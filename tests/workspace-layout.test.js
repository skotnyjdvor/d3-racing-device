import test from "node:test";
import assert from "node:assert/strict";
import {
  PANELS, DEFAULT_LAYOUT, PRESETS, MAX_COLUMNS,
  normalizeLayout, movePanel, hidePanel, showPanel, resizeColumns, resizePanels, visiblePanels,
} from "../src/domain/workspace-layout.js";

const sum = (values) => values.reduce((total, value) => total + value, 0);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);
const ids = (layout) => layout.columns.map((column) => column.panels.map((panel) => panel.id));

test("default layout and presets place every panel exactly once", () => {
  for (const layout of [DEFAULT_LAYOUT, ...Object.values(PRESETS)]) {
    const placed = [...visiblePanels(layout), ...layout.hidden];
    assert.deepEqual([...placed].sort(), [...PANELS].sort());
    close(sum(layout.columns.map((column) => column.width)), 1);
    layout.columns.forEach((column) => close(sum(column.panels.map((panel) => panel.size)), 1));
  }
});

test("normalizeLayout repairs stored layouts instead of trusting them", () => {
  assert.deepEqual(normalizeLayout(null), DEFAULT_LAYOUT);
  assert.deepEqual(normalizeLayout("garbage"), DEFAULT_LAYOUT);
  assert.deepEqual(normalizeLayout({ columns: [] }), DEFAULT_LAYOUT);
  const repaired = normalizeLayout({
    columns: [
      { width: 3, panels: [{ id: "track", size: 2 }, { id: "track", size: 1 }, { id: "evil", size: 1 }] },
      { width: -1, panels: [] },
      { width: 1, panels: [{ id: "delta", size: "x" }] },
    ],
    hidden: ["delta", "nope"],
  });
  assert.deepEqual(ids(repaired), [["track"], ["delta"]]);
  assert.deepEqual([...repaired.hidden].sort(), PANELS.filter((id) => id !== "track" && id !== "delta").sort());
  close(sum(repaired.columns.map((column) => column.width)), 1);
  close(repaired.columns[0].width, .75);
  repaired.columns.forEach((column) => close(sum(column.panels.map((panel) => panel.size)), 1));
});

test("normalizeLayout keeps at most MAX_COLUMNS columns", () => {
  const columns = PANELS.map((id) => ({ width: 1, panels: [{ id, size: 1 }] }));
  const layout = normalizeLayout({ columns, hidden: [] });
  assert.equal(layout.columns.length, MAX_COLUMNS);
  assert.deepEqual([...visiblePanels(layout), ...layout.hidden].sort(), [...PANELS].sort());
});

test("movePanel reorders inside a column and between columns", () => {
  const start = normalizeLayout({ columns: [{ width: .5, panels: [{ id: "track", size: .5 }, { id: "sectors", size: .5 }] }, { width: .5, panels: [{ id: "telemetry", size: .6 }, { id: "delta", size: .4 }] }], hidden: ["insights"] });
  assert.deepEqual(ids(movePanel(start, "sectors", { column: 0, index: 0 })), [["sectors", "track"], ["telemetry", "delta"]]);
  const moved = movePanel(start, "delta", { column: 0, index: 1 });
  assert.deepEqual(ids(moved), [["track", "delta", "sectors"], ["telemetry"]]);
  moved.columns.forEach((column) => close(sum(column.panels.map((panel) => panel.size)), 1));
  assert.deepEqual(ids(start), [["track", "sectors"], ["telemetry", "delta"]], "input is not mutated");
});

test("movePanel can open a new column and drops columns left empty", () => {
  const start = normalizeLayout({ columns: [{ width: .5, panels: [{ id: "track", size: 1 }] }, { width: .5, panels: [{ id: "telemetry", size: .5 }, { id: "delta", size: .5 }] }], hidden: ["sectors", "insights"] });
  const opened = movePanel(start, "delta", { newColumn: 0 });
  assert.deepEqual(ids(opened), [["delta"], ["track"], ["telemetry"]]);
  close(sum(opened.columns.map((column) => column.width)), 1);
  const merged = movePanel(start, "track", { column: 1, index: 2 });
  assert.deepEqual(ids(merged), [["telemetry", "delta", "track"]]);
  close(merged.columns[0].width, 1);
});

test("movePanel refuses a fifth column and unknown panels", () => {
  const four = normalizeLayout({ columns: ["track", "telemetry", "delta", "sectors"].map((id) => ({ width: .25, panels: [{ id, size: 1 }] })), hidden: ["insights"] });
  assert.equal(movePanel(four, "track", { newColumn: 4 }), four);
  assert.equal(movePanel(four, "nope", { column: 0, index: 0 }), four);
});

test("hidePanel and showPanel round-trip and never hide the last panel", () => {
  const hidden = hidePanel(DEFAULT_LAYOUT, "delta");
  assert.ok(hidden.hidden.includes("delta"));
  assert.ok(!visiblePanels(hidden).includes("delta"));
  const shown = showPanel(hidden, "delta");
  assert.ok(visiblePanels(shown).includes("delta"));
  assert.ok(!shown.hidden.includes("delta"));
  let only = DEFAULT_LAYOUT;
  for (const id of visiblePanels(DEFAULT_LAYOUT).slice(1)) only = hidePanel(only, id);
  assert.equal(visiblePanels(only).length, 1);
  assert.equal(hidePanel(only, visiblePanels(only)[0]), only);
});

test("resizeColumns and resizePanels move one border and respect the minimum", () => {
  const layout = normalizeLayout({ columns: [{ width: .5, panels: [{ id: "track", size: .5 }, { id: "delta", size: .5 }] }, { width: .5, panels: [{ id: "telemetry", size: 1 }] }], hidden: ["sectors", "insights"] });
  const wider = resizeColumns(layout, 0, .1, .15);
  close(wider.columns[0].width, .6); close(wider.columns[1].width, .4);
  const clamped = resizeColumns(layout, 0, .9, .15);
  close(clamped.columns[1].width, .15); close(clamped.columns[0].width, .85);
  const taller = resizePanels(layout, 0, 0, -.2, .1);
  close(taller.columns[0].panels[0].size, .3); close(taller.columns[0].panels[1].size, .7);
  assert.equal(resizeColumns(layout, 1, .1, .15), layout, "no border after the last column");
  assert.equal(resizePanels(layout, 1, 0, .1, .1), layout, "no border after the last panel");
});
