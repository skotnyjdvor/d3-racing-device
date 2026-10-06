// End-to-end API tests against a real Postgres. Runs when TEST_DATABASE_URL is set (CI provides it), skipped otherwise.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const databaseUrl = process.env.TEST_DATABASE_URL;
const skip = databaseUrl ? false : "set TEST_DATABASE_URL to run API end-to-end tests";
const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let api;
let mailServer;
let baseUrl;
const emails = [];

async function freePort() {
  const server = createServer().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function call(path, { method = "GET", body, token } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

const linkToken = (mail, kind) => mail.text.match(new RegExp(`#${kind}=([A-Za-z0-9_-]+)`))[1];
const register = (email, password = "correct-horse-1", language) => call("/api/auth/register", { method: "POST", body: { email, password, language } });

before(async () => {
  if (skip) return;
  // Fake Resend endpoint that records outgoing mail.
  mailServer = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      emails.push({ authorization: request.headers.authorization, ...JSON.parse(raw) });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"id":"test"}');
    });
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => mailServer.once("listening", resolve));
  const apiPort = await freePort();
  baseUrl = `http://127.0.0.1:${apiPort}`;
  let output = "";
  api = spawn(process.execPath, ["server/api.mjs"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      AUTH_RATE_LIMIT: "500",
      PORT: String(apiPort),
      DATABASE_URL: databaseUrl,
      JWT_SECRET: "e2e-secret",
      RESEND_API_KEY: "re_test",
      RESEND_API_URL: `http://127.0.0.1:${mailServer.address().port}/emails`,
      APP_URL: baseUrl,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  api.stdout.on("data", (chunk) => { output += chunk; });
  api.stderr.on("data", (chunk) => { output += chunk; });
  for (let attempt = 0; attempt < 80; attempt++) {
    await sleep(250);
    try { if ((await fetch(`${baseUrl}/api/health`)).ok) return; } catch {}
    if (api.exitCode !== null) break;
  }
  throw new Error(`API did not start:\n${output}`);
});

after(async () => {
  api?.kill();
  if (mailServer) await new Promise((resolve) => mailServer.close(resolve));
});

test("registration sends a single-use confirmation link", { skip }, async () => {
  const response = await register("Pilot@Example.com", "old-password-1", "en");
  assert.equal(response.status, 201);
  assert.equal(response.body.user.email, "pilot@example.com");
  assert.equal(response.body.user.emailVerified, false);
  const mail = emails.at(-1);
  assert.deepEqual(mail.to, ["pilot@example.com"]);
  assert.equal(mail.subject, "Confirm your email for D3CF");
  assert.equal(mail.authorization, "Bearer re_test");
  assert.equal(mail.reply_to, "office@d3cf.com");

  const token = linkToken(mail, "verify");
  const verified = await call("/api/auth/verify", { method: "POST", body: { token } });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.user.emailVerified, true);
  assert.equal((await call("/api/auth/verify", { method: "POST", body: { token } })).status, 400);
  assert.equal((await call("/api/auth/me", { token: response.body.token })).body.user.emailVerified, true);
  assert.equal((await register("pilot@example.com")).status, 409);
});

test("password reset does not reveal accounts, is single use and revokes old sessions", { skip }, async () => {
  const signup = await register("reset@example.com", "old-password-1");
  const oldSession = signup.body.token;

  const sentBefore = emails.length;
  assert.equal((await call("/api/auth/forgot", { method: "POST", body: { email: "nobody@example.com" } })).status, 200);
  assert.equal(emails.length, sentBefore, "no mail for unknown accounts");

  assert.equal((await call("/api/auth/forgot", { method: "POST", body: { email: "reset@example.com", language: "pl" } })).status, 200);
  const stale = linkToken(emails.at(-1), "reset");
  assert.equal(emails.at(-1).subject, "Reset hasła D3CF");
  await call("/api/auth/forgot", { method: "POST", body: { email: "reset@example.com" } });
  const token = linkToken(emails.at(-1), "reset");
  assert.equal((await call("/api/auth/reset", { method: "POST", body: { token: stale, password: "new-password-1" } })).status, 400, "older link is invalidated");
  assert.equal((await call("/api/auth/reset", { method: "POST", body: { token, password: "short" } })).status, 400);

  const reset = await call("/api/auth/reset", { method: "POST", body: { token, password: "new-password-1" } });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.user.emailVerified, true, "reset proves email ownership");
  assert.equal((await call("/api/auth/me", { token: oldSession })).status, 401, "old session revoked");
  assert.equal((await call("/api/auth/me", { token: reset.body.token })).status, 200);
  assert.equal((await call("/api/auth/reset", { method: "POST", body: { token, password: "another-pass-1" } })).status, 400, "link is single use");
  assert.equal((await call("/api/auth/login", { method: "POST", body: { email: "reset@example.com", password: "old-password-1" } })).status, 401);
  assert.equal((await call("/api/auth/login", { method: "POST", body: { email: "reset@example.com", password: "new-password-1" } })).status, 200);
});

