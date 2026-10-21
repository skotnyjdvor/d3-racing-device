import { test as base, expect } from "@playwright/test";

// Every page starts in English with the API mocked: unknown endpoints answer {} and page errors fail the test.
export const test = base.extend({
  api: async ({ page }, use) => {
    const handlers = [];
    const calls = [];
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      calls.push(`${request.method()} ${url.pathname}`);
      for (const handler of handlers) {
        const body = await handler({ method: request.method(), path: url.pathname, request });
        if (body !== undefined) {
          return body === null ? route.fulfill({ status: 204 }) : route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
        }
      }
      return route.fulfill({ contentType: "application/json", body: "{}" });
    });
    await use({ on: (handler) => handlers.push(handler), calls });
  },
  page: async ({ page }, use) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.addInitScript(() => {
      if (sessionStorage.getItem("e2e-ready")) return;
      sessionStorage.setItem("e2e-ready", "1");
      localStorage.setItem("d3-language", "en");
    });
    await use(page);
    expect(errors, "page errors").toEqual([]);
  },
});

export { expect };
