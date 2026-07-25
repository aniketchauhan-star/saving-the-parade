import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 180000,
  retries: 0,
  workers: 1, // timing-sensitive suite sharing one static server
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["json", { outputFile: "reports/playwright-results.json" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:8137",
    screenshot: "only-on-failure",
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
