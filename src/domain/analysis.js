const EARTH_RADIUS_M = 6_371_000;

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
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
    return { number, ...summarizePoints(lapPoints, samplePeriodMs) };
  });
  const fastestLap = laps.reduce((best, lap) => !best || lap.durationMs < best.durationMs ? lap : best, null);
  laps.forEach((lap) => { lap.deltaMs = fastestLap ? lap.durationMs - fastestLap.durationMs : 0; });

  const gapThreshold = samplePeriodMs * 1.5;
  const gaps = intervals.filter((interval) => interval > gapThreshold);
  const invalidCoordinates = points.filter((point) => Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180).length;
  return {
    startedAt: points[0].time,
    endedAt: points.at(-1).time,
    sampleRateHz: 1000 / samplePeriodMs,
    samplePeriodMs,
    session,
    laps,
    fastestLap,
    quality: {
      gapCount: gaps.length,
      maxGapMs: gaps.length ? Math.max(...gaps) : samplePeriodMs,
      invalidCoordinates,
      completeness: points.length > 1 ? 1 - gaps.length / intervals.length : 1,
    },
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
