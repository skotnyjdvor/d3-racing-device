import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseRaceBoxCsv } from "../src/domain/csv.js";
import { splitSessionIntoLaps } from "../src/domain/laps.js";
import { analyzeSession } from "../src/domain/analysis.js";
import { excludedLaps, lapReport } from "../src/domain/lap-report.js";
import { identifyTrack } from "../src/domain/tracks.js";
import { TRACKS } from "../src/domain/track-catalog.js";

const session = parseRaceBoxCsv(fs.readFileSync(new URL("../src/fixtures/viterbo-session-2026-07-10.csv", import.meta.url), "utf8"));
const prepared = splitSessionIntoLaps(session, identifyTrack(session, TRACKS));
const analysis = analyzeSession(prepared);
const laps = analysis.laps.map((lap) => ({ number: lap.number, durationMs: lap.durationMs, points: prepared.filter((point) => point.lap === lap.number) }));

test("slow laps are left out by default and the pilot can override it", () => {
  const timed = [{ number: 1, durationMs: 70_000 }, { number: 2, durationMs: 55_000 }, { number: 3, durationMs: 56_000 }, { number: 4, durationMs: 61_000 }];
  assert.deepEqual([...excludedLaps(timed)].sort(), [1, 4]);
  assert.deepEqual([...excludedLaps(timed, { 1: false, 3: true })].sort(), [3, 4]);
  assert.deepEqual([...excludedLaps([])], []);
});

test("every lap gets plausible speed and G figures", () => {
  const { rows } = lapReport(laps);
  assert.equal(rows.length, laps.length);
  for (const row of rows) {
    assert.ok(row.minSpeed > 20 && row.minSpeed < row.avgSpeed && row.avgSpeed < row.maxSpeed && row.maxSpeed < 200, JSON.stringify(row));
    assert.ok(row.maxLatG > .8 && row.maxLatG < 4, `lat ${row.maxLatG}`);
    assert.ok(row.maxBrakeG > .3 && row.maxBrakeG < 3, `brake ${row.maxBrakeG}`);
    assert.ok(row.maxAccelG > .1 && row.maxAccelG < 2, `accel ${row.maxAccelG}`);
  }
});

test("the summary uses only the included laps", () => {
  const all = lapReport(laps);
  const fastest = analysis.fastestLap;
  assert.equal(all.summary.bestMs, fastest.durationMs);
  assert.equal(all.summary.count, laps.length);
  const slowest = [...laps].sort((a, b) => b.durationMs - a.durationMs)[0];
  const without = lapReport(laps, new Set([slowest.number]));
  assert.equal(without.summary.count, laps.length - 1);
  assert.ok(without.summary.spreadMs < all.summary.spreadMs);
  assert.ok(without.summary.stdevMs < all.summary.stdevMs);
  assert.equal(without.rows.find((row) => row.number === slowest.number).excluded, true);
  assert.equal(without.rows.find((row) => row.number === fastest.number).gapMs, 0);
  const times = laps.filter((lap) => lap.number !== slowest.number).map((lap) => lap.durationMs);
  assert.ok(Math.abs(without.summary.meanMs - times.reduce((a, b) => a + b, 0) / times.length) < 1e-6);
});

test("with every lap excluded there is no summary, but the rows stay", () => {
  const report = lapReport(laps, new Set(laps.map((lap) => lap.number)));
  assert.equal(report.summary.count, 0);
  assert.equal(report.summary.bestMs, null);
  assert.equal(report.rows.length, laps.length);
});

test("per-lap figures of an earlier report are reused, only the summary changes", () => {
  const first = lapReport(laps);
  const again = lapReport(laps.map((lap) => ({ ...lap, points: [] })), new Set([laps[0].number]), first.rows);
  assert.deepEqual(again.rows.map((row) => row.maxSpeed), first.rows.map((row) => row.maxSpeed));
  assert.equal(again.summary.count, laps.length - 1);
});
