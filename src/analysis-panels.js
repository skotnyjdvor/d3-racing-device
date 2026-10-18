// Extra analysis views on top of the lap comparison:
//   - "Channels": several traces stacked on one distance axis, shared cursor and zoom, a phase band and an
//     A-marker to measure a stretch of track (distance, time of both laps, min/max speed);
//   - "G-G diagram": lateral vs longitudinal G of both laps (friction circle);
//   - colours for the track map (by speed or by where the lap gains / loses time).
// Channels are derived from GPS (domain/channels.js) so they work however the logger is mounted.
import { deriveChannels } from "./domain/channels.js";
import { deltaRate, deltaSeries, timeAtProgress } from "./domain/delta.js";
import { distanceMeters } from "./domain/tracks.js";

const WHITE = "#f4f4ee";
const RED = "#e10600";
const LIME = "#c7ff3d";
const MUTED = "#8c8d93";
const GRID = "#1f1f2a";
const FONT = "12px 'JetBrains Mono', ui-monospace, monospace";
const PHASE_COLORS = { braking: "#e10600", corner: "#ffb000", accel: "#c7ff3d", coast: "#3a3b44" };
const STORAGE_KEY = "d3-stack-channels";

// Order on screen, top to bottom. `band` channels are drawn as a coloured strip instead of a line.
export const STACK_CHANNELS = {
  phase: { band: true },
  speed: { unit: "unit.speed", digits: 1, scale: "speed", value: (d) => d.speed },
  delta: { unit: "unit.seconds", digits: 3, scale: "symmetric", delta: true },
  longG: { unit: "g", digits: 2, scale: "symmetric", value: (d) => d.longG },
  latG: { unit: "g", digits: 2, scale: "symmetric", value: (d) => d.latG },
  combinedG: { unit: "g", digits: 2, scale: "positive", value: (d) => d.combinedG },
  lean: { unit: "°", digits: 0, scale: "symmetric", value: (d) => d.lean },
  radius: { unit: "m", digits: 0, scale: "radius", value: (d) => d.radius },
};
const DEFAULT_CHANNELS = ["phase", "speed", "delta", "longG", "latG"];

const SPEED_RAMP = [[43, 108, 255], [0, 229, 255], [199, 255, 61], [255, 176, 0], [225, 6, 0]];
const mix = (a, b, ratio) => a.map((value, index) => Math.round(value + (b[index] - value) * ratio));
const rgb = ([r, g, b]) => `rgb(${r},${g},${b})`;
function ramp(stops, ratio) {
  const position = Math.max(0, Math.min(1, ratio)) * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(position));
  return rgb(mix(stops[index], stops[index + 1], position - index));
}
// Index of the sample closest to a distance fraction (series sorted by progress).
function indexAt(series, progress) {
  let low = 0; let high = series.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (series[middle].progress < progress) low = middle + 1; else high = middle;
  }
  return low > 0 && Math.abs(series[low - 1].progress - progress) < Math.abs(series[low].progress - progress) ? low - 1 : low;
}
const niceCeil = (value, step) => Math.max(step, Math.ceil(value / step) * step);
const percentile = (values, share) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))];
};

function loadChannels() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const valid = Array.isArray(saved) ? saved.filter((id) => id in STACK_CHANNELS) : [];
    return valid.length ? valid : [...DEFAULT_CHANNELS];
  } catch { return [...DEFAULT_CHANNELS]; }
}

const YZOOM_KEY = "d3-stack-yzoom";
const MAX_YZOOM = 8;
function loadYZoom() {
  try {
    const saved = JSON.parse(localStorage.getItem(YZOOM_KEY));
    if (!saved || typeof saved !== "object") return {};
    return Object.fromEntries(Object.entries(saved)
      .filter(([id, factor]) => id in STACK_CHANNELS && Number.isFinite(factor))
      .map(([id, factor]) => [id, Math.max(1, Math.min(MAX_YZOOM, factor))]));
  } catch { return {}; }
}
// Slider position 0..100 maps to a zoom factor of 1..8 on a log scale.
const sliderToFactor = (value) => 2 ** (value / 100 * Math.log2(MAX_YZOOM));
const factorToSlider = (factor) => Math.round(Math.log2(factor) / Math.log2(MAX_YZOOM) * 100);

