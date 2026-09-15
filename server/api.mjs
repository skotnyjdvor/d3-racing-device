import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import cors from "cors";
import express from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import jwt from "jsonwebtoken";
import { migrate, requireDatabase } from "./db.mjs";
import { sendPasswordResetEmail, sendVerificationEmail } from "./mail.mjs";
import { AI_MODEL, buildTelemetrySnapshot, generateAiFollowUp, generateAiReport, getOpenAiApiKey, groundAiReport, snapshotCacheKey } from "./ai.mjs";

const app = express();
app.disable("x-powered-by");
// Render sits behind its own proxy (and Cloudflare in front of the custom domain): trust one hop so req.ip is the client.
app.set("trust proxy", 1);
const port = Number(process.env.PORT || 10000);
const jwtSecret = process.env.JWT_SECRET || (process.env.NODE_ENV === "production" ? "" : "laptrace-local-development-secret");
if (!jwtSecret) throw new Error("JWT_SECRET is required");

const allowedOrigins = (process.env.APP_ORIGIN || "http://127.0.0.1:4173,http://localhost:4173")
  .split(",").map((origin) => origin.trim()).filter(Boolean);
app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)) }));
app.use((request, response, next) => {
  response.set({
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), bluetooth=(self)",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  });
  next();
});
const largeJson = express.json({ limit: "30mb" });
const smallJson = express.json({ limit: "200kb" });
app.use((request, response, next) => (request.method === "POST" && request.path === "/api/logs" ? largeJson : smallJson)(request, response, next));
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
app.param("id", (request, response, next, id) => (uuidPattern.test(id) ? next() : response.status(404).json({ error: "Not found" })));

// Cloudflare overwrites CF-Connecting-IP with the real visitor address; fall back to the proxied req.ip.
const clientKey = (request) => ipKeyGenerator(String(request.headers["cf-connecting-ip"] || request.ip || ""));
const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false, keyGenerator: clientKey });
// AI calls are authenticated, so budget them per account rather than per network.
const aiLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, keyGenerator: (request) => request.auth?.sub || clientKey(request) });
const normalizeEmail = (email) => String(email || "").trim().toLowerCase();
const validEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const publicUser = (row) => ({ id: row.id, email: row.email, emailVerified: Boolean(row.email_verified_at) });
const issueToken = (row) => jwt.sign({ sub: row.id, email: row.email, tv: row.token_version ?? 0 }, jwtSecret, { expiresIn: "30d", issuer: "laptrace" });
const userColumns = "id, email, email_verified_at, token_version";
const normalizeLanguage = (language) => (["ru", "en", "pl"].includes(language) ? language : "ru");
const hashToken = (token) => createHash("sha256").update(token).digest("hex");
const tokenPattern = /^[A-Za-z0-9_-]{32,128}$/;

async function authenticate(request, response, next) {
  const token = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return response.status(401).json({ error: "Authentication required" });
  let claims;
  try { claims = jwt.verify(token, jwtSecret, { issuer: "laptrace" }); }
  catch { return response.status(401).json({ error: "Session expired. Sign in again." }); }
  try {
    // Password resets bump token_version, which revokes every session issued before the reset.
    const result = await requireDatabase().query("select token_version from users where id = $1", [claims.sub]);
    if (!result.rows[0] || result.rows[0].token_version !== (claims.tv ?? 0)) return response.status(401).json({ error: "Session expired. Sign in again." });
    request.auth = claims;
    next();
  } catch (error) { next(error); }
}

async function issueAuthToken(database, userId, kind, ttlMinutes) {
  const token = randomBytes(32).toString("base64url");
  await database.query("update auth_tokens set used_at = now() where user_id = $1 and kind = $2 and used_at is null", [userId, kind]);
  await database.query("insert into auth_tokens (user_id, kind, token_hash, expires_at) values ($1, $2, $3, now() + make_interval(mins => $4))", [userId, kind, hashToken(token), ttlMinutes]);
  return token;
}

async function consumeAuthToken(client, token, kind) {
  if (!tokenPattern.test(String(token || ""))) return null;
  const result = await client.query(`update auth_tokens set used_at = now()
    where token_hash = $1 and kind = $2 and used_at is null and expires_at > now()
    returning user_id`, [hashToken(token), kind]);
  return result.rows[0]?.user_id ?? null;
}

async function sendVerification(database, user, language) {
  const token = await issueAuthToken(database, user.id, "verify", 24 * 60);
  await sendVerificationEmail(user.email, token, normalizeLanguage(language));
}

