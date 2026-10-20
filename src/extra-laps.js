// More laps on the charts and the map than the primary and comparison laps (MoTeC i2 overlay laps):
// up to three more of the pilot's own laps, each in its own colour. The picker sits next to the lap
// selectors; chosen laps show as chips that remove the lap on click.

export const EXTRA_COLORS = ["#00d1ff", "#ffb000", "#b36bff"];
export const MAX_EXTRA = EXTRA_COLORS.length;

export const extraLapColor = (state, number) => EXTRA_COLORS[state.extraLaps.indexOf(number)] ?? EXTRA_COLORS[0];

export function createExtraLaps({ state, elements, t, formatLapTime, onChange, onLanguageChange }) {
  state.extraLaps = [];
  const root = elements.extraLaps;
  const menu = elements.extraLapsMenu;
  const button = elements.extraLapsButton;

  // Laps that can be added: the pilot's own laps that are neither primary nor comparison.
  const candidates = () => (state.analysis?.laps ?? []).filter((lap) => lap.number !== state.selectedLapNumber
    && (state.comparisonRival || lap.number !== state.comparisonLapNumber));

  // Keep only laps that still exist and are not shown as primary or comparison already.
  function prune() {
    const allowed = new Set(candidates().map((lap) => lap.number));
    const next = state.extraLaps.filter((number) => allowed.has(number)).slice(0, MAX_EXTRA);
    if (next.length !== state.extraLaps.length) state.extraLaps = next;
  }

  function render() {
    prune();
    const laps = candidates();
    root.hidden = !laps.length;
    button.textContent = `+ ${t("extra.add")}`;
    button.title = t("extra.hint", { count: MAX_EXTRA });
    button.setAttribute("aria-expanded", String(!menu.hidden));
    elements.extraLapsChips.innerHTML = state.extraLaps.map((number) => `<button type="button" class="extra-chip" data-extra-remove="${number}" style="--lap-color: ${extraLapColor(state, number)}" title="${t("extra.remove", { lap: number })}" aria-label="${t("extra.remove", { lap: number })}">${t("laps.legend", { lap: number })} <span aria-hidden="true">×</span></button>`).join("");
    const full = state.extraLaps.length >= MAX_EXTRA;
    menu.innerHTML = `<p>${t("extra.hint", { count: MAX_EXTRA })}</p>${laps.map((lap) => {
      const checked = state.extraLaps.includes(lap.number);
      return `<label class="extra-option"><input type="checkbox" data-extra-lap="${lap.number}" ${checked ? "checked" : ""} ${!checked && full ? "disabled" : ""} /><i style="--lap-color: ${checked ? extraLapColor(state, lap.number) : "transparent"}"></i>${t("laps.option", { lap: lap.number, time: formatLapTime(lap.durationMs) })}</label>`;
    }).join("")}`;
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
    const number = Number(box.dataset.extraLap);
    set(box.checked ? [...state.extraLaps, number].slice(0, MAX_EXTRA) : state.extraLaps.filter((item) => item !== number));
    menu.querySelector(`[data-extra-lap="${number}"]`)?.focus();
  });
  elements.extraLapsChips.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-extra-remove]");
    if (chip) set(state.extraLaps.filter((item) => item !== Number(chip.dataset.extraRemove)));
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
