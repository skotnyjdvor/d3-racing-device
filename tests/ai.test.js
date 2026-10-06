import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseRaceBoxCsv } from "../src/domain/csv.js";
import { AI_FOLLOWUP_SCHEMA, AI_PILOT_LANGUAGE_RULES, AI_REPORT_SCHEMA, AI_STANDARD_REPORT_RULES, OTHER_PILOT_INSTRUCTIONS, SINGLE_LAP_INSTRUCTIONS, buildTelemetrySnapshot, generateAiFollowUp, groundAiReport, isSingleLapSnapshot, snapshotCacheKey, snapshotLapPair } from "../server/ai.mjs";

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
  assert.ok(snapshot.comparison.deltaLossZones.zones.every((zone) => ["beforeCorner", "inCorner", "afterCorner"].includes(zone.driverLocation)));
  assert.ok(JSON.stringify(snapshot).length < 25_000);
  assert.equal(snapshot.schema, "laptrace-telemetry-snapshot/v9");
  assert.equal(snapshot.analysisMode, "standard-report/v4-quality-aware-compact-advice");
  assert.equal(snapshot.session.dataQuality.assessment.level, "warning");
});

test("AI cache key is deterministic and input-sensitive", () => {
  const first = buildTelemetrySnapshot(points, { primaryLap: 4, comparisonLap: 6, language: "ru" });
  const second = buildTelemetrySnapshot(points, { primaryLap: 4, comparisonLap: 5 });
  const translated = buildTelemetrySnapshot(points, { primaryLap: 4, comparisonLap: 6, language: "en" });
  assert.equal(snapshotCacheKey("log-1", first), snapshotCacheKey("log-1", first));
  assert.notEqual(snapshotCacheKey("log-1", first), snapshotCacheKey("log-1", second));
  assert.notEqual(snapshotCacheKey("log-1", first), snapshotCacheKey("log-1", translated));
});

test("AI report schema requires evidence-backed structured sections", () => {
  assert.deepEqual(AI_REPORT_SCHEMA.required, ["summary", "strengths", "timeLosses", "consistency", "dataWarnings"]);
  assert.equal(AI_REPORT_SCHEMA.additionalProperties, false);
  assert.match(AI_REPORT_SCHEMA.properties.summary.description, /plain-language/);
  assert.match(AI_REPORT_SCHEMA.properties.timeLosses.items.properties.recommendation.description, /next lap/);
  assert.equal(AI_REPORT_SCHEMA.properties.timeLosses.items.properties.confidence.enum.length, 3);
  assert.deepEqual(AI_REPORT_SCHEMA.properties.timeLosses.items.required, ["zoneId", "observation", "hypothesis", "recommendation", "confidence"]);
});

test("AI follow-up schema returns a focused answer with evidence", () => {
  assert.equal(AI_FOLLOWUP_SCHEMA.additionalProperties, false);
  assert.deepEqual(AI_FOLLOWUP_SCHEMA.required, ["answer", "evidence", "dataWarnings"]);
  assert.equal(AI_FOLLOWUP_SCHEMA.properties.evidence.maxItems, 6);
});

test("AI report language is written for drivers without unexplained telemetry jargon", () => {
  assert.match(AI_PILOT_LANGUAGE_RULES, /racing driver/);
  assert.match(AI_PILOT_LANGUAGE_RULES, /what happened/);
  assert.match(AI_PILOT_LANGUAGE_RULES, /Do not use unexplained jargon/);
  assert.match(AI_STANDARD_REPORT_RULES, /only as hidden evidence/);
  assert.match(AI_STANDARD_REPORT_RULES, /Do not include digits/);
  assert.match(AI_STANDARD_REPORT_RULES, /before the corner, in the corner, or after the corner/);
});

test("AI follow-up rejects an empty question before calling the provider", async () => {
  await assert.rejects(
    generateAiFollowUp({}, {}, " ", { apiKey: "test-key" }),
    (error) => error.status === 422 && error.message === "Question is too short",
  );
});

test("grounds AI loss positions and deltas in deterministic telemetry zones", () => {
  const snapshot = buildTelemetrySnapshot(points, { primaryLap: 4, comparisonLap: 6, language: "en" });
  const firstZone = snapshot.comparison.deltaLossZones.zones[0];
  const report = groundAiReport({ timeLosses: [{
    zoneId: firstZone.id, distancePercent: 99, deltaSeconds: 99,
    observation: "Model explanation", hypothesis: "Model hypothesis", recommendation: "Model recommendation", confidence: "high",
  }] }, snapshot);
  assert.equal(report.timeLosses[0].distancePercent, firstZone.distancePercent);
  assert.equal(report.timeLosses[0].startPercent, firstZone.startPercent);
  assert.equal(report.timeLosses[0].endPercent, firstZone.endPercent);
  assert.equal(report.timeLosses[0].deltaSeconds, firstZone.deltaSeconds);
  assert.deepEqual(report.timeLosses[0].gForces, firstZone.gForces);
  assert.equal(report.timeLosses[0].driverLocation, firstZone.driverLocation);
  assert.equal(report.timeLosses[0].observation, "Model explanation");
  assert.equal(report.timeLosses[0].confidence, "medium");
  assert.equal(report.timeLosses.length, snapshot.comparison.deltaLossZones.zones.length);

  const poorSnapshot = structuredClone(snapshot);
  poorSnapshot.session.dataQuality.assessment.level = "poor";
  const poorReport = groundAiReport({ timeLosses: [{
    zoneId: firstZone.id, observation: "Observation", hypothesis: "Hypothesis", recommendation: "Recommendation", confidence: "high",
  }] }, poorSnapshot);
  assert.equal(poorReport.timeLosses[0].confidence, "low");
});

