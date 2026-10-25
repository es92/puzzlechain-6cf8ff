/* ============================================================
   Daily Snake — seeded, bounded daily variant (change-list item 8).
   Same 13×13 run for everyone: the apple SEQUENCE comes from today's
   seed, speed ramps deterministically, and the session is bounded —
   eat 20 apples to win, crash to lose the day. Real-time, so there is
   deliberately NO mid-run resume: leaving restarts the run.
   ============================================================ */
const DSNK_N = 13;
const DSNK_TARGET = 20;
/* #331 — the daily gains Easy/Hard as speed dials: where the ramp starts, how
   hard it bites, and where it floors. The apple count and the sequence shape
   are the daily's contract and stay fixed; Normal keeps the pre-band numbers
   (205 / 5 / 115) byte-for-byte. */
const DSNK_BANDS = {
  easy:   { base: 235, accel: 3.5, floor: 135 },
  normal: { base: 205, accel: 5,   floor: 115 },
  hard:   { base: 175, accel: 7,   floor: 95 },
};

function DailySnakeGame({ onWin, onLose, onStepChange, offset, band }) {
  const dailyBand = (band === 'easy' || band === 'hard') ? band : null;
  const [tick, render] = useState(0);
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);
  const [eaten, setEaten] = useState(0);
  const boardRef = useRef(null);
  const st = useRef(null);
  const doneRef = useRef(false);
  const { secs } = useTimer(started && !done, 0);
  const secsRef = useRef(0); secsRef.current = secs;

  // Today's apple sequence — everyone gets the same ordered list; a cell
  // occupied by the snake is skipped (deterministically) to the next entry.
  const foodSeq = useRef(null);
  if (!foodSeq.current) {
    const rng = dailyRng(offset, 'snakedaily', dailyBand); // null → pre-band seed
    foodSeq.current = Array.from({ length: 600 }, () => Math.floor(rng() * DSNK_N * DSNK_N));
  }

  const spawnFood = (snake, ptr) => {
    const seq = foodSeq.current;
    for (let k = ptr; k < seq.length; k++) {
      const cell = seq[k];
      const x = cell % DSNK_N, y = Math.floor(cell / DSNK_N);
      if (!snake.some(s => s.x === x && s.y === y)) return { food: { x, y }, ptr: k + 1 };
    }
    // Sequence exhausted (practically unreachable) — linear scan fallback.
    for (let i = 0; i < DSNK_N * DSNK_N; i++) {
      const x = i % DSNK_N, y = Math.floor(i / DSNK_N);
      if (!snake.some(s => s.x === x && s.y === y)) return { food: { x, y }, ptr };
    }
    return { food: { x: 0, y: 0 }, ptr };
  };

  if (!st.current) {
    const m = Math.floor(DSNK_N / 2);
    const snake = [{ x: m, y: m }, { x: m - 1, y: m }, { x: m - 2, y: m }];
    const sp = spawnFood(snake, 0);
    st.current = { snake, dir: { x: 1, y: 0 }, turns: [], food: sp.food, ptr: sp.ptr, eaten: 0 };
  }

  const finish = (won) => {
    if (doneRef.current) return;
    doneRef.current = true;
    setDone(true);
    const s = st.current;
    if (won) {
      const score = Math.max(1800 - secsRef.current * 5, 600);
      onWin(score, DSNK_TARGET, secsRef.current, { share: `🐍 Daily Snake — all ${DSNK_TARGET} apples in ${secsRef.current}s` });
    } else {
      onLose && onLose(s.eaten, secsRef.current, { share: `🐍 Daily Snake — ${s.eaten}/${DSNK_TARGET} apples` });
    }
  };

  const step = () => {
    const s = st.current;
    if (!s || doneRef.current) return;
    if (s.turns.length) s.dir = s.turns.shift();   // one turn per tick (#206)
    const head = s.snake[0];
    const nx = head.x + s.dir.x, ny = head.y + s.dir.y;
    if (nx < 0 || ny < 0 || nx >= DSNK_N || ny >= DSNK_N ||
        s.snake.some((seg, i) => i < s.snake.length - 1 && seg.x === nx && seg.y === ny)) {
      finish(false);
      return;
    }
    s.snake.unshift({ x: nx, y: ny });
    if (nx === s.food.x && ny === s.food.y) {
      s.eaten++;
      setEaten(s.eaten);
      onStepChange && onStepChange(s.eaten);
      if (s.eaten >= DSNK_TARGET) { finish(true); return; }
      const sp = spawnFood(s.snake, s.ptr);
      s.food = sp.food; s.ptr = sp.ptr;
    } else {
      s.snake.pop();
    }
    render(n => n + 1);
  };

  useEffect(() => {
    if (done || !started) return;
    let raf, last = 0, alive = true;
    const loop = (ts) => {
      if (!alive) return;
      const dsnkSpeed = DSNK_BANDS[dailyBand || 'normal'];
      const speed = Math.max(dsnkSpeed.floor, dsnkSpeed.base - st.current.eaten * dsnkSpeed.accel);
      if (ts - last >= speed) { last = ts; step(); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [done, started]);

  // Same rule as the classic snake, from the same pure function (#206).
  const turn = (dir) => {
    const s = st.current;
    if (!s || doneRef.current) return;
    const q = snakeQueueTurn(dir, s.dir, s.turns);
    if (!q) return;
    s.turns = q;
    if (!started) setStarted(true);
    cgSound('move');
  };
  useGestures(boardRef, {
    onSwipe: (d) => turn(d),
    onTap: (p) => {
      if (!started && !done) setStarted(true);
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
  const fmt = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

  return (
    // PHASE 3 — fit column so a swipe on the board never pulls the page.
    <div className="fit-col">
      <CuiBar height={46} build={(W) => {
        const pr = cuiRow(0, 0, W, 46, 3);
        return [
          { id: 'p-time', kind: 'pill', r: pr[0], label: 'Time', value: fmt, gold: true },
          { id: 'p-apples', kind: 'pill', r: pr[1], label: 'Apples', value: `${eaten}/${DSNK_TARGET}` },
          { id: 'p-length', kind: 'pill', r: pr[2], label: 'Length', value: s.snake.length },
        ];
      }} />
      <div className="dsnk-board" ref={boardRef}>
        <SnakeCanvas n={DSNK_N} stRef={st} tick={tick} skin="daily" ariaLabel={`Daily Snake board — ${eaten}/${DSNK_TARGET} apples`} />
      </div>
      <div className="dsnk-hint">
        {done ? 'Run over' : started ? `Eat ${DSNK_TARGET} apples — one crash ends the day` : 'Swipe or tap a side to start — everyone gets the same apple trail today'}
      </div>
    </div>
  );
}
