import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseRaceBoxCsv } from "../src/domain/csv.js";
import { splitSessionIntoLaps } from "../src/domain/laps.js";
import { analyzeSession } from "../src/domain/analysis.js";
import { identifyTrack } from "../src/domain/tracks.js";
import { TRACKS } from "../src/domain/track-catalog.js";
import { computeSectors } from "../src/domain/sectors.js";

function viterboSession() {
  const raw = parseRaceBoxCsv(fs.readFileSync(new URL("../src/fixtures/viterbo-session-2026-07-10.csv", import.meta.url), "utf8"));
  const points = splitSessionIntoLaps(raw, identifyTrack(raw, TRACKS));
  return { points, analysis: analyzeSession(points) };
}

test("splits every Viterbo lap into three sectors that add up to the lap time", () => {
  const { points, analysis } = viterboSession();
  const result = computeSectors(points, analysis);
  assert.equal(result.count, 3);
  assert.equal(result.gates.length, 2);
  assert.equal(result.referenceLap, analysis.fastestLap.number);
  assert.equal(result.laps.length, analysis.laps.length);
  for (const lap of result.laps) {
    assert.ok(lap.sectors, `lap ${lap.number} has sectors`);
    assert.equal(lap.sectors.length, 3);
    const sum = lap.sectors.reduce((total, value) => total + value, 0);
    assert.ok(Math.abs(sum - lap.durationMs) < 1, `lap ${lap.number} sectors sum to lap time`);
    lap.sectors.forEach((value) => assert.ok(value > 10_000 && value < 25_000));
  }
});

test("ideal lap is the sum of best sectors and never slower than the fastest lap", () => {
  const { points, analysis } = viterboSession();
  const result = computeSectors(points, analysis);
  result.best.forEach((best, sector) => {
    const minimum = Math.min(...result.laps.map((lap) => lap.sectors[sector]));
    assert.equal(best.timeMs, minimum);
    assert.equal(result.laps.find((lap) => lap.number === best.lap).sectors[sector], minimum);
  });
  assert.equal(result.idealMs, result.best.reduce((sum, item) => sum + item.timeMs, 0));
  assert.ok(result.idealMs <= analysis.fastestLap.durationMs);
  assert.equal(result.potentialMs, analysis.fastestLap.durationMs - result.idealMs);
  assert.ok(result.potentialMs > 0 && result.potentialMs < 2_000);
});

test("a lap that misses a sector gate gets no sectors and is excluded from the ideal lap", () => {
  const { points, analysis } = viterboSession();
  const broken = points.filter((point) => {
    if (point.lap !== 5) return true;
    const lapPoints = points.filter((item) => item.lap === 5);
    const index = lapPoints.indexOf(point);
    return index < lapPoints.length * 0.25 || index > lapPoints.length * 0.45;
  });
  const result = computeSectors(broken, analysis);
  assert.equal(result.laps.find((lap) => lap.number === 5).sectors, null);
  assert.ok(result.best.every((best) => best.lap !== 5));
  assert.ok(Number.isFinite(result.idealMs));
});

test("returns null without a fastest lap", () => {
  assert.equal(computeSectors([], { laps: [], fastestLap: null }), null);
});
