import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseRaceBoxCsv } from "../src/domain/csv.js";
import { splitSessionIntoLaps } from "../src/domain/laps.js";
import { analyzeSession } from "../src/domain/analysis.js";
import { cornerReport, statsFor, trackSections } from "../src/domain/corner-report.js";
import { identifyTrack } from "../src/domain/tracks.js";
import { TRACKS } from "../src/domain/track-catalog.js";

const session = parseRaceBoxCsv(fs.readFileSync(new URL("../src/fixtures/viterbo-session-2026-07-10.csv", import.meta.url), "utf8"));
const prepared = splitSessionIntoLaps(session, identifyTrack(session, TRACKS));
const analysis = analyzeSession(prepared);
const laps = analysis.laps.map((lap) => ({ number: lap.number, points: prepared.filter((point) => point.lap === lap.number) }));
const report = cornerReport(laps, analysis.fastestLap.number);

test("sections cover the whole lap without gaps, corners numbered along the track", () => {
  const { sections } = report;
  assert.equal(sections[0].from, 0);
  assert.equal(sections.at(-1).to, 1);
  sections.slice(1).forEach((section, index) => assert.equal(section.from, sections[index].to, `${section.id} starts where the previous ends`));
  sections.forEach((section) => assert.ok(section.to > section.from, section.id));
  const corners = sections.filter((section) => section.kind === "corner");
  assert.ok(corners.length >= 6, `${corners.length} corners`);
  assert.deepEqual(corners.map((corner) => corner.id), corners.map((_corner, index) => `T${index + 1}`));
  corners.forEach((corner) => assert.ok(corner.apex >= corner.from - 1e-9 && corner.apex <= corner.to + 1e-9, `${corner.id} apex inside`));
  sections.filter((section) => section.kind === "straight").forEach((straight) => assert.match(straight.id, /^(SF|T\d+)-(SF|T\d+)$/));
});

test("section times add up to the lap time", () => {
  for (const row of report.laps) {
    const lap = analysis.laps.find((item) => item.number === row.number);
    const total = row.stats.reduce((sum, stats) => sum + stats.timeMs, 0);
    assert.ok(Math.abs(total - lap.durationMs) < 120, `lap ${row.number}: ${total} vs ${lap.durationMs}`);
  }
});

test("speeds are consistent: the minimum is not above entry or exit", () => {
  for (const row of report.laps) {
    row.stats.forEach((stats, index) => {
      assert.ok(stats.min <= stats.entry + 1e-9 && stats.min <= stats.exit + 1e-9, `lap ${row.number} ${report.sections[index].id}`);
      assert.ok(stats.max >= stats.entry - 1e-9 && stats.max >= stats.exit - 1e-9);
    });
  }
});

test("the ideal lap is made of the best section of each lap and is not slower than the fastest lap", () => {
  report.best.forEach((best, index) => {
    const times = report.laps.filter((row) => row.comparable).map((row) => row.stats[index].timeMs);
    assert.equal(best.timeMs, Math.min(...times));
  });
  const fastest = report.laps.find((row) => row.number === analysis.fastestLap.number);
  const fastestTotal = fastest.stats.reduce((sum, stats) => sum + stats.timeMs, 0);
  assert.ok(report.idealMs <= fastestTotal + 1e-6);
  assert.ok(report.idealMs > fastestTotal - 3000, "a plausible ideal lap");
});

test("a partial lap is shown but never provides a best section", () => {
  const partial = { number: 99, points: laps[1].points.slice(0, Math.floor(laps[1].points.length / 2)) };
  const withPartial = cornerReport([...laps, partial], analysis.fastestLap.number);
  assert.equal(withPartial.laps.find((row) => row.number === 99).comparable, false);
  assert.ok(withPartial.best.every((best) => best.lap !== 99));
});

test("another lap (for example a friend's) is measured on the same sections", () => {
  const stats = statsFor(laps[2].points, report.sections);
  assert.equal(stats.length, report.sections.length);
  assert.deepEqual(stats, report.laps[2].stats);
});

test("no usable lap gives no report; a lap without corners is one straight", () => {
  assert.equal(cornerReport([], 1), null);
  assert.equal(cornerReport([{ number: 1, points: [] }], 1), null);
  const straight = Array.from({ length: 50 }, (_item, index) => ({ timeMs: index * 40, latitude: 42 + index * 1e-5, longitude: 12, speed: 100, gForceY: 0 }));
  assert.deepEqual(trackSections(straight).map((section) => [section.id, section.from, section.to]), [["SF-SF", 0, 1]]);
});
