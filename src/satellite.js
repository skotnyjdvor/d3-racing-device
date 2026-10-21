// Satellite imagery under the track map: Web Mercator helpers and a small tile cache.
// The map projects longitude and Mercator latitude (both in degrees) with one scale, so the trajectory
// keeps its real shape and lines up with standard XYZ tiles.

export const SATELLITE_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
export const SATELLITE_ATTRIBUTION = "Esri, Maxar, Earthstar Geographics";
const TILE_SIZE = 256;
const MAX_ZOOM = 19;

// Latitude in degrees -> Mercator y in "degrees" (equals latitude near the equator, stretches toward the poles).
export function mercatorY(latitude) {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const radians = clamped * Math.PI / 180;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2)) * 180 / Math.PI;
}

// Photo alignment is saved per place: the middle of the lap rounded to ~100 m.
export function satelliteOffsetKey(points) {
  const lats = points.map((point) => point.latitude);
  const lons = points.map((point) => point.longitude);
  const middle = (values) => (Math.min(...values) + Math.max(...values)) / 2;
  return `${middle(lats).toFixed(3)},${middle(lons).toFixed(3)}`;
}

// One tile cache for all map canvases. `onLoad` repaints the maps when a tile arrives.
export function createSatelliteLayer({ onLoad }) {
  const tiles = new Map(); // "z/x/y" -> { image, ready, failed }
  let repaintQueued = false;
  const queueRepaint = () => {
    if (repaintQueued) return;
    repaintQueued = true;
    requestAnimationFrame(() => { repaintQueued = false; onLoad(); });
  };

  function tile(z, x, y, load) {
    const key = `${z}/${x}/${y}`;
    let entry = tiles.get(key);
    if (!entry && load) {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.decoding = "async";
      entry = { image, ready: false, failed: false };
      image.onload = () => { entry.ready = true; queueRepaint(); };
      image.onerror = () => { entry.failed = true; };
      image.src = SATELLITE_TILES.replace("{z}", z).replace("{x}", x).replace("{y}", y);
      tiles.set(key, entry);
    }
    return entry;
  }

  // Draws the tiles covering the canvas. `toCanvas(longitude, mercatorY)` maps to CSS pixels and
  // `pixelsPerDegree` is its scale. Returns true when at least one tile was drawn.
  function draw(context, width, height, toCanvas, pixelsPerDegree) {
    const ratio = window.devicePixelRatio || 1;
    // Tile zoom whose pixels match the device pixels of the canvas.
    const zoom = Math.max(0, Math.min(MAX_ZOOM, Math.round(Math.log2(pixelsPerDegree * ratio * 360 / TILE_SIZE))));
    const count = 2 ** zoom;
    const degreesPerTile = 360 / count;
    // Canvas corners back to longitude / Mercator y.
    const [originX, originY] = toCanvas(0, 0);
    const longitudeAt = (x) => (x - originX) / pixelsPerDegree;
    const mercatorAt = (y) => (originY - y) / pixelsPerDegree;
    const firstX = Math.max(0, Math.floor((longitudeAt(0) + 180) / degreesPerTile));
    const lastX = Math.min(count - 1, Math.floor((longitudeAt(width) + 180) / degreesPerTile));
    const firstY = Math.max(0, Math.floor((180 - mercatorAt(0)) / degreesPerTile));
    const lastY = Math.min(count - 1, Math.floor((180 - mercatorAt(height)) / degreesPerTile));
    if ((lastX - firstX + 1) * (lastY - firstY + 1) > 64) return false;
    let drawn = false;
    context.save();
    context.imageSmoothingQuality = "high";
    for (let y = firstY; y <= lastY; y++) {
      for (let x = firstX; x <= lastX; x++) {
        const [left, top] = toCanvas(x * degreesPerTile - 180, 180 - y * degreesPerTile);
        const size = degreesPerTile * pixelsPerDegree;
        const entry = tile(zoom, x, y, true);
        if (entry.ready) {
          // +0.5px overlap hides hairline seams between neighbouring tiles.
          context.drawImage(entry.image, left, top, size + .5, size + .5);
          drawn = true;
          continue;
        }
        // Until it arrives, stretch the nearest loaded parent tile over its place.
        for (let up = 1; up <= 6 && zoom - up >= 0; up++) {
          const parent = tile(zoom - up, x >> up, y >> up, false);
          if (!parent?.ready) continue;
          const part = TILE_SIZE / 2 ** up;
          const sx = (x - ((x >> up) << up)) * part;
          const sy = (y - ((y >> up) << up)) * part;
          context.drawImage(parent.image, sx, sy, part, part, left, top, size + .5, size + .5);
          drawn = true;
          break;
        }
      }
    }
    context.restore();
    return drawn;
  }

  return { draw };
}
