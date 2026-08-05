/* Capture the frames right after the Play tap (tablet-ish touch viewport) to
   check the title-card → book-open transition for the QA "black flash". */
import { chromium } from "playwright";

const OUT = process.argv[2] || "/tmp";
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  hasTouch: true,
  isMobile: true,
});
const page = await ctx.newPage();
await page.goto("http://127.0.0.1:8137/index.html");
await page.waitForSelector("body.boot-ready", { timeout: 60000 });
await page.waitForTimeout(500);

const events = [];
await page.exposeFunction("__mark", (name) => events.push({ name, t: Date.now() }));
await page.evaluate(() => {
  window.__mark("armed");
  document.addEventListener("fullscreenchange", () =>
    window.__mark(document.fullscreenElement ? "fullscreen-on" : "fullscreen-off"));
  const mo = new MutationObserver(() => {
    if (document.body.classList.contains("is-open")) { window.__mark("book-open"); mo.disconnect(); }
  });
  mo.observe(document.body, { attributes: true, attributeFilter: ["class"] });
});

const t0 = Date.now();
await page.tap("#hint", { force: true });
for (const ms of [100, 300, 600, 900, 1300]) {
  const wait = t0 + ms - Date.now();
  if (wait > 0) await page.waitForTimeout(wait);
  await page.screenshot({ path: `${OUT}/open-${ms}ms.png` });
}
await page.waitForTimeout(500);
console.log("events:", events.map((e) => `${e.name}@${e.t - t0}ms`).join("  "));
await browser.close();
