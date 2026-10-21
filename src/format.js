// Formatting helpers shared by the app screens.
import { getLanguage } from "./i18n.js";

export const formatDuration = (milliseconds) => {
  if (!Number.isFinite(milliseconds)) return "—";
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.round((milliseconds % 60_000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

export const formatLapTime = (milliseconds) => {
  if (!Number.isFinite(milliseconds)) return "—";
  const rounded = Math.round(milliseconds);
  const minutes = Math.floor(rounded / 60_000);
  const seconds = Math.floor((rounded % 60_000) / 1000);
  const millis = rounded % 1000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
};

export const formatDate = (iso) => new Intl.DateTimeFormat(getLanguage(), {
  day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit",
}).format(new Date(iso));

export const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
}[character]));

export const formatSectorTime = (milliseconds) => !Number.isFinite(milliseconds) ? "—" : milliseconds < 60_000 ? (milliseconds / 1000).toFixed(3) : formatLapTime(milliseconds);
export const formatGap = (milliseconds) => `${milliseconds < 0 ? "−" : "+"}${(Math.abs(milliseconds) / 1000).toFixed(3)}`;
