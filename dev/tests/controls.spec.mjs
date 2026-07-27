import { test, expect } from "@playwright/test";
import {
  watchErrors,
  assertClean,
  gotoReady,
  openBook,
  finishCurrentVideo,
  nextPage,
} from "./helpers.mjs";

/* The one size token from styles.css, mirrored so the test knows what to expect:
   --nav-btn: clamp(64px, 11vmin, 124px), trimmed on short viewports by
   @media (max-height: 620px) to clamp(52px, 9vmin, 88px). */
function navBtnSize(page) {
  const { width: w, height: h } = page.viewportSize();
  const vmin = Math.min(w, h);
  return h <= 620
    ? Math.min(88, Math.max(52, vmin * 0.09))
    : Math.min(124, Math.max(64, vmin * 0.11));
}

test.describe("navigation controls", () => {
  test("hidden on cover; sizes/positions per spec; Back mirrored; no artwork overlap @mobile", async ({ page }) => {
    const errs = watchErrors(page);
    await gotoReady(page);

    // Controls do not appear on the cover / start screen.
    await expect(page.locator("#cornerPrev")).toBeHidden();
    await expect(page.locator("#cornerNext")).toBeHidden();

    await openBook(page);

    // Page 1: Back is fully ABSENT; Next hidden until the video gate opens.
    await expect(page.locator("#cornerPrev")).toBeHidden();
    await expect(page.locator("#cornerNext")).toBeHidden();

    await finishCurrentVideo(page);
    await expect(page.locator("#cornerNext")).toBeVisible({ timeout: 10000 });
    await nextPage(page); // page 2 → Back appears; Next hidden until this video ends too
    await expect(page.locator("#cornerNext")).toBeHidden();
    await finishCurrentVideo(page); // unlock so BOTH arrows are measurable
    await expect(page.locator("#cornerNext")).toBeVisible({ timeout: 10000 });
    await page.mouse.move(400, 20); // park the cursor away — :hover scale would skew the boxes
    await page.waitForTimeout(650); // let the 400ms reveal pop settle before measuring

    const box = (sel) => page.locator(sel).boundingBox();
    const next = await box("#cornerNext");
    const prev = await box("#cornerPrev");

    // ONE responsive size token, vmin-driven: clamp(64px, 11vmin, 124px), trimmed
    // to clamp(52px, 9vmin, 88px) on short viewports (max-height: 620px).
    const expected = navBtnSize(page);
    for (const b of [next, prev]) {
      expect(Math.abs(b.width - expected)).toBeLessThan(2);
      expect(Math.abs(b.height - expected)).toBeLessThan(2);
      expect(b.width).toBeGreaterThanOrEqual(44);   // minimum touch target
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

    // THE structural invariant: both buttons sit entirely in the reserved band
    // BELOW the book's rendered box, so they can never cover the artwork or the
    // page corners the curl-on-hover needs.
    const art = await box(".flip-scale");
    for (const b of [next, prev]) {
      expect(b.y).toBeGreaterThanOrEqual(art.y + art.height);
    }

    assertClean(errs);
  });

  /* ACCEPTANCE MATRIX — the real point of the book-anchored layout: at every one
     of these viewports (and the two zoom levels, which the browser reports as a
     smaller CSS viewport), both arrows must be fully on-screen, at least 44px,
     entirely BELOW the book's rendered box, and separated from each other. */
  const VIEWPORTS = [
    { w: 1920, h: 1080, note: "16:9 desktop" },
    { w: 1536, h: 864,  note: "Windows laptop scaling" },
    { w: 1366, h: 768,  note: "small laptop" },
    { w: 1280, h: 800,  note: "16:10 laptop" },
    { w: 1194, h: 834,  note: "iPad Air landscape" },
    { w: 1024, h: 768,  note: "4:3 tablet landscape" },
    { w: 962,  h: 601,  note: "worst-case short viewport" },
    { w: 911,  h: 512,  note: "1366x768 @150% zoom" },
    { w: 683,  h: 384,  note: "1366x768 @200% zoom" },
  ];

  test("no overlap, no clipping at every target viewport", async ({ browser }) => {
    test.setTimeout(420000);                   // one full boot per viewport
    for (const vp of VIEWPORTS) {
      // A fresh context per size, not setViewportSize: headless Chrome ties the
      // window to the viewport and refuses to grow past the host screen.
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
      const page = await ctx.newPage();
      const errs = watchErrors(page);
      await gotoReady(page);
      await openBook(page);
      await finishCurrentVideo(page);
      await nextPage(page);           // page 2 → Back is present too
      await finishCurrentVideo(page); // unlock so BOTH arrows are measurable
      await page.mouse.move(vp.w / 2, 4);      // park the cursor — :hover would skew the boxes
      await page.waitForTimeout(700);          // let the 400ms reveal pop settle before measuring
      const at = `${vp.w}x${vp.h} (${vp.note})`;
      const art = await page.locator(".flip-scale").boundingBox();
      const next = await page.locator("#cornerNext").boundingBox();
      const prev = await page.locator("#cornerPrev").boundingBox();
      const expected = navBtnSize(page);

      for (const [name, b] of [["next", next], ["prev", prev]]) {
        // sized from the one token, and always a real touch target
        expect(Math.abs(b.width - expected), `${name} width at ${at}`).toBeLessThan(2);
        expect(b.width, `${name} touch target at ${at}`).toBeGreaterThanOrEqual(44);
        // fully inside the viewport — no negative offsets, nothing clipped
        expect(b.x, `${name} left edge at ${at}`).toBeGreaterThanOrEqual(0);
        expect(b.y, `${name} top edge at ${at}`).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width,  `${name} right edge at ${at}`).toBeLessThanOrEqual(vp.w);
        expect(b.y + b.height, `${name} bottom edge at ${at}`).toBeLessThanOrEqual(vp.h);
        // strictly below the book, so it can never sit on the artwork or a corner
        expect(b.y, `${name} clears the book at ${at}`).toBeGreaterThanOrEqual(art.y + art.height);
      }
      // …and the two arrows never reach each other
      expect(next.x - (prev.x + prev.width), `arrow gap at ${at}`)
        .toBeGreaterThanOrEqual(expected * 0.35);
      // the book itself stays on-screen too
      expect(art.y, `book top at ${at}`).toBeGreaterThanOrEqual(0);
      expect(art.x, `book left at ${at}`).toBeGreaterThanOrEqual(0);

      const r = (n) => Math.round(n);
      console.log(
        `${at.padEnd(34)} btn ${r(expected)}px | book ${r(art.width)}x${r(art.height)} ` +
        `@y ${r(art.y)}-${r(art.y + art.height)} | arrows y ${r(next.y)}-${r(next.y + next.height)} ` +
        `(gap over book ${r(next.y - art.y - art.height)}px, under viewport ${r(vp.h - next.y - next.height)}px) ` +
        `| back x ${r(prev.x)} fwd x ${r(next.x)}`
      );
      assertClean(errs);
      await ctx.close();
    }
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
