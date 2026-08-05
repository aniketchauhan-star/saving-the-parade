/* ============================================================================
   THE STORY NIGHT — flipbook behaviour.
   Diagnostic first: surface any REAL JavaScript error on screen (a silent error
   would stop the click handlers from ever attaching). Image / video / network
   load failures are ignored — they have no .message and are handled per-element.
   ============================================================================ */
window.addEventListener("error", function (ev) {
  if (!ev || !ev.message) return;                 // ignore resource-load errors
  var b = document.getElementById("__jsErr");
  if (!b) {
    b = document.createElement("div");
    b.id = "__jsErr";
    b.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:100000;" +
      "background:#b00020;color:#fff;font:13px/1.5 monospace;padding:10px;white-space:pre-wrap";
    (document.body || document.documentElement).appendChild(b);
  }
  b.textContent = "⚠ JavaScript error (this is likely why the book won't open):\n" +
    ev.message + "\n" + (ev.filename || "") + " : line " + ev.lineno;
});

// If you can read this line in the console, the script parsed with NO syntax
// error and you are running the CURRENT file (not a cached copy).
console.log("%c✅ [The Story Night] loaded — 3D flipbook · full-bleed pages · speech bubbles.",
            "font-weight:bold;color:#7d5fd0;font-size:13px");

/* ============================================================================
   ██  EDIT YOUR CONTENT HERE  ██
   ----------------------------------------------------------------------------
   Every entry below is ONE page of the book, shown in order after the cover.

     • type   : "video"  → a full-page video (e.g. assets/1 page.mp4)
                "image"  → a full-page picture (e.g. assets/3 page.webp)
     • src    : the media file for that page.
     • delay  : (video only, optional) milliseconds to wait after landing on the
                page before the video starts (e.g. delay: 3000 → starts after 3s).
                Omit / 0 → the video starts instantly.
     • bubble : (optional) a speech bubble that POPS IN once the reader has
                FULLY landed on the page. Set:
                   kind     : "neel" (pink) or "everywhere" (glowing) — picks
                              which bubble artwork + crop to use.
                   text     : the words shown inside the bubble.
                   box      : where + how big — { top/left/right/bottom, w }.
                              positions are CSS lengths (e.g. "3%"); w is the
                              bubble WIDTH in book-space px (book is 1280x720).
                   flip     : true → mirror the bubble so its tail points the
                              other way.
                   textLeft / textTop / fontSize : fine-tune the words inside.

   Add / remove / reorder pages freely — the flip engine and the "Page X / N"
   counter update automatically.
   ============================================================================ */
// Each video page has a matching first-frame poster in assets/posters/ so the
// scene shows instantly. Videos are WebM (VP9/Opus) — supported by Chrome, Edge,
// Firefox and recent Safari. Add / remove / reorder pages freely — the flip
// engine and the navigation state update automatically.
const pages = [
  { type: "video", src: "assets/1.webm" },  // 1 — opening video
  { type: "video", src: "assets/2.webm" },  // 2
  { type: "video", src: "assets/3.webm" },  // 3
  // 4 — the embedded LBD game (PowerUp Bots), served from the flipbook's own
  // game/ copy. The leaf shows the game's start-screen poster; the live game is
  // a body-level overlay iframe (see LBD OVERLAY below) warmed in the background
  // after window load. Landing here reveals the already-booted intro INSIDE the
  // page frame; the game's own "Let's Go" tap expands it to fullscreen, and its
  // completion turns the book to the next page automatically.
  // Poster = the game's EMBEDDED boot screen backdrop (LetsPlayBg.webp — the
  // plain lab room), NOT GameStartScreen.webp: that art is a full "Save the
  // Parade" title card, which mid-story read as the book's welcome screen
  // re-appearing. The game (in embed mode) boots onto the same backdrop, so the
  // leaf poster → live-iframe handoff stays seamless.
  { type: "lbd", src: "game/index.html", poster: "game/assets/LetsPlayBg.webp" },
  { type: "video", src: "assets/4.webm" },  // 5
  { type: "end" },                          // 6 — THE END page (cream) + Replay
];

/* ============================================================================
   ██  END OF EDITABLE CONTENT — engine below (no need to change) ██
   ============================================================================ */

