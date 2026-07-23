import { distanceMeters } from "./tracks.js";

const LATITUDE_METERS = 111_320;

function localPoint(point, origin) {
  const longitudeMeters = LATITUDE_METERS * Math.cos(origin.latitude * Math.PI / 180);
  return {
    x: (point.longitude - origin.longitude) * longitudeMeters,
    y: (point.latitude - origin.latitude) * LATITUDE_METERS,
  };
}

function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

function segmentIntersectionRatio(a, b, c, d) {
  const path = { x: b.x - a.x, y: b.y - a.y };
  const line = { x: d.x - c.x, y: d.y - c.y };
  const denominator = cross(path, line);
  if (Math.abs(denominator) < 1e-9) return null;
  const offset = { x: c.x - a.x, y: c.y - a.y };
  const pathRatio = cross(offset, line) / denominator;
  const lineRatio = cross(offset, path) / denominator;
  return pathRatio >= 0 && pathRatio <= 1 && lineRatio >= 0 && lineRatio <= 1 ? pathRatio : null;
}

export function startFinishLine(track, halfWidthM = 20) {
  if (track.startFinish) return track.startFinish;
  if (!track.start?.point || !track.start?.next) return null;
  const origin = track.start.point;
  const next = localPoint(track.start.next, origin);
  const magnitude = Math.hypot(next.x, next.y);
  if (!magnitude) return null;
  const perpendicular = { x: -next.y / magnitude, y: next.x / magnitude };
  const longitudeMeters = LATITUDE_METERS * Math.cos(origin.latitude * Math.PI / 180);
  const coordinate = (sign) => ({
    latitude: origin.latitude + sign * perpendicular.y * halfWidthM / LATITUDE_METERS,
    longitude: origin.longitude + sign * perpendicular.x * halfWidthM / longitudeMeters,
  });
  return { a: coordinate(-1), b: coordinate(1) };
}

export function splitSessionIntoLaps(points, track, options = {}) {
  if (!points.length || !track) return points;
  if (points.some((point) => Number(point.lap) > 0)) return points;
  const line = startFinishLine(track, options.finishHalfWidthM ?? 20);
  if (!line) return points;

  const lineOrigin = {
    latitude: (line.a.latitude + line.b.latitude) / 2,
    longitude: (line.a.longitude + line.b.longitude) / 2,
  };
  const localLineA = localPoint(line.a, lineOrigin);
  const localLineB = localPoint(line.b, lineOrigin);
  const crossings = [];
  const minCrossingGapMs = options.minCrossingGapMs ?? 8_000;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (!Number.isFinite(previous.latitude) || !Number.isFinite(current.latitude)) continue;
    const ratio = segmentIntersectionRatio(
      localPoint(previous, lineOrigin),
      localPoint(current, lineOrigin),
      localLineA,
      localLineB,
    );
    if (ratio === null) continue;
    const previousTimeMs = Number(previous.timeMs);
    const currentTimeMs = Number(current.timeMs);
    const timeMs = previousTimeMs + (currentTimeMs - previousTimeMs) * ratio;
    const last = crossings.at(-1);
    if (!last || !Number.isFinite(timeMs) || timeMs - last.timeMs >= minCrossingGapMs) crossings.push({ index, timeMs });
  }

  if (crossings.length < 2) return points;
  const result = points.map((point) => ({ ...point, lap: 0 }));
  let lap = 1;
  const minLapTimeMs = options.minLapTimeMs ?? 12_000;
  const minLapDistanceM = options.minLapDistanceM ?? 120;
  for (let crossing = 1; crossing < crossings.length; crossing += 1) {
    const from = crossings[crossing - 1];
    const to = crossings[crossing];
    const durationMs = to.timeMs - from.timeMs;
    let distanceM = 0;
    for (let index = from.index + 1; index <= to.index; index += 1) {
      distanceM += distanceMeters(points[index - 1], points[index]);
    }
    if (durationMs < minLapTimeMs || distanceM < minLapDistanceM) continue;
    for (let index = from.index; index < to.index; index += 1) {
      result[index].lap = lap;
      result[index].lapStartTimeMs = from.timeMs;
      result[index].lapEndTimeMs = to.timeMs;
    }
    lap += 1;
  }
  return lap > 1 ? result : points;
}
