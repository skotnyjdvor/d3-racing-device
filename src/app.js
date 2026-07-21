import { RaceBoxBleClient } from "./ble/racebox.js";
import { analyzeSession, generateLocalInsights } from "./domain/analysis.js";
import { buildAiPrompt } from "./domain/ai-context.js";
import { distanceMeters, identifyTrack } from "./domain/tracks.js";
import { applyTranslations, getLanguage, onLanguageChange, setLanguage, t } from "./i18n.js";
import { cloudConfigured, currentUser, loadLogs, onAuthChange, saveLog, signIn, signOut, signUp } from "./cloud/api.js";

const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));
const state = { client: null, connected: false, deviceName: "", deviceModel: "", latestTelemetry: null, storage: null, sessions: [], selectedSession: null, analysis: null, selectedLapNumber: null, comparisonLapNumber: null, cursorProgress: null, track: null, user: null, cloudLogs: [], pollTimer: null };
const testMode = new URLSearchParams(location.search).has("mock");

const formatDuration = (milliseconds) => {
  if (!Number.isFinite(milliseconds)) return "—";
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.round((milliseconds % 60_000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

const formatLapTime = (milliseconds) => {
  if (!Number.isFinite(milliseconds)) return "—";
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor(milliseconds % 60_000 / 1000);
  const millis = Math.round(milliseconds % 1000);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
};

const formatDate = (iso) => new Intl.DateTimeFormat(getLanguage(), {
  day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
}).format(new Date(iso));

function setStatus(text, active = false) {
  elements.deviceStatus.textContent = text;
  elements.statusDot.classList.toggle("live", active);
}

function setHint(text, isError = false) {
  elements.actionHint.textContent = text;
  elements.actionHint.classList.toggle("error", isError);
}

function connectionErrorMessage(error) {
  if (error?.name === "NotFoundError" || /cancelled.*chooser/i.test(error?.message || "")) return t("error.notSelected");
  if (error?.name === "NetworkError") return t("error.network");
  if (error?.name === "SecurityError") return t("error.security");
  return error?.message || "Неизвестная ошибка Bluetooth";
}

function canvasContext(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * ratio));
  canvas.height = Math.max(1, Math.round(rect.height * ratio));
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { context, width: rect.width, height: rect.height };
}

function downsample(points, max = 1800) {
  if (points.length <= max) return points;
  const step = points.length / max;
  return Array.from({ length: max }, (_, index) => points[Math.floor(index * step)]);
}

function lapPoints(number) {
  if (!state.selectedSession) return [];
  return number ? state.selectedSession.points.filter((point) => point.lap === number) : state.selectedSession.points;
}

function distancePoints(points, max = 2400) {
  const sampled = downsample(points, max);
  if (sampled.length < 2) return [];
  let distance = 0;
  const series = sampled.map((point, index) => {
    if (index) distance += distanceMeters(sampled[index - 1], point);
    return { distance, point };
  });
  const total = Math.max(distance, 1);
  return series.map((item) => ({ progress: item.distance / total, point: item.point }));
}

function pointAtProgress(series, progress) {
  if (!series.length || progress === null) return null;
  let low = 0; let high = series.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (series[middle].progress < progress) low = middle + 1;
    else high = middle;
  }
  if (low > 0 && Math.abs(series[low - 1].progress - progress) < Math.abs(series[low].progress - progress)) return series[low - 1];
  return series[low];
}

