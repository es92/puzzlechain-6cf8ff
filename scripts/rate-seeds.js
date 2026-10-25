#!/usr/bin/env node
/*
 * Offline seed rater for the solitaire dailies (#176).
 *
 * WHY A CORPUS AT ALL. Sudoku, Mine Finder and Nonogram all rate a board in
 * milliseconds, so they generate-and-check at mount time and need nothing
 * shipped. Solitaire is the opposite: deciding whether a Klondike deal is
 * winnable is a search, not a deduction, and it costs far too much to run
 * while a player waits. So the expensive half moves here, and what ships is
 * NOT a board — it is a rated SEED.
 *
 * That distinction is what keeps the corpus small. Every generator in the app
 * is seeded and deterministic (it has to be, for the dailies to be identical
 * for everyone), so `{seed, difficulty}` regenerates the exact deal on demand.
 * Ten thousand rated Klondike deals is tens of kilobytes, not megabytes.
 *
 * THE DUPLICATION, STATED PLAINLY. The deal comes from the real client code —
 * this script extracts ceDeck/klDeal/spDeal out of public/src rather than
 * copying them, so a deal here is byte-identical to a deal in the browser. The
 * MOVE RULES are re-implemented below, because in the app they live inside the
 * React components rather than as pure functions. That is a duplication, and
 * it is the deliberate kind: if the two ever drift, the corpus's difficulty
 * LABELS go slightly wrong, but gameplay does not — the client plays its own
 * rules on a deal it derives itself. Nothing here is load-bearing for
 * correctness, only for calibration.
 *
 *   node scripts/rate-seeds.js [--count N] [--out DIR]
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'public', 'src', '24-engine-cards.jsx');
const CORE = path.join(__dirname, '..', 'public', 'src', '05-core-lib.jsx');
const OUT_DIR_DEFAULT = path.join(__dirname, '..', 'public', 'corpus');

// ---- pull the REAL deal functions out of the app source ---------------------
function extract(src, name, kind = 'function') {
  const re = new RegExp('^' + kind + '\\s+' + name + '\\s*\\(', 'm');
  const m = re.exec(src);
  if (!m) throw new Error('could not find ' + name + ' in the app source');
  let i = src.indexOf('{', m.index + m[0].length - 1);
  let depth = 0, j = i;
  while (j < src.length) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) break; }
    j++;
  }
  return src.slice(m.index, j + 1);
}

const appSrc = fs.readFileSync(SRC, 'utf8');
const coreSrc = fs.readFileSync(CORE, 'utf8');
const harness = [
  extract(coreSrc, 'mulberry32'),
  extract(appSrc, 'ceShuffle'),
  extract(appSrc, 'ceDeck'),
  extract(appSrc, 'klDeal'),
  extract(appSrc, 'spDeal'),
  'module.exports = { mulberry32, klDeal, spDeal };',
].join('\n');
const tmp = path.join(__dirname, '.rate-seeds-harness.js');
fs.writeFileSync(tmp, harness);
const DEAL = require(tmp);

// ---- Klondike --------------------------------------------------------------
/* Cards are the engine's own shape: { id, s: suit 0-3, r: rank 0-12, up }.
   Suits 1 and 2 are the red ones, matching ceIsRed in the app. */
const isRed = (c) => c.s === 1 || c.s === 2;
const canStack = (card, onto) => !!onto && isRed(card) !== isRed(onto) && card.r === onto.r - 1;
const canFound = (card, pile) =>
  pile.length === 0 ? card.r === 0 : (pile[pile.length - 1].s === card.s && card.r === pile[pile.length - 1].r + 1);

/* The state key must include the ORDER of stock and waste, not just their
   lengths. A first cut keyed on lengths alone made every draw/redeal cycle
   look like a state already visited, so the search pruned the very lines that
   win — it reported 0 winnable deals out of 800, which is how the bug was
   found (the true rate is about four in five). */
const cardKey = (c) => (c.up ? '' : 'x') + c.r + ':' + c.s;
const klKey = (st) =>
  st.tab.map(col => col.map(cardKey).join(',')).join('|')
  + '#' + st.found.map(f => f.length).join(',')
  + '#' + st.waste.map(cardKey).join(',')
  + '#' + st.stock.map(cardKey).join(',');

function klClone(st) {
  return {
    stock: st.stock.map(c => ({ ...c })),
    waste: st.waste.map(c => ({ ...c })),
    found: st.found.map(f => f.map(c => ({ ...c }))),
    tab: st.tab.map(col => col.map(c => ({ ...c }))),
    moves: st.moves,
  };
}

