/* ============================================================
   Home cards + the play-mode axis (#176)
   ============================================================
   Request #176 asked every game to offer, "as relevant", three ways to play:

     daily   — one seeded deal a day, ranked, everyone gets the same one
     story   — a progression that gets harder and that you can check off
     arcade  — generated live, endless, different every run

   THE MODEL. A play mode is a property of a CARD, not of a registry entry.
   That distinction is what keeps this cheap:

     - Registry ids never move. `daily_attempts`, `classic_scores`, chat,
       leaderboards, badges and every deep link key off them, so the four
       games that ship as two ids (Snake / Daily Snake, Bounce / Daily Bounce,
       Tile Match / Daily Tile Match, Mine Finder / Mine Finder Classic) keep
       BOTH ids and merge only here, on the card. Nothing migrates.
     - A card is one game as a player thinks of it. Its `modes` list says
       which buttons it shows and which registry id + play mode each launches.

   This generalises #146's dual-mode pairing, which hard-coded exactly two
   buttons (`regular` and `daily`). The shape is now an ordered list, so a card
   can carry one, two or three of them.

   A STORY LEVEL IS A DIFFICULTY STEP, NOT ONE OF A GAME'S OWN LEVELS. Games
   differ wildly in how much content they have — Tile Match generates 1000
   levels, Mahjong has 6 layouts, Marble Loop has 3 paths — so paying per
   level-of-content would make one game worth a hundred times another for the
   same "finished the story" achievement. Every game is normalised to
   STORY_LEVEL_MIN..STORY_LEVEL_MAX steps (6 to 10, #184), and a difficulty
   step is what a rating produces anyway, so the ladder falls out of work the
   rating already does. The internal identifiers still say `band` — the #184
   rename is display-only, and `game_progress.band` is a live primary key.

   ARCADE BANDS ARE ALWAYS THREE, ALWAYS OPEN. Easy / Normal / Hard for every
   game, available from the start — no story gate. See ARCADE_BANDS below.
   ============================================================ */

// The three play modes, in display order. `blurb` is the pre-game screen's
// one-line promise for that mode (the daily one is the only one that can
// honestly say "everyone plays this exact deal").
const PLAY_MODES = {
  daily:  { label: 'Daily',  order: 0, blurb: 'Everyone plays this exact deal today. One attempt.' },
  story:  { label: 'Story',  order: 1, blurb: 'Clear a level to tick it off. Each one is harder than the last.' },
  arcade: { label: 'Arcade', order: 2, blurb: 'A fresh board every run. Beat your best to score.' },
};
const PLAY_MODE_IDS = Object.keys(PLAY_MODES).sort((a, b) => PLAY_MODES[a].order - PLAY_MODES[b].order);
const isPlayMode = (m) => Object.prototype.hasOwnProperty.call(PLAY_MODES, m);

/* Arcade difficulty bands. THREE for every game, deliberately coarser than a
   story ladder: story's granularity is progression, arcade's is a selector and
   has to fit in a row. All three are open from the first run — a player who
   picks Hard on a game they have never played gets a hard board, and that is
   allowed: steering, not gating.

   The picker used to mark one band "recommended" from your story progress.
   #195 removed it — it repeated what the band names already say, and Easy /
   Normal / Hard is not a labelling anyone needs help reading. */
const ARCADE_BANDS = [
  { id: 'easy',   label: 'Easy',   t: 0.15 },
  { id: 'normal', label: 'Normal', t: 0.50 },
  { id: 'hard',   label: 'Hard',   t: 0.85 },
];
const ARCADE_BAND_IDS = ARCADE_BANDS.map(b => b.id);
const arcadeBand = (id) => ARCADE_BANDS.find(b => b.id === id) || ARCADE_BANDS[1];

