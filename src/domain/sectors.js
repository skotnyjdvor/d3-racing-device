import { localPoint, segmentIntersectionRatio } from "./laps.js";
import { distanceMeters } from "./tracks.js";

const LATITUDE_METERS = 111_320;

function validPoint(point) {
  return Number.isFinite(point?.latitude) && Number.isFinite(point?.longitude) && Number.isFinite(Number(point?.timeMs));
}

function cumulativeDistances(points) {
  const distances = [0];
  for (let index = 1; index < points.length; index += 1) distances.push(distances[index - 1] + distanceMeters(points[index - 1], points[index]));
  return distances;
}

function pointAtDistance(points, distances, target) {
  const clamped = Math.max(0, Math.min(distances.at(-1), target));
  let index = distances.findIndex((distance) => distance >= clamped);
  if (index <= 0) index = 1;
  const span = distances[index] - distances[index - 1];
  const ratio = span > 0 ? (clamped - distances[index - 1]) / span : 0;
  const a = points[index - 1]; const b = points[index];
  return { latitude: a.latitude + (b.latitude - a.latitude) * ratio, longitude: a.longitude + (b.longitude - a.longitude) * ratio };
}

// Gate = short line perpendicular to the direction of travel at a fraction of the reference lap distance.
function buildGate(points, distances, fraction, halfWidthM) {
  const total = distances.at(-1);
  const center = pointAtDistance(points, distances, total * fraction);
  const behind = localPoint(pointAtDistance(points, distances, total * fraction - 6), center);
  const ahead = localPoint(pointAtDistance(points, distances, total * fraction + 6), center);
  const direction = { x: ahead.x - behind.x, y: ahead.y - behind.y };
  const magnitude = Math.hypot(direction.x, direction.y);
  if (!magnitude) return null;
  const unit = { x: direction.x / magnitude, y: direction.y / magnitude };
  const longitudeMeters = LATITUDE_METERS * Math.cos(center.latitude * Math.PI / 180);
  const coordinate = (sign) => ({
    latitude: center.latitude + sign * unit.x * halfWidthM / LATITUDE_METERS,
    longitude: center.longitude - sign * unit.y * halfWidthM / longitudeMeters,
  });
  return { fraction, center, direction: unit, a: coordinate(-1), b: coordinate(1) };
}

function gateCrossing(points, distances, gate, maxFractionError) {
  const lineA = localPoint(gate.a, gate.center);
  const lineB = localPoint(gate.b, gate.center);
  const total = distances.at(-1) || 1;
  let best = null;
  for (let index = 1; index < points.length; index += 1) {
    const from = localPoint(points[index - 1], gate.center);
    const to = localPoint(points[index], gate.center);
    const ratio = segmentIntersectionRatio(from, to, lineA, lineB);
    if (ratio === null) continue;
    if ((to.x - from.x) * gate.direction.x + (to.y - from.y) * gate.direction.y <= 0) continue;
    const fraction = (distances[index - 1] + (distances[index] - distances[index - 1]) * ratio) / total;
    const error = Math.abs(fraction - gate.fraction);
    if (error > maxFractionError || (best && best.error <= error)) continue;
    const previousTime = Number(points[index - 1].timeMs);
    best = { error, fraction, timeMs: previousTime + (Number(points[index].timeMs) - previousTime) * ratio };
  }
  return best;
}

export function computeSectors(points, analysis, options = {}) {
  const count = options.count ?? 3;
  const halfWidthM = options.halfWidthM ?? 25;
  const maxFractionError = options.maxFractionError ?? 0.18;
  const laps = analysis?.laps ?? [];
  const reference = analysis?.fastestLap;
  if (!reference || !points?.length || count < 2) return null;

  const byLap = new Map();
  points.forEach((point) => {
    if (!(point.lap > 0) || !validPoint(point)) return;
    if (!byLap.has(point.lap)) byLap.set(point.lap, []);
    byLap.get(point.lap).push(point);
  });
  const referencePoints = byLap.get(reference.number) ?? [];
  if (referencePoints.length < 10) return null;
  const referenceDistances = cumulativeDistances(referencePoints);
  if (referenceDistances.at(-1) < 100) return null;
  const gates = Array.from({ length: count - 1 }, (_, index) => buildGate(referencePoints, referenceDistances, (index + 1) / count, halfWidthM));
  if (gates.some((gate) => !gate)) return null;

  const lapSectors = laps.map((lap) => {
    const lapPoints = byLap.get(lap.number) ?? [];
    if (lapPoints.length < 4) return { number: lap.number, durationMs: lap.durationMs, sectors: null, gateFractions: null };
    const distances = cumulativeDistances(lapPoints);
    const startMs = Number.isFinite(Number(lapPoints[0].lapStartTimeMs)) ? Number(lapPoints[0].lapStartTimeMs) : Number(lapPoints[0].timeMs);
    const endMs = Number.isFinite(Number(lapPoints[0].lapEndTimeMs)) ? Number(lapPoints[0].lapEndTimeMs) : startMs + lap.durationMs;
    const crossings = gates.map((gate) => gateCrossing(lapPoints, distances, gate, maxFractionError));
    const marks = [startMs, ...crossings.map((crossing) => crossing?.timeMs ?? NaN), endMs];
    const sectors = marks.slice(1).map((mark, index) => mark - marks[index]);
    const valid = sectors.every((value) => Number.isFinite(value) && value > 0);
    return {
      number: lap.number,
      durationMs: lap.durationMs,
      sectors: valid ? sectors : null,
      gateFractions: valid ? crossings.map((crossing) => crossing.fraction) : null,
    };
  });

  const best = Array.from({ length: count }, (_, sector) => lapSectors.reduce((result, lap) => {
    const value = lap.sectors?.[sector];
    return value !== undefined && (!result || value < result.timeMs) ? { timeMs: value, lap: lap.number } : result;
  }, null));
  const complete = best.every(Boolean);
  const idealMs = complete ? best.reduce((sum, item) => sum + item.timeMs, 0) : null;
  return {
    count,
    referenceLap: reference.number,
    gates: gates.map(({ fraction, center, a, b }) => ({ fraction, center, a, b })),
    laps: lapSectors,
    best,
    idealMs,
    bestLapMs: reference.durationMs,
    potentialMs: complete ? Math.max(0, reference.durationMs - idealMs) : null,
  };
}