app.get("/api/health", async (_request, response) => {
  response.set("Cache-Control", "no-store");
  try {
    await requireDatabase().query("select 1");
    response.json({
      ok: true,
      aiConfigured: Boolean(getOpenAiApiKey()),
      aiModel: AI_MODEL,
      revision: process.env.RENDER_GIT_COMMIT?.slice(0, 7) || null,
    });
  }
  catch (error) { console.error(error); response.status(503).json({ ok: false }); }
});

app.post("/api/auth/register", authLimiter, async (request, response, next) => {
  try {
    const email = normalizeEmail(request.body.email); const password = String(request.body.password || "");
    if (!validEmail(email) || password.length < 8) return response.status(400).json({ error: "Use a valid email and a password of at least 8 characters" });
    const hash = await bcrypt.hash(password, 12);
    const database = requireDatabase();
    const result = await database.query(`insert into users (email, password_hash) values ($1, $2) returning ${userColumns}`, [email, hash]);
    const row = result.rows[0];
    // Registration must not fail because of email delivery; the user can resend the confirmation later.
    try { await sendVerification(database, row, request.body.language); }
    catch (error) { console.error("Verification email failed", error.message); }
    response.status(201).json({ user: publicUser(row), token: issueToken(row) });
  } catch (error) {
    if (error.code === "23505") return response.status(409).json({ error: "An account with this email already exists" });
    next(error);
  }
});

app.post("/api/auth/login", authLimiter, async (request, response, next) => {
  try {
    const email = normalizeEmail(request.body.email); const password = String(request.body.password || "");
    const result = await requireDatabase().query(`select ${userColumns}, password_hash from users where email = $1`, [email]);
    const row = result.rows[0];
    if (!row || !await bcrypt.compare(password, row.password_hash)) return response.status(401).json({ error: "Invalid email or password" });
    response.json({ user: publicUser(row), token: issueToken(row) });
  } catch (error) { next(error); }
});

app.get("/api/auth/me", authenticate, async (request, response, next) => {
  try {
    const result = await requireDatabase().query(`select ${userColumns} from users where id = $1`, [request.auth.sub]);
    if (!result.rows[0]) return response.status(401).json({ error: "Account not found" });
    response.json({ user: publicUser(result.rows[0]) });
  } catch (error) { next(error); }
});

app.post("/api/auth/forgot", authLimiter, async (request, response, next) => {
  try {
    const email = normalizeEmail(request.body.email);
    if (!validEmail(email)) return response.status(400).json({ error: "Use a valid email" });
    const database = requireDatabase();
    const result = await database.query("select id, email from users where email = $1", [email]);
    const row = result.rows[0];
    if (row) {
      const token = await issueAuthToken(database, row.id, "reset", 60);
      await sendPasswordResetEmail(row.email, token, normalizeLanguage(request.body.language));
    }
    // Same answer whether or not the account exists, so the endpoint cannot be used to probe emails.
    response.json({ ok: true });
  } catch (error) { next(error); }
});

app.post("/api/auth/reset", authLimiter, async (request, response, next) => {
  const password = String(request.body.password || "");
  if (password.length < 8 || password.length > 200) return response.status(400).json({ error: "Use a password of at least 8 characters" });
  let client;
  try { client = await requireDatabase().connect(); }
  catch (error) { return next(error); }
  try {
    await client.query("begin");
    const userId = await consumeAuthToken(client, request.body.token, "reset");
    if (!userId) { await client.query("rollback"); return response.status(400).json({ error: "The reset link is invalid or has expired" }); }
    const hash = await bcrypt.hash(password, 12);
    // Resetting via email also proves ownership of the address.
    const result = await client.query(`update users set password_hash = $1, token_version = token_version + 1,
      email_verified_at = coalesce(email_verified_at, now()) where id = $2 returning ${userColumns}`, [hash, userId]);
    await client.query("update auth_tokens set used_at = now() where user_id = $1 and kind = 'reset' and used_at is null", [userId]);
    await client.query("commit");
    const row = result.rows[0];
    response.json({ user: publicUser(row), token: issueToken(row) });
  } catch (error) {
    await client.query("rollback").catch(() => {});
    next(error);
  } finally { client.release(); }
});

app.post("/api/auth/verify", authLimiter, async (request, response, next) => {
  try {
    const database = requireDatabase();
    const userId = await consumeAuthToken(database, request.body.token, "verify");
    if (!userId) return response.status(400).json({ error: "The confirmation link is invalid or has expired" });
    const result = await database.query(`update users set email_verified_at = coalesce(email_verified_at, now()) where id = $1 returning ${userColumns}`, [userId]);
    response.json({ user: publicUser(result.rows[0]) });
  } catch (error) { next(error); }
});

