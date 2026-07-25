import { expect } from "@playwright/test";

/* Collect console errors + failed/4xx+ responses for a page. Call early. */
export function watchErrors(page) {
  const state = { consoleErrors: [], badResponses: [], requestFailures: [] };
  page.on("console", (m) => {
    if (m.type() === "error") state.consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => state.consoleErrors.push("pageerror: " + e.message));
  page.on("response", (r) => {
    if (r.status() >= 400) state.badResponses.push(`${r.status()} ${r.url()}`);
  });
  page.on("requestfailed", (r) => {
    const err = (r.failure() && r.failure().errorText) || "";
    // aborts we cause ourselves (route interception) are not real failures
    if (!/ERR_ABORTED|ERR_BLOCKED_BY_CLIENT/.test(err)) {
      state.requestFailures.push(`${err} ${r.url()}`);
    }
  });
  return state;
}

export function assertClean(state, { allow = [] } = {}) {
  const filt = (arr) => arr.filter((t) => !allow.some((a) => t.includes(a)));
  expect(filt(state.consoleErrors), "console errors").toEqual([]);
  expect(filt(state.badResponses), "4xx/5xx responses").toEqual([]);
  expect(filt(state.requestFailures), "failed requests").toEqual([]);
}

/* Load the flipbook and wait until Stage A revealed the Start button. */
export async function gotoReady(page) {
  await page.goto("/index.html");
  await page.waitForSelector("body.boot-ready", { timeout: 45000 });
  await expect(page.locator("#hint")).toBeVisible();
}

/* Open the book (Start tap) and wait for the cover-open to finish (~6s):
   the engine hands pointer-events to the flipbook and marks itself ready.
   force: the Start button "breathes" (infinite scale animation), so Playwright's
   stability check would never pass — a real reader taps it mid-breath anyway. */
export async function openBook(page) {
  await page.click("#hint", { force: true });
  await page.waitForFunction(
    () => {
      const tc = document.getElementById("tapCatcher");
      return tc && tc.style.pointerEvents === "none";
    },
    { timeout: 15000 }
  );
}

/* The currently shown page index == number of flipped leaves. */
export function flippedCount(page) {
  return page.evaluate(() => document.querySelectorAll(".leaf.flipped").length);
}

/* The current page's <video>, if any (queried through the leaf DOM — engine
   state lives in module scope, not on window). */
export async function currentVideoHandle(page) {
  return page.evaluateHandle(() => {
    const leaves = Array.from(document.querySelectorAll(".leaf"));
    const idx = document.querySelectorAll(".leaf.flipped").length;
    const leaf = leaves[idx];
    return leaf ? leaf.querySelector("video.page-media") : null;
  });
}

/* Fast-forward the current page's video to its final moments so `ended` fires
   quickly (tests cannot wait out 20-40s clips). Waits for metadata first. */
export async function finishCurrentVideo(page) {
  await page.waitForFunction(
    () => {
      const idx = document.querySelectorAll(".leaf.flipped").length;
      const leaf = document.querySelectorAll(".leaf")[idx];
      const v = leaf && leaf.querySelector("video.page-media");
      return v && isFinite(v.duration) && v.duration > 0;
    },
    { timeout: 20000 }
  );
  await page.evaluate(() => {
    const idx = document.querySelectorAll(".leaf.flipped").length;
    const leaf = document.querySelectorAll(".leaf")[idx];
    const v = leaf.querySelector("video.page-media");
    v.muted = true;
    v.currentTime = Math.max(0, v.duration - 0.3);
    v.play().catch(() => {});
  });
  await page.waitForFunction(
    () => {
      const idx = document.querySelectorAll(".leaf.flipped").length;
      const leaf = document.querySelectorAll(".leaf")[idx];
      const v = leaf && leaf.querySelector("video.page-media");
      return v && v.ended;
    },
    { timeout: 20000 }
  );
}

/* Advance one page via the (now unlocked) forward arrow and wait for settle. */
export async function nextPage(page) {
  const before = await flippedCount(page);
  await page.click("#cornerNext");
  await page.waitForFunction(
    (n) => document.querySelectorAll(".leaf.flipped").length === n + 1,
    before,
    { timeout: 8000 }
  );
  await page.waitForTimeout(1400); // flip transition + settle callbacks
}

/* Complete a video page (finish clip -> Next unlock -> turn). */
export async function completeVideoPageAndAdvance(page) {
  await finishCurrentVideo(page);
  await expect(page.locator("#cornerNext")).toBeEnabled({ timeout: 10000 });
  await nextPage(page);
}

/* Walk forward from page 0 to the LBD page (index 3). */
export async function goToLbdPage(page) {
  for (let i = 0; i < 3; i++) await completeVideoPageAndAdvance(page);
  expect(await flippedCount(page)).toBe(3);
  await expect(page.locator("#lbdStage")).toHaveClass(/visible/, { timeout: 10000 });
}
