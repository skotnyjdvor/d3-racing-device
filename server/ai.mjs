import { createHash } from "node:crypto";
import { analyzeSession } from "../src/domain/analysis.js";
import { splitSessionIntoLaps } from "../src/domain/laps.js";
import { extractLapEvents } from "../src/domain/lap-events.js";
import { detectDeltaLossZones } from "../src/domain/delta-losses.js";
import { distanceMeters, identifyTrack } from "../src/domain/tracks.js";

export const AI_MODEL = process.env.OPENAI_MODEL || "gpt-5.6-sol";
export const getOpenAiApiKey = () => (process.env.LAPTRACE_OPENAI_KEY || process.env.OPENAI_API_KEY || "").trim();

export const AI_PILOT_LANGUAGE_RULES = [
  "Write for the racing driver, not for a telemetry engineer.",
  "Use short sentences and familiar driving terms: braking point, corner entry, middle of the corner, corner exit, acceleration, speed, and time gained or lost.",
  "Do not use unexplained jargon, raw phase IDs, sensor-axis names, mathematical terms, or words such as apex, derivative, polarity, and cumulative delta in the prose.",
  "If a technical term is unavoidable, explain it immediately in plain language.",
  "For every time-loss zone, say what happened, what may have caused it, and what the driver should try on the next lap.",
].join(" ");

export const AI_STANDARD_REPORT_RULES = [
  "Use exact telemetry, including speed, time delta, distance, and G-forces, only as hidden evidence for reasoning.",
  "Do not include digits, exact measurements, units, percentages, G-force values, or sensor readings in any user-visible report field.",
  "Do not mention G-forces or accelerometer signals in the report. Translate them into a plain conclusion about braking, turning, or acceleration only when supported by the other signals.",
  "Use qualitative comparisons such as earlier or later, faster or slower, stronger or smoother.",
  "Describe every loss location only with its supplied driverLocation: before the corner, in the corner, or after the corner. Never expose distancePercent, startPercent, or endPercent.",
].join(" ");

export const AI_REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "strengths", "timeLosses", "consistency", "dataWarnings"],
  properties: {
    summary: { type: "string", description: "Two or three plain-language sentences with the main takeaway for the driver, without exact measurements or digits." },
    strengths: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "evidence"],
        properties: {
          title: { type: "string", description: "A short driver-friendly title without telemetry jargon." },
          evidence: { type: "string", description: "A qualitative comparison derived from measurements, followed by what it means on track; do not quote numbers or units." },
        },
      },
    },
    timeLosses: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["zoneId", "observation", "hypothesis", "recommendation", "confidence"],
        properties: {
          zoneId: { type: "string" },
          observation: { type: "string", description: "What happened before, in, or after the corner, in words a driver can understand and without exact figures." },
          hypothesis: { type: "string", description: "A possible cause stated as a possibility, not as a measured fact." },
          recommendation: { type: "string", description: "One specific action the driver can safely test on the next lap." },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
        },
      },
    },
    consistency: {
      type: "object",
      additionalProperties: false,
      required: ["assessment", "lapTimeSpreadSeconds"],
      properties: {
        assessment: { type: "string", description: "A qualitative plain-language assessment of lap repeatability without exact figures." },
        lapTimeSpreadSeconds: { type: "number", minimum: 0 },
      },
    },
    dataWarnings: {
      type: "array",
      maxItems: 5,
      items: { type: "string" },
    },
  },
};

export const AI_FOLLOWUP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "evidence", "dataWarnings"],
  properties: {
    answer: { type: "string" },
    evidence: {
      type: "array",
      maxItems: 6,
      items: { type: "string" },
    },
    dataWarnings: {
      type: "array",
      maxItems: 4,
      items: { type: "string" },
    },
  },
};

const rounded = (value, digits = 3) => Number(Number(value || 0).toFixed(digits));

