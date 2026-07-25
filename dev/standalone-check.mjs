import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://127.0.0.1:8137/game/index.html", { waitUntil: "load" });
await page.waitForSelector("#playButton.play-ready", { timeout: 10000 });
const silent = await page.evaluate(() =>
  Array.from(document.querySelectorAll("audio,video")).every((m) => m.paused || m.muted)
);
await page.screenshot({ path: "reports/shots/standalone-game.png" });
console.log(JSON.stringify({ errors, silentOnBoot: silent }));
await browser.close();
