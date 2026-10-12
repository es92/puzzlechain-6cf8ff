/* ============================================================
   Seeded PRNG — deterministic daily puzzle generation
   ============================================================ */
// mulberry32: a tiny, fast, well-distributed 32-bit seeded PRNG. Returns a
// function yielding floats in [0,1), same contract as Math.random() so it can
// be threaded through the existing generators.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Server-anchored UTC day number (offset = serverNow − clientNow) so the daily
// puzzle can't desync from the lock countdown on a skewed device clock.
function utcDayNum(offset) {
  const d = new Date(Date.now() + (offset || 0));
  return Math.floor(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000
  );
}

// Cheap string→int hash, used to salt the seed per game so the three puzzles
// don't share a PRNG sequence on a given day.
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Server-issued daily seeds (phase 2), keyed by gameId. Populated by loadDaily
// from GET /api/daily (or GET /api/public/daily when signed out) BEFORE any
// game can mount, and refreshed from the /start response so a client that sat
// on the lobby across the UTC reset still mounts the new day's board. When a
// seed is missing (partial deploy, network hiccup) the legacy day-number
// derivation below keeps the board renderable — and because the server's
// generation policy currently issues that same legacy value, both paths agree.
let SERVER_DAILY_SEEDS = {};
// True when the viewer is signed out (phase 8 guest mode). Set by loadDaily
// before any game can mount; hooks that talk to account-keyed endpoints
// (hint counters, autosave) consult it so a guest run never fires requests
// that can only 401.
let GUEST_MODE = false;
function serverDailySeed(gameId) {
  const s = SERVER_DAILY_SEEDS[gameId];
  return Number.isFinite(s) ? s : null;
}

// ---- Anonymous pending runs (phase 8, spec §6.10) ---------------------------
// A guest's finished daily run is held client-side as a pending run — one per
// game, overwritten across days, no server state at all. On the first
// AUTHENTICATED load the client posts each same-day run to
// POST /api/daily/:gameId/commit ("make it count") and clears the slot. A run
// not claimed before the UTC reset simply expires: yesterday's board can't
// join today's leaderboard.
const PENDING_RUNS_KEY = 'pc_pending_runs_v1';
function loadPendingRuns() {
  try {
    const m = JSON.parse(localStorage.getItem(PENDING_RUNS_KEY));
    return m && typeof m === 'object' ? m : {};
  } catch { return {}; }
}
function savePendingRun(gameId, run) {
  try {
    const m = loadPendingRuns();
    m[gameId] = run;
    localStorage.setItem(PENDING_RUNS_KEY, JSON.stringify(m));
  } catch {}
}
function clearPendingRun(gameId) {
  try {
    const m = loadPendingRuns();
    delete m[gameId];
    localStorage.setItem(PENDING_RUNS_KEY, JSON.stringify(m));
  } catch {}
}

/* Daily difficulty bands (#331). The daily's band is chosen on the pre-game
   screen and stored on the attempt row; Easy/Hard deal a different board from
   the same day's anchor, Normal is byte-identical to the pre-band deal so
   every existing seeded board and check keeps passing. DAILY_BAND_MULT scales
   what a win pays (mirrored as a doc constant next to ARCADE_BAND_MULT in
   server.js — the server stores the client's final score as-is, exactly as it
   does for the streak multiplier). */
const DAILY_BANDS = ['easy', 'normal', 'hard'];
const DAILY_BAND_MULT = { easy: 0.8, normal: 1.0, hard: 1.25 };
const isDailyBand = (b) => DAILY_BANDS.indexOf(b) !== -1;

// The day's numeric anchor for (game, band). Prefers the server-issued seed;
// falls back to the legacy UTC-day derivation. Easy/Hard mix the anchor with
// the game id and the band, so one seed row still anchors all three boards and
// Normal (band undefined/null/'normal') hashes to exactly the pre-band seed.
function dailySeedFor(offset, gameId, band) {
  const srv = serverDailySeed(gameId);
  const base = srv != null ? srv : ((utcDayNum(offset) + hashStr(gameId)) >>> 0);
  const mixed = (band === 'easy' || band === 'hard')
    ? hashStr(gameId + ':daily:' + band) : 0;
  return (base + mixed) >>> 0;
}

// A fresh seeded RNG for (today, gameId, band). Everyone on the same UTC day
// gets the identical board for each game — the precondition for a fair
// leaderboard. Prefers the server-issued seed; mulberry32 stays the downstream
// generator either way, so game code is untouched by the server-seed flip.
function dailyRng(offset, gameId, band) {
  return mulberry32(dailySeedFor(offset, gameId, band));
}

/* ============================================================
   Play-mode seeding (#176)
   ============================================================
   Every generator in this app already takes an rng, which is what makes all
   three modes fall out of one helper rather than three code paths per game:

     daily   — today's server-issued seed. Everyone gets the same board.
     story   — derived from (game, band), so a rung is STABLE: leave it and
               come back and it is the same board, which is what makes
               "clear this band" a thing you can retry rather than a reroll.
     arcade  — fresh per run. The seed is returned so the finished run can be
               stored and replayed: a run is a seed plus a move list, not a
               board, which is why run history costs a few hundred bytes.

   Returns { rng, seed } — `seed` is null for the daily, whose seed already
   lives server-side on the daily_seeds row.
   ============================================================ */
