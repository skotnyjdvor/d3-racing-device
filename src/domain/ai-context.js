function rounded(value, digits = 3) {
  return Number(value.toFixed(digits));
}

export function buildAiContext(analysis, question = "") {
  return {
    schema: "d3-racing-ai-context/v1",
    userQuestion: question.trim() || "Дай инженерный разбор сессии и назови три приоритетных улучшения.",
    units: { speed: "km/h", duration: "s", distance: "m", acceleration: "g", rotation: "deg/s" },
    sensorConvention: {
      accelerometer: "X front/back, Y right/left, Z up/down",
      gyroscope: "X roll, Y pitch, Z yaw",
      warning: "Signs depend on device mounting; do not infer brake/turn direction before calibration.",
    },
    session: {
      startedAt: analysis.startedAt,
      duration: rounded(analysis.session.durationMs / 1000),
      sampleRate: rounded(analysis.sampleRateHz, 1),
      maxSpeed: rounded(analysis.session.maxSpeed, 2),
      peakLateralG: rounded(analysis.session.peakLateralG),
      strongestNegativeX: rounded(analysis.session.minLongitudinalG),
      laps: analysis.laps.length,
    },
    lapComparison: analysis.laps.map((lap) => ({
      lap: lap.number,
      time: rounded(lap.durationMs / 1000),
      deltaToBest: rounded(lap.deltaMs / 1000),
      averageSpeed: rounded(lap.averageSpeed, 2),
      maxSpeed: rounded(lap.maxSpeed, 2),
      distance: rounded(lap.distanceM, 1),
      strongestNegativeX: rounded(lap.minLongitudinalG),
      peakLateralG: rounded(lap.peakLateralG),
      peakYawRate: rounded(lap.peakYawRate, 1),
    })),
    dataQuality: analysis.quality,
    analysisRules: [
      "Separate observations from hypotheses.",
      "Do not claim racing causality from aggregate metrics alone.",
      "Point out when aligned distance traces or track sectors are required.",
      "Prioritize actionable, testable recommendations.",
    ],
  };
}

export function buildAiPrompt(analysis, question) {
  return [
    "Ты — инженер по гоночной телеметрии. Анализируй только факты из JSON.",
    "Отделяй наблюдения от гипотез и предлагай проверяемые действия на следующий заезд.",
    JSON.stringify(buildAiContext(analysis, question), null, 2),
  ].join("\n\n");
}
