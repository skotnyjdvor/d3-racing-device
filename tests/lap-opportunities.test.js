import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseRaceBoxCsv } from "../src/domain/csv.js";
import { splitSessionIntoLaps } from "../src/domain/laps.js";
import { detectLapOpportunities } from "../src/domain/lap-opportunities.js";
import { identifyTrack } from "../src/domain/tracks.js";
import { TRACKS } from "../src/domain/track-catalog.js";

const session = parseRaceBoxCsv(fs.readFileSync(new URL("../src/fixtures/viterbo-session-2026-07-10.csv", import.meta.url), "utf8"));
const prepared = splitSessionIntoLaps(session, identifyTrack(session, TRACKS));
const lap = (number) => prepared.filter((point) => point.lap === number);

test("finds the corner where lap 5 over-slowed, with strong evidence, from that lap alone", () => {
  const result = detectLapOpportunities(lap(5));
  const corner = result.zones.find((zone) => zone.type === "cornerSpeed" && zone.distancePercent > 11 && zone.distancePercent < 15);
  assert.ok(corner, "corner zone near 12% of the lap");
  assert.equal(corner.evidenceStrength, "strong");
  assert.ok(corner.evidence.cornerGripUsePercent < 55);
  assert.ok(corner.evidence.apexSpeedKph < 60);
});

test("zones are ordered along the lap, bounded and carry a positive estimate", () => {
  for (const number of [1, 2, 3, 4, 5, 6, 7]) {
    const { zones, references } = detectLapOpportunities(lap(number));
    assert.ok(references.strongestBrakingG > 0.5 && references.cornerGripG > 1, `references for lap ${number}`);
    assert.ok(zones.length >= 1 && zones.length <= 5, `lap ${number} has ${zones.length} zones`);
    assert.deepEqual(zones.map((zone) => zone.id), zones.map((_zone, index) => `O${index + 1}`));
    zones.forEach((zone, index) => {
      assert.ok(["braking", "coasting", "cornerSpeed", "lateThrottle"].includes(zone.type));
      assert.ok(["strong", "moderate", "weak"].includes(zone.evidenceStrength));
      assert.ok(zone.startPercent >= 0 && zone.endPercent <= 100 && zone.startPercent <= zone.endPercent);
      assert.ok(zone.distancePercent >= zone.startPercent - 0.1 && zone.distancePercent <= zone.endPercent + 0.1);
      assert.ok(zone.estimatedGainSeconds > 0 && zone.estimatedGainSeconds < 1);
      if (index) assert.ok(zone.distancePercent >= zones[index - 1].distancePercent);
    });
  }
});

test("a clean lap still gets focus corners, but only as weak evidence", () => {
  const { zones } = detectLapOpportunities(lap(3));
  assert.ok(zones.length >= 1);
  assert.ok(zones.every((zone) => zone.evidenceStrength === "weak"));
});

test("soft braking in a straight line is flagged against the lap's own strongest braking", () => {
  const { zones } = detectLapOpportunities(lap(7));
  const braking = zones.find((zone) => zone.type === "braking");
  assert.ok(braking);
  assert.ok(braking.evidence.peakDecelerationG < braking.evidence.lapStrongestBrakingG * 0.7);
});

test("waiting at the slowest point of a corner is reported as late throttle", () => {
  // Hold the speed flat for ~1.2 s after the apex of the corner around 47% of lap 3.
  const points = lap(3).map((point) => ({ ...point }));
  const apex = points.reduce((best, point, index) => (index > points.length * 0.44 && index < points.length * 0.5 && point.speed < points[best].speed ? index : best), Math.floor(points.length * 0.44));
  for (let index = apex; index < apex + 30; index += 1) points[index].speed = points[apex].speed;
  for (let index = apex + 30; index < apex + 70; index += 1) points[index].speed = Math.max(points[apex].speed, points[index].speed - (points[apex + 30].speed - points[apex].speed) * (1 - (index - apex - 30) / 40));
  const { zones } = detectLapOpportunities(points, { maxZones: 5 });
  const late = zones.find((zone) => zone.type === "lateThrottle");
  assert.ok(late, `zones: ${zones.map((zone) => zone.type).join(", ")}`);
  assert.ok(late.evidence.waitSeconds >= 0.6);
});

test("highlights name what the lap already does well", () => {
  const { highlights } = detectLapOpportunities(lap(3));
  assert.deepEqual(highlights.map((item) => item.type), ["strongestBraking", "bestCorner", "topSpeed"]);
  assert.ok(highlights[0].evidence.peakDecelerationG > 0.8);
});

test("too little data yields no findings", () => {
  assert.deepEqual(detectLapOpportunities([]), { references: null, zones: [], highlights: [], corners: [] });
});