/* ---- Build one page face's media (image OR video OR lbd poster) ---------- */
function makeMedia(page) {
  // "lbd" pages show a STILL poster on the leaf itself (seen while the page turns);
  // the live, interactive game is a separate full-screen-capable overlay iframe
  // (see the LBD OVERLAY section below) — it can't live inside the 3D-transformed
  // leaf because CSS transforms trap position:fixed, so true fullscreen would fail.
  if (page.type === "lbd") {
    const img = document.createElement("img");
    img.className = "page-media";
    img.draggable = false;
    img.addEventListener("dragstart", function (e) { e.preventDefault(); });
    img.decoding = "async";
    img.src = page.poster || "";
    img.alt = "PowerUp Bots — tap Start to play";
    return img;
  }
  const media = page.type === "video"
    ? document.createElement("video")
    : document.createElement("img");
  media.className = "page-media";
  media.draggable = false;                           // never let the image "ghost-drag" out
  media.addEventListener("dragstart", function (e) { e.preventDefault(); });
  media.src = page.src;
  if (page.type === "video") {
    media.loop = false;
    media.playsInline = true;
    media.setAttribute("playsinline", "");            // iOS Safari inline playback
    media.setAttribute("webkit-playsinline", "");
    // FIRST-FRAME POSTER: the page surface (--paper) is deep night-blue, so a video
    // that hasn't painted a frame yet (still buffering, or autoplay was blocked) would
    // show as a BLANK dark-blue page. The poster is that clip's own frame 0, so the
    // scene shows INSTANTLY and — because it equals where playback starts — there's no
    // jump when the video then plays. Posters are tiny (~40KB) and live in assets/posters/.
    media.setAttribute("poster",
      page.src.replace(/^assets\//, "assets/posters/").replace(/\.(webm|mp4)$/i, ".webp"));
    // LAZY: do NOT eager-buffer. With 25 videos, preload="auto" made the browser
    // open + decode every clip on load (huge memory/CPU spike + open lag). We only
    // buffer the page you're on + the next one, on demand (see warmVideo()).
    media.preload = "none";
    // Tap the video to (re)start it WITH sound — a guaranteed user gesture, so
    // browsers that blocked the auto-start's audio will now allow it.
    media.addEventListener("click", function () {
      media.muted = false;
      try { if (media.ended) media.currentTime = 0; } catch (_) {}
      const p = media.play(); if (p && p.catch) p.catch(function () {});
    });
    // When THIS page's video FULLY finishes, schedule the page-turn tutorial.
    // The forward arrow's own "you may turn now" GLOW PULSE is not fired here: it
    // belongs to the gate release (openPageGate → pulseNextArrow), so the cue also
    // plays when the arrow is revealed by the error / watchdog route.
    media.addEventListener("ended", function () {
      if (!opened || !ready || lbdFullscreen || flipped >= totalPages - 1) return;
      if (!leaves[flipped] || !leaves[flipped].contains(media)) return;   // only the current page
      // PAGE-TURN TUTORIAL: 5s after THIS page's video finishes, start the nudge
      // (hand swipe + ghost page-flip + blinking arrow), repeating while idle. On a
      // video page the tutorial is held back until the clip ends — see resetIdleHint.
      clearTimeout(idleHintTimer);
      idleHintTimer = setTimeout(triggerHint, VIDEO_END_HINT_MS);
    });
  } else {
    media.decoding = "async";
    media.alt = page.alt || "story page";
  }
  return media;
}

/* ---- Build one speech bubble (hidden until the page fully lands) ---------
   The bubble artwork + crop live in styles.css (.bubble.neel / .bubble.everywhere).
   Here we only apply the per-page geometry (position, width, flip) + the text. */
function makeBubble(bubble) {
  const wrap = document.createElement("div");
  wrap.className = "bubble" + (bubble.kind ? " " + bubble.kind : "");

  const box = bubble.box || {};
  ["top", "left", "right", "bottom"].forEach(function (k) {
    if (box[k] != null) wrap.style[k] = box[k];
  });
  if (box.w != null) wrap.style.setProperty("--w", box.w + "px");

  const bg = document.createElement("div");
  bg.className = "bubble-bg" + (bubble.flip ? " flip" : "");
  wrap.appendChild(bg);

  if (bubble.text) {
    const t = document.createElement("div");
    t.className = "bubble-text";
    t.textContent = bubble.text;
    if (bubble.textLeft) t.style.left = bubble.textLeft;
    if (bubble.textTop)  t.style.top  = bubble.textTop;
    if (bubble.fontSize) t.style.fontSize = bubble.fontSize;
    wrap.appendChild(t);
  }
  return wrap;
}

/* ---- Build one SVG speech bubble (white + black outline + purple glow) -----
   cfg = { text, box:{top,left,right,bottom,w}, tail, rot, fontSize }
     box   : position of the bubble box + its WIDTH in book-space px
     tail  : "down" | "down-left" | "down-right"  (which way the tail points)
     rot   : tilt in degrees (optional)
   Hidden until the page lands (revealed by refreshMedia). */
const SBUB_TAILS = {
  "down":       "M42 57 L58 57 L50 73 Z",
  "down-left":  "M30 55 L47 59 L16 73 Z",
  "down-right": "M53 59 L70 55 L84 73 Z"
};
function makeSpeechBubble(cfg) {
  const wrap = document.createElement("div");
  wrap.className = "sbub";
  const box = cfg.box || {};
  ["top", "left", "right", "bottom"].forEach(function (k) {
    if (box[k] != null) wrap.style[k] = box[k];
  });
  if (box.w != null) wrap.style.setProperty("--sbw", box.w + "px");
  if (cfg.rot)       wrap.style.setProperty("--sbrot", cfg.rot + "deg");

  const tailPath = SBUB_TAILS[cfg.tail] || SBUB_TAILS.down;
  wrap.innerHTML =
    '<svg class="sbub-svg" viewBox="0 0 100 74" aria-hidden="true">' +
      '<g class="sbub-shape">' +
        '<path d="' + tailPath + '"/>' +
        '<ellipse cx="50" cy="32" rx="47" ry="29"/>' +
      '</g>' +
    '</svg>';

  const t = document.createElement("div");
  t.className = "sbub-text";
  t.textContent = cfg.text || "";
  if (cfg.fontSize) t.style.fontSize = cfg.fontSize + "px";
  wrap.appendChild(t);
  return wrap;
}

/* ---- Build the pages (one CSS 3D "leaf" per entry) ---------------------- */
const flipbookEl  = document.getElementById("flipbook");
const pageStackEl = flipbookEl ? flipbookEl.querySelector(".page-stack") : null;   // right-side page stack
const flipScaleEl = document.getElementById("flipScale");
const coverScene  = document.getElementById("coverScene");
// ONE full 16:9 page per view (single display). page 1 = entry 1. The themed
// book frame forms the left spine/cover edge (always visible when open); pages
// flip normally. No two-page spread.
const totalPages = pages.length;
// Which leaf is the embedded LBD game (-1 if none). Used to show/hide the overlay.
const LBD_INDEX = pages.findIndex(function (p) { return p.type === "lbd"; });

// Each leaf is a full 16:9 page hinged on the LEFT spine:
//   • FRONT = the page's full-bleed image / video (+ its speech bubble, if any).
//   • BACK  = a BLANK parchment sheet (seen edge-on while the page turns).
const leaves = [];
pages.forEach(function (page, i) {
  const leaf = document.createElement("div");
  leaf.className = "leaf";

  const front = document.createElement("div");
  front.className = "face front";
  if (page.type === "end") {
    // THE END — a real final page (cream "paper") with a gold-plum title + Replay.
    front.classList.add("end-page");
    front.innerHTML =
      '<div class="end-page-inner">' +
        '<div class="end-title">THE&nbsp;END</div>' +
        '<button class="replay-btn" id="replayBtn" type="button" aria-label="Replay from the beginning">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true">' +
            '<path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>' +
          '</svg>' +
          '<span>Replay</span>' +
        '</button>' +
      '</div>';
  } else {
    front.appendChild(makeMedia(page));                       // full-bleed image / video
    if (page.bubble) front.appendChild(makeBubble(page.bubble));  // PNG speech bubble (revealed on land)
  }
  const curl = document.createElement("div");               // moving page-curl shading
  curl.className = "curl";
  front.appendChild(curl);

  const back = document.createElement("div");
  back.className = "face back";                             // blank reverse side (no content)

  leaf.appendChild(front);
  leaf.appendChild(back);
  flipbookEl.appendChild(leaf);
  leaves.push(leaf);
});

/* ---- State + element references ----------------------------------------- */
const bookStage  = document.getElementById("bookStage");
const book       = document.getElementById("book");
const bookPop    = document.getElementById("bookPop");
const bookFloat  = document.getElementById("bookFloat");
const cover      = document.getElementById("cover");
const hint       = document.getElementById("hint");
const cornerPrev  = document.getElementById("cornerPrev");
const cornerNext  = document.getElementById("cornerNext");
const replayBtn   = document.getElementById("replayBtn");   // lives on the THE END page (built above)

/* ==========================================================================
   LBD OVERLAY  —  the PowerUp Bots game embedded as one page.
   The game lives in a body-level iframe (#lbdStage) so it can grow to true
   fullscreen (a transform on .flip-scale would otherwise trap position:fixed).
   • warm-up  : the iframe is loaded HIDDEN during idle time after window load
                (the game is silent on boot — audio starts only on its own
                "Let's Go" tap), so landing on the game page shows the intro
                instantly with no spinner.
   • pre-LBD  : the overlay is sized/positioned OVER the current page rectangle,
                so the game's home screen looks like it's printed inside the book.
                No fullscreen yet — the reader can interact with the intro.
   • start    : the game (via embed-bridge.js) posts {source:"lbd", type:"lbd-start"}
                on the real "Let's Go" tap → the overlay morphs from the page frame
                to true viewport fullscreen; all flipbook chrome hides.
   • complete : the game's win screen is terminal, so completion only REVEALS the
                overlay's own "Next" button (the raw {type:"activity_complete"} or
                the bridge's {source:"lbd", type:"lbd-complete"}, whichever lands
                first, after a short beat so the celebration can land). Nothing
                moves on its own — the reader taps Next.
   • next     : that tap shrinks the overlay back into the page frame, turns the
                book to the next story page, and tears the iframe down to
                about:blank (killing all game audio/timers) then re-warms it from
                cache so a revisit starts instantly on a fresh intro.
   ========================================================================== */
const lbdStage   = document.getElementById("lbdStage");
const lbdFrame   = document.getElementById("lbdFrame");
const lbdNextBtn = document.getElementById("lbdNextBtn");
let lbdFullscreen = false;   // is the overlay expanded to full screen right now?
let lbdStarted    = false;   // has the child tapped "Let's Go" this visit?
let lbdWasOn      = false;   // was the overlay showing on the previous refresh?
let lbdExiting    = false;   // guard so "complete" only advances once
let lbdCompleted  = false;   // has the game reported complete this visit?
let lbdGameReady  = false;   // has the game painted its intro (lbd-ready) this visit?
let lbdWarmTimer  = null;    // pending idle-warm handle ({ric:id} or {t:id})
// Beat between "the game says it's done" and the Next button popping in: lets the
// win screen + confetti land, and stops a stray tap from the last move landing on
// a button that appeared under the finger.
const LBD_NEXT_DELAY_MS = 1100;
let _lbdNextTimer = null;    // pending Next-button reveal

// Show the pre-LBD backdrop inside the frame while the game boots (and while it's
// unloaded) so there is no dark flash — it matches the game's own start screen,
// so the live intro fades in seamlessly.
if (lbdFrame && LBD_INDEX >= 0 && pages[LBD_INDEX].poster) {
  lbdFrame.style.background = "#0a0f2d url('" + pages[LBD_INDEX].poster + "') center/cover no-repeat";
}

/* ---- Background warm-up (Stage B) ----------------------------------------
   The game is SILENT on boot (verified: its theme music starts only inside its
   own "Let's Go" click handler), so the live iframe can be booted hidden. It is
   scheduled during idle time after the flipbook's window `load` event so it never
   competes with the shell's critical loading path. The hidden iframe cannot steal
   input: the overlay is visibility:hidden + pointer-events:none until revealed. */
function warmLbd() {
  if (LBD_INDEX < 0 || !lbdFrame || lbdFrame.dataset.loaded) return;
  lbdFrame.src = pages[LBD_INDEX].src;
  lbdFrame.dataset.loaded = "1";
}
function cancelLbdWarm() {
  if (!lbdWarmTimer) return;
  if (lbdWarmTimer.ric && window.cancelIdleCallback) cancelIdleCallback(lbdWarmTimer.ric);
  if (lbdWarmTimer.t) clearTimeout(lbdWarmTimer.t);
  lbdWarmTimer = null;
}
function scheduleLbdWarm(delayMs) {
  if (LBD_INDEX < 0 || !lbdFrame || lbdFrame.dataset.loaded) return;
  cancelLbdWarm();
  const go = function () { lbdWarmTimer = null; warmLbd(); };
  // Minimum settle delay BEFORE the idle callback: a game (re)boot fires dozens
  // of warm requests at once, so give page-turn media a moment to breathe —
  // rapid page flipping must never stack overlapping reload bursts.
  const settle = Math.max(1500, delayMs || 0);
  lbdWarmTimer = {
    t: setTimeout(function () {
      if (window.requestIdleCallback) {
        lbdWarmTimer = { ric: requestIdleCallback(go, { timeout: 6000 }) };
      } else {
        go();                                              // Safari fallback
      }
    }, settle),
  };
}
if (document.readyState === "complete") scheduleLbdWarm();
else window.addEventListener("load", function () { scheduleLbdWarm(); });

// Unload the game (kills all its audio, timers and rAF loops instantly) and
// immediately schedule a silent cache-backed re-warm so the NEXT visit starts
// fresh at the intro with no load hitch.
function resetLbd() {
  if (!lbdFrame) return;
  lbdStarted = false;
  lbdCompleted = false;
  lbdGameReady = false;
  if (lbdStage) lbdStage.classList.remove("game-ready");
  hideLbdNext();                          // a stale Next must never greet a revisit
  cancelLbdWarm();
  lbdFrame.src = "about:blank";
  lbdFrame.dataset.loaded = "";
}
// Park the overlay exactly over the on-screen page rectangle (pre-LBD look).
function positionLbdStage() {
  if (!lbdStage) return;
  const r = flipScaleEl.getBoundingClientRect();   // the scaled 1280×720 page area
  lbdStage.style.left   = r.left   + "px";
  lbdStage.style.top    = r.top    + "px";
  lbdStage.style.width  = r.width  + "px";
  lbdStage.style.height = r.height + "px";
}
let lbdAnimTimer = null;
function setLbdFullscreen(on) {
  if (!lbdStage) return;
  lbdFullscreen = on;
  // The game has its OWN music (its theme track), so silence the flipbook's
  // background music while the game is up, then bring it back on the way out.
  try { if (on) { bgMusic.pause(); } } catch (_) {}
  if (on) { hideFlipHint(); clearTimeout(idleHintTimer); clearTimeout(nudgeHideTimer); }
  positionLbdStage();                        // make the inline page-rect geometry current
  lbdStage.classList.add("lbd-anim");        // turn the box-morph transition ON for this toggle
  void lbdStage.offsetWidth;                 // commit, so the class change below animates from here
  lbdStage.classList.toggle("fullscreen", on);   // expand to / shrink from full screen
  document.body.classList.toggle("lbd-is-fullscreen", on);
  clearTimeout(lbdAnimTimer);
  lbdAnimTimer = setTimeout(function () { lbdStage.classList.remove("lbd-anim"); }, 460);
  updateNavState();
}
// Reveal the (already warmed) overlay once we've fully landed on the LBD page —
// sized to the page frame, NOT fullscreen (fullscreen waits for the game's own
// "Let's Go" tap). Hide + tear down + re-warm the moment we leave the page.
function updateLbdOverlay() {
  if (LBD_INDEX < 0 || !lbdStage) return;
  const onLbd = opened && ready && !animating && flipped === LBD_INDEX;
  if (onLbd) {
    warmLbd();                            // no-op if the idle warm already ran
    if (!lbdFullscreen) positionLbdStage();
    lbdStage.classList.add("visible");
    lbdStage.setAttribute("aria-hidden", "false");
    lbdWasOn = true;
    // Suppress the idle page-turn hints while the game page is on show.
    hideFlipHint(); clearTimeout(idleHintTimer); clearTimeout(nudgeHideTimer);
  } else if (!lbdFullscreen) {           // never hide mid-game (fullscreen blocks page turns)
    lbdStage.classList.remove("visible");
    lbdStage.setAttribute("aria-hidden", "true");
    if (lbdWasOn) {
      lbdWasOn = false;
      resetLbd();                         // stops all game audio immediately
      scheduleLbdWarm(900);               // fresh intro is ready for a revisit
    }
  }
}
/* ---- End-of-game NEXT button --------------------------------------------
   The win screen has no exit of its own, so the overlay carries one. It is only
   ever armed by finishLbd() (i.e. the game really reported completion) and is
   torn down again by every route out of the page — leaving, Home, Replay. */
function showLbdNext() {
  if (!lbdNextBtn) return;
  lbdNextBtn.disabled = false;                    // [disabled] keeps it display:none
  lbdNextBtn.classList.add("show");
  lbdNextBtn.setAttribute("aria-hidden", "false");
  // Pull keyboard focus out of the finished game so Enter/Space works right away.
  try { lbdNextBtn.focus({ preventScroll: true }); } catch (_) {}
}
function hideLbdNext() {
  clearTimeout(_lbdNextTimer); _lbdNextTimer = null;
  if (!lbdNextBtn) return;
  lbdNextBtn.classList.remove("show");
  lbdNextBtn.setAttribute("aria-hidden", "true");
  lbdNextBtn.disabled = true;
}
// Next tapped: shrink the overlay back into the page frame, then turn to the next
// story page. Game input is ignored during the closing morph.
function exitLbd() {
  if (lbdExiting) return;
  lbdExiting = true;
  hideLbdNext();                          // the button goes with the game
  playBgMusic();                          // bring the flipbook's background music back
  lbdStage.style.pointerEvents = "none";  // no game input while the overlay closes
  if (lbdFullscreen) {
    setLbdFullscreen(false);              // animated morph back into the page rect
  }
  setTimeout(function () {
    lbdStage.style.pointerEvents = "";
    if (flipped === LBD_INDEX) goNext();  // turn the page; leaving the page then hides,
                                          // resets and re-warms the iframe + re-arms the
                                          // new page's video gate (refreshMedia)
    lbdExiting = false;
  }, 470);
}
// Completion is handled EXACTLY once per visit, whichever message arrives: it
// arms the Next button (after a short beat) and nothing else — the reader decides
// when to leave the win screen.
function finishLbd() {
  if (lbdCompleted || lbdExiting) return;
  lbdCompleted = true;
  // The game page's forward gate is earned ONLY here — completion. This also stops
  // the "never booted" watchdog and makes the page count as cleared, so coming back
  // to it later shows both arrows instead of demanding a second play-through.
  if (LBD_INDEX >= 0) {
    markGateCleared(LBD_INDEX);
    if (flipped === LBD_INDEX) { clearPageGate(); gateDone = true; updateNavState(); }
  }
  clearTimeout(_lbdNextTimer);
  _lbdNextTimer = setTimeout(function () {
    _lbdNextTimer = null;
    showLbdNext();
  }, LBD_NEXT_DELAY_MS);
}
if (lbdNextBtn) {
  lbdNextBtn.addEventListener("click", function () {
    if (lbdExiting) return;               // already on the way out
    exitLbd();
  });
}
// Listen for the game's messages. Only messages that really come from OUR iframe
// are honoured (event.source check) and the bridge additionally stamps
// data.source === "lbd". Completion arrives twice — the engine's own raw
// {type:"activity_complete"} first, the bridge's lbd-complete after the
// celebration audio — and finishLbd() de-duplicates them.
window.addEventListener("message", function (e) {
  const d = e && e.data;
  if (!d || !lbdFrame) return;
  if (e.source !== lbdFrame.contentWindow) return;      // must be the active LBD iframe
  const fromBridge = d.source === "lbd";
  if (fromBridge && d.type === "lbd-ready") {
    lbdStage.classList.add("game-ready");               // intro painted inside the iframe
    lbdGameReady = true;                                // the game is alive → only completion
    if (gateIdx === LBD_INDEX) {                        // opens its gate, no timed escape
      clearTimeout(gateTimer); gateTimer = null;
    }
    return;
  }
  if (fromBridge && d.type === "lbd-start") {
    // Fullscreen only from the game page, only once, never during the exit morph.
    if (flipped !== LBD_INDEX || lbdFullscreen || lbdExiting || !opened) return;
    lbdStarted = true;
    setLbdFullscreen(true);
    return;
  }
  if (fromBridge && d.type === "lbd-complete") {
    finishLbd();
    return;
  }
  if (d.type === "activity_complete") {
    // Raw engine message — fires the moment the win screen appears, so this is
    // normally what arms the Next button; the bridge's later lbd-complete (posted
    // when the celebration audio really ends) is then a no-op. Either message on
    // its own is enough, so a missing bridge never strands the reader.
    finishLbd();
  }
});

/* ---- Fullscreen watchdog (belt-and-suspenders for lbd-start) --------------
   The bridge's lbd-start relay hooks the game's internals, and a missed relay
   (stale cached bridge, an input layer it can't see) leaves the reader playing
   the whole game trapped inside the page frame. The iframe is same-origin, so
   the parent can check the truth directly: the game's FLOW step is 0 on the
   armed start screen and only ever advances through its own start handler. If
   the game is past its start screen while the overlay is still parked in the
   page frame, engage fullscreen exactly as a real lbd-start would. */
setInterval(function () {
  if (LBD_INDEX < 0 || !lbdFrame || !lbdStage) return;
  if (!opened || flipped !== LBD_INDEX || lbdFullscreen || lbdExiting) return;
  if (!lbdStage.classList.contains("visible")) return;
  try {
    var w = lbdFrame.contentWindow;
    if (w && w.state && typeof w.state.step === "number" && w.state.step >= 1) {
      lbdStarted = true;
      setLbdFullscreen(true);
    }
  } catch (_) { /* frame mid-navigation / inaccessible — try again next tick */ }
}, 700);

let opened = false;      // has the cover been opened?
let ready  = false;      // has the cover FINISHED opening? (flips allowed only then)
let flipped = 0;         // how many leaves are currently turned to the left
let animating = false;   // guard so a new turn can't start mid-flip
const FLIP_MS = 1150;    // keep in sync with --flip-ms in styles.css
const COVER_OPEN_MS = 6000;  // keep in sync with the coverOpen animation in styles.css
const CLOSE_SETTLE_MS = 560;  // keep in sync with the bookSettle animation in styles.css
const COVER_CLOSE_MS  = 2000; // Home/Replay: cover swings shut (reverse open); sync with coverClose in styles.css
let _openTimer = null;   // pending "cover finished opening" timer
let _homeTimer = null;   // pending "cover finished closing → back to the cover" timer

/* A hidden probe carrying the SAME tokens as a corner-arrow lane, so the space
   the chrome really occupies is resolved by the BROWSER (clamp / min / env all
   applied) and styles.css stays the single source of truth. The arrows cannot be
   measured directly here: they are display:none until body.is-open, and
   fitScale() runs on boot, long before that — a getBoundingClientRect() on them
   would read 0 and reserve nothing. */
const ctlProbe = document.createElement("div");
ctlProbe.setAttribute("aria-hidden", "true");
ctlProbe.style.cssText =
  "position:absolute;left:-9999px;top:0;visibility:hidden;pointer-events:none;" +
  "width:calc(var(--edge-l) + var(--ctl) + var(--ctl-gap));" +
  "height:calc(var(--edge-b) + var(--ctl) + var(--ctl-gap));";
document.body.appendChild(ctlProbe);

/* ---- Responsive: scale the FIXED 1280x720 book to fit the viewport --------
   Base fit — 88% of width / 80% of height — for breathing space at the edges.
   On top of that the book must never OVERLAP the bottom-corner arrows. The old
   guard reserved a hardcoded 64px per side, but --ctl grows to 112px plus its
   --edge-b inset, so from ~1280x800 up the book's bottom corners ran straight
   under the arrows (at 1280x800 the overlap was ~50px across and ~30px deep).
   The reserve is now MEASURED from the probe above instead of guessed.
   The arrows live in the bottom CORNERS, so an overlap needs the book to reach
   them on BOTH axes — clearing EITHER one is enough. So the book may be narrow
   enough to stay inside the lanes, OR short enough to stay above the band,
   whichever allows the LARGER book. That keeps 1920x1080 (which already cleared
   horizontally) at exactly its previous size instead of shrinking it needlessly.
   Only this CSS transform scale changes, so the paper curl is never distorted. */
function fitScale() {
  const lane = ctlProbe.getBoundingClientRect();
  const reserveX = lane.width  || 84;                // fall back to a sane band if the
  const reserveY = lane.height || 84;                // probe is somehow unstyled

  const baseS = Math.min(
    (window.innerWidth  * 0.88) / 1280,              // breathing space, left + right
    (window.innerHeight * 0.80) / 720
  );
  const clearsX = (window.innerWidth  - reserveX * 2) / 1280;   // book stays inside the lanes
  const clearsY = (window.innerHeight - reserveY * 2) / 720;    // book stays above the band
  const s = Math.max(0.1, Math.min(baseS, Math.max(clearsX, clearsY)));

  flipScaleEl.style.setProperty("--book-scale", s.toFixed(4));
  // keep the page-turn hint glued to the forward arrow when the viewport changes
  if (flipHint && flipHint.classList.contains("show")) positionFlipHint();
}

/* ---- Render / stacking for the CSS leaf flip ---------------------------- */
// A TURNED leaf sits to the left (rotateY -180deg, showing its blank back over
// the cover); an UN-turned leaf lies flat on top of the cover. z-index keeps the
// current (top un-turned) page in front, and stacks more-recently turned leaves
// above earlier ones on the left pile.
function updateZ() {
  leaves.forEach(function (leaf, i) {
    leaf.style.zIndex = (i < flipped) ? (200 + i) : (100 - i);
  });
}
function renderLeaves() {
  leaves.forEach(function (leaf, i) {
    if (i < flipped) leaf.classList.add("flipped");
    else             leaf.classList.remove("flipped");
  });
  updateZ();
  windowLeaves();
}

/* ---- GPU page windowing ---------------------------------------------------
   Only the current leaf and its immediate neighbours (the minimum needed for a
   believable page turn, in either direction) stay renderable. Every other leaf
   releases its GPU layer: visibility:hidden + will-change:auto + pointer-events:
   none (via .win-off — see styles.css). display:none is deliberately NOT used:
   the leaves' stacking/layout must survive for the flip engine. Re-windowed on
   every page arrival, flip settle, Home/Replay, LBD open/close and resize. */
function windowLeaves() {
  leaves.forEach(function (leaf, i) {
    leaf.classList.toggle("win-off", Math.abs(i - flipped) > 1);
  });
}

/* ---- Per-page media -----------------------------------------------------
   Play the CURRENT page's video (pause every other), and pop the current page's
   speech bubble in ONCE, only after the page has fully settled. Called after
   each flip completes and once the cover has finished opening. */
let mediaDelayTimer = null;   // pending "start this video after N ms" timer
let mediaDelayIdx = -1;       // which page that pending timer belongs to
let lastMediaIdx = -1;        // last page refreshMedia handled (to arm the blink once)
let armBlink = false;         // allow the video-end arrow blink ONCE per page arrival

function playVideoNow(v) {
  try {
    v.preload = "auto";                       // make sure it's buffering before we play
    if (v.ended) v.currentTime = 0;
    v.muted = false;                          // try WITH sound (primed in the Play gesture)
    const p = v.play();
    if (p && p.catch) p.catch(function () { v.muted = true; v.play().catch(function () {}); });
  } catch (_) {}
}

/* Buffer ONE page's video on demand (only the current + next page are ever
   warmed, so we never spin up all 25 decoders at once). */
function warmVideo(i) {
  const leaf = leaves[i];
  if (!leaf) return;
  const v = leaf.querySelector("video.page-media");
  if (v && v.preload !== "auto") { v.preload = "auto"; try { v.load(); } catch (_) {} }
}

/* Unlock ONE page's video for instant, sound-enabled playback: a muted
   play()→pause() done INSIDE a user gesture. We prime only the page being shown
   and the next one — priming all 25 at once was the opening lag. */
function primeVideo(i) {
  const leaf = leaves[i];
  if (!leaf) return;
  const v = leaf.querySelector("video.page-media");
  if (!v || v.dataset.primed) return;
  v.dataset.primed = "1";
  try {
    v.muted = true; v.preload = "auto";
    const p = v.play();                       // start within the gesture → element is "activated"
    if (p && p.catch) p.catch(function () {});
    v.pause();                                // pause synchronously
    v.currentTime = 0;
  } catch (_) {}
}

function refreshMedia() {
  const idx = flipped;                         // the front-most page right now
  if (idx !== lastMediaIdx) {                  // ARRIVAL on a new page (once per visit)
    lastMediaIdx = idx;
    armBlink = true;                           // arm the video-end blink once per page
    armPageGate(idx);                          // re-arm / release the forward video gate
  }
  // Left the page a delayed video was counting down on? Cancel that countdown.
  if (mediaDelayTimer && mediaDelayIdx !== idx) {
    clearTimeout(mediaDelayTimer); mediaDelayTimer = null; mediaDelayIdx = -1;
  }
  // Buffer + gesture-unlock ONLY this page and the next (so the upcoming flip is
  // instant and keeps sound) — never all 25 videos at once.
  warmVideo(idx); warmVideo(idx + 1); primeVideo(idx + 1);
  // Pause every video that is NOT the current page.
  leaves.forEach(function (leaf, i) {
    if (i === idx) return;
    const v = leaf.querySelector("video.page-media");
    if (v) { try { v.pause(); } catch (_) {} }
  });
  // Start (or schedule) the current page's video.
  const cur = leaves[idx];
  const v = cur && cur.querySelector("video.page-media");
  if (v) {
    const delayMs = (pages[idx] && pages[idx].delay) ? pages[idx].delay : 0;
    if (delayMs > 0) {
      // Already playing this page, or already counting down for it → leave it alone
      // (so the flip-start + flip-end calls don't restart the 3s countdown).
      if (mediaDelayIdx === idx && (mediaDelayTimer || !v.paused)) { /* keep going */ }
      else {
        try { v.pause(); v.currentTime = 0; } catch (_) {}   // hold on the first frame
        mediaDelayIdx = idx;
        mediaDelayTimer = setTimeout(function () {
          mediaDelayTimer = null;
          if (flipped === idx) playVideoNow(v);               // only if still on this page
        }, delayMs);
      }
    } else {
      playVideoNow(v);                          // no delay → instant
    }
  }
  const bub = cur && cur.querySelector(".bubble");
  if (bub && !bub.dataset.revealed) {           // reveal once — "for one time"
    bub.dataset.revealed = "1";
    bub.classList.add("revealed");
  }
  updateLbdOverlay();                           // show/hide the embedded LBD game
  // Right-side page stack shrinks toward the end: 3 sheets → … → 0 on the last page.
  if (pageStackEl) pageStackEl.dataset.count = String(Math.max(0, Math.min(3, totalPages - 1 - flipped)));
  // Restart the idle → page-turn-hint countdown for the page we've just landed on
  // (uses the NEW `flipped`, so the delay is right: 5s on page 1, 10s afterwards).
  if (typeof resetIdleHint === "function") resetIdleHint();
}

/* ==========================================================================
   VIDEO GATE  —  universal forward-navigation lock for video pages.
   Every page that owns a video arms this gate on its FIRST arrival: forward
   navigation (Next button, keyboard, swipe, page-corner drag, programmatic turns)
   stays blocked until ONE of three release paths fires — the video's `ended`
   event, its `error` event, or a watchdog timeout (duration + ~4s, or 30s when
   the duration is unknown).
   ONCE CLEARED, A PAGE STAYS CLEARED for the rest of the read (gateCleared): going
   back and forward again shows Back AND Next straight away, so nobody has to sit
   through a clip — or the game — a second time. A fresh read (Replay → the cover)
   wipes the record, so the gates arm again from page 1.
   The GAME page is gated too: see armPageGate / finishLbd.
   Pages without a video (image / THE END) are never locked. Back stays available
   at all times while a page video is playing.
   ========================================================================== */
let gateDone  = true;     // may the reader navigate FORWARD from the current page?
let gateIdx   = -1;       // which page the armed gate belongs to
let gateTimer = null;     // watchdog timeout
let gateVideo = null;     // the <video> being watched
const gateCleared = new Set();   // page indices whose gate is satisfied for this read
const GATE_UNKNOWN_MS = 30000;   // watchdog when the media duration is unknown
const GATE_EXTRA_MS   = 4000;    // slack added on top of a known duration
// Safety net for the GAME page only: if the embedded game never even reports that
// it painted its intro (`lbd-ready`), the reader would be trapped with no route
// forward — so release that page's gate. A game that DOES boot is never skippable:
// the gate then opens only on real completion.
const GATE_LBD_STUCK_MS = 25000;

/* ---- First story page: the Next arrow is fully HIDDEN (not just disabled)
   until BOTH the page video finishes AND the page's required interaction is
   done. Page 1 of this book has no configured clickable task, so per spec the
   interaction flag starts complete; the video gate is the live requirement. */
const FIRST_PAGE_HAS_INTERACTION = false;   // page 1 has no required interaction configured
let firstPageVideoCompleted = false;
let firstPageInteractionCompleted = !FIRST_PAGE_HAS_INTERACTION;
function updateFirstPageNextArrow() {
  if (!cornerNext) return;
  const canShowNext = firstPageVideoCompleted && firstPageInteractionCompleted;
  cornerNext.classList.toggle("is-visible", canShowNext);
  cornerNext.disabled = !canShowNext;
  cornerNext.setAttribute("aria-hidden", String(!canShowNext));
}
// Call when the first page's required interaction is genuinely completed (kept
// for pages that configure one; starting or mis-tapping must NOT call this).
function completeFirstPageInteraction() {
  firstPageInteractionCompleted = true;
  if (flipped === 0) updateNavState();
}

/* ---- "You may turn the page now" cue ------------------------------------
   The moment the gate opens and the forward arrow appears, it pops in and then
   GLOW-PULSES for a beat (a brightening teal halo — see .glow-pulse in
   styles.css), then settles back into its normal look. Fires at most ONCE per
   page arrival (armBlink), so a very short clip can't pulse over and over, and
   never on a revisit — there the arrow was already sitting there. */
const GLOW_PULSE_MS = 2380;      // reveal (400ms) + 3 × 660ms pulses, keep in sync with CSS
let _glowPulseTimer = null;
function stopNextArrowPulse() {
  clearTimeout(_glowPulseTimer); _glowPulseTimer = null;
  if (cornerNext) cornerNext.classList.remove("glow-pulse");
}
function pulseNextArrow() {
  if (!cornerNext || !armBlink) return;                    // already cued this visit
  if (!cornerNext.classList.contains("is-visible") || cornerNext.disabled) return;
  armBlink = false;
  stopNextArrowPulse();
  void cornerNext.offsetWidth;                             // restart the animation cleanly
  cornerNext.classList.add("glow-pulse");
  _glowPulseTimer = setTimeout(function () {
    _glowPulseTimer = null;
    if (cornerNext) cornerNext.classList.remove("glow-pulse");   // back to the normal state
  }, GLOW_PULSE_MS);
}

function clearPageGate() {
  clearTimeout(gateTimer); gateTimer = null;
  if (gateVideo) {
    gateVideo.removeEventListener("ended", _onGateRelease);
    gateVideo.removeEventListener("error", _onGateRelease);
    gateVideo.removeEventListener("loadedmetadata", _onGateMeta);
    gateVideo = null;
  }
  gateIdx = -1;
}
// Remember that this page's requirement is met, so a revisit never re-locks it.
function markGateCleared(idx) {
  if (idx < 0) return;
  gateCleared.add(idx);
  if (idx === 0) firstPageVideoCompleted = true;
}
function openPageGate(why) {
  const idx = gateIdx;
  clearPageGate();
  gateDone = true;
  markGateCleared(idx);
  updateNavState();
  pulseNextArrow();          // the arrow has just been revealed → glow-pulse once
}
function _onGateRelease() { if (!gateDone) openPageGate("media"); }
function _onGateMeta() {
  // Duration became known after arming — tighten the 30s default watchdog.
  if (gateVideo && !gateDone) armGateWatchdog(gateVideo);
}
function armGateWatchdog(v) {
  clearTimeout(gateTimer);
  const known = v && isFinite(v.duration) && v.duration > 0;
  const ms = known ? v.duration * 1000 + GATE_EXTRA_MS : GATE_UNKNOWN_MS;
  const idxAtArm = gateIdx;
  gateTimer = setTimeout(function () {
    if (gateIdx === idxAtArm && !gateDone) openPageGate("watchdog");
  }, ms);
}
// Re-arm (or open) the gate for the page we just arrived on. Stale timers and
// listeners from the previous page are always cleared first, so a leftover
// watchdog can never unlock the wrong page.
function armPageGate(idx) {
  clearPageGate();
  // ALREADY EARNED on an earlier visit → this page stays unlocked. Both arrows are
  // available the moment the reader lands back on it; the clip still replays, but
  // watching it out is no longer a condition of moving on.
  if (gateCleared.has(idx)) {
    gateDone = true;
    if (idx === 0) firstPageVideoCompleted = true;
    updateNavState();
    return;
  }
  if (idx === 0) {
    // First visit to the first page: arm its dual gate.
    firstPageVideoCompleted = false;
    firstPageInteractionCompleted = !FIRST_PAGE_HAS_INTERACTION;
  }
  // THE GAME PAGE: the Next arrow stays hidden and every forward route stays shut
  // until the game reports completion (finishLbd releases this gate). There is no
  // video here, so the only watchdog is the "the game never even booted" escape.
  if (pages[idx] && pages[idx].type === "lbd") {
    gateDone = false;
    gateIdx = idx;
    gateTimer = setTimeout(function () {
      if (gateIdx === idx && !gateDone && !lbdGameReady) openPageGate("lbd-never-ready");
    }, GATE_LBD_STUCK_MS);
    updateNavState();
    return;
  }
  const leaf = leaves[idx];
  const v = leaf ? leaf.querySelector("video.page-media") : null;
  if (!v || !pages[idx] || pages[idx].type !== "video") {
    gateDone = true;                        // image / end pages are never locked
    updateNavState();
    return;
  }
  gateDone = false;
  gateIdx = idx;
  gateVideo = v;
  // NOTE: v.ended may still be true from a PREVIOUS visit here — refreshMedia
  // resets/replays the clip right after this runs, so the gate must re-arm and
  // wait for the fresh `ended` (or error/watchdog). Never open on stale state.
  v.addEventListener("ended", _onGateRelease);
  v.addEventListener("error", _onGateRelease);
  v.addEventListener("loadedmetadata", _onGateMeta);
  // A video whose SOURCE is broken may already sit in the error state.
  if (v.error) { openPageGate("pre-errored"); return; }
  armGateWatchdog(v);
  updateNavState();
}

/* ---- Central forward-navigation guard ------------------------------------
   EVERY forward route (corner arrow, keyboard, swipe/drag, programmatic goNext)
   funnels through this check — disabling the visible button alone is not enough. */
function canNavigateForward() {
  if (!opened || !ready || animating || lbdFullscreen) return false;
  if (flipped >= totalPages - 1) return false;    // already on THE END
  return gateDone;
}

/* ---- Navigation (drives the CSS leaf flip) ------------------------------ */
function turnLeaf(leaf) {                 // shared flip visuals + timing
  leaf.style.zIndex = 300;               // lift the turning sheet above everything
  leaf.classList.add("flipping");        // enables the moving curl shading
  renderLeaves();
  refreshMedia();                        // START now → the target video plays INSTANTLY
                                          // (as the page is revealed, not after the flip)
  playFlip();
  updateNavState();
  setTimeout(function () {
    leaf.classList.remove("flipping");
    animating = false; updateZ(); windowLeaves(); updateNavState();
    refreshMedia();                      // re-assert once settled (idempotent safety net)
  }, FLIP_MS + 40);
}
function goNext() {
  if (!canNavigateForward()) return;      // gate + open/ready/animating/fullscreen guard
  animating = true;                       // locks navigation until the turn settles
  const leaf = leaves[flipped];           // the page to turn
  flipped++;
  turnLeaf(leaf);
}
function goPrev() {
  if (!opened || !ready || animating || lbdFullscreen) return;
  if (flipped <= 0) return;               // already on the first page
  animating = true;
  flipped--;
  turnLeaf(leaves[flipped]);
}

/* ---- Nav state --------------------------------------------------------- */
function updateNavState() {
  const last = totalPages - 1;
  if (cornerPrev) {
    // On the FIRST story page the Back arrow is fully hidden (display:none via
    // .is-hidden), not merely disabled/faded.
    cornerPrev.classList.toggle("is-hidden", flipped === 0);
    cornerPrev.disabled = !ready || flipped <= 0;
    cornerPrev.setAttribute("aria-disabled", String(cornerPrev.disabled));
  }
  if (cornerNext) {
    if (flipped === 0) {
      updateFirstPageNextArrow();          // hidden until video + interaction complete
    } else {
      // EVERY gated page hides the Next arrow entirely until its gate opens: a
      // video page until its clip finishes (ended/error/watchdog), the GAME page
      // until the game is completed. It then pops in via .is-visible. Ungated
      // pages (image, THE END) show it immediately — disabled on the final page,
      // where Replay owns the action. A page already cleared earlier in the read
      // is never gated again, so a revisit shows Back AND Next at once.
      const show = gateDone;
      cornerNext.classList.toggle("is-visible", show);
      cornerNext.setAttribute("aria-hidden", String(!show));
      cornerNext.disabled = !ready || flipped >= last || !gateDone;
    }
    cornerNext.setAttribute("aria-disabled", String(cornerNext.disabled));
  }
}

/* ---- Fullscreen: go FULLSCREEN when the book opens (the Play tap is the user
   gesture the Fullscreen API requires) and LEAVE fullscreen when back at the
   cover (Home / Replay). Applies on every screen; silently no-ops where the
   browser blocks it (e.g. iPhone Safari can't fullscreen arbitrary elements). */
function enterFullscreen() {
  // Resolves TRUE only when a fullscreen morph actually started (the viewport
  // is about to resize); FALSE when fullscreen is unavailable, already active,
  // or the request was rejected — so the caller knows whether to wait it out.
  try {
    if (document.fullscreenElement || document.webkitFullscreenElement) return Promise.resolve(false);
    var el = document.documentElement;
    var req = el.requestFullscreen || el.webkitRequestFullscreen || el.webkitRequestFullScreen || el.msRequestFullscreen;
    if (!req) return Promise.resolve(false);
    var p = req.call(el);
    if (p && p.then) return p.then(function () { return true; }, function () { return false; });
    // Old WebKit: no promise — infer engagement from the change event, or give up fast.
    return new Promise(function (resolve) {
      var timer = setTimeout(function () { cleanup(); resolve(false); }, 250);
      function onChange() { cleanup(); resolve(true); }
      function cleanup() {
        clearTimeout(timer);
        document.removeEventListener("fullscreenchange", onChange);
        document.removeEventListener("webkitfullscreenchange", onChange);
      }
      document.addEventListener("fullscreenchange", onChange);
      document.addEventListener("webkitfullscreenchange", onChange);
    });
  } catch (_) { return Promise.resolve(false); }
}
function exitFullscreen() {
  try {
    if (!(document.fullscreenElement || document.webkitFullscreenElement)) return;
    var ex = document.exitFullscreen || document.webkitExitFullscreen || document.webkitCancelFullScreen || document.msExitFullscreen;
    if (ex) { var p = ex.call(document); if (p && p.catch) p.catch(function () {}); }
  } catch (_) {}
}

/* ---- Play-tap transition curtain (QA: tablet "pitch-black flash") --------
   Raised synchronously inside the Play gesture, in the SAME frame as the
   fullscreen request: the browser's fullscreen morph, the viewport resize and
   the first re-raster at the new size all happen behind an opaque, theme-
   matched backdrop instead of an unrendered black frame. Dropped (450ms
   dissolve) one painted frame after the open sequence starts, so the curtain
   melts into the cover-opening animation. A hard failsafe guarantees the
   curtain can NEVER stay stuck over the book. */
const openCurtain = document.getElementById("openCurtain");
let curtainFailsafe = null;
function showOpenCurtain() {
  if (!openCurtain) return;
  openCurtain.classList.add("on");
  clearTimeout(curtainFailsafe);
  curtainFailsafe = setTimeout(hideOpenCurtain, 2600);  // belt-and-suspenders
}
function hideOpenCurtain() {
  if (!openCurtain) return;
  clearTimeout(curtainFailsafe); curtainFailsafe = null;
  openCurtain.classList.remove("on");
}

/* ---- Open the 3D cover, then hand off to the page-turning book ----------
   Shared by the first open (openBook) AND Replay (replayBook), so the dramatic
   hinge-open + post-open setup are identical both times. */
function runOpenSequence() {
  ready = false;
  document.body.classList.remove("is-closing");
  document.body.classList.add("is-open");
  // The whole open motion IS the cover's own hinge — NO zoom / camera move.
  book.classList.remove("closing");
  book.classList.add("open");          // cover hinges open on the LEFT spine
  bookFloat.classList.add("rest");     // stop the idle bob
  coverScene.classList.remove("parked");
  flipbookEl.style.zIndex = "";        // cover ABOVE the pages while it swings open
  // Reveal the REAL page right away (it sits beneath the cover, masked by it).
  flipbookEl.classList.add("show");
  // A user gesture drives every open, so start audio here.
  soundOn();
  resumeAudio();
  playCoverFlip();
  playBgMusic();                        // start the looping background music
  primeVideo(0); primeVideo(1);         // unlock page 1 + 2 inside the gesture
  refreshMedia();                       // start the page-1 video right away
  // Once the cover has FULLY opened, park it, lift the pages above it, hand over
  // pointer events, and mark the book READY.
  clearTimeout(_openTimer);
  _openTimer = setTimeout(function () {
    coverScene.classList.add("parked");
    flipbookEl.style.zIndex = "5";        // pages now sit ABOVE the parked cover (z3)
    tapCatcher.style.pointerEvents = "none";
    flipbookEl.style.pointerEvents = "auto";
    ready = true;
    updateNavState();
    refreshMedia();
    resetIdleHint();
  }, COVER_OPEN_MS + 50);
  updateNavState();
}
function openBook() {
  if (opened) return;
  // Stage-A shell preload gates the start: no route (click, keyboard, touch,
  // synthetic or direct call) may open the book before the loader finishes.
  if (document.body.classList.contains("boot-loading")) return;
  opened = true;
  // Everything the browser ties to the user gesture happens NOW, inside the tap:
  // audio unlock + the muted play()/pause() that "activates" the page videos.
  soundOn();
  resumeAudio();
  primeVideo(0); primeVideo(1);
  // Entering fullscreen RESIZES the viewport, and re-rastering the whole scene
  // at the new size while the 3D cover animation and the page-1 video decoder
  // spin up is what starves tablet GPUs into flashing an unrendered BLACK frame
  // (the fullscreen morph drops the old surface; the new one misses its
  // deadline). So: request fullscreen first (the Play tap is the gesture it
  // needs), let the resize SETTLE and paint the title card at the new size,
  // THEN run the open sequence. If fullscreen is refused or unavailable
  // (e.g. iPhone Safari), the book opens immediately instead.
  // Raise the transition curtain in the SAME synchronous gesture as the
  // fullscreen request below: whatever the tablet does during the morph
  // (resize, surface swap, re-raster) plays out behind an intentional
  // cross-dissolve instead of a black cut.
  showOpenCurtain();
  var started = false;
  var settleTimer = null;
  var capTimer = setTimeout(start, 900);   // hard cap — never leave the reader waiting
  function start() {
    if (started) return;
    started = true;
    clearTimeout(capTimer); clearTimeout(settleTimer);
    window.removeEventListener("resize", onResize);
    requestAnimationFrame(function () {
      runOpenSequence();
      // One more frame so the scene has actually PAINTED at the new viewport
      // size, then dissolve the curtain into the opening cover.
      requestAnimationFrame(function () { requestAnimationFrame(hideOpenCurtain); });
    });
  }
  function onResize() {                    // wait for the LAST resize + a beat to paint
    if (started) return;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(start, 180);
  }
  window.addEventListener("resize", onResize);
  enterFullscreen().then(function (engaged) {
    if (!engaged) start();                 // no fullscreen morph coming → open now
    else onResize();                       // morph done / in flight → settle, then open
  });
}

/* ---- Reset the whole book to the START SCREEN: the CLOSED FRONT COVER + Play
   button, exactly like a fresh load (so tapping Play reads from the top). Shared
   by Replay and Home (called once the closing swing has finished). --------- */
function resetToStart() {
  hideOpenCurtain();          // defensive: never carry a stuck curtain to the cover
  exitFullscreen();           // back at the cover → leave fullscreen
  ready = false; opened = false; flipped = 0;
  // LBD teardown: whatever state the game page was in (visible, warming, or a
  // stale fullscreen class), clear it, kill its audio/timers, and re-warm a
  // fresh intro in the background for the next read.
  lbdFullscreen = false; lbdWasOn = false; lbdExiting = false;
  document.body.classList.remove("lbd-is-fullscreen");
  if (lbdStage) {
    lbdStage.classList.remove("visible", "fullscreen", "lbd-anim");
    lbdStage.setAttribute("aria-hidden", "true");
    lbdStage.style.pointerEvents = "";
  }
  resetLbd();
  scheduleLbdWarm(1200);
  clearPageGate(); gateDone = true;   // no stale watchdog may fire on the cover
  // A fresh read starts with fresh gates: forget which pages were already earned
  // (so page 1's video, and the game, gate again from the top).
  gateCleared.clear();
  firstPageVideoCompleted = false;
  firstPageInteractionCompleted = !FIRST_PAGE_HAS_INTERACTION;
  stopNextArrowPulse();
  renderLeaves();
  leaves.forEach(function (leaf) {
    var vv = leaf.querySelector("video.page-media");
    if (vv) { try { vv.pause(); vv.currentTime = 0; } catch (_) {} }
  });
  lastMediaIdx = -1;
  document.body.classList.remove("is-open", "is-closing");
  book.classList.remove("open", "closing");
  coverScene.classList.remove("parked");
  cover.style.transform = "";                 // cover CLOSED → front cover + Play button showing
  flipbookEl.classList.remove("show");         // pages hidden behind the closed cover
  flipbookEl.style.zIndex = "";
  flipbookEl.style.pointerEvents = "none";
  bookFloat.classList.remove("rest");          // resume the idle bob
  tapCatcher.style.pointerEvents = "auto";     // Play is tappable again
  hideFlipHint(); clearTimeout(idleHintTimer); clearTimeout(nudgeHideTimer);
  try { bgMusic.pause(); bgMusic.currentTime = 0; } catch (_) {}   // stop music; restarts on Play
  updateNavState();                            // hides the progress read-out (not opened)
}

/* ---- CLOSE THE BOOK: the cover swings SHUT — the exact REVERSE of the opening
   hinge (cover −180 → 0) — and the book lands on the front cover. Driven by
   REPLAY (from THE END page). `afterReset` runs once we're back on the
   cover. ------------------------------------------------------------------ */
function closeBookToCover(afterReset) {
  ready = false;                               // block flips during the close
  clearTimeout(_openTimer);
  clearTimeout(_homeTimer);
  // Leaving from the LBD page (pre-start): drop the overlay INSTANTLY so the
  // game never floats over the closing book, and silence it at once.
  if (lbdStage && lbdStage.classList.contains("visible")) {
    lbdStage.classList.remove("visible", "fullscreen", "lbd-anim");
    lbdStage.setAttribute("aria-hidden", "true");
    document.body.classList.remove("lbd-is-fullscreen");
    lbdFullscreen = false; lbdWasOn = false;
    resetLbd();
  }
  clearPageGate();                             // no stale video watchdog into the cover
  hideFlipHint(); clearTimeout(idleHintTimer); clearTimeout(nudgeHideTimer);
  if (cornerNext) cornerNext.classList.remove("blink");
  stopNextArrowPulse();
  var v = currentVideo(); if (v) { try { v.pause(); } catch (_) {} }
  // pages back UNDER the cover, so the closing cover sweeps over them
  flipbookEl.style.zIndex = "";
  flipbookEl.style.pointerEvents = "none";
  tapCatcher.style.pointerEvents = "none";
  coverScene.classList.remove("parked");
  // CLOSE — reverse of the opening hinge (cover swings from -180 back to 0).
  // is-closing keeps the current page bright (hides the dark thickness block) and
  // hides the turned-page pile, so the cover folds cleanly with no stray left page.
  document.body.classList.add("is-closing");
  book.classList.remove("open");
  book.classList.add("closing");
  playCoverFlip();
  _homeTimer = setTimeout(function () {
    resetToStart();
    if (typeof afterReset === "function") afterReset();
  }, COVER_CLOSE_MS + 60);
}

/* ---- REPLAY (button on THE END page): close the book with the reverse-of-open
   swing, land on the front cover, and re-arm the title VO for another read. */
function replayBook() {
  if (!opened || animating) return;
  closeBookToCover();
}

/* (There is no HOME route any more — the Home button was removed, so Replay on
   THE END page is the only way back to the front cover.) */

/* ==========================================================================
   INPUT  —  tap PLAY to OPEN the cover; once open, drag + corner arrows +
   keyboard drive the page flip.
   ========================================================================== */
const tapCatcher = document.getElementById("tapCatcher");

// The book opens ONLY from the play button. The tap-catcher still sits on top to
// block page gestures before opening, but it opens the book only when the tap
// lands inside the play button's (breathing) hit-circle — taps elsewhere on the
// cover do nothing.
function tapHitsPlay(e) {
  const r = hint.getBoundingClientRect();
  if (!r.width || !r.height) return false;    // hidden while Stage A preloads
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const rad = Math.max(r.width, r.height) / 2;
  return Math.hypot(e.clientX - cx, e.clientY - cy) <= rad;
}
if (tapCatcher) tapCatcher.addEventListener("click", function (e) { if (!opened && tapHitsPlay(e)) openBook(); });
// Show the hand (pointer) cursor ONLY when hovering the play button — the sole CTA
// on the cover. Everywhere else on the tap surface stays a normal cursor.
if (tapCatcher) tapCatcher.addEventListener("mousemove", function (e) {
  tapCatcher.style.cursor = (!opened && tapHitsPlay(e)) ? "pointer" : "default";
});

// The play button itself (also covers keyboard: Enter/Space on the focused button).
hint.addEventListener("click", function (e) { e.stopPropagation(); if (!opened) openBook(); });

// Bottom-corner flip arrows (outside the book): back = left, forward = right.
cornerPrev.addEventListener("click", function (e) { e.stopPropagation(); goPrev(); this.blur(); });
cornerNext.addEventListener("click", function (e) { e.stopPropagation(); goNext(); this.blur(); });
if (replayBtn) replayBtn.addEventListener("click", function (e) { e.stopPropagation(); replayBook(); this.blur(); });

// Page interaction — DRAG TO TURN: grab the page and it follows your cursor,
// rotating about the spine, then SNAPS to the nearest state when you let go.
//   • drag LEFT  → turn the current page forward (it comes to rest on the cover)
//   • drag RIGHT → turn the previous page back
// A plain tap does nothing; the corner arrows + keyboard still work.
(function () {
  let startX = 0, startY = 0, pw = 1;
  let leaf = null, dir = 0, decided = false, dragging = false, curlEl = null;
  let lastX = 0, lastT = 0, vx = 0;                   // for flick (velocity) detection
  const DECIDE = 6;                                   // px before we commit to a drag
  const FLICK = 0.45;                                 // px/ms — a quick flick completes the turn
  const FINISH_DEG = 45;                              // turned this far (deg) → completes on release

  // how many degrees the drag has turned the page (0..180)
  function degFromDx(dx) { return Math.max(0, Math.min(180, Math.abs(dx) / pw * 180)); }
  // the live angle for the active leaf, given the raw horizontal travel
  function liveAngle(dx) {
    return (dir === 1) ? degFromDx(Math.min(0, dx))          // forward: leftward turns 0→180
                       : 180 - degFromDx(Math.max(0, dx));   // back: starts at 180, rightward → 0
  }

  flipbookEl.addEventListener("pointerdown", function (e) {
    if (!opened || !ready || animating || lbdFullscreen) return;
    startX = e.clientX; startY = e.clientY;
    lastX = e.clientX; lastT = e.timeStamp || performance.now(); vx = 0;
    decided = false; dragging = true; leaf = null; dir = 0; curlEl = null;
    pw = flipbookEl.getBoundingClientRect().width || 1;
  });

  flipbookEl.addEventListener("pointermove", function (e) {
    if (!dragging) return;
    const now = e.timeStamp || performance.now();
    const dt = now - lastT;
    if (dt > 0) vx = (e.clientX - lastX) / dt;         // running horizontal velocity
    lastX = e.clientX; lastT = now;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (!decided) {
      if (Math.abs(dx) < DECIDE || Math.abs(dx) <= Math.abs(dy)) return;   // wait for a clear horizontal drag
      // FORWARD drags must pass the central gate (video not finished → no swipe,
      // no corner-drag, no flick can advance). Backward drags stay available.
      if (dx < 0 && canNavigateForward())              { dir = 1;  leaf = leaves[flipped]; }     // turn forward
      else if (dx > 0 && flipped > 0 && !lbdFullscreen) { dir = -1; leaf = leaves[flipped - 1]; } // turn back
      else { dragging = false; return; }                  // nothing to turn that way
      decided = true;
      leaf.style.transition = "none";                     // follow the finger exactly
      leaf.style.zIndex = 300;
      curlEl = leaf.querySelector(".curl");
      try { flipbookEl.setPointerCapture(e.pointerId); } catch (_) {}
    }
    const ang = Math.max(0, Math.min(180, liveAngle(dx)));
    leaf.style.transform = "rotateY(" + (-ang) + "deg)";
    if (curlEl) curlEl.style.opacity = (ang <= 90 ? ang / 90 : (180 - ang) / 90) * 0.9;
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    const L = leaf, D = dir, C = curlEl;
    leaf = null; curlEl = null;
    if (!decided || !L) return;                           // a plain tap → nothing

    const ang = Math.max(0, Math.min(180, liveAngle(e.clientX - startX)));
    // Complete the turn if it's been dragged far enough OR flicked quickly in
    // the turn's direction — no need to drag all the way past halfway.
    const flick = (D === 1) ? (vx < -FLICK) : (vx > FLICK);
    const complete   = (D === 1) ? (ang > FINISH_DEG || flick)
                                 : (ang < 180 - FINISH_DEG || flick);
    const endFlipped = (D === 1) ? complete   : !complete;    // does this leaf end up turned?

    animating = true;
    if (C) C.style.opacity = "";
    if (complete) { playFlip(); flipped += (D === 1) ? 1 : -1; }
    // Lock in the resting classes + z-index NOW (so nothing pops in later), then
    // animate the inline transform from the dragged angle to the target. The
    // .flipped class already holds the same final angle underneath.
    L.style.transition = "";                              // restore the CSS flip transition
    void L.offsetWidth;                                   // reflow so it animates FROM the dragged angle
    L.classList.add("flipping");                          // curl shading during the snap
    renderLeaves();                                       // apply .flipped + z-index immediately
    refreshMedia();                                       // START the target video INSTANTLY
    L.style.transform = endFlipped ? "rotateY(-180deg)" : "rotateY(0deg)";
    updateNavState();

    setTimeout(function () {
      L.classList.remove("flipping");
      // Drop the inline transform WITHOUT re-animating: the .flipped class already
      // holds the final angle, so disabling the transition for this swap prevents
      // the leaf from briefly swinging back (the "page reappears on the left" glitch).
      L.style.transition = "none";
      L.style.transform = "";
      void L.offsetWidth;                                 // commit with no transition
      L.style.transition = "";                            // restore for the next turn
      animating = false; updateNavState();
      refreshMedia();                                     // re-assert once settled (idempotent safety net)
    }, FLIP_MS + 40);
  }
  flipbookEl.addEventListener("pointerup", endDrag);
  flipbookEl.addEventListener("pointercancel", endDrag);
})();

window.addEventListener("keydown", function (e) {
  // Game finished: page turns are still blocked under the fullscreen overlay, so
  // the forward key drives the overlay's Next button instead. (Enter/Space already
  // work — showLbdNext() focuses it.)
  if (e.key === "ArrowRight" && lbdNextBtn && lbdNextBtn.classList.contains("show")) {
    e.preventDefault(); lbdNextBtn.click(); return;
  }
  if (e.key === "ArrowRight") { e.preventDefault(); opened ? goNext() : openBook(); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); goPrev(); }
  else if ((e.key === " " || e.key === "Enter") && !opened) { e.preventDefault(); openBook(); }
});

// Keep the canvas scaled to fit on resize / rotate.
let _resizeSettle = null;
function onViewportChange() {
  // Suppress the page-turn transitions while the viewport is actively changing, so
  // a rapid resize / resolution change can't make the book LOOK like it's auto-
  // flipping (the leaves re-render during the scale change). Restored once settled.
  document.body.classList.add("is-resizing");
  clearTimeout(_resizeSettle);
  _resizeSettle = setTimeout(function () { document.body.classList.remove("is-resizing"); }, 220);
  fitScale();
  windowLeaves();                 // re-assert GPU windowing after resize/orientation
  // Re-park the LBD overlay over the (re-scaled) page — unless it's fullscreen,
  // where it already fills the viewport via CSS.
  if (lbdStage && lbdStage.classList.contains("visible") && !lbdFullscreen) positionLbdStage();
}
window.addEventListener("resize", onViewportChange);
window.addEventListener("orientationchange", onViewportChange);

/* ---- Block ALL zoom (pinch, double-tap, ctrl+wheel, ctrl +/-) ------------
   The book is fixed-layout, so zoom would only break it. */
(function () {
  // Never let anything (esp. page images) start a native HTML5 drag — that was
  // showing a "ghost" of the image following the cursor during a page-flip drag.
  document.addEventListener("dragstart", function (e) { e.preventDefault(); });
  ["gesturestart", "gesturechange", "gestureend"].forEach(function (t) {   // iOS pinch
    document.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false });
  });
  window.addEventListener("wheel", function (e) {                          // desktop ctrl+wheel
    if (e.ctrlKey) e.preventDefault();
  }, { passive: false });
  window.addEventListener("keydown", function (e) {                        // ctrl/⌘ +/-/0
    if ((e.ctrlKey || e.metaKey) && ["+", "-", "=", "0"].indexOf(e.key) !== -1) e.preventDefault();
    // Block "Save page" (Ctrl/⌘+S) — a casual way to grab the media.
    if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) e.preventDefault();
  });
  document.addEventListener("touchmove", function (e) {                    // 2-finger pinch
    if (e.touches && e.touches.length > 1) e.preventDefault();
  }, { passive: false });

  // NOTE: the right-click / context menu is intentionally LEFT ENABLED (so "Inspect"
  // and dev tools work). Casual image protection still stands via CSS — no drag,
  // no text-selection, no iOS long-press "Save Image" callout — plus Ctrl+S is blocked.
})();

