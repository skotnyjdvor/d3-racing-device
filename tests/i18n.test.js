import test from "node:test";
import assert from "node:assert/strict";
import { getLanguage, setLanguage, SUPPORTED_LANGUAGES, t } from "../src/i18n.js";

test("supports Russian, English and Polish translations", () => {
  assert.deepEqual(SUPPORTED_LANGUAGES, ["ru", "en", "pl"]);
  setLanguage("en");
  assert.equal(t("action.start"), "Start recording");
  assert.equal(t("action.connect"), "Connect LapTrace");
  setLanguage("pl");
  assert.equal(t("action.start"), "Rozpocznij zapis");
  assert.equal(t("device.satellites", { count: 12 }), "Satelity: 12");
  setLanguage("ru");
  assert.equal(getLanguage(), "ru");
});
