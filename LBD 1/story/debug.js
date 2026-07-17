/*
 * Layout alignment overlay for PowerUp Bots.
 * ----------------------------------------------------------------------------
 * Loads only with ?debug=1. Lets you jump to any round + screen (including the
 * static "blocks fit into slots" view), then DRAG and RESIZE the energy block,
 * the four quarter pieces and the four corner hollows until they sit exactly
 * where they should — and export a Layout JSON of every moved/resized element
 * to hand back to Claude, who bakes the values into the source.
 *
 * Purely additive: it only reads/positions existing elements and never changes
 * game logic. Remove the ?debug=1 script tag and the game is untouched.
 *
 * Coordinate space: #game is a 1280x720 logical surface scaled to fit via a CSS
 * transform. Every exported x/y/w/h is in that 1280x720 game space, so the
 * numbers map straight onto the source's hardcoded coordinates.
 *
 * Sibling: debugScreens.js is the tiny always-on scene pill. This is the richer,
 * ?debug=1-only alignment tool — move assets here, navigate scenes there.
 */
(function () {
  "use strict";

  if (window.__layoutOverlayLoaded) { return; }
  window.__layoutOverlayLoaded = true;

  var GAME_W = 1280, GAME_H = 720;

  function ready() {
    return window.FLOW && window.state && typeof window.renderStep === "function" && window.ROUNDS;
  }
  function whenReady(fn) {
    if (ready()) { fn(); return; }
    var tries = 0;
    var id = setInterval(function () {
      if (ready() || ++tries > 120) { clearInterval(id); if (ready()) { fn(); } }
    }, 50);
  }

  function gameEl() { return document.getElementById("game"); }

  /* Pixels-on-screen → logical game pixels (divide out the #game scale). */
  function scaleX() { var r = gameEl().getBoundingClientRect(); return GAME_W / r.width; }
  function scaleY() { var r = gameEl().getBoundingClientRect(); return GAME_H / r.height; }

  /* An element's rect in game space (matches the game's own gameSpaceCenter). */
  function gameRect(el) {
    var sr = gameEl().getBoundingClientRect();
    var er = el.getBoundingClientRect();
    var sx = GAME_W / sr.width, sy = GAME_H / sr.height;
    return {
      left: (er.left - sr.left) * sx,
      top: (er.top - sr.top) * sy,
      w: er.width * sx,
      h: er.height * sy,
      cx: (er.left - sr.left + er.width / 2) * sx,
      cy: (er.top - sr.top + er.height / 2) * sy
    };
  }

  function round1(n) { return Math.round(n * 10) / 10; }

  /* ── selection state ──────────────────────────────────────────────────── */
  var registry = [];     /* [{ el, id }] */
  var selected = null;   /* an entry from registry */
  var handles = [];      /* floating 8-point resize grips for the selection */
  var frozen = true;     /* freeze the picked screen (cancel its auto-advance) */

  var BG_IDS = { sceneBg: 1, playBg: 1, playFx: 1, completeConfetti: 1, focusDim: 1, botSpotlight: 1 };

  function isBackground(el) {
    if (BG_IDS[el.id]) { return true; }
    if (/\bbg\b/i.test(el.className || "")) { return true; }
    var r = gameRect(el);
    return r.w >= GAME_W * 0.97 && r.h >= GAME_H * 0.97;   /* full-frame guard */
  }

  function idFor(el) {
    if (el.getAttribute("data-dbg-id")) { return el.getAttribute("data-dbg-id"); }
    if (el.classList.contains("corner-slot")) {
      if (el.classList.contains("cs-tl")) { return "slot-tl"; }
      if (el.classList.contains("cs-tr")) { return "slot-tr"; }
      if (el.classList.contains("cs-bl")) { return "slot-bl"; }
      if (el.classList.contains("cs-br")) { return "slot-br"; }
    }
    if (el.classList.contains("whole-block")) { return "whole-block"; }
    if (el.id) { return el.id; }
    return el.className.split(" ")[0] || "el";
  }

  /* Move ANY asset on ANY screen without disturbing its own layout. Rather than
     converting to left/top (which double-applies a pre-existing CSS transform —
     the old "scatter on re-scan" bug, and the reason most screens weren't
     editable), we move by PREPENDING a game-space translate to the element's own
     transform: `translate(dx,dy) <its rotate/scale>`. The leading translate is
     applied in parent (game 1280×720) space, so rotated/scaled assets (the
     corner hollows, etc.) move correctly and keep their orientation.
     dx/dy live on the entry; baseXf is the element's pristine transform, captured
     ONCE (so a re-scan or re-grab never compounds it). */
  function pristineTransform(el) {
    if (el.getAttribute("data-dbg-basexf") === null) {
      var inline = (el.style.transform || "").replace(/^\s*translate\([^)]*\)\s*/, "").trim();
      /* "none" is NOT a transform we can prepend a translate to — treat it as
         empty, else applyXform builds "translate(..) none" (invalid CSS, dropped)
         and the move/resize anchoring silently breaks. */
      if (inline === "none") { inline = ""; }
      var xf = inline;
      if (!xf) { var cs = getComputedStyle(el).transform; xf = (cs && cs !== "none") ? cs : ""; }
      el.setAttribute("data-dbg-basexf", xf);
    }
    return el.getAttribute("data-dbg-basexf");
  }
  function applyXform(entry) {
    var base = (entry.baseXf && entry.baseXf !== "none") ? entry.baseXf : "";
    var t = (entry.dx || entry.dy) ? "translate(" + round1(entry.dx) + "px," + round1(entry.dy) + "px) " : "";
    var xf = (t + base).trim();
    entry.el.style.transform = xf || "none";
  }
  /* True if the element's computed transform includes a rotation (matrix b/c
     terms), e.g. the corner hollows. Pure scale/translate is NOT rotation. */
  function isRotated(el) {
    var cs = getComputedStyle(el).transform;
    var mm = /matrix\(([^)]+)\)/.exec(cs || "");
    if (!mm) { return false; }
    var n = mm[1].split(",").map(parseFloat);
    return Math.abs(n[1]) > 0.01 || Math.abs(n[2]) > 0.01;
  }
  /* True if the element carries a CSS scale (≠1). Such elements need BOX mode so
     resize stays 1:1; everything else can move via a translate (no reposition). */
  function isScaled(el) {
    var cs = getComputedStyle(el).transform;
    var mm = /matrix\(([^)]+)\)/.exec(cs || "");
    if (!mm) { return false; }
    var n = mm[1].split(",").map(parseFloat);
    var sx = Math.hypot(n[0], n[1]), sy = Math.hypot(n[2], n[3]);
    return Math.abs(sx - 1) > 0.01 || Math.abs(sy - 1) > 0.01;
  }
  function makePositionable(el, entry) {
    /* flight pieces ship pointer-events:none so play clicks fall through — re-enable
       hits on whatever we manage so it can be grabbed directly. */
    el.style.pointerEvents = "auto";
    /* BOX mode ONLY for a scaled-but-not-rotated element (the success pieces'
       fly-in scale): flatten the scale into plain left/top/width/height so resize
       can't double. Its left/top become #game-relative, which is correct only
       because those pieces live directly in #game / #flightLayer.
       Everything else — bots, corner hollows, buttons — uses XFORM mode: keep the
       element's own layout + transform and move it by a PREPENDED game-space
       translate. That never rewrites left/top, so elements nested in positioned
       containers (#bots, #cornerSlots) no longer fly off-screen on Re-scan. */
    if (isScaled(el) && !isRotated(el)) {
      var r = gameRect(el);
      entry.mode = "box";
      el.style.position = "absolute";
      el.style.right = "auto"; el.style.bottom = "auto"; el.style.margin = "0";
      el.style.transformOrigin = "top left";
      el.style.transform = "none";
      el.style.left = round1(r.left) + "px";
      el.style.top = round1(r.top) + "px";
      el.style.width = round1(r.w) + "px";
      el.style.height = round1(r.h) + "px";
    } else {
      entry.mode = "xform";
      entry.baseXf = pristineTransform(el);
      var m = /^\s*translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px/.exec(el.style.transform || "");
      entry.dx = m ? parseFloat(m[1]) : 0;
      entry.dy = m ? parseFloat(m[2]) : 0;
    }
  }

  function clearRegistry() {
    registry.forEach(function (e) {
      e.el.classList.remove("dbg-selected");
      if (e.group && e.paths) {
        e.paths.forEach(function (p) { p.removeEventListener("pointerdown", e.onDown); });
      } else {
        e.el.removeEventListener("pointerdown", e.onDown);
      }
    });
    registry = [];
    selected = null;
    placeHandles();
  }

  /* ── charging-wire bundle (one draggable group) ───────────────────────────
     The connectors are a full-frame, pointer-events:none SVG of game-space
     paths. Grab any wire stroke (or arrow-nudge) to translate the WHOLE bundle;
     the SVG itself stays click-through so it never blocks the hollows under it.
     Exported as pod-connectors {x,y} → bake into CONNECTOR_NUDGE in index.html. */
  function registerConnectorGroup() {
    var svg = document.getElementById("podConnectors");
    if (!svg || svg.offsetParent === null) { return; }
    var paths = Array.prototype.slice.call(svg.querySelectorAll("path"));
    if (!paths.length) { return; }
    var entry = { el: svg, id: "pod-connectors", group: true, paths: paths, baseXf: "" };
    var m = /^\s*translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px/.exec(svg.style.transform || "");
    entry.dx = m ? parseFloat(m[1]) : 0;
    entry.dy = m ? parseFloat(m[2]) : 0;
    entry.onDown = function (ev) { startDrag(ev, entry); };
    paths.forEach(function (p) {
      p.style.pointerEvents = "stroke";
      p.style.cursor = "move";
      p.addEventListener("pointerdown", entry.onDown);
    });
    registry.push(entry);
  }

  /* ── per-wire head-endpoint handles ───────────────────────────────────────
     Each charging wire ends on a bot's head. These cyan dots sit on those four
     head endpoints; drag one and the wire re-routes live (the game exposes
     __connectorHeads / __setConnectorHead). Exported as connectorHeads
     [{i,x,y}] → bake into CONNECTOR_HEADS in index.html. */
  var connHeads = [];   /* [{ el, i, gx, gy }] gx/gy = head point in game space (path coords) */
  var chDrag = null;

  function clearConnHeads() {
    connHeads.forEach(function (h) { if (h.el.parentNode) { h.el.parentNode.removeChild(h.el); } });
    connHeads = [];
  }
  function placeConnHead(h) {
    var nudge = (typeof window.__connectorNudge === "function") ? window.__connectorNudge() : { x: 0, y: 0 };
    var sr = gameEl().getBoundingClientRect();
    var px = sr.left + (h.gx + nudge.x) * (sr.width / GAME_W);
    var py = sr.top + (h.gy + nudge.y) * (sr.height / GAME_H);
    h.el.style.left = (px - 9) + "px";
    h.el.style.top = (py - 9) + "px";
  }
  function placeConnHeads() { connHeads.forEach(placeConnHead); }
  function registerConnectorHeads() {
    clearConnHeads();
    if (typeof window.__connectorHeads !== "function") { return; }
    var svg = document.getElementById("podConnectors");
    if (!svg || svg.offsetParent === null) { return; }
    var heads = window.__connectorHeads();
    if (!heads || !heads.length) { return; }
    var names = ["TL", "TR", "BL", "BR"];
    heads.forEach(function (hd) {
      var el = document.createElement("div");
      el.className = "dbg-conn-head";
      el.textContent = names[hd.i] || hd.i;
      el.title = "Drag this wire's head endpoint (" + (names[hd.i] || hd.i) + "→head)";
      document.body.appendChild(el);
      var h = { el: el, i: hd.i, gx: hd.x, gy: hd.y };
      connHeads.push(h);
      placeConnHead(h);
      el.addEventListener("pointerdown", function (ev) { startConnHeadDrag(ev, h); });
    });
  }
  function startConnHeadDrag(ev, h) {
    ev.preventDefault();
    ev.stopPropagation();
    chDrag = { h: h, sx: ev.clientX, sy: ev.clientY, gx: h.gx, gy: h.gy };
    window.addEventListener("pointermove", onConnHeadMove);
    window.addEventListener("pointerup", onConnHeadUp);
  }
  function onConnHeadMove(ev) {
    if (!chDrag) { return; }
    var h = chDrag.h;
    h.gx = round1(chDrag.gx + (ev.clientX - chDrag.sx) * scaleX());
    h.gy = round1(chDrag.gy + (ev.clientY - chDrag.sy) * scaleY());
    if (typeof window.__setConnectorHead === "function") { window.__setConnectorHead(h.i, h.gx, h.gy); }
    placeConnHead(h);
    renderInspector();
  }
  function onConnHeadUp() {
    chDrag = null;
    window.removeEventListener("pointermove", onConnHeadMove);
    window.removeEventListener("pointerup", onConnHeadUp);
  }

  /* Every alignable asset, across every screen. Containers (#bots, #playStage,
     #machineStage, …) and full-bleed backgrounds are excluded; their meaningful
     children are listed instead. Only the ones actually visible on the current
     screen get registered (offsetParent + size + background guards below). */
  var ASSET_SELECTORS = [
    /* fit / cut pieces + hollows */
    "#flightLayer .flying-half", "#cornerSlots .corner-slot", ".whole-block", ".block-demo",
    /* instruction panel */
    "#instruction",
    /* play screen */
    "#iraChar", "#iraGlowRing", "#playButton", "#labGate",
    /* charge / connect screens */
    ".bot-img", ".pod-img", ".head-plug",
    /* laser / machine screen */
    "#machineImg", "#laserImg", "#beamImg", "#machineBlock", "#cutLine",
    "#bubbleLeft", "#bubbleRight", "#bubbleCut",
    "#btnLeft", "#btnRight", "#btnCut", "#handGesture",
    /* teaching */
    "#teachContent",
    /* flow buttons */
    "#tryAgain", "#nextButton", "#finishButton"
  ];

  /* Visible on the CURRENT screen — .hidden is opacity:0 (not display:none), so
     check the element and its ancestors for opacity/visibility/display, not just
     offsetParent. Keeps the overlay from grabbing invisible off-screen assets. */
  function isVisible(el) {
    if (el.offsetParent === null) { return false; }
    var n = el;
    while (n && n !== document.body && n !== document.documentElement) {
      var cs = getComputedStyle(n);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.05) { return false; }
      n = n.parentElement;
    }
    return true;
  }

  function scan() {
    clearRegistry();
    var candidates = [];
    ASSET_SELECTORS.forEach(function (sel) {
      Array.prototype.forEach.call(document.querySelectorAll(sel), function (el) { candidates.push(el); });
    });

    var usedIds = {};
    candidates.forEach(function (el) {
      if (!el || !isVisible(el)) { return; }                 /* not on this screen */
      var r = gameRect(el);
      if (r.w < 6 || r.h < 6) { return; }
      if (isBackground(el)) { return; }
      if (registry.some(function (e) { return e.el === el; })) { return; }
      var id = idFor(el);
      if (usedIds[id]) { id = id + "-" + (++usedIds[id]); } else { usedIds[id] = 1; }
      var entry = { el: el, id: id };
      makePositionable(el, entry);
      entry.onDown = function (ev) { startDrag(ev, entry); };
      el.addEventListener("pointerdown", entry.onDown);
      el.style.cursor = "move";
      registry.push(entry);
    });
    registerConnectorGroup();
    registerConnectorHeads();
    renderInspector();
  }

  /* ── drag + resize ────────────────────────────────────────────────────── */
  var drag = null;
  var hdrag = null;   /* active resize-handle drag */

  var HANDLE_DIRS = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

  /* Position the 8 resize grips (corners + edge midpoints) on the selected
     element's screen box. Hidden when nothing is selected. */
  function placeHandles() {
    if (!handles.length) { return; }
    /* Group (the connector bundle) only translates — no resize grips. */
    if (!selected || !selected.el.isConnected || selected.group) {
      handles.forEach(function (h) { h.style.display = "none"; });
      return;
    }
    var r = selected.el.getBoundingClientRect();
    var mx = r.left + r.width / 2, my = r.top + r.height / 2;
    var pos = {
      nw: [r.left, r.top], n: [mx, r.top], ne: [r.right, r.top],
      e: [r.right, my], se: [r.right, r.bottom], s: [mx, r.bottom],
      sw: [r.left, r.bottom], w: [r.left, my]
    };
    handles.forEach(function (h) {
      var p = pos[h.getAttribute("data-dir")];
      h.style.display = "block";
      h.style.left = (p[0] - 7) + "px";
      h.style.top = (p[1] - 7) + "px";
    });
  }

  /* Start a resize from the given edge/corner. Each side moves independently
     (no aspect lock) so a block can be cropped or extended from any direction. */
  function startHandleResize(ev, dir) {
    if (!selected) { return; }
    ev.preventDefault();
    ev.stopPropagation();
    var g = gameRect(selected.el);
    hdrag = { dir: dir, sx: ev.clientX, sy: ev.clientY, W: g.w, H: g.h, L: g.left, T: g.top, dx: selected.dx || 0, dy: selected.dy || 0 };
    window.addEventListener("pointermove", onHandleMove);
    window.addEventListener("pointerup", onHandleUp);
  }

  /* Each side resizes independently; W/N edges keep the far edge fixed. Box mode
     sets left/top/width/height (1:1, no scale); xform mode keeps the rotation and
     compensates via a prepended translate. */
  function onHandleMove(ev) {
    if (!hdrag) { return; }
    var el = selected.el, d = hdrag.dir;
    var dx = (ev.clientX - hdrag.sx) * scaleX();
    var dy = (ev.clientY - hdrag.sy) * scaleY();
    var W = hdrag.W, H = hdrag.H;
    if (selected.mode === "box") {
      var L = hdrag.L, T = hdrag.T;
      if (d.indexOf("e") !== -1) { W = Math.max(8, hdrag.W + dx); }
      if (d.indexOf("w") !== -1) { W = Math.max(8, hdrag.W - dx); L = hdrag.L + (hdrag.W - W); }
      if (d.indexOf("s") !== -1) { H = Math.max(8, hdrag.H + dy); }
      if (d.indexOf("n") !== -1) { H = Math.max(8, hdrag.H - dy); T = hdrag.T + (hdrag.H - H); }
      el.style.left = round1(L) + "px";
      el.style.top = round1(T) + "px";
      el.style.width = round1(W) + "px";
      el.style.height = round1(H) + "px";
    } else {
      selected.dx = hdrag.dx; selected.dy = hdrag.dy;
      if (d.indexOf("e") !== -1) { W = Math.max(8, hdrag.W + dx); }
      if (d.indexOf("w") !== -1) { W = Math.max(8, hdrag.W - dx); selected.dx = hdrag.dx + (hdrag.W - W); }
      if (d.indexOf("s") !== -1) { H = Math.max(8, hdrag.H + dy); }
      if (d.indexOf("n") !== -1) { H = Math.max(8, hdrag.H - dy); selected.dy = hdrag.dy + (hdrag.H - H); }
      el.style.width = round1(W) + "px";
      el.style.height = round1(H) + "px";
      applyXform(selected);
    }
    placeHandles();
    renderInspector();
  }

  function onHandleUp() {
    hdrag = null;
    window.removeEventListener("pointermove", onHandleMove);
    window.removeEventListener("pointerup", onHandleUp);
  }

  function startDrag(ev, entry) {
    ev.preventDefault();
    ev.stopPropagation();
    select(entry);
    var resize = ev.shiftKey && !entry.group;   /* Shift+drag = uniform resize, plain drag = move */
    var g = gameRect(entry.el);
    drag = {
      entry: entry, resize: resize,
      startX: ev.clientX, startY: ev.clientY,
      dx: entry.dx || 0, dy: entry.dy || 0,
      left: parseFloat(entry.el.style.left) || 0, top: parseFloat(entry.el.style.top) || 0,
      w: g.w, h: g.h
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function onMove(ev) {
    if (!drag) { return; }
    var dx = (ev.clientX - drag.startX) * scaleX();
    var dy = (ev.clientY - drag.startY) * scaleY();
    var el = drag.entry.el;
    if (drag.resize) {
      /* uniform scale from the drag distance; keeps aspect */
      var factor = Math.max(0.25, 1 + dy / Math.max(40, drag.h));
      el.style.width = round1(drag.w * factor) + "px";
      el.style.height = round1(drag.h * factor) + "px";
    } else if (drag.entry.mode === "box") {
      el.style.left = round1(drag.left + dx) + "px";
      el.style.top = round1(drag.top + dy) + "px";
    } else {
      drag.entry.dx = drag.dx + dx;
      drag.entry.dy = drag.dy + dy;
      applyXform(drag.entry);
    }
    placeHandles();
    renderInspector();
  }

  function onUp() {
    drag = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  }

  function select(entry) {
    if (selected) { selected.el.classList.remove("dbg-selected"); }
    selected = entry;
    if (entry && !entry.group) { entry.el.classList.add("dbg-selected"); }   /* group is full-frame; skip the box outline */
    placeHandles();
    renderInspector();
  }

  /* Arrow-key nudge for the selected element (Shift = 10px). */
  function onKey(ev) {
    if (!selected) { return; }
    var step = ev.shiftKey ? 10 : 1;
    if (selected.mode === "box") {
      var el = selected.el;
      var l = parseFloat(el.style.left) || 0, t = parseFloat(el.style.top) || 0;
      if (ev.key === "ArrowLeft") { el.style.left = (l - step) + "px"; }
      else if (ev.key === "ArrowRight") { el.style.left = (l + step) + "px"; }
      else if (ev.key === "ArrowUp") { el.style.top = (t - step) + "px"; }
      else if (ev.key === "ArrowDown") { el.style.top = (t + step) + "px"; }
      else { return; }
    } else {
      if (ev.key === "ArrowLeft") { selected.dx -= step; }
      else if (ev.key === "ArrowRight") { selected.dx += step; }
      else if (ev.key === "ArrowUp") { selected.dy -= step; }
      else if (ev.key === "ArrowDown") { selected.dy += step; }
      else { return; }
      applyXform(selected);
    }
    ev.preventDefault();
    placeHandles();
    renderInspector();
  }

  /* ── export ───────────────────────────────────────────────────────────── */
  function currentScreenName() {
    if (document.querySelector("#flightLayer .dbg-piece")) { return "fit"; }
    var step = window.FLOW[window.state.step];
    return step ? step.scene : "?";
  }

  function buildJSON() {
    var r = window.ROUNDS[window.state.round] || {};
    var heads = (typeof window.__connectorHeads === "function") ? window.__connectorHeads() : [];
    return {
      round: window.state.round,
      roundName: r.name || "",
      screen: currentScreenName(),
      connectorHeads: heads.map(function (h) { return { i: h.i, x: round1(h.x), y: round1(h.y) }; }),
      assets: registry.map(function (e) {
        if (e.group) {
          /* connector bundle: just the {x,y} translate offset to bake into CONNECTOR_NUDGE */
          return { id: e.id, x: round1(e.dx), y: round1(e.dy) };
        }
        var g = gameRect(e.el);
        /* dx/dy = how far this asset was nudged from its built-in position (handy
           for a small CSS tweak); x/y/w/h = its final game-space box. */
        return {
          id: e.id,
          x: round1(g.left), y: round1(g.top),
          w: round1(g.w), h: round1(g.h),
          cx: round1(g.cx), cy: round1(g.cy),
          dx: round1(e.dx || 0), dy: round1(e.dy || 0)
        };
      })
    };
  }

  function download() {
    var data = buildJSON();
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "layout_" + data.roundName + "_" + data.screen + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ── navigation ───────────────────────────────────────────────────────── */
  function gotoScene(stepIndex) {
    if (typeof window.clearTimers === "function") { window.clearTimers(); }
    if (typeof window.stopInstructionAudio === "function") { window.stopInstructionAudio(); }
    window.state.step = stepIndex;
    window.renderStep();
    /* When frozen, cancel the scene's auto-advance IMMEDIATELY (not after a
       delay) so even short charge scenes — intro/plug/plugReady/moveOut, whose
       durations are under a second — hold on screen instead of slipping to the
       next one before you can align them. CSS entrance animations still play; we
       only kill the JS timers (auto-advance + deferred polish). A second clear +
       scan a moment later catches anything rescheduled as layout settles. */
    if (frozen) {
      if (typeof window.clearTimers === "function") { window.clearTimers(); }
      setTimeout(function () { if (frozen && typeof window.clearTimers === "function") { window.clearTimers(); } scan(); }, 450);
    } else {
      setTimeout(scan, 400);
    }
  }

  function gotoFit() {
    if (typeof window.__debugRenderFit === "function") {
      window.__debugRenderFit(window.state.round);
      setTimeout(scan, 250);
    }
  }

  function setRound(i) {
    window.state.round = i;
    syncRoundChips();
    /* re-render whatever screen we're on for the new round */
    if (currentScreenName() === "fit") { gotoFit(); }
    else { gotoScene(window.state.step); }
  }

  /* ── panel UI ─────────────────────────────────────────────────────────── */
  var panel, inspectorBox, roundRow;

  function syncRoundChips() {
    if (!roundRow) { return; }
    Array.prototype.forEach.call(roundRow.children, function (btn, i) {
      btn.classList.toggle("on", i === window.state.round);
    });
  }

  function renderInspector() {
    if (!inspectorBox) { return; }
    var html = "";
    registry.forEach(function (e) {
      var on = (selected === e) ? " on" : "";
      if (e.group) {
        html += '<div class="dbg-row' + on + '" data-id="' + e.id + '">' +
          '<b>' + e.id + '</b>' +
          '<span>offset x ' + round1(e.dx) + ' &nbsp; y ' + round1(e.dy) + '</span>' +
          '<span>grab a wire / arrows to nudge</span>' +
          '</div>';
        return;
      }
      var g = gameRect(e.el);
      html += '<div class="dbg-row' + on + '" data-id="' + e.id + '">' +
        '<b>' + e.id + '</b>' +
        '<span>x ' + round1(g.left) + ' &nbsp; y ' + round1(g.top) + '</span>' +
        '<span>w ' + round1(g.w) + ' &nbsp; h ' + round1(g.h) + '</span>' +
        '</div>';
    });
    if (!registry.length) { html = '<div class="dbg-empty">No elements on this screen. Pick a screen, then Re-scan.</div>'; }
    inspectorBox.innerHTML = html;
    Array.prototype.forEach.call(inspectorBox.querySelectorAll(".dbg-row"), function (row) {
      row.addEventListener("click", function () {
        var entry = registry.filter(function (e) { return e.id === row.getAttribute("data-id"); })[0];
        if (entry) { select(entry); entry.el.scrollIntoView && 0; }
      });
    });
  }

  function btn(label, title, cls) {
    var b = document.createElement("button");
    b.type = "button"; b.textContent = label; b.title = title || label;
    b.className = "dbg-btn" + (cls ? " " + cls : "");
    return b;
  }

  function build() {
    var style = document.createElement("style");
    style.textContent =
      "#dbgPanel{position:fixed;top:42px;right:8px;z-index:99998;width:248px;max-height:90vh;overflow:auto;" +
        "background:rgba(14,22,44,.95);border:1px solid #3f6bd0;border-radius:12px;color:#eaf2ff;" +
        "font:12px 'Trebuchet MS',Arial,sans-serif;padding:10px;box-shadow:0 6px 22px rgba(0,0,0,.45);user-select:none}" +
      "#dbgPanel h4{margin:0 0 6px;font-size:12px;letter-spacing:.4px;color:#9fc2ff;display:flex;align-items:center;justify-content:space-between;gap:6px}" +
      "#dbgPanel .dbg-collapse{cursor:pointer;border:none;border-radius:6px;background:#21345f;color:#eaf2ff;width:22px;height:20px;font-size:11px;line-height:1;padding:0}" +
      "#dbgPanel .dbg-collapse:hover{background:#2c4a86}" +
      "#dbgPanel .dbg-sec{margin:8px 0;padding-top:8px;border-top:1px solid #2a3c66}" +
      "#dbgPanel .dbg-btn{cursor:pointer;border:none;border-radius:8px;background:#21345f;color:#eaf2ff;" +
        "padding:5px 8px;margin:2px 2px 0 0;font:12px 'Trebuchet MS',Arial,sans-serif}" +
      "#dbgPanel .dbg-btn:hover{background:#2c4a86}" +
      "#dbgPanel .dbg-btn.on{background:#3f8bd0;color:#fff}" +
      "#dbgPanel .dbg-btn.go{background:#2e7d4f}#dbgPanel .dbg-btn.go:hover{background:#379a60}" +
      "#dbgPanel .dbg-btn.dl{background:#b9852b;width:100%;margin-top:6px}#dbgPanel .dbg-btn.dl:hover{background:#d39a33}" +
      "#dbgPanel select{width:100%;border:none;border-radius:8px;background:#21345f;color:#eaf2ff;" +
        "padding:5px 6px;font:12px 'Trebuchet MS',Arial,sans-serif;margin-top:4px}" +
      "#dbgPanel .dbg-row{display:flex;flex-direction:column;gap:1px;padding:4px 6px;border-radius:6px;cursor:pointer;margin-top:3px;background:#19284a}" +
      "#dbgPanel .dbg-row.on{background:#2f4f86;outline:1px solid #5fa0ff}" +
      "#dbgPanel .dbg-row b{color:#ffd98a}#dbgPanel .dbg-row span{color:#bcd2f5;font-size:11px}" +
      "#dbgPanel .dbg-empty{color:#8aa3cf;font-size:11px;padding:4px}" +
      "#dbgPanel .dbg-hint{color:#8aa3cf;font-size:10.5px;line-height:1.45;margin-top:6px}" +
      ".dbg-selected{outline:2px dashed #ffd98a !important;outline-offset:1px}" +
      ".dbg-h{position:fixed;width:14px;height:14px;background:#ffd98a;border:2px solid #b9852b;" +
        "border-radius:3px;z-index:99999;box-shadow:0 1px 4px rgba(0,0,0,.5)}" +
      ".dbg-conn-head{position:fixed;width:18px;height:18px;border-radius:50%;z-index:99999;cursor:move;" +
        "background:#23e0ff;border:2px solid #0a6c8a;box-shadow:0 0 8px rgba(35,224,255,.9);" +
        "color:#04303f;font:bold 9px/18px 'Trebuchet MS',Arial,sans-serif;text-align:center;" +
        "letter-spacing:-.5px;user-select:none;touch-action:none}";
    document.head.appendChild(style);

    /* 8 resize grips: corners + edge midpoints. Each drags its own side(s). */
    var CURSORS = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };
    HANDLE_DIRS.forEach(function (dir) {
      var h = document.createElement("div");
      h.className = "dbg-h";
      h.setAttribute("data-dir", dir);
      h.style.display = "none";
      h.style.cursor = CURSORS[dir];
      h.title = "Drag to resize the " + dir.toUpperCase() + " side";
      h.addEventListener("pointerdown", function (ev) { startHandleResize(ev, dir); });
      document.body.appendChild(h);
      handles.push(h);
    });
    window.addEventListener("scroll", function () { placeHandles(); placeConnHeads(); }, true);
    window.addEventListener("resize", function () { placeHandles(); placeConnHeads(); });

    panel = document.createElement("div");
    panel.id = "dbgPanel";

    /* Draggable, collapsible header so the panel never traps the corner pieces
       sitting under it. Click ▾/▸ to collapse to just the bar; drag the title to
       move the whole panel out of the way. */
    var h = document.createElement("h4");
    var hTitle = document.createElement("span");
    hTitle.textContent = "LAYOUT ALIGN";
    hTitle.style.cursor = "grab";
    var hToggle = document.createElement("button");
    hToggle.type = "button"; hToggle.className = "dbg-collapse"; hToggle.textContent = "▾";
    hToggle.title = "Collapse / expand";
    h.appendChild(hTitle);
    h.appendChild(hToggle);
    panel.appendChild(h);

    var bodyWrap = document.createElement("div");
    bodyWrap.className = "dbg-body";

    hToggle.addEventListener("click", function () {
      var hidden = bodyWrap.style.display === "none";
      bodyWrap.style.display = hidden ? "" : "none";
      hToggle.textContent = hidden ? "▾" : "▸";
    });
    /* drag the panel by its title */
    var pdrag = null;
    hTitle.addEventListener("pointerdown", function (ev) {
      var pr = panel.getBoundingClientRect();
      pdrag = { sx: ev.clientX, sy: ev.clientY, left: pr.left, top: pr.top };
      panel.style.right = "auto";
      hTitle.style.cursor = "grabbing";
      ev.preventDefault();
    });
    window.addEventListener("pointermove", function (ev) {
      if (!pdrag) { return; }
      panel.style.left = (pdrag.left + ev.clientX - pdrag.sx) + "px";
      panel.style.top = (pdrag.top + ev.clientY - pdrag.sy) + "px";
    });
    window.addEventListener("pointerup", function () {
      if (pdrag) { pdrag = null; hTitle.style.cursor = "grab"; }
    });

    /* round chips */
    var rsec = document.createElement("div");
    rsec.className = "dbg-sec";
    var rlab = document.createElement("div"); rlab.textContent = "Round"; rlab.style.color = "#9fc2ff";
    rsec.appendChild(rlab);
    roundRow = document.createElement("div");
    window.ROUNDS.forEach(function (r, i) {
      var b = btn(r.label || r.name || ("R" + i), "Switch to " + (r.name || i));
      b.addEventListener("click", function () { setRound(i); });
      roundRow.appendChild(b);
    });
    rsec.appendChild(roundRow);
    bodyWrap.appendChild(rsec);

    /* scene controls */
    var ssec = document.createElement("div");
    ssec.className = "dbg-sec";
    var slab = document.createElement("div"); slab.textContent = "Screen"; slab.style.color = "#9fc2ff";
    ssec.appendChild(slab);
    var sel = document.createElement("select");
    window.FLOW.forEach(function (step, i) {
      var o = document.createElement("option");
      o.value = i; o.textContent = i + ": " + step.scene;
      sel.appendChild(o);
    });
    sel.addEventListener("change", function () { gotoScene(Number(sel.value)); });
    ssec.appendChild(sel);
    var fitBtn = btn("▶ Blocks-in-slots (fit)", "Render the static fit screen for alignment", "go");
    fitBtn.style.width = "100%"; fitBtn.style.marginTop = "6px";
    fitBtn.addEventListener("click", gotoFit);
    ssec.appendChild(fitBtn);
    var freezeBtn = btn("🔒 Stay on this screen: ON", "Cancel the screen's auto-advance so it stays put", "on");
    freezeBtn.style.width = "100%"; freezeBtn.style.marginTop = "6px";
    freezeBtn.addEventListener("click", function () {
      frozen = !frozen;
      freezeBtn.textContent = "🔒 Stay on this screen: " + (frozen ? "ON" : "OFF");
      freezeBtn.classList.toggle("on", frozen);
      if (frozen && typeof window.clearTimers === "function") { window.clearTimers(); }
    });
    ssec.appendChild(freezeBtn);
    var rescan = btn("Re-scan elements", "Re-attach drag/resize handles");
    rescan.addEventListener("click", scan);
    ssec.appendChild(rescan);
    bodyWrap.appendChild(ssec);

    /* inspector */
    var isec = document.createElement("div");
    isec.className = "dbg-sec";
    var ilab = document.createElement("div"); ilab.textContent = "Elements (click to select)"; ilab.style.color = "#9fc2ff";
    isec.appendChild(ilab);
    inspectorBox = document.createElement("div");
    isec.appendChild(inspectorBox);
    var dl = btn("⬇ Download Layout JSON", "Export positions for Claude", "dl");
    dl.addEventListener("click", download);
    isec.appendChild(dl);
    bodyWrap.appendChild(isec);

    var hint = document.createElement("div");
    hint.className = "dbg-hint";
    hint.innerHTML = "Click a block to select it.<br>Drag body = move &nbsp;·&nbsp; drag any <b>orange grip</b> (corners + sides) = resize that edge<br>Grab a <b>cyan wire</b> = move the whole charging-connector bundle<br>Drag a <b>cyan TL/TR/BL/BR dot</b> = move that wire's head endpoint (over the bot head); exported as connectorHeads<br>Arrows = nudge (Shift = 10px)<br>Pick a round, hit <b>Blocks-in-slots</b>, align into the hollows, then Download JSON.";
    bodyWrap.appendChild(hint);

    panel.appendChild(bodyWrap);
    document.body.appendChild(panel);
    window.addEventListener("keydown", onKey);

    sel.value = window.state.step;
    syncRoundChips();
    setTimeout(scan, 300);
  }

  whenReady(build);
})();
