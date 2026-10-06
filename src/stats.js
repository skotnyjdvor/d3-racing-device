import { acceptFriend, createFriendInvite, loadFriends, loadFriendStats, loadLeaderboard, loadMyStats, previewFriendInvite, removeFriend, revokeFriendInvite, saveProfileSettings } from "./cloud/api.js";
import { getLanguage, onLanguageChange, t } from "./i18n.js";

// Pilot page: pilot name and privacy switch, friends and invite links, personal statistics and a friends leaderboard per track.
const $ = (id) => document.getElementById(id);
const ME = "me";
const MAX_PENDING_RETRIES = 6;

let user = null;
let callbacks = {};
let friends = [];
let invites = [];
let statsByPilot = new Map();
let pilot = ME;
let trackId = null;
let board = null;
let retries = 0;
let retryTimer = null;
let generation = 0;

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

export function formatLap(milliseconds) {
  if (!Number.isFinite(milliseconds)) return "—";
  const rounded = Math.round(milliseconds);
  const minutes = Math.floor(rounded / 60_000);
  const seconds = Math.floor((rounded % 60_000) / 1000);
  const millis = rounded % 1000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

const formatGap = (milliseconds) => (milliseconds > 0 ? `+${(milliseconds / 1000).toFixed(3)}` : "—");
const formatDate = (iso) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(getLanguage(), { dateStyle: "medium" }).format(date);
};
const formatHours = (milliseconds) => {
  const minutes = Math.round((milliseconds || 0) / 60_000);
  return minutes >= 60 ? t("stats.hoursMinutes", { hours: Math.floor(minutes / 60), minutes: minutes % 60 }) : t("stats.minutes", { minutes });
};

function setStatus(id, message = "", error = false) {
  $(id).textContent = message;
  $(id).classList.toggle("error", error);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const field = document.createElement("textarea");
    field.value = text; field.setAttribute("readonly", ""); field.style.position = "fixed"; field.style.opacity = "0";
    document.body.append(field); field.select();
    const ok = document.execCommand?.("copy") ?? false;
    field.remove();
    return ok;
  }
}

// ---- Pilot settings ----
function renderSettings() {
  $("pilotNameInput").value = user?.displayName ?? "";
  $("pilotNameInput").placeholder = user?.email ? user.email.split("@")[0] : "";
  $("pilotStatsVisible").checked = Boolean(user?.statsVisible);
}

async function saveSettings(patch, statusId) {
  setStatus(statusId);
  try {
    const { user: updated } = await saveProfileSettings(patch);
    user = { ...user, ...updated };
    callbacks.onUserUpdated?.(user);
    renderSettings();
    setStatus(statusId, t("pilot.saved"));
    return true;
  } catch (error) {
    setStatus(statusId, error.message, true);
    renderSettings();
    return false;
  }
}

// ---- Friends and invitations ----
function renderFriends() {
  const list = $("friendList");
  $("friendsEmpty").hidden = friends.length > 0;
  list.innerHTML = friends.map((friend) => `<li class="friend-item" data-friend-id="${escapeHtml(friend.id)}">
    <div><strong>${escapeHtml(friend.name)}</strong><small>${t("friends.since", { date: formatDate(friend.since) })}</small></div>
    <em class="${friend.statsVisible ? "open" : "closed"}">${t(friend.statsVisible ? "friends.shares" : "friends.private")}</em>
    <div class="friend-actions">
      <button class="secondary" type="button" data-friend-stats ${friend.statsVisible ? "" : "disabled"}>${t("friends.viewStats")}</button>
      <button class="share-revoke" type="button" data-friend-remove>${t("friends.remove")}</button>
    </div>
  </li>`).join("");
}

function renderInvites() {
  const list = $("inviteList");
  list.innerHTML = invites.map((invite) => `<li class="share-item" data-invite-id="${escapeHtml(invite.id)}">
    <div class="share-item-head"><strong>${t("invite.link")}</strong><span>${t("invite.expires", { date: formatDate(invite.expiresAt) })}</span></div>
    <input class="share-url" type="text" readonly value="${escapeHtml(invite.url)}" aria-label="${t("invite.link")}" />
    <div class="share-item-actions">
      <button class="secondary" type="button" data-invite-copy>${t("share.copyLink")}</button>
      ${typeof navigator.share === "function" ? `<button class="secondary" type="button" data-invite-send>${t("share.send")}</button>` : ""}
      <button class="share-revoke" type="button" data-invite-revoke>${t("share.revoke")}</button>
    </div>
  </li>`).join("");
}

