import test from "node:test";
import assert from "node:assert/strict";
import { getLanguage, setLanguage, SUPPORTED_LANGUAGES, t } from "../src/i18n.js";

test("supports Russian, English and Polish translations", () => {
  assert.deepEqual(SUPPORTED_LANGUAGES, ["ru", "en", "pl"]);
  setLanguage("en");
  assert.equal(t("action.start"), "Start recording");
  assert.equal(t("action.connect"), "Connect LapTrace");
  assert.equal(t("ai.quality.warning"), "Use the advice with care");
  assert.equal(t("ai.historyTitle"), "Report history");
  setLanguage("pl");
  assert.equal(t("action.start"), "Rozpocznij zapis");
  assert.equal(t("device.satellites", { count: 12 }), "Satelity: 12");
  assert.equal(t("ai.details"), "Dlaczego taka porada");
  assert.equal(t("ai.historyDelete"), "Usuń");
  setLanguage("ru");
  assert.equal(getLanguage(), "ru");
  assert.equal(t("ai.confidence.medium"), "средняя");
  assert.equal(t("ai.historyOpen"), "Открыть рапорт");
});
