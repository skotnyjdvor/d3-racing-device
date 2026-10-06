import { cleanPilotName, defaultPilotName, newShareToken, shareTokenPattern } from "./shares.mjs";

// Friendships are mutual and created through single-use invite links; nobody can look people up by email.
export const MAX_FRIENDS = 200;
export const MAX_OPEN_INVITES = 10;
export const INVITE_DAYS = 14;
export const inviteTokenPattern = shareTokenPattern;
export const newInviteToken = newShareToken;

// What friends see: the chosen pilot name, else the part of the email before "@" (never the domain).
export const pilotNameOf = (row) => cleanPilotName(row.display_name, defaultPilotName(row.email));

export const publicFriend = (row) => ({
  id: row.id,
  name: pilotNameOf(row),
  statsVisible: Boolean(row.stats_visible),
  since: row.since ?? null,
});

export const publicInvite = (row, origin) => ({
  id: row.id,
  token: row.token,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  url: `${origin}/#friend=${row.token}`,
});

// Friendship rows store the pair in a fixed order so a pair can exist only once.
export const orderedPair = (a, b) => (String(a) < String(b) ? [a, b] : [b, a]);

export function cleanSettings(body = {}) {
  const settings = {};
  if (body.displayName !== undefined) {
    const raw = String(body.displayName ?? "").trim();
    settings.displayName = raw ? cleanPilotName(raw, "") : null;
    if (raw && !settings.displayName) return { error: "Use a pilot name of 2 to 40 characters" };
  }
  if (body.statsVisible !== undefined) settings.statsVisible = body.statsVisible === true;
  return Object.keys(settings).length ? { settings } : { error: "Nothing to update" };
}
