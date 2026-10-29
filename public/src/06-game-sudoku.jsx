/* ============================================================
   Game 1 — Mini Sudoku (6×6)
   ============================================================ */
const SUDOKU6_SOLUTION = [
  [1, 2, 3, 4, 5, 6],
  [4, 5, 6, 1, 2, 3],
  [2, 3, 1, 5, 6, 4],
  [5, 6, 4, 2, 3, 1],
  [3, 1, 2, 6, 4, 5],
  [6, 4, 5, 3, 1, 2],
];

// Fisher–Yates using a supplied rng() (defaults to Math.random for any
// non-daily callers). A seeded rng makes the result deterministic.
const shuffle = (arr, rng = Math.random) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function generateSudoku6(rng = Math.random) {
  // 1. start from the hardcoded valid solution
  let sol = SUDOKU6_SOLUTION.map(row => row.slice());

  // 2. seeded digit permutation (remap 1..6)
  const perm = shuffle([1, 2, 3, 4, 5, 6], rng);
  const map = {};
  for (let i = 0; i < 6; i++) map[i + 1] = perm[i];
  sol = sol.map(row => row.map(v => map[v]));

  // 3. swap rows within each horizontal band (rows 0-1, 2-3, 4-5)
  for (let band = 0; band < 3; band++) {
    if (rng() < 0.5) {
      const r0 = band * 2, r1 = band * 2 + 1;
      [sol[r0], sol[r1]] = [sol[r1], sol[r0]];
    }
  }

  // 4. blank out 14 cells (seeded)
  const puzzle = sol.map(row => row.slice());
  const positions = shuffle(Array.from({ length: 36 }, (_, i) => i), rng).slice(0, 14);
  positions.forEach(p => { puzzle[Math.floor(p / 6)][p % 6] = 0; });

  return { solution: sol, puzzle };
}

// Box index for either board size: 6×6 uses 2×3 boxes, 9×9 uses 3×3.
const boxAt = (r, c, size = 6) => size === 9
  ? Math.floor(r / 3) * 3 + Math.floor(c / 3)
  : Math.floor(r / 2) * 2 + Math.floor(c / 3);

// ---- 9×9 generator (difficulty 'classic' — spec change-list item 7) --------
// Full seeded backtracking fill, then dig cells in seeded order keeping the
// solution UNIQUE (solution-count solver capped at 2, MRV + bitmasks so the
// whole generation stays well under ~100ms).
function sdk9CountSolutions(g, cap = 2) {
  const rows = new Array(9).fill(0), cols = new Array(9).fill(0), boxes = new Array(9).fill(0);
  const empties = [];
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    const v = g[r][c];
    const b = boxAt(r, c, 9);
    if (v) { const bit = 1 << v; rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit; }
    else empties.push(r * 9 + c);
  }
  let count = 0;
  const rec = () => {
    if (count >= cap) return;
    let bestI = -1, bestOpts = 10;
    for (let i = 0; i < empties.length; i++) {
      const e = empties[i];
      if (e < 0) continue;
      const r = (e / 9) | 0, c = e % 9;
      const used = rows[r] | cols[c] | boxes[boxAt(r, c, 9)];
      let opts = 0;
      for (let v = 1; v <= 9; v++) if (!(used & (1 << v))) opts++;
      if (opts === 0) return;
      if (opts < bestOpts) { bestOpts = opts; bestI = i; if (opts === 1) break; }
    }
    if (bestI === -1) { count++; return; }
    const e = empties[bestI];
    empties[bestI] = -1;
    const r = (e / 9) | 0, c = e % 9, b = boxAt(r, c, 9);
    for (let v = 1; v <= 9; v++) {
      const bit = 1 << v;
      if ((rows[r] | cols[c] | boxes[b]) & bit) continue;
      rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
      rec();
      rows[r] &= ~bit; cols[c] &= ~bit; boxes[b] &= ~bit;
      if (count >= cap) break;
    }
    empties[bestI] = e;
  };
  rec();
  return count;
}

function generateSudoku9(rng) {
  const g = Array.from({ length: 9 }, () => new Array(9).fill(0));
  const okay = (r, c, v) => {
    for (let k = 0; k < 9; k++) if (g[r][k] === v || g[k][c] === v) return false;
    const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
    for (let rr = br; rr < br + 3; rr++) for (let cc = bc; cc < bc + 3; cc++) if (g[rr][cc] === v) return false;
    return true;
  };
  const fill = (pos) => {
    if (pos === 81) return true;
    const r = (pos / 9) | 0, c = pos % 9;
    for (const v of shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rng)) {
      if (okay(r, c, v)) {
        g[r][c] = v;
        if (fill(pos + 1)) return true;
        g[r][c] = 0;
      }
    }
    return false;
  };
  fill(0);
  const solution = g.map(row => row.slice());
  const puzzle = solution.map(row => row.slice());
  const order = shuffle(Array.from({ length: 81 }, (_, i) => i), rng);
  let removed = 0;
  for (const idx of order) {
    if (removed >= 41) break; // 40 givens left — a fair mid-weight daily
    const r = (idx / 9) | 0, c = idx % 9;
    const keep = puzzle[r][c];
    puzzle[r][c] = 0;
    if (sdk9CountSolutions(puzzle) !== 1) puzzle[r][c] = keep;
    else removed++;
  }
  return { solution, puzzle };
}

// Real-Sudoku conflict marking: a filled cell is in error if its value repeats
// elsewhere in its row, column, or box. Size-aware (6×6 and 9×9). Returns the
// set of "r,c" keys in conflict — no hidden "correct answer" comparison.
function sudokuConflicts(grid) {
  const size = grid.length;
  const errs = new Set();
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const v = grid[r][c];
      if (!v) continue;
      for (let k = 0; k < size; k++) {
        if (k !== c && grid[r][k] === v) errs.add(`${r},${c}`);
        if (k !== r && grid[k][c] === v) errs.add(`${r},${c}`);
      }
      for (let rr = 0; rr < size; rr++) {
        for (let cc = 0; cc < size; cc++) {
          if ((rr !== r || cc !== c) && boxAt(rr, cc, size) === boxAt(r, c, size) && grid[rr][cc] === v) {
            errs.add(`${r},${c}`);
          }
        }
      }
    }
  }
  return errs;
}

