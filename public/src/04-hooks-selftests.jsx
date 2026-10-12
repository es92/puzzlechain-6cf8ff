/* ============================================================
   Shared timer hook
   ============================================================ */
// Counts up from `initialSecs` (default 0) while `running`. Seeding from a
// non-zero value lets a resumed daily attempt continue the timer from where it
// left off instead of restarting.
function useTimer(running, initialSecs = 0) {
  const [secs, setSecs] = useState(initialSecs);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setSecs(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [running]);
  const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return { secs, fmt: fmt(secs) };
}

/* ============================================================
   Shared responsive-board + input foundation (slice 1)
   ============================================================
   Three primitives every board game can lean on so a puzzle fits the
   viewport and reacts on the next frame:

     useFitBox      — measures the space a board actually has and derives
                      an integer cell size from it (ResizeObserver based).
     useCanvasBoard — DPR-correct canvas sizing + redraw scheduling, the
                      HashRushGame/BounceGame idiom generalized.
     usePointerCell — tap / long-press / drag over a board element, with
                      the long-press deliberately firing the OPPOSITE
                      action in the games that use it.

   None of these own game state; they hand back geometry and events. */

// Measure the board's container and derive a square cell size that makes a
// cols×rows grid fit inside it. `gap` is the inter-cell gutter (counted
// cols-1 / rows-1 times, so the caller can lay out at cell+gap and still fit);
// `padX`/`padY` are subtracted for borders, clue gutters and breathing room.
// Returns integers so canvas strokes stay crisp.
function useFitBox(ref, { cols, rows, minCell = 16, maxCell = 64, gap = 0, padX = 0, padY = 0 } = {}) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      // A collapsed parent (0-height flex child mid-layout) would pin the
      // cell to minCell forever; ignore those frames and wait for a real one.
      if (r.width < 1 && r.height < 1) return;
      setBox(prev => (Math.abs(prev.w - r.width) < 0.5 && Math.abs(prev.h - r.height) < 0.5
        ? prev : { w: r.width, h: r.height }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      window.addEventListener('orientationchange', measure);
      return () => {
        window.removeEventListener('resize', measure);
        window.removeEventListener('orientationchange', measure);
      };
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, cols, rows]);

  // The gutters are fixed overhead, so take them off the box BEFORE dividing —
  // dividing first and laying out at cell+gap overflows by gap*(n-1).
  const availW = Math.max(0, box.w - padX - gap * Math.max(0, cols - 1));
  const availH = Math.max(0, box.h - padY - gap * Math.max(0, rows - 1));
  const raw = (cols > 0 && rows > 0 && availW > 0 && availH > 0)
    ? Math.floor(Math.min(availW / cols, availH / rows))
    : minCell;
  const cell = Math.max(minCell, Math.min(maxCell, raw));
  return { cell, boxW: box.w, boxH: box.h, ready: box.w > 0 && box.h > 0 };
}

/* The FitScale scale-to-fit wrapper (slice 5) is GONE: its last riders
   (Mahjong, Spider, the Tile Match pair, Crate Push) all draw canvases sized
   from the measured box now, so nothing shrinks a fixed-pixel board with a
   transform any more. The .fit-scale-box CSS class stays — Word Search uses
   it as a plain flex box, and describeAppStylesheet() keys on the
   .fit-scale-content rule to recognize the app's own stylesheet. */

// DPR-correct canvas sizing + redraw scheduling. `draw(ctx, geom)` is called
// on a rAF whenever `deps` change or the element resizes; `geom` carries the
// CSS-pixel width/height so draw code never touches devicePixelRatio itself.
function useCanvasBoard(canvasRef, { width, height, draw, deps = [] }) {
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const rafRef = useRef(0);
  // A Light↔Dark flip must repaint immediately — canvas colours come from PAL,
  // which re-themes without any React state changing on its own.
  const themeV = useThemeVersion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !(width > 0) || !(height > 0)) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const pw = Math.round(width * dpr), ph = Math.round(height * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const c = canvasRef.current;
      if (!c) return;
      const ctx = guardCanvasCtx(c.getContext('2d'));
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      drawRef.current(ctx, { w: width, h: height, dpr });
    });
    return () => { if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; } };
  }, [canvasRef, width, height, themeV, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
}

// Shared DPR cap for the hand-rolled canvas loops (bounce, zuma, hashrush,
// bouncedaily) so they match useCanvasBoard instead of allocating a 4x backing
// store on high-density Androids.
function canvasDpr() { return Math.min(window.devicePixelRatio || 1, 3); }

/* PHASE 3 — no page scroll while a run is live.
   `fitShell` only covers dailies that opted in; shell:'self' games bypass it
   entirely, and a drag on a board could always pull the document. This locks
   the document itself, so it holds for all 33 games. Reference-counted: two
   overlapping locks (game + open sheet) must not fight over the restore. */
let _scrollLockCount = 0;
function useScrollLock(active) {
  useEffect(() => {
    if (!active) return;
    _scrollLockCount += 1;
    const root = document.documentElement;
    if (_scrollLockCount === 1) {
      root.classList.add('un-scroll-locked');
      document.body.classList.add('un-scroll-locked');
    }
    return () => {
      _scrollLockCount = Math.max(0, _scrollLockCount - 1);
      if (_scrollLockCount === 0) {
        root.classList.remove('un-scroll-locked');
        document.body.classList.remove('un-scroll-locked');
      }
    };
  }, [active]);
}

/* ---- Safe-area insets (platform-forwarded) ----
   Inside the platform's app frame env(safe-area-inset-*) is always 0px — a
   cross-origin iframe is never the top-level document — so the hosted bridge
   forwards the rectangle that applies to this frame instead, as
   --un-safe-inset-* on <html> plus window.usernode.safeAreaInsets and a
   window 'usernode:safe-area-changed' event. CSS reads the forwarded value
   through the var(--pc-safe-*) tokens in 01-styles.jsx; this hook is the JS
   spelling of the same numbers, for layout computed in a component rather
   than in CSS.

   It reports live values: the shell pushes a new object on rotation, on
   keyboard/toolbar moves and whenever the frame's rect shifts, and a layout
   effect must follow those, not a snapshot from mount. All four values are 0
   on desktop and on an un-notched phone, so a caller that only ever adds
   them is a no-op in the common case. */
function unSafeInsets() {
  try {
    const u = window.usernode;
    const v = u && u.safeAreaInsets;
    if (!v) return { top: 0, right: 0, bottom: 0, left: 0 };
    return {
      top: +v.top || 0, right: +v.right || 0,
      bottom: +v.bottom || 0, left: +v.left || 0,
    };
  } catch (_) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
}

// Live subscription: returns the current insets and updates when the shell
// reports a change. The hook is inert when the bridge is absent (standalone,
// or a proposal check's headless browser), so callers keep working there.
function useSafeAreaInsets() {
  const [insets, setInsets] = useState(unSafeInsets);
  useEffect(() => {
    const on = () => setInsets(unSafeInsets());
    on();
    window.addEventListener('usernode:safe-area-changed', on);
    window.addEventListener('orientationchange', on);
    return () => {
      window.removeEventListener('usernode:safe-area-changed', on);
      window.removeEventListener('orientationchange', on);
    };
  }, []);
  return insets;
}

/* PHASE 2 — the shared tap primitive.
   Spread onto any tappable board element. Two jobs:
     1. Press feedback on finger-DOWN (`data-pressed`), not on the browser's
        delayed click — this is the "I tapped and nothing happened" fix.
     2. Fire the action from pointerdown/pointerup instead of click, so a tap
        never waits on double-tap-to-zoom detection.
   `data-pressed` is cleared on up/cancel/lostpointercapture so it can never
   stick. Mouse and keyboard paths are preserved (onClick still fires for
   non-touch, guarded against double-firing). */
/* The touch/click de-dupe guard lives at MODULE scope, not in tapProps'
   closure. That distinction is the whole bug behind "one tap types two
   letters" (Daily Cipher's LENDING -> LLEENND):

     pointerup -> onTap() -> setState -> React 18 flushes the re-render
     SYNCHRONOUSLY (pointerup is a discrete event) -> the element's props are
     replaced by a FRESH tapProps(...) object -> the browser's compatibility
     `click` then dispatches against that new object, whose per-render
     `handledPointer` is back to false -> onTap() fires a SECOND time.

   Any tappable that changes state on tap hit this on every touch device, so
   the guard has to outlive the render. We record which element consumed a
   touch and when; the compat click that follows (always within a few ms) is
   swallowed. Asserted by the `tap-dedupe-survives-rerender` self-test. */
let _tapHandledEl = null;
let _tapHandledAt = 0;
const TAP_CLICK_SUPPRESS_MS = 700;

function tapMarkHandled(el) {
  _tapHandledEl = el || null;
  _tapHandledAt = Date.now();
}
function tapWasHandled(el) {
  if (!_tapHandledEl || _tapHandledEl !== el) return false;
  if (Date.now() - _tapHandledAt > TAP_CLICK_SUPPRESS_MS) {
    _tapHandledEl = null;
    return false;
  }
  // One-shot: consume it so a later genuine click on the same element works.
  _tapHandledEl = null;
  return true;
}

/* #238 — a tap fires on RELEASE-IN-PLACE, so the gesture that started it has
   to be measured. Firing on any pointerup is what made a scroll that began on
   a card's "Daily" button launch the game when the finger came off.

   `pointercancel` is NOT the guard people expect it to be: the browser only
   sends it once it has taken the gesture over for panning, and a short flick
   inside a scroller — or a drag that never scrolls anything because the list
   is already at its end — releases with no cancel at all. So the distance
   travelled is measured here instead, module scope for the same reason the
   de-dupe guard above is: a re-render between down and up (a timer tick, a
   poll landing) would reset a per-render closure mid-gesture.

   Beyond the slop the press styling is dropped and the release is swallowed —
   including the compatibility `click`, which the browser still delivers when
   it never took the gesture over. Mouse is untouched: it has no scroll
   gesture, and a press-drag-release on a button is a click by every platform's
   rules. Asserted by `tap-slop-cancels-scroll`. */
let _tapDownEl = null;
let _tapDownX = 0;
let _tapDownY = 0;
let _tapMoved = false;
const TAP_SLOP_PX = 10;

function tapPointerXY(e) {
  return [typeof e.clientX === 'number' ? e.clientX : 0,
          typeof e.clientY === 'number' ? e.clientY : 0];
}
function tapNoteDown(e) {
  const [x, y] = tapPointerXY(e);
  _tapDownEl = e.currentTarget || null;
  _tapDownX = x;
  _tapDownY = y;
  _tapMoved = false;
}
/* True once this gesture has travelled far enough to be a scroll rather than a
   tap. Unknown gestures (no matching pointerdown recorded — a handler upstream
   stopped propagation, say) are treated as taps, keeping the old behaviour
   rather than silently dropping an action. */
function tapDragged(e) {
  if (!_tapDownEl || _tapDownEl !== e.currentTarget) return false;
  if (_tapMoved) return true;
  const [x, y] = tapPointerXY(e);
  if (Math.abs(x - _tapDownX) > TAP_SLOP_PX || Math.abs(y - _tapDownY) > TAP_SLOP_PX) {
    _tapMoved = true;
    return true;
  }
  return false;
}

function tapProps(onTap, { disabled = false } = {}) {
  if (disabled) return {};
  const unpress = (e) => {
    if (e.currentTarget.removeAttribute) e.currentTarget.removeAttribute('data-pressed');
  };
  return {
    onPointerDown: (e) => {
      tapNoteDown(e);
      if (e.currentTarget.setAttribute) e.currentTarget.setAttribute('data-pressed', '1');
    },
    onPointerMove: (e) => {
      // Drop the press styling the moment it stops being a press, so the
      // button doesn't sit lit for the length of a scroll.
      if (tapDragged(e)) unpress(e);
    },
    onPointerUp: (e) => {
      const dragged = tapDragged(e);
      unpress(e);
      // Touch/pen act on release-in-place; mouse falls through to onClick so
      // text selection and drag handlers elsewhere keep working.
      if (e.pointerType === 'touch' || e.pointerType === 'pen') {
        // Mark BEFORE running the action: onTap re-renders, and the compat
        // click is dispatched against whatever props exist by then. A dragged
        // release marks too — that swallows the compat click without acting.
        tapMarkHandled(e.currentTarget);
        if (!dragged) onTap && onTap(e);
      }
    },
    onPointerCancel: (e) => {
      if (_tapDownEl === e.currentTarget) _tapMoved = true;
      unpress(e);
    },
    onPointerLeave: (e) => {
      unpress(e);
    },
    onClick: (e) => {
      if (tapWasHandled(e.currentTarget)) return;
      onTap && onTap(e);
    },
  };
}

/* ============================================================
   Load-time self-tests (mirrors the server's boot self-tests).
   These run once on load and log a console error on failure, which trips the
   platform's no-console-errors proposal check — so a regression in any of these
   invariants blocks a merge instead of silently shipping.
   ============================================================ */
/* #150 — the barrier that keeps navState serializable. Every field of the
   history reducer's nav state passes through here, because ONE DOM-bearing
   value (React hands a SyntheticEvent to a bare `onClick={backToLobby}`)
   made JSON.stringify throw "Converting circular structure to JSON" — and with
   no error boundary above it, that unmounted the entire React root, stylesheet
   included. Asserted by the nav-state-primitives self-test. */
function navPrimitive(v) {
  if (v == null) return null;
  const t = typeof v;
  if (t === 'string' || t === 'number' || t === 'boolean') return v;
  return null; // objects/functions/symbols can never reach the serializer
}

/* ============================================================
   #186 — back navigation: the nested-step stack and the parent map.

   Two problems this solves, both structural:

   1. Every in-app back control was hardwired to the lobby, so back from a
      board went home rather than to the screen you came from.
   2. Screens NESTED INSIDE a game (a ClassicShell sheet, an opponent picker,
      an online room setup, a level select) were invisible to the history
      reducer, so back from one of them unmounted the whole game.

   `useNavStep` is how a nested screen announces itself. Each active
   registration is one back step: it contributes its id to navState.sub (so the
   history entry records the depth), and its handler is what unwinds it. The
   stack is module scope on purpose — it has to be readable by the App's
   popstate handler, which is not inside any of these components.
   ============================================================ */
const NAV_STEPS = [];
let _navStepSeq = 0;
const _navStepSubs = new Set();

function navStepsSignature() { return NAV_STEPS.map((s) => s.id).join('|'); }
function navStepsCount() { return NAV_STEPS.length; }
function navStepsSubscribe(fn) { _navStepSubs.add(fn); return () => { _navStepSubs.delete(fn); }; }
function _navStepsNotify() { _navStepSubs.forEach((fn) => { try { fn(); } catch (_) {} }); }

/* Unwind the stack down to `n` entries, deepest-last-registered first.

   Handlers are read by INDEX from a snapshot rather than by repeatedly taking
   the tail, because each handler unwinds by calling setState — the entry does
   not leave NAV_STEPS until React has re-run that component's effect cleanup,
   which is not synchronous with this loop. Snapshotting makes "pop two levels"
   deterministic instead of racing the reconciler. */
function navStepsUnwindTo(n) {
  const target = Math.max(0, n | 0);
  const snapshot = NAV_STEPS.slice();
  let unwound = 0;
  for (let i = snapshot.length - 1; i >= target; i--) {
    try { snapshot[i].onBack(); unwound++; } catch (_) {}
  }
  return unwound;
}

/* Register one nested back step.
     active — whether this screen is currently showing
     onBack — how to leave it (one level, not all the way out)
     id     — a short stable token; it lands in navState.sub and in the
              data-nav-sub attribute the navigation proposal checks assert on.

   Registration order is effect order, which in React runs children before
   parents. That is the ordering we want: a sheet opened OVER a picker belongs
   at the top of the stack, and ClassicShell (the parent) registers after the
   game body (the child), so its step is popped first. */
function useNavStep(active, onBack, id) {
  const cbRef = useRef(onBack);
  cbRef.current = onBack;
  const keyRef = useRef(0);
  if (!keyRef.current) keyRef.current = ++_navStepSeq;
  const stepId = String(id || 'step');
  useEffect(() => {
    if (!active) return undefined;
    const entry = {
      key: keyRef.current,
      id: stepId,
      onBack: () => { if (cbRef.current) cbRef.current(); },
    };
    NAV_STEPS.push(entry);
    _navStepsNotify();
    return () => {
      const i = NAV_STEPS.indexOf(entry);
      if (i !== -1) NAV_STEPS.splice(i, 1);
      _navStepsNotify();
    };
  }, [!!active, stepId]);
}

/* Where does back go from here, when there is no history entry to pop?

   Pure over the nav state so it is self-testable (`nav-parent-map`), and it
   prefers the entry's own recorded `from` over the static map: the same game
   screen has a different parent depending on how it was opened (through the
   opponent picker, through the pre-game screen, or straight off a home card).
   Returns null at the root — the one place back must NOT be intercepted, so
   the platform shell handles the press instead. */
