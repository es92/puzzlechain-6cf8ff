/* ============================================================
   The flip-deck lobby — cards, shelves and the card that opens
   ============================================================
   The home screen is a card table: every game is a playing card (its category
   pip and name in the corner, its name, a square picture of its board, and the
   ways to play as small icons in the bottom-right). The CARD is the way in:
   tapping it lifts it out of its row, grows it and turns it over, and its back
   is that game's pre-game panel (`DeckOpenCard`, rendered by App). That
   replaces the old per-mode buttons on the card face — see "The card is the
   way in" in CLAUDE.md for why the one-button-per-mode rule was retired.

   The lobby is felt in BOTH themes, like a game board is: its colours are
   fixed here and in the `.fd-*` rules rather than read from `C`. Everything
   past the lobby (the pre-game route, the boards, the profile) still follows
   light/dark.
   ============================================================ */

/* Four shelves, each with a suit for its pip. A card's shelf is a property of
   the CARD (merged pairs have one), so it is keyed by card key; the
   deck-coverage self-test fails the build if a card is missing here. */
const DECK_SHELVES = [
  { id: 'puzzles', label: 'Puzzles', suit: 's' },
  { id: 'words', label: 'Words', suit: 'h' },
  { id: 'arcade', label: 'Arcade', suit: 'd' },
  { id: 'board', label: 'Board & cards', suit: 'c' },
];
const DECK_SHELF_IDS = DECK_SHELVES.map(s => s.id);
const DECK_SHELF_OF = {
  'card:sudoku': 'puzzles', 'card:minefinder': 'puzzles', 'card:2048': 'puzzles', 'card:sudokumini': 'puzzles',
  'card:nonogram': 'puzzles', 'card:blockblast': 'puzzles', 'card:tilematch': 'puzzles', 'card:cratepush': 'puzzles',
  'card:knights-tour': 'puzzles', 'card:dropstack': 'puzzles',
  'card:wordhunt': 'words', 'card:anagrams': 'words', 'card:cryptowordle': 'words', 'card:wordsprint': 'words',
  'card:dracula': 'words',
  'card:snake': 'arcade', 'card:jetrun': 'arcade', 'card:diamondrush': 'arcade', 'card:bounce': 'arcade',
  'card:zuma': 'arcade', 'card:match3': 'arcade', 'card:hashrush': 'arcade',
  'card:klondike': 'board', 'card:spider': 'board', 'card:mahjongsol': 'board', 'card:checkers': 'board',
  'card:reversi': 'board', 'card:fourinarow': 'board', 'card:mancala': 'board', 'card:gomoku': 'board',
  'card:ludo': 'board', 'card:chutes-ladders': 'board',
};
const deckShelfOf = (card) => DECK_SHELVES.find(s => s.id === DECK_SHELF_OF[card.key]) || DECK_SHELVES[0];

// Suit pips (24-unit viewBox, filled) and the play-mode icons (stroked).
const DECK_PIP = {
  s: 'M12 2.5C9.4 6.2 4.5 8.6 4.5 13a4 4 0 0 0 6.7 2.9L10 21h4l-1.2-5.1A4 4 0 0 0 19.5 13c0-4.4-4.9-6.8-7.5-10.5z',
  h: 'M12 20.5S3.5 15.3 3.5 9.3A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 8.5 2.1c0 6-8.5 11.2-8.5 11.2z',
  d: 'M12 2.5l6.8 9.5L12 21.5 5.2 12z',
  c: 'M12 3.4a3.6 3.6 0 1 1 0 7.2a3.6 3.6 0 1 1 0-7.2zM7.5 9.4a3.6 3.6 0 1 1 0 7.2a3.6 3.6 0 1 1 0-7.2zM16.5 9.4a3.6 3.6 0 1 1 0 7.2a3.6 3.6 0 1 1 0-7.2zM9 10.5h6v4H9zM11 12h2l1.2 9h-4.4z',
};
const DECK_ICON = {
  daily: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M5.3 18.7l1.5-1.5M17.2 6.8l1.5-1.5',
  story: 'M4 19h5v-5h5V9h6',
  arcade: 'M7 9a3 3 0 1 0 0 6c3 0 7-6 10-6a3 3 0 1 1 0 6c-3 0-7-6-10-6z',
  versus: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3.5 20c0-3 2.5-5.5 5.5-5.5s5.5 2.5 5.5 5.5M16 5.2a3 3 0 0 1 0 5.6M17.5 14.8c1.8.7 3 2.6 3 5.2',
  read: 'M4 5.5C4 4.7 4.7 4 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5zM20 5.5c0-.8-.7-1.5-1.5-1.5H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z',
};