function distanceSeries(points) {
  let distance = 0;
  const series = points.map((point, index) => {
    if (index) distance += distanceMeters(points[index - 1], point);
    return { distance, point };
  });
  const total = Math.max(distance, 1);
  return series.map((item) => ({ ...item, progress: item.distance / total }));
}

function interpolatedAtProgress(series, progress) {
  if (!series.length) return null;
  let low = 0; let high = series.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (series[middle].progress < progress) low = middle + 1;
    else high = middle;
  }
  const after = series[low];
  const before = series[Math.max(0, low - 1)];
  const span = after.progress - before.progress;
  const ratio = span > 0 ? (progress - before.progress) / span : 0;
  const interpolate = (key) => Number(before.point[key]) + (Number(after.point[key]) - Number(before.point[key])) * ratio;
  return {
    timeMs: interpolate("timeMs"),
    speed: interpolate("speed"),
    gForceX: interpolate("gForceX"),
    gForceY: interpolate("gForceY"),
  };
}

function lapProfile(points, bins = 40) {
  const series = distanceSeries(points);
  if (series.length < 2) return [];
  const startedAt = series[0].point.timeMs;
  return Array.from({ length: bins + 1 }, (_, index) => {
    const progress = index / bins;
    const point = interpolatedAtProgress(series, progress);
    return {
      distancePercent: rounded(progress * 100, 1),
      elapsedSeconds: rounded((point.timeMs - startedAt) / 1000),
      speedKph: rounded(point.speed, 1),
      longitudinalG: rounded(point.gForceX),
      lateralG: rounded(point.gForceY),
    };
  });
}

function signedPeak(values) {
  return values.reduce((peak, value) => Math.abs(value) > Math.abs(peak) ? value : peak, 0);
}

function summarizeGForZone(profile, zone) {
  const startIndex = Math.max(0, Math.floor(zone.startPercent / 100 * (profile.length - 1)));
  const endIndex = Math.min(profile.length - 1, Math.ceil(zone.endPercent / 100 * (profile.length - 1)));
  const focusIndex = Math.max(0, Math.min(profile.length - 1, Math.round(zone.distancePercent / 100 * (profile.length - 1))));
  const samples = profile.slice(startIndex, endIndex + 1);
  const longitudinal = samples.map((point) => point.longitudinalG);
  const lateral = samples.map((point) => point.lateralG);
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  const meanAbs = (values) => mean(values.map(Math.abs));
  return {
    atLossPoint: {
      longitudinalG: rounded(profile[focusIndex].longitudinalG),
      lateralG: rounded(profile[focusIndex].lateralG),
    },
    zone: {
      meanLongitudinalG: rounded(mean(longitudinal)),
      peakLongitudinalG: rounded(signedPeak(longitudinal)),
      meanLateralG: rounded(mean(lateral)),
      meanAbsoluteLateralG: rounded(meanAbs(lateral)),
      peakLateralG: rounded(signedPeak(lateral)),
    },
  };
}

function closestPhase(events, distancePercent, lapRole = "primary") {
  const phases = [
    ...(events.corners || []).map((event) => ({ type: "corner", ...event })),
    ...(events.brakingZones || []).map((event) => ({ type: "braking", ...event })),
    ...(events.accelerationZones || []).map((event) => ({ type: "acceleration", ...event })),
  ];
  const ranked = phases.map((phase) => ({
    phase,
    distance: distancePercent < phase.startPercent ? phase.startPercent - distancePercent
      : distancePercent > phase.endPercent ? distancePercent - phase.endPercent : 0,
  })).sort((a, b) => a.distance - b.distance);
  return ranked[0] && ranked[0].distance <= 4 ? { phaseType: ranked[0].phase.type, phaseId: `${lapRole}.${ranked[0].phase.id}` }
    : { phaseType: "transition", phaseId: "" };
}