async function createInvite() {
  $("inviteCreateButton").disabled = true;
  setStatus("friendsStatus");
  try {
    const { invite } = await createFriendInvite();
    invites = [invite, ...invites];
    renderInvites();
    setStatus("friendsStatus", t((await copyText(invite.url)) ? "invite.createdCopied" : "invite.created"));
  } catch (error) {
    setStatus("friendsStatus", error.message, true);
  } finally {
    $("inviteCreateButton").disabled = false;
  }
}

async function onInviteClick(event) {
  const item = event.target.closest(".share-item");
  const invite = item && invites.find((entry) => entry.id === item.dataset.inviteId);
  if (!invite) return;
  if (event.target.closest("[data-invite-copy]")) {
    setStatus("friendsStatus", t((await copyText(invite.url)) ? "share.copied" : "share.copyFailed"));
  } else if (event.target.closest("[data-invite-send]")) {
    try { await navigator.share({ title: "D3CF", text: t("invite.sendText", { name: user?.pilotName ?? "" }), url: invite.url }); }
    catch { /* dismissed */ }
  } else if (event.target.closest("[data-invite-revoke]")) {
    try { await revokeFriendInvite(invite.id); invites = invites.filter((entry) => entry.id !== invite.id); renderInvites(); setStatus("friendsStatus", t("invite.revoked")); }
    catch (error) { setStatus("friendsStatus", error.message, true); }
  }
}

async function onFriendClick(event) {
  const item = event.target.closest(".friend-item");
  const friend = item && friends.find((entry) => entry.id === item.dataset.friendId);
  if (!friend) return;
  if (event.target.closest("[data-friend-stats]")) {
    pilot = friend.id; trackId = null;
    renderPilotSelect();
    void loadStats();
    $("statsCard").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  } else if (event.target.closest("[data-friend-remove]")) {
    const ok = await callbacks.askDialog({ title: t("friends.removeTitle"), message: t("friends.removeConfirm", { name: friend.name }), confirmLabel: t("friends.remove"), danger: true });
    if (!ok) return;
    try {
      await removeFriend(friend.id);
      friends = friends.filter((entry) => entry.id !== friend.id);
      statsByPilot.delete(friend.id);
      if (pilot === friend.id) { pilot = ME; trackId = null; }
      renderFriends(); renderPilotSelect(); void loadStats();
      setStatus("friendsStatus", t("friends.removed"));
    } catch (error) { setStatus("friendsStatus", error.message, true); }
  }
}

// ---- Statistics ----
function renderPilotSelect() {
  const select = $("statsPilot");
  const visible = friends.filter((friend) => friend.statsVisible);
  select.innerHTML = `<option value="${ME}">${t("stats.me")}</option>` + visible.map((friend) => `<option value="${escapeHtml(friend.id)}">${escapeHtml(friend.name)}</option>`).join("");
  if (pilot !== ME && !visible.some((friend) => friend.id === pilot)) pilot = ME;
  select.value = pilot;
  select.hidden = visible.length === 0;
}

function currentStats() { return statsByPilot.get(pilot) ?? null; }

function renderTiles(stats) {
  const activity = stats?.activity;
  $("statsSessions").textContent = activity ? String(activity.sessions) : "—";
  $("statsLaps").textContent = activity ? String(activity.laps) : "—";
  $("statsDistance").textContent = activity ? activity.distanceKm.toLocaleString(getLanguage(), { maximumFractionDigits: 1 }) : "—";
  $("statsTime").textContent = activity ? formatHours(activity.durationMs) : "—";
}

function renderTracks(stats) {
  const tracks = stats?.tracks ?? [];
  $("statsTracksEmpty").hidden = !stats || tracks.length > 0;
  $("statsTrackBody").innerHTML = tracks.map((track) => `<tr class="${track.trackId === trackId ? "active" : ""}" data-track-id="${escapeHtml(track.trackId)}" tabindex="0" role="button" aria-pressed="${track.trackId === trackId}">
    <td>${escapeHtml(track.trackName ?? track.trackId)}</td><td class="num">${formatLap(track.bestLapMs)}</td><td class="num">${formatLap(track.idealLapMs)}</td><td class="num">${track.sessions}</td><td class="num">${track.laps}</td>
  </tr>`).join("");
  $("statsTracksTable").hidden = tracks.length === 0;
}

