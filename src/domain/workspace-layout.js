// Desktop workspace layout for the analysis screen: panels placed freely on a COLS x ROWS grid that
// fills the window. Every panel has its own x, y, width and height (in grid cells), so it can be
// resized on both axes. When a move or resize overlaps other panels, they go to the nearest free spot;
// if there is none, the change is refused. Free cells are allowed.
// Every function returns a new layout object and never mutates its input.

export const PANELS = ["sectors", "track", "stack", "gg", "corners", "telemetry", "delta", "insights"];
export const COLS = 24;
export const ROWS = 12;
export const MIN_W = 4;
export const MIN_H = 2;

const box = (id, x, y, w, h) => ({ id, x, y, w, h });
export const PRESETS = {
  // Timing screen: lap table and G-G on the left, map in the middle, stacked channels on the right.
  timing: { items: [box("sectors", 0, 0, 7, 7), box("gg", 0, 7, 7, 5), box("track", 7, 0, 9, 12), box("stack", 16, 0, 8, 12)], hidden: ["corners", "telemetry", "delta", "insights"] },
  // Big map with the channels and the lap table next to it.
  map: { items: [box("track", 0, 0, 14, 12), box("stack", 14, 0, 10, 7), box("sectors", 14, 7, 10, 5)], hidden: ["gg", "corners", "telemetry", "delta", "insights"] },
  // Channels first, map and G-G on the side.
  charts: { items: [box("stack", 0, 0, 15, 12), box("track", 15, 0, 9, 7), box("gg", 15, 7, 9, 5)], hidden: ["sectors", "corners", "telemetry", "delta", "insights"] },
  // Corner-by-corner: the corner table next to the map, channels below.
  corners: { items: [box("corners", 0, 0, 11, 12), box("track", 11, 0, 13, 6), box("stack", 11, 6, 13, 6)], hidden: ["sectors", "gg", "telemetry", "delta", "insights"] },
};
export const DEFAULT_LAYOUT = PRESETS.timing;

const clone = (layout) => ({ items: layout.items.map((item) => ({ ...item })), hidden: [...layout.hidden] });
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const clampRect = ({ x, y, w, h }) => {
  const width = Math.max(MIN_W, Math.min(COLS, Math.round(w)));
  const height = Math.max(MIN_H, Math.min(ROWS, Math.round(h)));
  return {
    x: Math.max(0, Math.min(COLS - width, Math.round(x))),
    y: Math.max(0, Math.min(ROWS - height, Math.round(y))),
    w: width,
    h: height,
  };
};

export const visiblePanels = (layout) => layout.items.map((item) => item.id);

// Nearest position (Manhattan distance from `near`) where a w x h box fits without overlapping `placed`.
function freeSpot(placed, w, h, near) {
  let best = null;
  for (let y = 0; y + h <= ROWS; y++) {
    for (let x = 0; x + w <= COLS; x++) {
      const candidate = { x, y, w, h };
      if (placed.some((item) => overlaps(item, candidate))) continue;
      const distance = Math.abs(x - near.x) + Math.abs(y - near.y);
      if (!best || distance < best.distance) best = { x, y, distance };
    }
  }
  return best;
}

// A displaced panel keeps its size if it can; otherwise it shrinks (largest area first, down to the
// minimum) to the nearest free spot. null when there is no room even at the minimum size.
function relocate(placed, item) {
  const exact = freeSpot(placed, item.w, item.h, item);
  if (exact) return { x: exact.x, y: exact.y, w: item.w, h: item.h };
  const sizes = [];
  for (let w = item.w; w >= MIN_W; w--) for (let h = item.h; h >= MIN_H; h--) sizes.push([w, h]);
  sizes.sort((a, b) => b[0] * b[1] - a[0] * a[1]);
  for (const [w, h] of sizes) {
    const spot = freeSpot(placed, w, h, item);
    if (spot) return { x: spot.x, y: spot.y, w, h };
  }
  return null;
}

