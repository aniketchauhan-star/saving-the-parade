import { test, expect } from "@playwright/test";
import {
  watchErrors,
  assertClean,
  gotoReady,
  openBook,
  flippedCount,
  finishCurrentVideo,
  nextPage,
  completeLbdAndAdvance,
} from "./helpers.mjs";

/* Full flipbook crawl: every page, forward then back, with per-page checks. */
test("crawl every page: no errors, media healthy, gates release, nav state correct", async ({ page }, testInfo) => {
  const errs = watchErrors(page);
  await gotoReady(page);
  await openBook(page);

  const TOTAL = 6; // 5 story/game pages + THE END
  for (let idx = 0; idx < TOTAL; idx++) {
    expect(await flippedCount(page)).toBe(idx);

    // Every VISIBLE image on the current leaf is decoded and complete.
    const badImgs = await page.evaluate(() => {
      const i = document.querySelectorAll(".leaf.flipped").length;
      const leaf = document.querySelectorAll(".leaf")[i];
      return Array.from(leaf ? leaf.querySelectorAll("img") : [])
        .filter((im) => !(im.complete && im.naturalWidth > 0))
        .map((im) => im.src);
    });
    expect(badImgs, `page ${idx + 1} images`).toEqual([]);

    // Page video (when present): poster attached, element not in error state.
    const vidState = await page.evaluate(() => {
      const i = document.querySelectorAll(".leaf.flipped").length;
      const leaf = document.querySelectorAll(".leaf")[i];
      const v = leaf && leaf.querySelector("video.page-media");
      if (!v) return null;
      return { error: !!v.error, poster: v.getAttribute("poster") || "" };
    });
    if (vidState) {
      expect(vidState.error, `page ${idx + 1} video error state`).toBe(false);
      expect(vidState.poster).toMatch(/posters\/\d\.webp$/);
    }

    // Navigation state for this page.
    const isFirst = idx === 0;
    const isLast = idx === TOTAL - 1;
    if (isFirst) {
      await expect(page.locator("#cornerPrev")).toBeHidden(); // fully hidden, not faded
    } else {
      await expect(page.locator("#cornerPrev")).toBeVisible();
      await expect(page.locator("#cornerPrev")).toBeEnabled();
    }
    if (isLast) {
      // THE END: forward arrow visible but disabled; Replay owns the page.
      await expect(page.locator("#cornerNext")).toBeDisabled();
      await expect(page.locator(".replay-btn")).toBeVisible();
    }
    // There is no Home button any more — the chrome is the two corner arrows only.
    expect(await page.locator("#homeBtn").count(), "Home button must not exist").toBe(0);

    await page.screenshot({ path: testInfo.outputPath(`crawl-page-${idx + 1}.png`) });

    if (isLast) break;

    // The GAME page: the Next arrow never appears — completing the game is the
    // only route on, and it hands over to the overlay's own Next button.
    const onGame = await page
      .locator("#lbdStage")
      .evaluate((el) => el.classList.contains("visible"));
    if (onGame) {
      await expect(page.locator("#cornerNext")).toBeHidden();
      await expect(page.locator("#cornerNext")).toBeDisabled();
      await completeLbdAndAdvance(page);
      continue;
    }

    // Move forward: on video pages the Next arrow is fully HIDDEN until the
    // clip's real `ended` event unlocks the gate; then it pops in enabled.
    if (vidState) {
      await expect(page.locator("#cornerNext")).toBeHidden();
      await expect(page.locator("#cornerNext")).toBeDisabled();
      await finishCurrentVideo(page);
    }
    await expect(page.locator("#cornerNext")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#cornerNext")).toBeEnabled({ timeout: 10000 });
    await nextPage(page);
  }

  // Walk all the way BACK (gates must not trap backward navigation).
  for (let idx = TOTAL - 1; idx > 0; idx--) {
    await page.click("#cornerPrev");
    await page.waitForFunction(
      (n) => document.querySelectorAll(".leaf.flipped").length === n - 1,
      idx,
      { timeout: 8000 }
    );
    await page.waitForTimeout(1350);
  }
  expect(await flippedCount(page)).toBe(0);

  assertClean(errs);
});
