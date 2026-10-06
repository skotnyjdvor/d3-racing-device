import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseRaceBoxCsv } from "../src/domain/csv.js";
import { computeLogStats } from "../server/stats.mjs";
import { cleanSettings, orderedPair, pilotNameOf, publicInvite } from "../server/friends.mjs";

test("computeLogStats summarises a real session: track, laps, best and ideal lap", () => {
  const points = parseRaceBoxCsv(fs.readFileSync(new URL("../src/fixtures/viterbo-session-2026-07-10.csv", import.meta.url), "utf8"));
  const stats = computeLogStats(points);
  assert.ok(stats.trackId, "the track is recognised");
  assert.ok(stats.lapCount > 2);
  assert.ok(stats.bestLapMs > 20_000 && stats.bestLapMs < 300_000);
  assert.ok(stats.idealLapMs <= stats.bestLapMs, "the ideal lap is never slower than the best lap");
  assert.ok(stats.distanceM > 1000);
});

test("computeLogStats returns null for logs that cannot be analysed", () => {
  assert.equal(computeLogStats([]), null);
  assert.equal(computeLogStats(null), null);
});

test("friend helpers: pilot names, ordered pairs, settings validation, invite links", () => {
  assert.equal(pilotNameOf({ display_name: "Marco R.", email: "m@x.com" }), "Marco R.");
  assert.equal(pilotNameOf({ display_name: null, email: "marco@x.com" }), "marco");
  assert.deepEqual(orderedPair("b", "a"), ["a", "b"]);
  assert.deepEqual(orderedPair("a", "b"), ["a", "b"]);
  assert.deepEqual(cleanSettings({ statsVisible: true }), { settings: { statsVisible: true } });
  assert.deepEqual(cleanSettings({ statsVisible: "yes" }), { settings: { statsVisible: false } });
  assert.ok(cleanSettings({ displayName: "x" }).error);
  assert.equal(cleanSettings({ displayName: "  " }).settings.displayName, null);
  assert.ok(cleanSettings({}).error);
  assert.equal(publicInvite({ id: "1", token: "T", created_at: "a", expires_at: "b" }, "https://d3cf.com").url, "https://d3cf.com/#friend=T");
});