/* ==========================================================================
   SOUND  —  real audio files in sfx/: Page flip.mp3 (every page flip),
   cover page flip.mp3 (the cover opening), and the LBD game's own theme track
   (game/audios/ThemeMusic.ogg — one shared cached file) as looping background
   music at 20% volume. All muted until the book is opened (a user gesture).
   ========================================================================== */
let muted = true;

// Looping BACKGROUND MUSIC — the GAME's own theme track (game/audios/ThemeMusic.ogg,
// Ogg/Opus) at 20% volume, shared with the embedded game so the file is fetched and
// cached ONCE. Started on open (a user gesture) so the browser allows it to play
// with sound. preload="none": the Stage-B background preloader warms the file into
// the HTTP cache instead, so this element never double-downloads it. It is paused
// while the embedded game is up (the game plays its own copy) — see setLbdFullscreen.
const bgMusic = new Audio();
bgMusic.preload = "none";
bgMusic.src = "game/audios/ThemeMusic.ogg";
bgMusic.loop = true;
bgMusic.volume = 0.20;                      // 20% volume, per request
function playBgMusic() {
  try {
    const p = bgMusic.play();
    if (p && p.catch) p.catch(function () {});   // ignore autoplay rejections
  } catch (_) {}
}

/* ---- Pause ALL audio when the tab / window goes to the background -----------
   Background music AND the current page's video (its voice-over) must stop the
   moment the reader switches tab or app, and resume when they come back — they
   were continuing to play in the background. Covers visibilitychange (tab switch),
   blur (other window), and pagehide (mobile app switch / bfcache). */
