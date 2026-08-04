import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseRaceBoxCsv } from "../src/domain/csv.js";
import { AI_REPORT_SCHEMA, buildTelemetrySnapshot, groundAiReport, snapshotCacheKey } from "../server/ai.mjs";

const points = parseRaceBoxCsv(fs.readFileSync(new URL("../src/fixtures/viterbo-session-2026-07-10.csv", import.meta.url), "utf8"));

test("builds a compact AI snapshot from a full telemetry log", () => {
  const snapshot = buildTelemetrySnapshot(points, { primaryLap: 4, comparisonLap: 6, language: "ru" });
  assert.equal(snapshot.track.name, "Circuito Internazionale Viterbo");
  assert.equal(snapshot.comparison.primaryLap, 4);
  assert.equal(snapshot.comparison.comparisonLap, 6);
  assert.equal(snapshot.comparison.trace.length, 41);
  assert.ok(snapshot.comparison.detectedPhases.primary.corners.length >= 8);
  assert.ok(snapshot.comparison.detectedPhases.primary.brakingZones.length >= 5);
  assert.ok(snapshot.comparison.detectedPhases.primary.accelerationZones.length >= 5);
  assert.ok(snapshot.comparison.deltaLossZones.zones.length > 0);
  assert.ok(snapshot.comparison.deltaLossZones.zones.every((zone) => zone.deltaSeconds > 0));
  assert.ok(snapshot.comparison.deltaLossZones.zones.every((zone) => Number.isFinite(zone.gForces.primary.atLossPoint.longitudinalG)));
  assert.ok(snapshot.comparison.deltaLossZones.zones.every((zone) => Number.isFinite(zone.gForces.primary.atLossPoint.lateralG)));
  assert.ok(snapshot.comparison.deltaLossZones.zones.every((zone) => Number.isFinite(zone.gForces.comparison.zone.peakLongitudinalG)));
  assert.ok(snapshot.comparison.deltaLossZones.zones.every((zone) => Number.isFinite(zone.gForces.comparison.zone.peakLateralG)));
  assert.ok(JSON.stringify(snapshot).length < 25_000);
  assert.equal(snapshot.schema, "laptrace-telemetry-snapshot/v5");
});

test("AI cache key is deterministic and input-sensitive", () => {
  const first = buildTelemetrySnapshot(points, { primaryLap: 4, comparisonLap: 6 });
  const second = buildTelemetrySnapshot(points, { primaryLap: 4, comparisonLap: 5 });
  assert.equal(snapshotCacheKey("log-1", first), snapshotCacheKey("log-1", first));
  assert.notEqual(snapshotCacheKey("log-1", first), snapshotCacheKey("log-1", second));
});

test("AI report schema requires evidence-backed structured sections", () => {
  assert.deepEqual(AI_REPORT_SCHEMA.required, ["summary", "strengths", "timeLosses", "consistency", "dataWarnings"]);
  assert.equal(AI_REPORT_SCHEMA.additionalProperties, false);
  assert.equal(AI_REPORT_SCHEMA.properties.timeLosses.items.properties.confidence.enum.length, 3);
  assert.deepEqual(AI_REPORT_SCHEMA.properties.timeLosses.items.required, ["zoneId", "observation", "hypothesis", "recommendation", "confidence"]);
});

test("grounds AI loss positions and deltas in deterministic telemetry zones", () => {
  const snapshot = buildTelemetrySnapshot(points, { primaryLap: 4, comparisonLap: 6, language: "en" });
  const firstZone = snapshot.comparison.deltaLossZones.zones[0];
  const report = groundAiReport({ timeLosses: [{
    zoneId: firstZone.id, distancePercent: 99, deltaSeconds: 99,
    observation: "Model explanation", hypothesis: "Model hypothesis", recommendation: "Model recommendation", confidence: "medium",
  }] }, snapshot);
  assert.equal(report.timeLosses[0].distancePercent, firstZone.distancePercent);
  assert.equal(report.timeLosses[0].deltaSeconds, firstZone.deltaSeconds);
  assert.deepEqual(report.timeLosses[0].gForces, firstZone.gForces);
  assert.equal(report.timeLosses[0].observation, "Model explanation");
  assert.equal(report.timeLosses.length, snapshot.comparison.deltaLossZones.zones.length);
});
