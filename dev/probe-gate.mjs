import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
await page.goto("http://127.0.0.1:8137/index.html");
await page.waitForSelector("body.boot-ready", { timeout: 45000 });
await page.waitForFunction(() => (document.getElementById("lbdFrame").getAttribute("src") || "").includes("game"), null, { timeout: 20000 });
await page.click("#hint", { force: true });
await page.waitForFunction(() => document.getElementById("tapCatcher").style.pointerEvents === "none", null, { timeout: 15000 });
// fast-forward three video pages
for (let i = 0; i < 3; i++) {
  await page.waitForFunction(() => {
    const idx = document.querySelectorAll(".leaf.flipped").length;
    const v = document.querySelectorAll(".leaf")[idx].querySelector("video.page-media");
    return v && isFinite(v.duration) && v.duration > 0;
  }, null, { timeout: 20000 });
  await page.evaluate(() => {
    const idx = document.querySelectorAll(".leaf.flipped").length;
    const v = document.querySelectorAll(".leaf")[idx].querySelector("video.page-media");
    v.muted = true; v.currentTime = Math.max(0, v.duration - 0.3); v.play().catch(() => {});
  });
  await page.waitForFunction(() => !document.getElementById("cornerNext").disabled, null, { timeout: 20000 });
  await page.click("#cornerNext");
  await page.waitForTimeout(1500);
}
// on LBD page: start + complete the game
const f = () => page.frames().find((fr) => fr.url().includes("game/index.html"));
await page.frameLocator("#lbdFrame").locator("#playButton.play-ready").click({ force: true });
await page.waitForTimeout(800);
await f().evaluate(() => window.completeGame());
await page.waitForFunction(() => document.querySelectorAll(".leaf.flipped").length === 4, null, { timeout: 25000 });
await page.waitForTimeout(2200);
const state = await page.evaluate(() => {
  const n = document.getElementById("cornerNext");
  return {
    disabled: n.disabled,
    ariaDisabled: n.getAttribute("aria-disabled"),
    opacity: getComputedStyle(n).opacity,
    anim: getComputedStyle(n).animationName,
    classes: n.className,
  };
});
console.log(JSON.stringify(state, null, 2));
await page.screenshot({ path: "reports/shots/probe-after-lbd.png" });
await browser.close();
