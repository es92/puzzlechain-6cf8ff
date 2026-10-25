/* ============================================================
   Zuma — frog shooter (Classic, leaderboard)
   ============================================================ */
const ZUMA_W = 300, ZUMA_H = 400;
/* #212 — BIGGER MARBLES, and the number is measured rather than picked.
   ZUMA_DIAM is the chain's spacing, so raising the radius makes the CHAIN
   longer and it reaches the skull sooner: the size is a difficulty knob
   whether you meant it to be or not. Chain length as a share of its own track,
   at the old 11 and at 13:

     free L1  39% -> 46%    story 1  40% -> 47%    story 4  40% -> 46%
     free L2  51% -> 60%    story 2  47% -> 55%    story 5  35% -> 41%
     free L3  53% -> 62%    story 3  38% -> 44%    story 6  38% -> 45%

   The tightest board still starts with 38% of its track empty, so nothing
   becomes unwinnable — and the marble gains about 40% in area, which is the
   part a player notices. Re-measure (scratch script in the #212 notes) if the
   levels or the paths are ever retuned. */
const ZUMA_BALL_R = 13;
const ZUMA_DIAM = ZUMA_BALL_R * 2 + 2;
const ZUMA_SHOT_SPEED = 300;
const FROG_X = 150, FROG_Y = 218;
const ZUMA_COLORS_ALL = ['#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6'];

const ZUMA_STORY_BANDS = 6;
const ZUMA_PATH_S = [
  {x:28,y:32},{x:75,y:25},{x:135,y:22},{x:195,y:25},{x:250,y:34},
  {x:276,y:58},{x:278,y:100},{x:268,y:138},{x:245,y:162},
  {x:208,y:175},{x:165,y:180},{x:122,y:175},{x:82,y:162},
  {x:52,y:138},{x:28,y:108},{x:18,y:155},{x:22,y:195},
  {x:42,y:228},{x:78,y:248},{x:120,y:256},{x:162,y:258},
  {x:205,y:255},{x:245,y:242},{x:268,y:220},
  {x:274,y:268},{x:265,y:308},{x:242,y:338},{x:208,y:358},
  {x:170,y:370},{x:148,y:374},
];

const ZUMA_PATH_L3 = [
  {x:28,y:32},{x:75,y:25},{x:135,y:22},{x:195,y:25},{x:250,y:34},
  {x:276,y:58},{x:278,y:100},{x:268,y:138},{x:245,y:162},
  {x:208,y:175},{x:165,y:180},{x:122,y:175},{x:82,y:162},
  {x:52,y:138},{x:28,y:108},{x:18,y:155},{x:22,y:195},
  {x:42,y:228},{x:78,y:248},{x:120,y:256},{x:162,y:258},
  {x:205,y:255},{x:245,y:242},{x:268,y:220},
  {x:255,y:248},{x:225,y:262},{x:188,y:268},{x:150,y:270},
  {x:112,y:268},{x:78,y:260},{x:52,y:245},{x:32,y:270},
  {x:26,y:300},{x:32,y:328},{x:52,y:350},{x:88,y:368},
  {x:125,y:377},{x:148,y:380},
];

/* #176 — PROCEDURAL TRACKS. The path IS the level here, and there were two of
   them, hand-plotted waypoint by waypoint. Two tracks cannot carry a daily (it
   would be the same board twice a week), a 5-rung ladder, or endless arcade
   play, and hand-plotting more does not scale.

   So a track is generated from a seed as an INWARD SPIRAL: start on a wide
   ellipse and wind toward the middle, with the ellipse's aspect, tilt and a
   low-frequency radial wobble all drawn from the seed. That shape is the right
   one for this game for a structural reason — the frog sits at the centre, so
   a spiral keeps every part of the track roughly within shooting range, where
   an arbitrary squiggle would put stretches of it behind the frog's back or
   past the canvas edge. The two authored paths are themselves spirals; this
   generalises them rather than replacing them with something different.

   The track STOPS short of the centre (ZUMA_SPIRAL_R1), leaving the skull an
   arm's length from the frog: end it at the centre and the drain would sit
   under the frog itself. */
const ZUMA_SPIRAL_R0 = 168;   // outermost radius
const ZUMA_SPIRAL_R1 = 46;    // where the track drains
const ZUMA_CX = 150, ZUMA_CY = 196;
const ZUMA_STEP = 0.22;       // radians per sampled waypoint

function zumaGeneratePath(rng, loops) {
  const tilt = rng() * Math.PI * 2;
  const aspect = 0.72 + rng() * 0.30;        // ellipse squash
  const wobbleAmp = 6 + rng() * 12;          // radial wobble depth
  const wobbleFreq = 2 + Math.floor(rng() * 3);
  const wobblePhase = rng() * Math.PI * 2;
  const dir = rng() < 0.5 ? 1 : -1;          // clockwise or not
  const total = loops * Math.PI * 2;
  const pts = [];
  for (let a = 0; a <= total; a += ZUMA_STEP) {
    const t = a / total;
    const r = ZUMA_SPIRAL_R0 + (ZUMA_SPIRAL_R1 - ZUMA_SPIRAL_R0) * t
      + Math.sin(a * wobbleFreq + wobblePhase) * wobbleAmp * (1 - t);
    const ang = tilt + dir * a;
    const x = ZUMA_CX + Math.cos(ang) * r;
    const y = ZUMA_CY + Math.sin(ang) * r * aspect;
    // Keep the whole track on the canvas with a ball's clearance.
    pts.push({
      x: Math.max(ZUMA_BALL_R + 4, Math.min(ZUMA_W - ZUMA_BALL_R - 4, x)),
      y: Math.max(ZUMA_BALL_R + 4, Math.min(ZUMA_H - ZUMA_BALL_R - 4, y)),
    });
  }
  return pts;
}

/* A rung on the ladder. `rng` generates the track; the numbers that actually
   set the pressure — ball count, chain speed, colour count — scale with the
   band, and the spiral gains a loop as it climbs so a hard track is longer as
   well as faster. */
function zumaLevelForBand(band, bandCount, rng) {
  const t = bandCount > 1 ? band / (bandCount - 1) : 0;
  const r = rng || mulberry32(0x5eed ^ (band * 2654435761));
  return {
    path: zumaGeneratePath(r, 2 + Math.round(t * 2)),
    ballCount: Math.round(20 + 22 * t),
    speed: Math.round(9 + 20 * t),
    colors: t < 0.34 ? 4 : t < 0.75 ? 5 : 6,
  };
}

const ZUMA_LEVELS = [
  { path: ZUMA_PATH_S,  ballCount: 20, speed: 9,  colors: 4 },
  { path: ZUMA_PATH_S,  ballCount: 26, speed: 15, colors: 4 },
  { path: ZUMA_PATH_L3, ballCount: 32, speed: 23, colors: 5 },
];

function zumaComputePathData(waypoints) {
  const cumDists = [0];
  for (let i = 1; i < waypoints.length; i++) {
    const dx = waypoints[i].x - waypoints[i-1].x;
    const dy = waypoints[i].y - waypoints[i-1].y;
    cumDists.push(cumDists[i-1] + Math.hypot(dx, dy));
  }
  return { waypoints, cumDists, totalLen: cumDists[cumDists.length - 1] };
}

function zumaPointAtDist(pd, dist) {
  const { waypoints: wps, cumDists: cd } = pd;
  if (dist <= 0) return wps[0];
  const last = cd.length - 1;
  if (dist >= cd[last]) return wps[last];
  let lo = 0, hi = last - 1;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (cd[m+1] < dist) lo = m + 1; else hi = m;
  }
  const t = (dist - cd[lo]) / (cd[lo+1] - cd[lo]);
  return { x: wps[lo].x + t*(wps[lo+1].x - wps[lo].x), y: wps[lo].y + t*(wps[lo+1].y - wps[lo].y) };
}

/* `rng` is optional and defaults to Math.random — free play is supposed to
   differ every time. A daily passes the day's rng so the chain, the shot
   colours and the power-up drops are identical for everyone, which is the same
   rule Daily Bounce follows for its brick drops. */
function zumaBuildChain(count, numColors, rng) {
  const r = rng || Math.random;
  const balls = [];
  for (let i = 0; i < count; i++) {
    balls.push({ color: ZUMA_COLORS_ALL[Math.floor(r() * numColors)], dist: -i * ZUMA_DIAM });
  }
  return balls;
}

function zumaRandColor(numColors, rng) {
  return ZUMA_COLORS_ALL[Math.floor((rng || Math.random)() * numColors)];
}

/* #213 — THE CAMOUFLAGE MARBLE.

   A camouflage marble takes the colour of what it lands against, so it always
   makes a match if one is there to be made. It is granted for
   ZUMA_CAMO_STREAK shots in a row that popped something, sits on the cannon
   for ZUMA_CAMO_MS, and is spent by one shot.

   It also REPLACES the old 'color-switch' power-up's wildcard, which was
   broken: that one fired a ball coloured '#ffffff' and zumaCheckMatches
   compares colour strings exactly, so a white marble matched nothing and the
   "wildcard" was strictly worse than the marble it replaced. One wildcard
   rule, in one place, rather than two that disagree. */
const ZUMA_CAMO_STREAK = 5;
const ZUMA_CAMO_MS = 10000;

/* Which colour a camouflage marble resolves to once it has landed. Pure, and
   the only copy of the rule: it takes whichever neighbour gives the LONGER
   run, so a marble dropped between a pair and a single joins the pair. Ties go
   to the left, which is the side nearer the head of the chain and therefore
   the side under time pressure. `idx` is the marble's own index. */
