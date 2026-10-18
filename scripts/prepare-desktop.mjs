// Copies the web build and the app icon into the desktop app folder before running or packaging Electron.
import { cp, mkdir, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";

const dist = resolve("dist");
const target = resolve("desktop/app/web");
try {
  await stat(resolve(dist, "index.html"));
} catch {
  throw new Error("dist/index.html is missing. Run npm run build first.");
}
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(dist, target, { recursive: true });
await cp(resolve("resources/icon-only.png"), resolve("desktop/app/icon.png"));
console.log("Desktop app prepared: desktop/app/web");
