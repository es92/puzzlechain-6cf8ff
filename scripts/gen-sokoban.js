#!/usr/bin/env node
/*
 * Crate Push level generator (#176).
 *
 * WHY OFFLINE. Sokoban is PSPACE-complete to solve, so a level can only be
 * shown to be solvable by searching — not something to do at mount time. This
 * is the ONE game in the programme whose content can never be rated at
 * runtime under any circumstances.
 *
 * HOW: ONE BACKWARD BFS PER ROOM.
 * -------------------------------
 * A push and a pull are exact inverses. Pushing a crate from B to A (player
 * stepping from C onto B) undoes pulling that crate from A to B (player
 * stepping from B to C). So if you take the SOLVED position — every crate on
 * a goal — and breadth-first expand it under PULL moves, you are walking the
 * forward push-graph backwards. That gives two things at once:
 *
 *   1. Every position reached is solvable BY CONSTRUCTION (replay the pulls
 *      in reverse). No solver is needed for correctness.
 *   2. The BFS depth of a position IS its exact minimum solution length in
 *      pushes. No solver is needed for difficulty either.
 *
 * The obvious design — generate a position by random pulls, then solve it to
 * measure it — pays for a fresh search per candidate and throws the search
 * away. This pays for one search per ROOM and harvests every depth from it.
 * A 4-crate room that cost ~6s per level under generate-and-test costs ~0.1s
 * here, and the difficulty ladder becomes a real push-count ladder instead of
 * a room-size proxy.
 *
 * Reverse generation is the same technique the repo already uses twice:
 * tmDealSolvable for Daily Tile Match and mjDeal for Mahjong Solitaire both
 * deal in reverse of a legal removal order for exactly this reason.
 *
 * TWO CORRECTNESS DETAILS
 *  - States are (crate multiset, player REGION), not (crates, player cell):
 *    where the player stands inside a region they can walk freely is not part
 *    of the position. Both directions normalise identically, so the backward
 *    graph really is the reverse of the forward one.
 *  - The forward goal is "all crates on goals" for ANY player position, so
 *    the backward BFS seeds depth 0 with EVERY player region of the solved
 *    crate configuration, not just one.
 *
 *   node scripts/gen-sokoban.js [--count N]
 */
const fs = require('fs');
const path = require('path');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIRS = [[0, 1], [0, -1], [1, 0], [-1, 0]];

/* ---- room ---------------------------------------------------------------- */

// Open room inside a walled rectangle, with a few interior pillars knocked in
// so the space is not a bare box. A pillar that would split the floor into two
// regions is rejected: an unreachable pocket makes a level look broken.
function makeRoom(w, h, pillars, rng) {
  const g = Array.from({ length: h }, (_, r) =>
    Array.from({ length: w }, (_, c) => (r === 0 || c === 0 || r === h - 1 || c === w - 1) ? '#' : ' '));
  let placed = 0, guard = 200;
  while (placed < pillars && guard-- > 0) {
    const r = 1 + Math.floor(rng() * (h - 2));
    const c = 1 + Math.floor(rng() * (w - 2));
    if (g[r][c] !== ' ') continue;
    g[r][c] = '#';
    if (!floorConnected(g)) { g[r][c] = ' '; continue; }
    placed++;
  }
  return g;
}

function floorConnected(g) {
  const h = g.length, w = g[0].length;
  let start = -1, floors = 0;
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    if (g[r][c] === ' ') { floors++; if (start < 0) start = r * w + c; }
  }
  if (start < 0) return false;
  const seen = new Set([start]);
  const q = [start];
  let head = 0;
  while (head < q.length) {
    const p = q[head++], r = (p / w) | 0, c = p % w;
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= h || nc >= w || g[nr][nc] === '#') continue;
      const k = nr * w + nc;
      if (!seen.has(k)) { seen.add(k); q.push(k); }
    }
  }
  return seen.size === floors;
}

/* ---- backward search ----------------------------------------------------- */

/* Reachable-region walk shared by normalisation and move generation. Returns
   the lowest cell index in the player's region and fills `reach` (a stamped
   Int32Array, so no allocation per node). */
