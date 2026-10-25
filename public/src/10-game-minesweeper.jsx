/* ============================================================
   Game 4 — Minesweeper (8×8, 10 mines, classic game)
   ============================================================ */
const MS_ROWS = 8, MS_COLS = 8, MS_MINES = 10, MS_SAFE = MS_ROWS * MS_COLS - MS_MINES; // 54
/* #331 — the arcade picker's Easy/Normal/Hard chips were decorative: every band
   dealt the same 8×8/10 board. Normal keeps the free-play constants
   byte-for-byte; Easy thins the minefield, Hard grows the board. */
const MS_BANDS = {
  easy: { rows: 8, cols: 8, mines: 6 },
  normal: { rows: MS_ROWS, cols: MS_COLS, mines: MS_MINES },
  hard: { rows: 10, cols: 10, mines: 22 },
};
const msConfFor = (band) => (band && MS_BANDS[band]) || MS_BANDS.normal;

const MS_HISTORY_KEY = 'puzzlechain_minesweeper_history';
const MS_HISTORY_MAX = 50;
// Looping background-music asset (served by express.static from public/audio).
const MS_MUSIC_URL = '/audio/minesweeper-bg.mp3';
// Tab ids stay stable (drive activeTab state + history reload); only the
// displayed label changed ("History" -> "My Best Runs").
const MS_TAB_LABELS = { game: 'Game', history: 'My Best Runs', leaderboard: 'Leaderboard', settings: 'Settings' };

function msLoadHistory() { return loadHistory(MS_HISTORY_KEY); }
function msSaveEntry(entry) { saveHistory(MS_HISTORY_KEY, entry, MS_HISTORY_MAX); }

/* Minesweeper's legacy in-game tab strip is hidden inside the classic shell
   (the `.cg-stage .ms-bottom-nav { display: none }` sweep), which orphaned
   the renamed "My Best Runs" history — no in-frame surface could reach it at
   all. The ☰ sheet is the shell's surface for exactly this, so the history
   lives there now, under the label the rename shipped. Registry-driven via
   the minesweeper entry's `sheetExtras`; `?sheet=history` deep-links it. */
function msBestRunsSection() {
  return {
    id: 'history',
    label: 'My Best Runs',
    render: () => {
      const rows = msLoadHistory();
      const fmtD = (d) => { const [y, m, day] = String(d || '').split('-'); return m ? `${m}/${day}/${y.slice(2)}` : ''; };
      return (
        <div>
          <h4>My Best Runs</h4>
          {rows.length === 0
            ? <div className="cg-sheet-empty">No games recorded yet — play one!</div>
            : (
              <div className="cg-sheet-list">
                {rows.map((h) => (
                  <div className="cg-sheet-row" key={h.id}>
                    <span className={`ms-outcome-chip ${h.outcome}`}>{h.outcome === 'win' ? 'Win' : 'Loss'}</span>
                    <span style={{ color: C.muted, fontSize: '0.75rem' }}>{fmtD(h.date)}</span>
                    <span className="mono" style={{ color: C.gold }}>+{h.score}</span>
                    <span style={{ color: C.muted, fontSize: '0.75rem' }}>{h.safeRevealed}/{h.safeTotal || 54} · {h.secs}s</span>
                  </div>
                ))}
              </div>
            )}
        </div>
      );
    },
  };
}

function generateMines(firstR, firstC, conf) {
  const rows = conf.rows, cols = conf.cols;
  const protected_ = new Set();
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r = firstR + dr, c = firstC + dc;
      if (r >= 0 && r < rows && c >= 0 && c < cols)
        protected_.add(r * cols + c);
    }
  }
  const indices = [];
  for (let i = 0; i < rows * cols; i++) if (!protected_.has(i)) indices.push(i);
  // Fisher-Yates on eligible indices
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return new Set(indices.slice(0, conf.mines));
}

function computeAdjacency(mineSet, conf) {
  const rows = conf.rows, cols = conf.cols;
  const adj = new Int8Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (mineSet.has(idx)) { adj[idx] = -1; continue; }
      let count = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && mineSet.has(nr * cols + nc)) count++;
      }
      adj[idx] = count;
    }
  }
  return adj;
}

