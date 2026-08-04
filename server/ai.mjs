import { createHash } from "node:crypto";
import { analyzeSession } from "../src/domain/analysis.js";
import { splitSessionIntoLaps } from "../src/domain/laps.js";
import { extractLapEvents } from "../src/domain/lap-events.js";
import { distanceMeters, identifyTrack } from "../src/domain/tracks.js";

export const AI_MODEL = process.env.OPENAI_MODEL || "gpt-5.6-sol";
export const getOpenAiApiKey = () => (process.env.LAPTRACE_OPENAI_KEY || process.env.OPENAI_API_KEY || "").trim();

export const AI_REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "strengths", "timeLosses", "consistency", "dataWarnings"],
  properties: {
    summary: { type: "string" },
    strengths: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "evidence"],
        properties: {
          title: { type: "string" },
          evidence: { type: "string" },
        },
      },
    },
    timeLosses: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["distancePercent", "deltaSeconds", "phaseType", "phaseId", "observation", "hypothesis", "recommendation", "confidence"],
        properties: {
          distancePercent: { type: "number", minimum: 0, maximum: 100 },
          deltaSeconds: { type: "number" },
          phaseType: { type: "string", enum: ["corner", "braking", "acceleration", "transition", "unknown"] },
          phaseId: { type: "string" },
          observation: { type: "string" },
          hypothesis: { type: "string" },
          recommendation: { type: "string" },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
        },
      },
    },
    consistency: {
      type: "object",
      additionalProperties: false,
      required: ["assessment", "lapTimeSpreadSeconds"],
      properties: {
        assessment: { type: "string" },
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

function nearestAtProgress(series, progress) {
  let low = 0; let high = series.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (series[middle].progress < progress) low = middle + 1;
    else high = middle;
  }
  return series[Math.max(0, low)];
}

function lapProfile(points, bins = 40) {
  const series = distanceSeries(points);
  if (series.length < 2) return [];
  const startedAt = series[0].point.timeMs;
  return Array.from({ length: bins + 1 }, (_, index) => {
    const progress = index / bins;
    const item = nearestAtProgress(series, progress);
    return {
      distancePercent: rounded(progress * 100, 1),
      elapsedSeconds: rounded((item.point.timeMs - startedAt) / 1000),
      speedKph: rounded(item.point.speed, 1),
      longitudinalG: rounded(item.point.gForceX),
      lateralG: rounded(item.point.gForceY),
    };
  });
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
  return {
    schema: "laptrace-telemetry-snapshot/v2",
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
        "You are a motorsport telemetry engineer.",
        "Use only facts present in the telemetry snapshot.",
        "Use detectedPhases to compare braking points, corner entry/apex/exit speeds, and acceleration zones by distance percentage.",
        "For every time loss, set phaseId to the closest evidence reference such as primary.C2 or comparison.B1; use an empty string only when no phase matches.",
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
