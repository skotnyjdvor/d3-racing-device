import test from "node:test";
import assert from "node:assert/strict";
import { localSessionId, makeLocalSession, mergeSessions } from "../src/domain/local-sessions.js";

const points = (start, count = 3) => Array.from({ length: count }, (_, index) => ({ time: new Date(Date.parse(start) + index * 40).toISOString() }));

test("a local session is identified by its start time", () => {
  const session = makeLocalSession(points("2026-07-10T13:16:19.480Z", 5), { title: "Viterbo" });
  assert.equal(session.id, localSessionId("2026-07-10T13:16:19.480Z"));
  assert.equal(session.source, "local");
  assert.equal(session.pointCount, 5);
  assert.equal(session.title, "Viterbo");
  assert.equal(session.endedAt, "2026-07-10T13:16:19.640Z");
  assert.ok(!("points" in session), "points are stored separately");
  assert.throws(() => makeLocalSession([]));
});

test("merging keeps one copy per start time, newest first, and keeps renames and cloud links", () => {
  const older = makeLocalSession(points("2026-07-01T10:00:00Z"), { title: "Morning" });
  const newer = makeLocalSession(points("2026-07-02T10:00:00Z"));
  const stored = [{ ...older, title: "Renamed", cloudId: "abc" }];
  const merged = mergeSessions(stored, [older, newer]);
  assert.deepEqual(merged.map((session) => session.id), [newer.id, older.id]);
  assert.equal(merged[1].title, "Renamed");
  assert.equal(merged[1].cloudId, "abc");
  assert.equal(mergeSessions(merged, [newer]).length, 2);
});