// Win = fully filled with zero conflicts (every row/col/box a permutation of
// 1–N). The true Sudoku rule, decoupled from any single generated solution.
function sudokuSolved(grid) {
  const size = grid.length;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!grid[r][c]) return false;
  return sudokuConflicts(grid).size === 0;
}

// One Sudoku entry, two board sizes (spec §8: "one entry, not two"). 'mini'
// is the original 6×6, byte-identical to the pre-change daily; 'classic' is
// the new 9×9 at ×2 points. The chooser renders BEFORE the board mounts, so
// the timer never ticks while the player decides; the pick is persisted into
// progress so a resumed attempt reopens the same board.
const SUDOKU_MULT = { mini: 1, classic: 2 };

/* ?sdk=9 → the 9×9 Classic board, ?sdk=6 → the 6×6 Mini board. Anything else
   (including no param) means "show the chooser", the normal flow. */
function sdkDeepLinkDifficulty() {
  try {
    const v = new URLSearchParams(window.location.search).get('sdk');
    if (v === '9' || v === 'classic') return 'classic';
    if (v === '6' || v === 'mini') return 'mini';
  } catch {}
  return null;
}


/* ============================================================
   Sudoku difficulty rating (#176) — technique-graded solving
   ============================================================
   The pilot for every difficulty band in the app, and the cheapest one: a
   Sudoku's difficulty is exactly "which human techniques does it force you to
   use", and that is decidable in milliseconds. So Sudoku needs NO rated-seed
   corpus at all — story and arcade generate a board, rate it, and keep it if
   it lands in the band that was asked for.

   The ladder is the technique list itself, hardest-required first:

     0 naked single    the cell has one candidate left
     1 hidden single   a digit fits only one cell in its row / column / box
     2 naked pair      two cells in a unit share the same two candidates
     3 pointing pair   a digit is confined to one line within a box
     4 box-line        a digit is confined to one box within a line
     5 X-wing          two rows share a digit in the same two columns

   A puzzle's rating is the HARDEST technique it forces, not the count of
   techniques used, because that is what a player experiences as difficulty:
   one X-wing makes a puzzle hard however many singles surround it.

   Anything the list cannot finish would need guessing, so it is rejected
   outright rather than shipped as "very hard" — a puzzle that needs a guess
   is not harder, it is broken.
   ============================================================ */

// Unit geometry for both board sizes. 6×6 uses 2×3 boxes, 9×9 uses 3×3.
function sdkUnits(size) {
  const bh = size === 9 ? 3 : 2;   // box height in rows
  const bw = 3;                    // box width in cols (both sizes)
  const units = [];
  for (let r = 0; r < size; r++) units.push(Array.from({ length: size }, (_, c) => [r, c]));
  for (let c = 0; c < size; c++) units.push(Array.from({ length: size }, (_, r) => [r, c]));
  for (let br = 0; br < size / bh; br++) {
    for (let bc = 0; bc < size / bw; bc++) {
      const cells = [];
      for (let r = 0; r < bh; r++) for (let c = 0; c < bw; c++) cells.push([br * bh + r, bc * bw + c]);
      units.push(cells);
    }
  }
  return units;
}
const SDK_UNITS = { 6: sdkUnits(6), 9: sdkUnits(9) };

// Candidate sets for every empty cell, as an array of Sets indexed r*size+c.
function sdkCandidates(grid, size) {
  const cand = new Array(size * size).fill(null);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c]) continue;
      const s = new Set();
      for (let v = 1; v <= size; v++) s.add(v);
      for (let i = 0; i < size; i++) {
        s.delete(grid[r][i]);
        s.delete(grid[i][c]);
      }
      const bh = size === 9 ? 3 : 2;
      const r0 = Math.floor(r / bh) * bh, c0 = Math.floor(c / 3) * 3;
      for (let i = 0; i < bh; i++) for (let j = 0; j < 3; j++) s.delete(grid[r0 + i][c0 + j]);
      cand[r * size + c] = s;
    }
  }
  return cand;
}

/* Solve with human techniques only, reporting the hardest one needed.
   Returns { solved, hardest } — `hardest` is -1 for an already-complete grid
   and SDK_TECHNIQUES.length when the technique list stalls (needs a guess). */
const SDK_TECHNIQUES = ['naked-single', 'hidden-single', 'naked-pair', 'pointing', 'box-line', 'x-wing'];

