import { BleClient } from "@capacitor-community/bluetooth-le";
import { encodePacket, UbxStreamParser } from "./ubx.js";
import {
  DEVICE_INFO_SERVICE,
  HistoryDownloadCollector,
  MODEL_CHARACTERISTIC,
  RACEBOX_CLASS as CLASS,
  RACEBOX_MESSAGE as MESSAGE,
  RACEBOX_RX,
  RACEBOX_TX,
  RACEBOX_UART_SERVICE,
  decodeRaceBoxData,
  decodeRecordingStatus,
  encodeRecordingConfiguration,
  isReplyFor,
} from "./racebox.js";

function asDataView(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export class CapacitorRaceBoxClient {
  constructor({ onStatus, onTelemetry }) {
    this.onStatus = onStatus;
    this.onTelemetry = onTelemetry;
    this.parser = new UbxStreamParser();
    this.pending = [];
    this.download = null;
    this.erase = null;
    this.device = null;
  }

  async connect() {
    await BleClient.initialize();
    const enabled = await BleClient.isEnabled();
    if (!enabled) throw new Error("Включите Bluetooth на iPhone и повторите подключение");

    this.device = await BleClient.requestDevice({
      optionalServices: [RACEBOX_UART_SERVICE, DEVICE_INFO_SERVICE],
      displayMode: "list",
    });
    await BleClient.connect(this.device.deviceId, () => this.#handleDisconnect());
    await BleClient.startNotifications(
      this.device.deviceId,
      RACEBOX_UART_SERVICE,
      RACEBOX_TX,
      (value) => this.#handleNotification(value),
    );

    this.model = await this.#readModel();
    this.supportsStandaloneRecording = this.model !== "RaceBoxMini";
    const name = this.device.name || "LapTrace";
    this.onStatus?.("connected", name);
    return name;
  }

  async disconnect() {
    if (!this.device) return;
    const { deviceId } = this.device;
    this.device = null;
    try { await BleClient.stopNotifications(deviceId, RACEBOX_UART_SERVICE, RACEBOX_TX); } catch {}
    try { await BleClient.disconnect(deviceId); } catch {}
    this.onStatus?.("disconnected", "LapTrace");
  }

  async readStorageStatus() {
    const packet = await this.#request(MESSAGE.RECORDING_STATUS, new Uint8Array(0),
      (candidate) => candidate.messageClass === CLASS && candidate.messageId === MESSAGE.RECORDING_STATUS && candidate.payload.length === 12);
    return decodeRecordingStatus(packet.payload);
  }

  async unlockMemory(code) {
    if (!Number.isInteger(code) || code < 0 || code > 0xffffffff) {
      throw new Error("Код должен быть целым числом от 0 до 4294967295");
    }
    const payload = new Uint8Array(4);
    new DataView(payload.buffer).setUint32(0, code, true);
    const packet = await this.#request(MESSAGE.UNLOCK, payload,
      (candidate) => isReplyFor(candidate, MESSAGE.ACK, MESSAGE.UNLOCK) || isReplyFor(candidate, MESSAGE.NACK, MESSAGE.UNLOCK));
    return packet.messageId === MESSAGE.ACK;
  }

  async startRecording() {
    if (!this.supportsStandaloneRecording) throw new Error(`${this.model} не поддерживает запись во внутреннюю память`);
    return this.#setRecording(true);
  }

  async stopRecording() {
    return this.#setRecording(false);
  }

  async downloadHistory(onProgress) {
    if (this.download) throw new Error("Загрузка уже выполняется");
    const collector = new HistoryDownloadCollector(onProgress);
    const promise = new Promise((resolve, reject) => { this.download = { collector, resolve, reject }; });
    await this.#write(encodePacket(CLASS, MESSAGE.DOWNLOAD));
    return promise;
  }

  async cancelDownload() {
    if (this.download) await this.#write(encodePacket(CLASS, MESSAGE.DOWNLOAD, Uint8Array.of(1)));
  }

  async eraseHistory(onProgress = () => {}) {
    if (this.erase || this.download) throw new Error("Другая операция с памятью уже выполняется");
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.erase) return;
        this.erase = null;
        reject(new Error("Очистка памяти не завершилась вовремя"));
      }, 180_000);
      this.erase = { resolve, reject, onProgress, timer };
    });
    try {
      await this.#write(encodePacket(CLASS, MESSAGE.ERASE));
    } catch (error) {
      clearTimeout(this.erase?.timer);
      this.erase = null;
      throw error;
    }
    return promise;
  }

  async #request(messageId, payload, match, timeoutMs = 10_000) {
    const response = new Promise((resolve, reject) => {
      const pending = { match, resolve, reject };
      pending.timer = setTimeout(() => {
        this.pending = this.pending.filter((item) => item !== pending);
        reject(new Error("LapTrace не ответил на команду"));
      }, timeoutMs);
      this.pending.push(pending);
    });
    await this.#write(encodePacket(CLASS, messageId, payload));
    return response;
  }

  async #write(bytes) {
    if (!this.device) throw new Error("LapTrace не подключён");
    const args = [this.device.deviceId, RACEBOX_UART_SERVICE, RACEBOX_RX, asDataView(bytes)];
    try { await BleClient.writeWithoutResponse(...args); }
    catch { await BleClient.write(...args); }
  }

  async #setRecording(enable) {
    const packet = await this.#request(MESSAGE.RECORDING_CONFIG, encodeRecordingConfiguration(enable),
      (candidate) => isReplyFor(candidate, MESSAGE.ACK, MESSAGE.RECORDING_CONFIG) || isReplyFor(candidate, MESSAGE.NACK, MESSAGE.RECORDING_CONFIG));
    if (packet.messageId === MESSAGE.NACK) {
      throw new Error(enable ? "LapTrace отклонил запуск записи" : "LapTrace отклонил остановку записи");
    }
    return true;
  }

  async #readModel() {
    try {
      const value = await BleClient.read(this.device.deviceId, DEVICE_INFO_SERVICE, MODEL_CHARACTERISTIC);
      return new TextDecoder().decode(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)).replace(/\0+$/, "").trim() || "LapTrace";
    } catch {
      return "LapTrace";
    }
  }

  #handleNotification(dataView) {
    const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
    for (const packet of this.parser.push(bytes)) {
      if (packet.messageClass === CLASS && packet.messageId === MESSAGE.DATA && packet.payload.length === 80) {
        this.onTelemetry?.(decodeRaceBoxData(packet.payload));
      }
      if (this.download) {
        const event = this.download.collector.handle(packet);
        if (event === "complete") {
          const { collector, resolve } = this.download;
          this.download = null;
          resolve(collector.result());
        } else if (isReplyFor(packet, MESSAGE.NACK, MESSAGE.DOWNLOAD)) {
          const { reject } = this.download;
          this.download = null;
          reject(new Error("LapTrace отклонил выгрузку памяти"));
        }
      }
      if (this.erase && packet.messageClass === CLASS && packet.messageId === MESSAGE.ERASE && packet.payload.length === 1) {
        this.erase.onProgress(Math.max(0, Math.min(100, packet.payload[0])));
      } else if (this.erase && isReplyFor(packet, MESSAGE.ACK, MESSAGE.ERASE)) {
        const { resolve, timer } = this.erase;
        clearTimeout(timer); this.erase = null; resolve(true);
      } else if (this.erase && isReplyFor(packet, MESSAGE.NACK, MESSAGE.ERASE)) {
        const { reject, timer } = this.erase;
        clearTimeout(timer); this.erase = null; reject(new Error("Устройство отклонило очистку памяти"));
      }
      const pending = this.pending.find((item) => item.match(packet));
      if (pending) {
        clearTimeout(pending.timer);
        this.pending = this.pending.filter((item) => item !== pending);
        pending.resolve(packet);
      }
    }
  }

  #handleDisconnect() {
    if (!this.device) return;
    const name = this.device.name || "LapTrace";
    this.device = null;
    const error = new Error("LapTrace отключился во время операции");
    this.pending.forEach((pending) => { clearTimeout(pending.timer); pending.reject(error); });
    this.pending = [];
    if (this.download) { this.download.reject(error); this.download = null; }
    if (this.erase) { clearTimeout(this.erase.timer); this.erase.reject(error); this.erase = null; }
    this.onStatus?.("disconnected", name);
  }
}
