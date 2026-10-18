// Time delta between two laps along the lap distance. Series items are { progress (0..1), point: { timeMs } },
// i.e. the output of the app's distance resampling.

export function timeAtProgress(series, progress) {
  if (!series.length) return null;
  if (progress <= series[0].progress) return series[0].point.timeMs;
  if (progress >= series.at(-1).progress) return series.at(-1).point.timeMs;
  let low = 0; let high = series.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (series[middle].progress <= progress) low = middle;
    else high = middle;
  }
  const before = series[low]; const after = series[high];
  const ratio = Math.max(0, Math.min(1, (progress - before.progress) / Math.max(after.progress - before.progress, 1e-9)));
  return before.point.timeMs + (after.point.timeMs - before.point.timeMs) * ratio;
}

// Seconds the primary lap is behind (+) or ahead (−) of the comparison lap at each distance fraction.
export function deltaSeries(primary, comparison, samples = 800) {
  if (primary.length < 2 || comparison.length < 2) return [];
  const primaryStart = primary[0].point.timeMs;
  const comparisonStart = comparison[0].point.timeMs;
  return Array.from({ length: samples + 1 }, (_, index) => {
    const progress = index / samples;
    return { progress, value: ((timeAtProgress(primary, progress) - primaryStart) - (timeAtProgress(comparison, progress) - comparisonStart)) / 1000 };
  }).filter((item) => Number.isFinite(item.value));
}

// How fast the delta changes (seconds per whole lap): + where the primary lap loses time, − where it gains.
export function deltaRate(delta, radius = 6) {
  return delta.map((item, index) => {
    const before = delta[Math.max(0, index - radius)];
    const after = delta[Math.min(delta.length - 1, index + radius)];
    const span = after.progress - before.progress;
    return { progress: item.progress, value: span > 0 ? (after.value - before.value) / span : 0 };
  });
}