function zumaWildColorAt(chain, idx) {
  if (!chain.length) return null;
  const runFrom = (start, step, color) => {
    let n = 0;
    for (let k = start; k >= 0 && k < chain.length; k += step) {
      if (chain[k].color !== color) break;
      n++;
    }
    return n;
  };
  const left = idx > 0 ? chain[idx - 1].color : null;
  const right = idx < chain.length - 1 ? chain[idx + 1].color : null;
  if (left === null && right === null) return null;
  let best = null, bestRun = -1;
  for (const c of [left, right]) {
    if (c === null) continue;
    const run = (idx > 0 ? runFrom(idx - 1, -1, c) : 0)
      + (idx < chain.length - 1 ? runFrom(idx + 1, 1, c) : 0);
    if (run > bestRun) { bestRun = run; best = c; }
  }
  return best;
}

/* A camouflage marble is drawn as a pie of the level's colours, so it reads as
   "any of these" at a glance rather than as a marble of some colour you have
   not seen before. Hardcoded canvas colours on purpose — these are the game's
   own marble colours, intrinsic art, not chrome that follows the theme. */
function zumaPaintCamo(ctx, x, y, r, numColors) {
  const n = Math.max(2, numColors || ZUMA_COLORS_ALL.length);
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, r, (i / n) * Math.PI * 2 - Math.PI / 2, ((i + 1) / n) * Math.PI * 2 - Math.PI / 2);
    ctx.closePath();
    ctx.fillStyle = ZUMA_COLORS_ALL[i % ZUMA_COLORS_ALL.length];
    ctx.fill();
  }
}

/* #212 — WHERE THE SHOT WOULD LAND.

   The trajectory guide has to stop somewhere honest, so it is computed rather
   than drawn as a fixed-length line: march the ray from the cannon and return
   the first chain marble it would touch, or the point where it leaves the
   board. Pure, so `marbleloop-aim` can hold it — and it is the same geometry
   the shot itself uses (a ball is hit when the centres are within 2R), so the
   line cannot promise a hit the shot does not make.

   The step is half a radius: fine enough not to tunnel through a marble,
   coarse enough that a full-length ray is a few dozen iterations. */
function zumaAimPath(chain, pd, ox, oy, angle, w, h) {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const step = ZUMA_BALL_R / 2;
  const maxSteps = Math.ceil((Math.max(w, h) * 1.5) / step);
  const r2 = (ZUMA_BALL_R * 2) * (ZUMA_BALL_R * 2);
  let x = ox, y = oy;
  for (let i = 1; i <= maxSteps; i++) {
    x = ox + dx * step * i;
    y = oy + dy * step * i;
    if (x < -ZUMA_BALL_R || x > w + ZUMA_BALL_R || y < -ZUMA_BALL_R || y > h + ZUMA_BALL_R) {
      return { x, y, hit: -1 };
    }
    if (pd) {
      for (let j = 0; j < chain.length; j++) {
        if (chain[j].dist < 0 || chain[j].dist > pd.totalLen) continue;
        const pt = zumaPointAtDist(pd, chain[j].dist);
        const ddx = x - pt.x, ddy = y - pt.y;
        if (ddx * ddx + ddy * ddy < r2) return { x: pt.x, y: pt.y, hit: j };
      }
    }
  }
  return { x, y, hit: -1 };
}

/* #212 — THE SUPPLY BOT.

   "Program the bot to supply the required colour matches when fewer than 5
   marbles remain." A chain that short can hold colours the cannon is no longer
   dealing, and then the level cannot be finished at all — you are left firing
   marbles that match nothing while the last few crawl to the skull. Below
   ZUMA_SUPPLY_AT the cannon deals only from what is actually still ON the
   chain, so every marble you are given is one that can clear something.

   It does NOT pick the best colour, only a possible one: which of the
   remaining colours to fire, and where, is still the player's problem. */
const ZUMA_SUPPLY_AT = 5;

function zumaSupplyColor(chain, numColors, rng) {
  const live = [];
  for (const b of chain) if (live.indexOf(b.color) === -1) live.push(b.color);
  if (!chain.length || chain.length >= ZUMA_SUPPLY_AT || !live.length) {
    return zumaRandColor(numColors, rng);
  }
  return live[Math.floor((rng || Math.random)() * live.length)];
}

function zumaCheckMatches(chain, idx) {
  if (chain.length === 0 || idx < 0 || idx >= chain.length) return 0;
  const color = chain[idx].color;
  let lo = idx, hi = idx;
  while (lo > 0 && chain[lo-1].color === color) lo--;
  while (hi < chain.length-1 && chain[hi+1].color === color) hi++;
  const runLen = hi - lo + 1;
  if (runLen < 3) return 0;
  chain.splice(lo, runLen);
  let extra = 0;
  if (lo > 0 && lo < chain.length) {
    const needed = chain[lo-1].dist - ZUMA_DIAM;
    const shift = needed - chain[lo].dist;
    if (shift > 1) {
      for (let i = lo; i < chain.length; i++) chain[i].dist += shift;
      if (chain[lo-1].color === chain[lo].color) extra += zumaCheckMatches(chain, lo);
    }
  }
  return runLen + extra;
}