/* ============================================================
   Rated seed corpora (#176)
   ============================================================
   Most games rate a board in milliseconds and generate-and-check at mount.
   Solitaire cannot: deciding whether a Klondike deal is winnable is a search,
   not a deduction. So that work happens OFFLINE (scripts/rate-seeds.js) and
   what ships is not a board but a rated SEED — the deal is re-derived from it
   on demand, which is why a corpus of hundreds of deals is tens of kilobytes.

   Fetched lazily and cached per game, and every caller degrades gracefully: if
   the corpus has not arrived, the game deals from an ordinary seed instead. A
   slow network costs you the difficulty guarantee, never the game.
   ============================================================ */
/* Two corpus SHAPES, because two different things are expensive.
     `seeds`  — [[seed, band], ...]. The board is cheap to re-derive from the
                seed; what cost a search was RATING it (Klondike, Spider).
     `levels` — [[{g, p}, ...], ...] indexed by band. The content itself had to
                be searched for and cannot be re-derived from a seed at all
                (Crate Push: Sokoban generation is a search either way).
   Both group by band and both are picked from with the same rng discipline. */
const CORPUS_GAMES = new Set(['klondike', 'spider', 'cratepush']);
const _corpusCache = {};
const _corpusPending = {};

function loadCorpus(gameId) {
  if (!CORPUS_GAMES.has(gameId)) return Promise.resolve(null);
  if (_corpusCache[gameId]) return Promise.resolve(_corpusCache[gameId]);
  if (_corpusPending[gameId]) return _corpusPending[gameId];
  _corpusPending[gameId] = fetch(`/corpus/${gameId}.json`)
    .then(r => (r.ok ? r.json() : null))
    .then(j => {
      if (j && Array.isArray(j.seeds)) {
        // Group once, so a pick is O(1) rather than a scan per mount.
        const byBand = {};
        for (const [seed, band] of j.seeds) (byBand[band] = byBand[band] || []).push(seed);
        _corpusCache[gameId] = { ...j, byBand };
      } else if (j && Array.isArray(j.levels)) {
        const byBand = {};
        j.levels.forEach((list, band) => { byBand[band] = list; });
        _corpusCache[gameId] = { ...j, byBand };
      }
      return _corpusCache[gameId] || null;
    })
    .catch(() => null);
  return _corpusPending[gameId];
}

/* Pick a rated seed for a band. `rng` chooses WITHIN the band, so a story rung
   is stable (its rng is derived from the band) while an arcade run is not.
   Returns null when the corpus is unavailable — callers fall back. */
function corpusPick(gameId, band, rng) {
  const c = _corpusCache[gameId];
  if (!c || !c.byBand) return null;
  const nBands = c.bands || 1;
  const idx = Math.max(0, Math.min(nBands - 1, band));
  // Walk outward if the requested band is empty, so a sparse corpus still
  // returns something of roughly the right difficulty.
  for (let d = 0; d < nBands; d++) {
    for (const b of [idx - d, idx + d]) {
      const list = c.byBand[b];
      if (list && list.length) return list[Math.floor(rng() * list.length)];
    }
  }
  return null;
}
const corpusSeed = corpusPick;    // `seeds`-shaped corpora
const corpusLevel = corpusPick;   // `levels`-shaped corpora
const corpusBands = (gameId) => (_corpusCache[gameId] ? _corpusCache[gameId].bands || 0 : 0);

/* WHEN "THE RUN ENDED" IS NOT "THE RUN SUCCEEDED".

   The real-time games (Marble Loop, Bounce, Snake) have always reported BOTH
   endings through onWin with a "Game Over" label, and that was right: the
   score IS the result, so there is nothing to lose and a loss overlay would be
   the wrong furniture. Story mode is the one place that reading breaks — a
   rung is ticked off by onWin, so draining the track would tick the rung you
   just failed. reportRunEnd routes an UNCLEARED STORY run to onLose (which
   pays nothing and leaves the rung unticked) and leaves every other mode
   exactly as it was, including arcade: reaching the end of an arcade run is
   how an arcade run is supposed to end, and its score should still count. */
function reportRunEnd(opts, score, steps, secs, meta) {
  const { cleared, playMode, onWin, onLose } = opts;
  if (!cleared && playMode === 'story' && onLose) {
    onLose(steps, secs, { ...(meta || {}), score });
    return;
  }
  if (onWin) onWin(score, steps, secs, meta);
}