function locationAroundCorner(corners, distancePercent) {
  if (!corners?.length) return { driverLocation: "betweenCorners", cornerId: "" };
  const ranked = corners.map((corner) => {
    if (distancePercent < corner.startPercent) {
      return { corner, driverLocation: "beforeCorner", distance: corner.startPercent - distancePercent };
    }
    if (distancePercent > corner.endPercent) {
      return { corner, driverLocation: "afterCorner", distance: distancePercent - corner.endPercent };
    }
    return { corner, driverLocation: "inCorner", distance: 0 };
  }).sort((a, b) => a.distance - b.distance);
  return { driverLocation: ranked[0].driverLocation, cornerId: ranked[0].corner.id };
}

export function buildTelemetrySnapshot(points, options = {}) {
  const track = identifyTrack(points);
  const prepared = splitSessionIntoLaps(points, track);
  const analysis = analyzeSession(prepared);
  const available = analysis.laps.map((lap) => lap.number);
  const primaryLap = available.includes(Number(options.primaryLap)) ? Number(options.primaryLap) : analysis.fastestLap?.number;
  const comparisonLap = available.includes(Number(options.comparisonLap)) && Number(options.comparisonLap) !== primaryLap
    ? Number(options.comparisonLap)
    : analysis.laps.find((lap) => lap.number !== primaryLap)?.number ?? null;
  const primaryPoints = prepared.filter((point) => point.lap === primaryLap);
  const comparisonPoints = comparisonLap ? prepared.filter((point) => point.lap === comparisonLap) : [];
  const primaryProfile = lapProfile(primaryPoints);
  const comparisonProfile = lapProfile(comparisonPoints);
  const primaryEvents = extractLapEvents(primaryPoints);
  const comparisonEvents = extractLapEvents(comparisonPoints);
  const trace = primaryProfile.map((primary, index) => {
    const comparison = comparisonProfile[index];
    return {
      ...primary,
      comparisonElapsedSeconds: comparison?.elapsedSeconds ?? null,
      comparisonSpeedKph: comparison?.speedKph ?? null,
      deltaSeconds: comparison ? rounded(primary.elapsedSeconds - comparison.elapsedSeconds) : null,
    };
  });
  const lapTimes = analysis.laps.map((lap) => lap.durationMs / 1000);
  const detailedPrimary = lapProfile(primaryPoints, 400);
  const detailedComparison = lapProfile(comparisonPoints, 400);
  const deltaLossZones = comparisonLap ? detectDeltaLossZones(detailedPrimary.map((primary, index) => ({
    progress: index / 400,
    value: primary.elapsedSeconds - detailedComparison[index].elapsedSeconds,
  }))).map((zone) => {
    const index = Math.max(0, Math.min(400, Math.round(zone.distancePercent * 4)));
    return {
      ...zone,
      ...closestPhase(comparisonEvents, zone.distancePercent, "comparison"),
      ...locationAroundCorner(comparisonEvents.corners, zone.distancePercent),
      primarySpeedKph: detailedPrimary[index].speedKph,
      comparisonSpeedKph: detailedComparison[index].speedKph,
      gForces: {
        primary: summarizeGForZone(detailedPrimary, zone),
        comparison: summarizeGForZone(detailedComparison, zone),
      },
    };
  }) : [];
  return {
    schema: "laptrace-telemetry-snapshot/v8",
    analysisMode: "standard-report/v3-qualitative-driver-language",
    language: ["ru", "en", "pl"].includes(options.language) ? options.language : "ru",
    question: String(options.question || "").trim().slice(0, 500),
    track: track ? { id: track.id, name: track.name } : null,
    session: {
      startedAt: analysis.startedAt,
      sampleRateHz: rounded(analysis.sampleRateHz, 1),
      completedLaps: analysis.laps.length,
      lapTimeSpreadSeconds: rounded(Math.max(...lapTimes) - Math.min(...lapTimes)),
      dataQuality: analysis.quality,
    },
    laps: analysis.laps.map((lap) => ({
      number: lap.number,
      timeSeconds: rounded(lap.durationMs / 1000),
      deltaToBestSeconds: rounded(lap.deltaMs / 1000),
      averageSpeedKph: rounded(lap.averageSpeed, 1),
      maxSpeedKph: rounded(lap.maxSpeed, 1),
      peakLateralG: rounded(lap.peakLateralG),
      strongestNegativeLongitudinalG: rounded(lap.minLongitudinalG),
    })),
    comparison: {
      primaryLap,
      comparisonLap,
      trace,
      deltaLossZones: {
        methodology: "Authoritative zones computed where the smoothed primary-minus-comparison cumulative delta decreases. Positive deltaSeconds means the comparison lap lost this amount of time to the primary lap in the interval. G-force samples are synchronized by normalized lap distance; signed peaks preserve the device-axis polarity.",
        zones: deltaLossZones,
      },
      detectedPhases: {
        methodology: "Braking and acceleration use smoothed GPS speed derivative; corners use smoothed absolute lateral acceleration; apex is the minimum-speed sample inside a corner.",
        primary: primaryEvents,
        comparison: comparisonEvents,
      },
    },
    sensorWarning: "Accelerometer signs depend on mounting. Treat causal claims as hypotheses unless supported by multiple signals.",
  };
}

