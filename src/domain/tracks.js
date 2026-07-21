const EARTH_RADIUS_M = 6_371_000;

export const TRACKS = [{
  id: "circuito-internazionale-viterbo",
  name: "Circuito Internazionale di Viterbo",
  country: "Italy",
  center: { latitude: 42.48475, longitude: 12.07012 },
  detectionRadiusM: 1200,
}];

export function distanceMeters(a, b) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const dLat = lat2 - lat1;
  const dLon = radians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function sessionCenter(points) {
  const valid = points.filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
  if (!valid.length) return null;
  return {
    latitude: valid.reduce((sum, point) => sum + point.latitude, 0) / valid.length,
    longitude: valid.reduce((sum, point) => sum + point.longitude, 0) / valid.length,
  };
}

export function identifyTrack(points, tracks = TRACKS) {
  const center = sessionCenter(points);
  if (!center) return null;
  return tracks
    .map((track) => ({ ...track, distanceM: distanceMeters(center, track.center) }))
    .filter((track) => track.distanceM <= track.detectionRadiusM)
    .sort((a, b) => a.distanceM - b.distanceM)[0] ?? null;
}
