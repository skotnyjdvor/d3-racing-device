import { analyzeSession, generateLocalInsights } from "./domain/analysis.js";
import { parseRaceBoxCsv } from "./domain/csv.js";
import { identifyTrack, loadTrackCatalog } from "./domain/tracks.js";
import { splitSessionIntoLaps } from "./domain/laps.js";
import { computeSectors } from "./domain/sectors.js";
import { applyTranslations, getLanguage, onLanguageChange, setLanguage, t } from "./i18n.js";
import { cloudConfigured, currentUser, deleteLog, loadLog, loadLogs, loadSharedSession, renameLog, saveLog } from "./cloud/api.js";
import { initShop, onShopShown, setShopUser } from "./shop.js";
import { initProfile, onProfileShown, setProfileUser } from "./profile.js";
import { initStats, onStatsShown, setStatsUser } from "./stats.js";
import { initShare, openShareDialog } from "./share.js";
import { PAGE_PATHS, currentPage, interceptLinks, upgradeLegacyHash } from "./router.js";
import "@fontsource/oswald/500.css";
import "@fontsource/oswald/700.css";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import { initWorkspace } from "./workspace.js";
import { createAnalysisPanels } from "./analysis-panels.js";
import { createCornersPanel } from "./corners-panel.js";
import { createComparison } from "./comparison.js";
import { createTrackMap } from "./track-map.js";
import { distancePoints, lapsOf } from "./lap-series.js";
import { startLandingTelemetry } from "./landing-telemetry.js";
import { createLapReportPanel } from "./lap-report-panel.js";
import { createExtraLaps } from "./extra-laps.js";
import { getExcludedLaps } from "./lap-exclusion.js";
import { setSpeedUnit, speedUnit, toSpeed } from "./units.js";
import { sectorsWithout } from "./domain/sectors.js";
import { canvasContext, isOverlayFrame, overlayFrame, paintLayers } from "./canvas-layers.js";
import { makeLocalSession, mergeSessions } from "./domain/local-sessions.js";
import { deleteLocalSession, listLocalSessions, loadLocalPoints, saveLocalSession, updateLocalSession } from "./local-store.js";
import { createAccount } from "./account.js";
import { createAiPage } from "./ai-page.js";
import { createAskDialog } from "./ask-dialog.js";
import { createDevice } from "./device.js";
import { escapeHtml, formatDate, formatDuration, formatGap, formatLapTime, formatSectorTime } from "./format.js";
import { createLapCharts } from "./lap-charts.js";
import "./demo.js";
import "./ai-sample.js";

const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));
const state = { client: null, connected: false, deviceName: "", deviceModel: "", latestTelemetry: null, storage: null, sessions: [], selectedSession: null, analysis: null, sectors: null, trial: false, rival: null, comparisonSource: null, comparisonRival: false, selectedLapNumber: null, comparisonLapNumber: null, cursorProgress: null, chartView: { start: 0, end: 1 }, trackView: { scale: 1, offsetX: 0, offsetY: 0 }, telemetryMetric: "speed", track: null, user: null, cloudLogs: [], pollTimer: null, memoryBusy: false, aiReport: null, aiReportLanguage: null, aiAnalysisId: null, aiPending: false, aiHistory: [], aiHistoryLoading: false, aiHistoryError: "", aiHoverIndex: null, aiSelectedIndex: null };
const trackAiMarkerAreas = new WeakMap();
let drawTrackMap = null; // track-map.js, created on first draw
const testMode = new URLSearchParams(location.search).has("mock");
// Native apps (and ?app=1) use the telemetry-app layout; public/app-boot.js sets the class before paint.
const appMode = document.documentElement.classList.contains("app-mode");
const accountRequired = () => !state.user && !testMode;
let routedUrl = "";

// Phones: the analysis screen shows one tab at a time and short lap labels.
const compactLayout = window.matchMedia("(max-width: 700px)");
const {
  pilotSource, useRivalComparison, rememberTrack, rivalComparable, extraLapPoints, comparisonLapPoints, comparisonLabel, comparisonSelectValue, comparisonOptionsHtml, comparisonAvailable, renderComparisonSource, changeComparisonSource,
} = createComparison({
  state, elements, t, escapeHtml, formatLapTime, formatDate, compactLayout,
  lapPoints, loadLocalPoints, loadLog, updateLocalSession, showNotice, clearAiReport: () => clearAiReport(), updateLapView,
});
const askDialog = createAskDialog(elements);
const { sectorFractions, setChartZoom, setChartRange, resetChartZoom, drawComparisonChart, drawDeltaChart } = createLapCharts({
  state, elements, t, lapPoints, comparisonLapPoints, drawCharts, setCursorProgress,
});
const { renderAiPageContext, renderAiHistory, refreshAiHistory, drawAiCardVisuals, clearAiReport, renderAiReport, runAiAnalysis } = createAiPage({
  state, elements, t, escapeHtml, formatDate, formatLapTime, askDialog, trackAiMarkerAreas,
  lapPoints, comparisonLapPoints, comparisonAvailable, comparisonLabel, comparisonOptionsHtml, comparisonSelectValue,
  rivalComparable, useRivalComparison, updateLapView, drawTrack, openAccountDialog: (mode) => openAccountDialog(mode),
});
const {
  setAccountMessage, updateAccess, renderTrialBanner, endTrial, saveTrialLogs, openAccountDialog, renderAccount, handleAuthLink, handleFriendLink, pendingFriendInvite,
} = createAccount({ state, elements, t, testMode, appMode, showView, applyUser, renderSessions, selectSession });
const { setStatus, renderBluetoothSupport, renderStorage, renderTelemetry } = createDevice({
  state, elements, t, formatDuration, askDialog, testMode, appMode, accountRequired, openAccountDialog, showView, currentView: () => currentView,
  storeLocally, renderSessions, selectSession, syncLocalToCloud, saveDownloadedLogs,
});

function viewFromHash() {
  if (location.hash === "#device") return "device";
  if (location.hash === "#logs") return "logs";
  if (location.hash === "#ai") return "ai";
  if (currentPage() === "shop") return "shop";
  if (location.hash === "#profile") return "profile";
  return "analysis";
}

