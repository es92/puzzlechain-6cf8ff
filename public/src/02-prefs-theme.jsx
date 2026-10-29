
/* ============================================================
   Classic Games shared subsystems — prefs, sound, haptics, gestures
   ============================================================ */
const CG_SOUND_KEY   = 'puzzlechain_cg_sound';
const CG_HAPTICS_KEY = 'puzzlechain_cg_haptics';
const CG_MOTION_KEY  = 'puzzlechain_cg_motion';
/* #192 — which keyboard a word game types with. Device-local like every other
   pref here, and OFF by default: the drawn keyboard is the only surface that
   carries the per-letter state (which letters are placed, which are spent), so
   turning it off is a real trade and belongs to the player rather than to a
   silent default. Flipping this default is one word if the group wants it. */
const CG_DEVKBD_KEY  = 'puzzlechain_cg_devkbd';
/* Background DJ music. OFF by default, deliberately: only a stored '1' means
   on, the same shape as devkbd. A beat that starts on its own is intrusive in
   public, on a call or in class, and the games that are silent today should
   stay that way until the player asks. The volume is a number, so it has its
   own key and setter (cgSetPref only writes '1'/'0'). */
const CG_MUSIC_KEY   = 'puzzlechain_cg_music';
const CG_MUSIC_VOLUME_KEY = 'puzzlechain_cg_music_volume';
const CG_MUSIC_VOLUME_DEFAULT = 60;
const PREF_KEYS = {
  sound: CG_SOUND_KEY, haptics: CG_HAPTICS_KEY, motion: CG_MOTION_KEY, devkbd: CG_DEVKBD_KEY,
  music: CG_MUSIC_KEY,
};
// Pure readers for the two music prefs, so `music-prefs` can assert the
// default without touching real storage.
function cgReadMusicPref(raw) { return raw === '1'; }
function cgClampVolume(n) {
  const v = Math.round(Number(n));
  if (!isFinite(v)) return CG_MUSIC_VOLUME_DEFAULT;
  return Math.max(0, Math.min(100, v));
}
function cgReadMusicVolume(raw) {
  if (raw == null || raw === '' || !isFinite(Number(raw))) return CG_MUSIC_VOLUME_DEFAULT;
  return cgClampVolume(raw);
}

// Module-level prefs read by cgSound/cgHaptic without prop threading.
const cgPrefs = {
  sound:   (() => { try { return localStorage.getItem(CG_SOUND_KEY) !== '0'; } catch { return true; } })(),
  haptics: (() => { try { return localStorage.getItem(CG_HAPTICS_KEY) !== '0'; } catch { return true; } })(),
  motion:  (() => { try { return localStorage.getItem(CG_MOTION_KEY) === '1'; } catch { return false; } })(),
  devkbd:  (() => { try { return localStorage.getItem(CG_DEVKBD_KEY) === '1'; } catch { return false; } })(),
  music:   (() => { try { return cgReadMusicPref(localStorage.getItem(CG_MUSIC_KEY)); } catch { return false; } })(),
  musicVolume: (() => { try { return cgReadMusicVolume(localStorage.getItem(CG_MUSIC_VOLUME_KEY)); } catch { return CG_MUSIC_VOLUME_DEFAULT; } })(),
};
/* One broadcast for pref changes. The music button, the Settings rows and
   ClassicShell's sound button each used to keep a private force counter, so
   flipping Sound in one left the others showing the old state. */
const _cgPrefListeners = new Set();
function cgOnPrefChange(fn) {
  _cgPrefListeners.add(fn);
  return () => { _cgPrefListeners.delete(fn); };
}
function _cgNotifyPrefs() {
  _cgPrefListeners.forEach((fn) => { try { fn(); } catch (e) {} });
}
// Re-render on any pref change. Returns a counter, like useThemeVersion.
function useCgPrefsVersion() {
  const [v, setV] = useState(0);
  useEffect(() => cgOnPrefChange(() => setV((n) => n + 1)), []);
  return v;
}
function cgSetPref(key, val) {
  cgPrefs[key] = val;
  try { localStorage.setItem(PREF_KEYS[key] || CG_MOTION_KEY, val ? '1' : '0'); } catch {}
  if (key === 'motion') applyMotionPref();
  if (key === 'music' || key === 'sound') cgApplyMusicVolume();
  _cgNotifyPrefs();
}
function cgSetMusicVolume(n) {
  cgPrefs.musicVolume = cgClampVolume(n);
  try { localStorage.setItem(CG_MUSIC_VOLUME_KEY, String(cgPrefs.musicVolume)); } catch {}
  cgApplyMusicVolume();
  _cgNotifyPrefs();
}
/* `?music=0|1` forces the DJ music pref at boot. It sets the in-memory pref
   ONLY and never writes storage, so a check that forces it on cannot leak into
   a later check that asserts the off default. */
(function readMusicParam() {
  try {
    const v = new URLSearchParams(window.location.search).get('music');
    if (v === '1' || v === '0') cgPrefs.music = v === '1';
  } catch (_) {}
})();

/* #331 — the remembered daily difficulty. A string, not a boolean, so it gets
   its own key and writer: cgSetPref writes '1'/'0' and would corrupt it. The
   pre-game screen seeds its band picker from this, and picking a band there
   updates it, so "Hard every morning" is one choice, not one per game. Only
   the remembered value lives here (05-core-lib declares the band list, and
   this file evaluates first); validation is inline for the same reason. */
const CG_DAILYBAND_KEY = 'puzzlechain_cg_dailyband';
function cgDailyBandPref() {
  try {
    const v = localStorage.getItem(CG_DAILYBAND_KEY);
    return (v === 'easy' || v === 'hard') ? v : 'normal';
  } catch { return 'normal'; }
}
function cgSetDailyBandPref(band) {
  try {
    localStorage.setItem(CG_DAILYBAND_KEY,
      (band === 'easy' || band === 'hard') ? band : 'normal');
  } catch {}
}
/* `?devkbd=1|0` — the pref is a device setting, so the only way a proposal
   check or a screenshot could otherwise reach the other mode is by opening
   Settings and tapping, which navigation cannot do. Applied at boot, before
   any game mounts. */
