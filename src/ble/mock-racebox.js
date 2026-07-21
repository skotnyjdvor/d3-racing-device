import { parseRaceBoxCsv } from "../domain/csv.js";

export class MockRaceBoxClient {
  constructor({ onStatus, onTelemetry }) { this.onStatus = onStatus; this.onTelemetry = onTelemetry; this.recording = false; this.cancelled = false; }
  async connect() {
    this.model = "LapTrace";
    this.supportsStandaloneRecording = true;
    this.onStatus?.("connected", "LapTrace Mock");
    this.onTelemetry?.({ fixStatus: 3, fixStatusFlags: 1, satellites: 17, batteryRaw: 86 });
    return "LapTrace Mock";
  }
  disconnect() { this.onStatus?.("disconnected", "LapTrace Mock"); }
  async readStorageStatus() {
    return { recording: this.recording, memoryLevel: 6, securityEnabled: false, unlocked: true, storedMessages: 12256, capacityMessages: 196608 };
  }
  async startRecording() { this.recording = true; return true; }
  async stopRecording() { this.recording = false; return true; }
  async unlockMemory() { return true; }
  async cancelDownload() { this.cancelled = true; }
  async downloadHistory(onProgress) {
    this.cancelled = false;
    const source = new URL("../fixtures/viterbo-session-2026-07-10.csv", import.meta.url);
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Не удалось загрузить тестовую память: HTTP ${response.status}`);
    const points = parseRaceBoxCsv(await response.text());
    onProgress({ expected: points.length, received: 0, percent: 0 });
    const chunkSize = Math.ceil(points.length / 20);
    for (let received = chunkSize; received < points.length; received += chunkSize) {
      if (this.cancelled) return [];
      onProgress({ expected: points.length, received, percent: received / points.length * 100 });
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    onProgress({ expected: points.length, received: points.length, percent: 100 });
    return [{ id: 1, points, startedAt: points[0].time, endedAt: points.at(-1).time, dataRate: 25, flags: 0 }];
  }
}
