import { RaceBoxBleClient } from "./ble/racebox.js";
import { analyzeSession, generateLocalInsights } from "./domain/analysis.js";
import { buildAiPrompt } from "./domain/ai-context.js";
import { parseRaceBoxCsv } from "./domain/csv.js";
import { distanceMeters, identifyTrack } from "./domain/tracks.js";
import { splitSessionIntoLaps } from "./domain/laps.js";
import { applyTranslations, getLanguage, onLanguageChange, setLanguage, t } from "./i18n.js";
import { cloudConfigured, currentUser, deleteLog, loadLog, loadLogs, renameLog, saveLog, signIn, signOut, signUp } from "./cloud/api.js";
import "./demo.js";

const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));
const state = { client: null, connected: false, deviceName: "", deviceModel: "", latestTelemetry: null, storage: null, sessions: [], selectedSession: null, analysis: null, selectedLapNumber: null, comparisonLapNumber: null, cursorProgress: null, chartView: { start: 0, end: 1 }, trackView: { scale: 1, offsetX: 0, offsetY: 0 }, telemetryMetric: "speed", track: null, user: null, cloudLogs: [], pollTimer: null, memoryBusy: false };
const testMode = new URLSearchParams(location.search).has("mock");
let accountMode = "signin";

const formatDuration = (milliseconds) => {
  if (!Number.isFinite(milliseconds)) return "—";
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.round((milliseconds % 60_000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

const formatLapTime = (milliseconds) => {
  if (!Number.isFinite(milliseconds)) return "—";
  const rounded = Math.round(milliseconds);
  const minutes = Math.floor(rounded / 60_000);
  const seconds = Math.floor((rounded % 60_000) / 1000);
  const millis = rounded % 1000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
};

const formatDate = (iso) => new Intl.DateTimeFormat(getLanguage(), {
  day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
}).format(new Date(iso));

function setStatus(text, active = false) {
  elements.deviceStatus.textContent = text;
  elements.statusDot.classList.toggle("live", active);
}

function setHint(text, isError = false) {
  elements.actionHint.textContent = text;
  elements.actionHint.classList.toggle("error", isError);
}

function showView(view, updateHash = true) {
  const logs = view === "logs";
  document.body.classList.toggle("view-logs", logs);
  elements.analysisNavButton.classList.toggle("active", !logs);
  elements.logsNavButton.classList.toggle("active", logs);
  if (updateHash) history.pushState(null, "", logs ? "#logs" : "#analysis");
  if (!logs) requestAnimationFrame(() => { drawTrack(); drawCharts(); });
}

function connectionErrorMessage(error) {
  if (error?.name === "NotFoundError" || /cancelled.*chooser/i.test(error?.message || "")) return t("error.notSelected");
  if (error?.name === "NetworkError") return t("error.network");
  if (error?.name === "SecurityError") return t("error.security");
  return error?.message || "Неизвестная ошибка Bluetooth";
}

function canvasContext(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { context, width: rect.width, height: rect.height };
}

function downsample(points, max = 1800) {
  if (points.length <= max) return points;
  const step = points.length / max;
  return Array.from({ length: max }, (_, index) => points[Math.floor(index * step)]);
}

function lapPoints(number) {
  if (!state.selectedSession) return [];
  return number ? state.selectedSession.points.filter((point) => point.lap === number) : state.selectedSession.points;
}

function distancePoints(points, max = 2400) {
  const sampled = downsample(points, max);
  if (sampled.length < 2) return [];
  let distance = 0;
  const series = sampled.map((point, index) => {
    if (index) distance += distanceMeters(sampled[index - 1], point);
    return { distance, point };
  });
  const total = Math.max(distance, 1);
  return series.map((item) => ({ progress: item.distance / total, point: item.point }));
}

function pointAtProgress(series, progress) {
  if (!series.length || progress === null) return null;
  let low = 0; let high = series.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (series[middle].progress < progress) low = middle + 1;
    else high = middle;
  }
  if (low > 0 && Math.abs(series[low - 1].progress - progress) < Math.abs(series[low].progress - progress)) return series[low - 1];
  return series[low];
}

function interpolatedTimeAtProgress(series, progress) {
  if (!series.length) return null;
  if (progress <= series[0].progress) return series[0].point.timeMs;
  if (progress >= series.at(-1).progress) return series.at(-1).point.timeMs;
  let low = 0; let high = series.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (series[middle].progress <= progress) low = middle;
    else high = middle;
  }
  const before = series[low]; const after = series[high];
  const span = Math.max(after.progress - before.progress, 1e-9);
  const ratio = Math.max(0, Math.min(1, (progress - before.progress) / span));
  return before.point.timeMs + (after.point.timeMs - before.point.timeMs) * ratio;
}

function chartX(progress, padding, plotWidth) {
  const span = Math.max(state.chartView.end - state.chartView.start, 1e-6);
  return padding.left + (progress - state.chartView.start) / span * plotWidth;
}

function chartProgress(clientX, canvas, paddingLeft = 48, paddingRight = 18) {
  const rect = canvas.getBoundingClientRect();
  const ratio = (clientX - rect.left - paddingLeft) / Math.max(rect.width - paddingLeft - paddingRight, 1);
  return state.chartView.start + Math.max(0, Math.min(1, ratio)) * (state.chartView.end - state.chartView.start);
}

function setChartZoom(center, nextSpan) {
  const span = Math.max(0.05, Math.min(1, nextSpan));
  const centerRatio = (center - state.chartView.start) / Math.max(state.chartView.end - state.chartView.start, 1e-6);
  let start = center - centerRatio * span;
  start = Math.max(0, Math.min(1 - span, start));
  state.chartView = { start, end: start + span };
  elements.chartZoomReset.textContent = `${Math.round(100 / span)}%`;
  drawCharts();
}

function resetChartZoom() {
  state.chartView = { start: 0, end: 1 };
  elements.chartZoomReset.textContent = "100%";
  drawCharts();
}

function updateTrackZoom(nextScale, anchorX, anchorY) {
  const previous = state.trackView;
  const scale = Math.max(1, Math.min(12, nextScale));
  const factor = scale / previous.scale;
  state.trackView = {
    scale,
    offsetX: anchorX - (anchorX - previous.offsetX) * factor,
    offsetY: anchorY - (anchorY - previous.offsetY) * factor,
  };
  elements.trackZoomReset.textContent = `${Math.round(scale * 100)}%`;
  drawTrack();
}

function resetTrackZoom() {
  state.trackView = { scale: 1, offsetX: 0, offsetY: 0 };
  elements.trackZoomReset.textContent = "100%";
  drawTrack();
}

function drawTrack() {
  const { context, width, height } = canvasContext(elements.trackCanvas);
  context.fillStyle = "#0c1117";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "rgba(151,166,181,.09)"; context.lineWidth = 1;
  const gridSize = width < 560 ? 38 : 52;
  for (let x = gridSize; x < width; x += gridSize) {
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke();
  }
  for (let y = gridSize; y < height; y += gridSize) {
    context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
  }
  const primarySeries = distancePoints(lapPoints(state.selectedLapNumber), 1800);
  const comparisonSeries = state.comparisonLapNumber ? distancePoints(lapPoints(state.comparisonLapNumber), 1800) : [];
  const primaryPoints = primarySeries.map((item) => item.point);
  const comparisonPoints = comparisonSeries.map((item) => item.point);
  const boundsPoints = [...primaryPoints, ...comparisonPoints];
  if (primaryPoints.length < 2) {
    context.fillStyle = "#657180";
    context.font = "13px system-ui";
    context.fillText(t("track.canvasEmpty"), 24, 38);
    return;
  }
  const lats = boundsPoints.map((point) => point.latitude);
  const lons = boundsPoints.map((point) => point.longitude);
  const minLat = Math.min(...lats); const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons); const maxLon = Math.max(...lons);
  const padding = 38;
  const scale = Math.min(
    (width - padding * 2) / Math.max(maxLon - minLon, 1e-9),
    (height - padding * 2) / Math.max(maxLat - minLat, 1e-9),
  );
  const offsetX = (width - (maxLon - minLon) * scale) / 2;
  const offsetY = (height - (maxLat - minLat) * scale) / 2;
  const project = (point) => {
    const baseX = offsetX + (point.longitude - minLon) * scale;
    const baseY = offsetY + (maxLat - point.latitude) * scale;
    return [
      width / 2 + (baseX - width / 2) * state.trackView.scale + state.trackView.offsetX,
      height / 2 + (baseY - height / 2) * state.trackView.scale + state.trackView.offsetY,
    ];
  };
  context.lineCap = "round"; context.lineJoin = "round";
  const drawTrajectory = (points, color, lineWidth) => {
    if (points.length < 2) return;
    context.strokeStyle = "rgba(255,255,255,.08)"; context.lineWidth = lineWidth + 6; context.beginPath();
    points.forEach((point, index) => { const [x, y] = project(point); index ? context.lineTo(x, y) : context.moveTo(x, y); });
    context.stroke();
    context.strokeStyle = color; context.lineWidth = lineWidth; context.beginPath();
    points.forEach((point, index) => { const [x, y] = project(point); index ? context.lineTo(x, y) : context.moveTo(x, y); });
    context.stroke();
  };
  drawTrajectory(comparisonPoints, "#37d7ff", 2.4);
  drawTrajectory(primaryPoints, "#c9ff37", 3.2);

  const drawCursorPoint = (series, color, shadow) => {
    const cursorPoint = pointAtProgress(series, state.cursorProgress)?.point;
    if (!cursorPoint) return;
    const [x, y] = project(cursorPoint);
    context.shadowColor = shadow; context.shadowBlur = 14;
    context.fillStyle = color; context.beginPath(); context.arc(x, y, 5.5, 0, Math.PI * 2); context.fill();
    context.shadowBlur = 0; context.strokeStyle = "#ffffff"; context.lineWidth = 1.5;
    context.beginPath(); context.arc(x, y, 8, 0, Math.PI * 2); context.stroke();
  };
  drawCursorPoint(comparisonSeries, "#37d7ff", "rgba(55,215,255,.8)");
  drawCursorPoint(primarySeries, "#c9ff37", "rgba(201,255,55,.8)");
}

