const express = require('express');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const dapp = require('./lib/dapp');
const boardRules = require('./lib/board-rules');

// The platform's address, injected by the platform at deploy (#2047). Never
// written out here: a hardcoded hostname is what broke this app when the
// platform moved domains. Empty only outside the platform (local runs).
const PLATFORM_ORIGIN = (process.env.USERNODE_PLATFORM_ORIGIN || '').replace(/\/+$/, '');
// Mancala's pure rules moved to the rules registry (phase 5); keep the local
// names so the routes / bot AI / ZK replay / daily challenge stay untouched.
const { srvMncOpposite, srvMncDistribute, srvMncApplyMove } = boardRules;

const app = express();
const port = process.env.PORT || 3000;
const USERNODE_JWT_PUBLIC_KEY = process.env.USERNODE_JWT_PUBLIC_KEY;
const IS_STAGING = process.env.USERNODE_ENV === 'staging';

// App identity secrets (APP_PUBKEY, APP_SECRET_KEY) are declared in dapp.json
// and available via process.env for cryptographic operations when needed.

// ---- dApps-integration app identity ---------------------------------------
// APP_PUBKEY / APP_SECRET_KEY identify this app to the dApps-integration
// surface and sign integration payloads. The feature is OPTIONAL and must
// degrade gracefully: a blank/missing APP_SECRET_KEY (e.g. a staging preview
// whose manifest staging_default is "") MUST NOT crash the server on boot.
// Instead the feature is treated as disabled — signing is skipped and the
// affected routes report it as unavailable so the UI can hide/disable it.
const APP_PUBKEY     = (process.env.APP_PUBKEY || '').trim();
const APP_SECRET_KEY = (process.env.APP_SECRET_KEY || '').trim();
const APP_INTEGRATION_ENABLED = APP_SECRET_KEY.length > 0;

if (!APP_INTEGRATION_ENABLED) {
  console.warn('[integration] APP_SECRET_KEY is empty — dApps integration disabled (signing/integration calls skipped).');
}

// Sign an integration payload with the app secret. Only ever called when
// APP_INTEGRATION_ENABLED is true; uses an opaque HMAC so any secret format is
// safe (no key parsing that could throw on a non-hex value).
function signIntegrationPayload(payload) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return crypto.createHmac('sha256', APP_SECRET_KEY).update(body).digest('hex');
}


/* Server-authoritative daily hint cap. Hints are FREE (the MATCH currency is
   retired) but still capped and counted server-side so the count survives
   reloads and a client can't reveal more clues than the day's puzzle carries.

   #193 — this used to REDERIVE the day's round count from a seeded draw,
   mirroring a frontend that drew R off dailyRng before picking any word. The
   frontend stopped doing that: the count is a fixed CW_ROUNDS_PER_DAY now
   ("Count is now fixed" in 09-game-cipher.jsx), and the 4-to-7 range the draw
   still used is the GUESS-ROW range, not a round count. So the cap was a
   uniform draw from {8, 10, 12, 14} against a day that always carries
   5 * hints-per-word — and on the quarter of days the draw landed on 4, the
   last clues of the day were refused with "No more clues" while the puzzle
   still had them. That is the "2-hint ceiling" as a player meets it.

   It is a straight multiplication now, with nothing to drift: the round count
   is fixed, and CW_HINTS_PER_WORD is the MAXIMUM a word can offer (two written
   clues plus the derived ones cwDerivedHints adds). The real per-word limit is
   enforced client-side against the clues that word actually has; this is only
   the day's abuse ceiling, so erring high is correct — every clue it counts is
   one the client already holds locally. */
const CW_ROUNDS_PER_DAY = 5;
const CW_HINTS_PER_WORD = 4;
function cwUtcDayNum() {
  const d = new Date();
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000);
}
function cwServerMaxHints() {
  return CW_ROUNDS_PER_DAY * CW_HINTS_PER_WORD;
}

// Single shared connection pool to this app's Postgres DB.
// connectionTimeoutMillis bounds how long a query waits for a connection so a
// stalled/unreachable DB fails fast-and-loud (the migrate retry loop logs and
// retries) instead of hanging boot forever. statement_timeout caps any single
// query server-side so a wedged statement can't pin a connection indefinitely.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10000,
  statement_timeout: 30000,
});

// Surface pool-level errors on idle clients instead of letting them bubble up
// as an uncaught exception that takes the process down.
pool.on('error', (err) => {
  console.error('[pg] idle client error:', err.message);
});

// Flipped true once the boot migration completes. Surfaced on /health for
// diagnostics; the container stays routable (and /health stays 200) while
// migrations are still running or retrying.
let migrationsReady = false;


// ---- Authoritative game registry -----------------------------------------
// Single source of truth for every game in the hub, keyed by id, mirroring the
// GAMES array in public/src/. `category` is the lobby tab; `tier` is the
// DApp-Mode validation tier (A=full replay, B=snapshot/heuristic,
// C=server-authoritative). This reconciles the historical GAMES/GAME_IDS drift:
// GAME_IDS is now DERIVED from this registry's daily-category games (the set the
// per-day attempt routes validate against), and DApp validation keys off the
// registry too.
//
// `manifest` is the Game Corner harness metadata (phase 2), mirrored by id on
// the client GAMES entries (which additionally carry the How-to-Play card copy
// — display strings live client-side, machine-relevant fields live here):
//   scoreDirection — 'higher' | 'lower': which way the leaderboard sorts score.
//   tieBreak       — symbolic tie-break rule the leaderboard SQL implements:
//                    'time-then-steps' (daily: time_secs ASC, steps ASC,
//                    finished_at ASC) or 'first-to-score' (classic all-time:
//                    best_score, then earliest updated_at wins ties).
//   sessionLength  — 'short' (<~3 min) | 'medium' (~3–10 min) | 'long' (10+).
//   input          — primary input paradigm: 'tap' | 'drag' | 'swipe' | 'keyboard'.
//   undo           — undo policy: 'none' | 'free' (unlimited take-backs) |
//                    'booster' (limited, counted uses).
const GAME_REGISTRY = {
  sudoku:            { name: 'Sudoku',            category: 'daily',   tier: 'A',
    manifest: { scoreDirection: 'higher', tieBreak: 'time-then-steps', sessionLength: 'medium', input: 'tap',      undo: 'free' } },
  sudokumini:        { name: 'Sudoku Mini',        category: 'daily',   tier: 'A',
    manifest: { scoreDirection: 'higher', tieBreak: 'time-then-steps', sessionLength: 'short',  input: 'tap',      undo: 'free' } },
  wordhunt:          { name: 'Word Search',       category: 'daily',   tier: 'A',
    manifest: { scoreDirection: 'higher', tieBreak: 'time-then-steps', sessionLength: 'medium', input: 'drag',     undo: 'none' } },
  cryptowordle:      { name: 'Daily Cipher',     category: 'daily',   tier: 'A',
    manifest: { scoreDirection: 'higher', tieBreak: 'time-then-steps', sessionLength: 'medium', input: 'keyboard', undo: 'none' } },
  tilematchingdaily: { name: 'Daily Tile Match Puzzle', category: 'daily', tier: 'A',
    manifest: { scoreDirection: 'higher', tieBreak: 'time-then-steps', sessionLength: 'short',  input: 'tap',      undo: 'booster' } },
  minesweeper:       { name: 'Mine Finder Classic', category: 'classic', tier: 'A',
    manifest: { scoreDirection: 'higher', tieBreak: 'first-to-score',  sessionLength: 'short',  input: 'tap',      undo: 'none' } },
  mancala:           { name: 'Mancala',           category: 'classic', tier: 'A',
    manifest: { scoreDirection: 'higher', tieBreak: 'first-to-score',  sessionLength: 'medium', input: 'tap',      undo: 'none' } },
  'chutes-ladders':  { name: 'Snakes & Ladders',  category: 'classic', tier: 'A',
    manifest: { scoreDirection: 'higher', tieBreak: 'first-to-score',  sessionLength: 'medium', input: 'tap',      undo: 'none' } },
  '2048':            { name: '2048',              category: 'classic', dailyMode: true, tier: 'A',
    manifest: { scoreDirection: 'higher', tieBreak: 'first-to-score',  sessionLength: 'long',   input: 'swipe',    undo: 'none' } },
  'knights-tour':    { name: "Knight's Tour",     category: 'classic', dailyMode: true, tier: 'A',
    manifest: { scoreDirection: 'higher', tieBreak: 'first-to-score',  sessionLength: 'medium', input: 'tap',      undo: 'free' } },
  snake:             { name: 'Snake',             category: 'classic', tier: 'B',
    manifest: { scoreDirection: 'higher', tieBreak: 'first-to-score',  sessionLength: 'short',  input: 'swipe',    undo: 'none' } },
  blockblast:        { name: 'Block Fit',         category: 'classic', dailyMode: true, tier: 'A',
    manifest: { scoreDirection: 'higher', tieBreak: 'first-to-score',  sessionLength: 'medium', input: 'drag',     undo: 'none' } },
  diamondrush:       { name: 'Diamond Rush',      category: 'classic', dailyMode: true, tier: 'A',
    manifest: { scoreDirection: 'higher', tieBreak: 'first-to-score',  sessionLength: 'short',  input: 'tap',      undo: 'none' } },
  tilematching:      { name: 'Tile Match Puzzle', category: 'classic', tier: 'A',
    manifest: { scoreDirection: 'higher', tieBreak: 'first-to-score',  sessionLength: 'medium', input: 'tap',      undo: 'booster' } },
  bounce:            { name: 'Bounce',            category: 'classic', tier: 'B',
    manifest: { scoreDirection: 'higher', tieBreak: 'first-to-score',  sessionLength: 'short',  input: 'drag',     undo: 'none' } },
  zuma:              { name: 'Marble Loop',              category: 'classic', dailyMode: true, tier: 'B',
    manifest: { scoreDirection: 'higher', tieBreak: 'first-to-score',  sessionLength: 'short',  input: 'tap',      undo: 'none' } },
  hashrush:          { name: 'Hash Rush',         category: 'classic', dailyMode: true, tier: 'A',
    manifest: { scoreDirection: 'higher', tieBreak: 'first-to-score',  sessionLength: 'short',  input: 'tap',      undo: 'none' } },
  // Request #326 ("aerial combat with F-16s") lands here as Jet Run: the
  // platform's content rules ban combat and weapons as game mechanics, so the
  // jet threads gates, dodges storm clouds and collects fuel stars — nothing
  // is shot at. Tier B: no lib/dapp.js engine, finishes settle through the
  // snapshot + timing heuristics like the other self-shell games without one.
  jetrun:            { name: 'Jet Run',           category: 'classic', dailyMode: true, tier: 'B',
    manifest: { scoreDirection: 'higher', tieBreak: 'first-to-score',  sessionLength: 'short',  input: 'drag',     undo: 'none' } },
  match3:            { name: 'Match-3 Puzzle',    category: 'classic', dailyMode: true, tier: 'A',
    manifest: { scoreDirection: 'higher', tieBreak: 'first-to-score',  sessionLength: 'long',   input: 'tap',      undo: 'none' } },
  // Phase 6 Lane A dailies — shared card/tile engine games. All tier B for now
  // (snapshot + timing heuristics through settleDailySession); per-game replay
  // engines land incrementally in lib/dapp.js, flipping each to tier A without
  // touching these rows. Being category 'daily' automatically enrolls them in
  // GAME_IDS → server-issued seeds, consume-on-start locks, resume, streaks,
  // and the per-game daily leaderboard.
  klondike:          { name: 'Klondike Solitaire', category: 'daily',  tier: 'B',
    manifest: { scoreDirection: 'higher', tieBreak: 'time-then-steps', sessionLength: 'medium', input: 'tap',      undo: 'none' } },
  spider:            { name: 'Spider Solitaire',  category: 'daily',   tier: 'B',
    manifest: { scoreDirection: 'higher', tieBreak: 'time-then-steps', sessionLength: 'long',   input: 'tap',      undo: 'none' } },
  mahjongsol:        { name: 'Mahjong Solitaire', category: 'daily',   tier: 'B',
    manifest: { scoreDirection: 'higher', tieBreak: 'time-then-steps', sessionLength: 'medium', input: 'tap',      undo: 'booster' } },
  nonogram:          { name: 'Nonogram',          category: 'daily',   tier: 'B',
    manifest: { scoreDirection: 'higher', tieBreak: 'time-then-steps', sessionLength: 'medium', input: 'tap',      undo: 'free' } },
  minefinder:        { name: 'Mine Finder',       category: 'daily',   tier: 'B',
    manifest: { scoreDirection: 'higher', tieBreak: 'time-then-steps', sessionLength: 'short',  input: 'tap',      undo: 'none' } },
  anagrams:          { name: 'Anagram Sprint',    category: 'daily',   tier: 'B',
    manifest: { scoreDirection: 'higher', tieBreak: 'time-then-steps', sessionLength: 'short',  input: 'tap',      undo: 'none' } },
  cratepush:         { name: 'Crate Push',        category: 'daily',   tier: 'B',
    manifest: { scoreDirection: 'higher', tieBreak: 'time-then-steps', sessionLength: 'medium', input: 'tap',      undo: 'free' } },
  dropstack:         { name: 'Drop Stack',        category: 'daily',   tier: 'B',
    manifest: { scoreDirection: 'higher', tieBreak: 'time-then-steps', sessionLength: 'short', input: 'drag',      undo: 'none' } },
  // Spec change-list items 6, 8, 9 — Word Sprint (the Boggle-style launch
  // game, fresh id since `wordhunt` is the word search) plus seeded daily
  // variants of Snake and Bounce. Being category 'daily' automatically
  // enrolls all three in GAME_IDS → server seeds, locks, resume, streaks,
  // per-game leaderboards, and the GotD rotation (weight 1).
  wordsprint:        { name: 'Word Sprint',       category: 'daily',   tier: 'B',
    manifest: { scoreDirection: 'higher', tieBreak: 'score-then-time', sessionLength: 'short',  input: 'tap',      undo: 'none' } },
  snakedaily:        { name: 'Daily Snake',       category: 'daily',   tier: 'B',
    manifest: { scoreDirection: 'higher', tieBreak: 'time-then-steps', sessionLength: 'short',  input: 'swipe',    undo: 'none' } },
  bouncedaily:       { name: 'Daily Bounce',      category: 'daily',   tier: 'B',
    manifest: { scoreDirection: 'higher', tieBreak: 'time-then-steps', sessionLength: 'short',  input: 'drag',     undo: 'none' } },
  // Phase 5 board games — server-authoritative rules modules (lib/board-rules.js)
  // over classic_rooms; online head-to-head only, rated on the ladder. Tier C:
  // the server IS the referee, so no replay validation is needed.
  checkers:          { name: 'Checkers',          category: 'classic', tier: 'C',
    manifest: { scoreDirection: 'higher', tieBreak: 'first-to-score',  sessionLength: 'long',   input: 'tap',      undo: 'none' } },
  reversi:           { name: 'Reversi',           category: 'classic', tier: 'C',
    manifest: { scoreDirection: 'higher', tieBreak: 'first-to-score',  sessionLength: 'medium', input: 'tap',      undo: 'none' } },
  fourinarow:        { name: 'Four in a Row',     category: 'classic', tier: 'C',
    manifest: { scoreDirection: 'higher', tieBreak: 'first-to-score',  sessionLength: 'short',  input: 'tap',      undo: 'none' } },
  gomoku:            { name: 'Gomoku',            category: 'classic', tier: 'C',
    manifest: { scoreDirection: 'higher', tieBreak: 'first-to-score',  sessionLength: 'medium', input: 'tap',      undo: 'none' } },
  ludo:              { name: 'Ludo',              category: 'classic', tier: 'C',
    manifest: { scoreDirection: 'higher', tieBreak: 'first-to-score',  sessionLength: 'long',   input: 'tap',      undo: 'none' } },
};
// Retired games (Texas Hold 'Em, Idle Empire, the PvP staking arena's
// tilematch_pvp pseudo-game) are deliberately absent: their routes and lobby
// cards were removed with the MATCH-currency economy. Their tables remain in
// the schema (no destructive migrations) but no code path touches them.

// Daily-attempt routes validate :gameId against the daily-category games.
// (Historically this set also carried mancala/idle/zuma by mistake; those are
// not daily games and were never reachable as daily attempts.)
/* Every id with a DAILY MODE — which is no longer the same thing as "lives on
   the daily tab". #176 gave seven classics a daily alongside their free play
   (2048, Knight's Tour, Block Fit, Diamond Rush, Marble Loop, Hash Rush,
   Match-3): they stay category 'classic' because that is where they belong in
   the lobby, and carry `dailyMode` to opt into the daily machinery — route
   validation, server-issued seeds, per-game leaderboards, the Game-of-the-Day
   pool and the staging fixtures all read THIS set, so opting in is one flag
   rather than seven call sites. Keep it in step with PLAY_MODES_BY_ID in
   public/src/29-cards.jsx, which is the client's copy of the same statement. */
const GAME_IDS = new Set(
  Object.keys(GAME_REGISTRY).filter(id =>
    GAME_REGISTRY[id].category === 'daily' || GAME_REGISTRY[id].dailyMode)
);

// Any game id known to the hub (used by DApp session validation).
const ALL_GAME_IDS = new Set(Object.keys(GAME_REGISTRY));

/* Most games a single player may pin to the top of the home grid (#232). The
   client mirrors this as PIN_LIMIT in public/src/29-cards.jsx purely to grey
   out the control once it is reached; THIS value is the authoritative one —
   the insert below refuses the 9th pin regardless of what the client sends. */
const PIN_LIMIT = 8;

// Classic games that persist a single global best score via the generic
// /api/classic/:gameId/score + /leaderboard endpoints (classic_scores table).
const CLASSIC_SCORE_GAME_IDS = new Set(['minesweeper', '2048', 'knights-tour', 'blockblast', 'hashrush', 'diamondrush', 'chutes-ladders', 'jetrun']);

/* ============================================================
   Play modes (#176) — story levels and arcade bands
   ============================================================
   Mirrors PLAY_MODES_BY_ID in public/src/29-cards.jsx. The client owns the
   card copy; the server owns what a mode is worth and whether a level has
   already been claimed, because both are cheatable from the client.

   STORY_BANDS is the story LEVEL count per game. (The identifier and the
   `game_progress.band` column keep their original names on purpose — the
   #184 rename is display-only, and `band` is part of a live primary key.)
   A story level is a difficulty step, not one of a game's own levels: Tile
   Match generates 1000 of those and Mahjong has 6 layouts, so paying per
   level-of-content would make one game worth a hundred times another for the
   same "finished the story" achievement.

   Every game's story is capped to STORY_LEVEL_MIN..STORY_LEVEL_MAX levels
   (#184), and storyBandAward below spends the SAME total budget on every game
   however many levels it has: later levels simply weigh more than earlier
   ones. scripts/check-registry.js enforces the bound AND that each client
   difficulty table is the same length as its entry here, because a server
   bump without the matching client bump silently replays the old hardest
   board at the top of the ladder. */
const STORY_LEVEL_MIN = 6;
const STORY_LEVEL_MAX = 10;
// What a NEWLY added story starts at. Start at the floor and earn the extra
// levels with content: the four games above the floor are there because they
// have a ladder of real, distinguishable difficulty to spend them on.
const STORY_LEVEL_DEFAULT = 6;
const STORY_BANDS = {
  sudoku: 6, sudokumini: 6, wordhunt: 6, cryptowordle: 6,
  klondike: 6, spider: 6, mahjongsol: 6, anagrams: 6,
  nonogram: 6, cratepush: 8, minefinder: 6,
  tilematching: 10, bounce: 6, diamondrush: 8, zuma: 6,
  hashrush: 6, match3: 6, 'knights-tour': 6,
  jetrun: 6,
};
const storyBandCount = (gameId) => STORY_BANDS[gameId] || 0;

// Every game's story is worth the same in total. Weight w(i) = i+1 so the last
// rung pays the most, then normalise to STORY_TOTAL_POINTS.
const STORY_TOTAL_POINTS = 2000;
function storyBandAward(gameId, band) {
  const n = storyBandCount(gameId);
  if (!n || band < 0 || band >= n) return 0;
  const denom = (n * (n + 1)) / 2;       // sum of 1..n
  return Math.round(STORY_TOTAL_POINTS * ((band + 1) / denom));
}

/* Arcade bands — three for every game, all open from the start (no story
   gate). ARCADE_BAND_MULT scales what a personal best is worth so that
   farming the Easy board is not the optimal strategy, which it would be if a
   single mixed board paid the same everywhere. */
const ARCADE_BANDS = ['easy', 'normal', 'hard'];
const ARCADE_BAND_MULT = { easy: 0.6, normal: 1.0, hard: 1.6 };
const isArcadeBand = (b) => ARCADE_BANDS.indexOf(b) !== -1;

/* Daily difficulty bands (#331) — Easy/Normal/Hard, chosen on the pre-game
   screen and stored on the attempt row. Easy/Hard deal a different seeded
   board from the same day's anchor (the client's dailySeedFor mixes the band
   into the seed); the leaderboard filters by band so a win is ranked against
   the same deal it was played on. DAILY_BAND_MULT scales what a win pays —
   mirrored from the client's DAILY_BAND_MULT, which the client applies to the
   final score it posts (the same client-authoritative trust model as the
   streak multiplier); this constant documents the contract. Normal must stay
   byte-identical to the pre-band deal, so every existing seeded board and
   check keeps passing. */
const DAILY_BANDS = ['easy', 'normal', 'hard'];
const DAILY_BAND_MULT = { easy: 0.8, normal: 1.0, hard: 1.25 };
const isDailyBand = (b) => DAILY_BANDS.indexOf(b) !== -1;

/* Rank thresholds pay ONCE each, ever, per (user, game, band). Paying for rank
   POSITION instead would let a player drift up as other scores decay, or
   oscillate across a boundary and collect repeatedly. */
/* How far a claimed duration may exceed the server's own measurement of the
   run before it is rejected. Generous on purpose: a backgrounded tab, a slow
   finish request and a device clock are all allowed to cost a few seconds, and
   the check only has to catch a claim that could not have been played, not
   shave seconds off an honest one. Claiming LESS time than really elapsed is
   always fine — putting a game down mid-run is normal. */
const ARCADE_TIME_GRACE_SECS = 30;

const ARCADE_RANK_THRESHOLDS = [
  { rank: 1,  key: 'top1',  points: 400 },
  { rank: 3,  key: 'top3',  points: 200 },
  { rank: 10, key: 'top10', points: 100 },
];


// Classic games that support online "race" multiplayer (each player plays
// their own board; highest final score wins) over classic_rooms.
const CLASSIC_RACE_GAME_IDS = new Set(['2048', 'blockblast']);
const CLASSIC_LB_LIMIT = 20;

// ---- Server-issued daily seeds (phase 2 harness) ---------------------------
// One seed row per (daily game, UTC day) in daily_seeds, created lazily on the
// first request of the day and returned from GET /api/daily, /start, and the
// public GET /api/public/daily. The client keeps mulberry32(seed) downstream
// and falls back to its legacy day-number derivation if no seed arrives, so a
// partial deploy can never blank the dailies.
//
// GENERATION POLICY: the seed VALUE is (for now) the same one the client's
// legacy derivation produces for that game/day. This makes the server-issued
// flip a pure seam change — the board is identical before/after deploy even
// mid-UTC-day, resumed attempts re-derive the same board, and the fallback
// path agrees byte-for-byte. When Game of the Day ships (phase 7) this becomes
// the knob to switch to unpredictable per-day seeds — change it only at a UTC
// boundary.

/* PHASE 4 (#122) — the staging `demo=solvedboard` fixture needs a REAL solved
   nonogram grid, not a plausible-looking fake, so the review screen a tester
   sees is the puzzle the client would actually have generated. Mirrors
   mulberry32 + ngGenerate in public/src/ exactly; used ONLY by that
   IS_STAGING fixture, never by gameplay or validation. Keep in sync with
   ngGenerate if the generator changes. */
// FNV-1a string hash — byte-for-byte mirror of hashStr in public/src/.
function srvHashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// The client's legacy per-game daily seed for a UTC day number. Two formulas
// exist historically: the Daily Tile Match seeded tmGenerateLevel with
// dayNum*31+7; the other dailies seed mulberry32 with (dayNum + hashStr(id)).
function legacyDailySeed(gameId, dayNum) {
  if (gameId === 'tilematchingdaily') return (dayNum * 31 + 7) >>> 0;
  return (dayNum + srvHashStr(gameId)) >>> 0;
}

// Per-process cache so the seed upsert runs once per game per day, not on
// every /api/daily hit. Keyed by the server's UTC date string.
let dailySeedCache = { date: null, seeds: {} };

async function ensureDailySeed(gameId) {
  const { rows: dRows } = await pool.query(
    `SELECT (now() AT TIME ZONE 'utc')::date AS d`
  );
  const d = dRows[0].d; // JS Date at UTC midnight of today's date
  const dateKey = d.toISOString().slice(0, 10);
  if (dailySeedCache.date !== dateKey) dailySeedCache = { date: dateKey, seeds: {} };
  if (Number.isFinite(dailySeedCache.seeds[gameId])) return dailySeedCache.seeds[gameId];

  const dayNum = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000);
  const value = legacyDailySeed(gameId, dayNum);
  // Upsert-read in one statement: the no-op DO UPDATE makes RETURNING yield
  // the existing row when another request already claimed the day.
  const { rows } = await pool.query(
    `INSERT INTO daily_seeds (game_id, seed_date, seed)
     VALUES ($1, $2, $3)
     ON CONFLICT (game_id, seed_date) DO UPDATE SET seed = daily_seeds.seed
     RETURNING seed`,
    [gameId, dateKey, value]
  );
  const seed = Number(rows[0].seed);
  dailySeedCache.seeds[gameId] = seed;
  return seed;
}

// Today's seeds for every daily game, as { gameId: seed }.
async function ensureDailySeeds() {
  const out = {};
  for (const gameId of GAME_IDS) out[gameId] = await ensureDailySeed(gameId);
  return out;
}

// ---- Game of the Day (phase 7) ---------------------------------------------
// Deterministic weighted round-robin over the daily pool (all Lane A dailies —
// GAME_IDS). The schedule interleaves by weight round so the same game never
// features on consecutive days: round 0 lists every game once (sorted by id),
// round r adds the games whose weight exceeds r. dayNum % schedule.length
// picks today's slot — no cron, no randomness, same answer on every process.
// The chosen row is persisted to daily_featured on the first request of the
// day; once written it is the day's truth even if weights change later.
const GOTD_WEIGHTS = { sudoku: 2, wordhunt: 2, cryptowordle: 2, tilematchingdaily: 2 }; // default 1

// GotD-participation streak cutover (spec §6.3). From this UTC date on, a
// streak day is earned ONLY by finishing that day's featured game; every day
// BEFORE it keeps the legacy any-daily rule, so no live streak resets at the
// changeover. Set to the first UTC midnight after the feature shipped.
const GOTD_STREAK_CUTOVER = '2026-07-24';

function gotdSchedule() {
  const ids = Array.from(GAME_IDS).sort();
  const maxW = Math.max(...ids.map((id) => GOTD_WEIGHTS[id] || 1));
  const schedule = [];
  for (let round = 0; round < maxW; round++) {
    for (const id of ids) if ((GOTD_WEIGHTS[id] || 1) > round) schedule.push(id);
  }
  return schedule;
}

// Staging-fixture helper: seed `nDays` consecutive finished streak days
// BEFORE today for one user, valid under the GotD-participation rule — for
// each prior day it upserts that day's daily_featured row (computed from the
// same deterministic schedule ensureDailyFeatured uses) and a finished
// attempt for that featured game. Idempotent; only called from IS_STAGING
// demo fixtures.
/* "Today is left open" has to be MADE true, not assumed.

   demo=streak and demo=badges both promise a long streak with today still
   playable. Neither of them finishes today — but demo=locked deliberately
   does, on the same viewer, and staging carries one database across every
   check run and never resets. So the first time demo=locked ran, today's
   sudoku was finished forever, and every later route that wanted the PRE-GAME
   screen got the locked screen instead. That is what took out the two #188
   leaderboards checks (`?game=sudoku&boards=1&demo=streak`): the panel lives
   on the pre-game screen, and the pre-game screen was never reached.

   Same rule as demo=storybadges and demo=modes: a fixture has to assert the
   state it claims, including the ABSENCE of a row. demo=locked still finishes
   today on its own routes, because it asserts its state too — the two simply
   have to stop depending on which one ran first. */
async function openTodayForDemo(userId) {
  await pool.query(
    `DELETE FROM daily_attempts
      WHERE user_id = $1 AND attempt_date = (now() AT TIME ZONE 'utc')::date`,
    [userId]
  );
}

async function seedFeaturedStreakDays(userId, username, nDays) {
  const schedule = gotdSchedule();
  const { rows: dRows } = await pool.query(`SELECT (now() AT TIME ZONE 'utc')::date AS d`);
  const today = dRows[0].d;
  const todayNum = Math.floor(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) / 86400000);
  for (let i = 1; i <= nDays; i++) {
    const dayNum = todayNum - i;
    const gameId = schedule[((dayNum % schedule.length) + schedule.length) % schedule.length];
    await pool.query(
      `INSERT INTO daily_featured (seed_date, game_id, seed)
       VALUES (((now() AT TIME ZONE 'utc')::date - $1::int), $2, $3)
       ON CONFLICT (seed_date) DO NOTHING`,
      [i, gameId, legacyDailySeed(gameId, dayNum)]
    );
    // Match whatever game the day's featured row actually holds (it may
    // predate this fixture run), so the attempt always counts.
    const { rows: fRows } = await pool.query(
      `SELECT game_id FROM daily_featured WHERE seed_date = ((now() AT TIME ZONE 'utc')::date - $1::int)`,
      [i]
    );
    const gid = (fRows[0] && fRows[0].game_id) || gameId;
    await pool.query(
      `INSERT INTO daily_attempts
         (user_id, username, game_id, attempt_date, score, steps, time_secs, finished_at)
       VALUES ($1, $2, $3, ((now() AT TIME ZONE 'utc')::date - $4::int), 900, 20, 120, now())
       ON CONFLICT (user_id, game_id, attempt_date) DO NOTHING`,
      [userId, username, gid, i]
    );
  }
}

let dailyFeaturedCache = { date: null, featured: null };

async function ensureDailyFeatured() {
  const { rows: dRows } = await pool.query(`SELECT (now() AT TIME ZONE 'utc')::date AS d`);
  const d = dRows[0].d;
  const dateKey = d.toISOString().slice(0, 10);
  if (dailyFeaturedCache.date === dateKey && dailyFeaturedCache.featured) {
    return dailyFeaturedCache.featured;
  }
  const dayNum = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000);
  const schedule = gotdSchedule();
  const gameId = schedule[dayNum % schedule.length];
  const seed = await ensureDailySeed(gameId);
  // Upsert-read in one statement (same idiom as ensureDailySeed): the no-op
  // DO UPDATE makes RETURNING yield whichever row won the day.
  const { rows } = await pool.query(
    `INSERT INTO daily_featured (seed_date, game_id, seed)
     VALUES ($1, $2, $3)
     ON CONFLICT (seed_date) DO UPDATE SET game_id = daily_featured.game_id
     RETURNING game_id, seed`,
    [dateKey, gameId, seed]
  );
  const featured = { date: dateKey, gameId: rows[0].game_id, seed: Number(rows[0].seed) };
  dailyFeaturedCache = { date: dateKey, featured };
  return featured;
}

// ---- Rating ladder (phase 4) ------------------------------------------------
// Head-to-head games whose online matches feed the Elo ladder: turn-based
// rooms (Mancala, Chutes & Ladders) and score races (2048, Block Blast).
const H2H_GAME_IDS = new Set([
  'mancala', 'chutes-ladders', '2048', 'blockblast',
  // Phase 5 board games (rules modules over classic_rooms).
  'checkers', 'reversi', 'fourinarow', 'gomoku', 'ludo',
]);
const ELO_K = 32;
const ELO_START = 1000;

// Monday of the current UTC week, as a YYYY-MM-DD string (the "weekly movers"
// window boundary).
function utcWeekStart() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

// Settle Elo for one finished head-to-head match. `winner` is '1' | '2' |
// 'draw' (the rooms' stored convention). Best-effort at every call site —
// a rating failure never blocks the match result. Idempotency is the CALLER's
// contract: call only from code paths that transition a room to finished
// exactly once (CAS-guarded moves, both-scores-in races, guarded forfeits).
async function applyMatchRating(gameId, p1, p2, winner) {
  if (!H2H_GAME_IDS.has(gameId)) return;
  if (!p1 || !p2 || !p1.id || !p2.id || p1.id === p2.id) return;
  if (winner !== '1' && winner !== '2' && winner !== 'draw') return;
  const weekStart = utcWeekStart();

  const loadRow = async (p) => {
    await pool.query(
      `INSERT INTO game_ratings (user_id, username, game_id, elo, week_start_elo, week_start_date)
       VALUES ($1, $2, $3, $4, $4, $5)
       ON CONFLICT (user_id, game_id) DO NOTHING`,
      [p.id, p.name || null, gameId, ELO_START, weekStart]
    );
    const { rows } = await pool.query(
      `SELECT * FROM game_ratings WHERE user_id = $1 AND game_id = $2`,
      [p.id, gameId]
    );
    return rows[0];
  };
  const r1 = await loadRow(p1);
  const r2 = await loadRow(p2);

  // Standard Elo with K=32. Scores: win 1, loss 0, draw 0.5.
  const s1 = winner === '1' ? 1 : winner === '2' ? 0 : 0.5;
  const s2 = 1 - s1;
  const e1 = 1 / (1 + Math.pow(10, (r2.elo - r1.elo) / 400));
  const e2 = 1 - e1;

  const save = async (row, p, score, expected) => {
    // Roll the weekly snapshot forward BEFORE applying this match's delta, so
    // weekly_delta measures movement within the current week only.
    const weekStartElo = (!row.week_start_date ||
      row.week_start_date.toISOString().slice(0, 10) < weekStart)
      ? row.elo : row.week_start_elo;
    const newElo = Math.round(row.elo + ELO_K * (score - expected));
    const newStreak = score === 1 ? row.win_streak + 1 : 0;
    await pool.query(
      `UPDATE game_ratings
          SET elo = $3, win_streak = $4, best_streak = GREATEST(best_streak, $4),
              wins = wins + $5, losses = losses + $6, draws = draws + $7,
              week_start_elo = $8, week_start_date = $9,
              username = COALESCE($10, username), updated_at = now()
        WHERE user_id = $1 AND game_id = $2`,
      [p.id, gameId, newElo, newStreak,
       score === 1 ? 1 : 0, score === 0 ? 1 : 0, score === 0.5 ? 1 : 0,
       weekStartElo, weekStart, p.name || null]
    );
  };
  await save(r1, p1, s1, e1);
  await save(r2, p2, s2, e2);
}

// Fire-and-forget wrapper for the finish handlers.
function rateMatch(gameId, p1, p2, winner) {
  applyMatchRating(gameId, p1, p2, winner)
    .catch((e) => console.warn(`[ladder] rating update failed (${gameId}, non-fatal):`, e.message));
}

// Consecutive-day streak milestones that unlock a named badge. Kept in sync
// with STREAK_BADGES in public/src/ (the client owns the icon/name copy;
// the server only persists the day thresholds as streak_milestone achievements
// so a player's earned badges survive a later streak reset).
const STREAK_BADGE_DAYS = [3, 7, 30, 50, 100, 180, 365];

// ---- Achievement badges (non-streak) -------------------------------------
// Persisted in user_achievements as one row per earned badge `type`, mirroring
// the streak_milestone pattern. Kept in sync with ACHIEVEMENT_BADGES in
// public/src/ (the client owns the icon/name copy; the server owns the
// award criteria and persists the earned `type`). All criteria derive from
// columns already recorded per solve (time_secs, steps, score, game_id,
// attempt_date), so no new data is needed.
//   first_solve    — the user's first ever finished daily attempt.
//   speed_demon    — solved any daily in under 60s.
//   flawless       — solved sudoku/wordhunt at/under a per-game step threshold.
//   daily_sweep    — finished ALL daily games within one UTC day.
//   podium         — held rank #1 on a game's daily leaderboard at finish time.
//   solve_milestone — lifetime finished+won solves crossed 10/50/100.
//   story_complete  — cleared every band of one game's Story ladder. One
//                    badge per (user, game); the game id lives in
//                    metadata.gameId so a single `type` covers all ladders,
//                    exactly as solve_milestone parameterises by count.
const SPEED_DEMON_MAX_SECS = 60;
// Per-game "no wasted moves" thresholds (the single balance knob for the
// Flawless badge — tune here). Only the move-counted daily games qualify;
// games without a meaningful step economy are omitted (no flawless).
// wordhunt has an 8-word solve floor (every gesture, incl. a stray tap or a
// non-matching drag, increments steps), so a threshold of 8 demanded a
// literally perfect game; 10 leaves a 2-move slack so a clean solve still
// earns it, loosely mirroring sudoku's ~4-of-14 tolerance.
const FLAWLESS_STEP_THRESHOLDS = { sudoku: 18, wordhunt: 10 };
const SOLVE_MILESTONES = [10, 50, 100];

// The set of non-streak achievement badge `type`s a user has earned, plus the
// solve-milestone counts they've crossed. Read from the permanent
// user_achievements rows so earned badges persist forever. Returns
// { types: [...], milestones: [...] }.
async function earnedAchievementBadges(userId) {
  try {
    const { rows } = await pool.query(
      `SELECT type, metadata
         FROM user_achievements
        WHERE user_id = $1
          AND type IN ('first_solve','speed_demon','flawless','daily_sweep','podium','solve_milestone','story_complete')`,
      [userId]
    );
    const types = new Set();
    const milestones = new Set();
    const stories = new Set();
    for (const r of rows) {
      types.add(r.type);
      if (r.type === 'solve_milestone' && r.metadata && Number.isFinite(+r.metadata.count)) {
        milestones.add(+r.metadata.count);
      }
      if (r.type === 'story_complete' && r.metadata && typeof r.metadata.gameId === 'string') {
        stories.add(r.metadata.gameId);
      }
    }
    return {
      types: Array.from(types),
      milestones: Array.from(milestones).sort((a, b) => a - b),
      stories: Array.from(stories).sort(),
    };
  } catch {
    return { types: [], milestones: [], stories: [] };
  }
}

// ---- Match-3 puzzle configuration ----------------------------------------
const MATCH3_PUZZLES = [
  // Easy (1-10)
  { id: 1, name: 'Getting Started', target: 800, timeLimit: 120, moveLimit: 30, layers: 2, difficulty: 'Easy' },
  { id: 2, name: 'Gather Gems', target: 1200, timeLimit: 120, moveLimit: 28, layers: 3, difficulty: 'Easy' },
  { id: 3, name: 'Color Cascade', target: 1500, timeLimit: 120, moveLimit: 26, layers: 2, difficulty: 'Easy' },
  { id: 4, name: 'Tile Practice', target: 2000, timeLimit: 120, moveLimit: 35, layers: 3, difficulty: 'Easy' },
  { id: 5, name: 'Gem Master', target: 2500, timeLimit: 120, moveLimit: 32, layers: 2, difficulty: 'Easy' },
  { id: 6, name: 'Combo Chain', target: 1800, timeLimit: 120, moveLimit: 40, layers: 2, difficulty: 'Easy' },
  { id: 7, name: 'Rainbow Tiles', target: 2200, timeLimit: 120, moveLimit: 30, layers: 3, difficulty: 'Easy' },
  { id: 8, name: 'Momentum', target: 2700, timeLimit: 120, moveLimit: 28, layers: 2, difficulty: 'Easy' },
  { id: 9, name: 'Precision Match', target: 2000, timeLimit: 120, moveLimit: 25, layers: 3, difficulty: 'Easy' },
  { id: 10, name: 'Power Play', target: 2800, timeLimit: 120, moveLimit: 32, layers: 3, difficulty: 'Easy' },
  // Medium (11-30)
  { id: 11, name: 'Rising Challenge', target: 3000, timeLimit: 110, moveLimit: 28, layers: 3, difficulty: 'Medium' },
  { id: 12, name: 'Locked Tiles', target: 3200, timeLimit: 110, moveLimit: 26, layers: 4, difficulty: 'Medium' },
  { id: 13, name: 'Strategic Moves', target: 3500, timeLimit: 110, moveLimit: 30, layers: 3, difficulty: 'Medium' },
  { id: 14, name: 'Gem Rush', target: 3800, timeLimit: 110, moveLimit: 28, layers: 4, difficulty: 'Medium' },
  { id: 15, name: 'Pressure Cooker', target: 3200, timeLimit: 100, moveLimit: 24, layers: 3, difficulty: 'Medium' },
  { id: 16, name: 'Ice Breaker', target: 4000, timeLimit: 110, moveLimit: 32, layers: 4, difficulty: 'Medium' },
  { id: 17, name: 'Cascade Master', target: 3600, timeLimit: 110, moveLimit: 26, layers: 3, difficulty: 'Medium' },
  { id: 18, name: 'Deep Focus', target: 4200, timeLimit: 110, moveLimit: 30, layers: 4, difficulty: 'Medium' },
  { id: 19, name: 'Tile Tactics', target: 3900, timeLimit: 100, moveLimit: 25, layers: 3, difficulty: 'Medium' },
  { id: 20, name: 'Gem Sculptor', target: 4400, timeLimit: 110, moveLimit: 28, layers: 4, difficulty: 'Medium' },
  { id: 21, name: 'Locked & Loaded', target: 4100, timeLimit: 110, moveLimit: 30, layers: 4, difficulty: 'Medium' },
  { id: 22, name: 'Precision Strike', target: 3800, timeLimit: 100, moveLimit: 23, layers: 3, difficulty: 'Medium' },
  { id: 23, name: 'Color Theory', target: 4300, timeLimit: 110, moveLimit: 28, layers: 4, difficulty: 'Medium' },
  { id: 24, name: 'Momentum Shift', target: 4600, timeLimit: 110, moveLimit: 32, layers: 4, difficulty: 'Medium' },
  { id: 25, name: 'Maze Solver', target: 4000, timeLimit: 100, moveLimit: 26, layers: 3, difficulty: 'Medium' },
  { id: 26, name: 'Time Pressure', target: 3900, timeLimit: 90, moveLimit: 22, layers: 4, difficulty: 'Medium' },
  { id: 27, name: 'Champion\'s Path', target: 4500, timeLimit: 110, moveLimit: 30, layers: 4, difficulty: 'Medium' },
  { id: 28, name: 'Final Stand', target: 4800, timeLimit: 110, moveLimit: 28, layers: 4, difficulty: 'Medium' },
  { id: 29, name: 'Gem Dynasty', target: 4200, timeLimit: 100, moveLimit: 24, layers: 3, difficulty: 'Medium' },
  { id: 30, name: 'Gateway Challenge', target: 5000, timeLimit: 110, moveLimit: 32, layers: 4, difficulty: 'Medium' },
  // Hard (31-50)
  { id: 31, name: 'Expert Territory', target: 5200, timeLimit: 100, moveLimit: 26, layers: 5, difficulty: 'Hard' },
  { id: 32, name: 'Ice Fortress', target: 5400, timeLimit: 100, moveLimit: 24, layers: 5, difficulty: 'Hard' },
  { id: 33, name: 'Avalanche', target: 5800, timeLimit: 100, moveLimit: 28, layers: 5, difficulty: 'Hard' },
  { id: 34, name: 'Locked Labyrinth', target: 5600, timeLimit: 100, moveLimit: 25, layers: 5, difficulty: 'Hard' },
  { id: 35, name: 'Inferno', target: 6000, timeLimit: 90, moveLimit: 22, layers: 5, difficulty: 'Hard' },
  { id: 36, name: 'Master Puzzle', target: 5900, timeLimit: 100, moveLimit: 26, layers: 5, difficulty: 'Hard' },
  { id: 37, name: 'Complexity', target: 6200, timeLimit: 100, moveLimit: 28, layers: 5, difficulty: 'Hard' },
  { id: 38, name: 'Precision Required', target: 5800, timeLimit: 90, moveLimit: 23, layers: 5, difficulty: 'Hard' },
  { id: 39, name: 'Final Test', target: 6400, timeLimit: 100, moveLimit: 26, layers: 5, difficulty: 'Hard' },
  { id: 40, name: 'Legendary Tier', target: 6600, timeLimit: 100, moveLimit: 30, layers: 5, difficulty: 'Hard' },
  { id: 41, name: 'Peak Performance', target: 6000, timeLimit: 90, moveLimit: 24, layers: 5, difficulty: 'Hard' },
  { id: 42, name: 'Unrelenting', target: 6300, timeLimit: 100, moveLimit: 27, layers: 5, difficulty: 'Hard' },
  { id: 43, name: 'Titan\'s Trial', target: 6800, timeLimit: 100, moveLimit: 28, layers: 5, difficulty: 'Hard' },
  { id: 44, name: 'Endgame', target: 6500, timeLimit: 90, moveLimit: 25, layers: 5, difficulty: 'Hard' },
  { id: 45, name: 'Perfection Quest', target: 6900, timeLimit: 100, moveLimit: 30, layers: 5, difficulty: 'Hard' },
  { id: 46, name: 'Unstoppable', target: 6700, timeLimit: 100, moveLimit: 26, layers: 5, difficulty: 'Hard' },
  { id: 47, name: 'Ultra Challenge', target: 7000, timeLimit: 100, moveLimit: 28, layers: 5, difficulty: 'Hard' },
  { id: 48, name: 'Reality Bender', target: 6800, timeLimit: 90, moveLimit: 23, layers: 5, difficulty: 'Hard' },
  { id: 49, name: 'Pandora\'s Box', target: 7100, timeLimit: 100, moveLimit: 30, layers: 5, difficulty: 'Hard' },
  { id: 50, name: 'Master Challenge', target: 7200, timeLimit: 100, moveLimit: 28, layers: 5, difficulty: 'Hard' },
];

// ---- Schema bootstrap (idempotent, runs on boot) -------------------------
// daily_attempts is PUBLIC (the platform default): it holds gameplay
// results, not sensitive personal data, and a future leaderboard would
// want them visible. One row per (user, game, UTC day) — the UNIQUE
// constraint is what enforces "exactly one attempt per day". The day
// resets implicitly: a new UTC date yields a new attempt_date, so
// yesterday's rows simply stop matching today's lookups.
async function migrate() {
  /* game_progress is PUBLIC — story-ladder state, gameplay only.
     One row per (user, game, band). The row's EXISTENCE is the claim: story
     pays on first clear and never again, and total_score is an incrementing
     column, so the award has to be gated on winning the insert rather than on
     the client saying "this was my first time". Same shape as the daily's
     consume-on-start claim. best_* are updated on replays; awarded_points
     never is. */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_progress (
      user_id        TEXT    NOT NULL,
      game_id        TEXT    NOT NULL,
      band           INTEGER NOT NULL,
      cleared_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      awarded_points INTEGER NOT NULL DEFAULT 0,
      best_score     INTEGER,
      best_time_secs INTEGER,
      best_steps     INTEGER,
      plays          INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (user_id, game_id, band)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS game_progress_game_idx ON game_progress (game_id, band)`);

  /* arcade_bests is PUBLIC — one row per (user, game, band): the personal best
     that arcade actually pays on, plus which rank thresholds have already been
     collected. Storing the claimed thresholds as a text[] is what makes each
     one payable exactly once ever, rather than every time the player crosses
     the boundary again. */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS arcade_bests (
      user_id      TEXT    NOT NULL,
      username     TEXT,
      game_id      TEXT    NOT NULL,
      band         TEXT    NOT NULL,
      best_score   INTEGER NOT NULL DEFAULT 0,
      best_time_secs INTEGER,
      best_steps   INTEGER,
      runs         INTEGER NOT NULL DEFAULT 0,
      claimed_ranks TEXT[] NOT NULL DEFAULT '{}',
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, game_id, band)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS arcade_bests_board_idx
      ON arcade_bests (game_id, band, best_score DESC, updated_at ASC)
  `);

  /* arcade_runs is PUBLIC — the run history #176 asks arcade to have ("see the
     history to share / replay"). A run is a SEED plus a move list, which is a
     few hundred bytes, because every generator in this app is seeded and
     deterministic: the board is re-derived rather than stored. */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS arcade_runs (
      id         SERIAL PRIMARY KEY,
      user_id    TEXT    NOT NULL,
      username   TEXT,
      game_id    TEXT    NOT NULL,
      band       TEXT    NOT NULL,
      seed       BIGINT  NOT NULL,
      score      INTEGER NOT NULL DEFAULT 0,
      time_secs  INTEGER,
      steps      INTEGER,
      moves      JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS arcade_runs_user_idx
      ON arcade_runs (user_id, game_id, created_at DESC)
  `);
  /* A run is CLAIMED before it is played, so the server has its own clock
     reading of how long it took. Without this the finish route could only take
     the client's word for `timeSecs`, and arcade is the one mode that pays
     directly for leaderboard position — see settleArcadeRun. Added as ALTERs
     because the table shipped one commit earlier in this same branch. */
  await pool.query(`ALTER TABLE arcade_runs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE arcade_runs ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE arcade_runs ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT false`);
  /* Rows written before the anchor existed are real finished runs that simply
     were never claimed. Backfilling finished_at keeps them in the player's own
     history (which reads finished_at IS NOT NULL, so otherwise they would
     silently disappear); `verified` stays false, which is the truth about them
     and correctly keeps them out of the shared boards. Idempotent. */
  await pool.query(
    `UPDATE arcade_runs SET finished_at = created_at WHERE finished_at IS NULL AND started_at IS NULL`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_attempts (
      id           SERIAL PRIMARY KEY,
      user_id      TEXT NOT NULL,
      username     TEXT,
      game_id      TEXT NOT NULL,
      attempt_date DATE NOT NULL,
      score        INTEGER,
      steps        INTEGER,
      time_secs    INTEGER,
      started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at  TIMESTAMPTZ,
      UNIQUE (user_id, game_id, attempt_date)
    )
  `);
  // Resumability: persist mutable in-progress state (board moves) and the
  // accumulated active timer so an unfinished daily attempt can be resumed
  // exactly where the player left off. Idempotent ADD COLUMN per platform DB
  // convention. `progress` is game-specific JSON; the board itself is
  // re-derived from the deterministic daily seed, so only player moves live here.
  await pool.query(`ALTER TABLE daily_attempts ADD COLUMN IF NOT EXISTS progress JSONB`);
  await pool.query(`ALTER TABLE daily_attempts ADD COLUMN IF NOT EXISTS elapsed_secs INTEGER`);
  /* #331 — the difficulty band the attempt was played on. Nullable: rows
     written before the bands existed are Normal by construction (the pre-band
     deal IS today's Normal deal), so reads COALESCE(band, 'normal'). The band
     is chosen before the claim, so the UNIQUE (user, game, date) constraint
     stays untouched — still one attempt per day. */
  await pool.query(`ALTER TABLE daily_attempts ADD COLUMN IF NOT EXISTS band TEXT`);
  /* #188 — the all-time board groups every finished attempt for one game by
     player. Without this the query is a full scan of a table that only grows;
     the existing indexes are keyed for "today, this game", which is the wrong
     shape for it. Idempotent, per the platform's schema convention. */
  await pool.query(`
    CREATE INDEX IF NOT EXISTS daily_attempts_alltime_idx
      ON daily_attempts (game_id, user_id) WHERE finished_at IS NOT NULL
  `);

  // game_ratings is PUBLIC (leaderboard data): one Elo rating row per
  // (user, head-to-head game), updated in the room/match finish handlers
  // (phase 4 ladder). `week_start_elo`/`week_start_date` snapshot the rating
  // at the player's first rated game of the current ISO week, so "weekly
  // movers" (elo − week_start_elo) needs no history table.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_ratings (
      user_id         TEXT NOT NULL,
      username        TEXT,
      game_id         TEXT NOT NULL,
      elo             INTEGER NOT NULL DEFAULT 1000,
      win_streak      INTEGER NOT NULL DEFAULT 0,
      best_streak     INTEGER NOT NULL DEFAULT 0,
      wins            INTEGER NOT NULL DEFAULT 0,
      losses          INTEGER NOT NULL DEFAULT 0,
      draws           INTEGER NOT NULL DEFAULT 0,
      week_start_elo  INTEGER NOT NULL DEFAULT 1000,
      week_start_date DATE,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, game_id)
    )
  `);

  // daily_seeds is PUBLIC: one server-issued board seed per (daily game, UTC
  // day). The seed everyone's board derives from — by definition shared data
  // (every player gets the same deal). Rows are created lazily on the first
  // request of the day (ensureDailySeed); BIGINT because seeds are unsigned
  // 32-bit values (up to 2^32−1, past INTEGER's 2^31−1 max).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_seeds (
      game_id    TEXT NOT NULL,
      seed_date  DATE NOT NULL,
      seed       BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (game_id, seed_date)
    )
  `);

  // daily_featured is PUBLIC (shared-by-definition data, like daily_seeds):
  // one row per UTC day naming the Game of the Day, written lazily on the
  // first request of the day by ensureDailyFeatured() — a deterministic
  // weighted round-robin over the daily pool. Once written, the row is the
  // truth for that day even if weights change mid-day.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_featured (
      seed_date  DATE PRIMARY KEY,
      game_id    TEXT NOT NULL,
      seed       BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // chat_messages is PUBLIC by policy review (phase 7): each game's chat room
  // is open to every signed-in user in-app — the platform's "already visible
  // to other users in-app" test — so staging may carry prod rows. Moderation
  // is report-to-hide: hidden_at set once CHAT_REPORT_THRESHOLD distinct
  // reporters file (chat_reports below); hidden rows stay for audit but render
  // as tombstones.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id         BIGSERIAL PRIMARY KEY,
      game_id    TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      username   TEXT,
      body       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      hidden_at  TIMESTAMPTZ,
      hide_reason TEXT
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_chat_messages_game_id ON chat_messages (game_id, id)`
  );

  // chat_reports is PUBLIC (it references only public message ids + reporter
  // ids, same identity class as leaderboard rows). One report per
  // (message, reporter) — the PK dedupes repeat taps.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_reports (
      message_id  BIGINT NOT NULL,
      reporter_id TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (message_id, reporter_id)
    )
  `);

  // mancala_rooms is PUBLIC — game results contain no sensitive data.
  // One row per multiplayer room; rooms persist until cleaned up.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mancala_rooms (
      id             TEXT PRIMARY KEY,
      player1_id     TEXT NOT NULL,
      player2_id     TEXT,
      player1_name   TEXT,
      player2_name   TEXT,
      pits           JSONB NOT NULL,
      current_player INTEGER NOT NULL DEFAULT 1,
      status         TEXT NOT NULL DEFAULT 'waiting',
      winner         TEXT,
      move_seq       INTEGER NOT NULL DEFAULT 0,
      last_move_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);





  // snake_scores is PUBLIC — high scores for the Snake classic game, shown on
  // a global leaderboard (no sensitive data; gameplay results only). One row
  // per user holding their personal best, upserted with GREATEST so a worse
  // run never clobbers a better one. No foreign keys (public-table rule).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS snake_scores (
      id             SERIAL PRIMARY KEY,
      user_id        TEXT NOT NULL UNIQUE,
      username       TEXT,
      best_score     INTEGER NOT NULL DEFAULT 0,
      best_length    INTEGER,
      best_time_secs INTEGER,
      games_played   INTEGER NOT NULL DEFAULT 0,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // breakout_scores is PUBLIC — high scores for the Bounce classic game, shown
  // on a global leaderboard (no sensitive data; gameplay results only). One row
  // per user holding their personal best, upserted with GREATEST so a worse run
  // never clobbers a better one. No foreign keys (public-table rule). Mirrors
  // snake_scores.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS breakout_scores (
      id             SERIAL PRIMARY KEY,
      user_id        TEXT NOT NULL UNIQUE,
      username       TEXT,
      best_score     INTEGER NOT NULL DEFAULT 0,
      best_level     INTEGER,
      best_time_secs INTEGER,
      games_played   INTEGER NOT NULL DEFAULT 0,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);


  // zuma_scores is PUBLIC — high scores for the Zuma classic game, shown on
  // a global leaderboard (no sensitive data; gameplay results only). One row
  // per user holding their personal best, upserted with GREATEST so a worse
  // run never clobbers a better one. No foreign keys (public-table rule).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS zuma_scores (
      id             SERIAL PRIMARY KEY,
      user_id        TEXT NOT NULL UNIQUE,
      username       TEXT,
      best_score     INTEGER NOT NULL DEFAULT 0,
      best_level     INTEGER,
      best_time_secs INTEGER,
      games_played   INTEGER NOT NULL DEFAULT 0,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // mancala_sessions is PUBLIC — transient game tokens, no sensitive data.
  // One row per ZK proof session; status: pending|verified|rejected|expired.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mancala_sessions (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      commitment   TEXT NOT NULL,
      difficulty   TEXT,
      status       TEXT NOT NULL DEFAULT 'pending',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      verified_at  TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_mancala_sessions_user
    ON mancala_sessions(user_id, created_at DESC)
  `);

  // mancala_scores is PUBLIC — global leaderboard for verified AI-mode wins.
  // One row per (user_id, difficulty); upserted with GREATEST so worse runs
  // never overwrite a personal best.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mancala_scores (
      user_id        TEXT NOT NULL,
      username       TEXT,
      difficulty     TEXT NOT NULL,
      best_score     INTEGER NOT NULL DEFAULT 0,
      best_margin    INTEGER,
      best_moves     INTEGER,
      best_time_secs INTEGER,
      games_played   INTEGER NOT NULL DEFAULT 0,
      wins           INTEGER NOT NULL DEFAULT 0,
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, difficulty)
    )
  `);

  // The Daily Challenge reuses mancala_sessions for the commit-reveal token;
  // puzzle_date binds a session to the day whose board it committed to, so a
  // finish just after midnight still verifies against the start day's board.
  await pool.query(`ALTER TABLE mancala_sessions ADD COLUMN IF NOT EXISTS puzzle_date DATE`);



  // users is PUBLIC: centralized user metadata. Lazy init on first API call.
  // No sensitive data — just identity.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id             TEXT PRIMARY KEY,
      username       TEXT NOT NULL UNIQUE,
      usernode_pubkey TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);







  // user_follows is PUBLIC: directional follow relationships.
  // One row per (follower_id, followee_id) pair.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_follows (
      follower_id    TEXT NOT NULL,
      followee_id    TEXT NOT NULL,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY    (follower_id, followee_id)
    )
  `);

  // user_stats_snapshot is PUBLIC: denormalized stats cache for fast profile
  // rendering. Updated on win and daily resets. One row per user.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_stats_snapshot (
      user_id        TEXT PRIMARY KEY,
      username       TEXT,
      total_score    INTEGER NOT NULL DEFAULT 0,
      current_streak INTEGER NOT NULL DEFAULT 0,
      games_played   INTEGER NOT NULL DEFAULT 0,
      dailies_completed INTEGER NOT NULL DEFAULT 0,
      classics_played   INTEGER NOT NULL DEFAULT 0,
      last_win_at    TIMESTAMPTZ,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Add streak_freezes column to user_stats_snapshot (idempotent)
  await pool.query(`
    ALTER TABLE user_stats_snapshot
      ADD COLUMN IF NOT EXISTS streak_freezes INTEGER NOT NULL DEFAULT 0
  `);

  // user_achievements is PUBLIC: recent milestones and notable events.
  // One row per achievement. Indexed for efficient friend-feed queries.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_achievements (
      id             SERIAL PRIMARY KEY,
      user_id        TEXT NOT NULL,
      type           TEXT NOT NULL,
      game_id        TEXT,
      score          INTEGER,
      metadata       JSONB,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);




  // Create indices for social queries
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_follows_followee
    ON user_follows(followee_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_stats_updated
    ON user_stats_snapshot(updated_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_achievements_user_created
    ON user_achievements(user_id, created_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_achievements_created
    ON user_achievements(created_at DESC)
  `);

  /* Backfill story_complete badges for ladders finished before the badge
     existed. Idempotent by the same NOT EXISTS guard the live award uses, so
     it is a cheap no-op on every boot after the first. A ladder counts as
     complete when the user holds every band 0..n-1 of that game. */
  try {
    for (const [gameId, bands] of Object.entries(STORY_BANDS)) {
      await pool.query(
        `INSERT INTO user_achievements (user_id, type, game_id, metadata)
         SELECT gp.user_id, 'story_complete', $1, $3::jsonb
           FROM game_progress gp
          WHERE gp.game_id = $1 AND gp.band >= 0 AND gp.band < $2::int
          GROUP BY gp.user_id
         HAVING COUNT(DISTINCT gp.band) = $2::int
            AND NOT EXISTS (
              SELECT 1 FROM user_achievements ua
               WHERE ua.user_id = gp.user_id AND ua.type = 'story_complete'
                 AND ua.metadata->>'gameId' = $1
            )`,
        [gameId, bands, JSON.stringify({ gameId, bands })]
      );
    }
  } catch (e) {
    console.warn('[migrate] story_complete backfill skipped:', e.message);
  }

  // tilematch_scores is PUBLIC: personal-best scores for the Tile Match Puzzle
  // (1000-level mode). One row per user, upserted with GREATEST.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tilematch_scores (
      user_id            TEXT PRIMARY KEY,
      username           TEXT,
      highest_level      INTEGER NOT NULL DEFAULT 0,
      total_cleared      INTEGER NOT NULL DEFAULT 0,
      best_session_score INTEGER NOT NULL DEFAULT 0,
      games_played       INTEGER NOT NULL DEFAULT 0,
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);




  // daily_hints is PUBLIC: one row per (user, daily game, UTC day) tracking how
  // many hints were used that day — drives the per-day cap, resets implicitly at
  // midnight UTC. No sensitive data (a gameplay counter, same class as
  // daily_attempts). Daily Cipher uses this table under game_id 'cryptowordle'.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_hints (
      user_id         TEXT NOT NULL,
      username        TEXT,
      game_id         TEXT NOT NULL,
      hint_date       DATE NOT NULL,
      hints_purchased INTEGER NOT NULL DEFAULT 0,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, game_id, hint_date)
    )
  `);



  // ---- DApp Mode (Phase 0) tables -----------------------------------------
  // game_sessions is PUBLIC: one verification session per play.
  // Holds gameplay results + the session's final chain hash + on-chain anchor
  // state. Carries usernode_pubkey only (already public in `users`) and no
  // financial identifiers of any kind.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_sessions (
      id               TEXT PRIMARY KEY,
      user_id          TEXT NOT NULL,
      username         TEXT,
      usernode_pubkey  TEXT,
      game_id          TEXT NOT NULL,
      seed             BIGINT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'active',  -- active|verified|disputed|abandoned
      dispute_reason   TEXT,
      final_score      INTEGER,
      final_steps      INTEGER,
      final_time_secs  INTEGER,
      final_chain_hash TEXT,
      anchor_status    TEXT NOT NULL DEFAULT 'none',     -- none|mock|pending|anchored
      anchor_tx_hash   TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at      TIMESTAMPTZ
    )
  `);

  // session_states is PUBLIC: the append-only hash-chain ledger. One row per
  // move/snapshot; gameplay data only, no sensitive content.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS session_states (
      id          BIGSERIAL PRIMARY KEY,
      session_id  TEXT NOT NULL,
      sequence    INTEGER NOT NULL,
      move        JSONB,
      state_hash  TEXT NOT NULL,
      prev_hash   TEXT NOT NULL,
      chain_hash  TEXT NOT NULL,
      ts_client   TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (session_id, sequence)
    )
  `);


  // match3_progress is PUBLIC — per-user campaign progress.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS match3_progress (
      id                SERIAL PRIMARY KEY,
      user_id           TEXT NOT NULL UNIQUE,
      username          TEXT,
      highest_puzzle    INTEGER NOT NULL DEFAULT 0,
      best_score        INTEGER NOT NULL DEFAULT 0,
      total_puzzles_completed INTEGER NOT NULL DEFAULT 0,
      last_played_puzzle INTEGER NOT NULL DEFAULT 1,
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // match3_scores is PUBLIC — per-user per-puzzle best scores.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS match3_scores (
      user_id           TEXT NOT NULL,
      puzzle_id         INTEGER NOT NULL,
      best_score        INTEGER NOT NULL,
      best_time_secs    INTEGER,
      moves_used        INTEGER,
      completed_at      TIMESTAMPTZ,
      PRIMARY KEY (user_id, puzzle_id)
    )
  `);

  // match3_session is PUBLIC — in-progress puzzle state for resumability.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS match3_session (
      user_id           TEXT NOT NULL UNIQUE,
      current_puzzle    INTEGER NOT NULL,
      tiles             JSONB NOT NULL,
      bar               JSONB NOT NULL,
      score             INTEGER NOT NULL DEFAULT 0,
      moves             INTEGER NOT NULL DEFAULT 0,
      elapsed_secs      INTEGER NOT NULL DEFAULT 0,
      board_seed        INTEGER NOT NULL,
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_game_sessions_user ON game_sessions(user_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_game_sessions_game_status ON game_sessions(game_id, status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_session_states_session ON session_states(session_id, sequence)`);

  // user_game_state is PUBLIC: generic per-user game-state store (gameplay
  // progress, no sensitive data). One row per (user_id, game_id); `state` is
  // an arbitrary game-specific JSON blob. This is the reusable persistence
  // layer for NEW non-daily games — they read/write it via GET/PUT
  // /api/state/:gameId instead of needing a bespoke table. Existing bespoke
  // tables (match3_progress, …) stay as-is.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_game_state (
      user_id    TEXT NOT NULL,
      username   TEXT,
      game_id    TEXT NOT NULL,
      state      JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, game_id)
    )
  `);
  await pool.query(`ALTER TABLE user_game_state ADD COLUMN IF NOT EXISTS save_hash TEXT`);
  await pool.query(`ALTER TABLE user_game_state ADD COLUMN IF NOT EXISTS anchor_tx_hash TEXT`);

  /* game_pins is PUBLIC — which games a player pinned to the top of their home
     grid (#232). It is a display preference over ids that are already public
     (every game id is a deep-link key), so a stranger reading every row learns
     nothing they could not read off the lobby. game_id holds the CARD's anchor
     registry id; the client resolves it back to a card through CARD_BY_GAME_ID,
     which is what lets the four merged cards keep both of their ids. */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_pins (
      user_id   TEXT NOT NULL,
      username  TEXT,
      game_id   TEXT NOT NULL,
      pinned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, game_id)
    )
  `);

  /* game_plays is PUBLIC (Recent goal) — which games this player launched and
     when, powering the lobby's Recently Played strip. Same exposure class as
     game_pins: per-user gameplay activity over ids that are already public
     lobby keys, so a stranger reading every row learns nothing they could not
     read by watching the lobby. One row per (user, game); each new play
     bumps played_at and plays. No foreign keys (public-table rule). */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_plays (
      user_id   TEXT NOT NULL,
      game_id   TEXT NOT NULL,
      username  TEXT,
      plays     INTEGER NOT NULL DEFAULT 1,
      played_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, game_id)
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS game_plays_recent_idx
       ON game_plays(user_id, played_at DESC)`
  );

  // game_favorites is PUBLIC — one row per (user, game) the player starred.
  // Same data class as game_pins: a display preference over ids that are
  // already public (every game id is a deep-link key), so a stranger reading
  // every row learns nothing the lobby does not show. game_id holds the CARD's
  // anchor registry id; the client resolves it back through CARD_BY_GAME_ID,
  // which lets the four merged cards keep both of their ids.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_favorites (
      user_id       TEXT NOT NULL,
      username      TEXT,
      game_id       TEXT NOT NULL,
      favorited_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, game_id)
    )
  `);

  // classic_rooms is PUBLIC: open room-code multiplayer for Classic Games
  // (currently Chutes & Ladders). Mirrors mancala_rooms but is generic — the
  // `state` JSONB is game-specific and `game_id` is validated against
  // ALL_GAME_IDS. No sensitive data (gameplay results only). Any user can join
  // a waiting room by code, so no inviteeId is required.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS classic_rooms (
      id             TEXT PRIMARY KEY,
      game_id        TEXT NOT NULL,
      player1_id     TEXT NOT NULL,
      player2_id     TEXT,
      player1_name   TEXT,
      player2_name   TEXT,
      state          JSONB NOT NULL DEFAULT '{}',
      move_seq       INTEGER NOT NULL DEFAULT 0,
      status         TEXT NOT NULL DEFAULT 'waiting',
      winner         TEXT,
      last_move_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  // Race-mode columns (used by 2048 / Block Blast online race; ignored by
  // Chutes & Ladders, which uses turn-based `state`/`move_seq`). Each player
  // plays their own board and submits a final score; when both are in the
  // server picks the winner. Idempotent ADD COLUMN per platform DB convention.
  await pool.query(`ALTER TABLE classic_rooms ADD COLUMN IF NOT EXISTS p1_score INTEGER`);
  await pool.query(`ALTER TABLE classic_rooms ADD COLUMN IF NOT EXISTS p2_score INTEGER`);
  await pool.query(`ALTER TABLE classic_rooms ADD COLUMN IF NOT EXISTS p1_finished_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE classic_rooms ADD COLUMN IF NOT EXISTS p2_finished_at TIMESTAMPTZ`);
  // Multi-seat columns (Ludo 2–4P — spec change-list item 10). Every existing
  // room keeps max_players = 2 and NULL seats 3/4, so the 2P paths (including
  // rating) behave exactly as before. Idempotent ADD COLUMN per convention.
  await pool.query(`ALTER TABLE classic_rooms ADD COLUMN IF NOT EXISTS player3_id TEXT`);
  await pool.query(`ALTER TABLE classic_rooms ADD COLUMN IF NOT EXISTS player3_name TEXT`);
  await pool.query(`ALTER TABLE classic_rooms ADD COLUMN IF NOT EXISTS player4_id TEXT`);
  await pool.query(`ALTER TABLE classic_rooms ADD COLUMN IF NOT EXISTS player4_name TEXT`);
  await pool.query(`ALTER TABLE classic_rooms ADD COLUMN IF NOT EXISTS max_players INTEGER NOT NULL DEFAULT 2`);

  // Stale-room cleanup — classic_rooms has no TTL, so abandoned waiting rooms
  // and old finished races accumulate. Prune them on boot (idempotent, cheap).
  await pool.query(
    `DELETE FROM classic_rooms
      WHERE (status = 'waiting'  AND created_at   < now() - interval '24 hours')
         OR (status = 'finished' AND last_move_at < now() - interval '7 days')`
  );

  // classic_scores is PUBLIC — global all-time best score per (user, game) for
  // the score-based classic games (Minesweeper, 2048, Knight's Tour, Block
  // Blast, Hash Rush). Mirrors snake_scores/breakout_scores but generic: one
  // row per (user_id, game_id), upserted with GREATEST so a worse run never
  // lowers a personal best. `extra` holds game-specific stats (best_time_secs,
  // best_level, …) for display. No foreign keys (public-table rule).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS classic_scores (
      user_id      TEXT NOT NULL,
      username     TEXT,
      game_id      TEXT NOT NULL,
      best_score   INTEGER NOT NULL DEFAULT 0,
      games_played INTEGER NOT NULL DEFAULT 0,
      extra        JSONB,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, game_id)
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_classic_scores_game_score
       ON classic_scores(game_id, best_score DESC, updated_at ASC)`
  );


  if (IS_STAGING) {
    // Social staging seeds: create demo users with follow relationships,
    // stats, and achievements. Idempotent, no-op in production.
    const demoUsers = [
      { id: 'staging-demo-user', username: 'staging-demo-user' },
      { id: 'staging-alice', username: 'staging-alice' },
      { id: 'staging-bob', username: 'staging-bob' },
      { id: 'staging-charlie', username: 'staging-charlie' },
    ];

    for (const u of demoUsers) {
      await pool.query(
        `INSERT INTO users (id, username)
         VALUES ($1, $2)
         ON CONFLICT (id) DO NOTHING`,
        [u.id, u.username]
      );
    }

    // Seed follow relationships: demo-user follows alice and bob,
    // alice follows bob
    const follows = [
      ['staging-demo-user', 'staging-alice'],
      ['staging-demo-user', 'staging-bob'],
      ['staging-alice', 'staging-bob'],
      ['staging-bob', 'staging-charlie'],
    ];

    for (const [follower, followee] of follows) {
      await pool.query(
        `INSERT INTO user_follows (follower_id, followee_id)
         VALUES ($1, $2)
         ON CONFLICT (follower_id, followee_id) DO NOTHING`,
        [follower, followee]
      );
    }

    // Seed stats for each demo user
    const stats = [
      ['staging-demo-user', 'staging-demo-user', 4850, 12, 45, 8, 37],
      ['staging-alice', 'staging-alice', 3200, 7, 28, 5, 23],
      ['staging-bob', 'staging-bob', 5600, 15, 52, 12, 40],
      ['staging-charlie', 'staging-charlie', 1900, 3, 15, 2, 13],
    ];

    for (const [uid, uname, score, streak, games, dailies, classics] of stats) {
      await pool.query(
        `INSERT INTO user_stats_snapshot
           (user_id, username, total_score, current_streak, games_played,
            dailies_completed, classics_played, last_win_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now() - interval '2 hours')
         ON CONFLICT (user_id) DO NOTHING`,
        [uid, uname, score, streak, games, dailies, classics]
      );
    }

    // Seed achievements for demo users
    const achievements = [
      ['staging-demo-user', 'personal_best', 'sudoku', 980, { previousBest: 850 }],
      ['staging-demo-user', 'personal_best', 'wordhunt', 1120, { previousBest: 900 }],
      ['staging-demo-user', 'streak_milestone', null, null, { streak: 10 }],
      ['staging-alice', 'personal_best', 'sudoku', 750, { previousBest: 620 }],
      ['staging-alice', 'personal_best', 'cryptowordle', 890, { previousBest: 700 }],
      ['staging-bob', 'personal_best', 'sudoku', 1100, { previousBest: 1050 }],
      ['staging-bob', 'streak_milestone', null, null, { streak: 15 }],
      ['staging-bob', 'personal_best', 'wordhunt', 1350, { previousBest: 1200 }],
      ['staging-charlie', 'personal_best', 'sudoku', 550, { previousBest: null }],
    ];

    for (const [uid, type, gameId, score, meta] of achievements) {
      await pool.query(
        `INSERT INTO user_achievements (user_id, type, game_id, score, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, now() - interval '1 day')
         ON CONFLICT DO NOTHING`,
        [uid, type, gameId, score, JSON.stringify(meta)]
      );
    }

    // Match-3 campaign progression seed — viewer at puzzle 12 with in-progress session.
    const demoUserId = 'staging-demo-user';
    await pool.query(`
      INSERT INTO match3_progress (user_id, username, highest_puzzle, best_score, total_puzzles_completed, last_played_puzzle)
      VALUES ($1, 'staging-demo-user', 12, 3500, 12, 13)
      ON CONFLICT (user_id) DO UPDATE SET highest_puzzle = GREATEST(match3_progress.highest_puzzle, 12)
    `, [demoUserId]);

    // In-progress session on puzzle 13
    const boardSeed = 99999;
    const tiles = JSON.stringify([
      { id: 1, type: 0, pos: 0, locked: false, inBar: false, removed: false },
      { id: 2, type: 1, pos: 1, locked: false, inBar: false, removed: false },
      { id: 3, type: 2, pos: 2, locked: false, inBar: false, removed: false },
      { id: 4, type: 3, pos: 3, locked: false, inBar: false, removed: false },
      { id: 5, type: 4, pos: 4, locked: false, inBar: false, removed: false },
    ]);
    const bar = JSON.stringify([1, 2, 3]);
    await pool.query(`
      INSERT INTO match3_session (user_id, current_puzzle, tiles, bar, score, moves, elapsed_secs, board_seed)
      VALUES ($1, 13, $2, $3, 1200, 15, 60, $4)
      ON CONFLICT (user_id) DO UPDATE SET current_puzzle = 13, score = 1200, moves = 15
    `, [demoUserId, tiles, bar, boardSeed]);

    // Match-3 leaderboard seeds — fake players for global leaderboard display
    const match3Leaderboard = [
      { id: 'staging-m3-ada', name: 'Staging demo Ada', highest: 50, best: 9950 },
      { id: 'staging-m3-borg', name: 'Staging demo Borg', highest: 45, best: 8200 },
      { id: 'staging-m3-chen', name: 'Staging demo Chen', highest: 38, best: 6100 },
      { id: 'staging-m3-dot', name: 'Staging demo Dot', highest: 42, best: 7600 },
    ];
    for (const p of match3Leaderboard) {
      await pool.query(`
        INSERT INTO match3_progress (user_id, username, highest_puzzle, best_score, total_puzzles_completed)
        VALUES ($1, $2, $3, $4, $3)
        ON CONFLICT (user_id) DO NOTHING
      `, [p.id, p.name, p.highest, p.best]);
    }
  }


  // Staging seeds for mancala_rooms so testers can exercise all states
  // without needing a second device. Strictly a no-op in production.
  if (IS_STAGING) {
    const initPits = JSON.stringify([4,4,4,4,4,4,0,4,4,4,4,4,4,0]);
    const finishedPits = JSON.stringify([0,0,0,0,0,0,32,0,0,0,0,0,0,16]);
    const midPits = JSON.stringify([0,0,0,0,0,1,28,2,2,2,2,2,2,5]);

    await pool.query(
      `INSERT INTO mancala_rooms (id, player1_id, player1_name, pits, status)
       VALUES ('STAGE1', 'staging-demo-user', 'staging-p1', $1, 'waiting')
       ON CONFLICT (id) DO NOTHING`,
      [initPits]
    );
    await pool.query(
      `INSERT INTO mancala_rooms
         (id, player1_id, player1_name, player2_id, player2_name, pits, status, winner, current_player)
       VALUES ('STAGE2', 'staging-demo-user', 'staging-p1', 'staging-opponent', 'staging-p2',
               $1, 'finished', '1', 1)
       ON CONFLICT (id) DO NOTHING`,
      [finishedPits]
    );
    await pool.query(
      `INSERT INTO mancala_rooms
         (id, player1_id, player1_name, player2_id, player2_name, pits, status, current_player)
       VALUES ('STAGE3', 'staging-demo-user', 'staging-p1', 'staging-opponent', 'staging-p2',
               $1, 'active', 1)
       ON CONFLICT (id) DO NOTHING`,
      [midPits]
    );

    // Game Menu staging seeds (this change). Both are no-ops in production.
    // 1) A saved Versus-Bot Mancala game so the "Resume Saved" prompt is
    //    demonstrable without playing an AI game to completion.
    await pool.query(
      `INSERT INTO user_game_state (user_id, username, game_id, state)
       VALUES ('staging-demo-user', 'staging-demo-user', 'mancala', $1::jsonb)
       ON CONFLICT (user_id, game_id) DO NOTHING`,
      [JSON.stringify({
        mode: 'bot', difficulty: 'medium',
        pits: [3, 4, 2, 5, 1, 4, 6, 3, 4, 3, 5, 2, 4, 5],
        currentPlayer: 1, moves: 8, secs: 64,
      })]
    );
    // 2) A waiting Chutes & Ladders online room so a tester can demo "Join Room"
    //    with code CLTST.
    await pool.query(
      `INSERT INTO classic_rooms (id, game_id, player1_id, player1_name, state, status)
       VALUES ('CLTST', 'chutes-ladders', 'staging-demo-user', 'staging-p1', $1::jsonb, 'waiting')
       ON CONFLICT (id) DO NOTHING`,
      [JSON.stringify({ p1Pos: 0, p2Pos: 0, currentPlayer: 1, die: null, rolls: 0 })]
    );

    // Snake leaderboard seed — newly created table is empty in staging, so the
    // leaderboard tab would have nothing to show. Obviously-fake users with a
    // spread of scores so the ranking is visibly sorted. Idempotent; no-op in
    // production.
    const snakeSeed = [
      ['snake-demo-1', 'staging-snake-pro',    480, 51, 142],
      ['snake-demo-2', 'staging-snake-ace',    360, 39, 118],
      ['snake-demo-3', 'staging-snake-rookie', 210, 24, 77],
      ['snake-demo-4', 'staging-snake-fan',    150, 18, 55],
      ['snake-demo-5', 'staging-snake-newbie', 90,  12, 33],
    ];
    for (const [uid, uname, best, len, secs] of snakeSeed) {
      await pool.query(
        `INSERT INTO snake_scores
           (user_id, username, best_score, best_length, best_time_secs, games_played)
         VALUES ($1, $2, $3, $4, $5, 3)
         ON CONFLICT (user_id) DO NOTHING`,
        [uid, uname, best, len, secs]
      );
    }

    // Bounce (Breakout) leaderboard seed — same rationale as Snake: a freshly
    // created table is empty in staging, so the leaderboard tab would have
    // nothing to show. Obviously-fake users with a descending spread.
    // Idempotent; no-op in production.
    const bounceSeed = [
      ['bounce-demo-1', 'staging-bounce-pro',    2400, 6, 188],
      ['bounce-demo-2', 'staging-bounce-ace',    1500, 4, 140],
      ['bounce-demo-3', 'staging-bounce-rookie', 900,  3, 96],
      ['bounce-demo-4', 'staging-bounce-fan',    450,  2, 64],
      ['bounce-demo-5', 'staging-bounce-newbie', 180,  1, 38],
    ];
    for (const [uid, uname, best, lvl, secs] of bounceSeed) {
      await pool.query(
        `INSERT INTO breakout_scores
           (user_id, username, best_score, best_level, best_time_secs, games_played)
         VALUES ($1, $2, $3, $4, $5, 3)
         ON CONFLICT (user_id) DO NOTHING`,
        [uid, uname, best, lvl, secs]
      );
    }

    // Zuma leaderboard seed — newly created table is empty in staging, so the
    // leaderboard tab would have nothing to show. Obviously-fake users with a
    // spread of scores. Idempotent; no-op in production.
    const zumaSeed = [
      ['zuma-demo-1', 'staging-zuma-master',  4200, 3, 210],
      ['zuma-demo-2', 'staging-zuma-ace',     2900, 3, 275],
      ['zuma-demo-3', 'staging-zuma-rookie',  1600, 2, 188],
      ['zuma-demo-4', 'staging-zuma-fan',      750, 2, 130],
      ['zuma-demo-5', 'staging-zuma-newbie',   280, 1,  60],
    ];
    for (const [uid, uname, best, lvl, secs] of zumaSeed) {
      await pool.query(
        `INSERT INTO zuma_scores
           (user_id, username, best_score, best_level, best_time_secs, games_played)
         VALUES ($1, $2, $3, $4, $5, 3)
         ON CONFLICT (user_id) DO NOTHING`,
        [uid, uname, best, lvl, secs]
      );
    }
  }

  // Tilematch Puzzle staging seeds: populate the leaderboard and daily
  // attempts for the daily leaderboard tab. All idempotent; no-op in prod.
  if (IS_STAGING) {
    // Global leaderboard — 5 fake users with spread of highest levels
    const tmScoreSeed = [
      ['tm-demo-1', 'staging-tm-legend',  480, 510, 12400],
      ['tm-demo-2', 'staging-tm-expert',  310, 325,  8200],
      ['tm-demo-3', 'staging-tm-veteran', 195, 205,  5100],
      ['tm-demo-4', 'staging-tm-player',   88,  92,  2300],
      ['tm-demo-5', 'staging-tm-newbie',   25,  27,   650],
    ];
    for (const [uid, uname, hl, tc, bs] of tmScoreSeed) {
      await pool.query(
        `INSERT INTO tilematch_scores
           (user_id, username, highest_level, total_cleared, best_session_score, games_played)
         VALUES ($1, $2, $3, $4, $5, 10)
         ON CONFLICT (user_id) DO NOTHING`,
        [uid, uname, hl, tc, bs]
      );
    }


    // Daily attempts for daily leaderboard tab
    const today = new Date().toISOString().slice(0, 10);
    const dailySeeds = [
      ['staging-alice',   'staging-alice',   85,  960],
      ['staging-bob',     'staging-bob',    112,  840],
      ['staging-charlie', 'staging-charlie', 137, 720],
    ];
    for (const [uid, uname, timeSecs, score] of dailySeeds) {
      await pool.query(
        `INSERT INTO daily_attempts
           (user_id, username, game_id, attempt_date, score, steps, time_secs, finished_at)
         VALUES ($1, $2, 'tilematchingdaily', $3, $4, 72, $5, now() - interval '1 hour')
         ON CONFLICT (user_id, game_id, attempt_date) DO NOTHING`,
        [uid, uname, today, score, timeSecs]
      );
    }

    // ---- DApp Mode staging seeds -------------------------------------------
    // One VERIFIED + (mock-)ANCHORED tilematchingdaily session for the viewer,
    // with a real recomputed hash-chain ledger, so the Verified badge, the
    // session receipt, and the anchor link are demonstrable on a fresh DB.
    const okSession = {
      id: 'DAPPDEMOOK', game_id: 'tilematchingdaily', seed: 12345,
      usernode_pubkey: 'ut1stagingdemo',
    };
    // A short valid run of legal triples (mirrors what the client would send).
    const okEngine = dapp.getEngine(okSession.game_id);
    const okInit = okEngine.initialState(okSession.seed);
    const okTypes = Array.from(okInit.validTypes).slice(0, 3);
    const okMoves = [];
    let okTs = Date.now() - 120000;
    for (const ty of okTypes) for (let k = 0; k < 3; k++) { okMoves.push({ tileType: ty, tsClient: new Date(okTs).toISOString() }); okTs += 900; }
    const okLedger = dapp.buildLedger(okSession, okMoves);
    await pool.query(
      `INSERT INTO game_sessions
         (id, user_id, username, usernode_pubkey, game_id, seed, status,
          final_score, final_steps, final_time_secs, final_chain_hash,
          anchor_status, anchor_tx_hash, finished_at)
       VALUES ($1, 'staging-demo-user', 'staging-demo-user', $2, $3, $4, 'verified',
               150, $5, 95, $6, 'mock', '0xSTAGINGDEMOANCHOR0000000000000000000000000000000000000000000000', now())
       ON CONFLICT (id) DO NOTHING`,
      [okSession.id, okSession.usernode_pubkey, okSession.game_id, okSession.seed,
       okLedger.entries.length, okLedger.finalChainHash]
    );
    for (const e of okLedger.entries) {
      await pool.query(
        `INSERT INTO session_states (session_id, sequence, move, state_hash, prev_hash, chain_hash, ts_client)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (session_id, sequence) DO NOTHING`,
        [okSession.id, e.sequence, JSON.stringify(e.move), e.stateHash, e.prevHash, e.chainHash, e.tsClient]
      );
    }

    // One DISPUTED session (anti-cheat rejection) so the "couldn't be verified"
    // state and the audit trail are demonstrable.
    await pool.query(
      `INSERT INTO game_sessions
         (id, user_id, username, usernode_pubkey, game_id, seed, status, dispute_reason,
          final_steps, finished_at)
       VALUES ('DAPPDEMOBAD', 'staging-demo-user', 'staging-demo-user', 'ut1stagingdemo',
               'tilematchingdaily', 99999, 'disputed', 'anti_cheat:invalid_tile_types:4', 30, now())
       ON CONFLICT (id) DO NOTHING`
    );

    // One VERIFIED + truly ANCHORED 6×6 Mini Sudoku session, so the daily
    // on-chain receipt for the headline puzzle is demonstrable (anchor_status
    // 'anchored', not the 'mock' the others use). Reached via ?demo=anchor,
    // which deep-links the client to this session's receipt by its fixed id.
    await pool.query(
      `INSERT INTO game_sessions
         (id, user_id, username, usernode_pubkey, game_id, seed, status,
          final_score, final_steps, final_time_secs, final_chain_hash,
          anchor_status, anchor_tx_hash, finished_at)
       VALUES ('DAPPDEMOSUDOKU', 'staging-demo-user', 'staging-demo-user', 'ut1stagingdemo',
               'sudoku', 20240, 'verified', 940, 22, 118,
               '0xSUDOKUDEMOCHAINHASH00000000000000000000000000000000000000000000',
               'anchored',
               '0xSUDOKUDEMOANCHORTX000000000000000000000000000000000000000000000', now())
       ON CONFLICT (id) DO NOTHING`
    );
    await pool.query(
      `INSERT INTO session_states (session_id, sequence, move, state_hash, prev_hash, chain_hash, ts_client)
       VALUES ('DAPPDEMOSUDOKU', 1, $1, $2, $3, $4, now())
       ON CONFLICT (session_id, sequence) DO NOTHING`,
      [
        JSON.stringify({ snapshot: true, score: 940 }),
        '0xSUDOKUDEMOSTATEHASH00000000000000000000000000000000000000000000',
        '0xSUDOKUDEMOGENESIS0000000000000000000000000000000000000000000000',
        '0xSUDOKUDEMOCHAINHASH00000000000000000000000000000000000000000000',
      ]
    );

    // A handful of VERIFIED leaderboard sessions — one Tier A game
    // (tilematchingdaily) and one Tier B game (zuma) — so the Verified filter
    // and ranking are visible. "Staging demo …" labelled, obviously fake.
    const demoBoard = [
      ['DAPPLBADA',  'Staging demo Ada',  'tilematchingdaily', 11, 980, 62],
      ['DAPPLBBORG', 'Staging demo Borg', 'tilematchingdaily', 12, 910, 70],
      ['DAPPLBCY',   'Staging demo Cy',   'zuma',              13, 4200, 140],
      ['DAPPLBDOT',  'Staging demo Dot',  'zuma',              14, 3800, 165],
    ];
    for (const [sid, uname, gameId, seed, score, secs] of demoBoard) {
      await pool.query(
        `INSERT INTO game_sessions
           (id, user_id, username, usernode_pubkey, game_id, seed, status,
            final_score, final_steps, final_time_secs, final_chain_hash,
            anchor_status, finished_at)
         VALUES ($1, $1, $2, 'ut1' || $1, $3, $4, 'verified', $5, 60, $6,
                 'beef' || $1, 'mock', now())
         ON CONFLICT (id) DO NOTHING`,
        [sid, uname, gameId, seed, score, secs]
      );
    }

    // Generic per-user game-state store: one demo row for the viewer so
    // GET /api/state/:gameId returns a non-empty payload during testing.
    await pool.query(
      `INSERT INTO user_game_state (user_id, username, game_id, state)
       VALUES ('staging-demo-user', 'staging-demo-user', 'minesweeper', $1::jsonb)
       ON CONFLICT (user_id, game_id) DO NOTHING`,
      [JSON.stringify({ demo: true, level: 3, board: 'expert', note: 'Staging demo saved state' })]
    );
  }

  // Mancala ZK leaderboard staging seeds: 3 session rows (one per status) and
  // 15 score rows (5 per difficulty) so the leaderboard tabs render with data.
  // Idempotent; no-op in production.
  if (IS_STAGING) {
    // Sessions — exercise pending / verified / rejected states in the UI
    await pool.query(`
      INSERT INTO mancala_sessions
        (id, user_id, commitment, difficulty, status, created_at, verified_at)
      VALUES
        ('MNCSESS1', 'staging-demo-user',
         'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
         'hard', 'verified',
         now() - interval '30 minutes', now() - interval '29 minutes'),
        ('MNCSESS2', 'staging-demo-user',
         'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3',
         'medium', 'rejected',
         now() - interval '1 hour', null),
        ('MNCSESS3', 'staging-mnc-seeder',
         'c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
         'easy', 'pending',
         now() - interval '5 minutes', null)
      ON CONFLICT (id) DO NOTHING
    `);

    // Hard-mode leaderboard seed
    const mncHard = [
      ['mnc-h1', 'staging-mnc-hard-ace', 'hard', 680, 20, 24, 62],
      ['mnc-h2', 'staging-mnc-hard-pro', 'hard', 520, 14, 28, 75],
      ['mnc-h3', 'staging-mnc-hard-mid', 'hard', 410, 10, 32, 88],
      ['mnc-h4', 'staging-mnc-hard-fan', 'hard', 280,  6, 36, 105],
      ['mnc-h5', 'staging-mnc-hard-new', 'hard', 170,  3, 41, 115],
    ];
    // Medium-mode leaderboard seed
    const mncMed = [
      ['mnc-m1', 'staging-mnc-med-ace',  'medium', 750, 22, 22, 58],
      ['mnc-m2', 'staging-mnc-med-pro',  'medium', 580, 16, 26, 70],
      ['mnc-m3', 'staging-mnc-med-mid',  'medium', 430, 11, 30, 85],
      ['mnc-m4', 'staging-mnc-med-fan',  'medium', 310,  7, 34, 98],
      ['mnc-m5', 'staging-mnc-med-new',  'medium', 200,  4, 39, 110],
    ];
    // Easy-mode leaderboard seed (wider margins since AI plays randomly)
    const mncEasy = [
      ['mnc-e1', 'staging-mnc-easy-ace', 'easy', 900, 26, 20, 52],
      ['mnc-e2', 'staging-mnc-easy-pro', 'easy', 710, 19, 23, 65],
      ['mnc-e3', 'staging-mnc-easy-mid', 'easy', 510, 13, 28, 79],
      ['mnc-e4', 'staging-mnc-easy-fan', 'easy', 370,  9, 33, 92],
      ['mnc-e5', 'staging-mnc-easy-new', 'easy', 200,  4, 38, 108],
    ];
    for (const [uid, uname, diff, score, margin, moves, secs] of [...mncHard, ...mncMed, ...mncEasy]) {
      await pool.query(
        `INSERT INTO mancala_scores
           (user_id, username, difficulty, best_score, best_margin, best_moves, best_time_secs, games_played, wins)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 5, 3)
         ON CONFLICT (user_id, difficulty) DO NOTHING`,
        [uid, uname, diff, score, margin, moves, secs]
      );
    }

  }
}

// ---- Mancala room helpers ------------------------------------------------

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateRoomId() {
  let id = '';
  for (let i = 0; i < 6; i++) id += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
  return id;
}


/* ============================================================
   Mancala AI engine (server side)
   ============================================================
   #176 — the Daily Challenge these helpers were built for is retired, and with
   it went TWO byte-for-byte cross-file invariants (the deterministic board
   mirror, and the AI-determinism precondition for server move-mismatch
   checks). What remains is the minimax the ZK replay path still uses. Pure
   integer math, no randomness.
   ============================================================ */
function mncMulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function mncHashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mncTodayUtc() {
  return new Date().toISOString().slice(0, 10);
}
function srvMncGetValidMoves(pits, player) {
  const min = player === 1 ? 0 : 7;
  const max = player === 1 ? 5 : 12;
  const moves = [];
  for (let i = min; i <= max; i++) if (pits[i] > 0) moves.push(i);
  return moves;
}
function srvMncEval(pits) { return pits[6] - pits[13]; }
function srvMncMinimax(pits, player, depth, alpha, beta) {
  const p1Empty = pits.slice(0, 6).every(v => v === 0);
  const p2Empty = pits.slice(7, 13).every(v => v === 0);
  if (p1Empty || p2Empty) {
    const p = pits.slice();
    for (let i = 0; i < 6;  i++) { p[6]  += p[i]; p[i] = 0; }
    for (let i = 7; i < 13; i++) { p[13] += p[i]; p[i] = 0; }
    return srvMncEval(p);
  }
  if (depth === 0) return srvMncEval(pits);
  const moves = srvMncGetValidMoves(pits, player);
  if (moves.length === 0) return srvMncEval(pits);
  if (player === 1) {
    let best = -Infinity;
    for (const idx of moves) {
      const { pits: np, extraTurn } = srvMncDistribute(pits, idx, 1);
      const score = srvMncMinimax(np, extraTurn ? 1 : 2, depth - 1, alpha, beta);
      if (score > best) best = score;
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const idx of moves) {
      const { pits: np, extraTurn } = srvMncDistribute(pits, idx, 2);
      const score = srvMncMinimax(np, extraTurn ? 2 : 1, depth - 1, alpha, beta);
      if (score < best) best = score;
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }
}
// Hard-difficulty AI move for P2 (deterministic; first-best-wins tie-break,
// matching the client). The Daily Challenge always uses 'hard'.
function srvMncAIMove(pits) {
  const moves = srvMncGetValidMoves(pits, 2);
  if (moves.length === 0) return -1;
  let bestIdx = moves[0], bestScore = Infinity;
  for (const idx of moves) {
    const { pits: np, extraTurn } = srvMncDistribute(pits, idx, 2);
    const s = srvMncMinimax(np, extraTurn ? 2 : 1, 6, -Infinity, Infinity);
    if (s < bestScore) { bestScore = s; bestIdx = idx; }
  }
  return bestIdx;
}

function shapeRoom(r) {
  return {
    roomId:        r.id,
    status:        r.status,
    pits:          r.pits,
    currentPlayer: r.current_player,
    winner:        r.winner,
    player1Id:     r.player1_id,
    player2Id:     r.player2_id,
    player1Name:   r.player1_name,
    player2Name:   r.player2_name,
    moveSeq:       r.move_seq,
    lastMoveAt:    r.last_move_at,
  };
}

// Next 00:00:00 UTC after the given instant.
function nextResetUtc(from = new Date()) {
  const d = new Date(Date.UTC(
    from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1, 0, 0, 0, 0
  ));
  return d.toISOString();
}

// The UTC day (YYYY-MM-DD) before a given ISO date string.
function prevUtcDay(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// N UTC days before a given ISO date string.
function prevUtcDayN(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// Consecutive-day streak for a user: the length of the unbroken run of UTC
// days (each with >=1 finished attempt) ending today, or ending yesterday if
// today hasn't been played yet (a streak stays alive until a full day is
// missed). Strict reset: ANY missed UTC day resets the streak to 0 — the
// former streak_freeze grace is disabled (column kept dormant). Computed from
// the existing daily_attempts rows.
async function computeStreak(userId) {
  // GotD-participation semantics (spec §6.3): from GOTD_STREAK_CUTOVER on, a
  // day counts toward the streak only when that day's FEATURED game (the
  // daily_featured row — written on the first request of every day that has
  // any player traffic) has a finished attempt. Days before the cutover keep
  // the legacy any-daily rule, grandfathering every previously earned day so
  // the changeover resets nobody.
  const { rows } = await pool.query(
    `SELECT DISTINCT attempt_date::text AS d
       FROM daily_attempts a
      WHERE a.user_id = $1 AND a.finished_at IS NOT NULL
        AND (
          a.attempt_date < $2::date
          OR EXISTS (
            SELECT 1 FROM daily_featured f
             WHERE f.seed_date = a.attempt_date AND f.game_id = a.game_id
          )
        )
      ORDER BY d DESC
      LIMIT 60`,
    [userId, GOTD_STREAK_CUTOVER]
  );
  if (rows.length === 0) return 0;
  const days = new Set(rows.map(r => r.d));
  const today = new Date().toISOString().slice(0, 10); // UTC
  const yesterday = prevUtcDay(today);
  let cursor;
  if (days.has(today)) cursor = today;
  else if (days.has(yesterday)) cursor = yesterday;
  else {
    // Strict reset: any missed UTC day breaks the streak back to 0. The
    // streak_freezes grace that once bridged a single missed day is
    // intentionally disabled (the column is kept dormant for backward
    // compatibility and possible future re-enablement as "streak insurance").
    return 0; // last finished day is older than yesterday → streak broken
  }
  let streak = 0;
  while (days.has(cursor)) {
    streak++;
    cursor = prevUtcDay(cursor);
  }
  return streak;
}

// The set of streak-milestone day thresholds a user has ever reached, as a
// sorted ascending int array (e.g. [3, 7, 30]). Read from the permanent
// user_achievements rows so earned badges persist across a streak reset.
async function earnedStreakBadges(userId) {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT (metadata->>'streak')::int AS days
         FROM user_achievements
        WHERE user_id = $1 AND type = 'streak_milestone'
          AND metadata ? 'streak'
        ORDER BY days ASC`,
      [userId]
    );
    return rows.map(r => r.days).filter(d => Number.isFinite(d));
  } catch {
    return [];
  }
}

// Shape a DB row for the client.
function shapeAttempt(row) {
  return {
    gameId: row.game_id,
    score: row.score,
    steps: row.steps,
    timeSecs: row.time_secs,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    progress: row.progress || null,
    elapsedSecs: row.elapsed_secs != null ? row.elapsed_secs : null,
    band: row.band || 'normal',
  };
}

app.use(express.json());

// Browsers request /favicon.ico on every page load. The app ships no icon
// file, so the request used to fall through express.static into the
// app.get('*') catch-all and 401 — a console error on every load. Answer it
// with 204 No Content here, ABOVE the auth middleware, so it never reaches
// the gate.
app.get('/favicon.ico', (req, res) => res.status(204).end());

// ---- Social feature helpers -----------------------------------------------

// Lazy init: ensure a user row exists, creating if needed.
async function ensureUser(userId, username, usernode_pubkey) {
  try {
    await pool.query(
      `INSERT INTO users (id, username, usernode_pubkey)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [userId, username, usernode_pubkey]
    );
  } catch (err) {
    // ON CONFLICT (id) only guards the id column — a brand-new id whose
    // username collides with an existing row (e.g. concurrent first-time
    // requests racing each other) still throws a unique_violation on
    // users_username_key. Callers only key off user_id downstream, so
    // swallow this one race instead of failing the whole request.
    if (err.code !== '23505') throw err;
  }
  // Also ensure stats row exists
  await pool.query(
    `INSERT INTO user_stats_snapshot (user_id, username)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, username]
  );
}

// Verify platform-issued JWT if one was passed, then enforce auth on
// anything not explicitly marked public. The iframe adds `?token=…`
// on load; the frontend script forwards the token via `x-usernode-token`
// on subsequent fetches.
const PUBLIC_API_PATHS = new Set(['/health', '/favicon.ico']);
const PUBLIC_PREFIXES = ['/explorer-api/'];

// GET-only public read allowlist (phase 2 / spec §6.10): the anonymous-play
// surface. Path PATTERNS (not exact paths) because two of them carry a
// :gameId segment. Only reads — everything mutating stays behind the gate.
// Handlers matched here must null-guard req.user (anonymous ⇒ me: null,
// isCurrentUser: false).
const PUBLIC_API_GET = [
  /^\/api\/public\/daily$/,               // anonymous daily state (seeds, directory, server time)
  /^\/api\/public\/daily\/[A-Za-z0-9_-]+\/rank-preview$/, // would-be rank for an anonymous run (read-only)
  /^\/api\/daily\/[A-Za-z0-9_-]+\/leaderboard$/,
  /^\/api\/daily\/leaderboard\/today$/,
  /^\/api\/classic\/[A-Za-z0-9_-]+\/leaderboard$/,
  /^\/api\/ladder\/[A-Za-z0-9_-]+$/,      // rating ladder (null-guards req.user)
  // #176 — the per-band arcade boards are reads of the same shape as the daily
  // ones, so they open to anonymous callers on the same terms: the handler
  // null-guards req.user (anonymous ⇒ me: null, isCurrentUser: false). The
  // arcade FINISH route stays auth-gated — it pays points.
  /^\/api\/arcade\/[A-Za-z0-9_-]+\/leaderboard$/,
  // #188 — the all-time board is the same shape as the two above and opens on
  // the same terms; its handler null-guards req.user too.
  /^\/api\/alltime\/[A-Za-z0-9_-]+\/leaderboard$/,
];

// Simple in-memory per-IP sliding window over the public GET surface — the
// spec's §6.7 rate limit applied exactly where the auth gate no longer
// protects. Only ANONYMOUS hits count against the window (token-bearing
// iframe traffic keeps its historical unlimited behaviour). Single-process
// app, so in-memory suffices; the map is swept when it grows past a bound.
const PUBLIC_RL_WINDOW_MS = 60_000;
const PUBLIC_RL_MAX = 60;
const publicRlBuckets = new Map(); // ip -> [hit timestamps, ascending]
function publicRateLimited(ip) {
  const now = Date.now();
  let hits = publicRlBuckets.get(ip);
  if (!hits) { hits = []; publicRlBuckets.set(ip, hits); }
  while (hits.length && now - hits[0] > PUBLIC_RL_WINDOW_MS) hits.shift();
  if (hits.length >= PUBLIC_RL_MAX) return true;
  hits.push(now);
  if (publicRlBuckets.size > 10_000) {
    for (const [k, v] of publicRlBuckets) {
      if (!v.length || now - v[v.length - 1] > PUBLIC_RL_WINDOW_MS) publicRlBuckets.delete(k);
    }
  }
  return false;
}
function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.ip || 'unknown';
}

app.use((req, res, next) => {
  const token = req.query.token || req.headers['x-usernode-token'];
  if (token && USERNODE_JWT_PUBLIC_KEY) {
    try {
      const payload = jwt.verify(token, USERNODE_JWT_PUBLIC_KEY, {
        algorithms: ['RS256'],
        issuer: 'usernode',
        audience: 'usernode:app:' + process.env.USERNODE_APP_ID,
      });
      // Platform iframe tokens only — reject any other purpose.
      if (payload && payload.pur === 'iframe') {
        req.user = payload;
        // The platform signs `id` as a NUMBER, but every *_id column here is
        // TEXT, so pg returns strings. SQL params cast fine either way, but
        // JS-side strict comparisons against row values (roomSeatOf, the
        // leaderboard me-pinning, isOwnProfile via the echoed /api/daily
        // user) silently miss on 7 === '7'. Normalize once at the boundary.
        if (req.user.id != null) req.user.id = String(req.user.id);
      }
    } catch {}
  }

  // Static assets (CSS/JS/images) are always served; the API and the HTML
  // shell are gated so direct hits to the staging/prod subdomain don't
  // leak app data to the public internet.
  if (req.method !== 'GET' || req.path.startsWith('/api/')) {
    if (PUBLIC_API_PATHS.has(req.path)) return next();
    if (PUBLIC_PREFIXES.some((p) => req.path.startsWith(p))) return next();
    if (req.method === 'GET' && PUBLIC_API_GET.some((re) => re.test(req.path))) {
      if (!req.user && publicRateLimited(clientIp(req))) {
        return res.status(429).json({ error: 'Too many requests' });
      }
      return next();
    }
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});

// Always 200 so the container stays routable even while migrations are still
// running or the DB is briefly unreachable; `migrationsReady` is surfaced for
// diagnostics (true once the boot migration has completed).
app.get('/health', (_req, res) => res.json({ status: 'ok', migrationsReady }));

// ---- Social API ----------------------------------------------------------

// GET /api/social/profile/:userId or /api/social/profile/:username
// Returns public profile data
app.get('/api/social/profile/:userIdOrName', async (req, res) => {
  try {
    const idOrName = req.params.userIdOrName;

    // Try to find by ID first, then by username
    let { rows: users } = await pool.query(
      `SELECT id FROM users WHERE id = $1 OR LOWER(username) = LOWER($2) LIMIT 1`,
      [idOrName, idOrName]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const viewedUserId = users[0].id;

    // Get user info and stats
    const { rows: userRows } = await pool.query(
      `SELECT u.id, u.username, u.created_at,
              s.total_score, s.current_streak, s.games_played,
              s.dailies_completed, s.classics_played, s.last_win_at
       FROM users u
       LEFT JOIN user_stats_snapshot s ON u.id = s.user_id
       WHERE u.id = $1`,
      [viewedUserId]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userRows[0];

    // Check if signed-in user follows this user
    let following = false;
    if (req.user) {
      const { rows: followRows } = await pool.query(
        `SELECT 1 FROM user_follows WHERE follower_id = $1 AND followee_id = $2`,
        [req.user.id, viewedUserId]
      );
      following = followRows.length > 0;
    }

    // Count followers and following
    const { rows: followerRows } = await pool.query(
      `SELECT COUNT(*) as count FROM user_follows WHERE followee_id = $1`,
      [viewedUserId]
    );
    const followerCount = parseInt(followerRows[0].count);

    const { rows: followingRows } = await pool.query(
      `SELECT COUNT(*) as count FROM user_follows WHERE follower_id = $1`,
      [viewedUserId]
    );
    const followingCount = parseInt(followingRows[0].count);

    // Live, authoritative streak (computed from finished daily_attempts) rather
    // than the stale user_stats_snapshot.current_streak column, plus the set of
    // permanent streak-milestone badges this player has earned.
    const liveStreak = await computeStreak(viewedUserId);
    const badges = await earnedStreakBadges(viewedUserId);
    const achievements = await earnedAchievementBadges(viewedUserId);

    // Recent game statistics: the player's last 10 finished daily runs.
    // score 0 = a recorded loss (e.g. Daily Cipher) — the client shows "Played".
    const { rows: recentRows } = await pool.query(
      `SELECT game_id, attempt_date, score, steps, time_secs
         FROM daily_attempts
        WHERE user_id = $1 AND finished_at IS NOT NULL
        ORDER BY finished_at DESC
        LIMIT 10`,
      [viewedUserId]
    );
    const recentGames = recentRows.map(r => ({
      gameId: r.game_id,
      date: r.attempt_date instanceof Date
        ? r.attempt_date.toISOString().slice(0, 10)
        : String(r.attempt_date).slice(0, 10),
      score: r.score || 0,
      steps: r.steps,
      timeSecs: r.time_secs,
    }));

    res.json({
      user: {
        id: user.id,
        username: user.username,
        createdAt: user.created_at,
      },
      badges,
      achievements,
      stats: {
        totalScore: user.total_score || 0,
        currentStreak: liveStreak,
        gamesPlayed: user.games_played || 0,
        dailiesCompleted: user.dailies_completed || 0,
        classicsPlayed: user.classics_played || 0,
        lastWinAt: user.last_win_at,
      },
      recentGames,
      following,
      followerCount,
      followingCount,
    });
  } catch (err) {
    console.error('[social] profile failed:', err.message);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

// GET /api/social/friends
// Returns the signed-in user's friend list
app.get('/api/social/friends', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.username, s.total_score, s.current_streak, s.last_win_at
       FROM users u
       LEFT JOIN user_stats_snapshot s ON u.id = s.user_id
       WHERE u.id IN (
         SELECT followee_id FROM user_follows WHERE follower_id = $1
       )
       ORDER BY u.username ASC`,
      [req.user.id]
    );

    res.json({
      friends: rows.map(r => ({
        id: r.id,
        username: r.username,
        totalScore: r.total_score || 0,
        currentStreak: r.current_streak || 0,
        lastWinAt: r.last_win_at,
      })),
      count: rows.length,
    });
  } catch (err) {
    console.error('[social] friends failed:', err.message);
    res.status(500).json({ error: 'Failed to load friends' });
  }
});

// GET /api/social/search?q=<term>
// Name search for the Friends screen's add-friend flow. Auth-gated
// (deliberately NOT in PUBLIC_API_GET): requires ≥2 chars, matches usernames
// case-insensitively, excludes the caller, and flags who's already followed.
app.get('/api/social/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) {
    return res.status(400).json({ error: 'Search needs at least 2 characters' });
  }
  // Escape ILIKE wildcards so a literal % or _ in the query can't scan-match.
  const escaped = q.replace(/([\\%_])/g, '\\$1');
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.username,
              (f.follower_id IS NOT NULL) AS following
         FROM users u
         LEFT JOIN user_follows f
           ON f.followee_id = u.id AND f.follower_id = $1
        WHERE u.username ILIKE '%' || $2 || '%'
          AND u.id <> $1
        ORDER BY u.username ASC
        LIMIT 20`,
      [req.user.id, escaped]
    );
    res.json({
      results: rows.map(r => ({
        id: r.id,
        username: r.username,
        following: !!r.following,
      })),
    });
  } catch (err) {
    console.error('[social] search failed:', err.message);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

// POST /api/social/follow/:userId
// Follow another user
app.post('/api/social/follow/:userId', async (req, res) => {
  const { userId } = req.params;

  if (userId === req.user.id) {
    return res.status(409).json({ error: 'Cannot follow yourself' });
  }

  try {
    await pool.query(
      `INSERT INTO user_follows (follower_id, followee_id)
       VALUES ($1, $2)
       ON CONFLICT (follower_id, followee_id) DO NOTHING`,
      [req.user.id, userId]
    );
    res.status(204).send();
  } catch (err) {
    console.error('[social] follow failed:', err.message);
    res.status(500).json({ error: 'Failed to follow user' });
  }
});

// DELETE /api/social/unfollow/:userId
// Unfollow another user
app.delete('/api/social/unfollow/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    await pool.query(
      `DELETE FROM user_follows
       WHERE follower_id = $1 AND followee_id = $2`,
      [req.user.id, userId]
    );
    res.status(204).send();
  } catch (err) {
    console.error('[social] unfollow failed:', err.message);
    res.status(500).json({ error: 'Failed to unfollow user' });
  }
});

// ---- Pinned games API (#232) --------------------------------------------
// Auth-gated like every other /api route: the pin belongs to req.user, never
// to an id the client names. Both routes answer with the player's FULL pin
// list so the client replaces its optimistic array with the server's truth
// rather than trying to reproduce the cap's arithmetic locally.

async function readPins(userId) {
  const { rows } = await pool.query(
    `SELECT game_id FROM game_pins WHERE user_id = $1 ORDER BY pinned_at ASC, game_id ASC`,
    [userId]
  );
  return rows.map(r => r.game_id);
}

/* ---- Recently Played tracking (Recent goal) ------------------------------
   Every "I played this game" moment funnels through recordGamePlay. Fire-and-
   forget by design: a tracking failure must never cost a player the score,
   attempt or rating the surrounding route exists to record, so the caller
   wraps it (or the helper swallows everything) and moves on. */
async function recordGamePlay(userId, username, gameId) {
  try {
    await pool.query(
      `INSERT INTO game_plays (user_id, username, game_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, game_id) DO UPDATE SET
         played_at = now(),
         plays = game_plays.plays + 1,
         username = COALESCE(EXCLUDED.username, game_plays.username)`,
      [userId, username || null, gameId]
    );
  } catch (e) { console.warn('[plays] record failed (non-fatal):', e.message); }
}

// The caller's five most recent plays (most recent first) for the lobby strip.
async function readRecentPlays(userId, limit) {
  const { rows } = await pool.query(
    `SELECT game_id, played_at FROM game_plays
      WHERE user_id = $1 ORDER BY played_at DESC, game_id ASC LIMIT $2`,
    [userId, limit]
  );
  return rows.map(r => ({ gameId: r.game_id, playedAt: r.played_at }));
}

// POST /api/pins/:gameId — pin a game to the top of the home grid.
app.post('/api/pins/:gameId', async (req, res) => {
  const { gameId } = req.params;
  if (!ALL_GAME_IDS.has(gameId)) return res.status(400).json({ error: 'Unknown game' });
  try {
    // The cap is enforced INSIDE the insert: a count-then-insert pair would let
    // two taps in flight at once both see 7 and both land.
    const { rowCount } = await pool.query(
      `INSERT INTO game_pins (user_id, username, game_id)
       SELECT $1, $2, $3
        WHERE (SELECT count(*) FROM game_pins WHERE user_id = $1) < $4
       ON CONFLICT (user_id, game_id) DO NOTHING`,
      [req.user.id, req.user.username || null, gameId, PIN_LIMIT]
    );
    const pins = await readPins(req.user.id);
    if (!rowCount && !pins.includes(gameId)) {
      return res.status(409).json({ error: 'Pin limit reached', limit: PIN_LIMIT, pins });
    }
    res.json({ pins, limit: PIN_LIMIT });
  } catch (err) {
    console.error('[pins] POST failed:', err.message);
    res.status(500).json({ error: 'Failed to pin game' });
  }
});

// DELETE /api/pins/:gameId — unpin. Idempotent: unpinning something that was
// never pinned is a success with an unchanged list.
app.delete('/api/pins/:gameId', async (req, res) => {
  const { gameId } = req.params;
  try {
    await pool.query(`DELETE FROM game_pins WHERE user_id = $1 AND game_id = $2`,
      [req.user.id, gameId]);
    res.json({ pins: await readPins(req.user.id), limit: PIN_LIMIT });
  } catch (err) {
    console.error('[pins] DELETE failed:', err.message);
    res.status(500).json({ error: 'Failed to unpin game' });
  }
});

// ---- Favorite games API --------------------------------------------------
// Same auth-gated, idempotent shape as the pins API above: the favorite
// belongs to req.user, never to an id the client names, and both routes
// answer with the player's FULL favorite list so the client replaces its
// optimistic set with the server's truth. No cap — a list of ids is cheap.

async function readFavorites(userId) {
  const { rows } = await pool.query(
    `SELECT game_id FROM game_favorites WHERE user_id = $1 ORDER BY favorited_at ASC, game_id ASC`,
    [userId]
  );
  return rows.map(r => r.game_id);
}

// PUT /api/favorites/:gameId — star a game. Idempotent: starring an
// already-starred game is a success with an unchanged list.
app.put('/api/favorites/:gameId', async (req, res) => {
  const { gameId } = req.params;
  if (!ALL_GAME_IDS.has(gameId)) return res.status(400).json({ error: 'Unknown game' });
  try {
    await pool.query(
      `INSERT INTO game_favorites (user_id, username, game_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, game_id) DO NOTHING`,
      [req.user.id, req.user.username || null, gameId]
    );
    res.json({ favorites: await readFavorites(req.user.id) });
  } catch (err) {
    console.error('[favorites] PUT failed:', err.message);
    res.status(500).json({ error: 'Failed to favorite game' });
  }
});

// DELETE /api/favorites/:gameId — unstar. Idempotent: unstarring something
// never starred is a success with an unchanged list.
app.delete('/api/favorites/:gameId', async (req, res) => {
  const { gameId } = req.params;
  try {
    await pool.query(`DELETE FROM game_favorites WHERE user_id = $1 AND game_id = $2`,
      [req.user.id, gameId]);
    res.json({ favorites: await readFavorites(req.user.id) });
  } catch (err) {
    console.error('[favorites] DELETE failed:', err.message);
    res.status(500).json({ error: 'Failed to unstar game' });
  }
});

// ---- Posts API (sharing) -----------------------------------------------




// ---- Post comments API ---------------------------------------------------




// ---- Collaborative sessions API ----------------------------------------





// ---- Daily attempts API --------------------------------------------------

// Current UTC-day state for the signed-in user: which games are locked
// today (with their results), plus server time + next reset so the client
// can drive a clock-skew-proof countdown.
// Anonymous substitute for GET /api/daily (public via PUBLIC_API_GET): server
// time, next reset, today's server-issued seeds, and the game directory from
// the registry manifest. No user-specific data — a signed-out visitor gets
// everything needed to render today's boards and browse the directory, per
// spec §6.10. Side-effect-free beyond the lazy daily_seeds upsert.
app.get('/api/public/daily', async (_req, res) => {
  try {
    const seeds = await ensureDailySeeds();
    let featured = null;
    try { featured = await ensureDailyFeatured(); }
    catch (e) { console.warn('[public] featured failed (non-fatal):', e.message); }
    res.json({
      serverNowUtc: new Date().toISOString(),
      nextResetUtc: nextResetUtc(),
      seeds,
      featured,
      games: Object.keys(GAME_REGISTRY).map((id) => ({
        id,
        name: GAME_REGISTRY[id].name,
        category: GAME_REGISTRY[id].category,
        tier: GAME_REGISTRY[id].tier,
        manifest: GAME_REGISTRY[id].manifest,
        daily: GAME_REGISTRY[id].category === 'daily',
      })),
    });
  } catch (err) {
    console.error('[public] daily failed:', err.message);
    res.status(500).json({ error: 'Failed to load public daily state' });
  }
});

app.get('/api/daily', async (req, res) => {
  try {
    // Staging-only fixture: force the "not authenticated" (401) response so the
    // lobby's signed-out badge placeholder is reachable for a screenshot/check
    // even though the staging preview carries a valid token. Returns the same
    // shape the auth middleware uses; strict no-op in production.
    if (IS_STAGING && req.query.demo === 'signedout') {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    // Lazy init: ensure user and stats rows exist
    await ensureUser(req.user.id, req.user.username, req.user.usernode_pubkey);
    // Staging-only demo seed: gives the current viewer a finished attempt
    // for today so they immediately see the locked screen + countdown.
    // Idempotent, obviously fake (round score), strict no-op in production.
    if (IS_STAGING && req.query.demo === 'locked') {
      /* DO UPDATE, not DO NOTHING. This fixture exists to produce a FINISHED
         row, and DO NOTHING cannot: an earlier route in the same run that
         merely OPENED the game leaves a claimed-but-unfinished row behind, the
         insert no-ops against it, and the fixture silently arms nothing — the
         locked screen renders as the pre-game screen instead. The whole suite
         shares one staging database and one viewer, so which tests ran first
         decided whether this one worked (the order-dependence trap in
         CLAUDE.md, in its other direction). Finishing whatever is there is
         both idempotent and what the fixture is named for. */
      await pool.query(
        `INSERT INTO daily_attempts
           (user_id, username, game_id, attempt_date, score, steps, time_secs, finished_at)
         VALUES ($1, $2, 'sudoku', (now() AT TIME ZONE 'utc')::date, 980, 17, 132, now())
         ON CONFLICT (user_id, game_id, attempt_date) DO UPDATE
           SET score = 980, steps = 17, time_secs = 132,
               finished_at = COALESCE(daily_attempts.finished_at, now())`,
        [req.user.id, req.user.username || 'staging-demo-user']
      );
      // Crypto Wordle finished-attempt seed so its locked card/screen is
      // demonstrable on a fresh staging DB. Obviously-fake round numbers.
      await pool.query(
        `INSERT INTO daily_attempts
           (user_id, username, game_id, attempt_date, score, steps, time_secs, finished_at)
         VALUES ($1, $2, 'cryptowordle', (now() AT TIME ZONE 'utc')::date, 820, 4, 95, now())
         ON CONFLICT (user_id, game_id, attempt_date) DO UPDATE
           SET score = 820, steps = 4, time_secs = 95,
               finished_at = COALESCE(daily_attempts.finished_at, now())`,
        [req.user.id, req.user.username || 'staging-demo-user']
      );
    }

    /* Staging-only demo seed (PHASE 4 / #122): a finished nonogram attempt for
       TODAY carrying a solved-grid `progress` snapshot, which is what the new
       locked-day review screen renders. Uses nonogram, not sudoku, on purpose:
       demo=locked and demo=streak both finish the viewer's sudoku row for today
       and proposal checks share one staging DB, so a second sudoku fixture would
       collide.

       #176 — this used to mirror the client's nonogram generator so the stored
       grid was byte-identical to the one the client would derive. That mirror
       is retired along with the noise generator it copied: the review screen
       renders whatever SNAPSHOT the finished row carries, so a fixed
       silhouette is exactly as good for a staging fixture and costs no
       cross-file invariant to keep in step. Idempotent; no-op in production. */
    if (IS_STAGING && req.query.demo === 'solvedboard') {
      const ngSolved = [
        [0,0,1,1,1,1,0,0], [0,1,1,0,0,1,1,0], [1,1,0,1,1,0,1,1],
        [1,1,1,1,1,1,1,1], [1,1,0,1,1,0,1,1], [1,1,1,0,0,1,1,1],
        [0,1,1,1,1,1,1,0], [0,0,1,1,1,1,0,0],
      ];
      await pool.query(
        `INSERT INTO daily_attempts
           (user_id, username, game_id, attempt_date, score, steps, time_secs,
            progress, elapsed_secs, finished_at)
         VALUES ($1, $2, 'nonogram', (now() AT TIME ZONE 'utc')::date, 910, 34, 148,
                 $3::jsonb, 148, now())
         ON CONFLICT (user_id, game_id, attempt_date) DO UPDATE
           SET score = 910, steps = 34, time_secs = 148,
               progress = EXCLUDED.progress, elapsed_secs = 148, finished_at = now()`,
        [req.user.id, req.user.username || 'staging-demo-user',
         JSON.stringify({ dayNum: Math.floor(Date.now() / 86400000), grid: ngSolved })]
      );
    }

    /* Staging-only demo seed (#232): pins three games for the current viewer
       so the Pinned section, its filter behaviour and the pin's "on" state are
       all reachable by navigation alone. game_pins is a NEW table, so staging
       starts with zero rows and none of that would otherwise render.

       The three ids are deliberately mixed — a daily (sudoku), a classic
       (mancala) and one half of a merged card (snakedaily) — and pinned in an
       order that is NOT their registry order, so a screenshot shows the
       section sorting by registry position rather than by recency. Nothing the
       app's own logic reads is fabricated here: a pin only ever moves a card
       up the grid. Idempotent; strict no-op in production. */
    if (IS_STAGING && (req.query.demo === 'pins' || req.query.demo === 'pinsfull')) {
      const demoPins = req.query.demo === 'pinsfull'
        ? ['snakedaily', 'mancala', 'sudoku', 'nonogram', 'checkers',
           'dropstack', '2048', 'wordhunt']
        : ['snakedaily', 'mancala', 'sudoku'];
      for (let i = 0; i < demoPins.length; i++) {
        await pool.query(
          `INSERT INTO game_pins (user_id, username, game_id, pinned_at)
           VALUES ($1, $2, $3, now() - ($4 || ' minutes')::interval)
           ON CONFLICT (user_id, game_id) DO NOTHING`,
          [req.user.id, req.user.username || 'staging-demo-user', demoPins[i],
           String(demoPins.length - i)]
        );
      }
    }

    /* Staging-only counterpart to demo=pins (#232): clears the viewer's pins so
       the zero-pin home — the shape a real player sees before they pin anything —
       is reachable DETERMINISTICALLY. A pin is durable by design, and the whole
       proposal-check suite runs as one viewer against one staging DB, so a plain
       `/` assertion on the empty state would pass or fail purely on whether a
       demo=pins route ran earlier in the file. This makes that order irrelevant.
       Deletes only rows belonging to the caller; strict no-op in production. */
    if (IS_STAGING && req.query.demo === 'pinsempty') {
      await pool.query(`DELETE FROM game_pins WHERE user_id = $1`, [req.user.id]);
    }

    /* Staging-only demo seed (Recent goal): five plays for the current viewer
       so the Recently Played strip, its most-recent-first ordering and its
       replay buttons are reachable by navigation alone. game_plays is a NEW
       table, so staging starts empty and none of that would otherwise render.
       Staggered timestamps make the ordering visible in a screenshot. Only the
       viewer's OWN rows are written/read, so nothing the strip concludes is
       fabricated by the seed itself; delete via demo=recentclear.
       Strict no-op in production. */
    if (IS_STAGING && req.query.demo === 'recent') {
      const demoPlays = ['sudoku', 'mancala', 'snake', 'tilematching', 'wordhunt'];
      for (let i = 0; i < demoPlays.length; i++) {
        await pool.query(
          `INSERT INTO game_plays (user_id, username, game_id, played_at)
           VALUES ($1, $2, $3, now() - ($4 || ' minutes')::interval)
           ON CONFLICT (user_id, game_id) DO NOTHING`,
          [req.user.id, req.user.username || 'staging-demo-user', demoPlays[i],
           String((i + 1) * 25)]
        );
      }
    }

    /* Staging-only demo seed: stars three games for the current viewer so the
       Favorites filter chip and its per-card star state are reachable by
       navigation alone — game_favorites is a NEW table, so staging starts
       with zero rows and an active chip would otherwise show nothing. The
       ids mirror the demo=pins mix (a daily, a classic, one half of a merged
       card). Nothing the app's own logic reads is fabricated here: a favorite
       is the player's own choice, this fixture IS the player acting (one
       viewer, one DB, explicitly armed by the demo param), and it only ever
       controls the chip the viewer opted into. Idempotent; strict no-op in
       production. */
    if (IS_STAGING && req.query.demo === 'favorites') {
      const demoFavorites = ['sudoku', 'mancala', 'snakedaily'];
      for (let i = 0; i < demoFavorites.length; i++) {
        await pool.query(
          `INSERT INTO game_favorites (user_id, username, game_id, favorited_at)
           VALUES ($1, $2, $3, now() - ($4 || ' minutes')::interval)
           ON CONFLICT (user_id, game_id) DO NOTHING`,
          [req.user.id, req.user.username || 'staging-demo-user', demoFavorites[i],
           String(demoFavorites.length - i)]
        );
      }
    }

    /* Staging-only counterpart to demo=recent (Recent goal): clears the
       viewer's play history so the no-history home (no strip at all) is
       reachable deterministically. Same rationale as demo=pinsempty: the
       proposal-check suite runs as one viewer against one staging DB, so a
       plain `/` assertion on the hidden state would depend on route order.
       Deletes only rows belonging to the caller; strict no-op in production. */
    if (IS_STAGING && req.query.demo === 'recentclear') {
      await pool.query(`DELETE FROM game_plays WHERE user_id = $1`, [req.user.id]);
    }

    /* Staging-only counterpart to demo=favorites: clears the viewer's
       favorites so the empty-chip state is reachable deterministically,
       exactly as demo=pinsempty does for pins — the check suite runs as one
       viewer against one staging DB, so the order routes ran in must not
       decide what the chip shows. Deletes only the caller's rows; strict
       no-op in production. */
    if (IS_STAGING && req.query.demo === 'favempty') {
      await pool.query(`DELETE FROM game_favorites WHERE user_id = $1`, [req.user.id]);
    }

    // Staging-only demo seed: gives the current viewer a 10-day consecutive
    // streak (finished sudoku attempts for the last 10 UTC days BEFORE today)
    // so the multiplier tier UI is demonstrable — nav badge, lobby next-tier
    // hint, and a 1.5x win card on today's still-unplayed games. Today is left
    // open on purpose so a tester can trigger a multiplied win. Idempotent,
    // obviously fake (round scores), strict no-op in production.
    if (IS_STAGING && req.query.demo === 'streak') {
      // 10 prior days of FEATURED-game finishes (plus their daily_featured
      // rows), so the streak is demonstrable under the GotD-participation
      // rule regardless of where the cutover falls relative to the seed days.
      await seedFeaturedStreakDays(req.user.id, req.user.username || 'staging-demo-user', 10);
      await openTodayForDemo(req.user.id);
    }

    // Staging-only demo seed: give the current viewer a LONG streak plus the
    // full earned-badge ladder so the streak-badge UI (nav chip, lobby badge
    // strip incl. "Centurion"/"Year-Long Legend", profile badges) is
    // demonstrable. Seeds 60 consecutive finished sudoku days before today
    // (the computeStreak read cap → an active Half-Century badge) and inserts
    // a permanent streak_milestone achievement for EVERY threshold so the
    // higher badges render even past the live-streak cap. Today left open so a
    // tester can still trigger a multiplied win. Idempotent, no-op in prod.
    if (IS_STAGING && req.query.demo === 'badges') {
      // Featured-game finishes so the long streak holds under the GotD rule.
      await seedFeaturedStreakDays(req.user.id, req.user.username || 'staging-demo-user', 60);
      await openTodayForDemo(req.user.id);
      for (const days of STREAK_BADGE_DAYS) {
        await pool.query(
          `INSERT INTO user_achievements (user_id, type, game_id, score, metadata)
           SELECT $1, 'streak_milestone', NULL, NULL, $2::jsonb
            WHERE NOT EXISTS (
              SELECT 1 FROM user_achievements
               WHERE user_id = $1 AND type = 'streak_milestone'
                 AND (metadata->>'streak')::int = $3
            )`,
          [req.user.id, JSON.stringify({ streak: days }), days]
        );
      }
      // Also seed one of every non-streak achievement badge so the broadened
      // badge strip renders fully earned for the viewer. Idempotent per type
      // (and per milestone count). Obviously-fake metadata.
      const achSeed = [
        { type: 'first_solve',     meta: {} },
        { type: 'speed_demon',     meta: { timeSecs: 42 } },
        { type: 'flawless',        meta: { gameId: 'sudoku', steps: 16 } },
        { type: 'daily_sweep',     meta: {} },
        { type: 'podium',          meta: { gameId: 'sudoku' } },
        { type: 'solve_milestone', meta: { count: 10 } },
        { type: 'solve_milestone', meta: { count: 50 } },
        { type: 'solve_milestone', meta: { count: 100 } },
      ];
      for (const a of achSeed) {
        // $3 must be referenced (with an explicit cast) in both branches —
        // an unreferenced parameter fails the whole statement in Postgres.
        const guard = `AND type = $2 AND ($3::int IS NULL OR (metadata->>'count')::int = $3::int)`;
        await pool.query(
          `INSERT INTO user_achievements (user_id, type, game_id, score, metadata)
           SELECT $1, $2, NULL, NULL, $4::jsonb
            WHERE NOT EXISTS (
              SELECT 1 FROM user_achievements WHERE user_id = $1 ${guard}
            )`,
          [req.user.id, a.type, a.type === 'solve_milestone' ? a.meta.count : null, JSON.stringify(a.meta)]
        );
      }
      // One story_complete per ladder, so the Story ladders group in the badge
      // strip also reads fully earned. Without this, broadening the strip by 18
      // chips would quietly break this fixture's "everything unlocked" promise.
      for (const [sGameId, sBands] of Object.entries(STORY_BANDS)) {
        await pool.query(
          `INSERT INTO user_achievements (user_id, type, game_id, metadata)
           SELECT $1, 'story_complete', $2, $3::jsonb
            WHERE NOT EXISTS (
              SELECT 1 FROM user_achievements
               WHERE user_id = $1 AND type = 'story_complete'
                 AND metadata->>'gameId' = $2
            )`,
          [req.user.id, sGameId, JSON.stringify({ gameId: sGameId, bands: sBands })]
        );
      }
    }

    // Staging-only demo seed for the Story-ladder completion badge: one ladder
    // finished (Sudoku, all 6 bands + its badge), one part-walked (Mine Finder,
    // 5 of 6 — still locked), and one untouched (Crate Push), so the badge
    // strip shows an earned story chip next to locked ones. Idempotent, no-op
    // in prod.
    if (IS_STAGING && req.query.demo === 'storybadges') {
      const storySeed = [
        { gameId: 'sudoku',     upTo: storyBandCount('sudoku') },
        { gameId: 'minefinder', upTo: Math.max(0, storyBandCount('minefinder') - 1) },
      ];
      for (const sg of storySeed) {
        // ASSERT the ladder's state, do not merely add to it. Staging carries
        // one database across every check run and never resets, and two
        // fixtures seed the SAME rows to different depths — this one wants
        // sudoku fully cleared, demo=modes wants it three rungs in. With a
        // plain ON CONFLICT DO NOTHING whichever ran first won permanently and
        // the other silently became a no-op, so the check that depended on the
        // loser failed for reasons nothing in its own proposal could explain.
        await pool.query(
          `DELETE FROM game_progress WHERE user_id = $1 AND game_id = $2 AND band >= $3`,
          [req.user.id, sg.gameId, sg.upTo]
        );
        for (let b = 0; b < sg.upTo; b++) {
          await pool.query(
            `INSERT INTO game_progress (user_id, game_id, band, best_score, best_time_secs, best_steps, cleared_at)
             VALUES ($1, $2, $3, $4, $5, $6, now())
             ON CONFLICT (user_id, game_id, band) DO NOTHING`,
            [req.user.id, sg.gameId, b, 600 + b * 80, 320 - b * 15, 55 + b * 7]
          );
        }
      }
      /* AND THE LOCKED HALF HAS TO BE ASSERTED TOO.

         The point of this collection screen is an EARNED badge sitting beside
         LOCKED ones, so the fixture has to be able to say a ladder is
         unfinished — not merely decline to finish it. On a database that is
         never reset, "unfinished" is not a state you can assume: one
         story_complete row left behind by any earlier session renders the
         locked example as earned instead, and the check that asserts on it
         fails with nothing in its own proposal to explain why. Same rule as
         the bands above — say what you mean, do not add to what is there. */
      const unfinishedLadders = ['minefinder', 'cratepush'];
      await pool.query(
        `DELETE FROM user_achievements
          WHERE user_id = $1 AND type = 'story_complete'
            AND metadata->>'gameId' = ANY($2::text[])`,
        [req.user.id, unfinishedLadders]
      );
      // cratepush is the never-started example (minefinder is the one rung
      // short of done, seeded above), so it must have no progress at all.
      await pool.query(
        `DELETE FROM game_progress WHERE user_id = $1 AND game_id = 'cratepush'`,
        [req.user.id]
      );
      // The earned badge itself, on the same guarded insert the live award uses.
      await pool.query(
        `INSERT INTO user_achievements (user_id, type, game_id, metadata)
         SELECT $1, 'story_complete', 'sudoku', $2::jsonb
          WHERE NOT EXISTS (
            SELECT 1 FROM user_achievements
             WHERE user_id = $1 AND type = 'story_complete'
               AND metadata->>'gameId' = 'sudoku'
          )`,
        [req.user.id, JSON.stringify({ gameId: 'sudoku', bands: storyBandCount('sudoku') })]
      );
    }

    // Staging-only demo seed: populate today's per-game leaderboards with a
    // handful of obviously-fake solvers so the ranking (fastest time, then
    // fewest steps) is demonstrable on a fresh staging DB. Spread time/steps
    // so order and tiebreakers are visible. `games` controls HOW MANY of the
    // daily games each demo user solved today (the "Today's Top Scores"
    // board only reads the featured game's rows, but the per-game boards
    // use them all). Idempotent, strict no-op in prod.
    // demo=makeitcount (phase 8) reuses this same seed: it fills today's
    // boards so the anonymous end screen's rank-preview has real ranks to
    // compute against; the anonymous end screen itself is a client-side demo
    // driven by the ?demo=makeitcount param.
    if (IS_STAGING && (req.query.demo === 'leaderboard' || req.query.demo === 'makeitcount')) {
      const lbSeed = [
        { name: 'Staging demo Ada',  time: 47,  steps: 12, games: 4 }, // swept all → top of champions
        { name: 'Staging demo Borg', time: 63,  steps: 18, games: 3 },
        { name: 'Staging demo Cleo', time: 63,  steps: 21, games: 3 }, // ties Borg on time → steps break
        { name: 'Staging demo Dax',  time: 88,  steps: 9,  games: 2 },
        { name: 'Staging demo Evy',  time: 121, steps: 30, games: 2 },
        { name: 'Staging demo Finn', time: 210, steps: 44, games: 1 },
      ];
      /* TODAY'S FEATURED GAME FIRST. Every user here is seeded on the first
         `games` entries of this list, and the home board this fixture feeds is
         GAME-OF-THE-DAY-scoped — so with the list in plain registry order,
         whether the board had any rows at all depended on where today's
         featured game happened to fall in it. That held only while the daily
         pool was small and fixed; #176 added seven dailies and it stopped
         holding. Putting the featured game at index 0 makes the fixture say
         what it means: everyone seeded here is on today's board. */
      const featuredForLb = await ensureDailyFeatured();
      const dailyGameList = [featuredForLb.gameId]
        .concat(Array.from(GAME_IDS).filter(g => g !== featuredForLb.gameId));
      for (let gi = 0; gi < dailyGameList.length; gi++) {
        const g = dailyGameList[gi];
        for (let i = 0; i < lbSeed.length; i++) {
          const r = lbSeed[i];
          // Only seed this user on the first `games` daily games, so games_solved
          // varies across the champions board while per-game boards stay full.
          if (gi >= r.games) continue;
          await pool.query(
            `INSERT INTO daily_attempts
               (user_id, username, game_id, attempt_date, score, steps, time_secs, finished_at)
             VALUES ($1, $2, $3, (now() AT TIME ZONE 'utc')::date, $4, $5, $6, now())
             ON CONFLICT (user_id, game_id, attempt_date) DO NOTHING`,
            [`staging-demo-lb-${i + 1}`, r.name, g, 1000 - r.time, r.steps, r.time]
          );
        }
      }
      /* #331 — Easy and Hard rows on the FEATURED game so the per-band boards
         are demonstrable. Deliberately DISTINCT users from the Normal rows
         above: staging carries one DB across every check run, and the same
         (user, game, date) triple seeded with a different band would be a
         silent ON CONFLICT no-op — whoever ran first would own the band. */
      const bandSeed = [
        { key: 'e', name: 'Staging demo Greta', time: 61, steps: 15 }, // easy board
        { key: 'e', name: 'Staging demo Hans',  time: 92, steps: 24 },
        { key: 'e', name: 'Staging demo Ivo',   time: 133, steps: 33 },
        { key: 'h', name: 'Staging demo Jana',  time: 79, steps: 20 }, // hard board
        { key: 'h', name: 'Staging demo Kai',   time: 118, steps: 28 },
      ];
      for (const r of bandSeed) {
        await pool.query(
          `INSERT INTO daily_attempts
             (user_id, username, game_id, attempt_date, band, score, steps, time_secs, finished_at)
           VALUES ($1, $2, $3, (now() AT TIME ZONE 'utc')::date, $4, $5, $6, $7, now())
           ON CONFLICT (user_id, game_id, attempt_date) DO UPDATE
             SET band = EXCLUDED.band,
                 score = EXCLUDED.score,
                 steps = EXCLUDED.steps,
                 time_secs = EXCLUDED.time_secs,
                 finished_at = EXCLUDED.finished_at`,
          [`staging-demo-lb-${r.key}${r.name.slice(-1)}`, r.name, featuredForLb.gameId,
           r.key === 'e' ? 'easy' : 'hard', 1000 - r.time, r.steps, r.time]
        );
      }
    }

    // Staging-only demo seed: give the current viewer a CLAIMED, UNFINISHED
    // WORD HUNT attempt for today (accumulated timer/steps, no finished_at) so
    // the "In progress · resume" card and the resume flow are demonstrable.
    //
    // Deliberately targets `wordhunt`, NOT `sudoku`: the `demo=locked` and
    // `demo=streak` seeds finish the viewer's sudoku (and cryptowordle) rows
    // for today, and proposal checks share one staging DB across tests run in
    // order. If this used sudoku too, a prior `demo=locked` visit would have
    // left a FINISHED sudoku row, and `ON CONFLICT DO NOTHING` here would be a
    // no-op — the card would render LOCKED and the "In progress" text would
    // never appear. wordhunt is untouched by the other viewer seeds, so it's
    // collision-free. The DO UPDATE additionally forces the row back to an
    // unfinished state, making this order-independent and re-run safe.
    // Idempotent; today only; strict no-op in prod.
    if (IS_STAGING && req.query.demo === 'resume') {
      await pool.query(
        `INSERT INTO daily_attempts
           (user_id, username, game_id, attempt_date, steps, elapsed_secs, progress)
         VALUES ($1, $2, 'wordhunt', (now() AT TIME ZONE 'utc')::date, $3, $4, $5::jsonb)
         ON CONFLICT (user_id, game_id, attempt_date) DO UPDATE
           SET finished_at = NULL,
               score = NULL,
               time_secs = NULL,
               steps = EXCLUDED.steps,
               elapsed_secs = EXCLUDED.elapsed_secs,
               progress = EXCLUDED.progress`,
        [
          req.user.id,
          req.user.username || 'staging-demo-user',
          7,
          84,
          // dayNum omitted on purpose so the client treats the board as the
          // current daily seed; this just marks a claimed, in-progress row.
          JSON.stringify({ resumeDemo: true }),
        ]
      );
    }

    // Staging-only demo seed: give the current viewer a CLAIMED, UNFINISHED
    // MINE FINDER attempt for today, so the reworked canvas board (slice 3) is
    // reachable by plain navigation — `/?game=minefinder&play=1&demo=minefinder`
    // resumes straight into the field with a carried-over timer and step count
    // instead of burning a fresh claim.
    //
    // The progress payload deliberately carries NO `dayNum`/`revealed`: the
    // client only hydrates a saved field when `progress.dayNum` matches today's
    // server-anchored day number, so this marks the row claimed-and-in-progress
    // while letting the client deal today's real seeded field. (Seeding an
    // explicit `revealed` set would mean duplicating the client's mfBuild mine
    // layout here, and any drift would render a nonsense board.) Same trick as
    // the `demo=resume` wordhunt seed above.
    //
    // Targets `minefinder`, which no other viewer-scoped fixture touches
    // (`demo=locked`/`streak` finish sudoku + cryptowordle; `demo=resume` uses
    // wordhunt; `demo=leaderboard` only seeds fake `staging-demo-lb-*` users),
    // so it can't collide on the shared staging DB. The DO UPDATE forces the
    // row back to unfinished, making it order-independent and re-run safe.
    // Idempotent; today only; strict no-op in prod.
    if (IS_STAGING && req.query.demo === 'minefinder') {
      await pool.query(
        `INSERT INTO daily_attempts
           (user_id, username, game_id, attempt_date, steps, elapsed_secs, progress)
         VALUES ($1, $2, 'minefinder', (now() AT TIME ZONE 'utc')::date, $3, $4, $5::jsonb)
         ON CONFLICT (user_id, game_id, attempt_date) DO UPDATE
           SET finished_at = NULL,
               score = NULL,
               time_secs = NULL,
               steps = EXCLUDED.steps,
               elapsed_secs = EXCLUDED.elapsed_secs,
               progress = EXCLUDED.progress`,
        [
          req.user.id,
          req.user.username || 'staging-demo-user',
          5,
          38,
          JSON.stringify({ minefinderDemo: true }),
        ]
      );
    }

    // Staging-only demo seed (slice 2): the merged "All Games" grid needs all
    // three daily indicator states visible at once — ✓ PLAYED, ▶ RESUME and
    // NEW TODAY.
    //
    // Game choice is deliberate, and it is NOT sudoku/wordhunt. Proposal checks
    // share one staging DB and run in sequence, so a fixture that finishes a
    // game breaks any LATER check that opens the same game with ?play=1 (it
    // would land on the locked screen instead). This one therefore only touches
    // games with no in-game check of their own: klondike (finished), spider
    // (in progress) and mahjongsol/anagrams/cratepush (reset to unplayed, so at
    // least three cards are guaranteed to read NEW TODAY no matter which checks
    // ran before this one). Everything else is left alone — deleting rows
    // wholesale would clobber whatever demo=review / demo=dropstack /
    // demo=tilematch had just seeded.
    // Idempotent; today only; strict no-op in prod.
    if (IS_STAGING && req.query.demo === 'homegrid') {
      await pool.query(
        `INSERT INTO daily_attempts
           (user_id, username, game_id, attempt_date, score, steps, time_secs, finished_at)
         VALUES ($1, $2, 'klondike', (now() AT TIME ZONE 'utc')::date, 940, 31, 128, now())
         ON CONFLICT (user_id, game_id, attempt_date) DO UPDATE
           SET score = EXCLUDED.score, steps = EXCLUDED.steps,
               time_secs = EXCLUDED.time_secs, finished_at = now()`,
        [req.user.id, req.user.username || 'staging-demo-user']
      );
      await pool.query(
        `INSERT INTO daily_attempts
           (user_id, username, game_id, attempt_date, steps, elapsed_secs, progress)
         VALUES ($1, $2, 'spider', (now() AT TIME ZONE 'utc')::date, 6, 71, $3::jsonb)
         ON CONFLICT (user_id, game_id, attempt_date) DO UPDATE
           SET finished_at = NULL, score = NULL, time_secs = NULL,
               steps = EXCLUDED.steps, elapsed_secs = EXCLUDED.elapsed_secs,
               progress = EXCLUDED.progress`,
        [req.user.id, req.user.username || 'staging-demo-user', JSON.stringify({ homegridDemo: true })]
      );
      await pool.query(
        `DELETE FROM daily_attempts
          WHERE user_id = $1
            AND attempt_date = (now() AT TIME ZONE 'utc')::date
            AND game_id IN ('mahjongsol', 'anagrams', 'cratepush')`,
        [req.user.id]
      );
    }

    // Staging-only demo seed (#146): the merged dual-mode cards need their two
    // interesting daily states visible at once — a FINISHED daily (so the card
    // shows "✓ Played" on the daily button while its free-play button stays
    // fully live) and a CLAIMED-BUT-UNFINISHED one (the "▶ Resume today's run"
    // button). NEW TODAY is the default state and needs no fixture.
    //
    // Game choice is deliberate, for the same reason demo=homegrid documents:
    // the whole check suite runs against ONE staging DB in declaration order,
    // so finishing a game breaks any later check that opens it.
    //   • snakedaily is FINISHED — its only routes are ?game=snakedaily (which
    //     asserts the text "Daily Snake", also rendered by the locked result
    //     screen) and a ?practice=1 route, so finishing it is safe.
    //   • bouncedaily is CLAIMED, NOT finished — a later check asserts
    //     "power-ups" from its auto-shown how-to, which launchGame skips for a
    //     FINISHED daily; a claimed-unfinished row still routes to pre-game.
    //   • minefinder / tilematchingdaily are left alone: they own &play=1
    //     checks and are re-seeded by demo=minefinder / demo=tilematch.
    // Idempotent; today only; strict no-op in prod.
    if (IS_STAGING && req.query.demo === 'dualmode') {
      await pool.query(
        `INSERT INTO daily_attempts
           (user_id, username, game_id, attempt_date, score, steps, time_secs, finished_at)
         VALUES ($1, $2, 'snakedaily', (now() AT TIME ZONE 'utc')::date, 610, 20, 74, now())
         ON CONFLICT (user_id, game_id, attempt_date) DO UPDATE
           SET score = EXCLUDED.score, steps = EXCLUDED.steps,
               time_secs = EXCLUDED.time_secs, finished_at = now()`,
        [req.user.id, req.user.username || 'staging-demo-user']
      );
      await pool.query(
        `INSERT INTO daily_attempts
           (user_id, username, game_id, attempt_date, steps, elapsed_secs, progress)
         VALUES ($1, $2, 'bouncedaily', (now() AT TIME ZONE 'utc')::date, 3, 41, $3::jsonb)
         ON CONFLICT (user_id, game_id, attempt_date) DO UPDATE
           SET finished_at = NULL, score = NULL, time_secs = NULL,
               steps = EXCLUDED.steps, elapsed_secs = EXCLUDED.elapsed_secs,
               progress = EXCLUDED.progress`,
        [req.user.id, req.user.username || 'staging-demo-user', JSON.stringify({ dualmodeDemo: true })]
      );
    }

    // Staging-only demo seed (slice 4): a claimed, unfinished NONOGRAM row so a
    // tester can land a few taps, finish, and exercise the results card's
    // "View board" against a real board. No dayNum in the payload, so the
    // client deals today's real seeded puzzle rather than a stale grid.
    // Idempotent; today only; strict no-op in prod.
    if (IS_STAGING && req.query.demo === 'review') {
      await pool.query(
        `INSERT INTO daily_attempts
           (user_id, username, game_id, attempt_date, steps, elapsed_secs, progress)
         VALUES ($1, $2, 'nonogram', (now() AT TIME ZONE 'utc')::date, 12, 64, $3::jsonb)
         ON CONFLICT (user_id, game_id, attempt_date) DO UPDATE
           SET finished_at = NULL, score = NULL, time_secs = NULL,
               steps = EXCLUDED.steps, elapsed_secs = EXCLUDED.elapsed_secs,
               progress = EXCLUDED.progress`,
        [req.user.id, req.user.username || 'staging-demo-user', JSON.stringify({ reviewDemo: true })]
      );
    }

    /* Staging-only demo seed (#218): a claimed, unfinished NONOGRAM row whose
       grid is FULLY DECIDED and provably wrong, so the "filled but does not
       match" verdict, the red clue numbers and the mistake counter are all
       reachable by navigation alone (a proposal check cannot tap 64 cells).

       Even rows all filled, odd rows all marked empty. That can never be the
       day's answer whatever the seed: ngBuildForBand rejects any picture with
       an empty row, so a row of zero filled cells cannot match its clue. No
       blank cells remain, so the grid reads as complete. Today's daily is band
       1 (8x8), which is the size the client's ngFits check requires.
       Idempotent; today only; strict no-op in prod. */
    if (IS_STAGING && req.query.demo === 'ngmistake') {
      const ngDay = Math.floor(Date.now() / 86400000);
      const ngGrid = Array.from({ length: 8 }, (_, r) => new Array(8).fill(r % 2 === 0 ? 1 : 2));
      await pool.query(
        `INSERT INTO daily_attempts
           (user_id, username, game_id, attempt_date, steps, elapsed_secs, progress)
         VALUES ($1, $2, 'nonogram', (now() AT TIME ZONE 'utc')::date, 64, 180, $3::jsonb)
         ON CONFLICT (user_id, game_id, attempt_date) DO UPDATE
           SET finished_at = NULL, score = NULL, time_secs = NULL,
               steps = EXCLUDED.steps, elapsed_secs = EXCLUDED.elapsed_secs,
               progress = EXCLUDED.progress`,
        [
          req.user.id,
          req.user.username || 'staging-demo-user',
          JSON.stringify({ dayNum: ngDay, grid: ngGrid, mistakes: 2 }),
        ]
      );
    }

    // Staging-only demo seed (slice 6): a claimed, unfinished DROP STACK run
    // deep enough to show levels, the next-three queue and Hold without playing
    // five minutes. `lines: 24` puts the player on level 3, so gravity is
    // visibly quicker than a fresh run.
    //
    // A `grid` IS required — the client only hydrates a saved run when it finds
    // one — and it must carry `dayNum` to pass the same-day check. The well is
    // seeded with a few ragged bottom rows; if DS_W/DS_H ever change, the
    // client's hydration pads/truncates rather than rejecting, so this fixture
    // survives a well resize.
    // Idempotent; today only; strict no-op in prod.
    if (IS_STAGING && req.query.demo === 'dropstack') {
      const DS_DEMO_W = 9, DS_DEMO_H = 16;
      const dsGrid = Array.from({ length: DS_DEMO_H }, () => new Array(DS_DEMO_W).fill(0));
      // Three ragged rows of settled blocks, no complete line (a full row would
      // clear itself the moment play resumes).
      const rows = [
        [1, 1, 0, 2, 2, 3, 3, 0, 4],
        [5, 5, 5, 0, 6, 6, 7, 7, 0],
        [2, 0, 3, 3, 4, 4, 0, 1, 1],
      ];
      rows.forEach((row, i) => { dsGrid[DS_DEMO_H - 1 - i] = row.slice(); });
      const dsDay = Math.floor(Date.now() / 86400000);
      await pool.query(
        `INSERT INTO daily_attempts
           (user_id, username, game_id, attempt_date, steps, elapsed_secs, progress)
         VALUES ($1, $2, 'dropstack', (now() AT TIME ZONE 'utc')::date, 60, 145, $3::jsonb)
         ON CONFLICT (user_id, game_id, attempt_date) DO UPDATE
           SET finished_at = NULL, score = NULL, time_secs = NULL,
               steps = EXCLUDED.steps, elapsed_secs = EXCLUDED.elapsed_secs,
               progress = EXCLUDED.progress`,
        [
          req.user.id, req.user.username || 'staging-demo-user',
          JSON.stringify({
            dayNum: dsDay, grid: dsGrid, pieceIdx: 60, lines: 24, points: 4200, level: 3, hold: 1,
          }),
        ]
      );
    }

    // Staging-only demo seed (slice 7): a WAITING Chutes & Ladders room on the
    // MOKSHA PATAM board with code DEMOMP, so a tester who joins it lands on
    // the original board immediately (mirrors demo=boardroom's DEMOBG). The
    // variant is stored on the room state exactly as a real create would, so
    // this exercises the same server path rather than a staging-only one.
    // Idempotent; strict no-op in prod.
    if (IS_STAGING && req.query.demo === 'moksha') {
      const mkInit = boardRules.getRules('chutes-ladders').initialState({ variant: 'moksha' });
      await pool.query(
        `INSERT INTO classic_rooms (id, game_id, player1_id, player1_name, state, status)
         VALUES ('DEMOMP', 'chutes-ladders', 'staging-demo-user', 'Staging demo Mira', $1::jsonb, 'waiting')
         ON CONFLICT (id) DO UPDATE
           SET state = EXCLUDED.state, status = 'waiting',
               player2_id = NULL, player2_name = NULL, winner = NULL, move_seq = 0`,
        [JSON.stringify(mkInit)]
      );
    }

    // Staging-only demo seed (slice 8): a claimed, unfinished DAILY TILE MATCH
    // row. Like the others it carries no dayNum, so the client deals today's
    // real layout from the seed — which is the point, since the whole change is
    // the board generator. Seeded counters show a run already in progress.
    // Idempotent; today only; strict no-op in prod.
    if (IS_STAGING && req.query.demo === 'tilematch') {
      await pool.query(
        `INSERT INTO daily_attempts
           (user_id, username, game_id, attempt_date, steps, elapsed_secs, progress)
         VALUES ($1, $2, 'tilematchingdaily', (now() AT TIME ZONE 'utc')::date, 9, 40, $3::jsonb)
         ON CONFLICT (user_id, game_id, attempt_date) DO UPDATE
           SET finished_at = NULL, score = NULL, time_secs = NULL,
               steps = EXCLUDED.steps, elapsed_secs = EXCLUDED.elapsed_secs,
               progress = EXCLUDED.progress`,
        [req.user.id, req.user.username || 'staging-demo-user', JSON.stringify({ tilematchDemo: true })]
      );
    }

    // Staging-only demo seed: set up the Crypto Wordle hint flow for the
    // viewer — drop them into a claimed, unfinished cryptowordle attempt
    // (lobby shows "In progress · resume") and pre-use 2 hints so the
    // server-side counter persistence is demonstrable. Forces the row
    // unfinished so it survives a prior demo=locked on the shared staging DB.
    // Idempotent, strict no-op in production.
    if (IS_STAGING && req.query.demo === 'hints') {
      await pool.query(
        `INSERT INTO daily_attempts
           (user_id, username, game_id, attempt_date, steps, elapsed_secs, progress)
         VALUES ($1, $2, 'cryptowordle', (now() AT TIME ZONE 'utc')::date, $3, $4, $5::jsonb)
         ON CONFLICT (user_id, game_id, attempt_date) DO UPDATE
           SET finished_at = NULL,
               score = NULL,
               time_secs = NULL,
               steps = EXCLUDED.steps,
               elapsed_secs = EXCLUDED.elapsed_secs,
               progress = EXCLUDED.progress`,
        [
          req.user.id,
          req.user.username || 'staging-demo-user',
          0,
          0,
          // dayNum omitted so the client treats the board as today's daily seed;
          // this just marks a claimed, in-progress row to resume into.
          JSON.stringify({ hintsDemo: true }),
        ]
      );
      // Pre-use 2 hints for every daily game so the server-side counter and
      // resume/persistence are demonstrable. Game-keyed daily_hints table.
      for (const gid of ['cryptowordle', 'sudoku', 'wordhunt', 'tilematchingdaily']) {
        await pool.query(
          `INSERT INTO daily_hints (user_id, username, game_id, hint_date, hints_purchased)
           VALUES ($1, $2, $3, (now() AT TIME ZONE 'utc')::date, 2)
           ON CONFLICT (user_id, game_id, hint_date) DO UPDATE
             SET hints_purchased = 2, updated_at = now()`,
          [req.user.id, req.user.username || 'staging-demo-user', gid]
        );
      }
    }

    // Staging-only demo seed: create a Bounce game attempt with active power-ups
    // so the power-up UI and mechanics are demonstrable on a fresh staging DB.
    if (IS_STAGING && req.query.demo === 'powerup') {
      await pool.query(
        `INSERT INTO breakout_scores
           (user_id, username, best_score, best_level, best_time_secs, games_played)
         VALUES ($1, $2, 1200, 3, 300, 5)
         ON CONFLICT (user_id) DO UPDATE
           SET best_score = GREATEST(breakout_scores.best_score, EXCLUDED.best_score),
               best_level = GREATEST(breakout_scores.best_level, EXCLUDED.best_level)`,
        [req.user.id, req.user.username || 'staging-demo-user']
      );
    }

    // Staging-only demo seed: create a claimed-but-unfinished Word Hunt attempt
    // with a couple of words already found, so the "in progress · resume" UI
    // is demonstrable. game_id must be a real daily-category game (Diamond
    // Rush is classic and never checked by the daily lock/resume machinery),
    // and the progress blob must match Word Hunt's { dayNum, found } shape.
    if (IS_STAGING && req.query.demo === 'powerups') {
      await pool.query(
        `INSERT INTO daily_attempts
           (user_id, username, game_id, attempt_date, steps, elapsed_secs, progress)
         VALUES ($1, $2, 'wordhunt', (now() AT TIME ZONE 'utc')::date, $3, $4, $5::jsonb)
         ON CONFLICT (user_id, game_id, attempt_date) DO UPDATE
           SET finished_at = NULL,
               score = NULL,
               time_secs = NULL,
               steps = EXCLUDED.steps,
               elapsed_secs = EXCLUDED.elapsed_secs,
               progress = EXCLUDED.progress`,
        [
          req.user.id,
          req.user.username || 'staging-demo-user',
          3,
          45,
          JSON.stringify({ dayNum: cwUtcDayNum(), found: ['CODE', 'GEM'] }),
        ]
      );
    }

    // Staging-only demo seed: populate the classic-game leaderboards
    // (classic_scores) with a handful of obviously-fake players so the
    // ClassicLeaderboard (in-game tab + mode-modal "Top players" preview) and
    // its ranking are demonstrable on a fresh staging DB. Idempotent (fixed
    // user ids + ON CONFLICT), obviously fake names, strict no-op in prod.
    // Staging-only demo seed (phase 4): fake users the VIEWER follows, each
    // with finished daily attempts today and all-time classic scores, so the
    // Friends leaderboard tabs show rows distinct from Global. Idempotent,
    // obviously fake, strict no-op in production.
    if (IS_STAGING && req.query.demo === 'friends-lb') {
      const friends = [
        ['staging-demo-friend-1', 'Staging friend Nia',   118, 26],
        ['staging-demo-friend-2', 'Staging friend Otto',  149, 31],
        ['staging-demo-friend-3', 'Staging friend Pia',   201, 38],
        ['staging-demo-friend-4', 'Staging friend Quinn', 260, 45],
      ];
      // Include today's FEATURED game so the GotD-scoped Today's Top Scores
      // board (friends scope) also shows these players, alongside the two
      // fixed per-game boards.
      const flbFeatured = await ensureDailyFeatured();
      const flbGames = Array.from(new Set(['sudoku', 'wordhunt', flbFeatured.gameId]));
      for (const [uid, name, time, steps] of friends) {
        // users row so the Friends screen list (which joins users) shows them.
        await pool.query(
          `INSERT INTO users (id, username) VALUES ($1, $2)
           ON CONFLICT (id) DO NOTHING`,
          [uid, name]
        );
        await pool.query(
          `INSERT INTO user_follows (follower_id, followee_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [req.user.id, uid]
        );
        for (const g of flbGames) {
          await pool.query(
            `INSERT INTO daily_attempts
               (user_id, username, game_id, attempt_date, score, steps, time_secs, finished_at)
             VALUES ($1, $2, $3, (now() AT TIME ZONE 'utc')::date, $4, $5, $6, now())
             ON CONFLICT (user_id, game_id, attempt_date) DO NOTHING`,
            [uid, name, g, 1000 - time, steps, time]
          );
        }
        await pool.query(
          `INSERT INTO classic_scores (user_id, username, game_id, best_score, games_played)
           VALUES ($1, $2, 'chutes-ladders', $3, 5)
           ON CONFLICT (user_id, game_id) DO NOTHING`,
          [uid, name, Math.round((1000 - time) / 100)]
        );
      }
    }

    // Staging-only demo seed: friend SEARCH targets — a handful of fake
    // players the viewer does NOT follow, present in the users table so
    // GET /api/social/search finds them (search "Staging" on the Friends
    // screen and the ＋ Add friend flow is exercisable). Idempotent,
    // obviously fake, strict no-op in production.
    if (IS_STAGING && req.query.demo === 'friendsearch') {
      const seekers = [
        ['staging-demo-seeker-1', 'Staging seeker Rex'],
        ['staging-demo-seeker-2', 'Staging seeker Sam'],
        ['staging-demo-seeker-3', 'Staging seeker Tia'],
        ['staging-demo-seeker-4', 'Staging seeker Uma'],
      ];
      for (const [uid, name] of seekers) {
        await pool.query(
          `INSERT INTO users (id, username) VALUES ($1, $2)
           ON CONFLICT (id) DO NOTHING`,
          [uid, name]
        );
        await pool.query(
          `INSERT INTO user_stats_snapshot (user_id, total_score, current_streak, games_played)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id) DO NOTHING`,
          [uid, 150 + seekers.findIndex(s => s[0] === uid) * 40, 2, 6]
        );
      }
    }

    // Staging-only demo seed (phase 4): populated rating ladder — 8 fake
    // rivals across two head-to-head games with varied Elo, win streaks, and
    // this-week deltas (weekly movers), plus a rating row for the viewer and
    // a few finished classic_rooms matches backing the ratings. Idempotent,
    // obviously fake, strict no-op in production.
    if (IS_STAGING && req.query.demo === 'ladder') {
      const weekStart = utcWeekStart();
      const rivals = [
        // [id, name, elo, winStreak, wins, losses, weeklyDelta]
        ['staging-demo-rival-1', 'Staging rival Kas',   1310, 6, 14,  4,  62],
        ['staging-demo-rival-2', 'Staging rival Lum',   1264, 2, 11,  6,  35],
        ['staging-demo-rival-3', 'Staging rival Mox',   1201, 0,  9,  7, -18],
        ['staging-demo-rival-4', 'Staging rival Nyx',   1150, 3,  8,  6,  21],
        ['staging-demo-rival-5', 'Staging rival Orin',  1098, 0,  6,  8, -44],
        ['staging-demo-rival-6', 'Staging rival Prax',  1042, 1,  5,  9,  12],
        ['staging-demo-rival-7', 'Staging rival Quill',  987, 0,  4, 11,   0],
        ['staging-demo-rival-8', 'Staging rival Rho',    934, 0,  3, 12, -27],
      ];
      for (const g of ['chutes-ladders', '2048', 'checkers', 'reversi']) {
        for (const [uid, name, elo, streak, wins, losses, delta] of rivals) {
          await pool.query(
            `INSERT INTO game_ratings
               (user_id, username, game_id, elo, win_streak, best_streak, wins, losses,
                week_start_elo, week_start_date)
             VALUES ($1, $2, $3, $4, $5, GREATEST($5, 4), $6, $7, $8, $9)
             ON CONFLICT (user_id, game_id) DO NOTHING`,
            [uid, name, g, elo, streak, wins, losses, elo - delta, delta === 0 ? null : weekStart]
          );
        }
        // The viewer gets a mid-table rating so the pinned "me" row renders.
        await pool.query(
          `INSERT INTO game_ratings
             (user_id, username, game_id, elo, win_streak, best_streak, wins, losses,
              week_start_elo, week_start_date)
           VALUES ($1, $2, $3, 1105, 2, 3, 7, 5, 1089, $4)
           ON CONFLICT (user_id, game_id) DO NOTHING`,
          [req.user.id, req.user.username || 'you', g, weekStart]
        );
      }
      // A few finished matches backing the ratings' narrative.
      const backing = [
        ['staging-demo-room-l1', 'chutes-ladders', 'staging-demo-rival-1', 'Staging rival Kas', 'staging-demo-rival-3', 'Staging rival Mox', '1'],
        ['staging-demo-room-l2', 'chutes-ladders', 'staging-demo-rival-4', 'Staging rival Nyx', 'staging-demo-rival-5', 'Staging rival Orin', '1'],
        ['staging-demo-room-l3', '2048',           'staging-demo-rival-2', 'Staging rival Lum', 'staging-demo-rival-8', 'Staging rival Rho', '1'],
      ];
      for (const [rid, gid, p1, n1, p2, n2, winner] of backing) {
        await pool.query(
          `INSERT INTO classic_rooms (id, game_id, player1_id, player1_name, player2_id, player2_name, status, winner)
           VALUES ($1, $2, $3, $4, $5, $6, 'finished', $7)
           ON CONFLICT (id) DO NOTHING`,
          [rid, gid, p1, n1, p2, n2, winner]
        );
      }
    }

    // Staging-only demo seed (phase 5): a WAITING Checkers room with the code
    // DEMOBG, created by a fake opponent, whose state has currentPlayer: 2 —
    // so a tester who joins (becoming player 2) can move immediately and see
    // the server-authoritative board respond. Idempotent; no-op in production.
    if (IS_STAGING && req.query.demo === 'boardroom') {
      const ckInit = boardRules.getRules('checkers').initialState();
      ckInit.currentPlayer = 2;
      await pool.query(
        `INSERT INTO classic_rooms (id, game_id, player1_id, player1_name, state, status)
         VALUES ('DEMOBG', 'checkers', 'staging-demo-opp', 'Staging demo Opp', $1::jsonb, 'waiting')
         ON CONFLICT (id) DO NOTHING`,
        [JSON.stringify(ckInit)]
      );
      // A fresh copy for repeat testers: if the demo room already finished or
      // was joined, re-arm it (still obviously fake, still idempotent per state).
      await pool.query(
        `UPDATE classic_rooms
            SET player2_id = NULL, player2_name = NULL, status = 'waiting',
                state = $1::jsonb, move_seq = 0, winner = NULL, last_move_at = now()
          WHERE id = 'DEMOBG' AND game_id = 'checkers' AND status <> 'waiting'`,
        [JSON.stringify(ckInit)]
      );
    }

    /* Staging-only demo seed (PHASE 7 / #145): rooms the VIEWER hosts.
       The lost-room fix widened /api/rooms/mine to include waiting rooms, and it
       lands on all five board games (the endpoint loops BOARD_RULE_GAME_IDS), so
       this seeds one WAITING room the viewer created (Rejoin + Close), one
       ACTIVE room where it's their turn (Rejoin into a live match), plus waiting
       gomoku/ludo rooms — the Gomoku ghost-confirm and Ludo token pad both need
       a reachable live board to screenshot. Idempotent; no-op in prod. */
    if (IS_STAGING && req.query.demo === 'myroom') {
      const me = req.user.id;
      const myName = req.user.username || 'staging-demo-user';
      const mkWaiting = async (code, gid, maxP) => {
        const init = boardRules.getRules(gid).initialState(maxP || undefined);
        await pool.query(
          `INSERT INTO classic_rooms (id, game_id, player1_id, player1_name, state, status, max_players)
           VALUES ($1, $2, $3, $4, $5::jsonb, 'waiting', $6)
           ON CONFLICT (id) DO UPDATE
             SET player1_id = EXCLUDED.player1_id, player1_name = EXCLUDED.player1_name,
                 player2_id = NULL, player2_name = NULL,
                 player3_id = NULL, player3_name = NULL,
                 player4_id = NULL, player4_name = NULL,
                 state = EXCLUDED.state, status = 'waiting', move_seq = 0,
                 winner = NULL, last_move_at = now()`,
          [code, gid, me, myName, JSON.stringify(init), maxP || 2]
        );
      };
      await mkWaiting('DEMOMY', 'reversi', 2);
      await mkWaiting('DEMOGO', 'gomoku', 2);
      await mkWaiting('DEMOLD', 'ludo', 2);
      // An ACTIVE room with a fake opponent, viewer to move.
      const rvActive = boardRules.getRules('reversi').initialState();
      rvActive.currentPlayer = 1;
      await pool.query(
        `INSERT INTO classic_rooms
           (id, game_id, player1_id, player1_name, player2_id, player2_name, state, status)
         VALUES ('DEMORJ', 'reversi', $1, $2, 'staging-demo-rival', 'Staging demo Rival', $3::jsonb, 'active')
         ON CONFLICT (id) DO UPDATE
           SET player1_id = EXCLUDED.player1_id, player1_name = EXCLUDED.player1_name,
               player2_id = 'staging-demo-rival', player2_name = 'Staging demo Rival',
               state = EXCLUDED.state, status = 'active', move_seq = 0,
               winner = NULL, last_move_at = now()`,
        [me, myName, JSON.stringify(rvActive)]
      );
    }

    // Staging-only demo seed (Ludo 2–4P): a WAITING 3-seat Ludo room with two
    // fake players already seated, so a tester who joins with code DEMOL4
    // fills the last seat, activates the room, and moves immediately
    // (currentPlayer starts at 3 — the seat the tester lands in). Re-arms on
    // repeat hits; strict no-op in prod.
    if (IS_STAGING && req.query.demo === 'ludo4') {
      const l4Init = boardRules.getRules('ludo').initialState(3);
      l4Init.currentPlayer = 3;
      await pool.query(
        `INSERT INTO classic_rooms
           (id, game_id, player1_id, player1_name, player2_id, player2_name, state, status, max_players)
         VALUES ('DEMOL4', 'ludo', 'staging-demo-ludo-1', 'Staging demo Rook', 'staging-demo-ludo-2', 'Staging demo Pawn', $1::jsonb, 'waiting', 3)
         ON CONFLICT (id) DO UPDATE
           SET player2_id = 'staging-demo-ludo-2', player2_name = 'Staging demo Pawn',
               player3_id = NULL, player3_name = NULL, player4_id = NULL, player4_name = NULL,
               state = EXCLUDED.state, status = 'waiting', max_players = 3,
               move_seq = 0, winner = NULL, last_move_at = now()`,
        [JSON.stringify(l4Init)]
      );
    }

    // Staging-only demo seed (phase 7): ~6 fake finished attempts for TODAY'S
    // featured game, so the Game of the Day hero's leaderboard preview has
    // rows on a fresh staging DB. Idempotent; strict no-op in prod.
    if (IS_STAGING && req.query.demo === 'gotd') {
      const feat = await ensureDailyFeatured();
      const gotdSeed = [
        { name: 'Staging demo Ada',  time: 52,  steps: 11 },
        { name: 'Staging demo Borg', time: 71,  steps: 19 },
        { name: 'Staging demo Cleo', time: 84,  steps: 15 },
        { name: 'Staging demo Dax',  time: 102, steps: 22 },
        { name: 'Staging demo Evy',  time: 155, steps: 27 },
        { name: 'Staging demo Finn', time: 240, steps: 40 },
      ];
      for (let i = 0; i < gotdSeed.length; i++) {
        const r = gotdSeed[i];
        await pool.query(
          `INSERT INTO daily_attempts
             (user_id, username, game_id, attempt_date, score, steps, time_secs, finished_at)
           VALUES ($1, $2, $3, (now() AT TIME ZONE 'utc')::date, $4, $5, $6, now())
           ON CONFLICT (user_id, game_id, attempt_date) DO NOTHING`,
          [`staging-demo-gotd-${i + 1}`, r.name, feat.gameId, 1000 - r.time, r.steps, r.time]
        );
      }
    }

    /* Staging-only demo seed (#176): a story ladder half-walked and an arcade
       board with rivals on it. Both are needed for the same reason — the two
       new modes are otherwise invisible on a fresh staging DB: the ladder
       renders every rung as unreachable-and-unstarted, and the arcade board is
       an empty list with no rank to be outside of. Idempotent. */
    if (IS_STAGING && req.query.demo === 'modes') {
      /* Three shapes of the same screen, because the level picker reads
         differently in each and only one of them was reachable before (#184):
           sudoku — half walked: ticks, one open level, locked levels.
           zuma   — every level cleared, which is the only way to see the
                    "All levels cleared" note and an all-ticked picker.
           spider — 3 of 6, the count the header renders as "3/6". Spider's
                    story went from 3 levels to 6, so it is also the game where
                    a stale client table would show as a short picker. */
      const walked = [
        { gameId: 'sudoku', cleared: 3 },
        { gameId: 'zuma',   cleared: 6 },
        { gameId: 'spider', cleared: 3 },
        // Jet Run's ladder half-walked too (request #326): 2 of 6, so the new
        // game shows ticks AND an open rung AND locked ones the same way the
        // classics above do.
        { gameId: 'jetrun', cleared: 2 },
      ];
      for (const w of walked) {
        // Same rule as demo=storybadges: this fixture says sudoku is HALF
        // walked, so it has to be able to say that even after storybadges has
        // marked the same ladder complete on the same shared staging database.
        // "Clearing a level for the first time pays" is the note a half-walked
        // picker renders; a fully cleared one reads "All levels cleared".
        await pool.query(
          `DELETE FROM game_progress WHERE user_id = $1 AND game_id = $2 AND band >= $3`,
          [req.user.id, w.gameId, w.cleared]
        );
        for (let b = 0; b < w.cleared; b++) {
          await pool.query(
            `INSERT INTO game_progress (user_id, game_id, band, best_score, best_time_secs, best_steps, cleared_at)
             VALUES ($1, $2, $3, $4, $5, $6, now())
             ON CONFLICT (user_id, game_id, band) DO NOTHING`,
            [req.user.id, w.gameId, b, 700 + b * 90, 300 - b * 20, 60 + b * 8]
          );
        }
      }
      // Rivals on the Normal arcade board for 2048, plus a modest viewer row
      // that sits outside the top 3 — the case the pinned `me` row exists for.
      const rivals = [
        { name: 'Staging arcade Ada',  score: 21400 },
        { name: 'Staging arcade Borg', score: 18800 },
        { name: 'Staging arcade Cleo', score: 15200 },
        { name: 'Staging arcade Dax',  score: 12600 },
        { name: 'Staging arcade Evy',  score: 9400 },
      ];
      for (let i = 0; i < rivals.length; i++) {
        await pool.query(
          `INSERT INTO arcade_bests
             (user_id, username, game_id, band, best_score, best_time_secs, best_steps, runs, updated_at)
           VALUES ($1, $2, '2048', 'normal', $3, 240, 300, 3, now())
           ON CONFLICT (user_id, game_id, band) DO NOTHING`,
          [`staging-arcade-${i + 1}`, rivals[i].name, rivals[i].score]
        );
      }
      await pool.query(
        `INSERT INTO arcade_bests
           (user_id, username, game_id, band, best_score, best_time_secs, best_steps, runs, updated_at)
         VALUES ($1, $2, '2048', 'normal', 11200, 210, 268, 4, now())
         ON CONFLICT (user_id, game_id, band) DO NOTHING`,
        [req.user.id, req.user.username || null]
      );
      // Rivals on Jet Run's Normal board too (request #326), same shape as the
      // 2048 block above but with its own fake users and a modest viewer row
      // outside the top 3. Same ON CONFLICT DO NOTHING idempotence.
      const jrRivals = [
        { name: 'Staging flyer Ada',  score: 480 },
        { name: 'Staging flyer Borg', score: 420 },
        { name: 'Staging flyer Cleo', score: 360 },
        { name: 'Staging flyer Dax',  score: 300 },
        { name: 'Staging flyer Evy',  score: 240 },
      ];
      for (let i = 0; i < jrRivals.length; i++) {
        await pool.query(
          `INSERT INTO arcade_bests
             (user_id, username, game_id, band, best_score, best_time_secs, best_steps, runs, updated_at)
           VALUES ($1, $2, 'jetrun', 'normal', $3, 150, 60, 3, now())
           ON CONFLICT (user_id, game_id, band) DO NOTHING`,
          [`staging-jet-${i + 1}`, jrRivals[i].name, jrRivals[i].score]
        );
      }
      await pool.query(
        `INSERT INTO arcade_bests
           (user_id, username, game_id, band, best_score, best_time_secs, best_steps, runs, updated_at)
         VALUES ($1, $2, 'jetrun', 'normal', 180, 140, 45, 2, now())
         ON CONFLICT (user_id, game_id, band) DO NOTHING`,
        [req.user.id, req.user.username || null]
      );
      // ...and a few settled runs of the viewer's own, so the run history on
      // the arcade pre-game screen has something to share and replay.
      const { rows: haveRuns } = await pool.query(
        `SELECT 1 FROM arcade_runs WHERE user_id = $1 AND game_id = '2048' LIMIT 1`, [req.user.id]);
      if (!haveRuns.length) {
        const runs = [
          { band: 'normal', seed: 1234567, score: 11200, t: 210, st: 268 },
          { band: 'hard',   seed: 7654321, score: 6800,  t: 140, st: 190 },
          { band: 'easy',   seed: 2468013, score: 9100,  t: 260, st: 310 },
        ];
        for (const r of runs) {
          await pool.query(
            `INSERT INTO arcade_runs
               (user_id, username, game_id, band, seed, score, time_secs, steps, verified, started_at, finished_at)
             VALUES ($1, $2, '2048', $3, $4, $5, $6, $7, true, now(), now())`,
            [req.user.id, req.user.username || null, r.band, r.seed, r.score, r.t, r.st]
          );
        }
      }
    }

    // Staging-only demo seed (phase 7): ~10 chat messages across two game
    // rooms — today's featured game and Checkers — including one message
    // hidden by reports, so the chat sheet + moderation tombstone are
    // demonstrable. Fixed high ids keep it idempotent (fresh staging tables
    // never reach them organically); strict no-op in prod.
    if (IS_STAGING && req.query.demo === 'chat') {
      const feat = await ensureDailyFeatured();
      const chatSeed = [
        [900001, feat.gameId, 'staging-demo-chat-1', 'Staging demo Mallory', 'gg everyone — that deal was rough today', false],
        [900002, feat.gameId, 'staging-demo-chat-2', 'Staging demo Nia',     'solved it in under two minutes, new PB! 🎉', false],
        [900003, feat.gameId, 'staging-demo-chat-3', 'Staging demo Otto',    'any tips for the opening?', false],
        [900004, feat.gameId, 'staging-demo-chat-1', 'Staging demo Mallory', 'work the corners first, always', false],
        // The hidden-by-reports example lives in the CHECKERS room on purpose:
        // the featured game rotates daily, but proposal tests need a stable
        // ?chat=checkers route that shows both live messages and a tombstone.
        [900005, 'checkers',  'staging-demo-chat-4', 'Staging demo Pia',     'SPAM SPAM SPAM buy coins at example dot com', true],
        [900006, feat.gameId, 'staging-demo-chat-2', 'Staging demo Nia',     'streak day 12 🔥', false],
        [900007, 'checkers',  'staging-demo-chat-3', 'Staging demo Otto',    'anyone up for a checkers match? code OTTO42', false],
        [900008, 'checkers',  'staging-demo-chat-5', 'Staging demo Quill',   'that double jump got me twice in a row 😅', false],
        [900009, 'checkers',  'staging-demo-chat-2', 'Staging demo Nia',     'king row or bust', false],
        [900010, 'checkers',  'staging-demo-chat-3', 'Staging demo Otto',    'rematch tonight?', false],
      ];
      for (const [id, gid, uid, uname, body, hidden] of chatSeed) {
        await pool.query(
          `INSERT INTO chat_messages (id, game_id, user_id, username, body, created_at, hidden_at, hide_reason)
           VALUES ($1, $2, $3, $4, $5, now() - interval '1 minute' * $6,
                   ${hidden ? "now()" : 'NULL'}, ${hidden ? "'reports'" : 'NULL'})
           ON CONFLICT (id) DO NOTHING`,
          [id, gid, uid, uname, body, 900011 - id]
        );
      }
      for (let i = 1; i <= 3; i++) {
        await pool.query(
          `INSERT INTO chat_reports (message_id, reporter_id) VALUES (900005, $1)
           ON CONFLICT (message_id, reporter_id) DO NOTHING`,
          [`staging-demo-reporter-${i}`]
        );
      }
    }

    // Staging-only demo seed (phase 7): an ACTIVE checkers room where the
    // VIEWER is player 2 and it's their turn, so the home "In progress" row's
    // your-turn card is demonstrable. Re-arms on every hit (DO UPDATE) so
    // repeat testers always land back in an active, your-turn state.
    if (IS_STAGING && req.query.demo === 'yourturn') {
      const ytInit = boardRules.getRules('checkers').initialState();
      ytInit.currentPlayer = 2;
      await pool.query(
        `INSERT INTO classic_rooms
           (id, game_id, player1_id, player1_name, player2_id, player2_name, state, status)
         VALUES ('DEMOYT', 'checkers', 'staging-demo-rival', 'Staging demo Rival', $1, $2, $3::jsonb, 'active')
         ON CONFLICT (id) DO UPDATE
           SET player2_id = EXCLUDED.player2_id, player2_name = EXCLUDED.player2_name,
               state = EXCLUDED.state, status = 'active', move_seq = 0, winner = NULL,
               last_move_at = now()`,
        [req.user.id, req.user.username || 'staging-demo-user', JSON.stringify(ytInit)]
      );
      // Second room with last_move_at backdated ~46h, so the your-turn card's
      // "expires in ~2h" turn-timer line is demonstrable (48h lazy forfeit).
      const ytInit2 = boardRules.getRules('gomoku').initialState();
      ytInit2.currentPlayer = 2;
      await pool.query(
        `INSERT INTO classic_rooms
           (id, game_id, player1_id, player1_name, player2_id, player2_name, state, status, last_move_at)
         VALUES ('DEMOEX', 'gomoku', 'staging-demo-rival', 'Staging demo Rival', $1, $2, $3::jsonb, 'active', now() - interval '46 hours')
         ON CONFLICT (id) DO UPDATE
           SET player2_id = EXCLUDED.player2_id, player2_name = EXCLUDED.player2_name,
               state = EXCLUDED.state, status = 'active', move_seq = 0, winner = NULL,
               last_move_at = now() - interval '46 hours'`,
        [req.user.id, req.user.username || 'staging-demo-user', JSON.stringify(ytInit2)]
      );
    }

    if (IS_STAGING && req.query.demo === 'classic-scores') {
      const csUsers = [
        { id: 'staging-demo-ada',  name: 'Staging demo Ada' },
        { id: 'staging-demo-borg', name: 'Staging demo Borg' },
        { id: 'staging-demo-cal',  name: 'Staging demo Cal' },
      ];
      for (const u of csUsers) {
        await pool.query(`INSERT INTO users (id, username) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [u.id, u.name]);
      }
      const csSeed = [
        ['staging-demo-ada',  'Staging demo Ada',  'minesweeper',  950, 3],
        ['staging-demo-borg', 'Staging demo Borg', 'minesweeper',  720, 5],
        ['staging-demo-cal',  'Staging demo Cal',  'minesweeper',  510, 2],
        ['staging-demo-ada',  'Staging demo Ada',  '2048',        8200, 5],
        ['staging-demo-borg', 'Staging demo Borg', '2048',        5120, 8],
        ['staging-demo-cal',  'Staging demo Cal',  '2048',        3040, 4],
        ['staging-demo-ada',  'Staging demo Ada',  'knights-tour', 5400, 2],
        ['staging-demo-borg', 'Staging demo Borg', 'knights-tour', 4100, 3],
        ['staging-demo-ada',  'Staging demo Ada',  'blockblast',  1240, 6],
        ['staging-demo-borg', 'Staging demo Borg', 'blockblast',   820, 4],
        ['staging-demo-ada',  'Staging demo Ada',  'hashrush',      1450,  6],
        ['staging-demo-borg', 'Staging demo Borg', 'hashrush',       930,  3],
        ['staging-demo-ada',  'Staging demo Ada',  'diamondrush',   2100,  8],
        ['staging-demo-borg', 'Staging demo Borg', 'diamondrush',   1650,  5],
        ['staging-demo-cal',  'Staging demo Cal',  'diamondrush',   1200,  3],
        ['staging-demo-ada',  'Staging demo Ada',  'chutes-ladders',   5,  9],
        ['staging-demo-borg', 'Staging demo Borg', 'chutes-ladders',   3,  7],
        ['staging-demo-cal',  'Staging demo Cal',  'chutes-ladders',   2,  4],
      ];
      for (const [uid, uname, gid, score, played] of csSeed) {
        await pool.query(
          `INSERT INTO classic_scores (user_id, username, game_id, best_score, games_played)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id, game_id) DO NOTHING`,
          [uid, uname, gid, score, played]
        );
      }
      // Seed snake_scores with obviously-fake players
      const snakeSeed = [
        ['staging-demo-ada',  'Staging demo Ada',  350, 36, 42],
        ['staging-demo-borg', 'Staging demo Borg', 230, 24, 31],
        ['staging-demo-cal',  'Staging demo Cal',  110, 12, 18],
      ];
      for (const [uid, uname, score, len, timeSecs] of snakeSeed) {
        await pool.query(
          `INSERT INTO snake_scores (user_id, username, best_score, best_length, best_time_secs, games_played)
           VALUES ($1, $2, $3, $4, $5, 3)
           ON CONFLICT (user_id) DO NOTHING`,
          [uid, uname, score, len, timeSecs]
        );
      }
    }

    if (IS_STAGING && req.query.demo === 'myscores') {
      /* Seeds the VIEWER's own all-time figures — /api/my/scores is
         caller-keyed, so this fixture must attribute rows to req.user (a
         fixture seeding fake users would show nothing on their profile).
         Past UTC dates only, so it never collides with demo=locked /
         demo=streak, which finish today's rows.

         Staging carries ONE database across every check run and never
         resets, so this fixture has to ASSERT its state, not add to it —
         the same rule demo=storybadges and demo=modes follow. demo=streak
         and demo=badges already finished this viewer's past-date
         daily_attempts, and demo=ladder wrote a rating row; with plain
         ON CONFLICT DO NOTHING those earlier rows win, /api/my/scores
         SUMS them (sudoku 4,820 rather than 320), and the merged Snake
         card prefers that pts over its classic best — so the figures this
         fixture names never render. Clear the viewer's rows for the games
         it names first, including the card-union daily ids that would
         otherwise mask a seeded best (snakedaily over snake, minefinder
         over minesweeper). */
      await pool.query(
        `DELETE FROM daily_attempts
          WHERE user_id = $1
            AND (game_id = 'snakedaily'
                 OR (game_id IN ('sudoku', '2048', 'wordsprint', 'minefinder')
                     AND attempt_date < (now() AT TIME ZONE 'utc')::date))`,
        [req.user.id]
      );
      await pool.query(
        `DELETE FROM classic_scores
          WHERE user_id = $1 AND game_id IN ('minesweeper', '2048', 'chutes-ladders')`,
        [req.user.id]
      );
      await pool.query(`DELETE FROM snake_scores WHERE user_id = $1`, [req.user.id]);
      await pool.query(
        `DELETE FROM game_ratings WHERE user_id = $1 AND game_id = 'checkers'`,
        [req.user.id]
      );
      const msSeed = [
        ['sudoku', 3, 320], ['2048', 2, 800], ['wordsprint', 1, 140],
      ];
      for (const [gid, daysAgo, score] of msSeed) {
        await pool.query(
          `INSERT INTO daily_attempts
             (user_id, username, game_id, attempt_date, score, steps, time_secs, started_at, finished_at)
           VALUES ($1, $2, $3, ((now() AT TIME ZONE 'utc')::date - $4::int), $5, 42, 95,
                   now() - ($4::int * '1 day'::interval), now() - ($4::int * '1 day'::interval))
           ON CONFLICT (user_id, game_id, attempt_date) DO NOTHING`,
          [req.user.id, req.user.username, gid, daysAgo, score]
        );
      }
      const msClassic = [
        ['minesweeper', 950], ['2048', 18432], ['chutes-ladders', 5],
      ];
      for (const [gid, score] of msClassic) {
        await pool.query(
          `INSERT INTO classic_scores (user_id, username, game_id, best_score, games_played)
           VALUES ($1, $2, $3, $4, 3)
           ON CONFLICT (user_id, game_id) DO NOTHING`,
          [req.user.id, req.user.username, gid, score]
        );
      }
      // snake_scores and game_ratings are single rows per user (per game),
      // so UPSERT the asserted values: a re-run must CORRECT them, not
      // no-op behind whatever a previous run or fixture left there.
      await pool.query(
        `INSERT INTO snake_scores (user_id, username, best_score, best_length, best_time_secs, games_played)
         VALUES ($1, $2, 350, 42, 118, 3)
         ON CONFLICT (user_id) DO UPDATE SET
           best_score = 350, best_length = 42, best_time_secs = 118, games_played = 3`,
        [req.user.id, req.user.username]
      );
      await pool.query(
        `INSERT INTO game_ratings (user_id, username, game_id, elo, win_streak, best_streak, wins, losses, draws)
         VALUES ($1, $2, 'checkers', 1046, 2, 3, 4, 2, 0)
         ON CONFLICT (user_id, game_id) DO UPDATE SET
           elo = 1046, win_streak = 2, best_streak = 3, wins = 4, losses = 2, draws = 0`,
        [req.user.id, req.user.username]
      );
    }

    const { rows } = await pool.query(
      `SELECT * FROM daily_attempts
       WHERE user_id = $1 AND attempt_date = (now() AT TIME ZONE 'utc')::date`,
      [req.user.id]
    );
    const attempts = {};
    for (const row of rows) attempts[row.game_id] = shapeAttempt(row);

    const streak = await computeStreak(req.user.id);
    const badges = await earnedStreakBadges(req.user.id);
    const achievements = await earnedAchievementBadges(req.user.id);
    // Server-issued daily seeds (phase 2): today's per-game board seeds. The
    // client derives every daily board from these (mulberry32 downstream),
    // falling back to its legacy day-number derivation if absent.
    let seeds = {};
    try { seeds = await ensureDailySeeds(); }
    catch (e) { console.warn('[daily] seed issue failed (client falls back):', e.message); }

    // Game of the Day (phase 7) — lazily written on first request of the day.
    let featured = null;
    try { featured = await ensureDailyFeatured(); }
    catch (e) { console.warn('[daily] featured failed (non-fatal):', e.message); }

    // All-time personal bests per daily game (phase 3 pre-game screen): best
    // score and fastest winning solve across every past attempt_date.
    const bests = {};
    try {
      const { rows: bestRows } = await pool.query(
        `SELECT game_id, MAX(score)::int AS best_score, MIN(time_secs)::int AS best_time
           FROM daily_attempts
          WHERE user_id = $1 AND finished_at IS NOT NULL
            AND score IS NOT NULL AND score > 0
          GROUP BY game_id`,
        [req.user.id]
      );
      for (const r of bestRows) bests[r.game_id] = { score: r.best_score, timeSecs: r.best_time };
    } catch (e) { console.warn('[daily] bests query failed (non-fatal):', e.message); }
    // Lifetime won-solve count for the "X/Y solves → milestone" progress hint.
    let solveCount = 0;
    try {
      const { rows: scRows } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM daily_attempts
          WHERE user_id = $1 AND finished_at IS NOT NULL
            AND score IS NOT NULL AND score > 0`,
        [req.user.id]
      );
      solveCount = (scRows[0] && scRows[0].n) || 0;
    } catch { solveCount = 0; }

    // Pinned games (#232) — the card anchor ids this player pinned, oldest
    // first. Non-fatal: a lobby without its Pinned section is still a lobby.
    let pins = [];
    try {
      const { rows: pinRows } = await pool.query(
        `SELECT game_id FROM game_pins WHERE user_id = $1 ORDER BY pinned_at ASC, game_id ASC`,
        [req.user.id]
      );
      pins = pinRows.map(r => r.game_id);
    } catch (e) { console.warn('[daily] pins query failed (non-fatal):', e.message); }

    // Recently Played (Recent goal) — this player's five most recent launches
    // for the lobby strip. Non-fatal for the same reason as pins.
    let recentPlays = [];
    try { recentPlays = await readRecentPlays(req.user.id, 5); }
    catch (e) { console.warn('[daily] recentPlays query failed (non-fatal):', e.message); }

    // Favorited games — the card anchor ids this player starred, oldest
    // first. Non-fatal: a lobby without its Favorites filter is still a
    // lobby; the client just falls back to no stars and an empty chip view.
    let favorites = [];
    try {
      favorites = await readFavorites(req.user.id);
    } catch (e) { console.warn('[daily] favorites query failed (non-fatal):', e.message); }

    res.json({
      // Surface the signed-in account so the UI can confirm login +
      // that persistent data is active. Always present here (route is
      // auth-gated), but the client still handles a null user gracefully.
      user: {
        username: req.user.username || null,
        id: req.user.id,
        usernodePubkey: req.user.usernode_pubkey || null,
      },
      serverNowUtc: new Date().toISOString(),
      nextResetUtc: nextResetUtc(),
      streak,
      // Permanent streak-milestone badges (day thresholds) this user has ever
      // earned — kept even after a streak resets, so the lobby/profile can show
      // a player's collected badges independent of the current streak.
      badges,
      // Non-streak achievement badges earned (types) + solve-milestone counts.
      achievements,
      // Lifetime won-solve count, drives the solve-milestone progress hint.
      solveCount,
      attempts,
      // Today's server-issued per-game board seeds ({ gameId: seed }).
      seeds,
      // Game of the Day (phase 7): { date, gameId, seed } from daily_featured.
      featured,
      // All-time personal bests per daily game ({ gameId: { score, timeSecs } }).
      bests,
      // Games pinned to the top of the home grid (#232), oldest pin first.
      pins,
      pinLimit: PIN_LIMIT,
      // Most recent launches for the lobby's Recently Played strip (Recent goal).
      recentPlays,
      // Games starred as favorites, oldest star first.
      favorites,
    });
  } catch (err) {
    console.error('[daily] GET failed:', err.message);
    res.status(500).json({ error: 'Failed to load daily state' });
  }
});

// Claim today's single attempt for a game. First call wins (creates the
// row); any later call the same UTC day hits the unique constraint and is
// rejected as locked.
app.post('/api/daily/:gameId/start', async (req, res) => {
  const { gameId } = req.params;
  if (!GAME_IDS.has(gameId)) return res.status(400).json({ error: 'Unknown game' });
  // The band is chosen on the pre-game screen and sent on the claim. It does
  // not gate anything (same code path either way) — it only picks which seeded
  // deal the client derives and what the board is ranked against. Absent =
  // 'normal' (the pre-band deal, unchanged).
  const band = isDailyBand(req.body && req.body.band) ? req.body.band : 'normal';
  try {
    // Issue (or read) today's board seed alongside the claim, so a client that
    // sat on the lobby across the UTC reset still mounts the new day's board.
    let seed = null;
    try { seed = await ensureDailySeed(gameId); }
    catch (e) { console.warn('[daily] start seed issue failed (client falls back):', e.message); }
    const { rows } = await pool.query(
      `INSERT INTO daily_attempts (user_id, username, game_id, attempt_date, band)
       VALUES ($1, $2, $3, (now() AT TIME ZONE 'utc')::date, $4)
       ON CONFLICT (user_id, game_id, attempt_date) DO NOTHING
       RETURNING *`,
      [req.user.id, req.user.username || null, gameId, band]
    );
    if (rows.length === 0) {
      // Already used today — return the existing attempt so the client can
      // render the locked screen with its stored result.
      const existing = await pool.query(
        `SELECT * FROM daily_attempts
         WHERE user_id = $1 AND game_id = $2
           AND attempt_date = (now() AT TIME ZONE 'utc')::date`,
        [req.user.id, gameId]
      );
      return res.status(409).json({
        error: 'Already played today',
        locked: true,
        nextResetUtc: nextResetUtc(),
        attempt: existing.rows[0] ? shapeAttempt(existing.rows[0]) : null,
        seed,
      });
    }
    // Recently Played tracking (Recent goal): a claimed attempt is a play.
    recordGamePlay(req.user.id, req.user.username, gameId);
    res.json({ attempt: shapeAttempt(rows[0]), nextResetUtc: nextResetUtc(), seed });
  } catch (err) {
    console.error('[daily] start failed:', err.message);
    res.status(500).json({ error: 'Failed to start attempt' });
  }
});

// ---- Daily finish → game_sessions + validateSession (phase 2) --------------
// Routes every daily WIN through the DApp verification pipeline instead of the
// old unconditional snapshot mint:
//   Tier A — the game has a registered engine (lib/dapp.js gameEngines) AND
//     the client submitted a replay-eligible per-move log (`replay: true`,
//     moves carrying engine-shaped fields): the server RE-SIMULATES the run
//     (buildLedger replays every move; illegal moves throw), persists the
//     resulting hash-chain ledger to session_states, and settles via
//     validateSession — steps must match the engine recompute, timing goes
//     through the generalized anti-cheat. The multiplied daily score is
//     deliberately NOT passed as a score claim: the streak multiplier is
//     applied on top of the engine's base score, so an equality check there
//     would dispute every legitimate multiplied win.
//   Tier B — no engine (sudoku / wordhunt / cryptowordle today), or the run
//     wasn't replay-eligible (resumed mid-run, boosters used, no log): records
//     the same single-link snapshot chain as before, but the submitted move
//     TIMESTAMPS now feed dapp.antiCheat heuristics plus a wall-clock
//     plausibility check (move span vs claimed active time).
// Sessions are bound to the server-issued daily seed (genesis hash), which is
// what phase 8's anonymous-commit endpoint will verify against. Never blocks
// the attempt: a 'disputed' verdict just means no Verified badge.
async function settleDailySession({ user, gameId, score, steps, timeSecs, moves, replay }) {
  const seed = await ensureDailySeed(gameId);
  const sid = newSessionId();
  await pool.query(
    `INSERT INTO game_sessions (id, user_id, username, usernode_pubkey, game_id, seed, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'active')`,
    [sid, user.id, user.username || null, user.usernode_pubkey || null, gameId, seed]
  );
  const session = { id: sid, game_id: gameId, seed, usernode_pubkey: user.usernode_pubkey || null };
  const engine = dapp.getEngine(gameId);
  // Replay-eligible moves are the engine-shaped ones (the client's shared move
  // log also carries plain timestamp events from other games' step hooks).
  const replayMoves = engine && replay
    ? moves.filter((m) => m && Number.isInteger(m.tileType))
    : [];

  if (engine && replay && replayMoves.length > 0) {
    // Tier A: full server-side replay re-simulation.
    let verdict; let entries = [];
    try {
      const ledger = dapp.buildLedger(
        session,
        replayMoves.map((m) => ({ tileType: m.tileType, tsClient: m.tsClient != null ? m.tsClient : null }))
      );
      entries = ledger.entries;
      verdict = dapp.validateSession(session, entries, { steps, chainHash: ledger.finalChainHash });
    } catch (err) {
      verdict = { status: 'disputed', reason: 'illegal_move:' + err.message, finalChainHash: null };
    }
    for (const e of entries) {
      await pool.query(
        `INSERT INTO session_states (session_id, sequence, move, state_hash, prev_hash, chain_hash, ts_client)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (session_id, sequence) DO NOTHING`,
        [sid, e.sequence, JSON.stringify(e.move), e.stateHash, e.prevHash, e.chainHash,
         e.tsClient != null ? new Date(e.tsClient).toISOString() : null]
      );
    }
    if (verdict.status === 'verified') {
      await pool.query(
        `UPDATE game_sessions SET status='verified', final_score=$2, final_steps=$3,
                final_time_secs=$4, final_chain_hash=$5, finished_at=now() WHERE id=$1`,
        [sid, score, steps, timeSecs, verdict.finalChainHash]
      );
    } else {
      console.warn(`[daily] tier-A replay disputed (${gameId}): ${verdict.reason}`);
      await pool.query(
        `UPDATE game_sessions SET status='disputed', dispute_reason=$2, final_chain_hash=$3, finished_at=now()
          WHERE id=$1`,
        [sid, verdict.reason, verdict.finalChainHash]
      );
    }
  } else {
    // Tier B: snapshot chain + timing heuristics over the submitted move log.
    const tsEntries = (moves || []).map((m, i) => ({
      sequence: i + 1, move: m, tsClient: m && m.tsClient != null ? m.tsClient : null,
    }));
    // Loose thresholds on purpose: this is a solo puzzle and a false dispute
    // costs a legitimate player their Verified badge. This catches
    // machine-paced scripted runs, not fast humans.
    const ac = dapp.antiCheat(tsEntries, null, null, {
      fastIntervalMs: 120, fastRatioLimit: 0.5, maxMovesPerSec: 6,
    });
    let disputeReason = ac.ok ? null : 'anti_cheat:' + ac.reason;
    // Wall-clock plausibility: the observed move span can't exceed the claimed
    // active play time by more than a generous idle/paused allowance.
    if (!disputeReason && Number.isFinite(timeSecs)) {
      const times = tsEntries.map((e) => e.tsClient).filter((v) => Number.isFinite(v));
      if (times.length >= 2) {
        const spanMs = Math.max(...times) - Math.min(...times);
        if (spanMs > (timeSecs + 300) * 1000) disputeReason = 'span_exceeds_claimed_time';
      }
    }

    const genesis = dapp.genesisHash({ gameId, seed, pubkey: user.usernode_pubkey, sessionId: sid });
    const stateHash = dapp.sha256Hex(dapp.canonicalize({ score, steps: steps || 0, terminal: 1 }));
    const chainHash = dapp.chainStep(genesis, stateHash, 1);
    await pool.query(
      `INSERT INTO session_states (session_id, sequence, move, state_hash, prev_hash, chain_hash, ts_client)
       VALUES ($1, 1, $2, $3, $4, $5, now()) ON CONFLICT (session_id, sequence) DO NOTHING`,
      [sid, JSON.stringify({ snapshot: true, score, moveCount: tsEntries.length }), stateHash, genesis, chainHash]
    );
    if (!disputeReason) {
      await pool.query(
        `UPDATE game_sessions SET status='verified', final_score=$2, final_steps=$3,
                final_time_secs=$4, final_chain_hash=$5, finished_at=now() WHERE id=$1`,
        [sid, score, steps, timeSecs, chainHash]
      );
    } else {
      console.warn(`[daily] tier-B heuristics disputed (${gameId}): ${disputeReason}`);
      await pool.query(
        `UPDATE game_sessions SET status='disputed', dispute_reason=$2, final_chain_hash=$3, finished_at=now()
          WHERE id=$1`,
        [sid, disputeReason, chainHash]
      );
    }
  }
  const { rows: sRows } = await pool.query('SELECT * FROM game_sessions WHERE id = $1', [sid]);
  return shapeSession(sRows[0]);
}

// Record the result of today's attempt (score/steps/time). Only touches
// today's already-claimed row. Also updates user stats and creates achievements.
// Shared finalization for a claimed, unfinished daily attempt — used by BOTH
// POST /api/daily/:gameId/finish (the normal signed-in path) and the phase-8
// POST /api/daily/:gameId/commit (retroactive anonymous-run commit), so a
// committed guest run passes the IDENTICAL scoring, badge, streak, and
// game_sessions/validateSession settlement as every other finish (§6.10
// integrity parity). Records score/steps/time on today's row (finished_at IS
// NULL guard makes concurrent finishes single-winner), updates stats +
// achievements, recomputes the streak, and settles the validation session.
// Returns the finish response payload, or null when there is no claimed,
// unfinished attempt today (callers map that to 409). Throws on DB errors.
async function finalizeDailyAttempt(user, gameId, { score, steps, timeSecs, moves, replay, progress }) {
  // Recently Played tracking (Recent goal): this finish WAS a play. Fire-and-
  // forget via the helper's own catch, so a tracking failure never delays the
  // badges, streak or settlement the rest of this function computes.
  recordGamePlay(user.id, user.username, gameId);

  // Read the player's previous best for this game BEFORE today's finish is
  // committed, so it naturally excludes the in-flight attempt (its
  // finished_at is still NULL at this point). Querying this after the
  // UPDATE below would always see today's own just-written score as the
  // max, so personal_best could never fire.
  const { rows: bestRows } = await pool.query(
    `SELECT MAX(score) as max_score FROM daily_attempts
     WHERE user_id = $1 AND game_id = $2 AND score IS NOT NULL
       AND finished_at IS NOT NULL`,
    [user.id, gameId]
  );
  const prevBest = bestRows.length > 0 ? bestRows[0].max_score : null;

  /* PHASE 4 (#122) — the final board snapshot rides along INSIDE this UPDATE.
     A separate POST /progress after the finish would 409 against the now-finished
     row (harmless but logs a console error, which trips the no-console-errors
     check) — that is exactly why the "never autosave on the winning move" rule
     exists. COALESCE keeps whatever the last in-play autosave wrote when the
     client sends nothing, so resumable games still have something to review. */
  const { rows } = await pool.query(
    `UPDATE daily_attempts
       SET score = $3, steps = $4, time_secs = $5, finished_at = now(),
           progress = COALESCE($6::jsonb, progress)
     WHERE user_id = $1 AND game_id = $2
       AND attempt_date = (now() AT TIME ZONE 'utc')::date
       AND finished_at IS NULL
     RETURNING *`,
    [user.id, gameId, score, steps, timeSecs, progress ? JSON.stringify(progress) : null]
  );
  if (rows.length === 0) {
    // No claimed, unfinished attempt today (client out of sync, or this
    // attempt was already finished) — surface so it resyncs instead of
    // silently overwriting an already-recorded score.
    return null;
  }

  // Update stats snapshot if this is a win (score > 0)
  if (score && score > 0) {
    await pool.query(
      `INSERT INTO user_stats_snapshot (user_id, username, total_score, last_win_at, updated_at)
       VALUES ($1, $2, $3, now(), now())
       ON CONFLICT (user_id) DO UPDATE SET
         total_score = user_stats_snapshot.total_score + $3,
         last_win_at = now(),
         updated_at = now()`,
      [user.id, user.username || null, score]
    );

    // Personal best for this game — award once. No unique constraint
    // backs user_achievements yet, but ON CONFLICT DO NOTHING is added
    // defensively for when one lands (see deferred work).
    if (!prevBest || score > prevBest) {
      await pool.query(
        `INSERT INTO user_achievements (user_id, type, game_id, score, metadata)
         VALUES ($1, 'personal_best', $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [user.id, gameId, score, JSON.stringify({ previousBest: prevBest })]
      );
    }
  }


  // Recompute the streak now that today is finished so the client can
  // reconcile its optimistic value without a full reload.
  const streak = await computeStreak(user.id);

  // Newly-awarded achievements THIS finish, so the client can pop a one-time
  // celebration. Both the streak-milestone block and the non-streak award()
  // helper push into it via their RETURNING clauses.
  const newAchievements = [];
  // Lifetime won-solve count, surfaced in the response so the client can drive
  // the "X/Y solves → milestone" progress hint. Set from the solve_milestone
  // block below (which already counts it); falls back to 0 on a non-win.
  let lifetimeSolves = 0;

  // Award streak-milestone badges as permanent achievements when this win
  // pushes the consecutive-day streak to (or past) a threshold. Idempotent:
  // each threshold is recorded at most once per user via a NOT EXISTS guard,
  // so a second daily game the same day (or a re-finish) never duplicates a
  // badge. RETURNING surfaces only the threshold(s) NEWLY crossed this finish
  // into newAchievements (shape { type:'streak_milestone', metadata:{streak} })
  // so the win overlay can celebrate them server-authoritatively — not relying
  // on the client's optimistic streak math. Best-effort; never blocks.
  if (score && score > 0) {
    try {
      for (const days of STREAK_BADGE_DAYS) {
        if (streak >= days) {
          const { rows: sIns } = await pool.query(
            `INSERT INTO user_achievements (user_id, type, game_id, score, metadata)
             SELECT $1, 'streak_milestone', NULL, NULL, $2::jsonb
              WHERE NOT EXISTS (
                SELECT 1 FROM user_achievements
                 WHERE user_id = $1 AND type = 'streak_milestone'
                   AND (metadata->>'streak')::int = $3
              )
             RETURNING type`,
            [user.id, JSON.stringify({ streak: days }), days]
          );
          if (sIns.length > 0) {
            newAchievements.push({ type: 'streak_milestone', metadata: { streak: days } });
          }
        }
      }
    } catch (badgeErr) {
      console.warn('[daily] streak badge award failed (non-fatal):', badgeErr.message);
    }
  }

  // Award non-streak achievement badges. Each criterion derives from data we
  // just recorded (time/steps/score/game/day). Every insert is guarded by a
  // NOT EXISTS so it's awarded at most once per user (per milestone count for
  // solve_milestone), and RETURNING tells us which ones were NEW this finish
  // so the client can pop a one-time celebration. Best-effort; never blocks.
  if (score && score > 0) {
    try {
      // Helper: idempotent guarded insert; returns true if newly inserted.
      const award = async (type, metadata) => {
        const meta = metadata || {};
        const metaJson = JSON.stringify(meta);
        // For solve_milestone we de-dup per count ($4 = the count); for the
        // rest, per type ($4 is passed as NULL and the guard collapses to the
        // type match). $4 must be referenced with an explicit ::int cast in
        // BOTH branches — an unreferenced parameter makes Postgres fail the
        // whole statement with "could not determine data type of parameter",
        // which silently killed every non-streak badge award.
        const guard = `AND type = $2 AND ($4::int IS NULL OR (metadata->>'count')::int = $4::int)`;
        const { rows: ins } = await pool.query(
          `INSERT INTO user_achievements (user_id, type, game_id, score, metadata)
           SELECT $1, $2, $3, NULL, $5::jsonb
            WHERE NOT EXISTS (
              SELECT 1 FROM user_achievements WHERE user_id = $1 ${guard}
            )
           RETURNING type`,
          [user.id, type, gameId, type === 'solve_milestone' ? meta.count : null, metaJson]
        );
        if (ins.length > 0) newAchievements.push({ type, metadata: meta });
      };

      // first_solve — the user's first ever WON daily attempt.
      await award('first_solve', {});

      // speed_demon — solved any daily in under SPEED_DEMON_MAX_SECS.
      if (timeSecs !== null && timeSecs < SPEED_DEMON_MAX_SECS) {
        await award('speed_demon', { timeSecs });
      }

      // flawless — solved a move-counted daily at/under its step threshold.
      const flawlessMax = FLAWLESS_STEP_THRESHOLDS[gameId];
      if (flawlessMax != null && steps !== null && steps <= flawlessMax) {
        await award('flawless', { gameId, steps });
      }

      // daily_sweep — solved (won) EVERY daily game within today's UTC day.
      const { rows: sweepRows } = await pool.query(
        `SELECT COUNT(DISTINCT game_id)::int AS n
           FROM daily_attempts
          WHERE user_id = $1
            AND attempt_date = (now() AT TIME ZONE 'utc')::date
            AND finished_at IS NOT NULL AND score IS NOT NULL AND score > 0`,
        [user.id]
      );
      if (sweepRows[0] && sweepRows[0].n >= GAME_IDS.size) {
        await award('daily_sweep', {});
      }

      // podium — held rank #1 on THIS game's daily leaderboard at finish time.
      // Count solvers strictly ahead under the (time, steps, finished_at)
      // ordering; zero ahead ⇒ currently #1. Rank can change as others finish
      // later in the day — this is intentional ("held #1 at finish time").
      if (timeSecs !== null) {
        const { rows: aheadRows } = await pool.query(
          `SELECT COUNT(*)::int AS ahead
             FROM daily_attempts
            WHERE game_id = $1
              AND attempt_date = (now() AT TIME ZONE 'utc')::date
              AND finished_at IS NOT NULL AND score IS NOT NULL AND score > 0
              AND user_id <> $2
              AND (
                time_secs < $3
                OR (time_secs = $3 AND steps < $4)
              )`,
          [gameId, user.id, timeSecs, steps]
        );
        if (aheadRows[0] && aheadRows[0].ahead === 0) {
          await award('podium', { gameId });
        }
      }

      // solve_milestone — lifetime finished+won solves crossed a threshold.
      const { rows: cntRows } = await pool.query(
        `SELECT COUNT(*)::int AS n
           FROM daily_attempts
          WHERE user_id = $1 AND finished_at IS NOT NULL
            AND score IS NOT NULL AND score > 0`,
        [user.id]
      );
      const totalSolves = (cntRows[0] && cntRows[0].n) || 0;
      lifetimeSolves = totalSolves;
      for (const m of SOLVE_MILESTONES) {
        if (totalSolves >= m) await award('solve_milestone', { count: m });
      }
    } catch (achErr) {
      console.warn('[daily] achievement award failed (non-fatal):', achErr.message);
    }
  }


  // ---- DApp Mode: settle a session for EVERY daily win --------------------
  // Phase 2: every daily win routes through the game_sessions +
  // validateSession pipeline (settleDailySession below) — tier A full replay
  // re-simulation where an engine exists and the client sent a
  // replay-eligible move log, tier B snapshot + timing heuristics otherwise.
  // Best-effort: a pipeline failure never blocks the recorded attempt, and a
  // 'disputed' verdict just means no Verified badge on the win overlay.
  let dappSession = null;
  if (score && score > 0) {
    try {
      dappSession = await settleDailySession({
        user, gameId, score, steps, timeSecs,
        moves,
        replay,
      });
    } catch (dappErr) {
      console.error('[daily] dapp session settle failed (non-fatal):', dappErr.message);
    }
  }

  return { attempt: shapeAttempt(rows[0]), nextResetUtc: nextResetUtc(), streak, solveCount: lifetimeSolves, dapp: dappSession, newAchievements };
}

app.post('/api/daily/:gameId/finish', async (req, res) => {
  const { gameId } = req.params;
  if (!GAME_IDS.has(gameId)) return res.status(400).json({ error: 'Unknown game' });
  const score = Number.isFinite(req.body.score) ? Math.round(req.body.score) : null;
  const steps = Number.isFinite(req.body.steps) ? Math.round(req.body.steps) : null;
  const timeSecs = Number.isFinite(req.body.timeSecs) ? Math.round(req.body.timeSecs) : null;
  try {
    const result = await finalizeDailyAttempt(req.user, gameId, {
      score, steps, timeSecs,
      moves: Array.isArray(req.body.moves) ? req.body.moves.slice(0, 800) : [],
      replay: req.body.replay === true,
      // Optional final-board snapshot for the locked-day review screen (#122).
      progress: req.body.progress && typeof req.body.progress === 'object' ? req.body.progress : null,
    });
    if (!result) {
      // No claimed, unfinished attempt today (client out of sync, or this
      // attempt was already finished) — surface so it resyncs instead of
      // silently overwriting an already-recorded score.
      return res.status(409).json({ error: 'No active attempt to finish' });
    }
    res.json(result);
  } catch (err) {
    console.error('[daily] finish failed:', err.message);
    res.status(500).json({ error: 'Failed to record result' });
  }
});

// ---- Phase 8: anonymous play, "make it count" (spec §6.10) ------------------

// Retroactively commit an anonymous run. The client held the finished run in
// localStorage (one pending run per game, same-day only); on the first
// authenticated load it posts it here. Flow, mirroring a normal play:
//   1. gameId must be a daily game.
//   2. The submitted seed must equal TODAY's daily_seeds row — boards freeze
//      at midnight UTC, so a run from a previous day is rejected (410).
//   3. Claim the day's attempt with the same INSERT … ON CONFLICT DO NOTHING
//      idiom as /start. An already-FINISHED row means the signed-in run
//      stands and the anonymous run is discarded (409). A claimed-but-
//      unfinished row is reused (the guest run finishes it — same board).
//   4. finalizeDailyAttempt: identical scoring/badges/streak recompute and
//      game_sessions + validateSession settlement as every signed-in finish —
//      full integrity parity per §6.10.
app.post('/api/daily/:gameId/commit', async (req, res) => {
  const { gameId } = req.params;
  if (!GAME_IDS.has(gameId)) return res.status(400).json({ error: 'Unknown game' });
  const score = Number.isFinite(req.body.score) ? Math.round(req.body.score) : null;
  const steps = Number.isFinite(req.body.steps) ? Math.round(req.body.steps) : null;
  const timeSecs = Number.isFinite(req.body.timeSecs) ? Math.round(req.body.timeSecs) : null;
  if (!(score > 0)) return res.status(400).json({ error: 'Nothing to commit' });
  // #331 — the band the anonymous run was played on (carried in the pending
  // run); it lands on the same deal's board it was played against.
  const band = isDailyBand(req.body.band) ? req.body.band : 'normal';
  try {
    const todaySeed = await ensureDailySeed(gameId);
    if (Number(req.body.seed) !== todaySeed) {
      return res.status(410).json({
        error: 'Board expired — an anonymous run only counts on the day it was played',
      });
    }
    const { rows: ins } = await pool.query(
      `INSERT INTO daily_attempts (user_id, username, game_id, attempt_date, band)
       VALUES ($1, $2, $3, (now() AT TIME ZONE 'utc')::date, $4)
       ON CONFLICT (user_id, game_id, attempt_date) DO NOTHING
       RETURNING *`,
      [req.user.id, req.user.username || null, gameId, band]
    );
    if (ins.length === 0) {
      const { rows: existing } = await pool.query(
        `SELECT finished_at FROM daily_attempts
          WHERE user_id = $1 AND game_id = $2
            AND attempt_date = (now() AT TIME ZONE 'utc')::date`,
        [req.user.id, gameId]
      );
      if (existing[0] && existing[0].finished_at) {
        return res.status(409).json({ error: 'Already played today — your signed-in run stands' });
      }
    }
    const result = await finalizeDailyAttempt(req.user, gameId, {
      score, steps, timeSecs,
      moves: Array.isArray(req.body.moves) ? req.body.moves.slice(0, 800) : [],
      replay: req.body.replay === true,
    });
    if (!result) return res.status(409).json({ error: 'No attempt to commit into' });
    res.json({ ...result, committed: true });
  } catch (err) {
    console.error('[daily] commit failed:', err.message);
    res.status(500).json({ error: 'Failed to commit run' });
  }
});

// Would-be rank for an anonymous run (public via PUBLIC_API_GET, rate-limited
// for anonymous callers). Runs the same ordering as the daily leaderboard
// (time ASC, steps ASC, finished_at ASC — a hypothetical run finishing "now"
// loses every (time, steps) tie) and writes nothing.
app.get('/api/public/daily/:gameId/rank-preview', async (req, res) => {
  const { gameId } = req.params;
  if (!GAME_IDS.has(gameId)) return res.status(400).json({ error: 'Unknown game' });
  const t = Number.parseInt(req.query.timeSecs, 10);
  const s = Number.parseInt(req.query.steps, 10);
  const sc = Number.parseInt(req.query.score, 10);
  if (!Number.isFinite(t)) return res.status(400).json({ error: 'timeSecs required' });
  // Score-ranked boards (Word Sprint) preview against score; the rest against
  // time-then-steps — mirrors the per-game leaderboard's tieBreak dispatch.
  const scoreRanked = (GAME_REGISTRY[gameId] && GAME_REGISTRY[gameId].manifest || {}).tieBreak === 'score-then-time';
  // #331 — ?band= previews against one deal's board (a guest who played Easy is
  // ranked against Easy). Defaults to normal, same as the leaderboard.
  const band = isDailyBand(req.query.band) ? req.query.band : 'normal';
  try {
    const { rows } = await pool.query(
      scoreRanked
        ? `SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE score >= $2)::int AS ahead
             FROM daily_attempts
            WHERE game_id = $1
              AND attempt_date = (now() AT TIME ZONE 'utc')::date
              AND finished_at IS NOT NULL AND score IS NOT NULL AND score > 0
              AND COALESCE(band, 'normal') = $3`
        : `SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE time_secs < $2 OR (time_secs = $2 AND steps <= $3))::int AS ahead
             FROM daily_attempts
            WHERE game_id = $1
              AND attempt_date = (now() AT TIME ZONE 'utc')::date
              AND finished_at IS NOT NULL AND score IS NOT NULL AND score > 0
              AND COALESCE(band, 'normal') = $4`,
      scoreRanked
        ? [gameId, Number.isFinite(sc) ? sc : 0, band]
        : [gameId, t, Number.isFinite(s) ? s : 2147483647, band]
    );
    res.json({
      rank: rows[0].ahead + 1,
      of: rows[0].total + 1, // the board as it would look with this run on it
      solvers: rows[0].total,
    });
  } catch (err) {
    console.error('[daily] rank-preview failed:', err.message);
    res.status(500).json({ error: 'Failed to preview rank' });
  }
});

// Autosave in-progress state for today's already-claimed, unfinished attempt.
// Persists the game-specific `progress` JSON, the accumulated `elapsed_secs`
// timer, and the live `steps` count so the player can resume exactly where
// they left off. Never creates rows (start owns claiming) and never touches
// finished_at/score — a finished attempt is immutable here.
app.post('/api/daily/:gameId/progress', async (req, res) => {
  const { gameId } = req.params;
  if (!GAME_IDS.has(gameId)) return res.status(400).json({ error: 'Unknown game' });
  const steps = Number.isFinite(req.body.steps) ? Math.round(req.body.steps) : null;
  const elapsedSecs = Number.isFinite(req.body.elapsedSecs) ? Math.round(req.body.elapsedSecs) : null;
  const progress = req.body.progress != null ? req.body.progress : null;
  try {
    const { rows } = await pool.query(
      `UPDATE daily_attempts
         SET progress = $3, steps = $4, elapsed_secs = $5
       WHERE user_id = $1 AND game_id = $2
         AND attempt_date = (now() AT TIME ZONE 'utc')::date
         AND finished_at IS NULL
       RETURNING *`,
      [req.user.id, gameId, progress, steps, elapsedSecs]
    );
    if (rows.length === 0) {
      // No claimed-and-unfinished attempt today: either never started or
      // already finished. Tell the client so it stops autosaving.
      return res.status(409).json({ error: 'No active attempt to save' });
    }
    res.json({ ok: true, attempt: shapeAttempt(rows[0]) });
  } catch (err) {
    console.error('[daily] progress failed:', err.message);
    res.status(500).json({ error: 'Failed to save progress' });
  }
});

// Per-game daily leaderboard for today's puzzle. Solvers only (finished with a
// positive score — this excludes Crypto Wordle losses recorded with score 0).
// Ranked fastest completion time first, then fewest steps, then earliest finish
// as a final deterministic tiebreak. Returns the top N plus the current user's
// own row/rank (present even when outside the top N).
const LEADERBOARD_LIMIT = 20;
/* ============================================================
   Story mode (#176) — the ladder, and the once-ever award
   ============================================================ */

// GET /api/story — every band this user has cleared, keyed by game. Feeds the
// home cards' "Story 4/8" state line and the band picker's start position.
app.get('/api/story', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT game_id, band, best_score, best_time_secs FROM game_progress WHERE user_id = $1`,
      [req.user.id]
    );
    const byGame = {};
    for (const gameId of Object.keys(STORY_BANDS)) {
      byGame[gameId] = { cleared: 0, total: storyBandCount(gameId), bands: {} };
    }
    for (const r of rows) {
      if (!byGame[r.game_id]) continue;
      byGame[r.game_id].bands[r.band] = {
        score: r.best_score, timeSecs: r.best_time_secs,
      };
    }
    // `cleared` is the length of the unbroken run from band 0, not the raw row
    // count: the ladder is a progression, so a band cleared out of order (which
    // nothing offers today, but a future deep link might) must not read as
    // further progress than the player actually has.
    for (const gameId of Object.keys(byGame)) {
      const g = byGame[gameId];
      let n = 0;
      while (n < g.total && g.bands[n]) n += 1;
      g.cleared = n;
    }
    res.json({ progress: byGame });
  } catch (e) {
    console.error('[story] load failed:', e.message);
    res.status(500).json({ error: 'Could not load story progress' });
  }
});

/* POST /api/story/:gameId/clear { band, score, timeSecs, steps }
   Marks a rung cleared. The award is gated on the INSERT winning, not on the
   client's word: story pays the first time and never again, and total_score is
   `total_score = total_score + $n`, so a retry that skipped the claim would
   silently double-credit. Replays fall through to the best_* update and are
   worth nothing, which is the rule. */
app.post('/api/story/:gameId/clear', async (req, res) => {
  const { gameId } = req.params;
  const total = storyBandCount(gameId);
  if (!total) return res.status(400).json({ error: 'Game has no story ladder' });

  const band = Number(req.body && req.body.band);
  if (!Number.isInteger(band) || band < 0 || band >= total) {
    return res.status(400).json({ error: 'Unknown band' });
  }
  const score = Math.max(0, Math.min(1e7, Number(req.body && req.body.score) || 0));
  const timeSecs = Math.max(0, Math.min(86400, Number(req.body && req.body.timeSecs) || 0));
  const steps = Math.max(0, Math.min(1e6, Number(req.body && req.body.steps) || 0));

  try {
    const award = storyBandAward(gameId, band);
    // Recently Played tracking (Recent goal): a band clear is a play.
    recordGamePlay(req.user.id, req.user.username, gameId);
    const claim = await pool.query(
      `INSERT INTO game_progress
         (user_id, game_id, band, awarded_points, best_score, best_time_secs, best_steps, plays)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
       ON CONFLICT (user_id, game_id, band) DO NOTHING
       RETURNING awarded_points`,
      [req.user.id, gameId, band, award, score, timeSecs, steps]
    );
    const firstClear = claim.rows.length > 0;

    if (!firstClear) {
      // Replay: keep the best figures, pay nothing.
      await pool.query(
        `UPDATE game_progress
            SET best_score = GREATEST(COALESCE(best_score, 0), $4),
                best_time_secs = LEAST(COALESCE(best_time_secs, 2147483647), $5),
                best_steps = LEAST(COALESCE(best_steps, 2147483647), $6),
                plays = plays + 1
          WHERE user_id = $1 AND game_id = $2 AND band = $3`,
        [req.user.id, gameId, band, score, timeSecs, steps]
      );
    } else if (award > 0) {
      await pool.query(
        `INSERT INTO user_stats_snapshot (user_id, username, total_score, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (user_id) DO UPDATE
           SET total_score = user_stats_snapshot.total_score + $3, updated_at = now()`,
        [req.user.id, req.user.username || null, award]
      );
    }

    const { rows } = await pool.query(
      `SELECT band FROM game_progress WHERE user_id = $1 AND game_id = $2`,
      [req.user.id, gameId]
    );
    const have = new Set(rows.map(r => r.band));
    let cleared = 0;
    while (cleared < total && have.has(cleared)) cleared += 1;

    /* story_complete badge — awarded the moment the ladder reads as fully
       cleared. Evaluated on EVERY clear, not only a first clear: the last rung
       a player fills may well be one they are replaying out of order, and the
       badge is about the ladder's state, not this one row. The guarded insert
       is the idempotency (one row per user per gameId, forever), so re-running
       this is free. Best-effort: a badge failure must never cost the player
       the band they just cleared. */
    const newAchievements = [];
    const ladderComplete = cleared >= total;
    if (ladderComplete) {
      try {
        const ach = await pool.query(
          `INSERT INTO user_achievements (user_id, type, game_id, metadata)
           SELECT $1, 'story_complete', $2, $3::jsonb
            WHERE NOT EXISTS (
              SELECT 1 FROM user_achievements
               WHERE user_id = $1 AND type = 'story_complete'
                 AND metadata->>'gameId' = $2
            )
           RETURNING type`,
          [req.user.id, gameId, JSON.stringify({ gameId, bands: total })]
        );
        if (ach.rows.length) newAchievements.push({ type: 'story_complete', gameId, bands: total });
      } catch (e) {
        console.warn('[story] badge award failed:', e.message);
      }
    }

    res.json({
      ok: true, band, total, cleared,
      awarded: firstClear ? award : 0, firstClear,
      ladderComplete, newAchievements,
    });
  } catch (e) {
    console.error('[story] clear failed:', e.message);
    res.status(500).json({ error: 'Could not record band' });
  }
});

/* ============================================================
   Arcade mode (#176) — personal bests and one-time rank bonuses
   ============================================================ */

/* POST /api/arcade/:gameId/finish { band, seed, score, timeSecs, steps, moves? }
   Arcade pays ONLY for landing higher, in two parts:
     - beating your own previous best on this game+band pays the base, scaled
       by band so farming Easy is not the optimal strategy;
     - crossing a rank threshold pays a one-time bonus, once ever.
   A player's FIRST run in a band sets the baseline and pays no personal-best
   component — it cannot beat their best because it is their best. Without that
   rule, "play once in every band of every game" would be a free harvest now
   that all three bands are open from the start. Rank bonuses still fire, so a
   strong debut is not unrewarded. */
/* POST /api/arcade/:gameId/start { band, seed } -> { runId }
   Claims the run BEFORE it is played, which is the only thing that gives the
   finish route a clock of its own. Cheap (one insert) and, unlike the daily's
   consume-on-start, it consumes nothing — arcade is unlimited by design, so
   this exists purely as an anchor. */
app.post('/api/arcade/:gameId/start', async (req, res) => {
  const { gameId } = req.params;
  if (!ALL_GAME_IDS.has(gameId)) return res.status(400).json({ error: 'Unknown game' });
  const band = String((req.body && req.body.band) || '');
  if (!isArcadeBand(band)) return res.status(400).json({ error: 'Unknown band' });
  const seed = Math.max(0, Math.min(4294967295, Number(req.body && req.body.seed) || 0));
  try {
    // Recently Played tracking (Recent goal): claiming the run is the play.
    recordGamePlay(req.user.id, req.user.username, gameId);
    const { rows } = await pool.query(
      `INSERT INTO arcade_runs (user_id, username, game_id, band, seed, score, started_at)
       VALUES ($1, $2, $3, $4, $5, 0, now()) RETURNING id`,
      [req.user.id, req.user.username || null, gameId, band, seed]
    );
    res.json({ runId: rows[0].id });
  } catch (e) {
    console.error('[arcade] start failed:', e.message);
    res.status(500).json({ error: 'Could not start run' });
  }
});

app.post('/api/arcade/:gameId/finish', async (req, res) => {
  const { gameId } = req.params;
  if (!ALL_GAME_IDS.has(gameId)) return res.status(400).json({ error: 'Unknown game' });
  const band = String((req.body && req.body.band) || '');
  if (!isArcadeBand(band)) return res.status(400).json({ error: 'Unknown band' });

  const score = Math.max(0, Math.min(1e7, Number(req.body && req.body.score) || 0));
  const timeSecs = Math.max(0, Math.min(86400, Number(req.body && req.body.timeSecs) || 0));
  const steps = Math.max(0, Math.min(1e6, Number(req.body && req.body.steps) || 0));
  const seed = Math.max(0, Math.min(4294967295, Number(req.body && req.body.seed) || 0));
  const moves = Array.isArray(req.body && req.body.moves) ? req.body.moves.slice(0, 800) : null;
  const runId = Number(req.body && req.body.runId) || 0;

  try {
    /* SETTLEMENT. Arcade pays for leaderboard position, so a score that the
       server has no way to place in time is recorded but not banked: it goes
       into the player's own history (which is theirs, and useful) and it does
       NOT move a personal best, a rank or a point total (which are shared, and
       what someone would bother to forge).

       A run settles when it was claimed through /start by this user for this
       game and band, is not already finished, and did not claim materially
       more time than actually passed. Everything else is unverified — including
       a finish that arrives with no runId at all, which is what an offline or
       interrupted run looks like. The rule is deliberately about the CLOCK and
       not about the score: a per-game score ceiling would be a second copy of
       every game's scoring formula, and the daily's replay harness already
       exists for the games that warrant that depth. */
    let verified = false;
    let claimedRun = null;
    if (runId) {
      const { rows } = await pool.query(
        `SELECT id, started_at, finished_at FROM arcade_runs
          WHERE id = $1 AND user_id = $2 AND game_id = $3 AND band = $4`,
        [runId, req.user.id, gameId, band]
      );
      claimedRun = rows[0] || null;
      if (claimedRun && !claimedRun.finished_at && claimedRun.started_at) {
        const wall = (Date.now() - new Date(claimedRun.started_at).getTime()) / 1000;
        verified = timeSecs <= wall + ARCADE_TIME_GRACE_SECS;
      }
    }

    const prev = await pool.query(
      `SELECT best_score, claimed_ranks FROM arcade_bests
        WHERE user_id = $1 AND game_id = $2 AND band = $3`,
      [req.user.id, gameId, band]
    );
    const isFirstRun = prev.rows.length === 0;
    const prevBest = isFirstRun ? 0 : (prev.rows[0].best_score || 0);
    const claimed = new Set(isFirstRun ? [] : (prev.rows[0].claimed_ranks || []));

    const beatBest = verified && !isFirstRun && score > prevBest;
    const pbAward = beatBest
      ? Math.round((score - prevBest) * (ARCADE_BAND_MULT[band] || 1))
      : 0;

    if (verified) await pool.query(
      `INSERT INTO arcade_bests
         (user_id, username, game_id, band, best_score, best_time_secs, best_steps, runs, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 1, now())
       ON CONFLICT (user_id, game_id, band) DO UPDATE
         SET best_score = GREATEST(arcade_bests.best_score, $5),
             best_time_secs = CASE WHEN $5 > arcade_bests.best_score THEN $6 ELSE arcade_bests.best_time_secs END,
             best_steps = CASE WHEN $5 > arcade_bests.best_score THEN $7 ELSE arcade_bests.best_steps END,
             runs = arcade_bests.runs + 1,
             username = COALESCE($2, arcade_bests.username),
             updated_at = now()`,
      [req.user.id, req.user.username || null, gameId, band, score, timeSecs, steps]
    );

    // Close the claimed row, or record an unanchored one so the history is
    // still complete. Either way the run is the player's to see and replay.
    if (claimedRun && !claimedRun.finished_at) {
      await pool.query(
        `UPDATE arcade_runs
            SET score = $2, time_secs = $3, steps = $4, moves = $5,
                verified = $6, finished_at = now()
          WHERE id = $1`,
        [claimedRun.id, score, timeSecs, steps, moves ? JSON.stringify(moves) : null, verified]
      );
    } else {
      await pool.query(
        `INSERT INTO arcade_runs
           (user_id, username, game_id, band, seed, score, time_secs, steps, moves, verified, finished_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, now())`,
        [req.user.id, req.user.username || null, gameId, band, seed, score, timeSecs, steps,
         moves ? JSON.stringify(moves) : null]
      );
    }

    /* Keep the per-game history bounded. Nothing else caps arcade_runs — the
       daily's uniqueness constraint has no equivalent here because arcade is
       unlimited by design — so a client stuck in a finish loop would grow the
       table without limit. 50 is twice what the history screen shows, so the
       trim is never visible to a player. */
    await pool.query(
      `DELETE FROM arcade_runs
        WHERE user_id = $1 AND game_id = $2
          AND id NOT IN (
            SELECT id FROM arcade_runs
             WHERE user_id = $1 AND game_id = $2
             ORDER BY created_at DESC, id DESC LIMIT 50)`,
      [req.user.id, gameId]
    );

    // Rank AFTER the write, so the row the player just set is the one ranked.
    const rankRes = await pool.query(
      `SELECT COUNT(*)::int AS ahead FROM arcade_bests
        WHERE game_id = $1 AND band = $2 AND best_score > $3`,
      [gameId, band, verified ? Math.max(score, prevBest) : prevBest]
    );
    const rank = (rankRes.rows[0] ? rankRes.rows[0].ahead : 0) + 1;

    let rankAward = 0;
    const newlyClaimed = [];
    for (const t of ARCADE_RANK_THRESHOLDS) {
      if (verified && rank <= t.rank && !claimed.has(t.key)) {
        rankAward += t.points;
        newlyClaimed.push(t.key);
      }
    }
    if (newlyClaimed.length) {
      await pool.query(
        `UPDATE arcade_bests SET claimed_ranks = claimed_ranks || $4::text[]
          WHERE user_id = $1 AND game_id = $2 AND band = $3`,
        [req.user.id, gameId, band, newlyClaimed]
      );
    }

    const awarded = pbAward + rankAward;
    if (awarded > 0) {
      await pool.query(
        `INSERT INTO user_stats_snapshot (user_id, username, total_score, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (user_id) DO UPDATE
           SET total_score = user_stats_snapshot.total_score + $3, updated_at = now()`,
        [req.user.id, req.user.username || null, awarded]
      );
    }

    res.json({
      ok: true, rank, band, score, verified,
      previousBest: prevBest, beatBest, isFirstRun: verified && isFirstRun,
      awarded, pbAward, rankAward, newRanks: newlyClaimed,
    });
  } catch (e) {
    console.error('[arcade] finish failed:', e.message);
    res.status(500).json({ error: 'Could not record run' });
  }
});

// GET /api/arcade/:gameId/leaderboard?band=normal — one board PER BAND, which
// the reward rule forces: with a single mixed board the optimal play would be
// to drop to Easy and top that.
app.get('/api/arcade/:gameId/leaderboard', async (req, res) => {
  const { gameId } = req.params;
  if (!ALL_GAME_IDS.has(gameId)) return res.status(400).json({ error: 'Unknown game' });
  const band = String(req.query.band || 'normal');
  if (!isArcadeBand(band)) return res.status(400).json({ error: 'Unknown band' });
  const uid = req.user ? req.user.id : null;
  try {
    const { rows } = await pool.query(
      `SELECT user_id, username, best_score, best_time_secs, runs
         FROM arcade_bests
        WHERE game_id = $1 AND band = $2 AND best_score > 0
        ORDER BY best_score DESC, updated_at ASC
        LIMIT 20`,
      [gameId, band]
    );
    const entries = rows.map((r, i) => ({
      rank: i + 1, userId: r.user_id, username: r.username || 'Player',
      score: r.best_score, timeSecs: r.best_time_secs, runs: r.runs,
      isCurrentUser: !!uid && r.user_id === uid,
    }));
    let me = entries.find(e => e.isCurrentUser) || null;
    if (!me && uid) {
      const mine = await pool.query(
        `SELECT best_score, best_time_secs, runs FROM arcade_bests
          WHERE user_id = $1 AND game_id = $2 AND band = $3 AND best_score > 0`,
        [uid, gameId, band]
      );
      if (mine.rows.length) {
        const ahead = await pool.query(
          `SELECT COUNT(*)::int AS n FROM arcade_bests
            WHERE game_id = $1 AND band = $2 AND best_score > $3`,
          [gameId, band, mine.rows[0].best_score]
        );
        me = {
          rank: ahead.rows[0].n + 1, userId: uid, username: req.user.username || 'You',
          score: mine.rows[0].best_score, timeSecs: mine.rows[0].best_time_secs,
          runs: mine.rows[0].runs, isCurrentUser: true,
        };
      }
    }
    const totalRes = await pool.query(
      `SELECT COUNT(*)::int AS n FROM arcade_bests WHERE game_id = $1 AND band = $2 AND best_score > 0`,
      [gameId, band]
    );
    res.json({ entries, me, total: totalRes.rows[0].n, band });
  } catch (e) {
    console.error('[arcade] leaderboard failed:', e.message);
    res.status(500).json({ error: 'Could not load board' });
  }
});

// GET /api/arcade/:gameId/runs — the player's own run history, newest first.
// A run is a seed plus a move list, so replaying one re-derives the board.
app.get('/api/arcade/:gameId/runs', async (req, res) => {
  const { gameId } = req.params;
  if (!ALL_GAME_IDS.has(gameId)) return res.status(400).json({ error: 'Unknown game' });
  try {
    const { rows } = await pool.query(
      `SELECT id, band, seed, score, time_secs, steps, verified, created_at
         FROM arcade_runs
        WHERE user_id = $1 AND game_id = $2 AND finished_at IS NOT NULL
        ORDER BY created_at DESC LIMIT 25`,
      [req.user.id, gameId]
    );
    res.json({
      runs: rows.map(r => ({
        id: r.id, band: r.band, seed: Number(r.seed), score: r.score,
        timeSecs: r.time_secs, steps: r.steps, verified: r.verified, at: r.created_at,
      })),
    });
  } catch (e) {
    console.error('[arcade] runs failed:', e.message);
    res.status(500).json({ error: 'Could not load runs' });
  }
});

app.get('/api/daily/:gameId/leaderboard', async (req, res) => {
  const { gameId } = req.params;
  if (!GAME_IDS.has(gameId)) return res.status(400).json({ error: 'Unknown game' });
  // ?scope=friends (phase 4): same board, filtered to the caller + the people
  // they follow (user_follows). Ranks are recomputed within the filtered set.
  // Anonymous callers have no follow graph — return an empty board.
  const friendsScope = req.query.scope === 'friends';
  if (friendsScope && !req.user) return res.json({ entries: [], me: null, total: 0 });
  // The ORDER BY is the manifest's symbolic tieBreak rule (phase 2 note:
  // "parameterize the SQL off it when the daily pool widens beyond
  // fastest-solve games"). Word Sprint is fixed-duration, so its board ranks
  // by score; everything else stays fastest-solve.
  const tieBreak = (GAME_REGISTRY[gameId] && GAME_REGISTRY[gameId].manifest || {}).tieBreak;
  const orderBy = tieBreak === 'score-then-time'
    ? 'score DESC, time_secs ASC, finished_at ASC'
    : 'time_secs ASC, steps ASC, finished_at ASC';
  /* #331 — ?band=easy|normal|hard filters the board to one deal. Default is
     'normal', which is also what every pre-band row COALESCEs to, so callers
     that send no band param see exactly the board they always saw. (Easy/Hard
     are separate deals — same day, different seed — so their finishes rank
     against the same board they were played on, at their own multiplier.) */
  const band = isDailyBand(req.query.band) ? req.query.band : 'normal';
  try {
    const { rows } = await pool.query(
      `SELECT user_id, username, score, steps, time_secs,
              ROW_NUMBER() OVER (
                ORDER BY ${orderBy}
              ) AS rank
         FROM daily_attempts
        WHERE game_id = $1
          AND attempt_date = (now() AT TIME ZONE 'utc')::date
          AND finished_at IS NOT NULL
          AND score IS NOT NULL AND score > 0
          AND COALESCE(band, 'normal') = $3
          AND ($2::text IS NULL
               OR user_id = $2
               OR user_id IN (SELECT followee_id FROM user_follows WHERE follower_id = $2))`,
      [gameId, friendsScope ? req.user.id : null, band]
    );
    const total = rows.length;
    // Public via PUBLIC_API_GET — req.user may be null (anonymous browse).
    const uid = req.user ? req.user.id : null;
    const shape = (r) => ({
      rank: Number(r.rank),
      username: r.username || 'anon',
      timeSecs: r.time_secs,
      steps: r.steps,
      score: r.score,
      isCurrentUser: uid != null && r.user_id === uid,
    });
    const entries = rows.slice(0, LEADERBOARD_LIMIT).map(shape);
    const mineRow = uid != null ? rows.find((r) => r.user_id === uid) : null;
    const me = mineRow ? shape(mineRow) : null;
    res.json({ entries, me, total, band });
  } catch (err) {
    console.error('[daily] leaderboard failed:', err.message);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

/* GET /api/alltime/:gameId/leaderboard — every finished daily attempt this
   game has ever recorded, summed per player (#188).

   The app had two boards for a daily game and no third: today's board
   (/api/daily/:gameId/leaderboard) and the per-band arcade boards
   (/api/arcade/:gameId/leaderboard). "All-time" was the only one of the three
   the report asks for that did not exist.

   It ranks on TOTAL POINTS, not on a best single day, because that is what the
   daily rewards: showing up. Ties break on fewer plays — the same points from
   fewer days is the better record — then on who got there first.

   Losses are excluded by `score > 0`, the same rule the daily board uses, so a
   pass/fail daily's failed runs do not appear. Public on the same terms as the
   other two boards: the handler null-guards req.user, so an anonymous caller
   gets me: null and isCurrentUser: false. */
app.get('/api/alltime/:gameId/leaderboard', async (req, res) => {
  const { gameId } = req.params;
  if (!GAME_IDS.has(gameId)) return res.status(400).json({ error: 'Unknown game' });
  const friendsScope = req.query.scope === 'friends';
  if (friendsScope && !req.user) return res.json({ entries: [], me: null, total: 0 });
  try {
    const { rows } = await pool.query(
      `SELECT user_id, username, points, plays, first_at,
              ROW_NUMBER() OVER (ORDER BY points DESC, plays ASC, first_at ASC) AS rank
         FROM (
           SELECT user_id,
                  MAX(username)        AS username,
                  SUM(score)::int      AS points,
                  COUNT(*)::int        AS plays,
                  MIN(finished_at)     AS first_at
             FROM daily_attempts
            WHERE game_id = $1
              AND finished_at IS NOT NULL
              AND score IS NOT NULL AND score > 0
              AND ($2::text IS NULL
                   OR user_id = $2
                   OR user_id IN (SELECT followee_id FROM user_follows WHERE follower_id = $2))
            GROUP BY user_id
         ) t`,
      [gameId, friendsScope ? req.user.id : null]
    );
    const total = rows.length;
    const uid = req.user ? req.user.id : null;
    const shape = (r) => ({
      rank: Number(r.rank),
      username: r.username || 'anon',
      points: Number(r.points),
      plays: Number(r.plays),
      isCurrentUser: uid != null && r.user_id === uid,
    });
    const entries = rows.slice(0, LEADERBOARD_LIMIT).map(shape);
    const mineRow = uid != null ? rows.find((r) => r.user_id === uid) : null;
    res.json({ entries, me: mineRow ? shape(mineRow) : null, total });
  } catch (err) {
    console.error('[alltime] leaderboard failed:', err.message);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

// "Today's Top Scores" leaderboard — GAME-OF-THE-DAY only: everyone who
// finished today's featured game, ranked by score (fastest time, then
// earliest finish, break ties). Returns { entries: top-N, me, total, gameId }
// mirroring the per-game shape; `gameId` is today's featured game so the
// client can label the board. Public via PUBLIC_API_GET (null-guarded).
app.get('/api/daily/leaderboard/today', async (req, res) => {
  // ?scope=friends (phase 4): see the per-game handler above.
  const friendsScope = req.query.scope === 'friends';
  try {
    const featured = await ensureDailyFeatured();
    if (friendsScope && !req.user) {
      return res.json({ entries: [], me: null, total: 0, gameId: featured.gameId });
    }
    const { rows } = await pool.query(
      `SELECT user_id, username, score, time_secs,
              ROW_NUMBER() OVER (
                ORDER BY score DESC, time_secs ASC, finished_at ASC
              ) AS rank
         FROM daily_attempts
        WHERE game_id = $2
          AND attempt_date = (now() AT TIME ZONE 'utc')::date
          AND finished_at IS NOT NULL
          AND score IS NOT NULL AND score > 0
          AND ($1::text IS NULL
               OR user_id = $1
               OR user_id IN (SELECT followee_id FROM user_follows WHERE follower_id = $1))`,
      [friendsScope ? req.user.id : null, featured.gameId]
    );
    const total = rows.length;
    // Public via PUBLIC_API_GET — req.user may be null (anonymous browse).
    const uid = req.user ? req.user.id : null;
    const shape = (r) => ({
      rank: Number(r.rank),
      username: r.username || 'anon',
      score: r.score,
      timeSecs: r.time_secs,
      userId: r.user_id,
      isCurrentUser: uid != null && r.user_id === uid,
    });
    const entries = rows.slice(0, LEADERBOARD_LIMIT).map(shape);
    const mineRow = uid != null ? rows.find((r) => r.user_id === uid) : null;
    const me = mineRow ? shape(mineRow) : null;
    res.json({ entries, me, total, gameId: featured.gameId });
  } catch (err) {
    console.error('[daily] today champions failed:', err.message);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

// ---- Mancala multiplayer API --------------------------------------------

// Create a new room. Retries up to 3 times on ID collision.
app.post('/api/mancala/rooms', async (req, res) => {
  const initPits = [4,4,4,4,4,4,0,4,4,4,4,4,4,0];
  // Recently Played tracking (Recent goal): hosting a room is playing it.
  recordGamePlay(req.user.id, req.user.username, 'mancala');
  let roomId = generateRoomId();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { rows } = await pool.query(
        `INSERT INTO mancala_rooms (id, player1_id, player1_name, pits)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [roomId, req.user.id, req.user.username || null, JSON.stringify(initPits)]
      );
      return res.json(shapeRoom(rows[0]));
    } catch (err) {
      if (err.code === '23505') { roomId = generateRoomId(); continue; }
      console.error('[mancala] create room failed:', err.message);
      return res.status(500).json({ error: 'Failed to create room' });
    }
  }
  res.status(500).json({ error: 'Failed to generate unique room ID' });
});

// Join an existing waiting room as player 2.
app.post('/api/mancala/rooms/:roomId/join', async (req, res) => {
  const { roomId } = req.params;
  // Recently Played tracking (Recent goal): sitting down in the room is a play.
  recordGamePlay(req.user.id, req.user.username, 'mancala');
  try {
    /* #200 — RECOGNISE A PLAYER WHO IS ALREADY IN THIS ROOM, before trying to
       seat them as a newcomer.

       The insert-only version below could only match a room that was still
       `waiting` with an empty seat 2, so a player who dropped out of an ACTIVE
       match and typed their own code again fell through to the error branch and
       was told "Room is already full or finished" — by their own room. There
       was no way back into a game in progress at all.

       This mirrors what /api/classic/:gameId/rooms/:roomId/join has done since
       #145; mancala keeps its own table and its own routes (see roomApiBase),
       and this is one the accommodation had not caught up on. Deliberately not
       gated on status: rejoining a finished room shows you the final board,
       which is a better answer than an error. */
    const existing = await pool.query('SELECT * FROM mancala_rooms WHERE id = $1', [roomId]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Room not found' });
    const cur = existing.rows[0];
    const mySeat = cur.player1_id === req.user.id ? 1 : cur.player2_id === req.user.id ? 2 : 0;
    if (mySeat === 1) {
      // Same shape the classic route returns, so the shared picker can offer
      // Rejoin rather than rendering a dead end.
      return res.status(409).json({
        error: 'That\'s your own room — rejoin it instead of joining',
        ownRoom: true,
        yourPlayerNum: 1,
        room: shapeRoom(cur),
      });
    }
    if (mySeat === 2) return res.json({ ...shapeRoom(cur), yourPlayerNum: 2 });

    const { rows } = await pool.query(
      `UPDATE mancala_rooms
         SET player2_id = $1, player2_name = $2, status = 'active', last_move_at = now()
       WHERE id = $3 AND status = 'waiting' AND player2_id IS NULL
         AND player1_id != $1
       RETURNING *`,
      [req.user.id, req.user.username || null, roomId]
    );
    if (rows.length === 0) return res.status(409).json({ error: 'Room is already full or finished', full: true });
    res.json({ ...shapeRoom(rows[0]), yourPlayerNum: 2 });
  } catch (err) {
    console.error('[mancala] join room failed:', err.message);
    res.status(500).json({ error: 'Failed to join room' });
  }
});

// Mark a mancala room finished early (concede / close an unjoined room).
// Idempotent, and the mirror of /api/classic/:gameId/rooms/:roomId/finish —
// mancala keeps its own room table, so it needs its own copy of the route the
// shared "End game" / "Close this room" button calls.
app.post('/api/mancala/rooms/:roomId/finish', async (req, res) => {
  const { roomId } = req.params;
  const { winner } = req.body || {};
  try {
    // Only a player in the room may concede it. Conceding declares a winner
    // and moves Elo, so a third party must not be able to reach for it.
    const { rows: pre } = await pool.query(
      'SELECT player1_id, player2_id FROM mancala_rooms WHERE id = $1', [roomId]
    );
    if (pre.length === 0) return res.status(404).json({ error: 'Room not found' });
    if (pre[0].player1_id !== req.user.id && pre[0].player2_id !== req.user.id) {
      return res.status(403).json({ error: 'Not a player in this room' });
    }
    // Rate only on the real active->finished transition; a repeat call just
    // echoes the room. A WAITING room has no opponent, so player2_id being
    // null is what keeps closing one off the ladder — no special case needed.
    const { rows: transitioned } = await pool.query(
      `UPDATE mancala_rooms
         SET status = 'finished', winner = COALESCE(winner, $2), last_move_at = now()
       WHERE id = $1 AND status <> 'finished'
       RETURNING *`,
      [roomId, winner != null ? String(winner) : null]
    );
    let room = transitioned[0];
    if (room && room.winner && room.player2_id) {
      rateMatch('mancala',
        { id: room.player1_id, name: room.player1_name },
        { id: room.player2_id, name: room.player2_name }, room.winner);
    }
    if (!room) {
      const { rows } = await pool.query('SELECT * FROM mancala_rooms WHERE id = $1', [roomId]);
      if (rows.length === 0) return res.status(404).json({ error: 'Room not found' });
      room = rows[0];
    }
    res.json(shapeRoom(room));
  } catch (err) {
    console.error('[mancala] finish failed:', err.message);
    res.status(500).json({ error: 'Failed to finish room' });
  }
});

// Poll room state. Any authenticated user can poll (supports reconnect).
app.get('/api/mancala/rooms/:roomId', async (req, res) => {
  const { roomId } = req.params;
  try {
    const { rows } = await pool.query('SELECT * FROM mancala_rooms WHERE id = $1', [roomId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Room not found' });
    // Lazy turn-timer enforcement: polling a stale room settles the forfeit.
    res.json(shapeRoom(await expireStaleMancalaRoom(rows[0])));
  } catch (err) {
    console.error('[mancala] get room failed:', err.message);
    res.status(500).json({ error: 'Failed to get room' });
  }
});

// Apply a move. Validates player identity, move_seq (anti-duplicate), and pit legality.
app.post('/api/mancala/rooms/:roomId/move', async (req, res) => {
  const { roomId } = req.params;
  const { pitIdx, moveSeq } = req.body;
  if (typeof pitIdx !== 'number' || typeof moveSeq !== 'number') {
    return res.status(400).json({ error: 'pitIdx and moveSeq are required' });
  }
  try {
    const { rows } = await pool.query('SELECT * FROM mancala_rooms WHERE id = $1', [roomId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Room not found' });
    const r = rows[0];

    if (r.status !== 'active') return res.status(409).json({ error: 'Game is not active' });
    if (r.move_seq !== moveSeq - 1) {
      return res.status(409).json({ error: 'Stale move_seq', serverMoveSeq: r.move_seq });
    }

    const player = r.current_player;
    if (player === 1 && req.user.id !== r.player1_id) return res.status(403).json({ error: 'Not your turn' });
    if (player === 2 && req.user.id !== r.player2_id) return res.status(403).json({ error: 'Not your turn' });

    const ownMin = player === 1 ? 0 : 7;
    const ownMax = player === 1 ? 5 : 12;
    const pits = r.pits;
    if (pitIdx < ownMin || pitIdx > ownMax || pits[pitIdx] === 0) {
      return res.status(400).json({ error: 'Invalid pit selection' });
    }

    const { pits: finalPits, extraTurn, gameOver, winner, nextPlayer } = srvMncApplyMove(pits, pitIdx, player);
    const newStatus = gameOver ? 'finished' : 'active';

    // Atomic update — re-checks move_seq to prevent concurrent duplicate moves.
    const { rows: updated } = await pool.query(
      `UPDATE mancala_rooms
         SET pits = $1, current_player = $2, status = $3, winner = $4,
             move_seq = $5, last_move_at = now()
       WHERE id = $6 AND move_seq = $7
       RETURNING *`,
      [JSON.stringify(finalPits), nextPlayer, newStatus, winner, moveSeq, roomId, moveSeq - 1]
    );
    if (updated.length === 0) return res.status(409).json({ error: 'Concurrent update conflict' });
    // Ladder: the CAS above guarantees this game-over transition fires once.
    if (gameOver && r.player2_id) {
      rateMatch('mancala',
        { id: r.player1_id, name: r.player1_name },
        { id: r.player2_id, name: r.player2_name }, winner);
    }
    res.json(shapeRoom(updated[0]));
  } catch (err) {
    console.error('[mancala] move failed:', err.message);
    res.status(500).json({ error: 'Failed to apply move' });
  }
});

// ---- Per-game public chat rooms (phase 7) ---------------------------------
// One room per game, polling transport (10s client cadence — the feed's).
// Auth-gated (deny-by-default middleware): chat is an account moment per spec
// §6.10, so none of these join PUBLIC_API_GET. Moderation is report-to-hide:
// CHAT_REPORT_THRESHOLD distinct reporters auto-hide a message (tombstoned in
// reads, never deleted).
const CHAT_REPORT_THRESHOLD = 3;
const CHAT_MAX_LEN = 500;
const CHAT_PAGE = 50;

function shapeChatMessage(r) {
  const hidden = !!r.hidden_at;
  return {
    id: Number(r.id),
    userId: hidden ? null : r.user_id,
    username: hidden ? null : (r.username || 'anonymous'),
    // Hidden bodies never leave the server — the client renders a tombstone.
    body: hidden ? null : r.body,
    hidden,
    createdAt: r.created_at,
  };
}

// Latest messages for a game's room; ?after=<id> returns only newer rows so
// the 10s poll is cheap. Both shapes are ascending by id.
app.get('/api/chat/:gameId', async (req, res) => {
  const { gameId } = req.params;
  if (!ALL_GAME_IDS.has(gameId)) return res.status(400).json({ error: 'Unknown game' });
  const after = Number.parseInt(req.query.after, 10);
  try {
    let rows;
    if (Number.isFinite(after) && after > 0) {
      ({ rows } = await pool.query(
        `SELECT * FROM chat_messages WHERE game_id = $1 AND id > $2 ORDER BY id ASC LIMIT $3`,
        [gameId, after, CHAT_PAGE]
      ));
    } else {
      ({ rows } = await pool.query(
        `SELECT * FROM (
           SELECT * FROM chat_messages WHERE game_id = $1 ORDER BY id DESC LIMIT $2
         ) t ORDER BY id ASC`,
        [gameId, CHAT_PAGE]
      ));
    }
    res.json({ messages: rows.map(shapeChatMessage) });
  } catch (err) {
    console.error('[chat] list failed:', err.message);
    res.status(500).json({ error: 'Failed to load chat' });
  }
});

// Post a message to a game's room.
app.post('/api/chat/:gameId', async (req, res) => {
  const { gameId } = req.params;
  if (!ALL_GAME_IDS.has(gameId)) return res.status(400).json({ error: 'Unknown game' });
  const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
  if (!body) return res.status(400).json({ error: 'Empty message' });
  if (body.length > CHAT_MAX_LEN) return res.status(400).json({ error: `Message too long (max ${CHAT_MAX_LEN})` });
  try {
    const { rows } = await pool.query(
      `INSERT INTO chat_messages (game_id, user_id, username, body)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [gameId, req.user.id, req.user.username || null, body]
    );
    res.json({ message: shapeChatMessage(rows[0]) });
  } catch (err) {
    console.error('[chat] post failed:', err.message);
    res.status(500).json({ error: 'Failed to post message' });
  }
});

// Report a message. One report per (message, reporter); at
// CHAT_REPORT_THRESHOLD distinct reporters the message auto-hides.
app.post('/api/chat/messages/:id/report', async (req, res) => {
  const msgId = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(msgId)) return res.status(400).json({ error: 'Bad message id' });
  try {
    const { rows: mRows } = await pool.query('SELECT * FROM chat_messages WHERE id = $1', [msgId]);
    if (!mRows[0]) return res.status(404).json({ error: 'Message not found' });
    await pool.query(
      `INSERT INTO chat_reports (message_id, reporter_id) VALUES ($1, $2)
       ON CONFLICT (message_id, reporter_id) DO NOTHING`,
      [msgId, req.user.id]
    );
    const { rows: cRows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM chat_reports WHERE message_id = $1', [msgId]
    );
    let hidden = !!mRows[0].hidden_at;
    if (!hidden && cRows[0].n >= CHAT_REPORT_THRESHOLD) {
      await pool.query(
        `UPDATE chat_messages SET hidden_at = now(), hide_reason = 'reports'
          WHERE id = $1 AND hidden_at IS NULL`,
        [msgId]
      );
      hidden = true;
    }
    res.json({ reported: true, reports: cRows[0].n, hidden });
  } catch (err) {
    console.error('[chat] report failed:', err.message);
    res.status(500).json({ error: 'Failed to report message' });
  }
});

// ---- My active rooms (phase 7 home "in progress" row) ----------------------
// The viewer's active turn-based classic_rooms matches, flagged with whether
// it's their turn (state.currentPlayer vs their player number). Score races
// have no turn concept and rejoin mid-run isn't supported, so only rules-
// module games (which include chutes-ladders) are listed.
app.get('/api/rooms/mine', async (req, res) => {
  try {
    /* #145 — WAITING rooms are included now.
       The filter was status = 'active' only, so a room you created and then
       left (backgrounded the app, phone slept) was invisible EVERYWHERE: not in
       the in-progress row, not in the online setup screen, and your own code
       came back "room is full or you created it" with no way to recover it. The
       endpoint already loops BOARD_RULE_GAME_IDS, so widening the status filter
       fixes lost rooms for all five board games plus Snakes & Ladders at once —
       Reversi is just where the reporter happened to hit it. */
    const { rows } = await pool.query(
      `SELECT * FROM classic_rooms
        WHERE status IN ('active', 'waiting')
          AND (player1_id = $1 OR player2_id = $1 OR player3_id = $1 OR player4_id = $1)
        ORDER BY last_move_at DESC NULLS LAST, created_at DESC LIMIT 12`,
      [req.user.id]
    );
    const rooms = [];
    for (let r of rows) {
      if (!BOARD_RULE_GAME_IDS.has(r.game_id)) continue;
      const waiting = r.status === 'waiting';
      if (!waiting) {
        // Lazy turn-timer enforcement: a stale room settles as a forfeit here
        // and drops off the your-turn row. Only ACTIVE rooms can go stale — a
        // waiting room has no side to move, so there is nothing to forfeit.
        r = await expireStaleClassicRoom(r);
        if (r.status !== 'active') continue;
      }
      const myPlayerNum = roomSeatOf(r, req.user.id) || 1;
      const cur = r.state && Number(r.state.currentPlayer);
      const others = [
        [1, r.player1_name], [2, r.player2_name], [3, r.player3_name], [4, r.player4_name],
      ].filter(([s, n]) => s !== myPlayerNum && s <= roomMaxPlayers(r) && n).map(([, n]) => n);
      rooms.push({
        id: r.id,
        gameId: r.game_id,
        myPlayerNum,
        waiting,
        myTurn: !waiting && cur === myPlayerNum,
        seatsFilled: roomSeatsFilled(r),
        maxPlayers: roomMaxPlayers(r),
        opponentName: waiting
          ? null
          : (others.length > 1 ? `${others[0]} +${others.length - 1}` : (others[0] || 'opponent')),
        lastMoveAt: r.last_move_at,
        turnTimeoutHours: TURN_TIMEOUT_HOURS,
      });
    }
    res.json({ rooms });
  } catch (err) {
    console.error('[rooms] mine failed:', err.message);
    res.status(500).json({ error: 'Failed to load rooms' });
  }
});

// ---- Classic Games generic online rooms (classic_rooms) ------------------
// Open room-code multiplayer used by the Game Menu's "Online Multiplayer".
// Currently wired for Chutes & Ladders; the table/state is generic so other
// classic games can slot in later. Any authenticated user can join by code.

// Turn-based rules now live in lib/board-rules.js (phase 5): one registry
// module per game — Chutes & Ladders (extracted from the inline rules that
// used to sit here), plus Checkers, Reversi, Four in a Row, Gomoku, and Ludo.
// The generic room endpoints below dispatch on boardRules.getRules(gameId).
const BOARD_RULE_GAME_IDS = new Set(
  Object.keys(boardRules.boardRules).filter((id) => id !== 'mancala')
);

// Seat helpers (multi-seat rooms — today only Ludo sets max_players > 2).
function roomMaxPlayers(r) { return Math.min(4, Math.max(2, Number(r.max_players) || 2)); }
function roomSeatIdCols(r) { return [r.player1_id, r.player2_id, r.player3_id, r.player4_id]; }
function roomSeatOf(r, userId) {
  const ids = roomSeatIdCols(r);
  for (let s = 1; s <= roomMaxPlayers(r); s++) if (ids[s - 1] === userId) return s;
  return 0;
}
function roomSeatsFilled(r) {
  const ids = roomSeatIdCols(r);
  let n = 0;
  for (let s = 1; s <= roomMaxPlayers(r); s++) if (ids[s - 1]) n++;
  return n;
}

function shapeClassicRoom(r) {
  return {
    id: r.id,
    gameId: r.game_id,
    player1Id: r.player1_id,
    player2Id: r.player2_id,
    player1Name: r.player1_name,
    player2Name: r.player2_name,
    player3Id: r.player3_id || null,
    player3Name: r.player3_name || null,
    player4Id: r.player4_id || null,
    player4Name: r.player4_name || null,
    maxPlayers: roomMaxPlayers(r),
    seatsFilled: roomSeatsFilled(r),
    state: r.state || {},
    moveSeq: r.move_seq,
    status: r.status,
    winner: r.winner,
    p1Score: r.p1_score != null ? Number(r.p1_score) : null,
    p2Score: r.p2_score != null ? Number(r.p2_score) : null,
    p1FinishedAt: r.p1_finished_at || null,
    p2FinishedAt: r.p2_finished_at || null,
    lastMoveAt: r.last_move_at || null,
    // Correspondence turn timer: an active room auto-forfeits after this many
    // hours without a move (enforced lazily on read — see expireStale*Room).
    turnTimeoutHours: TURN_TIMEOUT_HOURS,
  };
}

// ---- Correspondence turn timer (spec-audit item 7) --------------------------
// An ACTIVE two-player room whose last move is older than TURN_TIMEOUT_HOURS
// auto-forfeits the absent side — enforced LAZILY on the room read/poll paths
// (the app's no-cron idiom), through the same active→finished CAS transition
// the manual forfeit endpoint uses so rateMatch fires exactly once even when
// several readers race. Waiting rooms (no opponent yet) never time out.
const TURN_TIMEOUT_HOURS = 48;

function roomIsStale(r) {
  if (!r || r.status !== 'active' || !r.player2_id || !r.last_move_at) return false;
  return Date.now() - new Date(r.last_move_at).getTime() > TURN_TIMEOUT_HOURS * 3600 * 1000;
}

async function expireStaleClassicRoom(r) {
  if (!roomIsStale(r)) return r;
  // Multi-seat rooms (Ludo 3–4P) forfeit the seat to move and CONTINUE with
  // the remaining players; only a last-seat-standing ends the room. Unrated
  // by design (only 2P matches settle Elo).
  if (roomMaxPlayers(r) > 2 && r.game_id === 'ludo') {
    const seat = Number(r.state && r.state.currentPlayer) || 1;
    try {
      const ff = boardRules.ludoForfeitSeat(r.state || {}, seat);
      const { rows } = await pool.query(
        `UPDATE classic_rooms
           SET state = $3::jsonb, status = $4, winner = COALESCE(winner, $5),
               move_seq = move_seq + 1, last_move_at = now()
         WHERE id = $1 AND game_id = $2 AND status = 'active'
           AND last_move_at < now() - make_interval(hours => $6)
         RETURNING *`,
        [r.id, r.game_id, JSON.stringify(ff.state), ff.gameOver ? 'finished' : 'active',
         ff.gameOver ? ff.winner : null, TURN_TIMEOUT_HOURS]
      );
      return rows[0] || r;
    } catch (e) {
      console.warn('[rooms] multi-seat expiry failed (non-fatal):', e.message);
      return r;
    }
  }
  // Turn-based rooms forfeit the player to move; score races forfeit the side
  // that never submitted (both absent → the joiner is treated as absent).
  let loser;
  const cur = r.state && Number(r.state.currentPlayer);
  if (cur === 1 || cur === 2) loser = cur;
  else if (r.p1_score == null && r.p2_score != null) loser = 1;
  else loser = 2;
  const winner = String(loser === 1 ? 2 : 1);
  try {
    const { rows } = await pool.query(
      `UPDATE classic_rooms
         SET status = 'finished', winner = COALESCE(winner, $3)
       WHERE id = $1 AND game_id = $2 AND status = 'active'
         AND last_move_at < now() - make_interval(hours => $4)
       RETURNING *`,
      [r.id, r.game_id, winner, TURN_TIMEOUT_HOURS]
    );
    if (rows.length === 0) return r; // another reader settled it first
    const settled = rows[0];
    if (settled.winner && settled.player2_id) {
      rateMatch(settled.game_id,
        { id: settled.player1_id, name: settled.player1_name },
        { id: settled.player2_id, name: settled.player2_name }, settled.winner);
    }
    return settled;
  } catch (e) {
    console.warn('[rooms] stale-room expiry failed (non-fatal):', e.message);
    return r;
  }
}

async function expireStaleMancalaRoom(r) {
  if (!roomIsStale(r)) return r;
  const loser = Number(r.current_player) === 2 ? 2 : 1;
  const winner = String(loser === 1 ? 2 : 1);
  try {
    const { rows } = await pool.query(
      `UPDATE mancala_rooms
         SET status = 'finished', winner = COALESCE(winner, $2)
       WHERE id = $1 AND status = 'active'
         AND last_move_at < now() - make_interval(hours => $3)
       RETURNING *`,
      [r.id, winner, TURN_TIMEOUT_HOURS]
    );
    if (rows.length === 0) return r;
    const settled = rows[0];
    if (settled.winner && settled.player2_id) {
      rateMatch('mancala',
        { id: settled.player1_id, name: settled.player1_name },
        { id: settled.player2_id, name: settled.player2_name }, settled.winner);
    }
    return settled;
  } catch (e) {
    console.warn('[mancala] stale-room expiry failed (non-fatal):', e.message);
    return r;
  }
}

// Create an open room. Body: optional { players: 2..4 } for games whose
// rules module declares maxPlayers (today: Ludo); everything else is 2-seat.
app.post('/api/classic/:gameId/rooms', async (req, res) => {
  const { gameId } = req.params;
  if (!ALL_GAME_IDS.has(gameId)) return res.status(400).json({ error: 'Unknown game' });
  // Recently Played tracking (Recent goal): hosting a room is playing it.
  recordGamePlay(req.user.id, req.user.username, gameId);
  const rules = boardRules.getRules(gameId);
  const seatCap = rules && rules.maxPlayers ? rules.maxPlayers : 2;
  const wanted = Number((req.body || {}).players) || 2;
  const maxPlayers = Math.min(seatCap, Math.max(2, wanted));
  // Room options from the create body (today: Chutes & Ladders' board variant;
  // Ludo's multi-seat player count instead, since its rules module declares
  // maxPlayers). Each rules module validates what it understands and ignores
  // the rest, so an unknown/malformed value can never produce an unplayable room.
  const initState = BOARD_RULE_GAME_IDS.has(gameId) && rules
    ? (rules.maxPlayers ? rules.initialState(maxPlayers) : rules.initialState(req.body || {}))
    : CLASSIC_RACE_GAME_IDS.has(gameId)
    ? { mode: 'race' }
    : {};
  let roomId = generateRoomId();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { rows } = await pool.query(
        `INSERT INTO classic_rooms (id, game_id, player1_id, player1_name, state, max_players)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING *`,
        [roomId, gameId, req.user.id, req.user.username || null, JSON.stringify(initState), maxPlayers]
      );
      return res.json(shapeClassicRoom(rows[0]));
    } catch (err) {
      if (err.code === '23505') { roomId = generateRoomId(); continue; }
      console.error('[classic] create room failed:', err.message);
      return res.status(500).json({ error: 'Failed to create room' });
    }
  }
  res.status(500).json({ error: 'Failed to generate unique room ID' });
});

// Join an existing waiting room in the next free seat (seat 2 for classic
// 2-player rooms; seats 2→3→4 for multi-seat Ludo rooms). The room flips to
// 'active' when the last seat fills. The response carries `yourPlayerNum` so
// the client knows which seat it landed in.
app.post('/api/classic/:gameId/rooms/:roomId/join', async (req, res) => {
  const { gameId, roomId } = req.params;
  if (!ALL_GAME_IDS.has(gameId)) return res.status(400).json({ error: 'Unknown game' });
  // Recently Played tracking (Recent goal): sitting down in the room is a play.
  recordGamePlay(req.user.id, req.user.username, gameId);
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { rows: cur } = await pool.query(
        'SELECT * FROM classic_rooms WHERE id = $1 AND game_id = $2', [roomId, gameId]
      );
      if (cur.length === 0) return res.status(404).json({ error: 'Room not found' });
      const r = cur[0];
      const already = roomSeatOf(r, req.user.id);
      /* #145 — distinguish "your own room" from "full". The client used to get
         one 409 for both cases and rendered "Room is full or you created it",
         which is exactly the dead end the reporter hit. `ownRoom` lets it offer
         Rejoin instead of an error, and the seat number comes back so the rejoin
         goes straight into the room. */
      if (already === 1) {
        return res.status(409).json({
          error: 'That\'s your own room — rejoin it instead of joining',
          ownRoom: true,
          yourPlayerNum: 1,
          room: shapeClassicRoom(r),
        });
      }
      if (already > 1) {
        // Re-join (e.g. after a reload of a still-waiting multi-seat room).
        return res.json({ ...shapeClassicRoom(r), yourPlayerNum: already });
      }
      if (r.status !== 'waiting') return res.status(409).json({ error: 'Room is already full or finished', full: true });
      const ids = roomSeatIdCols(r);
      let seat = 0;
      for (let s = 2; s <= roomMaxPlayers(r); s++) if (!ids[s - 1]) { seat = s; break; }
      if (!seat) return res.status(409).json({ error: 'Room is already full or finished' });
      const lastSeat = roomSeatsFilled(r) + 1 >= roomMaxPlayers(r);
      const col = seat === 2 ? 'player2' : seat === 3 ? 'player3' : 'player4';
      const { rows } = await pool.query(
        `UPDATE classic_rooms
           SET ${col}_id = $1, ${col}_name = $2,
               status = $5, last_move_at = now()
         WHERE id = $3 AND game_id = $4 AND status = 'waiting' AND ${col}_id IS NULL
         RETURNING *`,
        [req.user.id, req.user.username || null, roomId, gameId, lastSeat ? 'active' : 'waiting']
      );
      if (rows.length === 0) continue; // seat raced away — retry
      return res.json({ ...shapeClassicRoom(rows[0]), yourPlayerNum: seat });
    }
    res.status(409).json({ error: 'Room is already full or finished' });
  } catch (err) {
    console.error('[classic] join room failed:', err.message);
    res.status(500).json({ error: 'Failed to join room' });
  }
});

// Poll room state.
app.get('/api/classic/:gameId/rooms/:roomId', async (req, res) => {
  const { gameId, roomId } = req.params;
  if (!ALL_GAME_IDS.has(gameId)) return res.status(400).json({ error: 'Unknown game' });
  try {
    const { rows } = await pool.query('SELECT * FROM classic_rooms WHERE id = $1 AND game_id = $2', [roomId, gameId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Room not found' });
    // Lazy turn-timer enforcement: polling a stale room settles the forfeit.
    res.json(shapeClassicRoom(await expireStaleClassicRoom(rows[0])));
  } catch (err) {
    console.error('[classic] get room failed:', err.message);
    res.status(500).json({ error: 'Failed to get room' });
  }
});

// Apply a move. For Chutes & Ladders the only move is { type: 'roll' }; the
// server rolls the die so neither client can cheat. move_seq guards duplicates.
// Apply a turn-based move. The per-game rules come from the registry
// (lib/board-rules.js): the endpoint owns loading, turn ownership, and the
// move_seq CAS; the module owns legality and the state transition. The move
// payload is game-specific (`{ move: {...} }`; legacy chutes clients send the
// roll fields at the top level, which its module ignores anyway).
app.post('/api/classic/:gameId/rooms/:roomId/move', async (req, res) => {
  const { gameId, roomId } = req.params;
  const { moveSeq } = req.body || {};
  if (!ALL_GAME_IDS.has(gameId)) return res.status(400).json({ error: 'Unknown game' });
  const rules = BOARD_RULE_GAME_IDS.has(gameId) ? boardRules.getRules(gameId) : null;
  if (!rules) return res.status(400).json({ error: 'Online moves not supported for this game' });
  if (typeof moveSeq !== 'number') return res.status(400).json({ error: 'moveSeq is required' });
  try {
    const { rows } = await pool.query('SELECT * FROM classic_rooms WHERE id = $1 AND game_id = $2', [roomId, gameId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Room not found' });
    const r = rows[0];
    if (r.status !== 'active') return res.status(409).json({ error: 'Game is not active' });
    if (r.move_seq !== moveSeq - 1) return res.status(409).json({ error: 'Stale move_seq', serverMoveSeq: r.move_seq });

    const player = (r.state && r.state.currentPlayer) || 1;
    if (roomSeatOf(r, req.user.id) !== player) return res.status(403).json({ error: 'Not your turn' });

    let newState, gameOver, winner;
    try {
      const result = rules.applyMove(r.state || rules.initialState(), player, req.body.move || req.body);
      newState = result.state; gameOver = result.gameOver; winner = result.winner;
    } catch (moveErr) {
      return res.status(400).json({ error: moveErr.message || 'Illegal move' });
    }
    const newStatus = gameOver ? 'finished' : 'active';

    const { rows: updated } = await pool.query(
      `UPDATE classic_rooms
         SET state = $1::jsonb, status = $2, winner = $3, move_seq = $4, last_move_at = now()
       WHERE id = $5 AND move_seq = $6
       RETURNING *`,
      [JSON.stringify(newState), newStatus, winner, moveSeq, roomId, moveSeq - 1]
    );
    if (updated.length === 0) return res.status(409).json({ error: 'Concurrent update conflict' });
    // Ladder: the CAS above guarantees this game-over transition fires once.
    // Only 2-player matches are rated (3–4P Ludo is unrated for now — the
    // pairwise Elo math doesn't extend to multi-seat).
    if (gameOver && r.player2_id && roomMaxPlayers(r) === 2) {
      rateMatch(gameId,
        { id: r.player1_id, name: r.player1_name },
        { id: r.player2_id, name: r.player2_name }, winner);
    }
    res.json(shapeClassicRoom(updated[0]));
  } catch (err) {
    console.error('[classic] move failed:', err.message);
    res.status(500).json({ error: 'Failed to apply move' });
  }
});

// Mark a room finished early (forfeit / opponent left). Idempotent.
// Multi-seat Ludo rooms forfeit only the CALLER's seat: the match continues
// for the remaining players and ends when one seat is left standing.
app.post('/api/classic/:gameId/rooms/:roomId/finish', async (req, res) => {
  const { gameId, roomId } = req.params;
  const { winner } = req.body || {};
  if (!ALL_GAME_IDS.has(gameId)) return res.status(400).json({ error: 'Unknown game' });
  try {
    const { rows: pre } = await pool.query(
      'SELECT * FROM classic_rooms WHERE id = $1 AND game_id = $2', [roomId, gameId]
    );
    if (pre.length === 0) return res.status(404).json({ error: 'Room not found' });
    const preRoom = pre[0];
    if (gameId === 'ludo' && roomMaxPlayers(preRoom) > 2 && preRoom.status === 'active') {
      const seat = roomSeatOf(preRoom, req.user.id);
      if (!seat) return res.status(403).json({ error: 'Not a player in this room' });
      const ff = boardRules.ludoForfeitSeat(preRoom.state || {}, seat);
      const { rows: updatedMulti } = await pool.query(
        `UPDATE classic_rooms
           SET state = $3::jsonb, status = $4, winner = COALESCE(winner, $5),
               move_seq = move_seq + 1, last_move_at = now()
         WHERE id = $1 AND game_id = $2 AND status = 'active' AND move_seq = $6
         RETURNING *`,
        [roomId, gameId, JSON.stringify(ff.state), ff.gameOver ? 'finished' : 'active',
         ff.gameOver ? ff.winner : null, preRoom.move_seq]
      );
      if (updatedMulti.length > 0) return res.json(shapeClassicRoom(updatedMulti[0]));
      // Raced with a move — fall through to the idempotent echo below.
    }
    // Rate the forfeit only on the actual active→finished transition (the
    // endpoint stays idempotent for repeat calls, which just echo the room).
    const { rows: transitioned } = await pool.query(
      `UPDATE classic_rooms
         SET status = 'finished', winner = COALESCE(winner, $3), last_move_at = now()
       WHERE id = $1 AND game_id = $2 AND status <> 'finished'
         AND NOT (game_id = 'ludo' AND max_players > 2 AND status = 'active')
       RETURNING *`,
      [roomId, gameId, winner != null ? String(winner) : null]
    );
    let room = transitioned[0];
    // #145 — closing a WAITING room (nobody ever joined) must not touch the
    // ladder. Already guaranteed by the player2_id condition: there is no
    // opponent to rate against, so `rateMatch` is skipped and the room simply
    // goes finished. Same endpoint, no special case needed on the client.
    if (room && room.status === 'finished' && room.winner && room.player2_id && roomMaxPlayers(room) === 2) {
      rateMatch(gameId,
        { id: room.player1_id, name: room.player1_name },
        { id: room.player2_id, name: room.player2_name }, room.winner);
    }
    if (!room) {
      const { rows } = await pool.query(
        `SELECT * FROM classic_rooms WHERE id = $1 AND game_id = $2`, [roomId, gameId]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Room not found' });
      room = rows[0];
    }
    res.json(shapeClassicRoom(room));
  } catch (err) {
    console.error('[classic] finish failed:', err.message);
    res.status(500).json({ error: 'Failed to finish room' });
  }
});

// Submit a race-mode player's final score. When both players are in, the
// server determines the winner (higher score; earlier finish breaks ties;
// player1 wins a full tie) and flips the room to finished. Idempotent per
// player (a retry overwrites the same value). move_seq CAS serializes writes.
app.post('/api/classic/:gameId/rooms/:roomId/score', async (req, res) => {
  const { gameId, roomId } = req.params;
  if (!CLASSIC_RACE_GAME_IDS.has(gameId)) return res.status(400).json({ error: 'Race not supported for this game' });
  const score = Number.isFinite(req.body.score) ? Math.round(req.body.score) : null;
  if (score === null || score < 0) return res.status(400).json({ error: 'score is required' });
  // Recently Played tracking (Recent goal): crossing the finish line is a play.
  recordGamePlay(req.user.id, req.user.username, gameId);
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { rows } = await pool.query('SELECT * FROM classic_rooms WHERE id = $1 AND game_id = $2', [roomId, gameId]);
      if (rows.length === 0) return res.status(404).json({ error: 'Room not found' });
      const r = rows[0];
      const isP1 = r.player1_id === req.user.id;
      const isP2 = r.player2_id === req.user.id;
      if (!isP1 && !isP2) return res.status(403).json({ error: 'Not a player in this room' });
      if (r.status === 'finished') return res.json(shapeClassicRoom(r));

      const p1Score = isP1 ? score : r.p1_score;
      const p2Score = isP2 ? score : r.p2_score;
      // Stamp this player's finish time; keep the other side's.
      const p1Fin = isP1 ? new Date() : r.p1_finished_at;
      const p2Fin = isP2 ? new Date() : r.p2_finished_at;
      const bothIn = p1Score != null && p2Score != null && r.player2_id != null;

      let winner = r.winner;
      let status = r.status;
      if (bothIn) {
        status = 'finished';
        if (p1Score > p2Score) winner = '1';
        else if (p2Score > p1Score) winner = '2';
        else {
          // tie on score → earlier finisher wins; if still equal, player1.
          const t1 = p1Fin ? new Date(p1Fin).getTime() : Infinity;
          const t2 = p2Fin ? new Date(p2Fin).getTime() : Infinity;
          winner = t2 < t1 ? '2' : '1';
        }
      }

      const { rows: updated } = await pool.query(
        `UPDATE classic_rooms
           SET p1_score = $1, p2_score = $2,
               p1_finished_at = $3, p2_finished_at = $4,
               winner = $5, status = $6,
               move_seq = move_seq + 1, last_move_at = now()
         WHERE id = $7 AND game_id = $8 AND move_seq = $9
         RETURNING *`,
        [p1Score, p2Score, p1Fin, p2Fin, winner, status, roomId, gameId, r.move_seq]
      );
      if (updated.length === 0) continue; // concurrent write — retry
      // Ladder: rate exactly when this write flipped the race to finished
      // (bothIn is only reachable once thanks to the move_seq CAS).
      if (bothIn && r.status !== 'finished' && r.player2_id) {
        rateMatch(gameId,
          { id: r.player1_id, name: r.player1_name },
          { id: r.player2_id, name: r.player2_name }, winner);
      }
      return res.json(shapeClassicRoom(updated[0]));
    }
    res.status(409).json({ error: 'Concurrent update conflict' });
  } catch (err) {
    console.error('[classic] race score failed:', err.message);
    res.status(500).json({ error: 'Failed to submit score' });
  }
});

// ---- Generic classic-game score + leaderboard (classic_scores) -------------

function shapeClassicScoreRow(row) {
  return {
    rank: Number(row.rank),
    username: row.username || 'anon',
    bestScore: Number(row.best_score),
    extra: row.extra || null,
  };
}

// Submit a finished classic-game run. Upserts the caller's personal-best row
// (GREATEST so a worse run never lowers it) and bumps games_played. Returns
// the new best, the caller's rank, and games played.
app.post('/api/classic/:gameId/score', async (req, res) => {
  const { gameId } = req.params;
  if (!CLASSIC_SCORE_GAME_IDS.has(gameId)) return res.status(400).json({ error: 'Unknown game' });
  const score = Number.isFinite(req.body.score) ? Math.round(req.body.score) : null;
  if (score === null || score < 0) return res.status(400).json({ error: 'score is required' });
  // Recently Played tracking (Recent goal): a submitted solo run is a play.
  recordGamePlay(req.user.id, req.user.username, gameId);
  const extra = (req.body.extra && typeof req.body.extra === 'object' && !Array.isArray(req.body.extra))
    ? req.body.extra : null;
  try {
    const { rows: prevRows } = await pool.query(
      `SELECT best_score FROM classic_scores WHERE user_id = $1 AND game_id = $2`,
      [req.user.id, gameId]
    );
    const prevBest = prevRows.length > 0 ? prevRows[0].best_score : null;

    const { rows } = await pool.query(
      `INSERT INTO classic_scores (user_id, username, game_id, best_score, games_played, extra, updated_at)
       VALUES ($1, $2, $3, $4, 1, $5::jsonb, now())
       ON CONFLICT (user_id, game_id) DO UPDATE SET
         username     = EXCLUDED.username,
         extra        = CASE WHEN EXCLUDED.best_score > classic_scores.best_score
                             THEN EXCLUDED.extra ELSE classic_scores.extra END,
         best_score   = GREATEST(classic_scores.best_score, EXCLUDED.best_score),
         games_played = classic_scores.games_played + 1,
         updated_at   = now()
       RETURNING *`,
      [req.user.id, req.user.username || null, gameId, score, extra ? JSON.stringify(extra) : null]
    );
    const me = rows[0];

    // Best-effort stats snapshot bump (row may not exist for this user yet).
    await pool.query(
      `UPDATE user_stats_snapshot
         SET total_score = total_score + $2, classics_played = classics_played + 1,
             last_win_at = now(), updated_at = now()
       WHERE user_id = $1`,
      [req.user.id, score]
    ).catch(() => {});

    if (!prevBest || score > prevBest) {
      await pool.query(
        `INSERT INTO user_achievements (user_id, type, game_id, score, metadata)
         VALUES ($1, 'personal_best', $2, $3, $4)`,
        [req.user.id, gameId, score, JSON.stringify({ previousBest: prevBest })]
      ).catch(() => {});
    }

    const { rows: rankRows } = await pool.query(
      `SELECT COUNT(*) + 1 AS rank FROM classic_scores
        WHERE game_id = $1 AND (best_score > $2 OR (best_score = $2 AND updated_at < $3))`,
      [gameId, me.best_score, me.updated_at]
    );
    res.json({ bestScore: me.best_score, rank: Number(rankRows[0].rank), gamesPlayed: me.games_played });
  } catch (err) {
    console.error('[classic] score failed:', err.message);
    res.status(500).json({ error: 'Failed to record score' });
  }
});

// Top-N classic-game leaderboard plus the caller's own standing.
app.get('/api/classic/:gameId/leaderboard', async (req, res) => {
  const { gameId } = req.params;
  if (!CLASSIC_SCORE_GAME_IDS.has(gameId)) return res.status(400).json({ error: 'Unknown game' });
  // ?scope=friends (phase 4): all-time board filtered to the caller + the
  // people they follow; ranks recomputed within the filtered set. Anonymous
  // callers have no follow graph — empty board.
  const friendsScope = req.query.scope === 'friends';
  if (friendsScope && !req.user) return res.json({ entries: [], me: null, total: 0 });
  const scopeUid = friendsScope ? req.user.id : null;
  const scopeSql = `AND ($2::text IS NULL
                         OR user_id = $2
                         OR user_id IN (SELECT followee_id FROM user_follows WHERE follower_id = $2))`;
  try {
    const { rows: top } = await pool.query(
      `SELECT user_id, username, best_score, extra,
              ROW_NUMBER() OVER (ORDER BY best_score DESC, updated_at ASC) AS rank
         FROM classic_scores
        WHERE game_id = $1 ${scopeSql}
        ORDER BY best_score DESC, updated_at ASC
        LIMIT $3`,
      [gameId, scopeUid, CLASSIC_LB_LIMIT]
    );
    const { rows: totalRows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM classic_scores WHERE game_id = $1 ${scopeSql}`,
      [gameId, scopeUid]
    );

    // Public via PUBLIC_API_GET — req.user may be null (anonymous browse).
    let me = null;
    const { rows: mine } = req.user
      ? await pool.query(
          `SELECT username, best_score, extra, updated_at FROM classic_scores WHERE user_id = $1 AND game_id = $2`,
          [req.user.id, gameId]
        )
      : { rows: [] };
    if (mine.length) {
      const row = mine[0];
      const { rows: rankRows } = await pool.query(
        `SELECT COUNT(*) + 1 AS rank FROM classic_scores
          WHERE game_id = $1 ${scopeSql}
            AND (best_score > $3 OR (best_score = $3 AND updated_at < $4))`,
        [gameId, scopeUid, row.best_score, row.updated_at]
      );
      me = { rank: Number(rankRows[0].rank), username: row.username || 'you', bestScore: Number(row.best_score), extra: row.extra || null };
    }

    res.json({ entries: top.map(shapeClassicScoreRow), me, total: totalRows[0].n });
  } catch (err) {
    console.error('[classic] leaderboard failed:', err.message);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

// ---- Rating ladder (phase 4) ----------------------------------------------
// Elo ladder for the head-to-head games, fed by the room/match finish
// handlers via applyMatchRating. `weeklyDelta` is elo − week_start_elo when
// the player has played this ISO week (0 otherwise); `movers` is the top of
// this week's biggest climbers. Public via PUBLIC_API_GET (null-guards
// req.user).
const LADDER_LIMIT = 20;
app.get('/api/ladder/:gameId', async (req, res) => {
  const { gameId } = req.params;
  if (!H2H_GAME_IDS.has(gameId)) return res.status(400).json({ error: 'Unknown ladder game' });
  try {
    const { rows } = await pool.query(
      `SELECT user_id, username, elo, win_streak, best_streak, wins, losses, draws,
              CASE WHEN week_start_date >= $2::date THEN elo - week_start_elo ELSE 0 END AS weekly_delta,
              ROW_NUMBER() OVER (ORDER BY elo DESC, win_streak DESC, updated_at ASC) AS rank
         FROM game_ratings
        WHERE game_id = $1
        ORDER BY elo DESC, win_streak DESC, updated_at ASC`,
      [gameId, utcWeekStart()]
    );
    const uid = req.user ? req.user.id : null;
    const shape = (r) => ({
      rank: Number(r.rank),
      username: r.username || 'anon',
      elo: r.elo,
      winStreak: r.win_streak,
      bestStreak: r.best_streak,
      wins: r.wins,
      losses: r.losses,
      draws: r.draws,
      weeklyDelta: Number(r.weekly_delta),
      isCurrentUser: uid != null && r.user_id === uid,
    });
    const entries = rows.slice(0, LADDER_LIMIT).map(shape);
    const mineRow = uid != null ? rows.find((r) => r.user_id === uid) : null;
    const movers = rows.map(shape)
      .filter((e) => e.weeklyDelta > 0)
      .sort((a, b) => b.weeklyDelta - a.weeklyDelta)
      .slice(0, 3);
    res.json({ entries, me: mineRow ? shape(mineRow) : null, total: rows.length, movers });
  } catch (err) {
    console.error('[ladder] load failed:', err.message);
    res.status(500).json({ error: 'Failed to load ladder' });
  }
});

// ---- The caller's own all-time scores, every game -------------------------
// One auth-gated read covering every figure the app records per game:
//   pts    — all-time daily points (daily_attempts, the exact filter the
//            all-time leaderboard ranks on, so the two agree)
//   best   — the game's own classic/PB-table best (classic_scores plus the
//            per-game snake/breakout/zuma/mancala/tilematch/match3 tables)
//   record — head-to-head wins/losses/draws (game_ratings)
// The two score systems never mix: a daily's score is multiplied points, a
// classic's best_score is the game's own raw score, so they stay separate
// fields and the client labels them differently ("+N pts" / "Best N").
// Registered above the app.get('*') catch-all; NOT in PUBLIC_API_GET — it is
// caller-keyed (req.user.id) and deliberately exposes no other user.
app.get('/api/my/scores', async (req, res) => {
  const uid = req.user.id;
  try {
    const scores = {};
    const ensure = (gid) => (scores[gid] || (scores[gid] = {}));
    // All-time daily points, grouped per game. Losses (score 0) are excluded,
    // like every leaderboard.
    const daily = await pool.query(
      `SELECT game_id, SUM(score)::int AS pts
         FROM daily_attempts
        WHERE user_id = $1
          AND finished_at IS NOT NULL
          AND score IS NOT NULL AND score > 0
        GROUP BY game_id`,
      [uid]
    );
    for (const r of daily.rows) {
      if (r.pts == null) continue;
      ensure(r.game_id).pts = Number(r.pts);
    }
    // Classic bests — the GREATEST-upserted per-game table.
    const classic = await pool.query(
      `SELECT game_id, MAX(best_score)::int AS best
         FROM classic_scores
        WHERE user_id = $1
        GROUP BY game_id`,
      [uid]
    );
    for (const r of classic.rows) {
      if (r.best == null) continue;
      ensure(r.game_id).best = Number(r.best);
    }
    // Per-game PB tables: snake/bounce/zuma/tilematch hold one row per user,
    // mancala one per difficulty and match3 one per puzzle — MAX across them.
    // Each branch is a bare aggregate, so zero rows yield one NULL row that
    // the `best IS NOT NULL` filter drops.
    const pb = await pool.query(
      `SELECT 'snake' AS game_id, MAX(best_score)::int AS best
         FROM snake_scores WHERE user_id = $1
       UNION ALL
       SELECT 'bounce', MAX(best_score)::int
         FROM breakout_scores WHERE user_id = $1
       UNION ALL
       SELECT 'zuma', MAX(best_score)::int
         FROM zuma_scores WHERE user_id = $1
       UNION ALL
       SELECT 'mancala', MAX(best_score)::int
         FROM mancala_scores WHERE user_id = $1
       UNION ALL
       SELECT 'tilematching', MAX(best_session_score)::int
         FROM tilematch_scores WHERE user_id = $1
       UNION ALL
       SELECT 'match3', MAX(best_score)::int
         FROM match3_scores WHERE user_id = $1`,
      [uid]
    );
    for (const r of pb.rows) {
      if (r.best == null) continue;
      ensure(r.game_id).best = Number(r.best);
    }
    // Head-to-head records. Unrated seats (local modes, 3–4P ludo) never write
    // a row, so absence is the correct answer for them.
    const ratings = await pool.query(
      `SELECT game_id, wins, losses, draws
         FROM game_ratings
        WHERE user_id = $1`,
      [uid]
    );
    for (const r of ratings.rows) {
      if (!H2H_GAME_IDS.has(r.game_id)) continue;
      ensure(r.game_id).record = { wins: r.wins, losses: r.losses, draws: r.draws };
    }
    res.json({ scores });
  } catch (err) {
    console.error('[my-scores] load failed:', err.message);
    res.status(500).json({ error: 'Failed to load scores' });
  }
});

// ---- Mancala ZK leaderboard API ------------------------------------------

const MNC_SESSION_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
function generateMncSessionId() {
  let id = '';
  const bytes = crypto.randomBytes(12);
  for (let i = 0; i < 12; i++) {
    id += MNC_SESSION_ALPHABET[bytes[i] % MNC_SESSION_ALPHABET.length];
  }
  return id;
}

const VALID_MNC_DIFFICULTIES = new Set(['easy', 'medium', 'hard']);
const MNC_LB_LIMIT = 20;
// Server-side score formula — must mirror the client constant in MancalaAIGame.
function mncComputeScore(finalPits) {
  return Math.max((finalPits[6] - finalPits[13]) * 15, 50);
}

// Register a new ZK session: client commits to game state before playing.
app.post('/api/mancala/score/start', async (req, res) => {
  const { commitment, difficulty } = req.body;
  if (typeof commitment !== 'string' || commitment.length < 10) {
    return res.status(400).json({ error: 'commitment is required' });
  }
  if (!VALID_MNC_DIFFICULTIES.has(difficulty)) {
    return res.status(400).json({ error: 'difficulty must be easy, medium, or hard' });
  }
  try {
    const sessionId = generateMncSessionId();
    await pool.query(
      `INSERT INTO mancala_sessions (id, user_id, commitment, difficulty)
       VALUES ($1, $2, $3, $4)`,
      [sessionId, req.user.id, commitment, difficulty]
    );
    res.json({ sessionId });
  } catch (err) {
    console.error('[mancala-zk] start failed:', err.message);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// Verify the move log, compute server-side score, upsert personal best.
// Score formula mirrors client: Math.max((finalPits[6] - finalPits[13]) * 15 - timeSecs, 50)
app.post('/api/mancala/score/verify', async (req, res) => {
  const { sessionId, nonce, moveLog, finalPits, timeSecs } = req.body;
  if (typeof sessionId !== 'string' || typeof nonce !== 'string') {
    return res.status(400).json({ error: 'sessionId and nonce are required' });
  }
  if (!Array.isArray(moveLog) || moveLog.length === 0 || moveLog.length > 200) {
    return res.status(400).json({ error: 'moveLog must be a non-empty array of ≤200 moves' });
  }
  if (!Array.isArray(finalPits) || finalPits.length !== 14) {
    return res.status(400).json({ error: 'finalPits must be a 14-element array' });
  }
  const tSecs = typeof timeSecs === 'number' ? Math.round(timeSecs) : null;
  if (tSecs === null || tSecs < 0) {
    return res.status(400).json({ error: 'timeSecs is required' });
  }

  try {
    // Recently Played tracking (Recent goal): a settled solo run is a play.
    recordGamePlay(req.user.id, req.user.username, 'mancala');
    const { rows } = await pool.query(
      `SELECT * FROM mancala_sessions WHERE id = $1`,
      [sessionId]
    );
    if (rows.length === 0) return res.status(404).json({ verified: false, reason: 'session_not_found' });
    const sess = rows[0];
    if (sess.user_id !== req.user.id) return res.status(403).json({ verified: false, reason: 'not_your_session' });
    if (sess.status !== 'pending') return res.status(409).json({ verified: false, reason: 'session_already_used' });

    // Check session age (max 2 hours)
    const ageMs = Date.now() - new Date(sess.created_at).getTime();
    if (ageMs > 7200 * 1000) {
      await pool.query(`UPDATE mancala_sessions SET status = 'expired' WHERE id = $1`, [sessionId]);
      return res.status(409).json({ verified: false, reason: 'session_expired' });
    }

    // Verify commitment: SHA-256(nonce + "||" + JSON(initBoard))
    const initBoard = [4,4,4,4,4,4,0,4,4,4,4,4,4,0];
    const expectedCommitment = crypto.createHash('sha256')
      .update(nonce + '||' + JSON.stringify(initBoard))
      .digest('hex');
    if (expectedCommitment !== sess.commitment) {
      await pool.query(`UPDATE mancala_sessions SET status = 'rejected' WHERE id = $1`, [sessionId]);
      return res.json({ verified: false, reason: 'commitment_mismatch' });
    }

    // Replay the full game from initBoard using the submitted move log.
    // Each move must be valid for the current player; we track currentPlayer.
    let pits = initBoard.slice();
    let currentPlayer = 1;
    for (let i = 0; i < moveLog.length; i++) {
      const pitIdx = moveLog[i];
      if (typeof pitIdx !== 'number' || !Number.isFinite(pitIdx)) {
        await pool.query(`UPDATE mancala_sessions SET status = 'rejected' WHERE id = $1`, [sessionId]);
        return res.json({ verified: false, reason: 'invalid_move_type' });
      }
      const ownMin = currentPlayer === 1 ? 0 : 7;
      const ownMax = currentPlayer === 1 ? 5 : 12;
      if (pitIdx < ownMin || pitIdx > ownMax || pits[pitIdx] === 0) {
        await pool.query(`UPDATE mancala_sessions SET status = 'rejected' WHERE id = $1`, [sessionId]);
        return res.json({ verified: false, reason: `illegal_move_at_index_${i}` });
      }
      const result = srvMncApplyMove(pits, pitIdx, currentPlayer);
      pits = result.pits;
      if (result.gameOver) {
        // Game should be over — remaining moves in log are unexpected
        if (i < moveLog.length - 1) {
          await pool.query(`UPDATE mancala_sessions SET status = 'rejected' WHERE id = $1`, [sessionId]);
          return res.json({ verified: false, reason: 'moves_after_game_over' });
        }
        break;
      }
      currentPlayer = result.nextPlayer;
    }

    // Check final board matches and player won
    for (let j = 0; j < 14; j++) {
      if (pits[j] !== finalPits[j]) {
        await pool.query(`UPDATE mancala_sessions SET status = 'rejected' WHERE id = $1`, [sessionId]);
        return res.json({ verified: false, reason: 'final_pits_mismatch' });
      }
    }
    if (pits[6] <= pits[13]) {
      await pool.query(`UPDATE mancala_sessions SET status = 'rejected' WHERE id = $1`, [sessionId]);
      return res.json({ verified: false, reason: 'player_did_not_win' });
    }

    // Compute server-side score (mirrors client formula)
    const margin = pits[6] - pits[13];
    const score = Math.max(margin * 15 - tSecs, 50);
    const diff = sess.difficulty;
    const moves = moveLog.length;

    // Get previous best for achievement check
    const { rows: prevRows } = await pool.query(
      `SELECT best_score FROM mancala_scores WHERE user_id = $1 AND difficulty = $2`,
      [req.user.id, diff]
    );
    const prevBest = prevRows.length > 0 ? prevRows[0].best_score : null;

    // Upsert personal best — GREATEST so worse runs never overwrite better ones
    const { rows: updated } = await pool.query(
      `INSERT INTO mancala_scores
         (user_id, username, difficulty, best_score, best_margin, best_moves, best_time_secs,
          games_played, wins, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 1, 1, now())
       ON CONFLICT (user_id, difficulty) DO UPDATE SET
         username       = EXCLUDED.username,
         best_margin    = CASE WHEN EXCLUDED.best_score > mancala_scores.best_score
                               THEN EXCLUDED.best_margin ELSE mancala_scores.best_margin END,
         best_moves     = CASE WHEN EXCLUDED.best_score > mancala_scores.best_score
                               THEN EXCLUDED.best_moves  ELSE mancala_scores.best_moves  END,
         best_time_secs = CASE WHEN EXCLUDED.best_score > mancala_scores.best_score
                               THEN EXCLUDED.best_time_secs ELSE mancala_scores.best_time_secs END,
         best_score     = GREATEST(mancala_scores.best_score, EXCLUDED.best_score),
         games_played   = mancala_scores.games_played + 1,
         wins           = mancala_scores.wins + 1,
         updated_at     = now()
       RETURNING best_score, updated_at`,
      [req.user.id, req.user.username || null, diff, score, margin, moves, tSecs]
    );
    const me = updated[0];

    // Mark session verified
    await pool.query(
      `UPDATE mancala_sessions SET status = 'verified', verified_at = now() WHERE id = $1`,
      [sessionId]
    );

    // Update user stats snapshot
    await pool.query(
      `INSERT INTO user_stats_snapshot (user_id, username, total_score, classics_played, last_win_at, updated_at)
       VALUES ($1, $2, $3, 1, now(), now())
       ON CONFLICT (user_id) DO UPDATE SET
         total_score = user_stats_snapshot.total_score + $3,
         classics_played = user_stats_snapshot.classics_played + 1,
         last_win_at = now(),
         updated_at = now()`,
      [req.user.id, req.user.username || null, score]
    );

    // Achievement for personal best
    if (!prevBest || score > prevBest) {
      await pool.query(
        `INSERT INTO user_achievements (user_id, type, game_id, score, metadata)
         VALUES ($1, 'personal_best', 'mancala', $2, $3)`,
        [req.user.id, score, JSON.stringify({ previousBest: prevBest, difficulty: diff })]
      );
    }

    // Caller's current rank within this difficulty
    const { rows: rankRows } = await pool.query(
      `SELECT COUNT(*) + 1 AS rank FROM mancala_scores
        WHERE difficulty = $1
          AND (best_score > $2 OR (best_score = $2 AND updated_at < $3))`,
      [diff, me.best_score, me.updated_at]
    );

    res.json({ verified: true, score, rank: Number(rankRows[0].rank) });
  } catch (err) {
    console.error('[mancala-zk] verify failed:', err.message);
    res.status(500).json({ error: 'Failed to verify session' });
  }
});

// Global Mancala leaderboard — top 20 per difficulty + caller's own standing.
const VALID_MNC_LB_DIFFICULTIES = new Set(['easy', 'medium', 'hard']);
app.get('/api/mancala/leaderboard', async (req, res) => {
  const diff = req.query.difficulty || 'hard';
  if (!VALID_MNC_LB_DIFFICULTIES.has(diff)) {
    return res.status(400).json({ error: 'difficulty must be easy, medium, or hard' });
  }
  try {
    const { rows: top } = await pool.query(
      `SELECT user_id, username, best_score, best_margin, best_time_secs,
              ROW_NUMBER() OVER (ORDER BY best_score DESC, updated_at ASC) AS rank
         FROM mancala_scores
        WHERE difficulty = $1
        ORDER BY best_score DESC, updated_at ASC
        LIMIT $2`,
      [diff, MNC_LB_LIMIT]
    );

    let me = null;
    const { rows: mine } = await pool.query(
      `SELECT best_score, best_margin, best_time_secs, updated_at
         FROM mancala_scores
        WHERE user_id = $1 AND difficulty = $2`,
      [req.user.id, diff]
    );
    if (mine.length) {
      const row = mine[0];
      const { rows: rankRows } = await pool.query(
        `SELECT COUNT(*) + 1 AS rank FROM mancala_scores
          WHERE difficulty = $1
            AND (best_score > $2 OR (best_score = $2 AND updated_at < $3))`,
        [diff, row.best_score, row.updated_at]
      );
      me = {
        rank: Number(rankRows[0].rank),
        username: req.user.username || null,
        bestScore: row.best_score,
        bestMargin: row.best_margin,
        bestTimeSecs: row.best_time_secs,
      };
    }

    res.json({
      top: top.map(r => ({
        rank: Number(r.rank),
        username: r.username,
        bestScore: r.best_score,
        bestMargin: r.best_margin,
        bestTimeSecs: r.best_time_secs,
      })),
      me,
    });
  } catch (err) {
    console.error('[mancala-zk] leaderboard failed:', err.message);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

// ---- Mancala Daily Challenge API -----------------------------------------

// Daily score formula — win margin rewarded, faster finish scores higher. Floor
// 0 (not 50) so losses/draws stay off the leaderboard, which filters score > 0.
function mncDailyScore(finalPits, timeSecs) {
  if (finalPits[6] <= finalPits[13]) return 0; // only a win scores
  return Math.max((finalPits[6] - finalPits[13]) * 15 - timeSecs, 0);
}

function shapeDailyAttempt(row) {
  if (!row) return null;
  return {
    puzzleDate:  row.puzzle_date,
    score:       row.score,
    margin:      row.margin,
    moves:       row.moves,
    timeSecs:    row.time_secs,
    won:         row.won,
    progress:    row.progress || null,
    elapsedSecs: row.elapsed_secs != null ? row.elapsed_secs : null,
    startedAt:   row.started_at,
    finishedAt:  row.finished_at,
  };
}

// ---- Diamond Rush API -------------------------------------------------------

// Phase 1 ships 5 handcrafted levels. Used to validate level-complete posts.
const DIAMOND_LEVEL_COUNT = 5;

function shapeDiamondProgress(row) {
  return {
    clearedLevels: Array.isArray(row.cleared_levels) ? row.cleared_levels : [],
    bestResults: row.best_results || {},
    totalGems: row.total_gems || 0,
  };
}



// ---- Snake leaderboard API -----------------------------------------------

const SNAKE_LB_LIMIT = 20;

function shapeSnakeRow(row) {
  return {
    rank: Number(row.rank),
    username: row.username,
    bestScore: row.best_score,
  };
}

// Submit a finished run. Upserts the caller's personal-best row (GREATEST so a
// worse run never lowers it) and bumps games_played. Identity from req.user.
// Also updates user stats snapshot and creates achievements.
app.post('/api/snake/score', async (req, res) => {
  const score = Number.isFinite(req.body.score) ? Math.round(req.body.score) : null;
  const length = Number.isFinite(req.body.length) ? Math.round(req.body.length) : null;
  const timeSecs = Number.isFinite(req.body.timeSecs) ? Math.round(req.body.timeSecs) : null;
  if (score === null) return res.status(400).json({ error: 'score is required' });
  // Recently Played tracking (Recent goal): a submitted run is a play.
  recordGamePlay(req.user.id, req.user.username, 'snake');
  try {
    // Get previous best before updating
    const { rows: prevRows } = await pool.query(
      `SELECT best_score FROM snake_scores WHERE user_id = $1`,
      [req.user.id]
    );
    const prevBest = prevRows.length > 0 ? prevRows[0].best_score : null;

    // Update best_length/best_time_secs only when this run set a new best score.
    const { rows } = await pool.query(
      `INSERT INTO snake_scores
         (user_id, username, best_score, best_length, best_time_secs, games_played, updated_at)
       VALUES ($1, $2, $3, $4, $5, 1, now())
       ON CONFLICT (user_id) DO UPDATE SET
         username       = EXCLUDED.username,
         best_length    = CASE WHEN EXCLUDED.best_score > snake_scores.best_score
                               THEN EXCLUDED.best_length ELSE snake_scores.best_length END,
         best_time_secs = CASE WHEN EXCLUDED.best_score > snake_scores.best_score
                               THEN EXCLUDED.best_time_secs ELSE snake_scores.best_time_secs END,
         best_score     = GREATEST(snake_scores.best_score, EXCLUDED.best_score),
         games_played   = snake_scores.games_played + 1,
         updated_at     = now()
       RETURNING *`,
      [req.user.id, req.user.username || null, score, length, timeSecs]
    );
    const me = rows[0];

    // Update user stats snapshot
    await pool.query(
      `INSERT INTO user_stats_snapshot (user_id, username, total_score, classics_played, last_win_at, updated_at)
       VALUES ($1, $2, $3, 1, now(), now())
       ON CONFLICT (user_id) DO UPDATE SET
         total_score = user_stats_snapshot.total_score + $3,
         classics_played = user_stats_snapshot.classics_played + 1,
         last_win_at = now(),
         updated_at = now()`,
      [req.user.id, req.user.username || null, score]
    );

    // Create achievement if this is a personal best
    if (!prevBest || score > prevBest) {
      await pool.query(
        `INSERT INTO user_achievements (user_id, type, game_id, score, metadata)
         VALUES ($1, 'personal_best', 'snake', $2, $3)`,
        [req.user.id, score, JSON.stringify({ previousBest: prevBest })]
      );
    }

    // Caller's current rank (1-based) by best_score, ties broken by who got
    // there first — same ordering as the leaderboard query.
    const { rows: rankRows } = await pool.query(
      `SELECT COUNT(*) + 1 AS rank FROM snake_scores
        WHERE best_score > $1
           OR (best_score = $1 AND updated_at < $2)`,
      [me.best_score, me.updated_at]
    );
    res.json({
      bestScore: me.best_score,
      rank: Number(rankRows[0].rank),
      gamesPlayed: me.games_played,
    });
  } catch (err) {
    console.error('[snake] score failed:', err.message);
    res.status(500).json({ error: 'Failed to record score' });
  }
});

// Top scores plus the caller's own standing (even when outside the top N).
app.get('/api/snake/leaderboard', async (req, res) => {
  try {
    const { rows: top } = await pool.query(
      `SELECT user_id, username, best_score,
              ROW_NUMBER() OVER (ORDER BY best_score DESC, updated_at ASC) AS rank
         FROM snake_scores
        ORDER BY best_score DESC, updated_at ASC
        LIMIT $1`,
      [SNAKE_LB_LIMIT]
    );

    let me = null;
    const { rows: mine } = await pool.query(
      `SELECT username, best_score, updated_at FROM snake_scores WHERE user_id = $1`,
      [req.user.id]
    );
    if (mine.length) {
      const row = mine[0];
      const { rows: rankRows } = await pool.query(
        `SELECT COUNT(*) + 1 AS rank FROM snake_scores
          WHERE best_score > $1
             OR (best_score = $1 AND updated_at < $2)`,
        [row.best_score, row.updated_at]
      );
      me = { rank: Number(rankRows[0].rank), username: row.username, bestScore: row.best_score };
    }

    res.json({ top: top.map(shapeSnakeRow), me });
  } catch (err) {
    console.error('[snake] leaderboard failed:', err.message);

    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

// ---- Bounce (Breakout) leaderboard API -----------------------------------
// Mirrors the Snake leaderboard exactly: one personal-best row per user,
// upserted with GREATEST, ranked by best_score then earliest-to-reach.

const BOUNCE_LB_LIMIT = 20;

function shapeBounceRow(row) {
  return {
    rank: Number(row.rank),
    username: row.username,
    bestScore: row.best_score,
  };
}

// Submit a finished run. Upserts the caller's personal-best row (GREATEST so a
// worse run never lowers it) and bumps games_played. Identity from req.user.
// Also updates user stats snapshot and creates achievements (Snake parity).
app.post('/api/bounce/score', async (req, res) => {
  const score = Number.isFinite(req.body.score) ? Math.round(req.body.score) : null;
  const level = Number.isFinite(req.body.level) ? Math.round(req.body.level) : null;
  const timeSecs = Number.isFinite(req.body.timeSecs) ? Math.round(req.body.timeSecs) : null;
  if (score === null) return res.status(400).json({ error: 'score is required' });
  // Recently Played tracking (Recent goal): a submitted run is a play.
  recordGamePlay(req.user.id, req.user.username, 'bounce');
  try {
    // Get previous best before updating
    const { rows: prevRows } = await pool.query(
      `SELECT best_score FROM breakout_scores WHERE user_id = $1`,
      [req.user.id]
    );
    const prevBest = prevRows.length > 0 ? prevRows[0].best_score : null;

    // Update best_level/best_time_secs only when this run set a new best score.
    const { rows } = await pool.query(
      `INSERT INTO breakout_scores
         (user_id, username, best_score, best_level, best_time_secs, games_played, updated_at)
       VALUES ($1, $2, $3, $4, $5, 1, now())
       ON CONFLICT (user_id) DO UPDATE SET
         username       = EXCLUDED.username,
         best_level     = CASE WHEN EXCLUDED.best_score > breakout_scores.best_score
                               THEN EXCLUDED.best_level ELSE breakout_scores.best_level END,
         best_time_secs = CASE WHEN EXCLUDED.best_score > breakout_scores.best_score
                               THEN EXCLUDED.best_time_secs ELSE breakout_scores.best_time_secs END,
         best_score     = GREATEST(breakout_scores.best_score, EXCLUDED.best_score),
         games_played   = breakout_scores.games_played + 1,
         updated_at     = now()
       RETURNING *`,
      [req.user.id, req.user.username || null, score, level, timeSecs]
    );
    const me = rows[0];

    // Update user stats snapshot
    await pool.query(
      `INSERT INTO user_stats_snapshot (user_id, username, total_score, classics_played, last_win_at, updated_at)
       VALUES ($1, $2, $3, 1, now(), now())
       ON CONFLICT (user_id) DO UPDATE SET
         total_score = user_stats_snapshot.total_score + $3,
         classics_played = user_stats_snapshot.classics_played + 1,
         last_win_at = now(),
         updated_at = now()`,
      [req.user.id, req.user.username || null, score]
    );

    // Create achievement if this is a personal best
    if (!prevBest || score > prevBest) {
      await pool.query(
        `INSERT INTO user_achievements (user_id, type, game_id, score, metadata)
         VALUES ($1, 'personal_best', 'bounce', $2, $3)`,
        [req.user.id, score, JSON.stringify({ previousBest: prevBest })]
      );
    }

    // Caller's current rank (1-based) by best_score, ties broken by who got
    // there first — same ordering as the leaderboard query.
    const { rows: rankRows } = await pool.query(
      `SELECT COUNT(*) + 1 AS rank FROM breakout_scores
        WHERE best_score > $1
           OR (best_score = $1 AND updated_at < $2)`,
      [me.best_score, me.updated_at]
    );
    res.json({
      bestScore: me.best_score,
      rank: Number(rankRows[0].rank),
      gamesPlayed: me.games_played,
    });
  } catch (err) {
    console.error('[bounce] score failed:', err.message);
    res.status(500).json({ error: 'Failed to record score' });
  }
});

// Top scores plus the caller's own standing (even when outside the top N).
app.get('/api/bounce/leaderboard', async (req, res) => {
  try {
    const { rows: top } = await pool.query(
      `SELECT user_id, username, best_score,
              ROW_NUMBER() OVER (ORDER BY best_score DESC, updated_at ASC) AS rank
         FROM breakout_scores
        ORDER BY best_score DESC, updated_at ASC
        LIMIT $1`,
      [BOUNCE_LB_LIMIT]
    );

    let me = null;
    const { rows: mine } = await pool.query(
      `SELECT username, best_score, updated_at FROM breakout_scores WHERE user_id = $1`,
      [req.user.id]
    );
    if (mine.length) {
      const row = mine[0];
      const { rows: rankRows } = await pool.query(
        `SELECT COUNT(*) + 1 AS rank FROM breakout_scores
          WHERE best_score > $1
             OR (best_score = $1 AND updated_at < $2)`,
        [row.best_score, row.updated_at]
      );
      me = { rank: Number(rankRows[0].rank), username: row.username, bestScore: row.best_score };
    }

    res.json({ top: top.map(shapeBounceRow), me });
  } catch (err) {
    console.error('[bounce] leaderboard failed:', err.message);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

// ---- Zuma leaderboard API ------------------------------------------------
// Mirrors Bounce/Snake exactly: one personal-best row per user, upserted with
// GREATEST, ranked by best_score then earliest-to-reach.

const ZUMA_LB_LIMIT = 20;

function shapeZumaRow(row) {
  return {
    rank: Number(row.rank),
    username: row.username,
    bestScore: row.best_score,
  };
}

app.post('/api/zuma/score', async (req, res) => {
  const score = Number.isFinite(req.body.score) ? Math.round(req.body.score) : null;
  const level = Number.isFinite(req.body.level) ? Math.round(req.body.level) : null;
  const timeSecs = Number.isFinite(req.body.timeSecs) ? Math.round(req.body.timeSecs) : null;
  if (score === null) return res.status(400).json({ error: 'score is required' });
  // Recently Played tracking (Recent goal): a submitted run is a play.
  recordGamePlay(req.user.id, req.user.username, 'zuma');
  try {
    const { rows: prevRows } = await pool.query(
      `SELECT best_score FROM zuma_scores WHERE user_id = $1`,
      [req.user.id]
    );
    const prevBest = prevRows.length > 0 ? prevRows[0].best_score : null;

    const { rows } = await pool.query(
      `INSERT INTO zuma_scores
         (user_id, username, best_score, best_level, best_time_secs, games_played, updated_at)
       VALUES ($1, $2, $3, $4, $5, 1, now())
       ON CONFLICT (user_id) DO UPDATE SET
         username       = EXCLUDED.username,
         best_level     = CASE WHEN EXCLUDED.best_score > zuma_scores.best_score
                               THEN EXCLUDED.best_level ELSE zuma_scores.best_level END,
         best_time_secs = CASE WHEN EXCLUDED.best_score > zuma_scores.best_score
                               THEN EXCLUDED.best_time_secs ELSE zuma_scores.best_time_secs END,
         best_score     = GREATEST(zuma_scores.best_score, EXCLUDED.best_score),
         games_played   = zuma_scores.games_played + 1,
         updated_at     = now()
       RETURNING *`,
      [req.user.id, req.user.username || null, score, level, timeSecs]
    );
    const me = rows[0];

    await pool.query(
      `INSERT INTO user_stats_snapshot (user_id, username, total_score, classics_played, last_win_at, updated_at)
       VALUES ($1, $2, $3, 1, now(), now())
       ON CONFLICT (user_id) DO UPDATE SET
         total_score = user_stats_snapshot.total_score + $3,
         classics_played = user_stats_snapshot.classics_played + 1,
         last_win_at = now(),
         updated_at = now()`,
      [req.user.id, req.user.username || null, score]
    );

    if (!prevBest || score > prevBest) {
      await pool.query(
        `INSERT INTO user_achievements (user_id, type, game_id, score, metadata)
         VALUES ($1, 'personal_best', 'zuma', $2, $3)`,
        [req.user.id, score, JSON.stringify({ previousBest: prevBest })]
      );
    }

    const { rows: rankRows } = await pool.query(
      `SELECT COUNT(*) + 1 AS rank FROM zuma_scores
        WHERE best_score > $1
           OR (best_score = $1 AND updated_at < $2)`,
      [me.best_score, me.updated_at]
    );
    res.json({
      bestScore: me.best_score,
      rank: Number(rankRows[0].rank),
      gamesPlayed: me.games_played,
    });
  } catch (err) {
    console.error('[zuma] score failed:', err.message);
    res.status(500).json({ error: 'Failed to record score' });
  }
});

app.get('/api/zuma/leaderboard', async (req, res) => {
  try {
    const { rows: top } = await pool.query(
      `SELECT user_id, username, best_score,
              ROW_NUMBER() OVER (ORDER BY best_score DESC, updated_at ASC) AS rank
         FROM zuma_scores
        ORDER BY best_score DESC, updated_at ASC
        LIMIT $1`,
      [ZUMA_LB_LIMIT]
    );

    let me = null;
    const { rows: mine } = await pool.query(
      `SELECT username, best_score, updated_at FROM zuma_scores WHERE user_id = $1`,
      [req.user.id]
    );
    if (mine.length) {
      const row = mine[0];
      const { rows: rankRows } = await pool.query(
        `SELECT COUNT(*) + 1 AS rank FROM zuma_scores
          WHERE best_score > $1
             OR (best_score = $1 AND updated_at < $2)`,
        [row.best_score, row.updated_at]
      );
      me = { rank: Number(rankRows[0].rank), username: row.username, bestScore: row.best_score };
    }

    res.json({ top: top.map(shapeZumaRow), me });
  } catch (err) {
    console.error('[zuma] leaderboard failed:', err.message);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

// ---- Daily hints (game-keyed, FREE) ---------------------------------------
// Per-UTC-day, per-game hint counter. Hints are free (the MATCH currency is
// retired) but the count stays server-authoritative — it survives reloads,
// can't be reset client-side, resets implicitly each UTC day, and is capped so
// a client can't reveal more clues than the day's puzzle actually carries.
// Hints never affect score/leaderboard. Table daily_hints, keyed by game_id
// (its hints_purchased column now simply counts hints used).

// Shared read: today's { hintsPurchased } for one game.
async function readDailyHintState(userId, username, gameId, res, logTag) {
  try {
    const { rows: hRows } = await pool.query(
      `SELECT hints_purchased FROM daily_hints
        WHERE user_id = $1 AND game_id = $2
          AND hint_date = (now() AT TIME ZONE 'utc')::date`,
      [userId, gameId]
    );
    const hintsPurchased = hRows.length ? hRows[0].hints_purchased : 0;
    res.json({ hintsPurchased });
  } catch (err) {
    console.error(`[${logTag}] hint read failed:`, err.message);
    res.status(500).json({ error: 'Failed to load hint state' });
  }
}

// Shared use: atomically bump today's per-game counter, refusing past the
// day's cap. Body may carry { maxHints } (the day's available clue/hint cap)
// so the server refuses to advance past the last one. Returns
// { hintsPurchased }.
async function useDailyHint(userId, username, gameId, maxHints, res, logTag) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Today's hint counter, locked. Upsert-then-lock so the row always exists.
    await client.query(
      `INSERT INTO daily_hints (user_id, username, game_id, hint_date, hints_purchased)
       VALUES ($1, $2, $3, (now() AT TIME ZONE 'utc')::date, 0)
       ON CONFLICT (user_id, game_id, hint_date) DO NOTHING`,
      [userId, username || null, gameId]
    );
    const { rows: hRows } = await client.query(
      `SELECT hints_purchased FROM daily_hints
        WHERE user_id = $1 AND game_id = $2
          AND hint_date = (now() AT TIME ZONE 'utc')::date
        FOR UPDATE`,
      [userId, gameId]
    );
    const purchased = hRows.length ? hRows[0].hints_purchased : 0;

    // No hints left to reveal (day's cap) → refuse.
    if (maxHints != null && purchased >= maxHints) {
      await client.query('ROLLBACK');
      return res.status(409).json({ code: 'no_more_hints', error: 'No more hints' });
    }

    await client.query(
      `UPDATE daily_hints
          SET hints_purchased = hints_purchased + 1, updated_at = now()
        WHERE user_id = $1 AND game_id = $2
          AND hint_date = (now() AT TIME ZONE 'utc')::date`,
      [userId, gameId]
    );

    await client.query('COMMIT');
    res.json({ hintsPurchased: purchased + 1 });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(`[${logTag}] hint use failed:`, err.message);
    res.status(500).json({ error: 'Failed to use hint' });
  } finally {
    client.release();
  }
}

// Generic game-keyed routes — the canonical hint API for all daily puzzles.
app.get('/api/daily/:gameId/hint', async (req, res) => {
  const { gameId } = req.params;
  if (!GAME_IDS.has(gameId)) return res.status(400).json({ error: 'Unknown game' });
  return readDailyHintState(req.user.id, req.user.username, gameId, res, gameId);
});

app.post('/api/daily/:gameId/hint', async (req, res) => {
  const { gameId } = req.params;
  if (!GAME_IDS.has(gameId)) return res.status(400).json({ error: 'Unknown game' });
  const maxHints = Number.isFinite(req.body.maxHints) ? Math.max(0, Math.round(req.body.maxHints)) : null;
  return useDailyHint(req.user.id, req.user.username, gameId, maxHints, res, gameId);
});

// Back-compat aliases — the original Crypto Wordle routes, now thin wrappers on
// the generic game-keyed flow (game_id 'cryptowordle').
app.get('/api/cryptowordle/hint', async (req, res) => {
  return readDailyHintState(req.user.id, req.user.username, 'cryptowordle', res, 'cryptowordle');
});
app.post('/api/cryptowordle/hint', async (req, res) => {
  // Crypto Wordle's cap is computed server-side (cwServerMaxHints) rather than
  // trusted from the client body, so a client can't raise its own cap.
  const maxHints = cwServerMaxHints();
  return useDailyHint(req.user.id, req.user.username, 'cryptowordle', maxHints, res, 'cryptowordle');
});

// ---- dApps integration (app-identity signing) -----------------------------
// Gated on APP_SECRET_KEY. When the secret is empty/missing (e.g. a staging
// preview whose staging_default is ""), these routes degrade gracefully: the
// server still boots, signing is skipped, and the routes report the feature as
// unavailable so the frontend hides/disables the related UI.

// Current integration availability for the signed-in user. Always 200 so the
// UI can branch on `enabled` rather than handling an error path.
app.get('/api/integration/status', (_req, res) => {
  res.json({
    enabled: APP_INTEGRATION_ENABLED,
    pubkey: APP_INTEGRATION_ENABLED ? (APP_PUBKEY || null) : null,
  });
});

// Sign an integration payload with the app secret. Returns 503 with a clear
// message when the feature is disabled so callers never reach a signing path
// that doesn't exist in this environment.
app.post('/api/integration/sign', (req, res) => {
  if (!APP_INTEGRATION_ENABLED) {
    return res.status(503).json({
      error: 'integration unavailable in this environment',
      code: 'integration_disabled',
      enabled: false,
    });
  }
  const payload = req.body && req.body.payload;
  if (payload === undefined || payload === null) {
    return res.status(400).json({ error: 'Missing payload' });
  }
  res.json({
    enabled: true,
    pubkey: APP_PUBKEY || null,
    signature: signIntegrationPayload(payload),
  });
});

// ---- Static + HTML shell -------------------------------------------------

/* Phase 7 (#144) — serve the turn-based rules registry to the browser.
   lib/board-rules.js lives OUTSIDE the public/ static root on purpose (it is
   server code first), so it needs an explicit route. It is not under /api/, so
   the deny-by-default auth middleware doesn't apply — and it carries no user
   data, only pure game rules, so anonymous access is correct: the signed-out
   lobby can already reach the games list. Loading it in the browser is what lets
   local pass-and-play and Versus Bot share the SERVER'S rules instead of a
   reimplementation that would eventually drift (see the file's own footer). */
app.get('/board-rules.js', (req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'lib', 'board-rules.js'), (err) => {
    if (err && !res.headersSent) res.status(500).end();
  });
});

app.use(express.static(path.join(__dirname, 'public')));

// HTML shell: serve the app if authenticated, otherwise an "open in Usernode"
// ---- Tile Match Puzzle API (/api/tilematch/*) --------------------------------
// Leaderboard + score submission. (The MATCH wallet, daily tasks, and 1v1
// duels that used to live here were retired with the MATCH currency.)
// All routes are auth-gated (req.user is always present here).

// --- Leaderboard ---

app.get('/api/tilematch/leaderboard', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    // Global: top 25 by highest_level (ties: earliest updated_at)
    const { rows: global } = await pool.query(
      `SELECT user_id, username, highest_level, total_cleared,
              ROW_NUMBER() OVER (ORDER BY highest_level DESC, updated_at ASC) AS rank
         FROM tilematch_scores
        ORDER BY highest_level DESC, updated_at ASC
        LIMIT 25`
    );

    // Daily: top 25 daily completions by time_secs for today
    const { rows: daily } = await pool.query(
      `SELECT user_id, username, time_secs, score,
              ROW_NUMBER() OVER (ORDER BY time_secs ASC, finished_at ASC) AS rank
         FROM daily_attempts
        WHERE game_id = 'tilematchingdaily'
          AND attempt_date = $1
          AND finished_at IS NOT NULL
          AND score > 0
        ORDER BY time_secs ASC, finished_at ASC
        LIMIT 25`,
      [today]
    );

    // Me — global rank
    let meGlobal = null;
    const { rows: myGlobal } = await pool.query(
      `SELECT username, highest_level, total_cleared, updated_at FROM tilematch_scores WHERE user_id = $1`,
      [req.user.id]
    );
    if (myGlobal.length) {
      const r = myGlobal[0];
      const { rows: gr } = await pool.query(
        `SELECT COUNT(*) + 1 AS rank FROM tilematch_scores
          WHERE highest_level > $1
             OR (highest_level = $1 AND updated_at < $2)`,
        [r.highest_level, r.updated_at]
      );
      meGlobal = { rank: Number(gr[0].rank), username: r.username, highestLevel: r.highest_level, totalCleared: r.total_cleared };
    }

    // Me — daily rank
    let meDaily = null;
    const { rows: myDaily } = await pool.query(
      `SELECT username, time_secs, score, finished_at FROM daily_attempts
        WHERE user_id = $1 AND game_id = 'tilematchingdaily'
          AND attempt_date = $2 AND finished_at IS NOT NULL AND score > 0`,
      [req.user.id, today]
    );
    if (myDaily.length) {
      const r = myDaily[0];
      const { rows: dr } = await pool.query(
        `SELECT COUNT(*) + 1 AS rank FROM daily_attempts
          WHERE game_id = 'tilematchingdaily' AND attempt_date = $1
            AND finished_at IS NOT NULL AND score > 0
            AND (time_secs < $2 OR (time_secs = $2 AND finished_at < $3))`,
        [today, r.time_secs, r.finished_at]
      );
      meDaily = { rank: Number(dr[0].rank), username: r.username, timeSecs: r.time_secs, score: r.score };
    }

    res.json({
      global: global.map(r => ({ rank: Number(r.rank), username: r.username, highestLevel: r.highest_level, totalCleared: r.total_cleared })),
      daily:  daily.map(r => ({ rank: Number(r.rank), username: r.username, timeSecs: r.time_secs, score: r.score })),
      me: { global: meGlobal, daily: meDaily },
    });
  } catch (err) {
    console.error('[tilematch] leaderboard failed:', err.message);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

// --- Score submit ---

app.post('/api/tilematch/scores/submit', async (req, res) => {
  const highestLevel  = Number.isFinite(req.body.highestLevel)  ? Math.round(req.body.highestLevel)  : 0;
  const totalCleared  = Number.isFinite(req.body.totalCleared)  ? Math.round(req.body.totalCleared)  : 0;
  const sessionScore  = Number.isFinite(req.body.sessionScore)  ? Math.round(req.body.sessionScore)  : 0;
  // Recently Played tracking (Recent goal): a submitted session is a play.
  recordGamePlay(req.user.id, req.user.username, 'tilematching');
  try {
    await pool.query(
      `INSERT INTO tilematch_scores
         (user_id, username, highest_level, total_cleared, best_session_score, games_played)
       VALUES ($1, $2, $3, $4, $5, 1)
       ON CONFLICT (user_id) DO UPDATE SET
         username           = EXCLUDED.username,
         highest_level      = GREATEST(tilematch_scores.highest_level, EXCLUDED.highest_level),
         total_cleared      = tilematch_scores.total_cleared + EXCLUDED.total_cleared,
         best_session_score = GREATEST(tilematch_scores.best_session_score, EXCLUDED.best_session_score),
         games_played       = tilematch_scores.games_played + 1,
         updated_at         = now()`,
      [req.user.id, req.user.username || null, highestLevel, totalCleared, sessionScore]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[tilematch] score submit failed:', err.message);
    res.status(500).json({ error: 'Failed to submit score' });
  }
});

// ---- Generic per-user game-state store ------------------------------------
// Reusable key-value persistence keyed to (req.user.id, game_id). New non-daily
// games persist here via GET/PUT /api/state/:gameId. :gameId is validated
// against ALL_GAME_IDS (any hub game), NOT the daily-only GAME_IDS.
const MAX_STATE_BYTES = 100 * 1024; // 100 KB cap on a single state payload

app.get('/api/state/:gameId', async (req, res) => {
  const { gameId } = req.params;
  if (!ALL_GAME_IDS.has(gameId)) return res.status(400).json({ error: 'Unknown game' });
  try {
    const { rows } = await pool.query(
      `SELECT state, updated_at, save_hash FROM user_game_state WHERE user_id = $1 AND game_id = $2`,
      [req.user.id, gameId]
    );
    if (rows.length === 0) return res.json({ state: null });
    res.json({
      state: rows[0].state,
      updatedAt: rows[0].updated_at,
      saveHash: rows[0].save_hash || null,
    });
  } catch (err) {
    console.error('[state] GET failed:', err.message);
    res.status(500).json({ error: 'Failed to load state' });
  }
});

app.put('/api/state/:gameId', async (req, res) => {
  const { gameId } = req.params;
  if (!ALL_GAME_IDS.has(gameId)) return res.status(400).json({ error: 'Unknown game' });
  const { state } = req.body || {};
  // Require a plain JSON object — reject null / arrays / scalars so the row's
  // shape stays predictable for consumers.
  if (state === null || typeof state !== 'object' || Array.isArray(state)) {
    return res.status(400).json({ error: 'state must be a JSON object' });
  }
  let serialized;
  try { serialized = JSON.stringify(state); }
  catch { return res.status(400).json({ error: 'state not serializable' }); }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_STATE_BYTES) {
    return res.status(400).json({ error: 'state too large (max 100KB)' });
  }
  const saveHash = crypto.createHash('sha256')
    .update(serialized + '|' + req.user.id + '|' + gameId)
    .digest('hex');
  try {
    // Last-write-wins upsert.
    await pool.query(
      `INSERT INTO user_game_state (user_id, username, game_id, state, save_hash, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, now())
       ON CONFLICT (user_id, game_id) DO UPDATE
         SET state = EXCLUDED.state, username = EXCLUDED.username,
             save_hash = EXCLUDED.save_hash, updated_at = now()`,
      [req.user.id, req.user.username || null, gameId, serialized, saveHash]
    );
    res.json({ ok: true, saveHash });
  } catch (err) {
    console.error('[state] PUT failed:', err.message);
    res.status(500).json({ error: 'Failed to save state' });
  }
});

function newSessionId() {
  return 'S' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 8).toUpperCase();
}

function shapeSession(s) {
  return {
    sessionId:      s.id,
    gameId:         s.game_id,
    seed:           s.seed != null ? Number(s.seed) : null,
    status:         s.status,
    disputeReason:  s.dispute_reason || null,
    finalScore:     s.final_score,
    finalSteps:     s.final_steps,
    finalTimeSecs:  s.final_time_secs,
    chainHash:      s.final_chain_hash,
    anchorStatus:   s.anchor_status,
    anchorTxHash:   s.anchor_tx_hash,
    username:       s.username,
    usernodePubkey: s.usernode_pubkey,
    createdAt:      s.created_at,
    finishedAt:     s.finished_at,
  };
}

// POST /api/dapp/sessions/start { gameId, seed? }
// Claims a new verification session. Returns the genesis hash so the client can
// build its hash chain against the same binding the server will recompute.
app.post('/api/dapp/sessions/start', async (req, res) => {
  const { gameId } = req.body || {};
  if (!ALL_GAME_IDS.has(gameId)) return res.status(400).json({ error: 'Unknown game' });
  if (!dapp.getEngine(gameId)) return res.status(400).json({ error: 'Game not yet supported by DApp Mode' });
  let seed = Number.isFinite(req.body.seed) ? Math.round(req.body.seed) : null;
  if (seed === null) seed = Math.floor(Math.random() * 0x7fffffff);
  // Recently Played tracking (Recent goal): claiming the session is a play.
  recordGamePlay(req.user.id, req.user.username, gameId);
  try {
    const id = newSessionId();
    await pool.query(
      `INSERT INTO game_sessions (id, user_id, username, usernode_pubkey, game_id, seed, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')`,
      [id, req.user.id, req.user.username || null, req.user.usernode_pubkey || null, gameId, seed]
    );
    const genesisHash = dapp.genesisHash({ gameId, seed, pubkey: req.user.usernode_pubkey, sessionId: id });
    res.json({ sessionId: id, seed, genesisHash });
  } catch (err) {
    console.error('[dapp] start failed:', err.message);
    res.status(500).json({ error: 'Failed to start session' });
  }
});

// POST /api/dapp/sessions/:id/append { entries:[{sequence,move,stateHash,prevHash,chainHash,tsClient}] }
// Autosave ledger flush. Append-only; rejects a finished or foreign session
// (mirrors the daily/progress immutability rule).
app.post('/api/dapp/sessions/:id/append', async (req, res) => {
  const { id } = req.params;
  const entries = Array.isArray(req.body.entries) ? req.body.entries.slice(0, 500) : [];
  try {
    const { rows } = await pool.query('SELECT * FROM game_sessions WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Session not found' });
    const s = rows[0];
    if (s.user_id !== req.user.id) return res.status(403).json({ error: 'Not your session' });
    if (s.status !== 'active') return res.status(409).json({ error: 'No active session to append to' });
    for (const e of entries) {
      if (!Number.isInteger(e.sequence) || !e.stateHash || !e.prevHash || !e.chainHash) continue;
      await pool.query(
        `INSERT INTO session_states (session_id, sequence, move, state_hash, prev_hash, chain_hash, ts_client)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (session_id, sequence) DO NOTHING`,
        [id, e.sequence, e.move != null ? JSON.stringify(e.move) : null,
         e.stateHash, e.prevHash, e.chainHash, e.tsClient ? new Date(e.tsClient).toISOString() : null]
      );
    }
    res.json({ ok: true, count: entries.length });
  } catch (err) {
    console.error('[dapp] append failed:', err.message);
    res.status(500).json({ error: 'Failed to append' });
  }
});

// POST /api/dapp/sessions/:id/finish { entries?, claimedScore, claimedSteps, claimedChainHash, timeSecs }
// Runs validateSession over the (persisted + newly-supplied) ledger, settles the
// session status, and returns the canonical chain hash for the client to anchor.
app.post('/api/dapp/sessions/:id/finish', async (req, res) => {
  const { id } = req.params;
  const supplied = Array.isArray(req.body.entries) ? req.body.entries.slice(0, 500) : [];
  const claimedScore     = Number.isFinite(req.body.claimedScore) ? Math.round(req.body.claimedScore) : null;
  const claimedSteps     = Number.isFinite(req.body.claimedSteps) ? Math.round(req.body.claimedSteps) : null;
  const claimedChainHash = typeof req.body.claimedChainHash === 'string' ? req.body.claimedChainHash : null;
  const timeSecs         = Number.isFinite(req.body.timeSecs) ? Math.round(req.body.timeSecs) : null;
  try {
    const { rows } = await pool.query('SELECT * FROM game_sessions WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Session not found' });
    const s = rows[0];
    if (s.user_id !== req.user.id) return res.status(403).json({ error: 'Not your session' });
    if (s.status !== 'active') {
      return res.json({ session: shapeSession(s), alreadyFinished: true });
    }

    // Persist any final entries the client flushed with the finish call.
    for (const e of supplied) {
      if (!Number.isInteger(e.sequence) || !e.stateHash || !e.prevHash || !e.chainHash) continue;
      await pool.query(
        `INSERT INTO session_states (session_id, sequence, move, state_hash, prev_hash, chain_hash, ts_client)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (session_id, sequence) DO NOTHING`,
        [id, e.sequence, e.move != null ? JSON.stringify(e.move) : null,
         e.stateHash, e.prevHash, e.chainHash, e.tsClient ? new Date(e.tsClient).toISOString() : null]
      );
    }

    // Load the full ordered ledger.
    const { rows: stateRows } = await pool.query(
      `SELECT sequence, move, state_hash, prev_hash, chain_hash, ts_client
         FROM session_states WHERE session_id = $1 ORDER BY sequence ASC`,
      [id]
    );
    const entries = stateRows.map(r => ({
      sequence: r.sequence,
      move: r.move,
      stateHash: r.state_hash,
      prevHash: r.prev_hash,
      chainHash: r.chain_hash,
      tsClient: r.ts_client,
    }));

    const session = { id: s.id, game_id: s.game_id, seed: Number(s.seed), usernode_pubkey: s.usernode_pubkey };
    const verdict = dapp.validateSession(session, entries, {
      score: claimedScore, steps: claimedSteps, chainHash: claimedChainHash,
    });

    if (verdict.status === 'verified') {
      await pool.query(
        `UPDATE game_sessions
            SET status='verified', final_score=$2, final_steps=$3, final_time_secs=$4,
                final_chain_hash=$5, finished_at=now()
          WHERE id=$1 AND status='active'`,
        [id, verdict.score, verdict.steps, timeSecs, verdict.finalChainHash]
      );
    } else {
      await pool.query(
        `UPDATE game_sessions
            SET status='disputed', dispute_reason=$2, final_chain_hash=$3, finished_at=now()
          WHERE id=$1 AND status='active'`,
        [id, verdict.reason, verdict.finalChainHash]
      );
    }

    const { rows: after } = await pool.query('SELECT * FROM game_sessions WHERE id = $1', [id]);
    res.json({
      status: verdict.status,
      reason: verdict.reason,
      chainHash: verdict.finalChainHash,
      score: verdict.score,
      steps: verdict.steps,
      session: shapeSession(after[0]),
    });
  } catch (err) {
    console.error('[dapp] finish failed:', err.message);
    res.status(500).json({ error: 'Failed to finish session' });
  }
});

// POST /api/dapp/sessions/:id/anchor/confirm { txHash, mock? }
// Records the on-chain anchor tx (or a mock marker when the bridge/wallet is
// unavailable). Never blocks settlement — best-effort.
app.post('/api/dapp/sessions/:id/anchor/confirm', async (req, res) => {
  const { id } = req.params;
  const txHash = typeof req.body.txHash === 'string' ? req.body.txHash : null;
  const mock = !!req.body.mock || IS_STAGING || !txHash;
  try {
    const { rows } = await pool.query('SELECT * FROM game_sessions WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Session not found' });
    if (rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'Not your session' });
    if (rows[0].status !== 'verified') return res.status(409).json({ error: 'Only verified sessions can be anchored' });
    await pool.query(
      `UPDATE game_sessions SET anchor_status=$2, anchor_tx_hash=$3 WHERE id=$1`,
      [id, mock ? 'mock' : 'anchored', txHash]
    );
    const { rows: after } = await pool.query('SELECT * FROM game_sessions WHERE id = $1', [id]);
    res.json({ ok: true, session: shapeSession(after[0]) });
  } catch (err) {
    console.error('[dapp] anchor confirm failed:', err.message);
    res.status(500).json({ error: 'Failed to record anchor' });
  }
});

// GET /api/dapp/sessions/:id — session receipt for the audit view.
app.get('/api/dapp/sessions/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query('SELECT * FROM game_sessions WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Session not found' });
    const { rows: stateRows } = await pool.query(
      `SELECT sequence, move, state_hash, prev_hash, chain_hash, ts_client
         FROM session_states WHERE session_id = $1 ORDER BY sequence ASC LIMIT 200`,
      [id]
    );
    res.json({
      session: shapeSession(rows[0]),
      ledger: stateRows.map(r => ({
        sequence: r.sequence, move: r.move,
        stateHash: r.state_hash, prevHash: r.prev_hash, chainHash: r.chain_hash, tsClient: r.ts_client,
      })),
    });
  } catch (err) {
    console.error('[dapp] get session failed:', err.message);
    res.status(500).json({ error: 'Failed to load session' });
  }
});

// GET /api/dapp/leaderboard/:gameId — verified-session leaderboard (Phase 0:
// powers the "Verified" filter; ranked by score desc, then time asc).
app.get('/api/dapp/leaderboard/:gameId', async (req, res) => {
  const { gameId } = req.params;
  if (!ALL_GAME_IDS.has(gameId)) return res.status(400).json({ error: 'Unknown game' });
  try {
    const { rows } = await pool.query(
      `SELECT id, username, usernode_pubkey, final_score, final_time_secs, final_chain_hash, anchor_status
         FROM game_sessions
        WHERE game_id = $1 AND status = 'verified' AND final_score IS NOT NULL
        ORDER BY final_score DESC, final_time_secs ASC NULLS LAST, finished_at ASC
        LIMIT 20`,
      [gameId]
    );
    res.json({
      entries: rows.map((r, i) => ({
        rank: i + 1,
        sessionId: r.id,
        username: r.username,
        score: r.final_score,
        timeSecs: r.final_time_secs,
        chainHash: r.final_chain_hash,
        anchored: r.anchor_status === 'anchored' || r.anchor_status === 'mock',
        verified: true,
      })),
    });
  } catch (err) {
    console.error('[dapp] leaderboard failed:', err.message);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

/* NOTE: every real route MUST be registered above the app.get('*') catch-all
   below. The Match-3 API used to sit AFTER it, so `/api/match3/progress`
   returned index.html instead of JSON and the campaign screen was stuck on
   "Loading..." forever — the game was unreachable, not merely unstyled. Found
   while giving Match 3 its design-system pass (phase 8); moved up here. */

// ---- Match-3 Campaign API (/api/match3/*) --------------------------------

app.get('/api/match3/progress', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const { rows: progress } = await pool.query(
      'SELECT * FROM match3_progress WHERE user_id = $1',
      [req.user.id]
    );

    const userProgress = progress[0] || {
      user_id: req.user.id,
      username: req.user.username,
      highest_puzzle: 0,
      best_score: 0,
      total_puzzles_completed: 0,
      last_played_puzzle: 1,
    };

    // Global leaderboard
    const { rows: global } = await pool.query(
      `SELECT user_id, username, highest_puzzle, best_score,
              ROW_NUMBER() OVER (ORDER BY highest_puzzle DESC, best_score DESC, updated_at ASC) AS rank
         FROM match3_progress
        ORDER BY highest_puzzle DESC, best_score DESC, updated_at ASC
        LIMIT 25`
    );

    const meRank = await pool.query(
      `SELECT COUNT(*) + 1 AS rank FROM match3_progress
        WHERE highest_puzzle > $1 OR (highest_puzzle = $1 AND best_score > $2)
           OR (highest_puzzle = $1 AND best_score = $2 AND updated_at < $3)`,
      [userProgress.highest_puzzle, userProgress.best_score, userProgress.updated_at]
    );

    const leaderboard = {
      global: global.map(r => ({
        rank: Number(r.rank),
        username: r.username || 'anon',
        highestPuzzle: r.highest_puzzle,
        bestScore: r.best_score,
      })),
      me: {
        rank: Number(meRank.rows[0]?.rank || 1),
        username: userProgress.username || req.user.username || 'you',
        highestPuzzle: userProgress.highest_puzzle,
        bestScore: userProgress.best_score,
      },
    };

    res.json({
      highestPuzzle: userProgress.highest_puzzle,
      bestScore: userProgress.best_score,
      totalCompleted: userProgress.total_puzzles_completed,
      lastPlayedPuzzle: userProgress.last_played_puzzle,
      leaderboard,
    });
  } catch (err) {
    console.error('[match3] progress failed:', err.message);
    res.status(500).json({ error: 'Failed to load progress' });
  }
});

app.post('/api/match3/start/:puzzleId', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  const puzzleId = Number(req.params.puzzleId);
  const puzzle = MATCH3_PUZZLES.find(p => p.id === puzzleId);
  if (!puzzle) return res.status(400).json({ error: 'Unknown puzzle' });

  // Recently Played tracking (Recent goal): opening a puzzle is the play.
  recordGamePlay(req.user.id, req.user.username, 'match3');
  try {
    const { rows: session } = await pool.query(
      'SELECT * FROM match3_session WHERE user_id = $1',
      [req.user.id]
    );

    const boardSeed = puzzleId * 73 + 17; // deterministic seed per puzzle
    const savedSession = session.length > 0 && session[0].current_puzzle === puzzleId
      ? {
          tiles: session[0].tiles,
          bar: session[0].bar,
          score: session[0].score,
          moves: session[0].moves,
          elapsedSecs: session[0].elapsed_secs,
        }
      : null;

    res.json({
      puzzleId: puzzle.id,
      name: puzzle.name,
      targetScore: puzzle.target,
      timeLimit: puzzle.timeLimit,
      moveLimit: puzzle.moveLimit,
      layers: puzzle.layers,
      difficulty: puzzle.difficulty,
      boardSeed,
      savedSession,
    });
  } catch (err) {
    console.error('[match3] start failed:', err.message);
    res.status(500).json({ error: 'Failed to start puzzle' });
  }
});

app.post('/api/match3/finish/:puzzleId', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  const puzzleId = Number(req.params.puzzleId);
  const { score, timeSecs, moves } = req.body;

  if (!Number.isFinite(score) || !Number.isFinite(timeSecs) || !Number.isFinite(moves)) {
    return res.status(400).json({ error: 'Invalid score/time/moves' });
  }

  const puzzle = MATCH3_PUZZLES.find(p => p.id === puzzleId);
  if (!puzzle) return res.status(400).json({ error: 'Unknown puzzle' });

  try {
    // Update progress if this is a new completion
    if (score > 0) {
      const { rows: existing } = await pool.query(
        'SELECT highest_puzzle FROM match3_progress WHERE user_id = $1',
        [req.user.id]
      );

      const currentHighest = existing.length > 0 ? existing[0].highest_puzzle : 0;
      const newHighest = Math.max(currentHighest, puzzleId);
      const nextUnlocked = newHighest === puzzleId ? puzzleId + 1 : newHighest;
      // EXCLUDED.highest_puzzle in the UPDATE below is just $3 (the value being
      // inserted), so comparing it against $3 is always false — decide "is this
      // a newly-completed puzzle" here in JS against the pre-write row instead.
      const isNewCompletion = puzzleId > currentHighest;

      await pool.query(`
        INSERT INTO match3_progress (user_id, username, highest_puzzle, best_score, total_puzzles_completed, last_played_puzzle, updated_at)
        VALUES ($1, $2, $3, $4, 1, $5, now())
        ON CONFLICT (user_id) DO UPDATE SET
          highest_puzzle = GREATEST(match3_progress.highest_puzzle, $3),
          best_score = GREATEST(match3_progress.best_score, $4),
          total_puzzles_completed = total_puzzles_completed + (CASE WHEN $6 THEN 1 ELSE 0 END),
          last_played_puzzle = $5,
          updated_at = now()
      `, [req.user.id, req.user.username || 'anon', newHighest, score, puzzleId + 1, isNewCompletion]);

      // Update per-puzzle best score
      await pool.query(`
        INSERT INTO match3_scores (user_id, puzzle_id, best_score, best_time_secs, moves_used, completed_at)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (user_id, puzzle_id) DO UPDATE SET
          best_score = GREATEST(match3_scores.best_score, $3),
          best_time_secs = LEAST(COALESCE(match3_scores.best_time_secs, 9999), $4),
          moves_used = LEAST(COALESCE(match3_scores.moves_used, 9999), $5),
          completed_at = now()
      `, [req.user.id, puzzleId, score, timeSecs, moves]);

      // Clear the session
      await pool.query('DELETE FROM match3_session WHERE user_id = $1', [req.user.id]);

      res.json({
        unlocked: nextUnlocked,
        newHighestPuzzle: newHighest,
        bestScoreOnThisPuzzle: score,
      });
    } else {
      // Score <= 0, no progression
      res.status(400).json({ error: 'Score must be > 0 to progress' });
    }
  } catch (err) {
    console.error('[match3] finish failed:', err.message);
    res.status(500).json({ error: 'Failed to save score' });
  }
});

app.post('/api/match3/autosave/:puzzleId', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  const puzzleId = Number(req.params.puzzleId);
  const { tiles, bar, score, moves, elapsedSecs } = req.body;

  if (!tiles || !Array.isArray(bar)) {
    return res.status(400).json({ error: 'Invalid session state' });
  }

  try {
    const boardSeed = puzzleId * 73 + 17;
    await pool.query(`
      INSERT INTO match3_session (user_id, current_puzzle, tiles, bar, score, moves, elapsed_secs, board_seed, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
      ON CONFLICT (user_id) DO UPDATE SET
        current_puzzle = $2,
        tiles = $3,
        bar = $4,
        score = $5,
        moves = $6,
        elapsed_secs = $7,
        updated_at = now()
    `, [req.user.id, puzzleId, JSON.stringify(tiles), JSON.stringify(bar), score, moves, elapsedSecs, boardSeed]);

    res.json({ ok: true });
  } catch (err) {
    console.error('[match3] autosave failed:', err.message);
    res.status(500).json({ error: 'Failed to save progress' });
  }
});

app.post('/api/match3/abandon/:puzzleId', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });

  try {
    await pool.query('DELETE FROM match3_session WHERE user_id = $1', [req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[match3] abandon failed:', err.message);
    res.status(500).json({ error: 'Failed to abandon puzzle' });
  }
});

app.get('/api/match3/leaderboard', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const { rows: global } = await pool.query(
      `SELECT user_id, username, highest_puzzle, best_score,
              ROW_NUMBER() OVER (ORDER BY highest_puzzle DESC, best_score DESC, updated_at ASC) AS rank
         FROM match3_progress
        ORDER BY highest_puzzle DESC, best_score DESC, updated_at ASC
        LIMIT 25`
    );

    const meRow = await pool.query(
      `SELECT * FROM match3_progress WHERE user_id = $1`,
      [req.user.id]
    );

    let me = null;
    if (meRow.rows.length > 0) {
      const r = meRow.rows[0];
      const rankRow = await pool.query(
        `SELECT COUNT(*) + 1 AS rank FROM match3_progress
          WHERE highest_puzzle > $1 OR (highest_puzzle = $1 AND best_score > $2)
             OR (highest_puzzle = $1 AND best_score = $2 AND updated_at < $3)`,
        [r.highest_puzzle, r.best_score, r.updated_at]
      );
      me = {
        rank: Number(rankRow.rows[0].rank),
        username: r.username || 'you',
        highestPuzzle: r.highest_puzzle,
        bestScore: r.best_score,
      };
    }

    res.json({
      global: global.map(r => ({
        rank: Number(r.rank),
        username: r.username || 'anon',
        highestPuzzle: r.highest_puzzle,
        bestScore: r.best_score,
      })),
      me,
    });
  } catch (err) {
    console.error('[match3] leaderboard failed:', err.message);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});


// landing page so stray visits to the staging URL don't reveal the app.
app.get('*', (req, res) => {
  if (!req.user) {
    return res.status(401).send(`<!doctype html><meta charset=utf-8><title>Open in Usernode</title>
<body style="font-family:system-ui;background:#09090b;color:#e4e4e7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="max-width:24rem;padding:2rem;text-align:center">
    <h1 style="font-size:1.25rem;margin:0 0 0.5rem">Open this app inside Usernode</h1>
    <p style="color:#a1a1aa;font-size:0.9rem;margin:0 0 1.25rem">This page is served via the platform; direct visits aren't authenticated.</p>
    <a href="${PLATFORM_ORIGIN}" style="display:inline-block;padding:0.5rem 1rem;background:#7c3aed;color:white;border-radius:0.5rem;text-decoration:none;font-size:0.9rem">Go to Usernode</a>
  </div>
</body>`);
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
// Fail fast if the DApp hash/replay contract regresses (cross-runtime
// determinism is the framework's highest-risk dependency).
try {
  dapp.selfTest();
  console.log('[dapp] verification self-test passed');
} catch (e) {
  console.error('[dapp] verification self-test FAILED:', e.message);
}
try {
  boardRules.selfTest();
  console.log('[board-rules] rules-registry self-test passed');
} catch (e) {
  console.error('[board-rules] rules-registry self-test FAILED:', e.message);
}

// Global last-resort handlers so a stray rejection/throw during boot or at
// runtime logs a clear, greppable line before the process exits, instead of
// dying silently (which looks identical to a hang from the outside).
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandledRejection:', reason && reason.stack ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaughtException:', err && err.stack ? err.stack : err);
  process.exit(1);
});

// Boot order: bind the port FIRST so /health responds immediately, THEN run
// migrations. Decoupling listen() from migrate() means a transient DB issue at
// boot no longer produces a hard 502 — the container stays up and answers the
// healthcheck while the DB recovers, and DB-backed routes return their own 500s
// (caught per-route) until the migration succeeds.
app.listen(port, () => console.log(`Listening on :${port}`));

// Run the idempotent schema migration, retrying with capped exponential
// backoff instead of exiting on the first failure. A stalled/unreachable DB
// (the #1 historical cause of the production 502) now keeps the container up
// and routable, logging a loud, greppable line per attempt so the failure is
// diagnosable, until the DB recovers and the migration completes.
async function runMigrations() {
  const backoffMs = [1000, 2000, 5000, 10000, 15000, 30000];
  for (let attempt = 0; ; attempt++) {
    try {
      await migrate();
      migrationsReady = true;
      console.log('[migrate] schema ready');
      return;
    } catch (err) {
      const wait = backoffMs[Math.min(attempt, backoffMs.length - 1)];
      console.error(`[migrate] attempt ${attempt + 1} failed — retrying in ${wait}ms:`, err.message);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

runMigrations();