export function createAnalysisPanels(ctx) {
  const { state, elements, t } = ctx;
  let selected = loadChannels();
  let selection = null; // { from, to } while a stretch is being dragged out
  let yZoom = loadYZoom();
  let cacheSource = null;
  const cache = new Map();

  // ---- Per-lap data: GPS channels on the same distance samples the other charts use ----
  function lapData(points, key) {
    const source = `${state.selectedSession?.id ?? ""}|${state.rival?.token ?? state.rival?.name ?? ""}`;
    if (source !== cacheSource) { cache.clear(); cacheSource = source; }
    if (points.length < 3) return null;
    const cacheKey = `${key}:${points.length}:${points[0].timeMs}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);
    const derived = deriveChannels(points);
    const byPoint = new Map(points.map((point, index) => [point, derived[index]]));
    const series = ctx.distancePoints(points, 1600).map(({ progress, point }) => ({ progress, point, d: byPoint.get(point) })).filter((item) => item.d);
    let length = 0;
    for (let index = 1; index < points.length; index++) {
      const step = distanceMeters(points[index - 1], points[index]);
      if (Number.isFinite(step) && step < 100) length += step;
    }
    const data = { key: cacheKey, series, length, channels: new Map() };
    cache.set(cacheKey, data);
    return data;
  }
  // The user's own laps share one cache entry whether they are shown as primary or comparison.
  const primaryData = () => lapData(ctx.lapPoints(state.selectedLapNumber), `o${state.selectedLapNumber}`);
  const comparisonData = () => (state.comparisonLapNumber
    ? lapData(ctx.comparisonLapPoints(), `${state.comparisonRival ? "r" : "o"}${state.comparisonLapNumber}`)
    : null);
  const memo = (key, build) => {
    if (!cache.has(key)) cache.set(key, build());
    return cache.get(key);
  };
  function delta() {
    const primary = primaryData(); const comparison = comparisonData();
    if (!primary || !comparison) return [];
    return memo(`delta|${primary.key}|${comparison.key}`, () => deltaSeries(primary.series, comparison.series, 800));
  }
  const inView = (progress) => progress >= state.chartView.start && progress <= state.chartView.end;

  // ---- Map colours ----
  // Colours are quantized into a few dozen shades so the map can draw runs of equal colour as one path,
  // and cached per lap pair: the map redraws on every cursor move.
  const quantize = (value, steps) => Math.round(value * steps) / steps;
  function mapColors(mode, primarySeries) {
    const primary = primaryData();
    if (mode === "speed") {
      const speeds = primarySeries.map((item) => item.point.speed).filter(Number.isFinite);
      if (!speeds.length) return { colors: null, legend: "" };
      return memo(`map|speed|${primary?.key}|${primarySeries.length}|${t("unit.speed")}`, () => {
        const min = Math.min(...speeds); const max = Math.max(...speeds);
        const ratio = (speed) => (Number.isFinite(speed) ? (speed - min) / Math.max(max - min, 1) : 0);
        return {
          colors: primarySeries.map((item) => ramp(SPEED_RAMP, quantize(ratio(item.point.speed), 31))),
          legend: `<span>${Math.round(min)}</span><i class="map-ramp"></i><span>${Math.round(max)} ${t("unit.speed")}</span>`,
        };
      });
    }
    if (mode === "delta") {
      const series = delta();
      if (!series.length) return { colors: null, legend: `<span>${t("map.needCompare")}</span>` };
      return memo(`map|delta|${primary?.key}|${comparisonData()?.key}|${primarySeries.length}|${t("map.gain", { lap: state.selectedLapNumber })}`, () => {
        const rate = deltaRate(series);
        const scale = Math.max(.5, percentile(rate.map((item) => Math.abs(item.value)), .95));
        const grey = [90, 91, 94]; const loss = [255, 59, 48]; const gain = [43, 217, 107];
        return {
          colors: primarySeries.map((item) => {
            const value = quantize(Math.max(-1, Math.min(1, rate[indexAt(rate, item.progress)].value / scale)), 16);
            return rgb(mix(grey, value > 0 ? loss : gain, Math.abs(value)));
          }),
          legend: `<span class="map-key gain">${t("map.gain", { lap: state.selectedLapNumber })}</span><span class="map-key loss">${t("map.loss", { lap: state.selectedLapNumber })}</span>`,
        };
      });
    }
    return { colors: null, legend: "" };
  }

  // ---- Channels (stacked traces) ----
  function renderChips() {
    elements.stackChannels.innerHTML = Object.keys(STACK_CHANNELS).map((id) => `<button type="button" class="stack-chip" data-channel="${id}" aria-pressed="${selected.includes(id)}">${t(`chan.${id}`)}</button>`).join("");
  }
  elements.stackChannels.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-channel]");
    if (!chip) return;
    const id = chip.dataset.channel;
    const next = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
    if (!next.some((item) => !STACK_CHANNELS[item].band)) return; // keep at least one trace
    selected = Object.keys(STACK_CHANNELS).filter((item) => next.includes(item));
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(selected)); } catch {}
    renderChips();
    drawStack();
  });

  const STACK_PADDING = { left: 76, right: 14, top: 6, bottom: 24 };
  const stackX = (progress, plotWidth) => STACK_PADDING.left + (progress - state.chartView.start) / Math.max(state.chartView.end - state.chartView.start, 1e-6) * plotWidth;
  function stackProgress(clientX) {
    const rect = elements.stackCanvas.getBoundingClientRect();
    const ratio = (clientX - rect.left - STACK_PADDING.left) / Math.max(rect.width - STACK_PADDING.left - STACK_PADDING.right, 1);
    return state.chartView.start + Math.max(0, Math.min(1, ratio)) * (state.chartView.end - state.chartView.start);
  }

  function seriesFor(id, data) {
    if (!data) return [];
    if (!data.channels.has(id)) data.channels.set(id, data.series.map((item) => ({ progress: item.progress, value: STACK_CHANNELS[id].value(item.d) })));
    return data.channels.get(id);
  }

  // The automatic scale, narrowed around its middle by the strip's slider (zero stays centred on ± channels).
  function scaleFor(channel, values, factor = 1) {
    const [min, max] = autoScale(channel, values);
    if (factor <= 1) return [min, max];
    const finite = values.filter(Number.isFinite);
    const center = min < 0 || !finite.length ? (min + max) / 2 : (Math.min(...finite) + Math.max(...finite)) / 2;
    const half = (max - min) / 2 / factor;
    const low = Math.max(min, Math.min(max - 2 * half, center - half));
    return [low, low + 2 * half];
  }
  function autoScale(channel, values) {
    const finite = values.filter(Number.isFinite);
    const peak = finite.length ? Math.max(...finite.map(Math.abs)) : 1;
    if (channel.scale === "speed") return [0, niceCeil(Math.max(...finite, 20), 20)];
    if (channel.scale === "radius") return [0, niceCeil(Math.min(300, Math.max(...finite, 20)), 50)];
    if (channel.scale === "positive") return [0, niceCeil(peak, .5)];
    const step = channel.unit === "°" ? 15 : channel.delta ? .1 : .5;
    const range = niceCeil(peak, step);
    return [-range, range];
  }

  let zoomLabel = "";
  function drawStack() {
    const canvas = elements.stackCanvas;
    if (!ctx.isOverlayFrame()) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
    }
    const primary = primaryData();
    const comparison = comparisonData();
    const zoom = `⤢ ${Math.round(100 / Math.max(state.chartView.end - state.chartView.start, .01))}%`;
    if (zoom !== zoomLabel) { zoomLabel = zoom; elements.stackZoomReset.textContent = zoom; }

    // Static layer: phase band, strips with scales, traces and channel names. Rebuilt only when the laps,
    // channels, zoom or size change; cursor frames reuse it.
    const { context, width, height, geometry } = ctx.paintLayers(canvas, ctx.canvasContext, (context, width, height) => {
      context.fillStyle = "#08080c"; context.fillRect(0, 0, width, height);
      if (!primary) return null;
      const plotWidth = width - STACK_PADDING.left - STACK_PADDING.right;
      const bands = selected.filter((id) => STACK_CHANNELS[id].band);
      const traces = selected.filter((id) => !STACK_CHANNELS[id].band);
      const bandHeight = 14;
      const traceArea = height - STACK_PADDING.top - STACK_PADDING.bottom - bands.length * (bandHeight + 4);
      const stripHeight = traceArea / Math.max(traces.length, 1);
      const clipPlot = (top, stripH) => { context.beginPath(); context.rect(STACK_PADDING.left, top, plotWidth, stripH); context.clip(); };
      context.font = FONT;

      // Sector boundaries across the whole stack.
      context.save();
      context.strokeStyle = "rgba(179,107,255,.4)"; context.setLineDash([4, 4]); context.lineWidth = 1;
      ctx.sectorFractions().forEach((fraction) => {
        if (!inView(fraction)) return;
        const x = stackX(fraction, plotWidth);
        context.beginPath(); context.moveTo(x, STACK_PADDING.top); context.lineTo(x, height - STACK_PADDING.bottom); context.stroke();
      });
      context.restore();

      let top = STACK_PADDING.top;
      // Phase band: braking / corner / acceleration / coasting of the primary lap.
      bands.forEach(() => {
        context.save(); clipPlot(top, bandHeight);
        primary.series.forEach((item, index) => {
          const next = primary.series[index + 1];
          if (!next) return;
          context.fillStyle = PHASE_COLORS[item.d.phase];
          const x = stackX(item.progress, plotWidth);
          context.fillRect(x, top, Math.max(1, stackX(next.progress, plotWidth) - x + .5), bandHeight);
        });
        context.restore();
        context.fillStyle = MUTED; context.textBaseline = "middle"; context.textAlign = "right";
        context.fillText(t("chan.phase"), STACK_PADDING.left - 8, top + bandHeight / 2);
        top += bandHeight + 4;
      });

      const deltaValues = traces.includes("delta") ? delta() : [];
      const strips = traces.map((id, index) => {
        const channel = STACK_CHANNELS[id];
        const primarySeries = channel.delta ? deltaValues : seriesFor(id, primary);
        const comparisonSeries = channel.delta ? [] : seriesFor(id, comparison);
        const visible = [...primarySeries, ...comparisonSeries].filter((item) => inView(item.progress)).map((item) => item.value);
        const factor = yZoom[id] ?? 1;
        const [min, max] = scaleFor(channel, visible, factor);
        const stripTop = top + index * stripHeight;
        const stripBottom = stripTop + stripHeight;
        // Zoomed in by the slider, values past the scale run off the strip (clipped) instead of flattening at its edge.
        const clamp = (value) => (factor > 1 ? value : Math.max(min, Math.min(max, value)));
        const y = (value) => stripTop + 18 + (max - clamp(value)) / Math.max(max - min, 1e-6) * (stripHeight - 24);
        context.strokeStyle = GRID; context.lineWidth = 1;
        context.beginPath(); context.moveTo(STACK_PADDING.left, stripBottom); context.lineTo(width - STACK_PADDING.right, stripBottom); context.stroke();
        if (min < 0) { context.strokeStyle = "rgba(255,255,255,.18)"; context.beginPath(); context.moveTo(STACK_PADDING.left, y(0)); context.lineTo(width - STACK_PADDING.right, y(0)); context.stroke(); }
        context.fillStyle = MUTED; context.textAlign = "right"; context.textBaseline = "middle";
        const digits = (channel.scale === "speed" || channel.scale === "radius" || channel.unit === "°" ? 0 : 1) + (factor >= 3 ? 1 : 0);
        context.fillText(max.toFixed(digits), STACK_PADDING.left - 8, y(max));
        context.fillText(min.toFixed(digits), STACK_PADDING.left - 8, y(min));

        const line = (series, color, lineWidth) => {
          if (series.length < 2) return;
          context.save(); clipPlot(stripTop, stripHeight);
          context.strokeStyle = color; context.lineWidth = lineWidth; context.beginPath();
          let drawing = false;
          series.forEach((item) => {
            if (!Number.isFinite(item.value)) { drawing = false; return; }
            const x = stackX(item.progress, plotWidth);
            if (drawing) context.lineTo(x, y(item.value)); else { context.moveTo(x, y(item.value)); drawing = true; }
          });
          context.stroke(); context.restore();
        };
        line(comparisonSeries, RED, 1.5);
        line(primarySeries, WHITE, 1.8);
        const unit = channel.unit.startsWith("unit.") ? t(channel.unit) : channel.unit;
        const strip = { id, channel, primarySeries, comparisonSeries, stripTop, stripHeight, y, name: `${t(`chan.${id}`)}, ${unit}` };
        drawStripLabel(context, strip, null);
        return strip;
      });

      // Distance axis.
      context.fillStyle = MUTED; context.textBaseline = "alphabetic";
      for (let tick = 0; tick <= 4; tick++) {
        const progress = state.chartView.start + (state.chartView.end - state.chartView.start) * tick / 4;
        context.textAlign = tick === 0 ? "left" : tick === 4 ? "right" : "center";
        context.fillText(`${Math.round(progress * 100)}%`, STACK_PADDING.left + tick / 4 * plotWidth, height - 7);
      }
      return { plotWidth, strips };
    });
    if (!geometry) { placeScaleSliders([]); renderReadout(null, null); return; }

    // Overlay: values under the cursor, the stretch being selected and the cursor line.
    const { plotWidth, strips } = geometry;
    if (!ctx.isOverlayFrame()) placeScaleSliders(strips);
    const cursor = state.cursorProgress;
    if (cursor !== null) strips.forEach((strip) => drawStripLabel(context, strip, cursor));
    const plotBottom = height - STACK_PADDING.bottom;
    if (selection) {
      const from = Math.max(STACK_PADDING.left, stackX(Math.min(selection.from, selection.to), plotWidth));
      const to = Math.min(width - STACK_PADDING.right, stackX(Math.max(selection.from, selection.to), plotWidth));
      context.fillStyle = "rgba(199,255,61,.1)";
      context.fillRect(from, STACK_PADDING.top, to - from, plotBottom - STACK_PADDING.top);
      context.strokeStyle = LIME; context.lineWidth = 1.2; context.setLineDash([5, 4]);
      [from, to].forEach((x) => { context.beginPath(); context.moveTo(x, STACK_PADDING.top); context.lineTo(x, plotBottom); context.stroke(); });
      context.setLineDash([]);
    }
    if (cursor !== null && inView(cursor)) {
      const x = stackX(cursor, plotWidth);
      context.strokeStyle = "rgba(255,255,255,.55)"; context.lineWidth = 1;
      context.beginPath(); context.moveTo(x, STACK_PADDING.top); context.lineTo(x, plotBottom); context.stroke();
    }
    renderReadout(primary, comparison);
  }

  // Channel name, and with a cursor the values of both laps, on a dark plate at the top of the strip.
  function drawStripLabel(context, strip, cursor) {
    const parts = [{ text: strip.name, color: MUTED }];
    if (cursor !== null) {
      const at = (series) => {
        if (!series.length) return null;
        const item = series[Math.max(0, Math.min(series.length - 1, indexAt(series, cursor)))];
        return Number.isFinite(item?.value) ? item.value.toFixed(strip.channel.digits) : "—";
      };
      const primaryValue = at(strip.primarySeries);
      const comparisonValue = at(strip.comparisonSeries);
      if (primaryValue !== null) parts.push({ text: `  ${primaryValue}`, color: WHITE });
      if (comparisonValue !== null) parts.push({ text: `  ${comparisonValue}`, color: RED });
    }
    context.font = FONT; context.textAlign = "left"; context.textBaseline = "alphabetic";
    const label = parts.map((part) => part.text).join("");
    context.fillStyle = "rgba(8,8,12,.92)";
    context.fillRect(STACK_PADDING.left + 4, strip.stripTop + 2, context.measureText(label).width + 8, 16);
    let x = STACK_PADDING.left + 8;
    parts.forEach((part) => { context.fillStyle = part.color; context.fillText(part.text, x, strip.stripTop + 14); x += context.measureText(part.text).width; });
  }

  let readoutHtml = "";
  function setReadout(html) {
    if (html === readoutHtml) return;
    readoutHtml = html;
    elements.stackReadout.innerHTML = html;
  }
  // While a stretch is being dragged out: its length and times. When zoomed in: the same for the visible part.
  function renderReadout(primary, comparison) {
    const zoomed = state.chartView.end - state.chartView.start < .999;
    if (!primary || (!selection && !zoomed)) {
      setReadout(`<span class="stack-hint">${t("measure.hint")}</span>${selected.includes("phase") ? `<span class="stack-hint">${t("phase.legend")}</span>` : ""}`);
      return;
    }
    const from = selection ? Math.min(selection.from, selection.to) : state.chartView.start;
    const to = selection ? Math.max(selection.from, selection.to) : state.chartView.end;
    const time = (data) => (data ? (timeAtProgress(data.series, to) - timeAtProgress(data.series, from)) / 1000 : null);
    const primaryTime = time(primary); const comparisonTime = time(comparison);
    const speeds = primary.series.filter((item) => item.progress >= from && item.progress <= to).map((item) => item.d.speed);
    const parts = [
      `<b class="stack-a">${Math.round(from * 100)}–${Math.round(to * 100)}%</b>`,
      `<span>${Math.round((to - from) * primary.length)} ${t("measure.meters")}</span>`,
      `<span class="val-primary">${t("measure.lap", { lap: state.selectedLapNumber })} ${primaryTime.toFixed(3)} ${t("unit.seconds")}</span>`,
    ];
    if (comparisonTime !== null) {
      const gap = primaryTime - comparisonTime;
      parts.push(`<span class="val-compare">${t("measure.lap", { lap: state.comparisonLapNumber })} ${comparisonTime.toFixed(3)} ${t("unit.seconds")}</span>`);
      parts.push(`<span class="${gap > 0 ? "loss" : "gain"}">Δ ${gap > 0 ? "+" : "−"}${Math.abs(gap).toFixed(3)} ${t("unit.seconds")}</span>`);
    }
    if (speeds.length) parts.push(`<span>${t("measure.min")} ${Math.round(Math.min(...speeds))} · ${t("measure.max")} ${Math.round(Math.max(...speeds))} ${t("unit.speed")}</span>`);
    const reset = selection ? "" : `<button type="button" class="stack-clear" data-stack-clear>${t("measure.clear")}</button>`;
    setReadout(parts.join("") + reset);
  }
  elements.stackReadout.addEventListener("click", (event) => {
    if (event.target.closest("[data-stack-clear]")) ctx.resetChartZoom();
  });

  // ---- Vertical scale sliders, one per strip, in the left gutter ----
  const scales = document.createElement("div");
  scales.className = "stack-scales";
  elements.stackCanvas.after(scales);
  // Inputs are kept per channel and only moved, so a slider being dragged is never replaced under the mouse.
  const scaleInputs = new Map();
  function placeScaleSliders(strips) {
    const ids = new Set(strips.map((strip) => strip.id));
    scaleInputs.forEach((input, id) => { if (!ids.has(id)) { input.remove(); scaleInputs.delete(id); } });
    strips.forEach((strip) => {
      let input = scaleInputs.get(strip.id);
      if (!input) {
        input = document.createElement("input");
        input.type = "range"; input.min = "0"; input.max = "100"; input.step = "1";
        input.className = "stack-scale";
        input.dataset.channel = strip.id;
        scaleInputs.set(strip.id, input);
        scales.append(input);
      }
      if (document.activeElement !== input) input.value = String(factorToSlider(yZoom[strip.id] ?? 1));
      input.title = t("chan.scale");
      input.setAttribute("aria-label", `${t("chan.scale")}: ${t(`chan.${strip.id}`)}`);
      const top = `${elements.stackCanvas.offsetTop + strip.stripTop + 20}px`;
      const height = `${Math.max(24, strip.stripHeight - 24)}px`;
      if (input.style.top !== top) input.style.top = top;
      if (input.style.height !== height) input.style.height = height;
    });
  }
  function setYZoom(id, factor) {
    const { [id]: _previous, ...rest } = yZoom;
    yZoom = factor > 1.001 ? { ...rest, [id]: factor } : rest;
    try { localStorage.setItem(YZOOM_KEY, JSON.stringify(yZoom)); } catch {}
    drawStack();
  }
  scales.addEventListener("input", (event) => {
    const input = event.target.closest(".stack-scale");
    if (input) setYZoom(input.dataset.channel, sliderToFactor(Number(input.value)));
  });
  scales.addEventListener("dblclick", (event) => {
    const input = event.target.closest(".stack-scale");
    if (!input) return;
    input.value = "0";
    setYZoom(input.dataset.channel, 1);
  });

  // Hover moves the shared cursor; dragging across the graph selects a stretch and zooms into it on release;
  // the wheel zooms the distance axis and a double click shows the whole lap again.
  {
    const canvas = elements.stackCanvas;
    const DRAG_PX = 6;
    let press = null;
    canvas.addEventListener("pointermove", (event) => {
      if (event.pointerType !== "mouse" && !press) return;
      const progress = stackProgress(event.clientX);
      if (press && (selection || Math.abs(event.clientX - press.x) >= DRAG_PX)) selection = { from: press.progress, to: progress };
      ctx.setCursorProgress(progress);
    });
    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      press = { x: event.clientX, progress: stackProgress(event.clientX) };
      canvas.setPointerCapture?.(event.pointerId);
      ctx.setCursorProgress(press.progress);
    });
    const finish = (apply) => {
      const range = selection;
      press = null; selection = null;
      if (apply && range && Math.abs(range.to - range.from) > 1e-4) {
        ctx.setChartRange(Math.min(range.from, range.to), Math.max(range.from, range.to));
      } else drawStack();
    };
    canvas.addEventListener("pointerup", () => finish(true));
    canvas.addEventListener("pointercancel", () => finish(false));
    window.addEventListener("keydown", (event) => { if (event.key === "Escape" && selection) finish(false); });
    canvas.addEventListener("pointerleave", (event) => { if (event.pointerType === "mouse" && !event.buttons) ctx.setCursorProgress(null); });
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      ctx.setChartZoom(stackProgress(event.clientX), (state.chartView.end - state.chartView.start) * Math.exp(event.deltaY * .0015));
    }, { passive: false });
    canvas.addEventListener("dblclick", ctx.resetChartZoom);
    elements.stackZoomReset.addEventListener("click", ctx.resetChartZoom);
  }

  // ---- G-G diagram ----
  let ggStatsHtml = null;
  function setGgStats(html) {
    if (html === ggStatsHtml) return;
    ggStatsHtml = html;
    elements.ggStats.innerHTML = html;
  }
  function drawGG() {
    const canvas = elements.ggCanvas;
    if (!ctx.isOverlayFrame()) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
    }
    const primary = primaryData();
    const comparison = comparisonData();
    // Static layer: rings, axes and every sample of both laps; cursor frames only add the two cursor dots.
    const { context, geometry } = ctx.paintLayers(canvas, ctx.canvasContext, (context, width, height) => {
    context.fillStyle = "#08080c"; context.fillRect(0, 0, width, height);
    if (!primary) { setGgStats(""); return null; }
    const visible = (data) => (data ? data.series.filter((item) => inView(item.progress)) : []);
    const primaryPoints = visible(primary);
    const comparisonPoints = visible(comparison);
    const peak = (items) => (items.length ? Math.max(...items.map((item) => item.d.combinedG)) : null);
    const range = niceCeil(Math.max(1, peak(primaryPoints) ?? 0, peak(comparisonPoints) ?? 0), .5);
    const radius = Math.max(20, Math.min(width, height) / 2 - 30);
    const cx = width / 2; const cy = height / 2;
    const toXY = (d) => [cx + d.latG / range * radius, cy - d.longG / range * radius];

    context.font = FONT; context.lineWidth = 1;
    for (let ring = .5; ring <= range + 1e-9; ring += .5) {
      const whole = Math.abs(ring - Math.round(ring)) < 1e-9;
      context.strokeStyle = whole ? "#2e2e3d" : GRID;
      context.beginPath(); context.arc(cx, cy, ring / range * radius, 0, Math.PI * 2); context.stroke();
      if (!whole) continue;
      // Ring values along the upper-right diagonal, clear of the axis labels.
      const offset = ring / range * radius * Math.SQRT1_2;
      context.fillStyle = MUTED; context.textAlign = "left"; context.textBaseline = "bottom";
      context.fillText(`${ring.toFixed(0)} g`, cx + offset + 3, cy - offset - 2);
    }
    context.strokeStyle = "#2e2e3d";
    context.beginPath(); context.moveTo(cx - radius, cy); context.lineTo(cx + radius, cy); context.moveTo(cx, cy - radius); context.lineTo(cx, cy + radius); context.stroke();
    context.fillStyle = MUTED; context.textAlign = "center";
    context.textBaseline = "bottom"; context.fillText(t("gg.accel"), cx, cy - radius - 6);
    context.textBaseline = "top"; context.fillText(t("gg.braking"), cx, cy + radius + 6);
    context.textBaseline = "middle"; context.textAlign = "right"; context.fillText(t("gg.left"), cx - radius - 6, cy);
    context.textAlign = "left"; context.fillText(t("gg.right"), cx + radius + 6, cy);

    const dots = (items, color) => {
      context.fillStyle = color;
      items.forEach((item) => { const [x, y] = toXY(item.d); context.fillRect(x - 1.2, y - 1.2, 2.4, 2.4); });
    };
    dots(comparisonPoints, "rgba(225,6,0,.45)");
    dots(primaryPoints, "rgba(244,244,238,.55)");
    const zoomed = state.chartView.end - state.chartView.start < .999;
    const primaryPeak = peak(primaryPoints); const comparisonPeak = peak(comparisonPoints);
    setGgStats(`${t("gg.peak")}${zoomed ? ` (${t("gg.visible")})` : ""}: <b class="val-primary">${primaryPeak?.toFixed(2) ?? "—"} g</b>${comparisonPeak !== null ? ` · <b class="val-compare">${comparisonPeak.toFixed(2)} g</b>` : ""}`);
    return { toXY };
    });
    if (!geometry) return;
    const { toXY } = geometry;
    const cursorDot = (data, color) => {
      if (!data || state.cursorProgress === null) return;
      const item = data.series[indexAt(data.series, state.cursorProgress)];
      if (!item) return;
      const [x, y] = toXY(item.d);
      context.fillStyle = color; context.beginPath(); context.arc(x, y, 5, 0, Math.PI * 2); context.fill();
      context.strokeStyle = "#ffffff"; context.lineWidth = 1.5; context.beginPath(); context.arc(x, y, 8, 0, Math.PI * 2); context.stroke();
    };
    cursorDot(comparison, RED);
    cursorDot(primary, WHITE);
  }

  function translate() { renderChips(); }
  ctx.onLanguageChange(() => { translate(); draw(); });
  translate();

  function draw() { drawStack(); drawGG(); }
  return { draw, mapColors };
}
