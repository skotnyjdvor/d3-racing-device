// Derived ("maths") channels for one lap, computed from GPS only so they do not depend on how the
// logger is mounted (cars, karts and leaning motorcycles alike):
//   longG     longitudinal acceleration in g from the GPS speed (+ accelerating, − braking)
//   latG      lateral acceleration in g from the curvature of the GPS path (+ right-hand turn, − left)
//   combinedG length of the lateral/longitudinal vector — how much grip is being used
//   lean      lean angle in degrees a motorcycle needs for that lateral load, atan(latG)
//   radius    corner radius in metres (null on straights)
//   phase     "braking" | "corner" | "accel" | "coast"
import { localPoint } from "./laps.js";

const G = 9.80665;
const BRAKING_G = -.14;
const ACCEL_G = .09;
const CORNER_G = .3;
const MIN_CORNER_ACCEL = 1.5; // m/s², below this the path counts as straight
const MAX_RADIUS = 2000;

function median(values) {
  if (!values.length) return 40;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function movingAverage(values, radius) {
  const prefix = [0];
  values.forEach((value) => prefix.push(prefix.at(-1) + value));
  return values.map((_value, index) => {
    const start = Math.max(0, index - radius);
    const end = Math.min(values.length - 1, index + radius);
    return (prefix[end + 1] - prefix[start]) / (end - start + 1);
  });
}

const finite = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

export function deriveChannels(points) {
  const count = points.length;
  if (!count) return [];
  const times = points.map((point) => finite(point.timeMs));
  const period = median(times.slice(1).map((time, index) => time - times[index]).filter((value) => value > 0));
  const smooth = Math.max(1, Math.round(120 / period));
  const span = Math.max(2, Math.round(240 / period));
  const speeds = movingAverage(points.map((point) => finite(point.speed) / 3.6), smooth);
  const origin = points[0];
  const positions = points.map((point) => localPoint(point, origin));

  const longitudinal = speeds.map((_speed, index) => {
    const before = Math.max(0, index - smooth);
    const after = Math.min(count - 1, index + smooth);
    const seconds = (times[after] - times[before]) / 1000;
    return seconds > 0 ? (speeds[after] - speeds[before]) / seconds / G : 0;
  });

  // Signed curvature through three points `span` samples apart (Menger curvature).
  const curvature = positions.map((here, index) => {
    const a = positions[index - span];
    const c = positions[index + span];
    if (!a || !c) return null;
    const ab = Math.hypot(here.x - a.x, here.y - a.y);
    const bc = Math.hypot(c.x - here.x, c.y - here.y);
    const ac = Math.hypot(c.x - a.x, c.y - a.y);
    if (ab < .5 || bc < .5 || ac < .5) return 0;
    const cross = (here.x - a.x) * (c.y - here.y) - (here.y - a.y) * (c.x - here.x);
    // Positive cross = counter-clockwise = left turn; the channel uses + for right-hand turns.
    return -2 * cross / (ab * bc * ac);
  });
  const firstKnown = curvature.findIndex((value) => value !== null);
  const lastKnown = curvature.findLastIndex((value) => value !== null);
  const filled = curvature.map((value, index) => value ?? (firstKnown < 0 ? 0 : curvature[index < firstKnown ? firstKnown : lastKnown]));
  const lateral = movingAverage(filled.map((value, index) => value * speeds[index] ** 2 / G), smooth);

  return points.map((point, index) => {
    const latG = lateral[index];
    const longG = longitudinal[index];
    const lateralAccel = Math.abs(latG) * G;
    const speed = speeds[index];
    const radius = lateralAccel >= MIN_CORNER_ACCEL && speed >= 5 ? Math.min(MAX_RADIUS, speed ** 2 / lateralAccel) : null;
    const phase = longG <= BRAKING_G ? "braking" : Math.abs(latG) >= CORNER_G ? "corner" : longG >= ACCEL_G ? "accel" : "coast";
    return {
      speed: finite(point.speed),
      longG,
      latG,
      combinedG: Math.hypot(latG, longG),
      lean: Math.atan(latG) * 180 / Math.PI,
      radius,
      phase,
    };
  });
}
