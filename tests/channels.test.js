import test from "node:test";
import assert from "node:assert/strict";
import { deriveChannels } from "../src/domain/channels.js";
import { deltaSeries, deltaRate, timeAtProgress } from "../src/domain/delta.js";

const G = 9.80665;
const LAT0 = 42.5;
const LON0 = 12.07;
const geo = (x, y) => ({ latitude: LAT0 + y / 111_320, longitude: LON0 + x / (111_320 * Math.cos(LAT0 * Math.PI / 180)) });

// 25 Hz samples along a path given by position(t) and speed(t) in m/s.
function samples(seconds, position, speed) {
  return Array.from({ length: Math.round(seconds * 25) + 1 }, (_, index) => {
    const time = index / 25;
    const { x, y } = position(time);
    return { ...geo(x, y), timeMs: 1_000_000 + time * 1000, speed: speed(time) * 3.6, gForceX: 0, gForceY: 0 };
  });
}
const middle = (values) => values.slice(Math.floor(values.length * .3), Math.floor(values.length * .7));
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

test("a steady circle gives lateral G, corner radius and lean angle from GPS alone", () => {
  const radius = 40; const speed = 15;
  // Clockwise when seen from above = a right-hand corner.
  const right = deriveChannels(samples(12, (t) => ({ x: radius * Math.sin(speed * t / radius), y: radius * Math.cos(speed * t / radius) }), () => speed));
  const expected = speed ** 2 / radius / G;
  const core = middle(right);
  assert.ok(Math.abs(mean(core.map((item) => item.latG)) - expected) < .02, `lat ${mean(core.map((item) => item.latG))} vs ${expected}`);
  assert.ok(Math.abs(mean(core.map((item) => item.radius)) - radius) < 1.5);
  assert.ok(Math.abs(mean(core.map((item) => item.lean)) - Math.atan(expected) * 180 / Math.PI) < 1.5);
  assert.ok(Math.abs(mean(core.map((item) => item.longG))) < .02);
  assert.ok(core.every((item) => item.phase === "corner"));
  // Counter-clockwise = left-hand corner: same size, opposite sign.
  const left = deriveChannels(samples(12, (t) => ({ x: radius * Math.sin(speed * t / radius), y: -radius * Math.cos(speed * t / radius) }), () => speed));
  assert.ok(mean(middle(left).map((item) => item.latG)) < -expected + .02);
});

test("straight-line acceleration and braking come from the GPS speed", () => {
  const accel = deriveChannels(samples(6, (t) => ({ x: 10 * t + 1.5 * t * t, y: 0 }), (t) => 10 + 3 * t));
  const core = middle(accel);
  assert.ok(Math.abs(mean(core.map((item) => item.longG)) - 3 / G) < .02);
  assert.ok(Math.abs(mean(core.map((item) => item.latG))) < .02);
  assert.ok(core.every((item) => item.radius === null && item.phase === "accel"));
  const brake = deriveChannels(samples(3, (t) => ({ x: 40 * t - 4 * t * t, y: 0 }), (t) => 40 - 8 * t));
  assert.ok(Math.abs(mean(middle(brake).map((item) => item.longG)) + 8 / G) < .03);
  assert.ok(middle(brake).every((item) => item.phase === "braking"));
});

test("combined G is the length of the lateral and longitudinal vector", () => {
  const derived = deriveChannels(samples(8, (t) => ({ x: 40 * Math.sin(15 * t / 40), y: 40 * Math.cos(15 * t / 40) }), () => 15));
  for (const item of derived) assert.ok(Math.abs(item.combinedG - Math.hypot(item.latG, item.longG)) < 1e-9);
});

test("short or empty input does not throw", () => {
  assert.deepEqual(deriveChannels([]), []);
  assert.equal(deriveChannels(samples(.04, () => ({ x: 0, y: 0 }), () => 0)).length, 2);
});

test("time delta and its rate show where a lap gains or loses", () => {
  const series = (seconds) => Array.from({ length: 101 }, (_, index) => ({ progress: index / 100, point: { timeMs: 5000 + index / 100 * seconds * 1000 } }));
  assert.equal(timeAtProgress(series(10), .25), 7500);
  // Primary lap 10% slower all the way round: the delta grows steadily to +1 s.
  const delta = deltaSeries(series(11), series(10), 200);
  assert.equal(delta.length, 201);
  assert.ok(Math.abs(delta.at(-1).value - 1) < 1e-9);
  const rate = deltaRate(delta);
  assert.ok(rate.every((item) => item.value > 0), "losing everywhere");
  assert.ok(deltaRate(deltaSeries(series(10), series(11), 200)).every((item) => item.value < 0), "gaining everywhere");
  assert.deepEqual(deltaSeries([], series(10)), []);
});
