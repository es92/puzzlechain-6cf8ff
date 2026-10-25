// ============================================================
// DApp Mode — game-agnostic verification framework (Phase 0)
//
// Pure, DB-free core: deterministic canonical hashing, the
// append-only hash-chain ledger primitives, the server-side game
// engine registry (initialState/applyMove/isTerminal/score), the
// generalized anti-cheat checks, and the validateSession pipeline.
//
// server.js requires this module, loads/persists rows, and calls
// these pure functions. The SAME canonicalize + sha256 + tile engine
// is mirrored byte-for-byte in public/src/ so a chain hash the
// client computes equals the one the server recomputes on finish.
// ============================================================

const crypto = require('crypto');

// ---- Deterministic canonical serialization --------------------------------
// Stable key-sorted JSON with no incidental whitespace. Floats are BANNED in
// hashed state (cross-runtime float formatting is not guaranteed identical) —
// quantize to integers/strings before hashing.
function canonicalize(value) {
  if (value === null || value === undefined) return 'null';
  const t = typeof value;
  if (t === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite number in hashed state');
    if (!Number.isInteger(value)) throw new Error('float in hashed state: ' + value);
    return String(value);
  }
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  if (t === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
  }
  throw new Error('unhashable type: ' + t);
}

function sha256Hex(str) {
  return crypto.createHash('sha256').update(String(str), 'utf8').digest('hex');
}

// ---- Hash-chain primitives -------------------------------------------------
// genesis prevChainHash binds the chain to identity + game + seed + session.
function genesisHash({ gameId, seed, pubkey, sessionId }) {
  return sha256Hex([gameId, String(seed), pubkey || '', sessionId].join('|'));
}

// chainHash[n] = sha256(prevChainHash || stateHash[n] || sequence[n])
function chainStep(prevChainHash, stateHashHex, sequence) {
  return sha256Hex(prevChainHash + '|' + stateHashHex + '|' + String(sequence));
}

// ---- Tile-match board generation (mirrors client mulberry32 + generateLevel)
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function tileBoard(cfg, seed) {
  const rng = mulberry32(seed);
  const { tileTypes, setsPerType, boardCols, boardRows, maxLayer } = cfg;
  const typeList = [];
  for (let t = 0; t < tileTypes; t++) {
    for (let s = 0; s < setsPerType; s++) typeList.push(t, t, t);
  }
  for (let i = typeList.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [typeList[i], typeList[j]] = [typeList[j], typeList[i]];
  }
  const tiles = [];
  let idx = 0, tileId = 0;
  for (let layer = 0; layer <= maxLayer && idx < typeList.length; layer++) {
    const cols = boardCols - layer, rows = boardRows - layer;
    if (cols <= 0 || rows <= 0) break;
    for (let r = 0; r < rows && idx < typeList.length; r++) {
      for (let c = 0; c < cols && idx < typeList.length; c++) {
        tiles.push({ id: tileId++, type: typeList[idx++] });
      }
    }
  }
  return tiles;
}

// MUST mirror the client's daily tile budget (TM_DAILY_TYPES / TM_DAILY_SETS in
// public/src/). The engine models only the TRAY — it needs the right type
// count and total, not the geometry — so the client is free to reshape layouts
// without touching this, but changing the type/set counts here and there must
// happen in the same commit or every finish fails validMoveType/isTerminal and
// settles as `disputed`.
// 12 types × 2 triples × 3 tiles = 72, the same total as the old 8 × 3.
const TM_CONFIG = { tileTypes: 12, setsPerType: 2, boardCols: 8, boardRows: 5, maxLayer: 3 };
const BAR_CAPACITY = 7; // overflow ⇒ illegal / loss

// Daily Tile Match scoring CEILING (mirrored by tmDailyScore in public/src/).
// The engine can't see wall-clock time, so it returns the best score reachable
// for the observed tap count — a run with zero elapsed time and every booster
// unspent. The client's own formula only ever SUBTRACTS from this (time penalty,
// boosters spent), so claimed <= recomputed always holds and validateSession's
// `score_too_high` check never fires on an honest run.
const TM_DAILY_BASE = 600;
const TM_DAILY_BOOSTER_BONUS = 40;   // per unused booster; 6 are available
const TM_DAILY_BOOSTERS_TOTAL = 6;   // undo 3 + shuffle 2 + clear 1
const TM_DAILY_MOVE_PENALTY = 4;     // per tap above the 72-tap minimum
const TM_DAILY_PAR_BONUS = 300;      // max under-par time bonus
const TM_DAILY_MIN_SCORE = 100;

