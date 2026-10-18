"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("picker", {
  strings: () => ipcRenderer.invoke("picker:strings"),
  onDevices: (listener) => ipcRenderer.on("picker:devices", (_event, devices) => listener(devices)),
  choose: (deviceId) => ipcRenderer.send("picker:choose", deviceId),
  cancel: () => ipcRenderer.send("picker:cancel"),
});
