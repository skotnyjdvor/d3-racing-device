// Desktop workspace for the analysis screen (native desktop app, wide windows only):
// panels live in columns, borders can be dragged to resize, and in "Layout" mode panels can be
// dragged by their header to another place or column, hidden, or reset to a preset.
// The layout model lives in domain/workspace-layout.js; this file only maps it to the DOM.
import {
  DEFAULT_LAYOUT, MAX_COLUMNS, PANELS, PRESETS,
  hidePanel, movePanel, normalizeLayout, resizeColumns, resizePanels, showPanel, visiblePanels,
} from "./domain/workspace-layout.js";

const STORAGE_KEY = "d3-workspace";
const MIN_COLUMN_PX = 240;
const MIN_PANEL_PX = 110;
const PANEL_SELECTORS = { sectors: "#sectorsPanel", track: ".track-panel", stack: "#stackPanel", gg: "#ggPanel", telemetry: ".telemetry-panel", delta: ".delta-panel", insights: ".insight-panel" };
const INTERACTIVE = "button, select, input, textarea, label, a, canvas, [role='tab']";

function loadLayout() {
  try { return normalizeLayout(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
  catch { return normalizeLayout(null); }
}
function saveLayout(layout) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(layout)); } catch {}
}

export function initWorkspace({ dashboard, actions, enabled, redraw, t, onLanguageChange }) {
  const panels = Object.fromEntries(PANELS.map((id) => [id, dashboard.querySelector(PANEL_SELECTORS[id])]));
  if (Object.values(panels).some((panel) => !panel)) return;
  const wide = window.matchMedia("(min-width: 1100px)");
  let layout = loadLayout();
  let mounted = null; // DOM built while the workspace is active
  let editing = false;
  let redrawFrame = 0;

  const scheduleRedraw = () => {
    if (redrawFrame) return;
    redrawFrame = requestAnimationFrame(() => { redrawFrame = 0; redraw(); });
  };
  const commit = (next) => {
    if (next === layout) return;
    layout = next;
    saveLayout(layout);
    render();
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
    scheduleRedraw();
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
    const drop = document.createElement("div");
    drop.className = "ws-drop";
    drop.hidden = true;
    area.append(drop);
    dashboard.append(bar, area, parking);
    const hideButtons = PANELS.map((id) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ws-hide";
      button.textContent = "×";
      button.addEventListener("click", () => commit(hidePanel(layout, id)));
      panels[id].querySelector(".panel-head")?.append(button);
      return button;
    });
    const observer = new ResizeObserver(scheduleRedraw);
    observer.observe(area);
    mounted = { original, bar, area, parking, drop, hideButtons, observer };
    document.body.classList.add("ws-on");
    render();
  }

  function unmount() {
    if (!mounted) return;
    setEditing(false);
    mounted.observer.disconnect();
    mounted.hideButtons.forEach((button) => button.remove());
    for (const element of mounted.original) {
      element.style.removeProperty("flex");
      dashboard.append(element);
    }
    mounted.bar.remove(); mounted.area.remove(); mounted.parking.remove();
    mounted = null;
    document.body.classList.remove("ws-on");
    scheduleRedraw();
  }

  function render() {
    if (!mounted) return;
    const { area, parking, drop } = mounted;
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
    area.replaceChildren(...children, drop);
    layout.hidden.forEach((id) => parking.append(panels[id]));
    const onlyOne = visiblePanels(layout).length <= 1;
    mounted.hideButtons.forEach((button) => { button.disabled = onlyOne; });
    renderBar();
    scheduleRedraw();
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

  // ---- Edit bar actions ----
  dashboard.addEventListener("click", (event) => {
    if (!mounted || !mounted.bar.contains(event.target)) return;
    const chip = event.target.closest("[data-ws-panel]");
    if (chip) commit(chip.getAttribute("aria-pressed") === "true" ? hidePanel(layout, chip.dataset.wsPanel) : showPanel(layout, chip.dataset.wsPanel));
    const preset = event.target.closest("[data-ws-preset]");
    if (preset) commit(normalizeLayout(PRESETS[preset.dataset.wsPreset]));
    if (event.target.closest(".ws-reset")) commit(normalizeLayout(DEFAULT_LAYOUT));
    if (event.target.closest(".ws-done")) setEditing(false);
  });

  // ---- Resizing: drag a border, or focus it and use the arrow keys ----
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
  // `min` is the smallest share a column/panel may get; computed from the current sizes when not given.
  const resizeBy = (element, delta, startLayout, min) => {
    const column = Number(element.dataset.column);
    if (element.classList.contains("ws-split-col")) {
      return resizeColumns(startLayout, column, delta, min ?? Math.min(.45, MIN_COLUMN_PX / mounted.area.clientWidth));
    }
    const height = mounted.area.querySelector(`.ws-column[data-column="${column}"]`)?.clientHeight || 1;
    return resizePanels(startLayout, column, Number(element.dataset.index), delta, min ?? Math.min(.45, MIN_PANEL_PX / height));
  };
  const applySizes = (redrawNow = true) => {
    mounted.area.querySelectorAll(".ws-column").forEach((element) => { element.style.flex = `${layout.columns[element.dataset.column].width} 1 0px`; });
    layout.columns.forEach((column) => column.panels.forEach((panel) => { panels[panel.id].style.flex = `${panel.size} 1 0px`; }));
    if (redrawNow) scheduleRedraw();
  };
  dashboard.addEventListener("pointerdown", (event) => {
    const element = event.target.closest?.(".ws-split");
    if (!element || !mounted || event.button !== 0) return;
    event.preventDefault();
    const vertical = element.classList.contains("ws-split-col");
    const span = vertical ? mounted.area.clientWidth : (element.parentElement?.clientHeight || 1);
    const start = vertical ? event.clientX : event.clientY;
    const startLayout = layout;
    // Read sizes once: reading layout on every move right after writing flex values forces a reflow each time.
    const min = Math.min(.45, (vertical ? MIN_COLUMN_PX : MIN_PANEL_PX) / Math.max(span, 1));
    element.setPointerCapture(event.pointerId);
    element.classList.add("active");
    // While dragging, canvases just stretch with their panels; they repaint at most every 150 ms and at the end.
    let frame = 0; let pending = null; let lastPaint = 0;
    const move = (moveEvent) => {
      pending = ((vertical ? moveEvent.clientX : moveEvent.clientY) - start) / span;
      if (frame) return;
      frame = requestAnimationFrame((now) => {
        frame = 0;
        layout = resizeBy(element, pending, startLayout, min);
        const repaint = now - lastPaint > 150;
        if (repaint) lastPaint = now;
        applySizes(repaint);
      });
    };
    const end = () => {
      cancelAnimationFrame(frame); frame = 0;
      if (pending !== null) { layout = resizeBy(element, pending, startLayout, min); applySizes(); }
      element.classList.remove("active");
      element.removeEventListener("pointermove", move);
      saveLayout(layout);
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", end, { once: true });
    element.addEventListener("pointercancel", end, { once: true });
  });
  dashboard.addEventListener("keydown", (event) => {
    const element = event.target.closest?.(".ws-split");
    if (!element || !mounted) return;
    const vertical = element.classList.contains("ws-split-col");
    const step = (vertical ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 })[event.key];
    if (!step) return;
    event.preventDefault();
    layout = resizeBy(element, step * .02, layout);
    saveLayout(layout);
    applySizes();
  });

  // ---- Moving panels (Layout mode): drag a panel by its header ----
  function dropTarget(x, y) {
    const column = document.elementFromPoint(x, y)?.closest(".ws-column");
    if (!column || !mounted.area.contains(column)) return null;
    const rect = column.getBoundingClientRect();
    const areaRect = mounted.area.getBoundingClientRect();
    const columnIndex = Number(column.dataset.column);
    const edge = Math.min(90, rect.width * .2);
    const canAddColumn = layout.columns.length < MAX_COLUMNS;
    if (canAddColumn && (x < rect.left + edge || x > rect.right - edge)) {
      const after = x > rect.right - edge;
      return {
        target: { newColumn: columnIndex + (after ? 1 : 0) },
        box: { left: (after ? rect.right - 6 : rect.left) - areaRect.left, top: rect.top - areaRect.top, width: 6, height: rect.height },
      };
    }
    const stack = [...column.querySelectorAll(":scope > .panel")];
    let index = stack.findIndex((panel) => { const box = panel.getBoundingClientRect(); return y < box.top + box.height / 2; });
    if (index < 0) index = stack.length;
    const edgeY = index < stack.length ? stack[index].getBoundingClientRect().top : stack.at(-1).getBoundingClientRect().bottom;
    return {
      target: { column: columnIndex, index },
      box: { left: rect.left - areaRect.left, top: edgeY - areaRect.top - 3, width: rect.width, height: 6 },
    };
  }
  dashboard.addEventListener("pointerdown", (event) => {
    if (!editing || !mounted || event.button !== 0) return;
    const head = event.target.closest?.(".panel-head");
    const panel = head?.closest("[data-ws-panel]");
    if (!panel || !mounted.area.contains(panel) || event.target.closest(INTERACTIVE)) return;
    const id = panel.dataset.wsPanel;
    const startX = event.clientX;
    const startY = event.clientY;
    let ghost = null;
    let target = null;
    let finished = false;
    head.setPointerCapture(event.pointerId);
    const move = (moveEvent) => {
      if (!ghost && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 5) return;
      if (!ghost) {
        ghost = document.createElement("div");
        ghost.className = "ws-ghost";
        ghost.textContent = t(`ws.panel.${id}`);
        document.body.append(ghost);
        panel.classList.add("ws-dragging");
      }
      ghost.style.transform = `translate(${moveEvent.clientX + 14}px, ${moveEvent.clientY + 14}px)`;
      const found = dropTarget(moveEvent.clientX, moveEvent.clientY);
      target = found?.target ?? null;
      mounted.drop.hidden = !found;
      if (found) {
        const { left, top, width, height } = found.box;
        const size = `${width}x${height}`;
        if (mounted.drop.dataset.size !== size) { mounted.drop.dataset.size = size; mounted.drop.style.width = `${width}px`; mounted.drop.style.height = `${height}px`; }
        mounted.drop.style.transform = `translate(${left}px, ${top}px)`;
      }
    };
    const finish = (apply) => {
      if (finished) return;
      finished = true;
      head.removeEventListener("pointermove", move);
      document.removeEventListener("keydown", escape, true);
      ghost?.remove();
      panel.classList.remove("ws-dragging");
      if (mounted) mounted.drop.hidden = true;
      if (apply && ghost && target) commit(movePanel(layout, id, target));
    };
    const escape = (keyEvent) => { if (keyEvent.key === "Escape") { keyEvent.stopPropagation(); finish(false); } };
    head.addEventListener("pointermove", move);
    document.addEventListener("keydown", escape, true);
    head.addEventListener("pointerup", () => finish(true), { once: true });
    head.addEventListener("pointercancel", () => finish(false), { once: true });
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && editing && !event.target.closest?.(".ws-split")) setEditing(false); });

  // ---- Texts, activation ----
  function translate() {
    toggle.querySelector("b").textContent = t("ws.edit");
    toggle.title = t("ws.hint");
    if (!mounted) return;
    mounted.hideButtons.forEach((button) => { button.title = t("ws.hide"); button.setAttribute("aria-label", t("ws.hide")); });
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
