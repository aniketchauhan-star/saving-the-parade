import { test, expect } from "@playwright/test";
import {
  watchErrors,
  assertClean,
  gotoReady,
  openBook,
  finishCurrentVideo,
  nextPage,
} from "./helpers.mjs";

/* ==========================================================================
   RESPONSIVE CHROME HARNESS
   The nav chrome is a set of position:fixed elements in three lanes (bottom-left,
   bottom-right + top-right, centre). Nothing in the DOM stops them from growing
   into each other, so the ONLY real check is measured geometry: take every
   visible control's client rect at a given viewport and assert
     (a) no two of them intersect (real rect intersection, not a proxy), and
     (b) each one is fully inside the viewport.
   ========================================================================== */

/* Every fixed control that shares the screen with the book. (#homeBtn is listed
   on purpose even though the Home button was removed: probe() simply finds no
   element, and the cover/last-page states assert it is really gone.) */
const CONTROLS = ["#homeBtn", "#cornerPrev", "#cornerNext", ".toolbar", "#lbdNextBtn"];

/* The laptops / tablets the book is actually read on. */
const VIEWPORTS = [
  { w: 1920, h: 1080 }, // 1080p desktop
  { w: 1536, h: 864 },  // 1080p @ 125% scaling
  { w: 1366, h: 768 },  // the classic short laptop
  { w: 1280, h: 720 },  // 720p laptop / TV
  { w: 1194, h: 834 },  // iPad Pro 11" landscape
  { w: 1024, h: 768 },  // iPad landscape / small laptop
  { w: 912, h: 1368 },  // Surface Pro portrait
  { w: 820, h: 1180 },  // iPad Air portrait
];
const BASE = { w: 1366, h: 768 };   // viewport the page journey runs at

const TOL = 0.5;        // sub-pixel tolerance (fractional clamp()/min() results)
const MIN_TAP = 44;     // minimum touch target, per WCAG 2.5.5 / platform HIG

/* The --ctl token from styles.css, mirrored: the control box scales on the
   SMALLER AXIS (min(vw, vh)), never on vw alone. The narrow step is declared
   last in the stylesheet, so it wins when both steps match. */
function expectedCtl(vw, vh) {
  const clamp = (lo, v, hi) => Math.min(hi, Math.max(lo, v));
  if (vw <= 820) return clamp(44, Math.min(vw * 0.11, vh * 0.13), 76);   // @media (max-width: 820px)
  if (vh <= 620) return clamp(46, Math.min(vw * 0.09, vh * 0.15), 84);   // @media (max-height: 620px)
  return clamp(52, Math.min(vw * 0.085, vh * 0.13), 112);                // :root
}

/* Real rect intersection. Returns the overlapping w/h, or null when the rects
   are disjoint (touching edges count as disjoint). */
function intersection(a, b) {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > TOL && h > TOL ? { w, h } : null;
}

/* Measure every VISIBLE control in one pass, together with the live layout
   viewport (read from the page, not assumed, so a browser-level fullscreen can
   never silently shift the expectation). Elements that are display:none,
   visibility:hidden, transparent or absent are simply not on screen. */
async function probe(page, sels) {
  return page.evaluate((selectors) => {
    const rects = [];
    selectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const shown =
          cs.display !== "none" &&
          cs.visibility !== "hidden" &&
          parseFloat(cs.opacity) > 0.02 &&   // [disabled] arrows sit at 0.22 — still on screen
          r.width > 0.5 && r.height > 0.5;
        if (shown) {
          rects.push({
            sel, left: r.left, top: r.top, right: r.right, bottom: r.bottom,
            width: r.width, height: r.height,
          });
        }
      });
    });
    return { rects, vw: window.innerWidth, vh: window.innerHeight };
  }, sels);
}

/* Resize, let the book re-fit, and PARK THE MOUSE far from every control —
   :hover applies scale(1.12), which would inflate the measured boxes. */
async function settle(page, w, h) {
  // The Play tap takes the BROWSER into real fullscreen (kiosk feel, script.js
  // enterFullscreen), and a fullscreen window cannot be resized. That API is
  // orthogonal to the CSS layout under test, so step out of it first.
  await page.evaluate(async () => {
    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch (_) {}
    }
  });
  await page.waitForFunction(() => !document.fullscreenElement, null, { timeout: 5000 });
  for (let attempt = 0; ; attempt++) {
    try {
      await page.setViewportSize({ width: w, height: h });
      break;
    } catch (e) {
      if (attempt >= 3) throw e;
      await page.waitForTimeout(400);                   // window still leaving fullscreen
    }
  }
  await page.waitForTimeout(120);                       // let the resize handler run
  await page.waitForFunction(                           // body.is-resizing clears ~220ms after it settles
    () => !document.body.classList.contains("is-resizing"),
    null,
    { timeout: 5000 }
  );
  await page.mouse.move(Math.round(w / 2), 4);          // top-centre: no control lives there
  await page.waitForTimeout(260);                       // the 150ms transform transition unwinds
}