/* THE ARCADE SEED BELONGS TO THE RUN, NOT TO THE GENERATOR.

   Rolling it inside modeSeed was enough to make a board, and not enough for
   anything else: a game that generated its own seed and dropped it left the
   finish with nothing to record, so the "history to share and replay" arcade
   is supposed to have had no board to replay. Worse, several games call
   modeSeed more than once for one run (Marble Loop derives its colour stream
   from a second call) and would have got two unrelated boards.

   So the SHELL opens a run and the generator reads it. A module-scope value is
   the right shape here because exactly one run is live at a time — the same
   reason `PAL` is module-scope — and it means the ~20 games that call
   modeSeed(mode, id, band, offset) did not have to learn about seeds at all. */
let _arcadeRunSeed = null;
function beginArcadeRun(seed) {
  _arcadeRunSeed = Number.isFinite(seed)
    ? (seed >>> 0)
    // Math.random is correct here and nowhere else in a generator: an arcade
    // board is SUPPOSED to differ per player and per run.
    : (Math.floor(Math.random() * 4294967295) >>> 0);
  return _arcadeRunSeed;
}
function currentArcadeSeed() { return _arcadeRunSeed; }
function endArcadeRun() { _arcadeRunSeed = null; }

/* LOCAL RUN SAVES — story and arcade (#187 / #196).

   "Only a daily resumes" is a rule about the DAILY ATTEMPT ROW, not about
   whether a player gets to keep their work. savedProgress/onSaveProgress are
   that row: a story run writing into it 409s, and reading from it would
   hydrate a half-finished daily into a rung that is meant to be a fixed,
   retryable deal. Both of those reasons are about the SERVER. Neither is a
   reason for a story rung to lose ten minutes of deduction to a reload, which
   is what it did — reported as a "crash" (#187) and as "spontaneous reloads"
   (#196), and in both cases the board simply came back empty because nothing
   had ever been written down.

   So story and arcade get a save that never goes near the server: one record
   per (game, mode, band) in localStorage, device-local like every other pref
   here. The game components need no changes at all — they already know how to
   hydrate from savedProgress and to write through onSaveProgress, and this
   just gives those two props something to point at outside a daily.

   THE BOARD HAS TO COME BACK IDENTICAL or a saved position is nonsense, and
   that is why the two modes are saved differently:
     story  — the seed has no day component (see modeSeed), so the rung
              rebuilds the same board on any day, from any device. Nothing
              extra to record.
     arcade — the seed belongs to the RUN. A resumed run therefore has to
              restore the seed it was dealt, and the run id it was anchored
              with, or the finish would look like a different run to the
              server. Both go in the record.

   `dayNum` is stamped on the way OUT, because the games' hydration gate is
   `savedProgress.dayNum === utcDayNum(offset)` — a same-BOARD check that a
   daily expresses as a same-day one. A story or arcade board is not
   day-scoped, so the honest answer to "is this save for the board I am about
   to build" is yes, and stamping it says so in the only vocabulary the twenty
   game components already speak. */
const RUN_SAVE_PREFIX = 'puzzlechain_run_v1:';
const RUN_SAVE_MAX_AGE_MS = 30 * 24 * 3600 * 1000;

function runSaveKey(gameId, playMode, band) {
  return RUN_SAVE_PREFIX + gameId + ':' + playMode + ':' + (band == null ? '-' : band);
}

function readRunSave(gameId, playMode, band) {
  if (!gameId || (playMode !== 'story' && playMode !== 'arcade')) return null;
  try {
    const raw = localStorage.getItem(runSaveKey(gameId, playMode, band));
    if (!raw) return null;
    const rec = JSON.parse(raw);
    if (!rec || !rec.progress) return null;
    if (rec.savedAt && Date.now() - rec.savedAt > RUN_SAVE_MAX_AGE_MS) {
      clearRunSave(gameId, playMode, band);
      return null;
    }
    return rec;
  } catch (_) { return null; }
}

function writeRunSave(gameId, playMode, band, rec) {
  if (!gameId || (playMode !== 'story' && playMode !== 'arcade')) return;
  try {
    localStorage.setItem(runSaveKey(gameId, playMode, band), JSON.stringify(rec));
  } catch (_) { /* quota or a private window: a lost resume is not worth throwing over */ }
}

function clearRunSave(gameId, playMode, band) {
  try { localStorage.removeItem(runSaveKey(gameId, playMode, band)); } catch (_) {}
}

// The shape the game components expect, from the record we stored.
function hydrateRunSave(rec, offset) {
  if (!rec || !rec.progress) return null;
  return {
    ...rec.progress,
    dayNum: utcDayNum(offset),
    steps: Number.isFinite(rec.steps) ? rec.steps : 0,
    elapsedSecs: Number.isFinite(rec.elapsedSecs) ? rec.elapsedSecs : 0,
  };
}

