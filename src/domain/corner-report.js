// Corner-by-corner report (like the Track Report of MoTeC i2): the lap is split into track sections —
// corners found on a reference lap and the straights between them — and every lap gets the time, entry,
// minimum, maximum and exit speed of each section. Sections are fractions of lap distance, the same
// "progress" the charts use, so a section can be shown on the charts by zooming to [from, to].
// Every function returns new objects and never mutates its input.

import { lapSignals } from "./lap-events.js";
import { distanceMeters } from "./tracks.js";

const MIN_SECTION = 0.012;     // shorter gaps between corners are folded into the next corner
const PROMINENCE_KPH = 6;      // a speed dip smaller than this on either side is not a corner
const CORNER_SHARE = 0.75;     // a corner spans the part of the dip below 75% of the way back to the peak
const LENGTH_TOLERANCE = 0.08; // laps whose length differs more from the reference are not compared

// Corners of one lap found the way people mark them by eye: every clear dip in speed is a corner with its
// apex at the slowest point. Lateral G is not used: on twisty kart tracks the "straights" carry it too.
export function findCorners(points) {
  if (!Array.isArray(points) || points.length < 5) return [];
  const { speeds, distance, totalDistance } = lapSignals(points);
  const fraction = (index) => distance[index] / totalDistance;
  // Prominent minima: the climb back up on both sides (before the speed gets any lower) is big enough.
  const apexes = [];
  for (let index = 1; index < speeds.length - 1; index++) {
    if (!(speeds[index] < speeds[index - 1] && speeds[index] <= speeds[index + 1])) continue;
    let left = speeds[index]; let right = speeds[index];
    for (let cursor = index - 1; cursor >= 0 && speeds[cursor] >= speeds[index]; cursor--) left = Math.max(left, speeds[cursor]);
    for (let cursor = index + 1; cursor < speeds.length && speeds[cursor] >= speeds[index]; cursor++) right = Math.max(right, speeds[cursor]);
    if (Math.min(left, right) - speeds[index] >= PROMINENCE_KPH) apexes.push(index);
  }
  const peakBetween = (from, to) => {
    let peak = from;
    for (let cursor = from; cursor <= to; cursor++) if (speeds[cursor] > speeds[peak]) peak = cursor;
    return peak;
  };
  return apexes.map((apex, order) => {
    const leftPeak = peakBetween(order ? apexes[order - 1] : 0, apex);
    const rightPeak = peakBetween(apex, order < apexes.length - 1 ? apexes[order + 1] : speeds.length - 1);
    const leftLevel = speeds[apex] + CORNER_SHARE * (speeds[leftPeak] - speeds[apex]);
    const rightLevel = speeds[apex] + CORNER_SHARE * (speeds[rightPeak] - speeds[apex]);
    let from = apex; while (from > leftPeak && speeds[from - 1] <= leftLevel) from--;
    let to = apex; while (to < rightPeak && speeds[to + 1] <= rightLevel) to++;
    return { from: fraction(from), to: fraction(to), apex: fraction(apex) };
  });
}

// Contiguous sections from 0 to 1, so section times add up to the lap time.
export function trackSections(referencePoints) {
  const corners = findCorners(referencePoints);
  const sections = [];
  let edge = 0;
  corners.forEach((corner, index) => {
    if (corner.to - edge < MIN_SECTION) return;
    const from = corner.from - edge >= MIN_SECTION ? corner.from : edge;
    if (from > edge) sections.push({ kind: "straight", from: edge, to: from });
    sections.push({ kind: "corner", from, to: Math.min(1, corner.to), apex: corner.apex, number: index + 1 });
    edge = Math.min(1, corner.to);
  });
  if (1 - edge >= MIN_SECTION || !sections.length) sections.push({ kind: "straight", from: edge, to: 1 });
  else sections[sections.length - 1] = { ...sections.at(-1), to: 1 };

  // Corners are numbered in order of the track; straights are named after the corners around them.
  let corner = 0;
  const numbered = sections.map((section) => (section.kind === "corner" ? { ...section, number: ++corner } : section));
  return numbered.map((section, index) => {
    if (section.kind === "corner") return { ...section, id: `T${section.number}` };
    const before = numbered.slice(0, index).reverse().find((item) => item.kind === "corner");
    const after = numbered.slice(index + 1).find((item) => item.kind === "corner");
    return { ...section, id: `${before ? `T${before.number}` : "SF"}-${after ? `T${after.number}` : "SF"}`, before: before?.number ?? null, after: after?.number ?? null };
  });
}

