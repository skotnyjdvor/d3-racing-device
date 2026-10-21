import { test, expect } from "./fixtures.js";

test("simulated LapTrace: connect, download, erase, disconnect", async ({ api, page }) => {
  void api;
  await page.goto("/?mock=1#device");
  await page.locator("#connectButton").click();
  await expect(page.locator("#deviceStatus")).toContainText("ready");
  await expect(page.locator("#downloadButton")).toBeEnabled();
  await expect(page.locator("#satellites")).toContainText("17");

  await page.locator("#downloadButton").click();
  await expect(page.locator("body")).toHaveClass(/has-session/, { timeout: 20_000 });
  await expect(page.locator("#trackTitle")).toContainText("Circuito Internazionale Viterbo");

  await page.locator("#eraseButton").click();
  await page.locator("#confirmSubmit").click();
  await expect(page.locator("#storedMessages")).toHaveText("0");

  await page.locator("#connectButton").click();
  await expect(page.locator("#deviceStatus")).toContainText("disconnected");
});
