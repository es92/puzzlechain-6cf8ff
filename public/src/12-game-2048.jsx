/* ============================================================
   2048 helpers
   ============================================================ */
const T2048_BOARD_KEY   = 'puzzlechain_2048_board';
const T2048_BEST_KEY    = 'puzzlechain_2048_best';
const T2048_UNDO_KEY    = 'puzzlechain_2048_undo';
const T2048_HISTORY_KEY = 'puzzlechain_2048_history';
const T2048_HISTORY_MAX = 50;

let t2048TileCounter = 0;

const T2048_COLORS = {
  2:    { bg: '#2E3038', color: '#8B9196' },
  4:    { bg: '#363B45', color: '#A0A7B0' },
  8:    { bg: '#B5630A', color: '#FFF' },
  16:   { bg: '#D4720E', color: '#FFF' },
  32:   { bg: '#C2410C', color: '#FFF' },
  64:   { bg: '#9D174D', color: '#FFF' },
  128:  { bg: '#5B21B6', color: '#FFF' },
  256:  { bg: '#1D4ED8', color: '#FFF' },
  512:  { bg: '#0369A1', color: '#FFF' },
  1024: { bg: '#0F766E', color: '#FFF' },
  2048: { bg: '#92400E', color: '#FEF3C7' },
};

function t2048_tileStyle(value) {
  if (T2048_COLORS[value]) return T2048_COLORS[value];
  const palette = ['#3b82f6', '#8b5cf6', '#f43f5e', '#10b981', '#f59e0b'];
  return { bg: palette[Math.floor(Math.log2(value)) % palette.length], color: '#FFF' };
}

function t2048_newTile(value, isNew, isMerged) {
  return { value, id: ++t2048TileCounter, isNew: !!isNew, isMerged: !!isMerged };
}

function t2048_emptyCells(grid) {
  const out = [];
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      if (!grid[r][c]) out.push([r, c]);
  return out;
}

/* #176 — 2048's daily seeds the SPAWN STREAM, not the board.
   Spawns land in whichever cells happen to be free, so two players making
   different moves diverge immediately: this game cannot promise "everyone
   plays the same board" the way a dealt puzzle can. What it CAN promise is the
   same stream of (value, index-into-free-cells) draws, which keeps the run
   fair without pretending to a stronger guarantee. That is a deliberate
   product call — a fun thing for the day rather than a strict shared deal —
   and the pre-game copy says so rather than letting it read as a bug. */
/* #176 arcade bands — the FOUR-RATE, which is 2048's one honest difficulty
   dial. The board is 4x4 in every mode (changing that would change the game,
   not its difficulty), and the tile values, merge rules and win target are all
   fixed by the game itself. What is left is how often a spawn is a 4 instead
   of a 2: more 4s fill the board faster and break the chains you are trying to
   build, which is exactly the pressure a "hard" band should add. 0.10 is the
   standard rate, so Normal is the classic game unchanged. */
const T2048_FOUR_RATE = { easy: 0.05, normal: 0.10, hard: 0.30 };
const T2048_DEFAULT_FOUR = 0.10;

function t2048_addRandom(grid, rng, fourRate) {
  const r0 = rng || Math.random;
  const empties = t2048_emptyCells(grid);
  if (!empties.length) return grid;
  const [r, c] = empties[Math.floor(r0() * empties.length)];
  const next = grid.map(row => [...row]);
  const four = Number.isFinite(fourRate) ? fourRate : T2048_DEFAULT_FOUR;
  next[r][c] = t2048_newTile(r0() < 1 - four ? 2 : 4, true, false);
  return next;
}

function t2048_initGrid(rng, fourRate) {
  let g = [[null,null,null,null],[null,null,null,null],[null,null,null,null],[null,null,null,null]];
  g = t2048_addRandom(g, rng, fourRate);
  g = t2048_addRandom(g, rng, fourRate);
  return g;
}