test("log library paginates through every session without duplicates", { skip }, async () => {
  const { body } = await register("library@example.com");
  const start = Date.parse("2026-01-01T10:00:00.123Z");
  for (let index = 0; index < 230; index++) {
    const startedAt = new Date(start + index * 60_000 + (index % 7)).toISOString();
    const endedAt = new Date(start + index * 60_000 + 30_000).toISOString();
    const saved = await call("/api/logs", { method: "POST", token: body.token, body: { startedAt, endedAt, points: [{ t: 1 }, { t: 2 }] } });
    assert.equal(saved.status, 201);
  }
  const ids = [];
  let cursor = null;
  let pages = 0;
  do {
    const query = new URLSearchParams({ limit: "100" });
    if (cursor) { query.set("before", cursor.before); query.set("beforeId", cursor.beforeId); }
    const page = await call(`/api/logs?${query}`, { token: body.token });
    assert.equal(page.status, 200);
    ids.push(...page.body.logs.map((log) => log.id));
    cursor = page.body.nextCursor;
    pages++;
  } while (cursor && pages < 10);
  assert.equal(pages, 3);
  assert.equal(ids.length, 230);
  assert.equal(new Set(ids).size, 230);
});

test("users cannot reach each other's logs and bad ids are 404", { skip }, async () => {
  const owner = await register("owner@example.com");
  const rival = await register("rival@example.com");
  const saved = await call("/api/logs", { method: "POST", token: owner.body.token, body: { startedAt: "2026-02-01T10:00:00Z", endedAt: "2026-02-01T10:30:00Z", points: [{ t: 1 }, { t: 2 }] } });
  const id = saved.body.id;
  assert.equal((await call(`/api/logs/${id}`, { token: owner.body.token })).status, 200);
  assert.equal((await call(`/api/logs/${id}`, { token: rival.body.token })).status, 404);
  assert.equal((await call(`/api/logs/${id}`, { method: "PATCH", token: rival.body.token, body: { title: "mine now" } })).status, 404);
  assert.equal((await call(`/api/logs/${id}`, { method: "DELETE", token: rival.body.token })).status, 404);
  assert.equal((await call("/api/logs/not-a-uuid", { token: owner.body.token })).status, 404);
  assert.equal((await call("/api/logs")).status, 401);
  assert.equal((await call("/api/logs", { token: "garbage" })).status, 401);
});

test("security headers, request size limit and 404 routing", { skip }, async () => {
  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.headers.get("x-content-type-options"), "nosniff");
  assert.equal(health.headers.get("x-frame-options"), "DENY");
  assert.match(health.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
  const oversized = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "x".repeat(300_000) }) });
  assert.equal(oversized.status, 413);
  assert.equal((await call("/api/unknown")).status, 404);
});

test("shop: pre-orders are stored, notify the sales inbox and keep payments stubbed", { skip }, async () => {
  const config = await call("/api/shop/config");
  assert.equal(config.status, 200);
  assert.equal(config.body.paymentsEnabled, false);
  assert.equal(config.body.priceCents, null);

  const order = { name: "Mario Rossi", email: "mario@example.com", country: "Italy", address: "Via Roma 1, Viterbo", quantity: 2, consent: true, language: "it" };
  const before = emails.length;
  assert.equal((await call("/api/orders", { method: "POST", body: { ...order, consent: false } })).status, 400);
  assert.equal(emails.length, before);

  const guest = await call("/api/orders", { method: "POST", body: order });
  assert.equal(guest.status, 201);
  assert.match(guest.body.order.number, /^D3-\d{4,}$/);
  assert.equal(guest.body.order.status, "preorder");
  assert.equal(guest.body.payment.status, "unavailable");
  assert.equal(guest.body.payment.url, null);
  const mail = emails.at(-1);
  assert.deepEqual(mail.to, ["office@d3cf.com"]);
  assert.match(mail.subject, new RegExp(guest.body.order.number));
  assert.match(mail.text, /Product: laptrace x 2/);
  assert.match(mail.text, /Account: guest/);

  const account = await register("buyer@example.com");
  const signedIn = await call("/api/orders", { method: "POST", token: account.body.token, body: order });
  assert.equal(signedIn.status, 201);
  assert.notEqual(signedIn.body.order.number, guest.body.order.number);
  assert.match(emails.at(-1).text, /Account: signed in/);

  // A filled honeypot pretends success but sends nothing.
  const sent = emails.length;
  const bot = await call("/api/orders", { method: "POST", body: { ...order, website: "http://spam.example" } });
  assert.equal(bot.status, 201);
  assert.equal(emails.length, sent);

  assert.equal((await call("/api/payments/webhook", { method: "POST", body: {} })).status, 501);
});

