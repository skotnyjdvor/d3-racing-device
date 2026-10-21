"use strict";
// D3CF desktop shell: serves the bundled web build on app://d3cf and adds the pieces a browser
// normally provides — a Web Bluetooth device chooser and opening outside links in the browser.
const { app, BrowserWindow, Menu, ipcMain, net, protocol, session, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { APP_HOST, APP_ORIGIN, APP_SCHEME, isAppUrl, isExternalWebUrl, resolveAppFile } = require("./paths.cjs");
const { pickerStrings } = require("./picker-strings.cjs");

const webRoot = process.env.D3CF_WEB_DIR || path.join(__dirname, "web");
// Same policy as d3cf.com (server/api.mjs), plus the live API the app talks to.
const CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob: https://server.arcgisonline.com; connect-src 'self' https://d3cf.com; object-src 'none'; base-uri 'self'; form-action 'self'";

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.exit(0);

let mainWindow = null;

function serveApp() {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    const file = url.host === APP_HOST ? resolveAppFile(webRoot, url.pathname) : null;
    if (!file) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
    const response = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(response.headers);
    headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(response.body, { status: response.status, headers });
  });
}

function openExternally(url) {
  if (isExternalWebUrl(url)) shell.openExternal(url);
}

// ---- Web Bluetooth device chooser ----
// Chromium hands the scan results to the app, which must let the user pick one. One chooser per
// app window; the IPC handlers are registered once and find the chooser by the sender's webContents.
const choosers = new Map(); // picker webContents id -> { id, picker, owner, respond, devices }

function finishChooser(state, deviceId) {
  if (!choosers.has(state.id)) return;
  choosers.delete(state.id);
  state.owner.chooser = null;
  if (!state.picker.isDestroyed()) state.picker.close();
  state.respond(deviceId);
}

function openChooser(owner, respond, devices) {
  const picker = new BrowserWindow({
    parent: owner.window,
    modal: true,
    width: 420,
    height: 460,
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    title: "Bluetooth",
    backgroundColor: "#08080c",
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "picker-preload.cjs"), contextIsolation: true, sandbox: true },
  });
  // Keep the id: webContents is no longer readable once the window is destroyed.
  const state = { id: picker.webContents.id, picker, owner, respond, devices };
  owner.chooser = state;
  choosers.set(state.id, state);
  picker.removeMenu();
  picker.webContents.on("will-navigate", (event) => event.preventDefault());
  picker.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  picker.once("ready-to-show", () => { if (!picker.isDestroyed()) picker.show(); });
  // Closing the chooser window (×, Escape) cancels this request only.
  picker.on("closed", () => finishChooser(state, ""));
  picker.webContents.once("did-finish-load", () => picker.webContents.send("picker:devices", state.devices));
  picker.loadFile(path.join(__dirname, "picker.html"));
}

function attachBluetoothChooser(window) {
  const owner = { window, chooser: null };
  window.webContents.on("select-bluetooth-device", (event, devices, callback) => {
    event.preventDefault();
    // Chromium labels devices without an advertised name "Unknown or Unsupported Device (MAC)".
    const list = devices.map(({ deviceId, deviceName }) => ({ id: deviceId, name: /^Unknown or Unsupported Device/.test(deviceName || "") ? "" : deviceName || "" }));
    const open = owner.chooser;
    if (open && !open.picker.isDestroyed()) {
      // The scan keeps reporting devices; the newest callback answers the same request.
      open.respond = callback;
      open.devices = list;
      open.picker.webContents.send("picker:devices", list);
      return;
    }
    openChooser(owner, callback, list);
  });
  window.on("closed", () => { if (owner.chooser) finishChooser(owner.chooser, ""); });
}

const chooserFor = (event) => choosers.get(event.sender.id);

ipcMain.on("picker:choose", (event, deviceId) => {
  const state = chooserFor(event);
  if (state && typeof deviceId === "string" && state.devices.some((device) => device.id === deviceId)) finishChooser(state, deviceId);
});
ipcMain.on("picker:cancel", (event) => {
  const state = chooserFor(event);
  if (state) finishChooser(state, "");
});
// Speak the language chosen in the app, falling back to the operating system language.
ipcMain.handle("picker:strings", async (event) => {
  const state = chooserFor(event);
  if (!state) return null;
  const chosen = state.owner.window.isDestroyed() ? null
    : await state.owner.window.webContents.executeJavaScript("localStorage.getItem('d3-language')").catch(() => null);
  return pickerStrings(chosen || app.getLocale());
});

// ---- Main window ----
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 380,
    minHeight: 560,
    show: false,
    title: "D3CF",
    backgroundColor: "#08080c",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "icon.png"),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    openExternally(url);
  });
  attachBluetoothChooser(mainWindow);
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.loadURL(`${APP_ORIGIN}/`);
}

if (primaryInstance) {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    serveApp();
    // Some LapTrace firmware asks the OS to confirm pairing; the user already picked the device.
    session.defaultSession.setBluetoothPairingHandler?.((details, callback) => {
      callback({ confirmed: details.pairingKind === "confirm" });
    });
    if (process.platform !== "darwin") Menu.setApplicationMenu(null);
    createWindow();
    app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
