import test from "node:test";
import assert from "node:assert/strict";
import { identifyTrack, loadTrackCatalog, sessionCenter } from "../src/domain/tracks.js";
import { TRACKS } from "../src/domain/track-catalog.js";

test("identifies Circuito Internazionale di Viterbo from session coordinates", () => {
  const points = [
    { latitude: 42.4855225, longitude: 12.0712220 },
    { latitude: 42.4830598, longitude: 12.0687377 },
  ];
  assert.equal(identifyTrack(points, TRACKS)?.id, "circuito-internazionale-viterbo");
});

test("returns no track for a session outside the catalog radius", () => {
  assert.equal(identifyTrack([{ latitude: 52.4, longitude: 16.8 }]), null);
  assert.equal(sessionCenter([]), null);
});

test("lazy catalog loads the full generated track list", async () => {
  const catalog = await loadTrackCatalog();
  assert.equal(catalog, TRACKS);
  assert.ok(catalog.length > 1000);
  const lonato = catalog.find((track) => /south garda/i.test(track.name));
  if (lonato) assert.equal(identifyTrack([lonato.center], catalog)?.id, lonato.id);
});
