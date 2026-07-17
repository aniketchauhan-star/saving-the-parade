/*
 * Screen Switcher for PowerUp Bots.
 * ----------------------------------------------------------------------------
 * A small, always-visible debug bar for jumping straight to any screen of the
 * flow without playing through. A compact pill at top-centre: ‹ prev | screen
 * dropdown | next ›. It shows whenever this script is loaded (one <script> tag
 * at the bottom of index.html) — purely additive, so deleting that tag fully
 * restores the clean game. Separate from debug.js (the layout/alignment
 * overlay): that one moves assets, this one navigates scenes.
 *
 * How it jumps: the game exposes its state machine on window (FLOW, state,
 * renderStep, clearTimers). A jump sets state.step and re-renders. Some scenes
 * immediately advance themselves (e.g. grid-round guards call nextStep) — when
 * that happens the dropdown just re-syncs to wherever the game actually landed.
 */
(function () {
  "use strict";

  if (window.__screenSwitcherLoaded) { return; }
  window.__screenSwitcherLoaded = true;

  /* Wait for the game's globals to be wired before building the bar. */
  function ready() {
    return window.FLOW && window.state && typeof window.renderStep === "function";
  }
  function whenReady(fn) {
    if (ready()) { fn(); return; }
    var tries = 0;
    var id = setInterval(function () {
      if (ready() || ++tries > 100) { clearInterval(id); if (ready()) { fn(); } }
    }, 50);
  }

  function jump(i) {
    if (i < 0 || i >= window.FLOW.length) { return; }
    if (typeof window.clearTimers === "function") { window.clearTimers(); }
    if (typeof window.stopInstructionAudio === "function") { window.stopInstructionAudio(); }
    window.state.step = i;
    window.renderStep();
  }

  function build() {
    var FLOW = window.FLOW;

    var bar = document.createElement("div");
    bar.id = "screenSwitcher";

    var prev = document.createElement("button");
    prev.type = "button"; prev.className = "ss-arrow"; prev.textContent = "‹"; prev.title = "Previous screen";

    var sel = document.createElement("select");
    sel.className = "ss-select"; sel.title = "Jump to screen";
    FLOW.forEach(function (step, i) {
      var opt = document.createElement("option");
      opt.value = i;
      var hint = step.text ? " — " + step.text.replace("{shape}", "").slice(0, 24) : "";
      opt.textContent = i + ": " + step.scene + hint;
      sel.appendChild(opt);
    });

    var next = document.createElement("button");
    next.type = "button"; next.className = "ss-arrow"; next.textContent = "›"; next.title = "Next screen";

    bar.appendChild(prev);
    bar.appendChild(sel);
    bar.appendChild(next);

    var style = document.createElement("style");
    style.textContent =
      "#screenSwitcher{position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:99999;" +
        "display:flex;align-items:center;gap:4px;padding:3px 4px;border-radius:18px;" +
        "background:rgba(18,28,54,.92);border:1px solid #3f6bd0;box-shadow:0 4px 16px rgba(0,0,0,.4);" +
        "font:12px 'Trebuchet MS',Arial,sans-serif;user-select:none}" +
      "#screenSwitcher .ss-arrow{cursor:pointer;border:none;border-radius:50%;width:24px;height:24px;" +
        "background:#21345f;color:#eaf2ff;font-size:16px;line-height:1;padding:0}" +
      "#screenSwitcher .ss-arrow:hover{background:#2c4a86}" +
      "#screenSwitcher .ss-select{max-width:230px;border:none;border-radius:12px;background:#21345f;" +
        "color:#eaf2ff;font:12px 'Trebuchet MS',Arial,sans-serif;padding:4px 8px;cursor:pointer;outline:none}";

    document.body.appendChild(style);
    document.body.appendChild(bar);

    prev.addEventListener("click", function () { jump(window.state.step - 1); });
    next.addEventListener("click", function () { jump(window.state.step + 1); });
    sel.addEventListener("change", function () { jump(Number(sel.value)); });

    /* Keep the dropdown showing the screen the game is actually on (it can
       self-advance) — but don't fight the user while the menu is open. */
    setInterval(function () {
      if (document.activeElement !== sel && Number(sel.value) !== window.state.step) {
        sel.value = window.state.step;
      }
    }, 250);
  }

  whenReady(build);
})();