function drawTrack() {
  const { context, width, height } = canvasContext(elements.trackCanvas);
  context.fillStyle = "#0c1117";
  context.fillRect(0, 0, width, height);
  const trackSeries = distancePoints(lapPoints(state.selectedLapNumber), 1800);
  const points = trackSeries.map((item) => item.point);
  if (points.length < 2) {
    context.fillStyle = "#657180";
    context.font = "13px system-ui";
    context.fillText(t("track.canvasEmpty"), 24, 38);
    return;
  }
  const lats = points.map((point) => point.latitude);
  const lons = points.map((point) => point.longitude);
  const minLat = Math.min(...lats); const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons); const maxLon = Math.max(...lons);
  const padding = 38;
  const scale = Math.min(
    (width - padding * 2) / Math.max(maxLon - minLon, 1e-9),
    (height - padding * 2) / Math.max(maxLat - minLat, 1e-9),
  );
  const offsetX = (width - (maxLon - minLon) * scale) / 2;
  const offsetY = (height - (maxLat - minLat) * scale) / 2;
  const project = (point) => [offsetX + (point.longitude - minLon) * scale, offsetY + (maxLat - point.latitude) * scale];
  const maxSpeed = Math.max(...points.map((point) => point.speed), 1);
  context.lineCap = "round"; context.lineJoin = "round";
  context.strokeStyle = "rgba(255,255,255,.08)"; context.lineWidth = 9; context.beginPath();
  points.forEach((point, index) => { const [x, y] = project(point); index ? context.lineTo(x, y) : context.moveTo(x, y); });
  context.stroke(); context.lineWidth = 3.2;
  for (let index = 1; index < points.length; index += 1) {
    const [x1, y1] = project(points[index - 1]); const [x2, y2] = project(points[index]);
    const ratio = Math.max(0, Math.min(1, points[index].speed / maxSpeed));
    context.strokeStyle = `hsl(${195 - ratio * 180} 92% 58%)`;
    context.beginPath(); context.moveTo(x1, y1); context.lineTo(x2, y2); context.stroke();
  }
  const cursorPoint = pointAtProgress(trackSeries, state.cursorProgress)?.point;
  if (cursorPoint) {
    const [x, y] = project(cursorPoint);
    context.shadowColor = "rgba(201,255,55,.8)"; context.shadowBlur = 15;
    context.fillStyle = "#c9ff37"; context.beginPath(); context.arc(x, y, 6, 0, Math.PI * 2); context.fill();
    context.shadowBlur = 0; context.strokeStyle = "#ffffff"; context.lineWidth = 2;
    context.beginPath(); context.arc(x, y, 9, 0, Math.PI * 2); context.stroke();
  }
}

function distanceSeries(points, key) {
  return distancePoints(points).map((item) => ({ progress: item.progress, value: item.point[key] }));
}

