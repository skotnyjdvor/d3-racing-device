// "Corners" workspace panel: the corner-by-corner report (MoTeC i2 Track Report). One row per track
// section of the primary lap: time, gap to the comparison lap and to the best of the session, entry,
// minimum and exit speed. Hovering a row moves the cursor to its apex, a click zooms the charts to it,
// and the row under the chart cursor is highlighted.

import { cornerReport, statsFor } from "./domain/corner-report.js";
import { exclusionVersion, getExcludedLaps } from "./lap-exclusion.js";
import { toSpeed } from "./units.js";

const seconds = (milliseconds) => (milliseconds / 1000).toFixed(3);
const gap = (milliseconds) => `${milliseconds > 0 ? "+" : milliseconds < 0 ? "−" : "±"}${(Math.abs(milliseconds) / 1000).toFixed(3)}`;
const speed = (value) => (Number.isFinite(value) ? String(Math.round(toSpeed(value))) : "—");

export function createCornersPanel(ctx) {
  const { state, elements, t } = ctx;
  let report = null;
  let reportKey = "";
  let comparison = null;
  let comparisonKey = "";
  let tableKey = "";
  let currentIndex = -1;

  // The report depends on the session only; sections come from its fastest lap, so they stay put
  // whichever laps are being compared.
  function currentReport() {
    const laps = state.analysis?.laps ?? [];
    const reference = state.analysis?.fastestLap?.number ?? null;
    const key = `${state.selectedSession?.id ?? ""}|${laps.length}|${reference}|${Boolean(state.selectedSession?.points)}|${exclusionVersion()}`;
    if (key !== reportKey) {
      reportKey = key;
      report = laps.length && reference ? cornerReport(laps.map((lap) => ({ number: lap.number, points: ctx.lapPoints(lap.number) })), reference, { exclude: [...getExcludedLaps(state)] }) : null;
      comparisonKey = "";
    }
    return report;
  }

  // The comparison lap may be a friend's lap, which is not in the report: measure it on the same sections.
  function comparisonStats() {
    if (!report || !state.comparisonLapNumber) return null;
    const key = `${reportKey}|${state.comparisonRival ? state.comparisonSource?.key : "o"}${state.comparisonLapNumber}`;
    if (key !== comparisonKey) {
      comparisonKey = key;
      const own = !state.comparisonRival && report.laps.find((row) => row.number === state.comparisonLapNumber);
      comparison = own ? own.stats : statsFor(ctx.comparisonLapPoints(), report.sections);
    }
    return comparison;
  }

  const sectionName = (section) => (section.kind === "corner"
    ? section.id
    : t("corners.straight", { from: section.before ? `T${section.before}` : t("corners.sf"), to: section.after ? `T${section.after}` : t("corners.sf") }));

  function renderTable() {
    const data = currentReport();
    const primary = data?.laps.find((row) => row.number === state.selectedLapNumber) ?? null;
    const compare = comparisonStats();
    const key = `${reportKey}|${state.selectedLapNumber}|${comparisonKey}|${state.comparisonLapNumber}|${t("corners.title")}`;
    if (key === tableKey) return;
    tableKey = key;
    currentIndex = -1;
    elements.cornersPanel.classList.toggle("is-empty", !primary);
    if (!data || !primary) {
      elements.cornersSummary.textContent = t("corners.empty");
      elements.cornersTable.innerHTML = "";
      return;
    }
    const primaryTotal = primary.stats.reduce((sum, stats) => sum + (stats?.timeMs ?? 0), 0);
    elements.cornersSummary.innerHTML = Number.isFinite(data.idealMs)
      ? t("corners.summary", { ideal: `<b>${ctx.formatLapTime(data.idealMs)}</b>`, gain: `<b class="gain">${gap(data.idealMs - primaryTotal)}</b>`, lap: state.selectedLapNumber })
      : "";
    const hasCompare = Boolean(compare);
    const head = `<thead><tr><th scope="col">${t("corners.section")}</th><th scope="col">${t("corners.time")}</th>${hasCompare ? `<th scope="col">Δ ${t("corners.vsCompare")}</th>` : ""}<th scope="col">${t("corners.toBest")}</th><th scope="col">${t("corners.entry")}</th><th scope="col">${t("corners.min")}</th><th scope="col">${t("corners.exit")}</th></tr></thead>`;
    const rows = data.sections.map((section, index) => {
      const stats = primary.stats[index];
      const other = compare?.[index] ?? null;
      const best = data.best[index];
      const lossToBest = best && primary.comparable ? stats.timeMs - best.timeMs : null;
      const delta = other ? stats.timeMs - other.timeMs : null;
      const deltaCell = hasCompare ? `<td class="${delta === null ? "" : delta > 0 ? "loss" : "gain"}">${delta === null ? "—" : gap(delta)}</td>` : "";
      const bestCell = lossToBest === null ? "<td>—</td>"
        : lossToBest <= 0.5 ? `<td class="best" title="${t("corners.bestOf", { lap: best.lap })}">${t("corners.isBest")}</td>`
        : `<td class="loss" title="${t("corners.bestOf", { lap: best.lap })}">${gap(lossToBest)}<small>${t("corners.lapShort", { lap: best.lap })}</small></td>`;
      const speedCell = (key) => `<td>${speed(stats[key])}${other ? `<small class="val-compare">${speed(other[key])}</small>` : ""}</td>`;
      return `<tr class="${section.kind}" data-corner-index="${index}" tabindex="0"><th scope="row">${sectionName(section)}</th><td><b>${seconds(stats.timeMs)}</b></td>${deltaCell}${bestCell}${speedCell("entry")}${speedCell("min")}${speedCell("exit")}</tr>`;
    }).join("");
    elements.cornersTable.innerHTML = `${head}<tbody>${rows}</tbody>`;
  }

  // Cursor frames only move the highlight.
  function highlightCursor() {
    const cursor = state.cursorProgress;
    const index = report && cursor !== null ? report.sections.findIndex((section) => cursor >= section.from && cursor <= section.to) : -1;
    if (index === currentIndex) return;
    elements.cornersTable.querySelector("tr.current")?.classList.remove("current");
    currentIndex = index;
    if (index >= 0) elements.cornersTable.querySelector(`tr[data-corner-index="${index}"]`)?.classList.add("current");
  }

  function draw() {
    if (!ctx.isOverlayFrame()) renderTable();
    highlightCursor();
  }

  const rowSection = (event) => {
    const row = event.target.closest("tr[data-corner-index]");
    return row && report ? report.sections[Number(row.dataset.cornerIndex)] : null;
  };
  const focusOn = (section) => {
    const margin = Math.max(.01, (section.to - section.from) * .2);
    ctx.setChartRange(Math.max(0, section.from - margin), Math.min(1, section.to + margin));
    ctx.setCursorProgress(section.apex ?? (section.from + section.to) / 2);
  };
  elements.cornersTable.addEventListener("pointerover", (event) => {
    const section = rowSection(event);
    if (section && event.pointerType === "mouse") ctx.setCursorProgress(section.apex ?? (section.from + section.to) / 2);
  });
  elements.cornersTable.addEventListener("click", (event) => {
    const section = rowSection(event);
    if (section) focusOn(section);
  });
  elements.cornersTable.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const section = rowSection(event);
    if (!section) return;
    event.preventDefault();
    focusOn(section);
  });
  ctx.onLanguageChange(() => { tableKey = ""; draw(); });

  // Corner names at their apexes, for the track map.
  const mapLabels = () => (currentReport()?.sections ?? []).filter((section) => section.kind === "corner").map((section) => ({ label: section.id, progress: section.apex }));

  return { draw, mapLabels };
}