const NAV_HOME = { screen: 'lobby', lobbyTab: 'home' };
function parentOf(s) {
  if (!s || typeof s !== 'object') return null;
  const scr = s.screen || 'lobby';
  const gameId = s.gameId || null;
  if (scr === 'lobby') {
    if (s.lobbyTab && s.lobbyTab !== 'home') return { screen: 'lobby', lobbyTab: 'home' };
    return null;
  }
  if (scr === 'game') {
    if (!gameId) return NAV_HOME;
    if (s.from === 'opponent') return { screen: 'opponent', gameId };
    if (s.from === 'lobby') return NAV_HOME;
    return { screen: 'pregame', gameId, playMode: s.playMode || null };
  }
  if (scr === 'locked') return gameId ? { screen: 'pregame', gameId } : NAV_HOME;
  if (scr === 'pregame' || scr === 'opponent') return NAV_HOME;
  if (scr === 'profile') return s.from === 'friends' ? { screen: 'friends' } : NAV_HOME;
  if (scr === 'friends' || scr === 'session') return NAV_HOME;
  return NAV_HOME;
}

/* #186 — how many history entries of OURS sit behind the one handed in.
   Read back off `history.state`, which survives a reload and a pop, so the
   in-app back control never has to guess. Anything that is not one of our
   own entries — a foreign state object, a null one, a hand-edited number —
   reads as 0, which is the value that makes goBack fall back to the lobby
   instead of calling history.back() out of the iframe. Depth is never
   negative and never fractional: a bad value must fail SAFE, not underflow
   into "there is somewhere to go back to". */
function navDepthOf(state) {
  const d = state && state.un ? state.unDepth : null;
  return typeof d === 'number' && Number.isFinite(d) && d > 0 ? Math.floor(d) : 0;
}

/* PHASE 2 (#163) — one reusable off-screen probe for touch-action computed
   values. Created once per sweep; `read(cls)` swaps the class and re-reads, and
   getComputedStyle flushes style recalc so the value is always current. */
function tapActionProbe() {
  const probe = document.createElement('div');
  probe.style.position = 'fixed';
  probe.style.left = '-9999px';
  probe.style.top = '0';
  document.body.appendChild(probe);
  return {
    read(cls) {
      probe.className = cls;
      return getComputedStyle(probe).touchAction;
    },
    destroy() { try { probe.remove(); } catch (_) {} },
  };
}

/* THE CANARY. `.un-selftest-canary` is emitted by the SAME generator as every
   real touch-action rule, so if it computes to `manipulation` the app
   stylesheet is genuinely APPLYING — not merely sitting in the DOM with its
   text present, which is all the old readiness check could tell. When it reads
   `auto`, every per-class probe below would report the UA default, and
   reporting 18 phantom class failures is what pointed #149 (and now #163) at
   the tap-target registry instead of at the stylesheet. */
function tapCanaryApplied() {
  try {
    const p = tapActionProbe();
    try { return p.read(TAP_CANARY_CLASS) === 'manipulation'; }
    finally { p.destroy(); }
  } catch (_) { return false; }
}

/* Diagnostics for a stylesheet that is present but not applying — enough to
   tell "no sheet at all" from "sheet blocked / cross-origin / empty". */
function describeAppStylesheet() {
  try {
    const sheets = Array.from(document.styleSheets || []);
    const mine = sheets.find((s) => {
      try {
        return s.ownerNode && s.ownerNode.textContent
          && s.ownerNode.textContent.indexOf('.fit-scale-content') >= 0;
      } catch (_) { return false; }
    });
    if (!mine) return 'sheets=' + sheets.length + ', appSheet=absent';
    let rules = 'unreadable';
    try { rules = String((mine.cssRules || []).length); } catch (e) { rules = 'blocked(' + e.name + ')'; }
    return 'sheets=' + sheets.length + ', appSheetRules=' + rules
      + ', disabled=' + !!mine.disabled;
  } catch (e) { return 'introspection-failed(' + (e && e.message) + ')'; }
}

/* #182 — count the column tracks a grid-template-columns value declares, so a
   static rule can be judged without mounting anything. Splits at the top level
   only (parens shield minmax()/repeat() internals) and expands a numeric
   repeat(); auto-fill / auto-fit are unbounded, so they count as "enough". */