function tmDailyCeiling(taps, total) {
  const over = Math.max(0, taps - total);
  return Math.max(
    TM_DAILY_MIN_SCORE,
    TM_DAILY_BASE + TM_DAILY_PAR_BONUS
      + TM_DAILY_BOOSTER_BONUS * TM_DAILY_BOOSTERS_TOTAL
      - TM_DAILY_MOVE_PENALTY * over
  );
}

// ---- Game engine registry --------------------------------------------------
// Each engine: { validationTier, initialState, applyMove, isTerminal, score,
//                hashState, validMoveType }.
//
// The HASHED state is intentionally minimal — { bar, cleared, taps } — so the
// client and server hash identical bytes without depending on identical board
// generation. The full board (validTypes) lives only on the server-side state
// and is used by anti-cheat to reject tile types that don't exist on the board.

function makeTileEngine({ tier, scoreFn }) {
  return {
    validationTier: tier,
    initialState(seed) {
      const tiles = tileBoard(TM_CONFIG, Number(seed) | 0);
      const validTypes = new Set(tiles.map(t => t.type));
      return { bar: [], cleared: 0, taps: 0, total: tiles.length, validTypes };
    },
    // move: { tileType:int }. Throws on a structurally-illegal move.
    applyMove(state, move) {
      const tileType = move && Number.isInteger(move.tileType) ? move.tileType : null;
      if (tileType === null) throw new Error('move missing integer tileType');
      const bar = state.bar.slice();
      bar.push(tileType);
      let cleared = state.cleared;
      // Clear a triple of the same type if present.
      const counts = {};
      for (const ty of bar) counts[ty] = (counts[ty] || 0) + 1;
      const tripleType = Object.keys(counts).find(k => counts[k] >= 3);
      let nextBar = bar;
      if (tripleType !== undefined) {
        let removed = 0;
        nextBar = bar.filter(ty => {
          if (String(ty) === String(tripleType) && removed < 3) { removed++; return false; }
          return true;
        });
        cleared += 3;
      }
      if (nextBar.length > BAR_CAPACITY) throw new Error('bar overflow');
      return { ...state, bar: nextBar, cleared, taps: state.taps + 1 };
    },
    isTerminal(state) { return state.cleared >= state.total; },
    // Only the three integer fields are hashed (client mirrors this exactly).
    hashState(state) {
      return sha256Hex(canonicalize({ bar: state.bar, cleared: state.cleared, taps: state.taps }));
    },
    validMoveType(state, tileType) { return state.validTypes.has(tileType); },
    score: scoreFn,
  };
}

const gameEngines = {
  // Daily Tile Match — a full clear scores; the value returned is the CEILING
  // the client's time/booster-aware formula sits under (see tmDailyCeiling).
  tilematchingdaily: makeTileEngine({
    tier: 'A',
    scoreFn(state) {
      return {
        score: state.cleared >= state.total ? tmDailyCeiling(state.taps, state.total) : 0,
        steps: state.taps, cleared: state.cleared, total: state.total,
      };
    },
  }),
  // PvP Tile Match — score scales with tiles cleared and pace.
  tilematch_pvp: makeTileEngine({
    tier: 'A',
    scoreFn(state) {
      return { score: state.cleared * 10, steps: state.taps, cleared: state.cleared, total: state.total };
    },
  }),
};

function getEngine(gameId) { return gameEngines[gameId] || null; }