function sdkSolveGraded(puzzle, size) {
  const grid = puzzle.map(row => row.slice());
  const units = SDK_UNITS[size];
  let hardest = -1;

  const place = (r, c, v) => { grid[r][c] = v; };

  for (;;) {
    const empties = [];
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!grid[r][c]) empties.push([r, c]);
    if (!empties.length) return { solved: true, hardest: Math.max(hardest, 0) };

    const cand = sdkCandidates(grid, size);
    // A cell with no candidates means the grid is already contradictory.
    for (const [r, c] of empties) if (cand[r * size + c].size === 0) return { solved: false, hardest: SDK_TECHNIQUES.length };

    let acted = false;

    // 0 — naked single
    for (const [r, c] of empties) {
      const s = cand[r * size + c];
      if (s.size === 1) { place(r, c, [...s][0]); hardest = Math.max(hardest, 0); acted = true; break; }
    }
    if (acted) continue;

    // 1 — hidden single
    for (const unit of units) {
      for (let v = 1; v <= size && !acted; v++) {
        const spots = unit.filter(([r, c]) => !grid[r][c] && cand[r * size + c].has(v));
        if (spots.length === 1) {
          place(spots[0][0], spots[0][1], v); hardest = Math.max(hardest, 1); acted = true;
        }
      }
      if (acted) break;
    }
    if (acted) continue;

    /* From here the techniques ELIMINATE candidates rather than place digits,
       so they mutate `cand` and loop back to let the singles above finish the
       job. `elim` tracks whether anything actually changed — a technique that
       fires but removes nothing must not count toward the rating. */
    let elim = false;
    const drop = (r, c, v) => {
      const s = cand[r * size + c];
      if (s && s.has(v)) { s.delete(v); elim = true; return true; }
      return false;
    };

    // 2 — naked pair
    for (const unit of units) {
      const open = unit.filter(([r, c]) => !grid[r][c]);
      for (let i = 0; i < open.length && !elim; i++) {
        const a = cand[open[i][0] * size + open[i][1]];
        if (a.size !== 2) continue;
        for (let j = i + 1; j < open.length; j++) {
          const b = cand[open[j][0] * size + open[j][1]];
          if (b.size !== 2) continue;
          const same = [...a].every(v => b.has(v));
          if (!same) continue;
          for (const [r, c] of open) {
            if ((r === open[i][0] && c === open[i][1]) || (r === open[j][0] && c === open[j][1])) continue;
            for (const v of a) drop(r, c, v);
          }
          if (elim) { hardest = Math.max(hardest, 2); break; }
        }
      }
      if (elim) break;
    }
    if (elim) continue;

    // 3 / 4 — pointing pair and box-line reduction, both "a digit is confined
    // to the intersection of a box and a line", read in the two directions.
    const bh = size === 9 ? 3 : 2;
    for (let b = 0; b < size && !elim; b++) {
      const r0 = Math.floor(b / (size / 3)) * bh, c0 = (b % (size / 3)) * 3;
      const boxCells = [];
      for (let i = 0; i < bh; i++) for (let j = 0; j < 3; j++) boxCells.push([r0 + i, c0 + j]);
      for (let v = 1; v <= size && !elim; v++) {
        const spots = boxCells.filter(([r, c]) => !grid[r][c] && cand[r * size + c].has(v));
        if (spots.length < 2) continue;
        const rows = new Set(spots.map(s => s[0])), cols = new Set(spots.map(s => s[1]));
        if (rows.size === 1) {
          const r = [...rows][0];
          for (let c = 0; c < size; c++) if (c < c0 || c >= c0 + 3) if (!grid[r][c]) drop(r, c, v);
        } else if (cols.size === 1) {
          const c = [...cols][0];
          for (let r = 0; r < size; r++) if (r < r0 || r >= r0 + bh) if (!grid[r][c]) drop(r, c, v);
        }
        if (elim) hardest = Math.max(hardest, 3);
      }
    }
    if (elim) continue;

    for (let line = 0; line < size && !elim; line++) {
      for (let v = 1; v <= size && !elim; v++) {
        for (const horiz of [true, false]) {
          const spots = [];
          for (let i = 0; i < size; i++) {
            const r = horiz ? line : i, c = horiz ? i : line;
            if (!grid[r][c] && cand[r * size + c].has(v)) spots.push([r, c]);
          }
          if (spots.length < 2) continue;
          const boxes = new Set(spots.map(([r, c]) => boxAt(r, c, size)));
          if (boxes.size !== 1) continue;
          const bb = [...boxes][0];
          const br0 = Math.floor(bb / (size / 3)) * bh, bc0 = (bb % (size / 3)) * 3;
          for (let i = 0; i < bh; i++) for (let j = 0; j < 3; j++) {
            const r = br0 + i, c = bc0 + j;
            const onLine = horiz ? r === line : c === line;
            if (!onLine && !grid[r][c]) drop(r, c, v);
          }
          if (elim) { hardest = Math.max(hardest, 4); break; }
        }
      }
    }
    if (elim) continue;

    // 5 — X-wing: a digit confined to the same two columns in two rows (and
    // the transpose) can be removed from those columns everywhere else.
    for (let v = 1; v <= size && !elim; v++) {
      for (const horiz of [true, false]) {
        const linesWithTwo = [];
        for (let line = 0; line < size; line++) {
          const spots = [];
          for (let i = 0; i < size; i++) {
            const r = horiz ? line : i, c = horiz ? i : line;
            if (!grid[r][c] && cand[r * size + c].has(v)) spots.push(i);
          }
          if (spots.length === 2) linesWithTwo.push([line, spots]);
        }
        for (let i = 0; i < linesWithTwo.length && !elim; i++) {
          for (let j = i + 1; j < linesWithTwo.length; j++) {
            const [l1, s1] = linesWithTwo[i], [l2, s2] = linesWithTwo[j];
            if (s1[0] !== s2[0] || s1[1] !== s2[1]) continue;
            for (const cross of s1) {
              for (let k = 0; k < size; k++) {
                if (k === l1 || k === l2) continue;
                const r = horiz ? k : cross, c = horiz ? cross : k;
                if (!grid[r][c]) drop(r, c, v);
              }
            }
            if (elim) { hardest = Math.max(hardest, 5); break; }
          }
        }
        if (elim) break;
      }
    }
    if (elim) continue;

    // Nothing fired: the technique list is exhausted and a guess is required.
    return { solved: false, hardest: SDK_TECHNIQUES.length };
  }
}

/* Uniqueness check for either board size, generalised from the 9×9-only
   counter above. This is what the DIG uses, because "does the puzzle still
   have exactly one solution" is the correct criterion for removing a cell —
   and a bitmask search answers it orders of magnitude faster than running the
   technique-graded solver per removal, which is what a first cut did and what
   made generation far too slow to run on the client. */