/* `?resumedemo=1` — arrive on a story or arcade board that is already part
   way through. A half-played run is reachable no other way: you would have to
   play one and then reload, and neither a proposal check nor a screenshot can
   play. This writes the same localStorage record a real run leaves and lets
   the ordinary resume path pick it up, so what it demonstrates is the real
   mechanism rather than a mock of it — and it writes NOTHING to the server,
   because this feature never touches the server.

   Deliberately generic: it carries the step count and the clock and an
   otherwise empty progress object, so it works on any game. A board that does
   not recognise the (empty) progress falls back to a fresh deal and still
   comes up mid-run on the clock, which is the thing being asserted — that a
   story or arcade run hydrates from a local record at all. */
function seedResumeDemo(offset) {
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get('resumedemo') !== '1') return;
    const gameId = q.get('game');
    const mode = q.get('pmode');
    if (!gameId || (mode !== 'story' && mode !== 'arcade')) return;
    const bandParam = q.get('level') || q.get('band');
    const band = mode === 'arcade'
      ? (bandParam || 'normal')
      : Math.max(0, (parseInt(bandParam, 10) || 1) - 1);
    if (readRunSave(gameId, mode, band)) return;   // a real run wins
    writeRunSave(gameId, mode, band, {
      v: 1, progress: { dayNum: utcDayNum(offset) },
      steps: 12, elapsedSecs: 214, savedAt: Date.now(), seed: null, runId: null,
    });
  } catch (_) {}
}

function modeSeed(playMode, gameId, band, offset) {
  if (playMode === 'story') {
    const s = (hashStr(gameId + ':story:' + band) >>> 0);
    return { rng: mulberry32(s), seed: s };
  }
  if (playMode === 'arcade') {
    // A run that somehow reaches here unopened still gets a board; it just
    // cannot be replayed, which is strictly better than not starting.
    const s = _arcadeRunSeed != null ? _arcadeRunSeed : beginArcadeRun();
    return { rng: mulberry32(s), seed: s };
  }
  // The daily branch takes the band (string, or null) so Easy/Hard get their
  // own mixed deal; Normal hashes to the pre-band seed (dailySeedFor). seed
  // stays null on purpose: some play-rngs (Zuma's) treat a non-null seed as
  // "arcade board", and the dailies want an rng, not a stored seed.
  return { rng: dailyRng(offset, gameId, band), seed: null };
}


/* #185 — the one-line "what changes on this rung" note. Every story ladder
   ramps the same way (the rungs are a difficulty ladder by construction), so
   this is a position-on-the-ladder sentence rather than a per-game table: one
   source, shared by the pre-game band picker and the auto-advance banner, so
   the two can never describe the same rung differently. `band` is 0-based. */
function storyBandNote(band, total) {
  const n = Number(total) || 0;
  const i = Number(band) || 0;
  if (n <= 1) return 'One band — clear it to finish the ladder.';
  if (i <= 0) return 'The gentlest rung — a warm-up for the ladder.';
  if (i >= n - 1) return 'The final rung — the hardest this ladder gets.';
  const frac = i / (n - 1);
  if (frac < 0.34) return 'A step up: a little bigger, a little tighter.';
  if (frac < 0.67) return 'Mid-ladder: less room for a wasted move.';
  return 'Near the top: tight margins, no easy openings.';
}

/* What a whole ladder pays, for the completion card. Mirrors
   STORY_TOTAL_POINTS / storyBandAward in server.js — the server is still the
   only thing that AWARDS anything; this recomputes the same sum so the card
   can name it without a round-trip. Keep the constant and the formula in step
   with server.js if the ladder is ever rebalanced. */
const STORY_TOTAL_POINTS = 2000;
function storyLadderTotal(total) {
  const n = Number(total) || 0;
  if (n <= 0) return 0;
  const denom = (n * (n + 1)) / 2;
  let sum = 0;
  for (let b = 0; b < n; b++) sum += Math.round(STORY_TOTAL_POINTS * ((b + 1) / denom));
  return sum;
}

// Periodically persist a game's in-progress state so a resumed attempt picks up
// the exact board, step count, and accumulated timer. `getState()` returns
// `{ progress, steps, secs }`; it's read through a ref so the interval and the
// unmount-flush always see the latest values without re-subscribing. Games also
// call `onSaveProgress` directly on each move for immediate persistence; this
// hook covers idle timer advance and the leave-the-tab case.
function useAutosave(onSaveProgress, getState, active) {
  const ref = useRef({});
  ref.current = { onSaveProgress, getState, active };
  useEffect(() => {
    const flush = () => {
      const cur = ref.current;
      if (!cur.active || !cur.onSaveProgress) return;
      const s = cur.getState();
      cur.onSaveProgress(s.progress, s.steps, s.secs);
    };
    const id = setInterval(flush, 10000);
    const onVis = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
      flush(); // best-effort save when leaving the game screen
    };
  }, []);
}

/* ============================================================
   Shared localStorage "recent results" history
   ============================================================ */