/* Which play modes each registry id offers. THE #176 DECLARATION TABLE — this
   is the single place that says what a game supports, and the home grid, the
   pre-game screen, the deep links and the self-tests all read it.

   Omissions are deliberate, not gaps:
     - Nonogram and Crate Push skip arcade: their content is authored or
       generated offline in bounded quantity, so endless play would exhaust it.
     - Drop Stack, Word Sprint, Snake, 2048 and Block Fit skip story: they are
       score-attack games and rungs fit them badly.
     - The seven head-to-head board games appear here with no modes at all.
       Their axis is opponent (bot / pass-and-play / online), not this one. */
const PLAY_MODES_BY_ID = {
  // Dailies that also gain a ladder and endless play
  sudoku:            ['daily', 'story', 'arcade'],
  sudokumini:        ['daily', 'story', 'arcade'],
  wordhunt:          ['daily', 'story', 'arcade'],
  cryptowordle:      ['daily', 'story', 'arcade'],
  klondike:          ['daily', 'story', 'arcade'],
  spider:            ['daily', 'story', 'arcade'],
  mahjongsol:        ['daily', 'story', 'arcade'],
  anagrams:          ['daily', 'story', 'arcade'],
  nonogram:          ['daily', 'story'],
  cratepush:         ['daily', 'story'],
  dropstack:         ['daily', 'arcade'],
  wordsprint:        ['daily', 'arcade'],

  // Merged pairs — the daily id carries only the daily; its free-play twin
  // carries the rest. Both keep their own registry id.
  tilematchingdaily: ['daily'],
  tilematching:      ['story', 'arcade'],
  minefinder:        ['daily', 'story'],
  minesweeper:       ['arcade'],
  snakedaily:        ['daily'],
  snake:             ['arcade'],
  bouncedaily:       ['daily'],
  bounce:            ['story', 'arcade'],

  // Classics gaining modes for the first time
  '2048':            ['daily', 'arcade'],
  blockblast:        ['daily', 'arcade'],
  diamondrush:       ['daily', 'story', 'arcade'],
  zuma:              ['daily', 'story', 'arcade'],
  hashrush:          ['daily', 'story', 'arcade'],
  jetrun:            ['daily', 'story', 'arcade'],
  match3:            ['daily', 'story', 'arcade'],
  'knights-tour':    ['daily', 'story', 'arcade'],

  // Head-to-head: opponent is the axis, so no play modes.
  mancala:           [],
  'chutes-ladders':  [],
  checkers:          [],
  reversi:           [],
  fourinarow:        [],
  gomoku:            [],
  ludo:              [],
};

const playModesFor = (gameId) => PLAY_MODES_BY_ID[gameId] || [];
const supportsMode = (gameId, mode) => playModesFor(gameId).indexOf(mode) !== -1;

/* Daily difficulty bands (#331). Every daily is playable on Easy, Normal or
   Hard: the band is picked on the pre-game screen, rides the /start claim, is
   stored on the attempt row, and scales what a win pays
   (DAILY_BAND_MULT in 05-core-lib: easy 0.8x, normal 1x, hard 1.25x — Hard is
   the better deal per run but earns less per minute, so farming Easy is never
   the optimal strategy, mirroring the arcade's ARCADE_BAND_MULT rationale).
   Normal is byte-identical to the pre-band deal, so every seeded board and
   check keeps passing. Each band is its own seeded deal from the same day
   anchor and ranks on its own board (leaderboard ?band=).

   DAILY_BAND_NOTES is the per-game copy shown beside the picker: what changes
   on Easy and on Hard. Every id declaring a daily mode must have an entry and
   vice versa, which scripts/check-registry.js enforces — a picker row with no
   idea what its band does is exactly the drift rule 5 exists to catch. */
