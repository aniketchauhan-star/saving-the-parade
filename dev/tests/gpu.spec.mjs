import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  watchErrors,
  assertClean,
  gotoReady,
  openBook,
  finishCurrentVideo,
  nextPage,
  goToLbdPage,
} from "./helpers.mjs";

const SHOTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "reports", "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (name) => path.join(SHOTS, name + ".png");

test("page windowing active; screenshots for ghost-layer inspection", async ({ page }) => {
  const errs = watchErrors(page);
  await gotoReady(page);
  await page.screenshot({ path: shot("01-cover") });
  await openBook(page);
  await page.screenshot({ path: shot("02-page1-current") });

  // Windowing on page 1: only leaves 0 and 1 renderable; the rest released.
  let winOff = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".leaf")).map((l) => l.classList.contains("win-off"))
  );
  expect(winOff).toEqual([false, false, true, true, true, true]);
  // Released leaves really drop their GPU hints.
  const released = await page.evaluate(() => {
    const l = document.querySelectorAll(".leaf")[3];
    const cs = getComputedStyle(l);
    return { vis: cs.visibility, wc: cs.willChange, pe: cs.pointerEvents };
  });
  expect(released.vis).toBe("hidden");
  expect(released.wc).toBe("auto");
  expect(released.pe).toBe("none");

  // Page-turn midpoint screenshot.
  await finishCurrentVideo(page);
  await expect(page.locator("#cornerNext")).toBeEnabled({ timeout: 10000 });
  await page.click("#cornerNext");
  await page.waitForTimeout(520); // mid-flip (flip = 1150ms)
  await page.screenshot({ path: shot("03-flip-midpoint") });
  await page.waitForTimeout(1100);
  await page.screenshot({ path: shot("04-page2-settled") });

  // Windowing follows the current page.
  winOff = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".leaf")).map((l) => l.classList.contains("win-off"))
  );
  expect(winOff).toEqual([false, false, false, true, true, true]);

  // Forward to the LBD page, into fullscreen, and back — the classic ghost spot.
  await finishCurrentVideo(page);
  await nextPage(page);
  await finishCurrentVideo(page);
  await nextPage(page);
  await expect(page.locator("#lbdStage")).toHaveClass(/visible/, { timeout: 10000 });
  await page.screenshot({ path: shot("05-lbd-page-frame") });
  const letsGo = page.frameLocator("#lbdFrame").locator("#playButton.play-ready");
  await letsGo.click({ force: true }); // breathing animation → never "stable"
  await expect(page.locator("body")).toHaveClass(/lbd-is-fullscreen/, { timeout: 4000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: shot("06-lbd-fullscreen") });
  const f = page.frames().find((fr) => fr.url().includes("game/index.html"));
  await f.evaluate(() => window.completeGame());
  await page.waitForFunction(() => document.querySelectorAll(".leaf.flipped").length === 4, null, { timeout: 25000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: shot("07-return-from-lbd") });

  // THE END page + full back-walk shot (turned pile on the left).
  await finishCurrentVideo(page);
  await nextPage(page);
  await page.screenshot({ path: shot("08-the-end") });
  await page.click("#cornerPrev");
  await page.waitForTimeout(560);
  await page.screenshot({ path: shot("09-backflip-midpoint") });
  await page.waitForTimeout(1100);

  assertClean(errs);
});