function drawComparisonChart(canvas, key, { speed = false } = {}) {
  const { context, width, height } = canvasContext(canvas);
  context.fillStyle = "#0c1117"; context.fillRect(0, 0, width, height);
  const primary = distanceSeries(lapPoints(state.selectedLapNumber), key);
  const comparison = distanceSeries(lapPoints(state.comparisonLapNumber), key);
  if (primary.length < 2) return;

  const padding = { left: 48, right: 18, top: 18, bottom: 30 };
  const values = [...primary, ...comparison].map((point) => point.value).filter(Number.isFinite);
  let minimum; let maximum; let step;
  if (speed) {
    minimum = 0;
    maximum = Math.ceil(Math.max(...values, 20) / 20) * 20;
    step = 20;
  } else {
    const range = Math.max(.5, Math.ceil(Math.max(...values.map(Math.abs), .5) * 2) / 2);
    minimum = -range; maximum = range; step = range / 2;
  }

  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const y = (value) => padding.top + (maximum - value) / Math.max(maximum - minimum, .001) * plotHeight;
  context.font = "10px ui-monospace, monospace"; context.fillStyle = "#73808e"; context.strokeStyle = "#202a34"; context.lineWidth = 1;
  for (let value = minimum; value <= maximum + step / 10; value += step) {
    const yPosition = y(value);
    context.beginPath(); context.moveTo(padding.left, yPosition); context.lineTo(width - padding.right, yPosition); context.stroke();
    context.fillText(speed ? String(Math.round(value)) : value.toFixed(1), 12, yPosition + 3);
  }
  for (let percent = 0; percent <= 100; percent += 25) {
    const xPosition = padding.left + percent / 100 * plotWidth;
    context.fillText(`${percent}%`, xPosition - (percent === 100 ? 24 : 8), height - 9);
  }

  const draw = (series, color, widthPx) => {
    if (series.length < 2) return;
    context.strokeStyle = color; context.lineWidth = widthPx; context.beginPath();
    series.forEach((point, index) => {
      const xPosition = padding.left + point.progress * plotWidth;
      const yPosition = y(point.value);
      index ? context.lineTo(xPosition, yPosition) : context.moveTo(xPosition, yPosition);
    });
    context.stroke();
  };
  draw(comparison, "#37d7ff", 1.6);
  draw(primary, "#c9ff37", 2.2);

  if (state.cursorProgress !== null) {
    const xPosition = padding.left + state.cursorProgress * plotWidth;
    context.strokeStyle = "rgba(255,255,255,.55)"; context.lineWidth = 1;
    context.beginPath(); context.moveTo(xPosition, padding.top); context.lineTo(xPosition, height - padding.bottom); context.stroke();
    const markers = [
      { item: pointAtProgress(primary, state.cursorProgress), color: "#c9ff37", side: -1 },
      { item: pointAtProgress(comparison, state.cursorProgress), color: "#37d7ff", side: 1 },
    ];
    markers.forEach(({ item, color, side }) => {
      if (!item || !Number.isFinite(item.value)) return;
      const yPosition = y(item.value);
      context.fillStyle = color; context.beginPath(); context.arc(xPosition, yPosition, 4.5, 0, Math.PI * 2); context.fill();
      const label = speed ? `${item.value.toFixed(1)}` : `${item.value.toFixed(2)} g`;
      context.font = "bold 11px ui-monospace, monospace";
      const labelWidth = context.measureText(label).width + 10;
      const labelX = Math.max(padding.left, Math.min(width - padding.right - labelWidth, xPosition + side * 8 - (side < 0 ? labelWidth : 0)));
      context.fillStyle = "rgba(12,17,23,.92)"; context.fillRect(labelX, yPosition - 20, labelWidth, 17);
      context.fillStyle = color; context.fillText(label, labelX + 5, yPosition - 8);
    });
  }
}

function drawCharts() {
  drawComparisonChart(elements.speedCanvas, "speed", { speed: true });
  drawComparisonChart(elements.longitudinalCanvas, "gForceX");
  drawComparisonChart(elements.lateralCanvas, "gForceY");
}

let cursorFrame = 0;
function setCursorProgress(progress) {
  state.cursorProgress = progress;
  if (cursorFrame) return;
  cursorFrame = requestAnimationFrame(() => {
    cursorFrame = 0;
    drawTrack(); drawCharts();
  });
}

function updateCursorFromEvent(event) {
  const rect = event.currentTarget.getBoundingClientRect();
  const paddingLeft = 48; const paddingRight = 18;
  const progress = (event.clientX - rect.left - paddingLeft) / Math.max(rect.width - paddingLeft - paddingRight, 1);
  setCursorProgress(Math.max(0, Math.min(1, progress)));
}

[elements.speedCanvas, elements.longitudinalCanvas, elements.lateralCanvas].forEach((canvas) => {
  canvas.addEventListener("pointerdown", (event) => { canvas.setPointerCapture?.(event.pointerId); updateCursorFromEvent(event); });
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType === "mouse" || canvas.hasPointerCapture?.(event.pointerId)) updateCursorFromEvent(event);
  });
  canvas.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "mouse" && !event.buttons) setCursorProgress(null);
  });
});