function countTracks(value) {
  const v = String(value || '').trim();
  if (!v || v === 'none') return 0;
  const parts = [];
  let depth = 0, cur = '';
  for (const ch of v) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth === 0 && /\s/.test(ch)) {
      if (cur) { parts.push(cur); cur = ''; }
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  let n = 0;
  for (const part of parts) {
    const rep = /^repeat\(\s*([^,]+),([\s\S]*)\)$/.exec(part);
    if (rep) {
      const count = rep[1].trim();
      if (/^(auto-fill|auto-fit)$/.test(count)) { n += 2; continue; }
      const times = parseInt(count, 10);
      n += (isNaN(times) ? 1 : times) * Math.max(1, countTracks(rep[2]));
    } else if (/^\[/.test(part)) {
      continue; // a line-name list is not a track
    } else n += 1;
  }
  return n;
}

/* `styleReady` is passed false when scheduleSelfTests() exhausted its retry
   budget without ever seeing the app's stylesheet APPLY. In that state EVERY
   computed-style probe returns the UA default, so the touch-action sweep used
   to report all 18 tappable classes as broken — which is exactly how #149 was
   filed against the tap-target registry when the real cause was a crash that
   unmounted the stylesheet (#150). One honest `stylesheet-*` failure beats 18
   phantom ones, so the computed-style checks are SKIPPED instead. */
function runClientSelfTests(styleReady) {
  const fails = [];
  const check = (name, fn) => {
    ran++;
    try { if (fn() !== true) fails.push(name); }
    catch (e) { fails.push(name + ': ' + e.message); }
  };
  let ran = 0;
  // Two independent gates. `styleReady` says the scheduler saw the sheet land;
  // the canary says it is actually painting. Either one failing means every
  // computed-style probe below is measuring the UA default, not this app.
  const canaryOk = tapCanaryApplied();
  const styleOk = styleReady !== false && canaryOk;
  // Only runs when the stylesheet is actually live; otherwise it would report
  // a layout/computed-style bug that doesn't exist.
  const checkStyled = (name, fn) => { if (styleOk) check(name, fn); };
  if (!styleOk) {
    fails.push(canaryOk
      ? 'stylesheet-missing: the app stylesheet never mounted, so ' +
        'computed-style checks were skipped (they would all report the UA default)'
      : 'stylesheet-not-applied: the generated .' + TAP_CANARY_CLASS + ' canary rule ' +
        'does not apply, so computed-style checks were skipped — this is a ' +
        'stylesheet problem, NOT a tap-target registry problem (' +
        describeAppStylesheet() + ')');
  }

  // Phase 1 — canvas colours.
  check('canvas-colors', canvasColorSelfTest);

  /* The double-input regression guard. One TOUCH tap = exactly one action,
     even though the action's setState re-renders the element and replaces its
     handler props before the compatibility `click` arrives. The old per-render
     `handledPointer` closure failed exactly here, which is why typing LENDING
     in Daily Cipher produced LLEENND. Simulated with plain objects: the second
     tapProps(...) stands in for the post-render props object. */
  check('tap-dedupe-survives-rerender', () => {
    const el = { _attrs: {}, setAttribute(k, v) { this._attrs[k] = v; }, removeAttribute(k) { delete this._attrs[k]; } };
    let fired = 0;
    const onTap = () => { fired++; };
    const first = tapProps(onTap);
    first.onPointerDown({ currentTarget: el, pointerType: 'touch' });
    first.onPointerUp({ currentTarget: el, pointerType: 'touch' });
    if (fired !== 1) throw new Error('touch pointerup fired ' + fired + ' times, expected 1');
    // The re-render the action just caused: brand-new props object, same node.
    const afterRerender = tapProps(onTap);
    afterRerender.onClick({ currentTarget: el });
    if (fired !== 1) throw new Error('compat click after re-render fired again (' + fired + ' total)');
    // A genuine MOUSE click on the same element afterwards must still work.
    tapProps(onTap).onClick({ currentTarget: el });
    if (fired !== 2) throw new Error('mouse click was swallowed (' + fired + ' total, expected 2)');
    return true;
  });

  /* #208 — a touch DROP must yield coordinates. `e.touches` is a TouchList on
     every TouchEvent and a TouchList is an object, so testing it for existence
     rather than length made `touchend` — whose `touches` is empty by
     definition — read `undefined.clientX` and throw. That throw happened
     inside Block Fit's window listener before the piece was committed, so the
     block was never placed and its drag ghost never cleared. Mouse was fine,
     which is why it read as a mobile-only rendering bug. */
  check('pointer-xy-reads-touchend', () => {
    const touch = { clientX: 120, clientY: 240 };
    // touchend: the lifted finger is in changedTouches, touches is EMPTY.
    const end = pointerXY({ touches: [], changedTouches: [touch] });
    if (end.x !== 120 || end.y !== 240) {
      throw new Error('touchend read as ' + JSON.stringify(end) + ', expected 120,240');
    }
    // touchmove: the finger is still down, so touches wins.
    const move = pointerXY({ touches: [touch], changedTouches: [{ clientX: 9, clientY: 9 }] });
    if (move.x !== 120 || move.y !== 240) {
      throw new Error('touchmove read as ' + JSON.stringify(move) + ', expected 120,240');
    }
    // mouse/pointer: neither list, so the event itself carries the point.
    const mouse = pointerXY({ clientX: 7, clientY: 8 });
    if (mouse.x !== 7 || mouse.y !== 8) {
      throw new Error('mouse read as ' + JSON.stringify(mouse) + ', expected 7,8');
    }
    return true;
  });

  /* #214 — a Match 3 deal must contain a MULTIPLE OF THREE of every type (a
     match is three of a kind, so anything else strands tiles), and the puzzle's
     own target must be reachable from the deal it is given. The old deal put
     `layers` of each of five types on the board: five of the fifty puzzles are
     `layers: 2`, which is two of each type and therefore no possible match at
     all, and the score ceiling everywhere else fell far below the authored
     target. Both halves are checked here across the real target/layer range. */
  check('match3-deal-is-winnable', () => {
    for (let layers = 1; layers <= 6; layers++) {
      for (const target of [800, 1200, 2000, 3200, 4800, 6000, 7200]) {
        const cfg = m3NormalizeConfig({ targetScore: target, layers });
        if (cfg.perType % 3 !== 0) {
          throw new Error('layers ' + layers + ' deals ' + cfg.perType +
            ' of each type — not a multiple of 3, so tiles strand');
        }
        if (cfg.perType < 3) {
          throw new Error('layers ' + layers + ' deals ' + cfg.perType +
            ' of each type — no match of three can exist');
        }
        const ceiling = cfg.pointsPerMatch * cfg.totalTriples;
        if (ceiling < target) {
          throw new Error('layers ' + layers + ' target ' + target +
            ' is unreachable: ceiling is ' + ceiling);
        }
      }
    }
    // The deal itself must honour the counts it promised.
    const cfg = m3NormalizeConfig({ targetScore: 800, layers: 2 });
    const tiles = m3DealBoard(cfg, 90);
    const counts = {};
    for (const t of tiles) counts[t.type] = (counts[t.type] || 0) + 1;
    const kinds = Object.keys(counts);
    if (kinds.length !== 5) throw new Error('deal has ' + kinds.length + ' types, expected 5');
    for (const k of kinds) {
      if (counts[k] % 3 !== 0) throw new Error('type ' + k + ' dealt ' + counts[k] + ' times');
    }
    if (tiles.length !== cfg.perType * 5) throw new Error('deal size ' + tiles.length);
    return true;
  });

  /* #238 — a scroll that STARTS on a button must not press it on release.
     The action fires on pointerup, so without a distance check the release
     that ends a scroll is indistinguishable from a tap. Checks all three
     halves: the drag is swallowed, the compat click the browser still sends
     after it is swallowed too, and a release inside the slop still fires. */
  check('tap-slop-cancels-scroll', () => {
    const mkEl = () => ({ _attrs: {}, setAttribute(k, v) { this._attrs[k] = v; }, removeAttribute(k) { delete this._attrs[k]; } });
    const el = mkEl();
    let fired = 0;
    const onTap = () => { fired++; };

    // A scroll: down, drag well past the slop, release on the same button.
    const p = tapProps(onTap);
    p.onPointerDown({ currentTarget: el, pointerType: 'touch', clientX: 100, clientY: 300 });
    p.onPointerMove({ currentTarget: el, pointerType: 'touch', clientX: 100, clientY: 220 });
    if (el._attrs['data-pressed']) throw new Error('press styling survived a scroll');
    p.onPointerUp({ currentTarget: el, pointerType: 'touch', clientX: 100, clientY: 180 });
    if (fired !== 0) throw new Error('a scroll that started on the button fired it');
    // The browser still delivers a compatibility click when it never took the
    // gesture over for panning; that must not act either.
    tapProps(onTap).onClick({ currentTarget: el });
    if (fired !== 0) throw new Error('the compat click after a scroll fired the button');

    // A real tap wanders a pixel or two and must still count.
    const el2 = mkEl();
    const q = tapProps(onTap);
    q.onPointerDown({ currentTarget: el2, pointerType: 'touch', clientX: 40, clientY: 40 });
    q.onPointerMove({ currentTarget: el2, pointerType: 'touch', clientX: 42, clientY: 43 });
    q.onPointerUp({ currentTarget: el2, pointerType: 'touch', clientX: 43, clientY: 44 });
    if (fired !== 1) throw new Error('a tap with normal finger wobble did not fire (' + fired + ')');

    // A MOUSE press-drag-release on a button is a click by every platform's
    // rules, and the slop must not have quietly changed that.
    const el3 = mkEl();
    const r = tapProps(onTap);
    r.onPointerDown({ currentTarget: el3, pointerType: 'mouse', clientX: 10, clientY: 10 });
    r.onPointerUp({ currentTarget: el3, pointerType: 'mouse', clientX: 10, clientY: 90 });
    r.onClick({ currentTarget: el3 });
    if (fired !== 2) throw new Error('mouse click after a drag was swallowed (' + fired + ')');
    return true;
  });

  /* #232 — the Pinned section is a PARTITION of the list the filter already
     produced, and the two halves are rendered as two separate grids. Three
     things have to hold or a card either vanishes or renders twice: a stored
     id must resolve to exactly one card (the four merged cards answer to two
     ids each), the partition must be lossless, and the pinned half must keep
     registry order rather than the order the ids arrived in. */
  check('pin-card-partition', () => {
    // A NON-anchor id of a merged card still resolves, and to one card only.
    const merged = CARD_BY_GAME_ID['tilematching'];
    if (!merged) throw new Error('merged id tilematching resolves to no card');
    if (CARD_BY_GAME_ID['tilematchingdaily'] !== merged) {
      throw new Error('the two halves of the Tile Match card resolve differently');
    }
    if (cardPinId(merged) !== 'tilematchingdaily') {
      throw new Error('merged card anchor id is ' + cardPinId(merged));
    }
    // Every card must have an anchor id to store, or it cannot be pinned.
    for (const c of GAME_CARDS) {
      if (!cardPinId(c)) throw new Error('card ' + c.key + ' has no pin id');
      if (CARD_BY_GAME_ID[cardPinId(c)] !== c) {
        throw new Error('card ' + c.key + ' does not round-trip through its pin id');
      }
    }
    // Partition, given ids deliberately out of registry order.
    const stored = ['minesweeper', 'sudoku', 'tilematching'];
    const keys = new Set();
    for (const id of stored) { const c = CARD_BY_GAME_ID[id]; if (c) keys.add(c.key); }
    if (keys.size !== 3) throw new Error('3 stored ids resolved to ' + keys.size + ' cards');
    const ordered = GAME_CARDS;
    const pinned = ordered.filter(c => keys.has(c.key));
    const rest = ordered.filter(c => !keys.has(c.key));
    if (pinned.length + rest.length !== ordered.length) {
      throw new Error('partition lost or duplicated cards');
    }
    if (pinned.some(c => rest.indexOf(c) !== -1)) throw new Error('a card is in both halves');
    if (pinned.length !== 3) throw new Error('pinned half has ' + pinned.length + ' cards');
    // Registry order, not the order `stored` listed them in.
    const idx = pinned.map(c => ordered.indexOf(c));
    for (let i = 1; i < idx.length; i++) {
      if (idx[i] <= idx[i - 1]) throw new Error('pinned half is not in registry order');
    }
    return true;
  });

  /* Favorites (#308): the chip's filter is the same id → card-key resolution
     the pin partition uses, so a star on one half of a merged pair must
     surface that one card, every star must resolve, and an unknown id must
     never drop the count below the cards that DID resolve. One filter that
     reads exactly what the chip's view reads. */
  check('favorite-card-resolution', () => {
    const favSet = new Set();
    const stored = ['snakedaily', 'sudoku', 'mancala', 'not-a-real-id'];
    for (const id of stored) {
      const c = CARD_BY_GAME_ID[id];
      if (c) favSet.add(c.key);
    }
    // The unknown id resolves to nothing; the three real ones resolve to
    // exactly three cards.
    if (favSet.size !== 3) throw new Error('3 resolvable ids resolved to ' + favSet.size + ' cards');
    // Snake's stored anchor id (snakedaily) must surface the merged Snake card.
    const snake = CARD_BY_GAME_ID['snakedaily'];
    if (!snake || !favSet.has(snake.key)) throw new Error('snake favorite did not resolve to its card');
    const filtered = GAME_CARDS.filter(c => favSet.has(c.key));
    if (filtered.length !== 3) throw new Error('the Favorites filter shows ' + filtered.length + ' of 3 starred cards');
    return true;
  });

  // Phase 5 (#143) — 2048 vertical swipes were inverted. A lone tile at the
  // bottom row swiped 'up' must reach row 0, and vice versa.
  check('t2048-up', () => {
    const g = [[null, null, null, null], [null, null, null, null],
               [null, null, null, null], [t2048_newTile(2), null, null, null]];
    const r = t2048_move(g, 'up');
    return !!(r.grid[0][0] && !r.grid[3][0]);
  });
  check('t2048-down', () => {
    const g = [[t2048_newTile(2), null, null, null], [null, null, null, null],
               [null, null, null, null], [null, null, null, null]];
    const r = t2048_move(g, 'down');
    return !!(r.grid[3][0] && !r.grid[0][0]);
  });
  check('t2048-left', () => {
    const g = [[null, null, null, t2048_newTile(2)], [null, null, null, null],
               [null, null, null, null], [null, null, null, null]];
    const r = t2048_move(g, 'left');
    return !!(r.grid[0][0] && !r.grid[0][3]);
  });

  // Phase 5 (#139) — Word Search must place every word on the bigger grid.
  check('wordsearch-placement', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const rng = mulberry32(seed * 7919);
      const b = generateWordSearch(rng);
      for (const w of b.words) if (!locateWord(b.letters, w)) return false;
    }
    return true;
  });

  // Phase 5 (#138) — Daily Cipher must not repeat a word inside ANY window of
  // CW_CYCLE_LEN consecutive days (a sliding guarantee, not just an aligned
  // one), and every day must deal a full round set. Repeats inside a week are
  // what made every day feel identical.
  check('cipher-rotation', () => {
    /* Check the CAUSE before the symptom. The rotation guarantee is a partition
       over the union of every theme, so one word appearing in two themes breaks
       it — and the day-window failure below reports that as "X repeats on days
       4 and 8", which reads like a bug in the block maths. It is not: adding a
       Nature theme that shared 14 landform words with Geography produced
       exactly that message. Name the real problem. */
    const owner = new Map();
    for (const t of CW_THEMES) {
      for (const def of t.words) {
        if (owner.has(def.word) && owner.get(def.word) !== t.name) {
          throw new Error(`${def.word} is in two themes ("${owner.get(def.word)}" and ` +
            `"${t.name}") — the rotation partitions the UNION of the themes, so a ` +
            `word may only appear once across all of them`);
        }
        owner.set(def.word, t.name);
      }
    }
    for (let base = 0; base < 240; base++) {
      const seen = new Map();
      for (let d = base; d < base + CW_CYCLE_LEN; d++) {
        const rs = cwRoundsForDay(d);
        if (rs.length !== CW_ROUNDS_PER_DAY) {
          throw new Error('day ' + d + ' dealt ' + rs.length + ' words');
        }
        for (const def of rs) {
          if (seen.has(def.word)) {
            throw new Error(def.word + ' repeats on days ' + seen.get(def.word) + ' and ' + d);
          }
          seen.set(def.word, d);
        }
      }
    }
    return true;
  });

  // Phase 8 (#121) — every Mahjong layout must have the same slot count, or a
  // resumed board hydrates against the wrong shape.
  check('mahjong-layouts', () => {
    const bad = MJ_LAYOUTS.filter(l => l.pos.length !== 60).map(l => l.name + '=' + l.pos.length);
    if (bad.length) throw new Error('layouts not 60 slots: ' + bad.join(', '));
    // And every day must resolve to a real layout.
    for (let d = 0; d < 70; d++) if (!mjLayoutForDay(d)) throw new Error('no layout for day ' + d);
    return true;
  });

  /* #193 — the derived clues must help without answering. They are generated
     from the word rather than written, so nothing but this stops a short word
     from having its whole answer spelled out one clue at a time. Every word
     carries exactly TWO derived clues so the per-word clue count is uniform
     however long the day's words run — the short word's second clue is the
     repetition status, never a letter. */
  check('cipher-derived-hints', () => {
    const seen = new Set();
    for (const theme of CW_THEMES) {
      for (const entry of theme.words) {
        const w = entry.word;
        const derived = cwDerivedHints(w);
        if (derived.length !== 2) throw new Error(w + ': ' + derived.length + ' derived clues, expected exactly 2');
        // Never more than half the word given away by structure alone: count
        // only the POSITIONAL clues — the short word's repetition-status clue
        // reveals no letter at all.
        const revealed = w.length >= 5 ? 2 : 1;
        if (revealed >= w.length - 1) throw new Error(w + ' (len ' + w.length + '): ' + revealed + ' letters revealed leaves nothing to solve');
        for (const h of derived) {
          if (h.indexOf(w) !== -1) throw new Error(w + ': a clue spells the answer');
        }
        if (derived[0].indexOf('"' + w[0] + '"') === -1) throw new Error(w + ': first-letter clue names the wrong letter');
        if (w.length >= 5) {
          if (derived[1].indexOf('"' + w[w.length - 1] + '"') === -1) throw new Error(w + ': last-letter clue names the wrong letter');
        } else {
          // The short-word clue must state the repetition status, and state
          // it TRUTHFULLY — a wrong status clue misdirects worse than none.
          if (derived[1].indexOf('more than once') === -1) throw new Error(w + ': short-word clue is not a repetition-status clue');
          if (derived[1].indexOf('"') !== -1) throw new Error(w + ': short-word clue must not name a letter');
          const counts = {};
          for (const ch of w) counts[ch] = (counts[ch] || 0) + 1;
          const repeats = Object.keys(counts).some(ch => counts[ch] > 1);
          const saysNone = derived[1].indexOf('No letter') === 0;
          if (saysNone === repeats) throw new Error(w + ': repetition clue contradicts the word');
        }
        seen.add(w);
      }
    }
    if (seen.size < 200) throw new Error('only checked ' + seen.size + ' words — the corpus should be far larger');
    // And the written clues still lead: the escalation is semantic, then structural.
    const sample = CW_THEMES[0].words[0];
    const all = [...(sample.hints || []), ...cwDerivedHints(sample.word)];
    if (all.length <= (sample.hints || []).length) throw new Error('derived clues did not extend the list');
    if (all[0] !== sample.hints[0]) throw new Error('a written clue must come first');
    return true;
  });

  /* #197 — the Word Search board's states must stay READABLE in BOTH
     palettes. This is a self-test rather than a code review because the
     failure is silent and one-sided: every colour on that board used to be a
     literal tuned against dark, and the light theme quietly inherited a 2.21:1
     selection that nobody would notice unless they switched themes. Bold
     letters at roughly half the cell are large text, so 3:1 is the bar; the
     values here clear it with room, and this fails the build if a retheme
     takes one back under. */
  check('wordsearch-contrast', () => {
    const lum = (rgb) => {
      const f = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
    };
    const hex = (h) => {
      const v = String(h).replace('#', '');
      return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
    };
    const ratio = (a, b) => {
      const la = lum(a), lb = lum(b);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    };
    const over = (fg, alpha, bg) => fg.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha)));
    const MIN = 3; // large-text AA; the letters are 600 weight at ~half the cell
    for (const theme of ['light', 'dark']) {
      const P = PALETTES[theme];
      const card = hex(P.card), text = hex(P.text), white = [255, 255, 255];
      const cases = [
        ['plain', text, card],
        ['found', text, over(hex(P.emerald), 0.34, card)],
        ['hinted', text, over(hex(P.gold), 0.20, card)],
        ['selected', white, hex(P.accent)],
      ];
      for (const [name, ink, bg] of cases) {
        const r = ratio(ink, bg);
        if (r < MIN) throw new Error(theme + ' ' + name + ' is ' + r.toFixed(2) + ':1, under ' + MIN);
      }
    }
    return true;
  });

  /* #205 — the knight's move overlay is drawn from ktMovePath, and the hit
     test accepts whatever ktValidMoves returns. If those two ever disagree
     the board draws a path to a square you cannot tap, or leaves a tappable
     square with no path — the silent, only-visible-in-a-browser class of bug
     that ngGeometry/ngCellAt exists to prevent on Nonogram. */
  check('knight-move-paths', () => {
    for (const size of [5, 6, 7, 8]) {
      const n = size * size;
      const visited = new Array(n).fill(0);
      for (let from = 0; from < n; from++) {
        const moves = ktValidMoves(from, visited, size, null);
        if (moves.length === 0) throw new Error('no moves from ' + from + ' on ' + size);
        for (const to of moves) {
          const path = ktMovePath(from, to, size);
          if (!path) throw new Error(size + ': no path for the legal move ' + from + '->' + to);
          const [a, elbow, b] = path;
          if (a[0] * size + a[1] !== from) throw new Error('path does not start at the knight');
          if (b[0] * size + b[1] !== to) throw new Error('path does not end on the move');
          for (const [r, c] of path) {
            if (r < 0 || r >= size || c < 0 || c >= size) throw new Error(size + ': path leaves the board at ' + r + ',' + c);
          }
          // The elbow is on the LONG leg: it shares a file with the start and
          // a rank with the end, or the other way round — never a diagonal.
          const straight1 = a[0] === elbow[0] || a[1] === elbow[1];
          const straight2 = b[0] === elbow[0] || b[1] === elbow[1];
          if (!straight1 || !straight2) throw new Error(size + ': elbow is not a right angle for ' + from + '->' + to);
          const leg1 = Math.abs(elbow[0] - a[0]) + Math.abs(elbow[1] - a[1]);
          const leg2 = Math.abs(b[0] - elbow[0]) + Math.abs(b[1] - elbow[1]);
          if (leg1 !== 2 || leg2 !== 1) throw new Error(size + ': legs are ' + leg1 + '/' + leg2 + ', expected 2 then 1');
        }
      }
    }
    // And nothing that is not a knight move gets a path.
    if (ktMovePath(0, 1, 8)) throw new Error('a one-square step is not a knight move');
    if (ktMovePath(0, 9, 8)) throw new Error('a diagonal is not a knight move');
    if (ktMovePath(null, 5, 8)) throw new Error('no knight, no path');
    return true;
  });

  /* #213 — the camouflage marble takes the colour of what it lands against.
     This is the rule that makes it a bonus at all: the power-up it replaces
     fired a marble coloured '#ffffff', and zumaCheckMatches compares colour
     strings exactly, so that "wildcard" matched nothing and left you one
     marble worse off than before you collected it. */
  check('marbleloop-camouflage', () => {
    const R = '#f43f5e', B = '#3b82f6', G = '#10b981';
    const ch = (...cols) => cols.map((c, i) => ({ color: c, dist: i * 10 }));
    // Ties go left, and left here is a pair, so the marble completes a three.
    let c = ch(R, R, null, B, B);
    if (zumaWildColorAt(c, 2) !== R) throw new Error('a tie must resolve to the left');
    // The longer run wins, whichever side it is on.
    c = ch(R, null, B, B, B);
    if (zumaWildColorAt(c, 1) !== B) throw new Error('the longer neighbouring run must win');
    c = ch(G, G, G, null, B);
    if (zumaWildColorAt(c, 3) !== G) throw new Error('the longer run must win on the left too');
    // One neighbour only.
    c = ch(null, B, B);
    if (zumaWildColorAt(c, 0) !== B) throw new Error('the head of the chain must take its only neighbour');
    c = ch(R, R, null);
    if (zumaWildColorAt(c, 2) !== R) throw new Error('the tail must take its only neighbour');
    // Nothing to take a colour from.
    if (zumaWildColorAt([{ color: null, dist: 0 }], 0) !== null) throw new Error('a lone marble has no colour to take');
    if (zumaWildColorAt([], 0) !== null) throw new Error('an empty chain must not throw');
    // And the resolved colour must actually POP: resolve, then match.
    c = ch(R, R, null, B, B);
    c[2].color = zumaWildColorAt(c, 2);
    if (zumaCheckMatches(c, 2) !== 3) throw new Error('a resolved camouflage marble must complete the run it joined');
    // The white marble it replaces would not have.
    c = ch(R, R, '#ffffff', B, B);
    if (zumaCheckMatches(c, 2) !== 0) throw new Error('the old white wildcard is supposed to match nothing');
    return true;
  });

  /* #212 — the aim ray and the supply bot. Both are pure, and both are things
     a player is told: the guide promises where the marble lands, and below
     five marbles the cannon promises every colour it deals can still clear
     something. */
  check('marbleloop-aim', () => {
    const pd = zumaComputePathData([{ x: 0, y: 100 }, { x: 300, y: 100 }]);
    // A ray with an empty chain runs off the board and reports no hit.
    let r = zumaAimPath([], pd, 150, 300, -Math.PI / 2, 300, 400);
    if (r.hit !== -1) throw new Error('nothing to hit means no hit');
    if (r.y > 0) throw new Error('a ray with nothing in the way must leave the board');
    // A marble straight ahead is found, and the guide stops ON it.
    const chain = [{ color: '#f43f5e', dist: 150 }];
    r = zumaAimPath(chain, pd, 150, 300, -Math.PI / 2, 300, 400);
    if (r.hit !== 0) throw new Error('a marble in the path must be found');
    if (Math.abs(r.x - 150) > 1 || Math.abs(r.y - 100) > 1) throw new Error('the guide must stop on the marble it found');
    // One well off to the side is not in the path.
    r = zumaAimPath([{ color: '#f43f5e', dist: 20 }], pd, 150, 300, -Math.PI / 2, 300, 400);
    if (r.hit !== -1) throw new Error('a marble the ray misses is not a hit');
    // A marble not yet on the track cannot be aimed at.
    r = zumaAimPath([{ color: '#f43f5e', dist: -40 }], pd, 150, 300, -Math.PI / 2, 300, 400);
    if (r.hit !== -1) throw new Error('a marble off the near end of the track is not on the board');

    // The supply bot: below the threshold every colour dealt is one that is
    // still on the chain, so the last marbles can always be cleared.
    const A = ZUMA_COLORS_ALL[0], B = ZUMA_COLORS_ALL[3];
    const short = [{ color: A, dist: 1 }, { color: B, dist: 2 }];
    for (let i = 0; i < 40; i++) {
      const c = zumaSupplyColor(short, 5, mulberry32(i >>> 0));
      if (c !== A && c !== B) throw new Error('a short chain must only be dealt colours it still holds');
    }
    // At or above the threshold it is the ordinary draw again, so the game
    // does not quietly become easy for the whole second half of a level.
    const long = [];
    for (let i = 0; i < ZUMA_SUPPLY_AT; i++) long.push({ color: A, dist: i });
    let sawOther = false;
    for (let i = 0; i < 60; i++) if (zumaSupplyColor(long, 5, mulberry32(i >>> 0)) !== A) sawOther = true;
    if (!sawOther) throw new Error('a full chain must still be dealt the full palette');
    // An empty chain has nothing to supply from and must not throw.
    if (!zumaSupplyColor([], 5, mulberry32(1))) throw new Error('an empty chain still deals a marble');

    // The marble is bigger than it was, and no level is choked by it: the
    // longest chain still leaves a third of its own track empty.
    if (ZUMA_BALL_R < 13) throw new Error('the marble was enlarged on purpose (#212)');
    for (const lvl of ZUMA_LEVELS) {
      const p = zumaComputePathData(lvl.path);
      if (lvl.ballCount * ZUMA_DIAM > p.totalLen * 0.75) {
        throw new Error('a level starts with too little track left: ' + lvl.ballCount + ' marbles');
      }
    }
    return true;
  });

  /* `C` is built from PALETTES.light's KEYS only, so `${C.well}` — or any
     other DERIVED token (well-strong, scrim, the shadow trio, the *-hover
     pair) — interpolates the string "undefined", and the browser drops the
     whole declaration. It is the same silent-failure shape as
     token-alpha-concat, and it had killed .review-btn:hover and
     .pregame-band[data-pressed] outright. Reach for var(--c-well) instead. */
  check('css-no-undefined-token', () => {
    const i = css.indexOf('undefined');
    if (i >= 0) {
      throw new Error('the stylesheet interpolates undefined — use var(--c-…) for a '
        + 'derived token. Near: ' + css.slice(Math.max(0, i - 80), i + 12));
    }
    return true;
  });

  /* #202 — how long a stone takes to be sown. The reported "instant turbo"
     was a flat 80 ms gap, under the ~100 ms a person needs to register a
     discrete event, so four stones read as one jump. The shape that fixes it
     has to hold at both ends: generous for a small handful, tightening as the
     handful grows, and bounded so a big pit is still quick. */
  check('mancala-sowing', () => {
    const d4 = mncSowDelay(4), d8 = mncSowDelay(8), d15 = mncSowDelay(15);
    if (d4 < 100) throw new Error('a small handful must be slow enough to see, got ' + d4);
    if (!(d4 >= d8 && d8 >= d15)) throw new Error('a bigger handful must not be slower per stone');
    if (d4 > MNC_SOW_MAX || d15 < MNC_SOW_MIN) throw new Error('the gap must stay inside its bounds');
    /* A typical move stays inside the budget; the bounds only catch extremes.
       The slack is `n` because the gap is rounded to whole milliseconds per
       stone, so n stones can carry up to n ms of rounding. */
    for (const n of [6, 8, 10, 12, 15]) {
      if (mncSowDelay(n) * n > MNC_SOW_BUDGET + n) throw new Error(n + ' stones overrun the budget');
    }
    // A one-stone move is a move, and a garbage count is not a crash.
    if (mncSowDelay(1) !== MNC_SOW_MAX) throw new Error('one stone gets the longest gap');
    if (!(mncSowDelay(0) > 0) || !(mncSowDelay(-3) > 0)) throw new Error('a nonsense count still yields a delay');
    return true;
  });

  /* #186 — the in-app back control reads this to decide between unwinding a
     screen and going home. It runs in an IFRAME, so a wrong answer here does
     not mis-navigate, it steps the EMBEDDING page out of the app. Everything
     that is not unambiguously one of our own entries must therefore read 0 —
     the value that makes goBack fall back to the lobby. */
  check('nav-depth-fail-safe', () => {
    if (navDepthOf({ un: { screen: 'game' }, unDepth: 3 }) !== 3) throw new Error('our own entry reports its depth');
    if (navDepthOf({ un: { screen: 'lobby' }, unDepth: 0 }) !== 0) throw new Error('the first entry is depth 0');
    // Not ours, in every shape a session history can hand back.
    for (const bad of [null, undefined, {}, { unDepth: 4 }, { un: null, unDepth: 4 },
                       { un: { screen: 'game' } }, { un: {}, unDepth: '4' },
                       { un: {}, unDepth: NaN }, { un: {}, unDepth: Infinity },
                       { un: {}, unDepth: -2 }, { un: {}, unDepth: true }]) {
      if (navDepthOf(bad) !== 0) throw new Error('a foreign or malformed entry must read 0: ' + JSON.stringify(bad));
    }
    // A fractional depth floors rather than surviving as one.
    if (navDepthOf({ un: {}, unDepth: 2.7 }) !== 2) throw new Error('depth is a whole number of entries');
    return true;
  });

  /* #217 — Ludo's tokens are now their own tap targets. The old layout
     stepped each token 5px down-right by its INDEX, which put a lone token
     off-centre and smeared a stack into something no finger can pick apart;
     the hit test then took the topmost of the draw order, which is simply
     the highest token number rather than the one that was aimed at. */
  check('ludo-token-stack', () => {
    for (const cell of [18, 22, 26]) {          // the whole range the board draws
      const lone = ludoStackLayout(1, cell);
      const [lx, ly] = lone.at(0);
      if (lx !== 0 || ly !== 0) throw new Error('a lone token sits dead centre');
      if (Math.abs(lone.r - cell * 0.425) > 0.001) throw new Error('a lone token keeps the full radius');
      for (let n = 2; n <= 4; n++) {
        const lay = ludoStackLayout(n, cell);
        const pts = [];
        for (let j = 0; j < n; j++) pts.push(lay.at(j));
        for (const [dx, dy] of pts) {
          if (Math.hypot(dx, dy) + lay.r > cell / 2 + 0.001) {
            throw new Error('a stack of ' + n + ' spills out of its cell at cell=' + cell);
          }
        }
        let gap = Infinity;
        for (let a = 0; a < n; a++) {
          for (let b = a + 1; b < n; b++) {
            gap = Math.min(gap, Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]));
          }
        }
        // 5px was the old fixed step; nothing may end up tighter than that.
        if (gap < 5) throw new Error('a stack of ' + n + ' packs tighter than 5px at cell=' + cell);
        if (lay.r < 4) throw new Error('a stack of ' + n + ' draws tokens too small to read');
      }
    }
    return true;
  });

  check('ludo-token-pick', () => {
    const cell = 26, lay = ludoStackLayout(4, cell);
    const toks = [];
    for (let j = 0; j < 4; j++) {
      const [dx, dy] = lay.at(j);
      toks.push({ i: j, cx: 100 + dx, cy: 100 + dy, r: lay.r });
    }
    // Aimed straight at each one, each one is what you get.
    for (const t of toks) {
      const got = ludoPickToken(toks, t.cx, t.cy);
      if (!got || got.i !== t.i) throw new Error('a tap on token ' + (t.i + 1) + ' picked ' + (got ? got.i + 1 : 'nothing'));
    }
    // The regression: a point inside the LAST token's slop but nearer the
    // first used to resolve to the last, because the scan ran in draw order.
    const near = ludoPickToken(toks, toks[0].cx, toks[0].cy - 1);
    if (!near || near.i !== 0) throw new Error('nearest centre must win, not draw order');
    // Nothing within reach is nothing.
    if (ludoPickToken(toks, 100, 100 + cell * 3)) throw new Error('a tap off the tokens picks none');
    if (ludoPickToken([], 100, 100)) throw new Error('no candidates picks none');
    return true;
  });

  /* The roll is animated, but the VALUE is still only ever the referee's —
     the tumble is a fixed, repeat-free cycle of faces shown while the real
     number is on its way. */
  check('ludo-die-faces', () => {
    for (let f = 1; f <= 6; f++) {
      const pips = LUDO_PIPS[f];
      if (!pips || pips.length !== f) throw new Error('face ' + f + ' must draw ' + f + ' pips');
      for (const [px, py] of pips) {
        if (Math.abs(px) > 1 || Math.abs(py) > 1) throw new Error('face ' + f + ' has a pip outside the die');
      }
    }
    if (LUDO_TUMBLE.length !== 6 || new Set(LUDO_TUMBLE).size !== 6) {
      throw new Error('the tumble must show each face once per cycle');
    }
    for (let k = 0; k < LUDO_TUMBLE.length; k++) {
      const a = LUDO_TUMBLE[k], b = LUDO_TUMBLE[(k + 1) % LUDO_TUMBLE.length];
      if (!LUDO_PIPS[a]) throw new Error('the tumble shows a face the die cannot draw: ' + a);
      if (a === b) throw new Error('two consecutive tumble frames are the same face');
    }
    if (!(LUDO_ROLL_MS > LUDO_ROLL_TICK_MS * 4)) throw new Error('the tumble must run long enough to read as one');
    return true;
  });

  /* #206 — the turn queue. The reported "the snake fails to turn on tap or
     swipe" is these two cases: a second turn that overwrote the first, and a
     second turn refused for reversing a direction the first one was about to
     change. A corner is two turns and a tick is 90-200 ms, so both happen
     constantly. */
  check('snake-turn-queue', () => {
    const R = SNAKE_DIRS.right, U = SNAKE_DIRS.up, D = SNAKE_DIRS.down, L = SNAKE_DIRS.left;
    const same = (a, b) => a && b && a.x === b.x && a.y === b.y;
    // The corner that used to lose its first half: up then left while going right.
    let q = snakeQueueTurn('up', R, []);
    if (!q || q.length !== 1 || !same(q[0], U)) throw new Error('the first turn of a corner must queue');
    q = snakeQueueTurn('left', R, q);
    if (!q || q.length !== 2 || !same(q[1], L)) throw new Error('the second turn of a corner must queue behind the first, not replace it');
    // Each turn is judged against the one BEFORE IT IN THE QUEUE, not against
    // the direction still being travelled.
    if (snakeQueueTurn('down', U, [L]) === null) throw new Error('down is legal after a queued left, whatever the snake is doing now');
    if (snakeQueueTurn('down', L, [U]) !== null) throw new Error('down must still be refused behind a queued up');
    // Doubling back is still impossible, which is the whole reason one tick
    // may only consume one turn.
    if (snakeQueueTurn('left', R, []) !== null) throw new Error('a snake may not reverse into itself');
    if (snakeQueueTurn('up', D, []) !== null) throw new Error('a snake may not reverse into itself');
    // A turn you are already making is not a turn.
    if (snakeQueueTurn('right', R, []) !== null) throw new Error('the direction already travelled is not a turn');
    if (snakeQueueTurn('up', R, [U]) !== null) throw new Error('the direction already queued is not a turn');
    // The queue is two deep: it remembers a corner, it is not an input buffer.
    if (snakeQueueTurn('right', R, [U, L]) !== null) throw new Error('the queue must hold at most ' + SNAKE_TURN_QUEUE);
    if (snakeQueueTurn('nowhere', R, []) !== null) throw new Error('an unknown direction is not a turn');
    if (snakeQueueTurn('up', null, []) !== null) throw new Error('no current direction, no turn');

    // A tap means the triangle it lands in, so it cannot mean two things.
    if (snakeTapDir(50, 5, 100, 100) !== 'up') throw new Error('the top triangle means up');
    if (snakeTapDir(50, 95, 100, 100) !== 'down') throw new Error('the bottom triangle means down');
    if (snakeTapDir(5, 50, 100, 100) !== 'left') throw new Error('the left triangle means left');
    if (snakeTapDir(95, 50, 100, 100) !== 'right') throw new Error('the right triangle means right');
    if (snakeTapDir(50, 50, 100, 100) !== null) throw new Error('the centre means nothing');
    if (snakeTapDir(10, 10, 0, 0) !== null) throw new Error('an unmeasured board means nothing');
    // Just inside a diagonal resolves to the nearer edge, never to neither.
    if (snakeTapDir(20, 18, 100, 100) !== 'up') throw new Error('a tap above the diagonal is up');
    if (snakeTapDir(18, 20, 100, 100) !== 'left') throw new Error('a tap left of the diagonal is left');
    return true;
  });

  /* #188 — a whole family of rules can go dead in one keystroke.

     `.pregame-deal` was missing its semicolon and its closing brace, and the
     declarations belonging to it had been stranded ~70 lines further down. The
     CSS parser swallowed everything in between into one invalid rule and threw
     it away: the band picker, its selected-state highlight, the resume note and
     the full-width Play button had all silently stopped applying, and nothing
     failed. Probing computed style is the only thing that catches this — a text
     scan of the css string sees the rules perfectly well, which is exactly why
     it went unnoticed. Same canary idea as tapCanaryApplied. */
  check('pregame-styles-applied', () => {
    const probes = [
      ['pregame-deal', 'borderRadius', '0px'],
      ['pregame-band', 'borderRadius', '0px'],
      ['pregame-band-row', 'display', 'block'],
    ];
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-9999px;top:-9999px';
    document.body.appendChild(host);
    try {
      for (const [cls, prop, dead] of probes) {
        const el = document.createElement('div');
        el.className = cls;
        host.appendChild(el);
        const got = getComputedStyle(el)[prop];
        if (got === dead) {
          throw new Error('.' + cls + ' is not applying (' + prop + ' = ' + got + ') — the rule block is probably unterminated');
        }
      }
    } finally {
      host.remove();
    }
    return true;
  });

  /* #215 — Hash Rush's four tap-to-mine rules, and the level targets derived
     from them. These are the whole of what the issue asked for, so they are
     the things a retune must not quietly undo. */
  check('hashrush-strike-rules', () => {
    const st = () => ({ score: 0, tokens: 0, boost: 0 });
    // A hash pays HR_TOKEN_SCORE, doubled while boosted.
    let s = st();
    hrApplyStrike(s, { type: 'hash' });
    if (s.score !== HR_TOKEN_SCORE || s.tokens !== 1) throw new Error('a hash must pay ' + HR_TOKEN_SCORE);
    s.boost = 3;
    hrApplyStrike(s, { type: 'hash' });
    if (s.score !== HR_TOKEN_SCORE * (1 + HR_BOOST_MULT)) throw new Error('a boosted hash must pay double');
    // Lightning ADDS. The pre-#215 bug was an assignment, which threw away
    // whatever was left of the boost you already had.
    s = st();
    hrApplyStrike(s, { type: 'bolt' });
    hrApplyStrike(s, { type: 'bolt' });
    if (s.boost !== HR_BOOST_SECS * 2) throw new Error('two bolts must stack, got ' + s.boost);
    s.boost = HR_BOOST_MAX;
    hrApplyStrike(s, { type: 'bolt' });
    if (s.boost !== HR_BOOST_MAX) throw new Error('stacked boost must cap at ' + HR_BOOST_MAX);
    // TNT costs points, and cannot push a score negative.
    s = st(); s.score = 25;
    hrApplyStrike(s, { type: 'tnt' });
    if (s.score !== 25 - HR_TNT_PENALTY) throw new Error('TNT must cost ' + HR_TNT_PENALTY);
    hrApplyStrike(s, { type: 'tnt' });
    hrApplyStrike(s, { type: 'tnt' });
    if (s.score !== 0) throw new Error('TNT must not drive a score below zero, got ' + s.score);
    // The hit box: nearest object in the tapped lane wins, and a strike
    // outside the window connects with nothing.
    const W = 300, laneW = W / HR_LANES;
    const objs = [{ lane: 1, y: 100, type: 'hash' }, { lane: 1, y: 160, type: 'tnt' }, { lane: 0, y: 100, type: 'hash' }];
    const mid = laneW * 1.5;
    if (hrPickAt(objs, mid, 105, W) !== 0) throw new Error('a strike must take the nearest object in its lane');
    if (hrPickAt(objs, mid, 158, W) !== 1) throw new Error('a strike lower down must take the lower object');
    if (hrPickAt(objs, mid, 100 + HR_TAP_R + 40, W) === 0) throw new Error('a strike well clear of an object must miss it');
    if (hrPickAt(objs, laneW * 2.5, 100, W) !== -1) throw new Error('an empty lane must yield nothing');
    if (hrPickAt([{ lane: 1, y: 100, type: 'hash', hit: true }], mid, 100, W) !== -1) throw new Error('an already-mined object must not be struck twice');
    return true;
  });

  /* The target every bounded level asks for is DERIVED from that level's own
     spawn stream (see hrTargetFor), so this is the check that a retune of the
     ladder cannot set a goal the game does not deal enough hashes to reach. */
  check('hashrush-level-targets', () => {
    const seeded = (band) => mulberry32(hashStr('hashrush:story:' + band) >>> 0);
    let prev = 0;
    for (let b = 0; b < HR_STORY.length; b++) {
      const cfg = { ...HR_STORY[b], limit: HR_STORY[b].secs };
      const target = hrTargetFor(cfg, seeded(b));
      const model = hrModelRun(cfg, seeded(b), cfg.limit);
      if (!(target > 0)) throw new Error('level ' + (b + 1) + ' has no target');
      if (target > model.score) throw new Error('level ' + (b + 1) + ' asks for ' + target + ' and the best the model scores is ' + model.score);
      if (target <= prev) throw new Error('level ' + (b + 1) + ' asks for ' + target + ', no more than level ' + b + "'s " + prev);
      prev = target;
      // Same seed, same target: two players on one rung must be given the
      // same goal, which is the whole reason it is derived and not rolled.
      if (hrTargetFor(cfg, seeded(b)) !== target) throw new Error('level ' + (b + 1) + ' target is not stable');
      // And the plan it is derived from must not depend on how it is walked.
      const a = hrSpawnPlan(cfg, seeded(b), cfg.limit);
      const c = hrSpawnPlan(cfg, seeded(b), cfg.limit);
      if (a.length !== c.length) throw new Error('level ' + (b + 1) + ' spawn plan is not deterministic');
    }
    return true;
  });

  /* #326 — Jet Run's contact rules and its derived course targets. The game
     has nothing to shoot at, so its hazards are gates, storm clouds and the
     shields they cost; these are the rules a retune must not quietly undo,
     mirroring hashrush-strike-rules: one pure pair owns the hit boxes and the
     costs, and the frame loop and these checks all go through it. */
  check('jetrun-course-rules', () => {
    const W = 300;
    const mk = (type, fx, fw, y) => ({ type, fx, fw, y });
    // A gate is two posts standing at the edges of its gap; the middle of the
    // gap is clear, a post is a hazard.
    const gate = mk('gate', 0.5, 0.30, 100); // gap 90px wide, centred at 150
    if (dfPickAt([gate], 150, 100, W) !== -1) throw new Error('the middle of a gate gap must be clear');
    if (dfPickAt([gate], 185, 100, W) !== 0) throw new Error('a gate post must be a hazard');
    // A storm cloud is a hazard; clear sky is not.
    const cloud = mk('cloud', 0.5, 0.20, 200);
    if (dfPickAt([cloud], 150, 200, W) !== 0) throw new Error('a storm cloud must be a hazard');
    if (dfPickAt([cloud], 150, 140, W) !== -1) throw new Error('clear sky must not be a hazard');
    // Stars are pickups, never hazards — dfStarAt is the one that sees them.
    if (dfPickAt([mk('star', 0.5, 0.05, 100)], 150, 100, W) !== -1) throw new Error('a star must not be a hazard');
    if (dfStarAt([mk('star', 0.5, 0.05, 100)], 150, 100, W) !== 0) throw new Error('a star must be collectable');
    // Nearest contact wins when two hazards overlap the jet.
    const near = mk('gate', 0.5, 0.30, 130);
    if (dfPickAt([gate, near], 185, 120, W) !== 1) throw new Error('the nearest contact must win');
    if (dfPickAt([near, gate], 185, 120, W) !== 0) throw new Error('the nearest contact must win, order aside');
    // An already-hit object never bills twice.
    if (dfPickAt([mk('cloud', 0.5, 0.20, 100)], 150, 100, W) !== 0) throw new Error('precondition');
    if (dfPickAt([{ type: 'cloud', fx: 0.5, fw: 0.20, y: 100, hit: true }], 150, 100, W) !== -1) throw new Error('a hit cloud must not bill twice');
    // The gate line: inside the gap is a pass, a post is a clip, outside both
    // is a miss.
    if (dfGateVerdict(150, 150, 45) !== 'pass') throw new Error('inside the gap must be a pass');
    if (dfGateVerdict(150 + 57, 150, 45) !== 'clip') throw new Error('a post must be a clip');
    if (dfGateVerdict(150 + 100, 150, 45) !== 'miss') throw new Error('clear of both must be a miss');
    // The combo ladder: 5 gates per step, capped at ×5. And what a contact
    // costs: a hazard takes a shield AND the combo, a star pays flat.
    if (dfMultFor(0) !== 1 || dfMultFor(4) !== 1 || dfMultFor(5) !== 2 || dfMultFor(100) !== DF_MAX_MULT) {
      throw new Error('the combo multiplier ladder is wrong');
    }
    const s = { score: 0, shields: 3, combo: 0 };
    dfApplyHit(s, 'star');
    if (s.score !== DF_STAR_SCORE || s.shields !== 3) throw new Error('a star must pay flat and never touch the shields');
    s.combo = 4;
    dfApplyHit(s, 'cloud');
    if (s.shields !== 2 || s.combo !== 0) throw new Error('a storm must cost a shield and the combo');
    dfApplyHit(s, 'pylon');
    if (s.shields !== 1) throw new Error('a pylon must cost a shield');
    // A storm is never parked inside a gate's gap — that would be a shield
    // loss no steering can avoid, which is a tax rather than a puzzle.
    const plan = dfCoursePlan({ speed: 200, spawnEvery: 0.6, cloudRate: 0.4, starRate: 0.2, gap: 0.26 }, mulberry32(424242), 120);
    let lastGateFx = null;
    for (const o of plan) {
      if (o.type === 'gate') lastGateFx = o.fx;
      else if (o.type === 'cloud' && lastGateFx != null && Math.abs(o.fx - lastGateFx) < 0.18) {
        throw new Error('a cloud must not sit on the previous gate\'s gap');
      }
    }
    return true;
  });

  /* Jet Run's targets are derived the same way Hash Rush's are (dfTargetFor),
     so the same property checks hold: every rung has a reachable, strictly
     rising, per-seed-stable target, and its course plan is deterministic. */
  check('jetrun-level-targets', () => {
    const seeded = (band) => mulberry32(hashStr('jetrun:story:' + band) >>> 0);
    let prev = 0;
    for (let b = 0; b < DF_STORY.length; b++) {
      const cfg = { ...DF_STORY[b], limit: DF_STORY[b].secs };
      const target = dfTargetFor(cfg, seeded(b));
      const model = dfModelRun(cfg, seeded(b), cfg.limit);
      if (!(target > 0)) throw new Error('level ' + (b + 1) + ' has no target');
      if (target > model.score) throw new Error('level ' + (b + 1) + ' asks for ' + target + ' and the best the model scores is ' + model.score);
      if (target <= prev) throw new Error('level ' + (b + 1) + ' asks for ' + target + ', no more than level ' + b + "'s " + prev);
      prev = target;
      if (dfModeConfig('story', b).limit !== DF_STORY[b].secs) {
        throw new Error('level ' + (b + 1) + ' config lost its clock');
      }
      // Same seed, same target: two players on one rung must be given the
      // same goal.
      if (dfTargetFor(cfg, seeded(b)) !== target) throw new Error('level ' + (b + 1) + ' target is not stable');
      // And the plan it is derived from must not depend on how it is walked.
      const a = dfCoursePlan(cfg, seeded(b), cfg.limit);
      const c = dfCoursePlan(cfg, seeded(b), cfg.limit);
      if (a.length !== c.length) throw new Error('level ' + (b + 1) + ' course plan is not deterministic');
    }
    return true;
  });

  /* #187 / #196 — the local resume record for story and arcade runs. These are
     the properties that keep it from doing harm: it is scoped per (game, mode,
     band) so two rungs cannot overwrite each other, it refuses to answer for a
     daily (whose resume is the server's attempt row and must stay that way),
     and it stamps the day on the way out so the games' same-board gate passes
     for a board that is not day-scoped. */
  check('local-run-save', () => {
    const K = (g, m, b) => runSaveKey(g, m, b);
    if (K('sudoku', 'story', 3) === K('sudoku', 'story', 4)) throw new Error('two rungs must not share a key');
    if (K('sudoku', 'story', 3) === K('wordhunt', 'story', 3)) throw new Error('two games must not share a key');
    if (K('sudoku', 'story', 3) === K('sudoku', 'arcade', 3)) throw new Error('two modes must not share a key');
    // A daily has a server-side resume and must never be answered from here.
    if (readRunSave('sudoku', 'daily', null) !== null) throw new Error('a daily must not read a local run save');
    let wrote = false;
    try { writeRunSave('sudoku', 'daily', null, { v: 1, progress: { a: 1 } }); wrote = !!localStorage.getItem(K('sudoku', 'daily', null)); } catch (_) {}
    if (wrote) { try { localStorage.removeItem(K('sudoku', 'daily', null)); } catch (_) {} throw new Error('a daily must not write a local run save'); }

    // Round trip, then clear. Uses a game id nothing else touches.
    const gid = '__selftest__';
    try {
      clearRunSave(gid, 'story', 0);
      if (readRunSave(gid, 'story', 0) !== null) throw new Error('a cleared save must read back as nothing');
      writeRunSave(gid, 'story', 0, { v: 1, progress: { grid: [1, 2] }, steps: 7, elapsedSecs: 99, savedAt: Date.now() });
      const rec = readRunSave(gid, 'story', 0);
      if (!rec || rec.steps !== 7) throw new Error('a written save must read back');
      const h = hydrateRunSave(rec, 0);
      if (h.steps !== 7 || h.elapsedSecs !== 99) throw new Error('hydrate must carry steps and the clock');
      if (h.dayNum !== utcDayNum(0)) throw new Error('hydrate must stamp today, or every game rejects it');
      if (!Array.isArray(h.grid)) throw new Error('hydrate must carry the progress through');
      // An old record is dropped rather than resumed into.
      writeRunSave(gid, 'story', 0, { v: 1, progress: { grid: [1] }, steps: 1, elapsedSecs: 1, savedAt: Date.now() - RUN_SAVE_MAX_AGE_MS - 1000 });
      if (readRunSave(gid, 'story', 0) !== null) throw new Error('a stale save must expire');
      if (hydrateRunSave(null, 0) !== null) throw new Error('nothing hydrates to nothing');
    } finally {
      clearRunSave(gid, 'story', 0);
    }
    return true;
  });

  /* Snakes & Ladders V2 — the seven hand-authored tier boards must satisfy
     the authoring constraints (see snakesladders-v2/00-layouts.jsx), or a
     future retune ships a broken board: a chained jump the engine resolves
     ambiguously, a snake pointing up, a Legend summit that can be skipped. */
  check('cnlv2-layouts', () => {
    const expected = {
      beginner: [8, 3], amateur: [7, 5], regular: [6, 6], professional: [5, 8],
      topplayer: [4, 10], superstar: [3, 12], legend: [2, 14],
    };
    if (CNLV2_LAYOUTS.length !== 7) throw new Error('expected 7 tiers, got ' + CNLV2_LAYOUTS.length);
    for (const L of CNLV2_LAYOUTS) {
      const exp = expected[L.id];
      if (!exp) throw new Error('unknown tier id ' + L.id);
      const lad = Object.keys(L.ladders).map(Number);
      const snk = Object.keys(L.snakes).map(Number);
      if (lad.length !== exp[0] || snk.length !== exp[1]) {
        throw new Error(L.id + ' has ' + lad.length + ' ladders / ' + snk.length + ' snakes, expected ' + exp.join('/'));
      }
      const starts = lad.concat(snk);
      if (new Set(starts).size !== starts.length) throw new Error(L.id + ' has duplicate jump starts');
      const dests = [];
      for (const s of lad) {
        const e = L.ladders[s];
        if (s < 2 || s > 99) throw new Error(L.id + ' ladder start ' + s + ' out of 2–99');
        // e < 100, not ≤: a collision knockback can land a pawn on a ladder
        // bottom, and a ladder into 100 would win the game for a pawn that
        // never rolled. Square 100 is reachable by an exact roll only.
        if (e <= s || e >= 100) throw new Error(L.id + ' ladder ' + s + '→' + e + ' must climb, ending below 100');
        dests.push(e);
      }
      for (const s of snk) {
        const e = L.snakes[s];
        if (s < 2 || s > 99) throw new Error(L.id + ' snake head ' + s + ' out of 2–99');
        if (e >= s || e < 2) throw new Error(L.id + ' snake ' + s + '→' + e + ' must slide down, ending ≥2');
        dests.push(e);
      }
      // No square may be both a jump start and a jump destination: the engine
      // applies exactly one jump per landing, so chains would be ambiguous.
      const destSet = new Set(dests);
      for (const s of starts) {
        if (destSet.has(s)) throw new Error(L.id + ': square ' + s + ' is both a jump start and a destination');
      }
      if (L.id === 'legend') {
        for (const s of lad) {
          if (L.ladders[s] >= 80) throw new Error('legend ladder tops out at ' + L.ladders[s] + ' — must stay below 80');
        }
      }
    }
    /* #203 — the part no count-based rule could catch. Legend satisfied every
       constraint above and still took 1812 expected rolls to finish, because
       95/97/98/99 were all snake heads and only two squares in the whole
       board could reach 100 by an exact roll. A tier is now MEASURED: it must
       finish in a human number of rolls, and each tier must be harder than the
       one before it, or the ladder the picker presents is a fiction.

       The cap is deliberately loose. It is not a balance target — it is the
       line between "a long game" and "not a game", and a retune that wants
       Legend at 400 rolls should be free to do it without editing a test. */
    const CNLV2_MAX_EXPECTED_ROLLS = 600;
    let prev = 0;
    for (const L of CNLV2_LAYOUTS) {
      const e = cnlv2ExpectedRolls(L);
      if (!isFinite(e) || e <= 0) throw new Error(L.id + ' has no finite expected roll count — square 100 may be unreachable');
      if (e > CNLV2_MAX_EXPECTED_ROLLS) {
        throw new Error(L.id + ' needs ' + Math.round(e) + ' expected rolls to finish, cap is ' + CNLV2_MAX_EXPECTED_ROLLS);
      }
      if (e <= prev) {
        throw new Error(L.id + ' (' + Math.round(e) + ' rolls) is not harder than the tier before it (' + Math.round(prev) + ')');
      }
      prev = e;
    }
    return true;
  });

  /* Local Match flow — the pure helpers behind the roster, the placement
     ladder and the mood switch. None of them is reachable by a navigation
     check (a hot-seat match takes dozens of taps to finish), so the rules
     they encode are asserted here instead of in dapp.json. */
  check('cnlv2-match-flow', () => {
    // A roster is always 2-6 seats and always holds at least one human: a
    // table of six bots has nobody to hand the phone to.
    const r1 = cnlv2NormalizeRoster(['bot', 'bot', 'bot'], 3);
    if (r1.length !== 3 || r1[0] !== 'human') throw new Error('all-bot roster must gain a human seat');
    if (cnlv2NormalizeRoster(null, 5).length !== 5) throw new Error('seat count fallback broken');
    if (cnlv2NormalizeRoster(['human'], 2).length !== 2) throw new Error('a 1-seat roster must pad to 2');
    if (cnlv2NormalizeRoster(new Array(9).fill('human'), 6).length !== 6) throw new Error('roster must cap at 6 seats');
    const mixed = cnlv2NormalizeRoster(['human', 'bot', 'human'], 3);
    if (mixed.join(',') !== 'human,bot,human') throw new Error('a legal roster must pass through unchanged');

    // Winning still scores exactly what it scored before placements existed.
    if (SNLV2_PLACE_FACTOR[1] !== 1) throw new Error('first place must not be scaled');
    if (cnlv2PlacementScore(300, 1) !== 300) throw new Error('first place must score the full base');
    let prev = Infinity;
    for (let place = 1; place <= 6; place++) {
      const v = cnlv2PlacementScore(300, place);
      if (v > prev) throw new Error('place ' + place + ' scored more than place ' + (place - 1));
      if (v < 10) throw new Error('placement score floor breached at place ' + place);
      prev = v;
    }
    if (cnlv2PlacementScore(12, 6) !== 10) throw new Error('the floor must hold for a low base');
    if (cnlv2PlaceLabel(1) !== '1st' || cnlv2PlaceLabel(2) !== '2nd' ||
        cnlv2PlaceLabel(3) !== '3rd' || cnlv2PlaceLabel(4) !== '4th') {
      throw new Error('placement labels wrong');
    }

    // The music turns tense once ANY pawn is past the tense square, and the
    // check is over the whole table, not just the seat that moved.
    if (cnlv2MoodFor([1, 2, 3]) !== 'calm') throw new Error('an early board must stay calm');
    if (cnlv2MoodFor([4, SNLV2_TENSE_SQUARE]) !== 'tense') throw new Error('the tense square itself must trip the mood');
    if (cnlv2MoodFor([0, 0, 96]) !== 'tense') throw new Error('any seat past 80 must trip the mood');
    if (cnlv2MoodFor(null) !== 'calm') throw new Error('an absent board must not throw');
    return true;
  });

  /* Ranked ladder — RP movement has to be symmetric and zero-sum-shaped, or
     a six-player table would inflate or deflate every device that plays one.
     cnlv2ApplyRank is the sole writer of localStorage, so this asserts the
     pure math only and never touches the stored ladder. */
  check('cnlv2-rank-tiers', () => {
    if (SNLV2_RANK_TIERS[0].at !== 0) throw new Error('the first tier must start at 0 RP');
    for (let i = 1; i < SNLV2_RANK_TIERS.length; i++) {
      if (SNLV2_RANK_TIERS[i].at <= SNLV2_RANK_TIERS[i - 1].at) throw new Error('tier thresholds must ascend');
    }
    if (cnlv2Tier(-50).id !== SNLV2_RANK_TIERS[0].id) throw new Error('RP below the floor must read as the first tier');
    if (cnlv2Tier(99999).id !== SNLV2_RANK_TIERS[SNLV2_RANK_TIERS.length - 1].id) throw new Error('a huge RP must read as the top tier');
    if (!cnlv2TierById('rank-gold') || cnlv2TierById('rank-gold').name !== 'Gold') throw new Error('tier lookup by id broken');
    if (!cnlv2TierById('Legend')) throw new Error('tier lookup must also accept a tier name');
    if (cnlv2TierById('nope')) throw new Error('an unknown tier id must resolve to null');

    for (let n = 2; n <= 6; n++) {
      const first = cnlv2RpDelta(1, n);
      const last = cnlv2RpDelta(n, n);
      if (first !== SNLV2_RP_BASE) throw new Error('first place must always pay +' + SNLV2_RP_BASE + ' (n=' + n + ')');
      if (last !== -SNLV2_RP_BASE) throw new Error('last place must always cost -' + SNLV2_RP_BASE + ' (n=' + n + ')');
      let prevD = Infinity;
      for (let place = 1; place <= n; place++) {
        const d = cnlv2RpDelta(place, n);
        if (d >= prevD) throw new Error('RP must fall as placement worsens (n=' + n + ')');
        prevD = d;
      }
      // Symmetric about the middle of the table: placing kth from the top
      // gains exactly what placing kth from the bottom loses.
      for (let place = 1; place <= n; place++) {
        if (cnlv2RpDelta(place, n) !== -cnlv2RpDelta(n + 1 - place, n)) {
          throw new Error('RP is not symmetric (n=' + n + ', place=' + place + ')');
        }
      }
    }
    if (SNLV2_RANKED_MIN_HUMANS < 4) throw new Error('ranked must need at least 4 human seats');
    return true;
  });

  /* Background music — the scheduler runs on a Web Audio clock a check can
     neither hear nor wait for, so the note generator is asserted as the pure
     function it is. A null note is a legal rest; a null LEAD is a silent bar. */
  check('cnlv2-music-loop', () => {
    const moods = Object.keys(CG_LOOP_MOODS);
    if (moods.indexOf('calm') < 0 || moods.indexOf('tense') < 0) throw new Error('both moods must exist');
    if (CG_LOOP_MOODS.tense.bpm <= CG_LOOP_MOODS.calm.bpm) throw new Error('tense must be faster than calm');
    for (const m of moods) {
      let heard = 0;
      for (let step = 0; step < CG_LOOP_STEPS_PER_BAR * 2; step++) {
        const note = cgLoopNoteAt(m, step);
        if (!note) continue;
        if (!(note.lead > 0)) throw new Error(m + ' step ' + step + ' has no lead pitch');
        if (!(note.dur > 0)) throw new Error(m + ' step ' + step + ' has no duration');
        if (!(note.gain > 0)) throw new Error(m + ' step ' + step + ' is silent');
        heard++;
      }
      if (heard < CG_LOOP_STEPS_PER_BAR) throw new Error(m + ' loop is mostly rests');
      // Pure: the same step must always yield the same note, or a mood that
      // survives a bar line would drift out of phase with itself.
      const a = cgLoopNoteAt(m, 3);
      const b = cgLoopNoteAt(m, 3 + CG_LOOP_STEPS_PER_BAR * 2);
      if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m + ' loop is not bar-periodic');
    }
    return true;
  });

  /* A HELD CONTROL MUST STILL BE THERE. tapProps sets [data-pressed] on
     pointerdown and acts on pointerup, so any rule that takes a pressed
     element out of the flow breaks the press outright: it is not under the
     cursor when the finger lifts, and the click lands on whatever slid into
     its place. #173 did exactly that by ending this rule's selector list with
     a comma above .sr-only, which merged the two and clipped every tappable
     control to 1px for the duration of the press. Buttons vanished while held
     and did nothing on release.

     Probing a real pressed element is the only way to see it — the CSS parses,
     the selectors are all spelled correctly, and nothing throws. */
  checkStyled('press-feedback-visible', () => {
    /* MEASURE ABSOLUTELY, NEVER BEFORE-AND-AFTER. A ratio between two reads of
       the same element races anything that can resize it between them — web
       fonts landing is the obvious one, since a text-sized button is exactly
       as wide as its font makes it. A self-test that fires on a slow font load
       is worse than no self-test: it cries wolf on somebody else's machine and
       teaches everyone to ignore it. The failure being caught is unmissable in
       absolute terms (313px -> 1px), so an absolute floor is both sufficient
       and unraceable.

       The positioning lives on a WRAPPER, never on the probe: an inline style
       on the probe outranks the stylesheet, which would mask the very
       declarations under test. */
    const wrap = document.createElement('div');
    wrap.setAttribute('aria-hidden', 'true');
    wrap.style.cssText = 'position:fixed;left:-9999px;top:0;width:200px;height:60px';
    const probe = document.createElement('button');
    probe.className = 'tappable';
    probe.textContent = 'probe';
    wrap.appendChild(probe);
    document.body.appendChild(wrap);
    try {
      const rest = probe.getBoundingClientRect();
      // Cannot measure (detached, display:none, fonts mid-swap) — do not guess.
      if (rest.width < 6 || rest.height < 6) return true;
      probe.setAttribute('data-pressed', '1');
      const cs = getComputedStyle(probe);
      const held = probe.getBoundingClientRect();
      /* Normalise `clip`: an unclipped element computes to "auto" in some
         engines and "rect(auto, auto, auto, auto)" in others, so a literal
         !== 'auto' reports a false failure on whichever engine you did not
         test on. Only a rect with no `auto` in it actually clips. */
      const clip = String(cs.clip || '');
      if (clip.indexOf('rect(') === 0 && clip.indexOf('auto') === -1) {
        throw new Error('a pressed .tappable is clipped (clip: ' + clip + ') — it is being hidden, not highlighted');
      }
      if (held.width < 6 || held.height < 6) {
        throw new Error('a pressed .tappable collapses to ' +
          Math.round(held.width) + 'x' + Math.round(held.height) +
          ' — pointerup will miss it and the tap will not register');
      }
      return true;
    } finally {
      wrap.remove();
    }
  });

  /* #218 — Nonogram validation. These four are the whole reason the win
     notification can be trusted: the banner, the Errors pill, the red clues and
     the mistake counter are all rendered straight off ngValidate, so a wrong
     line state is a wrong message rather than a crash. Cell values are the
     component's: 0 blank, 1 filled, 2 marked empty. */
  check('nonogram-line-state', () => {
    const cases = [
      [[0, 0, 0, 0, 0], [3], 'open'],       // untouched: still reachable
      [[1, 1, 1, 0, 0], [3], 'done'],       // runs match the clue exactly
      [[1, 0, 1, 0, 0], [3], 'open'],       // a blank is not a claim of empty
      [[1, 2, 1, 0, 0], [3], 'error'],      // the mark rules out every run of 3
      [[2, 2, 2, 2, 2], [], 'done'],        // an empty line's clue is 0
      [[1, 1, 1, 1, 0], [3], 'error'],      // four filled can never read as 3
      [[1, 0, 0, 1, 0], [1, 1], 'done'],
    ];
    for (const [cells, clue, want] of cases) {
      const got = ngLineState(cells, clue);
      if (got !== want) {
        throw new Error('ngLineState([' + cells.join(',') + '], [' + clue.join(',') +
          ']) = ' + got + ', expected ' + want);
      }
    }
    return true;
  });

  check('nonogram-validate', () => {
    /* Picture:  ##.     rows [2],[1],[2]
                 .#.     cols [1],[3],[1]      */
    const rowClues = [[2], [1], [2]], colClues = [[1], [3], [1]];
    const solvedGrid = [[1, 1, 2], [2, 1, 2], [2, 1, 1]];
    const a = ngValidate(solvedGrid, rowClues, colClues);
    if (!a.solved || a.errorCount || !a.complete) {
      throw new Error('the solution reads solved=' + a.solved + ' errors=' + a.errorCount);
    }
    if (a.filled !== 5 || a.targetFilled !== 5 || a.doneCount !== 6 || a.lines !== 6) {
      throw new Error('solution counts wrong: filled=' + a.filled + '/' + a.targetFilled +
        ' done=' + a.doneCount + '/' + a.lines);
    }
    // The ?ngfill=wrong shape: the right NUMBER of filled cells, in the wrong
    // places, so `complete` must fire while `solved` must not.
    const wrong = [[2, 1, 1], [2, 1, 2], [2, 1, 1]];
    const b = ngValidate(wrong, rowClues, colClues);
    if (b.solved || !b.complete || b.filled !== 5) {
      throw new Error('full-but-wrong reads solved=' + b.solved + ' complete=' + b.complete);
    }
    if (b.errorCount !== 2) throw new Error('expected 2 dead lines, got ' + b.errorCount);
    // A part-played board is neither.
    const part = ngValidate([[1, 1, 0], [0, 0, 0], [0, 0, 0]], rowClues, colClues);
    if (part.solved || part.complete || part.errorCount) {
      throw new Error('a part-played board must be open');
    }
    return true;
  });

  /* #218 — the geometry used to hard-code 8, so every band above 8x8 drew its
     trailing rows outside the canvas and could not be tapped at all, and 5x5
     hit-tested phantom cells past the edge. Every corner of every band must
     land back on itself, or the win is unreachable rather than unannounced. */
  check('nonogram-board-bounds', () => {
    for (const spec of NG_BANDS) {
      const { rows, cols } = spec;
      const geom = ngGeometry(390, 700, rows, cols, { rowChars: 5, colLines: 4 });
      if (geom.boardX < 0 || geom.boardW > 390) {
        throw new Error(rows + 'x' + cols + ' board is ' + geom.boardW + 'px wide in a 390px frame');
      }
      const corners = [[0, 0], [0, cols - 1], [rows - 1, 0], [rows - 1, cols - 1]];
      for (const [r, c] of corners) {
        const hit = ngCellAt(geom, rows, cols, {
          x: geom.boardX + geom.gutterX + c * geom.cellStep + geom.cell / 2,
          y: geom.boardY + geom.gutterY + r * geom.cellStep + geom.cell / 2,
        });
        if (!hit || hit.r !== r || hit.c !== c) {
          throw new Error(rows + 'x' + cols + ' cell ' + r + ',' + c + ' hit-tests as ' +
            (hit ? hit.r + ',' + hit.c : 'nothing'));
        }
      }
      // And a tap just past the last cell must miss rather than index past the row.
      const past = ngCellAt(geom, rows, cols, {
        x: geom.boardX + geom.gutterX + cols * geom.cellStep + 4,
        y: geom.boardY + geom.gutterY + rows * geom.cellStep + 4,
      });
      if (past) throw new Error(rows + 'x' + cols + ' hit-tests a cell past its own edge');
    }
    return true;
  });

  /* #199 — the same round-trip for Mine Finder, whose bands run 7x7 to 13x13.
     Its geometry and hit test were hardcoded to 9 while the draw loop walked
     the real dimensions, so only the two 9x9 bands worked: 7x7 mapped a tap
     through `r * 9 + c` and revealed the wrong cell, and 11x11 / 13x13 could
     not be tapped past column 8 at all. Every corner of every band has to
     survive geometry -> pixels -> hit test, or the board is unplayable in a
     way no parser and no console error can see. */
  check('minefinder-board-bounds', () => {
    for (const spec of MF_BANDS) {
      const { cols, rows } = spec;
      const geo = mfGeometry(390, 700, cols, rows);
      if (geo.boardX < 0 || geo.boardW > 390) {
        throw new Error(cols + 'x' + rows + ' board is ' + geo.boardW + 'px wide in a 390px frame');
      }
      const corners = [[0, 0], [0, cols - 1], [rows - 1, 0], [rows - 1, cols - 1]];
      for (const [r, c] of corners) {
        const hit = mfCellAt({
          x: geo.boardX + c * geo.cellStep + geo.cell / 2,
          y: geo.boardY + r * geo.cellStep + geo.cell / 2,
        }, geo, cols, rows);
        if (hit !== r * cols + c) {
          throw new Error(cols + 'x' + rows + ' cell ' + r + ',' + c +
            ' hit-tests as index ' + hit + ', expected ' + (r * cols + c));
        }
      }
      // A tap past the last column must MISS, not wrap onto the next row.
      const past = mfCellAt({
        x: geo.boardX + cols * geo.cellStep + 4,
        y: geo.boardY + geo.cell / 2,
      }, geo, cols, rows);
      if (past !== -1) throw new Error(cols + 'x' + rows + ' hit-tests ' + past + ' past its own edge');
      // Every cell the draw loop paints must be reachable by a tap.
      for (let i = 0; i < cols * rows; i++) {
        const r = Math.floor(i / cols), c = i % cols;
        const hit = mfCellAt({
          x: geo.boardX + c * geo.cellStep + geo.cell / 2,
          y: geo.boardY + r * geo.cellStep + geo.cell / 2,
        }, geo, cols, rows);
        if (hit !== i) throw new Error(cols + 'x' + rows + ' cell ' + i + ' is unreachable (got ' + hit + ')');
      }
    }
    return true;
  });

  /* The Filled pill counts against the clue totals, so a board whose row and
     column clues disagree would show a target nobody can reach. Generated
     boards must agree on every band, fallback paths included. */
  check('nonogram-target-filled', () => {
    for (let band = 0; band < NG_BANDS.length; band++) {
      const b = ngBuildForBand(mulberry32(9000 + band * 37), band);
      const rowSum = b.rowClues.reduce((n, cl) => n + cl.reduce((a, v) => a + v, 0), 0);
      const colSum = b.colClues.reduce((n, cl) => n + cl.reduce((a, v) => a + v, 0), 0);
      const actual = b.grid.flat().filter(Boolean).length;
      if (rowSum !== actual || colSum !== actual) {
        throw new Error('band ' + band + ': clues total ' + rowSum + '/' + colSum +
          ' against ' + actual + ' filled cells');
      }
      const solvedGrid = b.grid.map((row) => row.map((v) => (v ? 1 : 2)));
      const v = ngValidate(solvedGrid, b.rowClues, b.colClues);
      if (!v.solved || v.targetFilled !== actual) {
        throw new Error('band ' + band + ' solution reads solved=' + v.solved +
          ' target=' + v.targetFilled + '/' + actual);
      }
    }
    return true;
  });

  // Phase 3 — every daily must opt into the one-viewport column, or it scrolls
  // (or clips) during play. This is the standing guarantee behind the audit.
  // #149 — extended past the FLAG: fitShell without a .fit-col root CLIPS
  // instead of fitting, so when a daily is actually mounted, assert the class
  // is really on the tree. (Real-time dailies that render their own shell are
  // out of scope; every category:'daily' game here uses shell:'daily'.)
  check('registry-fitshell', () => {
    /* #176 — the gate is the SHELL, not the category and not the play mode.
       `fitShell` is read by exactly one renderer, the daily game-wrap, so it is
       every shell:'daily' entry that must set it — that is the same set as
       category:'daily' today, but says why rather than restating the coincidence.

       It is NOT "declares a daily play mode". Seven classics gained a daily in
       #176 and still render through ClassicShell, whose .cg-stage keeps
       .cg-scroll deliberately (an overflow:hidden stage clips a tall setup
       screen instead of fitting it) and whose boards honour the --cg-board
       viewport cap instead. Demanding fitShell of them would demand a flag the
       shell they use never reads. */
    const missing = GAMES.filter(g => g.shell === 'daily' && !g.fitShell).map(g => g.id);
    if (missing.length) throw new Error('dailies missing fitShell: ' + missing.join(', '));
    const wrap = document.querySelector('.game-wrap.fit');
    if (wrap && !wrap.querySelector('.fit-col')) {
      throw new Error('a fitShell daily is mounted with no .fit-col root — it will clip, not fit');
    }
    return true;
  });

  /* #149 — the collapse itself, measured. An auto cross-axis margin opts a
     flex item out of `align-items: stretch`, so a board inside .fit-col
     silently shrank to fit-content (Daily Snake rendered at 16px). Assert the
     mounted board fills its column, up to its own max-width cap. */
  checkStyled('fitcol-fill', () => {
    const col = document.querySelector('.fit-col');
    if (!col) return true; // no daily mounted right now
    const BOARDS = '.sudoku, .wordsearch, .wspr-grid, .dsnk-board';
    const board = col.querySelector(BOARDS);
    if (!board) return true;
    const colW = col.getBoundingClientRect().width;
    if (colW < 40) return true; // laid out off-screen / mid-mount
    const cs = getComputedStyle(board);
    const cap = parseFloat(cs.maxWidth);
    const want = Number.isFinite(cap) ? Math.min(colW, cap) : colW;
    const got = board.getBoundingClientRect().width;
    if (got < want - 4) {
      throw new Error(board.className + ' is ' + Math.round(got) + 'px in a '
        + Math.round(colW) + 'px column (expected ~' + Math.round(want) + 'px)');
    }
    return true;
  });

  /* #167 — the games grid must read as even tiles. Measured, because every way
     this regresses is a layout effect no static scan sees: re-adding
     `align-items: start` to .grid, dropping `grid-auto-rows: 1fr`, an unclamped
     title/blurb, or a footer that forgets `margin-top: auto`. One tolerance of
     1px covers sub-pixel row rounding. */
  checkStyled('grid-uniform-cards', () => {
    const cards = Array.from(document.querySelectorAll('.grid > .card'));
    if (cards.length < 2) return true; // grid not mounted (in a game, or filtered to one)
    const hs = cards.map((c) => c.getBoundingClientRect().height);
    if (Math.max.apply(null, hs) < 40) return true; // laid out off-screen / mid-mount
    const lo = Math.min.apply(null, hs);
    const hi = Math.max.apply(null, hs);
    if (hi - lo > 1) {
      const nameOf = (c) => {
        const n = c.querySelector('.card-name');
        return n ? n.textContent : '?';
      };
      throw new Error('game cards are ragged: ' + Math.round(lo) + 'px ('
        + nameOf(cards[hs.indexOf(lo)]) + ') vs ' + Math.round(hi) + 'px ('
        + nameOf(cards[hs.indexOf(hi)]) + ') across ' + cards.length + ' cards');
    }
    return true;
  });

  /* #182 — the games grid must be at least two-up on a phone. Measured,
     because the regression is arithmetic between two rules that never mention
     each other: .lobby's padding sets the content width, .grid's track floor
     sets how many fit, and a change to either can silently drop the wall back
     to a 30-card single-column scroll. The width guard keeps this quiet on a
     genuinely narrow frame (and while the grid is mid-mount at zero width),
     where one column is the honest answer. */
  checkStyled('grid-two-up', () => {
    const el = document.querySelector('.grid');
    if (!el) return true; // grid not mounted (in a game / on another screen)
    const w = el.getBoundingClientRect().width;
    if (w < 300) return true; // narrower than two 140px tiles + gap, or not laid out yet
    const cols = getComputedStyle(el).gridTemplateColumns;
    const tracks = (cols && cols !== 'none') ? cols.trim().split(/\s+/).length : 0;
    if (tracks < 2) {
      throw new Error('games grid is one column at ' + Math.round(w)
        + 'px wide (grid-template-columns: ' + cols + ')');
    }
    return true;
  });

  /* The static half of grid-two-up: it fires even when the home screen isn't
     mounted, and it names the rule rather than the symptom. Any rule whose
     selector is exactly `.grid` — including inside a @media block — that pins
     the wall to a single track is the #182 regression coming back. */
  check('grid-no-single-column', () => {
    const bad = [];
    // Selector must be EXACTLY `.grid`: preceded by start-of-file, `}` or a
    // media block's `{`, so `.fit-col .grid` or `.grid > .card` don't match.
    const re = /(?:^|[{}])\s*\.grid\s*\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(css))) {
      const body = m[1];
      const gm = /(^|[;\s])grid-template-columns\s*:([^;]+)/.exec(body);
      if (!gm) continue;
      const value = gm[2].trim();
      if (countTracks(value) < 2) bad.push('grid-template-columns: ' + value);
    }
    if (bad.length) {
      throw new Error('.grid pinned to a single column by: ' + bad.join(' | '));
    }
    return true;
  });

  /* #149, statically — fires even for a game that isn't mounted. A board rule
     that sets an auto SIDE margin without a definite width is the bug class;
     inside .fit-col that always collapses the board. */
  check('fitcol-auto-margin', () => {
    const BOARDS = ['sudoku', 'wordsearch', 'wspr-grid', 'dsnk-board'];
    const bad = [];
    for (const cls of BOARDS) {
      // Grab the .fit-col-scoped rule bodies for this class.
      const re = new RegExp('\\.fit-col[^{}]*\\.' + cls + '\\b[^{}]*\\{([^}]*)\\}', 'g');
      let m, sawRule = false;
      while ((m = re.exec(css))) {
        sawRule = true;
        const body = m[1];
        /* A DEFINITE width is what re-enables stretch. Read the declared value
           and compare it, rather than a `(?!auto)` lookahead — `\s*` backtracks
           to zero width there, so `width: auto` would slip past and make this
           whole check vacuous. `max-width` is not matched: the char before
           `width` must be `;`/whitespace/start, never `-`. */
        let hasWidth = false, wm;
        const wre = /(^|[;\s])width\s*:([^;]+)/g;
        while ((wm = wre.exec(body))) {
          if (wm[2].trim().toLowerCase() !== 'auto') hasWidth = true;
        }
        const autoSide = /(^|[;\s])margin\s*:[^;]*\bauto\b/.test(body)
          || /margin-(left|right|inline-start|inline-end|inline)\s*:\s*auto/.test(body);
        if (autoSide && !hasWidth) bad.push('.fit-col .' + cls);
      }
      if (!sawRule) bad.push('.fit-col .' + cls + ' (no fit-col override at all)');
    }
    if (bad.length) throw new Error('auto side margin without a definite width: ' + bad.join(', '));
    return true;
  });

  /* #149 — the CSS half of the token mistake guardCanvasCtx catches on canvas.
     `C.x` is the string 'var(--c-x)', so `${C.gold}22` emits `var(--c-gold)22`,
     which is invalid and computes to transparent. Use ca('gold','22') instead.
     This caught three dead Ludo seat-3 tints. */
  check('token-alpha-concat', () => {
    const bad = [];
    const re = /var\(--c-[a-z0-9-]+\)([0-9a-fA-F]{2,8})\b/g;
    let m;
    while ((m = re.exec(css))) {
      const at = Math.max(0, m.index - 60);
      bad.push(css.slice(at, m.index + m[0].length).split('\n').pop().trim());
    }
    if (bad.length) {
      throw new Error('hex alpha concatenated onto a var() token (use ca()): ' + bad.join(' | '));
    }
    return true;
  });

  /* #150 — navState is JSON.stringify'd every render, so ONE non-primitive
     field (a SyntheticEvent handed to backToLobby as `tab`) threw
     "Converting circular structure to JSON" and unmounted the whole root.
     This is the mechanical form of that invariant: navPrimitive must reject
     everything a serializer can choke on. */
  check('nav-state-primitives', () => {
    const el = document.createElement('button');
    const circular = { self: null }; circular.self = circular;
    for (const hostile of [el, circular, { a: 1 }, [1, 2], () => {}, Symbol('x')]) {
      if (navPrimitive(hostile) !== null) {
        throw new Error('navPrimitive let through ' + typeof hostile);
      }
    }
    for (const ok of ['home', 7, true, false]) {
      if (navPrimitive(ok) !== ok) throw new Error('navPrimitive dropped a primitive: ' + String(ok));
    }
    if (navPrimitive(null) !== null || navPrimitive(undefined) !== null) {
      throw new Error('navPrimitive must map null/undefined to null');
    }
    // And the whole shape must survive a round-trip.
    JSON.stringify({ screen: navPrimitive(el), lobbyTab: navPrimitive('home') });
    return true;
  });

  /* Phase 2 (#163) — a tappable class that isn't covered pays the browser's
     double-tap delay on every tap. The probe list is TAPPABLE_CLASSES itself,
     the same array the CSS is generated from, so the test and the stylesheet
     can no longer drift (the old hand-copied list omitted 8 classes the CSS
     covered). Each failure now says WHETHER the rule exists in `css`, which is
     what separates "someone deleted a class" from "the sheet isn't applying". */
  checkStyled('registry-touch-action', () => {
    const probe = tapActionProbe();
    const bad = [];
    try {
      // Defensive re-read of the canary: styleOk gated on it a moment ago, but
      // a sheet can be swapped between checks. One honest line, not N phantoms.
      if (probe.read(TAP_CANARY_CLASS) === 'auto') {
        throw new Error('stylesheet-not-applied — the .' + TAP_CANARY_CLASS +
          ' canary reads auto, so the per-class sweep was skipped (' +
          describeAppStylesheet() + ')');
      }
      for (const cls of TAPPABLE_CLASSES) {
        if (probe.read(cls) !== 'auto') continue;
        const declared = css.indexOf('.' + cls + ' { touch-action') >= 0;
        bad.push(cls + (declared ? ' (rule emitted, not applied)' : ' (NO RULE EMITTED)'));
      }
    } finally { probe.destroy(); }
    if (bad.length) throw new Error('touch-action:auto on ' + bad.join(', '));
    return true;
  });

  /* The generator's own contract: every probed class must actually produce a
     rule in `css`. A static check, so it fails even when the sheet is dead —
     it is what proves TAPPABLE_CLASSES and the emitted CSS are the same list. */
  check('touch-action-rules-emitted', () => {
    const missing = TAPPABLE_CLASSES
      .filter((c) => css.indexOf('.' + c + ' { touch-action: manipulation; }') < 0);
    if (missing.length) {
      throw new Error('TAPPABLE_CLASSES entries with no emitted rule: ' + missing.join(', '));
    }
    if (css.indexOf('.' + TAP_CANARY_CLASS + ' { touch-action: manipulation; }') < 0) {
      throw new Error('the ' + TAP_CANARY_CLASS + ' canary rule is not emitted');
    }
    return true;
  });

  /* #176 — the home grid is a walk over GAME_CARDS, so a card that names an
     id the registry does not have would silently drop that game from the grid
     entirely (the walk emits nothing, and there is no fallback card). This
     also guards the four merged cards, whose whole point is that two registry
     ids share one card without either id moving. */
  check('registry-cards', () => {
    const ids = new Set(GAMES.map(g => g.id));
    const seen = new Set();
    for (const c of GAME_CARDS) {
      if (ids.has(c.key)) throw new Error('card key collides with a game id: ' + c.key);
      if (!c.modes.length) {
        if (!c.gameId || !ids.has(c.gameId)) throw new Error(c.key + ' has no modes and no valid gameId');
        continue;
      }
      for (const m of c.modes) {
        if (!isPlayMode(m.mode)) throw new Error(c.key + ' → unknown play mode ' + m.mode);
        if (!ids.has(m.gameId)) throw new Error(c.key + ' → unknown game ' + m.gameId);
        if (!supportsMode(m.gameId, m.mode)) {
          throw new Error(c.key + ': ' + m.gameId + ' does not declare ' + m.mode);
        }
        const key = m.gameId + ':' + m.mode;
        if (seen.has(key)) throw new Error('mode listed on two cards: ' + key);
        seen.add(key);
      }
    }
    // Every declared mode must reach the grid, or it is unplayable.
    for (const id of Object.keys(PLAY_MODES_BY_ID)) {
      if (!ids.has(id)) throw new Error('PLAY_MODES_BY_ID names unknown game ' + id);
      for (const mode of playModesFor(id)) {
        if (!seen.has(id + ':' + mode)) throw new Error('no card surfaces ' + id + ':' + mode);
      }
    }
    // And every registry entry must have an opinion, so a new game cannot be
    // added without deciding what it offers.
    const undeclared = GAMES.filter(g => !Object.prototype.hasOwnProperty.call(PLAY_MODES_BY_ID, g.id));
    if (undeclared.length) {
      throw new Error('games missing from PLAY_MODES_BY_ID: ' + undeclared.map(g => g.id).join(', '));
    }
    return true;
  });

  // Phase 7 — the rules registry must be reachable from the browser now that
  // local/bot modes share it with the server.
  check('board-rules', () => {
    if (!window.boardRules) return true; // script not loaded (standalone) — skip
    return window.boardRules.selfTest() === true;
  });

  /* #210 — the Tile Match board's FOOTPRINT belongs to the deal, not to what
     is still on it. `tmGeom` used to measure the live subset, so clearing a
     column shrank the canvas and dragged the tile holder up underneath it.
     Functional, so it fails whether or not the game is mounted. */
  check('tilematch-board-anchor', () => {
    if (typeof tmExtent !== 'function' || typeof tmGeom !== 'function') return true;
    const tiles = [];
    let id = 0;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
      tiles.push({ id: id++, col: c, row: r, layer: 0, type: (r * 6 + c) % 3, removed: false, inBar: false });
    }
    const fresh = tmExtent(tiles);
    if (fresh.maxC !== 5 || fresh.maxR !== 3) {
      throw new Error('tmExtent read ' + fresh.maxC + 'x' + fresh.maxR + ' of a 6x4 deal');
    }
    const before = tmGeom(360, 400, fresh, false);
    // Clear the entire right column and bottom row — the worst case for a
    // live-subset measurement, and the exact shape players reported.
    const played = tiles.map((t) => ({ ...t,
      removed: t.col === 5 || t.row === 3,
      inBar: t.col === 4 && t.row === 0 }));
    const after = tmExtent(played);
    if (after.maxC !== fresh.maxC || after.maxR !== fresh.maxR) {
      throw new Error('extents moved after clearing: ' + fresh.maxC + 'x' + fresh.maxR
        + ' -> ' + after.maxC + 'x' + after.maxR);
    }
    const geo = tmGeom(360, 400, after, false);
    if (geo.bw !== before.bw || geo.bh !== before.bh || geo.ox !== before.ox || geo.step !== before.step) {
      throw new Error('board geometry moved after clearing: ' + JSON.stringify(before)
        .slice(0, 80) + ' -> step ' + geo.step + ' ox ' + geo.ox + ' ' + geo.bw + 'x' + geo.bh);
    }
    // And the deep-link clearer must not move it either.
    if (typeof tmClearSome === 'function') {
      const cut = tmExtent(tmClearSome(tiles, 9));
      if (cut.maxC !== fresh.maxC || cut.maxR !== fresh.maxR) {
        throw new Error('tmClearSome moved the extents to ' + cut.maxC + 'x' + cut.maxR);
      }
    }
    return true;
  });

  /* #210 — the 7-slot tile holder must fit the frame it is drawn in at every
     width the fleet actually sees. It was a hardcoded 44px slot with a 6px
     gap (344px), so on a phone it hung off both edges and its left origin
     went negative. Swept, because one device width proves nothing. */
  check('tilematch-tray-fits', () => {
    if (typeof tmTrayGeom !== 'function') return true;
    const bad = [];
    for (let w = 240; w <= 560; w += 4) {
      const t = tmTrayGeom(w, 50);
      if (t.totalW > w - 8 || t.x0 < 4 || t.slotW < 12 || t.slotH < 8) {
        bad.push(w + 'px -> ' + t.totalW + 'px tray at x' + t.x0);
      }
    }
    if (bad.length) throw new Error('tile holder does not fit: ' + bad.slice(0, 4).join(', '));
    // The mounted frame publishes the same answer for its measured width.
    const box = document.querySelector('.tm-board-box[data-tm-tray-fits]');
    if (box && box.getAttribute('data-tm-tray-fits') === '0') {
      throw new Error('mounted tile holder is ' + box.getAttribute('data-tm-tray-w')
        + 'px in a ' + Math.round(box.getBoundingClientRect().width) + 'px frame');
    }
    return true;
  });

  /* #331 — the daily's Easy/Hard mix the day anchor per (game, band), but
     Normal must hash to EXACTLY the pre-band seed: every existing daily board,
     resume record and tier-A replay is keyed to it, so a divergent Normal
     stream would silently deal every existing player a different board. The
     games list spans both seed shapes (server-issued and legacy-derived) and
     offsets vary so no single lucky pair can pass. */
  check('daily-band-normal-unchanged', () => {
    if (typeof dailyRng !== 'function') return true;
    const games = ['sudoku', 'wordsearch', 'cryptowordle', 'tilematchingdaily',
      'klondike', 'cratepush', 'zuma', 'snakedaily', 'bouncedaily', '2048', 'wordsprint'];
    for (const g of games) {
      for (let off = 0; off < 5; off++) {
        const base = dailyRng(off, g);
        const normal = dailyRng(off, g, 'normal');
        const normalNull = dailyRng(off, g, null);
        for (let i = 0; i < 4; i++) {
          const b = base(), n = normal(), nn = normalNull();
          if (b !== n || b !== nn) {
            throw new Error("dailyRng(" + off + ", '" + g + "') diverges from its " +
              'Normal-band stream — Normal must stay byte-identical to the pre-band seed');
          }
        }
        // And Easy/Hard must be three DIFFERENT boards off the same anchor —
        // fresh rngs each, so the comparison is first-draw to first-draw.
        const a = dailyRng(off, g)(), e = dailyRng(off, g, 'easy')(), h = dailyRng(off, g, 'hard')();
        if (!(a !== e && a !== h && e !== h)) {
          throw new Error("bands of '" + g + "' on offset " + off + ' share a stream');
        }
      }
    }
    return true;
  });

  /* #210, the CSS half, measured. `.tm-wrap` sits in `.cg-stage`, which is
     `align-items: center`, so without a definite width it took its
     fit-content width — the canvas's own CSS width, which useCanvasBoard
     writes back from the measured box. That loop settles at the UA's default
     300px canvas on every device, whatever the screen. */
  checkStyled('tilematch-canvas-fills', () => {
    const wrap = document.querySelector('.tm-wrap');
    const parent = wrap && wrap.parentElement;
    if (!parent) return true; // Tile Match not mounted
    const pcs = getComputedStyle(parent);
    const avail = parent.clientWidth
      - (parseFloat(pcs.paddingLeft) || 0) - (parseFloat(pcs.paddingRight) || 0);
    if (avail < 40) return true; // laid out off-screen / mid-mount
    const cap = parseFloat(getComputedStyle(wrap).maxWidth);
    const want = Number.isFinite(cap) ? Math.min(avail, cap) : avail;
    const got = wrap.getBoundingClientRect().width;
    if (got < want - 4) {
      throw new Error('.tm-wrap is ' + Math.round(got) + 'px inside '
        + Math.round(avail) + 'px (expected ~' + Math.round(want) + 'px)');
    }
    const box = wrap.querySelector('.tm-board-box');
    const canvas = box && box.querySelector('canvas.tm-canvas');
    if (!canvas) return true;
    const bw = box.getBoundingClientRect().width;
    const cw = canvas.getBoundingClientRect().width;
    if (bw >= 40 && cw < bw - 4) {
      throw new Error('the Tile Match canvas is ' + Math.round(cw) + 'px in a '
        + Math.round(bw) + 'px frame');
    }
    return true;
  });

  /* Safe-area audit, the static half. Inside the platform frame every bare
     env(safe-area-inset-*) resolves to 0px, so a rule that reads it directly
     is dead chrome: bottom bars sit under the home indicator and overlays run
     under the notch. The platform forwards the real values on <html> as
     --un-safe-inset-*, so each app rule must reach it through the
     var(--un-safe-inset-…, env(…)) form. The one legal bare env() is an app
     rule's OWN fallback inside that var(); reading it any other way is the
     regression this check exists to catch. */
  check('safe-area-env-wrapped', () => {
    const bad = [];
    const re = /env\(\s*safe-area-inset-[a-z]+\s*[,)]/g;
    let m;
    while ((m = re.exec(css))) {
      // Allow only the forwarded form: the env() must sit inside a var()
      // whose first argument is --un-safe-inset-*.
      const before = css.slice(Math.max(0, m.index - 40), m.index);
      if (/var\(\s*--un-safe-inset-[a-z]+\s*,\s*$/.test(before)) continue;
      bad.push(css.slice(Math.max(0, m.index - 50), m.index + m[0].length)
        .split('\n').pop().trim());
    }
    if (bad.length) {
      throw new Error('bare env(safe-area-inset-*) is inert inside the app '
        + 'frame — reach it through var(--un-safe-inset-…, env(…)): '
        + bad.join(' | '));
    }
    return true;
  });

  /* Safe-area audit, the measured half. The tokens must actually RESOLVE: a
     typo in the fallback chain leaves them as an invalid value, which makes
     every calc() that mentions them collapse to 0 and silently drops the
     inset rather than failing. Read the computed values on a probe element
     that sets padding-bottom from the token, and require a length, not the
     empty string an unresolved var() computes to. */
  checkStyled('safe-tokens-resolve', () => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;'
      + 'padding-bottom:calc(1px + var(--pc-safe-bottom));'
      + 'padding-top:calc(1px + var(--pc-safe-top));';
    document.body.appendChild(probe);
    try {
      const cs = getComputedStyle(probe);
      const pb = parseFloat(cs.paddingBottom);
      const pt = parseFloat(cs.paddingTop);
      if (!Number.isFinite(pb) || !Number.isFinite(pt)) {
        throw new Error('--pc-safe-bottom / --pc-safe-top did not resolve '
          + '(padding-bottom=' + cs.paddingBottom + ', padding-top=' + cs.paddingTop + ')');
      }
      if (pb < 1 || pt < 1) {
        throw new Error('the safe-area token calc collapsed below its fixed term: '
          + 'padding-bottom=' + pb + ', padding-top=' + pt);
      }
    } finally {
      probe.remove();
    }
    return true;
  });

  if (fails.length) {
    console.error('[self-test] client self-tests FAILED:\n  ' + fails.join('\n  '));
    return false;
  }
  console.log('[self-test] client self-tests passed (' + ran + ' checks)');
  return true;
}

