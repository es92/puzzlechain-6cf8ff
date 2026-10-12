/* ============================================================
   Jet Run — a fighter-jet flying game (self-shell canvas game)
   ============================================================ */
/* Request #326 asked for "an aerial combat mode using F-16 fighter jets".
   Two standing rules reshape that into what this file is:

     - The platform's content rules (which every Homeroom app must satisfy,
       and which a user request cannot override) ban violence: no combat and
       no weapons as depicted objects, icons or game mechanics. A dogfight
       cannot ship, so nothing here is shot at and nothing here is destroyed:
       the jet threads gates, dodges storm clouds and collects fuel stars.
       Every string in this file says "gates", "storm clouds" and "fuel
       stars" — never "targets", "enemies" or "weapons".
     - IP hygiene: "F-16" is a real aircraft mark, and this app keeps display
       names generic on purpose (Drop Stack, not Tetris). The jet is a
       generic delta-wing silhouette and the name is Jet Run.

   The architecture is 23-game-hashrush.jsx with wings: one seeded course
   stream per run, three bounded modes over it, a target derived from the
   stream rather than eyeballed, pure hit-test/apply pairs, and no end panel
   of its own — the shared results card is the ending. */

const JR_HISTORY_KEY = 'puzzlechain_jetrun_history';

/* Scoring. Gates are the spine of the score; stars are a small bonus the
   target model deliberately ignores (see dfModelRun) so a target can never
   depend on anything but the gates. */
const DF_GATE_SCORE = 10;
const DF_STAR_SCORE = 5;
const DF_MULT_EVERY = 5;     // gates per combo step
const DF_MAX_MULT = 5;       // combo caps at ×5
const DF_SHIELDS = 3;

/* The stream. dfEveryAt is stated as the interval at the START of the course
   and tightens with elapsed time — the same time-derived schedule Hash Rush
   uses, for the same reason: a slow device must fly the same course as a
   fast one, and the loop only asks which times have passed. */
const DF_MIN_EVERY = 0.55;
const DF_EVERY_DECAY = 0.0012;
const DF_RAMP_SECS = 30;
const DF_SPEED_STEP = 24;
const DF_MAX_SPEED = 460;

/* Course length and the ladder. Six rungs (the STORY_LEVEL_DEFAULT floor —
   start there and earn more rungs with content), each longer, faster, denser
   and narrower than the last. `gap` is the gate gap as a FRACTION of the
   board width, so two players on different screens thread the same course —
   the fraction is resolved against the real canvas width at spawn time. */
const DF_DAILY_SECS = 90;
const DF_STORY = [
  { secs: 45,  speed: 150, spawnEvery: 0.95, cloudRate: 0.16, starRate: 0.24, gap: 0.34, shields: 3 },
  { secs: 60,  speed: 170, spawnEvery: 0.85, cloudRate: 0.18, starRate: 0.24, gap: 0.32, shields: 3 },
  { secs: 75,  speed: 195, spawnEvery: 0.75, cloudRate: 0.20, starRate: 0.22, gap: 0.30, shields: 3 },
  { secs: 90,  speed: 220, spawnEvery: 0.68, cloudRate: 0.22, starRate: 0.22, gap: 0.28, shields: 3 },
  { secs: 120, speed: 250, spawnEvery: 0.60, cloudRate: 0.24, starRate: 0.20, gap: 0.26, shields: 2 },
  { secs: 150, speed: 285, spawnEvery: 0.55, cloudRate: 0.26, starRate: 0.20, gap: 0.24, shields: 2 },
];
const DF_ARCADE = {
  easy:   { speed: 130, spawnEvery: 1.00, cloudRate: 0.16, starRate: 0.26, gap: 0.36, shields: 4 },
  normal: { speed: 150, spawnEvery: 0.85, cloudRate: 0.20, starRate: 0.24, gap: 0.30, shields: 3 },
  hard:   { speed: 190, spawnEvery: 0.68, cloudRate: 0.26, starRate: 0.22, gap: 0.26, shields: 3 },
};

