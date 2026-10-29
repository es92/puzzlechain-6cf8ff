/* ============================================================
   Game — Knight's Tour (8×8, visit every square exactly once)
   ============================================================ */
const KT_HISTORY_KEY = 'puzzlechain_knights_history';
const KT_HISTORY_MAX = 50;
const KT_MOVES = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];

function ktLoadHistory() { return loadHistory(KT_HISTORY_KEY); }
function ktSaveEntry(entry) { saveHistory(KT_HISTORY_KEY, entry, KT_HISTORY_MAX); }
/* #176 — the board is a parameter now. Knight's Tour was the one game in the
   registry with NOTHING: no daily, no story, no arcade, no opponent, and the
   same fixed 8×8 board every single session, so it was not even random. The
   ladder is the obvious one — board size, then blocked squares — and it needs
   no corpus, because Warnsdorff's rule decides solvability at generation time.

   `blocked` is a Set of indices the knight may not enter; a tour must cover
   every UNBLOCKED square exactly once. */
function ktValidMoves(pos, visited, size = 8, blocked = null) {
  if (pos === null) return [];
  const r = Math.floor(pos / size), c = pos % size;
  const out = [];
  for (const [dr, dc] of KT_MOVES) {
    const nr = r + dr, nc = c + dc;
    if (nr >= 0 && nr < size && nc >= 0 && nc < size) {
      const idx = nr * size + nc;
      if (!visited[idx] && !(blocked && blocked.has(idx))) out.push(idx);
    }
  }
  return out;
}

/* #205 — the SHAPE of a knight's move, as three board squares: where it
   starts, where it turns, where it lands. The board drew a flat tint on the
   destination and nothing else, which tells you where you may land but not
   why — and "why" is the whole thing a player is learning here.

   The elbow is on the LONG leg, which is the way the move is taught: two
   squares in one direction, then one across. Pure, and the only place the
   overlay's geometry lives, so the drawn path cannot drift from the move the
   hit test accepts (that pair is what #218 cost us on Nonogram). Returns null
   for anything that is not a legal knight step. */
function ktMovePath(from, to, size) {
  if (from === null || to === null) return null;
  const r0 = Math.floor(from / size), c0 = from % size;
  const r1 = Math.floor(to / size), c1 = to % size;
  const dr = r1 - r0, dc = c1 - c0;
  const ar = Math.abs(dr), ac = Math.abs(dc);
  if (!((ar === 2 && ac === 1) || (ar === 1 && ac === 2))) return null;
  const elbow = ar === 2 ? [r0 + dr, c0] : [r0, c0 + dc];
  return [[r0, c0], elbow, [r1, c1]];
}

/* Warnsdorff's rule: always step to the square with the fewest onward moves.
   It finds a full tour on almost every solvable instance almost instantly,
   which is exactly the property that lets the generator VERIFY a board before
   handing it to a player — no corpus, no offline job, a millisecond at mount.
   Ties are broken deterministically so the check is reproducible per seed. */
function ktHasTour(size, start, blocked) {
  const total = size * size - (blocked ? blocked.size : 0);
  const visited = new Array(size * size).fill(0);
  if (blocked) for (const b of blocked) visited[b] = 1;
  let pos = start, n = 1;
  visited[pos] = 1;
  while (n < total) {
    const opts = ktValidMoves(pos, visited, size, blocked);
    if (!opts.length) return false;
    let best = opts[0], bestDeg = Infinity;
    for (const o of opts) {
      const deg = ktValidMoves(o, visited, size, blocked).length;
      if (deg < bestDeg || (deg === bestDeg && o < best)) { bestDeg = deg; best = o; }
    }
    pos = best; visited[pos] = 1; n += 1;
  }
  return true;
}

/* The ladder: 5×5 up to 8×8, then blocked squares on the largest board.
   Every rung is verified solvable from its start square before it ships. */
const KT_BANDS = [
  { size: 5, blocks: 0 },
  { size: 6, blocks: 0 },
  { size: 7, blocks: 0 },
  { size: 8, blocks: 0 },
  { size: 8, blocks: 2 },
  { size: 8, blocks: 4 },
];

