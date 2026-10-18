// Desktop workspace layout for the analysis screen: columns of stacked panels.
// Widths of the columns and sizes of the panels inside a column are fractions that sum to 1.
// Every function returns a new layout object and never mutates its input.

export const PANELS = ["sectors", "track", "stack", "gg", "telemetry", "delta", "insights"];
export const MAX_COLUMNS = 4;

const column = (width, panels) => ({ width, panels: panels.map(([id, size]) => ({ id, size })) });

export const PRESETS = {
  // Timing screen: lap table and G-G on the left, map in the middle, stacked channels on the right.
  timing: { columns: [column(.28, [["sectors", .6], ["gg", .4]]), column(.36, [["track", 1]]), column(.36, [["stack", 1]])], hidden: ["telemetry", "delta", "insights"] },
  // Big map with the channels and the lap table next to it.
  map: { columns: [column(.58, [["track", 1]]), column(.42, [["stack", .62], ["sectors", .38]])], hidden: ["gg", "telemetry", "delta", "insights"] },
  // Channels first, map and G-G on the side.
  charts: { columns: [column(.62, [["stack", 1]]), column(.38, [["track", .55], ["gg", .45]])], hidden: ["sectors", "telemetry", "delta", "insights"] },
};
export const DEFAULT_LAYOUT = PRESETS.timing;

const clone = (layout) => ({
  columns: layout.columns.map((item) => ({ width: item.width, panels: item.panels.map((panel) => ({ ...panel })) })),
  hidden: [...layout.hidden],
});
const positive = (value) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null);
const scaled = (values) => {
  const total = values.reduce((sum, value) => sum + value, 0);
  return values.map((value) => value / total);
};
const withWidths = (columns) => scaled(columns.map((item) => item.width)).map((width, index) => ({ ...columns[index], width }));
const withSizes = (item) => ({ ...item, panels: scaled(item.panels.map((panel) => panel.size)).map((size, index) => ({ ...item.panels[index], size })) });
// Drop empty columns and make every set of fractions sum to 1 again.
const tidy = (layout) => ({ columns: withWidths(layout.columns.filter((item) => item.panels.length).map(withSizes)), hidden: layout.hidden });

export const visiblePanels = (layout) => layout.columns.flatMap((item) => item.panels.map((panel) => panel.id));

// Accept a layout from storage only after checking every field; anything unusable falls back to the default.
export function normalizeLayout(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.columns)) return clone(DEFAULT_LAYOUT);
  const seen = new Set();
  const columns = [];
  for (const candidate of raw.columns) {
    if (!candidate || typeof candidate !== "object" || !Array.isArray(candidate.panels)) continue;
    const panels = [];
    for (const panel of candidate.panels) {
      const id = panel?.id;
      if (!PANELS.includes(id) || seen.has(id)) continue;
      if (columns.length >= MAX_COLUMNS) continue;
      seen.add(id);
      panels.push({ id, size: positive(panel.size) ?? 1 });
    }
    if (panels.length) columns.push({ width: positive(candidate.width) ?? 1 / Math.max(1, raw.columns.length), panels });
  }
  if (!columns.length) return clone(DEFAULT_LAYOUT);
  return tidy({ columns, hidden: PANELS.filter((id) => !seen.has(id)) });
}

function locate(layout, id) {
  for (let columnIndex = 0; columnIndex < layout.columns.length; columnIndex++) {
    const index = layout.columns[columnIndex].panels.findIndex((panel) => panel.id === id);
    if (index >= 0) return { column: columnIndex, index };
  }
  return null;
}

