import { analyzeSession } from "../src/domain/analysis.js";
import { splitSessionIntoLaps } from "../src/domain/laps.js";
import { computeSectors } from "../src/domain/sectors.js";
import { TRACKS } from "../src/domain/track-catalog.js";
import { identifyTrack } from "../src/domain/tracks.js";

// Per-session summary that the pilot statistics are built from (computed once per log, stored in log_stats).
export function computeLogStats(points) {
  if (!Array.isArray(points) || points.length < 2) return null;
  try {
    const track = identifyTrack(points, TRACKS);
    const prepared = splitSessionIntoLaps(points, track);
    const analysis = analyzeSession(prepared);
    const laps = analysis.laps;
    const sectors = laps.length ? computeSectors(prepared, analysis) : null;
    return {
      trackId: track?.id ?? null,
      trackName: track?.name ?? null,
      lapCount: laps.length,
      bestLapMs: laps.length ? Math.round(analysis.fastestLap.durationMs) : null,
      idealLapMs: Number.isFinite(sectors?.idealMs) ? Math.round(sectors.idealMs) : null,
      distanceM: Math.round(analysis.session.distanceM || 0),
      durationMs: Math.round(analysis.session.durationMs || 0),
    };
  } catch {
    return null;
  }
}

const upsertSql = `insert into log_stats (log_id, user_id, started_at, track_id, track_name, lap_count, best_lap_ms, ideal_lap_ms, distance_m, duration_ms)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  on conflict (log_id) do update set started_at = excluded.started_at, track_id = excluded.track_id, track_name = excluded.track_name,
    lap_count = excluded.lap_count, best_lap_ms = excluded.best_lap_ms, ideal_lap_ms = excluded.ideal_lap_ms,
    distance_m = excluded.distance_m, duration_ms = excluded.duration_ms, computed_at = now()`;

export async function storeLogStats(database, { logId, userId, startedAt, points }) {
  // A log that cannot be analysed still gets a row so it is not recomputed on every request.
  const stats = computeLogStats(points) ?? { trackId: null, trackName: null, lapCount: 0, bestLapMs: null, idealLapMs: null, distanceM: 0, durationMs: 0 };
  await database.query(upsertSql, [logId, userId, startedAt, stats.trackId, stats.trackName, stats.lapCount, stats.bestLapMs, stats.idealLapMs, stats.distanceM, stats.durationMs]);
}

// Fills in stats for logs saved before statistics existed (or re-saved since); a few per call so a request stays fast.
export async function ensureStats(database, userId, cap = 8) {
  const missing = await database.query(`select l.id, l.started_at, l.payload from telemetry_logs l
    left join log_stats s on s.log_id = l.id where l.user_id = $1 and s.log_id is null order by l.started_at desc limit $2`, [userId, cap]);
  for (const row of missing.rows) await storeLogStats(database, { logId: row.id, userId, startedAt: row.started_at, points: row.payload.points });
  const left = await database.query(`select count(*)::int as count from telemetry_logs l
    left join log_stats s on s.log_id = l.id where l.user_id = $1 and s.log_id is null`, [userId]);
  return left.rows[0].count;
}

// Activity totals, best laps per track and the best-lap history that the progress chart draws.
export async function statsFor(database, userId) {
  const [activity, tracks, history] = await Promise.all([
    database.query(`select count(*)::int as sessions, coalesce(sum(lap_count), 0)::int as laps,
      coalesce(sum(distance_m), 0)::float as distance_m, coalesce(sum(duration_ms), 0)::float as duration_ms
      from log_stats where user_id = $1`, [userId]),
    database.query(`select track_id, max(track_name) as track_name, count(*)::int as sessions, sum(lap_count)::int as laps,
      min(best_lap_ms)::int as best_lap_ms, min(ideal_lap_ms)::int as ideal_lap_ms, max(started_at) as last_at,
      (array_agg(started_at order by best_lap_ms))[1] as best_at
      from log_stats where user_id = $1 and track_id is not null and best_lap_ms is not null
      group by track_id order by max(started_at) desc`, [userId]),
    database.query(`select track_id, started_at, best_lap_ms from log_stats
      where user_id = $1 and track_id is not null and best_lap_ms is not null order by started_at asc limit 1000`, [userId]),
  ]);
  const row = activity.rows[0];
  const byTrack = {};
  for (const item of history.rows) (byTrack[item.track_id] ||= []).push({ at: item.started_at, bestLapMs: item.best_lap_ms });
  return {
    activity: { sessions: row.sessions, laps: row.laps, distanceKm: Math.round(row.distance_m / 100) / 10, durationMs: Math.round(row.duration_ms) },
    tracks: tracks.rows.map((track) => ({
      trackId: track.track_id, trackName: track.track_name, sessions: track.sessions, laps: track.laps,
      bestLapMs: track.best_lap_ms, idealLapMs: track.ideal_lap_ms, lastAt: track.last_at, bestAt: track.best_at,
      history: byTrack[track.track_id] ?? [],
    })),
  };
}

// Friends-only ranking on one track: the user plus every friend who allows their statistics to be seen.
export async function leaderboard(database, userIds, trackId) {
  const rows = await database.query(`select user_id, min(best_lap_ms)::int as best_lap_ms, min(ideal_lap_ms)::int as ideal_lap_ms,
    count(*)::int as sessions, sum(lap_count)::int as laps from log_stats
    where user_id = any($1::uuid[]) and track_id = $2 and best_lap_ms is not null group by user_id`, [userIds, trackId]);
  return rows.rows.sort((a, b) => a.best_lap_ms - b.best_lap_ms);
}