function klMoves(st) {
  const out = [];
  // Tableau / waste → foundation first: it never hurts and it prunes hard.
  for (let f = 0; f < 4; f++) {
    const w = st.waste[st.waste.length - 1];
    if (w && canFound(w, st.found[f])) out.push({ t: 'wf', f });
    for (let i = 0; i < 7; i++) {
      const col = st.tab[i];
      const c = col[col.length - 1];
      if (c && c.up && canFound(c, st.found[f])) out.push({ t: 'tf', i, f });
    }
  }
  // Tableau → tableau: move the whole face-up run.
  for (let i = 0; i < 7; i++) {
    const col = st.tab[i];
    const start = col.findIndex(c => c.up);
    if (start < 0) continue;
    const head = col[start];
    for (let j = 0; j < 7; j++) {
      if (i === j) continue;
      const dst = st.tab[j];
      const top = dst[dst.length - 1];
      if (!top) { if (head.r === 12 && start > 0) out.push({ t: 'tt', i, j, start }); continue; }
      if (top.up && canStack(head, top)) out.push({ t: 'tt', i, j, start });
    }
  }
  // Waste → tableau.
  const w = st.waste[st.waste.length - 1];
  if (w) {
    for (let j = 0; j < 7; j++) {
      const dst = st.tab[j];
      const top = dst[dst.length - 1];
      if (!top) { if (w.r === 12) out.push({ t: 'wt', j }); continue; }
      if (top.up && canStack(w, top)) out.push({ t: 'wt', j });
    }
  }
  if (st.stock.length) out.push({ t: 'draw' });
  else if (st.waste.length) out.push({ t: 'redeal' });
  return out;
}

function klApply(st, mv) {
  const n = klClone(st);
  n.moves += 1;
  const flip = (col) => { const c = col[col.length - 1]; if (c && !c.up) c.up = true; };
  if (mv.t === 'draw') { const c = n.stock.pop(); c.up = true; n.waste.push(c); return n; }
  if (mv.t === 'redeal') { n.stock = n.waste.reverse().map(c => ({ ...c, up: false })); n.waste = []; return n; }
  if (mv.t === 'wf') { n.found[mv.f].push(n.waste.pop()); return n; }
  if (mv.t === 'wt') { n.tab[mv.j].push(n.waste.pop()); return n; }
  if (mv.t === 'tf') { n.found[mv.f].push(n.tab[mv.i].pop()); flip(n.tab[mv.i]); return n; }
  const run = n.tab[mv.i].splice(mv.start);
  n.tab[mv.j].push(...run);
  flip(n.tab[mv.i]);
  return n;
}

const klWon = (st) => st.found.reduce((a, f) => a + f.length, 0) === 52;

/* Bounded depth-first search with a visited set. The node cap is the whole
   design: "winnable within N nodes" is a workable proxy for "winnable by a
   competent player", and it also makes the run time predictable, which an
   unbounded solitaire solver emphatically is not. Nodes consumed is the
   difficulty signal. */
function klSolve(st, nodeCap) {
  const seen = new Set();
  let nodes = 0;
  const dfs = (s, depth) => {
    if (klWon(s)) return true;
    if (++nodes > nodeCap || depth > 400) return false;
    const k = klKey(s);
    if (seen.has(k)) return false;
    seen.add(k);
    for (const mv of klMoves(s)) if (dfs(klApply(s, mv), depth + 1)) return true;
    return false;
  };
  const ok = dfs(st, 0);
  return { winnable: ok, nodes };
}

// ---- Spider (1-suit) -------------------------------------------------------
/* Spider's suit count IS its difficulty ladder, and a 1-suit game is nearly
   always winnable, so what is rated here is EFFORT rather than winnability:
   how many nodes a greedy-with-backtracking search needs. */