export function snapshotCacheKey(logId, snapshot, model = AI_MODEL) {
  return createHash("sha256").update(JSON.stringify({ logId, model, snapshot })).digest("hex");
}

export function groundAiReport(report, snapshot) {
  const zones = snapshot.comparison?.deltaLossZones?.zones || [];
  const generatedByZone = new Map((report.timeLosses || []).map((item) => [item.zoneId, item]));
  const fallback = snapshot.language === "ru" ? {
    observation: () => "На этом участке сравниваемый круг теряет время относительно основного.",
    hypothesis: "По доступным данным нельзя уверенно назвать причину.", recommendation: "На следующем круге сравнить момент торможения, скорость в повороте и начало разгона.",
  } : snapshot.language === "pl" ? {
    observation: () => "Na tym odcinku okrążenie porównawcze traci czas do głównego.",
    hypothesis: "Dostępne dane nie pozwalają pewnie określić przyczyny.", recommendation: "Na kolejnym okrążeniu porównaj moment hamowania, prędkość w zakręcie i początek przyspieszania.",
  } : {
    observation: () => "The comparison lap loses time to the primary lap in this section.",
    hypothesis: "The available data does not establish the cause with confidence.", recommendation: "On the next lap, compare the braking point, corner speed, and the start of acceleration.",
  };
  return {
    ...report,
    timeLosses: zones.map((zone) => {
      const generated = generatedByZone.get(zone.id) || {};
      return {
        zoneId: zone.id,
        observation: generated.observation || fallback.observation(zone),
        hypothesis: generated.hypothesis || fallback.hypothesis,
        recommendation: generated.recommendation || fallback.recommendation,
        confidence: generated.confidence || "low",
        distancePercent: zone.distancePercent,
        deltaSeconds: zone.deltaSeconds,
        deltaStartSeconds: zone.deltaStartSeconds,
        deltaEndSeconds: zone.deltaEndSeconds,
        startPercent: zone.startPercent,
        endPercent: zone.endPercent,
        phaseType: zone.phaseType,
        phaseId: zone.phaseId,
        driverLocation: zone.driverLocation,
        cornerId: zone.cornerId,
        primarySpeedKph: zone.primarySpeedKph,
        comparisonSpeedKph: zone.comparisonSpeedKph,
        gForces: zone.gForces,
      };
    }),
  };
}

function outputText(response) {
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  return "";
}