function distanceSeries(points, key) {
  return distancePoints(points).map((item) => ({ progress: item.progress, value: item.point[key] }));
}

function drawComparisonChart(canvas, key, { speed = false } = {}) {
  const { context, width, height } = canvasContext(canvas);
  context.fillStyle = "#0c1117"; context.fillRect(0, 0, width, height);
  const primary = distanceSeries(lapPoints(state.selectedLapNumber), key);
  const comparison = state.comparisonLapNumber ? distanceSeries(lapPoints(state.comparisonLapNumber), key) : [];
  if (primary.length < 2) return;

  const padding = { left: 48, right: 18, top: 18, bottom: 30 };
  const values = [...primary, ...comparison].map((point) => point.value).filter(Number.isFinite);
  let minimum; let maximum; let step;
  if (speed) {
    minimum = 0;
    maximum = Math.ceil(Math.max(...values, 20) / 20) * 20;
    step = 20;
  } else {
    const range = Math.max(.5, Math.ceil(Math.max(...values.map(Math.abs), .5) * 2) / 2);
    minimum = -range; maximum = range; step = range / 2;
  }

  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const y = (value) => padding.top + (maximum - value) / Math.max(maximum - minimum, .001) * plotHeight;
  context.font = "10px ui-monospace, monospace"; context.fillStyle = "#73808e"; context.strokeStyle = "#202a34"; context.lineWidth = 1;
  for (let value = minimum; value <= maximum + step / 10; value += step) {
    const yPosition = y(value);
    context.beginPath(); context.moveTo(padding.left, yPosition); context.lineTo(width - padding.right, yPosition); context.stroke();
    context.fillText(speed ? String(Math.round(value)) : value.toFixed(1), 12, yPosition + 3);
  }
  for (let tick = 0; tick <= 4; tick += 1) {
    const progress = state.chartView.start + (state.chartView.end - state.chartView.start) * tick / 4;
    const xPosition = padding.left + tick / 4 * plotWidth;
    context.fillText(`${Math.round(progress * 100)}%`, xPosition - (tick === 4 ? 24 : 8), height - 9);
  }

  const draw = (series, color, widthPx) => {
    if (series.length < 2) return;
    context.save();
    context.beginPath(); context.rect(padding.left, padding.top, plotWidth, plotHeight); context.clip();
    context.strokeStyle = color; context.lineWidth = widthPx; context.beginPath();
    series.forEach((point, index) => {
      const xPosition = chartX(point.progress, padding, plotWidth);
      const yPosition = y(point.value);
      index ? context.lineTo(xPosition, yPosition) : context.moveTo(xPosition, yPosition);
    });
    context.stroke();
    context.restore();
  };
  draw(comparison, "#37d7ff", 1.6);
  draw(primary, "#c9ff37", 2.2);

  if (state.cursorProgress !== null && state.cursorProgress >= state.chartView.start && state.cursorProgress <= state.chartView.end) {
    const xPosition = chartX(state.cursorProgress, padding, plotWidth);
    context.strokeStyle = "rgba(255,255,255,.55)"; context.lineWidth = 1;
    context.beginPath(); context.moveTo(xPosition, padding.top); context.lineTo(xPosition, height - padding.bottom); context.stroke();
    const markers = [
      { item: pointAtProgress(primary, state.cursorProgress), color: "#c9ff37", side: -1 },
      { item: pointAtProgress(comparison, state.cursorProgress), color: "#37d7ff", side: 1 },
    ];
    markers.forEach(({ item, color, side }) => {
      if (!item || !Number.isFinite(item.value)) return;
      const yPosition = y(item.value);
      context.fillStyle = color; context.beginPath(); context.arc(xPosition, yPosition, 4.5, 0, Math.PI * 2); context.fill();
      const label = speed ? `${item.value.toFixed(1)}` : `${item.value.toFixed(2)} g`;
      context.font = "bold 11px ui-monospace, monospace";
      const labelWidth = context.measureText(label).width + 10;
      const labelX = Math.max(padding.left, Math.min(width - padding.right - labelWidth, xPosition + side * 8 - (side < 0 ? labelWidth : 0)));
      context.fillStyle = "rgba(12,17,23,.92)"; context.fillRect(labelX, yPosition - 20, labelWidth, 17);
      context.fillStyle = color; context.fillText(label, labelX + 5, yPosition - 8);
    });
  }
}

