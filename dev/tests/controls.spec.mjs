import { test, expect } from "@playwright/test";
import {
  watchErrors,
  assertClean,
  gotoReady,
  openBook,
  finishCurrentVideo,
  nextPage,
} from "./helpers.mjs";

test.describe("navigation controls", () => {
  test("hidden on cover; sizes/positions per spec; Back mirrored; no artwork overlap @mobile", async ({ page }) => {
    const errs = watchErrors(page);
    await gotoReady(page);

    // Controls do not appear on the cover / start screen.
    await expect(page.locator("#cornerPrev")).toBeHidden();
    await expect(page.locator("#cornerNext")).toBeHidden();
    await expect(page.locator("#homeBtn")).toBeHidden();

    await openBook(page);

    // Page 1: Back is fully ABSENT; Next hidden until the video gate opens.
    await expect(page.locator("#cornerPrev")).toBeHidden();
    await expect(page.locator("#cornerNext")).toBeHidden();
    await expect(page.locator("#homeBtn")).toBeVisible();

    await finishCurrentVideo(page);
    await expect(page.locator("#cornerNext")).toBeVisible({ timeout: 10000 });
    await nextPage(page); // page 2 → Back appears; Next hidden until this video ends too
    await expect(page.locator("#cornerNext")).toBeHidden();
    await finishCurrentVideo(page); // unlock so BOTH arrows are measurable
    await expect(page.locator("#cornerNext")).toBeVisible({ timeout: 10000 });
    await page.mouse.move(400, 20); // park the cursor away — :hover scale would skew the boxes
    await page.waitForTimeout(650); // let the 400ms reveal pop settle before measuring

    const vw = page.viewportSize().width;
    const box = (sel) => page.locator(sel).boundingBox();
    const next = await box("#cornerNext");
    const prev = await box("#cornerPrev");
    const home = await box("#homeBtn");

    // Responsive size: clamp(84px, 10vw, 124px)
    const expected = Math.min(124, Math.max(84, vw * 0.10));
    for (const b of [next, prev, home]) {
      expect(Math.abs(b.width - expected)).toBeLessThan(2);
      expect(Math.abs(b.height - expected)).toBeLessThan(2);
    }

    // Back mirrored via the INNER element so hover scaling can't overwrite it.
    const mirror = await page
      .locator("#cornerPrev svg")
      .evaluate((el) => getComputedStyle(el).transform);
    expect(mirror).toContain("-1"); // matrix(-1, 0, 0, 1, ...)

    // Hover / active transforms on the buttons themselves.
    await page.hover("#cornerNext");
    await page.waitForTimeout(250);
    const hoverT = await page
      .locator("#cornerNext")
      .evaluate((el) => getComputedStyle(el).transform);
    expect(hoverT).not.toBe("none"); // scale(1.12)

    // Glyphs must not overlap the book artwork; Home fully in the top margin.
    const art = await box(".flip-scale");
    const nextGlyph = await box("#cornerNext svg");
    const prevGlyph = await box("#cornerPrev svg");
    const homeGlyph = await box("#homeBtn svg");
    expect(prevGlyph.x + prevGlyph.width).toBeLessThanOrEqual(art.x + 1);
    expect(nextGlyph.x).toBeGreaterThanOrEqual(art.x + art.width - 1);
    expect(homeGlyph.x).toBeGreaterThanOrEqual(art.x + art.width - 1); // right margin

    assertClean(errs);
  });

  test("disabled styling and focus outlines", async ({ page }) => {
    await gotoReady(page);
    await openBook(page);
    await finishCurrentVideo(page);
    await nextPage(page); // page 2: video gate re-locks Next

    // While the page-2 video plays, the Next arrow is not there at all —
    // fully hidden (display:none), disabled and aria-hidden, until `ended`.
    await expect(page.locator("#cornerNext")).toBeHidden();
    const dis = await page.locator("#cornerNext").evaluate((el) => ({
      disabled: el.disabled,
      display: getComputedStyle(el).display,
      ariaDisabled: el.getAttribute("aria-disabled"),
      ariaHidden: el.getAttribute("aria-hidden"),
    }));
    expect(dis.disabled).toBe(true);
    expect(dis.display).toBe("none");
    expect(dis.ariaDisabled).toBe("true");
    expect(dis.ariaHidden).toBe("true");

    // The disabled STYLING (0.22 + no pointer events) shows on THE END page,
    // where the arrow is visible but permanently disabled (Replay owns it).
    // Walk there: finish each remaining video page, cross the LBD page.
    for (let i = 0; i < 2; i++) {
      await finishCurrentVideo(page);
      await nextPage(page); // -> page 3, then the LBD page
    }
    await nextPage(page); // LBD page is ungated -> page 5 (video)
    await finishCurrentVideo(page);
    await nextPage(page); // -> THE END
    const end = await page.locator("#cornerNext").evaluate((el) => ({
      disabled: el.disabled,
      opacity: getComputedStyle(el).opacity,
      pe: getComputedStyle(el).pointerEvents,
      ariaDisabled: el.getAttribute("aria-disabled"),
    }));
    expect(end.disabled).toBe(true);
    expect(Number(end.opacity)).toBeCloseTo(0.22, 1);
    expect(end.pe).toBe("none");
    expect(end.ariaDisabled).toBe("true");

    // Buttons stay real <button> elements (keyboard-operable) with no focus ring.
    const focus = await page.locator("#cornerPrev").evaluate((el) => {
      el.focus();
      const cs = getComputedStyle(el);
      return { tag: el.tagName, outline: cs.outlineStyle, label: el.getAttribute("aria-label") };
    });
    expect(focus.tag).toBe("BUTTON");
    expect(focus.outline).toBe("none");
    expect(focus.label).toBeTruthy();
  });
});
