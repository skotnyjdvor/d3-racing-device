import demoLogUrl from "./fixtures/viterbo-session-2026-07-10.csv?url";
import { analyzeSession } from "./domain/analysis.js";
import { parseRaceBoxCsv } from "./domain/csv.js";
import { distanceMeters } from "./domain/tracks.js";
import { onLanguageChange, t } from "./i18n.js";

const progress = document.querySelector("#demoProgress");
const path = document.querySelector("#demoTrackPath");
const marker = document.querySelector("#demoTrackMarker");
const playButton = document.querySelector("#demoPlayButton");

if (progress && path && marker && playButton) {
  const elements = Object.fromEntries([...document.querySelectorAll("[id^='demo']")].map((element) => [element.id, element]));
  let primarySeries = [];
  let comparisonSeries = [];
  let primaryLap;
  let comparisonLap;
  let frame = 0;
  let lastTime = 0;

  const formatLap = (milliseconds) => {
    const minutes = Math.floor(milliseconds / 60_000);
    const seconds = Math.floor(milliseconds % 60_000 / 1000);
    const millis = Math.round(milliseconds % 1000);
    return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
  };

  function buildSeries(points) {
    let distance = 0;
    const values = points.map((point, index) => {
      if (index) distance += distanceMeters(points[index - 1], point);
      return { point, distance, elapsedMs: point.timeMs - points[0].timeMs };
    });
    const total = Math.max(distance, 1);
    return values.map((value) => ({ ...value, progress: value.distance / total }));
  }

  function atProgress(series, position) {
    let low = 0; let high = series.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (series[middle].progress < position) low = middle + 1;
      else high = middle;
    }
    return low > 0 && Math.abs(series[low - 1].progress - position) < Math.abs(series[low].progress - position) ? series[low - 1] : series[low];
  }

  function linePath(series, project) {
    const step = Math.max(1, Math.floor(series.length / 650));
    return series.filter((_, index) => index % step === 0).map((item, index) => {
      const [x, y] = project(item);
      return `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(" ");
  }

  function renderStaticLog(points, analysis) {
    primaryLap = analysis.fastestLap;
    comparisonLap = analysis.laps.reduce((slowest, lap) => lap.durationMs > slowest.durationMs ? lap : slowest, analysis.laps[0]);
    primarySeries = buildSeries(points.filter((point) => point.lap === primaryLap.number));
    comparisonSeries = buildSeries(points.filter((point) => point.lap === comparisonLap.number));

    const coordinates = primarySeries.map((item) => item.point);
    const minLat = Math.min(...coordinates.map((point) => point.latitude));
    const maxLat = Math.max(...coordinates.map((point) => point.latitude));
    const minLon = Math.min(...coordinates.map((point) => point.longitude));
    const maxLon = Math.max(...coordinates.map((point) => point.longitude));
    const padding = 48;
    const scale = Math.min((640 - padding * 2) / (maxLon - minLon), (430 - padding * 2) / (maxLat - minLat));
    const offsetX = (640 - (maxLon - minLon) * scale) / 2;
    const offsetY = (430 - (maxLat - minLat) * scale) / 2;
    const trackProject = ({ point }) => [offsetX + (point.longitude - minLon) * scale, offsetY + (maxLat - point.latitude) * scale];
    const trackD = linePath(primarySeries, trackProject);
    elements.demoTrackPath.setAttribute("d", trackD);
    elements.demoTrackShadow.setAttribute("d", trackD);

    const chartProject = ({ point, progress: position }) => [52 + position * 568, 270 - Math.max(0, Math.min(140, point.speed)) / 140 * 228];
    elements.demoPrimaryLine.setAttribute("d", linePath(primarySeries, chartProject));
    elements.demoSecondaryLine.setAttribute("d", linePath(comparisonSeries, chartProject));
    elements.demoBestLap.textContent = formatLap(primaryLap.durationMs);
    elements.demoBestLapLabel.textContent = `Viterbo · Lap ${primaryLap.number}`;
    elements.demoPrimaryLegend.textContent = `Lap ${primaryLap.number} · ${formatLap(primaryLap.durationMs)}`;
    elements.demoSecondaryLegend.textContent = `Lap ${comparisonLap.number} · ${formatLap(comparisonLap.durationMs)}`;
    renderDemo();
  }

  function renderDemo() {
    if (!primarySeries.length || !comparisonSeries.length) return;
    const position = Number(progress.value) / 1000;
    const primary = atProgress(primarySeries, position);
    const comparison = atProgress(comparisonSeries, position);
    const pathPoint = path.getPointAtLength(path.getTotalLength() * position);
    marker.setAttribute("transform", `translate(${pathPoint.x} ${pathPoint.y})`);
    const timeDelta = (primary.elapsedMs - comparison.elapsedMs) / 1000;
    const speedDelta = primary.point.speed - comparison.point.speed;
    const x = 52 + position * 568;
    const yPrimary = 270 - primary.point.speed / 140 * 228;
    const ySecondary = 270 - comparison.point.speed / 140 * 228;

    elements.demoChartCursor.setAttribute("x1", x); elements.demoChartCursor.setAttribute("x2", x);
    elements.demoPrimaryDot.setAttribute("cx", x); elements.demoPrimaryDot.setAttribute("cy", yPrimary);
    elements.demoSecondaryDot.setAttribute("cx", x); elements.demoSecondaryDot.setAttribute("cy", ySecondary);
    elements.demoSpeed.textContent = primary.point.speed.toFixed(1);
    elements.demoGForce.textContent = `${Math.abs(primary.point.gForceY).toFixed(2)} g`;
    elements.demoDelta.textContent = `${timeDelta <= 0 ? "−" : "+"}${Math.abs(timeDelta).toFixed(3)}`;
    elements.demoSector.textContent = `S${Math.min(3, Math.floor(position * 3) + 1)} · ${Math.round(position * 100)}%`;
    elements.demoProgressLabel.value = `${Math.round(position * 100)}%`;
    elements.demoInsight.textContent = t("landing.liveInsight", { lap: primaryLap.number, other: comparisonLap.number, speed: `${speedDelta >= 0 ? "+" : ""}${speedDelta.toFixed(1)}`, delta: `${timeDelta >= 0 ? "+" : ""}${timeDelta.toFixed(3)}` });
    progress.style.setProperty("--progress", `${position * 100}%`);
  }

  function stop() {
    cancelAnimationFrame(frame); frame = 0; lastTime = 0;
    playButton.textContent = "▶"; playButton.setAttribute("aria-label", "Play demo");
  }

  function animate(time) {
    if (!lastTime) lastTime = time;
    const next = Number(progress.value) + (time - lastTime) * .035;
    lastTime = time;
    progress.value = next >= 1000 ? 0 : next;
    renderDemo(); frame = requestAnimationFrame(animate);
  }

  progress.addEventListener("input", () => { if (frame) stop(); renderDemo(); });
  playButton.addEventListener("click", () => {
    if (frame) stop();
    else { playButton.textContent = "Ⅱ"; playButton.setAttribute("aria-label", "Pause demo"); frame = requestAnimationFrame(animate); }
  });
  onLanguageChange(renderDemo);

  fetch(demoLogUrl).then((response) => {
    if (!response.ok) throw new Error(`Demo log HTTP ${response.status}`);
    return response.text();
  }).then((text) => {
    const points = parseRaceBoxCsv(text);
    renderStaticLog(points, analyzeSession(points));
  }).catch(() => { elements.demoInsight.textContent = t("landing.demoError"); });
}
