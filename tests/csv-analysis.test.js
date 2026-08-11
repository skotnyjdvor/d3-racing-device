import test from "node:test";
import assert from "node:assert/strict";
import { analyzeSession } from "../src/domain/analysis.js";
import { parseRaceBoxCsv } from "../src/domain/csv.js";

const csv = `Record,Time,Latitude,Longitude,Altitude,Speed,GForceX,GForceY,GForceZ,Lap,GyroX,GyroY,GyroZ
1,2026-07-10T13:16:19.480Z,42.0000000,12.0000000,320.0,10.0,-0.1,0.2,1.0,1,0,0,1
2,2026-07-10T13:16:19.520Z,42.0000001,12.0000001,320.0,20.0,-0.2,0.3,1.0,1,0,0,2
3,2026-07-10T13:16:19.560Z,42.0000002,12.0000002,320.0,30.0,-0.3,0.4,1.0,2,0,0,3
4,2026-07-10T13:16:19.600Z,42.0000003,12.0000003,320.0,40.0,-0.4,0.5,1.0,2,0,0,4`;

test("parses RaceBox CSV into typed points", () => {
  const points = parseRaceBoxCsv(csv);
  assert.equal(points.length, 4);
  assert.equal(points[0].timeMs, 1783689379480);
  assert.equal(points[3].speed, 40);
});

test("calculates sample rate and lap metrics", () => {
  const analysis = analyzeSession(parseRaceBoxCsv(csv));
  assert.equal(analysis.sampleRateHz, 25);
  assert.equal(analysis.laps.length, 2);
  assert.equal(analysis.laps[0].durationMs, 80);
  assert.equal(analysis.session.maxSpeed, 40);
  assert.equal(analysis.quality.gapCount, 0);
  assert.equal(analysis.quality.assessment.level, "warning");
  assert.equal(analysis.quality.assessment.checks.gps, "unknown");
});

test("rates GPS, stream continuity, and device mounting deterministically", () => {
  const makePoint = (index) => ({
    time: new Date(1_700_000_000_000 + index * 40).toISOString(), timeMs: 1_700_000_000_000 + index * 40,
    latitude: 42 + index * 1e-7, longitude: 12 + index * 1e-7, speed: 2,
    gForceX: 0, gForceY: 0, gForceZ: 1, gyroZ: 0, lap: 1,
    horizontalAccuracy: 1.2, satellites: 14, fixStatus: 3, fixStatusFlags: 1,
  });
  const good = analyzeSession(Array.from({ length: 30 }, (_, index) => makePoint(index)));
  assert.equal(good.quality.assessment.level, "good");
  assert.deepEqual(good.quality.assessment.checks, { gps: "good", stream: "good", mounting: "good" });

  const poorPoints = Array.from({ length: 30 }, (_, index) => ({
    ...makePoint(index), horizontalAccuracy: 12, satellites: 4, fixStatus: 2,
    gForceX: .95, gForceZ: .15,
    timeMs: 1_700_000_000_000 + index * 40 + (index >= 15 ? 1000 : 0),
  }));
  const poor = analyzeSession(poorPoints);
  assert.equal(poor.quality.assessment.level, "poor");
  assert.equal(poor.quality.assessment.checks.gps, "poor");
  assert.equal(poor.quality.assessment.checks.stream, "poor");
  assert.equal(poor.quality.assessment.checks.mounting, "poor");
});
