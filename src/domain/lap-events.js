import { distanceMeters } from "./tracks.js";

const G = 9.80665;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const rounded = (value, digits = 3) => Number(value.toFixed(digits));

function median(values) {
  if (!values.length) return 40;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
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

function rangesFromMask(mask, times, { mergeGapMs, minDurationMs }) {
  const raw = [];
  let start = null;
  mask.forEach((active, index) => {
    if (active && start === null) start = index;
    if ((!active || index === mask.length - 1) && start !== null) {
      const end = active && index === mask.length - 1 ? index : index - 1;
      raw.push({ start, end });
      start = null;
    }
  });
  const merged = [];
  raw.forEach((range) => {
    const previous = merged.at(-1);
    if (previous && times[range.start] - times[previous.end] <= mergeGapMs) previous.end = range.end;
    else merged.push({ ...range });
  });
  return merged.filter((range) => times[range.end] - times[range.start] >= minDurationMs);
}

function rangesFromLabels(labels, times, options) {
  const ranges = [];
  let start = null;
  let label = 0;
  labels.forEach((nextLabel, index) => {
    if (nextLabel !== label) {
      if (label && start !== null) ranges.push({ start, end: index - 1, label });
      start = nextLabel ? index : null;
      label = nextLabel;
    }
    if (index === labels.length - 1 && label && start !== null) ranges.push({ start, end: index, label });
  });
  const merged = [];
  ranges.forEach((range) => {
    const previous = merged.at(-1);
    if (previous && previous.label === range.label && times[range.start] - times[previous.end] <= options.mergeGapMs) previous.end = range.end;
    else merged.push({ ...range });
  });
  return merged.filter((range) => times[range.end] - times[range.start] >= options.minDurationMs);
}

function baseEvent(range, distance, totalDistance, times) {
  return {
    startPercent: rounded(distance[range.start] / totalDistance * 100, 1),
    endPercent: rounded(distance[range.end] / totalDistance * 100, 1),
    durationSeconds: rounded((times[range.end] - times[range.start]) / 1000),
  };
}

export function extractLapEvents(points) {
  if (!Array.isArray(points) || points.length < 5) return { corners: [], brakingZones: [], accelerationZones: [] };
  const times = points.map((point) => finite(point.timeMs));
  const intervals = times.slice(1).map((time, index) => time - times[index]).filter((value) => value > 0);
  const samplePeriodMs = median(intervals);
  const smoothRadius = Math.max(1, Math.round(120 / samplePeriodMs));
  const speeds = movingAverage(points.map((point) => finite(point.speed)), smoothRadius);
  const lateral = movingAverage(points.map((point) => finite(point.gForceY)), smoothRadius);
  const distance = [0];
  for (let index = 1; index < points.length; index += 1) {
    const step = distanceMeters(points[index - 1], points[index]);
    distance.push(distance.at(-1) + (Number.isFinite(step) && step < 100 ? step : 0));
  }
  const totalDistance = Math.max(distance.at(-1), 1);
  const acceleration = speeds.map((_speed, index) => {
    const before = Math.max(0, index - smoothRadius);
    const after = Math.min(speeds.length - 1, index + smoothRadius);
    const seconds = (times[after] - times[before]) / 1000;
    return seconds > 0 ? ((speeds[after] - speeds[before]) / 3.6) / seconds : 0;
  });
  const options = { mergeGapMs: 360, minDurationMs: 360 };

  const cornerRanges = rangesFromLabels(lateral.map((value, index) => Math.abs(value) >= 0.3 && speeds[index] >= 12 ? Math.sign(value) : 0), times, options);
  const brakingRanges = rangesFromMask(acceleration.map((value, index) => value <= -1.35 && speeds[index] >= 15), times, options);
  const accelerationRanges = rangesFromMask(acceleration.map((value, index) => value >= 0.9 && speeds[index] >= 10), times, { ...options, minDurationMs: 440 });

  const corners = cornerRanges.map((range) => {
    let apex = range.start;
    for (let cursor = range.start + 1; cursor <= range.end; cursor += 1) {
      if (speeds[cursor] < speeds[apex]) apex = cursor;
    }
    const meanLateral = lateral.slice(range.start, range.end + 1).reduce((sum, value) => sum + value, 0) / (range.end - range.start + 1);
    const peakLateralG = Math.max(...lateral.slice(range.start, range.end + 1).map(Math.abs));
    return {
      ...baseEvent(range, distance, totalDistance, times),
      apexPercent: rounded(distance[apex] / totalDistance * 100, 1),
      entrySpeedKph: rounded(speeds[range.start], 1),
      apexSpeedKph: rounded(speeds[apex], 1),
      exitSpeedKph: rounded(speeds[range.end], 1),
      peakLateralG: rounded(peakLateralG),
      direction: meanLateral >= 0 ? "positive" : "negative",
    };
  }).filter((event) => event.endPercent - event.startPercent >= 0.4).slice(0, 16)
    .map((event, index) => ({ id: `C${index + 1}`, ...event }));

  const brakingZones = brakingRanges.map((range) => {
    const slice = acceleration.slice(range.start, range.end + 1);
    return {
      ...baseEvent(range, distance, totalDistance, times),
      entrySpeedKph: rounded(speeds[range.start], 1),
      exitSpeedKph: rounded(speeds[range.end], 1),
      speedDropKph: rounded(Math.max(0, speeds[range.start] - speeds[range.end]), 1),
      peakDecelerationG: rounded(Math.abs(Math.min(...slice)) / G),
    };
  }).filter((event) => event.speedDropKph >= 4).slice(0, 16)
    .map((event, index) => ({ id: `B${index + 1}`, ...event }));

  const accelerationZones = accelerationRanges.map((range) => {
    const slice = acceleration.slice(range.start, range.end + 1);
    return {
      ...baseEvent(range, distance, totalDistance, times),
      entrySpeedKph: rounded(speeds[range.start], 1),
      exitSpeedKph: rounded(speeds[range.end], 1),
      speedGainKph: rounded(Math.max(0, speeds[range.end] - speeds[range.start]), 1),
      peakAccelerationG: rounded(Math.max(...slice) / G),
    };
  }).filter((event) => event.speedGainKph >= 4).slice(0, 16)
    .map((event, index) => ({ id: `A${index + 1}`, ...event }));

  return { corners, brakingZones, accelerationZones };
}
