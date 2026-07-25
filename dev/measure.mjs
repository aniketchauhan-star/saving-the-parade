/* Measure boot performance of the flipbook (baseline & final).
   Usage: node measure.mjs <label> [url] */
import { chromium } from "playwright";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const label = process.argv[2] || "baseline";
const url = process.argv[3] || "http://127.0.0.1:8137/index.html";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });

const requests = [];
const failures = [];
const consoleErrors = [];
const t0 = Date.now();
page.on("response", async (res) => {
  const ts = Date.now() - t0;
  let bytes = 0;
  try {
    const sizes = await res.request().sizes();
    bytes = sizes.responseBodySize + sizes.responseHeadersSize;
  } catch {}
  requests.push({ url: res.url(), status: res.status(), bytes, ts });
  if (res.status() >= 400) failures.push({ url: res.url(), status: res.status() });
});
page.on("requestfailed", (req) =>
  failures.push({ url: req.url(), error: req.failure() && req.failure().errorText })
);
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));

await page.goto(url, { waitUntil: "load", timeout: 60000 });

// Time until the Start/Play button is actually usable (visible + enabled).
let startUsableMs = null;
try {
  await page.waitForSelector("#hint:not([disabled])", { state: "visible", timeout: 30000 });
  const probe = await page.evaluate(() => {
    const el = document.getElementById("hint");
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && cs.visibility !== "hidden" && cs.pointerEvents !== "none";
  });
  if (probe) startUsableMs = Date.now() - t0;
} catch {}

// settle: give late requests (posters, preload-auto audio) a moment to land
await page.waitForTimeout(6000);

const timing = await page.evaluate(() => {
  const nav = performance.getEntriesByType("navigation")[0];
  return {
    domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
    load: Math.round(nav.loadEventEnd),
  };
});

const totalBytes = requests.reduce((a, r) => a + (r.bytes || 0), 0);
// The boot window = everything transferred BEFORE the Start button became
// usable (comparable to the baseline's semantics); the rest is Stage-B warm-up.
const bootCut = startUsableMs || timing.load;
const bootReqs = requests.filter((r) => r.ts <= bootCut + 50);
const report = {
  label,
  url,
  when: new Date().toISOString(),
  viewport: "1366x768",
  bootWindow: {
    requests: bootReqs.length,
    transferredBytes: bootReqs.reduce((a, r) => a + (r.bytes || 0), 0),
  },
  settled: {
    requests: requests.length,
    transferredBytes: totalBytes,
  },
  domContentLoadedMs: timing.domContentLoaded,
  windowLoadMs: timing.load,
  startButtonUsableMs: startUsableMs,
  consoleErrors,
  failedRequests: failures,
  requests: requests.map((r) => ({ url: r.url.replace(/^http:\/\/127\.0\.0\.1:8137/, ""), status: r.status, bytes: r.bytes, ts: r.ts })),
};

fs.mkdirSync(new URL("./reports/", import.meta.url), { recursive: true });
fs.writeFileSync(new URL(`./reports/measure-${label}.json`, import.meta.url), JSON.stringify(report, null, 2));
await page.screenshot({ path: fileURLToPath(new URL(`./reports/shot-${label}-cover.png`, import.meta.url)) });

console.log(JSON.stringify({ ...report, requests: undefined }, null, 2));
await browser.close();
