// Desktop workspace for the analysis screen (native desktop app, wide windows only).
// Panels live in columns; borders between them can always be dragged to resize.
// "Layout" mode is for arranging only: panel contents are covered and inactive, a click selects a panel,
// the selected panel has handles on its edges to resize it, and dragging a panel moves it — the other
// panels make room live (animated), so the result is visible before the mouse is released.
// The layout model lives in domain/workspace-layout.js; this file only maps it to the DOM.
import {
  DEFAULT_LAYOUT, MAX_COLUMNS, PANELS, PRESETS,
  hidePanel, movePanel, normalizeLayout, resizeColumns, resizePanels, showPanel, visiblePanels,
} from "./domain/workspace-layout.js";

const STORAGE_KEY = "d3-workspace";
const MIN_COLUMN_PX = 240;
const MIN_PANEL_PX = 110;
const PANEL_SELECTORS = { sectors: "#sectorsPanel", track: ".track-panel", stack: "#stackPanel", gg: "#ggPanel", telemetry: ".telemetry-panel", delta: ".delta-panel", insights: ".insight-panel" };
const EDGES = ["left", "right", "top", "bottom"];
const REORDER_COOLDOWN_MS = 160; // after a live reorder, let the layout settle under the pointer
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function loadLayout() {
  try { return normalizeLayout(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
  catch { return normalizeLayout(null); }
}
function saveLayout(layout) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(layout)); } catch {}
}
function locate(layout, id) {
  for (let column = 0; column < layout.columns.length; column++) {
    const index = layout.columns[column].panels.findIndex((panel) => panel.id === id);
    if (index >= 0) return { column, index };
  }
  return null;
}

