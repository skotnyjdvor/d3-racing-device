"use strict";
// Renders resources/*.svg into the PNG sources used by @capacitor/assets (Android/iOS) and electron-builder.
// Run with: npx electron scripts/render-icons.cjs
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const resources = path.join(__dirname, "..", "resources");
const jobs = [
  ["icon.svg", "icon-only.png", 1024],
  ["icon-foreground.svg", "icon-foreground.png", 1024],
  ["splash.svg", "splash.png", 2732],
  ["splash.svg", "splash-dark.png", 2732],
];

async function render(window, svgFile, size) {
  const svg = fs.readFileSync(path.join(resources, svgFile)).toString("base64");
  const dataUrl = await window.webContents.executeJavaScript(`(async () => {
    const image = new Image();
    image.src = "data:image/svg+xml;base64,${svg}";
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = ${size};
    canvas.getContext("2d").drawImage(image, 0, 0, ${size}, ${size});
    return canvas.toDataURL("image/png");
  })()`);
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await window.loadURL("data:text/html,<!doctype html><title>icons</title>");
  for (const [source, target, size] of jobs) {
    fs.writeFileSync(path.join(resources, target), await render(window, source, size));
    console.log(`${target} ${size}x${size}`);
  }
  // Solid background layer for the Android adaptive icon.
  const background = await window.webContents.executeJavaScript(`(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1024;
    const context = canvas.getContext("2d");
    context.fillStyle = "#08080c";
    context.fillRect(0, 0, 1024, 1024);
    return canvas.toDataURL("image/png");
  })()`);
  fs.writeFileSync(path.join(resources, "icon-background.png"), Buffer.from(background.split(",")[1], "base64"));
  console.log("icon-background.png 1024x1024");
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