(function readDevKbdParam() {
  try {
    const v = new URLSearchParams(window.location.search).get('devkbd');
    if (v === '1' || v === '0') cgPrefs.devkbd = v === '1';
  } catch (_) {}
})();
/* #235 — the in-app "Reduced motion" switch has only ever reached JS call
   sites, because CSS could see the OS media query and not the pref. Mirroring
   it onto the root element gives the stylesheet something to match, so a
   player who turned motion down in Settings gets that from the CSS animations
   too and not only from the ones drawn in JS. */
function applyMotionPref() {
  try {
    const el = document.documentElement;
    if (cgPrefs.motion) el.setAttribute('data-reduce-motion', '1');
    else el.removeAttribute('data-reduce-motion');
  } catch (e) {}
}
/* ?motion=reduce|full — the pref is device-local, so a check or a screenshot
   could otherwise reach the reduced state only by opening Settings and
   tapping, which navigation cannot do. Same role as ?theme=, and read before
   the attribute is applied below. */
(function readMotionParam() {
  try {
    const v = new URLSearchParams(window.location.search).get('motion');
    if (v === 'reduce') cgPrefs.motion = true;
    else if (v === 'full') cgPrefs.motion = false;
  } catch (e) {}
})();
applyMotionPref();

/* ============================================================
   The palette is felt, always
   ------------------------------------------------------------
   There used to be a light / dark / system preference here. The card table
   replaced both palettes, so there is nothing left to choose: this marks
   <html data-theme="felt"> (index.html's boot script does the same before
   first paint) and keeps PAL and the browser's theme-color in step. The
   old `puzzlechain_theme` key is simply no longer read.
   `themeState.version` and its subscribers stay because canvas games repaint
   through useThemeVersion(); with one palette it never moves after boot.
   ============================================================ */
const themeState = { resolved: 'felt', version: 0 };
const themeSubscribers = new Set();

function applyTheme() {
  themeState.version += 1;
  try {
    const root = document.documentElement;
    root.setAttribute('data-theme', 'felt');
    root.removeAttribute('data-theme-pref');
    Object.assign(PAL, palSnapshot('felt'));
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', PALETTES.felt.surface);
  } catch {}
  themeSubscribers.forEach(fn => { try { fn(); } catch {} });
}

/* ============================================================
   BOARD MATERIALS — a board sits on the felt, it is not made of it
   ------------------------------------------------------------
   The felt is the table. A game's playing surface is an object on it, like
   the cards in the lobby, so it keeps a material of its own: 'paper' (the
   ivory puzzle page — Sudoku, Word Search, Nonogram…) or 'screen' (the dark
   arcade well — Drop Stack, Block Fit, Bounce…), following each game's lobby
   card. A board opts in with data-board="paper|screen" on its container:
   - CSS: [data-board] re-declares every --c-* token for its subtree, so the
     board's own rules, which read C.*, resolve to the material.
   - canvas: useCanvasBoard (and the hand-rolled loops) draw inside
     withPal(boardMaterialOf(canvas), …), which swaps PAL's values for the
     duration of the draw and puts the felt back after.
   Chrome drawn ON a board canvas through the cui kit (cuiDrawControls) stays
   felt: it is a control, not the board. Cards, tiles and pieces with their
   own pinned colours are untouched either way, and a board with no
   data-board (the card games, the wooden boards) lies on the felt itself.
   ============================================================ */
const BOARD_MATERIALS = ['paper', 'screen'];
let PAL_MAT = 'felt';

function palSnapshot(name) {
  return Object.assign({}, PALETTES[name], { accentInk: DERIVED[name]['accent-ink'] });
}

function withPal(name, fn) {
  if (!name || !PALETTES[name] || name === PAL_MAT) return fn();
  const prev = PAL_MAT, saved = Object.assign({}, PAL);
  Object.assign(PAL, palSnapshot(name));
  PAL_MAT = name;
  try { return fn(); } finally { Object.assign(PAL, saved); PAL_MAT = prev; }
}

function boardMaterialOf(el) {
  try {
    const host = el && el.closest ? el.closest('[data-board]') : null;
    const m = host ? host.getAttribute('data-board') : null;
    return BOARD_MATERIALS.indexOf(m) >= 0 ? m : null;
  } catch (e) { return null; }
}

applyTheme();

/* Phase 1 — canvas colour correctness.
   `C.x` is the string 'var(--c-x)'. Assigning that to ctx.fillStyle is
   INVALID: the 2D context silently keeps its previous value, and because the
   context object persists across frames the stale colour leaks between draws
   (black on frame 1, "last frame's piece colour" thereafter). Canvas code MUST
   read real values from PAL. These helpers make that cheap and make a
   regression loud instead of silent. */

// Subscribe a canvas game to palette changes so it repaints with the new values.
function useThemeVersion() {
  const [v, setV] = useState(themeState.version);
  useEffect(() => {
    const fn = () => setV(themeState.version);
    themeSubscribers.add(fn);
    fn();
    return () => { themeSubscribers.delete(fn); };
  }, []);
  return v;
}

// Resolve a palette token name (or pass a literal colour straight through).
// Storing token NAMES and resolving at draw time is what lets a theme flip
// recolour mid-game (the BOUNCE_ROW_COLORS precedent).
/* One answer for "should this thing animate?": the app's own opt-in pref OR
   the OS setting. Every new motion surface reads THIS, not matchMedia
   directly, so a player who turned motion down in Settings is honoured even
   on a device whose OS pref is unset. */
function cgReducedMotion() {
  if (cgPrefs.motion) return true;
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  catch (e) { return false; }
}

function palOf(nameOrLiteral, fallback) {
  if (!nameOrLiteral) return fallback || PAL.text;
  if (typeof nameOrLiteral !== 'string') return fallback || PAL.text;
  if (PAL[nameOrLiteral] != null) return PAL[nameOrLiteral];
  // A C.* token ('var(--c-x)') handed to canvas code resolves through PAL —
  // components that share one colour between DOM chrome and a canvas board
  // (the Snakes & Ladders pawns) pass the token form of both.
  const m = /^var\(--c-([a-z0-9-]+)\)$/.exec(nameOrLiteral);
  if (m && PAL[m[1]] != null) return PAL[m[1]];
  return nameOrLiteral;
}

const CANVAS_COLOR_PROPS = ['fillStyle', 'strokeStyle', 'shadowColor'];
let _canvasGuardWarned = 0;