const DAILY_BAND_NOTES = {
  sudoku:            { easy: 'Extra givens: the gentlest dig, in either size.', hard: 'Fewest givens: the toughest dig, in either size.' },
  sudokumini:        { easy: 'Extra givens: the gentlest 6x6 dig.', hard: 'Fewest givens: the toughest 6x6 dig.' },
  wordhunt:          { easy: 'The smallest 8x8 grid, everyday words.', hard: 'The full 15x15 grid, rarer words.' },
  cryptowordle:      { easy: 'Shorter words, one extra guess each round.', hard: 'Longer words, one guess fewer each round.' },
  klondike:          { easy: 'A friendlier rated deal: more cards already in place.', hard: 'The hardest rated deal in the corpus.' },
  spider:            { easy: 'A friendlier rated deal: more cards already in place.', hard: 'The hardest rated deal in the corpus.' },
  mahjongsol:        { easy: 'The gentlest layout (Courtyard).', hard: 'The deepest layout in the set.' },
  anagrams:          { easy: 'The shortest words, the gentlest band.', hard: 'The longest words in the pool.' },
  nonogram:          { easy: 'Small, sparse grids.', hard: 'The largest, densest grids.' },
  cratepush:         { easy: 'Rooms with the fewest pushes.', hard: 'The longest rooms in the corpus.' },
  dropstack:         { easy: 'Slower gravity, friendlier pieces.', hard: 'Faster gravity, more awkward pieces.' },
  wordsprint:        { easy: 'Two full minutes on the clock.', hard: 'A 60-second sprint.' },
  tilematchingdaily: { easy: 'The gentlest layout (Courtyard).', hard: 'The tightest layout in the set.' },
  minefinder:        { easy: 'The smallest field, fewest mines.', hard: 'The largest field, most mines.' },
  snakedaily:        { easy: 'The slowest snake speed.', hard: 'Full-speed snake.' },
  bouncedaily:       { easy: 'Four balls, a sparser wall.', hard: 'Two balls, a denser wall.' },
  '2048':            { easy: 'Almost every spawn is a 2.', hard: 'Nearly a third of spawns are 4s.' },
  blockblast:        { easy: 'A gentler piece pool.', hard: 'The most awkward pieces.' },
  diamondrush:       { easy: 'A gentle band: easier digs, more moves.', hard: 'The hardest band in the ladder.' },
  zuma:              { easy: 'The gentlest path.', hard: 'The hardest path in the ladder.' },
  hashrush:          { easy: 'Slower stream, fewer hazards. Same 90-second shift.', hard: 'Fast stream, heavy hazard rate. Same 90-second shift.' },
  match3:            { easy: 'The simplest of the authored puzzles.', hard: 'The most demanding authored puzzle.' },
  'knights-tour':    { easy: 'The openest board: fewest blocked squares.', hard: 'The most blocked board.' },
};

/* The mode a game opens in when nobody said which — a bare `?game=` link, a
   resumed attempt, a practice replay.

   A DAILY REGISTRY ENTRY opens on its daily; EVERYTHING ELSE opens on free
   play (null), even when it declares modes. That asymmetry is the point: a
   classic's identity is its free play, and #176 hung modes off it rather than
   replacing it. Returning the first declared mode instead — which this did at
   first — quietly repointed every existing `?game=snake` / `?game=2048` /
   `?game=match3` share link at a mode-selection screen the sender never saw,
   and left ten of the app's own checks looking at a pre-game card where a
   board used to be. `?pmode=` is how you ask for a mode. */
function defaultPlayMode(game) {
  if (!game) return null;
  if (game.daily && supportsMode(game.id, 'daily')) return 'daily';
  return null;
}

/* The four cards that merge two registry ids. Everything else gets a card
   derived straight from its registry entry, so this table only carries the
   genuinely irregular cases. Captions are per-card copy, not per-mode
   boilerplate: "20 apples" says more than "one try". */