function drawDeltaChart() {
  const { context, width, height } = canvasContext(elements.deltaCanvas);
  context.fillStyle = "#0c1117"; context.fillRect(0, 0, width, height);
  if (!state.selectedLapNumber || !state.comparisonLapNumber) {
    context.fillStyle = "#657180";
    context.font = "13px system-ui";
    context.fillText(t("telemetry.deltaEmpty"), 24, 38);
    return;
  }
  const primary = distancePoints(lapPoints(state.selectedLapNumber));
  const comparison = distancePoints(lapPoints(state.comparisonLapNumber));
  if (primary.length < 2 || comparison.length < 2) return;
  const primaryStart = primary[0].point.timeMs;
  const comparisonStart = comparison[0].point.timeMs;
  const delta = Array.from({ length: 801 }, (_, index) => {
    const progress = index / 800;
    const primaryTime = interpolatedTimeAtProgress(primary, progress);
    const comparisonTime = interpolatedTimeAtProgress(comparison, progress);
    return {
      progress,
      value: ((primaryTime - primaryStart) - (comparisonTime - comparisonStart)) / 1000,
    };
  }).filter((item) => Number.isFinite(item.value));
  if (delta.length < 2) return;

  const padding = { left: 52, right: 18, top: 18, bottom: 30 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const range = Math.max(.1, Math.ceil(Math.max(...delta.map((item) => Math.abs(item.value))) * 10) / 10);
  const y = (value) => padding.top + (range - value) / (range * 2) * plotHeight;
  context.font = "10px ui-monospace, monospace"; context.fillStyle = "#73808e"; context.lineWidth = 1;
  [-range, 0, range].forEach((value) => {
    const yPosition = y(value);
    context.strokeStyle = value === 0 ? "rgba(255,255,255,.28)" : "#202a34";
    context.beginPath(); context.moveTo(padding.left, yPosition); context.lineTo(width - padding.right, yPosition); context.stroke();
    context.fillText(`${value > 0 ? "+" : ""}${value.toFixed(1)}`, 10, yPosition + 3);
  });
  for (let tick = 0; tick <= 4; tick += 1) {
    const progress = state.chartView.start + (state.chartView.end - state.chartView.start) * tick / 4;
    const xPosition = padding.left + tick / 4 * plotWidth;
    context.fillText(`${Math.round(progress * 100)}%`, xPosition - (tick === 4 ? 24 : 8), height - 9);
  }

  const zeroY = y(0);
  context.save();
  context.beginPath(); context.rect(padding.left, padding.top, plotWidth, plotHeight); context.clip();
  context.beginPath(); context.moveTo(chartX(delta[0].progress, padding, plotWidth), zeroY);
  delta.forEach((item) => context.lineTo(chartX(item.progress, padding, plotWidth), y(item.value)));
  context.lineTo(chartX(delta.at(-1).progress, padding, plotWidth), zeroY); context.closePath();
  context.fillStyle = "rgba(201,255,55,.08)"; context.fill();
  context.strokeStyle = "#c9ff37"; context.lineWidth = 2.2; context.beginPath();
  delta.forEach((item, index) => {
    const xPosition = chartX(item.progress, padding, plotWidth);
    const yPosition = y(item.value);
    index ? context.lineTo(xPosition, yPosition) : context.moveTo(xPosition, yPosition);
  });
  context.stroke();
  context.restore();

  if (state.cursorProgress !== null && state.cursorProgress >= state.chartView.start && state.cursorProgress <= state.chartView.end) {
    const item = pointAtProgress(delta, state.cursorProgress);
    const xPosition = chartX(state.cursorProgress, padding, plotWidth);
    context.strokeStyle = "rgba(255,255,255,.55)"; context.lineWidth = 1;
    context.beginPath(); context.moveTo(xPosition, padding.top); context.lineTo(xPosition, height - padding.bottom); context.stroke();
    context.fillStyle = "#c9ff37"; context.beginPath(); context.arc(xPosition, y(item.value), 4.5, 0, Math.PI * 2); context.fill();
    const label = `${item.value >= 0 ? "+" : ""}${item.value.toFixed(3)} s`;
    context.font = "bold 11px ui-monospace, monospace";
    const labelWidth = context.measureText(label).width + 10;
    const labelX = Math.min(width - padding.right - labelWidth, Math.max(padding.left, xPosition + 8));
    context.fillStyle = "rgba(12,17,23,.92)"; context.fillRect(labelX, y(item.value) - 21, labelWidth, 17);
    context.fillStyle = "#c9ff37"; context.fillText(label, labelX + 5, y(item.value) - 9);
  }
}

function drawCharts() {
  drawComparisonChart(elements.telemetryCanvas, state.telemetryMetric, { speed: state.telemetryMetric === "speed" });
  drawDeltaChart();
}

let cursorFrame = 0;
function setCursorProgress(progress) {
  state.cursorProgress = progress;
  if (cursorFrame) return;
  cursorFrame = requestAnimationFrame(() => {
    cursorFrame = 0;
    drawTrack(); drawCharts();
  });
}

function updateCursorFromEvent(event) {
  const paddingLeft = event.currentTarget === elements.deltaCanvas ? 52 : 48;
  setCursorProgress(chartProgress(event.clientX, event.currentTarget, paddingLeft));
}

[elements.telemetryCanvas, elements.deltaCanvas].forEach((canvas) => {
  const pointers = new Map();
  let pinch = null;
  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, event.clientX);
    if (pointers.size === 1) updateCursorFromEvent(event);
    if (pointers.size === 2) {
      const positions = [...pointers.values()];
      pinch = {
        distance: Math.abs(positions[1] - positions[0]),
        span: state.chartView.end - state.chartView.start,
        center: chartProgress((positions[0] + positions[1]) / 2, canvas, canvas === elements.deltaCanvas ? 52 : 48),
      };
    }
  });
  canvas.addEventListener("pointermove", (event) => {
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, event.clientX);
    if (pointers.size === 2 && pinch) {
      const positions = [...pointers.values()];
      const distance = Math.max(8, Math.abs(positions[1] - positions[0]));
      setChartZoom(pinch.center, pinch.span * pinch.distance / distance);
    } else if (event.pointerType === "mouse" || canvas.hasPointerCapture?.(event.pointerId)) {
      updateCursorFromEvent(event);
    }
  });
  const releasePointer = (event) => { pointers.delete(event.pointerId); if (pointers.size < 2) pinch = null; };
  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", releasePointer);
  canvas.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "mouse" && !event.buttons) setCursorProgress(null);
  });
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const center = chartProgress(event.clientX, canvas, canvas === elements.deltaCanvas ? 52 : 48);
    const factor = Math.exp(event.deltaY * 0.0015);
    setChartZoom(center, (state.chartView.end - state.chartView.start) * factor);
  }, { passive: false });
  canvas.addEventListener("dblclick", resetChartZoom);
});