function t2048_slideRowLeft(row) {
  const tiles = row.filter(Boolean);
  let delta = 0;
  const out = [];
  let i = 0;
  while (i < tiles.length) {
    if (i + 1 < tiles.length && tiles[i].value === tiles[i + 1].value) {
      const val = tiles[i].value * 2;
      delta += val;
      out.push(t2048_newTile(val, false, true));
      i += 2;
    } else {
      out.push({ ...tiles[i], isNew: false, isMerged: false });
      i++;
    }
  }
  const newRow = [...out, null, null, null, null].slice(0, 4);
  let moved = false;
  for (let j = 0; j < 4; j++) {
    const ov = row[j] ? row[j].value : 0;
    const nv = newRow[j] ? newRow[j].value : 0;
    if (ov !== nv) { moved = true; break; }
  }
  return { row: newRow, delta, moved };
}

function t2048_rotateCW(g) {
  return Array.from({length:4},(_,c)=>Array.from({length:4},(_,r)=>g[3-r][c]));
}
function t2048_rotateCCW(g) {
  return Array.from({length:4},(_,c)=>Array.from({length:4},(_,r)=>g[r][3-c]));
}
function t2048_rot180(g) { return t2048_rotateCW(t2048_rotateCW(g)); }

/* #143 — vertical swipes were INVERTED (up moved tiles down and vice versa),
   including the arrow keys, which share this function through executeMove.
   The gesture math was fine: useGestures (shared with Snake and Daily Snake)
   reports the right direction. The bug was here.

   Everything slides LEFT after rotation, so the rotation has to put the
   direction of travel at index 0 of each row:
     rotateCCW row i = [g[0][3-i] … g[3][3-i]]  — a column TOP→BOTTOM  ⇒ 'up'
     rotateCW  row i = [g[3][i]   … g[0][i]  ]  — a column BOTTOM→TOP  ⇒ 'down'
   The code had those two swapped (and the un-rotation swapped to match, which
   is why the board stayed self-consistent and the bug looked like a gesture
   problem). Covered by the t2048-up / t2048-down load-time self-tests. */
function t2048_move(grid, dir) {
  let g = grid;
  if (dir === 'right') g = t2048_rot180(g);
  else if (dir === 'up')   g = t2048_rotateCCW(g);
  else if (dir === 'down') g = t2048_rotateCW(g);
  let totalDelta = 0, anyMoved = false;
  const next = g.map(row => {
    const { row: nr, delta, moved } = t2048_slideRowLeft(row);
    totalDelta += delta;
    if (moved) anyMoved = true;
    return nr;
  });
  let result = next;
  if (dir === 'right') result = t2048_rot180(next);
  else if (dir === 'up')   result = t2048_rotateCW(next);
  else if (dir === 'down') result = t2048_rotateCCW(next);
  return { grid: result, delta: totalDelta, moved: anyMoved };
}

function t2048_hasMove(grid) {
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      if (!grid[r][c]) return true;
      const v = grid[r][c].value;
      if (c + 1 < 4 && grid[r][c+1] && grid[r][c+1].value === v) return true;
      if (r + 1 < 4 && grid[r+1][c] && grid[r+1][c].value === v) return true;
    }
  return false;
}

function t2048_maxTile(grid) {
  let max = 0;
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      if (grid[r][c] && grid[r][c].value > max) max = grid[r][c].value;
  return max;
}

function t2048_toShareText(score, moves, secs, highTile) {
  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  return '2048 🔢 Score: ' + score.toLocaleString() + '\nHighest tile: ' + highTile + ' 🏆\nMoves: ' + moves + ' | Time: ' + mm + ':' + ss + '\nPlay at Game Corner';
}

function t2048_stripAnim(grid) {
  return grid.map(row => row.map(cell =>
    cell ? { value: cell.value, id: cell.id, isNew: false, isMerged: false } : null
  ));
}