const MERGED_CARDS = [
  {
    key: 'card:tilematch',
    name: 'Tile Match Puzzle',
    icon: '🀄',
    tag: 'Puzzle',
    tagColor: GA.violet,
    // The blurb LEADS with the variant name ("Daily Tile Match Puzzle"):
    // a merged dapp.json test asserts it renders on the lobby card, and the
    // mode buttons say "Daily", not the variant's full name.
    desc: 'Daily Tile Match Puzzle or free play — clear layered boards three of a kind.',
    modes: [
      { mode: 'daily',  gameId: 'tilematchingdaily', caption: 'One try' },
      { mode: 'story',  gameId: 'tilematching',      caption: '10 levels' },
      { mode: 'arcade', gameId: 'tilematching',      caption: 'Endless chain' },
    ],
  },
  {
    key: 'card:minefinder',
    name: 'Mine Finder',
    icon: '💣',
    tag: 'Risk',
    tagColor: GA.coral,
    // Leads with "Mine Finder Classic" for the same reason — see the
    // Tile Match card above.
    desc: 'Mine Finder Classic or the daily field — sweep with the numbers.',
    modes: [
      { mode: 'daily',  gameId: 'minefinder',  caption: 'One run' },
      { mode: 'story',  gameId: 'minefinder',  caption: 'Bigger fields' },
      { mode: 'arcade', gameId: 'minesweeper', caption: 'Lock In' },
    ],
  },
  {
    key: 'card:snake',
    name: 'Snake',
    icon: '🐍',
    tag: 'Arcade',
    tagColor: GA.lime,
    desc: "Steer, eat, grow — don't hit a wall or your own tail.",
    modes: [
      { mode: 'daily',  gameId: 'snakedaily', caption: '20 apples' },
      { mode: 'arcade', gameId: 'snake',      caption: 'Any speed' },
    ],
  },
  {
    key: 'card:bounce',
    name: 'Bounce',
    icon: '🧱',
    tag: 'Arcade',
    tagColor: GA.coral,
    desc: 'Smash every brick with a bouncing ball.',
    modes: [
      { mode: 'daily',  gameId: 'bouncedaily', caption: '3 balls' },
      { mode: 'story',  gameId: 'bounce',      caption: 'Wall by wall' },
      { mode: 'arcade', gameId: 'bounce',      caption: 'High score' },
    ],
  },
];

// Every registry id that a merged card speaks for, so the auto-derive pass
// below skips it instead of emitting a second card for the same game.
const MERGED_IDS = new Set();
for (const c of MERGED_CARDS) for (const m of c.modes) MERGED_IDS.add(m.gameId);

// Short forms of the opponent modes, for the single-button card caption.
const OPPONENT_CAPTION = { bot: 'Bot', '2p': '2P', online: 'Online', solo: 'Solo' };

/* Assemble the ordered card list once, at load. A merged card is emitted at
   the position of the FIRST of its ids in GAMES, so the home grid keeps the
   registry's ordering rather than floating the merged ones to the top. */
function buildGameCards(games) {
  const out = [];
  const emitted = new Set();
  for (const g of games) {
    if (MERGED_IDS.has(g.id)) {
      const card = MERGED_CARDS.find(c => c.modes.some(m => m.gameId === g.id));
      if (card && !emitted.has(card.key)) { emitted.add(card.key); out.push(card); }
      continue;
    }
    const modes = playModesFor(g.id).map(mode => ({ mode, gameId: g.id, caption: null }));
    out.push({
      key: 'card:' + g.id,
      name: g.name,
      icon: g.icon,
      tag: g.tag,
      tagColor: g.tagColor,
      desc: g.desc,
      modes,          // [] for the head-to-head games — one Play button, below
      gameId: g.id,   // set only for unmerged cards; the single button's target
      // Caption under that one button. DERIVED from the registry's opponent
      // list rather than written out, so a game that gains or loses an
      // opponent can't leave its card claiming otherwise.
      playCaption: (g.modes || []).map(m => OPPONENT_CAPTION[m]).filter(Boolean).join(' · ') || null,
    });
  }
  return out;
}

const GAME_CARDS = buildGameCards(GAMES);
const CARD_BY_GAME_ID = {};
for (const c of GAME_CARDS) for (const m of c.modes) CARD_BY_GAME_ID[m.gameId] = c;
for (const c of GAME_CARDS) if (c.gameId && !CARD_BY_GAME_ID[c.gameId]) CARD_BY_GAME_ID[c.gameId] = c;

