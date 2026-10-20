// Lap data helpers shared by the charts and the map: points grouped by lap, resampling along the
// distance of a lap ("progress" 0..1) and lookups by progress. Results are cached per points array.
import { distanceMeters } from "./domain/tracks.js";

export function downsample(points, max = 1800) {
  if (points.length <= max) return points;
  const step = points.length / max;
  return Array.from({ length: max }, (_, index) => points[Math.floor(index * step)]);
}

// Points grouped by lap, built once per points array: charts ask for laps on every cursor frame.
const lapIndex = new WeakMap();
export function lapsOf(points) {
  let laps = lapIndex.get(points);
  if (!laps) {
    laps = new Map();
    for (const point of points) {
      const lap = laps.get(point.lap);
      if (lap) lap.push(point); else laps.set(point.lap, [point]);
    }
    lapIndex.set(points, laps);
  }
  return laps;
}

// Distance resampling is cached per points array and sample count (laps come from lapsOf, so they are stable).
const distanceCache = new WeakMap();
export function distancePoints(points, max = 2400) {
  let bySize = distanceCache.get(points);
  if (!bySize) { bySize = new Map(); distanceCache.set(points, bySize); }
  if (!bySize.has(max)) bySize.set(max, computeDistancePoints(points, max));
  return bySize.get(max);
}
export function computeDistancePoints(points, max) {
  const sampled = downsample(points, max);
  if (sampled.length < 2) return [];
  let distance = 0;
  const series = sampled.map((point, index) => {
    if (index) distance += distanceMeters(sampled[index - 1], point);
    return { distance, point };
  });
  const total = Math.max(distance, 1);
  return series.map((item) => ({ progress: item.distance / total, point: item.point }));
}

export function pointAtProgress(series, progress) {
  if (!series.length || progress === null) return null;
  let low = 0; let high = series.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (series[middle].progress < progress) low = middle + 1;
    else high = middle;
  }
  if (low > 0 && Math.abs(series[low - 1].progress - progress) < Math.abs(series[low].progress - progress)) return series[low - 1];
  return series[low];
}
