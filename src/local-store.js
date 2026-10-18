// On-device session storage for the offline apps (IndexedDB inside the app's WebView / Electron).
// "sessions" holds the metadata list, "points" the telemetry of each session, loaded on demand.
const DB_NAME = "d3cf";
const DB_VERSION = 1;

let opening = null;
function database() {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("sessions")) db.createObjectStore("sessions", { keyPath: "id" });
      if (!db.objectStoreNames.contains("points")) db.createObjectStore("points");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { opening = null; reject(request.error); };
  });
  return opening;
}

function transaction(stores, mode, work) {
  return database().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Storage transaction aborted"));
    result = work(tx);
  }));
}
const requestValue = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export async function listLocalSessions(owner) {
  const db = await database();
  const all = await requestValue(db.transaction("sessions").objectStore("sessions").getAll());
  return all.filter((session) => session.owner === owner);
}

export async function loadLocalPoints(id) {
  const db = await database();
  return (await requestValue(db.transaction("points").objectStore("points").get(id))) ?? [];
}

// Saves metadata and points together; existing metadata (title, cloud link) is replaced by `session`.
export function saveLocalSession(session, points) {
  const { points: _ignored, ...meta } = session;
  return transaction(["sessions", "points"], "readwrite", (tx) => {
    tx.objectStore("sessions").put(meta);
    if (points) tx.objectStore("points").put(points, meta.id);
  });
}

export function updateLocalSession(id, changes) {
  return transaction(["sessions"], "readwrite", (tx) => {
    const store = tx.objectStore("sessions");
    const read = store.get(id);
    read.onsuccess = () => { if (read.result) store.put({ ...read.result, ...changes, id }); };
  });
}

export function deleteLocalSession(id) {
  return transaction(["sessions", "points"], "readwrite", (tx) => {
    tx.objectStore("sessions").delete(id);
    tx.objectStore("points").delete(id);
  });
}
