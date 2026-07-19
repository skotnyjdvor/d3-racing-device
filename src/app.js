import { RaceBoxBleClient } from "./ble/racebox.js";
import { analyzeSession, generateLocalInsights } from "./domain/analysis.js";
import { buildAiPrompt } from "./domain/ai-context.js";
import { applyTranslations, getLanguage, onLanguageChange, setLanguage, t } from "./i18n.js";

const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));
const state = { client: null, connected: false, deviceName: "", deviceModel: "", latestTelemetry: null, storage: null, sessions: [], selectedSession: null, analysis: null, pollTimer: null };
const testMode = new URLSearchParams(location.search).has("mock");

const formatDuration = (milliseconds) => {
  if (!Number.isFinite(milliseconds)) return "—";
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.round((milliseconds % 60_000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
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

function drawTrack() {
  const { context, width, height } = canvasContext(elements.trackCanvas);
  context.fillStyle = "#0c1117";
  context.fillRect(0, 0, width, height);
  const points = downsample(state.selectedSession?.points ?? []);
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
}

function drawSpeed() {
  const { context, width, height } = canvasContext(elements.speedCanvas);
  context.fillStyle = "#0c1117"; context.fillRect(0, 0, width, height);
  const points = downsample(state.selectedSession?.points ?? [], 2400);
  if (points.length < 2) return;
  const padding = { left: 48, right: 18, top: 18, bottom: 28 };
  const max = Math.ceil(Math.max(...points.map((point) => point.speed)) / 20) * 20 || 20;
  context.font = "10px ui-monospace, monospace"; context.fillStyle = "#73808e"; context.strokeStyle = "#202a34";
  for (let value = 0; value <= max; value += 20) {
    const y = height - padding.bottom - value / max * (height - padding.top - padding.bottom);
    context.beginPath(); context.moveTo(padding.left, y); context.lineTo(width - padding.right, y); context.stroke(); context.fillText(String(value), 16, y + 3);
  }
  const firstTime = points[0].timeMs; const duration = Math.max(1, points.at(-1).timeMs - firstTime);
  const x = (point) => padding.left + (point.timeMs - firstTime) / duration * (width - padding.left - padding.right);
  const y = (point) => height - padding.bottom - point.speed / max * (height - padding.top - padding.bottom);
  const gradient = context.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, "#37d7ff"); gradient.addColorStop(.58, "#c9ff37"); gradient.addColorStop(1, "#ff5f35");
  context.strokeStyle = gradient; context.lineWidth = 2; context.beginPath();
  points.forEach((point, index) => index ? context.lineTo(x(point), y(point)) : context.moveTo(x(point), y(point)));
  context.stroke();
}

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
      <strong>${t("sessions.item", { id: session.id })}</strong><span>${formatDate(session.startedAt)}</span><small>${formatDuration(new Date(session.endedAt) - new Date(session.startedAt))} · ${t("sessions.points", { count: session.points.length.toLocaleString(getLanguage()) })}</small>
    </button>`).join("");
  elements.sessionList.querySelectorAll("[data-session]").forEach((button) => button.addEventListener("click", () => selectSession(Number(button.dataset.session))));
}

function selectSession(id) {
  state.selectedSession = state.sessions.find((session) => session.id === id);
  if (!state.selectedSession?.points.length) return;
  state.analysis = analyzeSession(state.selectedSession.points);
  elements.durationValue.textContent = formatDuration(state.analysis.session.durationMs);
  elements.durationMeta.textContent = formatDate(state.selectedSession.startedAt);
  elements.maxSpeedValue.textContent = state.analysis.session.maxSpeed.toFixed(1);
  elements.sampleRateValue.textContent = state.analysis.sampleRateHz.toFixed(0);
  elements.trackTitle.textContent = `${t("sessions.item", { id })} · ${formatDate(state.selectedSession.startedAt)}`;
  elements.sourceLabel.textContent = `${state.deviceName} · память устройства`;
  elements.copyAiButton.disabled = false;
  elements.copyStatus.textContent = "Контекст строится только по выбранной сессии.";
  elements.insightsList.innerHTML = generateLocalInsights(state.analysis, t).map((insight) => `<li>${insight}</li>`).join("");
  renderSessions(); drawTrack(); drawSpeed();
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
window.addEventListener("resize", () => { drawTrack(); drawSpeed(); });
elements.languageSelect.addEventListener("change", () => setLanguage(elements.languageSelect.value));
onLanguageChange(() => {
  if (state.storage) renderStorage(state.storage);
  if (state.latestTelemetry) renderTelemetry(state.latestTelemetry);
  if (state.sessions.length) renderSessions();
  if (state.selectedSession) selectSession(state.selectedSession.id);
  else { drawTrack(); drawSpeed(); }
  if (state.connected) {
    setStatus(t(state.storage?.recording ? "state.recording" : "state.ready", { name: state.deviceName }), true);
    elements.connectButton.textContent = t("action.disconnect");
  } else {
    setStatus(t("status.disconnected"));
    elements.connectButton.textContent = t("action.connect");
  }
});
applyTranslations();
drawTrack(); drawSpeed();

if (testMode) elements.actionHint.textContent = t("hint.mock");