// target is { column, index } (index in that column as it is now) or { newColumn } (position among the columns now).
export function movePanel(layout, id, target) {
  const from = locate(layout, id);
  if (!from) return layout;
  if (target?.newColumn !== undefined) {
    if (layout.columns.length >= MAX_COLUMNS) return layout;
    const position = Math.max(0, Math.min(layout.columns.length, Math.trunc(target.newColumn)));
    const columns = layout.columns.map((item, columnIndex) => (columnIndex === from.column ? { ...item, panels: item.panels.filter((panel) => panel.id !== id) } : item));
    const fresh = { width: 1 / layout.columns.length, panels: [{ id, size: 1 }] };
    columns.splice(position, 0, fresh);
    return tidy({ columns, hidden: [...layout.hidden] });
  }
  const targetColumn = layout.columns[target?.column];
  if (!targetColumn) return layout;
  let index = Math.max(0, Math.min(targetColumn.panels.length, Math.trunc(target.index ?? targetColumn.panels.length)));
  if (target.column === from.column && from.index < index) index -= 1;
  const columns = layout.columns.map((item) => ({ ...item, panels: [...item.panels] }));
  const [moving] = columns[from.column].panels.splice(from.index, 1);
  const destination = columns[target.column].panels;
  if (target.column === from.column) {
    // Reordering inside one column keeps every panel's height.
    destination.splice(index, 0, moving);
  } else {
    // A panel joining a column takes an equal share; the others shrink proportionally.
    const share = 1 / (destination.length + 1);
    const total = destination.reduce((sum, item) => sum + item.size, 0);
    columns[target.column].panels = destination.map((panel) => ({ ...panel, size: panel.size / total * (1 - share) }));
    columns[target.column].panels.splice(index, 0, { ...moving, size: share });
  }
  return tidy({ columns, hidden: [...layout.hidden] });
}

export function hidePanel(layout, id) {
  const from = locate(layout, id);
  if (!from || visiblePanels(layout).length <= 1) return layout;
  const columns = layout.columns.map((item, columnIndex) => (columnIndex === from.column ? { ...item, panels: item.panels.filter((panel) => panel.id !== id) } : item));
  return tidy({ columns, hidden: [...layout.hidden, id] });
}

// A panel coming back goes to the end of the least crowded column (the rightmost one on a tie).
export function showPanel(layout, id) {
  if (!layout.hidden.includes(id)) return layout;
  let target = 0;
  layout.columns.forEach((item, columnIndex) => { if (item.panels.length <= layout.columns[target].panels.length) target = columnIndex; });
  const columns = layout.columns.map((item, columnIndex) => {
    if (columnIndex !== target) return item;
    const share = 1 / (item.panels.length + 1);
    return { ...item, panels: [...item.panels.map((panel) => ({ ...panel, size: panel.size * (1 - share) })), { id, size: share }] };
  });
  return tidy({ columns, hidden: layout.hidden.filter((hiddenId) => hiddenId !== id) });
}

const shiftBorder = (values, index, delta, min) => {
  const total = values[index] + values[index + 1];
  const first = Math.max(min, Math.min(total - min, values[index] + delta));
  return values.map((value, position) => (position === index ? first : position === index + 1 ? total - first : value));
};

// Move the border between column `index` and the next one by `delta` (a fraction of the whole width).
export function resizeColumns(layout, index, delta, min = .12) {
  if (index < 0 || index + 1 >= layout.columns.length) return layout;
  const widths = shiftBorder(layout.columns.map((item) => item.width), index, delta, min);
  return { columns: layout.columns.map((item, position) => ({ ...item, width: widths[position] })), hidden: [...layout.hidden] };
}

// Move the border between panel `index` and the next one in a column by `delta` (a fraction of the column height).
export function resizePanels(layout, columnIndex, index, delta, min = .12) {
  const target = layout.columns[columnIndex];
  if (!target || index < 0 || index + 1 >= target.panels.length) return layout;
  const sizes = shiftBorder(target.panels.map((panel) => panel.size), index, delta, min);
  return {
    columns: layout.columns.map((item, position) => (position === columnIndex ? { ...item, panels: item.panels.map((panel, panelIndex) => ({ ...panel, size: sizes[panelIndex] })) } : item)),
    hidden: [...layout.hidden],
  };
}
