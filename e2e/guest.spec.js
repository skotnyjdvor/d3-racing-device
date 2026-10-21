import { fileURLToPath } from "node:url";
import { test, expect } from "./fixtures.js";

const csv = fileURLToPath(new URL("../tests/fixtures/session.csv", import.meta.url));

test("guest trial: a CSV opens without an account and can be closed", async ({ api, page }) => {
  void api;
  await page.goto("/");
  await expect(page.locator("body")).toHaveClass(/auth-locked/);
  await page.locator("#trialInput").setInputFiles(csv);
  await expect(page.locator("body")).toHaveClass(/has-session/);
  await expect(page.locator("body")).not.toHaveClass(/auth-locked/);
  await expect(page.locator("#trialBanner")).toBeVisible();

  await page.locator("#trialExitButton").click();
  await expect(page.locator("body")).toHaveClass(/auth-locked/);
  await expect(page.locator("body")).toHaveClass(/no-session/);
});

test("account dialog switches between sign in, register and recovery", async ({ api, page }) => {
  void api;
  await page.goto("/");
  await page.locator("#accountButton").click();
  await expect(page.locator("#accountDialogTitle")).toHaveText("Sign in to D3CF");
  await page.locator("#accountRegisterTab").click();
  await expect(page.locator("#accountDialogTitle")).toHaveText("Create an account");
  await page.locator("#accountSignInTab").click();
  await page.locator("#accountForgotButton").click();
  await expect(page.locator("#accountDialogTitle")).toHaveText("Recover access");
  await page.locator("#accountClose").click();
  await expect(page.locator("#accountDialog")).not.toBeVisible();
});

test("public pages render", async ({ api, page }) => {
  void api;
  await page.goto("/features");
  await expect(page.locator("body")).toHaveClass(/guest-features/);
  await page.goto("/shop");
  await expect(page.locator("body")).toHaveClass(/view-shop/);
});