function renderStorage(storage) {
  state.storage = storage;
  elements.storageState.hidden = false;
  elements.deviceHealth.hidden = false;
  elements.memoryLevel.textContent = `${storage.memoryLevel}%`;
  elements.storedMessages.textContent = storage.storedMessages.toLocaleString("ru-RU");
  const freeMessages = Math.max(0, storage.capacityMessages - storage.storedMessages);
  const freePercent = storage.capacityMessages ? Math.max(0, 100 - storage.memoryLevel) : 0;
  elements.memoryFree.textContent = `${freePercent}%`;
  elements.memoryFreeMeta.textContent = t("memory.remaining", { records: freeMessages.toLocaleString(getLanguage()), time: formatDuration(freeMessages / 25 * 1000) });
  elements.unlockForm.hidden = !(storage.securityEnabled && !storage.unlocked);
  elements.downloadButton.disabled = storage.recording || storage.securityEnabled && !storage.unlocked || storage.storedMessages === 0;
  elements.recordButton.disabled = !state.client?.supportsStandaloneRecording || storage.securityEnabled && !storage.unlocked;
  elements.recordButton.classList.toggle("recording", storage.recording);
  elements.recordButton.innerHTML = `<span></span><b>${t(storage.recording ? "action.stop" : "action.start")}</b>`;
  setHint(storage.recording ? t("hint.recording") : t("hint.ready", { model: state.deviceModel || "—" }));
}

function renderTelemetry(point) {
  state.latestTelemetry = point;
  const hasFix = point.fixStatus === 3 && (point.fixStatusFlags & 1) !== 0;
  elements.deviceHealth.hidden = false;
  elements.gpsFix.textContent = t(hasFix ? "device.fix" : "device.noFix");
  elements.gpsFix.className = hasFix ? "good" : "bad";
  elements.satellites.textContent = t("device.satellites", { count: point.satellites });
  if (state.deviceModel === "RaceBoxMicro") {
    elements.batteryLevel.textContent = `${(point.batteryRaw / 10).toFixed(1)} V`;
    elements.batteryMeta.textContent = t("device.inputVoltage");
  } else {
    const charging = (point.batteryRaw & 0x80) !== 0;
    elements.batteryLevel.textContent = `${point.batteryRaw & 0x7f}%`;
    elements.batteryMeta.textContent = t(charging ? "device.charging" : "device.batteryPower");
  }
}

async function refreshStorage() {
  if (!state.client) return;
  try { renderStorage(await state.client.readStorageStatus()); }
  catch (error) { setHint(connectionErrorMessage(error), true); }
}

function renderSessions() {
  elements.sessionsValue.textContent = String(state.sessions.length);
  elements.sessionsMeta.textContent = t("progress.records", { received: state.sessions.reduce((sum, session) => sum + session.points.length, 0).toLocaleString(getLanguage()), expected: state.sessions.reduce((sum, session) => sum + session.points.length, 0).toLocaleString(getLanguage()) });
  elements.sessionList.innerHTML = state.sessions.map((session) => `
    <button class="session-item ${session === state.selectedSession ? "selected" : ""}" data-session="${session.id}">
      <strong>${t("sessions.item", { id: session.displayId ?? session.id })}${session.source === "cloud" ? " ☁" : ""}</strong><span>${formatDate(session.startedAt)}</span><small>${formatDuration(new Date(session.endedAt) - new Date(session.startedAt))} · ${t("sessions.points", { count: session.points.length.toLocaleString(getLanguage()) })}</small>
    </button>`).join("");
  elements.sessionList.querySelectorAll("[data-session]").forEach((button) => button.addEventListener("click", () => selectSession(button.dataset.session)));
}

function renderLapControls() {
  const laps = state.analysis?.laps ?? [];
  const options = laps.map((lap) => `<option value="${lap.number}">${t("laps.option", { lap: lap.number, time: formatLapTime(lap.durationMs) })}</option>`).join("");
  elements.primaryLapSelect.innerHTML = options;
  elements.comparisonLapSelect.innerHTML = `<option value="">${t("laps.none")}</option>${options}`;
  elements.primaryLapSelect.disabled = !laps.length;
  elements.comparisonLapSelect.disabled = laps.length < 2;
  elements.primaryLapSelect.value = state.selectedLapNumber ? String(state.selectedLapNumber) : "";
  elements.comparisonLapSelect.value = state.comparisonLapNumber ? String(state.comparisonLapNumber) : "";
  elements.primaryLapLegend.textContent = state.selectedLapNumber ? t("laps.legend", { lap: state.selectedLapNumber }) : "—";
  elements.comparisonLapLegend.textContent = state.comparisonLapNumber ? t("laps.legend", { lap: state.comparisonLapNumber }) : t("laps.none");
}

