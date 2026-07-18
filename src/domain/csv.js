export const REQUIRED_COLUMNS = [
  "Record", "Time", "Latitude", "Longitude", "Altitude", "Speed",
  "GForceX", "GForceY", "GForceZ", "Lap", "GyroX", "GyroY", "GyroZ",
];

function splitCsvLine(line) {
  const result = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      result.push(value.trim());
      value = "";
    } else {
      value += char;
    }
  }
  result.push(value.trim());
  return result;
}

export function parseRaceBoxCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("CSV не содержит измерений");

  const headers = splitCsvLine(lines[0]);
  const missing = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
  if (missing.length) throw new Error(`Не найдены столбцы: ${missing.join(", ")}`);

  const index = Object.fromEntries(headers.map((header, position) => [header, position]));
  const points = [];
  for (let row = 1; row < lines.length; row += 1) {
    const values = splitCsvLine(lines[row]);
    const time = new Date(values[index.Time]);
    const point = {
      record: Number(values[index.Record]),
      time: time.toISOString(),
      timeMs: time.getTime(),
      latitude: Number(values[index.Latitude]),
      longitude: Number(values[index.Longitude]),
      altitude: Number(values[index.Altitude]),
      speed: Number(values[index.Speed]),
      gForceX: Number(values[index.GForceX]),
      gForceY: Number(values[index.GForceY]),
      gForceZ: Number(values[index.GForceZ]),
      lap: Number(values[index.Lap]),
      gyroX: Number(values[index.GyroX]),
      gyroY: Number(values[index.GyroY]),
      gyroZ: Number(values[index.GyroZ]),
    };
    if (Object.values(point).some((value) => typeof value === "number" && !Number.isFinite(value))) {
      throw new Error(`Некорректное значение в строке ${row + 1}`);
    }
    points.push(point);
  }
  return points;
}

export function telemetryToCsv(points) {
  const rows = [REQUIRED_COLUMNS.join(",")];
  points.forEach((point, index) => rows.push([
    point.record ?? index + 1, point.time, point.latitude, point.longitude, point.altitude,
    point.speed, point.gForceX, point.gForceY, point.gForceZ, point.lap ?? 0,
    point.gyroX, point.gyroY, point.gyroZ,
  ].join(",")));
  return rows.join("\n");
}
