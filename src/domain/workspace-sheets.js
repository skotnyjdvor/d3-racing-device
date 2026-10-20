// Named sheets of the desktop workspace (like MoTeC i2 worksheets): each sheet keeps its own layout,
// one of them is active. Sheets made from a preset show the preset's (translated) name until renamed.
// Every function returns a new object and never mutates its input.

import { PRESETS, normalizeLayout } from "./workspace-layout.js";

export const MAX_SHEETS = 8;
export const MAX_NAME = 24;

const sheetFromPreset = (preset) => ({ name: null, preset, layout: normalizeLayout(PRESETS[preset]) });
export const DEFAULT_SHEETS = { active: 0, sheets: ["timing", "corners", "charts", "report"].map(sheetFromPreset) };

const cleanName = (name) => (typeof name === "string" && name.trim() ? name.trim().slice(0, MAX_NAME) : null);

// Accept stored sheets only after checking them. A layout saved by the single-layout version becomes
// the first sheet, followed by the default sheets.
export function normalizeSheets(raw, legacyLayout = null) {
  if (raw && typeof raw === "object" && Array.isArray(raw.sheets) && raw.sheets.length) {
    const sheets = raw.sheets.slice(0, MAX_SHEETS).map((sheet) => ({
      name: cleanName(sheet?.name),
      preset: typeof sheet?.preset === "string" && sheet.preset in PRESETS ? sheet.preset : null,
      layout: normalizeLayout(sheet?.layout),
    }));
    const active = Number.isInteger(raw.active) && raw.active >= 0 && raw.active < sheets.length ? raw.active : 0;
    return { active, sheets };
  }
  if (legacyLayout) {
    return { active: 0, sheets: [{ name: null, preset: null, layout: normalizeLayout(legacyLayout) }, ...DEFAULT_SHEETS.sheets.slice(1)] };
  }
  return { active: DEFAULT_SHEETS.active, sheets: DEFAULT_SHEETS.sheets.map((sheet) => ({ ...sheet })) };
}

export const activeLayout = (state) => state.sheets[state.active].layout;

export const setActive = (state, index) => (Number.isInteger(index) && index >= 0 && index < state.sheets.length && index !== state.active
  ? { ...state, active: index }
  : state);

export const updateActiveLayout = (state, layout) => ({
  ...state,
  sheets: state.sheets.map((sheet, index) => (index === state.active ? { ...sheet, layout } : sheet)),
});

// A new sheet starts as a copy of the active one and becomes active.
export function addSheet(state) {
  if (state.sheets.length >= MAX_SHEETS) return state;
  const copy = { name: null, preset: null, layout: activeLayout(state) };
  return { active: state.sheets.length, sheets: [...state.sheets, copy] };
}

export function renameSheet(state, index, name) {
  if (!state.sheets[index]) return state;
  const clean = cleanName(name);
  return { ...state, sheets: state.sheets.map((sheet, position) => (position === index ? { ...sheet, name: clean, preset: clean ? null : sheet.preset } : sheet)) };
}

export function removeSheet(state, index) {
  if (state.sheets.length <= 1 || !state.sheets[index]) return state;
  const sheets = state.sheets.filter((_sheet, position) => position !== index);
  const active = index < state.active ? state.active - 1 : Math.min(state.active, sheets.length - 1);
  return { active, sheets };
}

// Name to show: the pilot's name, the preset's name, or "Sheet N".
export const sheetLabel = (sheet, index, t) => sheet.name ?? (sheet.preset ? t(`ws.preset.${sheet.preset}`) : t("ws.sheet", { n: index + 1 }));
