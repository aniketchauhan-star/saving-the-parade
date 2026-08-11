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

  test("a cleared page stays cleared on revisit (no second viewing)", async ({ page }) => {
    await gotoReady(page);
    await openBook(page);
    await finishCurrentVideo(page);
    await nextPage(page); // now on page 2 (gated: not seen yet)
    await expect(page.locator("#cornerNext")).toBeDisabled();
    await finishCurrentVideo(page);
    await expect(page.locator("#cornerNext")).toBeEnabled({ timeout: 10000 });

    // go BACK to page 1 → already watched, so Next is there IMMEDIATELY (the
    // reader must never have to sit through the clip a second time).
    await page.click("#cornerPrev");
    await page.waitForFunction(() => document.querySelectorAll(".leaf.flipped").length === 0);
    await page.waitForTimeout(1400);
    await expect(page.locator("#cornerNext")).toBeVisible();
    await expect(page.locator("#cornerNext")).toBeEnabled();

    // forward again → page 2 is also still cleared, and Back is available there.
    await nextPage(page);
    await expect(page.locator("#cornerNext")).toBeVisible();
    await expect(page.locator("#cornerNext")).toBeEnabled();
    await expect(page.locator("#cornerPrev")).toBeVisible();
    await expect(page.locator("#cornerPrev")).toBeEnabled();
  });

  test("a revisited page REPLAYS its video from the start, never from where it was paused", async ({ page }) => {
    // Leaving a page only pauses its clip (the sheet flips away on that frame),
    // so coming back must rewind it — otherwise the reader lands mid-scene.
    const timeOf = (i) =>
      page.evaluate((n) => {
        const v = document.querySelectorAll(".leaf")[n].querySelector("video.page-media");
        return { t: v.currentTime, paused: v.paused };
      }, i);

    await gotoReady(page);
    await openBook(page);
    await finishCurrentVideo(page);
    await nextPage(page);                       // page 2, playing from 0

    // Watch a slice of page 2, then leave it MID-CLIP (Back is never gated).
    await page.waitForTimeout(4000);
    const watched = await timeOf(1);
    expect(watched.t, "page 2 should really be playing before we leave").toBeGreaterThan(3);

    await page.click("#cornerPrev");
    await page.waitForFunction(() => document.querySelectorAll(".leaf.flipped").length === 0);
    await page.waitForTimeout(1400);

    // Page 1 was watched to the end earlier — it too starts over, not on its last frame.
    const back = await timeOf(0);
    expect(back.paused, "the revisited page's video plays").toBe(false);
    expect(back.t, "page 1 restarts from the beginning").toBeLessThan(2.5);

    // Forward again → page 2 restarts, it does NOT resume at ~4s.
    await nextPage(page);
    const again = await timeOf(1);
    expect(again.paused).toBe(false);
    expect(again.t, "page 2 restarts instead of resuming").toBeLessThan(watched.t - 1);
    expect(again.t).toBeLessThan(2.5);
  });

  test("the revealed Next arrow glow-pulses once, then returns to normal", async ({ page }) => {
    await gotoReady(page);
    await openBook(page);

    const probe = () =>
      page.locator("#cornerNext").evaluate((el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          pulsing: el.classList.contains("glow-pulse"),
          anim: cs.animationName,
          shadows: (cs.filter.match(/drop-shadow/g) || []).length,
          box: [Math.round(r.width), Math.round(r.height)],
        };
      });

    await finishCurrentVideo(page);
    await expect(page.locator("#cornerNext")).toBeVisible({ timeout: 10000 });

    // The cue must really be RUNNING, not just class-toggled: the .is-visible
    // reveal rule also owns `animation`, so an under-specific pulse rule would be
    // silently dropped by the cascade and nothing would ever animate.
    await page.waitForTimeout(500); // past the 400ms reveal, into the first pulse
    const during = await probe();
    expect(during.pulsing).toBe(true);
    expect(during.anim, "the glow pulse must win the cascade").toContain("arrowGlowPulse");
    expect(during.shadows, "the halo blooms with extra drop-shadows").toBeGreaterThan(2);

    // Purely a paint effect: pulsing must never resize the fixed corner control.
    await page.waitForTimeout(330); // opposite phase of the 660ms cycle
    expect((await probe()).box).toEqual(during.box);

    // …and it ends by itself, leaving the arrow in its normal state.
    await page.waitForTimeout(1700);
    const after = await probe();
    expect(after.pulsing).toBe(false);
    expect(after.anim).not.toContain("arrowGlowPulse");
    expect(after.shadows).toBe(2);
    await expect(page.locator("#cornerNext")).toBeEnabled();
  });

  test("broken video releases the gate via error/watchdog; Back stays usable", async ({ page }) => {
    const errs = watchErrors(page);
    // Deliberately break page 2's video source (controlled test).
    await page.route("**/assets/2.webm", (r) => r.abort());
    await gotoReady(page);
    await openBook(page);
    await finishCurrentVideo(page);
    await nextPage(page); // arrive on the broken-video page

    // Back immediately usable.
    await expect(page.locator("#cornerPrev")).toBeEnabled();

    // The error (or watchdog) path must unlock Next without a working video.
    await expect(page.locator("#cornerNext")).toBeEnabled({ timeout: 35000 });
    // the abort we caused is expected (resource-load console noise included)
    assertClean(errs, { allow: ["2.webm", "Failed to load resource"] });
  });
});