test("fallback AI loss text does not expose exact telemetry figures", () => {
  const snapshot = buildTelemetrySnapshot(points, { primaryLap: 4, comparisonLap: 6, language: "ru" });
  const report = groundAiReport({ timeLosses: [] }, snapshot);
  assert.doesNotMatch(report.timeLosses[0].observation, /\d/);
  assert.doesNotMatch(report.timeLosses[0].recommendation, /\d/);
});

test("single-lap mode builds a snapshot about one lap without a comparison lap", () => {
  const snapshot = buildTelemetrySnapshot(points, { primaryLap: 5, comparisonLap: 3, mode: "single", language: "en" });
  assert.ok(isSingleLapSnapshot(snapshot));
  assert.equal(snapshot.schema, "laptrace-telemetry-snapshot/v10");
  assert.equal(snapshot.lap.number, 5);
  assert.equal(snapshot.comparison.primaryLap, 5);
  assert.equal(snapshot.comparison.comparisonLap, null);
  assert.equal(snapshot.lap.trace.length, 41);
  assert.ok(snapshot.lap.detectedPhases.corners.length >= 8);
  assert.ok(snapshot.lap.references.strongestBrakingG > 0.5);
  const zones = snapshot.lap.opportunities.zones;
  assert.ok(zones.length >= 1);
  assert.ok(zones.every((zone) => /^O\d+$/.test(zone.id)));
  assert.ok(zones.every((zone) => ["beforeCorner", "inCorner", "afterCorner", "betweenCorners"].includes(zone.driverLocation)));
  assert.ok(zones.every((zone) => ["braking", "coasting", "corner", "acceleration"].includes(zone.phaseType)));
  assert.ok(zones.every((zone) => Number.isFinite(zone.speedKph) && Number.isFinite(zone.gForces.zone.meanAbsoluteLateralG)));
  assert.ok(snapshot.lap.highlights.length >= 2);
  const text = JSON.stringify(snapshot);
  assert.ok(!text.includes("deltaLossZones") && !text.includes("comparisonSpeedKph"), "no comparison data leaks into the single-lap snapshot");
  assert.ok(text.length < 25_000);
});

test("a session with one completed lap falls back to single-lap analysis", () => {
  const firstLapOnly = buildTelemetrySnapshot(points.slice(0, 3000), { primaryLap: 1, comparisonLap: 2 });
  if (firstLapOnly.session.completedLaps === 1) {
    assert.ok(isSingleLapSnapshot(firstLapOnly));
    assert.equal(firstLapOnly.session.lapTimeSpreadSeconds, 0);
  } else {
    assert.equal(isSingleLapSnapshot(firstLapOnly), false);
  }
});

test("single-lap and comparison reports never share a cache entry", () => {
  const single = buildTelemetrySnapshot(points, { primaryLap: 4, comparisonLap: 6, mode: "single" });
  const compare = buildTelemetrySnapshot(points, { primaryLap: 4, comparisonLap: 6, mode: "compare" });
  assert.notEqual(snapshotCacheKey("log-1", single), snapshotCacheKey("log-1", compare));
});

test("single-lap grounding keeps deterministic zones and caps confidence by evidence and data quality", () => {
  const snapshot = buildTelemetrySnapshot(points, { primaryLap: 5, mode: "single", language: "ru" });
  const zones = snapshot.lap.opportunities.zones;
  const strong = zones.find((zone) => zone.evidenceStrength === "strong");
  const weak = zones.find((zone) => zone.evidenceStrength === "weak");
  assert.ok(strong && weak);
  const report = groundAiReport({
    summary: "S", strengths: [], dataWarnings: [], consistency: { assessment: "A", lapTimeSpreadSeconds: 9 },
    timeLosses: zones.map((zone) => ({ zoneId: zone.id, distancePercent: 1, observation: "Obs", hypothesis: "Hyp", recommendation: "Rec", confidence: "high" })),
  }, snapshot);
  assert.equal(report.analysisMode, "single-lap");
  assert.equal(report.lapNumber, 5);
  assert.equal(report.consistency.lapTimeSpreadSeconds, snapshot.session.lapTimeSpreadSeconds);
  assert.equal(report.timeLosses.length, zones.length);
  const groundedStrong = report.timeLosses.find((item) => item.zoneId === strong.id);
  const groundedWeak = report.timeLosses.find((item) => item.zoneId === weak.id);
  assert.equal(groundedStrong.distancePercent, strong.distancePercent);
  assert.equal(groundedStrong.opportunityType, strong.type);
  assert.equal(groundedStrong.comparisonSpeedKph, null);
  assert.equal(groundedStrong.confidence, "medium", "the fixture's data quality is 'warning', so high is capped");
  assert.equal(groundedWeak.confidence, "low");

  const good = structuredClone(snapshot);
  good.session.dataQuality.assessment.level = "good";
  assert.equal(groundAiReport({ timeLosses: [{ zoneId: strong.id, observation: "O", hypothesis: "H", recommendation: "R", confidence: "high" }] }, good)
    .timeLosses.find((item) => item.zoneId === strong.id).confidence, "high");
});

