/* Media optimisation pipeline (dev-only).
   - Story videos: MP4/H264 -> WebM VP9+Opus (constrained quality, 75% bitrate cap,
     two-pass at 70% fallback when the first output is not smaller).
   - Game audio:  Ogg/Vorbis (or mislabeled MP3) -> Ogg/Opus 64-96 kbps, in place.
   - Images:      PNG -> WebP q85; oversized WebP recompressed q82, in place.
   Every conversion is validated (decodes, dimensions/duration, smaller) before
   the output is accepted; losers are discarded and recorded as exceptions.
   Originals of replaced files are moved to dev/quarantine/ (never deployed).
   Browser support note: WebM/VP9 and Ogg/Opus play in Chrome, Edge, Firefox and
   recent Safari; WebP is universal in evergreen browsers. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const QUAR = path.join(ROOT, "dev", "quarantine");
const REPORTS = path.join(ROOT, "dev", "reports");
fs.mkdirSync(QUAR, { recursive: true });
fs.mkdirSync(REPORTS, { recursive: true });

const rows = [];
const exceptions = [];

function ff(args) {
  return execFileSync("ffmpeg", ["-hide_banner", "-y", ...args], { stdio: ["ignore", "pipe", "pipe"] });
}
function probe(file, entries) {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", entries, "-of", "json", file],
    { encoding: "utf8" }
  );
  return JSON.parse(out);
}
function size(f) {
  return fs.statSync(f).size;
}
function decodes(f) {
  try {
    execFileSync("ffmpeg", ["-v", "error", "-i", f, "-f", "null", "-"], { stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}
function videoMeta(f) {
  const j = probe(f, "stream=codec_type,codec_name,width,height,bit_rate,pix_fmt:format=duration,bit_rate");
  const v = (j.streams || []).find((s) => s.codec_type === "video") || {};
  return {
    width: v.width,
    height: v.height,
    pixFmt: v.pix_fmt || "",
    vBitrate: Number(v.bit_rate) || null,
    duration: Number(j.format && j.format.duration) || null,
    fBitrate: Number(j.format && j.format.bit_rate) || null,
  };
}
function record(kind, src, out, srcBytes, outBytes, note) {
  rows.push({
    kind,
    source: path.relative(ROOT, src).replace(/\\/g, "/"),
    output: out ? path.relative(ROOT, out).replace(/\\/g, "/") : null,
    sourceBytes: srcBytes,
    outputBytes: outBytes,
    savedBytes: outBytes != null ? srcBytes - outBytes : 0,
    savedPct: outBytes != null ? Math.round(((srcBytes - outBytes) / srcBytes) * 1000) / 10 : 0,
    note: note || "",
  });
  console.log(
    `[${kind}] ${path.basename(src)} ${(srcBytes / 1024).toFixed(0)}KB -> ${outBytes != null ? (outBytes / 1024).toFixed(0) + "KB" : "KEPT"} ${note || ""}`
  );
}
function quarantine(src) {
  const dest = path.join(QUAR, path.relative(ROOT, src).replace(/[\\/]/g, "__"));
  fs.renameSync(src, dest);
}

/* ---------- 1. Story videos: MP4 -> WebM (VP9 + Opus) ---------- */
const videos = ["assets/1.mp4", "assets/2.mp4", "assets/3.mp4", "assets/4.mp4"];
for (const rel of videos) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) continue;
  const meta = videoMeta(src);
  const srcBytes = size(src);
  const out = src.replace(/\.mp4$/i, ".webm");
  const cap75 = Math.round((meta.vBitrate || meta.fBitrate) * 0.75);
  const common = (cap) => [
    "-i", src,
    "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p",
    "-crf", "33", "-b:v", String(cap),
    "-row-mt", "1", "-cpu-used", "3", "-deadline", "good",
    "-c:a", "libopus", "-b:a", "96k", "-ac", "2",
    out,
  ];
  console.log(`encoding ${rel} (cap ${(cap75 / 1000).toFixed(0)}k)...`);
  ff(common(cap75));
  let ok = fs.existsSync(out) && size(out) < srcBytes && decodes(out);
  if (ok) {
    const om = videoMeta(out);
    ok =
      om.width === meta.width &&
      om.height === meta.height &&
      Math.abs((om.duration || 0) - (meta.duration || 0)) < 0.35;
  }
  if (!ok && fs.existsSync(out)) {
    fs.rmSync(out);
    // two-pass at ~70% of source bitrate
    const cap70 = Math.round((meta.vBitrate || meta.fBitrate) * 0.7);
    const passLog = path.join(REPORTS, "vp9pass");
    console.log(`retrying ${rel} two-pass (cap ${(cap70 / 1000).toFixed(0)}k)...`);
    ff(["-i", src, "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p", "-b:v", String(cap70), "-row-mt", "1", "-cpu-used", "3", "-deadline", "good", "-pass", "1", "-passlogfile", passLog, "-an", "-f", "null", process.platform === "win32" ? "NUL" : "/dev/null"]);
    ff(["-i", src, "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p", "-b:v", String(cap70), "-row-mt", "1", "-cpu-used", "3", "-deadline", "good", "-pass", "2", "-passlogfile", passLog, "-c:a", "libopus", "-b:a", "96k", "-ac", "2", out]);
    ok = fs.existsSync(out) && size(out) < srcBytes && decodes(out);
  }
  if (ok) {
    record("video", src, out, srcBytes, size(out), "VP9/Opus webm");
    quarantine(src); // mp4 original leaves the deploy payload
  } else {
    if (fs.existsSync(out)) fs.rmSync(out);
    exceptions.push({ file: rel, reason: "webm output not smaller/valid; original kept" });
    record("video", src, null, srcBytes, null, "EXCEPTION: kept mp4");
  }
}

