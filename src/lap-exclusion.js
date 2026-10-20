// Which laps of the open session are left out of the lap report summary and of the best sections of
// the corner report. Slow laps are left out by default (domain/lap-report.js); the pilot's choices are
// remembered per session.
import { excludedLaps } from "./domain/lap-report.js";

const STORAGE_KEY = "d3-lap-excluded";
const MAX_SESSIONS = 50;

function loadAll() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  } catch { return {}; }
}

const sessionKey = (state) => String(state.selectedSession?.id ?? "");

function overridesFor(state) {
  const saved = loadAll()[sessionKey(state)];
  if (!saved || typeof saved !== "object") return {};
  return Object.fromEntries(Object.entries(saved).filter(([, value]) => typeof value === "boolean"));
}

let cache = { key: "", laps: null, set: new Set() };
let version = 0;

export function getExcludedLaps(state) {
  const laps = state.analysis?.laps ?? [];
  const key = `${sessionKey(state)}|${version}`;
  if (cache.key !== key || cache.laps !== laps) cache = { key, laps, set: excludedLaps(laps, overridesFor(state)) };
  return cache.set;
}

export function setLapExcluded(state, lapNumber, excluded) {
  const all = loadAll();
  const key = sessionKey(state);
  const { [key]: current = {}, ...others } = all;
  // Newest session last, oldest dropped first.
  const kept = Object.fromEntries(Object.entries(others).slice(-(MAX_SESSIONS - 1)));
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...kept, [key]: { ...current, [lapNumber]: Boolean(excluded) } })); } catch {}
  version += 1;
}

// Changes with every toggle, for render caches.
export const exclusionVersion = () => version;