app.post("/api/auth/verify/resend", authenticate, authLimiter, async (request, response, next) => {
  try {
    const database = requireDatabase();
    const result = await database.query(`select ${userColumns} from users where id = $1`, [request.auth.sub]);
    const row = result.rows[0];
    if (!row) return response.status(401).json({ error: "Account not found" });
    if (!row.email_verified_at) await sendVerification(database, row, request.body.language);
    response.json({ ok: true, alreadyVerified: Boolean(row.email_verified_at) });
  } catch (error) { next(error); }
});

app.get("/api/logs", authenticate, async (request, response, next) => {
  try {
    // Keyset pagination over (started_at desc, id desc): ?limit=1..200&before=<ISO date>&beforeId=<uuid>.
    const limit = Math.min(200, Math.max(1, Number.parseInt(request.query.limit, 10) || 100));
    const before = String(request.query.before || "");
    const beforeId = uuidPattern.test(String(request.query.beforeId || "")) ? request.query.beforeId : null;
    const cursor = Number.isFinite(Date.parse(before)) && beforeId;
    const result = await requireDatabase().query(`select id, title, device_name, started_at, started_at::text as cursor_at, ended_at, point_count, created_at, updated_at
      from telemetry_logs where user_id = $1 ${cursor ? "and (started_at, id) < ($3::timestamptz, $4::uuid)" : ""}
      order by started_at desc, id desc limit $2`,
    cursor ? [request.auth.sub, limit + 1, before, beforeId] : [request.auth.sub, limit + 1]);
    const rows = result.rows.slice(0, limit);
    const last = rows.at(-1);
    response.json({
      logs: rows.map((row) => ({
        id: row.id, title: row.title, deviceName: row.device_name, startedAt: row.started_at, endedAt: row.ended_at,
        pointCount: row.point_count, createdAt: row.created_at, updatedAt: row.updated_at,
      })),
      nextCursor: result.rows.length > limit && last ? { before: last.cursor_at, beforeId: last.id } : null,
    });
  } catch (error) { next(error); }
});

app.get("/api/logs/:id", authenticate, async (request, response, next) => {
  try {
    const result = await requireDatabase().query(`select id, title, device_name, started_at, ended_at, point_count, payload, created_at, updated_at
      from telemetry_logs where id = $1 and user_id = $2`, [request.params.id, request.auth.sub]);
    const row = result.rows[0];
    if (!row) return response.status(404).json({ error: "Log not found" });
    response.json({ log: {
      id: row.id, title: row.title, deviceName: row.device_name, startedAt: row.started_at, endedAt: row.ended_at,
      pointCount: row.point_count, points: row.payload.points, createdAt: row.created_at, updatedAt: row.updated_at,
    } });
  } catch (error) { next(error); }
});

app.post("/api/logs", authenticate, async (request, response, next) => {
  try {
    const { deviceName = "LapTrace", startedAt, endedAt, points } = request.body;
    if (!Array.isArray(points) || points.length < 2 || points.length > 500_000) return response.status(400).json({ error: "Invalid telemetry payload" });
    if (!Number.isFinite(Date.parse(startedAt)) || !Number.isFinite(Date.parse(endedAt))) return response.status(400).json({ error: "Invalid session dates" });
    const result = await requireDatabase().query(`insert into telemetry_logs
      (id, user_id, device_name, started_at, ended_at, point_count, payload)
      values ($1, $2, $3, $4, $5, $6, $7::jsonb)
      on conflict (user_id, started_at) do update set
        device_name = excluded.device_name, ended_at = excluded.ended_at,
        point_count = excluded.point_count, payload = excluded.payload, updated_at = now()
      returning id`, [randomUUID(), request.auth.sub, String(deviceName).slice(0, 100), startedAt, endedAt, points.length, JSON.stringify({ points })]);
    response.status(201).json({ id: result.rows[0].id });
  } catch (error) { next(error); }
});

app.patch("/api/logs/:id", authenticate, async (request, response, next) => {
  try {
    const title = String(request.body.title || "").trim().slice(0, 100);
    if (!title) return response.status(400).json({ error: "Log title is required" });
    const result = await requireDatabase().query(
      "update telemetry_logs set title = $1, updated_at = now() where id = $2 and user_id = $3 returning id, title",
      [title, request.params.id, request.auth.sub],
    );
    if (!result.rows[0]) return response.status(404).json({ error: "Log not found" });
    response.json(result.rows[0]);
  } catch (error) { next(error); }
});

app.delete("/api/logs/:id", authenticate, async (request, response, next) => {
  try {
    const result = await requireDatabase().query(
      "delete from telemetry_logs where id = $1 and user_id = $2 returning id",
      [request.params.id, request.auth.sub],
    );
    if (!result.rows[0]) return response.status(404).json({ error: "Log not found" });
    response.status(204).end();
  } catch (error) { next(error); }
});

