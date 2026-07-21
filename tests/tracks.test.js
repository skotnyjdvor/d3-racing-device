import test from "node:test";
import assert from "node:assert/strict";
import { identifyTrack, sessionCenter } from "../src/domain/tracks.js";

test("identifies Circuito Internazionale di Viterbo from session coordinates", () => {
  const points = [
    { latitude: 42.4855225, longitude: 12.0712220 },
    { latitude: 42.4830598, longitude: 12.0687377 },
  ];
  assert.equal(identifyTrack(points)?.id, "circuito-internazionale-viterbo");
});

test("returns no track for a session outside the catalog radius", () => {
  assert.equal(identifyTrack([{ latitude: 52.4, longitude: 16.8 }]), null);
  assert.equal(sessionCenter([]), null);
});
