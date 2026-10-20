// "Lap report" workspace panel (MoTeC i2 Channel Report): one row per lap with time, gap to the best,
// max / min / average speed and peak G forces; a summary of the included laps (best, average, spread,
// standard deviation). The checkbox leaves a lap out of the summary and of the corner report's best
// sections; a click on a row makes it the primary lap.

import { lapReport } from "./domain/lap-report.js";
import { exclusionVersion, getExcludedLaps, setLapExcluded } from "./lap-exclusion.js";
import { toSpeed } from "./units.js";

const gap = (milliseconds) => (Number.isFinite(milliseconds) ? `${milliseconds > 0 ? "+" : milliseconds < 0 ? "−" : "±"}${(Math.abs(milliseconds) / 1000).toFixed(3)}` : "—");
const fixed = (value, digits) => (Number.isFinite(value) ? value.toFixed(digits) : "—");

export function createLapReportPanel(ctx) {
  const { state, elements, t } = ctx;
  let statsKey = "";
  let statsRows = null; // per-lap figures do not depend on exclusion: computed once per session
  let tableKey = "";

  function report() {
    const laps = state.analysis?.laps ?? [];
    const key = `${state.selectedSession?.id ?? ""}|${laps.length}|${Boolean(state.selectedSession?.points)}`;
    if (key !== statsKey) {
      statsKey = key;
      statsRows = lapReport(laps.map((lap) => ({ number: lap.number, durationMs: lap.durationMs, points: ctx.lapPoints(lap.number) }))).rows;
    }
    if (!laps.length) return null;
    // Summary for the current exclusion, reusing the per-lap figures.
    const excluded = getExcludedLaps(state);
    return lapReport(laps.map((lap) => ({ number: lap.number, durationMs: lap.durationMs, points: [] })), excluded, statsRows);
  }

  function render() {
    const key = `${statsKey}|${state.selectedSession?.id ?? ""}|${state.analysis?.laps.length ?? 0}|${exclusionVersion()}|${state.selectedLapNumber}|${state.comparisonRival ? state.comparisonSource?.key : ""}${state.comparisonLapNumber}|${t("lapReport.title")}`;
    if (key === tableKey) return;
    tableKey = key;
    const data = report();
    elements.lapReportPanel.classList.toggle("is-empty", !data);
    if (!data) {
      elements.lapReportSummary.textContent = t("lapReport.empty");
      elements.lapReportTable.innerHTML = "";
      return;
    }
    const { summary, bestValues } = data;
    elements.lapReportSummary.innerHTML = summary.count
      ? t("lapReport.summary", {
        count: summary.count,
        mean: `<b>${ctx.formatLapTime(summary.meanMs)}</b>`,
        spread: `<b>${(summary.spreadMs / 1000).toFixed(3)}</b>`,
        stdev: `<b>${summary.stdevMs === null ? "—" : (summary.stdevMs / 1000).toFixed(3)}</b>`,
      })
      : t("lapReport.noneIncluded");
    const best = (row, key, digits) => {
      const value = row[key];
      const isBest = !row.excluded && Number.isFinite(value) && Number.isFinite(bestValues[key]) && Math.abs(value - bestValues[key]) < 1e-9;
      return `<td class="${isBest ? "best" : ""}">${fixed(key.endsWith("Speed") ? toSpeed(value) : value, digits)}</td>`;
    };
    const head = `<thead><tr><th scope="col"><span class="visually-hidden">${t("lapReport.include")}</span></th><th scope="col">${t("lapReport.lap")}</th><th scope="col">${t("lapReport.time")}</th><th scope="col">Δ</th><th scope="col">V ${t("lapReport.max")}</th><th scope="col">V ${t("lapReport.min")}</th><th scope="col">V ${t("lapReport.avg")}</th><th scope="col">${t("lapReport.lat")}</th><th scope="col">${t("lapReport.brake")}</th><th scope="col">${t("lapReport.accel")}</th></tr></thead>`;
    const rows = data.rows.map((row) => {
      const classes = [row.excluded ? "excluded" : "", row.number === state.selectedLapNumber ? "is-primary" : "", !state.comparisonRival && row.number === state.comparisonLapNumber ? "is-compare" : ""].filter(Boolean).join(" ");
      const isBestTime = !row.excluded && row.timeMs === bestValues.timeMs;
      return `<tr class="${classes}" data-report-lap="${row.number}" tabindex="0" aria-selected="${row.number === state.selectedLapNumber}">
        <td class="include"><input type="checkbox" data-include-lap="${row.number}" ${row.excluded ? "" : "checked"} aria-label="${t("lapReport.includeLap", { lap: row.number })}" /></td>
        <th scope="row">${row.number}</th>
        <td class="${isBestTime ? "best" : ""}"><b>${ctx.formatLapTime(row.timeMs)}</b></td>
        <td>${row.excluded ? "—" : gap(row.gapMs)}</td>
        ${best(row, "maxSpeed", 1)}${best(row, "minSpeed", 1)}${best(row, "avgSpeed", 1)}
        ${best(row, "maxLatG", 2)}${best(row, "maxBrakeG", 2)}${best(row, "maxAccelG", 2)}
      </tr>`;
    }).join("");
    elements.lapReportTable.innerHTML = `${head}<tbody>${rows}</tbody>`;
  }

  elements.lapReportTable.addEventListener("change", (event) => {
    const box = event.target.closest("[data-include-lap]");
    if (!box) return;
    setLapExcluded(state, Number(box.dataset.includeLap), !box.checked);
    ctx.onExclusionChange();
  });
  elements.lapReportTable.addEventListener("click", (event) => {
    if (event.target.closest(".include")) return;
    const row = event.target.closest("[data-report-lap]");
    if (row && Number(row.dataset.reportLap) !== state.selectedLapNumber) ctx.selectLap(row.dataset.reportLap);
  });
  elements.lapReportTable.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.target.closest(".include")) return;
    const row = event.target.closest("[data-report-lap]");
    if (!row) return;
    event.preventDefault();
    const number = row.dataset.reportLap;
    if (Number(number) !== state.selectedLapNumber) ctx.selectLap(number);
    elements.lapReportTable.querySelector(`[data-report-lap="${number}"]`)?.focus();
  });
  ctx.onLanguageChange(() => { tableKey = ""; render(); });

  function draw() { if (!ctx.isOverlayFrame()) render(); }
  return { draw };
}
