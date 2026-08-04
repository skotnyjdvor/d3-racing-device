const rounded = (value, digits = 3) => Number(Number(value).toFixed(digits));

function movingAverage(values, radius) {
  const prefix = [0];
  values.forEach((value) => prefix.push(prefix.at(-1) + value));
  return values.map((_value, index) => {
    const start = Math.max(0, index - radius);
    const end = Math.min(values.length - 1, index + radius);
    return (prefix[end + 1] - prefix[start]) / (end - start + 1);
  });
}

export function detectDeltaLossZones(deltaSeries, options = {}) {
  const valid = (deltaSeries || []).filter((item) => Number.isFinite(item.progress) && Number.isFinite(item.value));
  if (valid.length < 8) return [];
  const smoothingRadius = options.smoothingRadius ?? Math.max(2, Math.round(valid.length * .01));
  const minimumLossSeconds = options.minimumLossSeconds ?? .012;
  const maxZones = options.maxZones ?? 6;
  const smoothed = movingAverage(valid.map((item) => item.value), smoothingRadius);
  const slopes = smoothed.map((value, index) => index ? value - smoothed[index - 1] : 0);
  const positive = slopes.map((slope) => slope > .00015);
  const raw = [];
  let start = null;
  positive.forEach((active, index) => {
    if (active && start === null) start = Math.max(0, index - 1);
    if ((!active || index === positive.length - 1) && start !== null) {
      raw.push({ start, end: active && index === positive.length - 1 ? index : index - 1 });
      start = null;
    }
  });
  const merged = [];
  raw.forEach((range) => {
    const previous = merged.at(-1);
    const gap = previous ? valid[range.start].progress - valid[previous.end].progress : Infinity;
    if (previous && gap <= .015) previous.end = range.end;
    else merged.push({ ...range });
  });
  const candidates = merged.map((range) => {
    const startIndex = Math.max(0, range.start - smoothingRadius);
    const endIndex = Math.min(valid.length - 1, range.end + smoothingRadius);
    let peakSlopeIndex = range.start;
    for (let index = range.start + 1; index <= range.end; index += 1) {
      if (slopes[index] > slopes[peakSlopeIndex]) peakSlopeIndex = index;
    }
    return {
      startPercent: rounded(valid[startIndex].progress * 100, 1),
      endPercent: rounded(valid[endIndex].progress * 100, 1),
      distancePercent: rounded(valid[peakSlopeIndex].progress * 100, 1),
      deltaStartSeconds: rounded(smoothed[startIndex]),
      deltaEndSeconds: rounded(smoothed[endIndex]),
      deltaSeconds: rounded(smoothed[endIndex] - smoothed[startIndex]),
      peakDeltaRate: rounded(slopes[peakSlopeIndex], 4),
    };
  }).filter((zone) => zone.deltaSeconds >= minimumLossSeconds && zone.endPercent > zone.startPercent);

  return candidates.sort((a, b) => b.deltaSeconds - a.deltaSeconds).slice(0, maxZones)
    .sort((a, b) => a.distancePercent - b.distancePercent)
    .map((zone, index) => ({ id: `D${index + 1}`, ...zone }));
}
