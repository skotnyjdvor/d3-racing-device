import { test, expect } from "./fixtures.js";

test.beforeEach(async ({ api, page }) => {
  void api;
  await page.goto("/?mock=1#analysis");
  await page.locator("#onboardDemoButton").click();
  await expect(page.locator("body")).toHaveClass(/has-session/);
});

test("demo session opens with laps, sectors and a track", async ({ page }) => {
  await expect(page.locator("#trackTitle")).toContainText("Circuito Internazionale Viterbo");
  expect(await page.locator("#primaryLapSelect option").count()).toBeGreaterThan(2);
  await expect(page.locator("#sectorTable [data-sector-lap]").first()).toBeVisible();
  await expect(page.locator("#idealLapValue")).not.toHaveText("—");
});

test("changing laps updates the title, the gap and the sector table", async ({ page }) => {
  const select = page.locator("#primaryLapSelect");
  const target = await select.locator("option").nth(2).getAttribute("value");
  await select.selectOption(target);
  await expect(page.locator("#trackTitle")).toContainText(`Lap ${target}`);
  await expect(page.locator(`#sectorTable [data-sector-lap="${target}"]`)).toHaveClass(/is-primary/);
  await expect(page.locator("#trackStatGap")).toContainText("Δ");

  await page.keyboard.press("BracketRight");
  await expect(page.locator("#trackTitle")).not.toContainText(`Lap ${target}`);
});

test("chart zoom and map modes respond", async ({ page }) => {
  const canvas = page.locator("#telemetryCanvas");
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
  await page.mouse.wheel(0, -300);
  await expect(page.locator("#chartZoomReset")).not.toHaveText("100%");
  await page.locator("#chartZoomReset").click();
  await expect(page.locator("#chartZoomReset")).toHaveText("100%");

  await page.locator("[data-map-mode='speed']").click();
  await expect(page.locator("[data-map-mode='speed']")).toHaveAttribute("aria-checked", "true");
});

test("logs and AI views list the session; language switch translates the page", async ({ page }) => {
  await page.locator("#logsNavButton").click();
  await expect(page.locator("body")).toHaveClass(/view-logs/);
  await expect(page.locator("#sessionList .session-item")).toHaveCount(1);

  await page.locator("#aiNavButton").click();
  await expect(page.locator("body")).toHaveClass(/view-ai/);
  await expect(page.locator("#aiSessionSelect")).toHaveValue("demo-viterbo");

  await page.locator("#langMenuToggle").click();
  await page.locator("[data-lang='it']").click();
  await expect(page.locator("#langMenuCurrent")).toHaveText("IT");
  await expect(page.locator("html")).toHaveAttribute("lang", "it");
});
