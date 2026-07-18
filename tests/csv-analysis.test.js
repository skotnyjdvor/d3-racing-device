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
});
