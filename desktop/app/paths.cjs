"use strict";
// URL and file helpers for the desktop shell. Kept free of Electron imports so they can be unit-tested.
const fs = require("node:fs");
const path = require("node:path");

const APP_SCHEME = "app";
const APP_HOST = "d3cf";
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

// Map a request path on app://d3cf to a file in the bundled web build.
// Paths without an extension are app routes (/features, /shop …) and get index.html.
// Returns null when the file is missing or the path tries to leave the web root.
const isFile = (file) => fs.statSync(file, { throwIfNoEntry: false })?.isFile() ?? false;

function resolveAppFile(root, pathname, exists = isFile) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes("\0")) return null;
  const base = path.resolve(root);
  const target = path.resolve(base, `.${path.sep}${decoded.replace(/[\\/]+/g, path.sep)}`);
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  const index = path.join(base, "index.html");
  if (target !== base && exists(target)) return target;
  if (path.extname(target)) return null;
  return exists(index) ? index : null;
}

function parse(url) {
  try { return new URL(url); } catch { return null; }
}

const isAppUrl = (url) => {
  const parsed = parse(url);
  return Boolean(parsed && parsed.protocol === `${APP_SCHEME}:` && parsed.host === APP_HOST);
};

// Links that should open in the user's browser or mail client instead of inside the app window.
const isExternalWebUrl = (url) => ["http:", "https:", "mailto:"].includes(parse(url)?.protocol);

module.exports = { APP_SCHEME, APP_HOST, APP_ORIGIN, resolveAppFile, isAppUrl, isExternalWebUrl };
