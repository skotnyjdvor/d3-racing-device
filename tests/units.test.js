import test from "node:test";
import assert from "node:assert/strict";
import { t } from "../src/i18n.js";
import { setSpeedUnit, speedUnit, toSpeed } from "../src/units.js";

test("speeds convert only for display, and the unit label follows the choice", () => {
  assert.equal(speedUnit(), "kmh");
  assert.equal(toSpeed(100), 100);
  const kmh = t("unit.speed");
  setSpeedUnit("mph");
  assert.equal(speedUnit(), "mph");
  assert.ok(Math.abs(toSpeed(100) - 62.1371) < 1e-6);
  assert.equal(toSpeed(null), null);
  assert.notEqual(t("unit.speed"), kmh);
  setSpeedUnit("knots");
  assert.equal(speedUnit(), "mph", "unknown units are ignored");
  setSpeedUnit("kmh");
  assert.equal(t("unit.speed"), kmh);
});