function ZumaGame({ onWin, onLose, onStepChange, resetKey, playMode, band, offset }) {
  const { useState, useEffect, useRef } = React;
  /* #331 — the daily's band. Story/arcade carry numeric bands that can never
     equal these strings, so the gate is safe across modes. */
  const dailyBand = playMode === 'daily' && (band === 'easy' || band === 'hard') ? band : null;
  /* One level, chosen by mode. Story plays exactly its band and gets a track
     that is STABLE for that rung; the daily gives everyone the same mid-ladder
     track for the day; arcade maps its three difficulties onto the same ladder
     with a fresh track per run; free play keeps the original three-level run
     on the two authored tracks, untouched. */
  const modeLevels = useRef(null);
  const modeRngRef = useRef(null);
  if (!modeLevels.current && playMode && playMode !== 'free') {
    const { rng } = modeSeed(playMode, 'zuma', band, offset);
    modeRngRef.current = rng;
    let rung;
    if (playMode === 'story') rung = Math.max(0, band || 0);
    else if (playMode === 'arcade') {
      const i = Math.max(0, ARCADE_BANDS.findIndex(b => b.id === band));
      rung = Math.round((i / 2) * (ZUMA_STORY_BANDS - 1));
    } else {
      // Daily: Normal keeps the fixed mid-ladder rung, so the day is about the
      // track and the chain rather than about which difficulty you happened to
      // draw. #331 — Easy/Hard take the ladder's own ends (gentlest/hardest).
      rung = dailyBand === 'easy' ? 0
        : dailyBand === 'hard' ? ZUMA_STORY_BANDS - 1
        : Math.floor((ZUMA_STORY_BANDS - 1) / 2);
    }
    modeLevels.current = [zumaLevelForBand(rung, ZUMA_STORY_BANDS, rng)];
  }
  const LEVELS = modeLevels.current || ZUMA_LEVELS;
  /* The mode rng is consumed by generation AND by play (chain colours, shot
     colours, power-up drops). Everything downstream of generation therefore
     draws from a SECOND stream derived from the same seed, so that a run whose
     colours diverge cannot shift the track — and so that Marble Loop's daily
     really is byte-identical for two players, drops included. */
  const playRng = useRef(null);
  if (playMode && !playRng.current) {
    const { seed } = modeSeed(playMode, 'zuma', band, offset);
    /* modeSeed's daily branch hands back seed null (a non-null seed reads as
       "arcade board" downstream), so the play stream derives its own. Easy/
       Hard hash their own mixed deal; Normal keeps the pre-band derivation
       byte-for-byte. */
    const playSeed = dailyBand ? dailySeedFor(offset, 'zuma', dailyBand)
      : (seed == null ? dailyRng(offset, 'zuma')() * 4294967295 : seed);
    playRng.current = mulberry32((playSeed ^ 0x9e3779b9) >>> 0);
  }
  const prand = () => (playRng.current ? playRng.current() : Math.random());
  const [activeTab, setActiveTab] = useState('game');
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(1);
  const [ballsPopped, setBallsPopped] = useState(0);
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [activePowerups, setActivePowerups] = useState([]);
  const [lb, setLb] = useState(null);
  const [lbLoading, setLbLoading] = useState(false);
  const [lbError, setLbError] = useState(false);

  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const elapsedRef = useRef(0);
  const startedRef = useRef(false);
  const doneRef = useRef(false);
  const submittedRef = useRef(false);
  const levelRef = useRef(1);
  const scoreRef = useRef(0);
  const bpRef = useRef(0);
  const chainRef = useRef([]);
  const shotRef = useRef(null);
  const frogAngleRef = useRef(-Math.PI / 2);
  /* #212 — A TAP AIMS; THE NEXT ONE FIRES.

     A tap used to fire immediately at wherever the finger landed, which on a
     phone means you find out where you were aiming by watching the marble go
     there. Same shape as the answer Gomoku already uses for a board too dense
     to poke at: show the intent, then confirm it. A tap that points somewhere
     materially different from the current aim RE-AIMS instead of firing
     (ZUMA_REAIM_RAD), so correcting yourself never costs a marble.

     The MOUSE keeps its old behaviour, because hovering already shows the aim
     continuously — on that input the hover IS the first tap. `aimed` exists
     only so the guide can be drawn once an aim has actually been taken rather
     than sitting on screen from the first frame. */
  const aimedRef = useRef(false);
  const [aimed, setAimed] = useState(false);
  const ZUMA_REAIM_RAD = 0.12;
  const curColorRef = useRef(ZUMA_COLORS_ALL[0]);
  const nxtColorRef = useRef(ZUMA_COLORS_ALL[1]);
  const pathDataRef = useRef(null);
  const powerUpsRef = useRef([]);
  const activePowerupsRef = useRef([]);
  const baseShotSpeedRef = useRef(ZUMA_SHOT_SPEED);
  const wildColorLoadedRef = useRef(0);
  // #213 — consecutive popping shots, and the deadline on the camouflage
  // marble they earn. 0 means no camouflage marble is loaded.
  const comboRef = useRef(0);
  const camoUntilRef = useRef(0);
  const [camoLeft, setCamoLeft] = useState(0);
  // Mirrors camoLeft so the frame loop can tell whether the displayed second
  // actually changed — setting state every frame would re-render 60 times a
  // second for a number that moves once.
  const camoLeftRef = useRef(0);
  const chainClearLoadedRef = useRef(0);
  const onWinRef = useRef(onWin); onWinRef.current = onWin;
  const onLoseRef = useRef(onLose); onLoseRef.current = onLose;
  const onStepRef = useRef(onStepChange); onStepRef.current = onStepChange;

  function initLevel(lvlNum) {
    const lvl = LEVELS[Math.min(lvlNum, LEVELS.length) - 1];
    pathDataRef.current = zumaComputePathData(lvl.path);
    chainRef.current = zumaBuildChain(lvl.ballCount, lvl.colors, playMode ? prand : null);
    curColorRef.current = zumaRandColor(lvl.colors, playMode ? prand : null);
    nxtColorRef.current = zumaRandColor(lvl.colors, playMode ? prand : null);
    shotRef.current = null;
  }

  function init() {
    levelRef.current = 1;
    scoreRef.current = 0;
    bpRef.current = 0;
    elapsedRef.current = 0;
    startedRef.current = false;
    doneRef.current = false;
    submittedRef.current = false;
    powerUpsRef.current = [];
    activePowerupsRef.current = [];
    wildColorLoadedRef.current = 0;
    chainClearLoadedRef.current = 0;
    comboRef.current = 0;
    camoUntilRef.current = 0;
    camoLeftRef.current = 0;
    setCamoLeft(0);
    initLevel(1);
    setScore(0); setLevel(1); setBallsPopped(0);
    setStarted(false); setDone(false); setElapsedSecs(0); setActivePowerups([]);
  }

  useEffect(() => { init(); }, [resetKey]);

  useEffect(() => {
    if (!started || done) return;
    const id = setInterval(() => { elapsedRef.current++; setElapsedSecs(elapsedRef.current); }, 1000);
    return () => clearInterval(id);
  }, [started, done]);

  const submitScore = async (finalScore, finalLevel) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    try {
      await api('/api/zuma/score', {
        method: 'POST',
        body: JSON.stringify({ score: finalScore, level: finalLevel, timeSecs: elapsedRef.current }),
      });
    } catch (_) {}
  };

  function triggerEnd(cleared) {
    if (doneRef.current) return;
    doneRef.current = true;
    setDone(true);
    const s = scoreRef.current;
    const bp = bpRef.current;
    const secs = elapsedRef.current;
    const lv = levelRef.current;
    // Free play and arcade post to the classic board; a story rung and a daily
    // settle on their own endpoints and must not also appear there.
    if (!playMode || playMode === 'arcade') submitScore(s, lv);
    reportRunEnd(
      { cleared, playMode, onWin: onWinRef.current, onLose: onLoseRef.current },
      s, bp, secs,
      {
        winnerLabel: cleared ? 'Cleared! 🎉' : 'Game Over',
        share: cleared
          ? '🐸 Marble Loop — ' + s + ' pts, track cleared!'
          : '🐸 Marble Loop — ' + s + ' pts, level ' + lv,
      }
    );
  }

  const loopRunning = activeTab === 'game' && !done;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = canvasDpr();
    canvas.width = Math.round(ZUMA_W * dpr);
    canvas.height = Math.round(ZUMA_H * dpr);

    function drawFrame() {
      const ctx = guardCanvasCtx(canvas.getContext('2d'));
      // The level being drawn — the camouflage marble is painted from its
      // colour count, so it shows only the colours this level actually deals.
      const lvNow = LEVELS[Math.min(levelRef.current, LEVELS.length) - 1];
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = PAL.bg;
      ctx.fillRect(0, 0, ZUMA_W, ZUMA_H);

      const pd = pathDataRef.current;
      if (pd) {
        // Track outer
        ctx.beginPath();
        ctx.moveTo(pd.waypoints[0].x, pd.waypoints[0].y);
        for (let i = 1; i < pd.waypoints.length; i++) ctx.lineTo(pd.waypoints[i].x, pd.waypoints[i].y);
        ctx.strokeStyle = '#1e3a5f';
        ctx.lineWidth = ZUMA_BALL_R * 2 + 6;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.stroke();
        // Track inner
        ctx.beginPath();
        ctx.moveTo(pd.waypoints[0].x, pd.waypoints[0].y);
        for (let i = 1; i < pd.waypoints.length; i++) ctx.lineTo(pd.waypoints[i].x, pd.waypoints[i].y);
        ctx.strokeStyle = '#0e1f33';
        ctx.lineWidth = ZUMA_BALL_R * 2 - 2;
        ctx.stroke();
        // Entry marker
        const entry = pd.waypoints[0];
        ctx.beginPath(); ctx.arc(entry.x, entry.y, 8, 0, Math.PI*2);
        ctx.fillStyle = '#334155'; ctx.fill();
        // Chain balls (back to front — lower dist first)
        const chain = chainRef.current;
        for (let i = chain.length - 1; i >= 0; i--) {
          const ball = chain[i];
          if (ball.dist < 0 || ball.dist > pd.totalLen) continue;
          const pt = zumaPointAtDist(pd, ball.dist);
          ctx.beginPath(); ctx.arc(pt.x, pt.y, ZUMA_BALL_R, 0, Math.PI*2);
          ctx.fillStyle = ball.color; ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1.5; ctx.stroke();
          ctx.beginPath(); ctx.arc(pt.x-3, pt.y-3, 4, 0, Math.PI*2);
          ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fill();
        }
        // Power-ups in flight
        for (let i = 0; i < powerUpsRef.current.length; i++) {
          const pu = powerUpsRef.current[i];
          ctx.save();
          ctx.translate(pu.x, pu.y);
          const rotation = ((Date.now() - pu.spawnedAt) / 100) % (Math.PI * 2);
          ctx.rotate(rotation);
          ctx.font = '20px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(POWERUP_ICONS[pu.type], 0, 0);
          ctx.restore();
          ctx.fillStyle = 'rgba(0,0,0,0.2)';
          ctx.beginPath();
          ctx.ellipse(pu.x, pu.y + pu.radius + 3, pu.radius * 0.7, pu.radius * 0.3, 0, 0, Math.PI * 2);
          ctx.fill();
        }

        // Shot ball
        const sh = shotRef.current;
        if (sh) {
          if (sh.wild) {
            zumaPaintCamo(ctx, sh.x, sh.y, ZUMA_BALL_R, lvNow.colors);
          } else {
            ctx.beginPath(); ctx.arc(sh.x, sh.y, ZUMA_BALL_R, 0, Math.PI*2);
            ctx.fillStyle = sh.color; ctx.fill();
          }
          ctx.beginPath(); ctx.arc(sh.x, sh.y, ZUMA_BALL_R, 0, Math.PI*2);
          ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1.5; ctx.stroke();
          ctx.beginPath(); ctx.arc(sh.x-3, sh.y-3, 4, 0, Math.PI*2);
          ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fill();
        }
        // Skull at path end
        const skull = pd.waypoints[pd.waypoints.length - 1];
        ctx.font = '20px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('💀', skull.x, skull.y);
      }

      // Frog shadow
      ctx.beginPath(); ctx.arc(FROG_X+2, FROG_Y+2, 18, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
      // Frog body
      ctx.beginPath(); ctx.arc(FROG_X, FROG_Y, 18, 0, Math.PI*2);
      ctx.fillStyle = '#059669'; ctx.fill();
      ctx.strokeStyle = '#064e3b'; ctx.lineWidth = 2; ctx.stroke();
      // Eyes
      const angle = frogAngleRef.current;
      const ex = Math.cos(angle-0.5)*10+FROG_X, ey = Math.sin(angle-0.5)*10+FROG_Y;
      const ex2 = Math.cos(angle+0.5)*10+FROG_X, ey2 = Math.sin(angle+0.5)*10+FROG_Y;
      ctx.beginPath(); ctx.arc(ex, ey, 3.5, 0, Math.PI*2); ctx.fillStyle='#fff'; ctx.fill();
      ctx.beginPath(); ctx.arc(ex+Math.cos(angle), ey+Math.sin(angle), 2, 0, Math.PI*2); ctx.fillStyle='#111'; ctx.fill();
      ctx.beginPath(); ctx.arc(ex2, ey2, 3.5, 0, Math.PI*2); ctx.fillStyle='#fff'; ctx.fill();
      ctx.beginPath(); ctx.arc(ex2+Math.cos(angle), ey2+Math.sin(angle), 2, 0, Math.PI*2); ctx.fillStyle='#111'; ctx.fill();
      // Ball loaded in frog — the camouflage marble sits ON TOP of it while it
      // lasts, which is why firing one does not consume the queue.
      if (camoUntilRef.current > Date.now()) {
        zumaPaintCamo(ctx, FROG_X, FROG_Y, 9, lvNow.colors);
        ctx.beginPath(); ctx.arc(FROG_X, FROG_Y, 9, 0, Math.PI*2);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(FROG_X, FROG_Y, 8, 0, Math.PI*2);
        ctx.fillStyle = curColorRef.current; ctx.fill();
      }
      /* #212 — THE TRAJECTORY GUIDE. Drawn only once an aim has been TAKEN, so
         it is the answer to "where will this go" rather than permanent chrome,
         and it ends where the shot would actually land — zumaAimPath walks the
         same 2R test the collision uses, so the line cannot promise a hit the
         marble does not make. A marker sits on the marble it would strike; a
         shot that hits nothing simply runs off the board.

         Hardcoded white, like the rest of the frog: intrinsic game art, not
         chrome, so it does not follow the theme. */
      if (aimedRef.current && !shotRef.current && !doneRef.current) {
        const aim = zumaAimPath(chainRef.current, pathDataRef.current,
          FROG_X, FROG_Y, angle, ZUMA_W, ZUMA_H);
        ctx.save();
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(FROG_X + Math.cos(angle) * 22, FROG_Y + Math.sin(angle) * 22);
        ctx.lineTo(aim.x, aim.y);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
        if (aim.hit >= 0) {
          ctx.beginPath();
          ctx.arc(aim.x, aim.y, ZUMA_BALL_R + 3, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255,255,255,0.85)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.restore();
      }
      // Aim pointer
      ctx.beginPath();
      ctx.moveTo(FROG_X+Math.cos(angle)*20, FROG_Y+Math.sin(angle)*20);
      ctx.lineTo(FROG_X+Math.cos(angle)*32, FROG_Y+Math.sin(angle)*32);
      ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 3; ctx.stroke();
      // Next ball preview
      const nx = FROG_X+Math.cos(angle+Math.PI)*30, ny = FROG_Y+Math.sin(angle+Math.PI)*30;
      ctx.beginPath(); ctx.arc(nx, ny, 7, 0, Math.PI*2);
      ctx.fillStyle = nxtColorRef.current; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth=1.5; ctx.stroke();
      ctx.font='8px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillStyle='rgba(255,255,255,0.5)'; ctx.fillText('next', nx, ny);

      // Start overlay
      if (!startedRef.current && !doneRef.current) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, ZUMA_W, ZUMA_H);
        ctx.font = 'bold 16px "Space Grotesk",system-ui,sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#e2e8f0'; ctx.fillText('Tap to aim, tap again to fire', ZUMA_W/2, ZUMA_H/2);
        ctx.font = '13px "Space Grotesk",system-ui,sans-serif';
        ctx.fillStyle = '#64748b'; ctx.fillText('The dotted line shows where it lands', ZUMA_W/2, ZUMA_H/2+24);
      }
      ctx.restore();
    }

    if (!loopRunning) { drawFrame(); return; }

    let alive = true, lastTs = null;
    const loop = (ts) => {
      if (!alive) return;
      rafRef.current = requestAnimationFrame(loop);
      if (!lastTs) { lastTs = ts; drawFrame(); return; }
      const dt = Math.min((ts - lastTs) / 1000, 0.05);
      lastTs = ts;

      const chain = chainRef.current;
      const pd = pathDataRef.current;
      const lv = LEVELS[Math.min(levelRef.current, LEVELS.length) - 1];

      // Advance chain
      for (let i = 0; i < chain.length; i++) chain[i].dist += lv.speed * dt;

      // Game over: front ball crossed the skull
      if (chain.length > 0 && chain[0].dist >= pd.totalLen) {
        triggerEnd(false); drawFrame(); return;
      }

      // Level cleared: chain empty and no shot in flight
      if (chain.length === 0 && !shotRef.current) {
        scoreRef.current += 500 * levelRef.current;
        setScore(scoreRef.current);
        if (levelRef.current >= LEVELS.length) { triggerEnd(true); drawFrame(); return; }
        levelRef.current++;
        setLevel(levelRef.current);
        initLevel(levelRef.current);
        drawFrame(); return;
      }

      // Update power-ups and handle frog collision
      const now = Date.now();
      for (let i = powerUpsRef.current.length - 1; i >= 0; i--) {
        const pu = powerUpsRef.current[i];
        updatePowerup(pu, dt);
        if (!pu.caught && Math.hypot(pu.x - FROG_X, pu.y - FROG_Y) < POWERUP_RADIUS + 18) {
          pu.caught = true;
          const existing = activePowerupsRef.current.find(p => p.type === pu.type);
          if (existing) {
            existing.stacks += 1;
            existing.startedAt = now;
          } else {
            activePowerupsRef.current.push({ type: pu.type, startedAt: now, stacks: 1 });
          }
          if (pu.type === 'chain-clear') chainClearLoadedRef.current = existing ? existing.stacks : 1;
          // #213 — the colour-switch power-up grants the same camouflage
          // marble the match streak does, instead of the white ball that
          // matched nothing.
          if (pu.type === 'color-switch') camoUntilRef.current = now + ZUMA_CAMO_MS;
          setActivePowerups([...activePowerupsRef.current]);
          powerUpsRef.current.splice(i, 1);
        } else if (pu.y > ZUMA_H + 50) {
          powerUpsRef.current.splice(i, 1);
        }
      }
      const camoSecs = camoUntilRef.current > now
        ? Math.ceil((camoUntilRef.current - now) / 1000) : 0;
      if (camoSecs !== camoLeftRef.current) {
        camoLeftRef.current = camoSecs;
        setCamoLeft(camoSecs);
      }
      for (let i = activePowerupsRef.current.length - 1; i >= 0; i--) {
        const ap = activePowerupsRef.current[i];
        if (now - ap.startedAt > POWERUP_DURATION_MS) {
          if (ap.type === 'chain-clear') chainClearLoadedRef.current = 0;
          if (ap.type === 'color-switch') { /* the camouflage marble times out on its own */ }
          activePowerupsRef.current.splice(i, 1);
        }
      }

      // Update baseShotSpeed for faster-shot power-up
      const fasterPower = activePowerupsRef.current.find(p => p.type === 'faster-shot');
      if (fasterPower) {
        baseShotSpeedRef.current = ZUMA_SHOT_SPEED * Math.pow(1.4, fasterPower.stacks);
      } else {
        baseShotSpeedRef.current = ZUMA_SHOT_SPEED;
      }

      // Advance shot ball
      if (shotRef.current) {
        const sh = shotRef.current;
        sh.x += sh.vx * dt; sh.y += sh.vy * dt;
        if (sh.x < -20 || sh.x > ZUMA_W+20 || sh.y < -20 || sh.y > ZUMA_H+20) {
          shotRef.current = null;
        } else {
          for (let i = 0; i < chain.length; i++) {
            if (chain[i].dist < 0) continue;
            const pt = zumaPointAtDist(pd, chain[i].dist);
            const dx = sh.x - pt.x, dy = sh.y - pt.y;
            if (dx*dx + dy*dy < (ZUMA_BALL_R*2)*(ZUMA_BALL_R*2)) {
              if (chainClearLoadedRef.current > 0) {
                chain.length = 0;
                chainClearLoadedRef.current = 0;
              } else {
                chain.splice(i+1, 0, { color: sh.color, dist: chain[i].dist - ZUMA_DIAM });
                for (let j = i+2; j < chain.length; j++) {
                  const needed = chain[j-1].dist - ZUMA_DIAM;
                  if (chain[j].dist > needed) chain[j].dist = needed; else break;
                }
                /* A camouflage marble decides its colour HERE, from where it
                   actually landed — that is the whole mechanic, and it is why
                   the old white marble did nothing: the colour has to become a
                   real one before zumaCheckMatches compares it. */
                if (sh.wild) {
                  const c = zumaWildColorAt(chain, i+1);
                  if (c) chain[i+1].color = c;
                }
                const p = zumaCheckMatches(chain, i+1);
                if (p > 0) {
                  const bonus = p >= 6 ? (p-5)*50 : 0;
                  scoreRef.current += p*10 + bonus;
                  bpRef.current += p;
                  setScore(scoreRef.current);
                  setBallsPopped(bpRef.current);
                  onStepRef.current && onStepRef.current(bpRef.current);
                  /* The streak is what earns a camouflage marble: a run of
                     shots that each popped something. A shot that pops nothing
                     ends it, so the reward is for reading the chain rather
                     than for firing quickly. */
                  comboRef.current += 1;
                  if (comboRef.current >= ZUMA_CAMO_STREAK) {
                    comboRef.current = 0;
                    camoUntilRef.current = Date.now() + ZUMA_CAMO_MS;
                  }
                } else {
                  comboRef.current = 0;
                }
              }
              if (prand() < POWERUP_SPAWN_RATE) {
                const pt = zumaPointAtDist(pd, chain[i] ? chain[i].dist : chain[chain.length - 1] ? chain[chain.length - 1].dist : 0);
                powerUpsRef.current.push(spawnPowerup(pt.x, pt.y, POWERUP_TYPES.zuma));
              }
              shotRef.current = null;
              break;
            }
          }
        }
      }
      drawFrame();
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { alive = false; if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [loopRunning, resetKey]);

  /* The branch has to test LENGTH, not existence — #208's rule, and this file
     had the old version. `e.touches` on a TouchEvent is always a TouchList and
     a TouchList is an object, so `e.touches ? …` is true even when it is
     EMPTY, which is exactly what touchend carries: the finger that just lifted
     is in `changedTouches`. Reading touches[0].clientX there throws. Nothing
     hit it before because touchend was only ever used as a bare "fire" signal
     and never asked where the finger was; #212's aim-on-tap asks. */
  const getCanvasCoords = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    const sx = ZUMA_W / rect.width, sy = ZUMA_H / rect.height;
    const p = (e.changedTouches && e.changedTouches.length) ? e.changedTouches[0]
      : (e.touches && e.touches.length) ? e.touches[0] : e;
    return { x: (p.clientX - rect.left)*sx, y: (p.clientY - rect.top)*sy };
  };

  const updateAim = e => {
    const c = canvasRef.current; if (!c) return;
    const { x, y } = getCanvasCoords(e, c);
    frogAngleRef.current = Math.atan2(y - FROG_Y, x - FROG_X);
  };

  /* A TOUCH tap aims; the next one fires. Re-aiming is free: if the tap points
     somewhere materially different from the current aim it just moves the aim,
     so correcting yourself never costs a marble. */
  const touchAimOrFire = (e) => {
    const c = canvasRef.current; if (!c) return;
    if (doneRef.current || shotRef.current) return;
    const { x, y } = getCanvasCoords(e, c);
    const a = Math.atan2(y - FROG_Y, x - FROG_X);
    let d = Math.abs(a - frogAngleRef.current) % (Math.PI * 2);
    if (d > Math.PI) d = Math.PI * 2 - d;
    if (aimedRef.current && d <= ZUMA_REAIM_RAD) { shoot(); return; }
    frogAngleRef.current = a;
    aimedRef.current = true;
    setAimed(true);
    cgSound('move');
  };

  const shoot = () => {
    if (doneRef.current || shotRef.current) return;
    if (!startedRef.current) { startedRef.current = true; setStarted(true); }
    const lv = LEVELS[Math.min(levelRef.current, LEVELS.length) - 1];
    const angle = frogAngleRef.current;
    const fasterPower = activePowerupsRef.current.find(p => p.type === 'faster-shot');
    const currentSpeed = fasterPower ? ZUMA_SHOT_SPEED * Math.pow(1.4, fasterPower.stacks) : ZUMA_SHOT_SPEED;

    /* A camouflage marble is spent by one shot and does NOT consume the queue:
       it sits on top of the marble you already had, so firing it leaves that
       one still loaded. Its colour is decided where it LANDS, not here. */
    const wild = camoUntilRef.current > Date.now();
    if (wild) { camoUntilRef.current = 0; camoLeftRef.current = 0; setCamoLeft(0); }

    shotRef.current = {
      x: FROG_X + Math.cos(angle)*20, y: FROG_Y + Math.sin(angle)*20,
      vx: Math.cos(angle)*currentSpeed, vy: Math.sin(angle)*currentSpeed,
      color: curColorRef.current,
      wild,
    };
    if (!wild) {
      curColorRef.current = nxtColorRef.current;
      // #212 — below ZUMA_SUPPLY_AT the cannon deals only colours still on the
      // chain, so the last few marbles are always clearable.
      nxtColorRef.current = zumaSupplyColor(chainRef.current, lv.colors, playMode ? prand : null);
    }
    aimedRef.current = false;
    setAimed(false);
  };

  /* `?zcamo=1` — load a camouflage marble at mount. It is drawn on the cannon
     and counted down in the HUD, and both are otherwise reachable only by
     popping five shots in a row, which neither a proposal check nor a
     screenshot can do. Writes nothing: it sets a deadline on a ref, exactly
     what the fifth pop would have set. Same role as ?cwtype= and ?sdk=9. */
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('zcamo') !== '1') return;
    camoUntilRef.current = Date.now() + ZUMA_CAMO_MS;
    camoLeftRef.current = Math.ceil(ZUMA_CAMO_MS / 1000);
    setCamoLeft(camoLeftRef.current);
  }, []);

  /* TOUCH IS BOUND NATIVELY, not through React's onTouch* props.

     Two reasons, and the second is the one that matters. React 18 registers
     touchmove on the ROOT as a PASSIVE listener, so an e.preventDefault()
     inside an onTouchMove prop does nothing at all — the board was relying on
     `.zuma-canvas { touch-action: none }` for that and calling preventDefault
     into the void. And a listener on the element itself is one a test can
     drive, which matters here because #212 makes touch behave DIFFERENTLY from
     the mouse (aim, then fire) and that difference is the whole change. */
  const touchApiRef = useRef({});
  touchApiRef.current = { updateAim, touchAimOrFire, setAimed };
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onMove = (e) => {
      e.preventDefault();
      touchApiRef.current.updateAim(e);
      aimedRef.current = true;
      touchApiRef.current.setAimed(true);
    };
    const onEnd = (e) => { e.preventDefault(); touchApiRef.current.touchAimOrFire(e); };
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: false });
    return () => {
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
    };
  }, [activeTab]);

  const loadLeaderboard = async () => {
    setLbLoading(true); setLbError(false);
    const { ok, body } = await api('/api/zuma/leaderboard');
    if (ok && body) setLb(body); else setLbError(true);
    setLbLoading(false);
  };

  const fmtS = s => String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');

  return (
    React.createElement('div', null,
      activeTab === 'game' && React.createElement('div', null,
        React.createElement(CuiBar, { height: 68, build: (W) => {
          const pr = cuiRow(0, 0, W, 46, 4);
          const out = [
            { id: 'p-score', kind: 'pill', r: pr[0], label: 'Score', value: score.toLocaleString() },
            { id: 'p-level', kind: 'pill', r: pr[1], label: 'Level', value: level + '/3' },
            { id: 'p-popped', kind: 'pill', r: pr[2], label: 'Popped', value: ballsPopped },
            { id: 'p-time', kind: 'pill', r: pr[3], label: 'Time', value: fmtS(elapsedSecs), gold: true },
          ];
          const now = Date.now();
          const notes = activePowerups.map((ap) => {
            const remaining = Math.max(0, Math.ceil((POWERUP_DURATION_MS - (now - ap.startedAt)) / 1000));
            return POWERUP_ICONS[ap.type] + ' ' + remaining + 's' + (ap.stacks > 1 ? ' ×' + ap.stacks : '');
          });
          // #213 — the camouflage marble is on a clock, so it has to say so.
          // It is drawn on the cannon as well; the line is what makes the time
          // left readable without staring at the marble.
          if (camoLeft > 0) notes.unshift('🌈 Camouflage ' + camoLeft + 's');
          if (notes.length) {
            out.push({
              id: 'powerups', kind: 'label', r: [0, 50, W, 20], font: 12, color: PAL.emerald,
              label: notes.join(' · '),
            });
          }
          return out;
        } }),
        React.createElement('div', { className: 'zuma-wrap' },
          React.createElement('canvas', {
            ref: canvasRef,
            className: 'zuma-canvas',
            onMouseMove: e => { updateAim(e); aimedRef.current = true; if (!aimed) setAimed(true); },
            onClick: e => { updateAim(e); shoot(); },
          })
        ),
        React.createElement(CuiBar, { height: 44, build: (W) => ([
          { id: 'new', kind: 'button', r: [Math.floor(W * 0.3), 0, Math.floor(W * 0.4), 40], label: '↺ New Game', action: () => init() },
        ]) })
      ),
      activeTab === 'leaderboard' && React.createElement('div', null,
        lbLoading && React.createElement('div', { className: 'snake-lb-empty' }, 'Loading…'),
        !lbLoading && lbError && React.createElement('div', { className: 'snake-lb-empty' }, 'Leaderboard unavailable — score saved locally.'),
        !lbLoading && !lbError && lb && (() => {
          const top = lb.top || [], me = lb.me || null;
          const meInTop = me && top.some(r => r.rank === me.rank);
          if (!top.length) return React.createElement('div', { className: 'snake-lb-empty' }, 'No scores yet — be the first!');
          return React.createElement('div', { className: 'snake-lb-list' },
            top.map(r =>
              React.createElement('div', { key: r.rank, className: 'snake-lb-row' + (me && r.rank === me.rank ? ' snake-lb-me' : '') },
                React.createElement('span', { className: 'snake-lb-rank' }, '#' + r.rank),
                React.createElement('span', { className: 'snake-lb-name' }, r.username || 'anon'),
                React.createElement('span', { className: 'snake-lb-score' }, Number(r.bestScore).toLocaleString())
              )
            ),
            me && !meInTop && React.createElement('div', null,
              React.createElement('div', { className: 'snake-lb-divider' }, '···'),
              React.createElement('div', { className: 'snake-lb-row snake-lb-me' },
                React.createElement('span', { className: 'snake-lb-rank' }, '#' + me.rank),
                React.createElement('span', { className: 'snake-lb-name' }, me.username || 'You'),
                React.createElement('span', { className: 'snake-lb-score' }, Number(me.bestScore).toLocaleString())
              )
            )
          );
        })()
      ),
      React.createElement('div', { className: 't2048-bottom-nav safe-bottom' },
        ['game', 'leaderboard'].map(tab =>
          React.createElement('button', {
            key: tab,
            className: 't2048-tab' + (activeTab === tab ? ' active' : ''),
            onClick: () => { setActiveTab(tab); if (tab === 'leaderboard') loadLeaderboard(); },
          }, tab.charAt(0).toUpperCase() + tab.slice(1))
        )
      )
    )
  );
}

