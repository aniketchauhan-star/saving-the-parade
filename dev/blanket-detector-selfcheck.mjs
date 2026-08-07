/* Self-check for the blanket detector in tests/loading.spec.mjs: re-inject the
   removed curtain and confirm the detector actually FAILS on it. A regression
   test that cannot fail is worthless, and the FIRST two versions of that
   detector were exactly that — one sampled a single moment after the flash was
   over, the next used a frame-count window that closed before the click landed
   (headless rAF is unthrottled) and trusted elementFromPoint, which skips
   pointer-events:none layers. Both reported "clean" on a build that still
   flashed. Re-run this whenever that detector is touched.

     node blanket-detector-selfcheck.mjs            → clean build must report 0
     node blanket-detector-selfcheck.mjs --curtain  → curtain must be CAUGHT

   Requires the dev server on :8137 (node server.mjs). */
import { chromium } from "playwright";

const WITH_CURTAIN = process.argv.includes("--curtain");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true });
const page = await ctx.newPage();
await page.goto("http://127.0.0.1:8137/index.html");
await page.waitForSelector("body.boot-ready", { timeout: 60000 });

if (WITH_CURTAIN) {
  // Re-create the exact layer that was removed, on its exact old schedule:
  // opaque instantly inside the tap, 4 frames later a 450ms fade out.
  // pointer-events stays NONE on purpose — proving the detector doesn't rely on
  // hit-testing to see a blanket.
  await page.evaluate(() => {
    const c = document.createElement("div");
    c.id = "openCurtain";
    c.style.cssText = "position:fixed;inset:0;z-index:5000;background:#0d0834;opacity:0;" +
      "pointer-events:none;transition:opacity 450ms ease";
    document.body.appendChild(c);
    // Capture on the DOCUMENT: the real tap lands on .tap-catcher (the topmost
    // transparent zone over the cover), not on #hint, so a listener on #hint
    // alone would never fire.
    document.addEventListener("click", () => {
      c.style.transition = "none"; c.style.opacity = "1";
      requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          c.style.transition = "opacity 450ms ease"; c.style.opacity = "0";
        }))));
    }, true);
  });
}

// --- the detector, copied verbatim from tests/loading.spec.mjs ---
await page.evaluate((ms) => {
  window.__blankets = [];
  const deadline = performance.now() + ms;
  const isBlanket = (el, cs) => {
    if (Number(cs.opacity) < 0.5) return false;
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    const m = cs.backgroundColor.match(/[\d.]+/g);
    if (!m) return false;
    return (m.length > 3 ? Number(m[3]) : 1) > 0.5;
  };
  (function tick() {
    for (const el of document.body.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width < innerWidth * 0.95 || r.height < innerHeight * 0.95) continue;
      const cs = getComputedStyle(el);
      if (!isBlanket(el, cs)) continue;
      window.__blankets.push(el.tagName + "." + (el.className || "-") + "#" + (el.id || "-"));
    }
    if (performance.now() < deadline) requestAnimationFrame(tick);
  })();
}, 3000);

await page.click("#hint", { force: true });
await page.waitForTimeout(3400);
const hits = await page.evaluate(() => window.__blankets);
const uniq = [...new Set(hits)];
await browser.close();

console.log(`mode=${WITH_CURTAIN ? "curtain re-injected" : "clean build"}`);
console.log(`blanket samples=${hits.length} unique=${JSON.stringify(uniq)}`);
const ok = WITH_CURTAIN ? hits.length > 0 : hits.length === 0;
console.log(ok
  ? (WITH_CURTAIN ? "PASS — detector CATCHES a reintroduced curtain"
                  : "PASS — detector reports the clean build as clean")
  : (WITH_CURTAIN ? "FAIL — detector is blind; the regression test is worthless"
                  : "FAIL — detector false-positives on the clean build"));
process.exit(ok ? 0 : 1);