app.post("/api/logs/:id/ai-analysis", authenticate, aiLimiter, async (request, response, next) => {
  try {
    const database = requireDatabase();
    const logResult = await database.query(
      "select id, payload from telemetry_logs where id = $1 and user_id = $2",
      [request.params.id, request.auth.sub],
    );
    const log = logResult.rows[0];
    if (!log) return response.status(404).json({ error: "Log not found" });
    const snapshot = buildTelemetrySnapshot(log.payload.points, {
      primaryLap: request.body.primaryLap,
      comparisonLap: request.body.comparisonLap,
      question: request.body.question,
      language: request.body.language,
    });
    if (!snapshot.comparison.primaryLap) return response.status(422).json({ error: "No completed laps available for AI analysis" });
    const cacheKey = snapshotCacheKey(log.id, snapshot);
    if (!request.body.force) {
      const cached = await database.query(
        "select id, model, report, usage, created_at from ai_analyses where user_id = $1 and cache_key = $2",
        [request.auth.sub, cacheKey],
      );
      if (cached.rows[0]) return response.json({ analysis: cached.rows[0], cached: true });
    }
    const generated = await generateAiReport(snapshot);
    generated.report = groundAiReport(generated.report, snapshot);
    const saved = await database.query(`insert into ai_analyses
      (id, user_id, log_id, cache_key, model, primary_lap, comparison_lap, question, snapshot, report, usage, provider_response_id)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12)
      on conflict (user_id, cache_key) do update set report = excluded.report, usage = excluded.usage,
        provider_response_id = excluded.provider_response_id, created_at = now()
      returning id, model, report, usage, created_at`,
    [randomUUID(), request.auth.sub, log.id, cacheKey, generated.model || AI_MODEL,
      snapshot.comparison.primaryLap, snapshot.comparison.comparisonLap, snapshot.question,
      JSON.stringify(snapshot), JSON.stringify(generated.report), JSON.stringify(generated.usage), generated.responseId]);
    response.status(201).json({ analysis: saved.rows[0], cached: false });
  } catch (error) { next(error); }
});

app.get("/api/logs/:id/ai-analyses", authenticate, async (request, response, next) => {
  try {
    const result = await requireDatabase().query(`select id, model, primary_lap, comparison_lap, question, report, usage, created_at,
      coalesce(snapshot->>'language', 'ru') as language, snapshot->>'schema' as schema
      from ai_analyses where log_id = $1 and user_id = $2 order by created_at desc limit 20`,
    [request.params.id, request.auth.sub]);
    response.json({ analyses: result.rows });
  } catch (error) { next(error); }
});

app.delete("/api/ai-analyses/:id", authenticate, async (request, response, next) => {
  try {
    const result = await requireDatabase().query(
      "delete from ai_analyses where id = $1 and user_id = $2 returning id",
      [request.params.id, request.auth.sub],
    );
    if (!result.rows[0]) return response.status(404).json({ error: "AI analysis not found" });
    response.status(204).end();
  } catch (error) { next(error); }
});

app.post("/api/ai-analyses/:id/follow-up", authenticate, aiLimiter, async (request, response, next) => {
  try {
    const result = await requireDatabase().query(
      "select snapshot, report from ai_analyses where id = $1 and user_id = $2",
      [request.params.id, request.auth.sub],
    );
    const analysis = result.rows[0];
    if (!analysis) return response.status(404).json({ error: "AI analysis not found" });
    const generated = await generateAiFollowUp(analysis.snapshot, analysis.report, request.body?.question);
    response.json(generated);
  } catch (error) { next(error); }
});

app.use("/api", (_request, response) => response.status(404).json({ error: "API route not found" }));

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(error.status || 500).json({ error: error.status ? error.message : "Internal server error" });
});

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
if (existsSync(dist)) {
  app.use(express.static(dist, {
    setHeaders(response, filePath) {
      if (/[\\/]assets[\\/]/.test(filePath)) response.set("Cache-Control", "public, max-age=31536000, immutable");
      else if (filePath.endsWith(".html")) response.set("Cache-Control", "no-cache");
    },
  }));
  // The app routes with #hashes, so only "/" is a real page; everything else is a proper 404.
  app.get(["/", "/index.html"], (_request, response) => response.set("Cache-Control", "no-cache").sendFile(join(dist, "index.html")));
  app.use((_request, response) => response.status(404).set("Cache-Control", "no-cache").sendFile(join(dist, "404.html")));
}

await migrate();
app.listen(port, "0.0.0.0", () => console.log(`LapTrace API listening on ${port}`));