// Pointer gestures over a board element, reported in element-local CSS pixels.
// onTap fires on release; onLongPress fires while the finger is still down
// (so the release that follows is suppressed); onDrag streams while moving.
function usePointerCell(ref, handlers, { longPressMs = 450, moveTolerance = 10 } = {}) {
  const h = useRef(handlers);
  h.current = handlers;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer = null, startX = 0, startY = 0, moved = false, fired = false, active = false;
    const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
    const local = (e) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onDown = (e) => {
      if (e.button != null && e.button !== 0 && e.pointerType === 'mouse') return;
      active = true; moved = false; fired = false;
      startX = e.clientX; startY = e.clientY;
      const p = local(e);
      if (el.setPointerCapture && e.pointerId != null) {
        try { el.setPointerCapture(e.pointerId); } catch {}
      }
      if (h.current.onDown) h.current.onDown(p, e);
      clear();
      if (h.current.onLongPress) {
        timer = setTimeout(() => {
          timer = null;
          if (!moved && active) { fired = true; cgHaptic(12); h.current.onLongPress(p, e); }
        }, longPressMs);
      }
    };
    const onMove = (e) => {
      if (!active) return;
      if (Math.abs(e.clientX - startX) > moveTolerance || Math.abs(e.clientY - startY) > moveTolerance) {
        moved = true;
        clear();
      }
      if (h.current.onDrag) h.current.onDrag(local(e), { dx: e.clientX - startX, dy: e.clientY - startY, moved }, e);
    };
    const onUp = (e) => {
      if (!active) return;
      active = false;
      clear();
      const p = local(e);
      if (h.current.onUp) h.current.onUp(p, e);
      if (!fired && !moved && h.current.onTap) h.current.onTap(p, e);
    };
    const onCancel = () => { active = false; clear(); };
    const onCtx = (e) => {
      if (!h.current.onContext) return;
      e.preventDefault();
      clear();
      fired = true;
      h.current.onContext(local(e), e);
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    el.addEventListener('contextmenu', onCtx);
    return () => {
      clear();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      el.removeEventListener('contextmenu', onCtx);
    };
  }, [ref, longPressMs, moveTolerance]);
}

