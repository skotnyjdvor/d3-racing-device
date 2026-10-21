// Where the comparison lap comes from: this session, a pilot's shared session (state.rival) or another of
// the pilot's own sessions on the same track, loaded without opening it. Also the comparison selectors.
import { analyzeSession } from "./domain/analysis.js";
import { splitSessionIntoLaps } from "./domain/laps.js";
import { identifyTrack, loadTrackCatalog } from "./domain/tracks.js";
import { lapsOf } from "./lap-series.js";

export function createComparison(ctx) {
  const {
    state, elements, t, escapeHtml, formatLapTime, formatDate, compactLayout,
    lapPoints, loadLocalPoints, loadLog, updateLocalSession, showNotice, clearAiReport, updateLapView,
  } = ctx;

  // ---- Comparison source: the comparison lap can come from this session, from a pilot's shared session
  // (state.rival) or from another of the pilot's own sessions on the same track. state.comparisonRival is
  // true when it comes from state.comparisonSource: { key, kind: "pilot" | "session", name, track, points, analysis }.
  function pilotSource() {
    const rival = state.rival;
    return rival ? { key: `r:${rival.token}`, kind: "pilot", name: rival.name, track: rival.track, points: rival.points, analysis: rival.analysis, token: rival.token } : null;
  }
  function useRivalComparison() {
    state.comparisonSource = pilotSource();
    state.comparisonLapNumber = rivalFastestLap();
    state.comparisonRival = Boolean(state.comparisonSource && state.comparisonLapNumber);
  }
  function sourceLapPoints(number) {
    return state.comparisonSource ? lapsOf(state.comparisonSource.points).get(number) ?? [] : [];
  }
  // Another own session, loaded without opening it; cached per session object.
  const comparisonSessions = new WeakMap();
  async function loadComparisonSession(session) {
    if (comparisonSessions.has(session)) return comparisonSessions.get(session);
    let points = session.points;
    if (!points?.length && session.source === "local") points = await loadLocalPoints(session.id).catch(() => []);
    if (!points?.length && session.source === "cloud") points = (await loadLog(session.cloudId).catch(() => null))?.points ?? [];
    if (!points?.length) return null;
    if (!session.points) { session.points = points; session.pointCount = points.length; }
    const catalog = await loadTrackCatalog().catch(() => undefined);
    const track = identifyTrack(points, catalog);
    rememberTrack(session, track);
    const lapped = splitSessionIntoLaps(points, track);
    let analysis;
    try { analysis = analyzeSession(lapped); } catch { return null; }
    if (!analysis.laps.length) return null;
    const source = { key: `s:${session.id}`, kind: "session", sessionId: String(session.id), name: session.title || formatDate(session.startedAt), track, points: lapped, analysis };
    comparisonSessions.set(session, source);
    return source;
  }
  // Sessions whose track is already known and differs from this one are not offered.
  const comparisonCandidates = () => state.sessions.filter((session) => session !== state.selectedSession && session.source !== "shared"
    && !(session.trackId && state.track?.id && session.trackId !== state.track.id));
  function rememberTrack(session, track) {
    const trackId = track?.id ?? null;
    if (!session || session.trackId === trackId) return;
    session.trackId = trackId;
    if (session.source === "local") void updateLocalSession(session.id, { trackId }).catch(() => {});
  }
  // Laps of two sessions only line up when they were driven on the same, recognised track.
  function rivalComparable() {
    const rival = state.rival;
    return Boolean(rival && state.selectedSession && state.selectedSession.source !== "shared" && rival.track && state.track
      && rival.track.id === state.track.id && rival.analysis.laps.length);
  }
  function rivalFastestLap() { return state.rival?.analysis.fastestLap?.number ?? state.rival?.analysis.laps[0]?.number ?? null; }
  const extraLapPoints = (entry) => (entry.external ? sourceLapPoints(entry.number) : lapPoints(entry.number));
  function comparisonLapPoints() {
    return state.comparisonRival && state.comparisonSource ? sourceLapPoints(state.comparisonLapNumber) : lapPoints(state.comparisonLapNumber);
  }
  function shortName(name, length = 14) { return name.length > length ? `${name.slice(0, length - 1)}…` : name; }
  function comparisonLabel(short = false) {
    if (!state.comparisonLapNumber) return t("laps.none");
    const lap = t("laps.legend", { lap: state.comparisonLapNumber });
    const source = state.comparisonRival ? state.comparisonSource : null;
    return source ? `${short ? shortName(source.name) : source.name} · ${lap}` : lap;
  }
  // Main selector: own laps, or laps of the chosen source as "x:N". AI page: own laps and a pilot's laps as "r:N".
  function comparisonSelectValue({ ai = false } = {}) {
    if (!state.comparisonLapNumber) return "";
    if (!state.comparisonRival) return String(state.comparisonLapNumber);
    if (!ai) return `x:${state.comparisonLapNumber}`;
    return state.comparisonSource?.kind === "pilot" ? `r:${state.comparisonLapNumber}` : "";
  }
  // A closed <select> shows only the chosen option, so the pilot's name goes into the text itself.
  function rivalOptionText(optionKey, lap) {
    return compactLayout.matches ? `${shortName(state.rival.name, 8)} · ${t("laps.legend", { lap: lap.number })}` : `${state.rival.name} · ${t(optionKey, { lap: lap.number, time: formatLapTime(lap.durationMs) })}`;
  }
  function comparisonOptionsHtml(optionKey, own, { ai = false } = {}) {
    const source = state.comparisonRival ? state.comparisonSource : null;
    if (!ai && source) {
      const laps = source.analysis.laps.map((lap) => `<option value="x:${lap.number}">${escapeHtml(t(optionKey, { lap: lap.number, time: formatLapTime(lap.durationMs) }))}</option>`).join("");
      return `<option value="">${escapeHtml(t("laps.none"))}</option>${laps}`;
    }
    const rival = rivalComparable()
      ? `<optgroup label="${escapeHtml(state.rival.name)}">${state.rival.analysis.laps.map((lap) => `<option value="r:${lap.number}">${escapeHtml(rivalOptionText(optionKey, lap))}</option>`).join("")}</optgroup>`
      : "";
    return `<option value="">${escapeHtml(t("laps.none"))}</option>${own}${rival}`;
  }
  function comparisonAvailable() { return (state.analysis?.laps.length ?? 0) > 1 || rivalComparable() || Boolean(state.comparisonRival && state.comparisonSource); }

  function renderComparisonSource() {
    const select = elements.comparisonSourceSelect;
    const others = comparisonCandidates();
    const pilot = rivalComparable() ? `<option value="pilot">${escapeHtml(state.rival.name)}</option>` : "";
    const sessions = others.length ? `<optgroup label="${escapeHtml(t("compare.mySessions"))}">${others.map((session) => `<option value="s:${escapeHtml(session.id)}">${escapeHtml(session.title || formatDate(session.startedAt))}${session.title ? ` · ${escapeHtml(formatDate(session.startedAt))}` : ""}</option>`).join("")}</optgroup>` : "";
    select.innerHTML = `<option value="">${escapeHtml(t("compare.thisSession"))}</option>${pilot}${sessions}`;
    const source = state.comparisonRival ? state.comparisonSource : null;
    select.value = !source ? "" : source.kind === "pilot" ? "pilot" : `s:${source.sessionId}`;
    select.disabled = !state.analysis || (!pilot && !sessions);
  }

  async function changeComparisonSource(value) {
    const select = elements.comparisonSourceSelect;
    if (!value) {
      state.comparisonSource = null; state.comparisonRival = false;
      const other = [...(state.analysis?.laps ?? [])].sort((a, b) => a.durationMs - b.durationMs).find((lap) => lap.number !== state.selectedLapNumber);
      state.comparisonLapNumber = other?.number ?? null;
    } else if (value === "pilot") {
      useRivalComparison();
    } else {
      const session = state.sessions.find((item) => `s:${item.id}` === value);
      const selectedBefore = state.selectedSession;
      select.disabled = true;
      const source = session ? await loadComparisonSession(session) : null;
      select.disabled = false;
      if (state.selectedSession !== selectedBefore) return;
      if (!source) { showNotice(t("compare.loadFailed"), true); renderComparisonSource(); return; }
      if (!source.track || !state.track || source.track.id !== state.track.id) { showNotice(t("compare.otherTrack"), true); renderComparisonSource(); return; }
      state.comparisonSource = source;
      state.comparisonLapNumber = source.analysis.fastestLap?.number ?? source.analysis.laps[0].number;
      state.comparisonRival = true;
    }
    clearAiReport();
    updateLapView();
  }

  return { pilotSource, useRivalComparison, sourceLapPoints, comparisonSessions, loadComparisonSession, comparisonCandidates, rememberTrack, rivalComparable, rivalFastestLap, extraLapPoints, comparisonLapPoints, shortName, comparisonLabel, comparisonSelectValue, rivalOptionText, comparisonOptionsHtml, comparisonAvailable, renderComparisonSource, changeComparisonSource };
}
