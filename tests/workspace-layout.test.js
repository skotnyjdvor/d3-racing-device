import test from "node:test";
import assert from "node:assert/strict";
import {
  PANELS, COLS, ROWS, MIN_W, MIN_H, DEFAULT_LAYOUT, PRESETS,
  normalizeLayout, moveItem, resizeItem, hidePanel, showPanel, visiblePanels,
} from "../src/domain/workspace-layout.js";

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
function assertValid(layout) {
  const seen = new Set();
  for (const item of layout.items) {
    assert.ok(PANELS.includes(item.id), item.id);
    assert.ok(!seen.has(item.id), `duplicate ${item.id}`);
    seen.add(item.id);
    assert.ok(Number.isInteger(item.x) && Number.isInteger(item.y) && Number.isInteger(item.w) && Number.isInteger(item.h));
    assert.ok(item.x >= 0 && item.y >= 0 && item.x + item.w <= COLS && item.y + item.h <= ROWS, JSON.stringify(item));
    assert.ok(item.w >= MIN_W && item.h >= MIN_H, JSON.stringify(item));
  }
  layout.items.forEach((a, i) => layout.items.slice(i + 1).forEach((b) => assert.ok(!overlap(a, b), `${a.id} overlaps ${b.id}`)));
  assert.deepEqual([...seen, ...layout.hidden].sort(), [...PANELS].sort());
}
const item = (layout, id) => layout.items.find((entry) => entry.id === id);
const grid = (items, hidden) => normalizeLayout({ items, hidden });

test("presets are valid layouts that fill the whole grid", () => {
  for (const layout of [DEFAULT_LAYOUT, ...Object.values(PRESETS)]) {
    assertValid(layout);
    assert.equal(layout.items.reduce((sum, entry) => sum + entry.w * entry.h, 0), COLS * ROWS);
  }
});

test("normalizeLayout repairs stored layouts instead of trusting them", () => {
  assert.deepEqual(normalizeLayout(null), DEFAULT_LAYOUT);
  assert.deepEqual(normalizeLayout("garbage"), DEFAULT_LAYOUT);
  assert.deepEqual(normalizeLayout({ items: [] }), DEFAULT_LAYOUT);
  const repaired = normalizeLayout({ items: [
    { id: "track", x: -3, y: 0, w: 99, h: 1.4 },     // clamped into the grid, min size
    { id: "track", x: 0, y: 0, w: 6, h: 4 },         // duplicate
    { id: "evil", x: 0, y: 0, w: 6, h: 4 },          // unknown
    { id: "delta", x: 0, y: 0, w: 6, h: 4 },         // overlaps track: moved to a free spot
  ], hidden: ["nope"] });
  assertValid(repaired);
  assert.deepEqual(item(repaired, "track"), { id: "track", x: 0, y: 0, w: COLS, h: MIN_H });
  assert.ok(item(repaired, "delta"));
});

test("old column layouts are converted to the grid", () => {
  const converted = normalizeLayout({
    columns: [
      { width: .5, panels: [{ id: "track", size: 1 }] },
      { width: .5, panels: [{ id: "stack", size: .6 }, { id: "gg", size: .4 }] },
    ],
    hidden: ["sectors", "telemetry", "delta", "insights"],
  });
  assertValid(converted);
  assert.deepEqual(item(converted, "track"), { id: "track", x: 0, y: 0, w: 12, h: 12 });
  assert.deepEqual(item(converted, "stack"), { id: "stack", x: 12, y: 0, w: 12, h: 7 });
  assert.deepEqual(item(converted, "gg"), { id: "gg", x: 12, y: 7, w: 12, h: 5 });
});

test("a panel can be resized on both axes; the space it frees stays free", () => {
  const start = grid([{ id: "track", x: 0, y: 0, w: 12, h: 12 }, { id: "stack", x: 12, y: 0, w: 12, h: 12 }], ["sectors", "gg", "telemetry", "delta", "insights"]);
  const smaller = resizeItem(start, "track", { x: 0, y: 0, w: 8, h: 6 });
  assertValid(smaller);
  assert.deepEqual(item(smaller, "track"), { id: "track", x: 0, y: 0, w: 8, h: 6 });
  assert.deepEqual(item(smaller, "stack"), item(start, "stack"));
  assert.deepEqual(item(start, "track"), { id: "track", x: 0, y: 0, w: 12, h: 12 }, "input is not mutated");
});

test("growing or moving into a neighbour pushes it to the nearest free spot", () => {
  const start = grid([
    { id: "track", x: 0, y: 0, w: 8, h: 6 },
    { id: "gg", x: 8, y: 0, w: 6, h: 6 },
  ], ["sectors", "stack", "telemetry", "delta", "insights"]);
  const wider = resizeItem(start, "track", { x: 0, y: 0, w: 12, h: 6 });
  assertValid(wider);
  assert.equal(item(wider, "track").w, 12);
  assert.ok(!overlap(item(wider, "track"), item(wider, "gg")));
  const moved = moveItem(start, "gg", 0, 0);
  assertValid(moved);
  assert.deepEqual(item(moved, "gg"), { id: "gg", x: 0, y: 0, w: 6, h: 6 });
  assert.ok(!overlap(item(moved, "gg"), item(moved, "track")));
});

test("a move or resize with no room for the others is refused", () => {
  const full = PRESETS.timing;
  const first = full.items[0];
  const tooBig = resizeItem(full, first.id, { x: 0, y: 0, w: COLS, h: ROWS });
  assert.equal(tooBig, full);
  assert.equal(moveItem(full, first.id, first.x, first.y), full, "no-op move returns the same layout");
});

test("sizes and positions are clamped to the grid and the minimum size", () => {
  const start = grid([{ id: "track", x: 0, y: 0, w: 8, h: 6 }], PANELS.filter((id) => id !== "track"));
  assert.deepEqual(item(resizeItem(start, "track", { x: 0, y: 0, w: 1, h: 1 }), "track"), { id: "track", x: 0, y: 0, w: MIN_W, h: MIN_H });
  assert.deepEqual(item(moveItem(start, "track", 50, 50), "track"), { id: "track", x: COLS - 8, y: ROWS - 6, w: 8, h: 6 });
});

test("in a full grid a moved panel swaps with a neighbour, shrinking it if needed", () => {
  const swapped = moveItem(PRESETS.timing, "track", 16, 0);
  assertValid(swapped);
  assert.equal(item(swapped, "track").x, 15);
  assert.equal(item(swapped, "stack").x, 7, "the channels take the old place of the map");
  const grown = resizeItem(PRESETS.timing, "track", { x: 7, y: 0, w: 13, h: 12 });
  assertValid(grown);
  assert.equal(item(grown, "track").w, 13);
  assert.ok(item(grown, "stack").w < 8, "the neighbour got smaller");
});

test("hiding and showing panels", () => {
  const hidden = hidePanel(DEFAULT_LAYOUT, "gg");
  assertValid(hidden);
  assert.ok(!visiblePanels(hidden).includes("gg"));
  const shown = showPanel(hidden, "gg");
  assertValid(shown);
  assert.ok(visiblePanels(shown).includes("gg"), "fits into the space gg left");
  assert.equal(showPanel(DEFAULT_LAYOUT, "insights"), DEFAULT_LAYOUT, "no free space: refused");
  let only = DEFAULT_LAYOUT;
  for (const id of visiblePanels(DEFAULT_LAYOUT).slice(1)) only = hidePanel(only, id);
  assert.equal(hidePanel(only, visiblePanels(only)[0]), only, "the last panel stays");
});