/* Guard: a `var(--…)` colour reaching a canvas is the bug class this phase
   fixes, so make it loud AND harmless — the assignment is swallowed so the
   stale-colour leak can never happen again, and the first few occurrences log
   a console error (which trips the platform's no-console-errors check).
   Deliberately NOT env-gated: identical code path in staging and production. */
/* #208 — the guard has to return the SAME proxy every time, so it is cached
   against the context rather than flagged on it.

   It used to mark the RAW context `__unGuarded` once it had wrapped it, and
   bail out returning that raw context on every later call. But
   `canvas.getContext('2d')` hands back the SAME object each time, and
   `useCanvasBoard` re-guards on EVERY frame — so only the very first frame of
   every canvas in the app was ever guarded, and every frame after it drew
   through an unwrapped context. The protection this comment block promises
   ("the bug class can never silently return") had been inert since frame one,
   which is exactly how Block Fit shipped a board that painted every placed
   piece in the background colour without ever tripping the check. */
const _ctxGuards = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
function guardCanvasCtx(ctx) {
  if (!ctx || typeof Proxy === 'undefined') return ctx;
  const cached = _ctxGuards && _ctxGuards.get(ctx);
  if (cached) return cached;
  try {
    const p = new Proxy(ctx, {
      get(t, k) {
        const v = t[k];
        return typeof v === 'function' ? v.bind(t) : v;
      },
      set(t, k, v) {
        if (CANVAS_COLOR_PROPS.indexOf(k) >= 0 && typeof v === 'string' && /^var\(/.test(v)) {
          if (_canvasGuardWarned < 12) {
            _canvasGuardWarned += 1;
            console.error(
              '[canvas-color] invalid canvas colour ' + JSON.stringify(v) + ' assigned to ctx.' + k +
              ' — canvas cannot resolve CSS custom properties. Read from PAL instead of C.'
            );
          }
          return true; // swallow: never let the stale-colour leak happen
        }
        t[k] = v;
        return true;
      },
    });
    if (_ctxGuards) _ctxGuards.set(ctx, p);
    return p;
  } catch { return ctx; }
}

/* Load-time self-test: every PAL key must be a colour the canvas actually
   accepts, and every C token must be a var() reference (so nobody "fixes" the
   theming by inlining hex and breaking re-theming). */
function canvasColorSelfTest() {
  const problems = [];
  try {
    const probe = document.createElement('canvas').getContext('2d');
    if (!probe) return true;
    for (const k of Object.keys(PAL)) {
      const want = PAL[k];
      if (typeof want !== 'string') { problems.push(k + ': not a string'); continue; }
      probe.fillStyle = '#000000';
      probe.fillStyle = want;
      // An invalid value leaves fillStyle at the previous colour.
      if (probe.fillStyle === '#000000' && want.toLowerCase() !== '#000000' && want.toLowerCase() !== '#000') {
        problems.push('PAL.' + k + ' = ' + want + ' is not a valid canvas colour');
      }
    }
    for (const k of Object.keys(C)) {
      if (!/^var\(--c-/.test(C[k])) problems.push('C.' + k + ' is not a var() token: ' + C[k]);
    }
  } catch { return true; }
  if (problems.length) {
    console.error('[canvas-color] self-test failed:\n  ' + problems.join('\n  '));
    return false;
  }
  return true;
}

let _cgAudioCtx = null;
function cgAudio() {
  if (_cgAudioCtx) return _cgAudioCtx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) _cgAudioCtx = new AC();
  } catch {}
  return _cgAudioCtx;
}
// Short synthesized cues — no asset files needed.
const CG_TONES = {
  move:      { f: 320, d: 0.05, t: 'square',   g: 0.05 },
  click:     { f: 440, d: 0.04, t: 'triangle', g: 0.05 },
  merge:     { f: 540, d: 0.09, t: 'sine',     g: 0.07 },
  clear:     { f: 660, d: 0.10, t: 'sine',     g: 0.08 },
  capture:   { f: 740, d: 0.12, t: 'triangle', g: 0.08 },
  deal:      { f: 380, d: 0.05, t: 'square',   g: 0.05 },
  chip:      { f: 500, d: 0.06, t: 'square',   g: 0.06 },
  win:       { f: 784, d: 0.22, t: 'sine',     g: 0.09 },
  lose:      { f: 150, d: 0.30, t: 'sawtooth', g: 0.08 },
  // Bounce-specific cues
  bwall:     { f: 290, d: 0.03, t: 'square',   g: 0.06 },
  bpaddle:   { f: 360, d: 0.07, t: 'triangle', g: 0.07 },
  bbrick:    { f: 580, d: 0.11, t: 'sine',     g: 0.09 },
  blevel:    { f: 880, d: 0.28, t: 'sine',     g: 0.10 },
  bpowerup:  { f: 720, d: 0.14, t: 'triangle', g: 0.08 },
  bdie:      { f: 190, d: 0.35, t: 'sawtooth', g: 0.10 },
  bgameover: { f: 140, d: 0.55, t: 'sawtooth', g: 0.11 },
  /* Snakes & Ladders V2 board cues. `f2` (optional) ramps the pitch across the
     tone's life, which is the whole difference between a beep and a hiss/slide:
     a falling sawtooth reads as "dropped down a snake", a rising sine as
     "climbed a ladder". Synthesised like every other cue here, so the feature
     ships no audio asset. */
  snlhiss:   { f: 620, f2: 170, d: 0.34, t: 'sawtooth', g: 0.07 },
  snlchime:  { f: 880, f2: 1320, d: 0.26, t: 'sine',    g: 0.09 },
  snlthwack: { f: 150, f2: 55,  d: 0.16, t: 'square',   g: 0.12 },
  snlrattle: { f: 240, f2: 300, d: 0.05, t: 'square',   g: 0.05 },
  snlfinish: { f: 660, f2: 990, d: 0.30, t: 'triangle', g: 0.09 },
};
function cgSound(name, pitch) {
  if (!cgPrefs.sound) return;
  const ctx = cgAudio();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') ctx.resume();
    const spec = CG_TONES[name] || CG_TONES.click;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = spec.t;
    const now = ctx.currentTime;
    osc.frequency.value = spec.f * (pitch || 1);
    // Optional pitch sweep across the tone (see the S&L cues above).
    if (spec.f2) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(20, spec.f2 * (pitch || 1)), now + spec.d);
    }
    gain.gain.value = spec.g;
    osc.connect(gain).connect(ctx.destination);
    gain.gain.setValueAtTime(spec.g, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + spec.d);
    osc.start(now);
    osc.stop(now + spec.d + 0.02);
  } catch {}
}
function cgHaptic(ms) {
  if (!cgPrefs.haptics) return;
  try {
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    if (navigator.vibrate) navigator.vibrate(ms || 12);
  } catch {}
}

