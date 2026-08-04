import test from "node:test";
import assert from "node:assert/strict";
import { detectDeltaLossZones } from "../src/domain/delta-losses.js";

test("detects only regions where cumulative delta increases", () => {
  const series = Array.from({ length: 101 }, (_, index) => {
    const progress = index / 100;
    let value = index < 20 ? 0 : index <= 35 ? (index - 20) * .004 : .06;
    if (index >= 70 && index <= 80) value += (index - 70) * .003;
    if (index > 80) value += .03;
    return { progress, value };
  });
  const zones = detectDeltaLossZones(series, { smoothingRadius: 1, minimumLossSeconds: .01 });
  assert.equal(zones.length, 2);
  assert.ok(zones[0].distancePercent >= 20 && zones[0].distancePercent <= 35);
  assert.ok(zones[1].distancePercent >= 70 && zones[1].distancePercent <= 80);
  assert.ok(zones.every((zone) => zone.deltaSeconds > 0));
});

test("does not mark flat or improving delta as a loss", () => {
  const flat = Array.from({ length: 101 }, (_, index) => ({ progress: index / 100, value: -index * .001 }));
  assert.deepEqual(detectDeltaLossZones(flat), []);
});