// The daily id a card locks against, if any — drives the NEW TODAY / RESUME /
// PLAYED badge. Cards with no daily mode never show one.
const cardDailyId = (card) => {
  const d = card.modes.find(m => m.mode === 'daily');
  return d ? d.gameId : null;
};

/* The registry id a PER-CARD, PER-USER control stores under: the card's
   ANCHOR id. Cards are a client-side composition and can be recomposed;
   registry ids never move, so the durable thing to write to the database is
   one of the ids the card speaks for. Reads come back through
   CARD_BY_GAME_ID, which already maps either half of a merged pair onto the
   one card. Two controls share this: the pin (#232) and the favorite star. */
const cardAnchorId = (card) => card.gameId || (card.modes[0] && card.modes[0].gameId) || null;
const cardPinId = cardAnchorId;

/* Mirrors PIN_LIMIT in server.js. Used ONLY to grey out the control once the
   player is at the cap — the server refuses the 9th pin either way, so the two
   drifting costs a stale tooltip rather than a wrong outcome. */
const PIN_LIMIT = 8;

/* ============================================================
   The card
   ============================================================
   One button per mode, or a single tap target when a card has no play modes
   (the head-to-head games, whose axis is the opponent picker inside the game).
   ============================================================ */
/* The card's all-time figure (myScores from /api/my/scores), in the
   pts -> best -> record priority, read across every registry id the card
   speaks for (a merged pair carries two: Snake / Daily Snake and friends).
   Returns null when nothing is recorded so the state line is unchanged —
   a signed-out visitor or a game never played renders exactly as before. */
const cardMyScoreBit = (card, myScores) => {
  if (!myScores) return null;
  const ids = new Set(card.modes.map(m => m.gameId));
  if (card.gameId) ids.add(card.gameId);
  let pts = 0, hasPts = false, best = 0, hasBest = false, rec = null;
  for (const id of ids) {
    const s = myScores[id];
    if (!s) continue;
    if (Number.isFinite(s.pts) && s.pts > 0) { hasPts = true; pts += s.pts; }
    if (Number.isFinite(s.best) && s.best > 0) { hasBest = true; best = Math.max(best, s.best); }
    if (s.record && (s.record.wins + s.record.losses + s.record.draws) > 0) rec = s.record;
  }
  if (hasPts) return `+${pts.toLocaleString()} pts`;
  if (hasBest) return `Best ${best.toLocaleString()}`;
  if (rec) {
    const parts = [`${rec.wins}W`, `${rec.losses}L`];
    if (rec.draws > 0) parts.push(`${rec.draws}D`);
    return parts.join(' · ');
  }
  return null;
};

