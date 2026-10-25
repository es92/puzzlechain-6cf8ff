/* ============================================================
   Daily Bounce — seeded, bounded brick-breaker daily (change-list item 9).
   One wall for everyone from today's seed; 3 balls. Clear the wall to
   win, run out of balls to lose the day. Real-time — no mid-run resume.
   ============================================================ */
const DBNC_W = 320, DBNC_H = 430, DBNC_COLS = 8, DBNC_ROWS = 6;
const DBNC_PADDLE_W = 64, DBNC_PADDLE_H = 10, DBNC_PADDLE_Y = DBNC_H - 26, DBNC_BALL_R = 6;
const DBNC_BALLS = 3;
/* #331 — the daily gains Easy/Hard as wall-and-supply dials: how many balls
   you get, how often a cell is a gap (easy leaves more holes, hard builds
   denser walls) and how the surviving HP mix leans. The wall stays a pure
   function of the seed either way — thresholds only, no extra draws. Normal
   keeps the pre-band numbers byte-for-byte. */
const DBNC_BANDS = {
  easy:   { balls: 4, gap: 0.24, hp1: 0.75, hp2: 0.95 },
  normal: { balls: DBNC_BALLS, gap: 0.15, hp1: 0.60, hp2: 0.88 },
  hard:   { balls: 2, gap: 0.08, hp1: 0.45, hp2: 0.82 },
};

// Phase 8 (#135) — power-ups are PRE-ASSIGNED to bricks from the daily seed,
// not rolled when a brick breaks. `spawnPowerup` uses Math.random()/Date.now(),
// which would make an ostensibly-fair daily differ per player; baking the drop
// into the deal means two people playing today get identical drops from
// identical bricks without touching the physics loop.
const DBNC_PU_RATE = 0.1;
const DBNC_PU_TYPES = POWERUP_TYPES.bounce;
const DBNC_PU_DUR = POWERUP_DURATION_MS;

function dbncBuildBricks(rng, cfg) {
  const band = cfg || DBNC_BANDS.normal;
  const bricks = [];
  const cellW = DBNC_W / DBNC_COLS, cellH = 20, top = 44;
  for (let r = 0; r < DBNC_ROWS; r++) {
    for (let c = 0; c < DBNC_COLS; c++) {
      const roll = rng();
      if (roll < band.gap) continue; // gap
      const hp = roll < band.hp1 ? 1 : roll < band.hp2 ? 2 : 3;
      // Two extra draws per surviving brick — order is fixed by the loop, so
      // the whole wall (bricks AND drops) is a pure function of the seed.
      const carries = rng() < DBNC_PU_RATE;
      const puType = DBNC_PU_TYPES[Math.floor(rng() * DBNC_PU_TYPES.length) % DBNC_PU_TYPES.length];
      bricks.push({
        x: c * cellW + 2, y: top + r * cellH + 2, w: cellW - 4, h: cellH - 4, hp,
        powerup: carries ? puType : null,
      });
    }
  }
  return bricks;
}

// A dropped power-up capsule. Deterministic: no Math.random, no Date.now.
function dbncDropPowerup(br) {
  return {
    type: br.powerup,
    x: br.x + br.w / 2,
    y: br.y + br.h / 2,
    vy: 90,
    r: 9,
  };
}