/* WHAT A COURSE ASKS FOR IS MEASURED, NOT PICKED — the hrTargetFor pattern.
   The target is derived from the course's OWN stream at the start of the run
   by flying it with an explicit model of a pilot:

     - steers at most DF_MODEL_STEER screen widths a second, sustained
     - cannot react to an event for DF_MODEL_LAG
     - has until DF_MODEL_REACH after an event spawns to be at its gap (the
       conservative end of how long an object is on screen)
     - never collects stars (they are upside, never a requirement) and never
       loses a shield (dfDrawObj keeps weather off a gate's gap)

   The target is DF_TARGET_FRACTION of what that model scores. Story seeds are
   stable per band and the daily seed is shared, so two players on one rung
   get the same target. DF_TARGET_FRACTION is the single balance knob — move
   it, not the per-rung numbers — and jetrun-level-targets re-checks the
   ladder after any retune. What no simulation can tell you is what share a
   real hand actually threads on a phone; that is a playtest. */
const DF_MODEL_STEER = 1.2;   // screen widths per second
const DF_MODEL_LAG = 0.25;
const DF_MODEL_REACH = 2.0;
const DF_TARGET_FRACTION = 0.7;

function dfEveryAt(cfg, t) {
  return Math.max(DF_MIN_EVERY, cfg.spawnEvery - t * DF_EVERY_DECAY);
}

// The combo multiplier: 5 gates per step, capped at DF_MAX_MULT. One copy —
// the frame loop, the model and the HUD all read it.
function dfMultFor(combo) {
  return 1 + Math.min(DF_MAX_MULT - 1, Math.floor(Math.max(0, combo) / DF_MULT_EVERY));
}

/* One event off the stream. Positions are FRACTIONS of the board width, so
   the same roll threads the same course on every screen. Gates are clamped
   so both posts stay on screen, and a cloud is nudged off the previous
   gate's gap: weather parked inside a gap is a shield loss the player cannot
   avoid, and that is a tax, not a puzzle. */
function dfDrawObj(cfg, rng, lastGateFx) {
  const roll = rng();
  if (roll < cfg.cloudRate) {
    let fx = 0.10 + rng() * 0.80;
    const cm = (0.14 + 0.10) / 2 + 0.04;
    fx = Math.min(1 - cm, Math.max(cm, fx));
    if (lastGateFx != null && Math.abs(fx - lastGateFx) < 0.20) {
      fx = lastGateFx + (fx < lastGateFx ? -0.20 : 0.20);
      if (fx < cm) fx = lastGateFx + 0.20;
      if (fx > 1 - cm) fx = lastGateFx - 0.20;
    }
    return { type: 'cloud', fx, fw: 0.14 + rng() * 0.10 };
  }
  if (roll < cfg.cloudRate + cfg.starRate) {
    return { type: 'star', fx: 0.08 + rng() * 0.84, fw: 0.05 };
  }
  const gm = cfg.gap / 2 + 0.03;
  const fx = Math.min(1 - gm, Math.max(gm, 0.16 + rng() * 0.68));
  return { type: 'gate', fx, fw: cfg.gap };
}

function dfCoursePlan(cfg, rng, secs) {
  const out = [];
  let lastGateFx = null;
  for (let t = dfEveryAt(cfg, 0); t <= secs; t += dfEveryAt(cfg, t)) {
    const d = dfDrawObj(cfg, rng, lastGateFx);
    if (d.type === 'gate') lastGateFx = d.fx;
    out.push({ t, ...d });
  }
  return out;
}

