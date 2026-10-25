/* ============================================================
   Bounce (Breakout) helpers + component
   ============================================================ */

// Fixed internal resolution — physics are device-independent; the canvas
// bitmap is scaled to fit the column via CSS.
const BOUNCE_W       = 360;
const BOUNCE_H       = 480;
const BOUNCE_PADDLE_W = 64;
const BOUNCE_PADDLE_H = 10;
/* #211 — the paddle sat 30px off the floor, which on a phone is under the
   thumb holding the device and, in a browser, behind the bottom toolbar.
   Raised to 64px so it is reachable. The ball's death line stays at the well
   floor (stepBall tests against BOUNCE_H), so a miss now falls a little
   further before it counts — the well keeps its shape and only the paddle
   moves. */
const BOUNCE_PADDLE_Y = BOUNCE_H - 64;
const BOUNCE_BALL_R  = 6;
const BOUNCE_COLS    = 9;
const BOUNCE_BRICK_H = 16;
const BOUNCE_TOP     = 44;          // y offset of the first brick row
const BOUNCE_MARGIN  = 16;
const BOUNCE_GAP_X   = 5;
const BOUNCE_GAP_Y   = 6;
const BOUNCE_BASE_SPEED = 3.6;      // px per 1/60s step at level 1
const BOUNCE_MAX_SPEED  = 7.2;      // speed-up cap
const BOUNCE_MAX_ANGLE  = Math.PI / 3;   // 60° max paddle deflection
const BOUNCE_PADDLE_KEY_SPEED = 7;  // px/step when steering by key/dpad
const BOUNCE_LIVES   = 3;
const BOUNCE_LEVEL_BONUS = 100;
const BOUNCE_FIXED_DT = 1000 / 60;
const BOUNCE_SUBSTEPS = 3;          // anti-tunneling integration substeps
const BOUNCE_BEST_KEY = 'puzzlechain_bounce_best';
// Looping background-music asset (served by express.static from public/audio).
const BOUNCE_MUSIC_URL = '/audio/bounce-bg.mp3';

// Points by row (top rows are harder to reach, so worth more); fallback 10.
const BOUNCE_ROW_POINTS = [50, 50, 30, 30, 20, 10, 10, 10];
/* Palette TOKEN NAMES, not hex: bricks are drawn on a canvas, so their colour
   is resolved from the live PAL at draw time and a theme flip recolours them
   mid-game without rebuilding the level. */
const BOUNCE_ROW_COLORS = ['rose', 'gold', 'emerald', 'violet', 'accent'];

function bounceClamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function bounceLoadBest() {
  try { return parseInt(localStorage.getItem(BOUNCE_BEST_KEY) || '0', 10) || 0; } catch { return 0; }
}
function bounceSaveBest(v) {
  try { localStorage.setItem(BOUNCE_BEST_KEY, String(v)); } catch {}
}

function bounceSpeedForLevel(level) {
  return Math.min(BOUNCE_BASE_SPEED + (level - 1) * 0.5, BOUNCE_MAX_SPEED);
}

// Build the brick wall for a level — denser (more rows) as levels climb.
/* ============================================================
   Wall patterns (#176)
   ============================================================
   "Arcade generates random layouts, that are still coherent" was the ask, and
   COHERENT is the whole job: bricks placed at random read as noise, not as a
   designed wall. So layouts come from a small GRAMMAR of shapes instead — each
   one is a predicate over (row, col) that either keeps a brick or leaves a
   gap. Symmetry and structure fall out of the predicate rather than having to
   be checked for afterwards.

   The same grammar serves both new modes: story walks the patterns in a fixed
   order (each rung is a specific wall you can learn), arcade rolls one plus a
   row count. One generator, two modes, no authored levels. */
const BOUNCE_PATTERNS = [
  { id: 'solid',    label: 'Solid',      keep: () => true },
  { id: 'arch',     label: 'Arch',       keep: (r, c, rows, cols) => r >= Math.abs(c - (cols - 1) / 2) * (rows / cols) },
  { id: 'columns',  label: 'Columns',    keep: (r, c) => c % 2 === 0 },
  { id: 'checker',  label: 'Checker',    keep: (r, c) => (r + c) % 2 === 0 },
  { id: 'pyramid',  label: 'Pyramid',    keep: (r, c, rows, cols) => Math.abs(c - (cols - 1) / 2) <= r },
  { id: 'diamond',  label: 'Diamond',    keep: (r, c, rows, cols) =>
      Math.abs(c - (cols - 1) / 2) + Math.abs(r - (rows - 1) / 2) <= Math.max(rows, cols) / 2 },
  { id: 'hourglass',label: 'Hourglass',  keep: (r, c, rows, cols) =>
      Math.abs(c - (cols - 1) / 2) >= Math.abs(r - (rows - 1) / 2) - 1 },
  { id: 'brickwork',label: 'Brickwork',  keep: (r, c) => !((r % 2 === 0 && c % 4 === 0) || (r % 2 === 1 && c % 4 === 2)) },
];
const bouncePattern = (i) => BOUNCE_PATTERNS[((i % BOUNCE_PATTERNS.length) + BOUNCE_PATTERNS.length) % BOUNCE_PATTERNS.length];