// App shell: screen title in the top bar and the highlighted rail / tab-bar item.
const APP_VIEW_TITLES = { device: "nav.device", analysis: "nav.analysis", logs: "profile.logs", ai: "nav.ai", profile: "profile.title" };
let currentView = "analysis";
function renderAppChrome() {
  if (!appMode) return;
  elements.appTitle.textContent = t(APP_VIEW_TITLES[currentView] ?? "nav.analysis");
  elements.appRail.querySelectorAll("[data-app-view]").forEach((button) => {
    if (button.dataset.appView === currentView) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

function showView(view, updateHash = true) {
  const device = view === "device";
  const logs = view === "logs";
  const ai = view === "ai";
  const shop = view === "shop";
  const profile = view === "profile";
  currentView = view === "shop" ? "analysis" : view;
  document.body.classList.toggle("view-device", device);
  document.body.classList.toggle("view-logs", logs);
  document.body.classList.toggle("view-ai", ai);
  document.body.classList.toggle("view-shop", shop);
  document.body.classList.toggle("view-profile", profile);
  elements.analysisNavButton.classList.toggle("active", !logs && !ai && !shop && !profile);
  elements.logsNavButton.classList.toggle("active", logs);
  elements.aiNavButton.classList.toggle("active", ai);
  if (ai) renderAiPageContext();
  if (updateHash) {
    const url = shop ? PAGE_PATHS.shop : `/${device ? "#device" : logs ? "#logs" : ai ? "#ai" : profile ? "#profile" : "#analysis"}`;
    if (url !== location.pathname + location.hash) { history.pushState(null, "", url); routedUrl = location.href; syncGuestPage(); }
  }
  renderAppChrome();
  if (appMode) window.scrollTo(0, 0);
  if (shop) { window.scrollTo(0, 0); onShopShown(); }
  else if (profile) { window.scrollTo(0, 0); onProfileShown(); onStatsShown(); }
  else {
    renderDocumentMeta();
    if (ai) requestAnimationFrame(drawTrack);
    else if (!logs) requestAnimationFrame(() => { drawTrack(); drawCharts(); });
  }
}

function renderSessionState() {
  document.body.classList.toggle("no-session", !state.sessions.length);
  document.body.classList.toggle("has-session", Boolean(state.selectedSession?.points?.length));
}

async function openDemoSession() {
  elements.onboardDemoButton.disabled = true;
  elements.onboardStatus.textContent = t("account.working");
  try {
    const { default: demoUrl } = await import("./fixtures/viterbo-session-2026-07-10.csv?url");
    const response = await fetch(demoUrl);
    if (!response.ok) throw new Error(t("landing.demoError"));
    const points = parseRaceBoxCsv(await response.text());
    // Kept local on purpose: the example is never uploaded to the user's cloud library.
    const session = { id: "demo-viterbo", title: t("onboard.demoSession"), source: "demo", deviceName: "LapTrace", startedAt: points[0].time, endedAt: points.at(-1).time, points };
    state.sessions = [session, ...state.sessions.filter((item) => item.id !== session.id)];
    renderSessions();
    await selectSession(session.id);
    elements.onboardStatus.textContent = "";
  } catch (error) {
    elements.onboardStatus.textContent = error.message;
  } finally {
    elements.onboardDemoButton.disabled = false;
  }
}

// A short message that fades on its own; works for guests who see no account dialog.
let noticeTimer = 0;
function showNotice(message, error = false) {
  elements.appNotice.textContent = message;
  elements.appNotice.classList.toggle("error", error);
  elements.appNotice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { elements.appNotice.hidden = true; }, error ? 8000 : 6000);
}

function lapPoints(number) {
  // Cloud sessions have no points until loadLog finishes; charts may redraw meanwhile (resize, view switch).
  const points = state.selectedSession?.points;
  if (!points) return [];
  return number ? lapsOf(points).get(number) ?? [] : points;
}

// Track map colouring: plain laps, gain/loss against the comparison lap, or speed.
const MAP_MODES = ["laps", "delta", "speed"];
let analysisPanels = null;
let cornersPanel = null;
let lapReportPanel = null;
let extraLaps = null;
try { state.mapMode = MAP_MODES.includes(localStorage.getItem("d3-map-mode")) ? localStorage.getItem("d3-map-mode") : "laps"; } catch { state.mapMode = "laps"; }
// Satellite imagery is a native-app feature (desktop, Android, iOS); the website keeps the plain map.
try { state.mapSatellite = appMode && localStorage.getItem("d3-map-satellite") === "1"; } catch { state.mapSatellite = false; }
// Photo shifts per place ({ "lat,lon": [longitude°, Mercator°] }): GPS and photos can be a few metres apart.
try { state.satelliteOffsets = JSON.parse(localStorage.getItem("d3-satellite-offsets") || "{}") || {}; } catch { state.satelliteOffsets = {}; }
state.satelliteAlign = false;
function saveSatelliteOffsets() {
  try { localStorage.setItem("d3-satellite-offsets", JSON.stringify(state.satelliteOffsets)); } catch {}
}
function renderMapMode() {
  elements.mapMode.querySelectorAll("[data-map-mode]").forEach((button) => button.setAttribute("aria-checked", String(button.dataset.mapMode === state.mapMode)));
  elements.mapSatelliteButton.setAttribute("aria-pressed", String(state.mapSatellite));
  elements.mapSatelliteButton.title = t("map.satellite");
  if (!state.mapSatellite) state.satelliteAlign = false;
  const shifted = Boolean(state.satelliteView && state.satelliteOffsets[state.satelliteView.key]);
  elements.mapAlign.hidden = !state.mapSatellite;
  elements.mapAlignButton.textContent = t(state.satelliteAlign ? "map.alignDone" : "map.align");
  elements.mapAlignButton.setAttribute("aria-pressed", String(state.satelliteAlign));
  elements.mapAlignHint.hidden = !state.satelliteAlign;
  elements.mapAlignReset.hidden = !state.satelliteAlign || !shifted;
  elements.trackCanvas.classList.toggle("aligning", state.satelliteAlign);
}
function renderMapLegend(html) {
  if (elements.mapLegend.dataset.html === html) return;
  elements.mapLegend.dataset.html = html;
  elements.mapLegend.innerHTML = html;
  elements.mapLegend.hidden = !html;
  elements.trackCanvas.closest(".track-panel").querySelector(".trajectory-legend").hidden = Boolean(html);
}

const SECTOR_COLOR = "#b36bff";

function renderSectors() {
  const excluded = getExcludedLaps(state);
  const sectors = sectorsWithout(state.sectors, excluded);
  const available = Boolean(sectors);
  elements.sectorsPanel.classList.toggle("is-empty", !available);
  const ideal = available && Number.isFinite(sectors.idealMs);
  elements.idealLapValue.textContent = ideal ? formatLapTime(sectors.idealMs) : "—";
  elements.idealGainValue.textContent = ideal ? `−${(sectors.potentialMs / 1000).toFixed(3)}` : "—";
  if (!available) {
    elements.sectorTable.innerHTML = "";
    elements.sectorNote.textContent = t("sectors.empty");
    return;
  }
  const head = `<thead><tr><th scope="col">${t("sectors.lap")}</th>${sectors.best.map((_, index) => `<th scope="col">S${index + 1}</th>`).join("")}<th scope="col">${t("sectors.time")}</th></tr></thead>`;
  const rows = sectors.laps.map((lap) => {
    const left = excluded.has(lap.number);
    const classes = [lap.number === state.selectedLapNumber && "is-primary", (!state.comparisonRival && lap.number === state.comparisonLapNumber) && "is-compare", left && "excluded"].filter(Boolean).join(" ");
    const cells = sectors.best.map((best, index) => {
      const value = lap.sectors?.[index];
      if (!Number.isFinite(value)) return `<td class="empty"><b>—</b><small>&nbsp;</small></td>`;
      const isBest = best?.lap === lap.number;
      return `<td class="${isBest ? "best" : ""}"><b>${formatSectorTime(value)}</b><small>${isBest ? t("sectors.best") : best && !left ? formatGap(value - best.timeMs) : "&nbsp;"}</small></td>`;
    }).join("");
    const fastest = lap.number === (sectors.fastestLap ?? sectors.referenceLap);
    const lapGap = left || !Number.isFinite(sectors.bestLapMs) ? t("sectors.left") : formatGap(lap.durationMs - sectors.bestLapMs);
    return `<tr class="${classes}" data-sector-lap="${lap.number}" tabindex="0" aria-selected="${lap.number === state.selectedLapNumber}"><th scope="row">${lap.number}</th>${cells}<td class="lap-time${fastest ? " fastest" : ""}"><b>${formatLapTime(lap.durationMs)}</b><small>${fastest ? t("sectors.best") : lapGap}</small></td></tr>`;
  }).join("");
  const foot = ideal ? `<tfoot><tr><th scope="row">${t("sectors.idealRow")}</th>${sectors.best.map((best) => `<td class="best"><b>${formatSectorTime(best.timeMs)}</b><small>${t("sectors.fromLap", { lap: best.lap })}</small></td>`).join("")}<td class="lap-time ideal"><b>${formatLapTime(sectors.idealMs)}</b><small>−${(sectors.potentialMs / 1000).toFixed(3)}</small></td></tr></tfoot>` : "";
  elements.sectorTable.innerHTML = `${head}<tbody>${rows}</tbody>${foot}`;
  const partial = sectors.laps.some((lap) => !lap.sectors);
  const leftNote = excluded.size ? ` ${t("sectors.excludedNote", { laps: [...excluded].sort((a, b) => a - b).join(", ") })}` : "";
  elements.sectorNote.textContent = `${t("sectors.note", { lap: sectors.referenceLap })}${partial ? ` ${t("sectors.partial")}` : ""}${leftNote}`;
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
  elements.trackCanvas.classList.toggle("zoomed", scale > 1);
  drawTrack();
}

function resetTrackZoom() {
  state.trackView = { scale: 1, offsetX: 0, offsetY: 0 };
  elements.trackZoomReset.textContent = "100%";
  elements.trackCanvas.classList.remove("zoomed");
  drawTrack();
}

// Created on first use: everything it needs is defined by then.
function drawTrackCanvas(canvas) {
  drawTrackMap ??= createTrackMap({
    state, elements, t, isOverlayFrame, paintLayers, canvasContext, trackAiMarkerAreas,
    lapPoints, comparisonLapPoints, extraLapPoints, sectorFractions, renderMapLegend, SECTOR_COLOR,
    analysisPanels: () => analysisPanels, cornersPanel: () => cornersPanel, redraw: () => drawTrack(),
  });
  drawTrackMap(canvas);
}

function drawTrack() {
  drawTrackCanvas(elements.trackCanvas);
  drawTrackCanvas(elements.aiTrackCanvas);
}

function drawCharts() {
  drawComparisonChart(elements.telemetryCanvas, state.telemetryMetric, { speed: state.telemetryMetric === "speed" });
  drawDeltaChart();
  analysisPanels?.draw();
  cornersPanel?.draw();
  lapReportPanel?.draw();
}

let cursorFrame = 0;
function setCursorProgress(progress) {
  state.cursorProgress = progress;
  if (cursorFrame) return;
  cursorFrame = requestAnimationFrame(() => {
    cursorFrame = 0;
    overlayFrame(() => { drawTrack(); drawCharts(); });
  });
}

analysisPanels = createAnalysisPanels({
  state, elements, t, onLanguageChange,
  lapPoints, comparisonLapPoints, extraLapPoints, distancePoints, canvasContext, sectorFractions, paintLayers, isOverlayFrame,
  setCursorProgress, setChartZoom, setChartRange, resetChartZoom,
});
cornersPanel = createCornersPanel({
  state, elements, t, onLanguageChange, lapPoints, comparisonLapPoints, isOverlayFrame, formatLapTime,
  setCursorProgress, setChartRange,
});
lapReportPanel = createLapReportPanel({
  state, elements, t, onLanguageChange, lapPoints, isOverlayFrame, formatLapTime,
  selectLap: (number) => changePrimaryLap(number),
  onExclusionChange: () => { renderSectors(); drawCharts(); },
});
extraLaps = createExtraLaps({ state, elements, t, formatLapTime, onLanguageChange, onChange: () => { drawTrack(); drawCharts(); } });
renderMapMode();
elements.mapMode.addEventListener("click", (event) => {
  const button = event.target.closest("[data-map-mode]");
  if (!button) return;
  state.mapMode = button.dataset.mapMode;
  try { localStorage.setItem("d3-map-mode", state.mapMode); } catch {}
  renderMapMode();
  drawTrack();
});
elements.mapSatelliteButton.addEventListener("click", () => {
  state.mapSatellite = !state.mapSatellite;
  try { localStorage.setItem("d3-map-satellite", state.mapSatellite ? "1" : "0"); } catch {}
  renderMapMode();
  drawTrack();
});
elements.mapAlignButton.addEventListener("click", () => {
  state.satelliteAlign = !state.satelliteAlign;
  renderMapMode();
});
elements.mapAlignReset.addEventListener("click", () => {
  if (state.satelliteView) delete state.satelliteOffsets[state.satelliteView.key];
  saveSatelliteOffsets();
  renderMapMode();
  drawTrack();
});

{
  const canvas = elements.trackCanvas;
  const pointers = new Map();
  let gesture = null;
  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const rect = canvas.getBoundingClientRect();
    if (pointers.size === 1 && state.satelliteAlign && state.satelliteView) {
      // Align mode: one finger moves the photo under the trajectory, not the map.
      const { key } = state.satelliteView;
      gesture = { mode: "align", key, x: event.clientX, y: event.clientY, shift: state.satelliteOffsets[key] ?? [0, 0] };
    } else if (pointers.size === 1) {
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
    } else if (pointers.size === 1 && gesture?.mode === "align") {
      const perDegree = state.satelliteView.pixelsPerDegree || 1;
      state.satelliteOffsets[gesture.key] = [
        gesture.shift[0] + (event.clientX - gesture.x) / perDegree,
        gesture.shift[1] - (event.clientY - gesture.y) / perDegree,
      ];
      drawTrack();
    } else if (pointers.size === 1 && gesture?.mode === "pan" && state.trackView.scale > 1) {
      state.trackView.offsetX = gesture.offsetX + event.clientX - gesture.x;
      state.trackView.offsetY = gesture.offsetY + event.clientY - gesture.y;
      drawTrack();
    }
  });
  const release = (event) => {
    if (gesture?.mode === "align") { saveSatelliteOffsets(); renderMapMode(); }
    pointers.delete(event.pointerId); gesture = null;
  };
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

function sessionLabel(session) {
  return `${session.title || t("sessions.item", { id: session.displayId ?? session.id })} · ${formatDate(session.startedAt)}${session.source === "cloud" && !compactLayout.matches ? " ☁" : ""}`;
}

// Session picker at the top of the analysis screen: select plus newer/older steppers.
function renderSessionBar() {
  const sessions = state.sessions;
  const index = sessions.indexOf(state.selectedSession);
  elements.sessionSelect.innerHTML = sessions.map((session) => `<option value="${escapeHtml(session.id)}">${escapeHtml(sessionLabel(session))}</option>`).join("");
  elements.sessionSelect.value = index >= 0 ? String(sessions[index].id) : "";
  elements.sessionSelect.disabled = sessions.length < 2;
  elements.sessionNewerButton.disabled = index <= 0;
  elements.sessionOlderButton.disabled = index < 0 || index >= sessions.length - 1;
  elements.sessionNewerButton.title = elements.sessionNewerButton.ariaLabel = t("session.newer");
  elements.sessionOlderButton.title = elements.sessionOlderButton.ariaLabel = t("session.older");
  const current = sessions[index];
  elements.sessionShareButton.hidden = !(state.user && current?.source === "cloud" && current.cloudId);
  elements.sessionBarMeta.textContent = current
    ? `${formatDuration(new Date(current.endedAt) - new Date(current.startedAt))} · ${t("sessions.points", { count: (current.points?.length ?? current.pointCount ?? 0).toLocaleString(getLanguage()) })}`
    : "";
}

async function chooseSession(id) {
  if (!id || String(state.selectedSession?.id) === String(id)) return;
  elements.sessionBar.classList.add("loading");
  const ok = await selectSession(id);
  elements.sessionBar.classList.remove("loading");
  if (!ok) renderSessionBar();
}

function renderSessions() {
  renderSessionState();
  renderSessionBar();
  elements.sessionsValue.textContent = String(state.sessions.length);
  const totalPoints = state.sessions.reduce((sum, session) => sum + (session.points?.length ?? session.pointCount ?? 0), 0);
  elements.sessionsMeta.textContent = t("progress.records", { received: totalPoints.toLocaleString(getLanguage()), expected: totalPoints.toLocaleString(getLanguage()) });
  elements.logsPageCount.textContent = String(state.sessions.length);
  elements.logsPagePoints.textContent = t("sessions.points", { count: totalPoints.toLocaleString(getLanguage()) });
  renderAiPageContext();
  if (!state.sessions.length) {
    elements.sessionList.innerHTML = `<p class="empty">${t("sessions.empty")}</p>`;
    return;
  }
  elements.sessionList.innerHTML = state.sessions.map((session) => `
    <div class="session-item ${session === state.selectedSession ? "selected" : ""}">
      <button class="session-open" data-session="${escapeHtml(session.id)}">
        <strong>${escapeHtml(session.title || t("sessions.item", { id: session.displayId ?? session.id }))}${session.source === "cloud" ? " ☁" : ""}</strong><span>${formatDate(session.startedAt)}</span><small>${formatDuration(new Date(session.endedAt) - new Date(session.startedAt))} · ${t("sessions.points", { count: (session.points?.length ?? session.pointCount ?? 0).toLocaleString(getLanguage()) })}</small>
      </button>
      ${session.source === "local" ? `<div class="session-actions"><button data-local-rename="${escapeHtml(session.id)}" title="${escapeHtml(t("sessions.rename"))}">✎</button><button data-local-delete="${escapeHtml(session.id)}" title="${escapeHtml(t("sessions.delete"))}">×</button></div>` : ""}
      ${session.source === "cloud" ? `<div class="session-actions"><button data-share="${escapeHtml(session.cloudId)}" title="${escapeHtml(t("share.button"))}">⇪</button><button data-rename="${escapeHtml(session.cloudId)}" title="${escapeHtml(t("sessions.rename"))}">✎</button><button data-delete="${escapeHtml(session.cloudId)}" title="${escapeHtml(t("sessions.delete"))}">×</button></div>` : ""}
    </div>`).join("");
  elements.sessionList.querySelectorAll("[data-session]").forEach((button) => button.addEventListener("click", async () => {
    if (await selectSession(button.dataset.session)) showView("analysis");
  }));
  elements.sessionList.querySelectorAll("[data-share]").forEach((button) => button.addEventListener("click", () => {
    const target = state.sessions.find((item) => item.cloudId === button.dataset.share);
    if (target) openShareDialog(target, state.user?.displayName || state.user?.email);
  }));
  elements.sessionList.querySelectorAll("[data-rename]").forEach((button) => button.addEventListener("click", () => renameCloudSession(button.dataset.rename)));
  elements.sessionList.querySelectorAll("[data-delete]").forEach((button) => button.addEventListener("click", () => deleteCloudSession(button.dataset.delete)));
  elements.sessionList.querySelectorAll("[data-local-rename]").forEach((button) => button.addEventListener("click", () => renameLocalSession(button.dataset.localRename)));
  elements.sessionList.querySelectorAll("[data-local-delete]").forEach((button) => button.addEventListener("click", () => deleteLocalSessionById(button.dataset.localDelete)));
}

async function renameCloudSession(cloudId) {
  const session = state.sessions.find((item) => item.cloudId === cloudId);
  if (!session) return;
  const title = await askDialog({ title: t("sessions.renameTitle"), confirmLabel: t("dialog.save"), input: { label: t("sessions.renamePrompt"), value: session.title || "" } });
  if (!title?.trim()) return;
  try { await renameLog(cloudId, title.trim()); session.title = title.trim(); renderSessions(); }
  catch (error) { setAccountMessage(error.message, true); }
}

async function deleteCloudSession(cloudId) {
  const session = state.sessions.find((item) => item.cloudId === cloudId);
  if (!session) return;
  const confirmed = await askDialog({ title: t("sessions.deleteTitle"), message: t("sessions.deleteConfirm", { title: session.title || t("sessions.item", { id: session.displayId ?? session.id }) }), confirmLabel: t("dialog.delete"), danger: true });
  if (!confirmed) return;
  try {
    await deleteLog(cloudId);
    const wasSelected = session === state.selectedSession;
    state.sessions = state.sessions.filter((item) => item !== session);
    state.cloudLogs = state.cloudLogs.filter((item) => item.cloudId !== cloudId);
    if (wasSelected) {
      state.selectedSession = null; state.analysis = null; state.sectors = null;
      const replacement = state.sessions[0];
      if (replacement) selectSession(replacement.id);
      else {
        elements.durationValue.textContent = "—"; elements.durationMeta.textContent = t("summary.selected");
        elements.maxSpeedValue.textContent = "—"; elements.sampleRateValue.textContent = "—";
        elements.trackTitle.textContent = t("track.empty"); elements.analyzeAiButton.disabled = true;
        elements.insightsList.innerHTML = `<li>${t("insights.empty")}</li>`;
        drawTrack(); drawCharts();
      }
    }
    renderAccount(); renderSessions();
  } catch (error) { setAccountMessage(error.message, true); }
}

function renderLapControls() {
  const laps = state.analysis?.laps ?? [];
  const optionKey = compactLayout.matches ? "laps.optionShort" : "laps.option";
  const options = laps.map((lap) => `<option value="${lap.number}">${t(optionKey, { lap: lap.number, time: formatLapTime(lap.durationMs) })}</option>`).join("");
  elements.primaryLapSelect.innerHTML = options;
  elements.comparisonLapSelect.innerHTML = comparisonOptionsHtml(optionKey, options);
  elements.primaryLapSelect.disabled = !laps.length;
  elements.comparisonLapSelect.disabled = !comparisonAvailable();
  elements.primaryLapSelect.value = state.selectedLapNumber ? String(state.selectedLapNumber) : "";
  elements.comparisonLapSelect.value = comparisonSelectValue();
  elements.primaryLapLegend.textContent = state.selectedLapNumber ? t("laps.legend", { lap: state.selectedLapNumber }) : "—";
  elements.comparisonLapLegend.textContent = comparisonLabel();
  renderComparisonSource();
  extraLaps?.render();
}

function updateLapView() {
  if (!state.analysis || !state.selectedSession) return;
  const lap = state.analysis.laps.find((item) => item.number === state.selectedLapNumber);
  elements.durationValue.textContent = lap ? formatLapTime(lap.durationMs) : formatDuration(state.analysis.session.durationMs);
  elements.durationMeta.textContent = lap ? t("laps.legend", { lap: lap.number }) : formatDate(state.selectedSession.startedAt);
  elements.maxSpeedValue.textContent = toSpeed(lap?.maxSpeed ?? state.analysis.session.maxSpeed).toFixed(1);
  elements.sampleRateValue.textContent = state.analysis.sampleRateHz.toFixed(0);
  const comparisonLap = (state.comparisonRival ? state.comparisonSource?.analysis.laps : state.analysis.laps)?.find((item) => item.number === state.comparisonLapNumber);
  const gapMs = lap && comparisonLap ? lap.durationMs - comparisonLap.durationMs : null;
  elements.trackStatTime.textContent = lap ? formatLapTime(lap.durationMs) : "—";
  elements.trackStatGap.textContent = gapMs === null ? "Δ —" : `Δ ${formatGap(gapMs)} ${t("unit.seconds")}`;
  elements.trackStatGap.classList.toggle("ahead", gapMs !== null && gapMs < 0);
  elements.trackStatGap.classList.toggle("behind", gapMs !== null && gapMs > 0);
  elements.trackStatSpeed.textContent = `${toSpeed(lap?.maxSpeed ?? state.analysis.session.maxSpeed).toFixed(1)} ${t("unit.speed")}`;
  elements.trackTitle.textContent = `${state.track ? `${state.track.name} · ` : ""}${state.selectedSession.title || t("sessions.item", { id: state.selectedSession.displayId ?? state.selectedSession.id })}${lap ? ` · ${t("laps.legend", { lap: lap.number })}` : ""}`;
  renderLapControls(); renderSectors(); renderAiPageContext(); drawTrack(); drawCharts();
}

async function selectSession(id) {
  const isNewSession = String(state.selectedSession?.id) !== String(id);
  if (isNewSession) {
    resetChartZoom(); resetTrackZoom(); clearAiReport();
    state.aiHistory = []; state.aiHistoryLoading = false; state.aiHistoryError = "";
  }
  const session = state.sessions.find((item) => String(item.id) === String(id));
  state.selectedSession = session;
  if (session?.source === "local" && !session.points) {
    session.points = await loadLocalPoints(session.id).catch(() => []);
    if (state.selectedSession !== session) return false;
  }
  if (session?.source === "cloud" && !session.points) {
    try {
      const record = await loadLog(session.cloudId);
      session.points = record?.points ?? [];
      session.pointCount = session.points.length;
      if (appMode && session.points.length) {
        const meta = ownedSession(makeLocalSession(session.points, { title: session.title, deviceName: session.deviceName }));
        void saveLocalSession({ ...meta, owner: state.user?.id ?? null, cloudId: session.cloudId }, session.points).catch(() => {});
      }
      if (state.selectedSession !== session) return false;
    } catch (error) {
      setAccountMessage(error.message, true);
      return false;
    }
  }
  if (!state.selectedSession?.points?.length) return false;
  const trackCatalog = await loadTrackCatalog().catch(() => undefined);
  if (!state.selectedSession?.points?.length) return false;
  state.track = identifyTrack(state.selectedSession.points, trackCatalog);
  rememberTrack(state.selectedSession, state.track);
  renderSessionState();
  state.selectedSession.points = splitSessionIntoLaps(state.selectedSession.points, state.track);
  state.analysis = analyzeSession(state.selectedSession.points);
  state.sectors = computeSectors(state.selectedSession.points, state.analysis);
  if (isNewSession || !state.analysis.laps.some((lap) => lap.number === state.selectedLapNumber)) {
    const ordered = [...state.analysis.laps].sort((a, b) => a.durationMs - b.durationMs);
    state.selectedLapNumber = ordered[0]?.number ?? null;
    state.comparisonLapNumber = ordered[1]?.number ?? null;
    state.comparisonRival = false; state.comparisonSource = null;
    extraLaps?.reset();
    // A pilot who shared a session on the same track is the natural thing to compare with.
    if (rivalComparable()) useRivalComparison();
  }
  elements.sourceLabel.textContent = t("footer.deviceMemory", { name: state.deviceName });
  const localSession = state.selectedSession.source === "local";
  elements.analyzeAiButton.disabled = !(state.selectedSession.cloudId || localSession) || !state.analysis.laps.length;
  elements.copyStatus.textContent = localSession && !state.selectedSession.cloudId ? t(state.user ? "app.aiUpload" : "app.aiSignIn")
    : state.selectedSession.cloudId ? t("ai.ready") : t(state.selectedSession.source === "demo" ? "onboard.demoAi" : state.selectedSession.source === "trial" ? "trial.aiLocked" : state.selectedSession.source === "shared" ? "share.aiLocked" : "ai.cloudRequired");
  elements.insightsList.innerHTML = generateLocalInsights(state.analysis, t).map((insight) => `<li>${insight}</li>`).join("");
  renderSessions(); updateLapView(); renderTrialBanner();
  void refreshAiHistory();
  return true;
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
  setShopUser(user);
  setProfileUser(user);
  setStatsUser(user);
  if (!user) {
    if (state.trial || state.sessions.some((session) => session.source === "trial")) endTrial();
    if (!testMode && state.client) await state.client.disconnect();
    state.cloudLogs = [];
    state.aiHistory = []; state.aiHistoryLoading = false; state.aiHistoryError = "";
    state.sessions = state.sessions.filter((session) => session.source !== "cloud" && session.source !== "local");
    if (state.selectedSession?.source === "cloud" || state.selectedSession?.source === "local") state.selectedSession = null;
    showView(viewFromHash() === "shop" ? "shop" : "analysis", false); renderAccount(); renderSessions(); renderAiHistory();
    return;
  }
  renderAccount();
  if (appMode) {
    state.sessions = state.sessions.filter((session) => session.source !== "local" || session.owner === user.id);
    await loadLocalSessions();
    if (user.offline) { showView(viewFromHash(), false); return; }
    void syncLocalToCloud();
  }
  await saveTrialLogs();
  await syncCloudLogs();
  showView(viewFromHash(), false);
  if (pendingFriendInvite()) void handleFriendLink();
}

// Links from emails arrive as #reset=<token> or #verify=<token>.
// Open "#shared=<token>": load the pilot's session, then compare with the user's own session or show it alone.
async function handleSharedLink() {
  const match = location.hash.match(/^#shared=([A-Za-z0-9_-]{32,64})$/);
  if (!match) return;
  history.replaceState(null, "", location.pathname + location.search + "#analysis");
  try {
    const { shared } = await loadSharedSession(match[1]);
    if (!shared?.points?.length) throw new Error(t("share.invalid"));
    const trackCatalog = await loadTrackCatalog().catch(() => undefined);
    const track = identifyTrack(shared.points, trackCatalog);
    const lapped = splitSessionIntoLaps(shared.points, track);
    const analysis = analyzeSession(lapped);
    const name = shared.pilotName || "Pilot";
    state.rival = { token: match[1], name, track, points: lapped, analysis, startedAt: shared.startedAt };
    const session = { id: `shared-${match[1].slice(0, 10)}`, title: t("share.sessionTitle", { name }), source: "shared", deviceName: "LapTrace", startedAt: shared.startedAt, endedAt: shared.endedAt, points: lapped };
    state.sessions = [...state.sessions.filter((item) => item.source !== "shared"), session];
    // Own sessions first, the pilot's session last.
    updateAccess();
    renderSessions();
    const own = state.selectedSession && state.selectedSession.source !== "shared" ? state.selectedSession : null;
    if (own && rivalComparable()) {
      useRivalComparison();
      clearAiReport(); updateLapView();
      showNotice(t("share.added", { name }));
    } else {
      await selectSession(session.id);
      showNotice(t(own ? "share.otherTrack" : "share.openedAlone", { name }), Boolean(own));
    }
    showView("analysis", false);
    window.scrollTo(0, 0);
  } catch (error) {
    showNotice(/no longer|invalid|not found/i.test(error.message) ? t("share.invalid") : t("share.loadFailed"), true);
  }
}

// Apps: every downloaded or imported session is kept on the device (IndexedDB).
const ownedSession = (meta) => ({ ...meta, id: `${state.user?.id ?? "guest"}:${meta.id}` });
async function storeLocally(points, options) {
  // One library per pilot on a shared device: the owner is part of the id.
  const meta = ownedSession(makeLocalSession(points, options));
  const existing = state.sessions.find((item) => item.id === meta.id);
  const session = { ...meta, owner: state.user?.id ?? null, title: existing?.title || meta.title, cloudId: existing?.cloudId ?? options.cloudId, points };
  await saveLocalSession(session, points);
  state.sessions = mergeSessions(state.sessions.filter((item) => item.id !== session.id), [session]);
  return state.sessions.find((item) => item.id === session.id);
}

// Automatic sync: sessions recorded or imported on this device are uploaded as soon as there is a network.
let syncing = null;
function syncLocalToCloud() {
  if (!appMode || !state.user || !navigator.onLine) return Promise.resolve();
  if (syncing) return syncing;
  syncing = (async () => {
    await Promise.resolve(); // the flag must be set before the body (and its finally) runs
    try {
      for (const session of state.sessions.filter((item) => item.source === "local" && !item.cloudId && item.owner === state.user?.id)) {
        const points = session.points ?? await loadLocalPoints(session.id);
        if (!points.length || !state.user) continue;
        session.cloudId = await saveLog({ ...session, points }, session.deviceName);
        if (session.title) await renameLog(session.cloudId, session.title).catch(() => {});
        await updateLocalSession(session.id, { cloudId: session.cloudId });
      }
      renderSessions();
      if (state.selectedSession?.source === "local" && state.selectedSession.cloudId) {
        elements.analyzeAiButton.disabled = !state.analysis?.laps.length;
        elements.copyStatus.textContent = t("ai.ready");
      }
    } catch (error) { console.warn("Sync paused:", error.message); }
    finally { syncing = null; }
  })();
  return syncing;
}
window.addEventListener("online", () => { if (state.user?.offline) void currentUser().then(applyUser); else void syncLocalToCloud(); });

async function loadLocalSessions() {
  try {
    const stored = await listLocalSessions(state.user?.id ?? null);
    if (!stored.length) return;
    const known = new Set(state.sessions.map((item) => item.id));
    state.sessions = mergeSessions(state.sessions, stored.filter((item) => !known.has(item.id)));
    renderSessions();
    if (!state.selectedSession && state.sessions.length) await selectSession(state.sessions[0].id);
  } catch (error) { showNotice(error.message, true); }
}

async function renameLocalSession(id) {
  const session = state.sessions.find((item) => item.id === id);
  if (!session) return;
  const title = await askDialog({ title: t("sessions.renameTitle"), confirmLabel: t("dialog.save"), input: { label: t("sessions.renamePrompt"), value: session.title || "" } });
  if (!title?.trim()) return;
  session.title = title.trim().slice(0, 100);
  await updateLocalSession(id, { title: session.title });
  if (session.cloudId && state.user) await renameLog(session.cloudId, session.title).catch(() => {});
  renderSessions();
}

async function deleteLocalSessionById(id) {
  const session = state.sessions.find((item) => item.id === id);
  if (!session) return;
  const confirmed = await askDialog({ title: t("sessions.deleteTitle"), message: t("sessions.deleteLocalConfirm", { title: session.title || formatDate(session.startedAt) }), confirmLabel: t("dialog.delete"), danger: true });
  if (!confirmed) return;
  await deleteLocalSession(id);
  const wasSelected = session === state.selectedSession;
  state.sessions = state.sessions.filter((item) => item !== session);
  if (wasSelected) {
    state.selectedSession = null; state.analysis = null; state.sectors = null;
    if (state.sessions[0]) await selectSession(state.sessions[0].id);
    else { drawTrack(); drawCharts(); }
  }
  renderSessions();
}

async function saveDownloadedLogs(sessions) {
  if (!state.user) return;
  try {
    const ids = await Promise.all(sessions.map((session) => saveLog(session, state.deviceName)));
    sessions.forEach((session, index) => { session.cloudId = ids[index]; });
    if (sessions.includes(state.selectedSession)) {
      elements.analyzeAiButton.disabled = !state.analysis?.laps.length;
      elements.copyStatus.textContent = t("ai.ready");
    }
    await syncCloudLogs();
    setAccountMessage(t("account.saved"));
  } catch (error) { setAccountMessage(error.message, true); }
}

async function importLogFile(file) {
  if (file && appMode) {
    try {
      const points = parseRaceBoxCsv(await file.text());
      const session = await storeLocally(points, { title: file.name.replace(/\.csv$/i, "") });
      renderSessions(); await selectSession(session.id);
      void syncLocalToCloud();
      showNotice(t("logsPage.importedLocal"));
    } catch (error) { showNotice(error.message, true); }
    finally { elements.importLogInput.value = ""; }
    return;
  }
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

elements.onboardImportButton.addEventListener("click", () => {
  if (accountRequired()) { openAccountDialog("signin"); return; }
  elements.importLogInput.click();
});
elements.onboardDemoButton.addEventListener("click", openDemoSession);
// App shell navigation: the rail on wide screens, the tab bar on phones.
const railActions = {
  device: () => showView("device"),
  analysis: () => showView("analysis"),
  logs: () => elements.logsNavButton.click(),
  ai: () => elements.aiNavButton.click(),
  profile: () => elements.accountButton.click(),
};
elements.appRail.addEventListener("click", (event) => {
  const button = event.target.closest("[data-app-view]");
  if (button) railActions[button.dataset.appView]?.();
});
elements.appSignInButton.addEventListener("click", () => openAccountDialog("signin"));
elements.appRegisterButton.addEventListener("click", () => openAccountDialog("register"));
elements.appTrialButton.addEventListener("click", () => elements.trialInput.click());
onLanguageChange(renderAppChrome);
// Desktop app: the analysis panels form an editable workspace (columns, resizable borders, Layout mode).
initWorkspace({
  dashboard: elements.dashboard,
  actions: elements.topbar.querySelector(".header-actions"),
  enabled: () => appMode,
  redraw: () => { drawTrack(); drawCharts(); },
  t,
  onLanguageChange,
});
onLanguageChange(renderBluetoothSupport);
renderBluetoothSupport();
renderSessionState();
elements.analysisNavButton.addEventListener("click", () => showView("analysis"));
elements.logsNavButton.addEventListener("click", () => accountRequired() ? openAccountDialog("signin") : showView("logs"));
elements.aiNavButton.addEventListener("click", () => accountRequired() ? openAccountDialog("signin") : showView("ai"));
elements.logsBackButton.addEventListener("click", () => showView("analysis"));
elements.aiBackButton.addEventListener("click", () => showView("analysis"));
elements.importLogButton.addEventListener("click", () => elements.importLogInput.click());
elements.importLogInput.addEventListener("change", () => importLogFile(elements.importLogInput.files?.[0]));
elements.sessionShareButton.addEventListener("click", () => { if (state.selectedSession?.cloudId) openShareDialog(state.selectedSession, state.user?.displayName || state.user?.email); });
initShare();
onLanguageChange(() => { renderTrialBanner(); if (state.rival && state.selectedSession?.source === "shared") { state.selectedSession.title = t("share.sessionTitle", { name: state.rival.name }); } });
elements.trialExitButton.addEventListener("click", () => { endTrial(); history.replaceState(null, "", "/"); routedUrl = location.href; showView("analysis", false); syncGuestPage(); window.scrollTo(0, 0); });
window.addEventListener("hashchange", handleAuthLink);
window.addEventListener("hashchange", handleSharedLink);
window.addEventListener("hashchange", handleFriendLink);
document.querySelectorAll("input:not([type='range']):not([type='file']), textarea").forEach((field) => {
  field.addEventListener("focus", () => {
    if (!globalThis.Capacitor?.isNativePlatform?.()) return;
    setTimeout(() => field.scrollIntoView({ block: "center", behavior: "smooth" }), 250);
  });
});
elements.aiReportJumpButton.addEventListener("click", () => showView("ai"));
elements.aiReportJumpButton.setAttribute("aria-label", t("ai.reportButton"));
onLanguageChange(() => elements.aiReportJumpButton.setAttribute("aria-label", t("ai.reportButton")));
onLanguageChange(renderMapMode);

const analysisTabButtons = [...elements.analysisTabs.querySelectorAll("[data-analysis-tab]")];
function selectAnalysisTab(tab, focus = false) {
  elements.dashboard.dataset.tab = tab;
  analysisTabButtons.forEach((button) => {
    const active = button.dataset.analysisTab === tab;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    if (active && focus) button.focus();
  });
  // Keep the sticky lap bar in place: if the page was scrolled past the dashboard, return to its top.
  const top = elements.dashboard.getBoundingClientRect().top + window.scrollY - elements.topbar.getBoundingClientRect().height;
  if (window.scrollY > top) window.scrollTo({ top });
  requestAnimationFrame(() => { drawTrack(); drawCharts(); });
}
analysisTabButtons.forEach((button) => button.addEventListener("click", () => selectAnalysisTab(button.dataset.analysisTab)));
elements.analysisTabs.addEventListener("keydown", (event) => {
  const index = analysisTabButtons.findIndex((button) => button.dataset.analysisTab === elements.dashboard.dataset.tab);
  const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: analysisTabButtons.length - 1 }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  selectAnalysisTab(analysisTabButtons[(next + analysisTabButtons.length) % analysisTabButtons.length].dataset.analysisTab, true);
});
analysisTabButtons.forEach((button) => { button.tabIndex = button.getAttribute("aria-selected") === "true" ? 0 : -1; });
compactLayout.addEventListener("change", () => { renderLapControls(); renderSessionBar(); requestAnimationFrame(() => { drawTrack(); drawCharts(); }); });

elements.deviceSummaryButton.addEventListener("click", () => {
  const open = !elements.devicePanel.classList.contains("device-open");
  elements.devicePanel.classList.toggle("device-open", open);
  elements.deviceSummaryButton.setAttribute("aria-expanded", String(open));
});
elements.sessionSelect.addEventListener("change", () => chooseSession(elements.sessionSelect.value));
const stepSession = (offset) => {
  const next = state.sessions[state.sessions.indexOf(state.selectedSession) + offset];
  if (next) void chooseSession(next.id);
};
elements.sessionNewerButton.addEventListener("click", () => stepSession(-1));
elements.sessionOlderButton.addEventListener("click", () => stepSession(1));
elements.aiSessionSelect.addEventListener("change", async () => {
  if (elements.aiSessionSelect.value) await selectSession(elements.aiSessionSelect.value);
});
function changePrimaryLap(value) {
  const previous = state.selectedLapNumber;
  state.selectedLapNumber = Number(value) || null;
  // Picking the comparison lap as primary swaps the two instead of dropping the comparison.
  if (!state.comparisonRival && state.comparisonLapNumber === state.selectedLapNumber) state.comparisonLapNumber = previous !== state.selectedLapNumber ? previous : null;
  clearAiReport();
  updateLapView();
}
function changeComparisonLap(value) {
  const text = String(value);
  if (text.startsWith("r:")) state.comparisonSource = pilotSource();
  else if (!text.startsWith("x:")) state.comparisonSource = null;
  state.comparisonLapNumber = Number(text.replace(/^[rx]:/, "")) || null;
  state.comparisonRival = Boolean(state.comparisonSource && state.comparisonLapNumber && /^[rx]:/.test(text));
  if (!state.comparisonRival) state.comparisonSource = null;
  if (!state.comparisonRival && state.comparisonLapNumber === state.selectedLapNumber) state.comparisonLapNumber = null;
  clearAiReport();
  updateLapView();
}
elements.primaryLapSelect.addEventListener("change", () => changePrimaryLap(elements.primaryLapSelect.value));
document.addEventListener("keydown", (event) => {
  if (event.code !== "BracketLeft" && event.code !== "BracketRight") return;
  if (event.ctrlKey || event.metaKey || event.altKey || !state.analysis?.laps.length) return;
  if (event.target.closest?.("input, select, textarea, [contenteditable]") || !document.body.classList.contains("has-session")) return;
  const step = event.code === "BracketRight" ? 1 : -1;
  const next = (laps, current) => {
    const index = laps.findIndex((lap) => lap.number === current);
    return laps[Math.max(0, Math.min(laps.length - 1, (index < 0 ? 0 : index + step)))]?.number ?? null;
  };
  event.preventDefault();
  if (event.shiftKey) {
    const source = state.comparisonRival ? state.comparisonSource : null;
    const laps = (source ? source.analysis.laps : state.analysis.laps).filter((lap) => source || lap.number !== state.selectedLapNumber);
    const number = next(laps, state.comparisonLapNumber);
    if (number && number !== state.comparisonLapNumber) changeComparisonLap(source ? `x:${number}` : String(number));
  } else {
    const number = next(state.analysis.laps, state.selectedLapNumber);
    if (number && number !== state.selectedLapNumber) changePrimaryLap(number);
  }
});
elements.sectorTable.addEventListener("click", (event) => {
  const row = event.target.closest("[data-sector-lap]");
  if (row && Number(row.dataset.sectorLap) !== state.selectedLapNumber) changePrimaryLap(row.dataset.sectorLap);
});
elements.sectorTable.addEventListener("keydown", (event) => {
  const row = event.target.closest("[data-sector-lap]");
  if (!row || (event.key !== "Enter" && event.key !== " ")) return;
  event.preventDefault();
  if (Number(row.dataset.sectorLap) !== state.selectedLapNumber) changePrimaryLap(row.dataset.sectorLap);
  elements.sectorTable.querySelector(`[data-sector-lap="${row.dataset.sectorLap}"]`)?.focus();
});
elements.comparisonLapSelect.addEventListener("change", () => changeComparisonLap(elements.comparisonLapSelect.value));
elements.comparisonSourceSelect.addEventListener("change", () => changeComparisonSource(elements.comparisonSourceSelect.value));
elements.aiPrimaryLapSelect.addEventListener("change", () => changePrimaryLap(elements.aiPrimaryLapSelect.value));
elements.aiComparisonLapSelect.addEventListener("change", () => changeComparisonLap(elements.aiComparisonLapSelect.value));
elements.telemetryMetricSelect.addEventListener("change", () => selectTelemetryMetric(elements.telemetryMetricSelect.value));
document.querySelectorAll("[data-metric]").forEach((button) => button.addEventListener("click", () => selectTelemetryMetric(button.dataset.metric)));
window.addEventListener("resize", () => { drawTrack(); drawCharts(); drawAiCardVisuals(); });
// Hash links, back/forward and in-app navigation all end up here; the last URL guards against double runs.
function applyRoute() {
  if (upgradeLegacyHash() || location.href !== routedUrl) {
    routedUrl = location.href;
    const view = viewFromHash();
    const needsLogin = view === "logs" || view === "ai" ? accountRequired() : view === "profile" && !state.user;
    showView(needsLogin ? "analysis" : view, false);
    syncGuestPage();
  }
}
window.addEventListener("hashchange", applyRoute);
window.addEventListener("popstate", applyRoute);
window.addEventListener("routechange", applyRoute);
// Language dropdown: rows slide out one after another; arrow keys, Home/End and Escape work like a menu.
const languageOptions = [...elements.langMenuList.querySelectorAll("[data-lang]")];
const unitOptions = [...elements.langMenuList.querySelectorAll("[data-speed-unit]")];
const menuOptions = [...languageOptions, ...unitOptions];
function setLanguageMenu(open, focusCurrent = false) {
  elements.langMenu.classList.toggle("open", open);
  elements.langMenuToggle.setAttribute("aria-expanded", String(open));
  if (open && focusCurrent) (languageOptions.find((button) => button.dataset.lang === getLanguage()) ?? languageOptions[0]).focus({ preventScroll: true });
}
const syncLanguageButtons = () => {
  const current = getLanguage();
  elements.langMenuCurrent.textContent = current.toUpperCase();
  languageOptions.forEach((button) => button.setAttribute("aria-checked", String(button.dataset.lang === current)));
  unitOptions.forEach((button) => button.setAttribute("aria-checked", String(button.dataset.speedUnit === speedUnit())));
};
unitOptions.forEach((button) => button.addEventListener("click", () => {
  setLanguageMenu(false);
  elements.langMenuToggle.focus({ preventScroll: true });
  setSpeedUnit(button.dataset.speedUnit);
}));
elements.langMenuToggle.addEventListener("click", (event) => setLanguageMenu(!elements.langMenu.classList.contains("open"), event.detail === 0));
elements.langMenuToggle.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  setLanguageMenu(true, true);
});
languageOptions.forEach((button) => button.addEventListener("click", () => {
  setLanguageMenu(false);
  elements.langMenuToggle.focus({ preventScroll: true });
  if (button.dataset.lang !== getLanguage()) setLanguage(button.dataset.lang);
}));
elements.langMenuList.addEventListener("keydown", (event) => {
  const index = menuOptions.indexOf(document.activeElement);
  const move = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: menuOptions.length - 1 }[event.key];
  if (move !== undefined) {
    event.preventDefault();
    menuOptions[(move + menuOptions.length) % menuOptions.length].focus();
  } else if (event.key === "Escape") {
    event.preventDefault();
    setLanguageMenu(false);
    elements.langMenuToggle.focus();
  } else if (event.key === "Tab") setLanguageMenu(false);
});
document.addEventListener("pointerdown", (event) => { if (!elements.langMenu.contains(event.target)) setLanguageMenu(false); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && elements.langMenu.classList.contains("open")) setLanguageMenu(false); });
onLanguageChange(syncLanguageButtons);
syncLanguageButtons();
elements.subbarBetaButton.addEventListener("click", () => openAccountDialog("register"));
elements.featuresAccountButton.addEventListener("click", () => openAccountDialog("register"));
const landingNavLinks = document.querySelectorAll(".landing-nav a, .subbar-nav a");
let shownGuestPage;
function syncGuestPage() {
  const page = currentPage();
  const previous = shownGuestPage;
  shownGuestPage = page;
  document.body.classList.toggle("guest-features", page === "features");
  document.body.classList.toggle("guest-contact", page === "contact");
  landingNavLinks.forEach((link) => link.classList.toggle("active", link.getAttribute("href") === (page ? PAGE_PATHS[page] : "/")));
  if (page !== previous && previous !== undefined && !location.hash) window.scrollTo(0, 0);
  if (location.hash && page !== previous && previous !== undefined) requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView());
  renderDocumentMeta();
}
upgradeLegacyHash();
interceptLinks();
syncGuestPage();

