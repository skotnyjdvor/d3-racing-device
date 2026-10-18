import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const { APP_ORIGIN, isAppUrl, isExternalWebUrl, resolveAppFile } = require("../desktop/app/paths.cjs");

const root = resolve("/srv/web");
const files = new Set([join(root, "index.html"), join(root, "assets", "app.js"), join(root, "favicon.svg")]);
const exists = (path) => files.has(path);

test("serves files that exist inside the web root", () => {
  assert.equal(resolveAppFile(root, "/assets/app.js", exists), join(root, "assets", "app.js"));
  assert.equal(resolveAppFile(root, "/favicon.svg", exists), join(root, "favicon.svg"));
  assert.equal(resolveAppFile(root, "/", exists), join(root, "index.html"));
});

test("falls back to index.html for app routes without a file extension", () => {
  assert.equal(resolveAppFile(root, "/features", exists), join(root, "index.html"));
  assert.equal(resolveAppFile(root, "/shop/", exists), join(root, "index.html"));
});

test("returns null for missing files and never leaves the web root", () => {
  assert.equal(resolveAppFile(root, "/assets/missing.js", exists), null);
  assert.equal(resolveAppFile(root, "/../secret.txt", () => true), null);
  assert.equal(resolveAppFile(root, "/%2e%2e/%2e%2e/windows/win.ini", () => true), null);
  assert.equal(resolveAppFile(root, "/assets/..%5c..%5csecret.js", () => true), null);
  assert.equal(resolveAppFile(root, "/%E0%A4%A", exists), null);
});

test("tells the app origin apart from external web links", () => {
  assert.equal(APP_ORIGIN, "app://d3cf");
  assert.equal(isAppUrl("app://d3cf/features"), true);
  assert.equal(isAppUrl("app://other/"), false);
  assert.equal(isAppUrl("https://d3cf.com/"), false);
  assert.equal(isExternalWebUrl("https://d3cf.com/shop"), true);
  assert.equal(isExternalWebUrl("mailto:office@d3cf.com"), true);
  assert.equal(isExternalWebUrl("file:///C:/Windows/system32/calc.exe"), false);
  assert.equal(isExternalWebUrl("javascript:alert(1)"), false);
  assert.equal(isExternalWebUrl("not a url"), false);
});
