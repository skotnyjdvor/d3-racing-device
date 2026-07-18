import { parseRaceBoxCsv } from "../domain/csv.js";

export class MockRaceBoxClient {
  constructor({ onStatus, onTelemetry }) { this.onStatus = onStatus; this.onTelemetry = onTelemetry; this.recording = false; }
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
  async cancelDownload() {}
  async downloadHistory(onProgress) {
    const text = await (await fetch("/tests/fixtures/session.csv")).text();
    const points = parseRaceBoxCsv(text).map((point) => ({ ...point, lap: 0 }));
    onProgress({ expected: points.length, received: 0, percent: 0 });
    onProgress({ expected: points.length, received: points.length, percent: 100 });
    return [{ id: 1, points, startedAt: points[0].time, endedAt: points.at(-1).time, dataRate: 25, flags: 0 }];
  }
}