function updateLapView() {
  if (!state.analysis || !state.selectedSession) return;
  const lap = state.analysis.laps.find((item) => item.number === state.selectedLapNumber);
  elements.durationValue.textContent = lap ? formatLapTime(lap.durationMs) : formatDuration(state.analysis.session.durationMs);
  elements.durationMeta.textContent = lap ? t("laps.legend", { lap: lap.number }) : formatDate(state.selectedSession.startedAt);
  elements.maxSpeedValue.textContent = (lap?.maxSpeed ?? state.analysis.session.maxSpeed).toFixed(1);
  elements.sampleRateValue.textContent = state.analysis.sampleRateHz.toFixed(0);
  elements.trackTitle.textContent = `${state.track ? `${state.track.name} · ` : ""}${t("sessions.item", { id: state.selectedSession.displayId ?? state.selectedSession.id })}${lap ? ` · ${t("laps.legend", { lap: lap.number })}` : ""}`;
  renderLapControls(); drawTrack(); drawCharts();
}

function selectSession(id) {
  const isNewSession = String(state.selectedSession?.id) !== String(id);
  state.selectedSession = state.sessions.find((session) => String(session.id) === String(id));
  if (!state.selectedSession?.points.length) return;
  state.analysis = analyzeSession(state.selectedSession.points);
  state.track = identifyTrack(state.selectedSession.points);
  if (isNewSession || !state.analysis.laps.some((lap) => lap.number === state.selectedLapNumber)) {
    const ordered = [...state.analysis.laps].sort((a, b) => a.durationMs - b.durationMs);
    state.selectedLapNumber = ordered[0]?.number ?? null;
    state.comparisonLapNumber = ordered[1]?.number ?? null;
  }
  elements.sourceLabel.textContent = `${state.deviceName} · память устройства`;
  elements.copyAiButton.disabled = false;
  elements.copyStatus.textContent = "Контекст строится только по выбранной сессии.";
  elements.insightsList.innerHTML = generateLocalInsights(state.analysis, t).map((insight) => `<li>${insight}</li>`).join("");
  renderSessions(); updateLapView();
}

function setAccountMessage(message = "", error = false) {
  elements.accountMessage.textContent = message;
  elements.accountMessage.classList.toggle("error", error);
}

function renderAccount() {
  const email = state.user?.email ?? "";
  elements.accountGuest.hidden = Boolean(state.user);
  elements.accountMember.hidden = !state.user;
  elements.accountLabel.textContent = email || t("account.signIn");
  elements.accountAvatar.textContent = email ? email[0] : "?";
  elements.accountUserEmail.textContent = email;
  elements.cloudLogStatus.textContent = state.user ? t("account.logs", { count: state.cloudLogs.length }) : "";
  if (!cloudConfigured) {
    setAccountMessage(t("account.notConfigured"), true);
    elements.accountForm.querySelectorAll("input, button").forEach((element) => { element.disabled = true; });
  }
}

async function syncCloudLogs() {
  if (!state.user) return;
  try {
    state.cloudLogs = await loadLogs();
    const localLogs = state.sessions.filter((session) => session.source !== "cloud");
    const localDates = new Set(localLogs.map((session) => session.startedAt));
    state.sessions = [...localLogs, ...state.cloudLogs.filter((session) => !localDates.has(session.startedAt))];
    renderAccount(); renderSessions();
    if (!state.selectedSession && state.sessions.length) selectSession(state.sessions[0].id);
  } catch (error) { setAccountMessage(error.message, true); }
}

