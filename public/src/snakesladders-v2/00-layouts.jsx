/* ============================================================
   Snakes & Ladders V2 — difficulty layouts + Legend unlock
   ============================================================
   Seven hand-authored tier boards for LOCAL play (bot / hotseat).
   Online rooms keep the server-refereed CNL_VARIANTS tables — these
   tables are shaped to drop into lib/board-rules.js later, but that
   plumbing is deferred (see the V2 spec's "Deferred work").

   Authoring constraints — enforced by the `cnlv2-layouts` self-test:
   - starts and ends in 2–99. 100 is NOT a legal ladder end: the collision
     penalty can shove a pawn onto a ladder bottom, and a ladder to 100 would
     hand that pawn a win it never rolled for (see 03-game.jsx's Rule 4)
   - ladder start < end; snake start > end
   - no square is both a jump start and a jump destination (the engine
     applies exactly ONE jump per landing, so chains would be ambiguous)
   - no two jumps share a start square
   - every tier must be PLAYABLE and the tiers must get harder in order —
     measured by cnlv2ExpectedRolls (below), not by counting snakes. #203's
     Legend passed every count-based rule and still needed 1812 expected rolls.
   - Legend: both ladders top out < 80, so the last two rows are walked.

   Everything here is CNLV2_-prefixed: the old file's CNL_* names and
   window.boardRules' browser globals share this one script scope, and
   a redeclared const is a parse error for the whole app. */

const CNLV2_LAYOUTS = [
  {
    id: 'beginner', label: 'Beginner',
    ladders: { 3: 22, 8: 31, 15: 44, 28: 56, 36: 64, 47: 68, 62: 81, 71: 92 },
    snakes:  { 39: 18, 66: 45, 88: 50 },
  },
  {
    id: 'amateur', label: 'Amateur',
    ladders: { 4: 25, 12: 33, 21: 49, 37: 57, 46: 73, 58: 82, 69: 91 },
    snakes:  { 30: 7, 52: 28, 65: 41, 84: 60, 96: 75 },
  },
  {
    id: 'regular', label: 'Regular',
    ladders: { 5: 27, 14: 35, 29: 54, 42: 63, 57: 78, 66: 89 },
    snakes:  { 23: 8, 48: 26, 61: 39, 75: 50, 86: 52, 97: 70 },
  },
  {
    id: 'professional', label: 'Professional',
    ladders: { 6: 29, 18: 41, 33: 60, 49: 72, 68: 90 },
    snakes:  { 25: 9, 43: 17, 56: 31, 64: 38, 79: 46, 88: 67, 94: 74, 98: 55 },
  },
  {
    id: 'topplayer', label: 'Top Player',
    ladders: { 7: 32, 20: 45, 39: 61, 55: 77 },
    snakes:  { 16: 4, 28: 11, 44: 22, 52: 30, 63: 35, 71: 48, 82: 58, 89: 53, 96: 68, 99: 80 },
  },
  {
    id: 'superstar', label: 'Super Star',
    ladders: { 9: 34, 27: 51, 46: 70 },
    snakes:  { 15: 3, 24: 6, 38: 12, 45: 19, 59: 37, 67: 40, 76: 54, 83: 49, 90: 62, 94: 71, 97: 65, 99: 58 },
  },
  {
    /* #203 — the summit used to be a wall, not a gauntlet: 11 of 15 heads sat
       in 80–99, and 95/97/98/99 were ALL heads, so the only squares from which
       an exact roll could reach 100 were 94 and 96. Measured through the
       board's own Markov chain that is 1812 expected rolls to finish — roughly
       an hour of tapping for one pawn, which is what the report meant by
       "mathematically unwinnable" (it is finishable with probability 1; it is
       not playable).

       Legend is still by far the hardest tier and still ends on a snake at 99.
       What changed is WHERE the difficulty sits: a long, snake-dense climb
       (eight heads between 18 and 76 against only two ladders, both topping out
       below 80) and then a stepped run-in — heads every third square from 81 to
       93, 94 through 98 clear, and one last snake on 99 that drops you to
       single digits. 362 expected rolls: 5× faster than before and 1.7× the
       tier below it, so the ladder still ends where it should.

       `cnlv2-layouts` measures this now rather than counting heads. The old
       "≥10 heads in 80–99" rule was the CAUSE, and it could not have caught
       this: head count says nothing about whether 100 is reachable. */
    id: 'legend', label: 'Legend',
    ladders: { 10: 42, 31: 66 },
    snakes:  {
      18: 5, 27: 9, 36: 14, 45: 21, 53: 29, 61: 34, 68: 47, 76: 55,
      81: 35, 84: 26, 87: 32, 90: 62, 93: 64, 99: 7,
    },
  },
];

