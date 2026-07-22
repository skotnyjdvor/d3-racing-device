import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import jwt from "jsonwebtoken";
import { migrate, requireDatabase } from "./db.mjs";

const app = express();
app.disable("x-powered-by");
const port = Number(process.env.PORT || 10000);
const jwtSecret = process.env.JWT_SECRET || (process.env.NODE_ENV === "production" ? "" : "laptrace-local-development-secret");
if (!jwtSecret) throw new Error("JWT_SECRET is required");

const allowedOrigins = (process.env.APP_ORIGIN || "http://127.0.0.1:4173,http://localhost:4173")
  .split(",").map((origin) => origin.trim()).filter(Boolean);
app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)) }));
app.use(express.json({ limit: "30mb" }));

const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });
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
  try { await requireDatabase().query("select 1"); response.json({ ok: true }); }
  catch (error) { response.status(error.status || 500).json({ ok: false, error: error.message }); }
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

app.use("/api", (_request, response) => response.status(404).json({ error: "API route not found" }));

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(error.status || 500).json({ error: error.status ? error.message : "Internal server error" });
});

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/.*/, (_request, response) => response.sendFile(join(dist, "index.html")));
}

await migrate();
app.listen(port, "0.0.0.0", () => console.log(`LapTrace API listening on ${port}`));
