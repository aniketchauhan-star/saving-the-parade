import { test, expect } from "@playwright/test";
import {
  watchErrors,
  assertClean,
  gotoReady,
  openBook,
  flippedCount,
  finishCurrentVideo,
  nextPage,
} from "./helpers.mjs";

async function expectNoForwardMovement(page, idx) {
  // Try EVERY forward route while gated: button, keyboard, swipe, page-corner drag.
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  const art = await page.locator(".flip-scale").boundingBox();
  // swipe / corner drag (pointer sequence across the page, right → left)
  await page.mouse.move(art.x + art.width - 30, art.y + art.height - 40);
  await page.mouse.down();
  await page.mouse.move(art.x + art.width / 2, art.y + art.height / 2, { steps: 8 });
  await page.mouse.move(art.x + 40, art.y + art.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(1400);
  expect(await flippedCount(page), "no forward route may bypass the gate").toBe(idx);
}

test.describe("universal video gating", () => {
  test("first page: Back absent, Next hidden until video completes; then exactly one page per tap", async ({ page }) => {
    const errs = watchErrors(page);
    await gotoReady(page);
    await openBook(page);

    // Back button entirely absent on the first story page.
    const prevDisplay = await page
      .locator("#cornerPrev")
      .evaluate((el) => getComputedStyle(el).display);
    expect(prevDisplay).toBe("none");
    // Next arrow completely hidden when the page first opens.
    const nextDisplay = await page
      .locator("#cornerNext")
      .evaluate((el) => getComputedStyle(el).display);
    expect(nextDisplay).toBe("none");

    // While the video plays, no forward route works.
    await expectNoForwardMovement(page, 0);
    // Home remains usable during the video (visible + enabled).
    await expect(page.locator("#homeBtn")).toBeVisible();
    await expect(page.locator("#homeBtn")).toBeEnabled();

    // Completing the video (real `ended`) reveals Next (interaction half of the
    // dual gate is auto-complete: page 1 configures no required interaction).
    await finishCurrentVideo(page);
    await expect(page.locator("#cornerNext")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#cornerNext")).toBeEnabled();

    // Rapid double-click turns exactly ONE page (nav locked during transition).
    await page.locator("#cornerNext").click({ clickCount: 2, delay: 60 });
    await page.waitForTimeout(2600);
    expect(await flippedCount(page)).toBe(1);
    assertClean(errs);
  });

  test("gate re-arms on revisit (backwards then forwards)", async ({ page }) => {
    await gotoReady(page);
    await openBook(page);
    await finishCurrentVideo(page);
    await nextPage(page); // now on page 2 (gated again)
    await expect(page.locator("#cornerNext")).toBeDisabled();
    await finishCurrentVideo(page);
    await expect(page.locator("#cornerNext")).toBeEnabled({ timeout: 10000 });

    // go BACK to page 1 → its dual gate must re-arm (Next hidden again)…
    await page.click("#cornerPrev");
    await page.waitForFunction(() => document.querySelectorAll(".leaf.flipped").length === 0);
    await page.waitForTimeout(1400);
    await expect(page.locator("#cornerNext")).toBeHidden();
    // …and re-release after the replayed video ends.
    await finishCurrentVideo(page);
    await expect(page.locator("#cornerNext")).toBeVisible({ timeout: 10000 });
  });

  test("broken video releases the gate via error/watchdog; Back and Home stay usable", async ({ page }) => {
    const errs = watchErrors(page);
    // Deliberately break page 2's video source (controlled test).
    await page.route("**/assets/2.webm", (r) => r.abort());
    await gotoReady(page);
    await openBook(page);
    await finishCurrentVideo(page);
    await nextPage(page); // arrive on the broken-video page

    // Back + Home immediately usable.
    await expect(page.locator("#cornerPrev")).toBeEnabled();
    await expect(page.locator("#homeBtn")).toBeEnabled();

    // The error (or watchdog) path must unlock Next without a working video.
    await expect(page.locator("#cornerNext")).toBeEnabled({ timeout: 35000 });
    // the abort we caused is expected (resource-load console noise included)
    assertClean(errs, { allow: ["2.webm", "Failed to load resource"] });
  });
});
