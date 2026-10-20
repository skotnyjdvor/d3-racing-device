import test from "node:test";
import assert from "node:assert/strict";
import { PRESETS, normalizeLayout } from "../src/domain/workspace-layout.js";
import {
  DEFAULT_SHEETS, MAX_SHEETS, activeLayout, addSheet, normalizeSheets, removeSheet, renameSheet, setActive, sheetLabel, updateActiveLayout,
} from "../src/domain/workspace-sheets.js";

const t = (key, params) => (key === "ws.sheet" ? `Sheet ${params.n}` : key);

test("defaults: four preset sheets, the first one active", () => {
  const sheets = normalizeSheets(null);
  assert.equal(sheets.active, 0);
  assert.deepEqual(sheets.sheets.map((sheet) => sheet.preset), ["timing", "corners", "charts", "report"]);
  assert.deepEqual(activeLayout(sheets), normalizeLayout(PRESETS.timing));
  assert.equal(sheetLabel(sheets.sheets[1], 1, t), "ws.preset.corners");
});

test("a layout from the single-layout version becomes the first sheet", () => {
  const legacy = { items: [{ id: "track", x: 0, y: 0, w: 24, h: 12 }], hidden: [] };
  const sheets = normalizeSheets(null, legacy);
  assert.deepEqual(activeLayout(sheets).items, [{ id: "track", x: 0, y: 0, w: 24, h: 12 }]);
  assert.equal(sheetLabel(sheets.sheets[0], 0, t), "Sheet 1");
  assert.equal(sheets.sheets.length, DEFAULT_SHEETS.sheets.length);
});

test("stored sheets are checked: bad names, presets, layouts and active index are repaired", () => {
  const sheets = normalizeSheets({ active: 7, sheets: [{ name: "  Pilot view that is far too long for a tab  ", preset: "nope", layout: "garbage" }, { name: 5, preset: "map", layout: null }] });
  assert.equal(sheets.active, 0);
  assert.equal(sheets.sheets[0].name, "Pilot view that is far t");
  assert.equal(sheets.sheets[0].preset, null);
  assert.ok(sheets.sheets[0].layout.items.length);
  assert.equal(sheets.sheets[1].name, null);
  assert.equal(sheets.sheets[1].preset, "map");
});

test("add copies the active layout, switch, rename, remove", () => {
  let sheets = normalizeSheets(null);
  const copy = addSheet(sheets);
  assert.equal(copy.active, 4);
  assert.deepEqual(activeLayout(copy), activeLayout(sheets));
  assert.equal(sheets.sheets.length, 4, "input is not mutated");
  sheets = setActive(copy, 1);
  assert.equal(sheets.active, 1);
  assert.equal(setActive(sheets, 99), sheets);
  sheets = renameSheet(sheets, 1, " Corners ");
  assert.equal(sheetLabel(sheets.sheets[1], 1, t), "Corners");
  assert.equal(sheetLabel(renameSheet(sheets, 1, "   ").sheets[1], 1, t), "Sheet 2", "an empty name falls back to the number");
  const layout = normalizeLayout(PRESETS.map);
  sheets = updateActiveLayout(sheets, layout);
  assert.deepEqual(sheets.sheets[1].layout, layout);
  assert.deepEqual(sheets.sheets[0].layout, normalizeLayout(PRESETS.timing));
  const removed = removeSheet(sheets, 0);
  assert.equal(removed.sheets.length, 4);
  assert.equal(removed.active, 0, "the active sheet stays active after an earlier one is removed");
  assert.equal(removeSheet(removed, 2).active, 0);
});

test("limits: at most MAX_SHEETS sheets, the last sheet cannot be removed", () => {
  let sheets = normalizeSheets(null);
  while (sheets.sheets.length < MAX_SHEETS) sheets = addSheet(sheets);
  assert.equal(addSheet(sheets), sheets);
  let one = normalizeSheets(null);
  one = removeSheet(removeSheet(removeSheet(one, 0), 0), 0);
  assert.equal(one.sheets.length, 1);
  assert.equal(removeSheet(one, 0), one);
});