elements.chartZoomReset.addEventListener("click", resetChartZoom);

{
  const canvas = elements.trackCanvas;
  const pointers = new Map();
  let gesture = null;
  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const rect = canvas.getBoundingClientRect();
    if (pointers.size === 1) {
      gesture = { mode: "pan", x: event.clientX, y: event.clientY, offsetX: state.trackView.offsetX, offsetY: state.trackView.offsetY };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = {
        mode: "pinch",
        distance: Math.hypot(b.x - a.x, b.y - a.y),
        scale: state.trackView.scale,
        anchorX: (a.x + b.x) / 2 - rect.left - rect.width / 2,
        anchorY: (a.y + b.y) / 2 - rect.top - rect.height / 2,
      };
    }
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2 && gesture?.mode === "pinch") {
      const [a, b] = [...pointers.values()];
      const distance = Math.max(8, Math.hypot(b.x - a.x, b.y - a.y));
      updateTrackZoom(gesture.scale * distance / Math.max(gesture.distance, 8), gesture.anchorX, gesture.anchorY);
    } else if (pointers.size === 1 && gesture?.mode === "pan" && state.trackView.scale > 1) {
      state.trackView.offsetX = gesture.offsetX + event.clientX - gesture.x;
      state.trackView.offsetY = gesture.offsetY + event.clientY - gesture.y;
      drawTrack();
    }
  });
  const release = (event) => { pointers.delete(event.pointerId); gesture = null; };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const anchorX = event.clientX - rect.left - rect.width / 2;
    const anchorY = event.clientY - rect.top - rect.height / 2;
    updateTrackZoom(state.trackView.scale * Math.exp(-event.deltaY * 0.0015), anchorX, anchorY);
  }, { passive: false });
  canvas.addEventListener("dblclick", resetTrackZoom);
  elements.trackZoomReset.addEventListener("click", resetTrackZoom);
}

function selectTelemetryMetric(metric) {
  state.telemetryMetric = ["speed", "gForceX", "gForceY"].includes(metric) ? metric : "speed";
  const translationKey = state.telemetryMetric === "speed" ? "telemetry.speed" : state.telemetryMetric === "gForceX" ? "telemetry.longitudinal" : "telemetry.lateral";
  elements.telemetryMetricSelect.value = state.telemetryMetric;
  elements.telemetryChartTitle.textContent = t(translationKey);
  elements.telemetryChartUnit.textContent = state.telemetryMetric === "speed" ? t("unit.speed") : "g";
  document.querySelectorAll("[data-metric]").forEach((button) => button.classList.toggle("active", button.dataset.metric === state.telemetryMetric));
  drawCharts();
}

