import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const plistPath = resolve("ios/App/App/Info.plist");
let plist;
try {
  plist = await readFile(plistPath, "utf8");
} catch {
  throw new Error("iOS project is missing. Run npm run ios:add on a Mac first.");
}

if (!plist.includes("NSBluetoothAlwaysUsageDescription")) {
  const permission = [
    "\t<key>NSBluetoothAlwaysUsageDescription</key>",
    "\t<string>LapTrace uses Bluetooth to connect to the telemetry logger and download recorded sessions.</string>",
  ].join("\n");
  plist = plist.replace("</dict>", `${permission}\n</dict>`);
  await writeFile(plistPath, plist, "utf8");
  console.log("Added the iOS Bluetooth permission description.");
} else {
  console.log("The iOS Bluetooth permission is already configured.");
}
