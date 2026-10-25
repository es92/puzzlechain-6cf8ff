/* ============================================================
   New Classic Games (Snake, Block Blast, Tile Match, Diamond Rush,
   Texas Hold 'Em) — all self-wrap in ClassicShell.
   ============================================================ */
const SNAKE_KEY = 'puzzlechain_snake_history';
const SNAKE_DIFFICULTY_KEY = 'puzzlechain_snake_difficulty';
const BB_KEY    = 'puzzlechain_blockblast_history';
const DR_KEY    = 'puzzlechain_diamondrush_history';
const TH_KEY    = 'puzzlechain_texas_history';

/* #206 — SNAKE'S TURN QUEUE.

   "The snake fails to turn upon tap or swipe" is not a gesture problem — the
   swipes arrive, and .snake-board / .dsnk-board both carry touch-action: none
   so the browser never steals them. It is that a turn had nowhere to wait.

   Both snakes held ONE pending direction and validated every new turn against
   the direction currently being travelled. Two consequences, and between them
   they eat a large share of the turns a player actually makes, because a
   corner is TWO turns and a tick is 90-200 ms:

     - the second turn OVERWRITES the first, so the snake never makes the first
       one: swipe up then left around a corner and it simply goes left;
     - or the second turn is REJECTED as a reversal of a direction the first
       turn was about to change: heading up with left already pending, "down"
       is a legal move after that left, and was refused because down reverses
       UP. Measured in a browser: that input returns without doing anything.

   So turns queue, up to SNAKE_TURN_QUEUE of them, and each is checked against
   the last direction QUEUED rather than the last one travelled — which is the
   direction it will actually follow. One tick consumes one turn, so the snake
   still cannot double back on itself within a tick; it just stops forgetting
   what you asked for. Pure, because that is the whole rule and a self-test can
   hold it (`snake-turn-queue`). */
const SNAKE_DIRS = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const SNAKE_TURN_QUEUE = 2;

function snakeQueueTurn(dir, cur, queue) {
  const nd = SNAKE_DIRS[dir];
  if (!nd || !cur) return null;
  const q = Array.isArray(queue) ? queue : [];
  if (q.length >= SNAKE_TURN_QUEUE) return null;          // hold two, not a buffer
  // The direction this turn actually follows on from.
  const prev = q.length ? q[q.length - 1] : cur;
  if (nd.x === -prev.x && nd.y === -prev.y) return null;  // no doubling back
  if (nd.x === prev.x && nd.y === prev.y) return null;    // already going that way
  return q.concat([nd]);
}

/* Which way a TAP on the board means. The issue asks for tap as well as swipe,
   and a tap used only to start the run. The board is cut into four triangles
   by its diagonals and a tap means the one it lands in — absolute, so it needs
   no knowledge of which way the snake is already going and cannot mean two
   things at once. A tap dead in the centre means nothing. */
function snakeTapDir(x, y, w, h) {
  if (!(w > 0) || !(h > 0)) return null;
  const nx = x / w - 0.5, ny = y / h - 0.5;
  if (Math.abs(nx) < 0.08 && Math.abs(ny) < 0.08) return null;
  return Math.abs(nx) > Math.abs(ny)
    ? (nx > 0 ? 'right' : 'left')
    : (ny > 0 ? 'down' : 'up');
}

function cgLoadHistory(key) { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } }
function cgSaveHistory(key, entry) {
  const h = cgLoadHistory(key);
  h.unshift(entry);
  const trimmed = h.slice(0, 30);
  try { localStorage.setItem(key, JSON.stringify(trimmed)); } catch {}
  return trimmed;
}
function cgFmt(s) { return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
function useElapsed(resetKey, running) {
  const [secs, setSecs] = useState(0);
  const start = useRef(Date.now());
  useEffect(() => { start.current = Date.now(); setSecs(0); }, [resetKey]);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setSecs(Math.round((Date.now() - start.current) / 1000)), 500);
    return () => clearInterval(id);
  }, [running, resetKey]);
  return secs;
}

/* ---------------- Snake ---- Difficulty config ---- */
const SNAKE_SPEED_CONFIG = {
  easy:   { initial: 250, decrement: 4 },
  normal: { initial: 200, decrement: 6 },
  hard:   { initial: 150, decrement: 8 },
};

/* ---- Snake — Mode Selector ---- */
function SnakeGameModeSelect({ onSelectDifficulty }) {
  const [difficulty, setDifficulty] = useState(() => localStorage.getItem(SNAKE_DIFFICULTY_KEY) || 'normal');

  const handleStart = () => {
    try { localStorage.setItem(SNAKE_DIFFICULTY_KEY, difficulty); } catch {}
    onSelectDifficulty(difficulty);
  };

  return (
    <div className="mnc-mode-select">
      <div style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
        <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.2rem' }}>Choose Difficulty</h3>
        <p style={{ color: 'var(--c-muted)', fontSize: '0.9rem', margin: '0 0 1.5rem 0' }}>Affects starting speed and acceleration</p>
      </div>
      <div className="mnc-difficulty-row">
        {['easy', 'normal', 'hard'].map(d => (
          <button key={d} className={'mnc-difficulty-pill' + (difficulty === d ? ' active' : '')} onClick={() => setDifficulty(d)}>
            {d.charAt(0).toUpperCase() + d.slice(1)}
          </button>
        ))}
      </div>
      <button className="mnc-mode-start-btn" onClick={handleStart}>
        Play
      </button>
    </div>
  );
}

/* ---- Snake — Gameplay ---- */
/* Snake boards (classic 15×15, daily 13×13) draw to ONE canvas now: the DOM
   grids re-reconciled 225/169 cell divs on every movement tick, which was the
   whole cost of the game loop. The outer .snake-board/.dsnk-board boxes stay
   (their sizing, background, border and the fit-col rules are unchanged, and
   gestures still bind to them); this fills them with a canvas that redraws
   once per tick. Colors read PAL — board chrome follows the theme exactly as
   the DOM cells' C tokens did. */
