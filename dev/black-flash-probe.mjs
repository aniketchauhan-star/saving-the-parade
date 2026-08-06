/* Play-tap transition: measure how long the viewport is DARK, in real pixels.
   Records the tap on a CPU-throttled tablet-class context, then walks every
   recorded frame's mean luminance with ffmpeg. Frame counts and DOM state can't
   answer "did the screen go black" — this can, which is how the long-running QA
   "black flash" was finally pinned on the transition curtain that was meant to
   prevent it (flat dark viewport for 560ms at 6x throttle; none once removed).
   Reach for this before changing anything on the open path.

   Usage: node black-flash-probe.mjs <outDir> [cpuRate] [--nocurtain]
     cpuRate     CDP CPU throttle multiplier (default 6; 10-20 = slow tablet)
     --nocurtain strips any #openCurtain first, as an A/B control
   Requires the dev server on :8137 (node server.mjs) and ffmpeg on PATH. */
import { chromium } from "playwright";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const OUT = process.argv[2];
const RATE = Number(process.argv[3] || 6);
const NOCURTAIN = process.argv.includes("--nocurtain");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: true,
  recordVideo: { dir: OUT, size: { width: 1280, height: 800 } },
});
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await page.goto("http://127.0.0.1:8137/index.html");
await page.waitForSelector("body.boot-ready", { timeout: 90000 });
await page.waitForTimeout(1200);
if (NOCURTAIN) await page.evaluate(() => {
  const c = document.getElementById("openCurtain"); if (c) c.remove();
});
await cdp.send("Emulation.setCPUThrottlingRate", { rate: RATE });
await page.waitForTimeout(600);
await page.tap("#hint", { force: true });
await page.waitForTimeout(4000);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
const vpath = await page.video().path();
await ctx.close(); await browser.close();

// ---- measure: per-frame YAVG + YMIN/YMAX (flat frame => YMAX-YMIN tiny) ----
const raw = execFileSync("ffmpeg", ["-v", "error", "-i", vpath, "-vf",
  "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-", "-f", "null", "-"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const rows = [];
const re = /pts_time:([\d.]+)[\s\S]*?YAVG=([\d.]+)/g;
let m; while ((m = re.exec(raw))) rows.push({ t: +m[1], y: +m[2] });

// "dark" = mean luma below the title card's floor (title card sits ~85)
const DARK = 40;
let runs = [], cur = null;
for (const r of rows) {
  if (r.y < DARK) { cur = cur || { from: r.t, to: r.t }; cur.to = r.t; }
  else if (cur) { runs.push(cur); cur = null; }
}
if (cur) runs.push(cur);
const brightest = Math.max(...rows.map((r) => r.y));
console.log(`cpu=${RATE}x overlays=${NOCURTAIN ? "#openCurtain stripped" : "as shipped"}`);
console.log(`frames=${rows.length} brightest=${brightest.toFixed(1)}`);
console.log("dark runs (YAVG<40):",
  runs.length ? runs.map((r) => `${r.from.toFixed(2)}s→${r.to.toFixed(2)}s (${Math.round((r.to - r.from) * 1000 + 40)}ms)`).join(", ") : "NONE");
console.log("video:", vpath);