/* ================= cui — the canvas control kit (controls wave) =============
   Draws the in-frame chrome — status pills, buttons, key grids — INTO a
   game's canvas, so a running game is one uninterrupted surface. Every drawn
   control is backed by a REAL, visually-hidden DOM twin (<CuiTwin/>): screen
   readers, hardware focus and innerText-based checks keep working, because
   .sr-only clips the box without unrendering the text. Menus, sheets,
   overlays, hint paragraphs and scroll-away content lists stay DOM on
   purpose — they are prose or navigation, not play-surface controls.

   A game builds `controls` fresh each render (geometry from its fit box):
     { id, kind: 'pill' | 'button' | 'label',
       r: [x, y, w, h], label, value, sub, gold, mono, font,
       primary, on, solid, disabled, action }
   and threads the SAME array through three places:
     draw:    cuiDrawControls(ctx, controls, pressedId)
     pointer: usePointerCell(ref, cuiWrapHandlers(ctlRef, setPressed, boardHandlers))
     JSX:     <CuiTwin controls={controls} />                                 */
const CUI_FONT = "'Space Grotesk', system-ui, sans-serif";
const CUI_MONO = "'JetBrains Mono', monospace";

function cuiInRect(r, x, y) { return x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3]; }

function cuiHitAt(controls, x, y) {
  for (let i = controls.length - 1; i >= 0; i--) {
    const c = controls[i];
    if (c.action && !c.disabled && cuiInRect(c.r, x, y)) return c;
  }
  return null;
}

