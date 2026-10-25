/* ============================================================
   Snakes & Ladders V2 — Ranked Match progression (device-local)
   ============================================================
   Where this lives, and why it is not on the server.

   The repo already has two ranking stores and NEITHER fits a hot-seat
   Ranked Match:

   - `game_ratings` / `applyMatchRating` (server.js) is Elo for ONLINE
     rooms. It is settled inside the four server finish paths, and it
     keys off two signed-in accounts. A local match never touches the
     server, and the four other people around the phone have no session.
   - `classic_scores` holds ONE best-streak row per signed-in account
     per game. A six-seat table has six players and one account.

   So Ranked Match keeps its ladder where every other free-play V2 state
   already lives: localStorage, next to puzzlechain_cnlv2_unlocks and
   puzzlechain_cnl_streak. It is the DEVICE's ladder, it moves on seat
   1's placement, and it is honest about that in the copy.

   RP math. `cnlv2RpDelta` is symmetric about the midpoint of the field:
   first place always gains SNLV2_RP_BASE, last place always loses it,
   and a mid-table finish lands near zero. That property is what keeps a
   6-player table worth the same as a 4-player one, and it is asserted by
   the `cnlv2-rank-tiers` self-test.

   Tier ids carry a `rank-` prefix on purpose: CNLV2_LAYOUTS already owns
   a DIFFICULTY tier called `legend`, and the two would otherwise collide
   in the deep-link parser and in every log line. */

const SNLV2_RANK_KEY = 'puzzlechain_cnlv2_rank';
const SNLV2_RP_BASE = 20;
// Ranked needs a real table. Below this many humans a "ranked" result is
// just a win over bots, so the toggle stays disabled (registry: rankedLocal).
const SNLV2_RANKED_MIN_HUMANS = 4;

const SNLV2_RANK_TIERS = [
  { id: 'rank-bronze', name: 'Bronze', glyph: '🥉', at: 0 },
  { id: 'rank-silver', name: 'Silver', glyph: '🥈', at: 60 },
  { id: 'rank-gold', name: 'Gold', glyph: '🥇', at: 140 },
  { id: 'rank-platinum', name: 'Platinum', glyph: '💠', at: 240 },
  { id: 'rank-diamond', name: 'Diamond', glyph: '💎', at: 360 },
  { id: 'rank-legend', name: 'Legend', glyph: '👑', at: 500 },
];

// Highest tier whose threshold the RP total has reached. Ascending table, so
// the last match wins.
function cnlv2Tier(rp) {
  const n = Math.max(0, Math.floor(rp || 0));
  let t = SNLV2_RANK_TIERS[0];
  for (const tier of SNLV2_RANK_TIERS) if (n >= tier.at) t = tier;
  return t;
}

function cnlv2TierById(id) {
  return SNLV2_RANK_TIERS.find((t) => t.id === id)
    || SNLV2_RANK_TIERS.find((t) => t.name.toLowerCase() === String(id || '').toLowerCase())
    || null;
}

/* Placement → RP. Linear and symmetric: with nRanked seats, place 1 gets
   +SNLV2_RP_BASE, place nRanked gets -SNLV2_RP_BASE, and the midpoint is 0.
   A 2-player ranked table is out of scope (SNLV2_RANKED_MIN_HUMANS), but the
   guard keeps the formula total anyway. */
function cnlv2RpDelta(place, nRanked) {
  const n = Math.max(2, Math.floor(nRanked || 0));
  const p = Math.max(1, Math.min(n, Math.floor(place || 1)));
  return Math.round((SNLV2_RP_BASE * (n + 1 - 2 * p)) / (n - 1));
}

function cnlv2ReadRank() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(SNLV2_RANK_KEY) || 'null'); } catch (e) { raw = null; }
  const rp = raw && Number.isFinite(raw.rp) ? Math.max(0, Math.floor(raw.rp)) : 0;
  const played = raw && Number.isFinite(raw.played) ? Math.max(0, Math.floor(raw.played)) : 0;
  const bestTier = (raw && cnlv2TierById(raw.bestTier) ? raw.bestTier : cnlv2Tier(rp).id);
  return { rp, played, bestTier };
}

function cnlv2SaveRank(st) {
  try { localStorage.setItem(SNLV2_RANK_KEY, JSON.stringify(st)); } catch (e) {}
}

/* Settle one ranked match for seat 1. `place` is its placement among the
   HUMAN seats only (bots are filtered out before this is called — beating
   three bots is not a ranked result). Returns everything the result card
   needs, so the caller never re-derives a tier. RP floors at 0: a bad night
   can cost a tier, it cannot go negative. */
function cnlv2ApplyRank(place, nRanked) {
  const before = cnlv2ReadRank();
  const delta = cnlv2RpDelta(place, nRanked);
  const rp = Math.max(0, before.rp + delta);
  const tierBefore = cnlv2Tier(before.rp);
  const tierAfter = cnlv2Tier(rp);
  const bestBefore = cnlv2TierById(before.bestTier) || tierBefore;
  const best = tierAfter.at >= bestBefore.at ? tierAfter : bestBefore;
  const after = { rp, played: before.played + 1, bestTier: best.id };
  cnlv2SaveRank(after);
  return {
    delta,
    rpBefore: before.rp,
    rpAfter: rp,
    tierBefore,
    tierAfter,
    promoted: tierAfter.at > tierBefore.at,
    demoted: tierAfter.at < tierBefore.at,
    played: after.played,
  };
}
