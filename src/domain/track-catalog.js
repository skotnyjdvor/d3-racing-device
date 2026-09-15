import GENERATED_TRACKS from "./track-catalog.generated.js";
import { BUILTIN_TRACKS } from "./tracks.js";

// Full catalog (~800 kB). Imported directly on the server/tests, loaded lazily in the browser via loadTrackCatalog().
export const TRACKS = [
  ...BUILTIN_TRACKS,
  ...GENERATED_TRACKS.map((track) => ({
    id: /circuito internazionale viterbo/i.test(track.name) ? "circuito-internazionale-viterbo" : track.id,
    name: track.name,
    center: { latitude: track.center[0], longitude: track.center[1] },
    detectionRadiusM: track.radius,
    start: {
      point: { latitude: track.start[0], longitude: track.start[1] },
      next: { latitude: track.start[2], longitude: track.start[3] },
    },
  })),
];