/* Sweep one UI state across every viewport.
   `visible` / `hidden` name the controls that MUST / must not be on screen in
   this state, so an all-hidden layout can never pass the overlap check
   vacuously. Returns what was actually measured, for the run log. */
async function sweepViewports(page, state, { visible = [], hidden = [] } = {}) {
  const log = {};
  for (const vp of VIEWPORTS) {
    await settle(page, vp.w, vp.h);
    const { rects, vw, vh } = await probe(page, CONTROLS);
    const at = `${state} @ ${vp.w}x${vp.h}`;
    const on = rects.map((r) => r.sel);
    log[`${vp.w}x${vp.h}`] = on;

    expect(vw, `${at}: layout viewport width drifted`).toBe(vp.w);
    expect(vh, `${at}: layout viewport height drifted`).toBe(vp.h);

    for (const sel of visible) expect(on, `${at}: ${sel} must be on screen`).toContain(sel);
    for (const sel of hidden) expect(on, `${at}: ${sel} must be off screen`).not.toContain(sel);

    // (a) NO two controls may intersect.
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const hit = intersection(rects[i], rects[j]);
        expect(
          hit,
          `${at}: ${rects[i].sel} ${JSON.stringify(rects[i])} intersects ` +
            `${rects[j].sel} ${JSON.stringify(rects[j])}` +
            (hit ? ` by ${hit.w.toFixed(1)}x${hit.h.toFixed(1)}px` : "")
        ).toBeNull();
      }
    }

    // (b) each control is FULLY inside the viewport (no negative offsets, no
    //     safe-area clipping, nothing hanging off an edge).
    for (const r of rects) {
      expect(r.left, `${at}: ${r.sel} off the LEFT edge`).toBeGreaterThanOrEqual(-TOL);
      expect(r.top, `${at}: ${r.sel} off the TOP edge`).toBeGreaterThanOrEqual(-TOL);
      expect(r.right, `${at}: ${r.sel} off the RIGHT edge (${r.right} > ${vw})`).toBeLessThanOrEqual(vw + TOL);
      expect(r.bottom, `${at}: ${r.sel} off the BOTTOM edge (${r.bottom} > ${vh})`).toBeLessThanOrEqual(vh + TOL);
    }

    // (c) every button keeps a real touch target, and the three square buttons
    //     size on the SMALLER axis (a vw-only formula fails here on 1366x768).
    const ctl = Math.max(MIN_TAP, expectedCtl(vw, vh));
    for (const r of rects) {
      if (r.sel === ".toolbar") continue;
      expect(r.width, `${at}: ${r.sel} width ${r.width} < ${MIN_TAP}px tap target`).toBeGreaterThanOrEqual(MIN_TAP - TOL);
      expect(r.height, `${at}: ${r.sel} height ${r.height} < ${MIN_TAP}px tap target`).toBeGreaterThanOrEqual(MIN_TAP - TOL);
      if (r.sel === "#lbdNextBtn") continue;   // a pill, not a square
      expect(Math.abs(r.width - ctl), `${at}: ${r.sel} width ${r.width} != --ctl ${ctl}`).toBeLessThan(1.5);
      expect(Math.abs(r.height - ctl), `${at}: ${r.sel} height ${r.height} != --ctl ${ctl}`).toBeLessThan(1.5);
    }
  }
  return log;
}

/* The warmed game iframe (the LBD overlay boots it during idle after load). */
async function gameFrame(page) {
  await page.waitForFunction(
    () => (document.getElementById("lbdFrame").getAttribute("src") || "").includes("game/index.html"),
    null,
    { timeout: 30000 }
  );
  await expect
    .poll(() => page.frames().some((fr) => fr.url().includes("game/index.html")), { timeout: 30000 })
    .toBe(true);
  const f = page.frames().find((fr) => fr.url().includes("game/index.html"));
  await f.waitForFunction(() => document.readyState === "complete");
  return f;
}