function DailyBounceGame({ onWin, onLose, onStepChange, offset, band }) {
  const dailyBand = (band === 'easy' || band === 'hard') ? band : null;
  const dbncCfg = DBNC_BANDS[dailyBand || 'normal'];
  const canvasRef = useRef(null);
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);
  const [balls, setBalls] = useState(dbncCfg.balls);
  const [score, setScore] = useState(0);
  const { secs } = useTimer(started && !done, 0);
  const secsRef = useRef(0); secsRef.current = secs;

  const st = useRef(null);
  if (!st.current) {
    st.current = {
      bricks: dbncBuildBricks(dailyRng(offset, 'bouncedaily', dailyBand), dbncCfg),
      paddle: DBNC_W / 2,
      ball: { x: DBNC_W / 2, y: DBNC_PADDLE_Y - DBNC_BALL_R - 1, vx: 0, vy: 0 },
      launched: false, balls: dbncCfg.balls, score: 0, broken: 0, done: false,
      // Phase 8 — falling capsules + timed effects (all seeded, see above).
      drops: [], effects: {}, extraBalls: [], paddleW: DBNC_PADDLE_W,
      lasers: [], laserCooldown: 0, picked: 0,
    };
    st.current.total = st.current.bricks.length;
  }
  const [effectLabels, setEffectLabels] = useState([]);
  const onWinRef = useRef(onWin); onWinRef.current = onWin;
  const onLoseRef = useRef(onLose); onLoseRef.current = onLose;
  const onStepRef = useRef(onStepChange); onStepRef.current = onStepChange;

  const finish = (won) => {
    const s = st.current;
    if (s.done) return;
    s.done = true;
    setDone(true);
    if (won) {
      const total = s.score + 150 * (s.balls - 1) + Math.max(0, 500 - secsRef.current * 2) + s.picked * 25;
      onWinRef.current(total, s.broken, secsRef.current, { share: `🧱 Daily Bounce — wall cleared in ${secsRef.current}s` });
    } else {
      onLoseRef.current && onLoseRef.current(s.broken, secsRef.current, { share: `🧱 Daily Bounce — ${s.broken}/${s.total} bricks` });
    }
  };

  const launch = () => {
    const s = st.current;
    if (s.done || s.launched) return;
    s.launched = true;
    if (!started) setStarted(true);
    s.ball.vx = 150; s.ball.vy = -240;
  };

  // Simulation + paint loop (refs only; React state just mirrors the HUD).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = guardCanvasCtx(canvas.getContext('2d'));
    let raf, lastTs = null, alive = true;

    /* Phase 1 — DPR-correct backing store. DBNC_W/DBNC_H stay the LOGICAL
       coordinate space (the physics is untouched); only the device-pixel
       resolution changes, which is what made the board look soft on a phone.

       #149 — the CSS size used to be pinned to the LOGICAL size (320×430),
       which left ~135px of dead space at the bottom of the fit column on a
       phone. It is now driven by the measured wrapper box, preserving the
       aspect ratio. Scaling via the backing store rather than a CSS transform
       keeps the canvas CRISP (a transform would scale rasterized pixels), and
       the pointer mapping is getBoundingClientRect-based already, so the
       physics and input math are untouched at any size. */
    const sizeCanvas = () => {
      const dpr = canvasDpr();
      const wrap = canvas.parentElement;
      const availW = wrap ? wrap.clientWidth : DBNC_W;
      const availH = wrap ? wrap.clientHeight : DBNC_H;
      // Never upscale past the logical size on a desktop-wide column, and never
      // fall below a playable floor if the box is measured mid-layout as 0.
      const fit = (availW > 0 && availH > 0)
        ? Math.min(availW / DBNC_W, availH / DBNC_H, 1.6)
        : 1;
      const scale = Math.max(0.5, fit);
      const cssW = Math.round(DBNC_W * scale), cssH = Math.round(DBNC_H * scale);
      const pw = Math.round(cssW * dpr), ph = Math.round(cssH * dpr);
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
      // One transform maps the untouched 320×430 logical space onto the
      // device-pixel backing store.
      const k = dpr * scale;
      ctx.setTransform(k, 0, 0, k, 0, 0);
    };
    sizeCanvas();
    window.addEventListener('resize', sizeCanvas);
    let dbncRO = null;
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      dbncRO = new ResizeObserver(() => sizeCanvas());
      dbncRO.observe(canvas.parentElement);
    }

    // Timed power-up effects. `until` is a monotonic ms timestamp from the rAF
    // clock, never Date.now(), so a backgrounded tab can't silently expire them.
    const effectOn = (type) => !!(st.current.effects[type] > 0);

    const tick = (ts) => {
      if (!alive) return;
      const s = st.current;
      const dt = lastTs == null ? 0 : Math.min(0.033, (ts - lastTs) / 1000);
      lastTs = ts;

      // Decay active effects.
      let labelsDirty = false;
      for (const k of Object.keys(s.effects)) {
        if (s.effects[k] > 0) {
          s.effects[k] -= dt * 1000;
          if (s.effects[k] <= 0) { s.effects[k] = 0; labelsDirty = true; }
        }
      }
      s.paddleW = effectOn('larger-paddle') ? DBNC_PADDLE_W * 1.6 : DBNC_PADDLE_W;

      // One brick-collision resolver, shared by the primary ball and any
      // multi-ball clones so a power-up ball scores and drops identically.
      const hitBricks = (b) => {
        for (let i = 0; i < s.bricks.length; i++) {
          const br = s.bricks[i];
          if (b.x + DBNC_BALL_R < br.x || b.x - DBNC_BALL_R > br.x + br.w ||
              b.y + DBNC_BALL_R < br.y || b.y - DBNC_BALL_R > br.y + br.h) continue;
          const fromSide = Math.min(Math.abs(b.x - br.x), Math.abs(b.x - (br.x + br.w))) <
                           Math.min(Math.abs(b.y - br.y), Math.abs(b.y - (br.y + br.h)));
          if (fromSide) b.vx = -b.vx; else b.vy = -b.vy;
          br.hp -= 1;
          s.score += 20;
          if (br.hp <= 0) {
            if (br.powerup) s.drops.push(dbncDropPowerup(br));
            s.bricks.splice(i, 1);
            s.broken += 1;
            onStepRef.current && onStepRef.current(s.broken);
          }
          setScore(s.score);
          if (s.bricks.length === 0) finish(true);
          return true;
        }
        return false;
      };

      const speedScale = effectOn('slower-ball') ? 0.6 : 1;

      const stepBall = (b) => {
        b.x += b.vx * dt * speedScale; b.y += b.vy * dt * speedScale;
        if (b.x < DBNC_BALL_R) { b.x = DBNC_BALL_R; b.vx = Math.abs(b.vx); }
        if (b.x > DBNC_W - DBNC_BALL_R) { b.x = DBNC_W - DBNC_BALL_R; b.vx = -Math.abs(b.vx); }
        if (b.y < DBNC_BALL_R) { b.y = DBNC_BALL_R; b.vy = Math.abs(b.vy); }
        const halfW = s.paddleW / 2;
        if (b.vy > 0 && b.y + DBNC_BALL_R >= DBNC_PADDLE_Y && b.y + DBNC_BALL_R <= DBNC_PADDLE_Y + DBNC_PADDLE_H + 6 &&
            Math.abs(b.x - s.paddle) <= halfW + DBNC_BALL_R) {
          const off = (b.x - s.paddle) / halfW; // -1..1
          const speed = Math.min(360, Math.hypot(b.vx, b.vy) * 1.015);
          const angle = off * 1.05; // radians off vertical
          b.vx = speed * Math.sin(angle);
          b.vy = -Math.abs(speed * Math.cos(angle));
          b.y = DBNC_PADDLE_Y - DBNC_BALL_R;
        }
        hitBricks(b);
      };

      if (!s.done && s.launched) {
        const b = s.ball;
        stepBall(b);

        // Multi-ball clones live and die without costing a life.
        for (let i = s.extraBalls.length - 1; i >= 0; i--) {
          const eb = s.extraBalls[i];
          stepBall(eb);
          if (eb.y - DBNC_BALL_R > DBNC_H) s.extraBalls.splice(i, 1);
        }

        // Laser: a slow auto-fire that clears a brick straight overhead.
        if (effectOn('laser')) {
          s.laserCooldown -= dt * 1000;
          if (s.laserCooldown <= 0) {
            s.laserCooldown = 550;
            s.lasers.push({ x: s.paddle, y: DBNC_PADDLE_Y - 4 });
          }
        }
        for (let i = s.lasers.length - 1; i >= 0; i--) {
          const lz = s.lasers[i];
          lz.y -= 420 * dt;
          const hit = hitBricks({ x: lz.x, y: lz.y, vx: 0, vy: -1 });
          if (hit || lz.y < 0) s.lasers.splice(i, 1);
        }

        // Falling capsules — caught on the paddle, otherwise off the bottom.
        for (let i = s.drops.length - 1; i >= 0; i--) {
          const d = s.drops[i];
          d.y += d.vy * dt;
          const halfW = s.paddleW / 2;
          if (d.y + d.r >= DBNC_PADDLE_Y && d.y - d.r <= DBNC_PADDLE_Y + DBNC_PADDLE_H + 4 &&
              Math.abs(d.x - s.paddle) <= halfW + d.r) {
            s.drops.splice(i, 1);
            s.picked += 1;
            s.score += 25;
            setScore(s.score);
            cgSound('clear');
            if (d.type === 'multi-ball') {
              // Two clones, mirrored — deterministic, no random spread.
              const sp = Math.max(200, Math.hypot(b.vx, b.vy));
              s.extraBalls.push({ x: b.x, y: b.y, vx: sp * 0.5, vy: -sp * 0.87 });
              s.extraBalls.push({ x: b.x, y: b.y, vx: -sp * 0.5, vy: -sp * 0.87 });
            } else {
              s.effects[d.type] = DBNC_PU_DUR;
              if (d.type === 'laser') s.laserCooldown = 0;
            }
            labelsDirty = true;
          } else if (d.y - d.r > DBNC_H) {
            s.drops.splice(i, 1);
          }
        }

        // Lost primary ball — a life only when no clones are still in play.
        if (b.y - DBNC_BALL_R > DBNC_H) {
          if (s.extraBalls.length) {
            s.ball = s.extraBalls.shift();
          } else {
            s.balls -= 1;
            setBalls(s.balls);
            if (s.balls <= 0) finish(false);
            else {
              s.launched = false;
              s.ball = { x: s.paddle, y: DBNC_PADDLE_Y - DBNC_BALL_R - 1, vx: 0, vy: 0 };
              s.drops = []; s.lasers = [];
            }
          }
        }
        if (!s.launched && !s.done) { s.ball.x = s.paddle; }
      } else if (!s.launched) {
        s.ball.x = s.paddle;
      }

      if (labelsDirty) {
        setEffectLabels(Object.keys(s.effects).filter(k => s.effects[k] > 0));
      }

      // Paint. Brick/paddle/ball/well colours are intrinsic arcade art and stay
      // hardcoded (CLAUDE.md rule) — this game's Phase 1 fix was the missing
      // device-pixel scaling above, not the palette.
      ctx.clearRect(0, 0, DBNC_W, DBNC_H);
      ctx.fillStyle = '#10131c';
      ctx.fillRect(0, 0, DBNC_W, DBNC_H);
      const hpColors = { 1: '#71A122', 2: '#C9A227', 3: '#CD4B3A' };
      for (const br of s.bricks) {
        ctx.fillStyle = hpColors[br.hp] || '#71A122';
        ctx.fillRect(br.x, br.y, br.w, br.h);
        if (br.powerup) {
          // A tiny pip marks a brick that carries a drop — the same brick for
          // every player today.
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.beginPath();
          ctx.arc(br.x + br.w / 2, br.y + br.h / 2, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // Lasers
      ctx.fillStyle = '#8ad2ff';
      for (const lz of s.lasers) ctx.fillRect(lz.x - 1.5, lz.y - 8, 3, 12);
      // Capsules
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '12px system-ui, sans-serif';
      for (const d of s.drops) {
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.fill();
        ctx.fillStyle = '#10131c';
        ctx.fillText(POWERUP_ICONS[d.type] || '?', d.x, d.y + 1);
      }
      ctx.fillStyle = '#e8e4da';
      ctx.fillRect(s.paddle - s.paddleW / 2, DBNC_PADDLE_Y, s.paddleW, DBNC_PADDLE_H);
      ctx.fillStyle = '#fff';
      for (const b2 of [s.ball].concat(s.extraBalls)) {
        ctx.beginPath();
        ctx.arc(b2.x, b2.y, DBNC_BALL_R, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      alive = false;
      window.removeEventListener('resize', sizeCanvas);
      if (dbncRO) dbncRO.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  // Paddle drag (pointer events cover mouse + touch) + tap/click to launch.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const toX = (e) => {
      const rect = canvas.getBoundingClientRect();
      return (e.clientX - rect.left) * (DBNC_W / rect.width);
    };
    const move = (e) => {
      const s = st.current;
      const half = s.paddleW / 2;
      s.paddle = Math.max(half, Math.min(DBNC_W - half, toX(e)));
      if (e.pointerType === 'touch') e.preventDefault();
    };
    const down = (e) => { move(e); launch(); };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerdown', down);
    return () => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerdown', down);
    };
  }, []);

  const fmt = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const s = st.current;

  return (
    <div className="fit-col">
      <CuiBar height={68} build={(W) => {
        const pr = cuiRow(0, 0, W, 46, 4);
        const out = [
          { id: 'p-time', kind: 'pill', r: pr[0], label: 'Time', value: fmt, gold: true },
          { id: 'p-score', kind: 'pill', r: pr[1], label: 'Score', value: score },
          { id: 'p-balls', kind: 'pill', r: pr[2], label: 'Balls', value: `${'●'.repeat(Math.max(0, balls))}${'○'.repeat(Math.max(0, dbncCfg.balls - Math.max(0, balls)))}` },
          { id: 'p-bricks', kind: 'pill', r: pr[3], label: 'Bricks', value: `${s.total - s.bricks.length}/${s.total}` },
        ];
        if (effectLabels.length) {
          out.push({
            id: 'effects', kind: 'label', r: [0, 48, W, 20], gold: true, font: 12,
            label: effectLabels.map(t => `${POWERUP_ICONS[t] || '✨'} ${t.replace(/-/g, ' ')}`).join(' · '),
          });
        }
        return out;
      }} />
      <div className="dbnc-wrap">
        <canvas ref={canvasRef} className="dbnc-canvas" />
      </div>
      <div className="dsnk-hint">
        {done ? 'Run over' : started ? 'Drag to move the paddle · catch the capsules' : 'Tap the board to launch — everyone breaks the same wall, with the same power-ups, today'}
      </div>
    </div>
  );
}