let _bgWasPlaying = false;
function currentVideo() {
  const leaf = leaves[flipped];
  return leaf ? leaf.querySelector("video.page-media") : null;
}
function pauseAllAudioFB() {
  if (!bgMusic.paused) { _bgWasPlaying = true; try { bgMusic.pause(); } catch (_) {} }
  const v = currentVideo();
  if (v && !v.paused) { v.dataset.wasPlaying = "1"; try { v.pause(); } catch (_) {} }
  if (audioCtx && audioCtx.state === "running") { try { audioCtx.suspend(); } catch (_) {} }
}
function resumeAllAudioFB() {
  if (document.hidden || !document.hasFocus()) return;   // only when truly back in front
  if (!opened) return;                                   // nothing plays before the book opens
  if (audioCtx && audioCtx.state === "suspended") { try { audioCtx.resume(); } catch (_) {} }
  if (_bgWasPlaying) { _bgWasPlaying = false; playBgMusic(); }
  const v = currentVideo();
  if (v && v.dataset.wasPlaying && !v.ended) { delete v.dataset.wasPlaying; const p = v.play(); if (p && p.catch) p.catch(function () {}); }
}
document.addEventListener("visibilitychange", function () {
  if (document.hidden) pauseAllAudioFB(); else resumeAllAudioFB();
});
window.addEventListener("blur", pauseAllAudioFB);
window.addEventListener("focus", resumeAllAudioFB);
window.addEventListener("pagehide", pauseAllAudioFB);