/* ============================================================
   Background-music manager — fetch / decode / loop an audio asset
   ------------------------------------------------------------
   Unlike the short synthesized cgSound cues, looping background music needs a
   real asset. We fetch the file once, decode it into an AudioBuffer with the
   Web Audio API, and play it on a looping BufferSource routed through a shared
   gain node (BG_MUSIC_GAIN keeps it at a moderate background level so it never
   drowns out the cgSound effects). decodeAudioData decodes from the raw bytes
   regardless of file extension / Content-Type, so the asset's container is not
   constrained by its `.mp3` name. All state is module-level so a single track
   plays at a time; calling start again with the same url reuses the decoded
   buffer instead of re-fetching.
   ============================================================ */
const BG_MUSIC_GAIN = 0.4;
let _bgAudioCtx = null;
let _bgMusicGainNode = null;
let _bgMusicSource = null;
let _bgMusicBuffer = null;
let _bgMusicUrl = null;
let _bgMusicLoading = false;
// True once the caller has asked to stop/pause — guards the async decode from
// auto-starting playback after a stop that raced the fetch.
let _bgMusicStopped = true;
// Bumped on every fetch/decode kicked off — lets a superseded in-flight
// request (e.g. a second startBackgroundMusic(url) call for a different
// track before the first one finished decoding) recognize it's stale and
// skip starting a source, instead of both requests racing to call
// _bgStartSource() and briefly double-firing playback.
let _bgMusicToken = 0;

function bgAudioContext() {
  if (_bgAudioCtx) return _bgAudioCtx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) _bgAudioCtx = new AC();
  } catch {}
  return _bgAudioCtx;
}

// (Re)create and start the looping source from the already-decoded buffer.
function _bgStartSource() {
  const ctx = bgAudioContext();
  if (!ctx || !_bgMusicBuffer) return;
  // Tear down any prior source first (start() can only be called once per node).
  if (_bgMusicSource) {
    try { _bgMusicSource.onended = null; _bgMusicSource.stop(); } catch {}
    _bgMusicSource = null;
  }
  if (!_bgMusicGainNode) {
    _bgMusicGainNode = ctx.createGain();
    _bgMusicGainNode.gain.value = cgOwnMusicLevel(cgPrefs.musicVolume);
    _bgMusicGainNode.connect(ctx.destination);
  }
  const src = ctx.createBufferSource();
  src.buffer = _bgMusicBuffer;
  src.loop = true;
  src.connect(_bgMusicGainNode);
  try { src.start(0); } catch {}
  _bgMusicSource = src;
}

// Start (or resume) looping the track at `url`. Must be called from a user
// gesture the first time so the AudioContext is allowed to produce sound.
function startBackgroundMusic(url) {
  const ctx = bgAudioContext();
  if (!ctx) return;
  _bgMusicStopped = false;
  try { if (ctx.state === 'suspended') ctx.resume(); } catch {}
  // Already decoded this track → just (re)start playback synchronously.
  if (_bgMusicBuffer && _bgMusicUrl === url) {
    if (!_bgMusicSource) _bgStartSource();
    return;
  }
  if (_bgMusicLoading && _bgMusicUrl === url) return; // fetch already in flight
  _bgMusicLoading = true;
  _bgMusicUrl = url;
  _bgMusicBuffer = null;
  const token = ++_bgMusicToken;
  fetch(url)
    .then(r => r.arrayBuffer())
    .then(buf => new Promise((resolve, reject) => {
      // decodeAudioData has both promise and legacy-callback forms — support both.
      let p;
      try { p = ctx.decodeAudioData(buf, resolve, reject); } catch (e) { reject(e); return; }
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    }))
    .then(decoded => {
      // A newer startBackgroundMusic() call superseded this one while we were
      // decoding — drop the stale result instead of racing it into _bgStartSource().
      if (token !== _bgMusicToken) return;
      _bgMusicLoading = false;
      _bgMusicBuffer = decoded;
      // Only begin if no stop/pause arrived while we were decoding.
      if (!_bgMusicStopped) _bgStartSource();
    })
    .catch(() => { if (token === _bgMusicToken) _bgMusicLoading = false; });
}

// Stop playback (used as pause too — resume restarts the loop from its start).
function stopBackgroundMusic() {
  _bgMusicStopped = true;
  if (_bgMusicSource) {
    try { _bgMusicSource.onended = null; _bgMusicSource.stop(); } catch {}
    _bgMusicSource = null;
  }
}

// Resume after a stop/pause. Reuses the decoded buffer when present; otherwise
// re-fetches the last url.
function resumeBackgroundMusic() {
  const ctx = bgAudioContext();
  if (!ctx) return;
  _bgMusicStopped = false;
  try { if (ctx.state === 'suspended') ctx.resume(); } catch {}
  if (_bgMusicBuffer) {
    if (!_bgMusicSource) _bgStartSource();
  } else if (_bgMusicUrl) {
    startBackgroundMusic(_bgMusicUrl);
  }
}

/* ============================================================
   Procedural loop music (cgStartLoopMusic / cgSetLoopMusicMood)
   ============================================================
   The manager above plays an ASSET. Snakes & Ladders has no soundtrack file
   and an agent cannot author one, so its background music is synthesised from
   the same AudioContext the SFX already use — no new bytes shipped, and it
   re-themes for free when a mood changes.

   Two things make this sound like music instead of a metronome of setTimeouts:

   - A LOOKAHEAD SCHEDULER. A 25ms interval schedules every note that falls in
     the next 150ms against ctx.currentTime, which is a sample-accurate clock.
     One setTimeout per note would inherit the main thread's jitter, and the
     result audibly stumbles whenever the board repaints.
   - MOOD CHANGES LAND ON A BAR BOUNDARY. Flipping the tempo mid-bar is heard
     as a mistake, not as tension. `pendingMood` holds the change until the
     next downbeat, which is at most one bar away.

   cgPrefs.sound is re-read PER NOTE, so muting during a match goes quiet
   immediately without tearing the scheduler down. */