// ---- Generalized anti-cheat (generalizes the PvP timing/board checks) ------
// thresholds default to the PvP values; per-call overridable.
function antiCheat(entries, session, engine, opts = {}) {
  const fastIntervalMs   = opts.fastIntervalMs   != null ? opts.fastIntervalMs   : 250;
  const fastRatioLimit   = opts.fastRatioLimit   != null ? opts.fastRatioLimit   : 0.15;
  const maxMovesPerSec   = opts.maxMovesPerSec   != null ? opts.maxMovesPerSec   : 3.0;
  const driftMs          = opts.driftMs          != null ? opts.driftMs          : 15000;
  const matchDurationMs  = opts.matchDurationMs  != null ? opts.matchDurationMs  : null;

  // Board-reconstruction validity: every move's tileType must exist on this board.
  if (engine && typeof engine.validMoveType === 'function' && session && session.seed != null) {
    const init = engine.initialState(session.seed);
    let invalid = 0;
    for (const e of entries) {
      const ty = e.move && Number.isInteger(e.move.tileType) ? e.move.tileType : null;
      if (ty !== null && !engine.validMoveType(init, ty)) invalid++;
    }
    if (invalid > 0) return { ok: false, reason: `invalid_tile_types:${invalid}` };
  }

  // Timing analysis over client timestamps.
  const times = entries
    .map(e => (e.tsClient != null ? new Date(e.tsClient).getTime() : null))
    .filter(v => Number.isFinite(v))
    .sort((a, b) => a - b);

  if (times.length >= 2) {
    const intervals = [];
    for (let i = 1; i < times.length; i++) intervals.push(times[i] - times[i - 1]);
    const fast = intervals.filter(iv => iv < fastIntervalMs).length;
    if (fast / intervals.length > fastRatioLimit) return { ok: false, reason: 'too_many_fast_intervals' };

    const spanMs = times[times.length - 1] - times[0];
    if (spanMs > 0 && (times.length / (spanMs / 1000)) > maxMovesPerSec) {
      return { ok: false, reason: 'aggregate_rate_too_high' };
    }
    if (matchDurationMs != null && spanMs > matchDurationMs + driftMs) {
      return { ok: false, reason: 'timestamp_drift' };
    }
  }

  return { ok: true };
}

// ---- The validation pipeline ----------------------------------------------
// Pure: caller supplies the loaded session row, the ordered ledger entries, and
// the claimed result. Returns a verdict; never touches the DB.
//
//   session: { id, game_id, seed, usernode_pubkey }
//   entries: [{ sequence, move, stateHash?, prevHash?, chainHash?, tsClient? }]
//   claimed: { score, steps, chainHash }
//
// Returns { status: 'verified'|'disputed', finalChainHash, score, steps, reason }
function validateSession(session, entries, claimed, opts = {}) {
  const engine = getEngine(session.game_id);
  if (!engine) return { status: 'disputed', reason: 'unsupported_game', finalChainHash: null };

  const ordered = entries.slice().sort((a, b) => a.sequence - b.sequence);

  // 1. monotonic strictly-increasing sequence
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].sequence <= ordered[i - 1].sequence) {
      return { status: 'disputed', reason: 'non_monotonic_sequence', finalChainHash: null };
    }
  }

  // 2. replay + recompute the hash chain
  let state = engine.initialState(session.seed);
  let prevChain = genesisHash({
    gameId: session.game_id, seed: session.seed,
    pubkey: session.usernode_pubkey, sessionId: session.id,
  });

  for (const e of ordered) {
    try {
      state = engine.applyMove(state, e.move);
    } catch (err) {
      return { status: 'disputed', reason: 'illegal_move:' + err.message, finalChainHash: null };
    }
    const sh = engine.hashState(state);
    if (e.stateHash && e.stateHash !== sh) {
      return { status: 'disputed', reason: 'state_hash_mismatch', finalChainHash: null };
    }
    if (e.prevHash && e.prevHash !== prevChain) {
      return { status: 'disputed', reason: 'broken_chain_link', finalChainHash: null };
    }
    const expectedChain = chainStep(prevChain, sh, e.sequence);
    if (e.chainHash && e.chainHash !== expectedChain) {
      return { status: 'disputed', reason: 'chain_hash_mismatch', finalChainHash: null };
    }
    prevChain = expectedChain;
  }

  const finalChainHash = prevChain;

  // 3. final chain hash must match what the client claims it anchored
  if (claimed && claimed.chainHash && claimed.chainHash !== finalChainHash) {
    return { status: 'disputed', reason: 'final_chain_hash_mismatch', finalChainHash };
  }

  // 4. score / steps must agree with the engine's deterministic recompute
  const recomputed = engine.score(state);
  if (claimed && Number.isInteger(claimed.steps) && claimed.steps !== recomputed.steps) {
    return { status: 'disputed', reason: 'steps_mismatch', finalChainHash };
  }
  if (claimed && Number.isInteger(claimed.score) && claimed.score > recomputed.score) {
    // Client may claim less (e.g. forfeit) but never MORE than the engine allows.
    return { status: 'disputed', reason: 'score_too_high', finalChainHash };
  }

  // 5. generalized anti-cheat
  const ac = antiCheat(ordered, session, engine, opts.antiCheat || {});
  if (!ac.ok) return { status: 'disputed', reason: 'anti_cheat:' + ac.reason, finalChainHash };

  return {
    status: 'verified',
    finalChainHash,
    score: recomputed.score,
    steps: recomputed.steps,
    reason: null,
  };
}

