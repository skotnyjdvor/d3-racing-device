import { readFile } from "node:fs/promises";
import pg from "pg";

const { Pool } = pg;

export const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  max: 10,
}) : null;

export async function migrate() {
  if (!pool) return;
  const sql = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  await pool.query(sql);
}

export function requireDatabase() {
  if (!pool) {
    const error = new Error("Database is not configured");
    error.status = 503;
    throw error;
  }
  return pool;
}
