import { encodePacket, UbxStreamParser } from "./ubx.js";

export const RACEBOX_UART_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
export const RACEBOX_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
export const RACEBOX_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

export const RACEBOX_CLASS = 0xff;
export const RACEBOX_MESSAGE = {
  DATA: 0x01,
  ACK: 0x02,
  NACK: 0x03,
  HISTORY_DATA: 0x21,
  RECORDING_STATUS: 0x22,
  DOWNLOAD: 0x23,
  RECORDING_CONFIG: 0x25,
  STATE_CHANGE: 0x26,
  UNLOCK: 0x30,
};
const CLASS = RACEBOX_CLASS;
const MESSAGE = RACEBOX_MESSAGE;

export const DEVICE_INFO_SERVICE = "0000180a-0000-1000-8000-00805f9b34fb";
export const MODEL_CHARACTERISTIC = "00002a24-0000-1000-8000-00805f9b34fb";

function viewOf(payload) {
  return new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
}

function decodeTimestamp(view) {
  const base = Date.UTC(
    view.getUint16(4, true), view.getUint8(6) - 1, view.getUint8(7),
    view.getUint8(8), view.getUint8(9), view.getUint8(10),
  );
  return new Date(base + view.getInt32(16, true) / 1_000_000);
}

export function decodeRaceBoxData(payload) {
  if (payload.byteLength !== 80) throw new Error(`Ожидался payload 80 байт, получено ${payload.byteLength}`);
  const view = viewOf(payload);
  const timestamp = decodeTimestamp(view);
  return {
    iTow: view.getUint32(0, true),
    time: timestamp.toISOString(),
    timeMs: timestamp.getTime(),
    validityFlags: view.getUint8(11),
    fixStatus: view.getUint8(20),
    fixStatusFlags: view.getUint8(21),
    satellites: view.getUint8(23),
    longitude: view.getInt32(24, true) / 1e7,
    latitude: view.getInt32(28, true) / 1e7,
    wgsAltitude: view.getInt32(32, true) / 1000,
    altitude: view.getInt32(36, true) / 1000,
    horizontalAccuracy: view.getUint32(40, true) / 1000,
    verticalAccuracy: view.getUint32(44, true) / 1000,
    speed: view.getInt32(48, true) * 3.6 / 1000,
    heading: view.getInt32(52, true) / 1e5,
    speedAccuracy: view.getUint32(56, true) * 3.6 / 1000,
    headingAccuracy: view.getUint32(60, true) / 1e5,
    pdop: view.getUint16(64, true) / 100,
    latLonFlags: view.getUint8(66),
    batteryRaw: view.getUint8(67),
    gForceX: view.getInt16(68, true) / 1000,
    gForceY: view.getInt16(70, true) / 1000,
    gForceZ: view.getInt16(72, true) / 1000,
    gyroX: view.getInt16(74, true) / 100,
    gyroY: view.getInt16(76, true) / 100,
    gyroZ: view.getInt16(78, true) / 100,
    lap: 0,
  };
}

export function decodeRecordingStatus(payload) {
  if (payload.byteLength !== 12) throw new Error("Некорректный ответ статуса памяти");
  const view = viewOf(payload);
  const security = view.getUint8(2);
  return {
    recording: view.getUint8(0) !== 0,
    memoryLevel: view.getUint8(1),
    securityEnabled: (security & 1) !== 0,
    unlocked: (security & 2) !== 0,
    storedMessages: view.getUint32(4, true),
    capacityMessages: view.getUint32(8, true),
  };
}

export function decodeStateChange(payload) {
  if (payload.byteLength !== 12) throw new Error("Некорректное сообщение границы сессии");
  const view = viewOf(payload);
  return {
    state: view.getUint8(0),
    dataRate: [25, 10, 5, 1, 20][view.getUint8(2)] ?? null,
    flags: view.getUint8(3),
  };
}

export function encodeRecordingConfiguration(enable) {
  const payload = new Uint8Array(12);
  const view = new DataView(payload.buffer);
  payload[0] = enable ? 1 : 0;
  if (!enable) return payload;
  payload[1] = 0; // 25 Hz
  payload[2] = 0x1d; // wait fix, no-fix filter, auto shutdown, wait for data
  payload[3] = 0;
  view.setUint16(4, 1389, true); // 5 km/h; stationary filter is intentionally off
  view.setUint16(6, 30, true);
  view.setUint16(8, 30, true);
  view.setUint16(10, 300, true);
  return payload;
}

export class HistoryDownloadCollector {
  constructor(onProgress = () => {}) {
    this.onProgress = onProgress;
    this.expected = 0;
    this.received = 0;
    this.sessions = [];
    this.current = null;
    this.done = false;
  }

  handle(packet) {
    if (packet.messageClass !== CLASS) return null;
    if (packet.messageId === MESSAGE.DOWNLOAD && packet.payload.length === 4) {
      this.expected = viewOf(packet.payload).getUint32(0, true);
      this.onProgress(this.progress());
      return "started";
    }
    if (packet.messageId === MESSAGE.STATE_CHANGE) {
      const change = decodeStateChange(packet.payload);
      if (change.state === 1) this.#startSession(change);
      if (change.state === 0) this.#closeSession();
      return "state-change";
    }
    if (packet.messageId === MESSAGE.HISTORY_DATA) {
      if (!this.current) this.#startSession({ state: 1, dataRate: null, flags: 0, inferred: true });
      const point = decodeRaceBoxData(packet.payload);
      point.record = ++this.received;
      this.current.points.push(point);
      this.onProgress(this.progress());
      return "record";
    }
    if (isReplyFor(packet, MESSAGE.ACK, MESSAGE.DOWNLOAD)) {
      this.#closeSession();
      this.done = true;
      this.onProgress(this.progress());
      return "complete";
    }
    return null;
  }