function SnakeCanvas({ n, stRef, tick, skin, ariaLabel }) {
  const canvasRef = useRef(null);
  const boxRef = useRef(null);
  const { boxW, boxH } = useFitBox(boxRef, { cols: n, rows: n });
  const side = Math.min(Math.floor(boxW) || 0, Math.floor(boxH) || Math.floor(boxW) || 0);
  useCanvasBoard(canvasRef, {
    width: side,
    height: side,
    deps: [tick, side, n],
    draw: (ctx) => {
      if (side < 40) return;
      const pad = 6;
      const cs = (side - pad * 2) / n;
      const cellRect = (gx, gy, color, r) => {
        klRR(ctx, pad + gx * cs + 0.5, pad + gy * cs + 0.5, cs - 1, cs - 1, r);
        ctx.fillStyle = color;
        ctx.fill();
      };
      if (skin === 'classic') {
        // The classic board's darker empty-cell wash.
        for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) cellRect(gx, gy, PAL.bg, 2);
      } else {
        // The daily board's faint hairline grid.
        ctx.strokeStyle = PAL.border;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.55;
        for (let i = 1; i < n; i++) {
          ctx.beginPath(); ctx.moveTo(pad + i * cs, pad); ctx.lineTo(pad + i * cs, side - pad); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(pad, pad + i * cs); ctx.lineTo(side - pad, pad + i * cs); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      const s = stRef.current;
      if (!s) return;
      const bodyColor = skin === 'classic' ? PAL.emerald : GA.lime;
      for (let i = s.snake.length - 1; i >= 1; i--) cellRect(s.snake[i].x, s.snake[i].y, bodyColor, 3);
      cellRect(s.snake[0].x, s.snake[0].y, PAL.accent, 4);
      ctx.beginPath();
      ctx.arc(pad + s.food.x * cs + cs / 2, pad + s.food.y * cs + cs / 2, cs * 0.38, 0, Math.PI * 2);
      ctx.fillStyle = PAL.rose;
      ctx.fill();
    },
  });
  return (
    <div className="snake-canvas-fill" ref={boxRef}>
      <canvas ref={canvasRef} className="snake-canvas board-canvas" role="img" aria-label={ariaLabel} />
    </div>
  );
}

function SnakeGameplay({ onWin, onStepChange, resetKey, game, onBack, difficulty, menuConfig }) {
  const N = 15;
  const [tick, render] = useState(0);
  const [done, setDone] = useState(false);
  const [score, setScore] = useState(0);
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [pausedSecs, setPausedSecs] = useState(0);
  const st = useRef(null);
  const doneRef = useRef(false);
  const boardRef = useRef(null);
  const secs = useElapsed(resetKey, !done && !paused);
  const secsRef = useRef(0); secsRef.current = secs;

  const randFood = (snake) => {
    let c;
    do { c = { x: Math.floor(Math.random() * N), y: Math.floor(Math.random() * N) }; }
    while (snake.some(s => s.x === c.x && s.y === c.y));
    return c;
  };
  const init = () => {
    const m = Math.floor(N / 2);
    const snake = [{ x: m, y: m }, { x: m - 1, y: m }, { x: m - 2, y: m }];
    const config = SNAKE_SPEED_CONFIG[difficulty || 'normal'];
    st.current = { snake, dir: { x: 1, y: 0 }, turns: [], food: randFood(snake), speed: config.initial, eaten: 0 };
    doneRef.current = false;
    setDone(false); setScore(0); setStarted(false); setPaused(false); setPausedSecs(0); render(n => n + 1);
  };
  useEffect(() => { init(); }, [resetKey]);

  const gameOver = () => {
    if (doneRef.current) return;
    doneRef.current = true; setDone(true);
    cgSound('lose'); cgHaptic([20, 40, 20]);
    const sc = st.current.eaten * 10;
    cgSaveHistory(SNAKE_KEY, { score: sc, len: st.current.snake.length, ts: Date.now() });
    api('/api/snake/score', { method: 'POST', body: JSON.stringify({ score: sc, length: st.current.snake.length, timeSecs: secsRef.current }) }).catch(() => {});
    const hist = cgLoadHistory(SNAKE_KEY);
    const bestScore = hist.reduce((m, r) => Math.max(m, r.score || 0), 0);
    const longestSnake = hist.reduce((m, r) => Math.max(m, r.len || 0), 0);
    onWin(sc, st.current.eaten, secsRef.current, { winnerLabel: 'Game Over', share: `🐍 Snake — ${sc} pts, length ${st.current.snake.length}`, bestScore, longestSnake });
  };
  const step = () => {
    const s = st.current;
    if (!s || doneRef.current) return;
    // One tick consumes one queued turn, which is what keeps the no-doubling-back
    // rule true however fast the player swipes (#206).
    if (s.turns.length) s.dir = s.turns.shift();
    const head = s.snake[0];
    const nx = head.x + s.dir.x, ny = head.y + s.dir.y;
    if (nx < 0 || ny < 0 || nx >= N || ny >= N ||
        s.snake.some((seg, i) => i < s.snake.length - 1 && seg.x === nx && seg.y === ny)) {
      gameOver(); return;
    }
    s.snake.unshift({ x: nx, y: ny });
    if (nx === s.food.x && ny === s.food.y) {
      s.eaten++; setScore(s.eaten * 10);
      cgSound('clear', 1 + s.eaten * 0.02); cgHaptic(15);
      s.food = randFood(s.snake);
      const config = SNAKE_SPEED_CONFIG[difficulty || 'normal'];
      s.speed = Math.max(80, config.initial - s.eaten * config.decrement);
      onStepChange && onStepChange(s.eaten);
    } else {
      s.snake.pop();
    }
    render(n => n + 1);
  };
  useEffect(() => {
    if (done || !started || paused) return;
    let raf, last = 0, alive = true;
    const loop = (ts) => {
      if (!alive) return;
      const s = st.current;
      if (s && ts - last >= s.speed) { last = ts; step(); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [done, started, paused, resetKey]);

  const turn = (dir) => {
    const s = st.current;
    if (!s || doneRef.current || paused) return;
    const q = snakeQueueTurn(dir, s.dir, s.turns);
    if (!q) return;
    s.turns = q;
    if (!started) setStarted(true);
    cgSound('move');
  };
  useGestures(boardRef, {
    onSwipe: (d) => turn(d),
    // A tap steers as well as starting the run (#206) — see snakeTapDir.
    onTap: (p) => {
      if (!started && !paused) setStarted(true);
      const el = boardRef.current; if (!el) return;
      const r = el.getBoundingClientRect();
      const dir = snakeTapDir(p.x - r.left, p.y - r.top, r.width, r.height);
      if (dir) turn(dir);
    },
  });
  useEffect(() => {
    const onKey = (e) => {
      const k = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.key];
      if (k) { e.preventDefault(); turn(k); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [started]);

  const s = st.current;
  const hist = cgLoadHistory(SNAKE_KEY);
  const best = hist.reduce((m, r) => Math.max(m, r.score || 0), 0);
  const longest = hist.reduce((m, r) => Math.max(m, r.len || 0), 0);
  const sheet = [
    cgHistorySection(hist, r => <><span>{r.score} pts</span><span className="mono">len {r.len}</span></>),
    cgStatsSection([
      { val: best, lbl: 'Best score' }, { val: hist.length, lbl: 'Games' },
      { val: longest, lbl: 'Longest' }, { val: score, lbl: 'This run' },
    ]),
    cgLeaderboardSection('snake', { url: '/api/snake/leaderboard' }),
    cgRulesSection(['Swipe, or tap the side of the board you want to head for — arrow keys work too. Two turns queue, so a corner takes one motion.', 'Eat the red food to grow and score.', 'Avoid the walls and your own tail.', 'It speeds up as you grow — chase a high score!', `Difficulty: ${(difficulty || 'normal').charAt(0).toUpperCase() + (difficulty || 'normal').slice(1)} — change via New Game.`]),
  ];
  return (
    <ClassicShell game={game} onExit={onBack} onNewGame={() => init()} sheetSections={sheet} menuConfig={menuConfig}>
      <div className="cg-stage">
        <CgStatus items={[{ l: 'Score', v: score }, { l: 'Length', v: s ? s.snake.length : 0 }, { l: 'Time', v: cgFmt(secs) }]} />
        <div className="snake-board-wrap">
          <div className="snake-board" ref={boardRef}>
            <SnakeCanvas n={N} stRef={st} tick={tick} skin="classic" ariaLabel={`Snake board — score ${score}, length ${s ? s.snake.length : 0}`} />
          </div>
          {paused && !done && (
            <div className="snake-pause-overlay">
              <div className="snake-pause-text">PAUSED</div>
            </div>
          )}
        </div>
        <div className="snake-hint">{started ? 'Swipe or tap a side to steer' : 'Swipe or tap a side to start'}</div>
        <CuiBar height={44} build={(W) => {
          const btns = [];
          if (started && !paused && !done) btns.push({ id: 'pause', label: 'Pause', action: () => { setPaused(true); setPausedSecs(secs); } });
          if (paused && !done) btns.push({ id: 'resume', label: 'Resume', primary: true, action: () => setPaused(false) });
          btns.push({ id: 'restart', label: 'Restart', action: () => init() });
          const br = cuiRow(Math.floor(W * 0.14), 0, Math.floor(W * 0.72), 40, btns.length);
          return btns.map((b, i) => ({ ...b, kind: 'button', r: br[i] }));
        }} />
      </div>
    </ClassicShell>
  );
}

/* `?snake=easy|normal|hard` preselects a difficulty so the BOARD itself is
   URL-reachable, exactly like Sudoku's `?sdk=9`. Without it every snake deep
   link lands on the difficulty chooser, so no navigation-only test or
   screenshot can ever see a snake board (which is what the end-of-run board
   review needs to assert on). */
function snakeDeepLinkDifficulty() {
  try {
    const d = new URLSearchParams(window.location.search).get('snake');
    return (d === 'easy' || d === 'normal' || d === 'hard') ? d : null;
  } catch (_) { return null; }
}

/* ---- Snake — Wrapper (mode selector + gameplay) ---- */
function SnakeGame({ onWin, onStepChange, resetKey, game, onBack, menuConfig, playMode, band }) {
  /* #207 — Snake's only play mode is ARCADE, and the arcade band picker on the
     pre-game screen already asks Easy / Normal / Hard. Landing on Snake's own
     "Choose Difficulty" screen straight afterwards asked the same question a
     second time, in different words, having thrown the first answer away.
     The two vocabularies are identical (ARCADE_BAND_IDS is exactly
     ['easy','normal','hard']), so the band IS the difficulty: take it and skip
     the chooser. Free play, which arrives with no band, still gets it. */
  const bandDifficulty = playMode === 'arcade' && ARCADE_BAND_IDS.indexOf(band) !== -1
    ? band : null;
  const [difficulty, setDifficulty] = useState(bandDifficulty || snakeDeepLinkDifficulty);
  const diffRef = useRef(difficulty);
  diffRef.current = difficulty;
  // This effect sends the player back to the chooser on a New Game. It must NOT
  // fire on MOUNT: with `?snake=` preselecting a difficulty, diffRef is already
  // non-null on the first pass and the mount run would immediately clobber the
  // deep link back to the chooser. (Before the deep link existed the initial
  // value was always null, so the mount pass was a silent no-op.)
  const diffMounted = useRef(false);

  useEffect(() => {
    if (!diffMounted.current) { diffMounted.current = true; return; }
    /* A New Game returns to the chooser — unless the band already answered
       the question, in which case "New Game" means another run at that band,
       not a fresh interrogation. */
    if (bandDifficulty) { setDifficulty(bandDifficulty); return; }
    if (diffRef.current !== null) {
      setDifficulty(null);
    }
  }, [resetKey]);

  if (!difficulty) {
    return (
      // The difficulty chooser used to pass sheetSections={[]}, so Snake's
      // all-time leaderboard was unreachable until you had already committed to
      // a difficulty — the one moment you'd most want to see the board. Carry
      // the same section here; it's the only sheet tab that makes sense before
      // a run has started (History/Stats belong to a chosen difficulty).
      <ClassicShell
        game={game}
        onExit={onBack}
        sheetSections={[cgLeaderboardSection('snake', { url: '/api/snake/leaderboard' })]}
        menuConfig={menuConfig}
      >
        <div className="cg-stage">
          <SnakeGameModeSelect onSelectDifficulty={(d) => setDifficulty(d)} />
        </div>
      </ClassicShell>
    );
  }

  return React.createElement(SnakeGameplay, { onWin, onStepChange, resetKey, game, onBack, difficulty, menuConfig });
}

/* ---------------- Block Blast ---------------- */
const BB_SHAPES = [
  [[0, 0]],
  [[0, 0], [0, 1]], [[0, 0], [1, 0]],
  [[0, 0], [0, 1], [0, 2]], [[0, 0], [1, 0], [2, 0]],
  [[0, 0], [0, 1], [1, 0], [1, 1]],
  [[0, 0], [0, 1], [1, 0]], [[0, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [1, 1]], [[0, 1], [1, 0], [1, 1]],
  [[0, 0], [0, 1], [0, 2], [0, 3]], [[0, 0], [1, 0], [2, 0], [3, 0]],
  [[0, 0], [0, 1], [0, 2], [1, 1]],
  [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0]],
];
const BB_COLORS = [C.accent, C.emerald, C.gold, C.violet, C.rose];
/* #176 — Block Fit's daily is the CLEANEST of the two new classic dailies:
   the piece-offer sequence does not depend on board state, so seeding it makes
   every player's run genuinely identical, not merely similarly-supplied. (2048
   cannot promise that — see t2048_addRandom.) A null rng keeps free play on
   Math.random, so nothing about the classic mode changes. */
/* #176 arcade bands — the PIECE POOL. Block Fit's difficulty is entirely a
   function of what it offers you: an 8x8 board with a steady diet of singles
   and dominoes is nearly unloseable, and one that keeps handing you 4-and-5
   cell pieces jams within a dozen placements. So a band is a slice of
   BB_SHAPES ordered by size — Easy draws only from the small end, Hard only
   from the large end, and Normal (and every other mode) uses the whole pool,
   which is the classic game unchanged. */
const BB_BAND_POOL = {
  easy:   BB_SHAPES.filter(sh => sh.length <= 3),
  normal: BB_SHAPES,
  hard:   BB_SHAPES.filter(sh => sh.length >= 4),
};

function bbRandPiece(rng, band) {
  const r = rng || Math.random;
  const pool = (band && BB_BAND_POOL[band]) || BB_SHAPES;
  const cells = pool[Math.floor(r() * pool.length)];
  return { cells, color: BB_COLORS[Math.floor(r() * BB_COLORS.length)] };
}
function bbCanPlace(grid, cells, or, oc) {
  return cells.every(([r, c]) => {
    const rr = or + r, cc = oc + c;
    return rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && !grid[rr * 8 + cc];
  });
}
function bbCanPlaceAny(grid, tray) {
  for (const p of tray) {
    if (!p) continue;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (bbCanPlace(grid, p.cells, r, c)) return true;
  }
  return false;
}
// Block Blast board (no ClassicShell) — shared by solo + online race. On
// game-over it calls onEnd(score, placed, secs); the parent decides what to do
// (solo submits the global score + shows the overlay; the race host posts to
// the room). The board itself never touches scoring endpoints.
/* Block Fit's 8×8 well as a canvas (#170 treatment). Pure display: the tray
   pieces stay DOM drag sources, the floating ghost stays DOM, and the drop
   origin keeps its getBoundingClientRect math against the same grid box —
   only the 64 cell divs became one draw pass. Piece colors are intrinsic. */
function BbGridCanvas({ grid, preview }) {
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const { boxW, boxH } = useFitBox(boxRef, { cols: 8, rows: 8 });
  const side = Math.max(0, Math.min(Math.floor(boxW), Math.floor(boxH) || Math.floor(boxW)));
  useCanvasBoard(canvasRef, {
    width: side,
    height: side,
    deps: [grid, preview, side],
    draw: (ctx) => {
      if (side < 60) return;
      const gapPx = 3;
      const cs = (side - gapPx * 7) / 8;
      for (let i = 0; i < 64; i++) {
        const r = Math.floor(i / 8), c = i % 8;
        const x = c * (cs + gapPx), y = r * (cs + gapPx);
        const pv = preview && preview[i];
        klRR(ctx, x, y, cs, cs, 4);
        /* #208 — BB_COLORS are C.* tokens ('var(--c-accent)'), which a canvas
           CANNOT resolve: the assignment is silently ignored and fillStyle
           keeps whatever it held, i.e. the PAL.bg of the previous empty cell.
           Every placed block therefore painted itself the background colour —
           the board read as empty however many pieces you had dropped. The
           tray canvas a few lines below already resolved through palOf; the
           well did not. */
        ctx.fillStyle = grid[i] ? palOf(grid[i], PAL.accent) : PAL.bg;
        ctx.fill();
        if (pv) {
          klRR(ctx, x, y, cs, cs, 4);
          ctx.fillStyle = pv === 'preview' ? 'rgba(58,110,205,0.40)' : 'rgba(205,75,58,0.33)';
          ctx.fill();
        }
      }
    },
  });
  return (
    <div className="snake-canvas-fill" ref={boxRef}>
      <canvas
        ref={canvasRef}
        className="bb-canvas board-canvas"
        role="img"
        aria-label={`Block Fit board — ${grid.filter(Boolean).length} of 64 cells filled`}
      />
    </div>
  );
}

function BlockBlastBoard({ onStepChange, resetKey, onEnd, playMode, band, offset }) {
  // Arcade narrows the pool; the daily's Easy/Hard (#331) borrow the same
  // narrowing, and Normal daily and free play use all of it.
  const bbBand = (playMode === 'arcade' || playMode === 'daily') && (band === 'easy' || band === 'hard')
    ? band : null;
  const onEndRef = useRef(onEnd); onEndRef.current = onEnd;
  /* One rng for the whole run so the offer sequence is reproducible: the daily
     seeds from today's server seed (band-mixed for Easy/Hard), arcade from a
     fresh per-run seed that is kept for replay, and free play stays on
     Math.random (null). */
  const rngRef = useRef(undefined);
  if (rngRef.current === undefined) {
    rngRef.current = (playMode === 'daily' || playMode === 'arcade')
      ? modeSeed(playMode, 'blockblast', playMode === 'daily' ? (bbBand || 0) : 0, offset).rng
      : null;
  }
  const bbRng = rngRef.current;
  const [grid, setGrid] = useState(() => new Array(64).fill(null));
  const [tray, setTray] = useState(() => [bbRandPiece(bbRng, bbBand), bbRandPiece(bbRng, bbBand), bbRandPiece(bbRng, bbBand)]);
  const [score, setScore] = useState(0);
  const [drag, setDrag] = useState(null); // { idx, cells, color, x, y }
  const [done, setDone] = useState(false);
  const doneRef = useRef(false);
  const placedRef = useRef(0);
  const linesRef = useRef(0);
  const gridRef = useRef(null);
  const secs = useElapsed(resetKey, !done);
  const secsRef = useRef(0); secsRef.current = secs;
  const scoreRef = useRef(0); scoreRef.current = score;

  const init = () => {
    setGrid(new Array(64).fill(null));
    setTray([bbRandPiece(bbRng, bbBand), bbRandPiece(bbRng, bbBand), bbRandPiece(bbRng, bbBand)]);
    setScore(0); setDone(false); setDrag(null);
    doneRef.current = false; placedRef.current = 0; linesRef.current = 0;
  };
  useEffect(() => { init(); }, [resetKey]);

  const originFromPointer = (x, y, cells) => {
    const el = gridRef.current; if (!el) return null;
    const rect = el.getBoundingClientRect();
    const cs = rect.width / 8;
    const maxR = Math.max(...cells.map(c => c[0]));
    const maxC = Math.max(...cells.map(c => c[1]));
    let oc = Math.round((x - rect.left) / cs - (maxC + 1) / 2);
    let or = Math.round((y - rect.top) / cs - (maxR + 1) / 2);
    oc = Math.max(0, Math.min(7 - maxC, oc));
    or = Math.max(0, Math.min(7 - maxR, or));
    return { or, oc };
  };
  const commitDrop = (endX, endY) => {
    setDrag(d => {
      if (!d) return null;
      const o = originFromPointer(endX, endY, d.cells);
      if (o && bbCanPlace(grid, d.cells, o.or, o.oc)) {
        place(d, o.or, o.oc);
      }
      return null;
    });
  };
  const place = (piece, or, oc) => {
    const g = grid.slice();
    piece.cells.forEach(([r, c]) => { g[(or + r) * 8 + (oc + c)] = piece.color; });
    // find full rows/cols
    const fullRows = [], fullCols = [];
    for (let r = 0; r < 8; r++) if ([0,1,2,3,4,5,6,7].every(c => g[r * 8 + c])) fullRows.push(r);
    for (let c = 0; c < 8; c++) if ([0,1,2,3,4,5,6,7].every(r => g[r * 8 + c])) fullCols.push(c);
    const lines = fullRows.length + fullCols.length;
    fullRows.forEach(r => { for (let c = 0; c < 8; c++) g[r * 8 + c] = null; });
    fullCols.forEach(c => { for (let r = 0; r < 8; r++) g[r * 8 + c] = null; });
    const gain = piece.cells.length + (lines > 0 ? lines * 10 + (lines - 1) * 10 : 0);
    placedRef.current++; linesRef.current += lines;
    cgSound(lines > 0 ? 'clear' : 'move'); cgHaptic(lines > 0 ? 25 : 10);
    setScore(s => s + gain);
    onStepChange && onStepChange(placedRef.current);
    // consume tray slot
    let nt = tray.slice();
    if (piece.idx != null) nt[piece.idx] = null;
    if (nt.every(p => !p)) nt = [bbRandPiece(bbRng, bbBand), bbRandPiece(bbRng, bbBand), bbRandPiece(bbRng, bbBand)];
    setGrid(g);
    setTray(nt);
    // game-over check next frame
    setTimeout(() => {
      if (doneRef.current) return;
      if (!bbCanPlaceAny(g, nt)) {
        doneRef.current = true; setDone(true);
        cgSound('lose'); cgHaptic([20, 40]);
        const sc = scoreRef.current;
        cgSaveHistory(BB_KEY, { score: sc, lines: linesRef.current, ts: Date.now() });
        onEndRef.current && onEndRef.current(sc, placedRef.current, secsRef.current);
      }
    }, 0);
  };
  useEffect(() => {
    if (!drag) return;
    const move = (e) => { if (e.cancelable) e.preventDefault(); const { x, y } = pointerXY(e); setDrag(d => d && { ...d, x, y }); };
    const up = (e) => { const { x, y } = pointerXY(e); commitDrop(x, y); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
    };
  }, [drag, grid, tray]);

  const startDrag = (e, idx) => {
    if (done || !tray[idx]) return;
    if (e.cancelable) e.preventDefault();
    const { x, y } = pointerXY(e);
    cgSound('click');
    setDrag({ idx, cells: tray[idx].cells, color: tray[idx].color, x, y });
  };

  // The tray draws on canvas too (controls wave): three piece slots, hit by
  // thirds; the piece lifts into the existing DOM ghost on pointerdown, so
  // the drag/drop pipeline (window-level move/up + originFromPointer against
  // the well) is untouched.
  const trayBoxRef = useRef(null);
  const trayCanvasRef = useRef(null);
  const { boxW: trayW0 } = useFitBox(trayBoxRef, { cols: 1, rows: 1, maxCell: 100000 });
  const trayW = Math.floor(trayW0);
  const BB_TRAY_H = 92;
  useCanvasBoard(trayCanvasRef, {
    width: trayW,
    height: BB_TRAY_H,
    deps: [tray, drag, trayW],
    draw: (ctx) => {
      const slotW = trayW / 3;
      for (let i = 0; i < 3; i++) {
        const p = tray[i];
        const x0 = i * slotW;
        klRR(ctx, x0 + 4, 4, slotW - 8, BB_TRAY_H - 8, 10);
        ctx.fillStyle = PAL.card;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = PAL.border;
        ctx.stroke();
        if (!p) continue;
        ctx.save();
        if (drag && drag.idx === i) ctx.globalAlpha = 0.3;
        const maxR = Math.max(...p.cells.map((c) => c[0]));
        const maxC = Math.max(...p.cells.map((c) => c[1]));
        const u = Math.min(16, Math.floor((slotW - 24) / (maxC + 1)), Math.floor((BB_TRAY_H - 24) / (maxR + 1)));
        const px0 = x0 + (slotW - (maxC + 1) * u) / 2;
        const py0 = (BB_TRAY_H - (maxR + 1) * u) / 2;
        for (const [r, c] of p.cells) {
          // BB_COLORS are C.* var() tokens (the DOM tray + the well's DOM-era
          // cells read them via CSS); the canvas resolves them through palOf.
          ctx.fillStyle = palOf(p.color, '#3A6ECD');
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(px0 + c * u, py0 + r * u, u - 1.5, u - 1.5, 2);
          else ctx.rect(px0 + c * u, py0 + r * u, u - 1.5, u - 1.5);
          ctx.fill();
        }
        ctx.restore();
      }
    },
  });
  // preview cells
  let preview = null;
  if (drag) {
    const o = originFromPointer(drag.x, drag.y, drag.cells);
    if (o) {
      const ok = bbCanPlace(grid, drag.cells, o.or, o.oc);
      preview = {};
      drag.cells.forEach(([r, c]) => { preview[(o.or + r) * 8 + (o.oc + c)] = ok ? 'preview' : 'invalid'; });
    }
  }
  return (
    <>
      <CgStatus items={[{ l: 'Score', v: score }, { l: 'Time', v: cgFmt(secs) }]} />
      <div className="bb-grid" ref={gridRef}>
        <BbGridCanvas grid={grid} preview={preview} />
      </div>
      <div className="bb-tray" ref={trayBoxRef}>
        <canvas
          ref={trayCanvasRef}
          className="bb-tray-canvas board-canvas"
          role="img"
          aria-label={`Piece tray — ${tray.filter(Boolean).length} of 3 pieces left`}
          onPointerDown={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const idx = Math.max(0, Math.min(2, Math.floor((e.clientX - rect.left) / (rect.width / 3))));
            startDrag(e, idx);
          }}
        />
      </div>
      {drag && (
        <div className="bb-drag-ghost" style={{
          left: drag.x, top: drag.y - 40,
          transform: 'translate(-50%, -50%)',
          gridTemplateColumns: `repeat(${Math.max(...drag.cells.map(c => c[1])) + 1}, 1.1rem)`,
        }}>
          {(() => {
            const maxR = Math.max(...drag.cells.map(c => c[0]));
            const maxC = Math.max(...drag.cells.map(c => c[1]));
            const set = new Set(drag.cells.map(([r, c]) => r * 10 + c));
            const out = [];
            for (let r = 0; r <= maxR; r++) for (let c = 0; c <= maxC; c++) {
              const on = set.has(r * 10 + c);
              out.push(<div key={r + '-' + c} className={'bb-pcell' + (on ? ' on' : '')} style={on ? { background: drag.color, width: '1.1rem', height: '1.1rem' } : { width: '1.1rem', height: '1.1rem', background: 'transparent' }} />);
            }
            return out;
          })()}
        </div>
      )}
    </>
  );
}

// Block Blast entry — solo (own board + leaderboard sheet) or the online-race
// host. Both wrap the shared BlockBlastBoard in the standard ClassicShell.
function BlockBlastGame({ onWin, onStepChange, resetKey, game, onBack, menuConfig, gameMode, gameModeOpts, playMode, band, offset }) {
  const [nkey, setNkey] = useState(0);
  const boardKey = `${resetKey || 0}:${nkey}`;
  const hist = cgLoadHistory(BB_KEY);
  const best = hist.reduce((m, r) => Math.max(m, r.score || 0), 0);
  const sheet = [
    cgLeaderboardSection('blockblast'),
    cgHistorySection(hist, r => <><span>{r.score} pts</span><span className="mono">{r.lines} lines</span></>),
    cgStatsSection([
      { val: best, lbl: 'Best score' }, { val: hist.length, lbl: 'Games' },
    ]),
    cgRulesSection(['Drag a block from the tray onto the grid.', 'Fill a full row or column to clear it and score.', 'Clear several lines at once for bonus points.', 'Game ends when none of the three pieces fit.']),
  ];

  if (gameMode === 'online' && gameModeOpts && gameModeOpts.roomId) {
    return (
      <ClassicShell game={game} onExit={onBack} sheetSections={[cgLeaderboardSection('blockblast')]} menuConfig={menuConfig}>
        <ClassicRaceGame
          game={game}
          roomId={gameModeOpts.roomId}
          myPlayerNum={gameModeOpts.roomAction === 'join' ? 2 : 1}
          onExitLobby={() => onBack && onBack()}
          renderBoard={({ onEnd }) => <BlockBlastBoard onStepChange={onStepChange} resetKey={boardKey} onEnd={(sc) => onEnd(sc)} />}
        />
      </ClassicShell>
    );
  }

  return (
    <ClassicShell game={game} onExit={onBack} onNewGame={() => setNkey(k => k + 1)} sheetSections={sheet} menuConfig={menuConfig}>
      <div className="cg-stage">
        <BlockBlastBoard
          onStepChange={onStepChange}
          resetKey={boardKey}
          playMode={playMode}
          band={band}
          offset={offset}
          onEnd={(sc, placed, secs) => {
            /* Only free play feeds the all-time classic board. A daily run is
               settled by the shell's daily pipeline and an arcade run by the
               per-band board, so submitting here too would put one run on two
               ladders. */
            if (!playMode) submitClassicScore('blockblast', sc);
            onWin(sc, placed, secs, { winnerLabel: 'Game Over', share: `🧱 Block Fit — ${sc} pts` });
          }}
        />
      </div>
    </ClassicShell>
  );
}

/* ---------------- Diamond Rush ---------------- */
const DR_GEMS = ['💎', '🔴', '🟡', '🟢', '🟣', '🔵', '💣', '⚡', '🌈'];
const DR_POWER_UP_ICONS = { hint: '💡', shuffle: '🔀', extraTime: '⏱️' };
const DR_POWER_UP_TYPES = { 6: 'hint', 7: 'shuffle', 8: 'extraTime' };
const DR_POWER_UP_REWARDS = {
  win: [
    { cascades: 3, reward: 'shuffle' },
    { moves: 15, reward: 'hint' },
    { always: true, reward: 'extraTime' },
  ],
};
function comboMultiplier(combo) {
  if (combo <= 1) return 1.0;
  if (combo <= 3) return 1.2;
  if (combo <= 5) return 1.5;
  return 2.0;
}
/* The story ladder: target up, moves down. Eight rungs, mirroring
   STORY_BANDS.diamondrush in server.js. */
const DR_BANDS = [
  { target: 500,  moves: 20 },
  { target: 800,  moves: 18 },
  { target: 1200, moves: 18 },
  { target: 1600, moves: 17 },
  { target: 2100, moves: 16 },
  { target: 2700, moves: 15 },
  { target: 3400, moves: 14 },
  { target: 4200, moves: 13 },
];

function drMake(powerUpSeed = false) {
  const g = new Array(64);
  for (let i = 0; i < 64; i++) {
    let v;
    do {
      if (powerUpSeed && Math.random() < 0.08) {
        v = 6 + Math.floor(Math.random() * 3);
      } else {
        v = Math.floor(Math.random() * 6);
      }
    }
    while (
      (i % 8 >= 2 && g[i - 1] === v && g[i - 2] === v) ||
      (i >= 16 && g[i - 8] === v && g[i - 16] === v)
    );
    g[i] = v;
  }
  return g;
}
function drFindMatches(g, onPowerUpEarned) {
  const m = new Set();
  let sourceColor = null;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 6; c++) {
    const i = r * 8 + c, v = g[i];
    if (v != null && v < 6 && g[i + 1] === v && g[i + 2] === v) {
      m.add(i); m.add(i + 1); m.add(i + 2);
      if (sourceColor === null) sourceColor = v;
    }
  }
  for (let c = 0; c < 8; c++) for (let r = 0; r < 6; r++) {
    const i = r * 8 + c, v = g[i];
    if (v != null && v < 6 && g[i + 8] === v && g[i + 16] === v) {
      m.add(i); m.add(i + 8); m.add(i + 16);
      if (sourceColor === null) sourceColor = v;
    }
  }
  if (onPowerUpEarned) {
    m.forEach(i => {
      const gemType = g[i];
      if (gemType >= 6 && gemType <= 8) {
        const powerUpType = DR_POWER_UP_TYPES[gemType];
        onPowerUpEarned(powerUpType);
      }
    });
  }
  return { matches: m, sourceColor };
}
function drCreateSpecialGem(g, matchSet, sourceColor, rainbowMeta) {
  const count = matchSet.size;
  if (count < 3) return null;
  let gemType = null;
  if (count >= 7) gemType = 8; // Rainbow
  else if (count >= 5) gemType = 7; // Lightning
  else if (count >= 3) gemType = 6; // Bomb
  if (gemType === null) return null;
  const positions = Array.from(matchSet).map(i => ({ r: Math.floor(i / 8), c: i % 8 }));
  const centerR = Math.round(positions.reduce((s, p) => s + p.r, 0) / positions.length);
  const centerC = Math.round(positions.reduce((s, p) => s + p.c, 0) / positions.length);
  const centerIndex = centerR * 8 + centerC;
  g[centerIndex] = gemType;
  if (gemType === 8) rainbowMeta.set(centerIndex, sourceColor);
  return centerIndex;
}
function drResolveSpecialEffects(g, specialIndex, rainbowMeta, toClear, processed = new Set()) {
  if (processed.has(specialIndex)) return toClear;
  processed.add(specialIndex);
  const gemType = g[specialIndex];
  const r = Math.floor(specialIndex / 8), c = specialIndex % 8;
  if (gemType === 6) { // Bomb 3×3
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
          toClear.add(nr * 8 + nc);
        }
      }
    }
  } else if (gemType === 7) { // Lightning row+col
    for (let col = 0; col < 8; col++) toClear.add(r * 8 + col);
    for (let row = 0; row < 8; row++) toClear.add(row * 8 + c);
  } else if (gemType === 8) { // Rainbow color match
    const sourceColor = rainbowMeta.get(specialIndex);
    for (let i = 0; i < 64; i++) {
      if (g[i] === sourceColor) toClear.add(i);
    }
  }
  const newSpecials = new Set();
  for (let i of toClear) {
    if ((g[i] === 6 || g[i] === 7 || g[i] === 8) && !processed.has(i)) {
      newSpecials.add(i);
    }
  }
  for (let special of newSpecials) {
    toClear = drResolveSpecialEffects(g, special, rainbowMeta, toClear, processed);
  }
  return toClear;
}
function drResolve(grid) {
  let g = grid.slice();
  let rainbowMeta = new Map();
  let total = 0, cascades = 0, maxClear = 0;
  while (true) {
    const matchResult = drFindMatches(g);
    const m = matchResult.matches;
    const sourceColor = matchResult.sourceColor;
    if (!m.size) break;
    const specialGemIndex = drCreateSpecialGem(g, m, sourceColor, rainbowMeta);
    let toClear = new Set(m);
    if (specialGemIndex !== null) {
      toClear = drResolveSpecialEffects(g, specialGemIndex, rainbowMeta, toClear, new Set());
    }
    cascades++;
    maxClear = Math.max(maxClear, toClear.size);
    total += toClear.size * 10 * cascades;
    toClear.forEach(i => {
      g[i] = null;
      rainbowMeta.delete(i);
    });
    for (let c = 0; c < 8; c++) {
      const col = [];
      for (let r = 7; r >= 0; r--) { const v = g[r * 8 + c]; if (v != null) col.push(v); }
      for (let r = 7; r >= 0; r--) {
        const idx = (7 - r);
        g[r * 8 + c] = idx < col.length ? col[idx] : Math.floor(Math.random() * 6);
      }
    }
  }
  return { grid: g, total, cascades, maxClear };
}

function findHighestScoringSwap(grid) {
  let best = { a: -1, b: -1, score: 0 };
  for (let i = 0; i < 64; i++) {
    const r = Math.floor(i / 8), c = i % 8;
    const neighbors = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
    for (const [nr, nc] of neighbors) {
      if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8) continue;
      const j = nr * 8 + nc;
      if (j <= i) continue;
      const g = grid.slice();
      [g[i], g[j]] = [g[j], g[i]];
      const m = drFindMatches(g);
      const score = m.matches.size * 10;
      if (score > best.score) best = { a: i, b: j, score };
    }
  }
  return best;
}
function DiamondRushGame({ onWin, onLose, onStepChange, resetKey, game, onBack, menuConfig, savedProgress, onSaveProgress, playMode, band }) {
  /* #176 — Diamond Rush's ladder is its own two dials: how many points you
     must reach and how many moves you get to do it in. Nothing else about the
     game changes across a band, which is right — the tension here is entirely
     "can I find enough cascades before the moves run out".

     (An earlier reading of this game had it as a five-level tile-maze
     adventure with server-saved progress. That was DEAD CODE — an authored
     maze, its two API routes and its table, none of them reachable from any
     component. All of it is deleted in this commit. The game players actually
     open is this gem-swap board, and this is its ladder.) */
  const drBandIdx = playMode === 'story' ? Math.max(0, band || 0)
    : playMode === 'arcade'
      ? [1, 4, 7][Math.max(0, ARCADE_BANDS.findIndex(b => b.id === band))]
      : /* #331 — the daily's Easy/Hard are the ladder's gentlest and hardest
           rungs; Normal keeps the classic 800/18 deal (rung 1's numbers,
           reached here through the null branch below). */
        (playMode === 'daily' && (band === 'easy' || band === 'hard'))
          ? (band === 'easy' ? 0 : DR_BANDS.length - 1)
          : null;
  const drSpec = drBandIdx != null ? DR_BANDS[Math.min(DR_BANDS.length - 1, drBandIdx)] : null;
  const TARGET = drSpec ? drSpec.target : 800;
  const START_MOVES = drSpec ? drSpec.moves : 18;
  const [grid, setGrid] = useState(() => drMake());
  const [sel, setSel] = useState(-1);
  const [moves, setMoves] = useState(START_MOVES);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [done, setDone] = useState(false);
  const [powerUps, setPowerUps] = useState(() => (savedProgress?.powerUps || { hint: 0, shuffle: 0, extraTime: 0 }));
  const [hintIndices, setHintIndices] = useState([]);
  const [timeBoost, setTimeBoost] = useState(false);
  const doneRef = useRef(false);
  const bestCascadeRef = useRef(0);
  const bestComboRef = useRef(0);
  const touch = useRef(null);
  const timeAddedRef = useRef(0);
  const secs = useElapsed(resetKey, !done) + timeAddedRef.current;
  const secsRef = useRef(0); secsRef.current = secs;

  const init = () => {
    setGrid(drMake()); setSel(-1); setMoves(START_MOVES); setScore(0); setCombo(0);
    setDone(false); doneRef.current = false; bestCascadeRef.current = 0; bestComboRef.current = 0;
    setHintIndices([]);
    timeAddedRef.current = 0;
  };
  useEffect(() => { init(); }, [resetKey]);

  const grantPowerUp = (type) => {
    setPowerUps(prev => ({ ...prev, [type]: prev[type] + 1 }));
  };

  const onPowerUpEarned = (type) => {
    grantPowerUp(type);
  };

  const finish = (sc, win, mv) => {
    doneRef.current = true; setDone(true);
    cgSound(win ? 'win' : 'lose'); cgHaptic(win ? [15, 30, 15] : [20, 40]);
    cgSaveHistory(DR_KEY, { score: sc, win, cascade: bestCascadeRef.current, bestCombo: bestComboRef.current, ts: Date.now() });
    submitClassicScore('diamondrush', sc, { level: 1, movesUsed: START_MOVES - mv, targetReached: win ? 1 : 0 });
    setCombo(0);
    if (win) {
      if (bestCascadeRef.current >= 3) grantPowerUp('shuffle');
      if (mv >= 15) grantPowerUp('hint');
      grantPowerUp('extraTime');
      onWin(sc, START_MOVES - mv, secsRef.current, { share: `💎 Diamond Rush — ${sc} pts!` });
    } else {
      grantPowerUp('extraTime');
      // PHASE 3 (#161) — carry the gems actually collected; submitClassicScore
      // on the line above already banked exactly this number.
      onLose(START_MOVES - mv, secsRef.current, {
        score: sc,
        scoreLabel: 'Target',
        scoreValue: `${sc} / ${TARGET}`,
        share: `💎 Diamond Rush — ${sc}/${TARGET}`,
      });
    }
  };
  const adjacent = (a, b) => {
    const ar = Math.floor(a / 8), ac = a % 8, br = Math.floor(b / 8), bc = b % 8;
    return Math.abs(ar - br) + Math.abs(ac - bc) === 1;
  };
  const trySwap = (a, b) => {
    if (done || a === b || !adjacent(a, b)) { setSel(-1); return; }
    const g = grid.slice();
    [g[a], g[b]] = [g[b], g[a]];
    if (!drFindMatches(g).matches.size) { cgSound('move'); setCombo(0); setSel(-1); return; }
    drFindMatches(g, onPowerUpEarned);
    const newCombo = combo + 1;
    const multiplier = comboMultiplier(newCombo);
    const res = drResolve(g);
    bestCascadeRef.current = Math.max(bestCascadeRef.current, res.cascades);
    cgSound('clear', 1 + res.cascades * 0.12); cgHaptic(20);
    const baseScore = res.total;
    const multipliedScore = Math.round(baseScore * multiplier);
    const ns = score + multipliedScore;
    const nm = moves - 1;
    setGrid(res.grid); setScore(ns); setCombo(newCombo); setMoves(nm); setSel(-1);
    if (newCombo > bestComboRef.current) bestComboRef.current = newCombo;
    onStepChange && onStepChange(START_MOVES - nm);
    if (ns >= TARGET) { setTimeout(() => finish(ns, true, nm), 150); }
    else if (nm <= 0) { setTimeout(() => finish(ns, false, nm), 150); }
  };
  /* The board is a CANVAS (#170 treatment) — same tap-or-swipe grammar as the
     DOM gems: press a gem and release nearby to select/swap-with-selection,
     or flick past the threshold to swap toward the flick. */
  const drBoxRef = useRef(null);
  const drCanvasRef = useRef(null);
  const { cell: drCell } = useFitBox(drBoxRef, { cols: 8, rows: 8, minCell: 28, maxCell: 56, gap: 2 });
  const drStep = drCell + 2;
  const drSide = drStep * 8 - 2;
  const drGeoRef = useRef(0);
  drGeoRef.current = drStep;
  const drCellAt = (p) => {
    const stp = drGeoRef.current;
    const c = Math.floor(p.x / stp), r = Math.floor(p.y / stp);
    if (c < 0 || c > 7 || r < 0 || r > 7) return -1;
    return r * 8 + c;
  };
  usePointerCell(drCanvasRef, {
    onDown: (p) => {
      const i = drCellAt(p);
      touch.current = i >= 0 ? { i, x: p.x, y: p.y } : null;
    },
    onUp: (p) => {
      const start = touch.current; touch.current = null;
      if (!start || done) return;
      const dx = p.x - start.x, dy = p.y - start.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > 18) {
        const r = Math.floor(start.i / 8), c = start.i % 8;
        let nr = r, nc = c;
        if (Math.abs(dx) > Math.abs(dy)) nc += dx > 0 ? 1 : -1; else nr += dy > 0 ? 1 : -1;
        if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) trySwap(start.i, nr * 8 + nc);
        else setSel(-1);
        return;
      }
      if (sel === -1) { setSel(start.i); cgSound('click'); }
      else if (sel === start.i) { setSel(-1); }
      else trySwap(sel, start.i);
    },
  }, { moveTolerance: 4 });
  useCanvasBoard(drCanvasRef, {
    width: drSide,
    height: drSide,
    deps: [grid, sel, hintIndices, done, drCell],
    draw: (ctx) => {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const GLOW = { 6: 'rgba(255,193,7,0.5)', 7: 'rgba(100,200,255,0.6)', 8: 'rgba(200,100,255,0.55)' };
      for (let i = 0; i < 64; i++) {
        const v = grid[i];
        if (v == null) continue;
        const r = Math.floor(i / 8), c = i % 8;
        const x = c * drStep, y = r * drStep;
        const cx = x + drCell / 2, cy = y + drCell / 2;
        if (v >= 6) {
          // Intrinsic special-gem glow (bomb / lightning / rainbow).
          klRR(ctx, x, y, drCell, drCell, 6);
          ctx.fillStyle = v === 6 ? 'rgba(255,193,7,0.15)' : v === 7 ? 'rgba(100,200,255,0.15)' : 'rgba(200,100,255,0.15)';
          ctx.fill();
          ctx.save();
          ctx.shadowColor = GLOW[v];
          ctx.shadowBlur = 12;
          ctx.font = `${Math.round(drCell * 0.62)}px system-ui, sans-serif`;
          ctx.fillText(DR_GEMS[v], cx, cy + 1);
          ctx.restore();
        } else {
          ctx.font = `${Math.round(drCell * 0.62)}px system-ui, sans-serif`;
          ctx.fillText(DR_GEMS[v], cx, cy + 1);
        }
        if (sel === i) {
          klRR(ctx, x + 1, y + 1, drCell - 2, drCell - 2, 6);
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#fff';
          ctx.stroke();
        }
        if (hintIndices.includes(i)) {
          klRR(ctx, x - 1, y - 1, drCell + 2, drCell + 2, 7);
          ctx.lineWidth = 3;
          ctx.strokeStyle = PAL.gold;
          ctx.stroke();
        }
      }
    },
  });
  const usePowerUp = (type) => {
    if (done || powerUps[type] <= 0) return;
    if (type === 'hint') {
      const best = findHighestScoringSwap(grid);
      if (best.a !== -1) {
        setHintIndices([best.a, best.b]);
        setTimeout(() => setHintIndices([]), 2000);
      }
    } else if (type === 'shuffle') {
      const g = grid.slice();
      const nonNull = [];
      for (let i = 0; i < 64; i++) if (g[i] != null && g[i] < 6) nonNull.push(i);
      for (let i = nonNull.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [g[nonNull[i]], g[nonNull[j]]] = [g[nonNull[j]], g[nonNull[i]]];
      }
      setGrid(g);
      cgSound('click'); cgHaptic(30);
    } else if (type === 'extraTime') {
      timeAddedRef.current += 30;
      setTimeBoost(true);
      setTimeout(() => setTimeBoost(false), 1000);
      cgSound('click'); cgHaptic(15);
    }
    setPowerUps(prev => ({ ...prev, [type]: prev[type] - 1 }));
  };

  const hist = cgLoadHistory(DR_KEY);
  const best = hist.reduce((m, r) => Math.max(m, r.score || 0), 0);
  const wins = hist.filter(r => r.win).length;
  const bigC = hist.reduce((m, r) => Math.max(m, r.cascade || 0), 0);
  const bestCombo = hist.reduce((m, r) => Math.max(m, r.bestCombo || 0), 0);
  const sheet = [
    cgHistorySection(hist, r => <><span>{r.win ? '✅' : '❌'} {r.score} pts</span><span className="mono">x{r.cascade}</span><span className="mono">c{r.bestCombo || 0}</span></>),
    cgStatsSection([
      { val: best, lbl: 'Best score' }, { val: wins, lbl: 'Rounds won' },
      { val: bigC, lbl: 'Best cascade' }, { val: bestCombo, lbl: 'Best combo' },
    ]),
    cgLeaderboardSection('diamondrush'),
    cgRulesSection([`WIN: reach ${TARGET} points within ${START_MOVES} moves. Falling short is a loss, however high you scored.`, 'Tap a gem then an adjacent gem — or swipe — to swap.', 'Line up 3+ to clear them. Special gems: 3-match→Bomb (3×3), 5+→Lightning (row+col), 7+→Rainbow (color).', 'Falling gems can chain into cascades for big bonuses.', 'Each consecutive clear builds your combo, multiplying your score — reset on any failed swap.', 'Use power-ups (Hint, Shuffle, Extra Time) to gain an edge.']),
  ];
  return (
    <ClassicShell game={game} onExit={onBack} onNewGame={() => init()} sheetSections={sheet} menuConfig={menuConfig}>
      <div className="cg-stage">
        <CgStatus items={[{ l: 'Score', v: `${score}` }, { l: 'Target', v: `${TARGET}` }, { l: 'Moves', v: moves }, { l: 'Combo', v: combo > 0 ? `${combo} / ×${comboMultiplier(combo).toFixed(1)}` : '—' }, { l: 'Time', v: cgFmt(secs) }]} />
        {/* #209 — the run's progression, off the REAL win condition rather
            than a number invented for the HUD: finish above TARGET before
            START_MOVES runs out, which is exactly what `finish(sc, win, mv)`
            decides on. Score and Target are their own pills now (they were one
            "340/800" pill, which reads as a score, not as a goal), and the bar
            plus the line under it say how far there is to go and whether the
            moves can still get you there. Both story and arcade have a real
            target — free play falls back to the same 800/18 the game has
            always used — so this renders in every mode. */}
        <CuiBar height={36} build={(W) => {
          const pad = Math.floor(W * 0.06);
          const bw = Math.max(20, W - pad * 2);
          const reached = score >= TARGET;
          const left = Math.max(0, TARGET - score);
          return [
            { id: 'dr-meter', kind: 'meter', r: [pad, 3, bw, 9], p: TARGET > 0 ? score / TARGET : 0, done: reached,
              twinLabel: `Progress ${score} of ${TARGET} points` },
            { id: 'dr-goal', kind: 'label', r: [0, 16, W, 18], font: 11.5,
              label: reached
                ? `🎉 Target reached — ${moves} ${moves === 1 ? 'move' : 'moves'} left to build on it`
                : `${left} more ${left === 1 ? 'point' : 'points'} in ${moves} ${moves === 1 ? 'move' : 'moves'}`,
              color: reached ? PAL.emerald : PAL.muted },
          ];
        }} />
        <CuiBar height={44} build={(W) => {
          const br = cuiRow(Math.floor(W * 0.08), 0, Math.floor(W * 0.84), 40, 3);
          return ['hint', 'shuffle', 'extraTime'].map((type, i) => ({
            id: 'pw-' + type, kind: 'button', r: br[i],
            label: `${DR_POWER_UP_ICONS[type]} ${powerUps[type]}`,
            disabled: powerUps[type] === 0 || done,
            on: powerUps[type] > 0,
            action: () => usePowerUp(type),
          }));
        }} />
        <div className="dr-grid" ref={drBoxRef}>
          <canvas
            ref={drCanvasRef}
            className="dr-canvas board-canvas"
            role="grid"
            aria-label={`Diamond Rush board — score ${score} of ${TARGET}, ${moves} moves left`}
          />
        </div>
        {timeBoost && <div className="dr-time-boost">+30 sec</div>}
      </div>
    </ClassicShell>
  );
}