// ---- Match-3 Campaign Game ----
/* Match 3's tile board as a canvas (#170 treatment). Self-contained because
   the game has campaign/loading phases — usePointerCell binds on mount, so
   the canvas must exist when the hooks run. Tile palette/icons stay the
   intrinsic M3 set; removed tiles keep their ✓ ghost. */
function M3BoardCanvas({ tiles, bar, done, onTile }) {
  const M3_ICONS = ['🔴', '🟠', '🟢', '🔵', '🟣'];
  const M3_HEX = ['#CD4B3A', '#C9A227', '#2D9F66', '#3A6ECD', '#7C5CD6'];
  const cols = 5;
  const rows = Math.max(1, Math.ceil(tiles.length / cols));
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const { cell } = useFitBox(boxRef, { cols, rows, minCell: 40, maxCell: 76, gap: 5 });
  const step = cell + 5;
  const bw = step * cols - 5, bh = step * rows - 5;
  const liveRef = useRef({});
  liveRef.current = { tiles, done, step };
  usePointerCell(canvasRef, {
    onTap: (p) => {
      const lv = liveRef.current;
      if (lv.done) return;
      const c = Math.floor(p.x / lv.step), r = Math.floor(p.y / lv.step);
      if (c < 0 || c >= cols || r < 0 || r >= rows) return;
      const t = lv.tiles[r * cols + c];
      if (t && !t.removed) onTile(t.id);
    },
  });
  // The tray band draws under the board (controls wave) — same canvas.
  const TRAY_H = 54, TRAY_GAP = 8;
  const barFull = bar.length >= 6;
  useCanvasBoard(canvasRef, {
    width: bw,
    height: bh + TRAY_GAP + TRAY_H,
    deps: [tiles, bar, done, cell],
    draw: (ctx) => {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];
        const r = Math.floor(i / cols), c = i % cols;
        const x = c * step, y = r * step;
        const inBar = bar.indexOf(t.id) >= 0;
        klRR(ctx, x, y, cell, cell, 10);
        ctx.fillStyle = t.removed ? PAL.surface : M3_HEX[t.type % 5];
        ctx.fill();
        ctx.lineWidth = inBar ? 2.5 : 1;
        ctx.strokeStyle = inBar ? PAL.accent : PAL.border;
        ctx.stroke();
        ctx.font = `${Math.round(cell * 0.5)}px system-ui, sans-serif`;
        if (t.removed) {
          ctx.fillStyle = PAL.muted;
          ctx.fillText('✓', x + cell / 2, y + cell / 2 + 1);
        } else {
          ctx.fillText(M3_ICONS[t.type % 5], x + cell / 2, y + cell / 2 + 1);
        }
      }
      // Tray strip.
      const ty = bh + TRAY_GAP;
      klRR(ctx, 0, ty, bw, TRAY_H, 10);
      ctx.fillStyle = PAL.card;
      ctx.fill();
      ctx.lineWidth = barFull ? 2 : 1;
      ctx.strokeStyle = barFull ? PAL.rose : PAL.border;
      ctx.stroke();
      ctx.font = '600 9px ' + CUI_FONT;
      ctx.fillStyle = barFull ? PAL.rose : PAL.muted;
      ctx.fillText('TRAY', 22, ty + TRAY_H / 2 + 0.5);
      if (bar.length === 0) {
        ctx.font = '500 11px ' + CUI_FONT;
        ctx.fillStyle = PAL.muted;
        ctx.fillText('Match three of a kind to clear them', bw / 2 + 10, ty + TRAY_H / 2 + 0.5);
      } else {
        const u = Math.min(38, Math.floor((bw - 50) / 6) - 6);
        bar.forEach((id, k) => {
          const t = tiles.find((tile) => tile.id === id);
          if (!t) return;
          const x = 44 + k * (u + 6);
          klRR(ctx, x, ty + (TRAY_H - u) / 2, u, u, 8);
          ctx.fillStyle = M3_HEX[t.type % 5];
          ctx.fill();
          ctx.font = `${Math.round(u * 0.55)}px system-ui, sans-serif`;
          ctx.fillText(M3_ICONS[t.type % 5], x + u / 2, ty + TRAY_H / 2 + 1);
        });
      }
    },
  });
  return (
    <div className="m3-grid" ref={boxRef}>
      <canvas
        ref={canvasRef}
        className="m3-canvas board-canvas"
        role="grid"
        aria-label={`Match 3 board — ${tiles.filter((t) => !t.removed).length} tiles left, ${bar.length} in tray`}
      />
    </div>
  );
}

