import test from "node:test";
import assert from "node:assert/strict";
import { decodeRaceBoxData, decodeRecordingStatus, encodeRecordingConfiguration, HistoryDownloadCollector } from "../src/ble/racebox.js";
import { UbxStreamParser } from "../src/ble/ubx.js";

const exampleHex = "B5 62 FF 01 50 00 A0 E7 0C 07 E6 07 01 0A 08 33 08 37 19 00 00 00 2A AD 4D 0E 03 01 EA 0B C6 93 E1 0D 3B 37 6F 19 61 8C 09 00 0F 01 09 00 9C 03 00 00 2C 07 00 00 23 00 00 00 00 00 00 00 D0 00 00 00 88 A9 DD 00 2C 01 00 59 FD FF 71 00 CE 03 2F FF 56 00 FC FF 06 DB";
const packet = Uint8Array.from(exampleHex.split(" ").map((value) => Number.parseInt(value, 16)));

test("reassembles a fragmented UBX packet", () => {
  const parser = new UbxStreamParser();
  assert.equal(parser.push(packet.slice(0, 17)).length, 0);
  const packets = parser.push(packet.slice(17));
  assert.equal(packets.length, 1);
  assert.equal(packets[0].messageClass, 0xff);
  assert.equal(packets[0].messageId, 0x01);
  assert.equal(packets[0].payload.length, 80);
});

test("decodes the protocol example with correct scaling", () => {
  const parser = new UbxStreamParser();
  const decoded = decodeRaceBoxData(parser.push(packet)[0].payload);
  assert.equal(decoded.latitude, 42.6719035);
  assert.equal(decoded.longitude, 23.2887238);
  assert.equal(decoded.altitude, 590.095);
  assert.equal(decoded.gForceZ, 0.974);
  assert.equal(decoded.gyroX, -2.09);
});

test("decodes recording memory status", () => {
  const payload = new Uint8Array(12);
  const view = new DataView(payload.buffer);
  payload.set([0, 34, 3, 0]);
  view.setUint32(4, 67173, true);
  view.setUint32(8, 196608, true);
  assert.deepEqual(decodeRecordingStatus(payload), {
    recording: false,
    memoryLevel: 34,
    securityEnabled: true,
    unlocked: true,
    storedMessages: 67173,
    capacityMessages: 196608,
  });
});

test("splits downloaded history using state-change messages", () => {
  const dataPayload = packet.slice(6, -2);
  const state = (value) => ({ messageClass: 0xff, messageId: 0x26, payload: Uint8Array.of(value, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0) });
  const collector = new HistoryDownloadCollector();
  collector.handle({ messageClass: 0xff, messageId: 0x23, payload: Uint8Array.of(2, 0, 0, 0) });
  collector.handle(state(1));
  collector.handle({ messageClass: 0xff, messageId: 0x21, payload: dataPayload });
  collector.handle(state(0));
  collector.handle(state(1));
  collector.handle({ messageClass: 0xff, messageId: 0x21, payload: dataPayload });
  collector.handle({ messageClass: 0xff, messageId: 0x02, payload: Uint8Array.of(0xff, 0x23) });
  const sessions = collector.result();
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].points.length, 1);
  assert.equal(sessions[1].points.length, 1);
  assert.equal(collector.progress().percent, 100);
});

test("builds a safe 25 Hz racing recording configuration", () => {
  const payload = encodeRecordingConfiguration(true);
  const view = new DataView(payload.buffer);
  assert.equal(payload.length, 12);
  assert.equal(payload[0], 1);
  assert.equal(payload[1], 0);
  assert.equal(payload[2], 0x1d);
  assert.equal(view.getUint16(8, true), 30);
  assert.equal(view.getUint16(10, true), 300);
  assert.deepEqual([...encodeRecordingConfiguration(false)], Array(12).fill(0));
});