function regionScan(player, blocked, walls, w, h, reach, stamp, queue) {
  let head = 0, tail = 0, min = player;
  queue[tail++] = player;
  reach[player] = stamp;
  while (head < tail) {
    const p = queue[head++], r = (p / w) | 0, c = p % w;
    if (p < min) min = p;
    for (let d = 0; d < 4; d++) {
      const nr = r + DIRS[d][0], nc = c + DIRS[d][1];
      if (nr < 0 || nc < 0 || nr >= h || nc >= w) continue;
      const np = nr * w + nc;
      if (walls[np] || blocked[np] || reach[np] === stamp) continue;
      reach[np] = stamp;
      queue[tail++] = np;
    }
  }
  return min;
}

/* All positions solvable from this room's solved state, bucketed by exact
   minimum push count.
   
   THE BOUND HAS TO FALL BETWEEN LEVELS, NEVER INSIDE ONE. Expansion stops
   only after a level has been expanded in full: cut a level short and its
   successors are simply not discovered there, so they turn up later by some
   longer route wearing an inflated depth. (That is not hypothetical — an
   earlier build sampled `width` states per level and shipped levels recorded
   at 35 pushes that an independent forward solver cracked in 16. `--verify`
   is what caught it.) Whole levels only, and every depth returned is the exact
   minimum push count. */
function backwardBfs(goals, walls, w, h, maxDepth, cap) {
  const n = w * h;
  /* TWO reach buffers, and this is load-bearing. Expanding a state needs its
     own reachability map alive across the whole move loop, while EACH move
     generated needs a second scan to normalise the successor's player region.
     Sharing one buffer means the first successor's scan overwrites the map the
     loop is still iterating against — every later move in that state is then
     tested against the wrong region, silently allowing and forbidding moves.
     That shipped once: it made both this search and the forward verifier
     report wrong depths, in both directions, and the disagreement between them
     is the only reason it was caught. */
  const reach = new Int32Array(n).fill(-1);      // outer: the state being expanded
  const nreach = new Int32Array(n).fill(-1);     // inner: the successor
  const queue = new Int32Array(n);
  const blocked = new Uint8Array(n);
  let stamp = 0, nstamp = 0;

  const byDepth = [];
  const seen = new Set();
  const frontier = [];

  const crates0 = goals.slice().sort((a, b) => a - b);
  for (const p of crates0) blocked[p] = 1;

  // Depth 0 = solved crates with the player in ANY region.
  const seededRegions = new Set();
  for (let p = 0; p < n; p++) {
    if (walls[p] || blocked[p] || seededRegions.has(p)) continue;
    stamp++;
    const norm = regionScan(p, blocked, walls, w, h, reach, stamp, queue);
    if (seededRegions.has(norm)) continue;
    for (let q = 0; q < n; q++) if (reach[q] === stamp) seededRegions.add(q);
    const st = { crates: crates0, player: norm, prev: null };
    seen.add(crates0.join(',') + '|' + norm);
    frontier.push(st);
  }
  for (const p of crates0) blocked[p] = 0;
  byDepth.push(frontier.slice());

  let cur = frontier;
  let depth = 0;
  let states = frontier.length;
  while (cur.length && depth < maxDepth && states < cap) {
    const next = [];
    for (const st of cur) {
      for (const p of st.crates) blocked[p] = 1;
      stamp++;
      regionScan(st.player, blocked, walls, w, h, reach, stamp, queue);

      for (let i = 0; i < st.crates.length; i++) {
        const crate = st.crates[i];
        const cr = (crate / w) | 0, cc = crate % w;
        for (let d = 0; d < 4; d++) {
          const br = cr + DIRS[d][0], bc = cc + DIRS[d][1];
          const xr = cr + 2 * DIRS[d][0], xc = cc + 2 * DIRS[d][1];
          if (br < 0 || bc < 0 || br >= h || bc >= w) continue;
          if (xr < 0 || xc < 0 || xr >= h || xc >= w) continue;
          const behind = br * w + bc, beyond = xr * w + xc;
          if (walls[behind] || walls[beyond]) continue;
          if (blocked[behind] || blocked[beyond]) continue;
          // The player has to already be standing where the pull starts.
          if (reach[behind] !== stamp) continue;

          const nc2 = st.crates.slice();
          nc2[i] = behind;
          nc2.sort((a, b) => a - b);
          // Normalise the new player position against the NEW crate set.
          blocked[crate] = 0; blocked[behind] = 1;
          nstamp++;
          const norm = regionScan(beyond, blocked, walls, w, h, nreach, nstamp, queue);
          blocked[behind] = 0; blocked[crate] = 1;

          const k = nc2.join(',') + '|' + norm;
          if (seen.has(k)) continue;
          seen.add(k);
          next.push({ crates: nc2, player: norm, prev: st });
        }
      }
      for (const p of st.crates) blocked[p] = 0;
    }
    if (!next.length) break;
    depth++;
    byDepth.push(next);
    states += next.length;
    cur = next;
  }
  return byDepth;
}

