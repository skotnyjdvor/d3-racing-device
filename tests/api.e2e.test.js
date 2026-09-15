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