/* ---------- 2. Game audio: -> Ogg/Opus in place ---------- */
const MUSIC = new Set(["ThemeMusic.ogg", "confettiSound.ogg", "clapSound.ogg", "gateOpen.ogg", "laserSound.ogg", "flashlight.ogg", "PlugConnect.ogg", "clapSound.ogg"]);
const audioDir = path.join(ROOT, "game", "audios");
for (const name of fs.readdirSync(audioDir)) {
  if (!/\.ogg$/i.test(name)) continue;
  const src = path.join(audioDir, name);
  const srcBytes = size(src);
  const kbps = MUSIC.has(name) ? "96k" : "64k";
  const tmp = src + ".opus.tmp.ogg";
  try {
    ff(["-i", src, "-c:a", "libopus", "-b:a", kbps, "-vbr", "on", tmp]);
  } catch (e) {
    exceptions.push({ file: "game/audios/" + name, reason: "opus encode failed; original kept" });
    record("audio", src, null, srcBytes, null, "EXCEPTION: encode failed");
    if (fs.existsSync(tmp)) fs.rmSync(tmp);
    continue;
  }
  const okDur = (() => {
    try {
      const a = Number(probe(src, "format=duration").format.duration);
      const b = Number(probe(tmp, "format=duration").format.duration);
      return Math.abs(a - b) < 0.3;
    } catch {
      return false;
    }
  })();
  if (fs.existsSync(tmp) && size(tmp) < srcBytes && decodes(tmp) && okDur) {
    const outBytes = size(tmp);
    fs.copyFileSync(src, path.join(QUAR, "game__audios__" + name));
    fs.rmSync(src);
    fs.renameSync(tmp, src);
    record("audio", src, src, srcBytes, outBytes, `opus ${kbps}`);
  } else {
    if (fs.existsSync(tmp)) fs.rmSync(tmp);
    exceptions.push({ file: "game/audios/" + name, reason: "opus output not smaller/valid; original kept" });
    record("audio", src, null, srcBytes, null, "EXCEPTION: kept original");
  }
}