/* ---- Match 3 deal + scoring (#214) -------------------------------------
   Three things were wrong at once and each on its own made the game
   unfinishable.

   THE BOARD. The deal was `layers * 5` tiles typed `i % 5`, i.e. exactly
   `layers` copies of each of the five types — and a match needs THREE of a
   type. Twenty-four of the fifty puzzles are `layers: 2`, so they put TWO of
   each type on the board and contained no possible match whatsoever: every tap
   grew the tray and the only reachable ending was filling it to seven and
   losing. Where matches did exist the ceiling was 300 x 5 x floor(layers / 3),
   which is 1500 for every layers-3-to-5 board, against authored targets of
   1200 to 7200. (It also made each of the five board columns a single colour,
   because the column index and the type were both `i % 5`.)

   Deal in TRIPLES instead, shuffled with the puzzle's own server seed so a
   given puzzle is the same board for everyone, and size the award so the
   authored target is reachable by clearing about three quarters of the board.
   `layers` stays the size knob and `target` stays the difficulty knob. */
const M3_TYPES = 5;
const M3_BASE_POINTS = 300;
/* Clearing ~75% of the dealt triples must reach the target, so a puzzle is
   winnable without demanding a perfect board clear. */
const M3_CLEAR_FRACTION = 0.75;

function m3NormalizeConfig(body) {
  const target = Number(body && (body.targetScore != null ? body.targetScore : body.target)) || 0;
  const layers = Math.max(1, Number(body && body.layers) || 2);
  // Tiles per type, always a multiple of three: 2 layers -> 3, 5 layers -> 9.
  const perType = 3 * Math.max(1, Math.round(layers / 2));
  const totalTriples = M3_TYPES * (perType / 3);
  const pointsPerMatch = Math.max(
    M3_BASE_POINTS,
    Math.ceil(target / Math.max(1, totalTriples * M3_CLEAR_FRACTION))
  );
  return Object.assign({}, body, { target, layers, perType, totalTriples, pointsPerMatch });
}

