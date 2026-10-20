// Speed unit: km/h (default) or mph. Telemetry and every calculation stay in km/h; only what is shown
// is converted. "unit.speed" is redirected to "unit.mph", so every label follows the choice.
import { redirectTranslation, refreshTranslations } from "./i18n.js";

const STORAGE_KEY = "d3-speed-unit";
const MPH_PER_KMH = 0.621371;

let unit = "kmh";
try { if (localStorage.getItem(STORAGE_KEY) === "mph") unit = "mph"; } catch {}

redirectTranslation("unit.speed", () => (unit === "mph" ? "unit.mph" : null));

export const speedUnit = () => unit;
export const toSpeed = (kmh) => (unit === "mph" && Number.isFinite(kmh) ? kmh * MPH_PER_KMH : kmh);

export function setSpeedUnit(next) {
  if ((next !== "kmh" && next !== "mph") || next === unit) return;
  unit = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch {}
  refreshTranslations();
}