export async function generateAiReport(snapshot, { apiKey = getOpenAiApiKey(), model = AI_MODEL } = {}) {
  if (!apiKey) {
    const error = new Error("AI analysis is not configured");
    error.status = 503;
    throw error;
  }
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: "medium" },
      instructions: [
        "You are a racing coach who explains measured telemetry in language every track driver can understand.",
        AI_PILOT_LANGUAGE_RULES,
        AI_STANDARD_REPORT_RULES,
        "Use only facts present in the telemetry snapshot.",
        "When the snapshot question is empty, produce the standard engineering report: summary, strongest measured advantages, every authoritative loss zone, consistency, and data limitations.",
        "Use detectedPhases to compare braking points, corner entry, middle, exit speeds, and acceleration zones, but describe the result only through driverLocation.",
        "deltaLossZones is authoritative and describes where the comparison lap loses time to the primary lap: return exactly one timeLosses item for each supplied zone and reference it only by zoneId.",
        "For every time-loss zone, compare gForces.primary with gForces.comparison. atLossPoint contains exact longitudinal and lateral G at the strongest delta change; zone contains measured means and signed peaks across the interval.",
        "Use longitudinal G to support braking or acceleration hypotheses and lateral G to support cornering-load hypotheses, but account for the mounting-dependent sign and do not treat G-force alone as driver input.",
        "Never invent or alter a loss position, delta value, phase ID, or zone ID. Explain possible causes only from the supplied signals.",
        "Treat corner direction labels as sensor polarity, not guaranteed left/right direction.",
        "Separate observations from hypotheses. Never invent track geometry, driver inputs, or vehicle setup.",
        "Use the requested language. Keep recommendations specific and testable.",
        "When data quality is insufficient, add a warning and lower confidence.",
      ].join(" "),
      input: JSON.stringify(snapshot),
      text: {
        verbosity: "low",
        format: { type: "json_schema", name: "laptrace_ai_report", strict: true, schema: AI_REPORT_SCHEMA },
      },
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error?.message || `OpenAI API error ${response.status}`);
    error.status = response.status === 429 ? 429 : 502;
    throw error;
  }
  const text = outputText(body);
  if (!text) throw Object.assign(new Error("AI returned no report"), { status: 502 });
  return { report: JSON.parse(text), responseId: body.id, usage: body.usage ?? null, model: body.model ?? model };
}

export async function generateAiFollowUp(snapshot, report, question, { apiKey = getOpenAiApiKey(), model = AI_MODEL } = {}) {
  if (!apiKey) {
    const error = new Error("AI analysis is not configured");
    error.status = 503;
    throw error;
  }
  const normalizedQuestion = String(question || "").trim().slice(0, 500);
  if (normalizedQuestion.length < 3) {
    const error = new Error("Question is too short");
    error.status = 422;
    throw error;
  }
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: "medium" },
      instructions: [
        "You are answering a follow-up question about an existing motorsport telemetry report.",
        AI_PILOT_LANGUAGE_RULES,
        "Use only the supplied telemetry snapshot and grounded report. Do not move, add, or reinterpret authoritative delta-loss zones.",
        "Support the answer with measured lap time, speed, longitudinal G, lateral G, delta, phase, or data-quality evidence from the input.",
        "Clearly distinguish measured observations from hypotheses. Accelerometer signs depend on device mounting.",
        "If the question cannot be answered from the supplied data, say so directly and add a data warning.",
        "Answer in the snapshot language and keep the response concise and actionable.",
      ].join(" "),
      input: JSON.stringify({ question: normalizedQuestion, telemetrySnapshot: snapshot, groundedReport: report }),
      text: {
        verbosity: "low",
        format: { type: "json_schema", name: "laptrace_ai_follow_up", strict: true, schema: AI_FOLLOWUP_SCHEMA },
      },
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error?.message || `OpenAI API error ${response.status}`);
    error.status = response.status === 429 ? 429 : 502;
    throw error;
  }
  const text = outputText(body);
  if (!text) throw Object.assign(new Error("AI returned no answer"), { status: 502 });
  return { followUp: JSON.parse(text), responseId: body.id, usage: body.usage ?? null, model: body.model ?? model };
}