function dfModelRun(cfg, rng, secs) {
  const plan = dfCoursePlan(cfg, rng, secs);
  let score = 0, combo = 0, jetFx = 0.5, prevAt = -Infinity;
  let passed = 0, missed = 0, gates = 0;
  for (const o of plan) {
    if (o.type !== 'gate') continue;
    gates++;
    const deadline = o.t + DF_MODEL_REACH;
    const start = Math.max(o.t + DF_MODEL_LAG, prevAt);
    const dt = deadline - start;
    const need = Math.abs(o.fx - jetFx);
    if (dt < 0 || need > DF_MODEL_STEER * dt + o.fw / 2) {
      missed++; combo = 0;
    } else {
      jetFx = o.fx;
      combo++;
      score += DF_GATE_SCORE * dfMultFor(combo);
      passed++;
    }
    prevAt = Math.max(prevAt, deadline);
  }
  return { score, passed, missed, gates, spawns: plan.length };
}

// Rounded to a readable number: a target is a thing a player reads off a pill
// mid-flight, not a checksum.
function dfTargetFor(cfg, rng) {
  if (!cfg.limit) return 0;
  const model = dfModelRun(cfg, rng, cfg.limit);
  return Math.max(DF_GATE_SCORE,
    Math.round(model.score * DF_TARGET_FRACTION / 10) * 10);
}

/* Hit geometry — pure, and the only copies of it: the frame loop, the
   keyboard path and jetrun-course-rules all go through them. Same
   pair-of-pure-functions shape as hrPickAt/hrApplyStrike.

   The jet's hit circle is DF_JET_R; a gate is two posts DF_POST_W wide
   standing at the edges of its gap; a cloud is a bank DF_PICK radius across;
   a star is a pickup, not a hazard, so dfPickAt never returns one (dfStarAt
   does). Nearest by vertical distance wins when two hazards overlap. */
const DF_JET_R = 14;
const DF_POST_W = 10;
const DF_POST_H = 56;

