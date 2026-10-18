// Two-layer canvas painting for charts that redraw on every cursor move.
// A full paint draws the static content (grid, traces, dots), keeps a pixel snapshot of it and returns
// the geometry the overlay needs. Frames that only move the cursor ("overlay frames") blit the snapshot
// and draw the cursor on top, without recomputing or re-stroking the static content.

let overlayOnly = false;
const layers = new WeakMap(); // canvas -> { snapshot, geometry, width, height, ratio }

// Run `draw` as an overlay frame: canvases with a valid snapshot skip their static content.
export function overlayFrame(draw) {
  overlayOnly = true;
  try { draw(); } finally { overlayOnly = false; }
}

export const isOverlayFrame = () => overlayOnly;

// `prepare(canvas)` sizes and clears the canvas and returns { context, width, height } (CSS pixels).
// `paintStatic(context, width, height)` draws the static layer and returns the geometry for the overlay.
export function paintLayers(canvas, prepare, paintStatic) {
  const cached = layers.get(canvas);
  if (overlayOnly && cached && canvas.width === cached.snapshot.width && canvas.height === cached.snapshot.height) {
    // No layout read and no resize: the cursor moved, nothing else did.
    const context = canvas.getContext("2d");
    Object.assign(context, { shadowBlur: 0, shadowColor: "rgba(0,0,0,0)", lineCap: "butt", lineJoin: "miter", textAlign: "start", textBaseline: "alphabetic" });
    context.setLineDash([]);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1; context.globalCompositeOperation = "copy";
    context.drawImage(cached.snapshot, 0, 0);
    context.globalCompositeOperation = "source-over";
    context.setTransform(cached.ratio, 0, 0, cached.ratio, 0, 0);
    return { context, width: cached.width, height: cached.height, geometry: cached.geometry };
  }
  const { context, width, height } = prepare(canvas);
  const geometry = paintStatic(context, width, height) ?? null;
  const snapshot = cached?.snapshot ?? document.createElement("canvas");
  if (snapshot.width !== canvas.width) snapshot.width = canvas.width;
  if (snapshot.height !== canvas.height) snapshot.height = canvas.height;
  const snapshotContext = snapshot.getContext("2d");
  snapshotContext.globalCompositeOperation = "copy";
  snapshotContext.drawImage(canvas, 0, 0);
  snapshotContext.globalCompositeOperation = "source-over";
  const ratio = width > 0 ? canvas.width / width : 1;
  layers.set(canvas, { snapshot, geometry, width, height, ratio });
  return { context, width, height, geometry };
}
