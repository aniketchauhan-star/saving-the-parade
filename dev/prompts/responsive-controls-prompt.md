# RESPONSIVE CONTROLS — Home / Back / Next must never overlap, on any screen

Act as a senior frontend developer. Work directly on the project files
(`styles.css`, and `script.js` / `index.html` only where genuinely required),
implement everything below, verify it with Playwright, and do not claim a
requirement passed without actually testing it.

## The bug

The book chrome (Home, Back, Next, the progress pill, and the game's own Next)
looks correct on ONE machine and breaks on other laptops and on tablets:
buttons overlap each other, sit half off-screen, or crowd the book.

## Why it breaks — diagnose against these exact rules before changing anything

Current state in `styles.css`:

| Control | Rule | Position | Size |
|---|---|---|---|
| `.corner-arrow` | ~L161 | `position:fixed; bottom: clamp(-10px, -0.5vh, -2px); z-index:700` | `clamp(84px, 10vw, 124px)` square |
| `.corner-arrow.back` | ~L228 | `left: clamp(12px, 2.5vw, 34px)` | — |
| `.corner-arrow.fwd` | ~L229 | `right: clamp(12px, 2.5vw, 34px)` | — |
| `.home-btn` | ~L192 | `position:fixed; top: clamp(-12px, -0.9vh, -4px); right: clamp(8px, 1.6vw, 22px); z-index:720` | `clamp(84px, 10vw, 124px)` square |
| `.toolbar` / `.progress` | ~L1109 | `position:fixed; left:50%; bottom: clamp(2px, 0.6vh, 8px); z-index:650`, pill `min-width:108px` | — |
| `.lbd-next` | ~L974 | `position:absolute` inside `.lbd-stage`, `right: clamp(14px,2.4vw,38px); bottom: clamp(16px,3vh,34px)` | — |

Six concrete defects follow from that:

1. **Sizing has no height term.** Every control scales on `vw` alone, so a
   1280×720 / 1366×768 laptop (or a 1080p panel at 150% OS scaling) keeps
   110–124px buttons while the usable height collapses. Fix by scaling on the
   SMALLER of the two axes.
2. **Negative vertical offsets** (`bottom: clamp(-10px,-0.5vh,-2px)`,
   `top: clamp(-12px,-0.9vh,-4px)`) deliberately bleed the button box off-screen
   to trim the SVG's internal padding. The crop amount is tied to `vh`, so it
   differs per device and the glyph looks clipped or floats away from the edge.
   Trim the artwork, not the layout — position with real, non-negative offsets.
3. **The bottom band is unmanaged.** Back arrow (left), progress pill (centre),
   forward arrow (right) are three independent `position:fixed` elements with no
   reserved gap. Around 700–900px wide, the 84px arrow boxes meet the 108px-min
   pill and overlap.
4. **The right gutter is inconsistent.** `.home-btn` uses `right: clamp(8px,1.6vw,22px)`
   while `.corner-arrow.fwd` uses `right: clamp(12px,2.5vw,34px)` — they are not
   on the same vertical lane, and on short viewports their 124px boxes converge.
5. **`.lbd-next` collides with the forward arrow.** It sits bottom-right of
   `.lbd-stage`, but the chrome hide at ~L1024 (`body.lbd-is-fullscreen .corner-arrow`)
   only applies in FULLSCREEN. In page-rect (non-fullscreen) game mode both
   bottom-right buttons are on screen at once.
6. **No safe-area handling and no touch-target floor** — controls clip on
   tablets with rounded corners / home indicators, and nothing guarantees a
   44×44 CSS-px hit area once they shrink.

## What to build

7. Define ONE set of control tokens on `:root` and drive every control from them
   — no more per-control magic numbers:

```css
:root {
  /* scales on the SMALLER axis, so short screens shrink it too */
  --ctl:      clamp(52px, min(8.5vw, 13vh), 112px);
  --ctl-gap:  clamp(8px, 1.4vw, 20px);
  --edge-x:   calc(clamp(10px, 2vw, 30px) + env(safe-area-inset-left, 0px));
  --edge-r:   calc(clamp(10px, 2vw, 30px) + env(safe-area-inset-right, 0px));
  --edge-b:   calc(clamp(6px, 1.2vh, 16px) + env(safe-area-inset-bottom, 0px));
  --edge-t:   calc(clamp(6px, 1.2vh, 16px) + env(safe-area-inset-top, 0px));
  /* height the bottom band claims — the book must not sit inside it */
  --band-b:   calc(var(--ctl) + var(--edge-b));
}
```

8. **Right gutter is one lane.** `.home-btn` and `.corner-arrow.fwd` use the
   IDENTICAL `right` value (`var(--edge-r)`), so they read as a single vertical
   column: Home pinned top-right at `top: var(--edge-t)`, forward arrow pinned
   bottom-right at `bottom: var(--edge-b)`. No negative offsets anywhere.
9. **The bottom band must never overlap.** The centred `.toolbar` may not enter
   either arrow's column. Give it a hard ceiling:

```css
.toolbar { max-width: calc(100vw - 2 * (var(--ctl) + var(--ctl-gap) + var(--edge-x))); }
```

   When that width drops under the pill's natural size, shrink the pill's
   font-size and `min-width` rather than letting it overlap. If the band still
   cannot fit all three, move `.progress` to top-CENTRE (it is passive,
   `cursor:default` — it is the one safe thing to relocate). Never solve an
   overlap by raising a z-index; z-order hides a collision, it does not fix it.
10. **Short-viewport step.** Add `@media (max-height: 620px)` and
    `@media (max-width: 820px)` breakpoints that reduce `--ctl` and the edge
    insets further. Verify the book's own scaling still centres correctly with
    the bottom band reserved.
11. **Touch-target floor.** After shrinking, every control keeps a ≥44×44 CSS-px
    activation area. If the visible glyph is smaller, expand the hit area with a
    transparent `::before` (`position:absolute; inset:-Npx`) — do not inflate the
    visual size.
12. **Fix the `.lbd-next` collision.** While the embedded game is mounted in
    page-rect mode, either hide `.corner-arrow.fwd` (the game's own Next owns
    forward navigation at that moment) or offset `.lbd-next` clear of the arrow's
    reserved column. Whichever you choose, the two boxes must not intersect at
    any tested viewport. Keep the existing fullscreen behaviour at ~L1024 intact.
13. **Do not regress behaviour.** All of these must keep working exactly as they
    do now: the `.show` / `.is-visible` / `.is-hidden` JS toggles; `body.is-open`
    gating; `[disabled] { opacity:0.22 !important; pointer-events:none; animation:none !important }`;
    the `arrowReveal` pop and its `backwards`-only fill; the mirrored back glyph
    (`.corner-arrow.back svg { transform: scaleX(-1) }`); `body.lbd-is-fullscreen`
    hiding all chrome; the portrait+`pointer:coarse` rotate lock at ~L1131; and
    `body.is-resizing` freezing page-turn transitions.
14. Prefer CSS-only fixes. Only touch `script.js` if a measurement/repositioning
    helper (e.g. `positionFlipHint`) genuinely needs the new tokens.

## Verify with Playwright — this must be an automated assertion, not eyeballing

15. Add a spec (extend `dev/tests/controls.spec.mjs`) that, for EVERY viewport
    below and at each meaningful book state (cover, first story page, a mid page
    with the game in page-rect mode, game fullscreen, last page), asserts that
    **no two of these bounding boxes intersect**:
    `#homeBtn`, `#cornerPrev`, `#cornerNext`, `.toolbar`, `#lbdNextBtn`.
    Write a real rect-intersection helper — do not approximate with
    `toBeVisible()`.

```
1920 x 1080   desktop
1536 x 864    1080p @ 125% scaling
1366 x 768    common budget laptop  ← the usual failure case
1280 x 720
1194 x 834    iPad Air landscape
1024 x 768    iPad landscape
 912 x 1368   tablet portrait
 820 x 1180   iPad Air portrait (expect the rotate lock on coarse pointer)
```

16. Also assert, at every viewport: each visible control is fully inside the
    viewport (`x >= 0`, `y >= 0`, `x+width <= innerWidth`, `y+height <= innerHeight`)
    — this is what catches the negative-offset clipping; and every control's hit
    area is ≥44×44.
17. Test-writing traps that will otherwise give false passes: park the mouse far
    away before measuring (`:hover` applies `scale(1.12)` and skews the box), and
    wait ~650ms after a reveal before measuring (`arrowReveal` starts at
    `scale(0.55)`).
18. Run the full existing suite from `dev/` (`npx playwright test`) and report
    the real output. `controls.spec.mjs`, `gating.spec.mjs`, `crawl.spec.mjs` and
    `lbd.spec.mjs` must all still pass — if something fails, say so rather than
    describing it as passing.
