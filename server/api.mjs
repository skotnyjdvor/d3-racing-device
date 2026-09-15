import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import cors from "cors";
import express from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import jwt from "jsonwebtoken";
import { migrate, requireDatabase } from "./db.mjs";
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
const publicUser = (row) => ({ id: row.id, email: row.email });
const issueToken = (user) => jwt.sign({ sub: user.id, email: user.email }, jwtSecret, { expiresIn: "30d", issuer: "laptrace" });

function authenticate(request, response, next) {
  const token = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return response.status(401).json({ error: "Authentication required" });
  try { request.auth = jwt.verify(token, jwtSecret, { issuer: "laptrace" }); next(); }
  catch { response.status(401).json({ error: "Session expired. Sign in again." }); }
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
    const result = await requireDatabase().query("insert into users (email, password_hash) values ($1, $2) returning id, email", [email, hash]);
    const user = publicUser(result.rows[0]);
    response.status(201).json({ user, token: issueToken(user) });
  } catch (error) {
    if (error.code === "23505") return response.status(409).json({ error: "An account with this email already exists" });
    next(error);
  }
});

app.post("/api/auth/login", authLimiter, async (request, response, next) => {
  try {
    const email = normalizeEmail(request.body.email); const password = String(request.body.password || "");
    const result = await requireDatabase().query("select id, email, password_hash from users where email = $1", [email]);
    const row = result.rows[0];
    if (!row || !await bcrypt.compare(password, row.password_hash)) return response.status(401).json({ error: "Invalid email or password" });
    const user = publicUser(row);
    response.json({ user, token: issueToken(user) });
  } catch (error) { next(error); }
});

app.get("/api/auth/me", authenticate, async (request, response, next) => {
  try {
    const result = await requireDatabase().query("select id, email from users where id = $1", [request.auth.sub]);
    if (!result.rows[0]) return response.status(401).json({ error: "Account not found" });
    response.json({ user: publicUser(result.rows[0]) });
  } catch (error) { next(error); }
});

app.get("/api/logs", authenticate, async (request, response, next) => {
  try {
    const result = await requireDatabase().query(`select id, title, device_name, started_at, ended_at, point_count, created_at, updated_at
      from telemetry_logs where user_id = $1 order by started_at desc limit 20`, [request.auth.sub]);
    response.json({ logs: result.rows.map((row) => ({
      id: row.id, title: row.title, deviceName: row.device_name, startedAt: row.started_at, endedAt: row.ended_at,
      pointCount: row.point_count, createdAt: row.created_at, updatedAt: row.updated_at,
    })) });
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
  app.get(/.*/, (_request, response) => response.set("Cache-Control", "no-cache").sendFile(join(dist, "index.html")));
}

await migrate();
app.listen(port, "0.0.0.0", () => console.log(`LapTrace API listening on ${port}`));