// Contact page: localized mail subjects and copy-to-clipboard.
function renderContactLinks() {
  document.querySelectorAll(".ct-topic[data-topic]").forEach((link, index) => {
    link.href = `mailto:office@d3cf.com?subject=${encodeURIComponent(t(`c.t${index + 1}subject`))}`;
  });
}
function renderDocumentMeta() {
  const page = currentPage();
  const prefix = page === "features" ? "meta.features" : page === "contact" ? "meta.contact" : page === "shop" ? "meta.shop" : "meta.";
  document.title = t(page ? `${prefix}Title` : "meta.title");
  document.querySelector('meta[name="description"]')?.setAttribute("content", t(page ? `${prefix}Description` : "meta.description"));
}
elements.contactCopyButton?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(elements.contactCopyButton.dataset.copy);
    elements.contactCopyStatus.textContent = t("c.copied");
  } catch {
    elements.contactCopyStatus.textContent = t("c.copyFailed");
  }
});
onLanguageChange(() => { renderContactLinks(); renderDocumentMeta(); elements.contactCopyStatus.textContent = ""; });
renderContactLinks();
renderDocumentMeta();
onLanguageChange(async (language) => {
  const refreshGeneratedReport = Boolean(state.aiReport && state.aiReportLanguage !== language);
  if (state.aiReport) renderAiReport(state.aiReport, state.aiAnalysisId, state.aiReportLanguage);
  renderAccount();
  if (state.storage) renderStorage(state.storage);
  if (state.latestTelemetry) renderTelemetry(state.latestTelemetry);
  selectTelemetryMetric(state.telemetryMetric);
  if (state.sessions.length) renderSessions();
  else renderAiPageContext();
  renderAiHistory();
  if (state.selectedSession) await selectSession(state.selectedSession.id);
  else { drawTrack(); drawCharts(); }
  if (state.connected) {
    setStatus(t(state.storage?.recording ? "state.recording" : "state.ready", { name: state.deviceName }), true);
    elements.connectButton.textContent = t("action.disconnect");
  } else {
    setStatus(t("status.disconnected"));
    elements.connectButton.textContent = t("action.connect");
  }
  if (refreshGeneratedReport && !state.aiPending) void runAiAnalysis();
});
applyTranslations();
renderAccount();
showView(testMode ? viewFromHash() : "analysis", false);
drawTrack(); drawCharts();

startLandingTelemetry();

// Page titles slide in the first time a page is shown; later visits show them in place.
document.querySelectorAll(".landing-copy h1, .fx-hero h1, .ct-hero h1").forEach((title) => {
  const lines = title.querySelectorAll(":scope > span");
  const finished = new Set();
  title.addEventListener("animationend", (event) => {
    if (event.animationName !== "heroLineIn") return;
    finished.add(event.target);
    if (finished.size >= lines.length) title.classList.add("played");
  });
});

initShop();
initProfile({
  askDialog,
  async onSignedOut() { history.replaceState(null, "", "/#analysis"); await applyUser(null); },
  async onPasswordChanged(user) { state.user = user; renderAccount(); },
});
initStats({ askDialog, showNotice, onUserUpdated(user) { state.user = { ...state.user, ...user }; } });
if (viewFromHash() === "shop") showView("shop", false);
if (cloudConfigured) {
  currentUser().then(applyUser).then(handleAuthLink).then(handleSharedLink).then(handleFriendLink);
} else {
  void handleAuthLink();
  void handleSharedLink();
}

if (testMode) elements.actionHint.textContent = t("hint.mock");
