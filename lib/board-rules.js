// ============================================================
// Turn-based board-game rules registry (Game Corner phase 5)
//
// Pure, DB-free rules modules for the server-authoritative online
// rooms (classic_rooms) — shaped like lib/dapp.js's gameEngines.
// server.js loads/persists room rows, checks turn ownership and the
// move_seq CAS, then calls these pure functions.
//
// Module contract:
//   players       — minimum seat count (2 for every module; ludo also
//                   declares maxPlayers: 4 and accepts initialState(n)).
//   initialState()             -> state POJO. MUST include currentPlayer
//                                 (1|2); the generic move endpoint reads it
//                                 for turn ownership.
//   applyMove(state, player, move) -> { state, gameOver, winner }
//                                 winner: '1' | '2' | 'draw' | null.
//                                 THROWS Error('...') on an illegal move —
//                                 the endpoint surfaces it as a 400.
//
// Dice games (Chutes & Ladders, Ludo) own their randomness server-side
// via crypto.randomInt — the client only ever asks to "roll".
// ============================================================

/* Cross-runtime randomness. Node gets crypto.randomInt; the browser gets an
   equivalent built on the Web Crypto API (rejection sampling, so the
   distribution is uniform — a naive % would bias low values). Same call shape
   either way, so the rules code below is runtime-agnostic. */
/* IIFE: in the browser this file is a CLASSIC script sharing one global scope
   with public/app.js, which declares its own CNL_LADDERS / CNL_CHUTES / ...
   for the Snakes & Ladders board. Without this wrapper those collide and the
   whole app fails to parse ("Identifier 'CNL_LADDERS' has already been
   declared"). Everything is published deliberately, via the footer. */
