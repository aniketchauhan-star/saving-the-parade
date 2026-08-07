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

  test("Play transition stays in-page on touch devices, with no browser fullscreen flash @mobile", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-landscape", "touch-only regression");
    const errs = watchErrors(page);
    await gotoReady(page);

    const fullscreenEvents = [];
    await page.exposeFunction("__recordFullscreenEvent", (isFullscreen) => {
      fullscreenEvents.push(isFullscreen);
    });
    await page.evaluate(() => {
      document.addEventListener("fullscreenchange", () => {
        window.__recordFullscreenEvent(Boolean(document.fullscreenElement));
      });
      document.addEventListener("webkitfullscreenchange", () => {
        window.__recordFullscreenEvent(Boolean(document.webkitFullscreenElement));
      });
    });

    // Watch EVERY frame of the transition for an opaque layer blanketing the
    // viewport. This is the actual QA defect: the old #openCurtain covered the
    // whole screen in flat #0d0834 for ~0.5s (longer the slower the tablet) and
    // then dissolved back to the same title card.
    //
    // Two traps this detector deliberately avoids — the previous version of this
    // test fell into both and passed while the flash was still shipping:
    //   1. It sampled the curtain's state ONCE, 1.4s after the tap. By then it
    //      was already off. Bound the watch by WALL CLOCK, not frame count:
    //      headless rAF is unthrottled, so a 90-frame window can close in ~100ms
    //      — before the click even lands.
    //   2. It trusted elementFromPoint, which skips pointer-events:none layers.
    //      An opaque blanket that ignores pointer events is just as black. So
    //      scan the tree by geometry + paint instead of by hit-testing.
    await page.evaluate((ms) => {
      window.__blankets = [];
      const deadline = performance.now() + ms;
      // A "blanket" = any rendered element spanning (nearly) the whole viewport
      // that paints an opaque colour of its own. `.scene` / `.tap-catcher` span
      // the viewport too, but they are transparent, so they never qualify.
      const isBlanket = (el, cs) => {
        if (Number(cs.opacity) < 0.5) return false;
        if (cs.visibility === "hidden" || cs.display === "none") return false;
        const m = cs.backgroundColor.match(/[\d.]+/g);
        if (!m) return false;
        return (m.length > 3 ? Number(m[3]) : 1) > 0.5;
      };
      (function tick() {
        for (const el of document.body.querySelectorAll("*")) {
          const r = el.getBoundingClientRect();
          if (r.width < innerWidth * 0.95 || r.height < innerHeight * 0.95) continue;
          const cs = getComputedStyle(el);
          if (!isBlanket(el, cs)) continue;
          window.__blankets.push(el.tagName + "." + (el.className || "-") + "#" + (el.id || "-"));
        }
        if (performance.now() < deadline) requestAnimationFrame(tick);
      })();
    }, 3000);

    await page.click("#hint", { force: true });
    await page.waitForSelector("body.is-open", { timeout: 5000 });
    await page.waitForTimeout(1400); // past the old delayed fullscreen-entry window

    const state = await page.evaluate(() => {
      const flipbook = document.getElementById("flipbook");
      return {
        fullscreen: Boolean(document.fullscreenElement || document.webkitFullscreenElement),
        // The curtain element is GONE for good — see the QA note in script.js.
        curtainExists: Boolean(document.getElementById("openCurtain")),
        blankets: [...new Set(window.__blankets)],
        flipbookShown: flipbook.classList.contains("show"),
        firstVideoReady: Boolean(document.querySelector(".leaf video.page-media")),
        touchPoints: navigator.maxTouchPoints || 0,
      };
    });

    expect(state.touchPoints).toBeGreaterThan(0);
    expect(state.fullscreen).toBe(false);
    expect(fullscreenEvents).toEqual([]);
    expect(state.curtainExists).toBe(false);
    // No frame of the title-card → book-open transition may be blanketed.
    expect(state.blankets, "opaque full-viewport layer during the Play transition")
      .toEqual([]);
    expect(state.flipbookShown).toBe(true);
    expect(state.firstVideoReady).toBe(true);
    assertClean(errs);
  });

  test("the cover hinge starts in the SAME frame as the Play tap @mobile", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-landscape", "touch-only regression");
    const errs = watchErrors(page);
    await gotoReady(page);

    // The open used to be deferred two rAFs so a curtain could paint first.
    // Nothing is layered over the tap now, so the hinge must be running by the
    // first frame after it — that immediacy IS the transition.
    const framesUntilOpen = await page.evaluate(async () => {
      let frames = 0;
      const done = new Promise((resolve) => {
        const step = () => {
          if (document.body.classList.contains("is-open")) return resolve(frames);
          if (++frames > 30) return resolve(frames);
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      document.getElementById("hint").click();
      return done;
    });
    expect(framesUntilOpen).toBeLessThanOrEqual(1);
    assertClean(errs);
  });
});