// Put `id` at `rect`; panels it now overlaps move (and shrink if needed) to the nearest free spot,
// or the change is refused.
function place(layout, id, rect) {
  const moving = { id, ...rect };
  const others = layout.items.filter((item) => item.id !== id);
  const blocked = others.filter((item) => overlaps(item, moving)).sort((a, b) => a.y - b.y || a.x - b.x);
  const placed = [moving, ...others.filter((item) => !overlaps(item, moving))];
  for (const item of blocked) {
    const spot = relocate(placed, item);
    if (!spot) return null;
    placed.push({ ...item, ...spot });
  }
  const order = new Map(layout.items.map((item, index) => [item.id, index]));
  return { items: placed.sort((a, b) => order.get(a.id) - order.get(b.id)), hidden: [...layout.hidden] };
}

const same = (a, b) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

export function moveItem(layout, id, x, y) {
  const current = layout.items.find((item) => item.id === id);
  if (!current) return layout;
  const rect = clampRect({ x, y, w: current.w, h: current.h });
  if (same(rect, current)) return layout;
  return place(layout, id, rect) ?? layout;
}

export function resizeItem(layout, id, rect) {
  const current = layout.items.find((item) => item.id === id);
  if (!current) return layout;
  const next = clampRect(rect);
  if (same(next, current)) return layout;
  return place(layout, id, next) ?? layout;
}

export function hidePanel(layout, id) {
  if (!layout.items.some((item) => item.id === id) || layout.items.length <= 1) return layout;
  return { items: layout.items.filter((item) => item.id !== id).map((item) => ({ ...item })), hidden: [...layout.hidden, id] };
}

// A panel coming back takes the largest of a few sizes that still fits into free space.
export function showPanel(layout, id) {
  if (!layout.hidden.includes(id)) return layout;
  for (const [w, h] of [[8, 6], [8, 4], [6, 4], [MIN_W, 4], [MIN_W, MIN_H]]) {
    const spot = freeSpot(layout.items, w, h, { x: 0, y: 0 });
    if (spot) return { items: [...layout.items.map((item) => ({ ...item })), box(id, spot.x, spot.y, w, h)], hidden: layout.hidden.filter((hiddenId) => hiddenId !== id) };
  }
  return layout;
}

// Column layouts saved by earlier versions: widths become x/w, panel sizes become y/h.
function fromColumns(raw) {
  const columns = raw.columns.filter((column) => Array.isArray(column?.panels) && column.panels.length);
  const widths = columns.map((column) => (Number(column.width) > 0 ? Number(column.width) : 1));
  const totalWidth = widths.reduce((sum, value) => sum + value, 0) || 1;
  const items = [];
  let edge = 0;
  columns.forEach((column, index) => {
    const x = Math.round(edge / totalWidth * COLS);
    edge += widths[index];
    const right = Math.round(edge / totalWidth * COLS);
    const sizes = column.panels.map((panel) => (Number(panel.size) > 0 ? Number(panel.size) : 1));
    const totalSize = sizes.reduce((sum, value) => sum + value, 0) || 1;
    let top = 0;
    column.panels.forEach((panel, panelIndex) => {
      const y = Math.round(top / totalSize * ROWS);
      top += sizes[panelIndex];
      items.push({ id: panel?.id, x, y, w: right - x, h: Math.round(top / totalSize * ROWS) - y });
    });
  });
  return { items, hidden: raw.hidden };
}

// Accept a layout from storage only after checking every field; anything unusable falls back to the default.
export function normalizeLayout(raw) {
  if (raw && typeof raw === "object" && Array.isArray(raw.columns)) raw = fromColumns(raw);
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.items)) return clone(DEFAULT_LAYOUT);
  const placed = [];
  for (const candidate of raw.items) {
    const id = candidate?.id;
    if (!PANELS.includes(id) || placed.some((item) => item.id === id)) continue;
    const numbers = ["x", "y", "w", "h"].map((key) => Number(candidate[key]));
    if (numbers.some((value) => !Number.isFinite(value))) continue;
    let rect = clampRect({ x: numbers[0], y: numbers[1], w: numbers[2], h: numbers[3] });
    if (placed.some((item) => overlaps(item, rect))) {
      const spot = relocate(placed, rect);
      if (!spot) continue;
      rect = spot;
    }
    placed.push({ id, ...rect });
  }
  if (!placed.length) return clone(DEFAULT_LAYOUT);
  return { items: placed, hidden: PANELS.filter((id) => !placed.some((item) => item.id === id)) };
}