/* ---- One-shot SFX via Web Audio (glitch-free, zero-latency) --------------
   An <audio> element pays a real first-play init cost and can stutter on short
   one-shots — that was the cover-flip "lag/glitch". Instead we decode each SFX
   ONCE into an AudioBuffer and play it through a BufferSource: sample-accurate,
   no start latency. Any leading silence baked into the mp3 is auto-skipped (we
   start on the first audible sample). Buffers come from base64 data URIs
   (window.SFX_DATA in sfx-data.js) so they decode even on file://, where fetch()
   of a plain path is blocked. If Web Audio is unavailable we fall back to plain
   <audio> elements (the old behaviour). */
let audioCtx = null;
const sfxBuf = {};                          // name -> { buffer, offset (seconds) }

// Fallback <audio> elements — used ONLY if Web Audio fails to init or decode.
// preload="none": these rarely-used fallbacks must not join the boot payload
// (the Web Audio path decodes the same clips from inlined base64 in sfx-data.js).
const flipSound = new Audio();
flipSound.preload = "none";
flipSound.src = "sfx/Page%20flip.mp3";
const coverFlipSound = new Audio();
coverFlipSound.preload = "none";
coverFlipSound.src = "sfx/cover%20page%20flip.mp3";
coverFlipSound.volume = 0.35;