function drawChart(stats) {
  const canvas = $("statsChart");
  const track = stats?.tracks.find((item) => item.trackId === trackId);
  const wrap = canvas.parentElement;
  const points = track?.history ?? [];
  wrap.hidden = points.length < 2;
  if (points.length < 2) return;
  const style = getComputedStyle(document.documentElement);
  const color = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  const width = wrap.clientWidth || 600;
  const height = 180;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  const pad = { left: 62, right: 14, top: 14, bottom: 26 };
  const times = points.map((point) => new Date(point.at).getTime());
  const laps = points.map((point) => point.bestLapMs);
  const minLap = Math.min(...laps); const maxLap = Math.max(...laps);
  const spread = Math.max(maxLap - minLap, 200);
  const minTime = times[0]; const timeSpan = Math.max(times.at(-1) - minTime, 1);
  const x = (index) => pad.left + ((times[index] - minTime) / timeSpan) * (width - pad.left - pad.right);
  // Faster laps sit higher, so improvement reads as growth.
  const y = (lap) => pad.top + ((lap - minLap) / spread) * (height - pad.top - pad.bottom);
  context.font = "12px " + (style.getPropertyValue("--font-code").trim() || "monospace");
  context.fillStyle = color("--race-muted", "#888"); context.strokeStyle = color("--race-line", "#333"); context.lineWidth = 1;
  for (const value of [minLap, minLap + spread / 2, minLap + spread]) {
    context.beginPath(); context.moveTo(pad.left, Math.round(y(value)) + .5); context.lineTo(width - pad.right, Math.round(y(value)) + .5); context.stroke();
    context.textAlign = "right"; context.textBaseline = "middle"; context.fillText(formatLap(value), pad.left - 8, y(value));
  }
  context.textBaseline = "alphabetic";
  context.textAlign = "left"; context.fillText(formatDate(points[0].at), pad.left, height - 6);
  context.textAlign = "right"; context.fillText(formatDate(points.at(-1).at), width - pad.right, height - 6);
  context.strokeStyle = color("--race-red", "#e10600"); context.lineWidth = 2; context.lineJoin = "round";
  context.beginPath();
  laps.forEach((lap, index) => (index ? context.lineTo(x(index), y(lap)) : context.moveTo(x(index), y(lap))));
  context.stroke();
  context.fillStyle = color("--race-red", "#e10600");
  laps.forEach((lap, index) => { context.beginPath(); context.arc(x(index), y(lap), 3, 0, Math.PI * 2); context.fill(); });
  canvas.setAttribute("aria-label", t("stats.chartLabel", { from: formatLap(laps[0]), to: formatLap(laps.at(-1)) }));
}

function renderBoard() {
  const wrap = $("boardWrap");
  const showBoard = Boolean(trackId) && pilot === ME;
  wrap.hidden = !showBoard;
  if (!showBoard) return;
  const rows = board?.rows ?? [];
  $("boardBody").innerHTML = rows.map((row) => `<tr class="${row.you ? "you" : ""}">
    <td class="num">${row.rank}</td><td>${escapeHtml(row.name)}${row.you ? ` <small>${t("stats.you")}</small>` : ""}</td><td class="num">${formatLap(row.bestLapMs)}</td><td class="num">${formatGap(row.gapMs)}</td><td class="num">${formatLap(row.idealLapMs)}</td><td class="num">${row.sessions}</td>
  </tr>`).join("");
  $("boardTable").hidden = rows.length === 0;
  const hidden = board?.hiddenFriends ?? 0;
  const notes = [];
  if (board && board.friendCount === 0) notes.push(t("stats.boardNoFriends"));
  else if (hidden > 0) notes.push(t("stats.boardHidden", { count: hidden }));
  if (board?.pending) notes.push(t("stats.pending"));
  $("boardNote").textContent = notes.join(" ");
}

function renderStats() {
  const stats = currentStats();
  const tracks = stats?.tracks ?? [];
  if (stats && (!trackId || !tracks.some((track) => track.trackId === trackId))) trackId = tracks[0]?.trackId ?? null;
  renderTiles(stats); renderTracks(stats); drawChart(stats); renderBoard();
  $("statsPending").hidden = !stats?.pending;
  $("statsTitle").textContent = pilot === ME ? t("stats.title") : t("stats.titleOf", { name: friends.find((friend) => friend.id === pilot)?.name ?? "" });
}

