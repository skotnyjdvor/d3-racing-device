"use strict";
// The desktop app has no npm dependencies of its own: it only ships desktop/app (Electron code + the web build).
// Returning false tells electron-builder not to install or collect node_modules, so the server packages
// from the repository root (express, pg, vite …) never end up inside the installer.
module.exports = async () => false;
