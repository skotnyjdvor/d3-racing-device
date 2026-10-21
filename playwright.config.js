import { defineConfig, devices } from "@playwright/test";

// Browser smoke tests against the production build (`vite preview`), so the cloud code paths are active.
// The API is mocked per test with page.route; ?mock=1 swaps Bluetooth for the simulated LapTrace.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: "http://127.0.0.1:4174",
    viewport: { width: 1400, height: 1000 },
    trace: "retain-on-failure",
  },
  projects: [{
    name: "chromium",
    use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 1000 }, launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined } },
  }],
  webServer: {
    command: "npm run build && npx vite preview --host 127.0.0.1 --port 4174 --strictPort",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