function renderStorage(storage) {
  state.storage = storage;
  elements.storageState.hidden = false;
  elements.deviceHealth.hidden = false;
  elements.memoryLevel.textContent = `${storage.memoryLevel}%`;
  elements.storedMessages.textContent = storage.storedMessages.toLocaleString("ru-RU");
  const freeMessages = Math.max(0, storage.capacityMessages - storage.storedMessages);
  const freePercent = storage.capacityMessages ? Math.max(0, 100 - storage.memoryLevel) : 0;
  elements.memoryFree.textContent = `${freePercent}%`;
  elements.memoryFreeMeta.textContent = t("memory.remaining", { records: freeMessages.toLocaleString(getLanguage()), time: formatDuration(freeMessages / 25 * 1000) });
  elements.unlockForm.hidden = !(storage.securityEnabled && !storage.unlocked);
  elements.downloadButton.disabled = state.memoryBusy || storage.recording || storage.securityEnabled && !storage.unlocked || storage.storedMessages === 0;
  elements.eraseButton.disabled = state.memoryBusy || storage.recording || storage.securityEnabled && !storage.unlocked || storage.storedMessages === 0;
  elements.recordButton.disabled = state.memoryBusy || !state.client?.supportsStandaloneRecording || storage.securityEnabled && !storage.unlocked;
  elements.recordButton.classList.toggle("recording", storage.recording);
  elements.recordButton.innerHTML = `<span></span><b>${t(storage.recording ? "action.stop" : "action.start")}</b>`;
  setHint(storage.recording ? t("hint.recording") : t("hint.ready", { model: state.deviceModel || "—" }));
}

function renderTelemetry(point) {
  state.latestTelemetry = point;
  const hasFix = point.fixStatus === 3 && (point.fixStatusFlags & 1) !== 0;
  elements.deviceHealth.hidden = false;
  elements.gpsFix.textContent = t(hasFix ? "device.fix" : "device.noFix");
  elements.gpsFix.className = hasFix ? "good" : "bad";
  elements.satellites.textContent = t("device.satellites", { count: point.satellites });
  if (state.deviceModel === "RaceBoxMicro") {
    elements.batteryLevel.textContent = `${(point.batteryRaw / 10).toFixed(1)} V`;
    elements.batteryMeta.textContent = t("device.inputVoltage");
  } else {
    const charging = (point.batteryRaw & 0x80) !== 0;
    elements.batteryLevel.textContent = `${point.batteryRaw & 0x7f}%`;
    elements.batteryMeta.textContent = t(charging ? "device.charging" : "device.batteryPower");
  }
}

async function refreshStorage() {
  if (!state.client) return;
  try { renderStorage(await state.client.readStorageStatus()); }
  catch (error) { setHint(connectionErrorMessage(error), true); }
}

function renderSessions() {
  elements.sessionsValue.textContent = String(state.sessions.length);
  const totalPoints = state.sessions.reduce((sum, session) => sum + (session.points?.length ?? session.pointCount ?? 0), 0);
  elements.sessionsMeta.textContent = t("progress.records", { received: totalPoints.toLocaleString(getLanguage()), expected: totalPoints.toLocaleString(getLanguage()) });
  elements.logsPageCount.textContent = String(state.sessions.length);
  elements.logsPagePoints.textContent = t("sessions.points", { count: totalPoints.toLocaleString(getLanguage()) });
  if (!state.sessions.length) {
    elements.sessionList.innerHTML = `<p class="empty">${t("sessions.empty")}</p>`;
    return;
  }
  elements.sessionList.innerHTML = state.sessions.map((session) => `
    <div class="session-item ${session === state.selectedSession ? "selected" : ""}">
      <button class="session-open" data-session="${session.id}">
        <strong>${session.title || t("sessions.item", { id: session.displayId ?? session.id })}${session.source === "cloud" ? " ☁" : ""}</strong><span>${formatDate(session.startedAt)}</span><small>${formatDuration(new Date(session.endedAt) - new Date(session.startedAt))} · ${t("sessions.points", { count: (session.points?.length ?? session.pointCount ?? 0).toLocaleString(getLanguage()) })}</small>
      </button>
      ${session.source === "cloud" ? `<div class="session-actions"><button data-rename="${session.cloudId}" title="${t("sessions.rename")}">✎</button><button data-delete="${session.cloudId}" title="${t("sessions.delete")}">×</button></div>` : ""}
    </div>`).join("");
  elements.sessionList.querySelectorAll("[data-session]").forEach((button) => button.addEventListener("click", async () => {
    if (await selectSession(button.dataset.session)) showView("analysis");
  }));
  elements.sessionList.querySelectorAll("[data-rename]").forEach((button) => button.addEventListener("click", () => renameCloudSession(button.dataset.rename)));
  elements.sessionList.querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", () => deleteCloudSession(button.dataset.delete)));
}

async function renameCloudSession(cloudId) {
  const session = state.sessions.find((item) => item.cloudId === cloudId);
  if (!session) return;
  const title = prompt(t("sessions.renamePrompt"), session.title || "");
  if (!title?.trim()) return;
  try { await renameLog(cloudId, title.trim()); session.title = title.trim(); renderSessions(); }
  catch (error) { setAccountMessage(error.message, true); }
}

async function deleteCloudSession(cloudId) {
  const session = state.sessions.find((item) => item.cloudId === cloudId);
  if (!session || !confirm(t("sessions.deleteConfirm", { title: session.title || t("sessions.item", { id: session.displayId ?? session.id }) }))) return;
  try {
    await deleteLog(cloudId);
    const wasSelected = session === state.selectedSession;
    state.sessions = state.sessions.filter((item) => item !== session);
    state.cloudLogs = state.cloudLogs.filter((item) => item.cloudId !== cloudId);
    if (wasSelected) {
      state.selectedSession = null; state.analysis = null;
      const replacement = state.sessions[0];
      if (replacement) selectSession(replacement.id);
      else {
        elements.durationValue.textContent = "—"; elements.durationMeta.textContent = t("summary.selected");
        elements.maxSpeedValue.textContent = "—"; elements.sampleRateValue.textContent = "—";
        elements.trackTitle.textContent = t("track.empty"); elements.copyAiButton.disabled = true;
        elements.insightsList.innerHTML = `<li>${t("insights.empty")}</li>`;
        drawTrack(); drawCharts();
      }
    }
    renderAccount(); renderSessions();
  } catch (error) { setAccountMessage(error.message, true); }
}

