import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseRaceBoxCsv } from "../src/domain/csv.js";
import { splitSessionIntoLaps } from "../src/domain/laps.js";
import { extractLapEvents } from "../src/domain/lap-events.js";
import { identifyTrack } from "../src/domain/tracks.js";

const session = parseRaceBoxCsv(fs.readFileSync(new URL("../src/fixtures/viterbo-session-2026-07-10.csv", import.meta.url), "utf8"));
const prepared = splitSessionIntoLaps(session, identifyTrack(session));
const events = extractLapEvents(prepared.filter((point) => point.lap === 4));

test("detects driving phases in the Viterbo reference lap", () => {
  assert.ok(events.corners.length >= 8);
  assert.ok(events.brakingZones.length >= 5);
  assert.ok(events.accelerationZones.length >= 5);
  assert.deepEqual(events.corners.map((event) => event.id), events.corners.map((_event, index) => `C${index + 1}`));
});

test("describes a major braking zone with measured evidence", () => {
  const zone = events.brakingZones.find((event) => event.startPercent >= 5 && event.startPercent <= 7);
  assert.ok(zone);
  assert.ok(zone.speedDropKph > 35);
  assert.ok(zone.peakDecelerationG > 0.4);
  assert.ok(zone.endPercent > zone.startPercent);
});

test("returns no phases for insufficient data", () => {
  assert.deepEqual(extractLapEvents([]), { corners: [], brakingZones: [], accelerationZones: [] });
});
