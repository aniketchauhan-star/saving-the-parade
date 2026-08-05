/* ============================================================================
   embed-bridge.js — flipbook <-> game handshake + idle asset warmer.
   Loaded LAST in the embedded game's index.html, after the game's own runtime.
   Minimally invasive: no game logic is rewritten; the bridge only
     • relays the REAL "Let's Go" tap to the parent as  {source:"lbd", type:"lbd-start"}
     • tells the parent the intro is painted            {source:"lbd", type:"lbd-ready"}
     • relays true game completion — after the win-celebration audio really ends
       (with error + watchdog fallbacks) — as           {source:"lbd", type:"lbd-complete"}
     • warms the game's later-screen images and audio in small idle chunks.
   Standalone (opened directly, not in an iframe) the bridge does NOTHING.
   ============================================================================ */
(function () {
  "use strict";
  if (window.parent === window) {
    // Standalone play — no host to talk to, no warm-up beyond the game's own.
    return;
  }

  /* Same-site embed: talk to the real origin, never "*" — but ONLY when that
     origin is a real, serialisable http(s) one. Anywhere else "*" is the only
     working target: on file:// Chromium reports location.origin as the literal
     string "file://" while treating every file: frame as an OPAQUE origin, so a
     postMessage targeted at "file://" can never match the parent and is dropped
     silently — the flipbook then never receives lbd-start and the game plays
     trapped inside the page frame instead of going fullscreen. */
  var TARGET_ORIGIN = "*";
  try {
    if (/^https?:\/\//.test(window.location.origin || "")) {
      TARGET_ORIGIN = window.location.origin;
    }
  } catch (e) { /* keep "*" */ }
  function post(msg) {
    try { window.parent.postMessage(msg, TARGET_ORIGIN); } catch (e) { /* never throw into the game */ }
  }

  var startButton = document.getElementById("playButton");
  var playStage = document.getElementById("playStage");

  /* ── START handshake ──────────────────────────────────────────────────────
     Capture phase is required: the game's own click handler locks the state and
     swaps the button artwork synchronously, so a bubble-phase hook could miss.
     Fires ONCE per game session, and only for the REAL intro "Let's Go" tap:
       • never during boot or from synthetic/preload clicks (isTrusted check),
       • never while the button is un-armed (.play-ready missing = disabled),
       • never once the game is already running (start-mode gone / state locked). */
  var sentStart = false;
  function sendStart() {
    if (sentStart) { return; }
    sentStart = true;
    post({ source: "lbd", type: "lbd-start" });
  }
  if (startButton) {
    startButton.addEventListener("click", function (e) {
      if (sentStart) { return; }
      if (e && e.isTrusted === false) { return; }
      if (!playStage || !playStage.classList.contains("start-mode")) { return; }
      if (!startButton.classList.contains("play-ready")) { return; }
      if (window.state && window.state.locked) { return; }
      sendStart();
    }, true);
  }
  /* Truth-path fallback: the click relay above only sees a TRUSTED click that
     wins the listener-order race — it goes silent for starts driven by
     assistive/kiosk layers (untrusted clicks), keyboard activation, or engines
     that run target listeners in registration order. But every start path goes
     through the game's own handler, which adds .play-exit to #playStage — its
     single authoritative "the game really started" mutation. Relay THAT.
     attributeOldValue matters: the intro's first scene switch strips the class
     again (sometimes within the same tick), so the removal record's oldValue is
     the only remaining evidence by the time the observer's microtask runs. */
  if (playStage && window.MutationObserver) {
    var startMo = new MutationObserver(function (records) {
      var started = playStage.classList.contains("play-exit");
      for (var i = 0; !started && i < records.length; i++) {
        var old = records[i].oldValue;
        if (old && old.indexOf("play-exit") !== -1) { started = true; }
      }
      if (started) {
        startMo.disconnect();
        sendStart();
      }
    });
    startMo.observe(playStage, { attributes: true, attributeFilter: ["class"], attributeOldValue: true });
  }

  /* ── READY handshake (optional, best-effort) ──────────────────────────────
     Sent once the intro is visually usable — the "Let's Go" button arming
     (.play-ready) is the game's own signal for that. A load+timer fallback
     covers any future flow change; the parent never blocks on this message. */
  var sentReady = false;
  function sendReady() {
    if (sentReady) { return; }
    sentReady = true;
    post({ source: "lbd", type: "lbd-ready" });
    setTimeout(startWarmer, 1000);          // idle warming ~1s after the intro painted
  }
  if (startButton && window.MutationObserver) {
    var mo = new MutationObserver(function () {
      if (startButton.classList.contains("play-ready")) {
        mo.disconnect();
        sendReady();
      }
    });
    mo.observe(startButton, { attributes: true, attributeFilter: ["class"] });
  }
  if (document.readyState === "complete") { setTimeout(sendReady, 1500); }
  else { window.addEventListener("load", function () { setTimeout(sendReady, 1500); }); }

  /* ── COMPLETION handshake ─────────────────────────────────────────────────
     completeGame() is the game's single TRUE success path (called only by
     nextRound() once every round is won — never on pause, fail, restart or
     replay). It shows "Bots Powered Up!" and starts the celebration audio
     (audios/confettiSound.ogg + a synthesized cheer). We wrap it — function
     declarations live on window in this classic script, and nextRound resolves
     the binding at call time — wait for the confetti clip's REAL `ended` event,
     and fall back on its `error` event or a duration-aware watchdog, then post
     completion exactly once. */
  var sentComplete = false;
  function sendComplete() {
    if (sentComplete) { return; }
    sentComplete = true;
    post({ source: "lbd", type: "lbd-complete" });
  }
  function afterCelebration() {
    var fired = false;
    function fire() { if (fired) { return; } fired = true; sendComplete(); }
    var clip = window._confettiAudio || null;   // created by sndConfetti() inside completeGame()
    var watchMs = 8000;                          // duration unknown → generous fixed fallback
    if (clip) {
      if (isFinite(clip.duration) && clip.duration > 0) {
        watchMs = clip.duration * 1000 + 4000;   // known duration + ~4s slack
      }
      clip.addEventListener("ended", fire, { once: true });
      clip.addEventListener("error", fire, { once: true });
    }
    setTimeout(fire, watchMs);                   // safety net — the learner is never trapped
  }
  var _origCompleteGame = window.completeGame;
  if (typeof _origCompleteGame === "function") {
    window.completeGame = function () {
      var r = _origCompleteGame.apply(this, arguments);
      try { afterCelebration(); } catch (e) { sendComplete(); }
      return r;
    };
  }
  /* (If a future engine drops completeGame, the parent still finishes the visit
     from the game's own raw {type:"activity_complete"} message.) */

  /* ── Idle chunked asset warmer ────────────────────────────────────────────
     The game's own boot warms every screen background / UI sprite / round sprite
     (preloadCriticalAssets + preloadRoundAssets — including sprites used only by
     hidden, display:none rounds). What it does NOT warm are the narration and
     SFX audio files (created lazily on first play) and a handful of late-screen
     images. This warmer pulls those in during idle time, in small chunks
     (~3 images / ~2 audio clips per slice), starting ~1s after the intro paints.
     Audio is NEVER played while warming. */
  var AUDIO_EXTRA = [
    "audios/ThemeMusic.ogg",      // theme element exists but preloads lazily
    "audios/PlugConnect.ogg",
    "audios/gateOpen.ogg",
    "audios/laserSound.ogg",
    "audios/flashlight.ogg",
    "audios/clapSound.ogg",
    "audios/confettiSound.ogg"
  ];
  var IMAGE_EXTRA = [
    "assets/play.webp",           // preplay button glyph (not in the game's critical list)
    "assets/Quarter.webp",
    "assets/postLBD.webp",        // the whole end screen is this one image
    "assets/LabGate.webp",        // CSS url() on the gate halves
    "assets/HandNudge.svg",
    "assets/TryAgainButton.webp"
  ];

  function collectAudioUrls() {
    var seen = {};
    var urls = [];
    function add(u) { if (u && !seen[u]) { seen[u] = 1; urls.push(u); } }
    var map = window.INSTRUCTION_AUDIO || {};
    for (var k in map) { if (Object.prototype.hasOwnProperty.call(map, k)) { add(map[k]); } }
    AUDIO_EXTRA.forEach(add);
    return urls;
  }
  function isInstructionUrl(src) {
    var map = window.INSTRUCTION_AUDIO || {};
    for (var k in map) { if (map[k] === src) { return true; } }
    return false;
  }
  function warmFetch(src) {
    // Full-file HTTP caching. The body MUST be consumed: an unread response
    // pins its connection and buffers in renderer memory — a few dozen of those
    // starve the browser's per-host connection pool (and can crash the tab).
    try {
      fetch(src, { cache: "force-cache" })
        .then(function (r) { return r.blob(); })   // read fully, then discard
        .catch(function () {});
    } catch (e) {}
  }
  function warmAudio(src) {
    warmFetch(src);
    // …and, for narration lines, prime the EXACT object the game will play:
    // playInstructionAudio() reuses _instructionAudioCache entries verbatim, and
    // this mirrors its own lazy init (preload auto, volume 0.95) precisely.
    try {
      var cache = window._instructionAudioCache;
      if (cache && isInstructionUrl(src) && !cache[src]) {
        var a = new Audio(src);
        a.preload = "auto";
        a.volume = 0.95;
        cache[src] = a;
      }
    } catch (e) {}
  }
  function warmImage(src) {
    warmFetch(src);
    try {
      if (typeof window.preloadAsset === "function") { window.preloadAsset(src); }  // game's own cache (hard ref + decode)
      else { var img = new Image(); img.src = src; }
    } catch (e) {}
  }

  var idle = window.requestIdleCallback
    ? function (cb) { window.requestIdleCallback(cb, { timeout: 2500 }); }
    : function (cb) { setTimeout(cb, 220); };   // Safari fallback

  var warmerStarted = false;
  function startWarmer() {
    if (warmerStarted) { return; }
    warmerStarted = true;
    // Warm the two eagerly-created singletons' own buffers first (exact objects).
    try {
      if (window._themeAudio) { window._themeAudio.preload = "auto"; window._themeAudio.load(); }
    } catch (e) {}
    try {
      if (window._plugConnectAudio) { window._plugConnectAudio.preload = "auto"; window._plugConnectAudio.load(); }
    } catch (e) {}

    var audioQueue = collectAudioUrls();
    var imageQueue = IMAGE_EXTRA.slice().filter(function (src) {
      return !(window._assetCache && window._assetCache[src]);   // already warmed by the game
    });
    (function pump() {
      if (!audioQueue.length && !imageQueue.length) { return; }
      idle(function () {
        for (var i = 0; i < 3 && imageQueue.length; i++) { warmImage(imageQueue.shift()); }
        for (var j = 0; j < 2 && audioQueue.length; j++) { warmAudio(audioQueue.shift()); }
        pump();
      });
    })();
  }
})();
