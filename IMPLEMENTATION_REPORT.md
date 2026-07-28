# Implementation Report — "Saving the Parade" flipbook + PowerUp Bots LBD

Date: 2026-07-25 · Workspace: `saving the parade/` · Deployed payload: static site, no build step.

---

## 1. Project structure discovered

- **Flipbook root** = repo root: `index.html`, `script.js` (flip engine + page content), `styles.css`, `sfx-data.js` (base64 SFX for Web Audio), `assets/` (story videos + posters + cover/play art), `sfx/` (flip SFX fallbacks).
- **New LBD source** = `LBD 1/story/` — a standalone single-file HTML5 game (~11.6k lines, inline CSS+JS) with `assets/`, `audios/`, and dev tooling (`debug.js`, `debugScreens.js`). **This folder was never modified.**

## 2. Page-indexing logic

Pages are one JS array (`pages` in `script.js`); the engine builds one CSS-3D "leaf" per entry, and `flipped` (count of turned leaves) is the current page index. "Page N" = array index N−1. Order after integration: video, video, video, **LBD (index 3 — immediately after story page 3)**, video, THE END.

## 3. Original LBD implementation removed

The previous integration pointed the overlay iframe **directly at the source folder** (`LBD%201/story/index.html`), loaded it only on landing (cold boot with a visible wait), forced fullscreen immediately on page arrival, and showed a manual overlay "Next" button (`#lbdNextBtn` + `assets/next button.webp`) 3.8 s after `activity_complete`. All of it was removed: the pages entry now points at `game/`, the `#lbdNextBtn` markup/CSS/handlers are gone, and completion auto-advances the book.

## 4. New LBD boot flow

`renderStep()` at the end of the game script renders `FLOW[0] = {scene:"play"}` — the start screen (`GameStartScreen.webp` + `#playButton` "Let's Go", armed with `.play-ready` ~560 ms after boot). The game then advances through scripted teaching beats to a tutorial and 6 cutting rounds (`ROUNDS`), ending in `completeGame()`.

## 5. Audio-autoplay finding

**The game is silent on boot.** Theme music (`audios/ThemeMusic.ogg`) starts only inside the game's own `#playButton` click handler; narration objects are created lazily on first play. This makes hidden live-iframe preloading safe (the "silent on boot" branch of the spec), verified by test: no `audio`/`video` element is playing in the warmed hidden iframe.

## 6. Start-button hook

