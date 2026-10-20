// Lap report (like the Channel Report of MoTeC i2): per-lap maximum, minimum and average speed and peak
// G forces, plus how consistent the laps are. Out-laps, in-laps and laps spoiled by traffic can be left
// out of the summary; laps much slower than the best are left out by default.
// G forces come from GPS (domain/channels.js), so they do not depend on how the logger is mounted.

import { deriveChannels } from "./channels.js";

export const SLOW_LAP_FACTOR = 1.1; // laps over 110% of the best are out-laps, in-laps or spoiled

// Laps left out unless the pilot says otherwise: overrides is { [lapNumber]: true (excluded) | false }.
export function excludedLaps(laps, overrides = {}) {
  const times = laps.map((lap) => lap.durationMs).filter((value) => Number.isFinite(value) && value > 0);
  const best = times.length ? Math.min(...times) : null;
  return new Set(laps.filter((lap) => {
    const override = overrides?.[lap.number];
    if (typeof override === "boolean") return override;
    return best !== null && lap.durationMs > best * SLOW_LAP_FACTOR;
  }).map((lap) => lap.number));
}

function lapStats(points) {
  const channels = deriveChannels(points ?? []);
  if (!channels.length) return { maxSpeed: null, minSpeed: null, avgSpeed: null, maxLatG: null, maxBrakeG: null, maxAccelG: null, maxCombinedG: null };
  const pick = (key) => channels.map((item) => item[key]).filter(Number.isFinite);
  const speeds = pick("speed");
  const lat = pick("latG").map(Math.abs);
  const long = pick("longG");
  const combined = pick("combinedG");
  const max = (values) => (values.length ? Math.max(...values) : null);
  return {
    maxSpeed: max(speeds),
    minSpeed: speeds.length ? Math.min(...speeds) : null,
    avgSpeed: speeds.length ? speeds.reduce((sum, value) => sum + value, 0) / speeds.length : null,
    maxLatG: max(lat),
    maxBrakeG: long.length ? Math.max(0, -Math.min(...long)) : null,
    maxAccelG: long.length ? Math.max(0, Math.max(...long)) : null,
    maxCombinedG: max(combined),
  };
}

// laps: [{ number, durationMs, points }]; excluded: Set of lap numbers left out of the summary.
// `previous`: rows of an earlier report of the same laps, whose per-lap figures are reused.
export function lapReport(laps, excluded = new Set(), previous = null) {
  const known = new Map((previous ?? []).map((row) => [row.number, row]));
  const figures = (lap) => {
    const row = known.get(lap.number);
    if (!row) return lapStats(lap.points);
    const { maxSpeed, minSpeed, avgSpeed, maxLatG, maxBrakeG, maxAccelG, maxCombinedG } = row;
    return { maxSpeed, minSpeed, avgSpeed, maxLatG, maxBrakeG, maxAccelG, maxCombinedG };
  };
  const rows = laps.map((lap) => ({ number: lap.number, timeMs: lap.durationMs, excluded: excluded.has(lap.number), ...figures(lap) }));
  const included = rows.filter((row) => !row.excluded && Number.isFinite(row.timeMs));
  const times = included.map((row) => row.timeMs);
  const best = times.length ? Math.min(...times) : null;
  const mean = times.length ? times.reduce((sum, value) => sum + value, 0) / times.length : null;
  const stdev = times.length > 1 ? Math.sqrt(times.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (times.length - 1)) : null;
  // Best value of each column among the included laps, for highlighting.
  const bestOf = (key, pickMin = false) => {
    const values = included.map((row) => row[key]).filter(Number.isFinite);
    return values.length ? (pickMin ? Math.min(...values) : Math.max(...values)) : null;
  };
  return {
    rows: rows.map((row) => ({ ...row, gapMs: best !== null && Number.isFinite(row.timeMs) ? row.timeMs - best : null })),
    summary: {
      count: included.length,
      bestMs: best,
      meanMs: mean,
      stdevMs: stdev,
      spreadMs: times.length ? Math.max(...times) - best : null,
    },
    bestValues: {
      timeMs: best, maxSpeed: bestOf("maxSpeed"), minSpeed: bestOf("minSpeed"), avgSpeed: bestOf("avgSpeed"),
      maxLatG: bestOf("maxLatG"), maxBrakeG: bestOf("maxBrakeG"), maxAccelG: bestOf("maxAccelG"),
    },
  };
}