function spKey(st) {
  return st.cols.map(col => col.map(c => (c.up ? '' : 'x') + c.r).join(',')).join('|')
    + '#' + st.stock.length + '#' + (st.done8 || 0);
}
function spMoves(st) {
  const out = [];
  for (let i = 0; i < st.cols.length; i++) {
    const col = st.cols[i];
    if (!col.length) continue;
    // longest descending face-up run at the tail
    let start = col.length - 1;
    while (start > 0 && col[start - 1].up && col[start - 1].r === col[start].r + 1) start--;
    if (!col[start] || !col[start].up) continue;
    for (let j = 0; j < st.cols.length; j++) {
      if (i === j) continue;
      const dst = st.cols[j];
      const top = dst[dst.length - 1];
      if (!top) { if (start > 0) out.push({ i, j, start }); continue; }
      if (top.up && top.r === col[start].r + 1) out.push({ i, j, start });
    }
  }
  if (st.stock && st.stock.length) out.push({ deal: true });
  return out;
}
function spApply(st, mv) {
  const n = { cols: st.cols.map(c => c.map(x => ({ ...x }))), stock: st.stock.map(c => ({ ...c })), done8: st.done8 || 0 };
  if (mv.deal) {
    for (let i = 0; i < n.cols.length && n.stock.length; i++) n.cols[i].push({ ...n.stock.pop(), up: true });
    return n;
  }
  const run = n.cols[mv.i].splice(mv.start);
  n.cols[mv.j].push(...run);
  const src = n.cols[mv.i];
  if (src.length && !src[src.length - 1].up) src[src.length - 1].up = true;
  // Clear a complete K→A run (ranks are 0-indexed, so K is 12).
  const dst = n.cols[mv.j];
  if (dst.length >= 13) {
    const tail = dst.slice(-13);
    if (tail.every((c, k) => c.up && c.r === 12 - k)) {
      dst.splice(-13);
      n.done8 += 1;
      if (dst.length && !dst[dst.length - 1].up) dst[dst.length - 1].up = true;
    }
  }
  return n;
}
function spSolve(st, nodeCap) {
  const seen = new Set();
  let nodes = 0;
  const dfs = (s, depth) => {
    if ((s.done8 || 0) >= 8) return true;
    if (++nodes > nodeCap || depth > 300) return false;
    const k = spKey(s);
    if (seen.has(k)) return false;
    seen.add(k);
    for (const mv of spMoves(s)) if (dfs(spApply(s, mv), depth + 1)) return true;
    return false;
  };
  return { winnable: dfs(st, 0), nodes };
}

// ---- drive -----------------------------------------------------------------
/* Band cuts are DERIVED from the measured node distribution, not guessed.
   A first cut used hand-picked thresholds and put two thirds of every corpus
   in band 0 — which is the same mistake as eyeballing a layout ladder instead
   of measuring it. Quantiles guarantee the bands are actually populated, and
   they self-correct if the solver is ever retuned. */
function quantileCuts(values, nBands) {
  const sorted = values.slice().sort((a, b) => a - b);
  const cuts = [];
  for (let i = 1; i < nBands; i++) {
    cuts.push(sorted[Math.floor((sorted.length * i) / nBands)]);
  }
  return cuts;
}
function bandOf(nodes, cuts) {
  for (let i = 0; i < cuts.length; i++) if (nodes <= cuts[i]) return i;
  return cuts.length;
}

function rate(name, dealFn, solveFn, opts) {
  const { count, nodeCap, bands } = opts;
  const found = [];
  let tried = 0, rejected = 0;
  const t0 = Date.now();
  for (let seed = 1; found.length < count && tried < count * 40; seed++) {
    tried++;
    const st = dealFn(DEAL.mulberry32(seed >>> 0));
    const { winnable, nodes } = solveFn(st, nodeCap);
    if (!winnable) { rejected++; continue; }
    found.push([seed, nodes]);
  }
  const cuts = quantileCuts(found.map(f => f[1]), bands);
  const kept = found.map(([seed, nodes]) => [seed, bandOf(nodes, cuts)]);
  const byBand = {};
  for (const [, b] of kept) byBand[b] = (byBand[b] || 0) + 1;
  const rate = tried ? ((found.length / tried) * 100).toFixed(0) : '0';
  console.log(`[${name}] kept ${kept.length} of ${tried} deals (${rate}% winnable within ${nodeCap} nodes) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`[${name}] node cuts ${JSON.stringify(cuts)}  band sizes ${JSON.stringify(byBand)}`);
  return { kept, cuts };
}

function main() {
  const args = process.argv.slice(2);
  const count = Number(args[args.indexOf('--count') + 1]) || 400;
  const outDir = args.indexOf('--out') >= 0 ? args[args.indexOf('--out') + 1] : OUT_DIR_DEFAULT;
  fs.mkdirSync(outDir, { recursive: true });

  const jobs = [
    // Band counts mirror STORY_BANDS in server.js (#184: 6 to 10 levels), and
    // scripts/check-registry.js re-reads the emitted `bands` field to assert
    // it. Bumping one here means regenerating and committing the corpus.
    ['klondike', DEAL.klDeal, klSolve, { count, nodeCap: 60000, bands: 6 }],
    ['spider',   DEAL.spDeal, spSolve, { count, nodeCap: 60000, bands: 6 }],
  ];
  for (const [name, dealFn, solveFn, opts] of jobs) {
    const { kept: seeds, cuts } = rate(name, dealFn, solveFn, opts);
    const out = { game: name, generated: seeds.length, bands: opts.bands, cuts, seeds };
    fs.writeFileSync(path.join(outDir, name + '.json'), JSON.stringify(out));
    const kb = (fs.statSync(path.join(outDir, name + '.json')).size / 1024).toFixed(1);
    console.log(`[${name}] wrote ${kb}kb`);
  }
  fs.unlinkSync(tmp);
}

main();