// The card's colour pulled toward black: the ink of its corners and the colour
// of its back. Raw hex (tagColor is a GA value, never a C token).
const deckDeepen = (hex) => '#' + [1, 3, 5]
  .map(k => Math.round(parseInt(String(hex).slice(k, k + 2), 16) * 0.7).toString(16).padStart(2, '0')).join('');

/* Where a card stands today. `daily` is 'done' | 'live' | 'fresh' | null (no
   daily mode) — the same attempts[cardDailyId] pair the old badge read. */
function deckDailyState(card, attempts) {
  const id = cardDailyId(card);
  if (!id) return null;
  const a = attempts && attempts[id];
  if (a && a.finishedAt) return 'done';
  if (a) return 'live';
  return 'fresh';
}

/* The icons in the card's corner, as a primitive string so DeckFace can be
   memoised: 'daily:done,story,arcade'. A card with no play modes shows what its
   axis is instead — an opponent, or a book. */
function deckIconSpec(card, attempts) {
  if (!card.modes.length) {
    const g = GAMES.find(x => x.id === card.gameId);
    return g && g.modeSelect ? 'versus' : 'read';
  }
  const daily = deckDailyState(card, attempts);
  return card.modes.map(m => m.mode === 'daily' ? 'daily:' + daily : m.mode).join(',');
}

/* The face of a card. Memoised on primitives only (see DeckArt): the lobby
   re-renders every second and a face only changes when its daily does. */