(function initSfx() {
  const AC = window.AudioContext || window.webkitAudioContext;
  const DATA = window.SFX_DATA || {};
  if (!AC || !DATA.cover) return;           // no Web Audio / no inlined data → fallback
  try { audioCtx = new AC(); } catch (_) { audioCtx = null; return; }
  function decode(name, uri) {
    fetch(uri).then(function (r) { return r.arrayBuffer(); })
      .then(function (a) { return audioCtx.decodeAudioData(a); })
      .then(function (buf) {
        // Skip any leading silence so playback starts right on the transient.
        const ch = buf.getChannelData(0), sr = buf.sampleRate, thr = 0.008;
        let first = 0;
        for (let i = 0; i < ch.length; i++) { if (Math.abs(ch[i]) > thr) { first = i; break; } }
        sfxBuf[name] = { buffer: buf, offset: Math.max(0, first / sr - 0.004) };
      })
      .catch(function () {});               // leave name unset → falls back to <audio>
  }
  decode("cover", DATA.cover);
  decode("flip", DATA.flip);
})();

// The audio context starts suspended until a user gesture. Resume it on the first
// pointer press (fires just BEFORE the open click) so the cover-flip sound, played
// a moment later, is instant. Capture phase, not once (cheap + always safe).
function resumeAudio() {
  if (audioCtx && audioCtx.state === "suspended") { try { audioCtx.resume(); } catch (_) {} }
}
document.addEventListener("pointerdown", resumeAudio, { capture: true });