test.describe("navigation controls", () => {
  test("hidden on cover; sizes/positions per spec; Back mirrored; no artwork overlap @mobile", async ({ page }) => {
    const errs = watchErrors(page);
    await gotoReady(page);

    // Controls do not appear on the cover / start screen.
    await expect(page.locator("#cornerPrev")).toBeHidden();
    await expect(page.locator("#cornerNext")).toBeHidden();
    // The Home button was removed outright — not hidden, GONE from the DOM.
    expect(await page.locator("#homeBtn").count(), "Home button must not exist").toBe(0);

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

    const { width: vw, height: vh } = page.viewportSize();
    const box = (sel) => page.locator(sel).boundingBox();
    const next = await box("#cornerNext");
    const prev = await box("#cornerPrev");

    // Responsive size: --ctl = clamp(52px, min(8.5vw, 13vh), 112px) — the SMALLER
    // axis, so a short laptop shrinks the button instead of keeping a 124px block.
    const expected = Math.max(MIN_TAP, expectedCtl(vw, vh));
    for (const b of [next, prev]) {
      expect(Math.abs(b.width - expected)).toBeLessThan(2);
      expect(Math.abs(b.height - expected)).toBeLessThan(2);
    }

    // Symmetric lanes: both arrows sit the same distance from their own edge.
    expect(Math.abs(prev.x - (vw - (next.x + next.width)))).toBeLessThan(1);

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
    await page.mouse.move(Math.round(vw / 2), 4);
    await page.waitForTimeout(250);

    // Glyphs must not overlap the book artwork.
    const art = await box(".flip-scale");
    const nextGlyph = await box("#cornerNext svg");
    const prevGlyph = await box("#cornerPrev svg");
    expect(prevGlyph.x + prevGlyph.width).toBeLessThanOrEqual(art.x + 1);
    expect(nextGlyph.x).toBeGreaterThanOrEqual(art.x + art.width - 1);

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

  test("chrome never overlaps and never leaves the viewport — 8 viewports x 5 states", async ({ page }) => {
    test.slow(); // one journey, then 8 measured viewports per state
    const errs = watchErrors(page);
    const seen = {};

    await page.setViewportSize({ width: BASE.w, height: BASE.h });
    await gotoReady(page);

    // ---- STATE 1: the cover. No chrome at all yet.
    seen.cover = await sweepViewports(page, "cover", {
      hidden: ["#homeBtn", "#cornerPrev", "#cornerNext", "#lbdNextBtn"],
    });

    await settle(page, BASE.w, BASE.h);
    await openBook(page);

    // ---- STATE 2: first story page — Next only (Back is absent on page 1).
    await finishCurrentVideo(page);
    await expect(page.locator("#cornerNext")).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(650); // arrowReveal starts at scale(.55) — let it land
    seen.firstPage = await sweepViewports(page, "first page", {
      visible: ["#cornerNext"],
      hidden: ["#homeBtn", "#cornerPrev", "#lbdNextBtn"],
    });

    // ---- STATE 3: game page in PAGE-RECT mode, with the game's own Next armed.
    // This is the dense case: Back + Next + the overlay's Next all on screen at
    // once, and the overlay's Next is parked in the same viewport corner as
    // #cornerNext (the book chrome only hides in FULLSCREEN).
    await settle(page, BASE.w, BASE.h);
    await nextPage(page);                       // -> page 2
    for (let i = 0; i < 2; i++) {               // -> page 3, then the LBD page
      await finishCurrentVideo(page);
      await nextPage(page);
    }
    await expect(page.locator("#lbdStage")).toHaveClass(/visible/, { timeout: 15000 });
    await expect(page.locator("body")).not.toHaveClass(/lbd-is-fullscreen/);
    const frame = await gameFrame(page);
    // The engine's raw completion arrives whether or not the game ever went
    // fullscreen (Let's Go), which is exactly how the overlay's Next can end up
    // armed over the page rect.
    await frame.evaluate(() => parent.postMessage({ source: "lbd", type: "lbd-complete" }, "*"));
    await expect(page.locator("#lbdNextBtn")).toBeVisible({ timeout: 15000 }); // 1100ms arm delay
    await page.waitForTimeout(600);             // lbdNextPop (420ms) settles
    seen.gamePageRect = await sweepViewports(page, "game page-rect", {
      visible: ["#cornerPrev", "#cornerNext", "#lbdNextBtn"],
      hidden: ["#homeBtn"],
    });

    // ---- STATE 4: game FULLSCREEN — all book chrome hides, only the game's
    // Next remains, and it must stay inside the viewport.
    await settle(page, BASE.w, BASE.h);
    const letsGo = page.frameLocator("#lbdFrame").locator("#playButton.play-ready");
    await expect(letsGo).toBeVisible({ timeout: 15000 });
    await letsGo.click({ force: true });        // breathing button: never "stable"
    await expect(page.locator("body")).toHaveClass(/lbd-is-fullscreen/, { timeout: 5000 });
    await page.waitForTimeout(650);             // page-rect -> fullscreen morph
    seen.gameFullscreen = await sweepViewports(page, "game fullscreen", {
      visible: ["#lbdNextBtn"],
      hidden: ["#homeBtn", "#cornerPrev", "#cornerNext", ".toolbar"],
    });

    // ---- STATE 5: THE END — Back + the permanently disabled Next.
    await settle(page, BASE.w, BASE.h);
    await page.click("#lbdNextBtn");             // shrink out of the game, turn the page
    await page.waitForFunction(() => document.querySelectorAll(".leaf.flipped").length === 4, null, {
      timeout: 25000,
    });
    await page.waitForTimeout(1400);
    await finishCurrentVideo(page);
    await nextPage(page);                        // -> THE END (last page)
    await expect(page.locator(".replay-btn")).toBeVisible();
    await page.waitForTimeout(650);
    seen.lastPage = await sweepViewports(page, "last page", {
      visible: ["#cornerPrev", "#cornerNext"],
      hidden: ["#homeBtn", "#lbdNextBtn"],
    });

    console.log("measured chrome per state:\n" + JSON.stringify(seen, null, 2));
    assertClean(errs);
  });
});