const CG_LOOP_STEPS_PER_BAR = 8;
const CG_LOOP_LOOKAHEAD = 0.15;
const CG_LOOP_TICK_MS = 25;

const CG_LOOP_MOODS = {
  // Major pentatonic, slow, soft: the board is calm and nobody is close.
  calm: {
    bpm: 96,
    lead: 'triangle', bass: 'sine',
    gain: 0.6,
    scale: [261.63, 293.66, 329.63, 392.0, 440.0],
    pattern: [0, 2, 4, 2, 1, 3, 2, 0, 0, 2, 4, 3, 1, 2, 3, 4],
    bassNote: 130.81,
  },
  /* Minor third plus a tritone, faster, with a sawtooth bass. Fires once any
     pawn passes SNLV2_TENSE_SQUARE and stays for the rest of the match. */
  tense: {
    bpm: 132,
    lead: 'sawtooth', bass: 'sawtooth',
    gain: 0.75,
    scale: [220.0, 261.63, 293.66, 311.13, 329.63],
    pattern: [0, 3, 1, 3, 0, 4, 3, 1, 0, 3, 2, 3, 4, 3, 1, 0],
    bassNote: 110.0,
  },
};

/* Pure: which note this step of the loop plays. Split out so the
   `cnlv2-music-loop` self-test can assert the pattern without an
   AudioContext (a headless check has no speakers and no user gesture). */
function cgLoopNoteAt(moodName, step) {
  const m = CG_LOOP_MOODS[moodName] || CG_LOOP_MOODS.calm;
  const i = ((step % m.pattern.length) + m.pattern.length) % m.pattern.length;
  const beat = 60 / m.bpm / 2; // eighth notes
  return {
    lead: m.scale[m.pattern[i]],
    bass: (step % CG_LOOP_STEPS_PER_BAR === 0) ? m.bassNote : null,
    dur: beat,
    gain: m.gain,
  };
}

let _cgLoop = null;

function _cgLoopVoice(ctx, freq, at, dur, type, level) {
  try {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur * 0.95);
    osc.connect(g).connect(_cgLoopOut(ctx));
    osc.start(at);
    osc.stop(at + dur);
  } catch (e) {}
}

/* The procedural loop's voices used to connect straight to the destination,
   so there was nothing to turn down. One gain node gives it the shared music
   volume; at the default volume it is unity, i.e. exactly today's level. */
let _cgLoopOutNode = null;
function _cgLoopOut(ctx) {
  if (_cgLoopOutNode) return _cgLoopOutNode;
  try {
    _cgLoopOutNode = ctx.createGain();
    _cgLoopOutNode.gain.value = cgOwnMusicFactor(cgPrefs.musicVolume);
    _cgLoopOutNode.connect(ctx.destination);
  } catch (e) { return ctx.destination; }
  return _cgLoopOutNode;
}

function _cgLoopTick() {
  const L = _cgLoop;
  if (!L) return;
  if (_cgAudioHidden) return; // app hidden: schedule nothing, catch up on show
  const ctx = cgAudio();
  if (!ctx) return;
  if (L.nextTime < ctx.currentTime) L.nextTime = ctx.currentTime + 0.05;
  while (L.nextTime < ctx.currentTime + CG_LOOP_LOOKAHEAD) {
    if (L.step % CG_LOOP_STEPS_PER_BAR === 0 && L.pendingMood) {
      L.mood = L.pendingMood;
      L.pendingMood = null;
    }
    const m = CG_LOOP_MOODS[L.mood] || CG_LOOP_MOODS.calm;
    const note = cgLoopNoteAt(L.mood, L.step);
    if (cgPrefs.sound) {
      _cgLoopVoice(ctx, note.lead, L.nextTime, note.dur * 0.9, m.lead,
        BG_MUSIC_GAIN * note.gain * 0.22);
      if (note.bass) {
        _cgLoopVoice(ctx, note.bass, L.nextTime, note.dur * 1.6, m.bass,
          BG_MUSIC_GAIN * note.gain * 0.18);
      }
    }
    L.nextTime += note.dur;
    L.step += 1;
  }
}

// Call from a user gesture the first time (the AudioContext stays suspended
// otherwise, exactly like startBackgroundMusic).
function cgStartLoopMusic(mood) {
  const want = CG_LOOP_MOODS[mood] ? mood : 'calm';
  if (_cgLoop) { cgSetLoopMusicMood(want); return; }
  const ctx = cgAudio();
  if (!ctx) return;
  try { if (ctx.state === 'suspended') ctx.resume(); } catch (e) {}
  _cgLoop = { mood: want, pendingMood: null, step: 0, nextTime: ctx.currentTime + 0.08, timer: 0 };
  _cgLoop.timer = setInterval(_cgLoopTick, CG_LOOP_TICK_MS);
  _cgLoopTick();
}

function cgSetLoopMusicMood(mood) {
  if (!_cgLoop || !CG_LOOP_MOODS[mood]) return;
  if (_cgLoop.mood === mood) { _cgLoop.pendingMood = null; return; }
  _cgLoop.pendingMood = mood; // applied on the next bar line
}

function cgLoopMusicMood() { return _cgLoop ? (_cgLoop.pendingMood || _cgLoop.mood) : null; }

function cgStopLoopMusic() {
  if (!_cgLoop) return;
  try { clearInterval(_cgLoop.timer); } catch (e) {}
  _cgLoop = null;
}

/* ============================================================
   Background DJ music. Synthesized with Web Audio, no audio files.
   ------------------------------------------------------------
   OFF by default (see CG_MUSIC_KEY). Three grooves, one per kind of game, each
   a 24-bar arrangement that loops: intro (kick and hats), main (everything),
   a break (the kick and bass drop out and a lowpass sweep brings them back),
   then main again. `djStepAt` is the whole arrangement as a pure function of
   (groove, bar, step), so `dj-music-pattern` can check it without audio.

   Games that ship their own soundtrack (Mine Finder Classic, Bounce, Snakes &
   Ladders) set `ownMusic` in the registry and never get this on top; they
   share only the volume slider, through cgApplyMusicVolume.
   ============================================================ */
