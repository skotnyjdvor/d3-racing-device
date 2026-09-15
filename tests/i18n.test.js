import test from "node:test";
import assert from "node:assert/strict";
import { getLanguage, setLanguage, SUPPORTED_LANGUAGES, t } from "../src/i18n.js";

test("supports Russian, English and Polish translations", () => {
  assert.deepEqual(SUPPORTED_LANGUAGES, ["ru", "en", "pl", "it"]);
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
  setLanguage("it");
  assert.equal(t("action.connect"), "Collega LapTrace");
  assert.equal(t("laps.option", { lap: 3, time: "0:54.880" }), "Giro 3 · 0:54.880");
  assert.equal(t("sectors.ideal"), "Giro ideale");
  setLanguage("ru");
  assert.equal(getLanguage(), "ru");
  assert.equal(t("ai.confidence.medium"), "средняя");
  assert.equal(t("ai.historyOpen"), "Открыть рапорт");
});

test("Italian table covers every key of the other languages", async () => {
  const { default: italian } = await import("../src/i18n-it.js");
  const { default: features } = await import("../src/features-i18n.js");
  const source = (await import("node:fs")).readFileSync(new URL("../src/i18n.js", import.meta.url), "utf8");
  const keys = new Set([...source.matchAll(/"([\w.]+)":\s*"/g)].map((match) => match[1]));
  Object.keys(features.en).forEach((key) => keys.add(key));
  assert.deepEqual([...keys].filter((key) => !(key in italian)), []);
});