test("profile: summary, password change with session rotation, and account deletion", { skip }, async () => {
  const account = await register("profile@example.com", "first-password-1");
  const token = account.body.token;
  assert.ok(account.body.user.createdAt);

  await call("/api/orders", { method: "POST", token, body: { name: "Anna Nowak", email: "profile@example.com", country: "Poland", address: "ul. Prosta 1, Warszawa", quantity: 1, consent: true, language: "pl" } });
  await call("/api/logs", { method: "POST", token, body: { startedAt: "2026-03-01T10:00:00Z", endedAt: "2026-03-01T10:30:00Z", points: [{ t: 1 }, { t: 2 }] } });

  const profile = await call("/api/profile", { token });
  assert.equal(profile.status, 200);
  assert.equal(profile.body.user.email, "profile@example.com");
  assert.deepEqual(profile.body.stats, { logs: 1, aiReports: 0, orders: 1 });
  assert.equal(profile.body.orders[0].status, "preorder");
  assert.match(profile.body.orders[0].number, /^D3-\d{4,}$/);
  assert.equal((await call("/api/profile")).status, 401);

  // Wrong current password, too-short new password, then a real change that rotates the token.
  assert.equal((await call("/api/auth/change-password", { method: "POST", token, body: { currentPassword: "nope-nope-1", newPassword: "second-password-2" } })).status, 403);
  assert.equal((await call("/api/auth/change-password", { method: "POST", token, body: { currentPassword: "first-password-1", newPassword: "short" } })).status, 400);
  const changed = await call("/api/auth/change-password", { method: "POST", token, body: { currentPassword: "first-password-1", newPassword: "second-password-2" } });
  assert.equal(changed.status, 200);
  assert.equal((await call("/api/auth/me", { token })).status, 401, "the old token is revoked");
  assert.equal((await call("/api/auth/me", { token: changed.body.token })).status, 200, "the fresh token works");
  assert.equal((await call("/api/auth/login", { method: "POST", body: { email: "profile@example.com", password: "first-password-1" } })).status, 401);
  assert.equal((await call("/api/auth/login", { method: "POST", body: { email: "profile@example.com", password: "second-password-2" } })).status, 200);

  // Deletion needs the password, removes logs, and keeps the order without the account link.
  const fresh = changed.body.token;
  assert.equal((await call("/api/auth/me", { method: "DELETE", token: fresh, body: { password: "wrong-password-1" } })).status, 403);
  assert.equal((await call("/api/auth/me", { method: "DELETE", token: fresh, body: { password: "second-password-2" } })).status, 204);
  assert.equal((await call("/api/auth/me", { token: fresh })).status, 401);
  assert.equal((await call("/api/auth/login", { method: "POST", body: { email: "profile@example.com", password: "second-password-2" } })).status, 401);
});