// Split a horizontal band into n equal rects with a gap — the .status-bar /
// button-row layout, minus the DOM.
function cuiRow(x, y, w, h, n, gap = 8) {
  const cw = (w - gap * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => [x + i * (cw + gap), y, cw, h]);
}

// The .pill look: card capsule, uppercase muted label over a mono value.
function cuiDrawPill(ctx, c) {
  const [x, y, w, h] = c.r;
  klRR(ctx, x, y, w, h, 10);
  ctx.fillStyle = PAL.card;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = PAL.border;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '600 9px ' + CUI_FONT;
  ctx.fillStyle = PAL.muted;
  ctx.fillText(String(c.label || '').toUpperCase(), x + w / 2, y + h * 0.4, w - 8);
  ctx.font = '600 ' + Math.max(13, Math.round(h * 0.34)) + 'px ' + CUI_MONO;
  ctx.fillStyle = c.color || (c.gold ? PAL.gold : PAL.text);
  ctx.fillText(String(c.value != null ? c.value : ''), x + w / 2, y + h * 0.85, w - 8);
}

// The .p6-btn look (card + border, accent tint when primary/on, solid accent
// for the one big CTA), with the pressed state drawn since :active can't be.
function cuiDrawButton(ctx, c, pressed) {
  const [x, y, w, h] = c.r;
  ctx.save();
  if (c.disabled) ctx.globalAlpha = 0.4;
  klRR(ctx, x, y, w, h, c.radius != null ? c.radius : Math.min(12, h * 0.3));
  ctx.fillStyle = c.bg ? c.bg : (c.solid ? palOf(C.accent, '#3A6ECD') : PAL.card);
  ctx.fill();
  if ((c.primary || c.on) && !c.solid && !c.bg) {
    ctx.save(); ctx.globalAlpha *= 0.14; ctx.fillStyle = palOf(C.accent, '#3A6ECD'); ctx.fill(); ctx.restore();
  }
  if (pressed && !c.disabled) {
    ctx.save(); ctx.globalAlpha *= 0.18; ctx.fillStyle = '#000'; ctx.fill(); ctx.restore();
  }
  if (!c.noBorder) {
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = (c.primary || c.on || c.solid) ? palOf(C.accent, '#3A6ECD') : PAL.border;
    ctx.stroke();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fs = c.font || Math.min(15, Math.max(12, Math.round(h * 0.3)));
  ctx.font = '600 ' + fs + 'px ' + (c.mono ? CUI_MONO : CUI_FONT);
  ctx.fillStyle = c.ink || (c.solid ? '#fff' : PAL.text);
  if (c.pips) {
    /* Die face: 3x3 pip grid (row-major booleans) instead of the label text.
       `c.spin` = { p, blur } turns the same grid into a throw: the face
       tumbles (a rotation about the button's centre, so it reads as a die
       turning over rather than a number swapping) and two ghost copies are
       stamped either side of it for motion blur. Both decay to nothing at
       p = 1, so a settled die is byte-identical to the static draw and a
       caller that passes no `spin` sees no change at all. */
    const pr = Math.max(2, Math.min(w, h) * 0.075);
    const face = () => {
      for (let i = 0; i < 9; i++) {
        if (!c.pips[i]) continue;
        const px = x + w * (0.28 + 0.22 * (i % 3));
        const py = y + h * (0.28 + 0.22 * Math.floor(i / 3));
        ctx.beginPath();
        ctx.arc(px, py, pr, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    const sp = c.spin;
    if (sp && sp.blur > 0.05) {
      const cx = x + w / 2;
      const cy = y + h / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((1 - sp.p) * Math.PI * 0.55);
      ctx.translate(-cx, -cy);
      ctx.save();
      ctx.globalAlpha *= 0.3;
      ctx.translate(-sp.blur, 0); face();
      ctx.translate(sp.blur * 2, 0); face();
      ctx.restore();
      face();
      ctx.restore();
    } else {
      face();
    }
  } else {
    ctx.fillText(String(c.label != null ? c.label : ''), x + w / 2, c.sub ? y + h / 2 - fs * 0.42 : y + h / 2 + 0.5, w - 10);
  }
  if (c.sub) {
    ctx.font = '500 ' + Math.max(9, Math.round(fs * 0.72)) + 'px ' + CUI_FONT;
    ctx.fillStyle = c.solid ? 'rgba(255,255,255,0.85)' : PAL.muted;
    ctx.fillText(String(c.sub), x + w / 2, y + h / 2 + fs * 0.58, w - 10);
  }
  ctx.restore();
}

// Plain centred text (the brg-note / warn-line role).
function cuiDrawLabel(ctx, c) {
  const [x, y, w, h] = c.r;
  ctx.font = (c.bold ? '700 ' : '') + (c.font || 12) + 'px ' + (c.mono ? CUI_MONO : CUI_FONT);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = c.color || (c.gold ? PAL.gold : PAL.muted);
  ctx.fillText(String(c.label != null ? c.label : ''), x + w / 2, y + h / 2, w - 4);
}

/* A progress meter: a track with a fill, `p` in 0..1. Colours resolve at DRAW
   time from PAL (never from a colour captured in build()), so a theme flip
   repaints it correctly — the same rule the canvas palette note in CLAUDE.md
   states. `done` swaps accent for emerald: a bar that has reached its goal
   should say so without needing a second label to explain it. */
function cuiDrawMeter(ctx, c) {
  const [x, y, w, h] = c.r;
  const p = Math.max(0, Math.min(1, Number(c.p) || 0));
  const r = Math.min(h / 2, 6);
  const path = (px, py, pw, ph) => {
    ctx.beginPath();
    if (pw <= 0) return;
    if (ctx.roundRect) { ctx.roundRect(px, py, pw, ph, Math.min(r, pw / 2)); return; }
    const rr = Math.min(r, pw / 2, ph / 2);
    ctx.moveTo(px + rr, py);
    ctx.arcTo(px + pw, py, px + pw, py + ph, rr);
    ctx.arcTo(px + pw, py + ph, px, py + ph, rr);
    ctx.arcTo(px, py + ph, px, py, rr);
    ctx.arcTo(px, py, px + pw, py, rr);
    ctx.closePath();
  };
  path(x, y, w, h);
  ctx.fillStyle = PAL.well || PAL.card;
  ctx.fill();
  const fw = Math.round(w * p);
  if (fw > 0) {
    path(x, y, fw, h);
    ctx.fillStyle = c.done ? PAL.emerald : PAL.accent;
    ctx.fill();
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = PAL.border;
  path(x, y, w, h);
  ctx.stroke();
}

function cuiDrawControls(ctx, controls, pressedId) {
  for (const c of controls) {
    if (c.noDraw) continue; // twin-only entry (prose the draw pass renders itself)
    if (c.kind === 'pill') cuiDrawPill(ctx, c);
    else if (c.kind === 'meter') cuiDrawMeter(ctx, c);
    else if (c.kind === 'label') cuiDrawLabel(ctx, c);
    else cuiDrawButton(ctx, c, pressedId === c.id);
  }
}

// Wrapped prose on canvas (clue lines): naive word wrap via measureText.
function cuiWrapText(ctx, text, x, y, maxW, lineH, maxLines) {
  const words = String(text).split(/\s+/);
  let line = '', lines = [];
  for (const w of words) {
    const probe = line ? line + ' ' + w : w;
    if (ctx.measureText(probe).width > maxW && line) { lines.push(line); line = w; }
    else line = probe;
  }
  if (line) lines.push(line);
  if (maxLines && lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] += '…';
  }
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineH));
  return lines.length;
}

/* Route the pointer stream: controls first (press feedback on finger-DOWN,
   action on the release, exactly tapProps' contract), board handlers only
   when no control claims the point. `ctlRef.current` must always hold the
   render's live controls array. */
function cuiWrapHandlers(ctlRef, setPressed, h = {}) {
  return {
    ...h,
    onDown: (p, e) => {
      const c = cuiHitAt(ctlRef.current || [], p.x, p.y);
      if (c) {
        ctlRef.pressed = c.id;
        setPressed(c.id);
        cgHaptic(8);
        if (c.holdDown) c.holdDown(); // hold-to-act controls (D-pads) engage on DOWN
        return;
      }
      if (h.onDown) h.onDown(p, e);
    },
    onDrag: (p, d, e) => {
      if (ctlRef.pressed) {
        // A hold control releases if the finger slides off it (the DOM
        // pointerleave contract) — capture means leave never fires.
        const c = (ctlRef.current || []).find(x => x.id === ctlRef.pressed);
        if (c && c.holdDown && !cuiInRect(c.r, p.x, p.y)) {
          if (c.holdUp) c.holdUp();
          ctlRef.pressed = null;
          setPressed(null);
        }
        return;
      }
      if (h.onDrag) h.onDrag(p, d, e);
    },
    onUp: (p, e) => {
      // A control fires on press + release-in-rect (the DOM button contract),
      // NOT via onTap — a board's tight moveTolerance would otherwise eat
      // slightly-jittery finger taps on buttons.
      if (ctlRef.pressed) {
        const c = (ctlRef.current || []).find(x => x.id === ctlRef.pressed);
        ctlRef.pressed = null;
        setPressed(null);
        if (c && c.holdDown) { if (c.holdUp) c.holdUp(); return; }
        if (c && !c.disabled && c.action && cuiInRect(c.r, p.x, p.y)) c.action();
        return;
      }
      if (h.onUp) h.onUp(p, e);
    },
    onTap: (p, e) => {
      if (cuiHitAt(ctlRef.current || [], p.x, p.y)) return; // fired in onUp
      if (h.onTap) h.onTap(p, e);
    },
    onLongPress: h.onLongPress ? (p, e) => {
      if (cuiHitAt(ctlRef.current || [], p.x, p.y)) return;
      h.onLongPress(p, e);
    } : undefined,
    onContext: h.onContext ? (p, e) => {
      if (cuiHitAt(ctlRef.current || [], p.x, p.y)) return;
      h.onContext(p, e);
    } : undefined,
  };
}

/* A self-contained control STRIP on its own canvas — for games whose board
   canvas is a hand-rolled real-time loop (Daily Snake/Bounce, the classic
   arcade games) where splicing bands into the loop would be surgery. The
   strip draws pills/labels/buttons, wires presses, and carries its twin;
   stacked over the board canvas it reads as one surface. */
function CuiBar({ height, build }) {
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const { boxW } = useFitBox(boxRef, { cols: 1, rows: 1, maxCell: 100000 });
  const W = Math.floor(boxW);
  const controls = W > 40 ? build(W) : [];
  const ctlRef = useRef([]);
  ctlRef.current = controls;
  const [pressedId, setPressedId] = useState(null);
  usePointerCell(canvasRef, cuiWrapHandlers(ctlRef, setPressedId, {}));
  // Redraw key = the controls' FULL visual state (functions dropped): a change
  // to only sub/color/bg/solid or a rect must repaint even with labels constant.
  const key = JSON.stringify(controls, (k, v) => (typeof v === 'function' ? undefined : v));
  useCanvasBoard(canvasRef, {
    width: W,
    height,
    deps: [key, W, height, pressedId],
    draw: (ctx) => cuiDrawControls(ctx, ctlRef.current, pressedId),
  });
  return (
    <div className="cui-bar" ref={boxRef}>
      <canvas ref={canvasRef} className="cui-bar-canvas" aria-hidden="true" />
      <CuiTwin controls={controls} />
    </div>
  );
}

// Shift a board's pointer handlers below the frame's top bands: the handlers
// keep their own coordinate space (verbatim code), the frame subtracts its
// band height once here. topRef.current = the board region's y offset.
function cuiShiftHandlers(h, topRef) {
  const out = {};
  for (const k of Object.keys(h)) {
    const fn = h[k];
    if (typeof fn !== 'function') continue;
    out[k] = (pt, a, b) => fn({ x: pt.x, y: pt.y - (topRef.current || 0) }, a, b);
  }
  return out;
}

// The accessibility twin: real buttons and live text, visually clipped. One
// per game frame, fed the same controls array the canvas drew.
function CuiTwin({ controls, extra }) {
  return (
    <div className="cui-twin sr-only">
      {controls.map((c) => (
        // One block per control so innerText keeps line breaks between them.
        <div key={c.id}>
          {c.action ? (
            <button
              type="button"
              disabled={!!c.disabled}
              aria-pressed={c.on != null ? !!c.on : undefined}
              onClick={() => { if (!c.disabled) c.action(); }}
            >{String(c.twinLabel != null ? c.twinLabel : (c.label != null ? c.label : c.id)) + (c.sub ? ' — ' + c.sub : '') + (c.value != null ? ' ' + c.value : '')}</button>
          ) : (
            <span>{((c.twinLabel != null ? String(c.twinLabel) : (c.label != null ? String(c.label) : '')) + ' ' + (c.value != null ? c.value : '')).trim()}</span>
          )}
        </div>
      ))}
      {extra || null}
    </div>
  );
}