function m3MatchPoints(cfg) {
  return (cfg && cfg.pointsPerMatch) || M3_BASE_POINTS;
}

function m3DealBoard(cfg, seed) {
  const rng = mulberry32((Number(seed) || 1) >>> 0);
  const deck = [];
  for (let t = 0; t < M3_TYPES; t++) {
    for (let k = 0; k < cfg.perType; k++) deck.push(t);
  }
  return ceShuffle(deck, rng).map((type, i) => ({
    id: i + 1, type, pos: i, locked: false, inBar: false, removed: false,
  }));
}

function Match3Game({ onWin, onLose, onStepChange, offset, savedProgress, onSaveProgress, resetKey, playMode, band }) {
  /* #176 — the campaign CONVERGES onto the shared progression at the layer
     that matters: rewards. Its fifty authored puzzles group into five story
     bands of ten, and clearing a band's last puzzle ticks the rung and pays,
     once, through game_progress. The campaign keeps its own fine-grained
     match3_* rows for which individual puzzle you are on and your per-puzzle
     bests, because that is session detail rather than progression — moving it
     would have been a risky migration for no behavioural gain.

     Daily and arcade come nearly free on top: the board generator was already
     seeded, so a daily is "today's goal plus today's board" and arcade is the
     same with a fresh seed and a goal that keeps rising. */
  /* The story levels are spread PROPORTIONALLY across the 50 campaign
     puzzles rather than in fixed steps of ten, so the top level is always the
     last puzzle whatever M3_STORY_BANDS is. A fixed stride silently stopped
     short of 50 the moment the level count changed (#184). */
  const M3_STORY_BANDS = 6;
  const M3_CAMPAIGN_PUZZLES = 50;
  const bandPuzzle = playMode === 'story'
    ? Math.max(1, Math.min(M3_CAMPAIGN_PUZZLES, Math.round(
        ((Math.max(0, Math.min(M3_STORY_BANDS - 1, band || 0)) + 1) / M3_STORY_BANDS) * M3_CAMPAIGN_PUZZLES)))
    : null;
  /* #331 — the daily's Easy/Hard pick from the authored tier ranges of the
   MATCH3_PUZZLES table below (ids 1–10 are its Easy tier, 31–50 its Hard), so
   the board is genuinely easier/harder rather than a re-roll. Normal keeps the
   whole-campaign rotation. The bounds mirror the table's `difficulty` column —
   keep them in step if that table changes shape. */
  const dailyBand = playMode === 'daily' && (band === 'easy' || band === 'hard') ? band : null;
  const dailyPuzzle = playMode === 'daily'
    ? dailyBand === 'easy'
      ? 1 + (utcDayNum(offset) % 10)
      : dailyBand === 'hard'
        ? 31 + (utcDayNum(offset) % 20)
        : 1 + (utcDayNum(offset) % 50)
    : null;
  const arcadePuzzle = playMode === 'arcade'
    ? [12, 28, 46][Math.max(0, ARCADE_BANDS.findIndex(b => b.id === band))] || 28
    : null;
  const forcedPuzzle = bandPuzzle || dailyPuzzle || arcadePuzzle;
  const [phase, setPhase] = useState(forcedPuzzle ? 'playing' : 'campaign'); // 'campaign' | 'playing' | 'won' | 'lost'
  const [selectedPuzzle, setSelectedPuzzle] = useState(forcedPuzzle || 1);
  const [puzzleConfig, setPuzzleConfig] = useState(null);
  const [tiles, setTiles] = useState([]);
  const [bar, setBar] = useState([]);
  const [score, setScore] = useState(0);
  const [moves, setMoves] = useState(0);
  const [done, setDone] = useState(false);
  const [userProgress, setUserProgress] = useState(null);
  const [boardSeed, setBoardSeed] = useState(0);

  const secs = useElapsed(resetKey, !done && phase === 'playing');
  const secsRef = useRef(0);
  secsRef.current = secs;

  // Match-3 puzzle definitions (same as server)
  const MATCH3_PUZZLES = [
    { id: 1, name: 'Getting Started', target: 800, timeLimit: 120, moveLimit: 30, layers: 2, difficulty: 'Easy' },
    { id: 2, name: 'Gather Gems', target: 1200, timeLimit: 120, moveLimit: 28, layers: 3, difficulty: 'Easy' },
    { id: 3, name: 'Color Cascade', target: 1500, timeLimit: 120, moveLimit: 26, layers: 2, difficulty: 'Easy' },
    { id: 4, name: 'Tile Practice', target: 2000, timeLimit: 120, moveLimit: 35, layers: 3, difficulty: 'Easy' },
    { id: 5, name: 'Gem Master', target: 2500, timeLimit: 120, moveLimit: 32, layers: 2, difficulty: 'Easy' },
    { id: 6, name: 'Combo Chain', target: 1800, timeLimit: 120, moveLimit: 40, layers: 2, difficulty: 'Easy' },
    { id: 7, name: 'Rainbow Tiles', target: 2200, timeLimit: 120, moveLimit: 30, layers: 3, difficulty: 'Easy' },
    { id: 8, name: 'Momentum', target: 2700, timeLimit: 120, moveLimit: 28, layers: 2, difficulty: 'Easy' },
    { id: 9, name: 'Precision Match', target: 2000, timeLimit: 120, moveLimit: 25, layers: 3, difficulty: 'Easy' },
    { id: 10, name: 'Power Play', target: 2800, timeLimit: 120, moveLimit: 32, layers: 3, difficulty: 'Easy' },
    { id: 11, name: 'Rising Challenge', target: 3000, timeLimit: 110, moveLimit: 28, layers: 3, difficulty: 'Medium' },
    { id: 12, name: 'Locked Tiles', target: 3200, timeLimit: 110, moveLimit: 26, layers: 4, difficulty: 'Medium' },
    { id: 13, name: 'Strategic Moves', target: 3500, timeLimit: 110, moveLimit: 30, layers: 3, difficulty: 'Medium' },
    { id: 14, name: 'Gem Rush', target: 3800, timeLimit: 110, moveLimit: 28, layers: 4, difficulty: 'Medium' },
    { id: 15, name: 'Pressure Cooker', target: 3200, timeLimit: 100, moveLimit: 24, layers: 3, difficulty: 'Medium' },
    { id: 16, name: 'Ice Breaker', target: 4000, timeLimit: 110, moveLimit: 32, layers: 4, difficulty: 'Medium' },
    { id: 17, name: 'Cascade Master', target: 3600, timeLimit: 110, moveLimit: 26, layers: 3, difficulty: 'Medium' },
    { id: 18, name: 'Deep Focus', target: 4200, timeLimit: 110, moveLimit: 30, layers: 4, difficulty: 'Medium' },
    { id: 19, name: 'Tile Tactics', target: 3900, timeLimit: 100, moveLimit: 25, layers: 3, difficulty: 'Medium' },
    { id: 20, name: 'Gem Sculptor', target: 4400, timeLimit: 110, moveLimit: 28, layers: 4, difficulty: 'Medium' },
    { id: 21, name: 'Locked & Loaded', target: 4100, timeLimit: 110, moveLimit: 30, layers: 4, difficulty: 'Medium' },
    { id: 22, name: 'Precision Strike', target: 3800, timeLimit: 100, moveLimit: 23, layers: 3, difficulty: 'Medium' },
    { id: 23, name: 'Color Theory', target: 4300, timeLimit: 110, moveLimit: 28, layers: 4, difficulty: 'Medium' },
    { id: 24, name: 'Momentum Shift', target: 4600, timeLimit: 110, moveLimit: 32, layers: 4, difficulty: 'Medium' },
    { id: 25, name: 'Maze Solver', target: 4000, timeLimit: 100, moveLimit: 26, layers: 3, difficulty: 'Medium' },
    { id: 26, name: 'Time Pressure', target: 3900, timeLimit: 90, moveLimit: 22, layers: 4, difficulty: 'Medium' },
    { id: 27, name: 'Champion\'s Path', target: 4500, timeLimit: 110, moveLimit: 30, layers: 4, difficulty: 'Medium' },
    { id: 28, name: 'Final Stand', target: 4800, timeLimit: 110, moveLimit: 28, layers: 4, difficulty: 'Medium' },
    { id: 29, name: 'Gem Dynasty', target: 4200, timeLimit: 100, moveLimit: 24, layers: 3, difficulty: 'Medium' },
    { id: 30, name: 'Gateway Challenge', target: 5000, timeLimit: 110, moveLimit: 32, layers: 4, difficulty: 'Medium' },
    { id: 31, name: 'Expert Territory', target: 5200, timeLimit: 100, moveLimit: 26, layers: 5, difficulty: 'Hard' },
    { id: 32, name: 'Ice Fortress', target: 5400, timeLimit: 100, moveLimit: 24, layers: 5, difficulty: 'Hard' },
    { id: 33, name: 'Avalanche', target: 5800, timeLimit: 100, moveLimit: 28, layers: 5, difficulty: 'Hard' },
    { id: 34, name: 'Locked Labyrinth', target: 5600, timeLimit: 100, moveLimit: 25, layers: 5, difficulty: 'Hard' },
    { id: 35, name: 'Inferno', target: 6000, timeLimit: 90, moveLimit: 22, layers: 5, difficulty: 'Hard' },
    { id: 36, name: 'Master Puzzle', target: 5900, timeLimit: 100, moveLimit: 26, layers: 5, difficulty: 'Hard' },
    { id: 37, name: 'Complexity', target: 6200, timeLimit: 100, moveLimit: 28, layers: 5, difficulty: 'Hard' },
    { id: 38, name: 'Precision Required', target: 5800, timeLimit: 90, moveLimit: 23, layers: 5, difficulty: 'Hard' },
    { id: 39, name: 'Final Test', target: 6400, timeLimit: 100, moveLimit: 26, layers: 5, difficulty: 'Hard' },
    { id: 40, name: 'Legendary Tier', target: 6600, timeLimit: 100, moveLimit: 30, layers: 5, difficulty: 'Hard' },
    { id: 41, name: 'Peak Performance', target: 6000, timeLimit: 90, moveLimit: 24, layers: 5, difficulty: 'Hard' },
    { id: 42, name: 'Unrelenting', target: 6300, timeLimit: 100, moveLimit: 27, layers: 5, difficulty: 'Hard' },
    { id: 43, name: 'Titan\'s Trial', target: 6800, timeLimit: 100, moveLimit: 28, layers: 5, difficulty: 'Hard' },
    { id: 44, name: 'Endgame', target: 6500, timeLimit: 90, moveLimit: 25, layers: 5, difficulty: 'Hard' },
    { id: 45, name: 'Perfection Quest', target: 6900, timeLimit: 100, moveLimit: 30, layers: 5, difficulty: 'Hard' },
    { id: 46, name: 'Unstoppable', target: 6700, timeLimit: 100, moveLimit: 26, layers: 5, difficulty: 'Hard' },
    { id: 47, name: 'Ultra Challenge', target: 7000, timeLimit: 100, moveLimit: 28, layers: 5, difficulty: 'Hard' },
    { id: 48, name: 'Reality Bender', target: 6800, timeLimit: 90, moveLimit: 23, layers: 5, difficulty: 'Hard' },
    { id: 49, name: 'Pandora\'s Box', target: 7100, timeLimit: 100, moveLimit: 30, layers: 5, difficulty: 'Hard' },
    { id: 50, name: 'Master Challenge', target: 7200, timeLimit: 100, moveLimit: 28, layers: 5, difficulty: 'Hard' },
  ];

  // Load user progress
  useEffect(() => {
    (async () => {
      const { ok, body } = await api('/api/match3/progress');
      if (ok && body) {
        setUserProgress(body);
        setSelectedPuzzle(body.lastPlayedPuzzle || 1);
      }
    })();
  }, []);

  // A mode that named a puzzle skips the campaign screen entirely.
  const m3Booted = useRef(false);
  useEffect(() => {
    if (forcedPuzzle && !m3Booted.current) { m3Booted.current = true; startPuzzle(forcedPuzzle); }
  }, [forcedPuzzle]);

  // Start a puzzle
  const startPuzzle = async (puzzleId) => {
    /* PHASE 8 — this was a GET against a POST-only route
       (app.post('/api/match3/start/:puzzleId')), so it fell through to the
       catch-all, came back as the HTML shell, and JSON parsing failed — the
       third reason Match 3 could never actually be played. */
    const { ok, body } = await api(`/api/match3/start/${puzzleId}`, { method: 'POST' });
    if (ok && body) {
      /* #214 — the server sends `targetScore`; the win check read
         `puzzleConfig.target`, which is undefined, and `score >= undefined` is
         false for every score there has ever been. That alone made the win
         state unreachable on all 50 puzzles. Normalise ONCE here, accepting
         either name, so the comparison and the status bar cannot drift apart
         again. */
      const cfg = m3NormalizeConfig(body);
      setPuzzleConfig(cfg);
      setBoardSeed(body.boardSeed);
      setSelectedPuzzle(puzzleId);

      if (body.savedSession) {
        setTiles(body.savedSession.tiles || []);
        setBar(body.savedSession.bar || []);
        setScore(body.savedSession.score || 0);
        setMoves(body.savedSession.moves || 0);
      } else {
        setTiles(m3DealBoard(cfg, body.boardSeed || puzzleId));
        setBar([]);
        setScore(0);
        setMoves(0);
      }

      setDone(false);
      setPhase('playing');
    }
  };

  // Handle tile click
  const selectTile = (tileId) => {
    if (phase !== 'playing' || done) return;
    if (bar.length >= 7) {
      onLose(moves, secsRef.current, { share: `Match-3 • Puzzle ${selectedPuzzle} • ${moves} moves` });
      setDone(true);
      setPhase('lost');
      return;
    }

    const newBar = [...bar, tileId];
    const newMoves = moves + 1;

    // Check for match-3
    let matched = false;
    if (newBar.length >= 3) {
      for (let i = 0; i <= newBar.length - 3; i++) {
        const t1 = tiles.find(t => t.id === newBar[i]);
        const t2 = tiles.find(t => t.id === newBar[i + 1]);
        const t3 = tiles.find(t => t.id === newBar[i + 2]);
        if (t1 && t2 && t3 && t1.type === t2.type && t2.type === t3.type) {
          matched = true;
          // Remove matched tiles
          const toRemove = new Set([newBar[i], newBar[i + 1], newBar[i + 2]]);
          setTiles(tiles.map(t => toRemove.has(t.id) ? { ...t, removed: true } : t));
          setBar(newBar.filter(id => !toRemove.has(id)));
          const newScore = score + m3MatchPoints(puzzleConfig);
          setScore(newScore);
          setMoves(newMoves);
          onStepChange && onStepChange(newMoves);

          if (newScore >= puzzleConfig.target) {
            onWin(newScore, newMoves, secsRef.current, { share: `Match-3 • Puzzle ${selectedPuzzle}: ${newScore}pts` });
            setDone(true);
            setPhase('won');
            /* The campaign row still records which puzzle you reached and your
               best on it. The shell's mode dispatch handles the band clear and
               the payout, so this stays a pure campaign-detail write. */
            api(`/api/match3/finish/${selectedPuzzle}`, {
              method: 'POST',
              body: JSON.stringify({ score: newScore, timeSecs: secsRef.current, moves: newMoves })
            });
          }
          return;
        }
      }
    }

    if (!matched) {
      setBar(newBar);
      setMoves(newMoves);
      onStepChange && onStepChange(newMoves);
    }
  };

  // Autosave
  useAutosave(
    onSaveProgress,
    () => ({
      puzzleId: selectedPuzzle,
      tiles,
      bar,
      score,
      moves,
    }),
    !done && phase === 'playing'
  );

  if (phase === 'campaign' && userProgress) {
    // Campaign selection screen
    const easyPuzzles = MATCH3_PUZZLES.slice(0, 10);
    const mediumPuzzles = MATCH3_PUZZLES.slice(10, 30);
    const hardPuzzles = MATCH3_PUZZLES.slice(30, 50);

    return React.createElement(
      'div',
      { style: { padding: '1.5rem', maxWidth: '900px', margin: '0 auto' } },
      React.createElement('h2', { style: { marginBottom: '1.5rem', color: C.text } }, '🟩 Match-3 Campaign'),
      React.createElement('div', { style: { marginBottom: '2rem', padding: '1rem', background: C.card, borderRadius: '0.5rem', border: `1px solid ${C.border}` } },
        React.createElement('div', { style: { display: 'flex', gap: '2rem', marginBottom: '1rem' } },
          React.createElement('div', null,
            React.createElement('div', { style: { fontSize: '0.75rem', textTransform: 'uppercase', color: C.muted, marginBottom: '0.25rem' } }, 'Highest Puzzle'),
            React.createElement('div', { style: { fontSize: '1.75rem', fontWeight: 700, color: C.gold } }, `${userProgress.highestPuzzle}/50`)
          ),
          React.createElement('div', null,
            React.createElement('div', { style: { fontSize: '0.75rem', textTransform: 'uppercase', color: C.muted, marginBottom: '0.25rem' } }, 'Best Score'),
            React.createElement('div', { style: { fontSize: '1.5rem', fontWeight: 600, color: C.emerald } }, userProgress.bestScore.toLocaleString())
          ),
          React.createElement('div', null,
            React.createElement('div', { style: { fontSize: '0.75rem', textTransform: 'uppercase', color: C.muted, marginBottom: '0.25rem' } }, 'Completed'),
            React.createElement('div', { style: { fontSize: '1.5rem', fontWeight: 600, color: C.accent } }, userProgress.totalCompleted)
          )
        ),
        userProgress.highestPuzzle > 0 && React.createElement(
          'button',
          {
            onClick: () => startPuzzle(Math.min(userProgress.lastPlayedPuzzle, 50)),
            style: {
              padding: '0.5rem 1rem',
              background: C.accent,
              color: C.bg,
              border: 'none',
              borderRadius: '0.375rem',
              fontWeight: 600,
              cursor: 'pointer',
            }
          },
          '▶ Resume Puzzle ' + Math.min(userProgress.lastPlayedPuzzle, 50)
        )
      ),
      ['Easy (1-10)', 'Medium (11-30)', 'Hard (31-50)'].map((tier, tierIdx) => {
        const puzzles = tierIdx === 0 ? easyPuzzles : tierIdx === 1 ? mediumPuzzles : hardPuzzles;
        const tierColor = tierIdx === 0 ? C.emerald : tierIdx === 1 ? C.gold : C.rose;
        return React.createElement(
          'div',
          { key: tier, style: { marginBottom: '2rem' } },
          React.createElement('h3', { style: { color: tierColor, marginBottom: '1rem', fontSize: '1.1rem' } }, tier),
          React.createElement(
            'div',
            { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '0.75rem' } },
            puzzles.map(p => {
              /* PHASE 8 — the unlock gate was `p.id <= highestPuzzle`, i.e. you
                 could only replay puzzles you had ALREADY solved. With
                 highestPuzzle: 0 on a new player that locked all 50, so nobody
                 could ever start the game — the second half of why Match 3 was
                 unplayable rather than merely unstyled (the first being its API
                 routes sitting after the catch-all, see server.js). The next
                 unsolved puzzle must be playable. */
              const isSolved = p.id <= userProgress.highestPuzzle;
              const isUnlocked = p.id <= userProgress.highestPuzzle + 1;
              return React.createElement(
                'button',
                Object.assign(
                  {
                    key: p.id,
                    disabled: !isUnlocked,
                    className: 'm3-level' + (isSolved ? ' solved' : '') + (isUnlocked ? '' : ' locked'),
                    'aria-label': `Puzzle ${p.id}: ${p.name}${isSolved ? ' (solved)' : isUnlocked ? '' : ' (locked)'}`,
                  },
                  tapProps(() => startPuzzle(p.id), { disabled: !isUnlocked })
                ),
                React.createElement('div', { className: 'm3-level-id' }, isSolved ? '✓' : isUnlocked ? p.id : '🔒'),
                React.createElement('div', { className: 'm3-level-name' }, p.name)
              );
            })
          )
        );
      })
    );
  }

  /* PHASE 8 — Match 3 was the only game in the registry with no design system:
     hand-written inline styles, plain coloured blocks with padding: 2rem, a bare
     "Bar:" label, `minHeight: 100vh` inside an already-fitted stage, and no CSS
     classes at all — so it also missed every registry-wide fix (Phase 2's
     touch-action/press state, Phase 3's fit sizing). Rebuilt on the same
     CgStatus / .m3-* / tray idiom the two Tile Match games use.
     Gameplay, scoring and MATCH3_PUZZLES are untouched: markup and CSS only. */
  if (phase === 'playing' && puzzleConfig) {
    return React.createElement(
      'div',
      { className: 'm3-wrap fit-col', style: { alignItems: 'center', gap: '0.75rem' } },
      React.createElement(CgStatus, {
        items: [
          { l: 'Score', v: `${score} / ${puzzleConfig.target}` },
          { l: 'Moves', v: `${moves} / ${puzzleConfig.moveLimit}` },
          { l: 'Time', v: `${secs}s` },
        ],
      }),
      React.createElement(M3BoardCanvas, { tiles, bar, done, onTile: selectTile })
    );
  }

  /* #214 — `setPhase('won')` / `setPhase('lost')` had NO render branch, so a
     finished puzzle fell through to the bare "Loading..." string below with no
     control on it at all. The shell's own win overlay appears over the top;
     dismiss it and you were left staring at "Loading..." with no way back —
     the reported "Play Again freezes". A finished puzzle now says so and
     offers the two things you can actually do next. */
  if (phase === 'won' || phase === 'lost') {
    const won = phase === 'won';
    const nextId = Math.min(M3_CAMPAIGN_PUZZLES, selectedPuzzle + 1);
    return React.createElement(
      'div',
      { className: 'm3-result' },
      React.createElement('div', { className: 'm3-result-icon' }, won ? '🏆' : '💥'),
      React.createElement('div', { className: 'm3-result-title' },
        won ? 'Puzzle cleared!' : 'Tray full — run over'),
      React.createElement('div', { className: 'm3-result-sub' },
        `Puzzle ${selectedPuzzle} · ${score} points · ${moves} moves`),
      React.createElement(
        'div',
        { className: 'm3-result-actions' },
        React.createElement('button', Object.assign(
          { className: 'primary-btn m3-result-btn' },
          tapProps(() => startPuzzle(won ? nextId : selectedPuzzle))
        ), won && nextId !== selectedPuzzle ? `Next puzzle ${nextId}` : 'Play again'),
        /* A mode that named its own puzzle (daily, story, arcade) has no
           campaign screen behind it, so that button would strand the player. */
        !forcedPuzzle && React.createElement('button', Object.assign(
          { className: 'm3-result-btn m3-result-btn-quiet' },
          tapProps(() => { setDone(false); setPhase('campaign'); })
        ), '← All puzzles')
      )
    );
  }

  return React.createElement('div', { style: { padding: '1rem', color: C.text } }, 'Loading...');
}