function sdkCountSolutions(g, size, cap = 2, nodeBudget = 20000) {
  const bh = size === 9 ? 3 : 2;
  const nBoxes = size;
  const rows = new Array(size).fill(0), cols = new Array(size).fill(0), boxes = new Array(nBoxes).fill(0);
  const empties = [];
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    const v = g[r][c], b = boxAt(r, c, size);
    if (v) { const bit = 1 << v; rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit; }
    else empties.push(r * size + c);
  }
  let count = 0;
  /* Counting solutions on a nearly-empty grid is unbounded work, and the dig
     calls this once per candidate removal — a first cut without this budget
     took ~8 SECONDS per 9×9 board, which is not a thing that can run at mount
     time. Exhausting the budget returns -1 ("don't know"), and the dig treats
     that as "keep the cell": a puzzle is only allowed to lose a given when
     uniqueness was actually PROVEN, so the cap can only ever make boards
     easier, never wrong. */
  let nodes = 0;
  let bankrupt = false;
  const rec = () => {
    if (count >= cap || bankrupt) return;
    if (++nodes > nodeBudget) { bankrupt = true; return; }
    let bestI = -1, bestOpts = size + 1;
    for (let i = 0; i < empties.length; i++) {
      const e = empties[i];
      if (e < 0) continue;
      const r = (e / size) | 0, c = e % size;
      const used = rows[r] | cols[c] | boxes[boxAt(r, c, size)];
      let opts = 0;
      for (let v = 1; v <= size; v++) if (!(used & (1 << v))) opts++;
      if (opts === 0) return;
      if (opts < bestOpts) { bestOpts = opts; bestI = i; if (opts === 1) break; }
    }
    if (bestI === -1) { count++; return; }
    const e = empties[bestI];
    empties[bestI] = -1;
    const r = (e / size) | 0, c = e % size, b = boxAt(r, c, size);
    for (let v = 1; v <= size; v++) {
      const bit = 1 << v;
      if ((rows[r] | cols[c] | boxes[b]) & bit) continue;
      rows[r] |= bit; cols[c] |= bit; boxes[b] |= bit;
      g[r][c] = v;
      rec();
      g[r][c] = 0;
      rows[r] &= ~bit; cols[c] &= ~bit; boxes[b] &= ~bit;
      if (count >= cap) break;
    }
    empties[bestI] = e;
  };
  rec();
  return bankrupt ? -1 : count;
}

/* Dig toward a hole count, never breaking uniqueness. Difficulty is RATED
   afterwards rather than steered here: how hard a puzzle plays is a property
   of which techniques the remaining givens force, not of how many were
   removed, and conflating the two is what makes hand-tuned generators produce
   "hard" boards that are actually just sparse. */
function sdkDigUnique(solution, size, holes, rng) {
  const puzzle = solution.map(row => row.slice());
  const order = shuffle(Array.from({ length: size * size }, (_, i) => i), rng);
  let removed = 0;
  for (const p of order) {
    if (removed >= holes) break;
    const r = Math.floor(p / size), c = p % size;
    if (!puzzle[r][c]) continue;
    const keep = puzzle[r][c];
    puzzle[r][c] = 0;
    if (sdkCountSolutions(puzzle, size, 2) === 1) removed += 1;
    else puzzle[r][c] = keep;   // that cell was load-bearing — put it back
  }
  return puzzle;
}

/* ============================================================
   Band selection — MEASURED, not assumed
   ============================================================
   The first cut banded by "which technique does this force", which is how
   Sudoku difficulty is normally described. Measurement killed it:

     - 6×6: over 80 maximally-dug boards, 96% needed nothing beyond naked
       singles. A 2×3-box board with six digits is too tightly constrained for
       a technique ladder to exist at all. Sudoku Mini therefore bands by
       GIVENS — which is what a player actually feels there: how long it takes.
     - 9×9: uniqueness-preserving digs at 36–46 holes run in ~1ms and land on
       naked/hidden singles ~90% of the time. Reaching X-wing-grade boards
       needs a targeted search that costs seconds per board, which cannot run
       at mount time.

   So the ladder is GIVENS for both sizes, and the technique grader keeps two
   jobs it is genuinely good at: rejecting boards that need a GUESS (it found
   that 7 of 40 boards from the old 6×6 generator were unsolvable by logic —
   a real pre-existing bug), and reporting the hardest technique so the
   pre-game screen can name what a band demands.

   Re-measure before retuning these numbers rather than eyeballing them; hole
   count alone predicts felt difficulty better than silhouette does, but only
   inside the range that was actually sampled. */
// Story LEVEL counts, mirroring STORY_BANDS in server.js — the server owns
// what a level is WORTH, the client owns what it looks like, and they must
// agree on how many there are (scripts/check-registry.js asserts it).
const SDK_BAND_COUNT = { sudoku: 6, sudokumini: 6 };
/* #190 — how far back Undo reaches. A cap rather than an unbounded stack
   because the buffer is what the request asks for and because a 9×9 board can
   absorb 60-odd entries in a sitting; 20 is far more than the "I just tapped
   the wrong number" case it exists for. */
const SDK_UNDO_MAX = 20;
// Arcade's three bands map onto the same ladder, so Easy/Normal/Hard are the
// bottom, middle and top of the story range rather than a second scale.
const ARCADE_BAND_ORDER = ['easy', 'normal', 'hard'];

const SDK_HOLE_RANGE = {
  6: { min: 10, max: 20 },
  9: { min: 34, max: 46 },
};

function sdkGenerateForBand(rng, size, band, bandCount) {
  const range = SDK_HOLE_RANGE[size] || SDK_HOLE_RANGE[9];
  const t = bandCount > 1 ? band / (bandCount - 1) : 0;
  const holes = Math.round(range.min + (range.max - range.min) * t);

  let fallback = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const base = size === 9 ? generateSudoku9(rng) : generateSudoku6(rng);
    const puzzle = sdkDigUnique(base.solution, size, holes, rng);
    const graded = sdkSolveGraded(puzzle, size);
    const givens = size * size - puzzle.flat().filter(v => !v).length;
    const out = { solution: base.solution, puzzle, hardest: graded.hardest, givens };
    // A board that needs a guess is not "harder" — it is broken. Reject it.
    if (graded.solved) return out;
    if (!fallback) fallback = out;
  }
  /* Every attempt needed a guess, which is vanishingly unlikely but must not
     hang the mount. Hand back the last board rather than looping forever; it
     is still a valid puzzle, just not guaranteed logic-only. */
  return fallback;
}