function bounceBuildBricks(level, pattern) {
  const rows = Math.min(4 + (level - 1), 8);
  const brickW = (BOUNCE_W - 2 * BOUNCE_MARGIN - (BOUNCE_COLS - 1) * BOUNCE_GAP_X) / BOUNCE_COLS;
  const bricks = [];
  const keep = (pattern && pattern.keep) || (() => true);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < BOUNCE_COLS; c++) {
      if (!keep(r, c, rows, BOUNCE_COLS)) continue;
      bricks.push({
        x: BOUNCE_MARGIN + c * (brickW + BOUNCE_GAP_X),
        y: BOUNCE_TOP + r * (BOUNCE_BRICK_H + BOUNCE_GAP_Y),
        w: brickW,
        h: BOUNCE_BRICK_H,
        alive: true,
        points: BOUNCE_ROW_POINTS[r] != null ? BOUNCE_ROW_POINTS[r] : 10,
        color: BOUNCE_ROW_COLORS[r % BOUNCE_ROW_COLORS.length],
      });
    }
  }
  return bricks;
}

function bounceShareText(score, level, secs) {
  const m = String(Math.floor(secs / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  return `I scored ${score.toLocaleString()} on Bounce 🧱 — reached level ${level} · ${m}:${s}`;
}

/* ============================================================
   Power-ups system (Bounce & Zuma)
   ============================================================ */
const POWERUP_DURATION_MS = 10000;
const POWERUP_SPAWN_RATE = 0.1;
const POWERUP_RADIUS = 12;
const POWERUP_TYPES = {
  bounce: ['multi-ball', 'larger-paddle', 'slower-ball', 'laser'],
  zuma: ['multi-shot', 'faster-shot', 'color-switch', 'chain-clear'],
};
const POWERUP_ICONS = {
  'multi-ball': '🔄',
  'larger-paddle': '⬆️',
  'slower-ball': '🐢',
  'laser': '⚡',
  'multi-shot': '🔄',
  'faster-shot': '💨',
  'color-switch': '🎨',
  'chain-clear': '✂️',
};

function spawnPowerup(x, y, typeArray) {
  const type = typeArray[Math.floor(Math.random() * typeArray.length)];
  return {
    id: `pu_${Date.now()}_${Math.random()}`,
    type,
    x, y,
    vx: (Math.random() - 0.5) * 1.2,
    vy: 1.5,
    radius: POWERUP_RADIUS,
    spawnedAt: Date.now(),
    caught: false,
  };
}

function updatePowerup(pu, scale) {
  pu.x += pu.vx * scale;
  pu.y += pu.vy * scale;
  pu.vy += 0.1 * scale;
}

function BounceGame({ onWin, onLose, onStepChange, resetKey, playMode, band, offset }) {
  /* #176 — story walks the pattern grammar in order (each rung is a specific
     wall you can learn and re-attempt), arcade rolls a pattern per level so
     the wall is different every run but never noise. Free play keeps the
     original solid wall, so the classic game is unchanged. */
  const bncMode = useRef(null);
  if (!bncMode.current) {
    if (playMode === 'story') {
      bncMode.current = { fixed: bouncePattern(Math.max(0, band || 0)), rng: null };
    } else if (playMode === 'arcade') {
      const i = Math.max(0, ARCADE_BANDS.findIndex(b => b.id === band));
      bncMode.current = { fixed: null, rng: modeSeed('arcade', 'bounce', i, offset).rng, base: i * 2 };
    } else {
      bncMode.current = { fixed: null, rng: null };
    }
  }
  // Which wall to build for a given level number, per mode.
  const bncPatternFor = (lvl) => {
    const m = bncMode.current;
    if (m.fixed) return m.fixed;
    if (m.rng) return bouncePattern((m.base || 0) + Math.floor(m.rng() * BOUNCE_PATTERNS.length) + lvl);
    return null;
  };
  const [score, setScore]   = useState(0);
  const [lives, setLives]   = useState(BOUNCE_LIVES);
  const [level, setLevel]   = useState(1);
  const [started, setStarted] = useState(false);
  const [done, setDone]     = useState(false);
  const [activeTab, setActiveTab] = useState('game');
  const [bestScore, setBestScore] = useState(() => bounceLoadBest());
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [activePowerups, setActivePowerups] = useState([]);
  // Audio: `soundOn` mirrors the shared cgPrefs.sound master switch (controls
  // both SFX and music); `musicPaused` is the player's in-game music pause
  // that leaves SFX untouched.
  const [soundOn, setSoundOn] = useState(() => cgPrefs.sound);
  const [musicPaused, setMusicPaused] = useState(false);

  // Leaderboard tab state (mirrors Snake)
  const [lb, setLb]               = useState(null);
  const [lbLoading, setLbLoading] = useState(false);
  const [lbError, setLbError]     = useState(false);

  // Canvas + simulation refs (the hot loop mutates these, not React state).
  const canvasRef   = useRef(null);
  const ctxRef      = useRef(null);
  const rafRef      = useRef(null);
  const lastTsRef   = useRef(null);
  const accRef      = useRef(0);

  const paddleRef   = useRef(BOUNCE_W / 2);
  const ballRef     = useRef({ x: BOUNCE_W / 2, y: BOUNCE_PADDLE_Y - BOUNCE_BALL_R - 1, vx: 0, vy: 0 });
  const bricksRef   = useRef(bounceBuildBricks(1, bncPatternFor(1)));
  const speedRef    = useRef(bounceSpeedForLevel(1));
  const scoreRef    = useRef(0);
  const livesRef    = useRef(BOUNCE_LIVES);
  const levelRef    = useRef(1);
  const brokenRef   = useRef(0);
  const elapsedRef  = useRef(0);
  const launchedRef = useRef(false);
  const startedRef  = useRef(false);
  const doneRef     = useRef(false);
  const submittedRef = useRef(false);
  const leftRef     = useRef(false);
  const rightRef    = useRef(false);

  // Power-ups refs
  const ballsRef    = useRef([{ x: BOUNCE_W / 2, y: BOUNCE_PADDLE_Y - BOUNCE_BALL_R - 1, vx: 0, vy: 0 }]);
  const powerUpsRef = useRef([]);
  const activePowerupsRef = useRef([]);
  const basePaddleWRef = useRef(BOUNCE_PADDLE_W);
  const baseSpeedRef = useRef(bounceSpeedForLevel(1));
  const laserLoadedRef = useRef(0);

  // Latest-closure prop refs so listeners/loop mount once.
  const onWinRef = useRef(onWin);        onWinRef.current = onWin;
  const onLoseRef = useRef(onLose);      onLoseRef.current = onLose;
  const onStepRef = useRef(onStepChange); onStepRef.current = onStepChange;

  const loopRunning = activeTab === 'game' && !done;
  const timerRunning = started && !done && activeTab === 'game';

  const fmtSecs = s => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');

  // Elapsed-time clock (pauses when not actively playing).
  useEffect(() => {
    if (!timerRunning) return;
    const id = setInterval(() => { elapsedRef.current += 1; setElapsedSecs(elapsedRef.current); }, 1000);
    return () => clearInterval(id);
  }, [timerRunning]);

  // Background music: plays once the ball has been launched, sound is
  // enabled, the player hasn't paused it, and the round isn't over. Starting
  // only after `started` (the first launch) means it's triggered by a user
  // gesture, satisfying browser autoplay policy. Stops if the player leaves
  // the game tab for the leaderboard.
  useEffect(() => {
    const shouldPlay = started && !done && soundOn && !musicPaused && activeTab === 'game';
    if (shouldPlay) startBackgroundMusic(BOUNCE_MUSIC_URL);
    else stopBackgroundMusic();
  }, [started, done, soundOn, musicPaused, activeTab]);

  // Always silence the track when leaving the game (unmount → back to lobby).
  useEffect(() => () => stopBackgroundMusic(), []);

  // Toggle the shared sound master switch (persists to localStorage via
  // cgPrefs) and mirror it into local state so the component re-renders.
  const toggleSound = () => {
    const next = !cgPrefs.sound;
    cgSetPref('sound', next);
    setSoundOn(next);
  };

  const resetBallToPaddle = () => {
    ballsRef.current = [{ x: paddleRef.current, y: BOUNCE_PADDLE_Y - BOUNCE_BALL_R - 1, vx: 0, vy: 0 }];
  };

  const handleNewGame = () => {
    paddleRef.current = BOUNCE_W / 2;
    basePaddleWRef.current = BOUNCE_PADDLE_W;
    bricksRef.current = bounceBuildBricks(1, bncPatternFor(1));
    speedRef.current = bounceSpeedForLevel(1);
    baseSpeedRef.current = bounceSpeedForLevel(1);
    scoreRef.current = 0;
    livesRef.current = BOUNCE_LIVES;
    levelRef.current = 1;
    brokenRef.current = 0;
    elapsedRef.current = 0;
    launchedRef.current = false;
    startedRef.current = false;
    doneRef.current = false;
    submittedRef.current = false;
    leftRef.current = false;
    rightRef.current = false;
    accRef.current = 0;
    lastTsRef.current = null;
    powerUpsRef.current = [];
    activePowerupsRef.current = [];
    laserLoadedRef.current = 0;
    resetBallToPaddle();
    setScore(0); setLives(BOUNCE_LIVES); setLevel(1);
    setStarted(false); setDone(false); setElapsedSecs(0); setActivePowerups([]);
    setMusicPaused(false);
  };

  useEffect(() => {
    if (!resetKey) return;
    handleNewGame();
  }, [resetKey]);

  const submitScore = async (finalScore, finalLevel, secs) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setBestScore(prev => {
      if (finalScore > prev) { bounceSaveBest(finalScore); return finalScore; }
      return prev;
    });
    try {
      await api('/api/bounce/score', {
        method: 'POST',
        body: JSON.stringify({ score: finalScore, level: finalLevel, timeSecs: secs }),
      });
    } catch {}
  };

  const launch = () => {
    if (doneRef.current || launchedRef.current) return;
    launchedRef.current = true;
    if (!startedRef.current) { startedRef.current = true; setStarted(true); }
    const speed = speedRef.current;
    const ball = ballRef.current;
    ball.vx = speed * 0.4;
    ball.vy = -Math.sqrt(Math.max(0.01, speed * speed - ball.vx * ball.vx));
    cgSound('deal', 1.2);
  };
  const launchRef = useRef(launch);
  launchRef.current = launch;

  const endGame = () => {
    cgSound('bgameover');
    doneRef.current = true;
    setDone(true);
    const finalScore = scoreRef.current;
    const lvl = levelRef.current;
    const secs = elapsedRef.current;
    if (!playMode || playMode === 'arcade') submitScore(finalScore, lvl, secs);
    /* `cleared` is false here by construction — endGame is the out-of-balls
       path, and clearing the wall goes through nextLevel instead. */
    reportRunEnd(
      { cleared: false, playMode, onWin: onWinRef.current, onLose: onLoseRef.current },
      finalScore, brokenRef.current, secs,
      { share: bounceShareText(finalScore, lvl, secs) }
    );
  };

  const nextLevel = () => {
    cgSound('blevel');
    scoreRef.current += BOUNCE_LEVEL_BONUS;
    setScore(scoreRef.current);
    /* STORY ENDS AT ITS OWN WALL. A rung is one specific wall — clearing it is
       the whole achievement — so story stops here instead of rolling into
       level 2. Without this the run would rebuild the SAME fixed pattern
       forever and the rung could only ever be ticked by dying, which is
       exactly backwards. Free play and arcade keep climbing. */
    if (playMode === 'story') {
      doneRef.current = true;
      setDone(true);
      const secs = elapsedRef.current;
      onWinRef.current && onWinRef.current(scoreRef.current, brokenRef.current, secs, {
        winnerLabel: 'Wall cleared! 🎉',
        share: bounceShareText(scoreRef.current, levelRef.current, secs),
      });
      return;
    }
    const lvl = levelRef.current + 1;
    levelRef.current = lvl;
    setLevel(lvl);
    speedRef.current = bounceSpeedForLevel(lvl);
    bricksRef.current = bounceBuildBricks(lvl, bncPatternFor(lvl));
    launchedRef.current = false;
    resetBallToPaddle();
  };

  const loseLife = () => {
    cgSound('bdie');
    const remaining = livesRef.current - 1;
    livesRef.current = remaining;
    setLives(remaining);
    if (remaining <= 0) { endGame(); return; }
    launchedRef.current = false;
    resetBallToPaddle();
  };

  const stepBall = (scale) => {
    const balls = ballsRef.current;
    const bricks = bricksRef.current;
    const px = paddleRef.current;
    const paddleW = basePaddleWRef.current * (1 + activePowerupsRef.current.filter(p => p.type === 'larger-paddle').reduce((a, p) => a + 0.5 * p.stacks, 0));

    for (let ballIdx = 0; ballIdx < balls.length; ballIdx++) {
      const ball = balls[ballIdx];
      ball.x += ball.vx * scale;
      ball.y += ball.vy * scale;

      if (ball.x - BOUNCE_BALL_R < 0) { ball.x = BOUNCE_BALL_R; ball.vx = Math.abs(ball.vx); cgSound('bwall'); }
      else if (ball.x + BOUNCE_BALL_R > BOUNCE_W) { ball.x = BOUNCE_W - BOUNCE_BALL_R; ball.vx = -Math.abs(ball.vx); cgSound('bwall'); }
      if (ball.y - BOUNCE_BALL_R < 0) { ball.y = BOUNCE_BALL_R; ball.vy = Math.abs(ball.vy); cgSound('bwall'); }

      if (ball.vy > 0 &&
          ball.y + BOUNCE_BALL_R >= BOUNCE_PADDLE_Y &&
          ball.y + BOUNCE_BALL_R <= BOUNCE_PADDLE_Y + BOUNCE_PADDLE_H + 8 &&
          ball.x >= px - paddleW / 2 - BOUNCE_BALL_R &&
          ball.x <= px + paddleW / 2 + BOUNCE_BALL_R) {
        const hit = bounceClamp((ball.x - px) / (paddleW / 2), -1, 1);
        const angle = hit * BOUNCE_MAX_ANGLE;
        const speed = speedRef.current;
        ball.vx = speed * Math.sin(angle);
        ball.vy = -Math.abs(speed * Math.cos(angle));
        ball.y = BOUNCE_PADDLE_Y - BOUNCE_BALL_R - 1;
        cgSound('bpaddle');
      }

      for (let i = 0; i < bricks.length; i++) {
        const b = bricks[i];
        if (!b.alive) continue;
        const ox = Math.min(ball.x + BOUNCE_BALL_R, b.x + b.w) - Math.max(ball.x - BOUNCE_BALL_R, b.x);
        const oy = Math.min(ball.y + BOUNCE_BALL_R, b.y + b.h) - Math.max(ball.y - BOUNCE_BALL_R, b.y);
        if (ox > 0 && oy > 0) {
          if (laserLoadedRef.current > 0) {
            const col = Math.floor((b.x - BOUNCE_MARGIN) / ((BOUNCE_W - 2 * BOUNCE_MARGIN - (BOUNCE_COLS - 1) * BOUNCE_GAP_X) / BOUNCE_COLS + BOUNCE_GAP_X));
            for (let j = 0; j < bricks.length; j++) {
              const br = bricks[j];
              const brickCol = Math.floor((br.x - BOUNCE_MARGIN) / ((BOUNCE_W - 2 * BOUNCE_MARGIN - (BOUNCE_COLS - 1) * BOUNCE_GAP_X) / BOUNCE_COLS + BOUNCE_GAP_X));
              if (brickCol === col && br.alive) {
                br.alive = false;
                brokenRef.current += 1;
                scoreRef.current += br.points;
                cgSound('bbrick', 1.3);
              }
            }
            laserLoadedRef.current -= 1;
          } else {
            b.alive = false;
            brokenRef.current += 1;
            scoreRef.current += b.points;
            cgSound('bbrick');
          }
          setScore(scoreRef.current);
          onStepRef.current && onStepRef.current(brokenRef.current);
          if (Math.random() < POWERUP_SPAWN_RATE) {
            powerUpsRef.current.push(spawnPowerup(b.x + b.w / 2, b.y + b.h / 2, POWERUP_TYPES.bounce));
          }
          if (ox < oy) { ball.vx = -ball.vx; ball.x += (ball.vx > 0 ? 1 : -1) * ox; }
          else { ball.vy = -ball.vy; ball.y += (ball.vy > 0 ? 1 : -1) * oy; }
          if (bricks.every(x => !x.alive)) { nextLevel(); return true; }
          break;
        }
      }

      if (ball.y - BOUNCE_BALL_R > BOUNCE_H) {
        balls.splice(ballIdx, 1);
        ballIdx--;
        if (balls.length === 0) { loseLife(); return true; }
      }
    }
    return false;
  };

  const update = () => {
    const now = Date.now();
    const paddleW = basePaddleWRef.current * (1 + activePowerupsRef.current.filter(p => p.type === 'larger-paddle').reduce((a, p) => a + 0.5 * p.stacks, 0));

    let px = paddleRef.current;
    if (leftRef.current) px -= BOUNCE_PADDLE_KEY_SPEED;
    if (rightRef.current) px += BOUNCE_PADDLE_KEY_SPEED;
    paddleRef.current = bounceClamp(px, paddleW / 2, BOUNCE_W - paddleW / 2);

    // Update power-ups in flight
    for (let i = powerUpsRef.current.length - 1; i >= 0; i--) {
      const pu = powerUpsRef.current[i];
      updatePowerup(pu, 1);

      if (!pu.caught && pu.y + pu.radius >= BOUNCE_PADDLE_Y && pu.x >= paddleRef.current - paddleW / 2 - 20 && pu.x <= paddleRef.current + paddleW / 2 + 20) {
        pu.caught = true;
        cgSound('bpowerup');
        const existing = activePowerupsRef.current.find(p => p.type === pu.type);
        if (pu.type === 'multi-ball') {
          if (ballsRef.current.length > 0) {
            const firstBall = ballsRef.current[0];
            const newBall = {
              x: firstBall.x + 10,
              y: firstBall.y,
              vx: firstBall.vx * Math.cos(Math.PI / 6) - firstBall.vy * Math.sin(Math.PI / 6),
              vy: firstBall.vx * Math.sin(Math.PI / 6) + firstBall.vy * Math.cos(Math.PI / 6),
            };
            ballsRef.current.push(newBall);
          }
        }
        if (existing) {
          existing.stacks += 1;
          existing.startedAt = now;
        } else {
          activePowerupsRef.current.push({ type: pu.type, startedAt: now, stacks: 1 });
        }
        setActivePowerups([...activePowerupsRef.current]);
        powerUpsRef.current.splice(i, 1);
      } else if (pu.y > BOUNCE_H + 50) {
        powerUpsRef.current.splice(i, 1);
      }
    }

    // Update active power-ups duration
    for (let i = activePowerupsRef.current.length - 1; i >= 0; i--) {
      const ap = activePowerupsRef.current[i];
      if (now - ap.startedAt > POWERUP_DURATION_MS) {
        if (ap.type === 'multi-shot') { } // handled in zuma
        activePowerupsRef.current.splice(i, 1);
      }
    }
    if (activePowerupsRef.current.length === 0 && powerUpsRef.current.length === 0) {
      setActivePowerups([]);
    }

    // Apply speed multiplier
    const slowPower = activePowerupsRef.current.find(p => p.type === 'slower-ball');
    if (slowPower) {
      speedRef.current = baseSpeedRef.current * Math.pow(0.7, slowPower.stacks);
    } else {
      speedRef.current = baseSpeedRef.current;
    }

    if (!launchedRef.current) { resetBallToPaddle(); return; }
    for (let i = 0; i < BOUNCE_SUBSTEPS; i++) {
      if (stepBall(1 / BOUNCE_SUBSTEPS)) return;
    }
  };

  const draw = () => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.clearRect(0, 0, BOUNCE_W, BOUNCE_H);
    ctx.fillStyle = PAL.bg;
    ctx.fillRect(0, 0, BOUNCE_W, BOUNCE_H);
    const bricks = bricksRef.current;
    for (let i = 0; i < bricks.length; i++) {
      const b = bricks[i];
      if (!b.alive) continue;
      ctx.fillStyle = PAL[b.color] || b.color;
      ctx.fillRect(b.x, b.y, b.w, b.h);
    }

    // Draw power-ups in flight
    for (let i = 0; i < powerUpsRef.current.length; i++) {
      const pu = powerUpsRef.current[i];
      ctx.save();
      ctx.translate(pu.x, pu.y);
      const rotation = ((Date.now() - pu.spawnedAt) / 100) % (Math.PI * 2);
      ctx.rotate(rotation);
      ctx.font = '24px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(POWERUP_ICONS[pu.type], 0, 0);
      ctx.restore();

      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath();
      ctx.ellipse(pu.x, pu.y + pu.radius + 3, pu.radius * 0.7, pu.radius * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = PAL.text;
    const px = paddleRef.current;
    const paddleW = basePaddleWRef.current * (1 + activePowerupsRef.current.filter(p => p.type === 'larger-paddle').reduce((a, p) => a + 0.5 * p.stacks, 0));
    ctx.fillRect(px - paddleW / 2, BOUNCE_PADDLE_Y, paddleW, BOUNCE_PADDLE_H);

    const balls = ballsRef.current;
    ctx.fillStyle = PAL.gold;
    for (let i = 0; i < balls.length; i++) {
      const ball = balls[i];
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, BOUNCE_BALL_R, 0, Math.PI * 2);
      ctx.fill();
    }

    if (startedRef.current && !launchedRef.current && !doneRef.current) {
      ctx.fillStyle = PAL.text;
      ctx.font = '600 14px "Space Grotesk", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Tap or press Space to launch', BOUNCE_W / 2, BOUNCE_H / 2);
    }
  };

  // Animation loop — fixed-timestep accumulator so physics are frame-rate
  // independent; re-armed whenever play resumes (tab switch / not done).
  useEffect(() => {
    if (!loopRunning) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = canvasDpr();
    canvas.width = BOUNCE_W * dpr;
    canvas.height = BOUNCE_H * dpr;
    const ctx = guardCanvasCtx(canvas.getContext('2d'));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctxRef.current = ctx;
    lastTsRef.current = null;
    accRef.current = 0;

    const loop = (ts) => {
      rafRef.current = requestAnimationFrame(loop);
      if (lastTsRef.current == null) lastTsRef.current = ts;
      let dt = ts - lastTsRef.current;
      lastTsRef.current = ts;
      if (dt > 50) dt = 50;            // clamp after a backgrounded tab
      accRef.current += dt;
      let guard = 0;
      while (accRef.current >= BOUNCE_FIXED_DT && guard < 5) {
        update();
        accRef.current -= BOUNCE_FIXED_DT;
        guard += 1;
        if (doneRef.current) break;
      }
      draw();
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [loopRunning]);

  // Keyboard — mounted once, latest-closure via refs.
  useEffect(() => {
    const down = (e) => {
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') { e.preventDefault(); leftRef.current = true; }
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') { e.preventDefault(); rightRef.current = true; }
      else if (k === ' ' || k === 'Spacebar') { e.preventDefault(); launchRef.current(); }
    };
    const up = (e) => {
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') leftRef.current = false;
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') rightRef.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  // Map a pointer's clientX onto the internal board coordinate and steer.
  const pointerToPaddle = (clientX) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    const x = (clientX - rect.left) / rect.width * BOUNCE_W;
    paddleRef.current = bounceClamp(x, BOUNCE_PADDLE_W / 2, BOUNCE_W - BOUNCE_PADDLE_W / 2);
  };
  const handleMouseMove = (e) => pointerToPaddle(e.clientX);
  const handleTouchMove = (e) => { if (e.touches[0]) { e.preventDefault(); pointerToPaddle(e.touches[0].clientX); } };
  const handleTouchStart = (e) => { if (e.touches[0]) pointerToPaddle(e.touches[0].clientX); launch(); };

  const loadLeaderboard = async () => {
    setLbLoading(true);
    setLbError(false);
    const { ok, body } = await api('/api/bounce/leaderboard');
    if (ok && body) setLb(body);
    else setLbError(true);
    setLbLoading(false);
  };

  return (
    <div>

      {activeTab === 'game' && (
        <div>
          <CuiBar height={68} build={(W) => {
            const pr = cuiRow(0, 0, W, 46, 5);
            const out = [
              { id: 'p-score', kind: 'pill', r: pr[0], label: 'Score', value: score.toLocaleString() },
              { id: 'p-best', kind: 'pill', r: pr[1], label: 'Best', value: bestScore.toLocaleString() },
              { id: 'p-lives', kind: 'pill', r: pr[2], label: 'Lives', value: '●'.repeat(Math.max(0, lives)) || '—' },
              { id: 'p-level', kind: 'pill', r: pr[3], label: 'Level', value: level },
              { id: 'p-time', kind: 'pill', r: pr[4], label: 'Time', value: fmtSecs(elapsedSecs), gold: true },
            ];
            if (activePowerups.length) {
              const now = Date.now();
              out.push({
                id: 'powerups', kind: 'label', r: [0, 50, W, 20], font: 12, color: PAL.emerald,
                label: activePowerups.map((ap) => {
                  const remaining = Math.max(0, Math.ceil((POWERUP_DURATION_MS - (now - ap.startedAt)) / 1000));
                  return `${POWERUP_ICONS[ap.type]} ${remaining}s${ap.stacks > 1 ? ` ×${ap.stacks}` : ''}`;
                }).join(' · '),
              });
            }
            return out;
          }} />

          <div className="bounce-board-wrap">
            <canvas
              ref={canvasRef}
              className="bounce-canvas"
              onMouseMove={handleMouseMove}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onClick={() => launch()}
            />
            {!started && !done && (
              /* #211 — this used to be a full-board div with `pointer-events:
                 auto` and nothing but an onClick. It covered the canvas, so a
                 finger never reached the canvas's own onTouchStart — the thing
                 that both aims the paddle and calls launch() — and the overlay
                 itself carried `touch-action: auto`, so the browser was free to
                 treat the press as a pan and swallow the click. Tapping to
                 start simply did not work.

                 The backdrop is now inert (`pointer-events: none` in CSS) so
                 drags fall through to the canvas and you can still aim, and the
                 launch is an explicit BUTTON rather than "tap anywhere", which
                 is what the report asked for on web. */
              <div className="bounce-start-overlay">
                <div style={{ fontSize: '2rem' }}>🧱</div>
                <div>Move to aim, then launch</div>
                <button
                  type="button"
                  className="primary-btn bounce-start-btn"
                  onClick={() => launch()}
                >▶ Start</button>
                <div className="bounce-start-hint">or tap the board / press Space</div>
              </div>
            )}
          </div>

          <CuiBar height={44} build={(W) => {
            const x0 = Math.floor(W * 0.02), usable = Math.floor(W * 0.96), g = 6;
            const soundW = Math.floor(usable * 0.3), musicW = Math.floor(usable * 0.12);
            const padW = Math.floor(usable * 0.13), newW = usable - soundW - musicW - padW * 2 - g * 4;
            let x = x0;
            const next = (w) => { const r = [x, 0, w, 40]; x += w + g; return r; };
            return [
              { id: 'sound', kind: 'button', r: next(soundW), label: soundOn ? '🔊 Sound On' : '🔇 Sound Off', font: 11, on: soundOn, action: toggleSound },
              { id: 'music', kind: 'button', r: next(musicW), label: !soundOn ? '🔇' : musicPaused ? '▶' : '⏸', font: 12, disabled: !soundOn, action: () => setMusicPaused(p => !p) },
              { id: 'left', kind: 'button', r: next(padW), label: '◀', font: 15, holdDown: () => { leftRef.current = true; }, holdUp: () => { leftRef.current = false; } },
              { id: 'right', kind: 'button', r: next(padW), label: '▶', font: 15, holdDown: () => { rightRef.current = true; }, holdUp: () => { rightRef.current = false; } },
              { id: 'new', kind: 'button', r: next(newW), label: '↺ New', font: 12, action: handleNewGame },
            ];
          }} />
        </div>
      )}

      {activeTab === 'leaderboard' && (
        <div>
          {lbLoading && <div className="snake-lb-empty">Loading…</div>}
          {!lbLoading && lbError && (
            <div className="snake-lb-empty">Leaderboard unavailable — your score is still saved locally.</div>
          )}
          {!lbLoading && !lbError && lb && (
            (() => {
              const top = lb.top || [];
              const me = lb.me || null;
              const meInTop = me && top.some(row => row.rank === me.rank);
              if (top.length === 0) {
                return <div className="snake-lb-empty">No scores yet — be the first to play!</div>;
              }
              return (
                <div className="snake-lb-list">
                  {top.map(row => (
                    <div key={row.rank} className={'snake-lb-row' + (me && row.rank === me.rank ? ' snake-lb-me' : '')}>
                      <span className="snake-lb-rank">#{row.rank}</span>
                      <span className="snake-lb-name">{row.username || 'anon'}</span>
                      <span className="snake-lb-score">{Number(row.bestScore).toLocaleString()}</span>
                    </div>
                  ))}
                  {me && !meInTop && (
                    <div>
                      <div className="snake-lb-divider">···</div>
                      <div className="snake-lb-row snake-lb-me">
                        <span className="snake-lb-rank">#{me.rank}</span>
                        <span className="snake-lb-name">{me.username || 'You'}</span>
                        <span className="snake-lb-score">{Number(me.bestScore).toLocaleString()}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()
          )}
        </div>
      )}

      <div className="t2048-bottom-nav safe-bottom">
        {['game', 'leaderboard'].map(tab => (
          <button
            key={tab}
            className={'t2048-tab' + (activeTab === tab ? ' active' : '')}
            onClick={() => { setActiveTab(tab); if (tab === 'leaderboard') loadLeaderboard(); }}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
}
