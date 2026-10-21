import test from "node:test";
import assert from "node:assert/strict";
import { mercatorY } from "../src/satellite.js";

const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≉ ${expected}`);

test("mercatorY matches latitude at the equator and grows toward the poles", () => {
  near(mercatorY(0), 0);
  near(mercatorY(42.43), 46.9425, 0.001);
  near(mercatorY(-30), -mercatorY(30));
});

test("mercatorY maps the Web Mercator limit to the edge of the tile world", () => {
  near(mercatorY(85.05112878), 180, 1e-6);
  near(mercatorY(89), mercatorY(85.05112878));
});