/* ---- level assembly ------------------------------------------------------ */

/* Walk a harvested state back up its parent chain and REPLAY the resulting
   pushes forward through a plain simulator. The chain is the forward solution
   already (a backward edge parent->child is a pull, so child->parent is a
   push), and replaying it proves three separate things at once: the level is
   solvable, it is solvable in exactly the recorded number of pushes, and the
   player can actually walk to each pushing square. Cheap — O(depth) — so it
   runs on every level the generator emits, not on a sample. */
function replayCertificate(st, goals, walls, w, h) {
  const n = w * h;
  const reach = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  const blocked = new Uint8Array(n);
  let stamp = 0;

  let crates = st.crates.slice();
  let player = st.player;
  let pushes = 0;
  for (let node = st; node.prev; node = node.prev) {
    const parent = node.prev;
    const from = crates.find(x => parent.crates.indexOf(x) === -1);
    const to = parent.crates.find(x => crates.indexOf(x) === -1);
    if (from === undefined || to === undefined) return -1;
    const dr = ((to / w) | 0) - ((from / w) | 0), dc = (to % w) - (from % w);
    if (Math.abs(dr) + Math.abs(dc) !== 1) return -1;      // not a unit push
    const stand = (((from / w) | 0) - dr) * w + ((from % w) - dc);
    if (stand < 0 || stand >= n || walls[stand] || crates.indexOf(stand) !== -1) return -1;
    for (const c of crates) blocked[c] = 1;
    stamp++;
    regionScan(player, blocked, walls, w, h, reach, stamp, queue);
    for (const c of crates) blocked[c] = 0;
    if (reach[stand] !== stamp) return -1;                 // player cannot get there
    crates = crates.map(x => (x === from ? to : x)).sort((a, b) => a - b);
    player = from;
    pushes++;
  }
  const g = goals.slice().sort((a, b) => a - b).join(',');
  return crates.join(',') === g ? pushes : -1;
}

function paint(g, goals, crates, player, w, h) {
  const out = g.map(row => row.slice());
  const gset = new Set(goals), cset = new Set(crates);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    if (out[r][c] === '#') continue;
    const p = r * w + c;
    if (cset.has(p)) out[r][c] = gset.has(p) ? '*' : '$';
    else if (gset.has(p)) out[r][c] = '.';
  }
  const pr = (player / w) | 0, pc = player % w;
  out[pr][pc] = out[pr][pc] === '.' ? '+' : '@';
  return out.map(r => r.join(''));
}

/* Harvest one room: build it, walk it backwards once, and return a level at a
   push depth inside [lo, hi] if the room reaches that far. */
function harvest(rng, spec, cap) {
  const { w, h, crates: nCrates, pillars, lo, hi } = spec;
  const g = makeRoom(w, h, pillars, rng);
  const floors = [];
  for (let r = 1; r < h - 1; r++) for (let c = 1; c < w - 1; c++) if (g[r][c] === ' ') floors.push(r * w + c);
  if (floors.length < nCrates * 5) return null;

  const walls = new Uint8Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (g[r][c] === '#') walls[r * w + c] = 1;

  const shuffled = floors.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const goals = shuffled.slice(0, nCrates);

  const byDepth = backwardBfs(goals, walls, w, h, hi, cap);
  const top = byDepth.length - 1;
  if (top < lo) return null;
  const d = lo + Math.floor(rng() * (Math.min(hi, top) - lo + 1));
  const pool = byDepth[d];
  if (!pool || !pool.length) return null;
  const st = pool[Math.floor(rng() * pool.length)];
  if (replayCertificate(st, goals, walls, w, h) !== d) return null;
  // A position whose crates are already all on goals is not a puzzle, whatever
  // its nominal depth (it can only happen at depth 0, which lo excludes).
  if (st.crates.join(',') === goals.slice().sort((a, b) => a - b).join(',')) return null;
  return { grid: paint(g, goals, st.crates, st.player, w, h), pushes: d, crates: nCrates };
}

