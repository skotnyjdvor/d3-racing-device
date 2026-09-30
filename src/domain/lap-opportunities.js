import { lapRanges, lapSignals } from "./lap-events.js";

// Single-lap analysis: finds places where one lap probably leaves time, using only that lap.
// The references are what the same lap already shows it can do (its strongest braking and its typical
// peak cornering grip), so every finding reads as "you already do better elsewhere on this lap".
// Gains are rough physics estimates used to rank the zones, not measured losses.

const G = 9.80665;
const rounded = (value, digits = 3) => Number(Number(value).toFixed(digits));
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);

function percentile(values, share) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
}

const strength = (value, strong, moderate, lowerIsStronger = true) => (lowerIsStronger
  ? value < strong ? "strong" : value < moderate ? "moderate" : "weak"
  : value >= strong ? "strong" : value >= moderate ? "moderate" : "weak");

export function detectLapOpportunities(points, options = {}) {
  if (!Array.isArray(points) || points.length < 20) return { references: null, zones: [], highlights: [], corners: [] };
  const signals = lapSignals(points);
  const { times, speeds, lateral, distance, totalDistance, acceleration } = signals;
  const { cornerRanges, brakingRanges } = lapRanges(signals);
  const count = points.length;
  const metres = speeds.map((kph) => kph / 3.6);
  const lat = lateral.map(Math.abs);
  const seconds = (index) => times[index] / 1000;
  const percent = (index) => rounded(distance[index] / totalDistance * 100, 1);
  const kph = (index) => rounded(speeds[index], 1);

  const peakDecel = (range) => -Math.min(...acceleration.slice(range.start, range.end + 1));
  const brakeRef = Math.max(3, ...brakingRanges.map(peakDecel));
  const gripRef = Math.max(0.4, percentile(cornerRanges.flatMap((range) => lat.slice(range.start, range.end + 1)), 0.95));
  // Friction-circle style usage: 1 means braking and turning as hard as this lap ever does, combined.
  const usage = (index) => Math.hypot(Math.max(0, -acceleration[index]) / brakeRef, lat[index] / gripRef);
  const nextBrakingStart = (index) => brakingRanges.find((range) => range.start > index)?.start ?? count - 1;
  const candidates = [];

  for (const range of brakingRanges) {
    const peak = peakDecel(range);
    const entry = metres[range.start];
    const exit = metres[range.end];
    const brakingSeconds = seconds(range.end) - seconds(range.start);
    const brakingDistance = distance[range.end] - distance[range.start];

    // Braking that uses clearly less grip than this lap shows elsewhere: brake later and firmer.
    let peakUsage = 0;
    for (let index = range.start; index <= range.end; index += 1) peakUsage = Math.max(peakUsage, usage(index));
    const meanDecel = (entry - exit) / Math.max(brakingSeconds, 0.001);
    if ((entry - exit) * 3.6 >= 12 && peakUsage < 0.75 && meanDecel > 0 && brakingDistance > 0) {
      const target = meanDecel * Math.min(1.35, 0.9 / peakUsage);
      const shorter = Math.min(brakingDistance, (entry * entry - exit * exit) / (2 * target));
      candidates.push({
        type: "braking", start: range.start, end: range.end, focus: range.start,
        gain: brakingSeconds - ((brakingDistance - shorter) / entry + (entry - exit) / target),
        strength: strength(peakUsage, 0.55, 0.65),
        evidence: { entrySpeedKph: kph(range.start), exitSpeedKph: kph(range.end), peakDecelerationG: rounded(peak / G), lapStrongestBrakingG: rounded(brakeRef / G), gripUsePercent: Math.round(peakUsage * 100), durationSeconds: rounded(brakingSeconds, 2) },
      });
    }

    // Coasting: after lifting off the car rolls before the brakes really bite.
    let onset = range.start;
    while (onset < range.end && -acceleration[onset] < 0.5 * peak) onset += 1;
    let lift = onset;
    while (lift > 0 && seconds(onset) - seconds(lift) < 3 && acceleration[lift] / G <= -0.02) lift -= 1;
    const coastSeconds = seconds(onset) - seconds(lift);
    let coastGrip = 0;
    for (let index = lift; index <= onset; index += 1) coastGrip = Math.max(coastGrip, lat[index] / gripRef);
    if (coastSeconds >= 0.55 && coastGrip < 0.6 && metres[lift] > metres[onset]) {
      const start = metres[lift];
      const atBrakes = metres[onset];
      const coastDistance = distance[onset] - distance[lift];
      const shorter = Math.min(coastDistance, (start * start - atBrakes * atBrakes) / (2 * peak));
      candidates.push({
        type: "coasting", start: lift, end: onset, focus: lift,
        gain: coastSeconds - ((coastDistance - shorter) / start + (start - atBrakes) / peak),
        strength: strength(coastSeconds, 1, 0.75, false),
        evidence: { coastSeconds: rounded(coastSeconds, 2), speedAtLiftKph: kph(lift), speedAtBrakingKph: kph(onset), peakDecelerationG: rounded(peak / G) },
      });
    }
  }

  const corners = [];
  for (const range of cornerRanges) {
    let peakLat = 0;
    let apex = range.start;
    for (let index = range.start; index <= range.end; index += 1) {
      peakLat = Math.max(peakLat, lat[index]);
      if (speeds[index] < speeds[apex]) apex = index;
    }
    // Flat-out kinks and corners that barely slow the car say nothing about corner speed.
    if (peakLat < 0.6 * gripRef || speeds[range.start] - speeds[apex] < 8) continue;
    const core = [];
    for (let index = range.start; index <= range.end; index += 1) if (Math.abs(seconds(index) - seconds(apex)) <= 0.35) core.push(lat[index]);
    const coreLat = mean(core);
    const coreUse = coreLat / gripRef;
    let slowStart = apex;
    while (slowStart > range.start && speeds[slowStart - 1] <= speeds[apex] + 5) slowStart -= 1;
    let slowEnd = apex;
    while (slowEnd < range.end && speeds[slowEnd + 1] <= speeds[apex] + 5) slowEnd += 1;
    const slowSeconds = seconds(slowEnd) - seconds(slowStart);
    // Minimum speed could rise until the corner reaches the target share of this lap's cornering grip.
    const cornerSpeed = (targetShare, evidenceStrength) => {
      const factor = Math.sqrt(Math.max(1, Math.min(targetShare * gripRef, 1.15 * coreLat) / coreLat));
      const next = nextBrakingStart(slowEnd);
      const straight = distance[next] - distance[slowEnd];
      const straightSpeed = (metres[slowEnd] + metres[next]) / 2;
      const carried = Math.min(0.15, 0.3 * straight * metres[apex] * (factor - 1) / (straightSpeed * straightSpeed));
      return {
        type: "cornerSpeed", start: slowStart, end: slowEnd, focus: apex,
        gain: slowSeconds * (1 - 1 / factor) + carried,
        strength: evidenceStrength,
        evidence: { entrySpeedKph: kph(range.start), apexSpeedKph: kph(apex), exitSpeedKph: kph(range.end), cornerGripUsePercent: Math.round(coreUse * 100), peakLateralG: rounded(peakLat), lapCornerGripG: rounded(gripRef), slowPhaseSeconds: rounded(slowSeconds, 2) },
      };
    };
    const measurable = slowSeconds >= 0.3 && coreLat > 0.2;
    corners.push({ range, apex, coreUse, fallback: measurable && coreUse < 0.9 ? cornerSpeed(0.9, "weak") : null });

    // The slowest part of the corner uses clearly less grip than other corners of this lap.
    if (coreUse < 0.72 && measurable) candidates.push(cornerSpeed(0.85, strength(coreUse, 0.55, 0.65)));

    // After the slowest point the car waits before accelerating although it is not at the grip limit.
    let throttle = apex;
    while (throttle < count - 1 && acceleration[throttle] < 0.5) throttle += 1;
    const waitSeconds = seconds(throttle) - seconds(apex);
    const waitUse = mean(lat.slice(apex, throttle + 1)) / gripRef;
    if (waitSeconds >= 0.45 && waitUse < 0.85) {
      let later = throttle;
      while (later < count - 1 && seconds(later) - seconds(throttle) < 1) later += 1;
      const exitAcceleration = Math.max(0.5, (metres[later] - metres[throttle]) / Math.max(0.2, seconds(later) - seconds(throttle)));
      const next = nextBrakingStart(throttle);
      const straightSpeed = (metres[throttle] + metres[next]) / 2;
      candidates.push({
        type: "lateThrottle", start: apex, end: throttle, focus: throttle,
        gain: Math.min(0.25, 0.7 * (distance[next] - distance[throttle]) * exitAcceleration * (waitSeconds - 0.25) / (straightSpeed * straightSpeed)),
        strength: strength(waitSeconds, 0.8, 0.6, false),
        evidence: { waitSeconds: rounded(waitSeconds, 2), apexSpeedKph: kph(apex), gripUsePercent: Math.round(waitUse * 100) },
      });
    }
  }

  const minGain = options.minGainSeconds ?? 0.02;
  const near = (a, b) => a.type === b.type && Math.abs(distance[a.focus] - distance[b.focus]) < totalDistance * 0.015;
  const selected = candidates
    .filter((candidate) => Number.isFinite(candidate.gain) && candidate.gain >= minGain)
    .sort((a, b) => b.gain - a.gain)
    .filter((candidate, index, list) => !list.slice(0, index).some((other) => near(other, candidate)))
    .slice(0, options.maxZones ?? 5);
  // A clean lap still gets something to work on: the corners that use the least grip, marked as weak evidence.
  const fallbacks = corners.filter((corner) => corner.fallback && corner.fallback.gain >= minGain / 2)
    .sort((a, b) => a.coreUse - b.coreUse).map((corner) => corner.fallback);
  for (const fallback of fallbacks) {
    if (selected.length >= 2) break;
    if (!selected.some((other) => near(other, fallback))) selected.push(fallback);
  }
  const zones = selected
    .sort((a, b) => a.focus - b.focus)
    .map((candidate, index) => ({
      id: `O${index + 1}`,
      type: candidate.type,
      startPercent: percent(candidate.start),
      endPercent: percent(candidate.end),
      distancePercent: percent(candidate.focus),
      estimatedGainSeconds: rounded(candidate.gain),
      evidenceStrength: candidate.strength,
      evidence: candidate.evidence,
    }));

  // What this lap already does well; used for the strengths part of the report.
  const highlights = [];
  if (brakingRanges.length) {
    const best = brakingRanges.reduce((result, range) => (peakDecel(range) > peakDecel(result) ? range : result));
    highlights.push({ type: "strongestBraking", startPercent: percent(best.start), endPercent: percent(best.end), distancePercent: percent(best.start), evidence: { peakDecelerationG: rounded(peakDecel(best) / G), entrySpeedKph: kph(best.start), exitSpeedKph: kph(best.end) } });
  }
  const bestCorner = corners.reduce((result, corner) => (!result || corner.coreUse > result.coreUse ? corner : result), null);
  if (bestCorner && bestCorner.coreUse >= 0.85) {
    highlights.push({ type: "bestCorner", startPercent: percent(bestCorner.range.start), endPercent: percent(bestCorner.range.end), distancePercent: percent(bestCorner.apex), evidence: { cornerGripUsePercent: Math.round(bestCorner.coreUse * 100), apexSpeedKph: kph(bestCorner.apex) } });
  }
  let top = 0;
  for (let index = 1; index < count; index += 1) if (speeds[index] > speeds[top]) top = index;
  highlights.push({ type: "topSpeed", startPercent: percent(top), endPercent: percent(top), distancePercent: percent(top), evidence: { speedKph: kph(top) } });

  return {
    references: { strongestBrakingG: rounded(brakeRef / G), cornerGripG: rounded(gripRef) },
    zones,
    highlights,
    corners: corners.map((corner) => ({ apexPercent: percent(corner.apex), startPercent: percent(corner.range.start), endPercent: percent(corner.range.end), apexSpeedKph: kph(corner.apex), gripUsePercent: Math.round(corner.coreUse * 100) })),
  };
}