test("single-lap fallback text is typed, localised and free of figures", () => {
  for (const language of ["ru", "en", "pl", "it"]) {
    const snapshot = buildTelemetrySnapshot(points, { primaryLap: 7, mode: "single", language });
    const report = groundAiReport({ timeLosses: [] }, snapshot);
    assert.ok(report.timeLosses.length >= 1);
    for (const item of report.timeLosses) {
      assert.ok(item.observation.length > 20 && item.recommendation.length > 20);
      assert.doesNotMatch(item.observation + item.hypothesis + item.recommendation, /\d/);
    }
  }
  const ru = groundAiReport({ timeLosses: [] }, buildTelemetrySnapshot(points, { primaryLap: 7, mode: "single", language: "ru" }));
  assert.match(ru.timeLosses.find((item) => item.opportunityType === "braking").observation, /торможение/);
});

test("single-lap instructions forbid comparisons and explain the zone types", () => {
  const text = SINGLE_LAP_INSTRUCTIONS.join(" ");
  assert.match(text, /There is no comparison lap/);
  assert.match(text, /lap\.opportunities\.zones is authoritative/);
  assert.match(text, /cornerSpeed/);
  assert.match(text, /never present it as a fact/);
  assert.match(text, /Do not include digits/);
});

test("comparing with another pilot's session orients the reference lap to the other pilot", () => {
  // The same fixture stands in for the other pilot's session: lap 3 is the fast reference, lap 5 is the user's slow lap.
  const snapshot = buildTelemetrySnapshot(points, { rival: points, primaryLap: 5, comparisonLap: 3, language: "en" });
  assert.equal(isSingleLapSnapshot(snapshot), false);
  assert.equal(snapshot.comparison.otherPilot, true);
  assert.equal(snapshot.comparison.userLap, 5);
  assert.equal(snapshot.comparison.otherPilotLap, 3);
  assert.equal(snapshot.comparison.primaryLap, 3, "the other pilot's lap is the reference");
  assert.equal(snapshot.comparison.comparisonLap, 5, "the user's lap is the one that loses time");
  assert.deepEqual(snapshotLapPair(snapshot), { primaryLap: 5, comparisonLap: 3 });
  assert.ok(snapshot.comparison.otherPilotLapDetails.timeSeconds > 50);
  const zones = snapshot.comparison.deltaLossZones.zones;
  assert.ok(zones.length >= 1 && zones.every((zone) => zone.deltaSeconds > 0));
  assert.ok(JSON.stringify(snapshot).length < 27_000);
  const normal = buildTelemetrySnapshot(points, { primaryLap: 5, comparisonLap: 3 });
  assert.deepEqual(snapshotLapPair(normal), { primaryLap: 5, comparisonLap: 3 });
  assert.notEqual(snapshotCacheKey("log-1", snapshot), snapshotCacheKey("log-1", normal));
});

test("a rival session on a different track or with no laps is rejected", () => {
  const far = points.map((point) => ({ ...point, latitude: point.latitude + 1 }));
  assert.throws(() => buildTelemetrySnapshot(points, { rival: far, primaryLap: 3 }), (error) => error.status === 422 && /different track/.test(error.message));
  const noLaps = points.map((point) => ({ ...point, lap: 0 })).slice(0, 40);
  assert.throws(() => buildTelemetrySnapshot(points, { rival: noLaps, primaryLap: 3 }), (error) => error.status === 422);
});

test("other-pilot reports address the user and use localised fallback wording", () => {
  for (const [language, word] of [["ru", /вы теряете/], ["en", /you lose/], ["pl", /tracisz/], ["it", /perdi/]]) {
    const snapshot = buildTelemetrySnapshot(points, { rival: points, primaryLap: 5, comparisonLap: 3, language });
    const report = groundAiReport({ timeLosses: [] }, snapshot);
    assert.match(report.timeLosses[0].observation, word);
    assert.doesNotMatch(report.timeLosses[0].observation, /\d/);
  }
  const text = OTHER_PILOT_INSTRUCTIONS.join(" ");
  assert.match(text, /ANOTHER pilot/);
  assert.match(text, /second person/);
  assert.match(text, /never judge talent or skill/);
  assert.match(text, /Different vehicles/);
});
