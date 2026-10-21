// Track map: grid, primary / comparison / extra laps (optionally coloured by speed or gain/loss), sector
// gates and numbers, corner names, AI markers and the cursor dots. Static content is painted once per
// change; cursor frames only add the dots (canvas-layers.js).
import { extraLapList } from "./extra-laps.js";
import { distancePoints, pointAtProgress } from "./lap-series.js";
import { createSatelliteLayer, mercatorY, satelliteOffsetKey, SATELLITE_ATTRIBUTION } from "./satellite.js";

export function createTrackMap(ctx) {
  const {
    state, elements, t, isOverlayFrame, paintLayers, canvasContext, trackAiMarkerAreas,
    lapPoints, comparisonLapPoints, extraLapPoints, sectorFractions, renderMapLegend, SECTOR_COLOR, redraw,
  } = ctx;
  const satellite = typeof Image === "function" && redraw ? createSatelliteLayer({ onLoad: redraw }) : null;
  const panels = ctx.analysisPanels;
  const corners = ctx.cornersPanel;

  return function drawTrackCanvas(canvas) {
    if (!isOverlayFrame()) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
    }
    // Static layer: grid, trajectories, sectors and AI markers. Cursor frames only redraw the cursor dots.
    const { context, geometry } = paintLayers(canvas, canvasContext, (context, width, height) => {
    trackAiMarkerAreas.set(canvas, []);
    context.fillStyle = "#08080c";
    context.fillRect(0, 0, width, height);
    const drawGrid = () => {
      context.strokeStyle = "rgba(255,255,255,.035)"; context.lineWidth = 1;
      const gridSize = width < 560 ? 38 : 52;
      for (let x = gridSize; x < width; x += gridSize) {
        context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke();
      }
      for (let y = gridSize; y < height; y += gridSize) {
        context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
      }
    };
    const primarySeries = distancePoints(lapPoints(state.selectedLapNumber), 1800);
    // The AI map of a single-lap report shows only that lap.
    const hideComparison = canvas === elements.aiTrackCanvas && state.aiReport?.analysisMode === "single-lap";
    const comparisonSeries = state.comparisonLapNumber && !hideComparison ? distancePoints(comparisonLapPoints(), 1800) : [];
    const extraSeries = canvas === elements.trackCanvas ? extraLapList(state).map((entry) => ({ series: distancePoints(extraLapPoints(entry), 1800), color: entry.color })) : [];
    const primaryPoints = primarySeries.map((item) => item.point);
    const comparisonPoints = comparisonSeries.map((item) => item.point);
    const boundsPoints = [...primaryPoints, ...comparisonPoints];
    if (primaryPoints.length < 2) {
      drawGrid();
      if (canvas === elements.trackCanvas) renderMapLegend("");
      context.fillStyle = "#8c8d93";
      context.font = "13px system-ui";
      context.fillText(t("track.canvasEmpty"), 24, 38);
      return null;
    }
    // Web Mercator (longitude, Mercator latitude) with one scale: true shape, and it matches satellite tiles.
    const lats = boundsPoints.map((point) => mercatorY(point.latitude));
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
    const toCanvas = (longitude, mercator) => {
      const baseX = offsetX + (longitude - minLon) * scale;
      const baseY = offsetY + (maxLat - mercator) * scale;
      return [
        width / 2 + (baseX - width / 2) * state.trackView.scale + state.trackView.offsetX,
        height / 2 + (baseY - height / 2) * state.trackView.scale + state.trackView.offsetY,
      ];
    };
    const project = (point) => toCanvas(point.longitude, mercatorY(point.latitude));
    // Satellite photo under the lines, dimmed so the trajectory stays the brightest thing on the map.
    // Photos and GPS can disagree by a few metres; the user's alignment for this place shifts the photo.
    const satelliteKey = satelliteOffsetKey(boundsPoints);
    const [shiftLon, shiftMercator] = state.satelliteOffsets?.[satelliteKey] ?? [0, 0];
    const photoToCanvas = (longitude, mercator) => toCanvas(longitude + shiftLon, mercator + shiftMercator);
    if (canvas === elements.trackCanvas) state.satelliteView = { key: satelliteKey, pixelsPerDegree: scale * state.trackView.scale };
    const onSatellite = Boolean(state.mapSatellite && satellite?.draw(context, width, height, photoToCanvas, scale * state.trackView.scale));
    if (onSatellite) {
      context.fillStyle = "rgba(8,8,12,.38)"; context.fillRect(0, 0, width, height);
    } else {
      drawGrid();
    }
    const halo = onSatellite ? "rgba(0,0,0,.55)" : "rgba(255,255,255,.08)";
    context.lineCap = "round"; context.lineJoin = "round";
    const drawTrajectory = (points, color, lineWidth) => {
      if (points.length < 2) return;
      context.strokeStyle = halo; context.lineWidth = lineWidth + 6; context.beginPath();
      points.forEach((point, index) => { const [x, y] = project(point); index ? context.lineTo(x, y) : context.moveTo(x, y); });
      context.stroke();
      context.strokeStyle = color; context.lineWidth = lineWidth; context.beginPath();
      points.forEach((point, index) => { const [x, y] = project(point); index ? context.lineTo(x, y) : context.moveTo(x, y); });
      context.stroke();
    };
    const coloring = canvas === elements.trackCanvas && state.mapMode !== "laps" && panels()
      ? panels().mapColors(state.mapMode, primarySeries)
      : { colors: null, legend: "" };
    if (canvas === elements.trackCanvas) renderMapLegend(coloring.legend);
    if (coloring.colors) {
      drawTrajectory(comparisonPoints, "rgba(225,6,0,.35)", 1.6);
      context.strokeStyle = halo; context.lineWidth = 10; context.beginPath();
      primaryPoints.forEach((point, index) => { const [x, y] = project(point); index ? context.lineTo(x, y) : context.moveTo(x, y); });
      context.stroke();
      context.lineWidth = 4.2;
      let runStart = 0;
      for (let index = 1; index <= primaryPoints.length; index++) {
        if (index < primaryPoints.length && coloring.colors[index] === coloring.colors[runStart] && index - runStart < 400) continue;
        const end = Math.min(index, primaryPoints.length - 1);
        context.strokeStyle = coloring.colors[runStart];
        context.beginPath();
        for (let point = runStart; point <= end; point++) { const [x, y] = project(primaryPoints[point]); point === runStart ? context.moveTo(x, y) : context.lineTo(x, y); }
        context.stroke();
        runStart = index;
      }
    } else {
      drawTrajectory(comparisonPoints, "#e10600", 2.6);
      drawTrajectory(primaryPoints, "#f4f4ee", 3.2);
    }

    extraSeries.forEach(({ series, color }) => {
      if (series.length < 2) return;
      context.save();
      context.strokeStyle = color; context.lineWidth = 2; context.setLineDash([7, 5]); context.beginPath();
      series.forEach((item, index) => { const [x, y] = project(item.point); index ? context.lineTo(x, y) : context.moveTo(x, y); });
      context.stroke(); context.restore();
    });

    if (canvas === elements.trackCanvas && state.sectors) {
      // Sector gates as short ticks across the line, sector numbers at the middle of each sector.
      context.save();
      state.sectors.gates.forEach((gate) => {
        const [ax, ay] = project(gate.a); const [bx, by] = project(gate.b); const [cx, cy] = project(gate.center);
        const length = Math.hypot(bx - ax, by - ay) || 1;
        const half = 11;
        const ux = (bx - ax) / length; const uy = (by - ay) / length;
        context.strokeStyle = "rgba(8,8,12,.9)"; context.lineWidth = 6;
        context.beginPath(); context.moveTo(cx - ux * half, cy - uy * half); context.lineTo(cx + ux * half, cy + uy * half); context.stroke();
        context.strokeStyle = SECTOR_COLOR; context.lineWidth = 3;
        context.beginPath(); context.moveTo(cx - ux * half, cy - uy * half); context.lineTo(cx + ux * half, cy + uy * half); context.stroke();
      });
      const bounds = [0, ...sectorFractions(), 1];
      context.font = "700 12px 'JetBrains Mono', ui-monospace, monospace";
      context.textAlign = "center"; context.textBaseline = "middle";
      bounds.slice(0, -1).forEach((start, index) => {
        const middle = (start + bounds[index + 1]) / 2;
        const here = pointAtProgress(primarySeries, middle)?.point;
        const ahead = pointAtProgress(primarySeries, Math.min(1, middle + .01))?.point;
        if (!here || !ahead) return;
        const [hx, hy] = project(here); const [nx, ny] = project(ahead);
        const length = Math.hypot(nx - hx, ny - hy) || 1;
        const x = hx - (ny - hy) / length * 22; const y = hy + (nx - hx) / length * 22;
        context.fillStyle = "rgba(8,8,12,.92)"; context.strokeStyle = SECTOR_COLOR; context.lineWidth = 1.5;
        context.beginPath(); context.roundRect(x - 15, y - 10, 30, 20, 4); context.fill(); context.stroke();
        context.fillStyle = SECTOR_COLOR; context.fillText(`S${index + 1}`, x, y + .5);
      });
      context.restore();
    }

    if (canvas === elements.trackCanvas && corners()) {
      // Corner names at the apexes, on the other side of the line from the sector numbers.
      context.save();
      context.font = "600 11px 'JetBrains Mono', ui-monospace, monospace";
      context.textAlign = "center"; context.textBaseline = "middle";
      corners().mapLabels().forEach(({ label, progress }) => {
        const here = pointAtProgress(primarySeries, progress)?.point;
        const ahead = pointAtProgress(primarySeries, Math.min(1, progress + .01))?.point;
        if (!here || !ahead) return;
        const [hx, hy] = project(here); const [nx, ny] = project(ahead);
        const length = Math.hypot(nx - hx, ny - hy) || 1;
        const x = hx + (ny - hy) / length * 20; const y = hy - (nx - hx) / length * 20;
        const textWidth = context.measureText(label).width;
        context.fillStyle = "rgba(8,8,12,.85)";
        context.beginPath(); context.roundRect(x - textWidth / 2 - 4, y - 8, textWidth + 8, 16, 3); context.fill();
        context.fillStyle = "#c9cad0"; context.fillText(label, x, y + .5);
      });
      context.restore();
    }

    const markerAreas = (state.aiReport?.timeLosses || []).map((item, index) => {
      const progress = Math.max(0, Math.min(1, Number(item.distancePercent) / 100));
      const markerPoint = pointAtProgress(primarySeries, progress)?.point;
      if (!markerPoint) return null;
      const [x, y] = project(markerPoint);
      const active = index === state.aiHoverIndex || index === state.aiSelectedIndex;
      const radius = active ? 13 : 10;
      context.save();
      context.shadowColor = "rgba(255,176,0,.85)"; context.shadowBlur = active ? 24 : 15;
      context.fillStyle = "#ffb000"; context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill();
      context.shadowBlur = 0; context.strokeStyle = active ? "#ffffff" : "rgba(255,255,255,.8)"; context.lineWidth = active ? 2.5 : 1.5;
      context.beginPath(); context.arc(x, y, radius + 4, 0, Math.PI * 2); context.stroke();
      context.fillStyle = "#080b10"; context.font = `900 ${active ? 14 : 12}px 'JetBrains Mono', ui-monospace, monospace`;
      context.textAlign = "center"; context.textBaseline = "middle"; context.fillText(String(index + 1), x, y + .5);
      context.restore();
      return { x, y, radius: radius + 8, index, progress };
    }).filter(Boolean);
    trackAiMarkerAreas.set(canvas, markerAreas);
    if (onSatellite) {
      context.save();
      context.font = "10px system-ui, sans-serif";
      context.textAlign = "right"; context.textBaseline = "bottom";
      const text = `© ${SATELLITE_ATTRIBUTION}`;
      const textWidth = context.measureText(text).width;
      context.fillStyle = "rgba(8,8,12,.7)"; context.fillRect(width - textWidth - 10, height - 16, textWidth + 10, 16);
      context.fillStyle = "rgba(244,244,238,.75)"; context.fillText(text, width - 5, height - 3);
      context.restore();
    }
    return { project, primarySeries, comparisonSeries, extraSeries };
    });
    if (!geometry) return;
    const { project, primarySeries, comparisonSeries, extraSeries } = geometry;
    extraSeries.forEach(({ series, color }) => {
      const point = pointAtProgress(series, state.cursorProgress)?.point;
      if (!point) return;
      const [x, y] = project(point);
      context.fillStyle = color; context.beginPath(); context.arc(x, y, 4, 0, Math.PI * 2); context.fill();
    });

    const drawCursorPoint = (series, color, shadow) => {
      const cursorPoint = pointAtProgress(series, state.cursorProgress)?.point;
      if (!cursorPoint) return;
      const [x, y] = project(cursorPoint);
      context.shadowColor = shadow; context.shadowBlur = 14;
      context.fillStyle = color; context.beginPath(); context.arc(x, y, 5.5, 0, Math.PI * 2); context.fill();
      context.shadowBlur = 0; context.strokeStyle = "#ffffff"; context.lineWidth = 1.5;
      context.beginPath(); context.arc(x, y, 8, 0, Math.PI * 2); context.stroke();
    };
    drawCursorPoint(comparisonSeries, "#e10600", "rgba(225,6,0,.8)");
    drawCursorPoint(primarySeries, "#f4f4ee", "rgba(244,244,238,.8)");

  }
}