let _cgAudioHidden = false;
const DJ_BASE_GAIN = 0.35;
// The own-soundtrack games were tuned at what is now the default volume (60),
// so at the default these are exactly their old levels.
function cgOwnMusicFactor(vol) { return cgClampVolume(vol) / CG_MUSIC_VOLUME_DEFAULT; }
function cgOwnMusicLevel(vol) { return BG_MUSIC_GAIN * cgOwnMusicFactor(vol); }
function djGain(sound, music, vol) {
  return sound && music ? (cgClampVolume(vol) / 100) * DJ_BASE_GAIN : 0;
}

const DJ_SECTIONS = [['intro', 4], ['main', 8], ['break', 4], ['main', 8]];
const DJ_CYCLE_BARS = DJ_SECTIONS.reduce((n, s) => n + s[1], 0);
const DJ_GROOVES = {
  // Four on the floor, offbeat bass, syncopated minor stabs.
  house: {
    bpm: 124,
    chords: [[220, 261.63, 329.63], [174.61, 220, 261.63], [261.63, 329.63, 392], [196, 246.94, 293.66]],
    roots: [110, 87.31, 130.81, 98],
    kick: [0, 4, 8, 12], clap: [4, 12], hat: [2, 6, 10, 14], ohat: [14],
    bass: [2, 6, 10, 14], bassUp: [10], stab: [3, 10], stabLen: 1.5,
    mix: { kick: 0.9, clap: 0.45, hat: 0.16, bass: 0.26, stab: 0.07 },
  },
  // Driving: sixteenth hats and a rolling bass between the kicks.
  electro: {
    bpm: 128,
    chords: [[164.81, 196, 246.94], [130.81, 164.81, 196], [146.83, 174.61, 220], [123.47, 146.83, 185]],
    roots: [82.41, 65.41, 73.42, 61.74],
    kick: [0, 4, 8, 12], clap: [4, 12], hat: [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15], ohat: [2, 10],
    bass: [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15], bassUp: [3, 7, 11, 15], stab: [0, 6], stabLen: 1,
    mix: { kick: 0.95, clap: 0.4, hat: 0.1, bass: 0.18, stab: 0.06 },
  },
  // Slower and softer, long pads, for board and card games you think at.
  chill: {
    bpm: 100,
    chords: [[146.83, 174.61, 220], [116.54, 146.83, 174.61], [130.81, 164.81, 196], [110, 138.59, 164.81]],
    roots: [73.42, 58.27, 65.41, 55],
    kick: [0, 4, 8, 12], clap: [12], hat: [2, 6, 10, 14], ohat: [],
    bass: [0, 7, 10], bassUp: [], stab: [0], stabLen: 12,
    mix: { kick: 0.6, clap: 0.3, hat: 0.1, bass: 0.24, stab: 0.05 },
  },
};
const DJ_CHILL_TAGS = new Set(['Board', 'Cards', 'Strategy', 'Risk']);
const DJ_CHILL_IDS = new Set(['klondike', 'spider', 'mahjongsol']);
function djGrooveFor(game) {
  if (!game) return 'house';
  if (game.djGroove && DJ_GROOVES[game.djGroove]) return game.djGroove;
  if (game.tag === 'Arcade') return 'electro';
  if (DJ_CHILL_TAGS.has(game.tag) || DJ_CHILL_IDS.has(game.id)) return 'chill';
  return 'house';
}
function djSectionAt(bar) {
  let b = ((Math.floor(bar) % DJ_CYCLE_BARS) + DJ_CYCLE_BARS) % DJ_CYCLE_BARS;
  for (const [name, len] of DJ_SECTIONS) {
    if (b < len) return { section: name, barOfSection: b, sectionBars: len };
    b -= len;
  }
  return { section: 'main', barOfSection: 0, sectionBars: 8 };
}
function djStepAt(name, bar, step) {
  const g = DJ_GROOVES[name] || DJ_GROOVES.house;
  const s = ((Math.floor(step) % 16) + 16) % 16;
  const sec = djSectionAt(bar);
  const n = g.chords.length;
  const ci = ((Math.floor(bar) % n) + n) % n;
  const main = sec.section === 'main', brk = sec.section === 'break';
  return {
    kick: !brk && g.kick.indexOf(s) >= 0,
    clap: main && g.clap.indexOf(s) >= 0,
    hat: g.hat.indexOf(s) >= 0,
    ohat: main && g.ohat.indexOf(s) >= 0,
    bass: main && g.bass.indexOf(s) >= 0 ? g.roots[ci] * (g.bassUp.indexOf(s) >= 0 ? 2 : 1) : null,
    stab: (main || brk) && g.stab.indexOf(s) >= 0 ? g.chords[ci] : null,
    section: sec.section, barOfSection: sec.barOfSection, sectionBars: sec.sectionBars,
    dur: 60 / g.bpm / 4,
  };
}