export function initWorkspace({ dashboard, actions, enabled, redraw, t, onLanguageChange }) {
  const panels = Object.fromEntries(PANELS.map((id) => [id, dashboard.querySelector(PANEL_SELECTORS[id])]));
  if (Object.values(panels).some((panel) => !panel)) return;
  const wide = window.matchMedia("(min-width: 1100px)");
  let layout = loadLayout();
  let mounted = null; // DOM built while the workspace is active
  let editing = false;
  let selected = null; // id of the selected panel in Layout mode
  let redrawFrame = 0;

  const scheduleRedraw = () => {
    if (redrawFrame) return;
    redrawFrame = requestAnimationFrame(() => { redrawFrame = 0; redraw(); });
  };
  const commit = (next, { animate = false } = {}) => {
    if (next === layout) return;
    const apply = () => { layout = next; render(); };
    if (animate) animateLayout(apply); else apply();
    saveLayout(layout);
  };

  // ---- Toggle button in the top bar ----
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "ws-toggle";
  toggle.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="7" height="16" /><rect x="14" y="4" width="7" height="7" /><rect x="14" y="14" width="7" height="6" /></svg><b></b>`;
  toggle.addEventListener("click", () => setEditing(!editing));
  actions.prepend(toggle);

  function setEditing(next) {
    editing = Boolean(next) && Boolean(mounted);
    document.body.classList.toggle("ws-editing", editing);
    toggle.setAttribute("aria-pressed", String(editing));
    if (mounted) mounted.bar.hidden = !editing;
    select(editing ? selected : null);
    scheduleRedraw();
  }

  function select(id) {
    selected = id && layout.columns.some((column) => column.panels.some((panel) => panel.id === id)) ? id : null;
    if (mounted) renderSelection();
  }

  // ---- Building and tearing down the workspace DOM ----
  function mount() {
    if (mounted) return;
    const original = [...dashboard.children];
    const bar = document.createElement("div");
    bar.className = "ws-bar";
    bar.hidden = true;
    const area = document.createElement("div");
    area.className = "ws-area";
    const parking = document.createElement("div");
    parking.hidden = true;
    dashboard.append(bar, area, parking);
    // A cover over each panel for Layout mode: name, hide button and resize handles. Contents stay inactive.
    const shields = Object.fromEntries(PANELS.map((id) => {
      const shield = document.createElement("div");
      shield.className = "ws-shield";
      shield.tabIndex = -1;
      shield.setAttribute("role", "button");
      shield.dataset.wsShield = id;
      shield.innerHTML = `<span class="ws-shield-name"></span><span class="ws-shield-size"></span><button type="button" class="ws-hide">×</button>${EDGES.map((edge) => `<i class="ws-handle ws-handle-${edge}" data-edge="${edge}" aria-hidden="true"></i>`).join("")}`;
      panels[id].append(shield);
      return [id, shield];
    }));
    const observer = new ResizeObserver(() => { scheduleRedraw(); if (editing) renderSizes(); });
    observer.observe(area);
    mounted = { original, bar, area, parking, shields, observer };
    document.body.classList.add("ws-on");
    render();
  }

  function unmount() {
    if (!mounted) return;
    setEditing(false);
    mounted.observer.disconnect();
    Object.values(mounted.shields).forEach((shield) => shield.remove());
    for (const element of mounted.original) {
      element.style.removeProperty("flex");
      element.classList.remove("ws-selected", "ws-placeholder");
      dashboard.append(element);
    }
    mounted.bar.remove(); mounted.area.remove(); mounted.parking.remove();
    mounted = null;
    document.body.classList.remove("ws-on");
    scheduleRedraw();
  }

  function render() {
    if (!mounted) return;
    const { area, parking } = mounted;
    const columns = layout.columns.map((column, columnIndex) => {
      const element = document.createElement("div");
      element.className = "ws-column";
      element.dataset.column = columnIndex;
      element.style.flex = `${column.width} 1 0px`;
      column.panels.forEach((panel, index) => {
        if (index) element.append(splitter("row", columnIndex, index - 1));
        panels[panel.id].style.flex = `${panel.size} 1 0px`;
        panels[panel.id].dataset.wsPanel = panel.id;
        element.append(panels[panel.id]);
      });
      return element;
    });
    const children = [];
    columns.forEach((element, index) => { if (index) children.push(splitter("col", index - 1)); children.push(element); });
    area.replaceChildren(...children);
    layout.hidden.forEach((id) => parking.append(panels[id]));
    if (selected && layout.hidden.includes(selected)) selected = null;
    renderSelection();
    renderBar();
    scheduleRedraw();
  }

  // Selected panel: outline, and only the handles that have a neighbour to push against.
  function renderSelection() {
    const onlyOne = visiblePanels(layout).length <= 1;
    for (const id of PANELS) {
      const panel = panels[id];
      const shield = mounted.shields[id];
      const isSelected = id === selected;
      panel.classList.toggle("ws-selected", isSelected);
      shield.tabIndex = editing ? 0 : -1;
      shield.setAttribute("aria-pressed", String(isSelected));
      shield.querySelector(".ws-hide").disabled = onlyOne;
      const at = locate(layout, id);
      const edges = at ? {
        left: at.column > 0,
        right: at.column < layout.columns.length - 1,
        top: at.index > 0,
        bottom: at.index < layout.columns[at.column].panels.length - 1,
      } : {};
      shield.querySelectorAll(".ws-handle").forEach((handle) => { handle.hidden = !isSelected || !edges[handle.dataset.edge]; });
    }
    renderSizes();
  }

  function renderSizes() {
    if (!editing || !mounted) return;
    for (const id of visiblePanels(layout)) {
      const { width, height } = panels[id].getBoundingClientRect();
      mounted.shields[id].querySelector(".ws-shield-size").textContent = `${Math.round(width)} × ${Math.round(height)}`;
    }
  }

  function renderBar() {
    if (!mounted) return;
    const visible = new Set(visiblePanels(layout));
    const chip = (id) => `<button type="button" class="ws-chip" data-ws-panel="${id}" aria-pressed="${visible.has(id)}">${t(`ws.panel.${id}`)}</button>`;
    const preset = (id) => `<button type="button" class="ws-preset" data-ws-preset="${id}">${t(`ws.preset.${id}`)}</button>`;
    mounted.bar.innerHTML = `
      <p class="ws-hint">${t("ws.hint")}</p>
      <div class="ws-group"><span>${t("ws.panels")}</span>${PANELS.map(chip).join("")}</div>
      <div class="ws-group"><span>${t("ws.presets")}</span>${Object.keys(PRESETS).map(preset).join("")}</div>
      <div class="ws-group ws-end"><button type="button" class="ws-reset">${t("ws.reset")}</button><button type="button" class="primary ws-done">${t("ws.done")}</button></div>`;
    if (visible.size <= 1) mounted.bar.querySelector(`[data-ws-panel="${[...visible][0]}"]`).disabled = true;
  }

  // FLIP: panels slide from where they were to where the new layout puts them (transform only).
  function animateLayout(change) {
    if (!mounted || reducedMotion.matches) { change(); return; }
    const before = new Map(visiblePanels(layout).map((id) => [id, panels[id].getBoundingClientRect()]));
    change();
    for (const id of visiblePanels(layout)) {
      const from = before.get(id);
      if (!from) continue;
      const to = panels[id].getBoundingClientRect();
      const dx = from.left - to.left; const dy = from.top - to.top;
      const sx = from.width / Math.max(to.width, 1); const sy = from.height / Math.max(to.height, 1);
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < .01 && Math.abs(sy - 1) < .01) continue;
      panels[id].animate(
        [{ transformOrigin: "0 0", transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transformOrigin: "0 0", transform: "none" }],
        { duration: 220, easing: "cubic-bezier(.2, .8, .2, 1)" },
      );
    }
  }

  // ---- Edit bar actions ----
  dashboard.addEventListener("click", (event) => {
    if (!mounted || !mounted.bar.contains(event.target)) return;
    const chip = event.target.closest("[data-ws-panel]");
    if (chip) {
      const id = chip.dataset.wsPanel;
      const showing = chip.getAttribute("aria-pressed") !== "true";
      commit(showing ? showPanel(layout, id) : hidePanel(layout, id), { animate: true });
      if (showing) select(id);
    }
    const preset = event.target.closest("[data-ws-preset]");
    if (preset) commit(normalizeLayout(PRESETS[preset.dataset.wsPreset]), { animate: true });
    if (event.target.closest(".ws-reset")) commit(normalizeLayout(DEFAULT_LAYOUT), { animate: true });
    if (event.target.closest(".ws-done")) setEditing(false);
  });

  // ---- Resizing: borders (always) and the selected panel's handles (Layout mode) ----
  function splitter(kind, column, index) {
    const element = document.createElement("div");
    element.className = `ws-split ws-split-${kind}`;
    element.tabIndex = 0;
    element.setAttribute("role", "separator");
    element.setAttribute("aria-orientation", kind === "col" ? "vertical" : "horizontal");
    element.setAttribute("aria-label", t("ws.resize"));
    element.dataset.column = column;
    if (index !== undefined) element.dataset.index = index;
    return element;
  }
  // A border is { kind: "col", column } (between column and column + 1) or { kind: "row", column, index }.
  const minShare = (border) => (border.kind === "col"
    ? Math.min(.45, MIN_COLUMN_PX / Math.max(mounted.area.clientWidth, 1))
    : Math.min(.45, MIN_PANEL_PX / Math.max(mounted.area.querySelector(`.ws-column[data-column="${border.column}"]`)?.clientHeight || 1, 1)));
  const resizeAt = (border, delta, startLayout, min) => (border.kind === "col"
    ? resizeColumns(startLayout, border.column, delta, min)
    : resizePanels(startLayout, border.column, border.index, delta, min));
  const applySizes = (redrawNow = true) => {
    mounted.area.querySelectorAll(".ws-column").forEach((element) => { element.style.flex = `${layout.columns[element.dataset.column].width} 1 0px`; });
    layout.columns.forEach((column) => column.panels.forEach((panel) => { panels[panel.id].style.flex = `${panel.size} 1 0px`; }));
    if (redrawNow) scheduleRedraw();
  };
  // The neighbours give way while dragging; canvases just stretch and repaint at most every 150 ms and at the end.
  function startResize(border, event, captureElement) {
    event.preventDefault();
    event.stopPropagation();
    const vertical = border.kind === "col";
    const span = vertical ? mounted.area.clientWidth : (mounted.area.querySelector(`.ws-column[data-column="${border.column}"]`)?.clientHeight || 1);
    const start = vertical ? event.clientX : event.clientY;
    const startLayout = layout;
    const min = minShare(border); // read once: no layout reads between the flex writes below
    captureElement.setPointerCapture(event.pointerId);
    captureElement.classList.add("active");
    document.body.classList.add(vertical ? "ws-resizing-col" : "ws-resizing-row");
    let frame = 0; let pending = null; let lastPaint = 0;
    const move = (moveEvent) => {
      pending = ((vertical ? moveEvent.clientX : moveEvent.clientY) - start) / span;
      if (frame) return;
      frame = requestAnimationFrame((now) => {
        frame = 0;
        layout = resizeAt(border, pending, startLayout, min);
        const repaint = now - lastPaint > 150;
        if (repaint) lastPaint = now;
        applySizes(repaint);
      });
    };
    const end = () => {
      cancelAnimationFrame(frame); frame = 0;
      if (pending !== null) { layout = resizeAt(border, pending, startLayout, min); applySizes(); }
      captureElement.classList.remove("active");
      document.body.classList.remove("ws-resizing-col", "ws-resizing-row");
      captureElement.removeEventListener("pointermove", move);
      saveLayout(layout);
      renderSizes();
    };
    captureElement.addEventListener("pointermove", move);
    captureElement.addEventListener("pointerup", end, { once: true });
    captureElement.addEventListener("pointercancel", end, { once: true });
  }
  dashboard.addEventListener("pointerdown", (event) => {
    if (!mounted || event.button !== 0) return;
    const split = event.target.closest?.(".ws-split");
    if (split) {
      startResize(split.classList.contains("ws-split-col")
        ? { kind: "col", column: Number(split.dataset.column) }
        : { kind: "row", column: Number(split.dataset.column), index: Number(split.dataset.index) }, event, split);
      return;
    }
    const handle = event.target.closest?.(".ws-handle");
    if (!handle || !editing) return;
    const at = locate(layout, handle.closest("[data-ws-shield]").dataset.wsShield);
    if (!at) return;
    const border = {
      left: { kind: "col", column: at.column - 1 },
      right: { kind: "col", column: at.column },
      top: { kind: "row", column: at.column, index: at.index - 1 },
      bottom: { kind: "row", column: at.column, index: at.index },
    }[handle.dataset.edge];
    startResize(border, event, handle);
  });
  dashboard.addEventListener("keydown", (event) => {
    const element = event.target.closest?.(".ws-split");
    if (!element || !mounted) return;
    const vertical = element.classList.contains("ws-split-col");
    const step = (vertical ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 })[event.key];
    if (!step) return;
    event.preventDefault();
    const border = vertical ? { kind: "col", column: Number(element.dataset.column) } : { kind: "row", column: Number(element.dataset.column), index: Number(element.dataset.index) };
    layout = resizeAt(border, step * .02, layout, minShare(border));
    saveLayout(layout);
    applySizes();
  });

  // ---- Moving panels (Layout mode): the panel itself is dragged, the others make room live ----
  // Where would the dragged panel go if dropped here? null = keep the current preview.
  function dropTarget(x, y, id) {
    const under = document.elementFromPoint(x, y);
    if (!under || under.closest?.(`[data-ws-panel="${id}"]`)) return null; // over its own slot: stable
    const column = under.closest?.(".ws-column");
    if (!column || !mounted.area.contains(column)) return null;
    const columnIndex = Number(column.dataset.column);
    const from = locate(layout, id);
    const rect = column.getBoundingClientRect();
    const edge = Math.min(90, rect.width * .2);
    if (layout.columns.length < MAX_COLUMNS && (x < rect.left + edge || x > rect.right - edge)) {
      const position = columnIndex + (x > rect.right - edge ? 1 : 0);
      // A panel alone in its column already is "a new column" right there: nothing would change.
      const alone = layout.columns[from.column].panels.length === 1;
      if (alone && (position === from.column || position === from.column + 1)) return null;
      return { newColumn: position };
    }
    const stack = [...column.querySelectorAll(":scope > .panel")];
    const over = under.closest(".panel");
    let index;
    if (over && stack.includes(over)) {
      const box = over.getBoundingClientRect();
      index = stack.indexOf(over) + (y > box.top + box.height / 2 ? 1 : 0);
    } else {
      index = stack.findIndex((panel) => y < panel.getBoundingClientRect().top + panel.getBoundingClientRect().height / 2);
      if (index < 0) index = stack.length;
    }
    if (from.column === columnIndex && (index === from.index || index === from.index + 1)) return null; // no-op
    return { column: columnIndex, index };
  }

  dashboard.addEventListener("pointerdown", (event) => {
    if (!editing || !mounted || event.button !== 0) return;
    const shield = event.target.closest?.("[data-ws-shield]");
    if (!shield) {
      if (mounted.area.contains(event.target) && !event.target.closest(".ws-split")) select(null);
      return;
    }
    if (event.target.closest(".ws-handle, .ws-hide")) return;
    const id = shield.dataset.wsShield;
    const panel = panels[id];
    select(id);
    event.preventDefault();
    shield.focus({ preventScroll: true });
    const startX = event.clientX; const startY = event.clientY;
    const startLayout = layout;
    let ghost = null; let finished = false; let settleUntil = 0;
    // Listen on the window, not with pointer capture: a live reorder moves the panel in the DOM,
    // which would drop the capture and lose the rest of the drag.
    const pointerId = event.pointerId;
    const move = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      if (!ghost) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 5) return;
        const box = panel.getBoundingClientRect();
        ghost = document.createElement("div");
        ghost.className = "ws-ghost";
        ghost.textContent = t(`ws.panel.${id}`);
        ghost.style.width = `${Math.min(260, box.width)}px`;
        ghost.style.height = `${Math.min(150, box.height)}px`;
        document.body.append(ghost);
        panel.classList.add("ws-placeholder");
        document.body.classList.add("ws-moving");
      }
      // Keep the floating card on screen: it flips to the other side of the pointer near the edges.
      const gx = moveEvent.clientX + 12 + ghost.offsetWidth > innerWidth ? moveEvent.clientX - 12 - ghost.offsetWidth : moveEvent.clientX + 12;
      const gy = moveEvent.clientY + 12 + ghost.offsetHeight > innerHeight ? moveEvent.clientY - 12 - ghost.offsetHeight : moveEvent.clientY + 12;
      ghost.style.transform = `translate(${gx}px, ${gy}px)`;
      if (moveEvent.timeStamp < settleUntil) return;
      const target = dropTarget(moveEvent.clientX, moveEvent.clientY, id);
      if (!target) return;
      const next = movePanel(layout, id, target);
      if (next === layout) return;
      animateLayout(() => { layout = next; render(); });
      settleUntil = moveEvent.timeStamp + REORDER_COOLDOWN_MS;
    };
    const finish = (keep) => {
      if (finished) return;
      finished = true;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      document.removeEventListener("keydown", escape, true);
      ghost?.remove();
      panel.classList.remove("ws-placeholder");
      document.body.classList.remove("ws-moving");
      if (!ghost) return; // a click: selection only
      if (keep) saveLayout(layout);
      else animateLayout(() => { layout = startLayout; render(); });
      renderSizes();
    };
    const escape = (keyEvent) => { if (keyEvent.key === "Escape") { keyEvent.stopPropagation(); finish(false); } };
    const up = (upEvent) => { if (upEvent.pointerId === pointerId) finish(true); };
    const cancel = (cancelEvent) => { if (cancelEvent.pointerId === pointerId) finish(false); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    document.addEventListener("keydown", escape, true);
  });

  dashboard.addEventListener("click", (event) => {
    const hide = event.target.closest?.(".ws-hide");
    if (!hide || !editing) return;
    const id = hide.closest("[data-ws-shield]").dataset.wsShield;
    commit(hidePanel(layout, id), { animate: true });
    select(null);
  });

  // Keyboard: arrows move the selected panel, Shift+arrows resize it, Delete hides it, Esc leaves Layout mode.
  dashboard.addEventListener("keydown", (event) => {
    const shield = event.target.closest?.("[data-ws-shield]");
    if (!shield || !editing) return;
    const id = shield.dataset.wsShield;
    const at = locate(layout, id);
    if (!at) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      commit(hidePanel(layout, id), { animate: true });
      select(null);
      return;
    }
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!dir) return;
    event.preventDefault();
    select(id);
    if (event.shiftKey) {
      const [dx, dy] = dir;
      const border = dx
        ? (at.column < layout.columns.length - 1 ? { kind: "col", column: at.column, sign: 1 } : at.column > 0 ? { kind: "col", column: at.column - 1, sign: -1 } : null)
        : (at.index < layout.columns[at.column].panels.length - 1 ? { kind: "row", column: at.column, index: at.index, sign: 1 } : at.index > 0 ? { kind: "row", column: at.column, index: at.index - 1, sign: -1 } : null);
      if (!border) return;
      layout = resizeAt(border, (dx || dy) * .02 * border.sign, layout, minShare(border));
      saveLayout(layout);
      applySizes();
      renderSizes();
      return;
    }
    const [dx, dy] = dir;
    const target = dx
      ? (layout.columns[at.column + dx] ? { column: at.column + dx, index: Math.min(at.index, layout.columns[at.column + dx].panels.length) } : null)
      : { column: at.column, index: at.index + (dy > 0 ? 2 : -1) };
    if (!target || target.index < 0 || target.index > layout.columns[at.column].panels.length && !dx) return;
    commit(movePanel(layout, id, target), { animate: true });
    mounted.shields[id].focus({ preventScroll: true });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && editing && !event.target.closest?.(".ws-split") && !document.body.classList.contains("ws-moving")) setEditing(false);
  });

  // ---- Texts, activation ----
  function translate() {
    toggle.querySelector("b").textContent = t("ws.edit");
    toggle.title = t("ws.hint");
    if (!mounted) return;
    for (const id of PANELS) {
      const shield = mounted.shields[id];
      shield.querySelector(".ws-shield-name").textContent = t(`ws.panel.${id}`);
      shield.setAttribute("aria-label", t(`ws.panel.${id}`));
      const hide = shield.querySelector(".ws-hide");
      hide.title = t("ws.hide"); hide.setAttribute("aria-label", t("ws.hide"));
    }
    mounted.area.querySelectorAll(".ws-split").forEach((element) => element.setAttribute("aria-label", t("ws.resize")));
    renderBar();
  }
  const sync = () => {
    if (enabled() && wide.matches) mount(); else unmount();
    translate();
  };
  wide.addEventListener("change", sync);
  onLanguageChange(translate);
  sync();
}