`game/embed-bridge.js` hooks `#playButton` in the **capture phase** (the game's handler locks state and swaps artwork synchronously). `lbd-start` fires only when: the click `isTrusted`, `#playStage.start-mode` is present (the intro screen — the same button is reused later as a "preplay" play button), `.play-ready` is set, `state.locked` is false, and it has not fired before this session.

## 7. Completion flow

`completeGame()` is the single true success path (called only from `nextRound()` after every round is won — never on pause / fail / Try-Again / replay / leaving). The bridge wraps `window.completeGame` (classic-script global; call-site resolves the binding at call time), lets the original run (it shows "Bots Powered Up!", plays `confettiSound.ogg` + a synthesized cheer, and posts the legacy `activity_complete`), then gates `lbd-complete` on the celebration.

## 8. Final voice-over handling

The end screen has **no final narration clip** — its celebration audio is `confettiSound.ogg` (~4.9 s). The bridge waits for that clip's real `ended` event, with an `error` listener and a watchdog (known duration + 4 s; 8 s fixed when the duration is unknown) so completion can never hang. The parent keeps the raw `activity_complete` as a belt-and-braces fallback (5.2 s celebration delay) in case the bridge ever fails to load — completion is processed exactly once whichever message wins.

## 9. Files added

| File | Purpose |
|---|---|
| `game/` (copy of `LBD 1/story/` minus `debug.js`/`debugScreens.js`) | the embedded game |
| `game/embed-bridge.js` | handshakes + idle asset warmer |
| `preload.js` | two-stage loader (Stage A gate + Stage B warm-up) |
| `asset-manifest.json` | generated manifest (real byte sizes; stage/type/usage/blob/game flags) |
| `.vercelignore` | keeps dev tooling, tests, reports, quarantine and the LBD source out of the deploy |
| `dev/` | dev-only: Range server, media pipeline, manifest generator, Playwright suite, reports, quarantine |

## 10. Files modified

- `index.html` — loader bar markup, `boot-loading` body class, overlay cleaned (`about:blank` iframe, `title="Interactive learning game"`), legacy hidden `#prev/#next` buttons and `#lbdNextBtn` removed, `preload.js` include, browser-support comment.
- `script.js` — pages array re-pointed to `game/`; LBD overlay rewritten (idle warm-up, page-frame reveal, `lbd-start` fullscreen, `lbd-complete` auto-advance, teardown + re-warm on every exit path); central `canNavigateForward()` gate; universal per-page video gate (ended/error/watchdog, re-armed per arrival); first-page dual gate (Back hidden, Next hidden until video+interaction); GPU page windowing; title-VO dead code removed (file never existed); bgMusic now the game's shared ThemeMusic at `preload="none"`; SFX fallbacks `preload="none"`; hand-nudge 404 removed (emoji hint built directly).
- `styles.css` — Phase-14 control sizes/positions/states; first-page hide rules + reveal pop; loader styles; `lbd-is-fullscreen` chrome hiding + scroll lock; `.leaf.win-off` windowing; dead CSS removed (`.arrow` legacy nav, `.lbd-next-btn`, missing-file bubble artwork rules); cover art re-pointed to WebP.
- `game/index.html` (embedded copy only) — `?debug=1` loader + commented debug tags removed; `embed-bridge.js` appended; Ira-clip warm list trimmed to WebM (was double-downloading MP4 fallbacks).
- `dev/server.mjs` — dev-only static server with Range (206) + Last-Modified/304.

## 11. Files removed / quarantined (`dev/quarantine/`, never deployed)

`assets/1-4.mp4` (replaced by WebM) · `assets/cover  page.png`, `assets/play-button.png` (replaced by WebP) · `assets/play button.png` (unused duplicate) · `assets/next button.webp` (only user was the removed overlay Next button) · `sfx/game-bgm.ogg` (byte-identical duplicate of the game's ThemeMusic — the parent now shares the game's file, cached once) · originals of every recompressed game image/audio. `debug.js`/`debugScreens.js` were never copied into `game/`.

## 12. Media conversion results (see `dev/reports/media-size-report.{json,csv}`)

| Type | Before | After | Saved |
|---|---|---|---|
| Video (4 story MP4 → WebM VP9/Opus, yuv420p, CRF 33 + 75% bitrate cap) | 45.49 MB | 14.65 MB | **−67.8%** |
| Audio (22 game clips → Ogg/Opus, 64k speech / 96k music) | 2.93 MB | 2.18 MB | −25.6% |
| Images (PNG→WebP q85; large WebP recompressed q82) | 6.50 MB | 1.44 MB | **−77.8%** |

Every output was validated (decodes, same dimensions, duration within tolerance, strictly smaller) and representative frames/images were visually inspected side-by-side (`dev/reports/visual/`). No converted file shipped larger than its source.

## 13. Unavoidable conversion exceptions (documented, intentional)

- `sfx/*.mp3` + the base64 SFX in `sfx-data.js` stay MP3: Safari's `decodeAudioData` cannot decode Ogg/Opus, and these two short clips are the Web Audio SFX source. Converting would silence page-flip SFX on Safari to save ~50 KB.
- `game/assets/IraVid*.webm` kept as-is (already VP9, 320–400 KB; a re-encode generation would trade quality for a marginal saving). Their MP4 fallbacks stay for `<source>` fallback but are no longer pre-warmed.
- 5 game images kept original where recompression saved <8% (not worth a lossy generation).

## 14. Asset preload architecture

- **Stage A (blocks Start only):** `asset-manifest.json` (generated from real files — no guessed sizes) lists 7 shell images (~581 KB): cover art, Start art, 4 posters, the LBD page poster. Streaming `fetch()` readers, ~5 concurrent, ascending-size queue (small before large), per-asset abort timeout, monotonic byte-aware progress, failed/stalled/aborted requests credited as complete, 45 s hard deadline. The Start reveal flips `boot-loading → boot-ready`; `openBook()` itself checks the class, so keyboard/touch/synthetic/direct calls cannot bypass the loader.
- **Stage B (idle, after `window.load` + Stage A):** parent fetch-warms story WebMs, shared ThemeMusic and SFX fallbacks in idle-scheduled pairs; `script.js` assigns the game iframe `src` via `requestIdleCallback` (setTimeout fallback). Game assets warm **inside** the iframe (game boot preloaders + bridge warmer) and are marked `warmVia:"iframe"` in the manifest so nothing downloads twice.

## 15. Blob fallback behavior

Blob replacement is applied where an error fallback is actually detectable: `<img>` targets (`#hint img`, the Start art). The original URL is stored (`data-original-src`) and a one-time `error` listener restores it. CSS backgrounds and `poster` attributes have no error event, so they intentionally keep original URLs and rely on the warmed HTTP cache. No blob URLs are pushed into the iframe.

## 16. GPU / windowing changes

`windowLeaves()` keeps only the current leaf ±1 renderable; all others get `.win-off` (`visibility:hidden; will-change:auto; pointer-events:none` — **not** `display:none`, which would break the flip engine's layout). Re-windowed on every arrival, flip settle, drag settle, Home/Replay, LBD open/close, and resize/orientation. Faces and curls already carry `backface-visibility:hidden`; screenshots of flip midpoints, hidden neighbours, and the return-from-LBD path were captured and inspected for ghosts/blank textures.

## 17. Navigation control implementation

Back/Next fixed at the viewport's lower corners outside the artwork (`clamp(84px,10vw,124px)` box, bottom `clamp(-10px,-0.5vh,-2px)`, glyph 62%, one arrow asset mirrored on the inner SVG so hover/active scaling can't cancel the mirror); Home top-right (`top clamp(-12px,-0.9vh,-4px)`, glyph 65%, z 720). All: hidden on the cover, `display:flex` + fade-in 400 ms after start, opacity .96, hover 1.12 / active 0.9 at 150 ms, no focus ring (still real `<button>`s with aria-labels), disabled = opacity .22 + `pointer-events:none` + `aria-disabled`. First story page: Back `display:none !important`; Next hidden until the dual gate (video + interaction) opens. **On every video page the Next arrow is fully hidden — not merely disabled — until that page's clip finishes** (ended/error/watchdog), then it pops in with the 400 ms fade + pop. Non-video pages (LBD) show it immediately; THE END shows it visible-but-disabled (0.22). All three controls `display:none !important` during LBD fullscreen.

## 18. Video-gating implementation

One central guard — `canNavigateForward()` — is consulted by the Next button, keyboard, swipe/corner drags and programmatic `goNext()`. Every page arrival re-arms `armPageGate(idx)`: video pages lock forward navigation until `ended` OR `error` OR watchdog (`duration+4 s`, 30 s unknown; re-tightened on `loadedmetadata`); stale timers/listeners are cleared on every departure so they can never unlock the wrong page. Non-video pages (LBD, THE END) are never locked. Back and Home stay available while a video plays. Double-tap turns exactly one page (`animating` lock).

## 19. Playwright test results — **16 / 16 passed** (final run, 5.3 min)

Projects: `desktop-1366` (1366×768, all 14 tests) and `mobile-landscape` (844×390 + touch, loading + controls tests). Reports: `dev/reports/pw-run5.log`, `dev/reports/playwright-results.json`, HTML in `dev/playwright-report/`.

| Group | Coverage | Result |
|---|---|---|
| Loading (4) | themed bar visible on boot, Start hidden during Stage A, monotonic byte progress to 100% under CDP throttling, pop-in reveal, small-before-large queueing, aborted shell fetches never block Start (blob original-URL fallback verified), keyboard/synthetic/direct-call bypass blocked | ✅ |
| Crawl (1) | every page forward + full back-walk: zero console errors/4xx/5xx, images `complete` + `naturalWidth>0`, posters attached, no video error states, gates release, per-page nav state, per-page screenshots | ✅ |
| Controls (2) | hidden on cover; clamp sizes exact; Back mirrored on inner SVG (survives hover scale); glyphs outside artwork at 1366×768; Home fully in top-right margin; hover/active transforms; disabled = 0.22 + `pointer-events:none` + `aria-disabled`; real buttons, no focus ring | ✅ |
| Gating (3) | first page: Back `display:none`, Next hidden until video `ended` (keyboard/swipe/corner-drag all blocked while locked), double-click turns exactly one page; gate re-arms on back-nav revisit; broken video (aborted source) releases via error/watchdog with Back + Home usable throughout | ✅ |
| LBD (3) | idle warm after `load`; boots hidden + silent + unfocused; dev tools absent; hidden-round sprites + narration audio warmed; overlay hidden pre-page; instant intro on landing (no spinner, `game-ready` handshake); real "Let's Go" → `lbd-start` → true-viewport fullscreen, chrome gone, **iframe not reloaded** (marker survives); page turns blocked underneath; game runs; completion → celebration-audio wait → `lbd-complete` → shrink-back → **auto-advance**; audio dead after leaving; iframe reset to `about:blank` then re-warmed; revisit = fresh instant intro; leave-before-start + Home routes clear overlay/audio/classes | ✅ |
| GPU (1) | windowing classes exact on every page; released leaves report `visibility:hidden`/`will-change:auto`/`pointer-events:none`; 9 screenshots (cover, current, flip midpoints both directions, LBD frame/fullscreen/return, THE END) captured **and opened/inspected** — no blank textures, no ghost text/overlays, no duplicated layers, no controls bleeding through page backs | ✅ |

Fixes that came out of testing (all verified by the final green run): stale-`ended` gate re-arm bug; unread warm-fetch bodies exhausting renderer memory (`VirtualAlloc failed` crashes / `ERR_INSUFFICIENT_RESOURCES`); re-warm burst smoothing (1.5 s settle before idle reload); blink animation continuing on a disabled arrow; disabled-opacity specificity bug (pre-existing — `body.is-open .corner-arrow` outranked `[disabled]`).

## 20. Console and network results

**Zero console errors and zero unexpected 4xx/5xx/failed requests** — asserted inside every test (`watchErrors`/`assertClean`) and confirmed by the final instrumented measurement run. The baseline had two guaranteed boot 404s (`assets/hand-nudge.png`, `sfx/the story night.ogg`); both eliminated.

## 21. Baseline versus final measurements (same method, local Range server, 1366×768)

| Metric | Baseline | Final |
|---|---|---|
| DOMContentLoaded | 402 ms | **252 ms** |
| window `load` | 568 ms | **257 ms** |
| Cover usable / Start button available | 661 ms | **576 ms** |
| Console errors on boot | 2 | **0** |
| Failed requests on boot | 2 (404) | **0** |
| Blocking (Stage A) payload | n/a (no loader) | 581 KB / 7 assets |
| Settled transfer (6 s idle) | 7.73 MB / 20 req | 26.4 MB / 115 req — includes the **entire** Stage-B warm-up (all story videos + full game) racing ahead on loopback; none of it blocks the shell |
| LBD page → intro interactive | cold iframe boot on landing | **instant** (booted hidden at idle; no post-landing game requests needed) |
| Total deployed payload | **63.97 MB** | **22.14 MB (−65.4%)** |
| Video payload | 49.29 MB | 16.95 MB (**−65.6%**) |
| Audio payload | 5.51 MB | 2.39 MB (**−56.7%**) |
| Image payload | 8.42 MB | 2.03 MB (**−75.8%**) |

The flipbook shell's initial readiness is *better* than baseline (576 ms vs 661 ms) while now also byte-gating the Start button behind verified shell assets.

## 22. Remaining known limitations

- Ogg/Opus + WebM target evergreen browsers (Chrome/Edge/Firefox/recent Safari). Very old Safari (<16) falls back to MP4 only for the Ira clips; story videos are WebM-only by design (per project format policy).
- The Playwright "complete flow" test drives the game's real intro + running state via UI, then invokes the game's own `completeGame()` to reach the terminal state deterministically (playing all six laser rounds by simulated pointer input is not stable in CI time budgets). The completion *plumbing* (celebration audio wait → `lbd-complete` → shrink → auto-advance → teardown → re-warm) is exercised for real.
- `sfx/*.mp3` retained (Safari Web Audio), documented in §13.

---

## 23. Update — 2026-07-28: navigation-gate revisions

Three behaviour changes to the forward gate. The sections above describe the state as of 2026-07-25 and are superseded where they conflict.

- **A cleared page stays cleared** (`gateCleared` in `script.js`). A page's gate arms on its FIRST arrival only; once satisfied it is remembered for the rest of the read, so going back and forward again shows Back **and** Next immediately — no second viewing. The clip still replays on a revisit; watching it out is simply no longer a condition of moving on. Replay (back to the cover) wipes the record, so a fresh read gates again from page 1. (Supersedes "gate re-arms per arrival" in §10, §18 and the §19 Gating row.)
- **The game page is gated** (`armPageGate` type `"lbd"` + `finishLbd`). The corner Next arrow is hidden and every forward route (arrow, keyboard, swipe, corner drag) is shut until the game reports completion, which is what arms the overlay's own Next button. Back stays available throughout. Escape hatch: if the embedded game never even posts `lbd-ready`, its gate releases after 25 s (`GATE_LBD_STUCK_MS`) so a failed iframe cannot trap the reader — a game that *does* boot is never skippable. (Supersedes "the LBD page is ungated".)
- **Glow-pulse reveal** (`.glow-pulse` / `@keyframes arrowGlowPulse`). When a gate opens and the Next arrow appears, it pops in and then pulses a brightening teal halo three times (~2 s) before settling into its normal state. Fired from `openPageGate`, so it also plays on the error/watchdog reveal route, and at most once per arrival. Glow and opacity only — deliberately **no** transform, since the arrow's measured box must stay exactly `--ctl` and inside the viewport (`controls.spec.mjs`).

This also fixed a **pre-existing cascade bug**: `.corner-arrow.blink` / `.blink1` were out-ranked by `body.is-open .corner-arrow.fwd.is-visible:not([disabled])`, which owns `animation` — so neither the video-end cue nor the idle-nudge blink ever played. Both cue rules now repeat that full scope. `.blink1` was retired in favour of the glow pulse.

Tests: 18/18 green (`gating` now 4, with a pulse test that asserts the animation really runs, does not resize the button, and ends by itself; `crawl` + `controls` complete the game to cross its page via the new `completeLbdAndAdvance` helper; the LBD "leave before starting" case became "the game page cannot be skipped").
