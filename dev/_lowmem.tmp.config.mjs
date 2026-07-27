/* TEMPORARY verification-only config — delete after use.
   Same as playwright.config.mjs but launches the lightweight headless-shell with
   a single renderer, because this machine is at its Windows commit limit and
   full headless Chrome cannot start. */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 240000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:8137",
    screenshot: "off",
    trace: "off",
    video: "off",
    channel: "chromium-headless-shell",
    launchOptions: {
      args: [
        "--renderer-process-limit=1",
        "--disable-gpu",
        "--js-flags=--max-old-space-size=256",
      ],
    },
  },
  outputDir: "./test-results",
  webServer: {
    command: 'node server.mjs "" 8137',
    url: "http://127.0.0.1:8137/index.html",
    reuseExistingServer: true,
  },
  projects: [
    { name: "desktop-1366", use: { viewport: { width: 1366, height: 768 } } },
    {
      name: "mobile-landscape",
      use: { viewport: { width: 844, height: 390 }, hasTouch: true },
      grep: /@mobile/,
    },
  ],
});
