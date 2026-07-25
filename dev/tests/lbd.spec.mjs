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

  test("full journey: instant intro → Let's Go → fullscreen → complete → auto-advance → fresh revisit", async ({ page }) => {
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
    for (const sel of ["#cornerNext", "#cornerPrev", "#homeBtn"]) {
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

    // 14-17. completion: the game's own success path fires; the bridge waits for
    // the real celebration audio to end (error/watchdog backed) and posts
    // lbd-complete exactly once → the book returns from fullscreen and advances
    // to the next story page automatically.
    await f.evaluate(() => window.completeGame());
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

  test("leaving before starting + Home route: overlay cleared, audio dead, revisit fresh", async ({ page }) => {
    const errs = watchErrors(page);
    await gotoReady(page);
    await waitForWarm(page);
    await openBook(page);
    await goToLbdPage(page);

    // Leave FORWARD without starting the game.
    await expect(page.locator("#cornerNext")).toBeEnabled();
    await nextPage(page);
    await expect(page.locator("#lbdStage")).not.toHaveClass(/visible/);
    // iframe reset then silently re-warmed for an instant fresh revisit
    await page.waitForFunction(
      () => (document.getElementById("lbdFrame").getAttribute("src") || "").includes("game/index.html"),
      { timeout: 20000 }
    );
    await page.click("#cornerPrev");
    await page.waitForFunction(() => document.querySelectorAll(".leaf.flipped").length === 3);
    await page.waitForTimeout(1400);
    await expect(page.frameLocator("#lbdFrame").locator("#playButton.play-ready")).toBeVisible({ timeout: 6000 });

    // HOME from the LBD page: overlay + fullscreen classes cleared, book closes.
    await page.click("#homeBtn");
    await page.waitForTimeout(2300); // cover-close swing
    await expect(page.locator("#lbdStage")).not.toHaveClass(/visible/);
    const state = await page.evaluate(() => ({
      fullscreenClass: document.body.classList.contains("lbd-is-fullscreen"),
      isOpen: document.body.classList.contains("is-open"),
    }));
    expect(state.fullscreenClass).toBe(false);
    expect(state.isOpen).toBe(false);
    await expect(page.locator("#hint")).toBeVisible({ timeout: 5000 }); // back on the cover
    assertClean(errs);
  });
});
