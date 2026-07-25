import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
await page.goto("http://127.0.0.1:8137/index.html", { waitUntil: "domcontentloaded", timeout: 60000 });
const data = await page.evaluate(() => {
  const nav = performance.getEntriesByType("navigation")[0];
  const res = performance.getEntriesByType("resource").map(r => ({
    name: r.name.replace(location.origin, ""),
    start: Math.round(r.startTime),
    end: Math.round(r.responseEnd),
    init: r.initiatorType,
    render: r.renderBlockingStatus,
  })).sort((a, b) => a.end - b.end);
  return { dcl: Math.round(nav.domContentLoadedEventEnd), domInteractive: Math.round(nav.domInteractive),
           respEnd: Math.round(nav.responseEnd), res };
});
console.log("domInteractive:", data.domInteractive, "DCL:", data.dcl, "docResponseEnd:", data.respEnd);
for (const r of data.res.slice(0, 30)) console.log(`${String(r.start).padStart(6)} -> ${String(r.end).padStart(6)}  ${r.init}  ${r.render || ""}  ${r.name.slice(0, 80)}`);
await browser.close();