// What a band demands, for the pre-game screen. Named from the grader so the
// copy cannot drift from what the board actually is.
function sdkBandLabel(size, band, bandCount) {
  const names = ['Gentle', 'Easy', 'Steady', 'Tricky', 'Tough', 'Fiendish'];
  const i = Math.min(names.length - 1, Math.round((band / Math.max(1, bandCount - 1)) * (names.length - 1)));
  return names[i];
}

function SudokuGame({ onWin, onStepChange, offset, savedProgress, onSaveProgress, gameId, playMode, band }) {
  const dayNum = useRef(utcDayNum(offset)).current;
  /* #176 — the registry entry decides the board size now. Sudoku is the 9×9
     card and Sudoku Mini the 6×6 one, so the in-game chooser is gone: a player
     who wanted the small board picked it on the home screen. The two entries
     also seed from their OWN game id, so they are genuinely separate dailies
     rather than two views of one board. */
  const fixedDifficulty = gameId === 'sudokumini' ? 'mini'
    : gameId === 'sudoku' ? 'classic' : null;
  const seedKey = gameId || 'sudoku';
  const resumedDiff = savedProgress && savedProgress.dayNum === dayNum &&
    (savedProgress.difficulty === 'classic' || savedProgress.difficulty === 'mini')
    ? savedProgress.difficulty
    : (savedProgress && savedProgress.dayNum === dayNum && Array.isArray(savedProgress.grid) && savedProgress.grid.length === 6
      ? 'mini' // pre-difficulty saves were always the 6×6 board
      : null);
  /* ?sdk=9 / ?sdk=6 preselects a board so the grid itself is URL-reachable
     (#149 regression coverage). The chooser renders BEFORE the board, so
     without this no deep link lands on a Sudoku grid at all and dapp.json
     tests — which cannot click — could never assert on it. A resumed
     difficulty still wins, and this deliberately does NOT write progress:
     it only seeds the initial view. */
  const [difficulty, setDifficulty] = useState(() => {
    if (fixedDifficulty) return fixedDifficulty;
    if (resumedDiff) return resumedDiff;
    return sdkDeepLinkDifficulty();
  });
  /* #176 — one board source for all three modes. The daily reads today's
     server seed; story derives a STABLE board per band, so leaving a rung and
     coming back gives the same puzzle rather than a reroll; arcade rolls a
     fresh seed and keeps it so the run can be replayed.

     Story and arcade go through sdkGenerateForBand, which digs to the band's
     measured hole count and rejects any board that would need a guess. The
     daily keeps the original generators untouched so today's board is
     unchanged by any of this. */
  const bandCount = SDK_BAND_COUNT[seedKey] || 6;
  /* #331 — the daily's difficulty band. Easy/Hard run the SAME ladder story
     uses (gentlest / toughest dig through sdkGenerateForBand) off the day's
     band-mixed seed; Normal keeps the original generators and the original
     seed untouched. The band arrives as a STRING — the numeric arcade/story
     band never equals 'easy'/'hard', so the mix can never accidentally fire. */
  const dailyBand = playMode === 'daily' && (band === 'easy' || band === 'hard')
    ? band : null;
  const arcadeIdx = playMode === 'arcade'
    ? Math.max(0, ARCADE_BAND_ORDER.indexOf(band))
    : 0;
  const effBand = playMode === 'story' ? (band || 0)
    : playMode === 'arcade' ? Math.round((arcadeIdx / 2) * (bandCount - 1))
    : dailyBand === 'easy' ? 0
    : dailyBand === 'hard' ? bandCount - 1
    : 0;
  /* #189 — the run's difficulty, named, for the gameplay HUD. Arcade prints
     the band the player PICKED rather than the grader's word for the board it
     maps onto: arcade Normal digs to what sdkBandLabel calls "Tricky", and
     printing that over a run they started by pressing "Normal" reads as a
     different setting than the one they chose. It reads the band off
     arcadeIdx, not off `band`, so an unrecognised id names the board that was
     actually dealt instead of naming nothing. Story has no picker, so it shows
     the rung AND what the grader calls it — that is the first caller
     sdkBandLabel has ever had. Daily and free play have no band, so both
     correctly show nothing at all. */
  const bandName = playMode === 'arcade'
    ? `Difficulty: ${(ARCADE_BANDS[arcadeIdx] || ARCADE_BANDS[0]).label}`
    : playMode === 'story'
      ? `Level ${effBand + 1}: ${sdkBandLabel(difficulty === 'mini' ? 6 : 9, effBand, bandCount)}`
      : dailyBand
        ? `Difficulty: ${dailyBand[0].toUpperCase() + dailyBand.slice(1)}`
        : null;
  const seedRef = useRef(null);
  const boardsRef = useRef({});
  const getBoard = (diff) => {
    if (!boardsRef.current[diff]) {
      const size = diff === 'mini' ? 6 : 9;
      if (playMode === 'story' || playMode === 'arcade') {
        const { rng, seed } = modeSeed(playMode, seedKey, effBand, offset);
        seedRef.current = seed;
        boardsRef.current[diff] = sdkGenerateForBand(rng, size, effBand, bandCount);
      } else if (dailyBand) {
        // #331 — a band daily digs to the same rung story does, off the band's
        // own seed stream. Normal keeps the untouched generators below.
        const rng = dailyRng(offset, seedKey, dailyBand);
        boardsRef.current[diff] = sdkGenerateForBand(rng, size, effBand, bandCount);
      } else if (size === 6) {
        boardsRef.current[diff] = generateSudoku6(dailyRng(offset, seedKey));
      } else {
        /* The 9×9 used to derive a SECOND stream from the 6×6's seed, because
           one registry entry served both boards and they could not share one.
           Sudoku is 9×9-only now (Sudoku Mini is its own entry with its own
           seed row), so it reads its own daily seed directly. Nothing mirrors
           this generator server-side, so the simplification is free. */
        boardsRef.current[diff] = generateSudoku9(dailyRng(offset, seedKey));
      }
    }
    return boardsRef.current[diff];
  };

  const pick = (diff) => {
    const b = getBoard(diff);
    setDifficulty(diff);
    // Persist the pick immediately so a resumed attempt reopens this board.
    onSaveProgress && onSaveProgress(
      { dayNum, grid: b.puzzle.map(row => row.slice()), hintedCells: [], difficulty: diff },
      savedProgress && Number.isFinite(savedProgress.steps) ? savedProgress.steps : 0,
      savedProgress && Number.isFinite(savedProgress.elapsedSecs) ? savedProgress.elapsedSecs : 0
    );
  };

  if (!difficulty) {
    // .fit-col even on the chooser: the game is fitShell:true, and fitShell
    // WITHOUT .fit-col clips instead of fitting. Asserted by registry-fitshell.
    return (
      <div className="fit-col">
      <div className="sdk-choose">
        <div className="sdk-choose-title">Choose your board</div>
        <div className="sdk-choose-sub">One daily attempt either way — the clock starts after you pick.</div>
        <button className="sdk-choice" onClick={() => pick('classic')}>
          <span className="sdk-choice-name">9×9 Classic</span>
          <span className="sdk-choice-note">The full-size grid · ×2 points</span>
        </button>
        <button className="sdk-choice" onClick={() => pick('mini')}>
          <span className="sdk-choice-name">6×6 Mini</span>
          <span className="sdk-choice-note">Quick board · standard points</span>
        </button>
      </div>
      </div>
    );
  }

  return (
    <SudokuBoard
      key={difficulty}
      difficulty={difficulty}
      bandName={bandName}
      board={getBoard(difficulty)}
      dayNum={dayNum}
      savedProgress={savedProgress}
      onWin={onWin}
      onStepChange={onStepChange}
      onSaveProgress={onSaveProgress}
    />
  );
}

