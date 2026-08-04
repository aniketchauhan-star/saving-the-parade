import { test, expect } from "@playwright/test";
import { watchErrors, assertClean, gotoReady, openBook } from "./helpers.mjs";

/* Throttle helper: real CDP network conditions so the loader is observable. */
async function throttle(page, kbps = 600, latencyMs = 40) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: latencyMs,
    downloadThroughput: (kbps * 1024) / 8,
    uploadThroughput: (kbps * 1024) / 8,
  });
  return cdp;
}

test.describe("Stage A loading", () => {
  test("loader bar shows, Start hidden, progress monotonic, pop-in at 100% @mobile", async ({ page }) => {
    const errs = watchErrors(page);
    await throttle(page, 800);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });

    // Themed loader visible on boot; the Start button is hidden during Stage A.
    await expect(page.locator("#bootLoader")).toBeVisible();
    await expect(page.locator("#hint")).toBeHidden();

    // Progress is observable and monotonic (sample until 100%, up to 60s).
    const samples = [];
    for (let i = 0; i < 400; i++) {
      const v = await page.locator("#bootLoader").getAttribute("aria-valuenow");
      samples.push(Number(v));
      if (Number(v) >= 100) break;
      await page.waitForTimeout(150);
    }
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i], `progress sample ${i}`).toBeGreaterThanOrEqual(samples[i - 1]);
    }
    expect(Math.max(...samples)).toBe(100); // Stage A reaches 100%

    // Start button appears with its pop-in animation and works.
    await page.waitForSelector("body.boot-ready", { timeout: 45000 });
    await expect(page.locator("#hint")).toBeVisible();
    const anim = await page
      .locator("#hint")
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(anim).toContain("playPopIn");
    await openBook(page); // the experience starts normally
    assertClean(errs);
  });

  test("smaller shell assets are queued before larger ones", async ({ page }) => {
    const shellFetches = [];
    page.on("request", (r) => {
      if (r.resourceType() === "fetch" && !r.url().includes("asset-manifest")) {
        shellFetches.push(r.url());
      }
    });
    await throttle(page, 1500);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("body.boot-ready", { timeout: 45000 });
    // Queue order is ascending by real byte size: the smallest shell asset must
    // be requested before the largest one (cover-page.webp ~102KB — the LBD
    // poster is LetsPlayBg.webp now, no longer the biggest shell asset).
    const smallest = shellFetches.findIndex((u) => u.includes("posters/2.webp"));
    const largest = shellFetches.findIndex((u) => u.includes("cover-page"));
    expect(smallest).toBeGreaterThanOrEqual(0);
    expect(largest).toBeGreaterThanOrEqual(0);
    expect(smallest).toBeLessThan(largest);
  });

  test("failed shell fetches never block the Start button", async ({ page }) => {
    // Break the LARGEST shell asset (and the cover art) at the network level.
    await page.route("**/GameStartScreen.webp", (r) => r.abort());
    await page.route("**/cover-page.webp", (r) => r.abort());
    await page.goto("/index.html");
    await page.waitForSelector("body.boot-ready", { timeout: 45000 });
    await expect(page.locator("#hint")).toBeVisible();
    // Blob-swapped elements keep a working image (original URL fallback).
    const ok = await page
      .locator("#hint img")
      .evaluate((img) => img.complete && img.naturalWidth > 0);
    expect(ok).toBe(true);
  });

  test("Start gate cannot be bypassed by keyboard or direct calls during Stage A", async ({ page }) => {
    await throttle(page, 300); // slow enough that Stage A is still running
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#bootLoader")).toBeVisible();
    // keyboard, synthetic click and a direct click() call — all while loading
    await page.keyboard.press("Enter");
    await page.keyboard.press(" ");
    await page.evaluate(() => {
      const h = document.getElementById("hint");
      h.click();
      h.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await page.waitForTimeout(500);
    const opened = await page.evaluate(() => document.body.classList.contains("is-open"));
    expect(opened).toBe(false);
    // ...and once ready, the same routes DO work.
    await page.waitForSelector("body.boot-ready", { timeout: 60000 });
    await page.keyboard.press("Enter");
    await expect(page.locator("body.is-open")).toHaveCount(1, { timeout: 5000 });
  });
});