let cgMusicMaster = null;
let _djNodes = null;
function _djGraph(ctx) {
  if (_djNodes && _djNodes.ctx === ctx) return _djNodes;
  try {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    comp.connect(ctx.destination);
    const master = ctx.createGain();
    master.gain.value = djGain(cgPrefs.sound, cgPrefs.music, cgPrefs.musicVolume);
    master.connect(comp);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 18000; filter.Q.value = 0.8;
    filter.connect(master);
    const bus = ctx.createGain();
    bus.gain.value = 0;
    bus.connect(filter);
    const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
    const d = noise.getChannelData(0);
    let seed = 0x9e3779b9;
    for (let i = 0; i < d.length; i++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      d[i] = ((seed >>> 0) / 4294967296) * 2 - 1;
    }
    cgMusicMaster = master;
    _djNodes = { ctx, comp, master, filter, bus, noise };
    return _djNodes;
  } catch (e) { return null; }
}
function _djEnv(ctx, gainVal, t, len, out) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(gainVal, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  g.connect(out);
  return g;
}
function _djNoise(ctx, N, t, len, type, freq, gainVal) {
  const src = ctx.createBufferSource();
  src.buffer = N.noise;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq;
  src.connect(f).connect(_djEnv(ctx, gainVal, t, len, N.bus));
  src.start(t); src.stop(t + len + 0.02);
}
function _djOsc(ctx, type, freq, t, len, dest, detune) {
  const o = ctx.createOscillator();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (detune) o.detune.value = detune;
  o.connect(dest);
  o.start(t); o.stop(t + len + 0.02);
  return o;
}
function _djPlayStep(ctx, N, n, t, g) {
  const m = g.mix;
  try {
    if (n.kick) {
      const o = _djOsc(ctx, 'sine', 150, t, 0.3, _djEnv(ctx, m.kick, t, 0.28, N.bus));
      o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    }
    if (n.clap) _djNoise(ctx, N, t, 0.18, 'bandpass', 1500, m.clap);
    if (n.hat) _djNoise(ctx, N, t, 0.05, 'highpass', 7000, m.hat);
    if (n.ohat) _djNoise(ctx, N, t, 0.25, 'highpass', 6500, m.hat * 0.8);
    if (n.bass) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(900, t);
      f.frequency.exponentialRampToValueAtTime(250, t + n.dur * 1.8);
      f.connect(_djEnv(ctx, m.bass, t, n.dur * 1.8, N.bus));
      _djOsc(ctx, 'sawtooth', n.bass, t, n.dur * 1.8, f);
    }
    if (n.stab) {
      const len = n.dur * g.stabLen;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 2200;
      f.connect(_djEnv(ctx, m.stab, t, len, N.bus));
      n.stab.forEach((hz) => {
        _djOsc(ctx, 'sawtooth', hz, t, len, f, -8);
        _djOsc(ctx, 'sawtooth', hz, t, len, f, 8);
      });
    }
  } catch (e) {}
}
// Break: filter shut at its first bar, opening across its last one.
function _djBarAutomation(N, n, t) {
  try {
    const fq = N.filter.frequency;
    if (n.section === 'break' && n.barOfSection === 0) {
      fq.cancelScheduledValues(t); fq.setValueAtTime(400, t);
    }
    if (n.section === 'break' && n.barOfSection === n.sectionBars - 1) {
      fq.setValueAtTime(400, t); fq.exponentialRampToValueAtTime(18000, t + n.dur * 16);
    }
    if (n.section !== 'break' && n.barOfSection === 0) fq.setValueAtTime(18000, t);
  } catch (e) {}
}
function _djMayUseAudio() {
  const ua = typeof navigator !== 'undefined' && navigator.userActivation;
  return !ua || ua.hasBeenActive;
}

let _djLoop = null;
function _djTick() {
  const L = _djLoop;
  if (!L || L.paused || _cgAudioHidden) return;
  const ctx = _cgAudioCtx;
  if (!ctx) return; // waits for the first gesture (cgArmAudioUnlock)
  if (ctx.state !== 'running') {
    if (_djMayUseAudio()) { try { ctx.resume(); } catch (e) {} }
    L.needsResync = true;
    return;
  }
  const N = _djGraph(ctx);
  if (!N) return;
  if (!L.faded) {
    L.faded = true;
    const t0 = ctx.currentTime;
    try {
      N.bus.gain.cancelScheduledValues(t0);
      N.bus.gain.setValueAtTime(0, t0);
      N.bus.gain.linearRampToValueAtTime(1, t0 + (L.fadeIn || 1));
    } catch (e) {}
  }
  if (L.needsResync || L.nextTime < ctx.currentTime) {
    L.nextTime = ctx.currentTime + 0.06;
    L.needsResync = false;
  }
  while (L.nextTime < ctx.currentTime + CG_LOOP_LOOKAHEAD) {
    if (L.step === 0 && L.pendingGroove) { L.groove = L.pendingGroove; L.pendingGroove = null; }
    const g = DJ_GROOVES[L.groove] || DJ_GROOVES.house;
    const n = djStepAt(L.groove, L.bar, L.step);
    if (L.step === 0) _djBarAutomation(N, n, L.nextTime);
    _djPlayStep(ctx, N, n, L.nextTime, g);
    L.nextTime += n.dur;
    L.step += 1;
    if (L.step >= 16) { L.step = 0; L.bar += 1; }
  }
}
function _djArm(L) {
  if (!L.timer) L.timer = setInterval(_djTick, CG_LOOP_TICK_MS);
}
function djMusicStart(groove) {
  const want = DJ_GROOVES[groove] ? groove : 'house';
  const L = _djLoop;
  if (L) {
    if (L.stopTimer) {
      // Restarted inside a fade-out: bring it straight back.
      clearTimeout(L.stopTimer); L.stopTimer = 0;
      L.faded = false; L.fadeIn = 0.4;
    }
    if (L.groove !== want) L.pendingGroove = want; else L.pendingGroove = null;
    _djArm(L); _djTick();
    return;
  }
  // Never create an AudioContext before the page has had a gesture: that is
  // what logs the autoplay warning. The unlock listener creates it later.
  if (!_cgAudioCtx && _djMayUseAudio()) cgAudio();
  _djLoop = { groove: want, pendingGroove: null, bar: 0, step: 0, nextTime: 0,
    timer: 0, paused: false, needsResync: true, faded: false, fadeIn: 1, stopTimer: 0 };
  _djArm(_djLoop);
  _djTick();
}
function djMusicStop() {
  const L = _djLoop;
  if (!L || L.stopTimer) return;
  const N = _djNodes;
  if (!N || !L.faded || L.paused) { _djClear(); return; }
  try {
    const t = N.ctx.currentTime;
    N.bus.gain.cancelScheduledValues(t);
    N.bus.gain.setValueAtTime(N.bus.gain.value, t);
    N.bus.gain.linearRampToValueAtTime(0, t + 0.8);
  } catch (e) {}
  L.stopTimer = setTimeout(_djClear, 900);
}
function _djClear() {
  const L = _djLoop;
  if (!L) return;
  try { clearInterval(L.timer); } catch (e) {}
  try { clearTimeout(L.stopTimer); } catch (e) {}
  _djLoop = null;
  try { if (_djNodes) { const t = _djNodes.ctx.currentTime; _djNodes.bus.gain.cancelScheduledValues(t); _djNodes.bus.gain.setValueAtTime(0, t); } } catch (e) {}
}
function djMusicPause() {
  const L = _djLoop;
  if (!L) return;
  if (L.stopTimer) { _djClear(); return; }
  L.paused = true;
  try { clearInterval(L.timer); } catch (e) {}
  L.timer = 0;
  try { if (_djNodes) { const t = _djNodes.ctx.currentTime; _djNodes.bus.gain.cancelScheduledValues(t); _djNodes.bus.gain.setValueAtTime(0, t); } } catch (e) {}
}
function djMusicResume() {
  const L = _djLoop;
  if (!L || !L.paused) return;
  L.paused = false; L.needsResync = true; L.faded = false; L.fadeIn = 0.4;
  _djArm(L); _djTick();
}
function djMusicPlaying() { return !!(_djLoop && !_djLoop.stopTimer && !_djLoop.paused); }

