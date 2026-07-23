import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { splitSessionIntoLaps } from "../src/domain/laps.js";
import { parseRaceBoxCsv } from "../src/domain/csv.js";
import { analyzeSession } from "../src/domain/analysis.js";
import { identifyTrack } from "../src/domain/tracks.js";

function point(latitude, longitude, seconds) {
  return { latitude, longitude, timeMs: seconds * 1000, time: new Date(seconds * 1000).toISOString(), lap: 0 };
}

test("splits telemetry between consecutive start-line crossings into completed laps", () => {
  const track = {
    startFinish: {
      a: { latitude: -0.001, longitude: 0 },
      b: { latitude: 0.001, longitude: 0 },
    },
  };
  const loop = (offset) => [
    point(0, -0.0002, offset),
    point(0, 0.0002, offset + 1),
    point(0.001, 0.001, offset + 5),
    point(0, 0.002, offset + 10),
    point(-0.001, 0.001, offset + 15),
    point(0, -0.0002, offset + 19),
  ];
  const points = [...loop(0), ...loop(20).slice(1), ...loop(40).slice(1)];
  const result = splitSessionIntoLaps(points, track, { minLapTimeMs: 10_000, minLapDistanceM: 100 });
  assert.ok(result.some((item) => item.lap === 1));
  assert.ok(result.some((item) => item.lap === 2));
  assert.equal(result.at(-1).lap, 0);
});

test("preserves laps supplied by the logger", () => {
  const points = [{ latitude: 0, longitude: 0, timeMs: 0, lap: 7 }];
  assert.equal(splitSessionIntoLaps(points, {})[0].lap, 7);
});

test("recovers the seven Viterbo laps when logger lap numbers are absent", () => {
  const csv = fs.readFileSync(new URL("../src/fixtures/viterbo-session-2026-07-10.csv", import.meta.url), "utf8");
  const points = parseRaceBoxCsv(csv).map((item) => ({ ...item, lap: 0 }));
  const track = identifyTrack(points);
  const analysis = analyzeSession(splitSessionIntoLaps(points, track));
  assert.equal(track?.name, "Circuito Internazionale Viterbo");
  assert.equal(analysis.laps.length, 7);
  assert.ok(analysis.laps.every((lap) => lap.durationMs > 50_000 && lap.durationMs < 60_000));
});