async function applyUser(user) {
  state.user = user;
  if (!user) {
    state.cloudLogs = [];
    state.sessions = state.sessions.filter((session) => session.source !== "cloud");
    if (state.selectedSession?.source === "cloud") state.selectedSession = null;
    renderAccount(); renderSessions();
    return;
  }
  renderAccount();
  await syncCloudLogs();
}

async function submitAccount(action) {
  const email = elements.accountEmail.value.trim();
  const password = elements.accountPassword.value;
  setAccountMessage("");
  try {
    const user = await action(email, password);
    if (user) await applyUser(user);
    else setAccountMessage(t("account.confirm"));
  } catch (error) { setAccountMessage(error.message, true); }
}

async function saveDownloadedLogs(sessions) {
  if (!state.user) return;
  try {
    await Promise.all(sessions.map((session) => saveLog(session, state.deviceName)));
    await syncCloudLogs();
    setAccountMessage(t("account.saved"));
  } catch (error) { setAccountMessage(error.message, true); }
}

async function createClient() {
  let Client = RaceBoxBleClient;
  if (testMode) Client = (await import("./ble/mock-racebox.js")).MockRaceBoxClient;
  else if (globalThis.Capacitor?.isNativePlatform?.()) {
    Client = (await import("./ble/capacitor-racebox.js")).CapacitorRaceBoxClient;
  }
  return new Client({ onTelemetry: renderTelemetry, onStatus: (status, name) => {
    const connected = status === "connected";
    state.connected = connected;
    setStatus(connected ? t("state.connected", { name }) : t("status.disconnected"), connected);
    elements.connectButton.textContent = t(connected ? "action.disconnect" : "action.connect");
    if (!connected) {
      clearInterval(state.pollTimer); state.pollTimer = null; state.client = null;
      elements.downloadButton.disabled = true; elements.recordButton.disabled = true;
    }
  }});
}

async function connect() {
  if (state.client) { state.client.disconnect(); return; }
  try {
    setStatus(t("status.searching")); setHint(t("error.notSelected"));
    const client = await createClient();
    state.deviceName = await client.connect(); state.client = client; state.deviceModel = client.model;
    setStatus(t("state.reading", { name: state.deviceName }), true);
    await refreshStorage();
    clearInterval(state.pollTimer);
    state.pollTimer = setInterval(refreshStorage, 10_000);
    setStatus(t("state.ready", { name: state.deviceName }), true);
  } catch (error) { state.client = null; setStatus(t("status.connectFailed")); setHint(connectionErrorMessage(error), true); }
}

async function toggleRecording() {
  if (!state.client || !state.storage) return;
  const wasRecording = state.storage.recording;
  elements.recordButton.disabled = true;
  try {
    setStatus(t(wasRecording ? "state.stopped" : "state.recording", { name: state.deviceName }), true);
    if (wasRecording) await state.client.stopRecording();
    else await state.client.startRecording();
    await refreshStorage();
    setStatus(t(wasRecording ? "state.stopped" : "state.recording", { name: state.deviceName }), true);
  } catch (error) {
    setHint(error.message, true);
    setStatus(`${state.deviceName} · команда записи отклонена`, true);
  } finally {
    elements.recordButton.disabled = !state.client?.supportsStandaloneRecording || state.storage?.securityEnabled && !state.storage?.unlocked;
  }
}