function cgApplyMusicVolume() {
  const v = cgPrefs.musicVolume;
  try {
    if (cgMusicMaster) {
      const t = cgMusicMaster.context.currentTime;
      cgMusicMaster.gain.cancelScheduledValues(t);
      cgMusicMaster.gain.setTargetAtTime(djGain(cgPrefs.sound, cgPrefs.music, v), t, 0.05);
    }
  } catch (e) {}
  try { if (_bgMusicGainNode) _bgMusicGainNode.gain.value = cgOwnMusicLevel(v); } catch (e) {}
  try { if (_cgLoopOutNode) _cgLoopOutNode.gain.value = cgOwnMusicFactor(v); } catch (e) {}
}

/* Web Audio is not <audio>: the bridge pauses media elements when the shell
   hides this app, and does nothing for an AudioContext. So music pauses here,
   on the shell's own signal and on the page's. */
let _shellHidden = false, _bgSuspendedByHide = false;
function _cgSyncAudioHidden() {
  let docHidden = false;
  try { docHidden = !!document.hidden; } catch (e) {}
  const hidden = _shellHidden || docHidden;
  if (hidden === _cgAudioHidden) return;
  _cgAudioHidden = hidden;
  if (hidden) {
    djMusicPause();
    try {
      if (_bgAudioCtx && _bgAudioCtx.state === 'running') { _bgAudioCtx.suspend(); _bgSuspendedByHide = true; }
    } catch (e) {}
  } else {
    djMusicResume();
    try { if (_bgSuspendedByHide && _bgAudioCtx) _bgAudioCtx.resume(); } catch (e) {}
    _bgSuspendedByHide = false;
  }
}
(function installAudioVisibility() {
  try {
    window.addEventListener('usernode:visibility-changed', (e) => {
      _shellHidden = !!(e && e.detail && e.detail.hidden);
      _cgSyncAudioHidden();
    });
    document.addEventListener('visibilitychange', _cgSyncAudioHidden);
  } catch (e) {}
})();
/* The first gesture unlocks audio. A deep link with ?music=1, or a reload into
   a game, reaches the music hook before any tap; the loop waits until here. */
(function cgArmAudioUnlock() {
  const unlock = () => {
    if (_cgAudioHidden) return;
    try {
      if (_djLoop && !_cgAudioCtx) cgAudio();
      if (_cgAudioCtx && _cgAudioCtx.state === 'suspended') _cgAudioCtx.resume();
    } catch (e) {}
  };
  try {
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
  } catch (e) {}
})();


// Discrete-gesture hook: tap / swipe / long-press / double-tap on an element.
function useGestures(ref, handlers) {
  const h = useRef(handlers);
  h.current = handlers;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let startX = 0, startY = 0, startT = 0, lpTimer = null, lastTap = 0, moved = false;
    const SWIPE = 30;
    const clearLp = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
    const onDown = (e) => {
      const p = e.touches ? e.touches[0] : e;
      startX = p.clientX; startY = p.clientY; startT = Date.now(); moved = false;
      clearLp();
      if (h.current.onLongPress) {
        lpTimer = setTimeout(() => {
          if (!moved) { h.current.onLongPress({ x: startX, y: startY, target: e.target }); lpTimer = null; }
        }, 480);
      }
    };
    const onMove = (e) => {
      const p = e.touches ? e.touches[0] : e;
      if (Math.abs(p.clientX - startX) > 8 || Math.abs(p.clientY - startY) > 8) { moved = true; clearLp(); }
    };
    const onUp = (e) => {
      clearLp();
      const p = e.changedTouches ? e.changedTouches[0] : e;
      const dx = p.clientX - startX, dy = p.clientY - startY;
      const adx = Math.abs(dx), ady = Math.abs(dy);
      if (Math.max(adx, ady) >= SWIPE) {
        if (h.current.onSwipe) {
          const dir = adx > ady ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
          h.current.onSwipe(dir, { x: startX, y: startY, target: e.target });
        }
        return;
      }
      // Treat as tap
      const now = Date.now();
      if (now - startT > 480) return; // was a long press
      if (h.current.onDoubleTap && now - lastTap < 280) {
        h.current.onDoubleTap({ x: startX, y: startY, target: e.target });
        lastTap = 0;
        return;
      }
      lastTap = now;
      if (h.current.onTap) h.current.onTap({ x: startX, y: startY, target: e.target });
    };
    el.addEventListener('touchstart', onDown, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    el.addEventListener('touchend', onUp, { passive: true });
    el.addEventListener('mousedown', onDown);
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseup', onUp);
    return () => {
      clearLp();
      el.removeEventListener('touchstart', onDown);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onUp);
      el.removeEventListener('mousedown', onDown);
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseup', onUp);
    };
  }, [ref]);
}

/* Drag tracking for Block Blast pieces / Diamond Rush swaps.

   #208 — the branch has to test LENGTH, not existence. `e.touches` on a
   TouchEvent is always a TouchList, and a TouchList is an object, so the old
   `e.touches ? …` was true even when it was EMPTY — which is exactly what
   `touchend` carries: the finger that just lifted is in `changedTouches`, and
   `touches` holds the fingers still down, i.e. none.

   So every touch DROP read `e.touches[0]` as undefined and threw
   `Cannot read properties of undefined (reading 'clientX')`. In Block Fit that
   throw happened inside the window `touchend` listener, before `commitDrop`
   ran: the piece was never placed and the cell stayed empty, which is the
   "dropped blocks fail to render, leaving empty slots" report. Because the
   throw also skipped `setDrag(null)`, the dragged piece's ghost stayed stuck
   on screen afterwards.

   Only touch was affected — a mouse drop has neither list and falls through to
   the event itself, which is why this was reported against mobile. */
function pointerXY(e) {
  const p = (e.touches && e.touches.length) ? e.touches[0]
    : (e.changedTouches && e.changedTouches.length) ? e.changedTouches[0]
    : e;
  return { x: p.clientX, y: p.clientY };
}
