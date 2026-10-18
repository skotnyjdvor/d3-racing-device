// Desktop workspace for the analysis screen (native desktop app, wide windows only).
// Panels sit on a grid that fills the window (domain/workspace-layout.js). "Layout" mode is for
// arranging only: contents are covered and inactive, a click selects a panel, its eight handles resize
// it on both axes, and dragging moves it. Panels in the way move aside (shrinking if needed) live, with
// an animation, so the result is visible before the mouse is released. Esc during a drag undoes it.
import {
  COLS, DEFAULT_LAYOUT, PANELS, PRESETS, ROWS,
  hidePanel, moveItem, normalizeLayout, resizeItem, showPanel, visiblePanels,
} from "./domain/workspace-layout.js";

const STORAGE_KEY = "d3-workspace";
const GAP = 8; // px between grid cells, same as the CSS gap
const PANEL_SELECTORS = { sectors: "#sectorsPanel", track: ".track-panel", stack: "#stackPanel", gg: "#ggPanel", telemetry: ".telemetry-panel", delta: ".delta-panel", insights: ".insight-panel" };
const HANDLES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function loadLayout() {
  try { return normalizeLayout(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
  catch { return normalizeLayout(null); }
}
function saveLayout(layout) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(layout)); } catch {}
}
const layoutKey = (layout) => `${layout.items.map((item) => `${item.id}:${item.x},${item.y},${item.w},${item.h}`).join("|")}/${layout.hidden.join()}`;

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
  // Show `next` (animated unless told otherwise); `save` persists it; `still` is not animated.
  function apply(next, { animate = true, save = true, still = null } = {}) {
    if (layoutKey(next) === layoutKey(layout)) return;
    const change = () => { layout = next; render(); };
    if (animate) animateLayout(change, still); else change();
    if (save) saveLayout(layout);
  }

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
    selected = id && layout.items.some((item) => item.id === id) ? id : null;
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
    area.style.setProperty("--ws-cols", COLS);
    area.style.setProperty("--ws-rows", ROWS);
    const parking = document.createElement("div");
    parking.hidden = true;
    dashboard.append(bar, area, parking);
    // A cover over each panel for Layout mode: name, size, hide button and resize handles.
    const shields = Object.fromEntries(PANELS.map((id) => {
      const shield = document.createElement("div");
      shield.className = "ws-shield";
      shield.tabIndex = -1;
      shield.setAttribute("role", "button");
      shield.dataset.wsShield = id;
      shield.innerHTML = `<span class="ws-shield-name"></span><span class="ws-shield-size"></span><button type="button" class="ws-hide">×</button>${HANDLES.map((edge) => `<i class="ws-handle ws-handle-${edge}" data-edge="${edge}" aria-hidden="true"></i>`).join("")}`;
      panels[id].append(shield);
      return [id, shield];
    }));
    const observer = new ResizeObserver(scheduleRedraw);
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
      element.style.removeProperty("grid-area");
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
    for (const item of layout.items) {
      const panel = panels[item.id];
      panel.dataset.wsPanel = item.id;
      panel.style.gridArea = `${item.y + 1} / ${item.x + 1} / span ${item.h} / span ${item.w}`;
      if (panel.parentElement !== area) area.append(panel);
    }
    layout.hidden.forEach((id) => { if (panels[id].parentElement !== parking) parking.append(panels[id]); });
    if (selected && layout.hidden.includes(selected)) selected = null;
    renderSelection();
    renderBar();
    scheduleRedraw();
  }

  function renderSelection() {
    const onlyOne = layout.items.length <= 1;
    for (const id of PANELS) {
      const isSelected = id === selected;
      panels[id].classList.toggle("ws-selected", isSelected);
      const shield = mounted.shields[id];
      shield.tabIndex = editing ? 0 : -1;
      shield.setAttribute("aria-pressed", String(isSelected));
      shield.querySelector(".ws-hide").disabled = onlyOne;
    }
    for (const item of layout.items) {
      mounted.shields[item.id].querySelector(".ws-shield-size").textContent = `${item.w} × ${item.h}`;
    }
  }

  let barKey = "";
  function renderBar() {
    if (!mounted) return;
    const visible = new Set(visiblePanels(layout));
    const key = `${[...visible].sort().join()}|${t("ws.hint")}`;
    if (key === barKey) return;
    barKey = key;
    const chip = (id) => `<button type="button" class="ws-chip" data-ws-panel="${id}" aria-pressed="${visible.has(id)}">${t(`ws.panel.${id}`)}</button>`;
    const preset = (id) => `<button type="button" class="ws-preset" data-ws-preset="${id}">${t(`ws.preset.${id}`)}</button>`;
    mounted.bar.innerHTML = `
      <p class="ws-hint">${t("ws.hint")}</p>
      <div class="ws-group"><span>${t("ws.panels")}</span>${PANELS.map(chip).join("")}</div>
      <div class="ws-group"><span>${t("ws.presets")}</span>${Object.keys(PRESETS).map(preset).join("")}</div>
      <div class="ws-group ws-end"><button type="button" class="ws-reset">${t("ws.reset")}</button><button type="button" class="primary ws-done">${t("ws.done")}</button></div>
      <p class="ws-notice" role="status" aria-live="polite"></p>`;
    if (visible.size <= 1) mounted.bar.querySelector(`[data-ws-panel="${[...visible][0]}"]`).disabled = true;
  }
  const notice = (text) => { const element = mounted?.bar.querySelector(".ws-notice"); if (element) element.textContent = text; };

  // FLIP: panels slide and scale from where they were to their new cells (transform only).
  function animateLayout(change, still = null) {
    if (!mounted || reducedMotion.matches) { change(); return; }
    const before = new Map(layout.items.map((item) => [item.id, panels[item.id].getBoundingClientRect()]));
    change();
    for (const item of layout.items) {
      if (item.id === still) continue;
      const from = before.get(item.id);
      if (!from) continue;
      const to = panels[item.id].getBoundingClientRect();
      const dx = from.left - to.left; const dy = from.top - to.top;
      const sx = from.width / Math.max(to.width, 1); const sy = from.height / Math.max(to.height, 1);
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < .01 && Math.abs(sy - 1) < .01) continue;
      panels[item.id].animate(
        [{ transformOrigin: "0 0", transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transformOrigin: "0 0", transform: "none" }],
        { duration: 200, easing: "cubic-bezier(.2, .8, .2, 1)" },
      );
    }
  }

  // Grid geometry in CSS pixels, read once per drag.
  function gridMetrics() {
    const rect = mounted.area.getBoundingClientRect();
    return { left: rect.left, top: rect.top, pitchX: (rect.width + GAP) / COLS, pitchY: (rect.height + GAP) / ROWS };
  }

  // ---- Edit bar actions ----
  dashboard.addEventListener("click", (event) => {
    if (!mounted || !mounted.bar.contains(event.target)) return;
    const chip = event.target.closest("[data-ws-panel]");
    if (chip) {
      const id = chip.dataset.wsPanel;
      if (chip.getAttribute("aria-pressed") === "true") { apply(hidePanel(layout, id)); select(null); }
      else {
        const next = showPanel(layout, id);
        if (next === layout) notice(t("ws.noRoom"));
        else { apply(next); select(id); }
      }
    }
    const preset = event.target.closest("[data-ws-preset]");
    if (preset) apply(normalizeLayout(PRESETS[preset.dataset.wsPreset]));
    if (event.target.closest(".ws-reset")) apply(normalizeLayout(DEFAULT_LAYOUT));
    if (event.target.closest(".ws-done")) setEditing(false);
  });

  // ---- Pointer gestures in Layout mode: select, move, resize ----
  // Tracked on the window: a live change re-renders panels and must not lose the drag.
  function track(event, onMove, onEnd) {
    const pointerId = event.pointerId;
    let frame = 0; let last = null;
    const move = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      last = moveEvent;
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; onMove(last); });
    };
    const stop = (keep) => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      document.removeEventListener("keydown", escape, true);
      onEnd(keep);
    };
    const up = (upEvent) => { if (upEvent.pointerId === pointerId) stop(true); };
    const cancel = (cancelEvent) => { if (cancelEvent.pointerId === pointerId) stop(false); };
    const escape = (keyEvent) => { if (keyEvent.key === "Escape") { keyEvent.stopPropagation(); stop(false); } };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    document.addEventListener("keydown", escape, true);
  }

  dashboard.addEventListener("pointerdown", (event) => {
    if (!editing || !mounted || event.button !== 0) return;
    const shield = event.target.closest?.("[data-ws-shield]");
    if (!shield) {
      if (mounted.area.contains(event.target)) select(null);
      return;
    }
    if (event.target.closest(".ws-hide")) return;
    const id = shield.dataset.wsShield;
    const item = layout.items.find((entry) => entry.id === id);
    if (!item) return;
    event.preventDefault();
    select(id);
    shield.focus({ preventScroll: true });
    const startLayout = layout;
    const metrics = gridMetrics();
    const handle = event.target.closest(".ws-handle");

    if (handle) {
      // Resize from an edge or corner; the opposite edges stay where they are.
      const edge = handle.dataset.edge;
      document.body.classList.add("ws-resizing");
      document.body.dataset.wsResize = edge;
      track(event, (moveEvent) => {
        const dx = Math.round((moveEvent.clientX - event.clientX) / metrics.pitchX);
        const dy = Math.round((moveEvent.clientY - event.clientY) / metrics.pitchY);
        let { x, y, w, h } = item;
        if (edge.includes("e")) w = item.w + dx;
        if (edge.includes("s")) h = item.h + dy;
        if (edge.includes("w")) { const right = item.x + item.w; x = Math.min(item.x + dx, right - 1); w = right - x; }
        if (edge.includes("n")) { const bottom = item.y + item.h; y = Math.min(item.y + dy, bottom - 1); h = bottom - y; }
        apply(resizeItem(startLayout, id, { x, y, w, h }), { save: false, still: id });
      }, (keep) => {
        document.body.classList.remove("ws-resizing");
        delete document.body.dataset.wsResize;
        if (keep) saveLayout(layout); else apply(startLayout, { save: false });
      });
      return;
    }

    // Move: the grabbed cell stays under the pointer; panels in the way make room live.
    const grabCol = Math.floor((event.clientX - metrics.left) / metrics.pitchX) - item.x;
    const grabRow = Math.floor((event.clientY - metrics.top) / metrics.pitchY) - item.y;
    let dragging = false;
    track(event, (moveEvent) => {
      if (!dragging) {
        if (Math.hypot(moveEvent.clientX - event.clientX, moveEvent.clientY - event.clientY) < 5) return;
        dragging = true;
        panels[id].classList.add("ws-placeholder");
        document.body.classList.add("ws-moving");
      }
      const col = Math.floor((moveEvent.clientX - metrics.left) / metrics.pitchX) - grabCol;
      const row = Math.floor((moveEvent.clientY - metrics.top) / metrics.pitchY) - grabRow;
      apply(moveItem(startLayout, id, col, row), { save: false });
    }, (keep) => {
      panels[id].classList.remove("ws-placeholder");
      document.body.classList.remove("ws-moving");
      if (!dragging) return; // a click: selection only
      if (keep) saveLayout(layout); else apply(startLayout, { save: false });
    });
  });

  dashboard.addEventListener("click", (event) => {
    const hide = event.target.closest?.(".ws-hide");
    if (!hide || !editing) return;
    apply(hidePanel(layout, hide.closest("[data-ws-shield]").dataset.wsShield));
    select(null);
  });

  // Keyboard: arrows move the selected panel one cell, Shift+arrows resize it, Delete hides it.
  dashboard.addEventListener("keydown", (event) => {
    const shield = event.target.closest?.("[data-ws-shield]");
    if (!shield || !editing) return;
    const id = shield.dataset.wsShield;
    const item = layout.items.find((entry) => entry.id === id);
    if (!item) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      apply(hidePanel(layout, id));
      select(null);
      return;
    }
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!dir) return;
    event.preventDefault();
    select(id);
    const [dx, dy] = dir;
    apply(event.shiftKey
      ? resizeItem(layout, id, { x: item.x, y: item.y, w: item.w + dx, h: item.h + dy })
      : moveItem(layout, id, item.x + dx, item.y + dy), { still: event.shiftKey ? id : null });
    mounted.shields[id].focus({ preventScroll: true });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && editing && !document.body.classList.contains("ws-moving") && !document.body.classList.contains("ws-resizing")) setEditing(false);
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
