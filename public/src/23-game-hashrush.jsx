/* ============================================================
   Hash Rush — tap-to-mine lane game (self-shell canvas game)
   ============================================================ */
const HR_HISTORY_KEY = 'puzzlechain_hashrush_history';
const HR_LANES = 3;
const HR_START_SPEED = 150;     // px/s downward
const HR_SPEED_STEP = 28;       // +px/s every ramp
const HR_RAMP_SECS = 30;        // ramp every N seconds
const HR_MAX_SPEED = HR_START_SPEED * 3;
const HR_TOKEN_SCORE = 10;
const HR_BOOST_MULT = 2;
const HR_BOOST_SECS = 5;        // #215 — ADDED by a bolt, not assigned
const HR_BOOST_MAX = 30;        // ceiling on stacked boost
const HR_TNT_PENALTY = 10;      // #215 — cost of hitting a TNT
const HR_BOLT_RATE = 0.12;      // share of spawns that are lightning
const HR_TAP_R = 34;            // half-height of a strike, px
const HR_SWING_MS = 180;        // how long a hammer stays on screen
const HR_MIN_EVERY = 0.30;      // fastest the spawn interval ever gets, s
const HR_EVERY_DECAY = 0.0015;  // how much it tightens per second elapsed
const HR_LIVES = 5;

/* #215 — TAP TO MINE.

   Hash Rush used to be a dodger: you steered a miner between three lanes,
   collected what it ran into and lost a life when it ran into a hazard. That
   made the hazard something you avoided by MOVING and made the lightning
   bolt nearly meaningless, because grabbing a second one simply reassigned
   the boost timer and threw away whatever was left of the first.

   It is now a striking game. Nothing steers. You hit what falls:

     mine    tapping a hash breaks it — HR_TOKEN_SCORE, doubled while boosted
     bolt    tapping lightning ADDS HR_BOOST_SECS to the boost you already
             have (up to HR_BOOST_MAX) instead of replacing it, so two bolts
             are worth twice one
     TNT     tapping one costs HR_TNT_PENALTY points. It is the one thing you
             are meant to leave alone, so the penalty is the whole hazard —
             it no longer takes a life, because there is nothing to dodge
     miss    a hash that reaches the floor un-mined costs a life. That is the
             failure this game has now, and it is what ends an endless run

   The lanes stay: they are what makes a strike aimable on a phone (a lane is
   130 px wide at 390 px) and they keep the seeded spawn stream meaningful.
*/

/* #176 — three modes over one loop.

   Hash Rush was pure endless score-attack driven by Math.random(), which is
   fine for a classic and disqualifying for a daily: two players would face
   different hazards and their scores would not be comparable. So the spawn
   stream is now drawn from a seeded rng in every mode except free play, and
   the modes differ only in how the shift is BOUNDED:

     daily  — a fixed 90-second shift over the day's spawn stream. Everyone
              gets the same stream in the same order.
     story  — six rungs, each longer, faster and denser than the last.
     arcade — endless, with the band setting the starting pressure.

   #215 gave the two bounded modes a TARGET as well: running the clock out is
   no longer the whole of clearing a shift, you have to have mined enough. */
const HR_DAILY_SECS = 90;
const HR_STORY_BANDS = 6;

/* `spawnEvery` is stated as the interval between spawns at the START of the
   shift, and it is the difficulty dial that matters now: the old one was
   `blockRate`, because the hazard was what you had to survive. In a striking
   game the pressure is how many strikes a second the stream asks of you —
   1/spawnEvery — against how many a hand can actually make. The ladder below
   runs from about 1.05 strikes a second to about 2.4, and HR_MODEL_TPS says
   what that is being measured against. */