// Build a full, valid ledger from an ordered list of moves (server-side helper,
// used by seeds and by routes that receive raw telemetry rather than entries).
function buildLedger(session, moves) {
  const engine = getEngine(session.game_id);
  if (!engine) throw new Error('unsupported_game');
  let state = engine.initialState(session.seed);
  let prevChain = genesisHash({
    gameId: session.game_id, seed: session.seed,
    pubkey: session.usernode_pubkey, sessionId: session.id,
  });
  const entries = [];
  let seq = 1;
  for (const m of moves) {
    state = engine.applyMove(state, m);
    const stateHash = engine.hashState(state);
    const chainHash = chainStep(prevChain, stateHash, seq);
    entries.push({
      sequence: seq, move: m, stateHash, prevHash: prevChain, chainHash,
      tsClient: m.tsClient != null ? m.tsClient : null,
    });
    prevChain = chainHash;
    seq++;
  }
  const recomputed = engine.score(state);
  return { entries, finalChainHash: prevChain, score: recomputed, state };
}

// Boot self-test: proves cross-runtime determinism contract holds locally and
// that a clean run verifies while a tampered chain is rejected. Throws on regression.
function selfTest() {
  const known = canonicalize({ b: 2, a: 1, list: [3, 2, 1] });
  if (known !== '{"a":1,"b":2,"list":[3,2,1]}') throw new Error('canonicalize regression');
  const session = { id: 'selftest', game_id: 'tilematchingdaily', seed: 12345, usernode_pubkey: 'ut1demo' };
  const engine = getEngine('tilematchingdaily');
  const init = engine.initialState(session.seed);
  // Produce a valid clearing sequence: tap each tile type three times in a row.
  const moves = [];
  const types = Array.from(init.validTypes);
  // We can't fully clear without the real board layout here; just exercise a
  // few legal triples to prove the chain links + verify path.
  for (const ty of types.slice(0, 2)) for (let k = 0; k < 3; k++) moves.push({ tileType: ty, tsClient: 1000 + moves.length * 600 });
  const { entries, finalChainHash } = buildLedger(session, moves);
  const good = validateSession(session, entries, { chainHash: finalChainHash, steps: entries.length });
  if (good.status !== 'verified') throw new Error('selfTest: clean run not verified: ' + good.reason);
  const tampered = entries.map((e, i) => i === 1 ? { ...e, chainHash: 'deadbeef' } : e);
  const bad = validateSession(session, tampered, { chainHash: finalChainHash, steps: entries.length });
  if (bad.status !== 'disputed') throw new Error('selfTest: tampered chain not rejected');
  // The daily tile board must deal exactly 72 tiles over 12 types, matching the
  // client's TM_DAILY_TYPES/TM_DAILY_SETS. A mismatch here is what silently
  // turns every finish into `disputed`.
  const board = tileBoard(TM_CONFIG, 999);
  if (board.length !== 72) throw new Error('selfTest: tile board should hold 72 tiles, got ' + board.length);
  if (new Set(board.map(t => t.type)).size !== 12) throw new Error('selfTest: tile board should span 12 types');
  // Ceiling must be monotonically non-increasing in taps and never dip below
  // the floor, so an honest client score can always sit under it.
  let prev = Infinity;
  for (let taps = 72; taps <= 400; taps += 8) {
    const c = tmDailyCeiling(taps, 72);
    if (c > prev) throw new Error('selfTest: score ceiling rose with tap count');
    if (c < TM_DAILY_MIN_SCORE) throw new Error('selfTest: score ceiling fell below the floor');
    prev = c;
  }
  if (tmDailyCeiling(72, 72) !== TM_DAILY_BASE + TM_DAILY_PAR_BONUS + TM_DAILY_BOOSTER_BONUS * TM_DAILY_BOOSTERS_TOTAL) {
    throw new Error('selfTest: perfect-run ceiling changed unexpectedly');
  }
  return true;
}

module.exports = {
  canonicalize, sha256Hex, genesisHash, chainStep,
  TM_CONFIG, tileBoard, tmDailyCeiling,
  gameEngines, getEngine,
  antiCheat, validateSession, buildLedger, selfTest,
};