/* Eight rungs, 3 pushes up to ~35. Difficulty is driven by PUSH DEPTH first —
   that is the thing a player actually feels — with crate count and pillar
   count rising underneath it so the deeper solutions have somewhere to live.
   The earlier generate-and-test build could not do this: its depths sat at 4-6
   pushes across every band and only the room grew.

   THE CEILINGS ARE MEASURED, NOT CHOSEN. A complete backward search tops out
   near 4 pushes with one crate, 10 with two, 18 with three and 26 with four,
   so a band cannot ask for more than its crate count can reach. Note that the
   top band adds PILLARS rather than a fifth crate: pillars lengthen the
   solution and shrink the floor at the same time, where a fifth crate multiply
   the state space until a complete search stops being affordable — and an
   incomplete search cannot report an exact depth. Re-probe before retuning. */
const SPECS = [
  { w: 7,  h: 6,  crates: 1, pillars: 0, lo: 3,  hi: 4 },
  { w: 8,  h: 7,  crates: 2, pillars: 1, lo: 5,  hi: 7 },
  { w: 8,  h: 7,  crates: 2, pillars: 3, lo: 8,  hi: 11 },
  { w: 9,  h: 8,  crates: 3, pillars: 3, lo: 11, hi: 14 },
  { w: 9,  h: 8,  crates: 3, pillars: 5, lo: 15, hi: 19 },
  { w: 10, h: 9,  crates: 4, pillars: 5, lo: 18, hi: 22 },
  { w: 10, h: 9,  crates: 4, pillars: 7, lo: 23, hi: 28 },
  { w: 11, h: 10, crates: 4, pillars: 9, lo: 29, hi: 40 },
];


/* ---- verification -------------------------------------------------------- */

/* `node scripts/gen-sokoban.js --verify` re-reads the shipped corpus, parses
   each grid exactly the way the game's cpParse does, and solves it FORWARD
   with an independent BFS over pushes. Two things are being checked that the
   generator cannot check itself: that the painted notation round-trips (a
   crate written onto a goal is '*', the player onto a goal is '+'), and that
   the recorded push count is the true minimum. A generator that proves its own
   output correct is only as trustworthy as its paint step. */
function parseGrid(rows) {
  const h = rows.length, w = Math.max(...rows.map(r => r.length));
  const walls = new Uint8Array(w * h);
  const goals = [], crates = [];
  let player = -1;
  for (let r = 0; r < h; r++) for (let c = 0; c < rows[r].length; c++) {
    const ch = rows[r][c], p = r * w + c;
    if (ch === '#') walls[p] = 1;
    if (ch === '.' || ch === '*' || ch === '+') goals.push(p);
    if (ch === '$' || ch === '*') crates.push(p);
    if (ch === '@' || ch === '+') player = p;
  }
  return { w, h, walls, goals: goals.sort((a, b) => a - b), crates: crates.sort((a, b) => a - b), player };
}