const HR_STORY = [
  { secs: 45,  speed: 150, tntRate: 0.26, spawnEvery: 0.95, lives: 5 },
  { secs: 60,  speed: 170, tntRate: 0.30, spawnEvery: 0.80, lives: 5 },
  { secs: 75,  speed: 195, tntRate: 0.34, spawnEvery: 0.67, lives: 4 },
  { secs: 90,  speed: 220, tntRate: 0.38, spawnEvery: 0.56, lives: 4 },
  { secs: 120, speed: 250, tntRate: 0.42, spawnEvery: 0.48, lives: 3 },
  { secs: 150, speed: 285, tntRate: 0.46, spawnEvery: 0.41, lives: 3 },
];
const HR_ARCADE = {
  easy:   { speed: 130, tntRate: 0.24, spawnEvery: 0.95, lives: 6 },
  normal: { speed: 150, tntRate: 0.30, spawnEvery: 0.72, lives: 5 },
  hard:   { speed: 190, tntRate: 0.38, spawnEvery: 0.55, lives: 4 },
};
/* #331 — the daily's band dials. Normal IS the pre-band daily config
   byte-for-byte (speed 150 / tnt 0.30 / spawn 0.70); Easy/Hard borrow the
   arcade bands' stream dials but keep the daily's own lives and 90-second
   limit, so the shape of a daily run never changes — only how hard the
   stream is. The level target derives itself through hrTargetFor, so there is
   no second table to keep in step. */
const HR_DAILY = {
  easy:   { speed: 130, tntRate: 0.24, spawnEvery: 0.95 },
  normal: { speed: HR_START_SPEED, tntRate: 0.30, spawnEvery: 0.70 },
  hard:   { speed: 190, tntRate: 0.38, spawnEvery: 0.55 },
};

/* THE SPAWN SCHEDULE IS A FUNCTION OF ELAPSED TIME, NOT OF FRAMES.

   The old loop accumulated a `spawnT` and fired when it crossed the interval,
   which overshoots by up to one frame EVERY spawn — so a slow device was
   dealt a measurably shorter stream than a fast one over the same 90 seconds.
   That was survivable while the score was just "how long did you last". It is
   not survivable now: a daily whose length depends on the phone holding it is
   not a daily, and a level target derived from the stream would mean a
   different thing on every device.

   So the times are derived from `elapsed` and the loop only asks which ones
   have passed. hrSpawnPlan walks the same recurrence ahead of time, which is
   what lets the target below be computed from the level's real stream rather
   than guessed. Keep the two using hrEveryAt/hrDrawObj — they are one rule
   with two readers. */
function hrEveryAt(cfg, t) {
  return Math.max(HR_MIN_EVERY, cfg.spawnEvery - t * HR_EVERY_DECAY);
}
function hrDrawObj(cfg, rng) {
  const lane = Math.floor(rng() * HR_LANES);
  const roll = rng();
  const type = roll < cfg.tntRate ? 'tnt'
    : roll < cfg.tntRate + HR_BOLT_RATE ? 'bolt'
    : 'hash';
  return { lane, type };
}
function hrSpawnPlan(cfg, rng, secs) {
  const out = [];
  for (let t = hrEveryAt(cfg, 0); t <= secs; t += hrEveryAt(cfg, t)) {
    const d = hrDrawObj(cfg, rng);
    out.push({ t, lane: d.lane, type: d.type });
  }
  return out;
}

/* WHAT A LEVEL ASKS FOR IS MEASURED, NOT PICKED.

   "Clear winning thresholds per level" needs a number per level, and a number
   somebody eyeballed would be wrong the moment any of the constants above
   moved — the same trap TM_LAYOUTS and MJ_LAYOUTS document. So the target is
   derived from the level's OWN spawn stream at the start of the run, by
   playing it with an explicit model of a player:

     - taps at most HR_MODEL_TPS times a second, sustained
     - cannot react to a spawn for HR_MODEL_LAG
     - loses anything it has not reached within HR_MODEL_REACH of the spawn
       (roughly how long an object is on screen; the real fall is 2.0-3.8 s
       depending on band and ramp, so this is the conservative end)
     - never taps a TNT, and taps bolts as they come

   The target is HR_TARGET_FRACTION of what that model scores. Because story
   seeds are stable per band and the daily seed is the same for everybody, two
   players on the same level get the same target.

   0.7 is where it is because of a second measurement. Re-running each level
   300 times with a player who mines only a FRACTION of the hashes it reaches
   and fumbles into some of the TNT gives, as a share of the perfect model:

     mines 95%, hits 3% of TNT      0.92  0.93  0.92  0.92  0.94  0.93
     mines 85%, hits 8% of TNT      0.78  0.78  0.78  0.77  0.81  0.79
     mines 72%, hits 15% of TNT     0.58  0.59  0.60  0.59  0.64  0.59
                                     L1    L2    L3    L4    L5    L6

   So 0.7 clears for an accurate-but-not-perfect player at every level and
   does not clear for a ragged one. Note how FLAT those rows are: the ladder's
   difficulty is carried entirely by stream density and TNT share, which is
   why one constant does the job and a per-level ramp would only be a second
   copy of the ladder. Note also that the tap BUDGET never binds — the model
   misses at most one object a level even at 3.1 spawns a second, because it
   only ever strikes hashes and bolts. The thing this game asks for is
   accuracy, not speed, and HR_MODEL_TPS is currently not the binding term.

   HR_TARGET_FRACTION IS THE SINGLE BALANCE KNOB. Move it, not the individual
   numbers — there are no individual numbers. What no simulation can tell you
   is what share a real hand actually mines on a phone; that is a playtest,
   and it is the one input here I could not measure. */
