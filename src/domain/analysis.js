const EARTH_RADIUS_M = 6_371_000;

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const QUALITY_RANK = { good: 0, unknown: 1, warning: 2, poor: 3 };
const worstQuality = (levels) => levels.reduce((worst, level) => QUALITY_RANK[level] > QUALITY_RANK[worst] ? level : worst, "good");
const finiteValues = (points, key) => points
  .map((point) => point[key])
  .filter((value) => value !== null && value !== "" && Number.isFinite(Number(value)))
  .map(Number);

export function assessTelemetryQuality(points, { sampleRateHz, quality }) {
  const issues = [];
  const gpsLevels = [];
  if (quality.invalidCoordinates > 0) { gpsLevels.push("poor"); issues.push("coordinates"); }

  const horizontalAccuracy = finiteValues(points, "horizontalAccuracy");
  const satellites = finiteValues(points, "satellites");
  const fixPoints = points.filter((point) => point.fixStatus !== null && point.fixStatus !== ""
    && Number.isFinite(Number(point.fixStatus)));
  if (!horizontalAccuracy.length && !satellites.length && !fixPoints.length) {
    gpsLevels.push("unknown"); issues.push("gpsUnavailable");
  }
  if (horizontalAccuracy.length) {
    const accuracy = median(horizontalAccuracy);
    if (accuracy > 5) { gpsLevels.push("poor"); issues.push("gpsWeak"); }
    else if (accuracy > 2) { gpsLevels.push("warning"); issues.push("gpsFair"); }
  }
  if (satellites.length) {
    const satelliteCount = median(satellites);
    if (satelliteCount < 7) { gpsLevels.push("poor"); issues.push("gpsWeak"); }
    else if (satelliteCount < 10) { gpsLevels.push("warning"); issues.push("gpsFair"); }
  }
  if (fixPoints.length) {
    const goodFixes = fixPoints.filter((point) => Number(point.fixStatus) >= 3 && (Number(point.fixStatusFlags) & 1) !== 0).length;
    const fixRatio = goodFixes / fixPoints.length;
    if (fixRatio < .9) { gpsLevels.push("poor"); issues.push("gpsFix"); }
    else if (fixRatio < .98) { gpsLevels.push("warning"); issues.push("gpsFix"); }
  }
  const gps = worstQuality(gpsLevels.length ? gpsLevels : ["good"]);

  const streamLevels = [];
  if (sampleRateHz < 10) { streamLevels.push("poor"); issues.push("sampleRate"); }
  else if (sampleRateHz < 20) { streamLevels.push("warning"); issues.push("sampleRate"); }
  if (quality.completeness < .98 || quality.maxGapMs > 500) { streamLevels.push("poor"); issues.push("gaps"); }
  else if (quality.completeness < .995 || quality.maxGapMs > 120) { streamLevels.push("warning"); issues.push("gaps"); }
  const stream = worstQuality(streamLevels.length ? streamLevels : ["good"]);

  const stationary = points.filter((point) => Number(point.speed) <= 5
    && [point.gForceX, point.gForceY, point.gForceZ].every((value) => Number.isFinite(Number(value))));
  let mounting = "unknown";
  if (stationary.length >= 20) {
    const mean = (key) => stationary.reduce((sum, point) => sum + Number(point[key]), 0) / stationary.length;
    const gravityX = mean("gForceX"); const gravityY = mean("gForceY"); const gravityZ = mean("gForceZ");
    const gravity = Math.hypot(gravityX, gravityY, gravityZ);
    const verticalShare = gravity > 0 ? Math.abs(gravityZ) / gravity : 0;
    if (gravity < .75 || gravity > 1.25 || verticalShare < .65) { mounting = "poor"; issues.push("mounting"); }
    else if (verticalShare < .85) { mounting = "warning"; issues.push("mounting"); }
    else mounting = "good";
  }

  const overallInputs = [stream, gps === "unknown" ? "warning" : gps];
  if (mounting !== "unknown") overallInputs.push(mounting);
  return {
    level: worstQuality(overallInputs),
    checks: { gps, stream, mounting },
    issues: [...new Set(issues)],
  };
}

function haversine(a, b) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const dLat = lat2 - lat1;
  const dLon = radians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function summarizePoints(points, samplePeriodMs) {
  let distanceM = 0;
  for (let index = 1; index < points.length; index += 1) distanceM += haversine(points[index - 1], points[index]);
  const values = (key) => points.map((point) => point[key]);
  return {
    samples: points.length,
    durationMs: points.length ? points.at(-1).timeMs - points[0].timeMs + samplePeriodMs : 0,
    distanceM,
    averageSpeed: points.length ? values("speed").reduce((sum, value) => sum + value, 0) / points.length : 0,
    maxSpeed: Math.max(0, ...values("speed")),
    minLongitudinalG: Math.min(0, ...values("gForceX")),
    maxLongitudinalG: Math.max(0, ...values("gForceX")),
    peakLateralG: Math.max(0, ...values("gForceY").map(Math.abs)),
    peakYawRate: Math.max(0, ...values("gyroZ").map(Math.abs)),
  };
}

