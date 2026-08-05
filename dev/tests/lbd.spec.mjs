import { test, expect } from "@playwright/test";
import {
  watchErrors,
  assertClean,
  gotoReady,
  openBook,
  flippedCount,
  goToLbdPage,
  nextPage,
} from "./helpers.mjs";

function gameFrame(page) {
  const f = page.frames().find((fr) => fr.url().includes("game/index.html"));
  expect(f, "game iframe should be loaded").toBeTruthy();
  return f;
}
async function waitForWarm(page) {
  await page.waitForFunction(
    () => (document.getElementById("lbdFrame").getAttribute("src") || "").includes("game/index.html"),
    { timeout: 30000 }
  );
  await page.waitForFunction(
    () => {
      const fr = document.getElementById("lbdFrame");
      try {
        return fr.contentWindow && fr.contentWindow.document.readyState === "complete";
      } catch (e) {
        return false;
      }
    },
    { timeout: 30000 }
  );
}

test.describe("embedded LBD", () => {
  test("warms hidden after load: silent, unfocused, dev-tool-free, assets warm", async ({ page }) => {
    const errs = watchErrors(page);
    await gotoReady(page);

    // 1. iframe source assigned during idle after window load (never at boot-block time)
    await waitForWarm(page);
    const f = gameFrame(page);

    // 2-3. boots hidden and SILENT — no theme music, no narration audio playing
    await expect(page.locator("#lbdStage")).not.toHaveClass(/visible/);
    const audio = await f.evaluate(() => ({
      themePaused: window._themeAudio ? window._themeAudio.paused : true,
      anyPlaying: Array.from(document.querySelectorAll("audio, video")).some((m) => !m.paused && !m.muted),
    }));
    expect(audio.themePaused).toBe(true);
    expect(audio.anyPlaying).toBe(false);

    // the hidden iframe must not steal keyboard/accessibility focus
    const activeTag = await page.evaluate(() => document.activeElement && document.activeElement.tagName);
    expect(activeTag).not.toBe("IFRAME");

    // 4. dev/QA controls are absent from the embedded copy
    const debugBits = await f.evaluate(() => ({
      scripts: Array.from(document.querySelectorAll("script[src]")).map((s) => s.getAttribute("src")),
    }));
    expect(debugBits.scripts.filter((s) => /debug/i.test(s))).toEqual([]);

    // 5. hidden-level sprites + later audio requested during idle warming
    await page.waitForTimeout(5000); // bridge warmer: starts ~1s after ready, chunked
    const warm = await f.evaluate(() => ({
      sprites: Object.keys(window._assetCache || {}),
      narrations: Object.keys(window._instructionAudioCache || {}),
    }));
    // sprites referenced only by hidden/later rounds (display:none until reached):
    expect(warm.sprites.join()).toContain("RectangleHollow.webp");
    expect(warm.sprites.join()).toContain("triangleHollow.webp");
    expect(warm.sprites.join()).toContain("play.webp");
    // audio referenced only during later interactions:
    expect(warm.narrations.length).toBeGreaterThan(5);

    // 6. overlay is hidden on every page before the LBD page
    await openBook(page);
    for (let i = 0; i < 3; i++) {
      await expect(page.locator("#lbdStage")).not.toHaveClass(/visible/);
      if (i < 2) {
        const { finishCurrentVideo } = await import("./helpers.mjs");
        await finishCurrentVideo(page);
        await nextPage(page);
      }
    }
    assertClean(errs);
  });

  test("full journey: instant intro → Let's Go → fullscreen → complete → Next tap → fresh revisit", async ({ page }) => {
    const errs = watchErrors(page);
    await gotoReady(page);
    await waitForWarm(page);
    await openBook(page);

    // Plant a marker: the iframe must NOT reload between reveal and fullscreen.
    let f = gameFrame(page);
    await f.evaluate(() => { window.__lbdTestMarker = "alive"; });

    // 7-8. the LBD page comes immediately after page 3; landing reveals the
    // already-booted intro instantly (no spinner — the real Let's-Go button is
    // armed and interactive right away).
    await goToLbdPage(page);
    await expect(page.locator("#lbdStage")).toHaveClass(/visible/);
    await expect(page.locator("body")).not.toHaveClass(/lbd-is-fullscreen/); // no forced fullscreen
    const letsGo = page.frameLocator("#lbdFrame").locator("#playButton.play-ready");
    await expect(letsGo).toBeVisible({ timeout: 4000 });
    // spinner-free: overlay reports the game-ready handshake
    await expect(page.locator("#lbdStage")).toHaveClass(/game-ready/);

    // 9-12. tapping the REAL Let's Go sends lbd-start → parent goes fullscreen,
    // chrome disappears, and the SAME game instance keeps running (no reload).
    // force: the button "breathes" (infinite scale animation) so it never
    // passes Playwright's stability check — readers tap it mid-breath anyway.
    await letsGo.click({ force: true });
    await expect(page.locator("body")).toHaveClass(/lbd-is-fullscreen/, { timeout: 4000 });
    await page.waitForTimeout(650); // let the 400ms page-frame → fullscreen morph finish
    const stageBox = await page.locator("#lbdStage").boundingBox();
    const vp = page.viewportSize();
    expect(Math.round(stageBox.width)).toBe(vp.width);
    expect(Math.round(stageBox.height)).toBe(vp.height);
    for (const sel of ["#cornerNext", "#cornerPrev"]) {
      await expect(page.locator(sel)).toBeHidden();
    }
    f = gameFrame(page);
    expect(await f.evaluate(() => window.__lbdTestMarker)).toBe("alive"); // not reloaded
    expect(await f.evaluate(() => window._themeAudio && !window._themeAudio.paused)).toBe(true); // game running

    // page turns are blocked underneath the fullscreen game
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(1300);
    expect(await flippedCount(page)).toBe(3);

    // 13. the game really runs its flow (screens advance; no errors while playing)
    await f.waitForFunction(() => window.state && window.state.step >= 1, null, { timeout: 20000 });

    // 14-17. completion: the game's own success path fires → the win screen stays
    // up, fullscreen is HELD, and a Next button pops in over it. Nothing advances
    // until the reader taps it; the tap then returns the book from fullscreen and
    // turns to the next story page.
    await f.evaluate(() => window.completeGame());
    const nextBtn = page.locator("#lbdNextBtn");
    await expect(nextBtn).toBeVisible({ timeout: 10000 });
    // no auto-advance: still fullscreen, still on the game page
    await expect(page.locator("body")).toHaveClass(/lbd-is-fullscreen/);
    expect(await flippedCount(page)).toBe(3);
    await page.waitForTimeout(600); // let the pop-in animation settle before tapping
    await nextBtn.click();
    await expect(nextBtn).toBeHidden();
    await expect(page.locator("body")).not.toHaveClass(/lbd-is-fullscreen/, { timeout: 25000 });
    await page.waitForFunction(() => document.querySelectorAll(".leaf.flipped").length === 4, null, { timeout: 25000 });
    await expect(page.locator("#lbdStage")).not.toHaveClass(/visible/);

    // 18-19. game audio is dead after leaving; the iframe resets and RE-WARMS
    await page.waitForFunction(
      () => {
        const src = document.getElementById("lbdFrame").getAttribute("src") || "";
        return src.includes("game/index.html"); // re-warmed from cache during idle
      },
      { timeout: 20000 }
    );
    // the src attribute lands before the frame actually navigates — wait for the
    // real frame, not just the attribute
    await expect
      .poll(() => page.frames().some((fr) => fr.url().includes("game/index.html")), { timeout: 20000 })
      .toBe(true);
    const f2 = gameFrame(page);
    await f2.waitForFunction(() => document.readyState === "complete");
    const post = await f2.evaluate(() => ({
      marker: window.__lbdTestMarker || null,             // fresh document
      themePaused: window._themeAudio ? window._themeAudio.paused : true,
    }));
    expect(post.marker).toBeNull();
    expect(post.themePaused).toBe(true);

    // 20. navigating back to the LBD page shows a fresh, instant intro
    await page.click("#cornerPrev");
    await page.waitForFunction(() => document.querySelectorAll(".leaf.flipped").length === 3);
    await page.waitForTimeout(1400);
    await expect(page.locator("#lbdStage")).toHaveClass(/visible/);
    await expect(page.frameLocator("#lbdFrame").locator("#playButton.play-ready")).toBeVisible({ timeout: 6000 });
    assertClean(errs);
  });

  test("a start the click relay can't see (untrusted click) still goes fullscreen", async ({ page }) => {
    // Assistive-touch layers, TalkBack and kiosk/managed-tablet shells dispatch
    // clicks with isTrusted:false. The game's own handler accepts those and
    // starts, but the bridge's click relay ignores them — the observer fallback
    // (on the game's .play-exit state mutation) must still post lbd-start, or
    // the game plays trapped inside the page frame (real tablet bug).
    const errs = watchErrors(page);
    await gotoReady(page);
    await waitForWarm(page);
    await openBook(page);
    await goToLbdPage(page);

    const f = gameFrame(page);
    await expect(page.frameLocator("#lbdFrame").locator("#playButton.play-ready")).toBeVisible({ timeout: 6000 });
    await f.evaluate(() => document.getElementById("playButton").click());   // isTrusted: false

    // The game really starts (intro flow advances, theme music up)…
    await f.waitForFunction(() => window.state && window.state.step >= 1, null, { timeout: 20000 });
    // …and the parent still gets the start handshake and goes fullscreen.
    await expect(page.locator("body")).toHaveClass(/lbd-is-fullscreen/, { timeout: 4000 });
    assertClean(errs);
  });

  test("opened from disk (file://): the start tap still expands to fullscreen", async ({ page }) => {
    // Chromium treats every file: document as an OPAQUE origin while reporting
    // location.origin as the literal string "file://". A postMessage targeted at
    // that string can never match the parent's (opaque) origin and is dropped
    // SILENTLY — and the parent's same-origin watchdog is blocked outright, so
    // there is no second chance. The bridge must therefore fall back to "*" on
    // any non-http(s) origin, or the whole game plays trapped inside the page
    // frame (the real "double-clicked index.html" bug). This walk is the full
    // reader journey over file:// — no server involved.
    const bookUrl = new URL("../../index.html", import.meta.url); // dev/tests → book root
    await page.goto(bookUrl.href);
    await page.waitForSelector("body.boot-ready", { timeout: 45000 });
    await openBook(page);

    // Walk the three gated video pages exactly like a reader would.
    for (let i = 0; i < 3; i++) {
      const { finishCurrentVideo } = await import("./helpers.mjs");
      await finishCurrentVideo(page);
      await expect(page.locator("#cornerNext")).toBeEnabled({ timeout: 10000 });
      await nextPage(page);
    }
    expect(await flippedCount(page)).toBe(3);
    await expect(page.locator("#lbdStage")).toHaveClass(/visible/, { timeout: 10000 });

    // Sanity-check the premise: the parent really CANNOT reach into the frame
    // on file:// (if this ever becomes readable, the watchdog covers the bug
    // and this test is only belt-and-suspenders).
    const opaque = await page.evaluate(() => {
      try { void document.getElementById("lbdFrame").contentWindow.document; return false; }
      catch (e) { return true; }
    });
    expect(opaque, "file:// frames should be opaque origins").toBe(true);

    // The REAL Let's Go tap → lbd-start must still arrive → fullscreen morph.
    const letsGo = page.frameLocator("#lbdFrame").locator("#playButton.play-ready");
    await expect(letsGo).toBeVisible({ timeout: 6000 });
    await letsGo.click({ force: true });
    await expect(page.locator("body")).toHaveClass(/lbd-is-fullscreen/, { timeout: 4000 });
    await page.waitForTimeout(650); // page-frame → fullscreen morph settles
    const stageBox = await page.locator("#lbdStage").boundingBox();
    const vp = page.viewportSize();
    expect(Math.round(stageBox.width)).toBe(vp.width);
    expect(Math.round(stageBox.height)).toBe(vp.height);
  });

  test("the game page cannot be skipped; leaving backwards clears the overlay", async ({ page }) => {
    const errs = watchErrors(page);
    await gotoReady(page);
    await waitForWarm(page);
    await openBook(page);
    await goToLbdPage(page);

    // The game IS the gate: without completing it the forward arrow is not even
    // shown, and no forward route may leave the page.
    await expect(page.locator("#cornerNext")).toBeHidden();
    const art = await page.locator(".flip-scale").boundingBox();
    await page.keyboard.press("ArrowRight");
    await page.mouse.move(art.x + art.width - 30, art.y + art.height - 40);
    await page.mouse.down();
    await page.mouse.move(art.x + 40, art.y + art.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(1400);
    expect(await flippedCount(page), "the game page must not be skippable").toBe(3);

    // (The Home button was removed, so there is no longer a mid-story route back
    // to the cover to exercise here — Replay on THE END page is the only one, and
    // the "full journey" test above covers leaving the game the intended way.)
    // Leaving BACKWARDS is always allowed and must tear the overlay down.
    await expect(page.locator("#cornerPrev")).toBeEnabled();
    await page.click("#cornerPrev");
    await page.waitForFunction(() => document.querySelectorAll(".leaf.flipped").length === 2);
    await page.waitForTimeout(1400);
    await expect(page.locator("#lbdStage")).not.toHaveClass(/visible/);
    // iframe reset then silently re-warmed for an instant fresh revisit
    await page.waitForFunction(
      () => (document.getElementById("lbdFrame").getAttribute("src") || "").includes("game/index.html"),
      { timeout: 20000 }
    );
    // page 3 was already watched, so its Next is right there — back into the game
    // page, where the intro is fresh and instant and the gate is armed again.
    await nextPage(page);
    await expect(page.frameLocator("#lbdFrame").locator("#playButton.play-ready")).toBeVisible({ timeout: 6000 });
    await expect(page.locator("#cornerNext")).toBeHidden();

    // …and back off it again, to check the teardown from a revisit too.
    await page.click("#cornerPrev");
    await page.waitForFunction(() => document.querySelectorAll(".leaf.flipped").length === 2);
    await page.waitForTimeout(1400);
    await expect(page.locator("#lbdStage")).not.toHaveClass(/visible/);
    const state = await page.evaluate(() => ({
      fullscreenClass: document.body.classList.contains("lbd-is-fullscreen"),
      gameAudioDead: (() => {
        const fr = document.getElementById("lbdFrame");
        try { return !fr.contentWindow._themeAudio || fr.contentWindow._themeAudio.paused; }
        catch (_) { return true; }
      })(),
    }));
    expect(state.fullscreenClass).toBe(false);
    expect(state.gameAudioDead).toBe(true);
    assertClean(errs);
  });
});
