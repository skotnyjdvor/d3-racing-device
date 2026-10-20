// More laps on the charts, the map and the G-G diagram than the primary and comparison laps (MoTeC i2
// overlay laps): up to three more laps, each in its own colour. They can be the pilot's own laps of this
// session ("o:N") or laps of the session chosen under "Compare from" ("x:N"). The picker sits next to the
// lap selectors; chosen laps show as chips that remove the lap on click.

export const EXTRA_COLORS = ["#00d1ff", "#ffb000", "#b36bff"];
export const MAX_EXTRA = EXTRA_COLORS.length;

const parseKey = (key) => ({ external: key.startsWith("x:"), number: Number(key.slice(2)) });

// The chosen extra laps with their colours, in the order they were added.
export const extraLapList = (state) => (state.extraLaps ?? []).map((key, index) => ({ key, ...parseKey(key), color: EXTRA_COLORS[index] ?? EXTRA_COLORS[0] }));

export function createExtraLaps({ state, elements, t, formatLapTime, onChange, onLanguageChange }) {
  state.extraLaps = [];
  const root = elements.extraLaps;
  const menu = elements.extraLapsMenu;
  const button = elements.extraLapsButton;
  const externalSource = () => (state.comparisonRival ? state.comparisonSource : null);

  // Laps that can be added: own laps that are not primary or comparison, and laps of the comparison
  // session other than the comparison lap itself.
  function candidates() {
    const own = (state.analysis?.laps ?? [])
      .filter((lap) => lap.number !== state.selectedLapNumber && (state.comparisonRival || lap.number !== state.comparisonLapNumber))
      .map((lap) => ({ key: `o:${lap.number}`, lap }));
    const source = externalSource();
    const external = source ? source.analysis.laps.filter((lap) => lap.number !== state.comparisonLapNumber).map((lap) => ({ key: `x:${lap.number}`, lap })) : [];
    return { own, external, source };
  }

  // Keep only laps that can still be shown.
  function prune() {
    const { own, external } = candidates();
    const allowed = new Set([...own, ...external].map((item) => item.key));
    const next = state.extraLaps.filter((key) => allowed.has(key)).slice(0, MAX_EXTRA);
    if (next.length !== state.extraLaps.length) state.extraLaps = next;
  }

  const lapName = (entry) => {
    const source = externalSource();
    const lap = t("laps.legend", { lap: entry.number });
    return entry.external && source ? `${source.name.length > 14 ? `${source.name.slice(0, 13)}…` : source.name} · ${lap}` : lap;
  };

  function render() {
    prune();
    const { own, external, source } = candidates();
    root.hidden = !own.length && !external.length;
    button.textContent = `+ ${t("extra.add")}`;
    button.title = t("extra.hint", { count: MAX_EXTRA });
    button.setAttribute("aria-expanded", String(!menu.hidden));
    const chosen = extraLapList(state);
    elements.extraLapsChips.innerHTML = chosen.map((entry) => `<button type="button" class="extra-chip" data-extra-remove="${entry.key}" style="--lap-color: ${entry.color}" title="${t("extra.remove", { lap: lapName(entry) })}" aria-label="${t("extra.remove", { lap: lapName(entry) })}">${lapName(entry)} <span aria-hidden="true">×</span></button>`).join("");
    const full = chosen.length >= MAX_EXTRA;
    const colorOf = new Map(chosen.map((entry) => [entry.key, entry.color]));
    const option = ({ key, lap }) => {
      const checked = colorOf.has(key);
      return `<label class="extra-option"><input type="checkbox" data-extra-lap="${key}" ${checked ? "checked" : ""} ${!checked && full ? "disabled" : ""} /><i style="--lap-color: ${colorOf.get(key) ?? "transparent"}"></i>${t("laps.option", { lap: lap.number, time: formatLapTime(lap.durationMs) })}</label>`;
    };
    const group = (title, items) => (items.length ? `<p class="extra-group">${title}</p>${items.map(option).join("")}` : "");
    menu.innerHTML = `<p>${t("extra.hint", { count: MAX_EXTRA })}</p>${group(t("compare.thisSession"), own)}${source ? group(source.name, external) : ""}`;
  }

  function set(next) {
    state.extraLaps = next;
    render();
    onChange();
  }

  const close = () => { if (!menu.hidden) { menu.hidden = true; button.setAttribute("aria-expanded", "false"); } };
  button.addEventListener("click", () => {
    menu.hidden = !menu.hidden;
    button.setAttribute("aria-expanded", String(!menu.hidden));
    if (!menu.hidden) menu.querySelector("input:not(:disabled)")?.focus();
  });
  menu.addEventListener("change", (event) => {
    const box = event.target.closest("[data-extra-lap]");
    if (!box) return;
    const key = box.dataset.extraLap;
    set(box.checked ? [...state.extraLaps, key].slice(0, MAX_EXTRA) : state.extraLaps.filter((item) => item !== key));
    menu.querySelector(`[data-extra-lap="${key}"]`)?.focus();
  });
  elements.extraLapsChips.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-extra-remove]");
    if (chip) set(state.extraLaps.filter((item) => item !== chip.dataset.extraRemove));
  });
  document.addEventListener("pointerdown", (event) => { if (!root.contains(event.target)) close(); });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) { close(); button.focus(); }
  });
  onLanguageChange(render);

  // A new session starts without extra laps.
  const reset = () => { state.extraLaps = []; close(); render(); };
  return { render, reset };
}