  progress() {
    return {
      expected: this.expected,
      received: this.received,
      percent: this.expected ? Math.min(100, this.received / this.expected * 100) : 0,
    };
  }

  result() {
    return this.sessions.filter((session) => session.points.length).map((session, index) => ({
      ...session,
      id: index + 1,
      startedAt: session.points[0].time,
      endedAt: session.points.at(-1).time,
    }));
  }

  #startSession(change) {
    this.#closeSession();
    this.current = { points: [], dataRate: change.dataRate, flags: change.flags, inferred: Boolean(change.inferred) };
  }

  #closeSession() {
    if (this.current?.points.length) this.sessions.push(this.current);
    this.current = null;
  }
}

export function isReplyFor(packet, replyId, operationId) {
  return packet.messageClass === CLASS && packet.messageId === replyId &&
    packet.payload.length === 2 && packet.payload[0] === CLASS && packet.payload[1] === operationId;
}

export class RaceBoxBleClient {
  constructor({ onStatus, onTelemetry }) {
    this.onStatus = onStatus;
    this.onTelemetry = onTelemetry;
    this.parser = new UbxStreamParser();
    this.pending = [];
    this.download = null;
  }

  async connect() {
    if (!navigator.bluetooth) throw new Error("Web Bluetooth недоступен. Используйте Chrome или Edge на localhost.");
    // Some RaceBox firmware/OS combinations do not expose advertised services
    // early enough for Web Bluetooth filtering. Show every nearby BLE device,
    // then verify RaceBox by requesting its UART service after connection.
    this.device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [RACEBOX_UART_SERVICE, DEVICE_INFO_SERVICE],
    });
    this.device.addEventListener("gattserverdisconnected", () => this.#handleDisconnect());
    const server = await this.device.gatt.connect();
    let service;
    try {
      service = await server.getPrimaryService(RACEBOX_UART_SERVICE);
    } catch {
      this.device.gatt.disconnect();
      throw new Error(`Устройство «${this.device.name || "без имени"}» не предоставляет UART service LapTrace`);
    }
    this.tx = await service.getCharacteristic(RACEBOX_TX);
    this.rx = await service.getCharacteristic(RACEBOX_RX);
    this.tx.addEventListener("characteristicvaluechanged", (event) => this.#handleNotification(event.target.value));
    await this.tx.startNotifications();
    this.model = await this.#readModel(server);
    this.supportsStandaloneRecording = this.model !== "RaceBoxMini";
    this.onStatus?.("connected", this.device.name);
    return this.device.name;
  }

  disconnect() {
    this.device?.gatt?.disconnect();
  }

  async readStorageStatus() {
    const packet = await this.#request(MESSAGE.RECORDING_STATUS, new Uint8Array(0),
      (candidate) => candidate.messageClass === CLASS && candidate.messageId === MESSAGE.RECORDING_STATUS && candidate.payload.length === 12);
    return decodeRecordingStatus(packet.payload);
  }

  async unlockMemory(code) {
    if (!Number.isInteger(code) || code < 0 || code > 0xffffffff) throw new Error("Код должен быть целым числом от 0 до 4294967295");
    const payload = new Uint8Array(4);
    new DataView(payload.buffer).setUint32(0, code, true);
    const packet = await this.#request(MESSAGE.UNLOCK, payload,
      (candidate) => isReplyFor(candidate, MESSAGE.ACK, MESSAGE.UNLOCK) || isReplyFor(candidate, MESSAGE.NACK, MESSAGE.UNLOCK));
    return packet.messageId === MESSAGE.ACK;
  }

  async startRecording() {
    if (!this.supportsStandaloneRecording) throw new Error(`${this.model || "Эта модель"} не поддерживает запись во внутреннюю память`);
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
    if (!this.download) return;
    await this.#write(encodePacket(CLASS, MESSAGE.DOWNLOAD, Uint8Array.of(1)));
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
    if (!this.rx) throw new Error("LapTrace не подключён");
    if (this.rx.writeValueWithoutResponse) await this.rx.writeValueWithoutResponse(bytes);
    else await this.rx.writeValue(bytes);
  }

  async #setRecording(enable) {
    const packet = await this.#request(MESSAGE.RECORDING_CONFIG, encodeRecordingConfiguration(enable),
      (candidate) => isReplyFor(candidate, MESSAGE.ACK, MESSAGE.RECORDING_CONFIG) || isReplyFor(candidate, MESSAGE.NACK, MESSAGE.RECORDING_CONFIG));
    if (packet.messageId === MESSAGE.NACK) throw new Error(enable ? "LapTrace отклонил запуск записи" : "LapTrace отклонил остановку записи");
    return true;
  }

  async #readModel(server) {
    try {
      const service = await server.getPrimaryService(DEVICE_INFO_SERVICE);
      const characteristic = await service.getCharacteristic(MODEL_CHARACTERISTIC);
      const value = await characteristic.readValue();
      return new TextDecoder().decode(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)).replace(/\0+$/, "").trim();
    } catch {
      return "Неизвестная модель";
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
          reject(new Error("Устройство отклонило выгрузку памяти"));
        }
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
    const error = new Error("LapTrace отключился во время операции");
    this.pending.forEach((pending) => { clearTimeout(pending.timer); pending.reject(error); });
    this.pending = [];
    if (this.download) { this.download.reject(error); this.download = null; }
    this.onStatus?.("disconnected", this.device?.name);
  }
}