function ktBuildBoard(rng, bandIdx) {
  const spec = KT_BANDS[Math.min(KT_BANDS.length - 1, Math.max(0, bandIdx))];
  const { size } = spec;
  for (let attempt = 0; attempt < 60; attempt++) {
    const blocked = new Set();
    while (blocked.size < spec.blocks) blocked.add(Math.floor(rng() * size * size));
    let start = Math.floor(rng() * size * size);
    if (blocked.has(start)) continue;
    if (ktHasTour(size, start, blocked)) return { size, start, blocked, total: size * size - blocked.size };
  }
  /* No verified board in 60 tries — fall back to a plain board of that size
     from a corner, which is the classic solvable case for every size here.
     Shipping an unverified board would be worse than shipping an easier one. */
  return { size, start: 0, blocked: new Set(), total: size * size };
}
function ktFmtTime(s) {
  return `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
}
function ktFmtDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y.slice(2)}`;
}

/* The Knight's Tour board is a canvas (self-contained: it lives behind the ☰
   tab switch, and usePointerCell binds on mount). Chessboard chrome reads
   PAL, so it re-themes exactly as the DOM cells' C tokens did. */
/* #176 — the board is 5x5 to 8x8 with blocked squares on the top rungs, so
   every 8 and 64 that used to be baked in here comes from the board the ladder
   built. `blocked` squares are drawn as part of the board (hatched, like the
   DOM version's repeating-linear-gradient) rather than left as holes — a board
   with gaps in it reads as broken rather than as harder. */
