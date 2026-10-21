// AI page: lap / mode pickers, report rendering with segment and speed previews, follow-up questions and
// the history of saved reports.
import { canvasContext } from "./canvas-layers.js";
import { analyzeLog, askAiFollowUp, deleteAiAnalysis, loadAiAnalyses, renameLog, saveLog } from "./cloud/api.js";
import { getLanguage } from "./i18n.js";
import { distancePoints, pointAtProgress } from "./lap-series.js";
import { updateLocalSession } from "./local-store.js";

export function createAiPage(ctx) {
  const {
    state, elements, t, escapeHtml, formatDate, formatLapTime, askDialog, trackAiMarkerAreas,
    lapPoints, comparisonLapPoints, comparisonAvailable, comparisonLabel, comparisonOptionsHtml, comparisonSelectValue,
    rivalComparable, useRivalComparison, updateLapView, drawTrack, openAccountDialog,
  } = ctx;
  // AI report mode: "single" analyses one lap on its own, "compare" explains the difference between two laps.
  let aiModePreference = "single";
  try { if (localStorage.getItem("d3-ai-mode") === "compare") aiModePreference = "compare"; } catch {}
  let aiRequestToken = 0;
  let aiHistoryRequestToken = 0;

  // What will actually be analysed: comparison needs a second lap to be selected.
  // The AI compares with own laps of the same session or with a pilot's shared lap, not with older sessions.
  function effectiveAiMode() {
    const olderSession = state.comparisonRival && state.comparisonSource?.kind === "session";
    return aiModePreference === "compare" && state.comparisonLapNumber && comparisonAvailable() && !olderSession ? "compare" : "single";
  }

  function renderAiMode() {
    const mode = effectiveAiMode();
    elements.aiModeGroup.querySelectorAll("[data-ai-mode]").forEach((button) => {
      button.setAttribute("aria-checked", String(button.dataset.aiMode === mode));
      button.tabIndex = button.dataset.aiMode === mode ? 0 : -1;
      if (button.dataset.aiMode === "compare") button.disabled = !comparisonAvailable();
    });
    elements.aiModeGroup.setAttribute("aria-label", t("ai.modeLabel"));
    elements.aiLapControls.classList.toggle("single", mode === "single");
    elements.aiPrimaryLapLabel.textContent = t(mode === "single" ? "ai.lapToAnalyse" : "laps.primary");
  }

  function setAiMode(mode) {
    aiModePreference = mode === "compare" ? "compare" : "single";
    try { localStorage.setItem("d3-ai-mode", aiModePreference); } catch {}
    if (aiModePreference === "compare" && !state.comparisonLapNumber && state.analysis) {
      // Switching to comparison picks the fastest other lap, the same default as when a session opens.
      const other = [...state.analysis.laps].sort((a, b) => a.durationMs - b.durationMs).find((lap) => lap.number !== state.selectedLapNumber);
      if (other) { state.comparisonLapNumber = other.number; state.comparisonRival = false; }
      else if (rivalComparable()) useRivalComparison();
    }
    clearAiReport();
    updateLapView();
  }

  function renderAiPageContext() {
    const session = state.selectedSession;
    elements.aiSessionSelect.innerHTML = state.sessions.length
      ? state.sessions.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title || t("sessions.item", { id: item.displayId ?? item.id }))}${item.cloudId ? " ☁" : ""}</option>`).join("")
      : `<option value="">${escapeHtml(t("aiPage.noLog"))}</option>`;
    elements.aiSessionSelect.disabled = !state.sessions.length;
    elements.aiSessionSelect.value = session ? String(session.id) : "";

    const laps = state.analysis?.laps ?? [];
    const options = laps.map((lap) => `<option value="${lap.number}">${escapeHtml(t("laps.option", { lap: lap.number, time: formatLapTime(lap.durationMs) }))}</option>`).join("");
    elements.aiPrimaryLapSelect.innerHTML = options || `<option value="">—</option>`;
    elements.aiComparisonLapSelect.innerHTML = comparisonOptionsHtml("laps.option", options, { ai: true });
    elements.aiPrimaryLapSelect.disabled = !laps.length;
    elements.aiComparisonLapSelect.disabled = !comparisonAvailable();
    elements.aiPrimaryLapSelect.value = state.selectedLapNumber ? String(state.selectedLapNumber) : "";
    elements.aiComparisonLapSelect.value = comparisonSelectValue({ ai: true });
    renderAiMode();
  }

  function renderAiHistory() {
    const available = Boolean(state.user && state.selectedSession?.cloudId);
    elements.aiHistory.hidden = !available;
    if (!available) return;
    elements.aiHistoryCount.textContent = String(state.aiHistory.length);
    if (state.aiHistoryLoading) {
      elements.aiHistoryList.innerHTML = `<p class="ai-history-empty">${escapeHtml(t("ai.historyLoading"))}</p>`;
      return;
    }
    if (state.aiHistoryError) {
      elements.aiHistoryList.innerHTML = `<p class="ai-history-empty error">${escapeHtml(state.aiHistoryError)}</p>`;
      return;
    }
    if (!state.aiHistory.length) {
      elements.aiHistoryList.innerHTML = `<p class="ai-history-empty">${escapeHtml(t("ai.historyEmpty"))}</p>`;
      return;
    }
    elements.aiHistoryList.innerHTML = state.aiHistory.map((item) => {
      const comparison = Number(item.comparison_lap);
      const primary = Number(item.primary_lap);
      const pair = Number.isFinite(comparison) && comparison > 0
        ? t(item.other_pilot ? "ai.historyPairRival" : "ai.historyPair", { primary, comparison })
        : t("ai.historySingle", { lap: primary });
      const language = ["ru", "en", "pl", "it"].includes(item.language) ? item.language.toUpperCase() : "RU";
      const current = item.id === state.aiAnalysisId ? " current" : "";
      return `<article class="ai-history-item${current}">
        <div class="ai-history-meta"><span>${escapeHtml(formatDate(item.created_at))}</span><b>${escapeHtml(language)}</b></div>
        <strong>${escapeHtml(pair)}</strong>
        <p>${escapeHtml(item.report?.summary || t("ai.historyTitle"))}</p>
        <div class="ai-history-actions">
          <button class="secondary" type="button" data-ai-history-open="${escapeHtml(item.id)}">${escapeHtml(t("ai.historyOpen"))}</button>
          <button class="ai-history-delete" type="button" data-ai-history-delete="${escapeHtml(item.id)}" aria-label="${escapeHtml(t("ai.historyDelete"))}">×</button>
        </div>
      </article>`;
    }).join("");
    elements.aiHistoryList.querySelectorAll("[data-ai-history-open]").forEach((button) => {
      button.addEventListener("click", () => openAiHistoryReport(button.dataset.aiHistoryOpen));
    });
    elements.aiHistoryList.querySelectorAll("[data-ai-history-delete]").forEach((button) => {
      button.addEventListener("click", () => removeAiHistoryReport(button.dataset.aiHistoryDelete));
    });
  }

  async function refreshAiHistory() {
    const cloudId = state.selectedSession?.cloudId;
    const requestToken = ++aiHistoryRequestToken;
    if (!state.user || !cloudId) {
      state.aiHistory = []; state.aiHistoryLoading = false; state.aiHistoryError = "";
      renderAiHistory();
      return;
    }
    state.aiHistoryLoading = true;
    state.aiHistoryError = "";
    renderAiHistory();
    try {
      const result = await loadAiAnalyses(cloudId);
      if (requestToken !== aiHistoryRequestToken || state.selectedSession?.cloudId !== cloudId) return;
      state.aiHistory = result.analyses || [];
    } catch (error) {
      if (requestToken === aiHistoryRequestToken && state.selectedSession?.cloudId === cloudId) state.aiHistoryError = error.message;
    } finally {
      if (requestToken === aiHistoryRequestToken && state.selectedSession?.cloudId === cloudId) {
        state.aiHistoryLoading = false;
        renderAiHistory();
      }
    }
  }

  function openAiHistoryReport(id) {
    const saved = state.aiHistory.find((item) => item.id === id);
    if (!saved?.report || !state.analysis) return;
    aiRequestToken += 1;
    state.aiPending = false;
    const availableLaps = new Set(state.analysis.laps.map((lap) => lap.number));
    const primary = Number(saved.primary_lap);
    const comparison = Number(saved.comparison_lap);
    if (availableLaps.has(primary)) state.selectedLapNumber = primary;
    if (comparison > 0 && saved.other_pilot) {
      aiModePreference = "compare";
      if (rivalComparable() && state.rival.analysis.laps.some((lap) => lap.number === comparison)) { useRivalComparison(); state.comparisonLapNumber = comparison; }
    } else if (comparison > 0) {
      aiModePreference = "compare";
      state.comparisonRival = false; state.comparisonSource = null;
      state.comparisonLapNumber = availableLaps.has(comparison) && comparison !== state.selectedLapNumber ? comparison : null;
    } else {
      aiModePreference = "single";
      if (state.comparisonLapNumber === state.selectedLapNumber) state.comparisonLapNumber = null;
    }
    updateLapView();
    renderAiReport(saved.report, saved.id, saved.language || getLanguage());
    revealAiReport();
    elements.copyStatus.textContent = t("ai.historyOpened");
    elements.analyzeAiButton.disabled = false;
    elements.analyzeAiButton.textContent = t("ai.analyze");
    renderAiHistory();
    requestAnimationFrame(() => elements.aiResults.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function removeAiHistoryReport(id) {
    if (!await askDialog({ title: t("ai.historyDeleteTitle"), message: t("ai.historyDeleteConfirm"), confirmLabel: t("dialog.delete"), danger: true })) return;
    try {
      await deleteAiAnalysis(id);
      if (state.aiAnalysisId === id) clearAiReport();
      await refreshAiHistory();
      elements.copyStatus.textContent = t("ai.historyDeleted");
    } catch (error) {
      state.aiHistoryError = error.message;
      renderAiHistory();
    }
  }

  function drawAiSegmentPreview(canvas, item, index) {
    const series = distancePoints(lapPoints(state.selectedLapNumber), 700);
    const { context, width, height } = canvasContext(canvas);
    context.fillStyle = "#08080c";
    context.fillRect(0, 0, width, height);
    if (series.length < 2 || width < 2 || height < 2) return;

    context.strokeStyle = "rgba(255,255,255,.03)";
    context.lineWidth = 1;
    const grid = 28;
    for (let x = grid; x < width; x += grid) {
      context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke();
    }
    for (let y = grid; y < height; y += grid) {
      context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
    }

    const points = series.map((entry) => entry.point);
    const lats = points.map((point) => point.latitude);
    const lons = points.map((point) => point.longitude);
    const minLat = Math.min(...lats); const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons); const maxLon = Math.max(...lons);
    const padding = 12;
    const scale = Math.min(
      (width - padding * 2) / Math.max(maxLon - minLon, 1e-9),
      (height - padding * 2) / Math.max(maxLat - minLat, 1e-9),
    );
    const offsetX = (width - (maxLon - minLon) * scale) / 2;
    const offsetY = (height - (maxLat - minLat) * scale) / 2;
    const project = (point) => [
      offsetX + (point.longitude - minLon) * scale,
      offsetY + (maxLat - point.latitude) * scale,
    ];
    const drawSeries = (entries, color, lineWidth) => {
      if (entries.length < 2) return;
      context.strokeStyle = color;
      context.lineWidth = lineWidth;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      entries.forEach((entry, pointIndex) => {
        const [x, y] = project(entry.point);
        if (pointIndex) context.lineTo(x, y); else context.moveTo(x, y);
      });
      context.stroke();
    };

    drawSeries(series, "rgba(255,255,255,.18)", 3);
    const focus = Math.max(0, Math.min(1, Number(item.distancePercent) / 100));
    let start = Number(item.startPercent) / 100;
    let end = Number(item.endPercent) / 100;
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      start = Math.max(0, focus - .035);
      end = Math.min(1, focus + .035);
    }
    start = Math.max(0, Math.min(1, start));
    end = Math.max(0, Math.min(1, end));
    const ranges = start <= end ? [[start, end]] : [[start, 1], [0, end]];
    const highlighted = ranges.map(([rangeStart, rangeEnd]) => {
      const inside = series.filter((entry) => entry.progress >= rangeStart && entry.progress <= rangeEnd);
      const first = pointAtProgress(series, rangeStart);
      const last = pointAtProgress(series, rangeEnd);
      return [first, ...inside, last].filter(Boolean);
    });
    context.save();
    context.shadowColor = "rgba(244,244,238,.6)";
    context.shadowBlur = 10;
    highlighted.forEach((segment) => drawSeries(segment, "#f4f4ee", 6));
    context.restore();
    highlighted.forEach((segment) => drawSeries(segment, "#f5f7fa", 2));

    const marker = pointAtProgress(series, focus)?.point;
    if (!marker) return;
    const [markerX, markerY] = project(marker);
    context.save();
    context.shadowColor = "rgba(255,176,0,.85)";
    context.shadowBlur = 12;
    context.fillStyle = "#ffb000";
    context.beginPath(); context.arc(markerX, markerY, 9, 0, Math.PI * 2); context.fill();
    context.restore();
    context.strokeStyle = "#ffffff";
    context.lineWidth = 1.5;
    context.beginPath(); context.arc(markerX, markerY, 11.5, 0, Math.PI * 2); context.stroke();
    context.fillStyle = "#080b10";
    context.font = "900 12px 'JetBrains Mono', ui-monospace, monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(index + 1), markerX, markerY + .5);
  }

  function drawAiSpeedPreview(canvas, item) {
    const single = state.aiReport?.analysisMode === "single-lap";
    const primary = distancePoints(lapPoints(state.selectedLapNumber), 700);
    const comparison = !single && state.comparisonLapNumber ? distancePoints(comparisonLapPoints(), 700) : [];
    const { context, width, height } = canvasContext(canvas);
    context.fillStyle = "#08080c";
    context.fillRect(0, 0, width, height);
    if (primary.length < 2 || (!single && comparison.length < 2) || width < 2 || height < 2) return;

    const focus = Math.max(0, Math.min(1, Number(item.distancePercent) / 100));
    const rawStart = Math.max(0, Math.min(1, Number(item.startPercent) / 100));
    const rawEnd = Math.max(0, Math.min(1, Number(item.endPercent) / 100));
    const zoneStart = Number.isFinite(rawStart) ? rawStart : Math.max(0, focus - .03);
    const zoneEnd = Number.isFinite(rawEnd) ? rawEnd : Math.min(1, focus + .03);
    const zoneSpan = zoneEnd >= zoneStart ? zoneEnd - zoneStart : .08;
    const viewSpan = Math.min(1, Math.max(.14, zoneSpan * 2.4));
    const viewStart = Math.max(0, Math.min(1 - viewSpan, focus - viewSpan / 2));
    const viewEnd = viewStart + viewSpan;
    const visible = [...primary, ...comparison].filter((entry) => entry.progress >= viewStart && entry.progress <= viewEnd);
    const speeds = visible.map((entry) => Number(entry.point.speed)).filter(Number.isFinite);
    if (!speeds.length) return;

    const padding = { left: 10, right: 10, top: 27, bottom: 10 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const minimum = Math.max(0, Math.min(...speeds) - 8);
    const maximum = Math.max(minimum + 20, Math.max(...speeds) + 8);
    const x = (progress) => padding.left + (progress - viewStart) / viewSpan * plotWidth;
    const y = (speed) => padding.top + (maximum - speed) / (maximum - minimum) * plotHeight;

    context.fillStyle = "rgba(255,176,0,.08)";
    const highlightStart = x(Math.max(viewStart, zoneStart));
    const highlightEnd = x(Math.min(viewEnd, zoneEnd));
    context.fillRect(highlightStart, padding.top, Math.max(2, highlightEnd - highlightStart), plotHeight);
    context.strokeStyle = "rgba(255,255,255,.04)";
    context.lineWidth = 1;
    for (let row = 0; row <= 2; row += 1) {
      const rowY = padding.top + plotHeight * row / 2;
      context.beginPath(); context.moveTo(padding.left, rowY); context.lineTo(width - padding.right, rowY); context.stroke();
    }

    const drawLine = (series, color, lineWidth) => {
      const section = series.filter((entry) => entry.progress >= viewStart && entry.progress <= viewEnd);
      if (section.length < 2) return;
      context.strokeStyle = color;
      context.lineWidth = lineWidth;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      section.forEach((entry, pointIndex) => {
        const pointX = x(entry.progress); const pointY = y(entry.point.speed);
        if (pointIndex) context.lineTo(pointX, pointY); else context.moveTo(pointX, pointY);
      });
      context.stroke();
    };
    drawLine(comparison, "#e10600", 2);
    drawLine(primary, "#f4f4ee", 2.4);

    const focusX = x(focus);
    context.strokeStyle = "rgba(255,255,255,.55)";
    context.lineWidth = 1;
    context.beginPath(); context.moveTo(focusX, padding.top); context.lineTo(focusX, height - padding.bottom); context.stroke();
    [{ series: primary, color: "#f4f4ee" }, { series: comparison, color: "#e10600" }].forEach(({ series, color }) => {
      const point = pointAtProgress(series, focus)?.point;
      if (!point) return;
      context.fillStyle = color;
      context.beginPath(); context.arc(focusX, y(point.speed), 3.5, 0, Math.PI * 2); context.fill();
    });

    context.font = "700 12px 'JetBrains Mono', ui-monospace, monospace";
    context.textBaseline = "middle";
    const legends = [
      { x: 10, color: "#f4f4ee", label: t("laps.legend", { lap: state.selectedLapNumber }) },
      ...(single ? [] : [{ x: Math.min(width / 2, 116), color: "#e10600", label: comparisonLabel(true) }]),
    ];
    legends.forEach((legend) => {
      context.fillStyle = legend.color; context.fillRect(legend.x, 10, 12, 2);
      context.fillStyle = "#a8a9ac"; context.fillText(legend.label, legend.x + 17, 11);
    });
  }

  function drawAiCardVisuals() {
    elements.aiReport.querySelectorAll("[data-ai-segment]").forEach((canvas) => {
      const index = Number(canvas.dataset.aiSegment);
      const item = state.aiReport?.timeLosses?.[index];
      if (item) drawAiSegmentPreview(canvas, item, index);
    });
    elements.aiReport.querySelectorAll("[data-ai-speed]").forEach((canvas) => {
      const index = Number(canvas.dataset.aiSpeed);
      const item = state.aiReport?.timeLosses?.[index];
      if (item) drawAiSpeedPreview(canvas, item);
    });
  }

  // Selecting an advice item (card or map marker) highlights both on the AI page; the page never switches views.
  function openAiRecommendation(index, progress, { scrollTo = "map" } = {}) {
    state.aiSelectedIndex = index;
    state.cursorProgress = progress;
    elements.aiReport.querySelectorAll("[data-ai-index]").forEach((card) => card.classList.toggle("selected", Number(card.dataset.aiIndex) === index));
    drawTrack();
    // The map is sticky beside the cards on desktop; on phones it sits above them, so bring the right one into view.
    const compact = window.matchMedia("(max-width: 1023px)").matches;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const target = scrollTo === "card" ? elements.aiReport.querySelector(`[data-ai-index="${index}"]`) : compact ? elements.aiTrackCanvas : null;
    target?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  }

  function clearAiReport() {
    aiRequestToken += 1;
    state.aiReport = null;
    state.aiReportLanguage = null;
    state.aiAnalysisId = null;
    state.aiPending = false;
    state.aiHoverIndex = null;
    state.aiSelectedIndex = null;
    elements.aiResults.hidden = true;
    elements.aiReport.hidden = true;
    elements.aiReport.innerHTML = "";
    elements.aiFollowup.hidden = true;
    elements.aiFollowupAnswer.hidden = true;
    elements.aiFollowupAnswer.innerHTML = "";
    elements.aiQuestion.value = "";
    elements.aiQuestionStatus.textContent = "";
    elements.askAiButton.disabled = true;
    elements.aiTrackLegend.hidden = true;
    elements.aiReportJumpButton.classList.remove("ready");
    renderAiHistory();
    drawTrack();
  }

  function aiQualityMarkup() {
    const assessment = state.analysis?.quality?.assessment;
    if (!assessment) return "";
    const validLevels = new Set(["good", "warning", "poor", "unknown"]);
    const level = ["good", "warning", "poor"].includes(assessment.level) ? assessment.level : "warning";
    const checks = ["gps", "stream", "mounting"].map((name) => {
      const checkLevel = validLevels.has(assessment.checks?.[name]) ? assessment.checks[name] : "unknown";
      return `<div class="ai-quality-check ${checkLevel}"><span>${escapeHtml(t(`ai.qualityCheck.${name}`))}</span><strong>${escapeHtml(t(`ai.qualityLevel.${checkLevel}`))}</strong></div>`;
    }).join("");
    const issues = (assessment.issues || []).map((issue) => `<li>${escapeHtml(t(`ai.qualityIssue.${issue}`))}</li>`).join("");
    return `<section class="ai-quality ${level}">
      <div class="ai-quality-heading"><div><p class="eyebrow">${escapeHtml(t("ai.qualityTitle"))}</p><strong>${escapeHtml(t(`ai.quality.${level}`))}</strong></div><span class="ai-quality-light" aria-hidden="true"></span></div>
      <p>${escapeHtml(t(`ai.qualityCopy.${level}`))}</p>
      <div class="ai-quality-checks">${checks}</div>
      ${issues ? `<ul>${issues}</ul>` : ""}
    </section>`;
  }

  // A fresh or reopened report enters card by card; re-renders (language switch) stay still.
  let aiRevealTimer = 0;
  function revealAiReport() {
    let index = 0;
    [...elements.aiReport.children].forEach((block) => {
      const cards = block.querySelectorAll(".ai-report-card");
      (cards.length ? [...cards] : [block]).forEach((item) => {
        item.classList.add("ai-reveal-item");
        item.style.setProperty("--reveal", String(Math.min(index, 10)));
        index += 1;
      });
    });
    elements.aiReport.classList.remove("revealing");
    void elements.aiReport.offsetWidth;
    elements.aiReport.classList.add("revealing");
    clearTimeout(aiRevealTimer);
    aiRevealTimer = setTimeout(() => elements.aiReport.classList.remove("revealing"), 1200);
  }

  function renderAiReport(report, analysisId, reportLanguage = getLanguage()) {
    state.aiReport = report;
    state.aiReportLanguage = reportLanguage;
    state.aiAnalysisId = analysisId;
    state.aiHoverIndex = null;
    state.aiSelectedIndex = null;
    elements.aiResults.hidden = false;
    elements.aiTrackLegend.hidden = !(report.timeLosses || []).length;
    const singleLap = report.analysisMode === "single-lap";
    elements.aiTrackComparisonLegend.hidden = singleLap;
    elements.aiFollowupCopy.textContent = t(singleLap ? "ai.followupCopySingle" : "ai.followupCopy");
    elements.aiQuestion.placeholder = t(singleLap ? "ai.placeholderSingle" : "ai.placeholder");
    elements.aiReportJumpButton.classList.add("ready");
    const strengths = (report.strengths || []).map((item) => `
      <article class="ai-report-card"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.evidence)}</span></article>`).join("");
    const losses = (report.timeLosses || []).map((item, index) => {
      const phaseLabel = item.phaseType ? t(`ai.phase.${item.phaseType}`) : "";
      const locationLabel = t(`ai.location.${item.driverLocation || "betweenCorners"}`);
      const confidence = ["low", "medium", "high"].includes(item.confidence) ? item.confidence : "low";
      return `
      <article class="ai-report-card" data-ai-index="${index}" data-ai-progress="${Number(item.distancePercent) / 100}">
        <i class="ai-marker-index">${index + 1}</i>
        <button class="ai-card-focus" type="button" data-ai-open>
          <canvas class="ai-segment-preview" data-ai-segment="${index}" aria-hidden="true"></canvas>
          <canvas class="ai-speed-preview" data-ai-speed="${index}" aria-label="${escapeHtml(t("ai.speedPreview"))}"></canvas>
          <strong>${escapeHtml(locationLabel)}</strong>
          <small class="ai-phase">${escapeHtml(item.zoneId || "ZONE")}${phaseLabel ? ` · ${escapeHtml(phaseLabel)}` : ""}</small>
          <span class="ai-observation"><b>${escapeHtml(t("ai.observation"))}:</b> ${escapeHtml(item.observation)}</span>
          <small class="ai-action"><b>${escapeHtml(t("ai.recommendation"))}:</b> ${escapeHtml(item.recommendation)}</small>
        </button>
        <details class="ai-card-details">
          <summary>${escapeHtml(t("ai.details"))}</summary>
          <small><b>${escapeHtml(t("ai.hypothesis"))}:</b> ${escapeHtml(item.hypothesis)}</small>
          <small class="ai-confidence ${confidence}">${escapeHtml(t("ai.confidence", { value: t(`ai.confidence.${confidence}`) }))}</small>
        </details>
      </article>`;
    }).join("");
    const warnings = (report.dataWarnings || []).length
      ? `<ul class="ai-warnings">${report.dataWarnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>` : "";
    elements.aiReport.innerHTML = `
      ${aiQualityMarkup()}
      <div><p class="eyebrow">${escapeHtml(t("ai.summary"))}</p><div class="ai-report-summary">${escapeHtml(report.summary)}</div></div>
      ${strengths ? `<div><p class="eyebrow">${escapeHtml(t("ai.strengths"))}</p><div class="ai-report-grid">${strengths}</div></div>` : ""}
      ${losses ? `<div><p class="eyebrow">${escapeHtml(t("ai.losses"))}</p><div class="ai-report-grid">${losses}</div></div>` : ""}
      <article class="ai-report-card"><strong>${escapeHtml(t("ai.consistency"))}</strong><span>${escapeHtml(report.consistency?.assessment)}</span></article>
      ${warnings ? `<div><p class="eyebrow">${escapeHtml(t("ai.warnings"))}</p>${warnings}</div>` : ""}`;
    elements.aiReport.hidden = false;
    elements.aiFollowup.hidden = false;
    elements.aiFollowupAnswer.hidden = true;
    elements.aiFollowupAnswer.innerHTML = "";
    elements.aiQuestion.value = "";
    elements.aiQuestionStatus.textContent = "";
    elements.askAiButton.disabled = true;
    elements.aiReport.querySelectorAll("[data-ai-progress]").forEach((card) => {
      card.addEventListener("mouseenter", () => { state.aiHoverIndex = Number(card.dataset.aiIndex); drawTrack(); });
      card.addEventListener("mouseleave", () => { state.aiHoverIndex = null; drawTrack(); });
      card.querySelector("[data-ai-open]").addEventListener("click", () => {
        const progress = Math.max(0, Math.min(1, Number(card.dataset.aiProgress)));
        openAiRecommendation(Number(card.dataset.aiIndex), progress);
      });
    });
    requestAnimationFrame(() => { drawTrack(); drawAiCardVisuals(); });
  }

  async function runAiAnalysis() {
    const local = state.selectedSession?.source === "local" ? state.selectedSession : null;
    if (local && !local.cloudId) {
      if (!state.user) { openAccountDialog("signin"); return; }
      try {
        elements.copyStatus.textContent = t("app.aiUploading");
        local.cloudId = await saveLog(local, local.deviceName);
        if (local.title) await renameLog(local.cloudId, local.title).catch(() => {});
        await updateLocalSession(local.id, { cloudId: local.cloudId });
      } catch (error) { elements.copyStatus.textContent = error.message; return; }
    }
    const cloudId = state.selectedSession?.cloudId;
    if (!cloudId) { elements.copyStatus.textContent = t("ai.cloudRequired"); return; }
    const requestLanguage = getLanguage();
    const requestPrimaryLap = state.selectedLapNumber;
    const requestMode = effectiveAiMode();
    const requestComparisonLap = requestMode === "compare" ? state.comparisonLapNumber : null;
    const requestRivalToken = requestMode === "compare" && state.comparisonRival ? state.comparisonSource?.token : undefined;
    const requestToken = ++aiRequestToken;
    state.aiPending = true;
    elements.analyzeAiButton.disabled = true;
    elements.analyzeAiButton.textContent = t("ai.analyzing");
    elements.copyStatus.textContent = t("ai.analyzing");
    try {
      const result = await analyzeLog(cloudId, {
        mode: requestMode,
        primaryLap: requestPrimaryLap,
        comparisonLap: requestComparisonLap,
        rivalToken: requestRivalToken,
        question: "",
        language: requestLanguage,
      });
      if (requestToken !== aiRequestToken || requestLanguage !== getLanguage()) return;
      renderAiReport(result.analysis.report, result.analysis.id, requestLanguage);
      revealAiReport();
      elements.copyStatus.textContent = `${t("ai.reportReady")}${result.cached ? " · cache" : ""}`;
      void refreshAiHistory();
    } catch (error) {
      if (requestToken === aiRequestToken) elements.copyStatus.textContent = error.message;
    } finally {
      if (requestToken === aiRequestToken) {
        state.aiPending = false;
        elements.analyzeAiButton.disabled = !state.selectedSession?.cloudId || !state.analysis?.laps.length;
        elements.analyzeAiButton.textContent = t("ai.analyze");
        const sameComparison = state.selectedSession?.cloudId === cloudId
          && state.selectedLapNumber === requestPrimaryLap
          && effectiveAiMode() === requestMode
          && (requestMode === "single" || (state.comparisonLapNumber === requestComparisonLap && state.comparisonSource?.token === requestRivalToken && state.comparisonRival === Boolean(requestRivalToken)));
        if (sameComparison && requestLanguage !== getLanguage()) void runAiAnalysis();
      }
    }
  }

  async function askAiQuestion() {
    const question = elements.aiQuestion.value.trim();
    if (!state.aiAnalysisId || question.length < 3) return;
    elements.askAiButton.disabled = true;
    elements.askAiButton.textContent = t("ai.asking");
    elements.aiQuestionStatus.textContent = t("ai.asking");
    elements.aiFollowupAnswer.hidden = true;
    try {
      const result = await askAiFollowUp(state.aiAnalysisId, question);
      const followUp = result.followUp || {};
      const evidence = (followUp.evidence || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
      const warnings = (followUp.dataWarnings || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
      elements.aiFollowupAnswer.innerHTML = `
        <strong>${escapeHtml(t("ai.answer"))}</strong>
        <p>${escapeHtml(followUp.answer)}</p>
        ${evidence ? `<b>${escapeHtml(t("ai.evidence"))}</b><ul>${evidence}</ul>` : ""}
        ${warnings ? `<b>${escapeHtml(t("ai.warnings"))}</b><ul class="ai-warnings">${warnings}</ul>` : ""}`;
      elements.aiFollowupAnswer.hidden = false;
      elements.aiQuestionStatus.textContent = t("ai.answerReady");
    } catch (error) {
      elements.aiQuestionStatus.textContent = error.message;
    } finally {
      elements.askAiButton.disabled = elements.aiQuestion.value.trim().length < 3;
      elements.askAiButton.textContent = t("ai.ask");
    }
  }

  elements.aiTrackCanvas.addEventListener("click", (event) => {
    const rect = elements.aiTrackCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const marker = (trackAiMarkerAreas.get(elements.aiTrackCanvas) || [])
      .find((item) => Math.hypot(item.x - x, item.y - y) <= item.radius);
    if (marker) openAiRecommendation(marker.index, marker.progress, { scrollTo: "card" });
  });
  elements.analyzeAiButton.addEventListener("click", runAiAnalysis);
  elements.askAiButton.addEventListener("click", askAiQuestion);
  elements.aiQuestion.addEventListener("input", () => {
    elements.askAiButton.disabled = !state.aiAnalysisId || elements.aiQuestion.value.trim().length < 3;
  });
  elements.aiModeGroup.querySelectorAll("[data-ai-mode]").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.aiMode !== effectiveAiMode()) setAiMode(button.dataset.aiMode);
  }));
  elements.aiModeGroup.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const next = effectiveAiMode() === "single" ? "compare" : "single";
    const target = elements.aiModeGroup.querySelector(`[data-ai-mode="${next}"]`);
    if (target.disabled) return;
    setAiMode(next);
    target.focus();
  });

  return { renderAiPageContext, renderAiHistory, refreshAiHistory, drawAiCardVisuals, clearAiReport, renderAiReport, runAiAnalysis };
}