async function downloadHistory() {
  try {
    elements.downloadButton.disabled = true; elements.downloadProgress.hidden = false; elements.cancelButton.hidden = false;
    setStatus(t("state.downloading", { name: state.deviceName }), true);
    const sessions = await state.client.downloadHistory(({ expected, received, percent }) => {
      elements.progressBar.value = percent;
      elements.progressLabel.textContent = expected ? t("progress.records", { received: received.toLocaleString(getLanguage()), expected: expected.toLocaleString(getLanguage()) }) : t("progress.preparing");
    });
    if (!sessions.length) throw new Error("В памяти не найдено записей телеметрии");
    state.sessions = sessions; state.selectedSession = sessions.at(-1);
    renderSessions(); selectSession(state.selectedSession.id);
    await saveDownloadedLogs(sessions);
    elements.progressBar.value = 100; elements.progressLabel.textContent = t("progress.done", { count: sessions.length });
    elements.cancelButton.hidden = true;
    setStatus(t("state.loaded", { name: state.deviceName }), true); setHint(t("state.loaded", { name: state.deviceName }));
  } catch (error) { elements.cancelButton.hidden = true; setStatus(`${state.deviceName} · ошибка загрузки`, true); setHint(error.message, true); }
  finally { elements.downloadButton.disabled = false; }
}

elements.connectButton.addEventListener("click", connect);
elements.recordButton.addEventListener("click", toggleRecording);
elements.downloadButton.addEventListener("click", downloadHistory);
elements.cancelButton.addEventListener("click", () => state.client?.cancelDownload());
elements.accountButton.addEventListener("click", () => { renderAccount(); elements.accountDialog.showModal(); });
elements.accountClose.addEventListener("click", () => elements.accountDialog.close());
elements.accountDialog.addEventListener("click", (event) => { if (event.target === elements.accountDialog) elements.accountDialog.close(); });
elements.accountForm.addEventListener("submit", async (event) => { event.preventDefault(); await submitAccount(signIn); });
elements.registerButton.addEventListener("click", () => submitAccount(signUp));
elements.logoutButton.addEventListener("click", async () => { try { await signOut(); await applyUser(null); } catch (error) { setAccountMessage(error.message, true); } });
elements.unlockForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const ok = await state.client.unlockMemory(Number(elements.securityCode.value));
    if (!ok) throw new Error("Неверный код памяти");
    renderStorage(await state.client.readStorageStatus()); setHint("Память разблокирована.");
  } catch (error) { setHint(error.message, true); }
});
elements.copyAiButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(buildAiPrompt(state.analysis, elements.aiQuestion.value));
  elements.copyStatus.textContent = "AI-контекст выбранной BLE-сессии скопирован.";
});
elements.primaryLapSelect.addEventListener("change", () => {
  state.selectedLapNumber = Number(elements.primaryLapSelect.value) || null;
  if (state.comparisonLapNumber === state.selectedLapNumber) state.comparisonLapNumber = null;
  updateLapView();
});
elements.comparisonLapSelect.addEventListener("change", () => {
  state.comparisonLapNumber = Number(elements.comparisonLapSelect.value) || null;
  if (state.comparisonLapNumber === state.selectedLapNumber) state.comparisonLapNumber = null;
  updateLapView();
});
window.addEventListener("resize", () => { drawTrack(); drawCharts(); });
elements.languageSelect.addEventListener("change", () => setLanguage(elements.languageSelect.value));
onLanguageChange(() => {
  renderAccount();
  if (state.storage) renderStorage(state.storage);
  if (state.latestTelemetry) renderTelemetry(state.latestTelemetry);
  if (state.sessions.length) renderSessions();
  if (state.selectedSession) selectSession(state.selectedSession.id);
  else { drawTrack(); drawCharts(); }
  if (state.connected) {
    setStatus(t(state.storage?.recording ? "state.recording" : "state.ready", { name: state.deviceName }), true);
    elements.connectButton.textContent = t("action.disconnect");
  } else {
    setStatus(t("status.disconnected"));
    elements.connectButton.textContent = t("action.connect");
  }
});
applyTranslations();
renderAccount();
drawTrack(); drawCharts();

if (cloudConfigured) {
  onAuthChange((user) => { if (user?.id !== state.user?.id) applyUser(user); });
  currentUser().then(applyUser);
}

if (testMode) elements.actionHint.textContent = t("hint.mock");