// Play a decoded SFX buffer; returns false if Web Audio isn't ready (→ caller
// falls back to the <audio> element).
function playSfx(name, vol, rate) {
  const entry = sfxBuf[name];
  if (!audioCtx || !entry) return false;
  try {
    if (audioCtx.state === "suspended") audioCtx.resume();
    const src = audioCtx.createBufferSource();
    src.buffer = entry.buffer;
    if (rate) src.playbackRate.value = rate;
    const g = audioCtx.createGain();
    g.gain.value = (vol == null ? 1 : vol);
    src.connect(g).connect(audioCtx.destination);
    src.start(0, entry.offset || 0);        // start on the first audible sample
    return true;
  } catch (_) { return false; }
}

// Page-flip sound — snappy 1.5× on every ordinary flip.
function playFlip() {
  if (muted) return;                        // sound turns on when the book opens
  if (playSfx("flip", 1.0, 1.5)) return;    // Web Audio path
  try {                                     // fallback
    flipSound.currentTime = 0; flipSound.playbackRate = 1.5;
    const p = flipSound.play(); if (p && p.catch) p.catch(function () {});
  } catch (_) {}
}
// COVER-page flip sound — played ONLY when the cover opens (never on page flips).
function playCoverFlip() {
  if (muted) return;
  if (playSfx("cover", 0.35)) return;       // Web Audio path
  try {                                     // fallback
    coverFlipSound.currentTime = 0;
    const p = coverFlipSound.play(); if (p && p.catch) p.catch(function () {});
  } catch (_) {}
}
// Turn sound ON when the book is opened (a clear user gesture). Safe to call
// repeatedly.
function soundOn() {
  muted = false;                     // opening the book turns sound on
}


