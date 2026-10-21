// Speed / g-force and delta charts along the lap distance: sector markers, zoom (wheel, pinch, drag
// selection via setChartRange) and the cursor that follows the pointer.
import { canvasContext, paintLayers } from "./canvas-layers.js";
import { deltaSeries } from "./domain/delta.js";
import { distancePoints, pointAtProgress } from "./lap-series.js";
import { speedUnit, toSpeed } from "./units.js";

export function createLapCharts(ctx) {
  const {
    state, elements, t, lapPoints, comparisonLapPoints, drawCharts, setCursorProgress,
  } = ctx;

  // Sector boundaries as distance fractions of the primary lap (falls back to the reference gates).
  function sectorFractions() {
    const sectors = state.sectors;
    if (!sectors) return [];
    return sectors.laps.find((lap) => lap.number === state.selectedLapNumber)?.gateFractions ?? sectors.gates.map((gate) => gate.fraction);
  }

  function drawSectorMarkers(context, padding, plotWidth, height) {
    const fractions = sectorFractions();
    if (!fractions.length) return;
    const bounds = [0, ...fractions, 1];
    context.save();
    context.beginPath(); context.rect(padding.left, 0, plotWidth, height); context.clip();
    context.font = "12px 'JetBrains Mono', ui-monospace, monospace";
    context.textBaseline = "alphabetic";
    bounds.slice(0, -1).forEach((start, index) => {
      const xStart = chartX(start, padding, plotWidth);
      if (index) {
        context.strokeStyle = "rgba(179,107,255,.55)"; context.lineWidth = 1; context.setLineDash([4, 4]);
        context.beginPath(); context.moveTo(xStart, padding.top); context.lineTo(xStart, height - padding.bottom); context.stroke();
        context.setLineDash([]);
      }
      // Labels sit in the band above the plot, so traces and the delta legend never cover them.
      context.fillStyle = "rgba(179,107,255,.85)";
      context.textAlign = "left";
      context.fillText(`S${index + 1}`, Math.max(padding.left, xStart) + 6, padding.top - 6);
    });
    context.restore();
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

  // Show exactly [start, end] of the lap (a stretch selected with the mouse).
  function setChartRange(start, end) {
    const span = Math.max(.02, Math.min(1, end - start));
    const from = Math.max(0, Math.min(1 - span, start));
    state.chartView = { start: from, end: from + span };
    elements.chartZoomReset.textContent = `${Math.round(100 / span)}%`;
    drawCharts();
  }

  function resetChartZoom() {
    state.chartView = { start: 0, end: 1 };
    elements.chartZoomReset.textContent = "100%";
    drawCharts();
  }

  const seriesCache = new WeakMap();
  function distanceSeries(points, key) {
    let byKey = seriesCache.get(points);
    if (!byKey) { byKey = new Map(); seriesCache.set(points, byKey); }
    if (!byKey.has(key)) byKey.set(key, distancePoints(points).map((item) => ({ progress: item.progress, value: item.point[key] })));
    return byKey.get(key);
  }

  function drawComparisonChart(canvas, key, { speed = false } = {}) {
    // Static layer: grid, sectors and both traces. Cursor frames only redraw the cursor line and values.
    const { context, width, height, geometry } = paintLayers(canvas, canvasContext, (context, width, height) => {
    context.fillStyle = "#08080c"; context.fillRect(0, 0, width, height);
    // Speeds in the chosen unit (the cached series stay in km/h).
    const shown = (series) => (speed && speedUnit() !== "kmh" ? series.map((item) => ({ ...item, value: toSpeed(item.value) })) : series);
    const primary = shown(distanceSeries(lapPoints(state.selectedLapNumber), key));
    const comparison = state.comparisonLapNumber ? shown(distanceSeries(comparisonLapPoints(), key)) : [];
    if (primary.length < 2) return null;

    const padding = { left: 48, right: 18, top: 24, bottom: 30 };
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
    context.font = "12px 'JetBrains Mono', ui-monospace, monospace"; context.fillStyle = "#8c8d93"; context.strokeStyle = "#1f1f2a"; context.lineWidth = 1;
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
    drawSectorMarkers(context, padding, plotWidth, height);
    draw(comparison, "#e10600", 1.9);
    draw(primary, "#f4f4ee", 2.2);
    return { primary, comparison, padding, plotWidth, y };
    });
    if (!geometry) return;
    const { primary, comparison, padding, plotWidth, y } = geometry;

    if (state.cursorProgress !== null && state.cursorProgress >= state.chartView.start && state.cursorProgress <= state.chartView.end) {
      const xPosition = chartX(state.cursorProgress, padding, plotWidth);
      context.strokeStyle = "rgba(255,255,255,.55)"; context.lineWidth = 1;
      context.beginPath(); context.moveTo(xPosition, padding.top); context.lineTo(xPosition, height - padding.bottom); context.stroke();
      const markers = [
        { item: pointAtProgress(primary, state.cursorProgress), color: "#f4f4ee", side: -1 },
        { item: pointAtProgress(comparison, state.cursorProgress), color: "#e10600", side: 1 },
      ];
      markers.forEach(({ item, color, side }) => {
        if (!item || !Number.isFinite(item.value)) return;
        const yPosition = y(item.value);
        context.fillStyle = color; context.beginPath(); context.arc(xPosition, yPosition, 4.5, 0, Math.PI * 2); context.fill();
        const label = speed ? `${item.value.toFixed(1)}` : `${item.value.toFixed(2)} g`;
        context.font = "bold 12px 'JetBrains Mono', ui-monospace, monospace";
        const labelWidth = context.measureText(label).width + 10;
        const labelX = Math.max(padding.left, Math.min(width - padding.right - labelWidth, xPosition + side * 8 - (side < 0 ? labelWidth : 0)));
        context.fillStyle = "rgba(8,8,12,.92)"; context.fillRect(labelX, yPosition - 20, labelWidth, 17);
        context.fillStyle = color; context.fillText(label, labelX + 5, yPosition - 8);
      });
    }
  }

  // The delta curve for a pair of laps, cached by their (stable) distance series.
  const deltaCache = new WeakMap();
  function cachedDelta(primary, comparison) {
    let byComparison = deltaCache.get(primary);
    if (!byComparison) { byComparison = new WeakMap(); deltaCache.set(primary, byComparison); }
    if (!byComparison.has(comparison)) byComparison.set(comparison, deltaSeries(primary, comparison, 800));
    return byComparison.get(comparison);
  }

  function drawDeltaChart() {
    // Static layer: grid, sectors, the delta curve and its legend. Cursor frames only redraw the cursor.
    const { context, width, height, geometry } = paintLayers(elements.deltaCanvas, canvasContext, (context, width, height) => {
    context.fillStyle = "#08080c"; context.fillRect(0, 0, width, height);
    if (!state.selectedLapNumber || !state.comparisonLapNumber) {
      context.fillStyle = "#8c8d93";
      context.font = "13px system-ui";
      context.fillText(t("telemetry.deltaEmpty"), 24, 38);
      return null;
    }
    const primary = distancePoints(lapPoints(state.selectedLapNumber));
    const comparison = distancePoints(comparisonLapPoints());
    if (primary.length < 2 || comparison.length < 2) return null;
    const delta = cachedDelta(primary, comparison);
    if (delta.length < 2) return null;

    const padding = { left: 52, right: 18, top: 24, bottom: 30 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const range = Math.max(.1, Math.ceil(Math.max(...delta.map((item) => Math.abs(item.value))) * 10) / 10);
    const y = (value) => padding.top + (range - value) / (range * 2) * plotHeight;
    context.font = "12px 'JetBrains Mono', ui-monospace, monospace"; context.fillStyle = "#8c8d93"; context.lineWidth = 1;
    [-range, 0, range].forEach((value) => {
      const yPosition = y(value);
      context.strokeStyle = value === 0 ? "rgba(255,255,255,.28)" : "#1f1f2a";
      context.beginPath(); context.moveTo(padding.left, yPosition); context.lineTo(width - padding.right, yPosition); context.stroke();
      context.fillText(`${value > 0 ? "+" : ""}${value.toFixed(1)}`, 10, yPosition + 3);
    });
    for (let tick = 0; tick <= 4; tick += 1) {
      const progress = state.chartView.start + (state.chartView.end - state.chartView.start) * tick / 4;
      const xPosition = padding.left + tick / 4 * plotWidth;
      context.fillText(`${Math.round(progress * 100)}%`, xPosition - (tick === 4 ? 24 : 8), height - 9);
    }

    // Sign legend on a dark plate so the delta line never crosses the text.
    const signLabel = (text, baseline) => {
      const labelWidth = context.measureText(text).width;
      const right = width - padding.right - 6;
      context.fillStyle = "rgba(8,8,12,.88)";
      context.fillRect(right - labelWidth - 6, baseline - 12, labelWidth + 12, 17);
      context.fillStyle = "#8c8d93";
      context.fillText(text, right - labelWidth, baseline);
    };

    drawSectorMarkers(context, padding, plotWidth, height);
    const zeroY = y(0);
    context.save();
    context.beginPath(); context.rect(padding.left, padding.top, plotWidth, plotHeight); context.clip();
    context.beginPath(); context.moveTo(chartX(delta[0].progress, padding, plotWidth), zeroY);
    delta.forEach((item) => context.lineTo(chartX(item.progress, padding, plotWidth), y(item.value)));
    context.lineTo(chartX(delta.at(-1).progress, padding, plotWidth), zeroY); context.closePath();
    context.fillStyle = "rgba(244,244,238,.06)"; context.fill();
    context.strokeStyle = "#f4f4ee"; context.lineWidth = 2.2; context.beginPath();
    delta.forEach((item, index) => {
      const xPosition = chartX(item.progress, padding, plotWidth);
      const yPosition = y(item.value);
      index ? context.lineTo(xPosition, yPosition) : context.moveTo(xPosition, yPosition);
    });
    context.stroke();
    context.restore();
    signLabel(t("delta.behind", { lap: state.selectedLapNumber }), padding.top + 14);
    signLabel(t("delta.ahead", { lap: state.selectedLapNumber }), height - padding.bottom - 6);
    return { delta, padding, plotWidth, y };
    });
    if (!geometry) return;
    const { delta, padding, plotWidth, y } = geometry;

    if (state.cursorProgress !== null && state.cursorProgress >= state.chartView.start && state.cursorProgress <= state.chartView.end) {
      const item = pointAtProgress(delta, state.cursorProgress);
      const xPosition = chartX(state.cursorProgress, padding, plotWidth);
      context.strokeStyle = "rgba(255,255,255,.55)"; context.lineWidth = 1;
      context.beginPath(); context.moveTo(xPosition, padding.top); context.lineTo(xPosition, height - padding.bottom); context.stroke();
      context.fillStyle = "#f4f4ee"; context.beginPath(); context.arc(xPosition, y(item.value), 4.5, 0, Math.PI * 2); context.fill();
      const label = `${item.value >= 0 ? "+" : ""}${item.value.toFixed(3)} s`;
      context.font = "bold 12px 'JetBrains Mono', ui-monospace, monospace";
      const labelWidth = context.measureText(label).width + 10;
      const labelX = Math.min(width - padding.right - labelWidth, Math.max(padding.left, xPosition + 8));
      context.fillStyle = "rgba(8,8,12,.92)"; context.fillRect(labelX, y(item.value) - 21, labelWidth, 17);
      context.fillStyle = "#f4f4ee"; context.fillText(label, labelX + 5, y(item.value) - 9);
    }
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

  return { sectorFractions, setChartZoom, setChartRange, resetChartZoom, drawComparisonChart, drawDeltaChart };
}