function floodReveal(startIdx, adjacency, mineSet, prevRevealed, flagged, conf) {
  const cols = conf.cols, rows = conf.rows;
  const next = new Set(prevRevealed);
  const queue = [startIdx];
  while (queue.length) {
    const idx = queue.shift();
    if (next.has(idx) || mineSet.has(idx) || flagged.has(idx)) continue;
    next.add(idx);
    if (adjacency[idx] === 0) {
      const r = Math.floor(idx / cols), c = idx % cols;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) queue.push(nr * cols + nc);
      }
    }
  }
  return next;
}

/* The Minesweeper board is a canvas — Mine Finder's exact pattern (they are
   the same family on purpose). Self-contained because the board lives behind
   the ☰ tab switch: usePointerCell binds on mount, so the canvas must exist
   when its hooks run. The board's light/dark look still keys off the RESOLVED
   theme (the old data-ms-theme pair), not the raw palette: base art is dark,
   light pins its own greys — intrinsic to this board, like the daily's. */
const MS_LIGHT = { grid: '#9ca3af', hidden: '#e5e7eb', revealed: '#f9fafb', mineDead: '#fca5a5', exploded: '#f87171' };
function MsBoardCanvas({ theme, revealed, flagged, mineSet, adjacency, gameOverMine, done, onCellTap, onCellFlag, onCellAlt, conf }) {
  const board = conf || msConfFor(null);
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const { cell } = useFitBox(boxRef, { cols: board.cols, rows: board.rows, minCell: 26, maxCell: 46, gap: 2 });
  const cellStep = cell + 2;
  const boardPx = cellStep * board.cols - 2;

  const liveRef = useRef({});
  liveRef.current = { revealed, flagged, done, cellStep };
  const idxAt = (p) => {
    const cs = liveRef.current.cellStep;
    const c = Math.floor(p.x / cs), r = Math.floor(p.y / cs);
    if (c < 0 || c >= board.cols || r < 0 || r >= board.rows) return -1;
    return r * board.cols + c;
  };
  usePointerCell(canvasRef, {
    onTap: (p) => { const i = idxAt(p); if (i >= 0 && !liveRef.current.done) onCellTap(i); },
    onLongPress: (p) => {
      const i = idxAt(p);
      if (i < 0 || liveRef.current.done || liveRef.current.revealed.has(i)) return;
      onCellAlt(i);
    },
    onContext: (p) => {
      const i = idxAt(p);
      if (i < 0 || liveRef.current.done || liveRef.current.revealed.has(i)) return;
      onCellFlag(i);
    },
  });

  useCanvasBoard(canvasRef, {
    width: boardPx,
    height: boardPx,
    deps: [cell, revealed, flagged, mineSet, gameOverMine, done, theme],
    draw: (ctx) => {
      const light = theme === 'light';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const radius = Math.max(3, Math.round(cell * 0.16));
      for (let i = 0; i < board.rows * board.cols; i++) {
        const r = Math.floor(i / board.cols), c = i % board.cols;
        const x = c * cellStep, y = r * cellStep;
        const isRev = revealed.has(i);
        const isFlag = flagged.has(i);
        const isMineVisible = done && mineSet && mineSet.has(i) && !isRev;
        const isExploded = gameOverMine === i;
        const adjVal = adjacency ? adjacency[i] : 0;

        let fill = light ? MS_LIGHT.hidden : PAL.card;
        if (isRev) fill = light ? MS_LIGHT.revealed : MINE_DARK_TILES.revealed;
        if (isMineVisible) fill = light ? MS_LIGHT.mineDead : 'rgba(205,75,58,.25)';
        if (isExploded) fill = light ? MS_LIGHT.exploded : 'rgba(205,75,58,.60)';
        if (!light && !isRev && !isMineVisible && !isExploded) {
          // #294 — a covered cell is a raised key in dark mode.
          mineDrawDarkHidden(ctx, x, y, cell, radius);
        } else {
          klRR(ctx, x, y, cell, cell, radius);
          ctx.fillStyle = fill;
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = light ? MS_LIGHT.grid
            : (isRev && !isExploded ? MINE_DARK_TILES.revealedLn : PAL.border);
          ctx.stroke();
        }

        const cx = x + cell / 2, cy = y + cell / 2;
        if (isExploded) {
          ctx.font = `${Math.round(cell * 0.6)}px system-ui, sans-serif`;
          ctx.fillText('💥', cx, cy + 1);
        } else if (isMineVisible) {
          ctx.font = `${Math.round(cell * 0.58)}px system-ui, sans-serif`;
          ctx.fillText('💣', cx, cy + 1);
        } else if (isRev && adjVal > 0) {
          ctx.font = `700 ${Math.round(cell * 0.5)}px 'JetBrains Mono', monospace`;
          ctx.fillStyle = palOf(MF_NUM_COLORS[adjVal], PAL.text);
          ctx.fillText(String(adjVal), cx, cy + 1);
        } else if (isFlag) {
          ctx.font = `${Math.round(cell * 0.55)}px system-ui, sans-serif`;
          ctx.fillText('🚩', cx, cy + 1);
        }
      }
    },
  });

  return (
    <div className="ms-boardbox" ref={boxRef} onContextMenu={(e) => e.preventDefault()}>
      <canvas
        ref={canvasRef}
        className="ms-canvas board-canvas"
        role="grid"
        aria-label={`Minesweeper, ${board.cols} by ${board.rows} board, ${revealed.size} cells revealed`}
      />
    </div>
  );
}

