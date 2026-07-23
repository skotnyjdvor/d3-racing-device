import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const source = process.argv[2];
const output = process.argv[3] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/domain/track-catalog.generated.js");

if (!source) {
  console.error("Usage: node scripts/convert-ztracks.mjs <tracks.ztracks> [output.js]");
  process.exit(1);
}

function readArchiveEntries(buffer) {
  const entries = [];
  for (let offset = 0; offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50;) {
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    if (flags & 0x08) throw new Error("ZIP entries with data descriptors are not supported");
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? compressed : method === 8 ? zlib.inflateRawSync(compressed) : null;
    if (data) entries.push({ name: buffer.subarray(nameStart, nameStart + nameLength).toString("utf8"), data });
    offset = dataStart + compressedSize;
  }
  return entries;
}

function chunk(buffer, name) {
  const marker = Buffer.from(`<h${name}\0`, "ascii");
  const offset = buffer.indexOf(marker);
  if (offset < 0 || offset + 12 > buffer.length) return null;
  const size = buffer.readUInt32LE(offset + 6);
  const start = offset + 12;
  return buffer.subarray(start, Math.min(start + size, buffer.length));
}

function readCString(buffer) {
  const end = buffer.indexOf(0);
  return buffer.subarray(0, end < 0 ? buffer.length : end).toString("utf8").trim();
}

function parseTrack(entry) {
  const pointsChunk = chunk(entry.data, "pts");
  if (!pointsChunk || pointsChunk.length < 24) return null;
  const points = [];
  for (let offset = 0; offset + 12 <= pointsChunk.length; offset += 12) {
    const latitude = pointsChunk.readInt32LE(offset) / 1e7;
    const longitude = pointsChunk.readInt32LE(offset + 4) / 1e7;
    if (Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) points.push({ latitude, longitude });
  }
  if (points.length < 3) return null;

  const name = readCString(chunk(entry.data, "V_sw") ?? Buffer.alloc(0))
    || readCString(chunk(entry.data, "Vnfo") ?? Buffer.alloc(0))
    || path.basename(entry.name, ".tkk");
  const latitude = points.reduce((sum, point) => sum + point.latitude, 0) / points.length;
  const longitude = points.reduce((sum, point) => sum + point.longitude, 0) / points.length;
  const latScale = 111_320;
  const lonScale = latScale * Math.cos(latitude * Math.PI / 180);
  const radiusM = Math.max(...points.map((point) => Math.hypot(
    (point.latitude - latitude) * latScale,
    (point.longitude - longitude) * lonScale,
  )));

  const start = points[0];
  const next = points.find((point) => Math.hypot(
    (point.latitude - start.latitude) * latScale,
    (point.longitude - start.longitude) * lonScale,
  ) > 4) ?? points[1];
  return {
    id: path.basename(entry.name, ".tkk"),
    name,
    center: [Number(latitude.toFixed(7)), Number(longitude.toFixed(7))],
    radius: Math.round(Math.min(5000, Math.max(250, radiusM + 180))),
    start: [
      Number(start.latitude.toFixed(7)),
      Number(start.longitude.toFixed(7)),
      Number(next.latitude.toFixed(7)),
      Number(next.longitude.toFixed(7)),
    ],
  };
}

const archive = fs.readFileSync(source);
const tracks = readArchiveEntries(archive)
  .filter((entry) => entry.name.toLowerCase().endsWith(".tkk"))
  .map(parseTrack)
  .filter(Boolean);

const moduleText = `// Generated from ${path.basename(source)}. Do not edit manually.\nexport default ${JSON.stringify(tracks)};\n`;
fs.writeFileSync(output, moduleText);
console.log(`Converted ${tracks.length} tracks to ${output}`);