const HR_MODEL_TPS = 3.2;
const HR_MODEL_LAG = 0.25;
const HR_MODEL_REACH = 2.0;
const HR_TARGET_FRACTION = 0.7;

function hrModelRun(cfg, rng, secs) {
  const plan = hrSpawnPlan(cfg, rng, secs);
  let score = 0, mined = 0, missed = 0, boostUntil = -1, freeAt = 0;
  for (const o of plan) {
    if (o.type === 'tnt') continue;           // the model leaves TNT alone
    const at = Math.max(o.t + HR_MODEL_LAG, freeAt);
    if (at > o.t + HR_MODEL_REACH || at > secs) { missed++; continue; }
    freeAt = at + 1 / HR_MODEL_TPS;
    if (o.type === 'bolt') {
      boostUntil = Math.min(Math.max(boostUntil, at) + HR_BOOST_SECS, at + HR_BOOST_MAX);
    } else {
      score += HR_TOKEN_SCORE * (at < boostUntil ? HR_BOOST_MULT : 1);
      mined++;
    }
  }
  return { score, mined, missed, spawns: plan.length };
}

// Rounded to a readable number: a target is a thing a player reads off a pill
// mid-run, not a checksum.
function hrTargetFor(cfg, rng) {
  if (!cfg.limit) return 0;
  const model = hrModelRun(cfg, rng, cfg.limit);
  return Math.max(HR_TOKEN_SCORE,
    Math.round(model.score * HR_TARGET_FRACTION / 10) * 10);
}

/* Which object a strike at (x, y) breaks. Pure, and the only place the hit
   box is defined: the lane is the full column (so aiming left-to-right is as
   coarse as the lanes themselves) and the vertical window is HR_TAP_R either
   side of the object's centre. Nearest wins when two overlap, which is what
   makes a strike into a stack break the one you aimed at. */
