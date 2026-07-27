# NEXT BUTTON — implementation prompt

Act as a senior HTML5 game/frontend developer. Work directly on the project files,
implement everything below, test it with Playwright, and do not claim a requirement
passed without testing it.

## Placement and appearance

1. The Next button is fixed at the viewport's bottom-RIGHT corner, outside the
   book/content artwork:

```css
width:  clamp(84px, 10vw, 124px);
height: clamp(84px, 10vw, 124px);
bottom: clamp(-10px, -0.5vh, -2px);
right:  clamp(12px, 2.5vw, 34px);
z-index: 700;
```

2. The arrow glyph fills ~62% of the button box. Use ONE arrow asset shared with
   the Back button; mirror Back on an INNER element (`transform: scaleX(-1)`) so
   the button's own hover/active transforms can never overwrite the mirroring.
3. States and motion:
   - `display: none` before the experience starts (never on the cover).
   - visible state: `display: flex`, centred content, `opacity: 0.96`,
     400ms opacity fade, `cursor: pointer`.
   - hover `scale(1.12)`, active `scale(0.9)`, ~150ms transform transitions.
   - reveal animation: ~400ms fade + gentle pop (overshoot to ~1.08, settle at 1).
     The animation must NOT use a forwards fill and must NOT run while the button
     is disabled — a filling/looping animation that touches `opacity` will
     silently override the disabled style.
   - disabled state: `opacity: 0.22 !important; pointer-events: none;
     animation: none !important;` plus the real `disabled` property AND
     `aria-disabled`. (The `!important` matters: a higher-specificity base rule
     like `body.is-open .corner-arrow` will otherwise win over `[disabled]`.)
   - no focus ring (`:focus / :focus-visible { outline: none; box-shadow: none; }`)
     but keep a real `<button>` with an accessible name and keyboard operability.

## Core behavior — the button is NOT THERE until the video ends

4. On EVERY page that owns a video, the Next button must be completely hidden —
   `display: none`, `disabled`, `aria-hidden="true"` — from the moment the page
   is entered. Do not show it in a faded/disabled state.
5. The button appears (with the fade + pop reveal) only when the page's gate
   opens, through whichever of these three release paths fires first:
   - the video's real `ended` event;
   - the video's `error` event;
   - a watchdog timer: known duration + ~4 seconds, or 30 seconds when the
     duration is unknown (re-tighten the timer if metadata arrives later).
   A learner must never be trapped by a broken or stalled video.
6. Pages WITHOUT a video (e.g. an embedded game page) show the button
   immediately, enabled. The final page shows it visible but disabled
   (its own Replay control owns the action).
7. FIRST story page only — dual gate: the button stays hidden until BOTH
   `firstPageVideoCompleted` AND `firstPageInteractionCompleted` are true.
   If the page has no required interaction, treat the interaction flag as
   complete from the start; if it has no video, treat the video flag as
   complete. Mis-taps or merely starting the interaction must not count.

## Gating must cover every forward route

8. Route ALL forward navigation through one central guard
   (`canNavigateForward()` or equivalent): the Next button click, keyboard
   (ArrowRight), swipe/drag gestures, clickable page corners, autoplay, and
   every programmatic page-turn call. Disabling the visible button alone is
   not acceptable.
9. Re-arm the gate on EVERY page arrival, including back-navigation revisits
   (careful: the old video's `.ended` is still true from the previous visit at
   arming time if the replay reset happens later — never open the gate on that
   stale state). Clear all listeners and watchdog timers when leaving a page so
   a stale timer can never unlock the wrong page.
10. Clicking Next turns exactly ONE page; lock navigation until the page-turn
    transition finishes so double-taps cannot skip pages.
11. While an embedded game/LBD is fullscreen, the button is hidden with
    `display: none !important` and no navigation route may turn pages
    underneath the game.
12. Back and Home must remain available while a page video is playing.

## Verify with Playwright (all of these must actually pass)

- Button absent on the cover and on every video page while its clip plays
  (`display:none`, disabled, aria-hidden).
- Keyboard, swipe, page-corner and programmatic navigation are all blocked
  while the gate is locked.
- The real `ended` event reveals the button with the pop animation; clicking it
  advances exactly one page (double-click still one page).
- Back-navigation to a previously finished page re-hides and re-arms it.
- A deliberately broken video source still releases it via error/watchdog.
- On the last page it is visible and disabled at 0.22 opacity with
  `pointer-events: none`.
- It disappears entirely during embedded-game fullscreen and returns after.
- Test-writing traps to avoid: park the mouse away before measuring the button
  box (`:hover` scale skews it), and wait ~650ms after the reveal before
  measuring (the pop animation starts at scale 0.55).
