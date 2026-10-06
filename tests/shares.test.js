import test from "node:test";
import assert from "node:assert/strict";
import { cleanPilotName, defaultPilotName, newShareToken, publicShare, shareTokenPattern } from "../server/shares.mjs";

test("share tokens are long, URL-safe and unique", () => {
  const tokens = new Set(Array.from({ length: 50 }, newShareToken));
  assert.equal(tokens.size, 50);
  for (const token of tokens) assert.match(token, shareTokenPattern);
  assert.ok(!shareTokenPattern.test("short"));
  assert.ok(!shareTokenPattern.test("../../etc/passwd" + "a".repeat(30)));
});

test("pilot names are trimmed, stripped of markup and fall back when too short", () => {
  assert.equal(cleanPilotName("  Marco   Rossi  "), "Marco Rossi");
  assert.equal(cleanPilotName("<b>Ma</b>rco"), "bMa/brco");
  assert.equal(cleanPilotName("x"), "Pilot");
  assert.equal(cleanPilotName("", "Fallback"), "Fallback");
  assert.equal(cleanPilotName("a".repeat(100)).length, 40);
});

test("the default pilot name never exposes the mail domain", () => {
  assert.equal(defaultPilotName("marco.rossi@example.com"), "marco.rossi");
  assert.ok(!defaultPilotName("marco.rossi@example.com").includes("example"));
  assert.equal(defaultPilotName("a@b.c"), "Pilot");
});

test("a public share carries the link built from the app origin", () => {
  const share = publicShare({ id: "1", token: "t".repeat(32), pilot_name: "Marco", created_at: "2026-10-01" }, "https://d3cf.com");
  assert.equal(share.url, `https://d3cf.com/#shared=${"t".repeat(32)}`);
  assert.equal(share.pilotName, "Marco");
});