async function loadBoard() {
  if (!trackId || pilot !== ME) { board = null; renderBoard(); return; }
  const wanted = trackId; const mark = generation;
  try {
    const result = await loadLeaderboard(wanted);
    if (mark !== generation || wanted !== trackId) return;
    board = result; renderBoard();
    if (result.pending) scheduleRetry();
  } catch (error) { if (mark === generation) $("boardNote").textContent = error.message; }
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  if (retries >= MAX_PENDING_RETRIES) return;
  retries += 1;
  retryTimer = setTimeout(() => { void loadStats(true); }, 2000);
}

async function loadStats(quiet = false) {
  if (!user) return;
  const mark = generation; const who = pilot;
  if (!quiet) { retries = 0; clearTimeout(retryTimer); setStatus("statsStatus"); }
  try {
    const result = who === ME ? await loadMyStats() : await loadFriendStats(who);
    if (mark !== generation) return;
    statsByPilot.set(who, result);
    if (who === pilot) { renderStats(); await loadBoard(); }
    if (result.pending) scheduleRetry();
  } catch (error) {
    if (mark !== generation) return;
    if (who !== ME && /does not share|not found/i.test(error.message)) { pilot = ME; await refreshFriends(); await loadStats(); return; }
    setStatus("statsStatus", error.message, true);
  }
}

async function refreshFriends() {
  const result = await loadFriends();
  friends = result.friends; invites = result.invites;
  renderFriends(); renderInvites(); renderPilotSelect();
}

function selectTrack(row) {
  const id = row?.dataset.trackId;
  if (!id || id === trackId) return;
  trackId = id; board = null;
  renderStats(); void loadBoard();
}

// ---- Public API ----
export function setStatsUser(next) {
  const changed = next?.id !== user?.id;
  user = next;
  if (changed) {
    generation += 1; clearTimeout(retryTimer);
    friends = []; invites = []; statsByPilot = new Map(); pilot = ME; trackId = null; board = null;
    renderFriends(); renderInvites(); renderPilotSelect(); renderStats();
  }
  renderSettings();
}

export function onStatsShown() {
  if (!user) return;
  renderSettings();
  void refreshFriends().then(() => loadStats()).catch((error) => setStatus("friendsStatus", error.message, true));
}

// "#friend=<token>" links: show who is inviting, ask, then become friends.
export async function acceptInviteFlow(token) {
  let inviter;
  try { inviter = (await previewFriendInvite(token)).inviter; }
  catch (error) { callbacks.showNotice(/no longer valid|not found/i.test(error.message) ? t("invite.invalid") : error.message, true); return false; }
  if (inviter.isYou) { callbacks.showNotice(t("invite.own"), true); return false; }
  const ok = await callbacks.askDialog({ title: t("invite.acceptTitle"), message: t("invite.acceptText", { name: inviter.name }), confirmLabel: t("invite.accept") });
  if (!ok) return false;
  try {
    const { friend, alreadyFriends } = await acceptFriend(token);
    callbacks.showNotice(t(alreadyFriends ? "invite.already" : "invite.accepted", { name: friend.name }));
    return true;
  } catch (error) { callbacks.showNotice(error.message, true); return false; }
}

export function initStats(options) {
  callbacks = options;
  $("pilotForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("pilotNameSave").disabled = true;
    await saveSettings({ displayName: $("pilotNameInput").value.trim() }, "pilotStatus");
    $("pilotNameSave").disabled = false;
  });
  $("pilotStatsVisible").addEventListener("change", async (event) => {
    const box = event.target; box.disabled = true;
    await saveSettings({ statsVisible: box.checked }, "pilotStatus");
    box.disabled = false;
  });
  $("inviteCreateButton").addEventListener("click", createInvite);
  $("inviteList").addEventListener("click", onInviteClick);
  $("friendList").addEventListener("click", onFriendClick);
  $("statsPilot").addEventListener("change", (event) => { pilot = event.target.value; trackId = null; board = null; if (currentStats()) renderStats(); void loadStats(); });
  $("statsTrackBody").addEventListener("click", (event) => selectTrack(event.target.closest("tr")));
  $("statsTrackBody").addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectTrack(event.target.closest("tr")); } });
  let resizeFrame = 0;
  window.addEventListener("resize", () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => { if (document.body.classList.contains("view-profile")) drawChart(currentStats()); }); });
  onLanguageChange(() => { renderSettings(); renderFriends(); renderInvites(); renderPilotSelect(); renderStats(); });
  renderStats();
}
