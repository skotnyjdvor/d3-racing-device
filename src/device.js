// LapTrace over Bluetooth: connection status, GPS / battery telemetry, device memory (download, record,
// unlock, erase).
import { RaceBoxBleClient } from "./ble/racebox.js";
import { getLanguage } from "./i18n.js";

export function createDevice(ctx) {
  const {
    state, elements, t, formatDuration, askDialog, testMode, appMode, accountRequired, openAccountDialog, showView, currentView,
    storeLocally, renderSessions, selectSession, syncLocalToCloud, saveDownloadedLogs,
  } = ctx;

  function setStatus(text, active = false) {
    elements.deviceStatus.textContent = text;
    elements.statusDot.classList.toggle("live", active);
    elements.railDeviceDot.classList.toggle("live", active);
    elements.deviceSummaryStatus.textContent = text;
    elements.deviceSummaryDot.classList.toggle("live", active);
  }

  function setHint(text, isError = false) {
    elements.actionHint.textContent = text;
    elements.actionHint.classList.toggle("error", isError);
  }

  // Web Bluetooth exists only in Chromium browsers; iOS Safari and Firefox need the native app or a CSV import.
  const bluetoothAvailable = () => testMode || Boolean(globalThis.Capacitor?.isNativePlatform?.()) || Boolean(globalThis.navigator?.bluetooth);

  function renderBluetoothSupport() {
    const available = bluetoothAvailable();
    elements.bluetoothNotice.hidden = available;
    elements.connectButton.disabled = !available && !state.client;
    elements.onboardConnectButton.classList.toggle("unavailable", !available);
    document.body.classList.toggle("bt-unavailable", !available);
    elements.onboardConnectText.textContent = t(available ? "onboard.connectText" : "onboard.connectUnsupported");
  }

  function connectionErrorMessage(error) {
    if (error?.code === "no-web-bluetooth") return t("bt.copy");
    if (error?.code === "not-laptrace") return t("error.notLapTrace", { name: error.deviceName || "—" });
    if (error?.name === "NotFoundError" || /cancelled.*chooser/i.test(error?.message || "")) return t("error.notSelected");
    if (error?.name === "NetworkError") return t("error.network");
    if (error?.name === "SecurityError") return t("error.security");
    return error?.message || t("error.bluetoothUnknown");
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
    elements.downloadButton.disabled = state.memoryBusy || storage.recording || storage.securityEnabled && !storage.unlocked || storage.storedMessages === 0;
    elements.eraseButton.disabled = state.memoryBusy || storage.recording || storage.securityEnabled && !storage.unlocked || storage.storedMessages === 0;
    elements.recordButton.disabled = state.memoryBusy || !state.client?.supportsStandaloneRecording || storage.securityEnabled && !storage.unlocked;
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
        elements.eraseButton.disabled = true;
      }
    }});
  }

  async function connect() {
    if (accountRequired()) { openAccountDialog(); return; }
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
    if (accountRequired()) { openAccountDialog(); return; }
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
      setStatus(t("state.recordRejected", { name: state.deviceName }), true);
    } finally {
      elements.recordButton.disabled = !state.client?.supportsStandaloneRecording || state.storage?.securityEnabled && !state.storage?.unlocked;
    }
  }

  async function downloadHistory() {
    if (accountRequired()) { openAccountDialog(); return; }
    try {
      elements.downloadButton.disabled = true; elements.downloadProgress.hidden = false; elements.cancelButton.hidden = false;
      setStatus(t("state.downloading", { name: state.deviceName }), true);
      const sessions = await state.client.downloadHistory(({ expected, received, percent }) => {
        elements.progressBar.value = percent;
        elements.progressLabel.textContent = expected ? t("progress.records", { received: received.toLocaleString(getLanguage()), expected: expected.toLocaleString(getLanguage()) }) : t("progress.preparing");
      });
      if (!sessions.length) throw new Error(t("error.noRecords"));
      if (appMode) {
        // Keep everything already on the device; the newest downloaded session opens.
        const stored = [];
        for (const session of sessions) stored.push(await storeLocally(session.points, { deviceName: state.deviceName }));
        renderSessions(); await selectSession(stored.at(-1).id);
        void syncLocalToCloud();
      } else {
        state.sessions = sessions; state.selectedSession = sessions.at(-1);
        renderSessions(); selectSession(state.selectedSession.id);
        await saveDownloadedLogs(sessions);
      }
      elements.progressBar.value = 100; elements.progressLabel.textContent = t("progress.done", { count: sessions.length });
      elements.cancelButton.hidden = true;
      setStatus(t("state.loaded", { name: state.deviceName }), true); setHint(t("state.loaded", { name: state.deviceName }));
      // In the app the device controls have their own tab: show the fresh session straight away.
      if (appMode && currentView() === "device") showView("analysis");
    } catch (error) { elements.cancelButton.hidden = true; setStatus(t("state.downloadFailed", { name: state.deviceName }), true); setHint(error.message, true); }
    finally { elements.downloadButton.disabled = false; }
  }

  async function eraseDeviceMemory() {
    if (accountRequired()) { openAccountDialog(); return; }
    if (!state.client || !state.storage || state.storage.recording || state.storage.storedMessages === 0) return;
    if (!await askDialog({ title: t("erase.title"), message: t("erase.confirm"), confirmLabel: t("action.erase"), danger: true })) return;
    elements.eraseButton.disabled = true;
    elements.downloadButton.disabled = true;
    elements.recordButton.disabled = true;
    state.memoryBusy = true;
    elements.eraseProgress.hidden = false;
    elements.eraseProgressBar.value = 0;
    elements.eraseProgressLabel.textContent = t("erase.progress", { percent: 0 });
    try {
      await state.client.eraseHistory((percent) => {
        elements.eraseProgressBar.value = percent;
        elements.eraseProgressLabel.textContent = t("erase.progress", { percent });
      });
      elements.eraseProgressBar.value = 100;
      elements.eraseProgressLabel.textContent = t("erase.done");
      await refreshStorage();
      setHint(t("erase.done"));
    } catch (error) {
      setHint(error.message, true);
    } finally {
      state.memoryBusy = false;
      if (state.storage) renderStorage(state.storage);
    }
  }

  elements.connectButton.addEventListener("click", connect);
  elements.onboardConnectButton.addEventListener("click", () => {
    if (appMode) showView("device");
    if (!bluetoothAvailable()) { elements.bluetoothNotice.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    elements.connectButton.scrollIntoView({ behavior: "smooth", block: "center" });
    void connect();
  });
  elements.recordButton.addEventListener("click", toggleRecording);
  elements.downloadButton.addEventListener("click", downloadHistory);
  elements.eraseButton.addEventListener("click", eraseDeviceMemory);
  elements.cancelButton.addEventListener("click", () => state.client?.cancelDownload());
  elements.unlockForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const ok = await state.client.unlockMemory(Number(elements.securityCode.value));
      if (!ok) throw new Error(t("memory.wrongCode"));
      renderStorage(await state.client.readStorageStatus()); setHint(t("memory.unlocked"));
    } catch (error) { setHint(error.message, true); }
  });

  return { setStatus, renderBluetoothSupport, renderStorage, renderTelemetry };
}