function hrPickAt(objs, x, y, W) {
  const laneW = W / HR_LANES;
  let best = -1, bestD = Infinity;
  for (let i = 0; i < objs.length; i++) {
    const o = objs[i];
    if (o.hit) continue;
    if (Math.abs(x - (o.lane * laneW + laneW / 2)) > laneW / 2) continue;
    const d = Math.abs(y - o.y);
    if (d <= HR_TAP_R && d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// What a strike DOES. Split out from the pointer handler so the keyboard path
// and the self-test go through the same rules rather than a second copy.
function hrApplyStrike(s, o) {
  o.hit = true;
  if (o.type === 'hash') {
    s.score += HR_TOKEN_SCORE * (s.boost > 0 ? HR_BOOST_MULT : 1);
    s.tokens += 1;
    return 'hash';
  }
  if (o.type === 'bolt') {
    s.boost = Math.min(HR_BOOST_MAX, s.boost + HR_BOOST_SECS);
    return 'bolt';
  }
  s.score = Math.max(0, s.score - HR_TNT_PENALTY);
  return 'tnt';
}

// One config for whichever mode the shell opened this in. `limit` of 0 means
// endless — the run ends when the lives do, and an endless run has no target.
function hrModeConfig(playMode, band) {
  if (playMode === 'story') {
    const c = HR_STORY[Math.max(0, Math.min(HR_STORY.length - 1, band || 0))];
    return { ...c, limit: c.secs, label: `Level ${Math.max(0, band || 0) + 1}` };
  }
  if (playMode === 'arcade') {
    const c = HR_ARCADE[band] || HR_ARCADE.normal;
    return { ...c, limit: 0, label: 'Arcade' };
  }
  if (playMode === 'daily') {
    const d = HR_DAILY[(band === 'easy' || band === 'hard') ? band : 'normal'];
    return { speed: d.speed, tntRate: d.tntRate, spawnEvery: d.spawnEvery,
             lives: HR_LIVES, limit: HR_DAILY_SECS, label: "Today's shift" };
  }
  return { speed: HR_START_SPEED, tntRate: 0.30, spawnEvery: 0.85,
           lives: HR_LIVES, limit: 0, label: 'Free play' };
}

/* #215 — Hash Rush no longer draws an end panel of its own, and that is the
   whole of the reported "brief glitchy Play Again".

   Phase 1 (#160) gave it a `resultShown` prop so its panel would stand down
   once App's shared results card owned the ending. Standing down turned out to
   be ALL it ever did: `reportRunEnd` always reaches `onWin`/`onLose`, so a
   shared card always follows, and the panel only ever existed in the gap
   before one arrived. Measured in a browser:

     free play  — the classic branch of handleWin sets winData synchronously,
                  so the panel never rendered at all. Dead code.
     arcade     — that branch AWAITS /api/arcade/:id/finish first, so the panel
                  committed for one paint and was swapped for the shared card
                  32 ms later against a local stub; over a real network it is a
                  whole round trip. Daily and story await too.
     Play Again — clearing winData drops `resultShown` a commit BEFORE the
                  resetKey effect returns the game to idle, so the panel
                  flashed a second time, in the exact spot the button was.

   So the panel is deleted rather than re-timed: there is no state in which it
   is the ending the player is meant to read. `finalRank` went with it — the
   "Global rank #N" line it carried arrives after `submitClassicScore`
   resolves, by which time the shared card is already on top of it.

   The reset is a LAYOUT effect for the same reason: it has to run before the
   paint that follows Play Again, or the dead board shows for a frame. */
function HashRushGame({ onWin, onLose, onStepChange, resetKey, game, onBack, menuConfig,
                       playMode, band, offset }) {
  const cfg = useRef(null);
  if (!cfg.current) cfg.current = hrModeConfig(playMode, band);
  const MODE = cfg.current;
  const MODE_LIMIT_INIT = MODE.limit || 0;
  const [phase, setPhase] = useState('idle'); // idle | playing | dead
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(MODE.lives);
  const [mult, setMult] = useState(1);
  const [boostLeft, setBoostLeft] = useState(0);
  const [secsLeft, setSecsLeft] = useState(MODE_LIMIT_INIT);
  const [target, setTarget] = useState(0);

  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const lastTsRef = useRef(0);
  const stateRef = useRef(null);
  const submittedRef = useRef(false);
  const onWinRef = useRef(onWin); onWinRef.current = onWin;
  const onLoseRef = useRef(onLose); onLoseRef.current = onLose;
  const onStepRef = useRef(onStepChange); onStepRef.current = onStepChange;

  /* The spawn stream is seeded in every mode but free play. A fresh rng per
     RUN (not per mount) is what makes "restart the rung" replay the same
     stream — a rung you cannot learn is not a rung.

     The target takes a SECOND rng on the same seed, deliberately: the model
     run has to walk the whole stream before the player has taken a strike,
     and the run's own generator is about to be consumed by play. modeSeed
     returns a fresh generator each call, and story/daily/arcade seeds are all
     stable for the length of a run, so the two streams are identical. Free
     play is unseeded and endless, so it has no target to compute. */
  const fresh = () => {
    const seeded = () => modeSeed(playMode, 'hashrush', band, offset).rng;
    return {
      objs: [], swings: [], elapsed: 0, score: 0, lives: MODE.lives, tokens: 0,
      speed: MODE.speed, boost: 0, nextAt: hrEveryAt(MODE, 0), missed: 0,
      dead: false, cleared: false,
      rng: playMode ? seeded() : null,
      target: playMode && MODE.limit ? hrTargetFor(MODE, seeded()) : 0,
    };
  };

  const reset = () => {
    const s = fresh();
    stateRef.current = s;
    setScore(0); setLives(MODE.lives); setMult(1); setBoostLeft(0);
    setSecsLeft(MODE.limit || 0);
    setTarget(s.target);
    submittedRef.current = false;
  };

  // Layout, not passive: Play Again clears the shared card and bumps resetKey in
  // one commit, and a passive effect would let the finished board paint once
  // before this ran. See the note above the component.
  React.useLayoutEffect(() => { reset(); setPhase('idle'); }, [resetKey]);

  /* `?hrdead=1` — park the game in its finished state with no shared results
     card over it. That combination is the ONLY one in which an end panel of
     this game's own could ever have been the thing a player reads, and it is
     unreachable by navigating: ending a run for real always produces a card.
     So it is what the dapp.json check asserts on, and it deliberately writes
     NOTHING — no endGame, no score submission, no endpoint — it is a render
     state, not a run. Same role as ?sdk=9 and ?cwtype= elsewhere. */
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('hrdead') !== '1') return;
    if (!stateRef.current) stateRef.current = fresh();
    stateRef.current.dead = true;
    setPhase('dead');
  }, []);

  /* A strike. The swing is recorded whether or not it connects — a hammer that
     lands on nothing is the feedback that says the aim was off, and swallowing
     it would make a miss indistinguishable from an input that never arrived. */
  const strike = (x, y, W) => {
    const s = stateRef.current; if (!s || s.dead) return null;
    s.swings.push({ x, y, t: (typeof performance !== 'undefined' ? performance.now() : Date.now()) });
    const i = hrPickAt(s.objs, x, y, W);
    if (i < 0) { cgSound('move'); return null; }
    const kind = hrApplyStrike(s, s.objs[i]);
    if (kind === 'tnt') { cgSound('lose'); cgHaptic(30); }
    else { cgSound('clear'); }
    setScore(Math.round(s.score));
    return kind;
  };

  /* Keyboard: one key per lane, striking the LOWEST thing in it — the one
     about to be lost. Without this the game would be pointer-only, which the
     lane-steering version never was, and it is also the only path a test can
     drive: a keydown is a discrete event, so React has flushed the result by
     the time the next line runs. */
  const strikeLane = (lane) => {
    const el = canvasRef.current;
    const s = stateRef.current; if (!s || s.dead || !el) return null;
    let best = -1, bestY = -Infinity;
    for (let i = 0; i < s.objs.length; i++) {
      const o = s.objs[i];
      if (o.hit || o.lane !== lane) continue;
      if (o.y > bestY) { bestY = o.y; best = i; }
    }
    if (best < 0) { cgSound('move'); return null; }   // nothing in that lane
    const W = el.clientWidth;
    const laneW = W / HR_LANES;
    return strike(lane * laneW + laneW / 2, s.objs[best].y, W);
  };

  useEffect(() => {
    const el = canvasRef.current; if (!el) return;
    // Pointer-DOWN, like tapProps: a hammer that waits for the finger to come
    // back up is a hammer that feels late.
    const onDown = (e) => {
      if (phase === 'idle') { startGame(); return; }
      const rect = el.getBoundingClientRect();
      strike(e.clientX - rect.left, e.clientY - rect.top, rect.width);
    };
    el.addEventListener('pointerdown', onDown);
    return () => el.removeEventListener('pointerdown', onDown);
  }, [phase]);

  useEffect(() => {
    const LANE_KEYS = { ArrowLeft: 0, ArrowDown: 1, ArrowRight: 2, 1: 0, 2: 1, 3: 2 };
    const onKey = (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.key === ' ' || e.key === 'Enter') && phase === 'idle') { e.preventDefault(); startGame(); return; }
      const lane = LANE_KEYS[e.key];
      if (lane === undefined || phase !== 'playing') return;
      e.preventDefault();
      strikeLane(lane);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  const endGame = (cleared) => {
    const s = stateRef.current; if (!s) return;
    s.dead = true;
    s.cleared = !!cleared;
    setPhase('dead');
    cgSound(cleared ? 'clear' : 'lose'); cgHaptic(cleared ? 20 : [20, 40, 20]);
    const finalScore = Math.round(s.score);
    cgSaveHistory(HR_HISTORY_KEY, { score: finalScore, tokens: s.tokens, secs: Math.round(s.elapsed), ts: Date.now() });
    if (!submittedRef.current) {
      submittedRef.current = true;
      // Only free play and arcade belong on the classic all-time board; a
      // daily and a story rung settle on their own endpoints.
      if (!playMode || playMode === 'arcade') {
        submitClassicScore('hashrush', finalScore, { tokens: s.tokens, timeSecs: Math.round(s.elapsed) });
      }
      reportRunEnd(
        { cleared: !!cleared, playMode, onWin: onWinRef.current, onLose: onLoseRef.current },
        finalScore, s.tokens, Math.round(s.elapsed),
        {
          winnerLabel: cleared ? 'Shift complete! ⛏️' : 'Game Over',
          share: `⛏️ Hash Rush — ${finalScore} pts, ${s.tokens} hashes mined`,
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
      s.elapsed += dt;
      s.speed = Math.min(HR_MAX_SPEED, MODE.speed + Math.floor(s.elapsed / HR_RAMP_SECS) * HR_SPEED_STEP);
      if (s.boost > 0) { s.boost = Math.max(0, s.boost - dt); }
      // Every spawn time that has now passed, from the schedule — not "has a
      // frame's worth of time built up". dt is capped at 0.05 s upstream and
      // the interval floor is HR_MIN_EVERY, so this can never run away.
      while (s.nextAt <= s.elapsed) {
        const d = hrDrawObj(MODE, s.rng || Math.random);
        s.objs.push({ lane: d.lane, y: -30, type: d.type });
        s.nextAt += hrEveryAt(MODE, s.nextAt);
      }

      for (const o of s.objs) {
        o.y += s.speed * dt;
        // A hash that reaches the floor un-mined is the only way to lose a
        // life now. TNT and lightning falling past cost nothing — leaving them
        // alone is the correct play for one and merely a missed chance for the
        // other.
        if (!o.hit && o.type === 'hash' && o.y > H) {
          o.hit = true;
          s.missed += 1;
          s.lives -= 1;
          cgSound('lose'); cgHaptic(20);
          if (s.lives <= 0) s.dead = true;
        }
      }
      // Drop mined/missed/offscreen objects, and expired hammers.
      s.objs = s.objs.filter(o => !o.hit && o.y < H + 40);
      const nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      if (s.swings.length) s.swings = s.swings.filter(w => nowMs - w.t < HR_SWING_MS);

      // sync HUD (throttled by React batching)
      setScore(Math.round(s.score));
      setLives(s.lives);
      setMult(s.boost > 0 ? HR_BOOST_MULT : 1);
      setBoostLeft(s.boost > 0 ? Math.ceil(s.boost) : 0);
      if (MODE.limit) setSecsLeft(Math.max(0, Math.ceil(MODE.limit - s.elapsed)));
      if (onStepRef.current) onStepRef.current(s.tokens);
    };

    const draw = (s, W, H) => {
      ctx.clearRect(0, 0, W, H);
      // Play-area chrome follows the theme (PAL, resolved every frame so a
      // Light↔Dark flip recolours mid-run). The old near-white lane stripes
      // were invisible in the light palette. The hashes / TNT / hammer below
      // stay hardcoded — intrinsic arcade art, like the Drop Stack pieces.
      ctx.fillStyle = PAL.bg;
      ctx.fillRect(0, 0, W, H);
      const laneW = W / HR_LANES;
      for (let i = 0; i < HR_LANES; i++) {
        ctx.fillStyle = i % 2 ? PAL.surface : PAL.card;
        ctx.fillRect(i * laneW, 0, laneW, H);
      }
      ctx.strokeStyle = PAL.border;
      ctx.lineWidth = 1;
      for (let i = 1; i < HR_LANES; i++) {
        ctx.beginPath();
        ctx.moveTo(Math.round(i * laneW) + 0.5, 0);
        ctx.lineTo(Math.round(i * laneW) + 0.5, H);
        ctx.stroke();
      }
      // The floor. A hash that crosses it is lost, so it has to be a line you
      // can see coming rather than the edge of the box.
      ctx.fillStyle = PAL.accent;
      ctx.fillRect(0, H - 5, W, 5);

      // objects
      for (const o of s.objs) {
        const cx = o.lane * laneW + laneW / 2;
        ctx.font = '30px serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        if (o.type === 'tnt') {
          ctx.fillStyle = 'rgba(244,63,94,0.85)';
          ctx.fillRect(cx - laneW * 0.4, o.y - 18, laneW * 0.8, 36);
          ctx.fillStyle = '#fff'; ctx.fillText('🧨', cx, o.y);
        } else if (o.type === 'bolt') {
          if (s.boost > 0) { ctx.shadowColor = '#22d3ee'; ctx.shadowBlur = 14; }
          ctx.fillText('⚡', cx, o.y);
          ctx.shadowBlur = 0;
        } else {
          ctx.fillText('⛏️', cx, o.y);
        }
      }

      /* Hammers. Alpha comes from ctx.globalAlpha and the colours from PAL:
         a ca() string is CSS-only and canvas silently keeps the last colour
         it had, which is the bug class guardCanvasCtx exists to catch. */
      const nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      for (const w of s.swings) {
        const age = (nowMs - w.t) / HR_SWING_MS;
        if (age < 0 || age > 1) continue;
        ctx.globalAlpha = 1 - age;
        ctx.font = '30px serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('🔨', w.x, w.y - age * 10);
        ctx.globalAlpha = 1;
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
      // A bounded shift (daily / story rung) that runs its clock out is
      // CLEARED, which is a different ending from running out of lives — the
      // distinction is the only thing that decides whether a story rung ticks.
      // A bounded shift that runs its clock out is CLEARED only if it hit the
      // level's target — that is what "#215: clear winning thresholds" means,
      // and for a story rung it is the difference between ticking it and not.
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

  const hist = cgLoadHistory(HR_HISTORY_KEY);
  const best = hist.reduce((m, r) => Math.max(m, r.score || 0), 0);
  const sheet = [
    cgLeaderboardSection('hashrush'),
    cgHistorySection(hist, r => <><span>{r.score} pts</span><span className="mono">{r.tokens} ⛏️ · {r.secs}s</span></>),
    cgStatsSection([
      { val: best, lbl: 'Best score' }, { val: hist.length, lbl: 'Runs' },
    ]),
    cgRulesSection([
      'Tap a falling ⛏️ hash to swing your hammer and mine it — 10 points each.',
      'Tap ⚡ lightning to ADD 5 seconds of 2× scoring. Bolts stack, so two in a row are worth twice one.',
      'Do NOT tap 🧨 TNT. Hitting one costs you 10 points — leave it to fall.',
      'A hash that reaches the floor un-mined costs a life. Run out and the shift ends.',
      'Daily and story shifts have a target score: reach it before the clock runs out to clear the shift.',
      'Keyboard: 1 / 2 / 3 (or ← ↓ →) swing at the lowest thing in that lane.',
    ]),
  ];

  return (
    <ClassicShell game={game} onExit={onBack} onNewGame={() => startGame()} sheetSections={sheet} menuConfig={menuConfig}>
      <div className="cg-stage">
        {/* The target is shown IN the score pill rather than beside it: what a
            player needs mid-strike is one glance that answers "am I going to
            clear this", and two pills to subtract is not that. */}
        <CgStatus items={[
          { l: target ? 'Score / target' : 'Score', v: target ? `${score} / ${target}` : score },
          { l: 'Lives', v: '❤️'.repeat(lives) || '—' },
          MODE.limit
            ? { l: 'Left', v: `${Math.floor(secsLeft / 60)}:${String(secsLeft % 60).padStart(2, '0')}` }
            : { l: 'Mult', v: '×' + mult },
        ]} />
        <div className="hr-wrap" ref={wrapRef} data-hr-phase={phase} data-hr-target={target}>
          <canvas ref={canvasRef} className="hr-canvas" />
          {boostLeft > 0 && phase === 'playing' && (
            <div className="hr-boost-badge">⚡ Boost {boostLeft}s</div>
          )}
          {phase === 'idle' && (
            <div className="hr-overlay">
              <div className="hr-overlay-title">⛏️ Hash Rush</div>
              <div className="hr-overlay-sub">
                {MODE.limit
                  ? `${MODE.label} — ${MODE.limit}s to mine ${target} points. Tap ⛏️ hashes and ⚡ lightning, leave 🧨 TNT alone.`
                  : 'Tap ⛏️ hashes to mine them and ⚡ lightning to stack your boost. Leave 🧨 TNT alone.'}
              </div>
              <button className="gm-play-btn" style={{ maxWidth: 200 }} onClick={startGame}>Start mining</button>
            </div>
          )}
        </div>
      </div>
    </ClassicShell>
  );
}
