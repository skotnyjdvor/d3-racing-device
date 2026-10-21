import { readFileSync } from "node:fs";
import { parseRaceBoxCsv } from "../src/domain/csv.js";
import { test, expect } from "./fixtures.js";

// A signed-in pilot with one cloud log and one saved report; the AI endpoints answer with a fixed report.
const points = parseRaceBoxCsv(readFileSync(new URL("../src/fixtures/viterbo-session-2026-07-10.csv", import.meta.url), "utf8"));
const report = (language) => ({
  analysisMode: "single-lap",
  summary: `Summary in ${language}`,
  strengths: [{ title: "Braking", evidence: "Late and firm" }],
  timeLosses: [
    { zoneId: "Z1", phaseType: "braking", driverLocation: "cornerEntry", distancePercent: 22, startPercent: 18, endPercent: 26, observation: "obs1", recommendation: "rec1", hypothesis: "hyp1", confidence: "high" },
    { zoneId: "Z2", phaseType: "exit", driverLocation: "cornerExit", distancePercent: 64, startPercent: 60, endPercent: 69, observation: "obs2", recommendation: "rec2", hypothesis: "hyp2", confidence: "medium" },
  ],
  consistency: { assessment: "Consistent" },
  dataWarnings: [],
});

test.beforeEach(async ({ api, page }) => {
  let history = [{ id: "A0", primary_lap: 2, comparison_lap: 3, language: "en", created_at: "2026-07-11T10:00:00Z", report: { ...report("en"), summary: "Saved report", analysisMode: "compare" } }];
  let count = 0;
  api.on(({ method, path, request }) => {
    if (path === "/api/auth/me") return { user: { id: "u1", email: "pilot@example.com", emailVerified: true } };
    if (path === "/api/logs" && method === "GET") return { logs: [{ id: "L1", title: "Viterbo run", deviceName: "LapTrace", startedAt: points[0].time, endedAt: points.at(-1).time, pointCount: points.length }], nextCursor: null };
    if (path === "/api/logs/L1") return { log: { id: "L1", points } };
    if (path === "/api/logs/L1/ai-analyses") return { analyses: history };
    if (path === "/api/logs/L1/ai-analysis") {
      const body = JSON.parse(request.postData());
      const analysis = { id: `A${++count}`, report: report(body.language) };
      history = [{ id: analysis.id, primary_lap: body.primaryLap, comparison_lap: body.comparisonLap, language: body.language, created_at: "2026-07-12T10:00:00Z", report: analysis.report }, ...history];
      return { analysis, cached: false };
    }
    if (path.endsWith("/follow-up")) return { followUp: { answer: "Brake later", evidence: ["ev1"], dataWarnings: [] } };
    if (method === "DELETE" && path.startsWith("/api/ai-analyses/")) { history = history.filter((item) => item.id !== path.split("/").pop()); return null; }
    return undefined;
  });
  await page.addInitScript(() => { if (!sessionStorage.getItem("e2e-token")) { sessionStorage.setItem("e2e-token", "1"); localStorage.setItem("laptrace-access-token", "token"); } });
  await page.goto("/#ai");
  await expect(page.locator("body")).toHaveClass(/has-session/, { timeout: 20_000 });
});

test("generates a report, opens a recommendation and answers a question", async ({ api, page }) => {
  await expect(page.locator("#aiHistoryCount")).toHaveText("1");
  await page.locator("#analyzeAiButton").click();
  await expect(page.locator("#aiReport")).toBeVisible();
  await expect(page.locator("#aiReport")).toContainText("Summary in en");
  await expect(page.locator("#aiReport [data-ai-index]")).toHaveCount(2);
  await expect(page.locator("#aiHistoryCount")).toHaveText("2");
  expect(api.calls).toContain("POST /api/logs/L1/ai-analysis");

  await page.locator("[data-ai-index='1'] [data-ai-open]").click();
  await expect(page.locator("[data-ai-index='1']")).toHaveClass(/selected/);

  await page.locator("#aiQuestion").fill("Where do I lose time?");
  await page.locator("#askAiButton").click();
  await expect(page.locator("#aiFollowupAnswer")).toBeVisible();
  await expect(page.locator("#aiFollowupAnswer")).toContainText("Brake later");
});

test("opens and deletes a saved report", async ({ page }) => {
  await page.locator("[data-ai-history-open='A0']").click();
  await expect(page.locator("#aiReport")).toBeVisible();
  await expect(page.locator("#aiReport")).toContainText("Saved report");
  await page.locator("[data-ai-history-delete='A0']").click();
  await page.locator("#confirmSubmit").click();
  await expect(page.locator("#aiReport")).toBeHidden();
  await expect(page.locator("#aiHistoryCount")).toHaveText("0");
});

test("signing out locks the app again", async ({ page }) => {
  await page.locator("#logoutButton").dispatchEvent("click");
  await expect(page.locator("body")).toHaveClass(/auth-locked/);
});