// Newest-first list of finished-game summaries, persisted per game under its
// own storage key with a hard length cap. Several classic games (minesweeper,
// mancala, 2048, knight's tour) each used to carry an identical copy of this
// load/unshift/cap/save pair — collapsed here into one shared implementation
// they delegate to (the per-game wrappers keep their names + keys, so behavior
// is byte-identical: same key, same MAX cap, newest-first, errors swallowed).
function loadHistory(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); }
  catch { return []; }
}
function saveHistory(key, entry, max) {
  const h = loadHistory(key);
  h.unshift(entry);
  if (h.length > max) h.length = max;
  try { localStorage.setItem(key, JSON.stringify(h)); } catch {}
}

/* ============================================================
   Platform API helpers — forward the iframe JWT
   ============================================================ */
// The shell injects ?token=… on the initial iframe load; capture it once
// and forward it on every API call via the x-usernode-token header.
const USERNODE_TOKEN = new URLSearchParams(window.location.search).get('token') || '';

/* Copy a line to the clipboard, degrading to a no-op where it is unavailable
   (an insecure origin, or a browser that withholds it). Every caller shows its
   own "copied" feedback, so a silent failure only costs the confirmation. */
function copyText(text) {
  try { return navigator.clipboard.writeText(text).catch(() => {}); }
  catch { return Promise.resolve(); }
}

// Coarse relative time for history rows — "3d", "2h", "just now". Deliberately
// coarse: a run list wants scannable ages, not timestamps.
function cgAgo(when) {
  const t = new Date(when).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 86400 * 30) return Math.floor(s / 86400) + 'd ago';
  return new Date(t).toLocaleDateString();
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(USERNODE_TOKEN ? { 'x-usernode-token': USERNODE_TOKEN } : {}),
      ...(opts.headers || {}),
    },
  });
  let body = null;
  try { body = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, body };
}
// Shared hint bar for every daily puzzle. Hints are FREE (the MATCH currency
// is retired) but capped per day and counted server-side. Behaviour-free: the
// parent owns the hint state and passes a `buy` handler (kept identical across
// all four daily games so the control looks and feels the same everywhere).
/* HintBar retired (controls wave) — hint buttons draw on each game
   frame via the cui kit; useDailyHints below is unchanged. */

// Shared hint state hook for the daily games that use a generic "reveal"
// (Sudoku cell, Word Hunt start, Tile Match nudge). Reads today's
// server-authoritative count and performs the atomic capped use — free, no
// currency involved. `onReveal(usedIndex)` applies the game-specific reveal
// and should return false to abort (e.g. nothing left to reveal). Crypto
// Wordle keeps its own bespoke per-round logic and does not use this hook.
function useDailyHints({ gameId, maxHints }) {
  const { useState, useEffect } = React;
  const [hintsPurchased, setHintsPurchased] = useState(0);
  const [buying, setBuying] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (GUEST_MODE) return; // guests count hints locally — no account counter
    let alive = true;
    (async () => {
      const { ok, body } = await api(`/api/daily/${gameId}/hint`);
      if (!alive || !ok || !body) return;
      if (Number.isFinite(body.hintsPurchased)) setHintsPurchased(body.hintsPurchased);
    })();
    return () => { alive = false; };
  }, []);

  const exhausted = maxHints != null && hintsPurchased >= maxHints;
  const hintsLeft = maxHints != null ? Math.max(0, maxHints - hintsPurchased) : null;

  // onReveal(index) must apply the reveal and return true; returning false
  // aborts (the server counter has already advanced, which only means one
  // fewer free hint today — never a lost purchase).
  const buy = async (onReveal) => {
    if (buying || exhausted) return;
    // Guest mode (phase 8): hints work, counted locally for this run only —
    // there's no account to key the server's daily counter to, and the POST
    // would just 401. Same per-board cap as signed-in play.
    if (GUEST_MODE) {
      const applied = onReveal ? onReveal(hintsPurchased) : true;
      if (applied === false) return;
      setHintsPurchased((n) => n + 1);
      return;
    }
    setBuying(true);
    setMsg('');
    const { ok, status, body } = await api(`/api/daily/${gameId}/hint`, {
      method: 'POST', body: JSON.stringify({ maxHints }),
    });
    setBuying(false);
    if (ok && body) {
      const idx = (Number.isFinite(body.hintsPurchased) ? body.hintsPurchased : hintsPurchased + 1) - 1;
      const applied = onReveal ? onReveal(idx) : true;
      if (applied === false) return;
      if (Number.isFinite(body.hintsPurchased)) setHintsPurchased(body.hintsPurchased);
      return;
    }
    if (status === 409 && body && body.code === 'no_more_hints') {
      setMsg('No more hints');
    } else {
      setMsg('Could not use hint');
    }
  };

  return { hintsPurchased, hintsLeft, exhausted, buying, msg, buy };
}

// HH:MM:SS for a millisecond remainder.
function fmtCountdown(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
}

// "12h 45m" for a millisecond remainder — hours + minutes only.
function fmtHoursMins(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return `${h}h ${m}m`;
}

/* ============================================================
   Streak → score multiplier tiers
   ============================================================ */