export function analyzeSession(points) {
  if (!points.length) throw new Error("Нет точек телеметрии");
  const intervals = points.slice(1).map((point, index) => point.timeMs - points[index].timeMs).filter((value) => value > 0);
  const samplePeriodMs = median(intervals) || 40;
  const session = summarizePoints(points, samplePeriodMs);
  const lapNumbers = [...new Set(points.map((point) => point.lap).filter((lap) => lap > 0))].sort((a, b) => a - b);
  const laps = lapNumbers.map((number) => {
    const lapPoints = points.filter((point) => point.lap === number);
    const summary = summarizePoints(lapPoints, samplePeriodMs);
    const interpolatedStart = Number(lapPoints[0]?.lapStartTimeMs);
    const interpolatedEnd = Number(lapPoints[0]?.lapEndTimeMs);
    if (Number.isFinite(interpolatedStart) && Number.isFinite(interpolatedEnd)) {
      summary.durationMs = interpolatedEnd - interpolatedStart;
    }
    return { number, ...summary };
  });
  const fastestLap = laps.reduce((best, lap) => !best || lap.durationMs < best.durationMs ? lap : best, null);
  laps.forEach((lap) => { lap.deltaMs = fastestLap ? lap.durationMs - fastestLap.durationMs : 0; });

  const gapThreshold = samplePeriodMs * 1.5;
  const gaps = intervals.filter((interval) => interval > gapThreshold);
  const invalidCoordinates = points.filter((point) => Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180).length;
  const quality = {
    gapCount: gaps.length,
    maxGapMs: gaps.length ? Math.max(...gaps) : samplePeriodMs,
    invalidCoordinates,
    completeness: points.length > 1 ? 1 - gaps.length / intervals.length : 1,
  };
  quality.assessment = assessTelemetryQuality(points, { sampleRateHz: 1000 / samplePeriodMs, quality });
  return {
    startedAt: points[0].time,
    endedAt: points.at(-1).time,
    sampleRateHz: 1000 / samplePeriodMs,
    samplePeriodMs,
    session,
    laps,
    fastestLap,
    quality,
  };
}

export function generateLocalInsights(analysis, translate = null) {
  const insights = [];
  if (analysis.fastestLap) {
    const slowest = analysis.laps.reduce((result, lap) => lap.durationMs > result.durationMs ? lap : result, analysis.laps[0]);
    insights.push(translate ? translate("insight.fastest", { lap: analysis.fastestLap.number, delta: (slowest.deltaMs / 1000).toFixed(2) }) : `Лучший круг — №${analysis.fastestLap.number}; разброс до самого медленного круга составляет ${(slowest.deltaMs / 1000).toFixed(2)} с.`);
  }
  const brakingLap = analysis.laps.reduce((result, lap) => !result || lap.minLongitudinalG < result.minLongitudinalG ? lap : result, null);
  if (brakingLap) insights.push(translate ? translate("insight.braking", { lap: brakingLap.number, value: brakingLap.minLongitudinalG.toFixed(2) }) : `Самое сильное продольное замедление зафиксировано на круге №${brakingLap.number}: ${brakingLap.minLongitudinalG.toFixed(2)} g. Знак зависит от ориентации устройства.`);
  const lateralLap = analysis.laps.reduce((result, lap) => !result || lap.peakLateralG > result.peakLateralG ? lap : result, null);
  if (lateralLap) insights.push(translate ? translate("insight.lateral", { lap: lateralLap.number, value: lateralLap.peakLateralG.toFixed(2) }) : `Пиковая боковая нагрузка — ${lateralLap.peakLateralG.toFixed(2)} g на круге №${lateralLap.number}; это кандидат для проверки траектории и стабильности руля.`);
  if (analysis.quality.gapCount === 0) insights.push(translate ? translate("insight.qualityGood", { hz: analysis.sampleRateHz.toFixed(0), gap: (analysis.samplePeriodMs * 1.5).toFixed(0) }) : `Поток ровный: ${analysis.sampleRateHz.toFixed(0)} Гц, разрывов длиннее ${(analysis.samplePeriodMs * 1.5).toFixed(0)} мс не обнаружено.`);
  else insights.push(translate ? translate("insight.qualityBad", { count: analysis.quality.gapCount }) : `Обнаружено ${analysis.quality.gapCount} разрывов потока; перед сравнением точек торможения стоит проверить качество записи.`);
  return insights.slice(0, 4);
}