function GameCard({ card, attempts, bests, storyProgress, myScores, loading, onPlay, pinned, onTogglePin, pinDisabled, streak, favorited, onToggleFavorite }) {
  const dailyId = cardDailyId(card);
  const attempt = dailyId ? attempts[dailyId] : null;
  const finished = !!(attempt && attempt.finishedAt);
  const inProgress = !!(attempt && !attempt.finishedAt);

  // State line, per recommendation 04: the card reports where you stand
  // instead of spending its width on buttons that repeat the mode labels.
  const bits = [];
  if (dailyId) bits.push(finished ? 'Daily ✓' : inProgress ? 'Daily ▶' : 'Daily · new');
  // #313 — a signed-in player's current streak rides on every card that offers
  // a daily (the merged cards included: cardDailyId covers them). Zero stays
  // off the card: a 0-day streak is not information the card needs, and the
  // nav stat still shows it.
  const storyMode = card.modes.find(m => m.mode === 'story');
  if (storyMode) {
    const p = (storyProgress && storyProgress[storyMode.gameId]) || null;
    if (p && p.total) bits.push(`Story ${p.cleared}/${p.total}`);
    else bits.push('Story');
  }
  // All-time figure LAST, so any assertion on the line's leading segments
  // ("Daily ✓", "Story 3/10") keeps passing when it appears.
  const scoreBit = cardMyScoreBit(card, myScores);
  if (scoreBit) bits.push(scoreBit);

  /* EVERY CARD ENDS IN A BUTTON. A card with one way to play used to be one
     big tap target instead, which made the grid inconsistent to read and to
     use: two cards side by side, one with labelled buttons and one where the
     art itself is the button, and no way to tell which without trying. The
     head-to-head games have exactly one way to play — against an opponent —
     so they get exactly one button that says so. */
  const singleModes = card.modes.length
    ? card.modes
    : [{ mode: null, gameId: card.gameId, caption: card.playCaption, label: 'Play' }];

  return (
    <div className="card paired" style={{ '--accent': card.tagColor }} role="group" aria-label={card.name}>
      {onTogglePin && (
        <button
          className={'card-pin tappable' + (pinned ? ' on' : '')}
          aria-pressed={pinned ? 'true' : 'false'}
          aria-label={pinned ? `Unpin ${card.name}` : `Pin ${card.name} to top`}
          title={pinned ? 'Unpin' : pinDisabled ? `Pin limit reached (${PIN_LIMIT})` : 'Pin to top'}
          disabled={!pinned && pinDisabled}
          {...tapProps(() => { onTogglePin(cardPinId(card), !pinned); }, { disabled: !pinned && pinDisabled })}
        >📌</button>
      )}
      {onToggleFavorite && (
        <button
          className={'card-fav tappable' + (favorited ? ' on' : '')}
          aria-pressed={favorited ? 'true' : 'false'}
          aria-label={favorited ? `Remove ${card.name} from favorites` : `Add ${card.name} to favorites`}
          title={favorited ? 'Remove from favorites' : 'Add to favorites'}
          {...tapProps(() => { onToggleFavorite(cardAnchorId(card), !favorited); })}
        >{favorited ? '★' : '☆'}</button>
      )}
      {dailyId && (
        <span className={'card-daily-badge' + (finished ? ' done' : inProgress ? ' resume' : ' fresh')}>
          {finished ? '✓ PLAYED' : inProgress ? '▶ RESUME' : 'NEW TODAY'}
        </span>
      )}
      <div className="card-icon">{card.icon}</div>
      <div className="card-name">{card.name}</div>
      <div className="card-desc">{card.desc}</div>
      {/* #313 — the state footer. The tag and the streak pill share one row;
          without the wrapper the pill (a flex item like the tag) drops to
          its own line and pushes the buttons down. */}
      <div className="card-footer">
        <span className="tag mono" style={{ background: card.tagColor + '22', color: card.tagColor }}>
          {card.tag}
        </span>
        {dailyId && streak > 0 && (
          <span className="card-streak mono" data-streak={streak} title={`${streak}-day streak`}>
            <span className="cs-flame" aria-hidden="true">🔥</span>
            <span>{streak}</span>
            <span className="cs-days">d</span>
          </span>
        )}
      </div>
      {bits.length > 0 && <div className="card-state mono">{bits.join(' · ')}</div>}
      <div className={'card-modes n' + singleModes.length}>
        {singleModes.map(m => {
          const isDaily = m.mode === 'daily';
          const state = isDaily ? (finished ? 'done' : inProgress ? 'resume' : 'fresh') : '';
          const label = m.label || PLAY_MODES[m.mode].label;
          const caption = m.caption
            || (isDaily ? (finished ? 'Played' : inProgress ? 'Resume' : 'One try') : null)
            || (m.mode === 'story' ? 'Levels' : m.mode === 'arcade' ? 'Endless' : null);
          return (
            <button
              key={m.mode || 'play'}
              className={`card-mode-btn tappable ${m.mode || 'single'} ${state}`}
              aria-label={`${card.name} — ${label}`}
              {...tapProps(() => { if (!loading) onPlay(m.gameId, m.mode); })}
            >
              <span className="cmb-label">{label}</span>
              <span className="cmb-caption">{caption}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