function MinesweeperGame({ onWin, onLose, onStepChange, resetKey, playMode, band }) {
  // The board follows the APP theme now (its own light/dark button is gone —
  // one control, in Settings). Base .ms-* rules are dark and
  // [data-ms-theme="light"] overrides them, so the resolved value maps directly.
  const { resolved: theme } = useTheme();
  /* #331 — the band is an arcade-only string here (story/arcade numeric bands
     never equal 'easy'/'hard', and classics get null), so a plain string gate
     cannot cross modes. */
  const msBand = playMode === 'arcade' && (band === 'easy' || band === 'hard') ? band : null;
  const msConf = msConfFor(msBand);
  const safeTotal = msConf.rows * msConf.cols - msConf.mines;
  const [activeTab, setActiveTab] = useState('game');
  const [mineSet, setMineSet] = useState(null);
  const [adjacency, setAdjacency] = useState(null);
  const [revealed, setRevealed] = useState(() => new Set());
  const [flagged, setFlagged] = useState(() => new Set());
  const [done, setDone] = useState(false);
  const [gameOverMine, setGameOverMine] = useState(null);
  const [steps, setSteps] = useState(0);
  const [gameHistory, setGameHistory] = useState(() => msLoadHistory());
  // Audio: `soundOn` mirrors the shared cgPrefs.sound master switch (controls
  // both SFX and music); `musicPaused` is the player's in-game music pause that
  // leaves SFX untouched.
  const [soundOn, setSoundOn] = useState(() => cgPrefs.sound);
  const [musicPaused, setMusicPaused] = useState(false);
  const { secs, fmt: timeFmt } = useTimer(!done && mineSet !== null);

  // Reset when parent increments resetKey
  useEffect(() => {
    setMineSet(null);
    setAdjacency(null);
    setRevealed(new Set());
    setFlagged(new Set());
    setDone(false);
    setGameOverMine(null);
    setSteps(0);
    setActiveTab('game');
    setMusicPaused(false);
  }, [resetKey, msBand]);

  // Background music: plays while a game is live (board generated on first
  // reveal), sound is enabled, and the player hasn't paused it. Starting only
  // after the first reveal means it's triggered by a user gesture, satisfying
  // browser autoplay policy. Any change to these conditions re-evaluates.
  useEffect(() => {
    const shouldPlay = mineSet !== null && !done && soundOn && !musicPaused;
    if (shouldPlay) startBackgroundMusic(MS_MUSIC_URL);
    else stopBackgroundMusic();
  }, [mineSet, done, soundOn, musicPaused]);

  // Always silence the track when leaving the game (unmount → back to lobby).
  useEffect(() => () => stopBackgroundMusic(), []);

  // Toggle the shared sound master switch (persists to localStorage via cgPrefs)
  // and mirror it into local state so the component re-renders.
  const toggleSound = () => {
    const next = !cgPrefs.sound;
    cgSetPref('sound', next);
    setSoundOn(next);
  };

  const safeRevealed = mineSet
    ? Array.from(revealed).filter(i => !mineSet.has(i)).length
    : 0;
  const cashOutActive = safeRevealed >= 10 && !done;
  const cashoutMultiplier = parseFloat((1.0 + safeRevealed / safeTotal).toFixed(2));

  const handleReveal = (idx) => {
    if (done || revealed.has(idx) || flagged.has(idx)) return;
    const r = Math.floor(idx / msConf.cols), c = idx % msConf.cols;

    let mines = mineSet, adj = adjacency;
    if (!mines) {
      mines = generateMines(r, c, msConf);
      adj = computeAdjacency(mines, msConf);
      setMineSet(mines);
      setAdjacency(adj);
    }

    const newSteps = steps + 1;
    setSteps(newSteps);
    onStepChange(newSteps);

    if (mines.has(idx)) {
      setGameOverMine(idx);
      setDone(true);
      cgSound('lose'); cgHaptic([20, 40, 20]);
      const baseScore = 0;
      const entry = {
        id: String(Date.now()),
        date: new Date().toISOString().slice(0, 10),
        outcome: 'loss', score: 0, steps: newSteps, secs, safeRevealed, safeTotal, cashOut: false, cashoutMultiplier: null,
      };
      msSaveEntry(entry);
      setGameHistory(msLoadHistory());
      const shareText = `Mine Finder Classic ${entry.date} — 💥 Game Over · ${safeRevealed}/${safeTotal} safe · ${secs}s · +0 pts`;
      onLose(newSteps, secs, { share: shareText });
      return;
    }

    const newRevealed = floodReveal(idx, adj, mines, revealed, flagged, msConf);
    setRevealed(newRevealed);

    const newSafeRevealed = Array.from(newRevealed).filter(i => !mines.has(i)).length;
    if (newSafeRevealed >= safeTotal) {
      // Full board clear
      setDone(true);
      cgSound('win'); cgHaptic([15, 30, 15]);
      const baseScore = Math.max(newSafeRevealed * 30 - secs * 2, 100) + 200;
      const dateStr = new Date().toISOString().slice(0, 10);
      const entry = {
        id: String(Date.now()),
        date: dateStr,
        outcome: 'win', score: baseScore, steps: newSteps, secs, safeRevealed: newSafeRevealed, safeTotal, cashOut: false, cashoutMultiplier: 1.0,
      };
      msSaveEntry(entry);
      setGameHistory(msLoadHistory());
      const shareText = `Mine Finder Classic ${dateStr} — ✅ Full Clear · ${newSafeRevealed}/${safeTotal} safe · ${secs}s · +${baseScore} pts`;
      submitClassicScore('minesweeper', baseScore, { safeRevealed: newSafeRevealed, timeSecs: secs });
      onWin(baseScore, newSteps, secs, { share: shareText, cashOut: false });
    }
  };

  const handleCashOut = () => {
    if (!cashOutActive || !mineSet) return;
    setDone(true);
    cgSound('win'); cgHaptic([15, 30, 15]);
    const baseScore = Math.max(safeRevealed * 30 - secs * 2, 100);
    const finalScore = Math.round(baseScore * cashoutMultiplier);
    const dateStr = new Date().toISOString().slice(0, 10);
    const entry = {
      id: String(Date.now()),
      date: dateStr,
      outcome: 'win', score: finalScore, steps, secs, safeRevealed, safeTotal, cashOut: true, cashoutMultiplier,
    };
    msSaveEntry(entry);
    setGameHistory(msLoadHistory());
    const shareText = `Mine Finder Classic ${dateStr} — 🔒×${cashoutMultiplier} · ${safeRevealed}/${safeTotal} safe · ${secs}s · +${finalScore} pts`;
    submitClassicScore('minesweeper', finalScore, { safeRevealed, timeSecs: secs });
    onWin(finalScore, steps, secs, { share: shareText, cashOut: true, cashoutMultiplier });
  };

  const handleFlag = (idx) => {
    if (done || revealed.has(idx)) return;
    setFlagged(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  /* #136 — chording. Tapping a revealed number used to do nothing at all.
     When its adjacent flag count equals the number, clear every unflagged
     neighbour; a wrong flag loses the game, exactly like tapping a mine.
     Ported from the daily Mine Finder, which already had both this and the
     flag-mode toggle below. */
  const handleChord = (idx) => {
    if (done || !mineSet || !adjacency) return false;
    if (!revealed.has(idx)) return false;
    const n = adjacency[idx];
    if (!(n > 0)) return false;
    const r = Math.floor(idx / msConf.cols), c = idx % msConf.cols;
    const neigh = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < msConf.rows && cc >= 0 && cc < msConf.cols) neigh.push(rr * msConf.cols + cc);
    }
    const flags = neigh.filter(i => flagged.has(i));
    if (flags.length !== n) return false;
    const toOpen = neigh.filter(i => !flagged.has(i) && !revealed.has(i));
    if (!toOpen.length) return false;

    const newSteps = steps + 1;
    setSteps(newSteps);
    onStepChange(newSteps);

    // A misplaced flag means one of these is a mine — same loss path as a tap.
    const boom = toOpen.find(i => mineSet.has(i));
    if (boom != null) {
      setGameOverMine(boom);
      setDone(true);
      cgSound('lose'); cgHaptic([20, 40, 20]);
      const entry = {
        id: String(Date.now()),
        date: new Date().toISOString().slice(0, 10),
        outcome: 'loss', score: 0, steps: newSteps, secs, safeRevealed, safeTotal, cashOut: false, cashoutMultiplier: null,
      };
      msSaveEntry(entry);
      setGameHistory(msLoadHistory());
      onLose(newSteps, secs, {
        share: `Mine Finder Classic ${entry.date} — 💥 Game Over · ${safeRevealed}/${safeTotal} safe · ${secs}s · +0 pts`,
      });
      return true;
    }

    let next = revealed;
    for (const i of toOpen) next = floodReveal(i, adjacency, mineSet, next, flagged, msConf);
    setRevealed(next);
    cgSound('move');

    const newSafe = Array.from(next).filter(i => !mineSet.has(i)).length;
    if (newSafe >= safeTotal) {
      setDone(true);
      cgSound('win'); cgHaptic([15, 30, 15]);
      const baseScore = Math.max(newSafe * 30 - secs * 2, 100) + 200;
      const dateStr = new Date().toISOString().slice(0, 10);
      const entry = {
        id: String(Date.now()), date: dateStr,
        outcome: 'win', score: baseScore, steps: newSteps, secs, safeRevealed: newSafe, safeTotal, cashOut: false, cashoutMultiplier: 1.0,
      };
      msSaveEntry(entry);
      setGameHistory(msLoadHistory());
      submitClassicScore('minesweeper', baseScore, { safeRevealed: newSafe, timeSecs: secs });
      onWin(baseScore, newSteps, secs, {
        share: `Mine Finder Classic ${dateStr} — ✅ Full Clear · ${newSafe}/${safeTotal} safe · ${secs}s · +${baseScore} pts`,
        cashOut: false,
      });
    }
    return true;
  };

  /* #136 — a real flag/dig toggle. Long-press was previously the ONLY way to
     flag, which is undiscoverable and awkward one-handed. Per-run state, not
     localStorage: it's a choice about this board, not a preference. */
  const [flagMode, setFlagMode] = useState(false);

  // One dispatcher: chord a revealed number, flag or dig a covered cell.
  const handleCellTap = (idx) => {
    if (done) return;
    if (revealed.has(idx)) { handleChord(idx); return; }
    if (flagMode) { handleFlag(idx); return; }
    handleReveal(idx);
  };

  const minesLeft = msConf.mines - flagged.size;

  const fmtDate = (d) => { const [y, m, day] = d.split('-'); return `${m}/${day}/${y.slice(2)}`; };

  return (
    <div>

      {activeTab === 'game' && (
        <div>
          <CuiBar height={46} build={(W) => {
            const pr = cuiRow(0, 0, W, 46, 3);
            return [
              { id: 'p-time', kind: 'pill', r: pr[0], label: 'Time', value: timeFmt, gold: true },
              { id: 'p-mines', kind: 'pill', r: pr[1], label: 'Mines Left', value: minesLeft },
              { id: 'p-safe', kind: 'pill', r: pr[2], label: 'Safe Revealed', value: `${safeRevealed}/${safeTotal}` },
            ];
          }} />

          {/* #136 — flag/dig toggle, drawn; the two mine games read the same. */}
          <CuiBar height={52} build={(W) => {
            const br = cuiRow(Math.floor(W * 0.06), 2, Math.floor(W * 0.88), 48, 2);
            return [
              { id: 'dig', kind: 'button', r: br[0], label: '⛏️ Dig', sub: 'tap to reveal', on: !flagMode, action: () => setFlagMode(false) },
              { id: 'flag', kind: 'button', r: br[1], label: '🚩 Flag', sub: 'tap to mark', on: flagMode, action: () => setFlagMode(true) },
            ];
          }} />
          {/* #136 — chording was completely undiscoverable: tapping a revealed
              number simply did nothing, with no hint that it ever would. */}
          <div className="p6-hint" style={{ textAlign: 'center' }}>
            Long-press does the opposite of the current mode.
            Tap a number whose flags all match to clear around it.
          </div>

          <MsBoardCanvas
            theme={theme}
            revealed={revealed}
            flagged={flagged}
            mineSet={mineSet}
            adjacency={adjacency}
            gameOverMine={gameOverMine}
            done={done}
            onCellTap={handleCellTap}
            onCellFlag={handleFlag}
            onCellAlt={(idx) => { if (flagMode) handleReveal(idx); else handleFlag(idx); cgHaptic(12); }}
            conf={msConf}
          />

          <CuiBar height={50} build={(W) => {
            const br = cuiRow(Math.floor(W * 0.04), 4, Math.floor(W * 0.92), 42, 3);
            return [
              { id: 'lockin', kind: 'button', r: [br[0][0], 4, br[0][2] + br[1][2] * 0.35, 42], label: `Lock In 🔒 ×${cashoutMultiplier}`, solid: cashOutActive, disabled: !cashOutActive, action: handleCashOut },
              { id: 'music', kind: 'button', r: [br[1][0] + br[1][2] * 0.45, 4, br[1][2] * 0.55, 42], label: !soundOn ? '🔇' : musicPaused ? '▶' : '⏸', disabled: !soundOn, action: () => setMusicPaused(p => !p) },
              { id: 'new', kind: 'button', r: br[2], label: '↺ New', action: () => {
                setMineSet(null); setAdjacency(null); setRevealed(new Set());
                setFlagged(new Set()); setDone(false); setGameOverMine(null); setSteps(0);
                setMusicPaused(false);
              } },
            ];
          }} />
        </div>
      )}

      {activeTab === 'history' && (
        <div>
          <div className="ms-history-list">
            {gameHistory.length === 0
              ? <div className="ms-empty-state">No games recorded yet</div>
              : gameHistory.map(h => (
                <div key={h.id} className="ms-history-row">
                  <span className={`ms-outcome-chip ${h.outcome}`}>{h.outcome === 'win' ? 'Win' : 'Loss'}</span>
                  <span style={{ color: C.muted, fontSize: '0.75rem' }}>{fmtDate(h.date)}</span>
                  <span className="mono" style={{ color: C.gold }}>+{h.score}</span>
                  <span style={{ color: C.muted, fontSize: '0.75rem' }}>{h.safeRevealed}/{h.safeTotal || 54} · {h.secs}s</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {activeTab === 'leaderboard' && (
        <div style={{ padding: '0.25rem' }}>
          <ClassicLeaderboard gameId="minesweeper" />
        </div>
      )}

      {activeTab === 'settings' && (
        <div style={{ padding: '0.5rem 0' }}>
          <div className="ms-settings-section">
            <h4>Audio</h4>
            <div className="ms-settings-row">
              <span className="ms-settings-label">Sound &amp; music</span>
              <button className="ms-theme-toggle" onClick={toggleSound}>
                {soundOn ? '🔊 On' : '🔇 Off'}
              </button>
            </div>
            <div className="ms-settings-row">
              <span className="ms-settings-label">Background music</span>
              <button
                className="ms-theme-toggle"
                onClick={() => setMusicPaused(p => !p)}
                disabled={!soundOn}
                style={!soundOn ? { opacity: 0.5, cursor: 'default' } : undefined}
              >
                {!soundOn ? '🔇 Off' : musicPaused ? '▶ Paused' : '⏸ Playing'}
              </button>
            </div>
          </div>
          <div className="ms-settings-section">
            <h4>Appearance</h4>
            <ThemeChoice />
          </div>
        </div>
      )}

      <div className="ms-bottom-nav safe-bottom">
        {['game', 'history', 'leaderboard', 'settings'].map(tab => (
          <button
            key={tab}
            className={'ms-tab' + (activeTab === tab ? ' active' : '')}
            onClick={() => { setActiveTab(tab); if (tab !== 'game') setGameHistory(msLoadHistory()); }}
          >
            {MS_TAB_LABELS[tab]}
          </button>
        ))}
      </div>
    </div>
  );
}