function dfPickAt(objs, jetX, jetY, W) {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < objs.length; i++) {
    const o = objs[i];
    if (o.hit) continue;
    if (o.type !== 'gate' && o.type !== 'cloud') continue;
    const x = o.fx * W;
    const halfW = (o.fw * W) / 2;
    if (Math.abs(o.y - jetY) > DF_POST_H / 2 + DF_JET_R) continue;
    if (o.type === 'gate') {
      const px = Math.min(Math.abs(jetX - (x - halfW)), Math.abs(jetX - (x + halfW)));
      if (px > DF_POST_W / 2 + DF_JET_R) continue;
    } else {
      const dx = jetX - x, dy = jetY - o.y;
      if (Math.hypot(dx, dy) > halfW * 0.85 + DF_JET_R) continue;
    }
    const d = Math.abs(o.y - jetY);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function dfStarAt(objs, jetX, jetY, W) {
  for (let i = 0; i < objs.length; i++) {
    const o = objs[i];
    if (o.hit || o.type !== 'star') continue;
    const dx = jetX - o.fx * W, dy = jetY - o.y;
    if (Math.hypot(dx, dy) <= 12 + DF_JET_R + 4) return i;
  }
  return -1;
}

/* WHAT CROSSING THE GATE LINE IS WORTH. Judged once, as the gate's centre
   passes the jet: inside the gap is a pass, touching a post is a clip
   (dfPickAt has usually already claimed it — this is the frame that catches
   a fast one), clear outside both is a miss. Pure. */
function dfGateVerdict(jetX, gapX, gapHalfW) {
  const d = Math.abs(jetX - gapX);
  if (d <= gapHalfW - DF_JET_R) return 'pass';
  if (d <= gapHalfW + DF_POST_W / 2 + DF_JET_R) return 'clip';
  return 'miss';
}

/* WHAT A CONTACT COSTS. A hazard costs a shield and the combo with it; a
   star pays flat and never touches the combo. Mirrors hrApplyStrike: split
   out from the frame loop so no second copy of the pricing can drift. */
function dfApplyHit(s, kind) {
  if (kind === 'star') {
    s.score += DF_STAR_SCORE;
    return 'star';
  }
  s.shields -= 1;
  s.combo = 0;
  return kind; // 'cloud' | 'pylon'
}

// One config for whichever mode the shell opened this in. `limit` of 0 means
// endless — the flight ends when the shields do, and an endless flight has no
// target. Mirrors hrModeConfig.
function dfModeConfig(playMode, band) {
  if (playMode === 'story') {
    const c = DF_STORY[Math.max(0, Math.min(DF_STORY.length - 1, band || 0))];
    return { ...c, limit: c.secs, label: `Level ${Math.max(0, band || 0) + 1}` };
  }
  if (playMode === 'arcade') {
    const c = DF_ARCADE[band] || DF_ARCADE.normal;
    return { ...c, limit: 0, label: 'Arcade' };
  }
  if (playMode === 'daily') {
    return { speed: 150, spawnEvery: 0.85, cloudRate: 0.20, starRate: 0.24, gap: 0.30,
             shields: DF_SHIELDS, limit: DF_DAILY_SECS, label: "Today's course" };
  }
  return { speed: 150, spawnEvery: 0.95, cloudRate: 0.20, starRate: 0.26, gap: 0.32,
           shields: DF_SHIELDS, limit: 0, label: 'Free play' };
}

/* No end panel of this game's own, for the same reason Hash Rush has none:
   reportRunEnd always reaches onWin/onLose, so a shared card always follows,
   and a panel would only exist in the gap before it arrived. The reset is a
   LAYOUT effect so Play Again cannot paint the finished course first. */
function JetRunGame({ onWin, onLose, onStepChange, resetKey, game, onBack, menuConfig,
                      playMode, band, offset }) {
  const cfg = useRef(null);
  if (!cfg.current) cfg.current = dfModeConfig(playMode, band);
  const MODE = cfg.current;
  const MODE_LIMIT_INIT = MODE.limit || 0;
  const [phase, setPhase] = useState('idle'); // idle | playing | dead
  const [score, setScore] = useState(0);
  const [shields, setShields] = useState(MODE.shields);
  const [mult, setMult] = useState(1);
  const [secsLeft, setSecsLeft] = useState(MODE_LIMIT_INIT);
  const [target, setTarget] = useState(0);

  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const lastTsRef = useRef(0);
  const stateRef = useRef(null);
  const submittedRef = useRef(false);
  const pressedRef = useRef(false);
  const keysRef = useRef({ left: false, right: false });
  const onWinRef = useRef(onWin); onWinRef.current = onWin;
  const onLoseRef = useRef(onLose); onLoseRef.current = onLose;
  const onStepRef = useRef(onStepChange); onStepRef.current = onStepChange;

  /* The course stream is seeded in every mode but free play. A fresh rng per
     RUN (not per mount) is what makes "retry the rung" replay the same
     course. The target takes a SECOND rng on the same seed, deliberately:
     the model run has to walk the whole stream before the player has moved,
     and the run's own generator is about to be consumed by play. modeSeed
     returns a fresh generator each call, and story/daily/arcade seeds are
     all stable for the length of a run, so the two streams are identical.
     Free play is unseeded and endless, so it has no target to compute. */
  const fresh = () => {
    const seeded = () => modeSeed(playMode, 'jetrun', band, offset).rng;
    return {
      objs: [], elapsed: 0, score: 0, shields: MODE.shields, combo: 0,
      gates: 0, stars: 0, speed: MODE.speed, jetX: null, targetX: null,
      nextAt: dfEveryAt(MODE, 0), lastGateFx: null, iframes: 0,
      dead: false, cleared: false,
      rng: playMode ? seeded() : null,
      target: playMode && MODE.limit ? dfTargetFor(MODE, seeded()) : 0,
    };
  };

  const reset = () => {
    const s = fresh();
    stateRef.current = s;
    setScore(0); setShields(MODE.shields); setMult(1);
    setSecsLeft(MODE.limit || 0);
    setTarget(s.target);
    submittedRef.current = false;
  };

  // Layout, not passive: Play Again clears the shared card and bumps resetKey
  // in one commit, and a passive effect would let the finished course paint
  // once before this ran. See the note above the component.
  React.useLayoutEffect(() => { reset(); setPhase('idle'); }, [resetKey]);

  /* `?jrdead=1` — park the game in its finished state with no shared results
     card over it, the same role as ?hrdead=1. It deliberately writes NOTHING
     — no endGame, no score submission, no endpoint — it is a render state,
     not a run. Same role as ?sdk=9 and ?cwtype= elsewhere. */
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('jrdead') !== '1') return;
    if (!stateRef.current) stateRef.current = fresh();
    stateRef.current.dead = true;
    setPhase('dead');
  }, []);

  // Steering. The pointer is bound NATIVELY, not through React's onTouch*
  // props — React 18 registers touchmove on the root as a PASSIVE listener,
  // so a prop-level preventDefault does nothing, and an element listener is
  // also one a test can drive. Drag anywhere: the jet banks toward the
  // finger. Arrow keys (held) steer on a desktop.
  useEffect(() => {
    const el = canvasRef.current; if (!el) return;
    const xAt = (e) => {
      const r = el.getBoundingClientRect();
      return e.clientX - r.left;
    };
    const onDown = (e) => {
      if (phase === 'idle') { startGame(); return; }
      pressedRef.current = true;
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* fine without capture */ }
      const s = stateRef.current;
      if (s && !s.dead) s.targetX = xAt(e);
    };
    const onMove = (e) => {
      if (!pressedRef.current || phase !== 'playing') return;
      const s = stateRef.current; if (!s || s.dead) return;
      s.targetX = xAt(e);
    };
    const onUp = () => { pressedRef.current = false; };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
  }, [phase]);

  useEffect(() => {
    const keys = keysRef.current;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.key === ' ' || e.key === 'Enter') && phase === 'idle') { e.preventDefault(); startGame(); return; }
      if (phase !== 'playing') return;
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { keys.left = true; e.preventDefault(); }
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { keys.right = true; e.preventDefault(); }
    };
    const onKeyUp = (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = false;
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = false;
    };
    const onBlur = () => { keys.left = false; keys.right = false; };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [phase]);

  const endGame = (cleared) => {
    const s = stateRef.current; if (!s) return;
    s.dead = true;
    s.cleared = !!cleared;
    setPhase('dead');
    cgSound(cleared ? 'clear' : 'lose'); cgHaptic(cleared ? 20 : [20, 40, 20]);
    const finalScore = Math.round(s.score);
    const secs = Math.round(s.elapsed);
    cgSaveHistory(JR_HISTORY_KEY, { score: finalScore, gates: s.gates, stars: s.stars, secs, ts: Date.now() });
    if (!submittedRef.current) {
      submittedRef.current = true;
      // Only free play and arcade belong on the classic all-time board; a
      // daily and a story rung settle on their own endpoints.
      if (!playMode || playMode === 'arcade') {
        submitClassicScore('jetrun', finalScore, { gates: s.gates, stars: s.stars, timeSecs: secs });
      }
      reportRunEnd(
        { cleared: !!cleared, playMode, onWin: onWinRef.current, onLose: onLoseRef.current },
        finalScore, s.gates, secs,
        {
          winnerLabel: cleared ? 'Course complete! ✈️' : 'Game Over',
          share: `✈️ Jet Run — ${finalScore} pts, ${s.gates} gates threaded`,
        }
      );
    }
  };

  const startGame = () => {
    reset();
    setPhase('playing');
    cgSound('click');
  };

  // Main loop.
  useEffect(() => {
    if (phase !== 'playing') return;
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = guardCanvasCtx(canvas.getContext('2d'));
    let running = true;
    lastTsRef.current = 0;
    const jetYOff = 64;    // the jet rides this far above the floor
    const DF_STEER = 1.2;  // widths per second — the rate the model assumes

    const sizeCanvas = () => {
      const wrap = wrapRef.current; if (!wrap) return;
      const dpr = canvasDpr();
      const w = wrap.clientWidth, h = wrap.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    sizeCanvas();
    window.addEventListener('resize', sizeCanvas);

    const step = (s, dt, W, H) => {
      const jetY = H - jetYOff;
      s.elapsed += dt;
      s.speed = Math.min(DF_MAX_SPEED, MODE.speed + Math.floor(s.elapsed / DF_RAMP_SECS) * DF_SPEED_STEP);
      if (s.iframes > 0) s.iframes = Math.max(0, s.iframes - dt);

      // Steer. Keyboard nudges the target; the jet chases the target at the
      // same cap, so a drag feels weighty but never loses the finger.
      if (s.targetX == null) { s.targetX = W / 2; s.jetX = W / 2; }
      const steer = W * DF_STEER;
      if (keysRef.current.left) s.targetX -= steer * dt;
      if (keysRef.current.right) s.targetX += steer * dt;
      s.targetX = Math.max(DF_JET_R, Math.min(W - DF_JET_R, s.targetX));
      const dx = s.targetX - s.jetX;
      const maxStep = steer * dt;
      s.jetX += Math.max(-maxStep, Math.min(maxStep, dx));

      // Every spawn time that has now passed, from the schedule — not "has a
      // frame's worth of time built up". dt is capped at 0.05 s upstream and
      // the interval floor is DF_MIN_EVERY, so this can never run away.
      while (s.nextAt <= s.elapsed) {
        const d = dfDrawObj(MODE, s.rng || Math.random, s.lastGateFx);
        if (d.type === 'gate') s.lastGateFx = d.fx;
        s.objs.push({ type: d.type, fx: d.fx, fw: d.fw, y: -50, hit: false, judged: false });
        s.nextAt += dfEveryAt(MODE, s.nextAt);
      }

      for (const o of s.objs) {
        o.y += s.speed * dt;
        // The gate line is judged ONCE, as its centre passes the jet.
        if (o.type === 'gate' && !o.judged && o.y >= jetY) {
          o.judged = true;
          if (!o.hit) {
            const v = dfGateVerdict(s.jetX, o.fx * W, (o.fw * W) / 2);
            if (v === 'pass') {
              s.combo += 1;
              s.gates += 1;
              s.score += DF_GATE_SCORE * dfMultFor(s.combo);
              cgSound('clear');
            } else if (v === 'miss') {
              s.combo = 0;
            } else { // 'clip' — a post the per-frame pick missed
              o.hit = true;
              dfApplyHit(s, 'pylon');
              cgSound('lose'); cgHaptic(30);
              s.iframes = 0.8;
            }
          }
        }
      }

      // Contacts. One hazard per touch (i-frames) so a cloud bank sliding
      // past cannot bill two shields for one mistake.
      const hazard = dfPickAt(s.objs, s.jetX, jetY, W);
      if (hazard >= 0 && s.iframes <= 0) {
        const o = s.objs[hazard];
        o.hit = true;
        dfApplyHit(s, o.type === 'gate' ? 'pylon' : 'cloud');
        cgSound('lose'); cgHaptic(30);
        s.iframes = 0.8;
      }
      const star = dfStarAt(s.objs, s.jetX, jetY, W);
      if (star >= 0) {
        s.objs[star].hit = true;
        dfApplyHit(s, 'star');
        s.stars += 1;
        cgSound('clear');
      }
      if (s.shields <= 0) s.dead = true;

      // Drop things that have scrolled past.
      s.objs = s.objs.filter(o => o.y < H + 60);

      // sync HUD (throttled by React batching)
      setScore(Math.round(s.score));
      setShields(s.shields);
      setMult(dfMultFor(s.combo));
      if (MODE.limit) setSecsLeft(Math.max(0, Math.ceil(MODE.limit - s.elapsed)));
      if (onStepRef.current) onStepRef.current(s.gates);
    };

    const draw = (s, W, H) => {
      const jetY = H - jetYOff;
      // Sky follows the theme (PAL, resolved every frame so a Light↔Dark flip
      // recolours mid-run). The jet, pylons, clouds and stars below stay
      // hardcoded — intrinsic arcade art, like the 2048 tiles.
      ctx.clearRect(0, 0, W, H);
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, PAL.card);
      sky.addColorStop(1, PAL.bg);
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);
      // The floor. The course scrolls toward it, so it is a line you can see.
      ctx.fillStyle = PAL.accent;
      ctx.globalAlpha = 0.25;
      ctx.fillRect(0, H - 4, W, 4);
      ctx.globalAlpha = 1;

      for (const o of s.objs) {
        const x = o.fx * W;
        const halfW = (o.fw * W) / 2;
        if (o.type === 'gate') {
          // Two amber posts standing at the edges of the gap, plus a faint
          // line across it so the gate line is visible before it arrives.
          ctx.fillStyle = '#f59e0b';
          ctx.fillRect(x - halfW - DF_POST_W / 2, o.y - DF_POST_H / 2, DF_POST_W, DF_POST_H);
          ctx.fillRect(x + halfW - DF_POST_W / 2, o.y - DF_POST_H / 2, DF_POST_W, DF_POST_H);
          ctx.fillStyle = '#b45309';
          ctx.fillRect(x - halfW - DF_POST_W / 2, o.y - DF_POST_H / 2, DF_POST_W, 4);
          ctx.fillRect(x + halfW - DF_POST_W / 2, o.y - DF_POST_H / 2, DF_POST_W, 4);
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = '#f59e0b';
          ctx.fillRect(x - halfW, o.y - 1, halfW * 2, 2);
          ctx.globalAlpha = 1;
        } else if (o.type === 'cloud') {
          // A bank of three lumps. A hit cloud keeps drifting, drawn inert.
          ctx.fillStyle = o.hit ? 'rgba(148,163,184,0.35)' : 'rgba(148,163,184,0.9)';
          ctx.beginPath();
          ctx.arc(x - halfW * 0.5, o.y + halfW * 0.15, halfW * 0.55, 0, Math.PI * 2);
          ctx.arc(x, o.y - halfW * 0.2, halfW * 0.7, 0, Math.PI * 2);
          ctx.arc(x + halfW * 0.5, o.y + halfW * 0.15, halfW * 0.55, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // A fuel star: a gold spark with a bright core.
          ctx.fillStyle = o.hit ? 'rgba(251,191,36,0.25)' : '#fbbf24';
          ctx.beginPath();
          ctx.arc(x, o.y, 9, 0, Math.PI * 2);
          ctx.fill();
          if (!o.hit) {
            ctx.fillStyle = '#fef3c7';
            ctx.beginPath();
            ctx.arc(x, o.y, 4, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // The jet — a generic delta-wing fighter silhouette (hardcoded art),
      // banking toward where it is headed. It blinks while i-frames last, so
      // a shield loss is visible without a shake the reduced-motion pref
      // would have to chase.
      const s2 = s;
      const blink = s2.iframes > 0 && Math.floor(s2.iframes * 10) % 2 === 1;
      if (!blink) {
        ctx.save();
        ctx.translate(s2.jetX, jetY);
        const tilt = Math.max(-0.3, Math.min(0.3, (s2.targetX - s2.jetX) / 60));
        ctx.rotate(tilt);
        // engine glow, sized by how hard the jet is working
        ctx.fillStyle = 'rgba(56,189,248,0.55)';
        ctx.beginPath();
        ctx.ellipse(0, 19, 3.5, 5 + Math.min(6, s2.speed / 70), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#dbe4f0';
        ctx.beginPath();
        ctx.moveTo(0, -24);          // nose
        ctx.lineTo(5, -6);
        ctx.lineTo(18, 8);           // right wing tip
        ctx.lineTo(14, 12);
        ctx.lineTo(4, 8);
        ctx.lineTo(0, 16);           // tail
        ctx.lineTo(-4, 8);
        ctx.lineTo(-14, 12);
        ctx.lineTo(-18, 8);
        ctx.lineTo(-5, -6);
        ctx.closePath();
        ctx.fill();
        // canopy
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.ellipse(0, -8, 3, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    };

    const frame = (ts) => {
      if (!running) return;
      const s = stateRef.current;
      const W = canvas.clientWidth, H = canvas.clientHeight;
      if (!lastTsRef.current) lastTsRef.current = ts;
      let dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      if (dt > 0.05) dt = 0.05;
      step(s, dt, W, H);
      draw(s, W, H);
      // A bounded course (daily / story rung) that runs its clock out is
      // CLEARED only if it hit the course's target — the same rule Hash Rush
      // runs, and for a story rung it is the difference between ticking the
      // rung and not. An endless flight ends when the shields do.
      if (!s.dead && MODE.limit && s.elapsed >= MODE.limit) {
        endGame(!s.target || s.score >= s.target);
        return;
      }
      if (s.dead) { endGame(false); return; }
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);
    return () => {
      running = false;
      window.removeEventListener('resize', sizeCanvas);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [phase]);

  const hist = cgLoadHistory(JR_HISTORY_KEY);
  const best = hist.reduce((m, r) => Math.max(m, r.score || 0), 0);
  const sheet = [
    cgLeaderboardSection('jetrun'),
    cgHistorySection(hist, r => <><span>{r.score} pts</span><span className="mono">{r.gates} gates · {r.secs}s</span></>),
    cgStatsSection([
      { val: best, lbl: 'Best score' }, { val: hist.length, lbl: 'Runs' },
    ]),
    cgRulesSection([
      'Drag to steer your jet — it climbs on its own and the course streams past. Hold an arrow key on a desktop.',
      'Thread a gate for 10 points. Consecutive gates build a combo multiplier up to ×5; a missed gap or a clipped post breaks it.',
      'Fuel stars are worth 5 points and never break your combo.',
      'A storm cloud or a gate post costs a shield — and the combo with it. Lose every shield and the flight is over.',
      'Daily and story courses show a target score: reach it before the clock runs out to clear the course.',
    ]),
  ];

  return (
    <ClassicShell game={game} onExit={onBack} onNewGame={() => startGame()} sheetSections={sheet} menuConfig={menuConfig}>
      <div className="cg-stage">
        {/* The target is shown IN the score pill rather than beside it, the
            same one-glance rule Hash Rush runs: mid-flight the only question
            is "am I going to clear this". */}
        <CgStatus items={[
          { l: target ? 'Score / target' : 'Score', v: target ? `${score} / ${target}` : score },
          { l: 'Shields', v: '❤️'.repeat(shields) || '—' },
          MODE.limit
            ? { l: 'Left', v: `${Math.floor(secsLeft / 60)}:${String(secsLeft % 60).padStart(2, '0')}` }
            : { l: 'Combo', v: '×' + mult },
        ]} />
        <div className="jr-wrap" ref={wrapRef} data-jr-phase={phase} data-jr-target={target}>
          <canvas ref={canvasRef} className="jr-canvas" />
          {phase === 'idle' && (
            <div className="jr-overlay">
              <div className="jr-overlay-title">✈️ Jet Run</div>
              <div className="jr-overlay-sub">
                {MODE.limit
                  ? `${MODE.label} — ${MODE.limit}s to thread ${target} points of gates. Drag to steer; leave the storm clouds alone.`
                  : 'Drag to steer your jet through the gates. Fuel stars score; storm clouds cost a shield.'}
              </div>
              <button className="gm-play-btn" style={{ maxWidth: 200 }} onClick={startGame}>Start flying</button>
            </div>
          )}
        </div>
      </div>
    </ClassicShell>
  );
}