function renderLapControls() {
  const laps = state.analysis?.laps ?? [];
  const options = laps.map((lap) => `<option value="${lap.number}">${t("laps.option", { lap: lap.number, time: formatLapTime(lap.durationMs) })}</option>`).join("");
  elements.primaryLapSelect.innerHTML = options;
  elements.comparisonLapSelect.innerHTML = `<option value="">${t("laps.none")}</option>${options}`;
  elements.primaryLapSelect.disabled = !laps.length;
  elements.comparisonLapSelect.disabled = laps.length < 2;
  elements.primaryLapSelect.value = state.selectedLapNumber ? String(state.selectedLapNumber) : "";
  elements.comparisonLapSelect.value = state.comparisonLapNumber ? String(state.comparisonLapNumber) : "";
  elements.primaryLapLegend.textContent = state.selectedLapNumber ? t("laps.legend", { lap: state.selectedLapNumber }) : "—";
  elements.comparisonLapLegend.textContent = state.comparisonLapNumber ? t("laps.legend", { lap: state.comparisonLapNumber }) : t("laps.none");
}

function updateLapView() {
  if (!state.analysis || !state.selectedSession) return;
  const lap = state.analysis.laps.find((item) => item.number === state.selectedLapNumber);
  elements.durationValue.textContent = lap ? formatLapTime(lap.durationMs) : formatDuration(state.analysis.session.durationMs);
  elements.durationMeta.textContent = lap ? t("laps.legend", { lap: lap.number }) : formatDate(state.selectedSession.startedAt);
  elements.maxSpeedValue.textContent = (lap?.maxSpeed ?? state.analysis.session.maxSpeed).toFixed(1);
  elements.sampleRateValue.textContent = state.analysis.sampleRateHz.toFixed(0);
  elements.trackTitle.textContent = `${state.track ? `${state.track.name} · ` : ""}${t("sessions.item", { id: state.selectedSession.displayId ?? state.selectedSession.id })}${lap ? ` · ${t("laps.legend", { lap: lap.number })}` : ""}`;
  renderLapControls(); drawTrack(); drawCharts();
}

async function selectSession(id) {
  const isNewSession = String(state.selectedSession?.id) !== String(id);
  if (isNewSession) { resetChartZoom(); resetTrackZoom(); }
  const session = state.sessions.find((item) => String(item.id) === String(id));
  state.selectedSession = session;
  if (session?.source === "cloud" && !session.points) {
    try {
      const record = await loadLog(session.cloudId);
      session.points = record?.points ?? [];
      session.pointCount = session.points.length;
      if (state.selectedSession !== session) return false;
    } catch (error) {
      setAccountMessage(error.message, true);
      return false;
    }
  }
  if (!state.selectedSession?.points.length) return false;
  state.track = identifyTrack(state.selectedSession.points);
  state.selectedSession.points = splitSessionIntoLaps(state.selectedSession.points, state.track);
  state.analysis = analyzeSession(state.selectedSession.points);
  if (isNewSession || !state.analysis.laps.some((lap) => lap.number === state.selectedLapNumber)) {
    const ordered = [...state.analysis.laps].sort((a, b) => a.durationMs - b.durationMs);
    state.selectedLapNumber = ordered[0]?.number ?? null;
    state.comparisonLapNumber = ordered[1]?.number ?? null;
  }
  elements.sourceLabel.textContent = `${state.deviceName} · память устройства`;
  elements.copyAiButton.disabled = false;
  elements.copyStatus.textContent = "Контекст строится только по выбранной сессии.";
  elements.insightsList.innerHTML = generateLocalInsights(state.analysis, t).map((insight) => `<li>${insight}</li>`).join("");
  renderSessions(); updateLapView();
  return true;
}

function setAccountMessage(message = "", error = false) {
  elements.accountMessage.textContent = message;
  elements.accountMessage.classList.toggle("error", error);
}

function updateAccess() {
  const unlocked = Boolean(state.user) || testMode;
  document.body.classList.toggle("auth-locked", !unlocked);
  elements.authGate.hidden = unlocked;
}

function setAccountMode(mode) {
  accountMode = mode === "register" ? "register" : "signin";
  const registering = accountMode === "register";
  elements.accountSignInTab.classList.toggle("active", !registering);
  elements.accountRegisterTab.classList.toggle("active", registering);
  elements.accountSignInTab.setAttribute("aria-selected", String(!registering));
  elements.accountRegisterTab.setAttribute("aria-selected", String(registering));
  elements.accountConfirmLabel.hidden = !registering;
  elements.accountPasswordConfirm.required = registering;
  elements.accountPassword.autocomplete = registering ? "new-password" : "current-password";
  elements.accountDialogTitle.textContent = t(registering ? "account.registerTitle" : "account.title");
  elements.accountDialogCopy.textContent = t(registering ? "account.registerCopy" : "account.copy");
  elements.accountSubmitButton.textContent = t(registering ? "account.create" : "account.signIn");
  elements.accountPassword.classList.remove("invalid");
  elements.accountPasswordConfirm.classList.remove("invalid");
  elements.accountPasswordConfirm.setCustomValidity("");
  setAccountMessage("");
}

function openAccountDialog(mode = "signin") {
  renderAccount();
  if (!state.user) setAccountMode(mode);
  elements.accountDialog.showModal();
}

function renderAccount() {
  const email = state.user?.email ?? "";
  elements.accountGuest.hidden = Boolean(state.user);
  elements.accountMember.hidden = !state.user;
  elements.accountLabel.textContent = email || t("account.signIn");
  elements.accountAvatar.textContent = email ? email[0] : "?";
  elements.accountUserEmail.textContent = email;
  elements.cloudLogStatus.textContent = state.user ? t("account.logs", { count: state.cloudLogs.length }) : "";
  if (!cloudConfigured) {
    setAccountMessage(t("account.notConfigured"), true);
    elements.accountForm.querySelectorAll("input, button").forEach((element) => { element.disabled = true; });
  }
  updateAccess();
}

async function syncCloudLogs() {
  if (!state.user) return;
  try {
    state.cloudLogs = await loadLogs();
    const localLogs = state.sessions.filter((session) => session.source !== "cloud");
    const localDates = new Set(localLogs.map((session) => session.startedAt));
    state.sessions = [...localLogs, ...state.cloudLogs.filter((session) => !localDates.has(session.startedAt))];
    renderAccount(); renderSessions();
    if (!state.selectedSession && state.sessions.length) await selectSession(state.sessions[0].id);
  } catch (error) { setAccountMessage(error.message, true); }
}

