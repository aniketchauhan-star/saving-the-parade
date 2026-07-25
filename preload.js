/* ============================================================================
   preload.js — two-stage asset loading for the flipbook.

   STAGE A (blocking, tiny): the shell — cover art, Start-button art, page
   posters, the LBD page poster. A themed progress bar sits in the Start
   button's place; the button is revealed (with a pop) only at 100%. Progress is
   BYTE-AWARE (streamed reader against real on-disk sizes from
   asset-manifest.json, refined by Content-Length) and MONOTONIC. Failed,
   aborted, stalled, unsupported or file://-blocked requests count as complete —
   the reader is NEVER trapped on the loader; a hard deadline backs everything.

   STAGE B (non-blocking): after Stage A AND the window load event, later-page
   videos and shared audio are warmed into the HTTP cache during idle time.
   Embedded-game assets are deliberately NOT fetched here — they warm inside the
   hidden game iframe (its own boot preloaders + game/embed-bridge.js), so no
   asset ever downloads twice. The iframe itself is loaded by script.js on the
   same idle schedule.
   ============================================================================ */
(function () {
  "use strict";

  var MANIFEST_URL = "asset-manifest.json";
  var CONCURRENCY = 5;               // ~5 transfers in flight
  var ASSET_TIMEOUT_MS = 25000;      // per-request abort timeout (Stage A)
  var BG_ASSET_TIMEOUT_MS = 120000;  // Stage B fetches include multi-MB videos
  var HARD_DEADLINE_MS = 45000;      // absolute ceiling on the whole Stage A gate

  var body = document.body;
  var loaderEl = document.getElementById("bootLoader");
  var fillEl = document.getElementById("bootLoaderFill");
  var labelEl = document.getElementById("bootLoaderLabel");

  /* ---- Reveal the Start button (exactly once) ---------------------------- */
  var revealed = false;
  function revealStart() {
    if (revealed) return;
    revealed = true;
    if (fillEl) fillEl.style.width = "100%";
    if (loaderEl) loaderEl.setAttribute("aria-valuenow", "100");
    if (labelEl) labelEl.textContent = "Ready!";
    setTimeout(function () {
      body.classList.remove("boot-loading");   // openBook()'s guard lifts here
      body.classList.add("boot-ready");        // CSS pops the Start button in
    }, 200);
  }
  // The learner is NEVER trapped by the loader, whatever fails below.
  setTimeout(revealStart, HARD_DEADLINE_MS);

  /* ---- Monotonic byte-aware progress -------------------------------------- */
  var totalBytes = 0;
  var doneByUrl = {};     // url -> bytes credited so far
  var shownPct = 0;       // displayed % — only ever increases
  function paint() {
    var done = 0;
    for (var k in doneByUrl) done += doneByUrl[k];
    var pct = totalBytes > 0 ? Math.min(100, (done / totalBytes) * 100) : 100;
    if (pct <= shownPct) return;               // monotonic: never move backward
    shownPct = pct;
    if (fillEl) fillEl.style.width = pct.toFixed(1) + "%";
    if (loaderEl) loaderEl.setAttribute("aria-valuenow", String(Math.round(pct)));
    if (labelEl) labelEl.textContent = "Loading… " + Math.round(pct) + "%";
  }

  /* ---- Blob URL replacement (one-time error fallback to the original) ----- */
  function maybeBlobSwap(entry, blob) {
    if (!entry.blobAllowed || !entry.target || !blob) return;
    try {
      var el = document.querySelector(entry.target);
      if (!el || el.tagName !== "IMG") return;
      var original = el.getAttribute("src");
      var blobUrl = URL.createObjectURL(blob);
      el.addEventListener("error", function onErr() {
        el.removeEventListener("error", onErr);
        try { URL.revokeObjectURL(blobUrl); } catch (e) {}
        el.src = original;                     // restore the untouched original URL
      });
      el.dataset.originalSrc = original;
      el.src = blobUrl;
    } catch (e) { /* keep the original URL — never break the element */ }
  }

  /* ---- One streamed, abortable, always-resolving preload ------------------ */
  function preloadOne(entry, timeoutMs, wantBlob) {
    return new Promise(function (resolve) {
      var expected = entry.bytes || 0;
      var settled = false;
      var ctrl = window.AbortController ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) try { ctrl.abort(); } catch (e) {} }, timeoutMs);
      function finish(blob) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // whatever happened, this asset counts as COMPLETE for progress
        doneByUrl[entry.url] = Math.max(doneByUrl[entry.url] || 0, expected);
        paint();
        if (blob) maybeBlobSwap(entry, blob);
        resolve();
      }
      var opts = {};
      if (ctrl) opts.signal = ctrl.signal;
      var p;
      try { p = fetch(entry.url, opts); } catch (e) { finish(null); return; }
      p.then(function (res) {
        if (!res || !res.ok) { finish(null); return; }
        // Refine the expected size from Content-Length when it is larger (the
        // displayed % is still monotonic — it simply pauses until bytes catch up).
        var len = Number(res.headers && res.headers.get && res.headers.get("content-length"));
        if (isFinite(len) && len > expected) { totalBytes += len - expected; expected = len; }
        if (!res.body || !res.body.getReader) {
          // No streaming support: fall back to a plain read.
          res.blob().then(function (b) { finish(wantBlob ? b : null); }, function () { finish(null); });
          return;
        }
        var reader = res.body.getReader();
        var chunks = wantBlob ? [] : null;
        (function pump() {
          reader.read().then(function (r) {
            if (r.done) {
              finish(wantBlob && chunks ? new Blob(chunks, { type: res.headers.get("content-type") || "" }) : null);
              return;
            }
            if (chunks) chunks.push(r.value);
            var got = (doneByUrl[entry.url] || 0) + r.value.length;
            doneByUrl[entry.url] = Math.min(got, expected || got);   // streamed byte credit
            paint();
            pump();
          }, function () { finish(null); });
        })();
      }, function () { finish(null); });
    });
  }

  /* ---- Small pool runner --------------------------------------------------- */
  function runPool(queue, worker, width) {
    return new Promise(function (resolve) {
      var inFlight = 0, i = 0;
      function next() {
        if (i >= queue.length && inFlight === 0) { resolve(); return; }
        while (inFlight < width && i < queue.length) {
          inFlight++;
          worker(queue[i++]).then(function () { inFlight--; next(); });
        }
      }
      next();
    });
  }

  /* ---- Stage B: idle background warm-up ------------------------------------ */
  function startStageB(entries) {
    var queue = entries
      .filter(function (e) { return e.stage === "background" && e.warmVia !== "iframe"; })
      .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    if (!queue.length) return;
    var idle = window.requestIdleCallback
      ? function (cb) { window.requestIdleCallback(cb, { timeout: 4000 }); }
      : function (cb) { setTimeout(cb, 500); };   // Safari fallback
    var done = 0;
    (function pump() {
      if (!queue.length) return;
      idle(function () {
        var batch = queue.splice(0, 2);           // two background transfers per idle slice
        Promise.all(batch.map(function (e) { return preloadOne(e, BG_ASSET_TIMEOUT_MS, false); }))
          .then(function () {
            done += batch.length;
            try { console.debug("[preload] stage B " + done + " asset(s) warmed"); } catch (e) {}
            pump();
          });
      });
    })();
  }

  /* ---- Boot ---------------------------------------------------------------- */
  var stageADone = false, windowLoaded = document.readyState === "complete";
  var manifestEntries = null;
  function maybeStartStageB() {
    if (stageADone && windowLoaded && manifestEntries) {
      var entries = manifestEntries;
      manifestEntries = null;                    // start once
      startStageB(entries);
    }
  }
  window.addEventListener("load", function () { windowLoaded = true; maybeStartStageB(); });

  fetch(MANIFEST_URL)
    .then(function (r) {
      if (!r.ok) throw new Error("manifest " + r.status);
      return r.json();
    })
    .then(function (manifest) {
      var entries = (manifest && manifest.entries) || [];
      manifestEntries = entries;
      var shell = entries
        .filter(function (e) { return e.stage === "shell"; })
        .sort(function (a, b) { return (a.bytes || 0) - (b.bytes || 0); });   // small files first
      totalBytes = shell.reduce(function (a, e) { return a + (e.bytes || 0); }, 0);
      paint();
      return runPool(shell, function (e) { return preloadOne(e, ASSET_TIMEOUT_MS, !!e.blobAllowed); }, CONCURRENCY);
    })
    .then(function () {
      stageADone = true;
      revealStart();
      maybeStartStageB();
    })
    .catch(function () {
      // Manifest unavailable (e.g. file://, offline dev) → never block the reader.
      stageADone = true;
      revealStart();
    });
})();