// Loyal daily players earn more on every win. Tiers are listed high→low;
// the first whose `min` the streak meets wins. Centralized here so the
// breakpoints/multipliers are a one-line balance change. The 5-day→1.2x and
// 10-day→1.5x breakpoints are the headline; 3-day and 20-day fill the ramp.
const STREAK_TIERS = [
  { min: 20, mult: 2.0 },
  { min: 10, mult: 1.5 },
  { min: 5,  mult: 1.2 },
  { min: 3,  mult: 1.1 },
  { min: 0,  mult: 1.0 },
];

/* ============================================================
   What's new — in-repo weekly changelog (newest first).
   Add an entry (with a fresh id) whenever a player-visible change
   ships; the Home "New this week" strip shows the newest entry's
   headline until dismissed (dismissal is per-browser, keyed on the
   entry id in localStorage, like the how-to first-open state).
   ============================================================ */
const CHANGELOG = [
  {
    id: 'w2026-10-05',
    weekOf: 'Week of October 5, 2026',
    items: [
      'New game: Jet Run — steer a fighter jet through the gates, dodge the storm clouds and grab the fuel stars, with Daily, Story and Arcade modes.',
    ],
  },
  {
    id: 'w2026-08-17',
    weekOf: 'Week of August 17, 2026',
    items: [
      'Most games now have three ways to play: today’s daily, a Story mode you clear level by level, and endless Arcade with Easy / Normal / Hard.',
      'Story pays the first time you clear a level. Every game’s story is worth the same in total, however many levels it has.',
      'Arcade keeps a run history you can share or replay, and pays when you beat your own best or crack the top 10, top 3 or #1.',
      'Seven classics gained a daily: 2048, Knight’s Tour, Block Fit, Diamond Rush, Marble Loop, Hash Rush and Match-3.',
      'Crate Push now has 200 generated warehouses instead of 10 hand-built ones, each one showing the shortest solution it has.',
      'Marble Loop builds a new track every run rather than reusing the same two.',
      'Sudoku offers both the 9×9 grid and the 6×6 mini board from one card.',
    ],
  },
  {
    id: 'w2026-08-03',
    weekOf: 'Week of August 3, 2026',
    items: [
      'Snake, Bounce, Tile Match, Mine Finder and Mancala are one card each now — one button for free play, one for today’s challenge.',
      'Finishing a daily no longer greys out the whole game: the free-play button stays live, and the daily button shows your score and the countdown.',
    ],
  },
  {
    id: 'w2026-07-27',
    weekOf: 'Week of July 27, 2026',
    items: [
      'Nonogram, Mine Finder and Drop Stack now draw properly on mobile — no more black boards.',
      'Taps land instantly across every game, with a visible press the moment your finger touches down.',
      'Nothing scrolls while you play any more, and the Daily Cipher keyboard always stays on screen.',
      'Back works everywhere — including your phone’s back gesture, and after viewing a finished board.',
      'Come back to a game you finished and you get your result and the board you solved, not just a countdown.',
      'Play any daily again for fun — shown but never scored.',
      '2048 swipes the right way up, and tiles slide instead of teleporting.',
      'Mine Finder Classic gains a flag button and tap-a-number-to-clear.',
      'Hash Rush is drag-to-steer. Klondike and Spider can be dragged, and can be given up.',
      'Daily Cipher spans four themes and 180 words — no repeats for over a month.',
      'Word Search grows to a 10×10 grid with more words to find.',
      'Checkers, Reversi, Four in a Row, Gomoku and Ludo gain Versus Bot and pass-and-play.',
      'Lost an online room? Your rooms are listed with one-tap Rejoin, and every match can be ended.',
      'Mahjong Solitaire gains undos, hints, a safe shuffle and six rotating board shapes.',
      'Daily Bounce gains power-ups — the same drops from the same bricks for everyone, every day.',
      'Match-3 is playable again and looks like the rest of the app.',
    ],
  },
  {
    id: 'w2026-07-20',
    weekOf: 'Week of July 20, 2026',
    items: [
      'New daily: Word Sprint — trace neighboring letters, find every word you can in 90 seconds.',
      'Sudoku goes full-size: pick 9×9 Classic (double points) or keep the 6×6 Mini.',
      'Daily Snake and Daily Bounce join the daily rotation — same run for everyone, once a day.',
      'Ludo tables now seat 2–4 players.',
      'Fresh names, same games: Snakes & Ladders, Block Fit, Word Search, and Mine Finder Classic.',
      'PuzzleChain is now Game Corner — same games, one name everywhere.',
      'Streaks now follow the Game of the Day: finish the featured game to keep your streak (every day you already earned still counts).',
      'Share cards include your rank on today’s board.',
      'Online matches now time out — 48 quiet hours forfeits the turn.',
      'The Community Feed retired; game chat, share cards, and Friends leaderboards are the social corner now.',
    ],
  },
  {
    id: 'w2026-07-13',
    weekOf: 'Week of July 13, 2026',
    items: [
      'Play without signing in — today’s boards are open to everyone, and signing in before midnight UTC makes a finished guest run count.',
      'A warmer, newspaper-style look for the whole app.',
    ],
  },
  {
    id: 'w2026-07-06',
    weekOf: 'Week of July 6, 2026',
    items: [
      'Game of the Day: one featured board everyone plays, front and center on Home.',
      'Eight new daily puzzles, five new board games, and a public chat room for every game.',
    ],
  },
];