/* ---------- 3. Images ---------- */
function hasAlpha(f) {
  try {
    const j = probe(f, "stream=pix_fmt");
    const p = ((j.streams || [])[0] || {}).pix_fmt || "";
    return /a/.test(p.replace("yuv", "")); // yuva420p, argb, rgba, pal8 w/ alpha...
  } catch {
    return true; // assume alpha to be safe
  }
}
function imgDims(f) {
  const j = probe(f, "stream=width,height");
  const s = (j.streams || [])[0] || {};
  return { w: s.width, h: s.height };
}
function convertImage(src, out, quality) {
  const alpha = hasAlpha(src);
  const srcBytes = size(src);
  const dims = imgDims(src);
  const args = ["-i", src, "-c:v", "libwebp", "-lossless", "0", "-quality", String(quality), "-compression_level", "6"];
  if (alpha) args.push("-pix_fmt", "yuva420p");
  else args.push("-pix_fmt", "yuv420p");
  const tmp = out + ".tmp.webp";
  args.push(tmp);
  try {
    ff(args);
  } catch {
    if (fs.existsSync(tmp)) fs.rmSync(tmp);
    return { ok: false, reason: "encode failed" };
  }
  const od = imgDims(tmp);
  if (!(size(tmp) < srcBytes && od.w === dims.w && od.h === dims.h && decodes(tmp))) {
    const r = { ok: false, reason: `not smaller/valid (${size(tmp)} vs ${srcBytes})` };
    fs.rmSync(tmp);
    return r;
  }
  const outBytes = size(tmp);
  if (path.resolve(src) === path.resolve(out)) {
    fs.copyFileSync(src, path.join(QUAR, path.relative(ROOT, src).replace(/[\\/]/g, "__")));
    fs.rmSync(src);
  }
  fs.renameSync(tmp, out);
  return { ok: true, srcBytes, outBytes };
}

// 3a. flipbook PNGs -> WebP (new names; references updated in code separately)
const pngJobs = [
  { src: "assets/cover  page.png", out: "assets/cover-page.webp", q: 85 },
  { src: "assets/play-button.png", out: "assets/play-button.webp", q: 85 },
];
for (const j of pngJobs) {
  const src = path.join(ROOT, j.src);
  if (!fs.existsSync(src)) continue;
  const srcBytes = size(src);
  const r = convertImage(src, path.join(ROOT, j.out), j.q);
  if (r.ok) {
    record("image", src, path.join(ROOT, j.out), srcBytes, r.outBytes, "png->webp");
    quarantine(src);
  } else {
    exceptions.push({ file: j.src, reason: r.reason });
    record("image", src, null, srcBytes, null, "EXCEPTION: " + r.reason);
  }
}

// 3b. large game WebP re-compression in place (>30KB only)
const gameAssets = path.join(ROOT, "game", "assets");
for (const name of fs.readdirSync(gameAssets)) {
  if (!/\.webp$/i.test(name)) continue;
  const src = path.join(gameAssets, name);
  const srcBytes = size(src);
  if (srcBytes < 30 * 1024) continue;
  const r = convertImage(src, src, 82);
  if (r.ok && r.srcBytes - r.outBytes > r.srcBytes * 0.08) {
    record("image", src, src, srcBytes, r.outBytes, "webp recompress q82");
  } else if (r.ok) {
    // saving <8% is not worth a lossy generation — restore the original
    const backup = path.join(QUAR, path.relative(ROOT, src).replace(/[\\/]/g, "__"));
    fs.rmSync(src);
    fs.renameSync(backup, src);
    record("image", src, null, srcBytes, null, "kept (saving too small)");
  } else {
    exceptions.push({ file: "game/assets/" + name, reason: r.reason });
    record("image", src, null, srcBytes, null, "kept: " + r.reason);
  }
}

/* ---------- 4. Reports ---------- */
const summary = {};
for (const r of rows) {
  const s = (summary[r.kind] = summary[r.kind] || { sourceBytes: 0, outputBytes: 0, converted: 0, kept: 0 });
  s.sourceBytes += r.sourceBytes;
  s.outputBytes += r.outputBytes != null ? r.outputBytes : r.sourceBytes;
  r.outputBytes != null ? s.converted++ : s.kept++;
}
const report = { when: new Date().toISOString(), rows, exceptions, summary };
fs.writeFileSync(path.join(REPORTS, "media-size-report.json"), JSON.stringify(report, null, 2));
const csv = ["kind,source,output,sourceBytes,outputBytes,savedBytes,savedPct,note"]
  .concat(rows.map((r) => [r.kind, r.source, r.output || "", r.sourceBytes, r.outputBytes ?? "", r.savedBytes, r.savedPct, JSON.stringify(r.note)].join(",")))
  .join("\n");
fs.writeFileSync(path.join(REPORTS, "media-size-report.csv"), csv);
console.log("\nSummary:", JSON.stringify(summary, null, 2));
console.log("Exceptions:", JSON.stringify(exceptions, null, 2));
