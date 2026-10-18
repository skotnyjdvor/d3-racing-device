// Sessions kept on the device by the offline apps. A session is identified by its start time, so
// downloading the same LapTrace memory twice or importing the same CSV again does not duplicate it.

export const localSessionId = (startedAt) => `local-${new Date(startedAt).getTime()}`;

// Metadata stored next to the points; points live in their own record and load on demand.
export function makeLocalSession(points, { title = "", deviceName = "LapTrace" } = {}) {
  if (!Array.isArray(points) || !points.length) throw new Error("A session needs telemetry points");
  const startedAt = points[0].time;
  return {
    id: localSessionId(startedAt),
    source: "local",
    title: String(title).slice(0, 100),
    deviceName: String(deviceName || "LapTrace").slice(0, 60),
    startedAt,
    endedAt: points.at(-1).time,
    pointCount: points.length,
  };
}

// Newest first; an incoming session replaces a stored one with the same start time but keeps its title
// and cloud link, so a re-download does not undo a rename or a sync.
export function mergeSessions(stored, incoming) {
  const byId = new Map(stored.map((session) => [session.id, session]));
  for (const session of incoming) {
    const previous = byId.get(session.id);
    byId.set(session.id, previous ? { ...session, title: previous.title || session.title, cloudId: previous.cloudId ?? session.cloudId } : session);
  }
  return [...byId.values()].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
}