const DeckFace = React.memo(function DeckFace({ cardKey, name, color, icons }) {
  const card = CARD_BY_KEY[cardKey];
  const shelf = card ? deckShelfOf(card) : DECK_SHELVES[0];
  const deep = deckDeepen(color);
  return (
    <span className="fd-card">
      <span className="fd-in" style={{ color, background: `radial-gradient(ellipse 120% 70% at 50% 0, ${color}24, transparent 70%)` }}>
        <span className="fd-corner" style={{ color: deep }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d={DECK_PIP[shelf.suit]} fill="currentColor" /></svg>
          <span className="fd-lbl">{shelf.label}</span>
        </span>
        <span className="fd-name">{name}</span>
        <span className="fd-art"><DeckArt cardKey={cardKey} /></span>
        <span className="fd-modes" style={{ color: deep }}>
          {icons.split(',').map((spec) => {
            const [m, st] = spec.split(':');
            return (
              <span key={m} className={'fd-mi' + (st === 'done' ? ' done' : st === 'live' ? ' live' : '')} data-mode={m}>
                <svg className="fd-ic" viewBox="0 0 24 24" aria-hidden="true"><path d={DECK_ICON[m]} /></svg>
              </span>
            );
          })}
        </span>
      </span>
    </span>
  );
});

const CARD_BY_KEY = {};
for (const c of GAME_CARDS) CARD_BY_KEY[c.key] = c;

/* A card on the table: the face, then a line or two under it. The whole card
   is one button and opens with the tap primitive; `onOpen` gets the card and
   the face element, which is where the open card grows from. */
function DeckCardBtn({ card, attempts, onOpen, sub, subCls, sub2, sub2Cls, live, label }) {
  return (
    <button
      type="button"
      className={'fd-cardbtn tappable' + (live ? ' live' : '')}
      aria-label={label || card.name}
      data-card={card.key}
      {...tapProps((e) => onOpen && onOpen(card, e && e.currentTarget ? e.currentTarget.querySelector('.fd-card') : null))}
    >
      <DeckFace cardKey={card.key} name={card.name} color={card.tagColor} icons={deckIconSpec(card, attempts)} />
      {sub && <span className={subCls || 'fd-sub'}>{sub}</span>}
      {sub2 && <span className={sub2Cls || 'fd-sub2'}>{sub2}</span>}
    </button>
  );
}

/* The open card's size and place, in viewport pixels: nearly the whole screen
   on a phone, a big card (still a card's proportions) in the middle on a wider
   screen. 700 is also where the back's layout switches (see the CSS). */
function deckOpenGeometry() {
  const vw = window.innerWidth || 390, vh = window.innerHeight || 844;
  if (vw < 700) {
    const h = Math.min(828, vh - 16);
    return { left: 8, top: Math.max(8, Math.round((vh - h) / 2)), width: vw - 16, height: h };
  }
  const w = Math.min(450, vw - 48), h = Math.min(700, vh - 48);
  return { left: Math.round((vw - w) / 2), top: Math.round((vh - h) / 2), width: w, height: h };
}

/* The card that opens. One element grows from the card's place in its row to
   its open size and turns over on the way; its back is the game's panel.

     from   -> sits exactly on the card in the row (no transition)
     open   -> grows and turns (0.62s), the back's content fades in late
     rest   -> settled. The 3D is switched OFF here, not just finished: a
               transform, perspective or preserve-3d ancestor is the containing
               block of every position:fixed descendant, so the leaderboards
               sheet inside the panel would otherwise open inside the card
               (and rotated). Flat text is also crisper.
     unrest -> back to the turned 3D state, invisibly, to start the close
     back   -> shrinks and turns back to the card in the row, then unmounts

   With no `src` (a deep link, a back/forward restore) it opens straight to
   `rest` and closes with a short fade. Reduced motion does the same. */
function DeckOpenCard({ card, icons, src, closing, onClose, onClosed, labelId, children }) {
  const reduced = cgReducedMotion();
  const animated = !!src && !reduced;
  const [phase, setPhase] = useState(animated ? 'from' : 'rest');
  const [geo, setGeo] = useState(deckOpenGeometry);
  const closedRef = useRef(onClosed);
  closedRef.current = onClosed;
  useScrollLock(true);

  useEffect(() => {
    const onResize = () => setGeo(deckOpenGeometry());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Two frames at the source so the browser has painted it before the
  // transition starts — one frame is not always enough to commit the styles.
  const twoFrames = (fn) => {
    let a = 0, b = 0;
    a = requestAnimationFrame(() => { b = requestAnimationFrame(fn); });
    return () => { cancelAnimationFrame(a); cancelAnimationFrame(b); };
  };
  useEffect(() => {
    if (phase === 'from') return twoFrames(() => setPhase('open'));
    if (phase === 'open') { const t = setTimeout(() => setPhase('rest'), 660); return () => clearTimeout(t); }
    if (phase === 'unrest') return twoFrames(() => setPhase('back'));
    if (phase === 'back') { const t = setTimeout(() => closedRef.current(), 640); return () => clearTimeout(t); }
    if (phase === 'fade') { const t = setTimeout(() => closedRef.current(), 200); return () => clearTimeout(t); }
    return undefined;
  }, [phase]);

  useEffect(() => {
    if (!closing) return;
    setPhase(animated ? 'unrest' : 'fade');
  }, [closing]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const atSrc = phase === 'from' || phase === 'back';
  const box = atSrc
    ? { left: src.x, top: src.y, width: src.w, height: src.w * 14 / 9 }
    : geo;
  const flat = phase === 'rest' || phase === 'fade';
  const deep = deckDeepen(card.tagColor);
  return (
    <div className={'fd-ov fd-ph-' + phase}>
      <button type="button" className="fd-ov-scrim" aria-label="Close" onClick={onClose} tabIndex={-1} />
      <div
        className={'fd-fc' + (flat ? ' flat' : '')}
        style={{ left: box.left + 'px', top: box.top + 'px', width: box.width + 'px', height: box.height + 'px' }}
      >
        <div className="fd-fc-flip" style={{ transform: flat ? 'none' : atSrc ? 'rotateY(0deg)' : 'rotateY(180deg)' }}>
          {!flat && (
            <div className="fd-fc-face fd-fc-front" aria-hidden="true">
              <DeckFace cardKey={card.key} name={card.name} color={card.tagColor} icons={icons || deckIconSpec(card, null)} />
            </div>
          )}
          <div className="fd-fc-face fd-fc-back" role="dialog" aria-modal="true" aria-labelledby={labelId} style={{ backgroundColor: deep }}>
            <div className="fd-back-frame" aria-hidden="true" />
            <div className="fd-back-scroll">
              <div className="fd-back-body" style={{ width: geo.width + 'px' }}>{children}</div>
            </div>
            <button type="button" className="fd-back-x tappable" aria-label={'Close ' + card.name} {...tapProps(() => onClose())}>
              <svg className="fd-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* The top of the card's back: its picture, its shelf and its name, and your
   all-time figure for it (cardMyScoreBit) when there is one. */
function DeckPanelHead({ card, labelId, stat }) {
  const shelf = deckShelfOf(card);
  return (
    <React.Fragment>
      <div className="fd-head">
        <span className="fd-thumb"><DeckArt cardKey={card.key} /></span>
        <div className="fd-titles">
          <div className="fd-kicker">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={DECK_PIP[shelf.suit]} fill="currentColor" /></svg>
            {shelf.label}
          </div>
          <h2 className="fd-pname" id={labelId}>{card.name}</h2>
          {stat && <div className="fd-pstat mono">{stat}</div>}
        </div>
      </div>
      <p className="fd-pdesc">{card.desc}</p>
    </React.Fragment>
  );
}

/* Daily / Story / Arcade, for a card with more than one way to play. */
function DeckModeTabs({ card, mode, dailyDone, onMode }) {
  if (card.modes.length < 2) return null;
  return (
    <div className="fd-tabs" role="tablist" aria-label="Ways to play">
      {card.modes.map(m => (
        <button
          key={m.mode}
          type="button"
          role="tab"
          aria-selected={m.mode === mode ? 'true' : 'false'}
          className={'fd-tab tappable' + (m.mode === mode ? ' on' : '')}
          data-mode={m.mode}
          {...tapProps(() => onMode(m.mode))}
        >
          <svg className="fd-ic" viewBox="0 0 24 24" aria-hidden="true"><path d={DECK_ICON[m.mode]} /></svg>
          {PLAY_MODES[m.mode].label}{m.mode === 'daily' && dailyDone ? ' ✓' : ''}
        </button>
      ))}
    </div>
  );
}

/* The daily tab once today's deal is played: the result, and the two ways on
   from it. The full result screen (board review, today's board) is a tap away. */
function DeckPlayed({ attempt, nextResetUtc, offset, onReset, onSeeResult, onPractice }) {
  const countdown = useCountdown(nextResetUtc, offset, onReset);
  const score = attempt && attempt.score != null ? attempt.score : 0;
  return (
    <div className="fd-played-wrap">
      <div className="fd-played">
        <span className="fd-played-ic" aria-hidden="true">✓</span>
        <div>
          <b>Played today · +{score} pts</b>
          <span>A new deal lands in <span className="mono">{countdown}</span>.</span>
        </div>
      </div>
      <div className="fd-duo">
        <button type="button" className="fd-ghost tappable" {...tapProps(onSeeResult)}>See today's result</button>
        {onPractice && (
          <button type="button" className="fd-ghost tappable" {...tapProps(onPractice)}>🎲 Practice run</button>
        )}
      </div>
    </div>
  );
}

/* A card with no play modes: the seven head-to-head games pick an opponent on
   their own screen, and Escape from Dracula is a book. */
function DeckNoModes({ card, onStart, onHowTo, onChat }) {
  const g = GAMES.find(x => x.id === card.gameId);
  const versus = !!(g && g.modeSelect);
  return (
    <div className="fd-nomodes">
      {versus && card.playCaption && (
        <p className="fd-blurb">Play against {card.playCaption.replace(/ · /g, ', ').replace('2P', 'a friend on this device').replace('Bot', 'the computer').replace('Online', 'someone online')}.</p>
      )}
      <button type="button" className="primary-btn fd-play tappable" {...tapProps(onStart)}>
        {versus ? 'Choose an opponent' : g && g.id === 'dracula' ? 'Start reading' : 'Play'}
      </button>
      <div className="pregame-actions">
        <button className="pregame-howto-btn" onClick={onHowTo}>❓ How to play</button>
        {onChat && <button className="pregame-howto-btn" onClick={onChat}>💬 Game chat</button>}
      </div>
    </div>
  );
}

/* Favorite and Pin, the two per-card controls the card face used to carry.
   Signed-out visitors have nowhere to store either, so they get neither. */
function DeckPanelActions({ card, favorited, onFavorite, pinned, onPin, pinDisabled }) {
  if (!onFavorite && !onPin) return null;
  return (
    <div className="fd-actions">
      {onFavorite && (
        <button
          type="button"
          className={'fd-ghost fd-fav tappable' + (favorited ? ' on' : '')}
          aria-pressed={favorited ? 'true' : 'false'}
          aria-label={favorited ? `Remove ${card.name} from favorites` : `Add ${card.name} to favorites`}
          {...tapProps(() => onFavorite(cardAnchorId(card), !favorited))}
        >{favorited ? '★ Favorite' : '☆ Favorite'}</button>
      )}
      {onPin && (
        <button
          type="button"
          className={'fd-ghost fd-pin tappable' + (pinned ? ' on' : '')}
          aria-pressed={pinned ? 'true' : 'false'}
          aria-label={pinned ? `Unpin ${card.name}` : `Pin ${card.name} to the top`}
          disabled={!pinned && pinDisabled}
          title={!pinned && pinDisabled ? `Pin limit reached (${PIN_LIMIT})` : undefined}
          {...tapProps(() => onPin(cardPinId(card), !pinned), { disabled: !pinned && pinDisabled })}
        >{pinned ? '📌 Pinned' : '📌 Pin'}</button>
      )}
    </div>
  );
}

/* The dailies row's order: what you are in the middle of, then the game of
   the day, then the rest by how much you have played them, then what is done.
   "How much" is the all-time points a card's daily has earned you
   (/api/my/scores) — the one per-game measure of play the client already
   holds. Ties keep registry order. */
function deckDailyOrder(cards, attempts, myScores, featuredId) {
  const rank = (c) => {
    const s = deckDailyState(c, attempts);
    if (s === 'live') return 0;
    if (s === 'done') return 3;
    return cardDailyId(c) === featuredId ? 1 : 2;
  };
  const played = (c) => {
    const s = myScores && myScores[cardDailyId(c)];
    return s && Number.isFinite(s.pts) ? s.pts : 0;
  };
  return cards
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || played(b.c) - played(a.c) || a.i - b.i)
    .map(x => x.c);
}

/* The Game of the day, as a banner: its card (tilted, the way in like every
   other card), what it is, when the deal changes, and a Play button that opens
   the same card on its daily. */
function DeckHero({ card, game, attempts, attempt, authOk, nextResetUtc, offset, onReset, onOpen }) {
  const countdown = useCountdown(nextResetUtc, offset, onReset);
  const finished = !!(attempt && attempt.finishedAt);
  const inProgress = !!attempt && !finished;
  const wrapRef = useRef(null);
  const shelf = deckShelfOf(card);
  const openFromButton = () => {
    const face = wrapRef.current ? wrapRef.current.querySelector('.fd-card') : null;
    onOpen(card, face);
  };
  return (
    <section className="fd-hero" aria-labelledby="fd-hero-h">
      <div className="fd-hero-in">
        <div className="fd-hero-top"><span>Game of the day</span><span className="fd-cd">New deal in {countdown}</span></div>
        <div className="fd-hero-cardwrap" ref={wrapRef}>
          <DeckCardBtn card={card} attempts={attempts} onOpen={onOpen} label={'Open ' + game.name} />
        </div>
        <div className="fd-hero-info">
          <h1 className="fd-hero-name" id="fd-hero-h">{game.name}</h1>
          <p className="fd-hero-desc">{game.desc}</p>
          <p className="fd-hero-meta">{shelf.label} · Same deal for everyone · Keeps your streak</p>
          {authOk === false && (
            <p className="fd-hero-guest">Play today's deal free as a guest — sign in to join the board and keep a streak.</p>
          )}
        </div>
        <button type="button" className="fd-btn fd-hero-btn tappable" {...tapProps(openFromButton)}>
          {finished ? `Played today · +${attempt.score != null ? attempt.score : 0}` : inProgress ? "Resume today's deal" : "Play today's deal"}
        </button>
      </div>
    </section>
  );
}