test("sharing: owner creates and revokes read-only links, anyone with the link reads that one session", { skip }, async () => {
  const owner = await register("owner-share@example.com", "owner-password-1");
  const rival = await register("rival-share@example.com", "rival-password-1");
  const points = Array.from({ length: 30 }, (_, index) => ({ timeMs: index * 40, latitude: 42.48 + index * 1e-5, longitude: 12.07, speed: 50, gForceX: 0, gForceY: 0, gForceZ: 1, lap: 0 }));
  const saved = await call("/api/logs", { method: "POST", token: owner.body.token, body: { startedAt: "2026-04-01T10:00:00Z", endedAt: "2026-04-01T10:01:00Z", points } });
  const other = await call("/api/logs", { method: "POST", token: owner.body.token, body: { startedAt: "2026-04-02T10:00:00Z", endedAt: "2026-04-02T10:01:00Z", points: points.slice(0, 10) } });

  // Only the owner can create or list links.
  assert.equal((await call(`/api/logs/${saved.body.id}/shares`, { method: "POST", token: rival.body.token, body: { pilotName: "Thief" } })).status, 404);
  assert.equal((await call(`/api/logs/${saved.body.id}/shares`, { method: "POST", body: {} })).status, 401);
  assert.equal((await call(`/api/logs/${saved.body.id}/shares`, { token: rival.body.token })).body.shares?.length ?? 0, 0);

  const created = await call(`/api/logs/${saved.body.id}/shares`, { method: "POST", token: owner.body.token, body: { pilotName: "  Marco  " } });
  assert.equal(created.status, 201);
  assert.equal(created.body.share.pilotName, "Marco");
  assert.match(created.body.share.url, /#shared=[A-Za-z0-9_-]{32}$/);
  const defaulted = await call(`/api/logs/${saved.body.id}/shares`, { method: "POST", token: owner.body.token, body: {} });
  assert.equal(defaulted.body.share.pilotName, "owner-share", "defaults to the mail name without the domain");

  const listed = await call(`/api/logs/${saved.body.id}/shares`, { token: owner.body.token });
  assert.equal(listed.body.shares.length, 2);

  // The link works without any account and exposes only that session.
  const token = created.body.share.token;
  const read = await call(`/api/shared/${token}`);
  assert.equal(read.status, 200);
  assert.equal(read.body.shared.pilotName, "Marco");
  assert.equal(read.body.shared.points.length, 30);
  assert.ok(!JSON.stringify(read.body).includes("owner-share@example.com"), "the owner's email is never exposed");
  assert.equal((await call(`/api/shared/${"x".repeat(32)}`)).status, 404);
  assert.equal((await call("/api/shared/short")).status, 404);

  // An AI comparison against a link that does not exist (or was malformed) is refused before any model call.
  assert.equal((await call(`/api/logs/${saved.body.id}/ai-analysis`, { method: "POST", token: owner.body.token, body: { rivalToken: "y".repeat(32) } })).status, 404);
  assert.equal((await call(`/api/logs/${saved.body.id}/ai-analysis`, { method: "POST", token: owner.body.token, body: { rivalToken: "../x" } })).status, 404);

  // Only the owner can revoke; once revoked the link stops working.
  assert.equal((await call(`/api/shares/${created.body.share.id}`, { method: "DELETE", token: rival.body.token })).status, 404);
  assert.equal((await call(`/api/shares/${created.body.share.id}`, { method: "DELETE", token: owner.body.token })).status, 204);
  assert.equal((await call(`/api/shared/${token}`)).status, 404);
  assert.equal((await call(`/api/logs/${saved.body.id}/shares`, { token: owner.body.token })).body.shares.length, 1);

  // Deleting the session removes its links.
  const link = defaulted.body.share.token;
  assert.equal((await call(`/api/logs/${saved.body.id}`, { method: "DELETE", token: owner.body.token })).status, 204);
  assert.equal((await call(`/api/shared/${link}`)).status, 404);
  assert.equal(other.status, 201);
});

test("friends: single-use invites, mutual friendship, stats only with consent, friends leaderboard", { skip }, async () => {
  const fs = await import("node:fs");
  const { parseRaceBoxCsv } = await import("../src/domain/csv.js");
  const raw = parseRaceBoxCsv(fs.readFileSync(new URL("../src/fixtures/viterbo-session-2026-07-10.csv", import.meta.url), "utf8"));
  const points = raw.map((p) => ({ timeMs: p.timeMs, latitude: p.latitude, longitude: p.longitude, speed: p.speed, gForceX: p.gForceX ?? 0, gForceY: p.gForceY ?? 0, gForceZ: p.gForceZ ?? 1, lap: p.lap ?? 0 }));
  const anna = await register("anna-friend@example.com", "anna-password-1");
  const ben = await register("ben-friend@example.com", "ben-password-1");
  const cara = await register("cara-friend@example.com", "cara-password-1");
  const log = await call("/api/logs", { method: "POST", token: anna.body.token, body: { startedAt: "2026-07-10T10:00:00Z", endedAt: "2026-07-10T10:30:00Z", points } });
  assert.equal(log.status, 201);
  await call("/api/logs", { method: "POST", token: ben.body.token, body: { startedAt: "2026-07-11T10:00:00Z", endedAt: "2026-07-11T10:30:00Z", points } });

  assert.equal((await call("/api/friends")).status, 401);
  assert.equal((await call("/api/friends/invites", { method: "POST" })).status, 401);

  // Settings: pilot name and the stats switch (closed by default).
  const me = await call("/api/auth/me", { token: anna.body.token });
  assert.equal(me.body.user.statsVisible, false);
  const named = await call("/api/profile/settings", { method: "PATCH", token: anna.body.token, body: { displayName: "Anna R." } });
  assert.equal(named.body.user.pilotName, "Anna R.");
  assert.equal((await call("/api/profile/settings", { method: "PATCH", token: anna.body.token, body: { displayName: "x" } })).status, 400);
  const annaId = me.body.user.id;

  // Invite: cannot accept your own, a stranger can, and the link works once.
  const invite = await call("/api/friends/invites", { method: "POST", token: anna.body.token });
  assert.equal(invite.status, 201);
  assert.match(invite.body.invite.url, /#friend=[A-Za-z0-9_-]{32}$/);
  const token = invite.body.invite.token;
  assert.equal((await call("/api/friends/accept", { method: "POST", token: anna.body.token, body: { token } })).status, 400);
  const preview = await call(`/api/friends/invites/${token}`, { token: ben.body.token });
  assert.equal(preview.body.inviter.name, "Anna R.");
  assert.ok(!JSON.stringify(preview.body).includes("anna-friend@example.com"));
  assert.equal((await call("/api/friends/accept", { method: "POST", token: ben.body.token, body: { token: "bad" } })).status, 404);
  const accepted = await call("/api/friends/accept", { method: "POST", token: ben.body.token, body: { token } });
  assert.equal(accepted.status, 201);
  assert.equal((await call("/api/friends/accept", { method: "POST", token: cara.body.token, body: { token } })).status, 404, "single use");
  assert.equal((await call("/api/friends", { token: anna.body.token })).body.invites.length, 0);
  assert.equal((await call("/api/friends", { token: anna.body.token })).body.friends[0].name, "ben-friend");
  assert.equal((await call("/api/friends", { token: ben.body.token })).body.friends[0].name, "Anna R.");

  // Already friends: a second invite does not duplicate or consume.
  const again = await call("/api/friends/invites", { method: "POST", token: anna.body.token });
  const dup = await call("/api/friends/accept", { method: "POST", token: ben.body.token, body: { token: again.body.invite.token } });
  assert.equal(dup.body.alreadyFriends, true);
  assert.equal((await call(`/api/friends/invites/${again.body.invite.token}`, { token: cara.body.token })).status, 200, "not consumed");
  assert.equal((await call(`/api/friends/invites/${again.body.invite.id}`, { method: "DELETE", token: ben.body.token })).status, 404);
  assert.equal((await call(`/api/friends/invites/${again.body.invite.id}`, { method: "DELETE", token: anna.body.token })).status, 204);

  // Own stats; a friend's stats stay closed until they opt in.
  await sleep(300);
  const mine = await call("/api/stats/me", { token: anna.body.token });
  assert.equal(mine.body.activity.sessions, 1);
  assert.equal(mine.body.tracks.length, 1);
  assert.ok(mine.body.tracks[0].bestLapMs > 0);
  const trackId = mine.body.tracks[0].trackId;
  assert.equal((await call(`/api/friends/${annaId}/stats`, { token: ben.body.token })).status, 403);
  assert.equal((await call(`/api/friends/${annaId}/stats`, { token: cara.body.token })).status, 404, "strangers get nothing");
  const lonely = await call(`/api/leaderboard?track=${trackId}`, { token: ben.body.token });
  assert.equal(lonely.body.rows.length, 1);
  assert.equal(lonely.body.hiddenFriends, 1);

  await call("/api/profile/settings", { method: "PATCH", token: anna.body.token, body: { statsVisible: true } });
  const seen = await call(`/api/friends/${annaId}/stats`, { token: ben.body.token });
  assert.equal(seen.status, 200);
  assert.equal(seen.body.pilot.name, "Anna R.");
  assert.ok(!JSON.stringify(seen.body).includes("anna-friend@example.com"));
  const board = await call(`/api/leaderboard?track=${trackId}`, { token: ben.body.token });
  assert.equal(board.body.rows.length, 2);
  assert.equal(board.body.hiddenFriends, 0);
  assert.equal(board.body.rows.filter((row) => row.you).length, 1);
  assert.equal(board.body.rows[0].gapMs, 0);
  assert.equal((await call(`/api/leaderboard?track=${trackId}`, { token: cara.body.token })).body.rows.length, 0);
  assert.equal((await call("/api/leaderboard", { token: ben.body.token })).status, 400);

  // Removing a friend cuts the access in both directions.
  assert.equal((await call(`/api/friends/${annaId}`, { method: "DELETE", token: ben.body.token })).status, 204);
  assert.equal((await call(`/api/friends/${annaId}/stats`, { token: ben.body.token })).status, 404);
  assert.equal((await call("/api/friends", { token: anna.body.token })).body.friends.length, 0);
  assert.equal((await call(`/api/friends/${annaId}`, { method: "DELETE", token: ben.body.token })).status, 404);
});
