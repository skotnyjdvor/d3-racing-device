import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PUBLIC_PAGES, renderPublicPage } from "../server/pages.mjs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("public pages get their own title, description, canonical and preview tags", () => {
  for (const [path, page] of Object.entries(PUBLIC_PAGES)) {
    const rendered = renderPublicPage(html, path);
    assert.ok(rendered.includes(`<title>${page.title}</title>`), path);
    assert.ok(rendered.includes(`<link rel="canonical" href="https://d3cf.com${path}" />`), path);
    assert.ok(rendered.includes(`<meta property="og:url" content="https://d3cf.com${path}" />`), path);
    assert.ok(rendered.includes(`<meta name="description" content="${page.description}" />`), path);
    assert.ok(rendered.includes(`<meta name="twitter:title" content="${page.title}" />`), path);
    assert.equal(rendered.length > html.length / 2, true);
  }
});

test("unknown paths are not rendered as public pages", () => {
  assert.equal(renderPublicPage(html, "/admin"), null);
  assert.equal(renderPublicPage(html, "/"), null);
});

test("the sitemap lists every public page", () => {
  const sitemap = readFileSync(new URL("../public/sitemap.xml", import.meta.url), "utf8");
  for (const path of ["", ...Object.keys(PUBLIC_PAGES)]) assert.ok(sitemap.includes(`<loc>https://d3cf.com${path || "/"}</loc>`), path);
});