async function applyUser(user) {
  state.user = user;
  if (!user) {
    if (!testMode && state.client) await state.client.disconnect();
    state.cloudLogs = [];
    state.sessions = state.sessions.filter((session) => session.source !== "cloud");
    if (state.selectedSession?.source === "cloud") state.selectedSession = null;
    showView("analysis", false); renderAccount(); renderSessions();
    return;
  }
  renderAccount();
  await syncCloudLogs();
  showView(location.hash === "#logs" ? "logs" : "analysis", false);
}

async function submitAccount(action) {
  const email = elements.accountEmail.value.trim();
  const password = elements.accountPassword.value;
  if (accountMode === "register" && password !== elements.accountPasswordConfirm.value) {
    elements.accountPassword.classList.add("invalid");
    elements.accountPasswordConfirm.classList.add("invalid");
    elements.accountPasswordConfirm.setCustomValidity(t("account.passwordMismatch"));
    elements.accountPasswordConfirm.reportValidity();
    setAccountMessage(t("account.passwordMismatch"), true);
    return;
  }
  setAccountMessage("");
  elements.accountSubmitButton.disabled = true;
  elements.accountSubmitButton.textContent = t("account.working");
  try {
    const user = await action(email, password);
    if (user) {
      await applyUser(user);
      elements.accountForm.reset();
      elements.accountDialog.close();
    }
    else setAccountMessage(t("account.confirm"));
  } catch (error) { setAccountMessage(error.message, true); }
  finally {
    elements.accountSubmitButton.disabled = false;
    elements.accountSubmitButton.textContent = t(accountMode === "register" ? "account.create" : "account.signIn");
  }
}

async function saveDownloadedLogs(sessions) {
  if (!state.user) return;
  try {
    await Promise.all(sessions.map((session) => saveLog(session, state.deviceName)));
    await syncCloudLogs();
    setAccountMessage(t("account.saved"));
  } catch (error) { setAccountMessage(error.message, true); }
}

async function importLogFile(file) {
  if (!file || !state.user) return;
  elements.importLogButton.disabled = true;
  try {
    const points = parseRaceBoxCsv(await file.text());
    const session = {
      startedAt: points[0].time,
      endedAt: points.at(-1).time,
      points,
    };
    const id = await saveLog(session, "LapTrace");
    if (id) await renameLog(id, file.name.replace(/\.csv$/i, "").slice(0, 100));
    await syncCloudLogs();
    setAccountMessage(t("logsPage.imported"));
  } catch (error) {
    setAccountMessage(error.message, true);
  } finally {
    elements.importLogInput.value = "";
    elements.importLogButton.disabled = false;
  }
}

async function createClient() {
  let Client = RaceBoxBleClient;
  if (testMode) Client = (await import("./ble/mock-racebox.js")).MockRaceBoxClient;
  else if (globalThis.Capacitor?.isNativePlatform?.()) {
    Client = (await import("./ble/capacitor-racebox.js")).CapacitorRaceBoxClient;
  }
  return new Client({ onTelemetry: renderTelemetry, onStatus: (status, name) => {
    const connected = status === "connected";
    state.connected = connected;
    setStatus(connected ? t("state.connected", { name }) : t("status.disconnected"), connected);
    elements.connectButton.textContent = t(connected ? "action.disconnect" : "action.connect");
    if (!connected) {
      clearInterval(state.pollTimer); state.pollTimer = null; state.client = null;
      elements.downloadButton.disabled = true; elements.recordButton.disabled = true;
      elements.eraseButton.disabled = true;
    }
  }});
}

async function connect() {
  if (!state.user && !testMode) { openAccountDialog(); return; }
  if (state.client) { state.client.disconnect(); return; }
  try {
    setStatus(t("status.searching")); setHint(t("error.notSelected"));
    const client = await createClient();
    state.deviceName = await client.connect(); state.client = client; state.deviceModel = client.model;
    setStatus(t("state.reading", { name: state.deviceName }), true);
    await refreshStorage();
    clearInterval(state.pollTimer);
    state.pollTimer = setInterval(refreshStorage, 10_000);
    setStatus(t("state.ready", { name: state.deviceName }), true);
  } catch (error) { state.client = null; setStatus(t("status.connectFailed")); setHint(connectionErrorMessage(error), true); }
}

async function toggleRecording() {
  if (!state.user && !testMode) { openAccountDialog(); return; }
  if (!state.client || !state.storage) return;
  const wasRecording = state.storage.recording;
  elements.recordButton.disabled = true;
  try {
    setStatus(t(wasRecording ? "state.stopped" : "state.recording", { name: state.deviceName }), true);
    if (wasRecording) await state.client.stopRecording();
    else await state.client.startRecording();
    await refreshStorage();
    setStatus(t(wasRecording ? "state.stopped" : "state.recording", { name: state.deviceName }), true);
  } catch (error) {
    setHint(error.message, true);
    setStatus(`${state.deviceName} · команда записи отклонена`, true);
  } finally {
    elements.recordButton.disabled = !state.client?.supportsStandaloneRecording || state.storage?.securityEnabled && !state.storage?.unlocked;
  }
}

async function downloadHistory() {
  if (!state.user && !testMode) { openAccountDialog(); return; }
  try {
    elements.downloadButton.disabled = true; elements.downloadProgress.hidden = false; elements.cancelButton.hidden = false;
    setStatus(t("state.downloading", { name: state.deviceName }), true);
    const sessions = await state.client.downloadHistory(({ expected, received, percent }) => {
      elements.progressBar.value = percent;
      elements.progressLabel.textContent = expected ? t("progress.records", { received: received.toLocaleString(getLanguage()), expected: expected.toLocaleString(getLanguage()) }) : t("progress.preparing");
    });
    if (!sessions.length) throw new Error("В памяти не найдено записей телеметрии");
    state.sessions = sessions; state.selectedSession = sessions.at(-1);
    renderSessions(); selectSession(state.selectedSession.id);
    await saveDownloadedLogs(sessions);
    elements.progressBar.value = 100; elements.progressLabel.textContent = t("progress.done", { count: sessions.length });
    elements.cancelButton.hidden = true;
    setStatus(t("state.loaded", { name: state.deviceName }), true); setHint(t("state.loaded", { name: state.deviceName }));
  } catch (error) { elements.cancelButton.hidden = true; setStatus(`${state.deviceName} · ошибка загрузки`, true); setHint(error.message, true); }
  finally { elements.downloadButton.disabled = false; }
}