(function () {
const crypto = (typeof require === 'function')
  ? require('crypto')
  : {
      randomInt(min, max) {
        if (max === undefined) { max = min; min = 0; }
        const range = max - min;
        const g = (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
        if (!g || !g.getRandomValues) return min + Math.floor(Math.random() * range);
        // Reject values in the incomplete final bucket to stay uniform.
        const limit = Math.floor(0x100000000 / range) * range;
        const buf = new Uint32Array(1);
        for (let i = 0; i < 64; i++) {
          g.getRandomValues(buf);
          if (buf[0] < limit) return min + (buf[0] % range);
        }
        return min + (buf[0] % range);
      },
    };

// ---- Mancala (extracted from server.js inline rules) -----------------------
// Pits layout: [0..5] player-1 pits, [6] p1 store, [7..12] player-2 pits,
// [13] p2 store. Exported standalone too: the Mancala routes (own table),
// its bot AI, the ZK-verification replay, and the daily challenge all reuse
// these exact functions.

function srvMncOpposite(idx) { return 12 - idx; }

function srvMncDistribute(pits, pitIdx, player) {
  const p = pits.slice();
  const stones = p[pitIdx];
  p[pitIdx] = 0;
  const skipStore = player === 1 ? 13 : 6;
  const ownStore  = player === 1 ? 6  : 13;
  const ownMin    = player === 1 ? 0  : 7;
  const ownMax    = player === 1 ? 5  : 12;
  let cur = pitIdx;
  for (let i = 0; i < stones; i++) {
    do { cur = (cur + 1) % 14; } while (cur === skipStore);
    p[cur]++;
  }
  const lastIdx = cur;
  const extraTurn = lastIdx === ownStore;
  if (!extraTurn && lastIdx >= ownMin && lastIdx <= ownMax && p[lastIdx] === 1) {
    const opp = srvMncOpposite(lastIdx);
    if (p[opp] > 0) {
      p[ownStore] += p[opp] + 1;
      p[lastIdx]  = 0;
      p[opp]      = 0;
    }
  }
  return { pits: p, extraTurn };
}

function srvMncApplyMove(pits, pitIdx, player) {
  const { pits: p, extraTurn } = srvMncDistribute(pits, pitIdx, player);
  const p1Empty = p.slice(0, 6).every(v => v === 0);
  const p2Empty = p.slice(7, 13).every(v => v === 0);
  if (p1Empty || p2Empty) {
    for (let i = 0; i < 6;  i++) { p[6]  += p[i]; p[i] = 0; }
    for (let i = 7; i < 13; i++) { p[13] += p[i]; p[i] = 0; }
    const winner = p[6] > p[13] ? '1' : p[13] > p[6] ? '2' : 'draw';
    return { pits: p, extraTurn: false, gameOver: true, winner, nextPlayer: null };
  }
  return { pits: p, extraTurn, gameOver: false, winner: null, nextPlayer: extraTurn ? player : (player === 1 ? 2 : 1) };
}

// Registry-shaped mancala module (state carries pits + currentPlayer). The
// live Mancala routes still use their own mancala_rooms table/handlers; this
// wrapper exists so the game participates in the uniform registry contract.
const mancala = {
  players: 2,
  initialState() {
    return { pits: [4,4,4,4,4,4,0,4,4,4,4,4,4,0], currentPlayer: 1 };
  },
  applyMove(state, player, move) {
    const pitIdx = move && Number.isInteger(move.pitIdx) ? move.pitIdx : -1;
    const ownMin = player === 1 ? 0 : 7;
    const ownMax = player === 1 ? 5 : 12;
    if (pitIdx < ownMin || pitIdx > ownMax || !state.pits || state.pits[pitIdx] === 0) {
      throw new Error('Invalid pit selection');
    }
    const r = srvMncApplyMove(state.pits, pitIdx, player);
    return {
      state: { pits: r.pits, currentPlayer: r.gameOver ? player : r.nextPlayer },
      gameOver: r.gameOver,
      winner: r.winner,
    };
  },
};

// ---- Chutes & Ladders (extracted from server.js inline rules) ---------------
const CNL_LADDERS = { 1: 38, 4: 14, 9: 31, 21: 42, 28: 84, 36: 44, 51: 67, 71: 91, 80: 100 };
const CNL_CHUTES  = { 16: 6, 47: 26, 49: 11, 56: 53, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 78 };
const CNL_JUMPS   = Object.assign({}, CNL_LADDERS, CNL_CHUTES);

// ---- Moksha Patam (the original Indian board) -------------------------------
// Ladders sit on VIRTUES, snakes on VICES, and vices outnumber virtues 11 to 5 —
// that imbalance is the point the original was making, and it makes for a
// deliberately slower climb than the Milton-Bradley board. Square 100 is Moksha.
//
// The SQUARE NUMBERS follow the commonly published Moksha Patam virtue/vice
// list. The DESTINATIONS are designed for playability, not historical record —
// surviving boards disagree with each other, so treat these as this app's
// balance choice. Keep this table byte-identical to CNL_MOKSHA_* in
// public/src/; the client renders the same board the server referees.
//
// Note 98 (Lust) lands on 78, which is the Asceticism ladder foot. Jumps do NOT
// chain — applyMove resolves at most one — so that's a flavour touch, not a loop.
const CNL_MOKSHA_LADDERS = { 12: 38, 51: 67, 57: 74, 76: 91, 78: 97 };
const CNL_MOKSHA_CHUTES  = {
  41: 20, 44: 22, 49: 9, 52: 35, 58: 40, 62: 19, 69: 33, 84: 63, 92: 73, 95: 24, 98: 78,
};
const CNL_MOKSHA_JUMPS = Object.assign({}, CNL_MOKSHA_LADDERS, CNL_MOKSHA_CHUTES);

const CNL_VARIANTS = {
  classic: { ladders: CNL_LADDERS, chutes: CNL_CHUTES, jumps: CNL_JUMPS },
  moksha:  { ladders: CNL_MOKSHA_LADDERS, chutes: CNL_MOKSHA_CHUTES, jumps: CNL_MOKSHA_JUMPS },
};

function cnlVariant(v) { return CNL_VARIANTS[v] ? v : 'classic'; }

// Resolve a landing square through AT MOST ONE jump. Single-hop is the rule
// both boards rely on: Moksha's 98 (Lust) drops onto 78, which is the
// Asceticism ladder foot, and must stay there rather than climbing to 97.
function cnlResolve(jumps, landed) {
  return jumps[landed] !== undefined ? jumps[landed] : landed;
}

const chutesLadders = {
  players: 2,
  // `opts.variant` comes from the create-room body; anything unknown falls back
  // to the classic board, so a malformed request can never produce a room with
  // no jump table.
  initialState(opts) {
    return {
      p1Pos: 0, p2Pos: 0, currentPlayer: 1, die: null, rolls: 0,
      variant: cnlVariant(opts && opts.variant),
    };
  },
  // Server owns the die; the move payload is ignored (the client just asks
  // to roll).
  applyMove(state, player) {
    const die = crypto.randomInt(1, 7);
    const jumps = CNL_VARIANTS[cnlVariant(state && state.variant)].jumps;
    const fromKey = player === 1 ? 'p1Pos' : 'p2Pos';
    const from = state[fromKey] || 0;
    const next = { ...state, die, rolls: (state.rolls || 0) + 1, lastJump: null };
    let landed = from;
    if (from + die <= 100) {
      landed = from + die;
      if (jumps[landed] !== undefined) {
        next.lastJump = { from: landed, to: jumps[landed] };
        landed = jumps[landed];
      }
    }
    next[fromKey] = landed;
    const gameOver = landed === 100;
    next.currentPlayer = gameOver ? player : (player === 1 ? 2 : 1);
    return { state: next, gameOver, winner: gameOver ? String(player) : null };
  },
};

// ---- Checkers (8×8 draughts) ------------------------------------------------
// board: 64 ints — 0 empty, 1 p1 man, 2 p2 man, 3 p1 king, 4 p2 king.
// P1 starts on rows 0–2 moving DOWN; P2 on rows 5–7 moving UP; dark squares
// only ((r+c)%2===1). House rules: captures are NOT forced; after a capture
// the same piece may continue jumping (mustJumpFrom keeps the turn); a man
// promoting to king ends the jump chain. A player with no pieces or no legal
// move loses.
function ckOwner(v) { return v === 1 || v === 3 ? 1 : v === 2 || v === 4 ? 2 : 0; }
function ckIsKing(v) { return v === 3 || v === 4; }

function ckJumpsFrom(board, idx) {
  const v = board[idx];
  const owner = ckOwner(v);
  if (!owner) return [];
  const r = Math.floor(idx / 8), c = idx % 8;
  const dirs = ckIsKing(v) ? [[1,1],[1,-1],[-1,1],[-1,-1]]
    : owner === 1 ? [[1,1],[1,-1]] : [[-1,1],[-1,-1]];
  const out = [];
  for (const [dr, dc] of dirs) {
    const mr = r + dr, mc = c + dc, tr = r + 2 * dr, tc = c + 2 * dc;
    if (tr < 0 || tr > 7 || tc < 0 || tc > 7) continue;
    const mid = board[mr * 8 + mc], to = board[tr * 8 + tc];
    if (to === 0 && ckOwner(mid) && ckOwner(mid) !== owner) out.push(tr * 8 + tc);
  }
  return out;
}

function ckStepsFrom(board, idx) {
  const v = board[idx];
  const owner = ckOwner(v);
  if (!owner) return [];
  const r = Math.floor(idx / 8), c = idx % 8;
  const dirs = ckIsKing(v) ? [[1,1],[1,-1],[-1,1],[-1,-1]]
    : owner === 1 ? [[1,1],[1,-1]] : [[-1,1],[-1,-1]];
  const out = [];
  for (const [dr, dc] of dirs) {
    const tr = r + dr, tc = c + dc;
    if (tr < 0 || tr > 7 || tc < 0 || tc > 7) continue;
    if (board[tr * 8 + tc] === 0) out.push(tr * 8 + tc);
  }
  return out;
}

function ckHasAnyMove(board, player) {
  for (let i = 0; i < 64; i++) {
    if (ckOwner(board[i]) !== player) continue;
    if (ckStepsFrom(board, i).length || ckJumpsFrom(board, i).length) return true;
  }
  return false;
}

const checkers = {
  players: 2,
  initialState() {
    const board = new Array(64).fill(0);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) board[r * 8 + c] = 1;
    for (let r = 5; r < 8; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) board[r * 8 + c] = 2;
    return { board, currentPlayer: 1, mustJumpFrom: null, captured: { 1: 0, 2: 0 } };
  },
  applyMove(state, player, move) {
    const from = move && Number.isInteger(move.from) ? move.from : -1;
    const to = move && Number.isInteger(move.to) ? move.to : -1;
    if (from < 0 || from > 63 || to < 0 || to > 63) throw new Error('Move needs from/to cells');
    const board = state.board.slice();
    const v = board[from];
    if (ckOwner(v) !== player) throw new Error('Not your piece');
    if (board[to] !== 0) throw new Error('Destination occupied');
    const fr = Math.floor(from / 8), fc = from % 8, tr = Math.floor(to / 8), tc = to % 8;
    if ((tr + tc) % 2 !== 1) throw new Error('Dark squares only');
    if (state.mustJumpFrom != null && from !== state.mustJumpFrom) {
      throw new Error('You must continue jumping with the same piece');
    }
    const dr = tr - fr, dc = tc - fc;
    const isKing = ckIsKing(v);
    const fwdOk = isKing || (player === 1 ? dr > 0 : dr < 0);
    let didJump = false;
    if (Math.abs(dr) === 1 && Math.abs(dc) === 1) {
      if (state.mustJumpFrom != null) throw new Error('You must continue jumping');
      if (!fwdOk) throw new Error('Men can only move forward');
    } else if (Math.abs(dr) === 2 && Math.abs(dc) === 2) {
      if (!fwdOk) throw new Error('Men can only jump forward');
      const mid = (fr + tr) / 2 * 8 + (fc + tc) / 2;
      if (!ckOwner(board[mid]) || ckOwner(board[mid]) === player) throw new Error('Nothing to capture');
      board[mid] = 0;
      didJump = true;
    } else {
      throw new Error('Illegal checkers move');
    }
    board[from] = 0;
    // Promotion: reaching the far row makes a king (and ends a jump chain).
    let promoted = false;
    let nv = v;
    if (!isKing && ((player === 1 && tr === 7) || (player === 2 && tr === 0))) {
      nv = player === 1 ? 3 : 4;
      promoted = true;
    }
    board[to] = nv;

    const captured = { ...state.captured };
    if (didJump) captured[player] = (captured[player] || 0) + 1;

    const opp = player === 1 ? 2 : 1;
    const oppPieces = board.filter(x => ckOwner(x) === opp).length;
    if (oppPieces === 0 || !ckHasAnyMove(board, opp)) {
      return { state: { board, currentPlayer: player, mustJumpFrom: null, captured }, gameOver: true, winner: String(player) };
    }
    // Multi-jump: same piece keeps the turn while it can capture again.
    if (didJump && !promoted && ckJumpsFrom(board, to).length > 0) {
      return { state: { board, currentPlayer: player, mustJumpFrom: to, captured }, gameOver: false, winner: null };
    }
    return { state: { board, currentPlayer: opp, mustJumpFrom: null, captured }, gameOver: false, winner: null };
  },
};

// ---- Reversi (8×8 flipping discs) -------------------------------------------
// board: 64 ints — 0 empty, 1/2 discs. A move must flip ≥1 opposing disc.
// If the opponent has no legal reply the turn stays with the mover; when
// neither side can move the game ends on disc count.
const RV_DIRS = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];

function rvFlips(board, cell, player) {
  const r0 = Math.floor(cell / 8), c0 = cell % 8;
  const opp = player === 1 ? 2 : 1;
  const flips = [];
  for (const [dr, dc] of RV_DIRS) {
    const line = [];
    let r = r0 + dr, c = c0 + dc;
    while (r >= 0 && r < 8 && c >= 0 && c < 8 && board[r * 8 + c] === opp) {
      line.push(r * 8 + c);
      r += dr; c += dc;
    }
    if (line.length && r >= 0 && r < 8 && c >= 0 && c < 8 && board[r * 8 + c] === player) {
      flips.push(...line);
    }
  }
  return flips;
}

function rvHasMove(board, player) {
  for (let i = 0; i < 64; i++) {
    if (board[i] === 0 && rvFlips(board, i, player).length) return true;
  }
  return false;
}

const reversi = {
  players: 2,
  initialState() {
    const board = new Array(64).fill(0);
    board[3 * 8 + 4] = 1; board[4 * 8 + 3] = 1; // p1 (dark) — moves first
    board[3 * 8 + 3] = 2; board[4 * 8 + 4] = 2; // p2 (light)
    return { board, currentPlayer: 1, passed: false };
  },
  applyMove(state, player, move) {
    const cell = move && Number.isInteger(move.cell) ? move.cell : -1;
    if (cell < 0 || cell > 63) throw new Error('Move needs a cell');
    const board = state.board.slice();
    if (board[cell] !== 0) throw new Error('Cell is occupied');
    const flips = rvFlips(board, cell, player);
    if (!flips.length) throw new Error('Move must flip at least one disc');
    board[cell] = player;
    for (const f of flips) board[f] = player;

    const opp = player === 1 ? 2 : 1;
    let next = opp;
    if (!rvHasMove(board, opp)) {
      if (rvHasMove(board, player)) {
        next = player; // opponent passes automatically
      } else {
        const p1 = board.filter(x => x === 1).length;
        const p2 = board.filter(x => x === 2).length;
        const winner = p1 > p2 ? '1' : p2 > p1 ? '2' : 'draw';
        return { state: { board, currentPlayer: player, passed: false }, gameOver: true, winner };
      }
    }
    return { state: { board, currentPlayer: next, passed: next === player }, gameOver: false, winner: null };
  },
};

// ---- Four in a Row (7×6 drop discs) -----------------------------------------
// board: 42 ints row-major (row 0 = top), 0 empty / 1 / 2. Move { col }.
const FIR_COLS = 7, FIR_ROWS = 6;

function firWinsAt(board, idx, player) {
  const r0 = Math.floor(idx / FIR_COLS), c0 = idx % FIR_COLS;
  for (const [dr, dc] of [[0,1],[1,0],[1,1],[1,-1]]) {
    let n = 1;
    for (const s of [1, -1]) {
      let r = r0 + dr * s, c = c0 + dc * s;
      while (r >= 0 && r < FIR_ROWS && c >= 0 && c < FIR_COLS && board[r * FIR_COLS + c] === player) {
        n++; r += dr * s; c += dc * s;
      }
    }
    if (n >= 4) return true;
  }
  return false;
}

const fourinarow = {
  players: 2,
  initialState() {
    return { board: new Array(FIR_COLS * FIR_ROWS).fill(0), currentPlayer: 1, lastMove: null };
  },
  applyMove(state, player, move) {
    const col = move && Number.isInteger(move.col) ? move.col : -1;
    if (col < 0 || col >= FIR_COLS) throw new Error('Move needs a column');
    const board = state.board.slice();
    let row = -1;
    for (let r = FIR_ROWS - 1; r >= 0; r--) {
      if (board[r * FIR_COLS + col] === 0) { row = r; break; }
    }
    if (row === -1) throw new Error('Column is full');
    const idx = row * FIR_COLS + col;
    board[idx] = player;
    if (firWinsAt(board, idx, player)) {
      return { state: { board, currentPlayer: player, lastMove: idx }, gameOver: true, winner: String(player) };
    }
    if (board.every(x => x !== 0)) {
      return { state: { board, currentPlayer: player, lastMove: idx }, gameOver: true, winner: 'draw' };
    }
    return { state: { board, currentPlayer: player === 1 ? 2 : 1, lastMove: idx }, gameOver: false, winner: null };
  },
};

// ---- Gomoku (15×15 five in a row) --------------------------------------------
const GMK_N = 15;

function gmkWinsAt(board, idx, player) {
  const r0 = Math.floor(idx / GMK_N), c0 = idx % GMK_N;
  for (const [dr, dc] of [[0,1],[1,0],[1,1],[1,-1]]) {
    let n = 1;
    for (const s of [1, -1]) {
      let r = r0 + dr * s, c = c0 + dc * s;
      while (r >= 0 && r < GMK_N && c >= 0 && c < GMK_N && board[r * GMK_N + c] === player) {
        n++; r += dr * s; c += dc * s;
      }
    }
    if (n >= 5) return true;
  }
  return false;
}

const gomoku = {
  players: 2,
  initialState() {
    return { board: new Array(GMK_N * GMK_N).fill(0), currentPlayer: 1, lastMove: null };
  },
  applyMove(state, player, move) {
    const cell = move && Number.isInteger(move.cell) ? move.cell : -1;
    if (cell < 0 || cell >= GMK_N * GMK_N) throw new Error('Move needs a cell');
    const board = state.board.slice();
    if (board[cell] !== 0) throw new Error('Cell is occupied');
    board[cell] = player;
    if (gmkWinsAt(board, cell, player)) {
      return { state: { board, currentPlayer: player, lastMove: cell }, gameOver: true, winner: String(player) };
    }
    if (board.every(x => x !== 0)) {
      return { state: { board, currentPlayer: player, lastMove: cell }, gameOver: true, winner: 'draw' };
    }
    return { state: { board, currentPlayer: player === 1 ? 2 : 1, lastMove: cell }, gameOver: false, winner: null };
  },
};

// ---- Ludo (2–4 players, 4 tokens each) ----------------------------------------
// Token position is RELATIVE progress: -1 base · 0..50 on the 52-cell ring
// (absolute cell = (startOffset + pos) % 52) · 51..56 home column · 57 home.
// Two-phase turns: { type:'roll' } (server-owned die; if no token can use it
// the turn passes automatically) then { type:'move', token } — a 6 grants
// another roll. Landing on a rival's ring cell captures it back to base;
// the four start cells are safe. Exact roll needed to finish.
//
// Multi-seat (item 10 of the spec's change list): state carries
// { nPlayers, seats: { '1': [...], ... }, forfeited: [seat, ...] }. Legacy
// 2-player states ({ p1, p2 }) are normalized on the way in, and seats 1/2
// are always mirrored back onto p1/p2 so stale clients keep rendering.
const LUDO_START = { 1: 0, 2: 26, 3: 13, 4: 39 };
const LUDO_SAFE = new Set([0, 13, 26, 39]);
const LUDO_HOME = 57;

function ludoNormalize(state) {
  if (state && state.seats) {
    return { ...state, forfeited: Array.isArray(state.forfeited) ? state.forfeited.slice() : [] };
  }
  // Legacy 2P shape.
  return {
    ...state,
    nPlayers: 2,
    seats: { 1: (state.p1 || [-1, -1, -1, -1]).slice(), 2: (state.p2 || [-1, -1, -1, -1]).slice() },
    forfeited: [],
  };
}

// Mirror seats 1/2 back to p1/p2 for backward-compatible reads.
function ludoFinalize(state) {
  return { ...state, p1: state.seats[1], p2: state.seats[2] };
}

function ludoTokens(state, player) { return state.seats[player]; }

function ludoActiveSeats(state) {
  const out = [];
  for (let s = 1; s <= (state.nPlayers || 2); s++) {
    if (!state.forfeited.includes(s)) out.push(s);
  }
  return out;
}

function ludoNextSeat(state, from) {
  const n = state.nPlayers || 2;
  for (let k = 1; k <= n; k++) {
    const s = ((from - 1 + k) % n) + 1;
    if (!state.forfeited.includes(s)) return s;
  }
  return from;
}

function ludoLegalTokens(state, player, die) {
  const toks = ludoTokens(state, player);
  const out = [];
  for (let i = 0; i < 4; i++) {
    const pos = toks[i];
    if (pos === LUDO_HOME) continue;
    if (pos === -1) { if (die === 6) out.push(i); continue; }
    if (pos + die <= LUDO_HOME) out.push(i);
  }
  return out;
}

// Forfeit one seat (manual forfeit or turn-timer expiry). Their tokens leave
// the board; last remaining seat wins. Used by server.js's finish endpoint
// and the lazy expiry path for multi-seat rooms.
function ludoForfeitSeat(rawState, seat) {
  const state = ludoNormalize(rawState);
  if (!state.forfeited.includes(seat)) state.forfeited.push(seat);
  state.seats = { ...state.seats, [seat]: [-1, -1, -1, -1] };
  const active = ludoActiveSeats(state);
  if (active.length <= 1) {
    const winner = active.length === 1 ? String(active[0]) : null;
    state.currentPlayer = active[0] || state.currentPlayer;
    state.phase = 'roll';
    state.die = null;
    return { state: ludoFinalize(state), gameOver: true, winner };
  }
  if (Number(state.currentPlayer) === seat) {
    state.currentPlayer = ludoNextSeat(state, seat);
    state.phase = 'roll';
    state.die = null;
    state.lastEvent = null;
  }
  return { state: ludoFinalize(state), gameOver: false, winner: null };
}

const ludo = {
  players: 2,      // minimum; rooms may seat up to maxPlayers
  maxPlayers: 4,
  initialState(nPlayers = 2) {
    const n = Math.min(4, Math.max(2, Number(nPlayers) || 2));
    const seats = {};
    for (let s = 1; s <= n; s++) seats[s] = [-1, -1, -1, -1];
    return ludoFinalize({
      nPlayers: n, seats, forfeited: [],
      currentPlayer: 1, phase: 'roll', die: null, lastEvent: null,
    });
  },
  applyMove(rawState, player, move) {
    const state = ludoNormalize(rawState);
    const type = move && move.type;
    if (state.forfeited.includes(player)) throw new Error('You have forfeited this match');

    if (type === 'roll') {
      if (state.phase !== 'roll') throw new Error('Pick a token to move first');
      const die = crypto.randomInt(1, 7);
      const legal = ludoLegalTokens(state, player, die);
      if (legal.length === 0) {
        // Nothing can use this roll — show it, pass the turn.
        return {
          state: ludoFinalize({ ...state, die, phase: 'roll', currentPlayer: ludoNextSeat(state, player), lastEvent: 'no-move' }),
          gameOver: false, winner: null,
        };
      }
      return {
        state: ludoFinalize({ ...state, die, phase: 'move', lastEvent: null }),
        gameOver: false, winner: null,
      };
    }

    if (type === 'move') {
      if (state.phase !== 'move') throw new Error('Roll first');
      const die = state.die;
      const token = Number.isInteger(move.token) ? move.token : -1;
      if (token < 0 || token > 3) throw new Error('Move needs a token 0–3');
      if (!ludoLegalTokens(state, player, die).includes(token)) throw new Error('That token cannot use this roll');

      const mine = ludoTokens(state, player).slice();
      const seats = { ...state.seats, [player]: mine };
      const pos = mine[token];
      const newPos = pos === -1 ? 0 : pos + die;
      mine[token] = newPos;
      let lastEvent = null;

      // Capture on the shared ring (home columns are private, start cells safe).
      if (newPos <= 50) {
        const abs = (LUDO_START[player] + newPos) % 52;
        if (!LUDO_SAFE.has(abs)) {
          for (const rival of ludoActiveSeats(state)) {
            if (rival === player) continue;
            const theirs = seats[rival].slice();
            let hit = false;
            for (let i = 0; i < 4; i++) {
              const tp = theirs[i];
              if (tp >= 0 && tp <= 50 && (LUDO_START[rival] + tp) % 52 === abs) {
                theirs[i] = -1;
                hit = true;
                lastEvent = 'capture';
              }
            }
            if (hit) seats[rival] = theirs;
          }
        }
      }

      const next = { ...state, seats, die, lastEvent };
      if (mine.every(t => t === LUDO_HOME)) {
        next.phase = 'roll';
        next.currentPlayer = player;
        return { state: ludoFinalize(next), gameOver: true, winner: String(player) };
      }
      // A six earns another roll; otherwise the turn passes to the next seat.
      next.phase = 'roll';
      next.currentPlayer = die === 6 ? player : ludoNextSeat(next, player);
      return { state: ludoFinalize(next), gameOver: false, winner: null };
    }

    throw new Error('Move needs type roll or move');
  },
};

// ---- Registry ----------------------------------------------------------------
const boardRules = {
  mancala,
  'chutes-ladders': chutesLadders,
  checkers,
  reversi,
  fourinarow,
  gomoku,
  ludo,
};

function getRules(gameId) { return boardRules[gameId] || null; }

// Boot self-test: one legal opening + one illegal move per module proves the
// registry contract holds. Throws on regression.
function selfTest() {
  // Checkers: p1 opens 17→26 (r2c1 → r3c2).
  let ck = checkers.initialState();
  ck = checkers.applyMove(ck, 1, { from: 17, to: 26 }).state;
  let threw = false;
  try { checkers.applyMove(ck, 2, { from: 40, to: 26 }); } catch { threw = true; }
  if (!threw) throw new Error('checkers: occupied destination not rejected');
  // Reversi: p1's classic opening at (2,3)=19 flips (3,3)=27.
  let rv = reversi.initialState();
  const r1 = reversi.applyMove(rv, 1, { cell: 19 });
  if (r1.state.board[27] !== 1) throw new Error('reversi: flip failed');
  // Four in a Row: fill a column and overflow it.
  let f = fourinarow.initialState();
  for (let i = 0; i < 6; i++) f = fourinarow.applyMove(f, (i % 2) + 1, { col: 3 }).state;
  threw = false;
  try { fourinarow.applyMove(f, 1, { col: 3 }); } catch { threw = true; }
  if (!threw) throw new Error('fourinarow: full column not rejected');
  // Gomoku: five in a row wins.
  let g = gomoku.initialState();
  for (let i = 0; i < 4; i++) {
    g = gomoku.applyMove(g, 1, { cell: i }).state;
    g = gomoku.applyMove(g, 2, { cell: 15 + i }).state;
  }
  if (gomoku.applyMove(g, 1, { cell: 4 }).winner !== '1') throw new Error('gomoku: five-in-row not detected');
  // Ludo: roll then an illegal premature move phase.
  const l = ludo.initialState();
  threw = false;
  try { ludo.applyMove(l, 1, { type: 'move', token: 0 }); } catch { threw = true; }
  if (!threw) throw new Error('ludo: move before roll not rejected');
  // Ludo multi-seat: 4P init shape, legacy-state normalization, forfeit chain.
  const l4 = ludo.initialState(4);
  if (l4.nPlayers !== 4 || !l4.seats[4] || !Array.isArray(l4.p1)) throw new Error('ludo: 4P initialState malformed');
  const legacy = { p1: [-1, -1, -1, -1], p2: [0, -1, -1, -1], currentPlayer: 1, phase: 'roll', die: null };
  const norm = ludo.applyMove(legacy, 1, { type: 'roll' }).state;
  if (!norm.seats || norm.p2[0] !== 0) throw new Error('ludo: legacy state normalization failed');
  let ff = ludoForfeitSeat(l4, 2);
  if (ff.gameOver) throw new Error('ludo: early forfeit ended a 4P game');
  ff = ludoForfeitSeat(ff.state, 3);
  ff = ludoForfeitSeat(ff.state, 4);
  if (!ff.gameOver || ff.winner !== '1') throw new Error('ludo: last-seat-standing win not detected');
  // Chutes & Ladders board tables — both variants must be structurally sane,
  // or a jump could strand a pawn or loop it.
  for (const [name, v] of Object.entries(CNL_VARIANTS)) {
    for (const [headStr, dest] of Object.entries(v.jumps)) {
      const head = Number(headStr);
      if (head === dest) throw new Error(`${name}: square ${head} jumps to itself`);
      if (dest < 1 || dest > 100) throw new Error(`${name}: ${head} → ${dest} is off the board`);
      if (head === 100) throw new Error(`${name}: square 100 must not be a jump head`);
      // A destination MAY be another jump's head (Moksha's 98 → 78 is
      // deliberate); what must hold is that resolution stops after one hop.
      if (cnlResolve(v.jumps, head) !== dest) {
        throw new Error(`${name}: ${head} resolved past its single hop`);
      }
    }
    for (const [h, d] of Object.entries(v.ladders)) {
      if (d <= Number(h)) throw new Error(`${name}: ladder ${h} → ${d} does not ascend`);
    }
    for (const [h, d] of Object.entries(v.chutes)) {
      if (d >= Number(h)) throw new Error(`${name}: chute ${h} → ${d} does not descend`);
    }
  }
  // The variant actually reaches applyMove: a moksha room must never resolve a
  // jump using the classic table.
  const mk = chutesLadders.initialState({ variant: 'moksha' });
  if (mk.variant !== 'moksha') throw new Error('chutes: variant not stored on initial state');
  if (chutesLadders.initialState({ variant: 'bogus' }).variant !== 'classic') {
    throw new Error('chutes: unknown variant not coerced to classic');
  }
  // Lust (98) drops to the Asceticism ladder foot and STAYS there.
  if (cnlResolve(CNL_MOKSHA_JUMPS, 98) !== 78) throw new Error('moksha: 98 should resolve to 78');
  if (cnlResolve(CNL_MOKSHA_JUMPS, 12) !== 38) throw new Error('moksha: 12 should resolve to 38');
  return true;
}

/* ============================================================
   Phase 7 (#144) — DUAL MODE: Node require() AND browser <script>.

   The five board games (Checkers, Reversi, Four in a Row, Gomoku, Ludo) were
   online-only because the rules lived here, server-side, and public/src/ is a
   classic script that cannot require(). Adding local pass-and-play and Versus
   Bot could have meant reimplementing the rules client-side — which is exactly
   the drift the phase-5 design was built to avoid, and would guarantee that an
   offline game and an online game eventually disagree about a legal move.

   Instead this file is served to the browser verbatim (server.js exposes it at
   GET /board-rules.js; public/index.html loads it before the app bootstrap) and
   publishes the same API on `window.boardRules`. ONE source of truth, referee
   and client, forever.

   Everything above this footer stays pure and DB-free, which is what makes the
   trick safe: no require(), no process, no fs.
   ============================================================ */
const BOARD_RULES_API = {
  boardRules, getRules, selfTest,
  // Ludo multi-seat helper reused by server.js (forfeit endpoint + lazy expiry).
  ludoForfeitSeat,
  // Mancala internals reused by server.js (routes, bot AI, ZK replay, daily).
  srvMncOpposite, srvMncDistribute, srvMncApplyMove,
  // Chutes maps reused by anything that needs the board layout server-side.
  CNL_LADDERS, CNL_CHUTES, CNL_JUMPS,
  CNL_MOKSHA_LADDERS, CNL_MOKSHA_CHUTES, CNL_MOKSHA_JUMPS, CNL_VARIANTS,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BOARD_RULES_API;
} else if (typeof window !== 'undefined') {
  window.boardRules = BOARD_RULES_API;
}
})();