function t2048LoadHistory() { return loadHistory(T2048_HISTORY_KEY); }
function t2048SaveEntry(entry) { saveHistory(T2048_HISTORY_KEY, entry, T2048_HISTORY_MAX); }
function t2048LoadSavedBoard() {
  try {
    const raw = localStorage.getItem(T2048_BOARD_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return { ...p, grid: t2048_stripAnim(p.grid) };
  } catch { return null; }
}
function t2048SaveBoard(grid, score, elapsed, won, moves) {
  try {
    localStorage.setItem(T2048_BOARD_KEY, JSON.stringify({
      grid: t2048_stripAnim(grid), score, elapsed, won, moves: moves || 0
    }));
  } catch {}
}
function t2048ClearBoard() {
  try { localStorage.removeItem(T2048_BOARD_KEY); } catch {}
}
function t2048LoadBest() {
  try { return parseInt(localStorage.getItem(T2048_BEST_KEY) || '0', 10) || 0; }
  catch { return 0; }
}
function t2048SaveBest(v) {
  try { localStorage.setItem(T2048_BEST_KEY, String(v)); } catch {}
}

/* ============================================================
   T2048Game component
   ============================================================ */
/* The 2048 board as a canvas (#170 treatment), keeping #142's animation
   contract: tiles are tracked BY ID, so a move draws each tile sliding from
   its previous cell to its new one (100ms), new tiles pop in and merges
   bump — and input is never gated on the animation (executeMove stays
   synchronous; the drawing catches up). Tile faces keep the intrinsic 2048
   palette; the backdrop reads PAL. Reduced-motion players get instant
   placement, matching the old CSS media block. */
function T2048BoardCanvas({ grid }) {
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const { boxW } = useFitBox(boxRef, { cols: 4, rows: 4 });
  const side = Math.max(0, Math.floor(boxW));
  const pad = 8, gap = 6;
  const cell = (side - pad * 2 - gap * 3) / 4;

  const animRef = useRef({ prev: {}, t0: 0, reduced: false });
  const [, setFrame] = useState(0);
  useEffect(() => {
    const a = animRef.current;
    const targets = {};
    grid.forEach((row, r) => row.forEach((t, c) => { if (t) targets[t.id] = { r, c }; }));
    a.from = a.prev;
    a.targets = targets;
    a.prev = targets;
    a.reduced = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    a.t0 = a.reduced ? -1e9 : performance.now();
    if (a.reduced) { setFrame((f) => f + 1); return; }
    let raf = 0;
    const tick = () => {
      setFrame((f) => f + 1);
      if (performance.now() - a.t0 < 170) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [grid]);

  useCanvasBoard(canvasRef, {
    width: side,
    height: side,
    deps: [grid, side],
    draw: (ctx) => {
      if (side < 60) return;
      const a = animRef.current;
      const now = performance.now();
      const slideP = Math.min(1, (now - a.t0) / 100);
      const ease = 1 - (1 - slideP) * (1 - slideP);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // Static 4x4 backdrop.
      for (let i = 0; i < 16; i++) {
        const r = Math.floor(i / 4), c = i % 4;
        const x = pad + c * (cell + gap), y = pad + r * (cell + gap);
        klRR(ctx, x, y, cell, cell, 8);
        ctx.fillStyle = PAL.bg;
        ctx.fill();
        ctx.save();
        ctx.globalAlpha = 0.27;
        ctx.lineWidth = 1;
        ctx.strokeStyle = PAL.border;
        ctx.stroke();
        ctx.restore();
      }
      const at = (r, c) => [pad + c * (cell + gap), pad + r * (cell + gap)];
      grid.forEach((row, r) => row.forEach((t, c) => {
        if (!t) return;
        const from = a.from && a.from[t.id];
        const [tx, ty] = at(r, c);
        let x = tx, y = ty;
        if (from && (from.r !== r || from.c !== c)) {
          const [fx, fy] = at(from.r, from.c);
          x = fx + (tx - fx) * ease;
          y = fy + (ty - fy) * ease;
        }
        let scale = 1, alpha = 1;
        if (!a.reduced) {
          if (t.isNew && !from) {
            const p = Math.min(1, (now - a.t0) / 120);
            scale = 0.5 + 0.5 * p;
            alpha = p;
          } else if (t.isMerged) {
            const p = Math.min(1, (now - a.t0) / 150);
            scale = 1 + 0.18 * Math.sin(p * Math.PI);
          }
        }
        const { bg, color } = t2048_tileStyle(t.value);
        const cx = x + cell / 2, cy = y + cell / 2;
        const s = cell * scale;
        ctx.save();
        ctx.globalAlpha = alpha;
        klRR(ctx, cx - s / 2, cy - s / 2, s, s, 8 * scale);
        ctx.fillStyle = bg;
        if (t.value === 2048) {
          ctx.shadowColor = 'rgba(245,158,11,0.55)';
          ctx.shadowBlur = 14;
        }
        ctx.fill();
        ctx.shadowBlur = 0;
        const len = String(t.value).length;
        ctx.font = `700 ${Math.round(cell * (len <= 2 ? 0.45 : len === 3 ? 0.37 : len === 4 ? 0.3 : 0.24))}px 'JetBrains Mono', monospace`;
        ctx.fillStyle = color;
        ctx.fillText(String(t.value), cx, cy + 1);
        ctx.restore();
      }));
    },
  });

  return (
    <div className="t2048-canvas-fill" ref={boxRef}>
      <canvas
        ref={canvasRef}
        className="t2048-canvas board-canvas"
        role="img"
        aria-label={`2048 board — highest tile ${t2048_maxTile(grid) || 0}`}
      />
    </div>
  );
}

function T2048Solo({ onWin, onLose, onStepChange, resetKey, onRaceEnd, playMode, band, offset }) {
  /* #204 — the arcade band, named. Only arcade has one: the daily is a fixed
     deal and free play has no band, so both correctly show nothing. */
  const bandLabel = playMode === 'arcade'
    ? ((ARCADE_BANDS.find((b) => b.id === band) || {}).label || null)
    : null;
  // Arcade picks a four-rate; the daily's Easy/Hard (#331) borrow the same
  // dial — fewer 4s on Easy, many more on Hard — and every other mode plays
  // the standard one.
  const dailyBand = playMode === 'daily' && (band === 'easy' || band === 'hard') ? band : null;
  const fourRate = playMode === 'arcade'
    ? (T2048_FOUR_RATE[band] || T2048_DEFAULT_FOUR)
    : dailyBand
      ? T2048_FOUR_RATE[dailyBand]
      : T2048_DEFAULT_FOUR;
  /* One spawn stream for the run. Free play keeps Math.random (null), so the
     saved-board resume and the all-time leaderboard behave exactly as before. */
  const rngRef = useRef(undefined);
  if (rngRef.current === undefined) {
    rngRef.current = (playMode === 'daily' || playMode === 'arcade')
      ? modeSeed(playMode, '2048', dailyBand || 0, offset).rng
      : null;
  }
  const t2048Rng = rngRef.current;
  const raceMode = !!onRaceEnd;
  /* The saved board is a single localStorage key belonging to FREE PLAY. A
     daily or arcade run must not hydrate from it (it would replace the seeded
     opening with someone's half-finished classic game) and must not write to
     it (it would clobber that game). Both modes are self-contained runs. */
  const seededRun = playMode === 'daily' || playMode === 'arcade';
  const _saved = (raceMode || seededRun) ? null : t2048LoadSavedBoard();

  const [grid, setGrid]               = useState(() => _saved ? _saved.grid : t2048_initGrid(t2048Rng, fourRate));
  const [score, setScore]             = useState(() => _saved ? _saved.score || 0 : 0);
  const [moves, setMoves]             = useState(() => _saved ? _saved.moves || 0 : 0);
  const [elapsedSecs, setElapsedSecs] = useState(() => _saved ? _saved.elapsed || 0 : 0);
  const [done, setDone]               = useState(false);
  const [hasWon, setHasWon]           = useState(() => _saved ? _saved.won || false : false);
  const [victoryVisible, setVictoryVisible] = useState(false);
  const [activeTab, setActiveTab]     = useState('game');
  const [history, setHistory]         = useState(() => t2048LoadHistory());
  const [bestScore, setBestScore]     = useState(() => t2048LoadBest());
  const [scoreDelta, setScoreDelta]   = useState(null);

  const touchStartRef  = useRef(null);
  const deltaTimerRef  = useRef(null);
  const executeMoveRef = useRef(null);

  const gameRunning = !done && !victoryVisible && activeTab === 'game';

  useEffect(() => {
    if (!gameRunning) return;
    const id = setInterval(() => setElapsedSecs(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [gameRunning]);

  useEffect(() => {
    if (!resetKey) return;
    handleNewGame();
  }, [resetKey]);

  // Clear animation flags after 200ms
  useEffect(() => {
    const hasTmp = grid.some(row => row.some(c => c && (c.isNew || c.isMerged)));
    if (!hasTmp) return;
    const id = setTimeout(() => {
      setGrid(g => g.map(row => row.map(c =>
        c && (c.isNew || c.isMerged) ? { ...c, isNew: false, isMerged: false } : c
      )));
    }, 200);
    return () => clearTimeout(id);
  }, [grid]);

  // Keyboard handler — always reads fresh executeMove via ref
  useEffect(() => {
    const handler = (e) => {
      const dirs = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
      if (dirs[e.key]) {
        e.preventDefault();
        if (executeMoveRef.current) executeMoveRef.current(dirs[e.key]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const fmtSecs = s => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  const fmtDate = d => {
    if (!d) return '';
    const [y, m, day] = d.split('-');
    return m + '/' + day + '/' + y.slice(2);
  };

  const handleNewGame = () => {
    t2048ClearBoard();
    try { localStorage.removeItem(T2048_UNDO_KEY); } catch {}
    setGrid(t2048_initGrid(t2048Rng, fourRate));
    setScore(0);
    setMoves(0);
    setElapsedSecs(0);
    setDone(false);
    setHasWon(false);
    setVictoryVisible(false);
    setScoreDelta(null);
  };

  const executeMove = (dir) => {
    if (done || victoryVisible || activeTab !== 'game') return;
    const { grid: movedGrid, delta, moved } = t2048_move(grid, dir);
    if (!moved) return;

    const withTile  = t2048_addRandom(movedGrid, t2048Rng, fourRate);
    const newScore  = score + delta;
    const newMoves  = moves + 1;

    setGrid(withTile);
    setScore(newScore);
    setMoves(newMoves);

    if (delta > 0) {
      if (deltaTimerRef.current) clearTimeout(deltaTimerRef.current);
      setScoreDelta(delta);
      deltaTimerRef.current = setTimeout(() => setScoreDelta(null), 600);
    }

    if (newScore > bestScore) { setBestScore(newScore); t2048SaveBest(newScore); }
    if (!seededRun) t2048SaveBoard(withTile, newScore, elapsedSecs, hasWon, newMoves);
    onStepChange && onStepChange(newMoves);

    const maxT = t2048_maxTile(withTile);
    if (maxT >= 2048 && !hasWon) {
      setHasWon(true);
      setVictoryVisible(true);
      return;
    }
    if (!t2048_hasMove(withTile)) {
      setDone(true);
      const entry = {
        id: Date.now(),
        date: new Date().toISOString().slice(0, 10),
        outcome: 'loss',
        score: newScore,
        moves: newMoves,
        secs: elapsedSecs,
        highTile: maxT,
      };
      t2048SaveEntry(entry);
      t2048ClearBoard();
      if (onRaceEnd) { onRaceEnd(newScore); return; }
      submitClassicScore('2048', newScore, { highTile: maxT });
      /* PHASE 3 (#161) — the jammed board's score is the run's result. It was
         already going to /api/classic/2048/score on the line above, but the
         end screen hard-coded "Earned +0", so a 20-minute run read as worth
         nothing. `score` is what the card shows; scoreLabel/scoreValue add the
         highest-tile row next to it. */
      onLose && onLose(newMoves, elapsedSecs, {
        score: newScore,
        scoreLabel: 'Highest tile',
        scoreValue: maxT,
        share: t2048_toShareText(newScore, newMoves, elapsedSecs, maxT),
        answer: String(maxT),
      });
    }
  };

  // Keep ref fresh on every render so the keyboard handler always calls the latest closure
  executeMoveRef.current = executeMove;

  const handleFinish = () => {
    const maxT = t2048_maxTile(grid);
    t2048SaveEntry({
      id: Date.now(),
      date: new Date().toISOString().slice(0, 10),
      outcome: 'win',
      score,
      moves,
      secs: elapsedSecs,
      highTile: maxT,
    });
    t2048ClearBoard();
    if (onRaceEnd) { onRaceEnd(score); return; }
    submitClassicScore('2048', score, { highTile: maxT });
    onWin && onWin(score, moves, elapsedSecs, {
      share: t2048_toShareText(score, moves, elapsedSecs, maxT),
    });
  };

  const handleTouchStart = (e) => {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  };
  const handleTouchEnd = (e) => {
    if (!touchStartRef.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartRef.current.x;
    const dy = t.clientY - touchStartRef.current.y;
    touchStartRef.current = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 40) return;
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    executeMove(dir);
  };

  const maxTile = t2048_maxTile(grid);

  // Inline stats computation (same pattern as Mancala)
  const histStats = history.length ? (() => {
    const gp = history.length;
    const gw = history.filter(h => h.outcome === 'win').length;
    const hs = Math.max(0, ...history.map(h => h.score));
    const ht = Math.max(0, ...history.map(h => h.highTile));
    const avg = Math.round(history.reduce((a, h) => a + h.score, 0) / gp);
    const tm  = history.reduce((a, h) => a + h.moves, 0);
    const ls  = Math.max(0, ...history.map(h => h.secs));
    const fmtDur = s => {
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
      return h > 0 ? h + 'h ' + m + 'm' : m + 'm ' + sec + 's';
    };
    return { gp, gw, hs, ht, avg, tm, ls: fmtDur(ls) };
  })() : null;

  return (
    <div>

      {activeTab === 'game' && (
        <div>
          {/* #204 — the arcade band is 2048's difficulty, and once the run
              started nothing on screen said which one you had picked. It is a
              real difference in play (the four-rate: 5%, 10% or 30% of spawns
              are a 4), so a score is not comparable without it. Rendered as a
              line under the pills rather than a sixth pill, which would not
              fit five-across on a phone. */}
          <CuiBar height={bandLabel ? 66 : 46} build={(W) => {
            const pr = cuiRow(0, 0, W, 46, 5);
            const out = [
              { id: 'p-score', kind: 'pill', r: pr[0], label: 'Score', value: score.toLocaleString() + (scoreDelta !== null ? ` +${scoreDelta}` : '') },
              { id: 'p-best', kind: 'pill', r: pr[1], label: 'Best', value: bestScore.toLocaleString() },
              { id: 'p-tile', kind: 'pill', r: pr[2], label: 'Tile', value: maxTile || '—' },
              { id: 'p-moves', kind: 'pill', r: pr[3], label: 'Moves', value: moves },
              { id: 'p-time', kind: 'pill', r: pr[4], label: 'Time', value: fmtSecs(elapsedSecs), gold: true },
            ];
            if (bandLabel) {
              out.push({
                id: 'p-band', kind: 'label', r: [0, 48, W, 18], font: 12, color: PAL.muted,
                label: `Difficulty: ${bandLabel}`,
              });
            }
            return out;
          }} />

          <div
            className="t2048-board-wrap"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <div className="t2048-grid">
              <T2048BoardCanvas grid={grid} />
            </div>

            {victoryVisible && (
              <div className="t2048-overlay">
                <div style={{ fontSize: '2rem' }}>🎉</div>
                <h3 style={{ color: C.gold }}>You did it!</h3>
                <div className="t2048-overlay-score">{score.toLocaleString()}</div>
                <div style={{ fontSize: '0.75rem', color: C.muted }}>Keep playing for a higher score</div>
                <div className="t2048-overlay-btns">
                  <button className="t2048-keep-btn" onClick={() => setVictoryVisible(false)}>Keep Going</button>
                  <button className="t2048-finish-btn" onClick={handleFinish}>Finish</button>
                </div>
              </div>
            )}
          </div>

          <CuiBar height={44} build={(W) => ([
            { id: 'new', kind: 'button', r: [Math.floor(W * 0.3), 0, Math.floor(W * 0.4), 40], label: '↺ New Game', action: handleNewGame },
          ])} />
        </div>
      )}

      {activeTab === 'leaderboard' && (
        <div style={{ padding: '0.5rem 0.25rem' }}>
          <ClassicLeaderboard gameId="2048" />
        </div>
      )}

      {activeTab === 'history' && (
        <div>
          <div className="t2048-history-list">
            {history.length === 0
              ? <div className="t2048-empty-state">No games recorded yet</div>
              : history.map(h => (
                <div key={h.id} className="t2048-history-row">
                  <span className={'t2048-outcome-chip ' + h.outcome}>{h.outcome === 'win' ? 'Win' : 'Loss'}</span>
                  <span style={{ color: C.muted, fontSize: '0.75rem' }}>{fmtDate(h.date)}</span>
                  <span className="mono" style={{ color: C.gold }}>{h.score.toLocaleString()}</span>
                  <span style={{ color: C.muted, fontSize: '0.75rem' }}>×{h.highTile}</span>
                  <span style={{ color: C.muted, fontSize: '0.75rem' }}>{h.moves}mv · {fmtSecs(h.secs)}</span>
                </div>
              ))
            }
          </div>
        </div>
      )}

      {activeTab === 'stats' && (
        <div>
          {!histStats
            ? <div className="t2048-empty-state">No games recorded yet</div>
            : (
              <div className="t2048-stats-grid">
                <div className="t2048-stat-card">
                  <div className="t2048-stat-val">{histStats.gp}</div>
                  <div className="t2048-stat-lbl">Played</div>
                </div>
                <div className="t2048-stat-card">
                  <div className="t2048-stat-val" style={{ color: C.emerald }}>{histStats.gw}</div>
                  <div className="t2048-stat-lbl">Won</div>
                </div>
                <div className="t2048-stat-card">
                  <div className="t2048-stat-val">{histStats.hs.toLocaleString()}</div>
                  <div className="t2048-stat-lbl">Best Score</div>
                </div>
                <div className="t2048-stat-card">
                  <div className="t2048-stat-val" style={{ color: C.gold }}>{histStats.ht}</div>
                  <div className="t2048-stat-lbl">Best Tile</div>
                </div>
                <div className="t2048-stat-card">
                  <div className="t2048-stat-val">{histStats.avg.toLocaleString()}</div>
                  <div className="t2048-stat-lbl">Avg Score</div>
                </div>
                <div className="t2048-stat-card">
                  <div className="t2048-stat-val">{histStats.tm.toLocaleString()}</div>
                  <div className="t2048-stat-lbl">Total Moves</div>
                </div>
                <div className="t2048-stat-card" style={{ gridColumn: '1 / 3' }}>
                  <div className="t2048-stat-val">{histStats.ls}</div>
                  <div className="t2048-stat-lbl">Longest Session</div>
                </div>
              </div>
            )
          }
        </div>
      )}

      {!raceMode && (
        <div className="t2048-bottom-nav safe-bottom">
          {['game', 'leaderboard', 'history', 'stats'].map(tab => (
            <button
              key={tab}
              className={'t2048-tab' + (activeTab === tab ? ' active' : '')}
              onClick={() => { setActiveTab(tab); if (tab !== 'game') setHistory(t2048LoadHistory()); }}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// 2048 entry: solo board, or the online-race host when launched via the mode
// modal in Online Race mode.
function T2048Game({ onWin, onLose, onStepChange, resetKey, gameMode, gameModeOpts, onBack, playMode, band, offset }) {
  if (gameMode === 'online' && gameModeOpts && gameModeOpts.roomId) {
    return (
      <ClassicRaceGame
        game={{ id: '2048', name: '2048', icon: '🔢', tagColor: GA.amber }}
        roomId={gameModeOpts.roomId}
        myPlayerNum={gameModeOpts.roomAction === 'join' ? 2 : 1}
        onExitLobby={() => onBack && onBack()}
        renderBoard={({ onEnd }) => (
          <T2048Solo onRaceEnd={onEnd} onStepChange={onStepChange} resetKey={resetKey} />
        )}
      />
    );
  }
  return <T2048Solo onWin={onWin} onLose={onLose} onStepChange={onStepChange} resetKey={resetKey} playMode={playMode} band={band} offset={offset} />;
}