function SudokuBoard({ difficulty, bandName, board, dayNum, onWin, onStepChange, savedProgress, onSaveProgress }) {
  const { puzzle, solution } = board;
  const size = puzzle.length;
  const mult = SUDOKU_MULT[difficulty] || 1;

  // Hydrate from a resumed attempt when the saved board is for today's puzzle
  // AND the same board size (a mismatched save is ignored, not corrupted).
  const resumed = savedProgress && savedProgress.dayNum === dayNum &&
    Array.isArray(savedProgress.grid) && savedProgress.grid.length === size
    ? savedProgress
    : null;
  const [grid, setGrid] = useState(() =>
    resumed ? resumed.grid.map(row => row.slice()) : puzzle.map(row => row.slice())
  );
  // Cells revealed by a hint — locked like givens, persisted across resume.
  const [hintedCells, setHintedCells] = useState(() =>
    new Set(resumed && Array.isArray(resumed.hintedCells) ? resumed.hintedCells : [])
  );
  const [selected, setSelected] = useState(null); // [r, c]
  const [errors, setErrors] = useState(() => sudokuConflicts(grid));
  // Steps is a free counter (not encoded in the grid), so restore it whenever
  // the attempt carries one — even if the board itself couldn't be rehydrated.
  const [steps, setSteps] = useState(() => (savedProgress && Number.isFinite(savedProgress.steps) ? savedProgress.steps : 0));
  /* #190 — the last SDK_UNDO_MAX player entries, newest last. Session-scoped
     on purpose: a daily's saved progress is a BOARD SNAPSHOT, not a move list
     (see the progress shapes in CLAUDE.md), so a resumed attempt starts with an
     empty buffer rather than an invented one. Storing a move list would change
     the daily progress shape for every Sudoku row that exists.

     A hint is deliberately NOT pushed here. It reveals a solved cell, locks it,
     and is counted server-side against the day's cap — undoing one would hand
     back a hint the server has already spent. */
  const [undoStack, setUndoStack] = useState([]);
  const [done, setDone] = useState(false);
  const initialSecs = savedProgress && Number.isFinite(savedProgress.elapsedSecs) ? savedProgress.elapsedSecs : 0;
  const { secs, fmt } = useTimer(!done, initialSecs);

  const cellKey = (r, c) => r * size + c;
  const isGiven = (r, c) => puzzle[r][c] !== 0;
  const isLocked = (r, c) => isGiven(r, c) || hintedCells.has(cellKey(r, c));
  const finalScore = (ns, sc) => {
    const base = size === 9
      ? Math.max(1600 - ns * 10 - sc * 2, 300)
      : Math.max(1200 - ns * 15 - sc * 2, 200);
    return Math.round(base * mult);
  };

  // Free hints: total empty cells in the puzzle is the per-day cap.
  const totalEmpty = useRef(puzzle.flat().filter(v => v === 0).length).current;
  const hints = useDailyHints({ gameId: 'sudoku', maxHints: totalEmpty });
  const emptyCells = () => {
    const out = [];
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (grid[r][c] === 0) out.push([r, c]);
    return out;
  };
  const noEmpty = grid.flat().every(v => v !== 0);

  // Idle/leave autosave (timer advance + tab close). Per-move saves happen in place().
  const stateRef = useRef({});
  stateRef.current = { grid, steps, secs, hintedCells };
  useAutosave(
    onSaveProgress,
    () => ({
      progress: { dayNum, grid: stateRef.current.grid, hintedCells: [...stateRef.current.hintedCells], difficulty },
      steps: stateRef.current.steps, secs: stateRef.current.secs,
    }),
    !done
  );

  const saveNow = (ng, ns, hc) =>
    onSaveProgress && onSaveProgress({ dayNum, grid: ng, hintedCells: [...hc], difficulty }, ns, secs);

  // Reveal one correct cell — the selected empty cell if any, else a random one.
  const buyHint = () => {
    if (done || noEmpty) return;
    hints.buy(() => {
      let target = null;
      if (selected && grid[selected[0]][selected[1]] === 0 && !isGiven(selected[0], selected[1])) {
        target = selected;
      } else {
        const empties = emptyCells();
        if (!empties.length) return true; // nothing to reveal (server already charged)
        target = empties[Math.floor(Math.random() * empties.length)];
      }
      const [r, c] = target;
      const ng = grid.map(row => row.slice());
      ng[r][c] = solution[r][c];
      const hc = new Set(hintedCells); hc.add(cellKey(r, c));
      setGrid(ng);
      setHintedCells(hc);
      setErrors(sudokuConflicts(ng));
      saveNow(ng, steps, hc);
      if (sudokuSolved(ng)) {
        setDone(true);
        onWin(finalScore(steps, secs), steps, secs);
      }
      return true;
    });
  };

  const place = (val) => {
    if (done || !selected) return;
    const [r, c] = selected;
    if (isLocked(r, c)) return;

    const prev = grid[r][c];
    if (prev === val) return; // nothing changed, nothing to remember
    const ng = grid.map(row => row.slice());
    ng[r][c] = val;
    setGrid(ng);
    setUndoStack(st => [...st, { r, c, prev, steps }].slice(-SDK_UNDO_MAX));

    const newSteps = steps + 1;
    setSteps(newSteps);
    onStepChange(newSteps);

    // recompute conflict highlighting from the full grid
    setErrors(sudokuConflicts(ng));

    // persist this move immediately
    saveNow(ng, newSteps, hintedCells);

    // win check — fully filled and no conflicts
    if (sudokuSolved(ng)) {
      setDone(true);
      onWin(finalScore(newSteps, secs), newSteps, secs);
    }
  };

  /* Step back one entry. The step COUNTER rolls back with it, matching
     Knight's Tour, which is the app's existing undo. That is not a free
     rewind: the clock keeps running and the score reads both, so undoing is
     paid for in time rather than in moves. */
  const undo = () => {
    if (done || undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    const ng = grid.map(row => row.slice());
    ng[last.r][last.c] = last.prev;
    setGrid(ng);
    setUndoStack(undoStack.slice(0, -1));
    setSelected([last.r, last.c]); // show WHERE it went back to
    setSteps(last.steps);
    onStepChange(last.steps);
    setErrors(sudokuConflicts(ng));
    saveNow(ng, last.steps, hintedCells);
  };

  const selKey = selected ? `${selected[0]},${selected[1]}` : null;
  const selBox = selected ? boxAt(selected[0], selected[1], size) : -1;
  const boldRight = (c) => size === 9 ? (c === 2 || c === 5) : c === 2;
  const boldBottom = (r) => size === 9 ? (r === 2 || r === 5) : (r === 1 || r === 3);

  /* The whole game frame is ONE canvas now (controls wave): pills, grid,
     hint bar and numpad draw together, with <CuiTwin> carrying the real
     hidden buttons. Cell chrome reads PAL; the box separators keep #149's
     rule (they out-read the 1px gridlines by using the muted tone). */
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const { boxW, boxH } = useFitBox(boxRef, { cols: 1, rows: 1, maxCell: 100000 });
  const W = Math.floor(boxW);
  const GAP = 8, PILL_H = 46, HINT_H = 36, KEY_H = 44, ERASE_H = 38;
  /* #189 — the difficulty line is its own track under the pills, and it costs
     nothing in the two modes that have no difficulty to name: BAND_H is 0
     there, so the daily's board is the same size it has always been. The
     spacing is baked into the track rather than added as a fifth GAP, so the
     board's y only has one term to keep in step with `chrome`. */
  const BAND_H = bandName ? 20 : 0;
  const chrome = PILL_H + BAND_H + HINT_H + KEY_H + ERASE_H + GAP * 4;
  const availB = Math.max(0, Math.min(W, Math.floor(boxH) - chrome));
  /* #323 — the 44/56px caps are finger-size for phones. On a desktop box
     (wider than the old 620px column) let cells grow with the space the fit
     column affords; availB still bounds them by height, so the board never
     outgrows the window. Phones keep the old caps. */
  const sdkCellCap = W > 620 ? Infinity : (size === 9 ? 44 : 56);
  const sdkCell = Math.max(24, Math.min(sdkCellCap, Math.floor((availB - (size - 1)) / size)));
  const sdkStep = sdkCell + 1;
  const sdkSide = sdkStep * size - 1;
  const H = chrome + sdkSide;
  const boardX = Math.floor((W - sdkSide) / 2);
  const boardY = PILL_H + BAND_H + GAP;
  const hintY = boardY + sdkSide + GAP;
  const keysY = hintY + HINT_H + GAP;
  const eraseY = keysY + KEY_H + GAP;

  const filled = grid.flat().filter(v => v !== 0).length;
  const controls = [];
  if (W > 80) {
    const pr = cuiRow(0, 0, W, PILL_H, 4);
    controls.push({ id: 'p-time', kind: 'pill', r: pr[0], label: 'Time', value: fmt, gold: true });
    controls.push({ id: 'p-steps', kind: 'pill', r: pr[1], label: 'Steps', value: steps });
    controls.push({ id: 'p-filled', kind: 'pill', r: pr[2], label: 'Filled', value: `${filled}/${size * size}` });
    controls.push({ id: 'p-board', kind: 'pill', r: pr[3], label: 'Board', value: size === 9 ? '9×9 ×2' : '6×6' });
    if (bandName) {
      /* Gold and bold, not the label default: PAL.muted under a row of pills
         reads as a caption on the pills rather than as the run's own setting,
         and #189 asks for the difficulty to be HIGHLIGHTED. `gold` resolves at
         DRAW time, so a theme flip recolours it — an explicit colour here
         would be captured at render and go stale. */
      controls.push({ id: 'p-band', kind: 'label', r: [0, PILL_H, W, BAND_H], label: bandName, font: 12, bold: true, gold: true });
    }
    if (!done) {
      const exhausted = hints.exhausted || noEmpty;
      controls.push({
        id: 'hint', kind: 'button',
        r: [hints.msg ? 0 : Math.floor(W * 0.2), hintY, hints.msg ? Math.floor(W * 0.48) : Math.floor(W * 0.6), HINT_H],
        label: exhausted ? `💡 ${noEmpty ? 'Board full' : 'No more hints'}`
          : `💡 Hint${Number.isFinite(hints.hintsLeft) ? ` · ${hints.hintsLeft} left` : ''}`,
        disabled: hints.buying || exhausted,
        action: buyHint,
      });
      if (hints.msg) {
        controls.push({ id: 'hint-msg', kind: 'label', r: [Math.floor(W * 0.5), hintY, Math.floor(W * 0.5), HINT_H], label: hints.msg, font: 11 });
      }
      const kr = cuiRow(0, keysY, W, KEY_H, size, 6);
      for (let n = 1; n <= size; n++) {
        controls.push({ id: 'k' + n, kind: 'button', r: kr[n - 1], label: String(n), mono: true, font: 18, action: () => place(n) });
      }
      /* #190 — Erase gives up its second half to Undo. They share a row
         because they are the same kind of action (take that back), and the
         hint row above is not available: its right half is already the hint
         message's, so a button there would appear and disappear as messages
         come and go. */
      const half = Math.floor((W - 6) / 2);
      controls.push({ id: 'erase', kind: 'button', r: [0, eraseY, half, ERASE_H], label: 'Erase', action: () => place(0) });
      controls.push({
        id: 'undo', kind: 'button', r: [W - half, eraseY, half, ERASE_H],
        label: undoStack.length ? `↩ Undo · ${undoStack.length}` : '↩ Undo',
        disabled: undoStack.length === 0,
        action: undo,
      });
    }
  }
  const ctlRef = useRef([]);
  ctlRef.current = controls;
  const [pressedId, setPressedId] = useState(null);

  const sdkGeoRef = useRef({});
  sdkGeoRef.current = { sdkStep, size, done, boardX, boardY, sdkSide };
  usePointerCell(canvasRef, cuiWrapHandlers(ctlRef, setPressedId, {
    onTap: (p) => {
      const g = sdkGeoRef.current;
      if (g.done) return;
      const c = Math.floor((p.x - g.boardX) / g.sdkStep), r = Math.floor((p.y - g.boardY) / g.sdkStep);
      if (c < 0 || c >= g.size || r < 0 || r >= g.size) return;
      const locked = isGiven(r, c) || hintedCells.has(cellKey(r, c));
      if (!locked) setSelected([r, c]);
    },
  }));
  useCanvasBoard(canvasRef, {
    width: W,
    height: H,
    deps: [grid, selected, errors, hintedCells, done, sdkCell, W, fmt, steps, pressedId, bandName, undoStack.length, hints.hintsLeft, hints.msg, hints.buying],
    draw: (ctx) => {
      cuiDrawControls(ctx, ctlRef.current, pressedId);
      drawBoardPlate(ctx, boardX, boardY, sdkSide, sdkSide, { pad: 6, W, H, radius: 8 });
      ctx.save();
      ctx.translate(boardX, boardY);
      ctx.fillStyle = PAL.border; // 1px gridlines (#149's gap idiom, drawn)
      ctx.fillRect(0, 0, sdkSide, sdkSide);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          const key = `${r},${c}`;
          const x = c * sdkStep, y = r * sdkStep;
          const given = isGiven(r, c);
          const hinted = hintedCells.has(cellKey(r, c));
          const isSel = selKey === key;
          const isHl = !isSel && selected &&
            (selected[0] === r || selected[1] === c || boxAt(r, c, size) === selBox);
          const isErr = errors.has(key);
          let bg = PAL.card;
          if (isErr) bg = 'rgba(205,75,58,0.12)';
          else if (isSel) bg = 'rgba(58,110,205,0.28)';
          else if (isHl) bg = 'rgba(58,110,205,0.06)';
          else if (hinted) bg = 'rgba(201,162,39,0.12)';
          ctx.fillStyle = bg;
          ctx.fillRect(x, y, sdkCell, sdkCell);
          const v = grid[r][c];
          if (v !== 0) {
            ctx.font = `600 ${Math.round(sdkCell * (size === 9 ? 0.5 : 0.55))}px 'JetBrains Mono', monospace`;
            ctx.fillStyle = isErr ? PAL.rose : given ? PAL.text : hinted ? PAL.gold : PAL.accent;
            ctx.fillText(String(v), x + sdkCell / 2, y + sdkCell / 2 + 1);
          }
        }
      }
      // Box separators over the gridlines (the #149 contrast rule).
      ctx.strokeStyle = PAL.muted;
      ctx.lineWidth = 2;
      for (let c = 0; c < size; c++) {
        if (!boldRight(c)) continue;
        const x = (c + 1) * sdkStep - 0.5;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, sdkSide); ctx.stroke();
      }
      for (let r = 0; r < size; r++) {
        if (!boldBottom(r)) continue;
        const y = (r + 1) * sdkStep - 0.5;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(sdkSide, y); ctx.stroke();
      }
      ctx.restore();
    },
  });

  return (
    <div className="fit-col">
      <div className={'sudoku cui-frame' + (size === 9 ? ' s9' : '')} ref={boxRef}>
        <canvas
          ref={canvasRef}
          className="sdk-canvas board-canvas"
          data-board="paper"
          role="grid"
          aria-label={`Sudoku ${size} by ${size} board — ${filled} of ${size * size} filled`}
        />
      </div>
      <CuiTwin controls={controls} />
    </div>
  );
}