/* How long a tier actually TAKES, exactly — the expected number of dice rolls
   for one pawn to get from square 0 to square 100.

   Solving it beats simulating it: the board is an absorbing Markov chain, so
   E[s] = 1 + (1/6)·Σ E[dest(s, d)] is 100 linear equations in 100 unknowns and
   Gauss-Jordan gives the answer to full precision in about a millisecond. A
   simulation would need millions of trials to separate a slow tier from an
   impossible one, and would still be noisy.

   `dest` mirrors the engine in 03-game.jsx: an overshoot past 100 stays put,
   otherwise the pawn lands and takes at most one jump. The extra roll on a 6,
   the three-6 forfeit and the collision knockback are deliberately NOT modelled
   — none of them changes which squares are reachable, which is what this is
   for. Pure and self-contained so `cnlv2-layouts` can assert on it. */
function cnlv2ExpectedRolls(layout) {
  const jump = Object.assign({}, layout.ladders, layout.snakes);
  const n = 100;                       // unknowns E[0..99]; E[100] is 0
  const W = n + 1;                     // one augmented column
  const A = new Float64Array(n * W);
  for (let s = 0; s < n; s++) {
    A[s * W + s] += 1;
    A[s * W + n] = 1;                  // the roll that is being taken
    for (let d = 1; d <= 6; d++) {
      let t = s + d;
      t = t > 100 ? s : (jump[t] !== undefined ? jump[t] : t);
      if (t < 100) A[s * W + t] -= 1 / 6;
    }
  }
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col; r < n; r++) {
      if (Math.abs(A[r * W + col]) > Math.abs(A[piv * W + col])) piv = r;
    }
    if (piv !== col) {
      for (let j = col; j < W; j++) {
        const tmp = A[col * W + j]; A[col * W + j] = A[piv * W + j]; A[piv * W + j] = tmp;
      }
    }
    const inv = 1 / A[col * W + col];
    for (let j = col; j < W; j++) A[col * W + j] *= inv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r * W + col];
      if (f === 0) continue;
      for (let j = col; j < W; j++) A[r * W + j] -= f * A[col * W + j];
    }
  }
  return A[0 * W + n];
}

function cnlv2LayoutById(id) {
  return CNLV2_LAYOUTS.find((l) => l.id === id) || CNLV2_LAYOUTS[0];
}

/* Device-local progression, matching the precedent of puzzlechain_cnl_skin /
   puzzlechain_cnl_streak: classic free-play state never round-trips the
   server. JSON so future tiers can add keys without a second storage slot. */
const CNLV2_UNLOCK_KEY = 'puzzlechain_cnlv2_unlocks';
function cnlv2Unlocks() {
  try { return JSON.parse(localStorage.getItem(CNLV2_UNLOCK_KEY) || '{}') || {}; }
  catch (e) { return {}; }
}
function cnlv2SaveUnlock(id) {
  try {
    const u = cnlv2Unlocks();
    u[id] = true;
    localStorage.setItem(CNLV2_UNLOCK_KEY, JSON.stringify(u));
  } catch (e) {}
}
function cnlv2LegendUnlocked() { return !!cnlv2Unlocks().legend; }