// Bottom-sheet listing the recent weekly changes. Presented like the chat
// panel (shared overlay idiom); pure display, no server state.
function WhatsNewSheet({ onClose }) {
  return (
    <div className="chat-overlay" onClick={onClose}>
      <div className="chat-panel wn-panel" onClick={(e) => e.stopPropagation()}>
        <div className="chat-head">
          <div className="chat-title">🗞️ What&apos;s new</div>
          <button className="chat-close" onClick={onClose}>✕</button>
        </div>
        <div className="chat-list wn-list">
          {CHANGELOG.map((entry) => (
            <div key={entry.id} className="wn-week">
              <div className="wn-week-title">{entry.weekOf}</div>
              <ul className="wn-items">
                {entry.items.map((it, i) => <li key={i}>{it}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* App-wide Settings sheet. Same bottom-sheet chrome as the chat / what's-new
   sheets; reuses CgSettings so the theme + feedback prefs are defined once and
   rendered identically here and in a classic game's ☰ → Settings tab. */
function SettingsSheet({ onClose }) {
  return (
    <div className="chat-overlay" onClick={onClose}>
      <div className="chat-panel settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="chat-head">
          <div className="chat-title">⚙ Settings</div>
          <button className="chat-close" onClick={onClose}>✕</button>
        </div>
        <div className="chat-list settings-list">
          <CgSettings />
        </div>
      </div>
    </div>
  );
}

// Multiplier for a streak length (consecutive days, including the current win).
function streakMultiplier(streak) {
  for (const t of STREAK_TIERS) if (streak >= t.min) return t.mult;
  return 1.0;
}

/* ============================================================
   Streak badges — named milestones unlocked at consecutive-day
   thresholds. The single source of truth for badge copy/icons;
   the server (STREAK_BADGE_DAYS in server.js) persists the same day
   thresholds as streak_milestone achievements so earned badges
   survive a streak reset. Keep the `min` list in sync across both.
   ============================================================ */
const STREAK_BADGES = [
  { min: 3,   id: 'on-fire',     name: 'On Fire',          icon: '🔥' },
  { min: 7,   id: 'week',        name: 'Week Warrior',     icon: '⚡' },
  { min: 30,  id: 'monthly',     name: 'Monthly Master',   icon: '🌟' },
  { min: 50,  id: 'half-cent',   name: 'Half-Century',     icon: '💎' },
  { min: 100, id: 'centurion',   name: 'Centurion',        icon: '👑' },
  { min: 180, id: 'half-year',   name: 'Half-Year Hero',   icon: '🛡️' },
  { min: 365, id: 'year-legend', name: 'Year-Long Legend', icon: '🏆' },
];

// Look up a badge definition by its day threshold (used to render the
// permanent earned-badge list the server returns as `badges`).
function badgeForDays(days) {
  return STREAK_BADGES.find(b => b.min === days) || null;
}

// All badges a live streak currently satisfies (streak >= min), low→high.
function streakBadges(streak) {
  return STREAK_BADGES.filter(b => streak >= b.min);
}

// The highest badge a live streak has reached, or null below the first tier.
function activeBadge(streak) {
  const earned = streakBadges(streak);
  return earned.length ? earned[earned.length - 1] : null;
}

// Does this win's streak land EXACTLY on a badge threshold? (the "just
// unlocked" celebration fires only on the day the milestone is reached.)
function justUnlockedBadge(streak) {
  return STREAK_BADGES.find(b => b.min === streak) || null;
}

// The nearest streak badge the player has NOT yet reached (lowest min > streak),
// or null when every streak tier is already earned. Used for the "X/Y days →
// Name" progress hint so a player who finished today sees concrete progress
// even when no badge unlocked this run.
function nextStreakBadge(streak) {
  return STREAK_BADGES.find(b => b.min > streak) || null;
}

// The nearest lifetime-solve milestone the player has NOT yet reached
// (lowest count > solveCount), or null when all are earned. Drives the
// "X/Y solves → Name" progress hint.
function nextSolveMilestone(solveCount) {
  return SOLVE_MILESTONE_BADGES.find(b => b.count > (solveCount || 0)) || null;
}

/* ============================================================
   Achievement badges — non-streak milestones the server awards
   in /api/daily/:gameId/finish and persists in user_achievements.
   This is the client's source of truth for badge copy/icons; the
   server (ACHIEVEMENT_BADGE_TYPES + criteria in server.js) owns when
   each is awarded. Keep `type` values in sync across both files.
   `solve_milestone` is parameterized by a `count` (10/50/100).
   ============================================================ */
const ACHIEVEMENT_BADGES = [
  { type: 'first_solve', name: 'First Solve',   icon: '🎉', desc: 'Solved your first daily puzzle' },
  { type: 'speed_demon', name: 'Speed Demon',   icon: '⚡', desc: 'Solved a daily in under 60s' },
  { type: 'flawless',    name: 'Flawless',      icon: '✨', desc: 'Solved with no wasted moves' },
  { type: 'daily_sweep', name: 'Daily Sweep',   icon: '🧹', desc: 'Solved every daily puzzle in one day' },
  { type: 'podium',      name: 'Podium Finish', icon: '🥇', desc: 'Finished #1 on a daily leaderboard' },
];
// Lifetime solve-count milestones (a single `solve_milestone` type, many counts).
const SOLVE_MILESTONE_BADGES = [
  { count: 10,  name: 'Solver',      icon: '🔟', desc: 'Solved 10 daily puzzles' },
  { count: 50,  name: 'Dedicated',   icon: '🏅', desc: 'Solved 50 daily puzzles' },
  { count: 100, name: 'Centenarian', icon: '💯', desc: 'Solved 100 daily puzzles' },
];

// One badge per Story ladder (server type `story_complete`, parameterised by
// metadata.gameId — the same trick solve_milestone plays with metadata.count).
// The chip's identity IS the game, so name and icon come from the registry
// rather than a second hand-maintained table that would drift from it.
// Read at render time only, so GAMES loading later in ORDER is fine.
function storyBadgeChip(gameId) {
  if (!gameId) return null;
  const g = (typeof GAMES !== 'undefined' ? GAMES : []).find(x => x.id === gameId);
  if (!g) return null;
  return {
    key: 'story-' + gameId,
    icon: g.icon,
    name: g.name + ' Story',
    sub: 'Cleared every band of the ' + g.name + ' story ladder',
  };
}

// Resolve a freshly-awarded achievement (from finish's newAchievements) to its
// badge definition for the "just unlocked" overlay pop.
function achievementBadgeFor(ach) {
  if (!ach || !ach.type) return null;
  if (ach.type === 'solve_milestone') {
    const c = ach.metadata && ach.metadata.count;
    return SOLVE_MILESTONE_BADGES.find(b => b.count === c) || null;
  }
  // Server-confirmed streak milestones arrive in newAchievements as
  // { type: 'streak_milestone', metadata: { streak: <days> } }; resolve to the
  // STREAK_BADGES entry so the win overlay can celebrate it like any other
  // badge. We normalise its shape to { name, icon } (STREAK_BADGES has no
  // `desc`), so the overlay can render it uniformly.
  if (ach.type === 'streak_milestone') {
    const days = ach.metadata && +ach.metadata.streak;
    const b = STREAK_BADGES.find(x => x.min === days);
    return b ? { ...b, desc: `${b.min}-day streak` } : null;
  }
  // Story-ladder completion: one type, many games. Resolve through the registry
  // so the celebration names the ladder the player just finished.
  if (ach.type === 'story_complete') {
    const gid = ach.gameId || (ach.metadata && ach.metadata.gameId);
    const chip = storyBadgeChip(gid);
    return chip ? { name: chip.name, icon: chip.icon, desc: chip.sub } : null;
  }
  return ACHIEVEMENT_BADGES.find(b => b.type === ach.type) || null;
}

// Merge newly-awarded achievements into the { types, milestones } client state.
function mergeAchievements(prev, newAch) {
  const types = new Set((prev && prev.types) || []);
  const milestones = new Set((prev && prev.milestones) || []);
  const stories = new Set((prev && prev.stories) || []);
  for (const a of newAch || []) {
    if (!a || !a.type) continue;
    types.add(a.type);
    if (a.type === 'solve_milestone' && a.metadata && Number.isFinite(+a.metadata.count)) {
      milestones.add(+a.metadata.count);
    }
    if (a.type === 'story_complete') {
      const gid = a.gameId || (a.metadata && a.metadata.gameId);
      if (gid) stories.add(gid);
    }
  }
  return {
    types: Array.from(types),
    milestones: Array.from(milestones).sort((a, b) => a - b),
    stories: Array.from(stories).sort(),
  };
}

// Live countdown to `nextResetUtc`, driven by server time (Date.now()+offset)
// so a wrong device clock can't unlock early. Calls onExpire once at zero.
function useCountdown(nextResetUtc, offset, onExpire) {
  const [now, setNow] = useState(() => Date.now() + offset);
  const fired = useRef(false);
  useEffect(() => {
    fired.current = false;
    setNow(Date.now() + offset);
    const id = setInterval(() => setNow(Date.now() + offset), 1000);
    return () => clearInterval(id);
  }, [nextResetUtc, offset]);
  const target = nextResetUtc ? new Date(nextResetUtc).getTime() : 0;
  const remaining = target - now;
  useEffect(() => {
    if (nextResetUtc && remaining <= 0 && !fired.current) {
      fired.current = true;
      onExpire && onExpire();
    }
  }, [remaining, nextResetUtc]);
  return fmtCountdown(remaining);
}
