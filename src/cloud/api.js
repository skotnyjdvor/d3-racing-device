const apiBase = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
const tokenKey = "laptrace-access-token";
const listeners = new Set();

const getToken = () => localStorage.getItem(tokenKey);

async function request(path, options = {}) {
  const token = getToken();
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `API error ${response.status}`);
  return body;
}

function rememberAuth(data) {
  if (data.token) localStorage.setItem(tokenKey, data.token);
  listeners.forEach((listener) => listener(data.user ?? null));
  return data.user ?? null;
}

export const cloudConfigured = Boolean(apiBase) || (import.meta.env.PROD && location.protocol.startsWith("http"));

export async function currentUser() {
  if (!getToken()) return null;
  try { return (await request("/api/auth/me")).user; }
  catch { localStorage.removeItem(tokenKey); return null; }
}

export async function signIn(email, password) {
  return rememberAuth(await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }));
}

export async function signUp(email, password) {
  return rememberAuth(await request("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password }) }));
}

export async function signOut() {
  localStorage.removeItem(tokenKey);
  listeners.forEach((listener) => listener(null));
}

export function onAuthChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export async function saveLog(session, deviceName) {
  if (!getToken()) return null;
  const data = await request("/api/logs", {
    method: "POST",
    body: JSON.stringify({
      deviceName: deviceName || "LapTrace",
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      points: session.points,
    }),
  });
  return data.id;
}

export async function loadLogs() {
  if (!getToken()) return [];
  const { logs } = await request("/api/logs");
  return logs.map((record, index) => ({
    id: `cloud-${record.id}`,
    cloudId: record.id,
    title: record.title,
    displayId: index + 1,
    source: "cloud",
    deviceName: record.deviceName,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    points: record.points ?? [],
  }));
}

export async function renameLog(id, title) {
  return request(`/api/logs/${id}`, { method: "PATCH", body: JSON.stringify({ title }) });
}

export async function deleteLog(id) {
  await request(`/api/logs/${id}`, { method: "DELETE" });
}
