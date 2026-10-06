import { randomBytes } from "node:crypto";

// Share links give read-only access to ONE log through an unguessable token; the owner can revoke them any time.
export const MAX_SHARES_PER_LOG = 20;
export const shareTokenPattern = /^[A-Za-z0-9_-]{32,64}$/;
export const newShareToken = () => randomBytes(24).toString("base64url");

export function cleanPilotName(value, fallback = "Pilot") {
  const name = String(value ?? "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
  return name.length >= 2 ? name : fallback;
}

// "marco.rossi@example.com" -> "marco.rossi": a readable default that does not expose the mail domain.
export const defaultPilotName = (email) => cleanPilotName(String(email || "").split("@")[0]);

export const publicShare = (row, origin) => ({
  id: row.id,
  token: row.token,
  pilotName: row.pilot_name,
  createdAt: row.created_at,
  url: `${origin}/#shared=${row.token}`,
});