/* Screenshot-state deep links (same role as ?cnlskin in the old file):
   ?cnldiff=<tierId> pins the difficulty — and for legend, bypasses the lock
   for the session (the URL wins over stored state; the lock itself is
   asserted separately on the bare picker). ?seats=2..6 pins the hotseat
   seat count and is only honored with mode=2p.

   The dice rules (a 6 rolls again; three 6s forfeit the third roll) are only
   reachable by ROLLING, which navigation-driven proposal checks and the
   before/after screenshots cannot do — so three more params script them
   deterministically. They are a pure client-side TEST FIXTURE: they write
   nothing, touch no endpoint, and are therefore deliberately NOT
   staging-gated (the "before" shot comes from production).

   - ?snldice=6,6,6  forces the next rolls in order (values outside 1–6 are
     dropped, at most 12 kept); once the queue empties the die is fair again.
   - ?snlauto=1      fires exactly as many rolls as the queue holds, so the
     whole sequence plays out on a plain page load.
   - ?snlsix=0..2    pre-seeds seat 1's consecutive-6 counter, putting the
     forfeit one roll away instead of three.

   The collision penalty (landing on an occupied square knocks its occupant
   back 10) needs two pawns on one square, which takes six honest rolls to
   reach — long enough that a check could time out waiting. Two more fixture
   params put the board one roll away instead:

   - ?snlpos=13,9    pre-places each seat (0–99, one per seat, extras
     ignored); anything unlisted starts at 0 as usual.
   - ?snlturn=1..6   starts the round on that seat rather than seat 1.

   The Local Match roster, the Ranked toggle and the ranked ladder are all
   behind taps too, so they get the same treatment:

   - ?snlroster=h,b,b  seats the match directly ("h" human, "b" bot; the
     compact form "hbb" also parses). Ignored unless it holds at least one
     human, because a table of six bots has nobody to hand the phone to.
   - ?snlranked=1      arms Ranked Match. Still subject to the 4-human rule,
     so it only takes effect on a roster that qualifies.
   - ?snlrank=gold     DISPLAY-ONLY: shows the badge at that tier without
     writing localStorage, exactly as ?cnldiff=legend shows the Legend board
     without granting the unlock. A screenshot fixture must never mutate the
     device's ladder.
   - ?snlquiet=1       forces reduced motion and silence for this load, so
     the particle layer and the music scheduler cannot make a screenshot
     nondeterministic.

   Same fixture rules: client-side only, no writes, no endpoint. */
const CNLV2_NO_DEEP_LINKS = {
  difficulty: null, seats: null, dice: null, auto: false, sixSeed: 0, pos: null, turn: 0,
  roster: null, ranked: false, rank: null, quiet: false,
};

/* "h,b,b" and "hbb" both mean [human, bot, bot]. Returns null unless the
   result is a legal 2-6 seat table containing a human. */
function cnlv2ParseRoster(raw) {
  const txt = String(raw || '').toLowerCase().replace(/[^hb]/g, '');
  const seats = txt.split('').map((c) => (c === 'b' ? 'bot' : 'human')).slice(0, 6);
  if (seats.length < 2) return null;
  if (!seats.some((s) => s === 'human')) return null;
  return seats;
}

function cnlv2DeepLinks() {
  try {
    const q = new URLSearchParams(window.location.search);
    const diff = q.get('cnldiff');
    const seats = parseInt(q.get('seats') || '', 10);
    const dice = (q.get('snldice') || '')
      .split(',')
      .map((s) => parseInt(s, 10))
      .filter((n) => n >= 1 && n <= 6)
      .slice(0, 12);
    const sixSeed = parseInt(q.get('snlsix') || '', 10);
    const pos = (q.get('snlpos') || '')
      .split(',')
      .map((s2) => parseInt(s2, 10))
      .filter((n) => n >= 0 && n <= 99)
      .slice(0, 6);
    const turn = parseInt(q.get('snlturn') || '', 10);
    const rankId = q.get('snlrank');
    return {
      difficulty: diff && CNLV2_LAYOUTS.some((l) => l.id === diff) ? diff : null,
      seats: seats >= 2 && seats <= 6 ? seats : null,
      dice: dice.length ? dice : null,
      auto: q.get('snlauto') === '1',
      // Clamped below the forfeit limit: seeding the limit itself would mean
      // the forfeit had already happened without a roll being thrown.
      sixSeed: sixSeed >= 1 && sixSeed <= 2 ? sixSeed : 0,
      // 99 is the ceiling on purpose: a pre-placed pawn on 100 would be a
      // finished game the shell never announced.
      pos: pos.length ? pos : null,
      turn: turn >= 1 && turn <= 6 ? turn : 0,
      roster: cnlv2ParseRoster(q.get('snlroster')),
      ranked: q.get('snlranked') === '1',
      // Display only. cnlv2ApplyRank is the sole writer of the stored ladder.
      rank: rankId && cnlv2TierById(rankId) ? cnlv2TierById(rankId).id : null,
      quiet: q.get('snlquiet') === '1',
    };
  } catch (e) { return CNLV2_NO_DEEP_LINKS; }
}