/* ==========================================================================
   PAGE-TURN HINT  —  guidance for readers who don't know how to turn the page.
   When idle, two cues fire together: a hand taps the forward arrow AND the page
   itself does a "ghost" half-flip (lifts toward the next page, then falls back).
   Timing: PAGE 1 after 5s, every later page after 10s of no interaction; repeats
   while idle and is cancelled by any tap / key / flip. Never on the last page or
   while the LBD game is open.
   ========================================================================== */
// The nudge is a HAND on the RIGHT side of the book — the emoji hand, built
// directly (no assets/hand-nudge.png request: the art doesn't exist, and a
// guaranteed-404 boot request is worse than the emoji it fell back to anyway).
let flipHint = document.createElement("div");
flipHint.className = "flip-hint flip-hint--emoji";
flipHint.setAttribute("aria-hidden", "true");
flipHint.textContent = "👆";
document.body.appendChild(flipHint);

// Idle guidance timing: the FIRST nudge is after 5s on page 1, 10s on later pages;
// then it plays ONCE, disappears, and comes back every 9s. Any interaction resets it.
function idleDelay() { return flipped === 0 ? 5000 : 10000; }
const NUDGE_SHOW_MS = 2000;    // how long one nudge stays on screen
const NUDGE_GAP_MS  = 9000;    // gap after it disappears before it plays again
const VIDEO_END_HINT_MS = 5000; // on a video page, wait this long AFTER the clip ends, then nudge
let idleHintTimer = null;
let nudgeHideTimer = null;
let peeking = false;
let peekTimers = [];

function canShowHint() {
  // gateDone: never nudge the reader forward while the page's video gate is
  // still locked (the hint demonstrates a forward page-turn).
  return opened && ready && !animating && !lbdFullscreen && gateDone &&
         flipped < totalPages - 1 && flipped !== LBD_INDEX && !document.hidden;
}
function positionFlipHint() {
  if (!flipScaleEl) return;
  const r = flipScaleEl.getBoundingClientRect();            // the book's on-screen rect
  const w = flipHint.offsetWidth || 80, h = flipHint.offsetHeight || 80;
  // Park the hand against the book's RIGHT edge, vertically centred — the side the
  // ghost flip lifts. The swipe animation moves it right→left from here.
  flipHint.style.left = Math.round(r.right - w - r.width * 0.05) + "px";
  flipHint.style.top  = Math.round(r.top + r.height * 0.5 - h / 2) + "px";
}
function showFlipHint() {
  if (!canShowHint()) return;
  positionFlipHint();
  flipHint.classList.add("show");
}
function hideFlipHint() {
  flipHint.classList.remove("show");
}

/* ---- GHOST PAGE-FLIP -------------------------------------------------------
   Lift the current page about halfway toward the next one, then let it fall back
   — a live demo that the page turns. Purely visual; cancelled the instant the
   reader interacts, so a real drag/flip takes over cleanly. */
function cancelPeek() {
  peekTimers.forEach(clearTimeout);
  peekTimers = [];
  if (!peeking) return;
  peeking = false;
  const leaf = leaves[flipped];
  if (leaf) {
    leaf.style.transition = ""; leaf.style.transform = ""; leaf.style.zIndex = "";
    const c = leaf.querySelector(".curl"); if (c) c.style.opacity = "";
  }
  updateZ();
}
function peekFlip() {
  if (peeking || !canShowHint()) return;
  const leaf = leaves[flipped];
  if (!leaf) return;
  peeking = true;
  const curl = leaf.querySelector(".curl");
  leaf.style.zIndex = 300;                               // lift above the rest while peeking
  leaf.style.transition = "transform 720ms cubic-bezier(0.33, 0, 0.2, 1)";
  void leaf.offsetWidth;                                 // commit so the lift animates from flat
  leaf.style.transform = "rotateY(-52deg)";              // turn toward the next page (~halfway)
  if (curl) curl.style.opacity = "0.85";                 // page-curl shading during the lift
  peekTimers.push(setTimeout(function () {               // ...then ease it back down
    leaf.style.transform = "rotateY(0deg)";
    if (curl) curl.style.opacity = "";
  }, 760));
  peekTimers.push(setTimeout(function () {               // clean up once settled
    leaf.style.transition = ""; leaf.style.transform = ""; leaf.style.zIndex = "";
    peeking = false; updateZ();
  }, 760 + 760));
}

// Play the nudge ONCE — hand swipe on the book's right + ghost page-flip + the
// right arrow blinks — hold ~2s, then hide and come back 9s later. Repeats while idle.
function triggerHint() {
  if (!canShowHint()) { idleHintTimer = setTimeout(triggerHint, NUDGE_GAP_MS); return; }
  showFlipHint();
  peekFlip();
  if (cornerNext) cornerNext.classList.add("blink");
  clearTimeout(nudgeHideTimer);
  nudgeHideTimer = setTimeout(function () {
    hideFlipHint();
    if (cornerNext) cornerNext.classList.remove("blink");
    idleHintTimer = setTimeout(triggerHint, NUDGE_GAP_MS);   // ...then again after 9s
  }, NUDGE_SHOW_MS);
}
function resetIdleHint() {
  hideFlipHint();
  cancelPeek();
  if (cornerNext) cornerNext.classList.remove("blink");
  clearTimeout(idleHintTimer);
  clearTimeout(nudgeHideTimer);
  // On a VIDEO page the tutorial waits for the clip to FINISH, then +5s (armed in
  // the video's "ended" handler). While the video is still playing, don't start the
  // idle countdown — otherwise the nudge could pop up mid-video.
  const v = currentVideo();
  if (v && !v.ended) return;
  idleHintTimer = setTimeout(triggerHint, idleDelay());       // first show: 5s (pg1) / 10s (later)
}
// Any interaction cancels the nudge + restarts the idle countdown.
["pointerdown", "keydown", "wheel", "touchstart"].forEach(function (evt) {
  document.addEventListener(evt, resetIdleHint, { passive: true, capture: true });
});

/* ---- Boot ---------------------------------------------------------------- */
fitScale();                              // scale the fixed 1280x720 book to fit first
renderLeaves();                          // lay out the leaves (all on page 1 to start)
updateNavState();