async function eraseDeviceMemory() {
  if (!state.user && !testMode) { openAccountDialog(); return; }
  if (!state.client || !state.storage || state.storage.recording || state.storage.storedMessages === 0) return;
  if (!confirm(t("erase.confirm"))) return;
  elements.eraseButton.disabled = true;
  elements.downloadButton.disabled = true;
  elements.recordButton.disabled = true;
  state.memoryBusy = true;
  elements.eraseProgress.hidden = false;
  elements.eraseProgressBar.value = 0;
  elements.eraseProgressLabel.textContent = t("erase.progress", { percent: 0 });
  try {
    await state.client.eraseHistory((percent) => {
      elements.eraseProgressBar.value = percent;
      elements.eraseProgressLabel.textContent = t("erase.progress", { percent });
    });
    elements.eraseProgressBar.value = 100;
    elements.eraseProgressLabel.textContent = t("erase.done");
    await refreshStorage();
    setHint(t("erase.done"));
  } catch (error) {
    setHint(error.message, true);
  } finally {
    state.memoryBusy = false;
    if (state.storage) renderStorage(state.storage);
  }
}

elements.connectButton.addEventListener("click", connect);
elements.recordButton.addEventListener("click", toggleRecording);
elements.downloadButton.addEventListener("click", downloadHistory);
elements.eraseButton.addEventListener("click", eraseDeviceMemory);
elements.cancelButton.addEventListener("click", () => state.client?.cancelDownload());
elements.analysisNavButton.addEventListener("click", () => showView("analysis"));
elements.logsNavButton.addEventListener("click", () => state.user || testMode ? showView("logs") : openAccountDialog("signin"));
elements.logsBackButton.addEventListener("click", () => showView("analysis"));
elements.importLogButton.addEventListener("click", () => elements.importLogInput.click());
elements.importLogInput.addEventListener("change", () => importLogFile(elements.importLogInput.files?.[0]));
elements.accountButton.addEventListener("click", () => openAccountDialog("signin"));
elements.gateAccountButton.addEventListener("click", () => openAccountDialog("register"));
elements.demoAccountButton.addEventListener("click", () => openAccountDialog("register"));
elements.accountSignInTab.addEventListener("click", () => setAccountMode("signin"));
elements.accountRegisterTab.addEventListener("click", () => setAccountMode("register"));
elements.accountPasswordConfirm.addEventListener("input", () => {
  elements.accountPassword.classList.remove("invalid");
  elements.accountPasswordConfirm.classList.remove("invalid");
  elements.accountPasswordConfirm.setCustomValidity("");
});
document.querySelectorAll("input:not([type='range']):not([type='file']), textarea").forEach((field) => {
  field.addEventListener("focus", () => {
    if (!globalThis.Capacitor?.isNativePlatform?.()) return;
    setTimeout(() => field.scrollIntoView({ block: "center", behavior: "smooth" }), 250);
  });
});
elements.accountClose.addEventListener("click", () => elements.accountDialog.close());
elements.accountDialog.addEventListener("click", (event) => { if (event.target === elements.accountDialog) elements.accountDialog.close(); });
elements.accountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitAccount(accountMode === "register" ? signUp : signIn);
});
elements.logoutButton.addEventListener("click", async () => { try { await signOut(); await applyUser(null); } catch (error) { setAccountMessage(error.message, true); } });
elements.unlockForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const ok = await state.client.unlockMemory(Number(elements.securityCode.value));
    if (!ok) throw new Error("Неверный код памяти");
    renderStorage(await state.client.readStorageStatus()); setHint("Память разблокирована.");
  } catch (error) { setHint(error.message, true); }
});
elements.copyAiButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(buildAiPrompt(state.analysis, elements.aiQuestion.value));
  elements.copyStatus.textContent = "AI-контекст выбранной BLE-сессии скопирован.";
});
elements.primaryLapSelect.addEventListener("change", () => {
  state.selectedLapNumber = Number(elements.primaryLapSelect.value) || null;
  if (state.comparisonLapNumber === state.selectedLapNumber) state.comparisonLapNumber = null;
  updateLapView();
});
elements.comparisonLapSelect.addEventListener("change", () => {
  state.comparisonLapNumber = Number(elements.comparisonLapSelect.value) || null;
  if (state.comparisonLapNumber === state.selectedLapNumber) state.comparisonLapNumber = null;
  updateLapView();
});
elements.telemetryMetricSelect.addEventListener("change", () => selectTelemetryMetric(elements.telemetryMetricSelect.value));
document.querySelectorAll("[data-metric]").forEach((button) => button.addEventListener("click", () => selectTelemetryMetric(button.dataset.metric)));
window.addEventListener("resize", () => { drawTrack(); drawCharts(); });
window.addEventListener("hashchange", () => {
  if (location.hash === "#logs" && (state.user || testMode)) showView("logs", false);
  else showView("analysis", false);
});
elements.languageSelect.addEventListener("change", () => setLanguage(elements.languageSelect.value));
onLanguageChange(() => {
  renderAccount();
  if (state.storage) renderStorage(state.storage);
  if (state.latestTelemetry) renderTelemetry(state.latestTelemetry);
  selectTelemetryMetric(state.telemetryMetric);
  if (state.sessions.length) renderSessions();
  if (state.selectedSession) selectSession(state.selectedSession.id);
  else { drawTrack(); drawCharts(); }
  if (state.connected) {
    setStatus(t(state.storage?.recording ? "state.recording" : "state.ready", { name: state.deviceName }), true);
    elements.connectButton.textContent = t("action.disconnect");
  } else {
    setStatus(t("status.disconnected"));
    elements.connectButton.textContent = t("action.connect");
  }
});
applyTranslations();
renderAccount();
showView(location.hash === "#logs" && testMode ? "logs" : "analysis", false);
drawTrack(); drawCharts();

if (cloudConfigured) {
  currentUser().then(applyUser);
}

if (testMode) elements.actionHint.textContent = t("hint.mock");