// Distance fraction, time and speed of every point of one lap.
export function lapProfile(points) {
  const usable = (points ?? []).filter((point) => Number.isFinite(Number(point?.timeMs)));
  if (usable.length < 2) return null;
  const distance = [0];
  for (let index = 1; index < usable.length; index++) {
    const step = distanceMeters(usable[index - 1], usable[index]);
    distance.push(distance[index - 1] + (Number.isFinite(step) && step < 100 ? step : 0));
  }
  const length = distance.at(-1);
  if (!(length > 0)) return null;
  return {
    length,
    fractions: distance.map((value) => value / length),
    times: usable.map((point) => Number(point.timeMs)),
    speeds: usable.map((point) => Number(point.speed)),
  };
}

// Value of `values` at distance fraction `at`, interpolated between the two nearest points.
function valueAt(profile, values, at) {
  const { fractions } = profile;
  let low = 0; let high = fractions.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (fractions[middle] < at) low = middle + 1; else high = middle;
  }
  if (low === 0) return values[0];
  const span = fractions[low] - fractions[low - 1];
  const ratio = span > 0 ? (at - fractions[low - 1]) / span : 0;
  return values[low - 1] + (values[low] - values[low - 1]) * ratio;
}

export function sectionStats(profile, section) {
  if (!profile) return null;
  const inside = profile.speeds.filter((speed, index) => Number.isFinite(speed) && profile.fractions[index] > section.from && profile.fractions[index] < section.to);
  const entry = valueAt(profile, profile.speeds, section.from);
  const exit = valueAt(profile, profile.speeds, section.to);
  const speeds = [entry, ...inside, exit].filter(Number.isFinite);
  return {
    timeMs: valueAt(profile, profile.times, section.to) - valueAt(profile, profile.times, section.from),
    entry: Number.isFinite(entry) ? entry : null,
    exit: Number.isFinite(exit) ? exit : null,
    min: speeds.length ? Math.min(...speeds) : null,
    max: speeds.length ? Math.max(...speeds) : null,
  };
}

export const statsFor = (points, sections) => {
  const profile = lapProfile(points);
  return sections.map((section) => sectionStats(profile, section));
};

// laps: [{ number, points }]. Sections come from the reference lap (usually the fastest one); the best
// time of every section is taken only from laps of about the same length, so a partial lap never wins,
// and never from laps the pilot left out (`exclude`: lap numbers).
export function cornerReport(laps, referenceNumber, { exclude = [] } = {}) {
  const left = new Set(exclude);
  const reference = laps.find((lap) => lap.number === referenceNumber) ?? laps[0];
  const referenceProfile = lapProfile(reference?.points);
  if (!referenceProfile) return null;
  const sections = trackSections(reference.points);
  const rows = laps.map((lap) => {
    const profile = lapProfile(lap.points);
    const comparable = Boolean(profile) && !left.has(lap.number) && Math.abs(profile.length / referenceProfile.length - 1) <= LENGTH_TOLERANCE;
    return { number: lap.number, comparable, stats: sections.map((section) => sectionStats(profile, section)) };
  });
  const best = sections.map((_section, index) => rows
    .filter((row) => row.comparable && Number.isFinite(row.stats[index]?.timeMs))
    .reduce((result, row) => (!result || row.stats[index].timeMs < result.timeMs ? { lap: row.number, timeMs: row.stats[index].timeMs } : result), null));
  const idealMs = best.every(Boolean) ? best.reduce((sum, item) => sum + item.timeMs, 0) : null;
  return { referenceLap: reference.number, sections, laps: rows, best, idealMs };
}