function KtBoardCanvas({ size, blocked, visited, currentPos, validMvs, done, onCell }) {
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const { cell } = useFitBox(boxRef, { cols: size, rows: size, minCell: 28, maxCell: 60 });
  const side = cell * size;
  const liveRef = useRef({});
  liveRef.current = { visited, currentPos, validMvs, done, cell, size, blocked };

  usePointerCell(canvasRef, {
    onTap: (p) => {
      const s = liveRef.current;
      const c = Math.floor(p.x / s.cell), r = Math.floor(p.y / s.cell);
      if (c < 0 || c >= s.size || r < 0 || r >= s.size) return;
      const idx = r * s.size + c;
      if (s.blocked && s.blocked.has(idx)) return;
      const isValid = !s.done && idx !== s.currentPos && s.validMvs.includes(idx);
      const canPlace = s.currentPos === null && !(s.visited[idx] > 0);
      if (canPlace || isValid) onCell(idx);
    },
  });

  useCanvasBoard(canvasRef, {
    width: side,
    height: side,
    deps: [visited, currentPos, done, cell, size, blocked, validMvs],
    draw: (ctx) => {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let idx = 0; idx < size * size; idx++) {
        const r = Math.floor(idx / size), c = idx % size;
        const x = c * cell, y = r * cell;
        const isLight = (r + c) % 2 === 0;
        const isCurrent = idx === currentPos;
        const isVisited = visited[idx] > 0;
        const isBlocked = !!(blocked && blocked.has(idx));
        ctx.fillStyle = isLight ? PAL.surface : PAL.card;
        ctx.fillRect(x, y, cell, cell);
        if (isBlocked) {
          ctx.fillStyle = PAL.well;
          ctx.fillRect(x, y, cell, cell);
          ctx.save();
          ctx.beginPath(); ctx.rect(x, y, cell, cell); ctx.clip();
          ctx.strokeStyle = PAL.muted;
          ctx.globalAlpha = 0.35;
          ctx.lineWidth = 2;
          for (let d = -cell; d < cell * 2; d += 8) {
            ctx.beginPath(); ctx.moveTo(x + d, y); ctx.lineTo(x + d + cell, y + cell); ctx.stroke();
          }
          ctx.restore();
          continue;
        }
        if (isCurrent) {
          ctx.fillStyle = 'rgba(58,110,205,0.15)';
          ctx.fillRect(x, y, cell, cell);
          ctx.lineWidth = 2;
          ctx.strokeStyle = PAL.accent;
          ctx.strokeRect(x + 1, y + 1, cell - 2, cell - 2);
        }
      }
      /* #205 — the legal moves, drawn as the L the knight actually travels.
         This is a SECOND pass on purpose: the paths cross other squares, so
         drawing them inside the per-cell loop would let a later cell's
         background paint over an earlier cell's line. Squares first, then the
         paths, then the glyphs — so a number is never buried under a line. */
      const cc = (rc) => [rc[1] * cell + cell / 2, rc[0] * cell + cell / 2];
      if (!done && currentPos !== null) {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (const mv of validMvs) {
          const path = ktMovePath(currentPos, mv, size);
          if (!path) continue;
          const pts = path.map(cc);
          // Two strokes: a wide translucent body so eight overlapping paths
          // still read as separate ribbons, and a thin bright core on top.
          /* Alpha comes from globalAlpha, NOT from ca(): ca() emits a
             var(--c-…) string, which is a CSS colour and is invalid on a
             canvas — guardCanvasCtx swallows it and logs. PAL is the live
             palette, so this still re-themes. */
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          ctx.lineTo(pts[1][0], pts[1][1]);
          ctx.lineTo(pts[2][0], pts[2][1]);
          ctx.strokeStyle = PAL.accent;
          ctx.globalAlpha = 0.2;
          ctx.lineWidth = Math.max(4, cell * 0.16);
          ctx.stroke();
          ctx.globalAlpha = 0.85;
          ctx.lineWidth = Math.max(1.5, cell * 0.05);
          ctx.stroke();
          // The landing square keeps a target of its own: the path says how,
          // the ring says where, and the ring is what a finger aims at.
          const [ex, ey] = pts[2];
          ctx.beginPath();
          ctx.arc(ex, ey, Math.max(6, cell * 0.26), 0, Math.PI * 2);
          ctx.fillStyle = PAL.accent;
          ctx.globalAlpha = 0.18;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.lineWidth = Math.max(1.5, cell * 0.055);
          ctx.strokeStyle = PAL.accent;
          ctx.stroke();
        }
        ctx.restore();
      }
      // Glyph pass: the knight and the visit numbers ride on top of everything.
      for (let idx = 0; idx < size * size; idx++) {
        if (blocked && blocked.has(idx)) continue;
        const r = Math.floor(idx / size), c = idx % size;
        const cx = c * cell + cell / 2, cy = r * cell + cell / 2;
        if (idx === currentPos) {
          ctx.font = `${Math.round(cell * 0.55)}px system-ui, sans-serif`;
          ctx.fillStyle = PAL.text;
          ctx.fillText('♞', cx, cy + 1);
        } else if (visited[idx] > 0) {
          ctx.font = `600 ${Math.max(9, Math.round(cell * 0.28))}px 'JetBrains Mono', monospace`;
          ctx.fillStyle = PAL.muted;
          ctx.fillText(String(visited[idx]), cx, cy);
        }
      }
      ctx.lineWidth = 2;
      ctx.strokeStyle = PAL.border;
      ctx.strokeRect(1, 1, side - 2, side - 2);
    },
  });

  return (
    <div className="kt-boardbox" ref={boxRef}>
      <canvas
        ref={canvasRef}
        className="kt-canvas board-canvas"
        role="grid"
        aria-label={`Knight's Tour board — ${visited.filter((v) => v > 0).length} of ${size * size} squares visited`}
      />
    </div>
  );
}