function solveForward(lv, cap) {
  const { w, h, walls } = lv;
  const n = w * h;
  const reach = new Int32Array(n).fill(-1);      // see backwardBfs: two buffers,
  const nreach = new Int32Array(n).fill(-1);     // never one
  const queue = new Int32Array(n);
  const blocked = new Uint8Array(n);
  let stamp = 0, nstamp = 0;
  const goalKey = lv.goals.join(',');
  const seen = new Set();
  let cur = [];
  {
    for (const p of lv.crates) blocked[p] = 1;
    stamp++;
    const norm = regionScan(lv.player, blocked, walls, w, h, reach, stamp, queue);
    for (const p of lv.crates) blocked[p] = 0;
    cur.push({ crates: lv.crates, player: norm });
    seen.add(lv.crates.join(',') + '|' + norm);
  }
  let depth = 0, states = 0;
  while (cur.length && states < cap) {
    for (const st of cur) if (st.crates.join(',') === goalKey) return depth;
    const next = [];
    for (const st of cur) {
      states++;
      for (const p of st.crates) blocked[p] = 1;
      stamp++;
      regionScan(st.player, blocked, walls, w, h, reach, stamp, queue);
      for (let i = 0; i < st.crates.length; i++) {
        const crate = st.crates[i];
        const cr = (crate / w) | 0, cc = crate % w;
        for (let d = 0; d < 4; d++) {
          const fr = cr - DIRS[d][0], fc = cc - DIRS[d][1];
          const tr = cr + DIRS[d][0], tc = cc + DIRS[d][1];
          if (fr < 0 || fc < 0 || fr >= h || fc >= w) continue;
          if (tr < 0 || tc < 0 || tr >= h || tc >= w) continue;
          const from = fr * w + fc, to = tr * w + tc;
          if (walls[from] || walls[to] || blocked[from] || blocked[to]) continue;
          if (reach[from] !== stamp) continue;   // player must get behind it
          const nc2 = st.crates.slice();
          nc2[i] = to;
          nc2.sort((a, b) => a - b);
          blocked[crate] = 0; blocked[to] = 1;
          nstamp++;
          const norm = regionScan(crate, blocked, walls, w, h, nreach, nstamp, queue);
          blocked[to] = 0; blocked[crate] = 1;
          const k = nc2.join(',') + '|' + norm;
          if (seen.has(k)) continue;
          seen.add(k);
          next.push({ crates: nc2, player: norm });
        }
      }
      for (const p of st.crates) blocked[p] = 0;
    }
    if (!next.length) break;
    depth++;
    cur = next;
  }
  return -1;
}

function verify() {
  const f = path.join(__dirname, '..', 'public', 'corpus', 'cratepush.json');
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  let bad = 0, total = 0, proven = 0, capped = 0;
  data.levels.forEach((band, b) => {
    let worst = 0;
    for (const lv of band) {
      total++;
      const parsed = parseGrid(lv.g);
      if (parsed.player < 0) { console.error(`band ${b}: no player`); bad++; continue; }
      if (parsed.crates.length !== parsed.goals.length) {
        console.error(`band ${b}: ${parsed.crates.length} crates vs ${parsed.goals.length} goals`); bad++; continue;
      }
      const d = solveForward(parsed, 1500000);
      if (d < 0) { capped++; continue; }          // not proven inside the cap
      if (d !== lv.p) { console.error(`band ${b}: recorded ${lv.p} pushes, forward solver says ${d}`); bad++; }
      else proven++;
      worst = Math.max(worst, d);
    }
    console.log(`[band ${b}] ${band.length} levels, deepest confirmed ${worst} pushes`);
  });
  console.log(bad
    ? `FAIL: ${bad}/${total} levels disagree with the forward solver`
    : `OK: ${proven}/${total} confirmed minimal by forward search, ${capped} beyond its cap ` +
      `(all ${total} are solvable by construction and passed certificate replay)`);
  process.exit(bad ? 1 : 0);
}

function main() {
  if (process.argv.includes('--verify')) return verify();
  const args = process.argv.slice(2);
  const perBand = Number(args[args.indexOf('--count') + 1]) || 25;
  const cap = Number(args[args.indexOf('--cap') + 1]) || 250000;
  const outDir = path.join(__dirname, '..', 'public', 'corpus');
  fs.mkdirSync(outDir, { recursive: true });
  const bands = [];
  let seed = 1;
  for (let b = 0; b < SPECS.length; b++) {
    const levels = [];
    const t0 = Date.now();
    let tries = 0;
    while (levels.length < perBand && tries < perBand * 40) {
      tries++;
      const lv = harvest(mulberry32(seed++), SPECS[b], cap);
      if (lv) levels.push({ g: lv.grid, p: lv.pushes });
    }
    const ps = levels.map(l => l.p);
    const avg = ps.length ? (ps.reduce((a, x) => a + x, 0) / ps.length).toFixed(1) : 0;
    const rng = ps.length ? `${Math.min(...ps)}-${Math.max(...ps)}` : '-';
    console.log(`[band ${b}] ${levels.length}/${perBand} levels  ${SPECS[b].w}x${SPECS[b].h} ` +
      `${SPECS[b].crates} crates  pushes ${rng} (avg ${avg})  ${tries} rooms  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    bands.push(levels);
  }
  const out = { game: 'cratepush', bands: bands.length, levels: bands };
  const f = path.join(outDir, 'cratepush.json');
  fs.writeFileSync(f, JSON.stringify(out));
  console.log(`wrote ${(fs.statSync(f).size / 1024).toFixed(1)}kb`);
}

main();