function KnightsTourGame({ onWin, onStepChange, resetKey, playMode, band, offset }) {
  /* Board comes from the mode. Free play keeps the classic full 8×8 from a
     free choice of start, which is what this game has always been. */
  const boardRef = useRef(null);
  if (!boardRef.current) {
    if (playMode === 'story' || playMode === 'arcade' || playMode === 'daily') {
      /* #331 — the daily gains Easy/Hard: the 5×5 and the blocked 8×8 rungs of
         KT_BANDS. Normal keeps the classic 8×8 (bandIdx 3) byte-for-byte. The
         RNG takes the STRING band so Easy/Hard get their own deal; the numeric
         index (or story/arcade's own) still sizes the board. */
      const dailyBand = playMode === 'daily' && (band === 'easy' || band === 'hard') ? band : null;
      const bandIdx = playMode === 'story' ? (band || 0)
        : playMode === 'arcade'
          ? [1, 3, 5][Math.max(0, ARCADE_BANDS.findIndex(b => b.id === band))]
          : dailyBand === 'easy' ? 0
          : dailyBand === 'hard' ? KT_BANDS.length - 1
          : 3; // the daily is the classic 8×8, seeded start
      const { rng } = modeSeed(playMode, 'knights-tour', playMode === 'daily' ? (dailyBand || bandIdx) : bandIdx, offset);
      boardRef.current = ktBuildBoard(rng, bandIdx);
    } else {
      boardRef.current = { size: 8, start: null, blocked: new Set(), total: 64 };
    }
  }
  const KB = boardRef.current;
  const KN = KB.size * KB.size;
  const [visited, setVisited]       = useState(() => {
    const v = new Array(KN).fill(0);
    if (KB.start !== null) v[KB.start] = 1;
    return v;
  });
  /* A seeded board fixes the START square, which is what makes the board a
     shared puzzle rather than a free exploration. Free play keeps its
     pick-your-own-square opening. */
  const [currentPos, setCurrentPos] = useState(KB.start);
  const [moves, setMoves]           = useState(KB.start !== null ? 1 : 0);
  const [undoStack, setUndoStack]   = useState([]);
  const [done, setDone]             = useState(false);
  const [elapsed, setElapsed]       = useState(0);
  const [activeTab, setActiveTab]   = useState('game');
  const [history, setHistory]       = useState(() => ktLoadHistory());
  const [lastWinId, setLastWinId]   = useState(null);
  const startTimeRef = useRef(null);
  const timerRef     = useRef(null);

  const stopTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  const resetGame = () => {
    stopTimer();
    setVisited(() => {
      const v = new Array(KN).fill(0);
      if (KB.start !== null) v[KB.start] = 1;
      return v;
    });
    setCurrentPos(KB.start);
    setMoves(KB.start !== null ? 1 : 0);
    setUndoStack([]);
    setDone(false);
    setElapsed(0);
    startTimeRef.current = null;
    setActiveTab('game');
  };

  useEffect(() => { resetGame(); }, [resetKey]);
  useEffect(() => () => stopTimer(), []);

  const validMvs  = ktValidMoves(currentPos, visited, KB.size, KB.blocked);
  const stuck     = currentPos !== null && !done && validMvs.length === 0;

  const handleCellClick = (idx) => {
    if (done) return;

    if (currentPos === null) {
      if (!startTimeRef.current) {
        startTimeRef.current = Date.now();
        timerRef.current = setInterval(() => {
          setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
        }, 500);
      }
      const v = visited.slice(); v[idx] = 1;
      setVisited(v); setCurrentPos(idx); setMoves(1); setUndoStack([]);
      onStepChange(1);
      return;
    }

    if (!validMvs.includes(idx)) return;

    const newUndoStack = [...undoStack, { visited: visited.slice(), currentPos, moves }];
    const v = visited.slice();
    const m = moves + 1;
    v[idx] = m;

    if (m === KB.total) {
      stopTimer();
      const finalSecs = startTimeRef.current
        ? Math.floor((Date.now() - startTimeRef.current) / 1000)
        : elapsed;
      // Score scales with board area so a 5×5 tour cannot outscore an 8×8.
      const score = Math.max(100, Math.round(KB.total * 100 - finalSecs * 8));
      const today = new Date().toISOString().slice(0, 10);
      const entryId = Date.now();
      ktSaveEntry({ id: entryId, timeSecs: finalSecs, score, date: today });
      setHistory(ktLoadHistory());
      setLastWinId(entryId);
      setVisited(v); setCurrentPos(idx); setMoves(m); setUndoStack(newUndoStack); setDone(true);
      onStepChange(m);
      submitClassicScore('knights-tour', score, { timeSecs: finalSecs, moves: m });
      onWin(score, KB.total, finalSecs);
    } else {
      setVisited(v); setCurrentPos(idx); setMoves(m); setUndoStack(newUndoStack);
      onStepChange(m);
    }
  };

  const handleUndo = () => {
    if (undoStack.length === 0 || done) return;
    const prev = undoStack[undoStack.length - 1];
    setVisited(prev.visited.slice());
    setCurrentPos(prev.currentPos);
    setMoves(prev.moves);
    setUndoStack(undoStack.slice(0, -1));
    onStepChange(prev.moves);
  };

  const sortedHistory = history.slice().sort((a, b) => a.timeSecs - b.timeSecs);
  const bestEntry = sortedHistory[0] || null;

  return (
    <div>
      {activeTab === 'game' && (
        <div className="kt-wrap">
          <CuiBar height={46} build={(W) => {
            const pr = cuiRow(0, 0, W, 46, 3);
            return [
              { id: 'p-time', kind: 'pill', r: pr[0], label: 'Time', value: ktFmtTime(elapsed), gold: true },
              { id: 'p-moves', kind: 'pill', r: pr[1], label: 'Moves', value: `${moves}/${KB.total}`, color: stuck ? PAL.rose : undefined },
              { id: 'p-left', kind: 'pill', r: pr[2], label: 'Left', value: KB.total - moves },
            ];
          }} />

          <KtBoardCanvas
            size={KB.size}
            blocked={KB.blocked}
            visited={visited}
            currentPos={currentPos}
            validMvs={validMvs}
            done={done}
            onCell={handleCellClick}
          />

          <CuiBar height={stuck ? 68 : 44} build={(W) => {
            const out = [];
            let y = 0;
            if (stuck) {
              out.push({ id: 'stuck', kind: 'label', r: [0, 0, W, 20], label: 'No valid moves — try Undo or restart.', color: PAL.rose, font: 12 });
              y = 24;
            }
            const br = cuiRow(Math.floor(W * 0.1), y, Math.floor(W * 0.8), 40, stuck ? 2 : 1);
            out.push({ id: 'undo', kind: 'button', r: br[0], label: '↩ Undo', disabled: undoStack.length === 0 || done, action: handleUndo });
            if (stuck) out.push({ id: 'new', kind: 'button', r: br[1], label: 'New Game', primary: true, action: resetGame });
            return out;
          }} />

          {currentPos === null && (
            <div className="kt-hint">Tap any square to place the knight and begin.</div>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div>
          {sortedHistory.length === 0 ? (
            <div className="kt-empty">No completed tours yet.</div>
          ) : (
            <>
              {bestEntry && (
                <div className="kt-best">
                  Best: {ktFmtTime(bestEntry.timeSecs)} · {bestEntry.score} pts
                </div>
              )}
              <div className="kt-history-list">
                {sortedHistory.slice(0, KT_HISTORY_MAX).map((h, i) => (
                  <div key={h.id} className={'kt-history-row' + (h.id === lastWinId ? ' kt-row-new' : '')}>
                    <span className="kt-rank">#{i + 1}</span>
                    <span className="mono" style={{ flex: 1, fontWeight: 600 }}>{ktFmtTime(h.timeSecs)}</span>
                    <span style={{ color: C.gold, fontWeight: 600 }}>+{h.score}</span>
                    <span style={{ color: C.muted, fontSize: '0.75rem' }}>{ktFmtDate(h.date)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'leaderboard' && (
        <div style={{ padding: '0.25rem' }}>
          <ClassicLeaderboard gameId="knights-tour" valueFmt={(r) => `${r.bestScore} pts`} />
        </div>
      )}

      <div className="kt-bottom-nav safe-bottom">
        {['game', 'leaderboard', 'history'].map(tab => (
          <button
            key={tab}
            className={'kt-tab' + (activeTab === tab ? ' active' : '')}
            onClick={() => { setActiveTab(tab); if (tab === 'history') setHistory(ktLoadHistory()); }}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
}
