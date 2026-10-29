/* ============================================================
   Root app
   ============================================================ */
// Next-milestone progress hints so a player who finished today sees concrete
// progress even when no badge unlocked this run (e.g. "🔥 2/3 days → On Fire",
// "7/10 solves → Solver"). Each is the nearest UNEARNED milestone of its kind.
function badgeProgressHints(streak, solveCount) {
  const hints = [];
  const ns = nextStreakBadge(streak);
  if (ns) hints.push({ key: 'streak', icon: '🔥', text: `${streak}/${ns.min} days → ${ns.name}` });
  const nm = nextSolveMilestone(solveCount);
  if (nm) hints.push({ key: 'solve', icon: nm.icon, text: `${solveCount || 0}/${nm.count} solves → ${nm.name}` });
  return hints;
}

/* #241 — the earned score, counted up. The rule this is built around: the
   REAL number is what renders first, and the count-up only ever starts from
   INSIDE a frame that actually ran. A screenshot capture and a throttled
   background tab both fire no rAF at all, and a card that reads "+0" because
   its animation never started would be worse than no animation — so the
   fallback is the finished state, not the opening one. It always lands on the
   exact value, and `data-win-earned` carries it whatever the frame count. */
const WIN_COUNT_MS = 620;
function WinEarned({ value }) {
  const n = Number.isFinite(value) ? value : 0;
  const [shown, setShown] = useState(n);
  useEffect(() => {
    setShown(n);
    if (cgReducedMotion() || n <= 0) return;
    let raf = 0, start = 0, alive = true;
    const step = (t) => {
      if (!alive) return;
      if (!start) start = t;
      const p = Math.min(1, (t - start) / WIN_COUNT_MS);
      setShown(Math.round(n * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { alive = false; if (raf) cancelAnimationFrame(raf); };
  }, [n]);
  return <span className="we-v" data-win-earned={n}>+{shown}</span>;
}

/* Copy-to-clipboard Share button for the win/loss result cards. Declared at
   MODULE scope on purpose, and this is the whole of issue #340: defined
   inside App it got a new function identity on every App render, and React
   treats a changed component type as an unmount-plus-remount — so the button
   was rebuilt (local state wiped) on every timer tick and every state update
   behind the card. Measured on the open win card: seven distinct DOM elements
   in four seconds. A player who tapped Share saw "Copied!" flash for a few
   hundred milliseconds and revert, or saw nothing at all when the copy
   resolved after the remount had orphaned the setState — a dead button.
   Module scope keeps the identity stable so the feedback survives re-renders.
   The copy itself goes through copyText (clipboard API, then an execCommand
   fallback) and says so when neither path worked, instead of failing silently. */
function ShareButton({ text }) {
  const [copied, setCopied] = useState(null); // null | 'ok' | 'fail'
  if (!text) return null;
  const copy = () => {
    copyText(text).then((ok) => {
      setCopied(ok ? 'ok' : 'fail');
      setTimeout(() => setCopied(null), ok ? 1500 : 2600);
    });
  };
  return (
    <button
      className="primary-btn tappable"
      data-share-btn="1"
      style={{ background: C.text, marginBottom: '0.6rem' }}
      {...tapProps(copy)}
    >
      {copied === 'ok' ? 'Copied!' : copied === 'fail' ? "Couldn't copy. Try again." : 'Share result'}
    </button>
  );
}


function App() {
  const [screen, setScreen] = useState(() => {
    // Support ?screen=friends / ?screen=session deep links for testing.
    // ?screen=account (the retired Account screen) now lands on the viewer's
    // own profile — but the user id isn't known until /api/daily resolves,
    // so it's handled by the pendingSelfProfile effect below.
    const params = new URLSearchParams(window.location.search);
    const s = params.get('screen');
    if (s === 'friends') return 'friends';
    return 'lobby';
  }); // 'lobby' | 'game' | 'locked' | 'profile' | 'friends'
  const [currentGame, setCurrentGame] = useState(null);
  /* #176 — which of the three play modes the current game was opened in.
     null means "no play-mode axis": the head-to-head games, whose axis is the
     opponent picker inside the game. `arcadeBandId` is only meaningful while
     playMode === 'arcade'; `storyBand` only while playMode === 'story'. */
  const [playMode, setPlayMode] = useState(null);
  const [arcadeBandId, setArcadeBandId] = useState('normal');
  const [storyBand, setStoryBand] = useState(0);
  /* #331 — which difficulty the current daily run is on. Seeded from the
     remembered pref (02-prefs-theme's cgDailyBandPref), changed on the
     pre-game band picker, sent on the /start claim, and restored from a
     resumed attempt row (whose band is authoritative). */
  const [dailyBandId, setDailyBandId] = useState(() => cgDailyBandPref());
  const setDailyBand = (b) => {
    const v = isDailyBand(b) ? b : 'normal';
    setDailyBandId(v);
    cgSetDailyBandPref(v);
  };
  /* The band a PRACTICE replay runs under: the attempt row's band when the
     replay was asked for from a result card or the locked screen (you are
     replaying the deal you actually played), else Normal (`?practice=1`). */
  const [practiceBandId, setPracticeBandId] = useState('normal');
  // Refs shadowing the two above, so startRun can read them without waiting a
  // render when a deep link sets the mode and starts the run in one go.
  const playModeRef = useRef(playMode);   playModeRef.current = playMode;
  const arcadeBandRef = useRef(arcadeBandId); arcadeBandRef.current = arcadeBandId;
  const dailyBandRef = useRef(dailyBandId);   dailyBandRef.current = dailyBandId;
  // gameId -> { cleared, total } for the card state line and the story picker.
  const [storyProgress, setStoryProgress] = useState({});
  /* Pinned games (#232): the CARD ANCHOR ids this player pinned, in the order
     the server holds them. The array is the server's, replaced wholesale on
     every toggle — the client never recomputes the cap. Deliberately NOT a
     navState field: a pin changes what the home grid looks like, not which
     screen you are on, so it must not push a history entry. */
  const [pins, setPins] = useState([]);
  // Recently Played (Recent goal): the viewer's last few plays, as
  // [{ gameId, playedAt }] from /api/daily. Most recent first.
  const [recentPlays, setRecentPlays] = useState([]);
  // Transient "you are at the cap" line, cleared on the next successful pin.
  const [pinNotice, setPinNotice] = useState('');
  /* Favorited games: the CARD ANCHOR ids this player starred, in the order
     the server holds them. Same shape as `pins` above — the array is the
     server's, replaced wholesale on every toggle. Also deliberately NOT a
     navState field: a star changes which cards the active chip shows, not
     which screen you are on, so it must not push a history entry. */
  const [favorites, setFavorites] = useState([]);
  /* The flip-deck lobby's open card: { key, mode, story, arcade, daily, src,
     closing }, null when no card is open. The pre-game panel on the card's back
     keeps its OWN mode and bands (null = the default) and writes them into
     App's playMode / storyBand / … only when Play is pressed. Those fields are
     part of navState's page key: changing them under the open card would push
     a history entry per tab and scroll the lobby to the top behind it (#239).
     The open card itself is an overlay in navState, like Settings, so device
     back closes it. */
  const [deckOpen, setDeckOpen] = useState(null);
  const [deckArcadeBest, setDeckArcadeBest] = useState(null);
  // The viewer's standing on the arcade band currently selected, so the
  // pre-game screen can show what there is to beat before the run starts.
  const [arcadeBest, setArcadeBest] = useState(null);
  const [totalScore, setTotalScore] = useState(0);
  const [streak, setStreak] = useState(0);
  // All-time best daily streak (#362) — one figure for the player, shown
  // beside the current streak on every daily card. Never below the current
  // streak in cardProps, so an optimistic bump never under-shoots it.
  const [bestStreak, setBestStreak] = useState(0);
  // Permanent earned streak-milestone day thresholds (e.g. [3, 7, 30]) — kept
  // even after a streak resets, so the lobby can show a collected-badges strip.
  const [badges, setBadges] = useState([]);
  // Non-streak achievement badges earned: { types: [...], milestones: [...] }.
  const [achievements, setAchievements] = useState({ types: [], milestones: [], stories: [] });
  // Lifetime won-solve count (server-computed), used to drive the
  // "X/Y solves → Solver" next-milestone progress hint.
  const [solveCount, setSolveCount] = useState(0);
  const [winData, setWinData] = useState(null);
  const [loseData, setLoseData] = useState(null);
  // Server-backed per-day attempt state, keyed by game id.
  // { [gameId]: { score, steps, timeSecs, startedAt, finishedAt } }
  const [attempts, setAttempts] = useState({});
  const [nextResetUtc, setNextResetUtc] = useState(null);
  const [offset, setOffset] = useState(0); // serverNow - clientNow (ms)
  const [loading, setLoading] = useState(true);
  // Live step count from the running game. Held in a REF, not state (slice 1):
  // nothing renders it, and the old useState re-rendered the whole App tree on
  // every tap of every game — a measurable part of the input latency the grid
  // dailies were reported for. Kept because launch/resume seed it and future
  // chrome may want to read it.
  const stepCountRef = useRef(0);
  const setStepCount = (n) => { stepCountRef.current = typeof n === 'number' ? n : 0; };
  const [user, setUser] = useState(null);       // { username, id, usernodePubkey }
  const [authOk, setAuthOk] = useState(true);    // false → signed-out / DB unreachable
  // Review round 1: /api/daily failing with a 5xx (or an unreachable server)
  // used to degrade the lobby to the guest view with nothing said — the hero
  // and In progress simply vanished. A 401 is the normal signed-out lobby;
  // only a backend failure sets this, and the hero position then carries an
  // inline notice with a refetch instead.
  const [dailyErr, setDailyErr] = useState(false);
  const [, setTick] = useState(0); // 1s heartbeat to keep lobby countdowns live
  // Lobby view (phase 7 home reorg): 'home' is the single scrolling home
  // (GotD hero → in-progress → all games); 'ladder' is the one remaining
  // sub-screen. Legacy ?tab=daily/classic/feed deep links land on home (the
  // Community Feed was retired — chat, share cards, and Friends boards are
  // the social surface now).
  const [lobbyTab, setLobbyTab] = useState(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    return t === 'ladder' ? 'ladder' : 'home';
  });
  // End-screen board review (slice 4): true while the results card is tucked
  // into its minibar and the finished board is on show underneath.
  const [reviewMode, setReviewMode] = useState(() =>
    new URLSearchParams(window.location.search).get('review') === '1'
  );
  /* PHASE 4 (#133) — practice replay. Replays TODAY'S exact puzzle with the
     score shown but never recorded: no /start, no /finish, no /progress, no
     dailyRunLog entry, and handleWin/handleLose bail out early so streak,
     badges, bests and leaderboards cannot move. */
  /* A replay re-runs one past board. It is deliberately INERT — practiceMode
     is on, so handleWin/handleLose stop before any endpoint. Otherwise the
     cheapest way to top an arcade board would be to replay the friendliest
     seed you ever drew until you played it perfectly, which is the opposite of
     what a fresh-board-every-run mode is for. */
  const [arcadeReplaySeed, setArcadeReplaySeed] = useState(null);
  const arcadeRunIdRef = useRef(null);
  const [practiceMode, setPracticeMode] = useState(() =>
    new URLSearchParams(window.location.search).get('practice') === '1'
  );
  const [practiceResult, setPracticeResult] = useState(null);
  /* #367 — true when this run was dealt a RANDOM board from the pre-game
     screen's Practice button (or `?practice=random`), false for a replay of
     today's deal ("Play again for fun", `?practice=1`). Only changes the card's
     wording and where "Another practice run" draws its seed from. */
  const [practiceFresh, setPracticeFresh] = useState(false);
  // #122 — is the locked-day review board on show (vs the result card)?
  const [lockedReview, setLockedReview] = useState(() =>
    new URLSearchParams(window.location.search).get('review') === '1'
  );
  // PHASE 4 (#132) — force the offline-sync card so its reworded copy is
  // reachable by a screenshot/proposal test without unplugging the network.
  const [syncFailDemo] = useState(() =>
    new URLSearchParams(window.location.search).get('syncfail') === '1'
  );
  // Merged-grid filter (slice 2). The retired ?tab=daily / ?tab=classic deep
  // links now preselect the matching chip instead of being ignored, which is
  // also what keeps the existing "/?tab=classic" proposal checks meaningful.
  const [homeFilter, setHomeFilter] = useState(() => {
    // The chips are the deck's shelves (Puzzles, Words, …) plus Favorites. The
    // retired Daily / Classic chips' links (?tab=daily|classic) land on All:
    // the dailies have their own row above the shelves now.
    const t = new URLSearchParams(window.location.search).get('tab');
    return DECK_SHELF_IDS.indexOf(t) !== -1 || t === 'favorites' ? t : 'all';
  });
  /* ?favview=1 preselects the Favorites chip. Deliberately separate from
     ?tab=favorites: ?tab= is a REAL chip a player can reach by tapping, and
     its deep link already exists for the daily/classic chips — but it is also
     the query the signed-out 401 lands on, and the chip only renders signed
     in. favview is for the proposal checks (which stage an authed capture
     identity), and it only ever sets the same chip; there is nothing to
     restore in a history entry because a deep link IS the history entry. */
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('favview') === '1') {
      setHomeFilter('favorites');
    }
  }, []);
  // #350 — home grid search. App-level state like homeFilter, so what you
  // typed survives going into a game and back and resets on reload.
  // Deliberately NOT part of navState: typing must not push a history entry
  // per keystroke. ?gamesearch= only seeds the initial value (the checks can
  // navigate but cannot type); it is capped so a giant URL cannot bloat state.
  const [homeSearch, setHomeSearch] = useState(() =>
    (new URLSearchParams(window.location.search).get('gamesearch') || '').slice(0, 60)
  );
  // Game of the Day (phase 7): { date, gameId, seed } from daily_featured.
  const [featured, setFeatured] = useState(null);
  // The viewer's active online matches (your-turn row), from /api/rooms/mine.
  const [myRooms, setMyRooms] = useState([]);
  // Game whose public chat room is open (null = closed).
  const [chatGame, setChatGame] = useState(null);
  // Phase 8 "make it count": banner shown after a pending anonymous run was
  // retroactively committed on an authenticated load.
  const [commitNotice, setCommitNotice] = useState(null);
  // What's-new sheet, opened from Settings (the "New this week" strip on the
  // lobby was retired with the flip-deck redesign).
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Incremented to trigger MinesweeperGame reset on Play Again
  const [playAgainKey, setPlayAgainKey] = useState(0);
  /* #185 — auto-advance between Ladder bands. One object drives the whole
     overlay: { gameId, phase, fromBand, toBand, total, awarded, firstClear,
     secs, win }, where phase is 'tally' | 'count' | 'complete' and `win` is
     the result card to fall back to if the player cancels. null = no overlay.
     Every timer that drives it lives in the ref so ANY exit path can clear all
     of them at once (see clearAdvanceTimers). */
  const [advance, setAdvance] = useState(null);
  const advanceTimers = useRef([]);
  // Classic Games — Game Menu state. `classicGameMode` is the active mode of
  // the current classic game ('bot' | '2p' | 'online' | null); `classicLastResult`
  // is the most recent finished classic result so the menu's Post to Feed works
  // even after Play Again.
  const [classicGameMode, setClassicGameMode] = useState(null);
  const [classicGameModeOpts, setClassicGameModeOpts] = useState(null);
  const [classicLastResult, setClassicLastResult] = useState(null);
  // The game whose opponent screen is open (multi-mode classic games — the
  // five board games, Mancala, Snakes & Ladders, 2048, Block Fit).
  const [preLaunchGame, setPreLaunchGame] = useState(null);
  /* Opening the opponent screen is two pieces of state — which game, and the
     screen itself — so it gets one function. Setting only the first is how the
     old modal worked and there is no reason to keep that shape now it is a
     screen the back button and history have to know about. */
  const openOpponentScreen = (g) => {
    if (!g) return;
    endPracticeRun();   // #367 — never let a practice seed reach a real run
    setCurrentGame(g);
    setPreLaunchGame(g);
    setClassicGameMode(null);
    setClassicGameModeOpts(null);
    setWinData(null);
    setLoseData(null);
    setPracticeMode(false);
    setScreen('opponent');
  };
  // Shell-owned chrome (phase 3): all-time personal bests per daily game
  // (from /api/daily), and the game whose How-to-Play modal is open (null =
  // closed). The modal renders above every screen/shell.
  const [bests, setBests] = useState({});
  // All-time per-game figures (/api/my/scores): pts (daily points), best
  // (classic/PB-table best), record (head-to-head W/L/D). Consumed by the
  // home cards' state line and the profile's "All-time scores" section.
  const [myScores, setMyScores] = useState({});
  const [howToGame, setHowToGame] = useState(null);
  // Social: profile viewing and friends list
  const [selectedUserId, setSelectedUserId] = useState(null);
  // ?screen=account / ?screen=profile deep links open the viewer's OWN
  // profile, which needs the user id from /api/daily — remembered here and
  // consumed once the load settles.
  const pendingSelfProfile = useRef((() => {
    const s = new URLSearchParams(window.location.search).get('screen');
    // 'badges' is the literal deep link to the badge collection; there is no
    // separate badge screen, the collection lives in the profile's BadgeStrip.
    return s === 'account' || s === 'profile' || s === 'badges';
  })());

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  /* ============================================================
     PHASE 4 (#134, part two) — browser/platform history.
     There was NO pushState / replaceState / popstate anywhere in this file, so
     the device back gesture exited the app instead of unwinding a screen — from
     a game, a profile, the Friends list, the Ladder, and every overlay. One
     reducer owns it:
       • every navigable state pushes one entry;
       • popstate DERIVES state from the event (never navigates imperatively),
         so back unwinds review → results → screen → home one step at a time;
       • a change caused BY a pop must not push again (navLock);
       • existing deep-link params survive — the URL keeps them so a mid-flow
         reload lands in the same place.
     ============================================================ */
  const navLock = useRef(false);
  const navReady = useRef(false);
  /* #186 — how many entries OF OURS are behind this one. The in-app back
     control needs to know whether there is somewhere of ours to go back TO:
     at depth 0 the previous entry belongs to whoever loaded us, and this app
     runs in an iframe, so calling history.back() there steps the EMBEDDING
     page out of the app rather than unwinding a screen. Stored on the entry
     as well as held in a ref, so a reload or a pop restores the count instead
     of guessing it. */
  const navDepth = useRef(0);
  /* A render-visible mirror of the ref, so the root can carry the depth as an
     attribute. It is deliberately NOT part of navState: it changes as a RESULT
     of a push, and putting it in would make every push cause another one. */
  const [navDepthTick, setNavDepthTick] = useState(0);

  /* The single description of "where am I", used for both push and restore.
     EVERY field must be a primitive: this object is JSON.stringify'd on each
     render, and one DOM-bearing value (a stray SyntheticEvent — see #150)
     throws "Converting circular structure to JSON", which with no error
     boundary above it unmounted the entire root. `navPrimitive` is the
     barrier; the `nav-state-primitives` self-test asserts it holds. */
  const navState = {
    screen: navPrimitive(screen),
    gameId: currentGame ? navPrimitive(currentGame.id) : null,
    lobbyTab: navPrimitive(lobbyTab),
    selectedUserId: navPrimitive(selectedUserId),
    reviewMode: !!reviewMode,
    practiceMode: !!practiceMode,
    /* #367 — a random practice board is part of "where am I": back/forward has
       to land on the same board, not on today's. The seed is a primitive. */
    practiceFresh: !!practiceFresh,
    practiceSeed: practiceFresh ? navPrimitive(practiceRunSeed()) : null,
    /* #176 — the play mode is part of "where am I". Two entries for the same
       game in different modes are different places, and without this, going
       back from an arcade run to the pre-game screen restored the screen but
       not the mode it was showing. Primitives, per the barrier above. */
    playMode: navPrimitive(playMode),
    storyBand: Number.isFinite(storyBand) ? storyBand : 0,
    arcadeBandId: navPrimitive(arcadeBandId),
    dailyBandId: navPrimitive(dailyBandId),
    /* The open card counts only on the lobby: leaving for a game takes it
       away (the effect below clears it a render later), and that must not
       write a second history entry for the game screen. */
    overlay: settingsOpen ? 'settings' : howToGame ? 'howto' : chatGame ? 'chat' : whatsNewOpen ? 'whatsnew'
      : deckOpen && screen === 'lobby' ? 'card' : null,
    overlayArg: navPrimitive(howToGame ? howToGame.id : chatGame ? (chatGame.id || chatGame)
      : deckOpen && screen === 'lobby' ? deckOpen.key : null),
  };
  const navKey = JSON.stringify(navState);

  /* #239 — "start at the top of the page in any case".
     Nothing reset the scroll position on navigation, and the home grid is
     ~4500px tall on a phone. The browser clamps scrollY to the new document's
     height, which HID the bug on a tall screen against a short target: tap a
     game from the bottom of the grid on a 844px phone and the pre-game screen
     happens to be exactly 844px, so you land at 0 by accident. Anywhere the
     target is taller you land mid-page — tapping the account chip from the
     bottom of the grid opened the profile at scrollY 844 of 1688, below its
     own header, and on a 420px-tall viewport a game's header sat 195px above
     the top of the screen.

     This is deliberately keyed off the PAGE, not off navKey: navKey also
     changes when an overlay opens, and scrolling the page out from under a
     modal you just opened is its own bug. Overlay and overlayArg are the two
     fields left out.

     A POP is left alone. The early return below already covers it (navLock),
     and it is the right behaviour: back should put you where you were, not at
     the top of a screen you have already read. */
  const navPageKey = JSON.stringify({ ...navState, overlay: null, overlayArg: null });
  const navPageReady = useRef(false);
  useEffect(() => {
    if (navLock.current) return;          // a pop — the push effect clears the flag
    if (!navPageReady.current) {          // first mount: already at the top
      navPageReady.current = true;
      return;
    }
    try { window.scrollTo(0, 0); } catch {}
  }, [navPageKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (navLock.current) { navLock.current = false; return; }
    try {
      // Keep the query string intact so ?game=, ?tab=, ?theme=, ?chat= … all
      // still work after a reload mid-flow.
      const url = window.location.pathname + window.location.search + window.location.hash;
      if (!navReady.current) {
        navReady.current = true;
        navDepth.current = navDepthOf(window.history.state);
        window.history.replaceState({ un: navState, unDepth: navDepth.current }, '', url);
      } else {
        navDepth.current += 1;
        window.history.pushState({ un: navState, unDepth: navDepth.current }, '', url);
      }
      setNavDepthTick(navDepth.current);
    } catch {}
  }, [navKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onPop = (e) => {
      const s = e.state && e.state.un;
      navLock.current = true;
      navDepth.current = navDepthOf(e.state);
      setNavDepthTick(navDepth.current);
      if (!s) {
        // Popped past our first entry — land on home rather than a blank state.
        setScreen('lobby'); setCurrentGame(null); setReviewMode(false);
        setSettingsOpen(false); setHowToGame(null); setChatGame(null); setWhatsNewOpen(false);
        setDeckOpen(null);
        return;
      }
      // Overlays first: closing one is the cheapest back step.
      setSettingsOpen(s.overlay === 'settings');
      setWhatsNewOpen(s.overlay === 'whatsnew');
      setHowToGame(s.overlay === 'howto' ? (GAMES.find(g => g.id === s.overlayArg) || null) : null);
      setChatGame(s.overlay === 'chat' ? (GAMES.find(g => g.id === s.overlayArg) || null) : null);
      /* The open card comes back without its animation (there is no card on
         screen to grow from) and goes away at once: a close that animated
         would finish after this pop and push an entry of its own. A card that
         is already open stays as it is — a pop off the How-to-Play sheet it
         opened lands back on it. */
      setDeckOpen((prev) => {
        if (s.overlay !== 'card' || !CARD_BY_KEY[s.overlayArg]) return null;
        if (prev && prev.key === s.overlayArg) return { ...prev, closing: false };
        return { key: s.overlayArg, mode: null, story: null, arcade: null, daily: null, src: null, closing: false };
      });
      setLobbyTab(s.lobbyTab || 'home');
      setSelectedUserId(s.selectedUserId || null);
      setReviewMode(!!s.reviewMode);
      setPracticeMode(!!s.practiceMode);
      setPracticeFresh(!!s.practiceFresh);
      if (s.practiceMode && s.practiceFresh && Number.isFinite(s.practiceSeed)) {
        beginPracticeRun(s.practiceSeed);
      }
      setPlayMode(isPlayMode(s.playMode) ? s.playMode : null);
      setStoryBand(Number.isFinite(s.storyBand) ? s.storyBand : 0);
      setArcadeBandId(ARCADE_BAND_IDS.indexOf(s.arcadeBandId) !== -1 ? s.arcadeBandId : 'normal');
      setDailyBandId(isDailyBand(s.dailyBandId) ? s.dailyBandId : 'normal');
      if (s.screen === 'game' || s.screen === 'pregame' || s.screen === 'locked' || s.screen === 'opponent') {
        const g = GAMES.find(x => x.id === s.gameId);
        if (g) {
          setCurrentGame(g);
          // The opponent screen reads preLaunchGame, so a pop back onto it has
          // to restore that too or it renders nothing.
          setPreLaunchGame(s.screen === 'opponent' ? g : null);
          setScreen(s.screen);
        }
        else { setCurrentGame(null); setScreen('lobby'); }
      } else {
        setCurrentGame(null);
        setScreen(s.screen || 'lobby');
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /* PHASE 3 — document-level scroll lock while a run is live. `fitShell` only
     covers dailies that opted in and shell:'self' games bypass it entirely, so
     locking the document is what makes "nothing scrolls during play" true for
     all 33 games. Released the moment a result screen appears (that scrolls). */
  useScrollLock((screen === 'game' && !!currentGame && !winData && !loseData && !practiceResult) || !!advance);

  /* #367 — belt and braces for the practice seed: anything that clears
     practiceMode without going through startRun/launchGame/backToLobby
     (a popstate, say) closes it too, so no later board can draw from it. */
  useEffect(() => { if (!practiceMode) endPracticeRun(); }, [practiceMode]);

  /* #185 — Escape leaves the countdown (falling back to the ordinary result
     card), and any unmount clears every pending timer so nothing can start a
     band on a screen the player has left. */
  useEffect(() => {
    if (!advance) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') dismissAdvance(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => () => {
    advanceTimers.current.forEach(t => clearTimeout(t));
    advanceTimers.current = [];
  }, []);

  // Per-run daily move log (phase 2). Every daily game feeds move events with
  // client timestamps into this ref — the Daily Tile Match via its native
  // onMoveTile (engine-shaped { tileType } moves, replay-eligible), the other
  // dailies via their onStepChange calls (timestamp-only events for the
  // server's tier-B timing heuristics). `replayOk` goes false when the run
  // can't be fully replayed server-side: a resume (earlier moves predate this
  // mount) or a booster (not modeled by the replay engine). Submitted with
  // /finish; reset by launchGame so a retry re-sends the same log.
  const dailyRunLog = useRef({ moves: [], replayOk: true });
  const recordDailyMove = (m) => {
    const log = dailyRunLog.current;
    if (m && m.replayBreak) log.replayOk = false;
    if (log.moves.length < 800) {
      log.moves.push({ ...m, tsClient: m && m.tsClient != null ? m.tsClient : Date.now() });
    }
  };

  // Hydrate today's locked/result state from the server on mount, and
  // recompute the score from finished attempts so it survives reloads.
  // Phase 8 "make it count": on an authenticated load, retroactively commit
  // any SAME-DAY pending anonymous runs through POST /api/daily/:gameId/commit
  // (full validation parity with normal finishes), then clear the local slot.
  // Expired (410), already-played (409), or invalid (400) runs are discarded —
  // boards freeze at midnight UTC and a signed-in run always stands. Server
  // hiccups keep the run for a retry on the next load.
  const commitPendingRuns = async (daily) => {
    const runs = loadPendingRuns();
    const ids = Object.keys(runs);
    if (!ids.length) return;
    const serverDayNum = Math.floor(new Date(daily.serverNowUtc).getTime() / 86400000);
    for (const gid of ids) {
      const run = runs[gid];
      const game = GAMES.find((g) => g.id === gid);
      if (!run || !game || run.dayNum !== serverDayNum || !(run.score > 0)) {
        clearPendingRun(gid);
        continue;
      }
      if (daily.attempts && daily.attempts[gid] && daily.attempts[gid].finishedAt) {
        clearPendingRun(gid); // already played signed-in — that run stands
        continue;
      }
      try {
        const { ok, status, body } = await api(`/api/daily/${gid}/commit`, {
          method: 'POST',
          body: JSON.stringify({
            seed: run.seed, score: run.score, steps: run.steps, timeSecs: run.secs,
            band: run.band,
            moves: Array.isArray(run.moves) ? run.moves : [],
            replay: run.replay === true,
          }),
        });
        if (ok && body && body.attempt) {
          setAttempts((prev) => ({ ...prev, [gid]: body.attempt }));
          if (typeof body.streak === 'number') setStreak(body.streak);
          if (typeof body.bestStreak === 'number') setBestStreak(body.bestStreak);
          setTotalScore((t) => t + (body.attempt.score || 0));
          setCommitNotice(`✅ Your guest ${game.name} run now counts — you're on today's board!`);
          clearPendingRun(gid);
        } else if (Number.isFinite(status) && status !== 500 && status !== 0) {
          clearPendingRun(gid);
        }
      } catch {}
    }
  };

  const loadDaily = async () => {
    const params = new URLSearchParams(window.location.search);
    const demo = params.get('demo');
    const path = '/api/daily' + (demo ? `?demo=${encodeURIComponent(demo)}` : '');
    // ?demo=signedout: render the guest lobby WITHOUT making the call at all.
    // The server fixture answers it 401 on purpose, but the browser logs every
    // 4xx response as a console error, and the platform's per-test console
    // gate fails the route for it — the fixture's own mechanics failed the
    // screen it exists to demonstrate. Skipping straight to the guest branch
    // renders the identical state with a clean console; the server fixture
    // stays for direct API checks.
    const { ok, status, body } = demo === 'signedout'
      ? { ok: false, status: 401, body: null }
      : await (async () => {
          try { return await api(path); }
          catch {
            // A network throw is a backend failure, not a signed-out one —
            // land it in the same error state as a 5xx instead of leaving
            // the lobby on its loading skeleton forever.
            return { ok: false, status: 0, body: null };
          }
        })();
    // Signed out ({ signedIn: false }, or a 401) → the normal guest lobby;
    // 5xx / unreachable → the error notice.
    setDailyErr(!ok && (status === 0 || status >= 500));
    if (ok && body && body.signedIn !== false) {
      GUEST_MODE = false;
      setAuthOk(true);
      setUser(body.user || null);
      setAttempts(body.attempts || {});
      setNextResetUtc(body.nextResetUtc);
      setStreak(typeof body.streak === 'number' ? body.streak : 0);
          setBestStreak(typeof body.bestStreak === 'number' ? body.bestStreak : 0);
      setSolveCount(Number.isFinite(body.solveCount) ? body.solveCount : 0);
      setBadges(Array.isArray(body.badges) ? body.badges : []);
      setAchievements(body.achievements && Array.isArray(body.achievements.types)
        ? {
            types: body.achievements.types,
            milestones: body.achievements.milestones || [],
            stories: body.achievements.stories || [],
          }
        : { types: [], milestones: [], stories: [] });
      // Server-issued daily seeds — must land before any daily game mounts
      // (they do: games launch from the lobby, which renders after loading).
      SERVER_DAILY_SEEDS = body.seeds || {};
      setBests(body.bests || {});
      setPins(Array.isArray(body.pins) ? body.pins : []);
      setRecentPlays(Array.isArray(body.recentPlays) ? body.recentPlays : []);
      setFavorites(Array.isArray(body.favorites) ? body.favorites : []);
      /* #176 — story progress is loaded alongside the daily state rather than
         folded into it: it is not day-scoped, so it does not belong on a route
         whose whole contract is "today". Failure is silent because the home
         grid degrades to showing no ladder counts rather than not rendering. */
      api('/api/story').then(r => {
        if (r.ok && r.body && r.body.progress) setStoryProgress(r.body.progress);
      }).catch(() => {});
      // The caller's all-time per-game figures (pts / best / W-L record),
      // rendered on the home cards' state line and the profile's
      // "All-time scores" section. Fire-and-forget like /api/story: failure
      // degrades to today's behaviour (no score segments, no section).
      api('/api/my/scores').then(r => {
        if (r.ok && r.body && r.body.scores) setMyScores(r.body.scores);
      }).catch(() => {});
      setFeatured(body.featured || null);
      setOffset(new Date(body.serverNowUtc).getTime() - Date.now());
      const sum = Object.values(body.attempts || {})
        .reduce((acc, a) => acc + (a.score || 0), 0);
      setTotalScore(sum);
      // Phase 8 "make it count": commit any same-day pending anonymous runs
      // now that we're authenticated. Fire-and-forget; state merges on success.
      commitPendingRuns(body);
      // ?screen=account / ?screen=profile deep link: now that we know who the
      // viewer is, open their own profile (one-shot).
      if (pendingSelfProfile.current && body.user && body.user.id) {
        pendingSelfProfile.current = false;
        setSelectedUserId(body.user.id);
        setScreen('profile');
      }
    } else {
      // 401 (no/expired token) or 5xx (DB down): can't confirm the account,
      // so persistence isn't guaranteed — reflect that in the nav.
      GUEST_MODE = true;
      setAuthOk(false);
      setUser(null);
      setStreak(0);
      setBestStreak(0);
      setSolveCount(0);
      setBadges([]);
      setAchievements({ types: [], milestones: [], stories: [] });
      setMyScores({});
      setPins([]);
      setRecentPlays([]);
      setFavorites([]);
      // Signed-out (or backend hiccup): the public read surface still supplies
      // server time, the reset countdown, and today's board seeds, so the
      // signed-out lobby stays anchored to server time.
      try {
        const pub = await api('/api/public/daily');
        if (pub.ok && pub.body) {
          SERVER_DAILY_SEEDS = pub.body.seeds || {};
          if (pub.body.nextResetUtc) setNextResetUtc(pub.body.nextResetUtc);
          if (pub.body.serverNowUtc) setOffset(new Date(pub.body.serverNowUtc).getTime() - Date.now());
          if (pub.body.featured) setFeatured(pub.body.featured);
        }
      } catch {}
    }
    setLoading(false);
  };

  useEffect(() => { loadDaily(); }, []);

  /* "Try again" on the hero's error notice: rerun loadDaily through the
     loading state, so the skeleton hero holds the panel's footprint and the
     checklist's taps no-op while the refetch is in flight. */
  const retryDaily = () => { setLoading(true); loadDaily(); };

  /* Pin / unpin one card (#232). Optimistic so the grid reorders on the tap
     rather than a round trip later, then RECONCILED against the array the
     server returns — the cap lives there, so the server's answer is the only
     one that can be trusted about what actually landed. A failure reverts. */
  const togglePin = async (gameId, wantPinned) => {
    if (!gameId || !authOk || loading) return;
    const before = pins;
    setPinNotice('');
    cgHaptic(8);
    setPins(wantPinned
      ? (before.includes(gameId) ? before : before.concat([gameId]))
      : before.filter(id => id !== gameId));
    const r = await api('/api/pins/' + encodeURIComponent(gameId),
      { method: wantPinned ? 'POST' : 'DELETE' });
    if (r.ok && r.body && Array.isArray(r.body.pins)) { setPins(r.body.pins); return; }
    setPins(Array.isArray(r.body && r.body.pins) ? r.body.pins : before);
    if (r.status === 409) {
      setPinNotice(`You can pin up to ${PIN_LIMIT} games. Unpin one to make room.`);
    }
  };

  /* Star / unstar one card. Optimistic like togglePin, so the star flips and
     the active Favorites view updates on the tap rather than a round trip
     later, then RECONCILED against the array the server returns. A failure
     reverts. No cap to reconcile — the list is unbounded, so a failure is a
     straight revert to what was there before the tap. */
  const toggleFavorite = async (gameId, wantFavorited) => {
    if (!gameId || !authOk || loading) return;
    const before = favorites;
    cgHaptic(8);
    setFavorites(wantFavorited
      ? (before.includes(gameId) ? before : before.concat([gameId]))
      : before.filter(id => id !== gameId));
    const r = await api('/api/favorites/' + encodeURIComponent(gameId),
      { method: wantFavorited ? 'PUT' : 'DELETE' });
    if (r.ok && r.body && Array.isArray(r.body.favorites)) { setFavorites(r.body.favorites); return; }
    setFavorites(Array.isArray(r.body && r.body.favorites) ? r.body.favorites : before);
  };

  // Home in-progress row (phase 7): the viewer's active online matches.
  // Refetched on every return to the lobby so a just-made move updates the
  // your-turn flag without waiting for a reload.
  useEffect(() => {
    if (loading || !authOk || screen !== 'lobby') return;
    api('/api/rooms/mine')
      .then(({ ok, body }) => { if (ok && body) setMyRooms(body.rooms || []); })
      .catch(() => {});
  }, [loading, authOk, screen]);

  // ?demo=makeitcount: render the anonymous end screen (score + would-be rank
  // + "make it count" CTA) without an actual signed-out session, so proposal
  // checks can assert on it. The server side of this param seeds today's
  // boards (same fixture as demo=leaderboard) so the rank-preview has real
  // ranks to compute against. Available in every environment — it's an
  // explicit opt-in demo param, not an env-gated code path.
  useEffect(() => {
    if (loading) return;
    if (new URLSearchParams(window.location.search).get('demo') !== 'makeitcount') return;
    const g = GAMES.find((x) => x.id === 'sudoku');
    if (!g) return;
    setCurrentGame(g);
    setScreen('game');
    setWinData({
      score: 905, bonus: 0, finalScore: 905, steps: 21, timeSecs: 95,
      multiplier: 1, effectiveStreak: 0,
      guest: true, guestSaved: false, gameId: 'sudoku',
      share: `Game Corner Sudoku — solved today's board in 01:35!\nPlay the same board (no login): ${window.location.origin}/?game=sudoku`,
    });
    api('/api/public/daily/sudoku/rank-preview?timeSecs=95&steps=21')
      .then(({ ok, body }) => {
        if (ok && body && Number.isFinite(body.rank)) {
          setWinData((prev) => (prev && prev.guest ? { ...prev, guestRank: body.rank, guestOf: body.of } : prev));
        }
      })
      .catch(() => {});
  }, [loading]);

  // ?chat=<gameId> deep link opens that game's chat room once the daily load
  // (and any ?demo= fixture seeding inside it) has settled. Proposal tests use
  // it; it's also a handy share target.
  useEffect(() => {
    if (loading) return;
    const cid = new URLSearchParams(window.location.search).get('chat');
    if (!cid) return;
    const g = GAMES.find((x) => x.id === cid);
    if (g) setChatGame(g);
  }, [loading]);

  // ?howto=<gameId> deep link opens that game's How-to-Play cards the same
  // way. It is the ONLY way navigation can reach them now that nothing
  // auto-shows the modal, so proposal tests asserting on manifest copy have to
  // go through it.
  useEffect(() => {
    if (loading) return;
    const hid = new URLSearchParams(window.location.search).get('howto');
    if (!hid) return;
    const g = GAMES.find((x) => x.id === hid);
    if (g) setHowToGame(g);
  }, [loading]);

  // ?settings=1 opens the Settings sheet (a test hook and a share link). The
  // old ?theme= link is ignored: the palette is felt, with nothing to pick.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('settings') === '1') setSettingsOpen(true);
  }, []);


  // Midnight UTC reached — reload state so everything unlocks.
  const onReset = () => {
    setScreen('lobby');
    setCurrentGame(null);
    setWinData(null);
    setLoseData(null);
    loadDaily();
  };

  // Opening a game lands on the shell-owned PRE-GAME screen (phase 3) — the
  // day's attempt is only claimed when the player hits Play (startRun),
  // so browsing the pre-game screen never burns the attempt. The How-to-Play
  // cards auto-open on a player's first-ever open of each game; because timed
  // dailies only mount (and start their clock) after Play, the auto-shown
  // how-to can never eat into the timer.
  /* Story opens on the first band you have not cleared, not on band 0 — the
     ladder is a progression, so re-entering it should carry on rather than
     restart. Falls back to 0 before progress has loaded. */
  /* Corpus-backed games need their table before the board is dealt. Visiting
     the pre-game screen WARMS it — story, arcade and the daily all pass
     through, and the Play button is a beat later — but a warm-up is not a
     guarantee and this used to be the only fetch: `?game=cratepush&play=1`
     skips the pre-game screen entirely and dealt from the hand-built fallback
     rooms every time, silently, because the fallback is by design invisible.
     startRun awaits the same (cached, deduped) promise, so the warm-up now
     only decides whether that await costs anything. */
  useEffect(() => {
    if (screen === 'pregame' && currentGame && CORPUS_GAMES.has(currentGame.id)) {
      loadCorpus(currentGame.id);
    }
  }, [screen, currentGame]);

  /* Pull the viewer's standing on the selected arcade band whenever the
     pre-game screen is showing one. Kept out of loadDaily on purpose: it is
     per-band and changes as the picker moves, so it belongs to the screen
     rather than to the day. */
  useEffect(() => {
    if (screen !== 'pregame' || playMode !== 'arcade' || !currentGame || !authOk) {
      setArcadeBest(null);
      return;
    }
    let live = true;
    api(`/api/arcade/${currentGame.id}/leaderboard?band=${encodeURIComponent(arcadeBandId)}`)
      .then(r => { if (live && r.ok && r.body) setArcadeBest(r.body.me || null); })
      .catch(() => {});
    return () => { live = false; };
  }, [screen, playMode, currentGame, arcadeBandId, authOk]);

  const nextUnclearedBand = (gameId) => {
    const p = storyProgress[gameId];
    if (!p || !p.total) return 0;
    return Math.min(p.cleared, p.total - 1);
  };

  const launchGame = (game, mode) => {
    endPracticeRun(); // #367 — never let a practice seed reach a real run
    allowProgressSave(game.id); // a new run lifts any prior finish guard
    /* #176 — `mode` is the play mode the card button asked for. It is
       authoritative over the registry's legacy `daily` flag: Block Fit is a
       classic entry that now has a daily, and Tile Match's free-play entry
       serves both story and arcade. Fall back to the entry's own default so
       every pre-#176 call site (deep links, resume, practice) still works. */
    const pm = isPlayMode(mode) ? mode : defaultPlayMode(game);
    setPlayMode(pm);
    if (pm === 'story') setStoryBand(nextUnclearedBand(game.id));
    /* Story and arcade land on the pre-game screen too, because both need a
       choice made before the board exists: which rung, or which band. Only a
       game with NO play modes at all (the head-to-head cards) mounts straight
       into play, which is exactly how classics behaved before #176. */
    if (pm === 'story' || pm === 'arcade') {
      setCurrentGame(game);
      setWinData(null);
      setLoseData(null);
      // Opening a card is always a live run; only the history's Replay button
      // arms a seed, and only for the run it launches.
      setPracticeMode(false);
      setArcadeReplaySeed(null);
      setScreen('pregame');
      return;
    }
    if (pm !== 'daily') {
      setCurrentGame(game);
      setStepCount(0);
      setWinData(null);
      setLoseData(null);
      setScreen('game');
      return;
    }
    const existing = attempts[game.id];
    if (existing && existing.finishedAt) {
      // Finished today — straight to the locked screen.
      setCurrentGame(game);
      setScreen('locked');
      return;
    }
    setCurrentGame(game);
    setWinData(null);
    setLoseData(null);
    setScreen('pregame');
  };

  // Claim (or resume) the day's single attempt and mount the game. Extracted
  // from launchGame so the pre-game screen's Play button owns consume-on-start.
  /* #176 — replay a past arcade run. The board is re-derived from the run's
     seed, which is the whole reason a run is stored as a seed plus a move list
     rather than as a board: history costs a few hundred bytes per run. */
  const replayArcadeRun = (game, run) => {
    if (!game || !run) return;
    endPracticeRun(); // #367 — the arcade replay has its own seed
    setPlayMode('arcade');
    setArcadeBandId(run.band);
    setArcadeReplaySeed(run.seed);
    setPracticeMode(true);
    setCurrentGame(game);
    setStepCount(0);
    setWinData(null);
    setLoseData(null);
    setPracticeResult(null);
    beginArcadeRun(run.seed);
    setScreen('game');
  };

  /* `over` lets a caller start a run in a mode/band it just chose, without
     waiting a render for the state to land. Only the deep-link path needs it —
     the Play button reads state that is already settled — but without it a
     `?pmode=arcade&band=hard&play=1` link would claim the run under whatever
     mode happened to be in state. */
  const startRun = async (game, over) => {
    const playMode = (over && over.mode) || playModeRef.current;
    const arcadeBandId = (over && over.arcadeBand) || arcadeBandRef.current;
    const dailyBandId = (over && over.dailyBand) || dailyBandRef.current;
    endPracticeRun(); // #367 — a claimed/resumed run is always the real board
    allowProgressSave(game.id); // claiming/resuming a run lifts the finish guard
    // Cached and request-deduped, so this is free after the first open.
    if (CORPUS_GAMES.has(game.id)) await loadCorpus(game.id);
    /* #176 — only the DAILY consumes anything. Story and arcade have no
       once-a-day claim to make, so they mount straight away; the pre-game
       screen was there to pick a band, not to gate an attempt. */
    if (playMode === 'story' || playMode === 'arcade') {
      /* Open the arcade run HERE, in the shell, so the seed that generates the
         board is the same one the finish records — that is what makes a run
         replayable at all. `arcadeReplaySeed` is set when the player picked a
         past run out of their history; a fresh Play rolls a new one. */
      if (playMode === 'arcade') {
        /* #196 — a RESUMED arcade run is the same run, so it reopens with the
           seed it was dealt and the anchor it was already given. Rolling a
           fresh seed here would hand the player a different board than the one
           their saved position belongs to, and a second /start would anchor a
           run the finish is not going to claim. `arcadeReplaySeed` (history
           replay) still wins, because that IS asking for a different run. */
        const resumeRec = practiceMode ? null : readRunSave(game.id, 'arcade', arcadeBandId);
        const resumeSeed = arcadeReplaySeed == null && resumeRec && Number.isFinite(resumeRec.seed)
          ? resumeRec.seed : null;
        const seed = beginArcadeRun(arcadeReplaySeed != null ? arcadeReplaySeed : resumeSeed);
        /* Claim the run server-side so the finish has a clock it did not get
           from us. Fire-and-forget on purpose: the board must not wait on a
           request. A run that never gets an id still plays and still lands in
           the player's history — it just settles as unverified, which is the
           right outcome for a run the server never saw begin. */
        arcadeRunIdRef.current = resumeSeed != null && resumeRec.runId ? resumeRec.runId : null;
        if (authOk && arcadeRunIdRef.current == null) {
          api(`/api/arcade/${game.id}/start`, {
            method: 'POST',
            body: JSON.stringify({ band: arcadeBandId, seed }),
          }).then(({ ok, body }) => { if (ok && body) arcadeRunIdRef.current = body.runId; })
            .catch(() => {});
        }
      }
      setCurrentGame(game);
      setStepCount(0);
      setWinData(null);
      setLoseData(null);
      setScreen('game');
      return;
    }
    // Guest mode (phase 8): a signed-out visitor plays today's board from the
    // public seed with NO server claim — the one-play lock is account-keyed
    // and can't apply to guests (§6.7's structural defense: the board only
    // takes accounted entries, so replaying anonymously buys nothing). The
    // finished run is held locally and committed retroactively on sign-in.
    if (!authOk) {
      dailyRunLog.current = { moves: [], replayOk: true };
      setCurrentGame(game);
      setStepCount(0);
      setWinData(null);
      setLoseData(null);
      setScreen('game');
      return;
    }
    const existing = attempts[game.id];
    if (existing) {
      if (existing.finishedAt) {
        setCurrentGame(game);
        setScreen('locked');
      } else {
        // Claimed but unfinished — resume into the saved board state. The row
        // is already claimed, so do NOT call /start again. A resumed run's
        // earlier moves predate this page load, so its finish can't be
        // replay-validated (server falls back to tier-B heuristics).
        // #331 — the row's band is authoritative for the resumed run: the
        // board being hydrated was dealt under it.
        if (existing.band) setDailyBandId(isDailyBand(existing.band) ? existing.band : 'normal');
        dailyRunLog.current = { moves: [], replayOk: false };
        setCurrentGame(game);
        setStepCount(existing.steps || 0);
        setWinData(null);
        setLoseData(null);
        setScreen('game');
      }
      return;
    }
    const { ok, status, body } = await api(`/api/daily/${game.id}/start`, {
      method: 'POST',
      body: JSON.stringify({ band: dailyBandId }),
    });
    // Merge the seed issued with the claim — covers a client that sat on the
    // lobby across the UTC reset, whose mount-time seeds are yesterday's.
    if (body && Number.isFinite(body.seed)) SERVER_DAILY_SEEDS[game.id] = body.seed;
    if (ok) {
      if (body && body.nextResetUtc) setNextResetUtc(body.nextResetUtc);
      dailyRunLog.current = { moves: [], replayOk: true };
      setAttempts(prev => ({ ...prev, [game.id]: body.attempt }));
      setCurrentGame(game);
      setStepCount(0);
      setWinData(null);
      setLoseData(null);
      setScreen('game');
    } else if (status === 409) {
      // Lost the race / already locked — show the locked screen.
      if (body && body.nextResetUtc) setNextResetUtc(body.nextResetUtc);
      if (body && body.attempt) setAttempts(prev => ({ ...prev, [game.id]: body.attempt }));
      dailyRunLog.current = { moves: [], replayOk: false };
      setCurrentGame(game);
      setScreen(body && body.attempt && !body.attempt.finishedAt ? 'game' : 'locked');
    }
  };

  // Deep-link: ?game=<id> auto-opens that game once loaded. Combined with
  // ?mmode=daily it jumps straight into Mancala's Daily Challenge — used by the
  // Daily Challenge proposal tests and shareable links. Runs once after hydrate.
  const deepLinkedRef = useRef(false);
  useEffect(() => {
    if (loading || deepLinkedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const gid = params.get('game');
    /* ?advance= is the one link that does not need a ?game=: it previews
       shell-owned chrome, not a particular game, so a bare /?advance=1 picks a
       representative ladder game rather than dropping the visitor on home. */
    const advParam = params.get('advance');
    if (!gid && !advParam) return;
    const g = GAMES.find(x => x.id === (gid || 'sudoku'));
    if (!g) return;
    deepLinkedRef.current = true;
    // ?mode= / ?mmode= both pin a classic game's mode (#144: land straight in a
    // bot or pass-and-play match without a second account, which is also how the
    // proposal tests screenshot the Gomoku ghost-confirm and Ludo token pad).
    // ?rooms=mine implies Online — it must skip the mode modal, or the deep link
    // lands on a chooser instead of the "Your rooms" list it names (#145).
    const wantsRooms = params.get('rooms') === 'mine';
    const mmode = params.get('mmode') || params.get('mode') || (wantsRooms ? 'online' : null);
    /* PHASE 1 — ?result=1 mounts the game and opens a representative results
       card over its frozen board. The end-of-run screen is otherwise reachable
       only by finishing a run, which navigation-only screenshots and proposal
       checks cannot do. Records nothing (see openResultDemo).

       Checked BEFORE the pre-launch modal on purpose: 2048 and Block Fit carry
       preLaunchModal, so anything below that branch would surface the mode
       chooser instead of the screen the link names. openResultDemo pins solo
       mode itself. */
    if (params.get('result') === '1' || params.get('result') === 'win') {
      openResultDemo(g, params.get('result') === 'win');
      setHowToGame(null);
      return;
    }
    /* #185 — ?advance=1|count|complete opens the between-bands overlay. Same
       reasoning as ?result=1 above, and checked in the same place: it must
       come before the pre-launch / mode-select branches or a game carrying a
       chooser would surface that instead. */
    if (advParam) {
      openAdvanceDemo(g, advParam);
      setHowToGame(null);
      return;
    }
    /* #176 — ?pmode=daily|story|arcade opens a card in one of its play modes,
       and ?level= preselects the story level (a 1-based number) or the arcade
       difficulty (easy|normal|hard). Without these the story levels, the
       arcade band picker and every board behind them are reachable only by
       TAPPING a card button — which navigation-driven proposal checks and
       screenshots cannot do, so none of #176 would have been verifiable.
       Deliberately NOT ?mode=, which already pins a classic's opponent
       (bot / 2p / online).

       ?band= is the original spelling and still works (#184 renamed the copy,
       not the URL contract) — every merged deep link and dapp.json test keeps
       resolving. ?level= wins when both are present.

       Checked BEFORE the pre-launch modal for the same reason ?result=1 is:
       2048 and Block Fit carry preLaunchModal, so below that branch this link
       would surface the opponent chooser instead of the mode it names. */
    const pmode = params.get('pmode');
    if (isPlayMode(pmode) && supportsMode(g.id, pmode)) {
      const bandParam = params.get('level') || params.get('band');
      let band = null;
      if (pmode === 'story' && bandParam) band = Math.max(0, (parseInt(bandParam, 10) || 1) - 1);
      if (pmode === 'arcade' && ARCADE_BAND_IDS.indexOf(bandParam) !== -1) band = bandParam;
      /* #331 — the daily's difficulty is selectable by link the same way the
         arcade's is, so the Easy and Hard deals are reachable by navigation
         (a check or a screenshot cannot tap the picker). */
      if (pmode === 'daily' && DAILY_BANDS.indexOf(bandParam) !== -1) band = bandParam;
      launchGame(g, pmode);
      if (pmode === 'story' && band != null) setStoryBand(band);
      if (pmode === 'arcade' && band != null) setArcadeBandId(band);
      if (pmode === 'daily' && band != null) setDailyBand(band);
      if (params.get('play') === '1') {
        startRun(g, {
          mode: pmode,
          arcadeBand: pmode === 'arcade' ? (band || arcadeBandId) : undefined,
          dailyBand: pmode === 'daily' ? (band || dailyBandId) : undefined,
        });
        setHowToGame(null);
      }
      return;
    }
    // A multi-mode classic lands on the shared opponent screen unless the mode
    // is pinned via ?mode= (then launch straight into it). All nine of them go
    // through this one branch now — Mancala and Snakes & Ladders used to fall
    // through to their own in-game pickers, which is exactly the split the
    // opponent screen exists to close.
    /* #201 — ?room=<code> (plus ?seat=1|2) enters a live online match the way
       tapping a your-turn card on Home does. That tap was the ONLY way in, so
       no proposal check and no before/after screenshot could ever see the
       in-match chrome — which is exactly the surface this change moves. Pure
       navigation: it pre-seats the room id and lets the normal polling decide
       whether the room is real, so a bad code lands on "Room not found"
       rather than on a broken screen.

       Checked BEFORE the opponent-screen branch, for the same reason ?result=1
       and ?pmode= are: a game with modeSelect would otherwise surface the
       chooser instead of the room this link names. */
    const roomParam = params.get('room');
    if (roomParam) {
      setClassicGameMode('online');
      setClassicGameModeOpts({ roomId: roomParam, myPlayerNum: params.get('seat') === '2' ? 2 : 1 });
      setPreLaunchGame(null);
      launchGame(g);
      setHowToGame(null);
      return;
    }
    if (g.modeSelect && !mmode) { openOpponentScreen(g); return; }
    if (g.modeSelect && mmode) { setClassicGameMode(mmode); }
    // ?play=1 skips the pre-game screen and claims/mounts immediately — used
    // by proposal tests that assert on in-game UI, and by "jump straight in"
    // share links.
    if (params.get('play') === '1') {
      /* A DAILY REACHED THIS WAY IS STILL A DAILY, and the shell has to be
         told so. This branch used to call startRun(g) alone. startRun reads
         the mode from a REF and never sets it, so on a link with no ?pmode=
         the shell was left with playMode === null — and `resumable` in
         renderGameBody is `playMode === 'daily'`, which is the single gate on
         whether a game is handed its savedProgress at all.

         So a daily opened by `?game=<id>&play=1` could not resume: a claimed,
         half-played attempt mounted as a blank board with its clock at zero.
         That is the shape of link the share cards carry ("the no-login ?game=
         link") and the shape the proposal checks use, which is how it showed
         up — "Nonogram resumes its mistake count" asserts on a resumed board
         and had no mode to resume in.

         Now it takes the same two steps the ?pmode= branch above takes:
         launchGame sets the mode, startRun claims or resumes in it. */
      if (g.daily) {
        const dm = defaultPlayMode(g);
        /* ?band= works without ?pmode=daily too (`?game=x&play=1&band=easy`):
           the daily defaults to its daily mode here, so the band belongs to
           it. Passed through `over` because the ref will not see the setter
           within this tick. */
        const bParam = params.get('band');
        const bOk = DAILY_BANDS.indexOf(bParam) !== -1 ? bParam : null;
        if (bOk) setDailyBand(bOk);
        launchGame(g, dm);
        startRun(g, { mode: dm, dailyBand: bOk || undefined });
        setHowToGame(null);
        return;
      }
      launchGame(g);
      setHowToGame(null); // suppress the classic first-open auto-show too
      return;
    }
    // #133 — ?practice=1 mounts today's puzzle as an unscored replay. No /start
    // claim, so it works whether or not the day has been played.
    if (params.get('practice') === '1' && g.daily) {
      startPractice(g);
      setHowToGame(null);
      return;
    }
    // #367 — ?practice=random deals a fresh random board, which is otherwise
    // only reachable by tapping the pre-game Practice button that checks can't.
    if (params.get('practice') === 'random' && g.daily) {
      startPractice(g, { fresh: true });
      setHowToGame(null);
      return;
    }
    // #145 — ?rooms=mine lands on the online setup with the "Your rooms" list
    // showing, which is otherwise only reachable by picking Online in the modal.
    if (wantsRooms) {
      setClassicGameMode('online');
      setClassicGameModeOpts(null);
      setPreLaunchGame(null);
      launchGame(g);
      setHowToGame(null);
      return;
    }
    launchGame(g);
  }, [loading]);

  // Merge a stored attempt's persisted progress JSON with its steps/elapsed so
  // a game component can hydrate from a single savedProgress object.
  const progressFor = (attempt) => {
    if (!attempt || !attempt.progress) return null;
    return { ...attempt.progress, steps: attempt.steps, elapsedSecs: attempt.elapsedSecs };
  };

  // Autosave callback handed to every game: persists in-progress state for
  // today's claimed, unfinished attempt. Best-effort (keepalive) so it survives
  // a tab close. Never blocks gameplay.
  //
  // COALESCED (slice 1): games call this on every move, and firing a POST +
  // a full App re-render per tap was a large share of the "laggy clicking"
  // in the grid dailies. The latest payload is held in a ref and flushed on a
  // trailing timer; the local `attempts` mirror moves into that same flush so
  // a tap no longer re-renders the tree. Resume semantics are unchanged — the
  // flush always sends the newest state, and unmount/visibilitychange (via
  // useAutosave's teardown) force it out immediately.
  // `blockedGameId` is the finish guard: once a run ends, ALL further progress
  // writes for that game are dropped until a new run is claimed. A one-shot
  // queue drain isn't enough — unmounting the game body runs useAutosave's
  // teardown flush, which would re-queue a write against the row the finish
  // just closed and 409 (a console error that trips the no-console-errors
  // check). This also covers the games that don't self-suppress their winning
  // move's save.
  const saveQueueRef = useRef({ timer: null, gameId: null, payload: null, blockedGameId: null });
  const PROGRESS_FLUSH_MS = 1000;

  const flushProgressSave = () => {
    const q = saveQueueRef.current;
    if (q.timer) { clearTimeout(q.timer); q.timer = null; }
    const gameId = q.gameId, payload = q.payload;
    q.gameId = null; q.payload = null;
    if (!gameId || !payload) return;
    api(`/api/daily/${gameId}/progress`, {
      method: 'POST',
      keepalive: true,
      body: JSON.stringify({
        progress: payload.progress, steps: payload.steps, elapsedSecs: payload.secs,
      }),
    }).catch(() => {});
    // Keep local mirror fresh so a same-session re-entry resumes correctly.
    setAttempts(prev => {
      const a = prev[gameId];
      if (!a || a.finishedAt) return prev;
      return { ...prev, [gameId]: { ...a, progress: payload.progress, steps: payload.steps, elapsedSecs: payload.secs } };
    });
  };

  // Drop any queued write without sending it, and block further writes for
  // this game. Called the moment a run finishes so nothing can race the finish
  // and 409 against the closed row (the phase-6 "no progress save on the
  // winning move" rule, generalized to every finish path).
  const cancelProgressSave = () => {
    const q = saveQueueRef.current;
    if (q.timer) { clearTimeout(q.timer); q.timer = null; }
    if (currentGame) q.blockedGameId = currentGame.id;
    q.gameId = null; q.payload = null;
  };

  // Lift the finish guard when a fresh run is claimed/mounted for a game.
  const allowProgressSave = (gameId) => {
    const q = saveQueueRef.current;
    if (q.blockedGameId === gameId) q.blockedGameId = null;
  };

  /* The story/arcade half of resume (#187 / #196). Device-local, never the
     attempt row — see the note in renderGameBody.

     Three rules, each of which exists because of something that would
     otherwise go wrong:

     - NOTHING IS SAVED UNTIL A MOVE IS MADE. A save of an untouched board is
       worth nothing and is actively harmful: proposal checks mount story
       boards to assert on their FRESH state, and a save written by one of them
       would hydrate into the next and change the board it was asserting on.
     - THE FINISH GUARD IS THE SAME ONE THE DAILY USES. handleWin/handleLose
       call cancelProgressSave() before anything else, and useAutosave flushes
       again on unmount — without honouring that flag a trailing flush would
       write the save back after the finish had cleared it, and the next visit
       would resume a run that was already over.
     - AN ARCADE RUN RECORDS ITS SEED AND ITS RUN ID. A story rung rebuilds the
       same board from (game, band) on any day, so it needs neither; an arcade
       board comes from the run's own seed, and its finish is checked against
       the anchor /api/arcade/:id/start stamped. Resume both or the run comes
       back as a different board, settling unverified. */
  const saveLocalRun = (progress, steps, secs) => {
    const g = currentGame;
    if (!g || practiceMode) return;
    if (playMode !== 'story' && playMode !== 'arcade') return;
    if (saveQueueRef.current.blockedGameId === g.id) return;
    if (!(steps > 0)) return;
    const band = playMode === 'arcade' ? arcadeBandId : storyBand;
    writeRunSave(g.id, playMode, band, {
      v: 1,
      progress,
      steps,
      elapsedSecs: secs,
      savedAt: Date.now(),
      seed: playMode === 'arcade' ? currentArcadeSeed() : null,
      runId: playMode === 'arcade' ? arcadeRunIdRef.current : null,
    });
  };

  // Dropped when the run ends and at the four deliberate start-fresh moments,
  // which is what playAgainKey already marks.
  const dropLocalRun = (gameId, mode, band) => {
    if (mode !== 'story' && mode !== 'arcade') return;
    clearRunSave(gameId, mode, band);
  };

  /* Read ONCE per (game, mode, band) — and again when playAgainKey moves,
     because that is the signal that a fresh run was asked for and the record
     has just been dropped. The games read savedProgress in their useState
     initialisers, so what matters is the value on the render that mounts
     them. */
  const resumeDemoSeeded = useRef(false);
  if (!resumeDemoSeeded.current) { resumeDemoSeeded.current = true; seedResumeDemo(offset); }

  const localRunProgress = React.useMemo(() => {
    if (!currentGame || practiceMode) return null;
    if (playMode !== 'story' && playMode !== 'arcade') return null;
    const band = playMode === 'arcade' ? arcadeBandId : storyBand;
    return hydrateRunSave(readRunSave(currentGame.id, playMode, band), offset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentGame && currentGame.id, playMode, arcadeBandId, storyBand, practiceMode, playAgainKey, offset]);

  const handleSaveProgress = (progress, steps, secs) => {
    if (!currentGame) return;
    // #122 — remember the latest snapshot even for guests / blocked queues, so
    // the finish can attach it as the reviewable final board.
    lastProgressRef.current = { gameId: currentGame.id, progress };
    // Guests have no server attempt row to save into — the POST would just
    // 401 and log console errors. A guest run lives only until its finish.
    if (!authOk) return;
    const gameId = currentGame.id;
    const q = saveQueueRef.current;
    if (q.blockedGameId === gameId) return; // run already finished

    // Switching games mid-queue: get the old game's state out first.
    if (q.gameId && q.gameId !== gameId) flushProgressSave();
    q.gameId = gameId;
    q.payload = { progress, steps, secs };
    if (!q.timer) q.timer = setTimeout(() => { saveQueueRef.current.timer = null; flushProgressSave(); }, PROGRESS_FLUSH_MS);
  };

  // Never strand a queued write on unload.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flushProgressSave(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flushProgressSave);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flushProgressSave);
      flushProgressSave();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // POST the finished daily result to the server and reconcile client state.
  // Pulled out of handleWin so the win overlay's "couldn't sync — retrying"
  // button can re-run exactly the same submission. Returns true on success.
  // Best-effort: a network throw is treated as a failed sync (syncError), never
  // an uncaught rejection that would break the overlay.
  // Three-line share card (spec-audit item 6): an edition/date line, the
  // game's own spoiler-free result line, then rank + the playable no-login
  // challenge link. `rank` is optional — the card reads fine while it's still
  // being fetched (or for guests before the rank preview lands).
  // #331 — `band` is the run's difficulty: the "same deal" link names it
  // (#335 makes that `&level=` via playLink) so the recipient opens the SAME
  // board the sender played. A daily link always names it, Normal included,
  // so the opener does not get whatever difficulty they last picked.
  const buildShareCard = (gameId, resultLine, rank, band) => {
    const d = new Date(Date.now() + offset);
    const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const lines = [`Game Corner No. ${utcDayNum(offset) - 20000} · ${dateStr}`];
    // Game result lines historically self-prefix the app name; strip it so
    // the card doesn't read "Game Corner … Game Corner …".
    if (resultLine) lines.push(resultLine.replace(/^Game Corner /, ''));
    lines.push(
      (Number.isFinite(rank) ? `#${rank} on today's board · ` : '') +
      `Play the same deal (no login): ${playLink(gameId, 'daily', band)}`
    );
    return lines.join('\n');
  };

  /* The last in-play progress payload a game handed us, kept so the finish can
     carry a final board snapshot for the locked-day review screen (#122).
     Read from the SAME coalesced autosave path the games already use — we never
     ask a game to save on its winning move (that write 409s against the row the
     finish is closing), so this is the freshest legal snapshot available. */
  const lastProgressRef = useRef({ gameId: null, progress: null });

  const submitDailyFinish = async (gameId, finalScore, steps, timeSecs) => {
    let ok = false, body = null;
    try {
      // Attach the per-run move log (phase 2): engine-shaped moves make the
      // finish replay-validatable (tier A); timestamp-only events feed the
      // server's tier-B timing heuristics. The ref survives until the next
      // launchGame, so the overlay's retry re-sends the identical log.
      const log = dailyRunLog.current;
      const moves = log.moves.slice(0, 800);
      const res = await api(`/api/daily/${gameId}/finish`, {
        method: 'POST',
        body: JSON.stringify({
          score: finalScore, steps, timeSecs,
          moves,
          replay: log.replayOk && moves.some(m => Number.isInteger(m.tileType)),
          // #122 — final board snapshot, written in the same UPDATE server-side.
          progress: lastProgressRef.current.gameId === gameId
            ? lastProgressRef.current.progress : null,
        }),
      });
      ok = res.ok; body = res.body;
    } catch (e) {
      console.error('[daily] finish submit threw:', e && e.message);
      ok = false;
    }
    // Local mirror so the lobby card locks even if the server didn't confirm.
    const stored = ok && body && body.attempt
      ? body.attempt
      : { gameId, score: finalScore, steps, timeSecs, finishedAt: new Date().toISOString() };
    setAttempts(prev => ({ ...prev, [gameId]: stored }));
    if (ok) {
      // Reconcile against the server's authoritative streak + reward + new
      // achievement badges, and clear any prior sync-error flag.
      if (body && typeof body.streak === 'number') setStreak(body.streak);
      if (body && typeof body.bestStreak === 'number') setBestStreak(body.bestStreak);
      if (body && Number.isFinite(body.solveCount)) setSolveCount(body.solveCount);
      const newAch = (body && Array.isArray(body.newAchievements)) ? body.newAchievements : [];
      if (newAch.length) {
        setAchievements(prev => mergeAchievements(prev, newAch));
        // Reflect any server-confirmed streak milestones in the permanent
        // `badges` state too (their day thresholds), so the lobby's streak
        // chips light immediately even if the client's optimistic streak math
        // missed the exact tier.
        const streakDays = newAch
          .filter(a => a && a.type === 'streak_milestone' && a.metadata && Number.isFinite(+a.metadata.streak))
          .map(a => +a.metadata.streak);
        if (streakDays.length) {
          setBadges(prev => Array.from(new Set([...prev, ...streakDays])).sort((a, b) => a - b));
        }
      }
      setWinData(prev => {
        if (!prev) return prev;
        // De-dup the win overlay: the client-side fast-path already shows
        // `justBadge` for the streak tier this win landed on. Pick the first
        // NEW achievement that isn't that same streak badge so we never show
        // one badge twice. If the only new achievement IS the streak badge the
        // fast-path missed (stale client streak), this surfaces it as the
        // server backstop.
        const shownMin = prev.justBadge && prev.justBadge.min;
        const firstNew = newAch.find(a => {
          if (a && a.type === 'streak_milestone') return +(a.metadata && a.metadata.streak) !== shownMin;
          return true;
        });
        return {
          ...prev,
          syncError: false,
          newAchievements: newAch,
          justAchievement: firstNew ? achievementBadgeFor(firstNew) : prev.justAchievement,
        };
      });
    } else {
      setWinData(prev => prev ? { ...prev, syncError: true } : prev);
    }
    return ok;
  };

  /* #176 story — a rung is ticked off by the SERVER, once, on first clear.
     total_score is an incrementing column (`total_score = total_score + $n`),
     so it is not idempotent and a retry would double-credit. The award is
     therefore gated on the progression row's claim succeeding, exactly the way
     the daily's consume-on-start claim works. A replay of a cleared band is
     inert by design: story pays the first time and never again. */
  const handleBandCleared = async (bandIndex, meta) => {
    if (practiceMode || !authOk) return null;
    const gameId = currentGame && currentGame.id;
    if (!gameId) return null;
    const { ok, body } = await api(`/api/story/${gameId}/clear`, {
      method: 'POST',
      body: JSON.stringify({
        band: bandIndex,
        score: (meta && meta.score) || 0,
        timeSecs: (meta && meta.timeSecs) || 0,
        steps: (meta && meta.steps) || 0,
      }),
    }).catch(() => ({ ok: false, body: null }));
    if (ok && body) {
      setStoryProgress(prev => ({ ...prev, [gameId]: { cleared: body.cleared, total: body.total } }));
      if (body.awarded) setTotalScore(t => t + body.awarded);
      if (body.newAchievements && body.newAchievements.length) {
        setAchievements(prev => mergeAchievements(prev, body.newAchievements));
      }
    }
    /* Returned, not stashed in state here: handleWin's setWinData runs AFTER
       this await, so anything this function set on the win overlay would be
       clobbered by that call. The caller threads it in instead — the
       auto-advance tally also needs this exact response ({ awarded,
       firstClear, cleared, total, ladderComplete, newAchievements }) and
       re-deriving it client-side would be a second copy of the server's
       award rule. */
    return ok && body ? body : null;
  };

  /* ============================================================
     #185 — auto-advance between Ladder bands
     ------------------------------------------------------------
     Clearing a band used to drop the ordinary result card, and the only way on
     was Back to the ladder, then the pre-game screen, then Play. A band's board
     is a pure function of (gameId, band) (see modeSeed), so nothing has to be
     fetched to start the next one: the shell moves the band and remounts.
     Two things make that work, both easy to get wrong:
       - A story game caches its board in its own useRef at mount, so moving
         `storyBand` alone repaints nothing. The three <GameComponent> call
         sites carry a story-scoped React `key`; changing the key IS the
         remount. Note the `.game-body` wrapper stays unconditional either
         way (see #158) — the key changes, the element does not.
       - Every timer goes through advTimer so any exit (Start now, Back to the
         ladder, Escape, backdrop, unmount) can clear all of them. A stray
         timer would start a band the player had just walked away from.
     ============================================================ */
  const ADV_TALLY_MS = 1100;
  const ADV_COUNT_SECS = 3;
  const clearAdvanceTimers = () => {
    advanceTimers.current.forEach(t => clearTimeout(t));
    advanceTimers.current = [];
  };
  const advTimer = (fn, ms) => { advanceTimers.current.push(setTimeout(fn, ms)); };
  // Leave the overlay for a destination the caller supplies (Start now, Back
  // to the ladder). No result card: the player chose where to go.
  const cancelAdvance = () => { clearAdvanceTimers(); setAdvance(null); };
  /* Escape / backdrop means "out of the countdown", not "out of the result" —
     so fall back to the ordinary win card, where the score breakdown, the
     share CTA and the ladder button all still live. */
  const dismissAdvance = () => {
    clearAdvanceTimers();
    if (advance && advance.win) setWinData(advance.win);
    setAdvance(null);
  };
  const startAdvanceBand = (band) => {
    clearAdvanceTimers();
    setAdvance(null);
    setWinData(null); setLoseData(null); setPracticeResult(null);
    setStepCount(0);
    if (typeof band === 'number') setStoryBand(band);
    // playAgainKey is part of the board key, so bumping it re-deals even when
    // the band is unchanged — which is what "Try this band again" needs.
    setPlayAgainKey(k => k + 1);
    cgSound('click', 1.3);
  };
  const backToLadder = () => {
    clearAdvanceTimers();
    setAdvance(null);
    if (currentGame) launchGame(currentGame, 'story');
  };
  const runAdvanceSequence = (info) => {
    clearAdvanceTimers();
    setAdvance({ ...info, phase: 'tally', secs: ADV_COUNT_SECS });
    cgSound('blevel'); cgHaptic(20);
    advTimer(() => setAdvance(a => (a ? { ...a, phase: 'count' } : a)), ADV_TALLY_MS);
    for (let i = 1; i < ADV_COUNT_SECS; i++) {
      advTimer(() => {
        cgSound('click', 1 + i * 0.15);
        setAdvance(a => (a ? { ...a, secs: ADV_COUNT_SECS - i } : a));
      }, ADV_TALLY_MS + i * 1000);
    }
    advTimer(() => startAdvanceBand(info.toBand), ADV_TALLY_MS + ADV_COUNT_SECS * 1000);
  };
  /* Deep-linked preview of the overlay, for screenshots and proposal checks:
     ?advance=1 freezes it on the countdown, ?advance=count runs the real
     sequence, ?advance=complete shows the end-of-ladder card. Inert — practice
     mode, no claim, no clear, no win payload — so it needs no seed data, is
     deliberately NOT staging-gated, and the "before" shot can come from
     production. */
  const openAdvanceDemo = (game, kind) => {
    if (!game) return;
    clearAdvanceTimers();
    setCurrentGame(game);
    setPlayMode('story');
    setPracticeMode(true);
    setReviewMode(false);
    setLockedReview(false);
    setWinData(null); setLoseData(null); setPracticeResult(null);
    setPreLaunchGame(null); setClassicGameMode(null); setClassicGameModeOpts(null);
    setStepCount(0);
    setScreen('game');
    const total = ((storyProgress[game.id] || {}).total) || 6;
    if (kind === 'complete') {
      setStoryBand(total - 1);
      setAdvance({
        gameId: game.id, phase: 'complete', fromBand: total - 1, toBand: null,
        total, awarded: 571, firstClear: true, secs: 0, win: null,
      });
      return;
    }
    const from = Math.min(2, Math.max(0, total - 2));
    setStoryBand(from);
    const info = {
      gameId: game.id, fromBand: from, toBand: from + 1, total,
      awarded: 286, firstClear: true, win: null,
    };
    if (kind === 'count') { runAdvanceSequence(info); return; }
    setAdvance({ ...info, phase: 'count', secs: ADV_COUNT_SECS });
  };

  const handleWin = async (score, steps, timeSecs, meta) => {
    // The run is over: drop any queued progress write so a trailing flush
    // can't land on the row the finish is about to close (a 409 + console
    // error that would trip the no-console-errors check).
    cancelProgressSave();
    /* PHASE 4 (#133) — a practice replay is scored LOCALLY and stops here.
       No endpoint call, no streak, no badges, no bests, no leaderboard, no
       dailyRunLog submission. This early return is the single guarantee that
       "play again for fun" can never touch a real record. */
    if (practiceMode) {
      // `gameId` so the shared boardReviewable guard can confirm the result
      // belongs to the game that is actually mounted (phase 1).
      setPracticeResult({
        score, steps, timeSecs, share: meta && meta.share, won: true,
        gameId: currentGame ? currentGame.id : null,
      });
      return;
    }
    /* #176 — story and arcade settle on their OWN endpoints and never touch
       the daily's attempt row, streak or badges. Dispatching here rather than
       in each game component is what let ~20 games gain two modes without one
       of them changing its finish path: a game still just calls onWin(), and
       the shell decides what that means in the mode it was opened in. */
    if (playMode === 'story') {
      const bandIdx = typeof storyBand === 'number' ? storyBand : 0;
      // The run is over: its local resume record is done with (#187).
      dropLocalRun(currentGame.id, 'story', bandIdx);
      const res = await handleBandCleared(bandIdx, { score, steps, timeSecs });
      const total = (res && res.total) || (storyProgress[currentGame.id] || {}).total || 0;
      // Issue #183 — the ladder-completion badge. Only a FRESH award pops the
      // celebration; finishing the last band again just shows the usual card.
      const storyAch = (res && res.newAchievements || [])
        .find(a => a && a.type === 'story_complete');
      const storyBadge = storyAch ? achievementBadgeFor(storyAch) : null;
      const winPayload = {
        score, bonus: 0, finalScore: score, steps, timeSecs,
        multiplier: 1, effectiveStreak: 0, share: meta && meta.share,
        modeLabel: 'Story', bandIndex: bandIdx, bandTotal: total,
        ladderComplete: !!(res && res.ladderComplete),
        storyBadge,
      };
      /* #185 — the ladder carries you on. Two cases keep the old card: a
         guest has no ladder at all (GET /api/story is auth-gated, so there is
         no total to walk), and a practice replay records nothing, so there is
         nothing to advance. */
      if (!total || practiceMode || !authOk) { setWinData(winPayload); return; }
      const info = {
        gameId: currentGame.id, fromBand: bandIdx, toBand: bandIdx + 1, total,
        awarded: (res && res.awarded) || 0, firstClear: !!(res && res.firstClear),
        storyBadge, win: winPayload,
      };
      if (bandIdx + 1 >= total) {
        clearAdvanceTimers();
        cgSound('win'); cgHaptic(30);
        setAdvance({ ...info, phase: 'complete', toBand: null, secs: 0 });
        return;
      }
      runAdvanceSequence(info);
      return;
    }
    if (playMode === 'arcade') {
      const band = arcadeBandId;
      dropLocalRun(currentGame.id, 'arcade', band);
      const { ok, body } = await api(`/api/arcade/${currentGame.id}/finish`, {
        method: 'POST',
        body: JSON.stringify({
          band, score, timeSecs, steps,
          runId: arcadeRunIdRef.current || 0,
          seed: currentArcadeSeed() || 0,
          moves: (meta && meta.moves) || undefined,
        }),
      }).catch(() => ({ ok: false, body: null }));
      if (ok && body && body.awarded) setTotalScore(t => t + body.awarded);
      setWinData({
        score, bonus: 0, finalScore: score, steps, timeSecs,
        multiplier: 1, effectiveStreak: 0, share: meta && meta.share,
        modeLabel: 'Arcade', arcadeBand: band,
        arcadeRank: ok && body ? body.rank : null,
        arcadePrevBest: ok && body ? body.previousBest : null,
        arcadeBeatBest: ok && body ? body.beatBest : false,
        arcadeFirstRun: ok && body ? body.isFirstRun : false,
        arcadeAwarded: ok && body ? body.awarded : 0,
        arcadeVerified: !!(ok && body && body.verified),
      });
      return;
    }
    try {
      /* #176 — the branch is the MODE, not the registry entry. Seven classics
         gained a daily (2048, Knight's Tour, Block Fit, Diamond Rush, Marble
         Loop, Hash Rush, Match-3) while keeping `daily: false` and their
         classic shell, because that is still where they live in the lobby.
         Reading the entry's flag here would send their daily win down the
         classic path: no attempt row, no lock, no leaderboard, no streak — the
         run would look like it worked and record nothing. */
      // A free-play classic run skips the server, streak and totalScore.
      if (currentGame && playMode !== 'daily') {
        const cashoutMultiplier = (meta && meta.cashoutMultiplier) || 1;
        setWinData({
          score,
          bonus: 0,
          finalScore: score,
          steps,
          timeSecs,
          multiplier: cashoutMultiplier,
          effectiveStreak: 0,
          share: meta && meta.share,
          cashOut: meta && meta.cashOut,
          winnerLabel: meta && meta.winnerLabel,
          isClassic: true,
          bestScore: meta && meta.bestScore,
          longestSnake: meta && meta.longestSnake,
          /* Free-form result rows a game can add to the score breakdown
             (Snakes & Ladders V2 reports its placement and, in a ranked
             match, the rank points it moved). A game that reports none is
             unchanged: the block renders nothing. */
          extraRows: meta && meta.extraRows,
          /* Final table for a multi-player local match: every seat with the
             place it took and the square it stopped on. */
          standings: meta && meta.standings,
          gameId: currentGame.id,
        });
        // Remember the round's result for the Game Menu (kept for future
        // share affordances; the feed post button was retired).
        setClassicLastResult({ gameId: currentGame.id, score, steps, timeSecs });
        return;
      }
      // Declare gameId FIRST — referencing it before this line is a temporal
      // dead zone ReferenceError that previously killed the entire win flow
      // (no overlay, no finish call). Keep this above setWinData.
      const gameId = currentGame.id;
      // Guest run (phase 8): no server finish. Hold the run locally as a
      // same-day pending run (moves + seed, the exact payload a normal finish
      // sends, so the retroactive commit gets full validation parity), fetch
      // the would-be rank from the public read surface, and show the
      // anonymous end screen with the "make it count" CTA.
      if (!authOk) {
        const log = dailyRunLog.current;
        const seed = serverDailySeed(gameId);
        // #331 — a guest run was played on the band the pre-game picker chose;
        // committing it under that band (below, and server-side in /commit)
        // ranks it against the same deal it was played on. Score stays the raw
        // base: the streak multiplier is a signed-in reward, and the band
        // multiplier only exists to keep per-band boards comparable, which a
        // raw score already is within its own board.
        const guestBand = isDailyBand(dailyBandRef.current) ? dailyBandRef.current : 'normal';
        if (seed != null) {
          savePendingRun(gameId, {
            dayNum: utcDayNum(offset), gameId, seed, band: guestBand,
            score, steps, secs: timeSecs,
            moves: log.moves.slice(0, 800),
            replay: log.replayOk && log.moves.some(m => Number.isInteger(m.tileType)),
            at: new Date().toISOString(),
          });
        }
        setWinData({
          score, bonus: 0, finalScore: score, steps, timeSecs,
          multiplier: 1, effectiveStreak: 0,
          band: guestBand,
          guest: true, guestSaved: seed != null,
          share: buildShareCard(gameId, meta && meta.share, null, guestBand),
          gameId,
        });
        try {
          const { ok, body } = await api(
            `/api/public/daily/${gameId}/rank-preview?timeSecs=${Math.round(timeSecs || 0)}&steps=${Math.round(steps || 0)}&score=${Math.round(score || 0)}&band=${guestBand}`
          );
          if (ok && body && Number.isFinite(body.rank)) {
            // Would-be rank into the CTA and the share card's rank line alike.
            setWinData(prev => (prev && prev.guest
              ? { ...prev, guestRank: body.rank, guestOf: body.of, share: buildShareCard(gameId, meta && meta.share, body.rank, guestBand) }
              : prev));
          }
        } catch {}
        return;
      }
      // The streak this win lands in. GotD-participation semantics: only
      // finishing TODAY'S FEATURED game extends the consecutive-day streak by
      // 1 (the server's computeStreak reconciles via the finish response);
      // every other daily reuses the current day count — the multiplier stays
      // per-day, not per-game.
      const isFeaturedWin = featured && featured.gameId === gameId;
      const featuredDoneToday = featured && attempts[featured.gameId]
        && attempts[featured.gameId].score != null;
      const effectiveStreak = (isFeaturedWin && !featuredDoneToday) ? streak + 1 : streak;
      const multiplier = streakMultiplier(effectiveStreak);
      /* #331 — the band multiplier on top of the streak multiplier. The run's
         band is read from the ref (startRun may have set it in the same tick a
         deep link fired) and Normal is the no-op so every pre-band flow scores
         byte-identically. Carried onto winData so the end card can say which
         board this was. */
      const runBand = isDailyBand(dailyBandRef.current) ? dailyBandRef.current : 'normal';
      const bandMult = DAILY_BAND_MULT[runBand] != null ? DAILY_BAND_MULT[runBand] : 1;
      const finalScore = Math.round(score * multiplier * bandMult);
      const bonus = finalScore - score;
      setStreak(effectiveStreak);
      // Personal-best comparison for the end screen (phase 3), captured BEFORE
      // merging this win into the bests map.
      const prevBest = bests[gameId] && Number.isFinite(bests[gameId].score) ? bests[gameId].score : null;
      setBests(prev => {
        const cur = prev[gameId] || {};
        return {
          ...prev,
          [gameId]: {
            score: cur.score != null ? Math.max(cur.score, finalScore) : finalScore,
            timeSecs: cur.timeSecs != null && timeSecs != null ? Math.min(cur.timeSecs, timeSecs) : (cur.timeSecs != null ? cur.timeSecs : timeSecs),
          },
        };
      });
      // A badge unlocked the moment this win's streak lands exactly on a tier.
      const unlocked = justUnlockedBadge(effectiveStreak);
      if (unlocked) {
        setBadges(prev => (prev.includes(unlocked.min) ? prev : [...prev, unlocked.min].sort((a, b) => a - b)));
      }
      // Show the celebration overlay immediately — independent of the network
      // call below, so the player always gets a clear "Solved!" confirmation.
      setWinData({
        score, bonus, finalScore, steps, timeSecs, multiplier, effectiveStreak,
        band: runBand,
        prevBest,
        activeBadge: activeBadge(effectiveStreak),
        justBadge: unlocked,
        // Three-line share card: edition/date, the game's spoiler-free result
        // line, then rank + the playable no-login challenge link. The rank
        // line is threaded in below once the finish lands on the board.
        share: meta && meta.share ? buildShareCard(gameId, meta.share, null, runBand) : undefined,
        hintsUsed: meta && meta.hintsUsed,
        wordsSolved: meta && meta.wordsSolved,
        wordsTotal: meta && meta.wordsTotal,
        gameId,
        syncError: false,
        newAchievements: [],
      });
      setTotalScore(t => t + finalScore);
      // Submit to the server (records result, streak, reward, badges, receipt).
      await submitDailyFinish(gameId, finalScore, steps, timeSecs);
      // Now that the finish is on today's board, thread the earned rank into
      // the share card ("#N on today's board · …"). Best-effort — the card
      // reads fine without a rank if the fetch loses or hasn't landed.
      if (meta && meta.share) {
        try {
          const { ok, body } = await api(`/api/daily/${gameId}/leaderboard?band=${encodeURIComponent(runBand)}`);
          const rank = ok && body && body.me && Number.isFinite(body.me.rank) ? body.me.rank : null;
          if (rank) {
            setWinData(prev => (prev && !prev.isClassic && prev.gameId === gameId)
              ? { ...prev, myRank: rank, share: buildShareCard(gameId, meta.share, rank, runBand) }
              : prev);
          }
        } catch {}
      }
    } catch (e) {
      // Never let a handler error swallow the win silently again. Surface a
      // minimal overlay so the player sees their solve was registered.
      console.error('[daily] handleWin failed:', e && e.message);
      setWinData(prev => prev || {
        score, finalScore: score, bonus: 0, steps, timeSecs,
        multiplier: 1, effectiveStreak: 0, share: meta && meta.share, syncError: true,
      });
    }
  };

  // Retry the finish submission for the current win. PHASE 4 (#132): this is now
  // a FALLBACK — the effect below retries automatically when connectivity comes
  // back, so the reworded card is a reassurance rather than a chore.
  const retryDailyFinish = () => {
    if (!winData || winData.isClassic) return;
    const gameId = winData.gameId || (currentGame && currentGame.id);
    if (!gameId) return;
    setWinData(prev => prev ? { ...prev, syncError: false, syncing: true } : prev);
    submitDailyFinish(gameId, winData.finalScore, winData.steps, winData.timeSecs)
      .finally(() => setWinData(prev => prev ? { ...prev, syncing: false } : prev));
  };
  const retryRef = useRef(retryDailyFinish);
  retryRef.current = retryDailyFinish;

  // #132 — automatic re-send. Fires the moment the browser reports it is back
  // online while an unsynced result is on screen.
  useEffect(() => {
    if (!winData || winData.isClassic || !winData.syncError) return;
    const go = () => retryRef.current();
    window.addEventListener('online', go);
    // Also try once on a short delay: `online` doesn't fire if we were never
    // formally offline (a transient 5xx / captive portal looks the same to us).
    const t = setTimeout(go, 8000);
    return () => { window.removeEventListener('online', go); clearTimeout(t); };
  }, [winData && winData.syncError, winData && winData.gameId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Loss path (used by games that can be lost, e.g. Crypto Wordle). Records a
     finished row so the day stays locked, but does NOT touch the streak.
     Existing win-only games never call this.

     PHASE 3 (#161) — `meta.score` carries the score the run actually REACHED.
     It defaults to 0, so every game that doesn't pass one behaves exactly as
     before; the games where a high score IS the result (2048, Bounce, Snake,
     Diamond Rush) pass it and stop reporting "Earned +0" for a run whose score
     had already been sent to the leaderboard.

     Deliberately NOT passed by pass/fail dailies (Daily Cipher, Mine Finder,
     Mahjong, Drop Stack, Daily Snake, Daily Bounce): the daily leaderboard
     filters `score > 0`, so a non-zero loss would put a FAILED run on the
     board. Streaks are unaffected either way — computeStreak keys off
     finished_at, not score. */
  const handleLose = async (steps, timeSecs, meta) => {
    cancelProgressSave(); // same finish-race guard as handleWin
    const lostScore = meta && Number.isFinite(meta.score) ? Math.max(0, Math.round(meta.score)) : 0;
    if (practiceMode) { // #133 — practice losses are local too
      setPracticeResult({
        score: lostScore, steps, timeSecs,
        share: meta && meta.share, answer: meta && meta.answer, won: false,
        gameId: currentGame ? currentGame.id : null,
      });
      return;
    }
    /* #176 — a story or arcade loss must never touch the daily's attempt row.
       Story pays nothing for a failed band (the rung stays unticked, which is
       the whole point of a ladder); arcade still records the run, because run
       history is meant to hold everything you played, but a losing run can
       only ever tie a personal best, never beat one. */
    if (playMode === 'story' || playMode === 'arcade') {
      if (playMode === 'arcade') {
        await api(`/api/arcade/${currentGame.id}/finish`, {
          method: 'POST',
          body: JSON.stringify({
            band: arcadeBandId, score: lostScore, timeSecs, steps,
            runId: arcadeRunIdRef.current || 0,
            seed: currentArcadeSeed() || 0,
          }),
        }).catch(() => {});
      }
      dropLocalRun(currentGame.id, playMode,
        playMode === 'arcade' ? arcadeBandId : storyBand);
      setLoseData({
        steps, timeSecs, score: lostScore, finalScore: lostScore,
        share: meta && meta.share, answer: meta && meta.answer,
        scoreLabel: meta && meta.scoreLabel, scoreValue: meta && meta.scoreValue,
        winnerLabel: meta && meta.winnerLabel,
        modeLabel: playMode === 'story' ? 'Story' : 'Arcade',
      });
      return;
    }
    try {
      // A free-play classic run skips the server entirely. Mode, not entry —
      // see the matching note in handleWin.
      if (currentGame && playMode !== 'daily') {
        setLoseData({
          steps,
          timeSecs,
          score: lostScore,
          finalScore: lostScore,
          scoreLabel: meta && meta.scoreLabel,
          scoreValue: meta && meta.scoreValue,
          share: meta && meta.share,
          answer: meta && meta.answer,
          winnerLabel: meta && meta.winnerLabel,
          isClassic: true,
          gameId: currentGame.id,
        });
        // A loss can still be posted ("Game Over" result) — with the score the
        // run reached, which is the same number submitClassicScore already sent.
        setClassicLastResult({ gameId: currentGame.id, score: lostScore, steps, timeSecs });
        return;
      }
      const gameId = currentGame.id;
      // Guest loss (phase 8): nothing to commit — a loss has no board entry —
      // so just show the overlay with the guest note. No server call (no
      // attempt row exists), no local pending run.
      if (!authOk) {
        setLoseData({
          steps, timeSecs,
          score: lostScore,
          finalScore: lostScore,
          scoreLabel: meta && meta.scoreLabel,
          scoreValue: meta && meta.scoreValue,
          share: meta && meta.share,
          answer: meta && meta.answer,
          winnerLabel: meta && meta.winnerLabel,
          guest: true,
          gameId,
        });
        return;
      }
      setLoseData({
        steps,
        timeSecs,
        score: lostScore,
        finalScore: lostScore,
        scoreLabel: meta && meta.scoreLabel,
        scoreValue: meta && meta.scoreValue,
        share: meta && meta.share,
        answer: meta && meta.answer,
        winnerLabel: meta && meta.winnerLabel,
        hintsUsed: meta && meta.hintsUsed,
        wordsSolved: meta && meta.wordsSolved,
        wordsTotal: meta && meta.wordsTotal,
        gameId,
      });
      // A scored loss adds to the nav total, same as a win would.
      if (lostScore > 0) setTotalScore(t => t + lostScore);

      let ok = false, body = null;
      try {
        const res = await api(`/api/daily/${gameId}/finish`, {
          method: 'POST',
          body: JSON.stringify({ score: lostScore, steps, timeSecs }),
        });
        ok = res.ok; body = res.body;
      } catch (e) {
        console.error('[daily] lose submit threw:', e && e.message);
      }
      const stored = ok && body && body.attempt
        ? body.attempt
        : { gameId, score: lostScore, steps, timeSecs, finishedAt: new Date().toISOString() };
      setAttempts(prev => ({ ...prev, [gameId]: stored }));
    } catch (e) {
      console.error('[daily] handleLose failed:', e && e.message);
    }
  };

  /* Exit any game screen back to the home lobby.
     `tab` is OPTIONAL and must be a STRING. Several call sites used to pass
     this straight to onClick/onBack, so React handed it a SyntheticEvent —
     which then landed in `lobbyTab`, and the next render's
     JSON.stringify(navState) threw "Converting circular structure to JSON",
     unmounting the whole root (#150). Two barriers now: the typeof guard
     here, and primitive coercion in navState below.
     Only 'ladder'/'home' are real lobby views — a game CATEGORY ('daily' /
     'classic') is a home-grid filter chip, so it routes to setHomeFilter.
     Writing it to lobbyTab (as before) was a no-op nothing ever read. */
  const backToLobby = (tab) => {
    endPracticeRun(); // #367 — a practice seed only lives as long as its run
    setScreen('lobby');
    setCurrentGame(null);
    setReviewMode(false);
    setPracticeMode(false);
    setPracticeResult(null);
    setWinData(null);
    setLoseData(null);
    setClassicGameMode(null);
    setClassicGameModeOpts(null);
    setClassicLastResult(null);
    setPreLaunchGame(null);
    if (typeof tab !== 'string' || !tab) return;
    if (tab === 'daily' || tab === 'classic') { setLobbyTab('home'); setHomeFilter('all'); }
    else if (tab === 'ladder' || tab === 'home') setLobbyTab(tab);
  };

  /* #186 — the in-app back control, which was never a back control.
     Every "← Back" in this app called backToLobby(), a RESET: it clears the
     game, the result, the mode and the practice flag and sets screen to
     'lobby'. Measured, from a board reached home → card → pre-game → Play:
     the device back button unwound game → pregame → lobby a step at a time
     (the #134 reducer doing its job), while "← Back" jumped straight to the
     lobby AND pushed another entry (history.length 4 → 5), so pressing it and
     then device-back went FORWARD into the board you had just left.

     So this is not a second navigation model — it is the existing one, used.
     The only judgement here is the fallback: at depth 0 there is no entry of
     ours behind us (a cold deep link, which is the shape every share card
     carries), and history.back() would leave the app. `backToLobby` is then
     the right answer and the safe one.

     The result cards' "Back to Lobby" and the Ladder tab's "← Home" keep
     calling backToLobby directly: their labels name a destination, and going
     there is correct. */
  const goBack = (fallbackTab) => {
    if (navDepth.current > 0 && typeof window !== 'undefined' && window.history) {
      try { window.history.back(); return; } catch (e) {}
    }
    backToLobby(fallbackTab);
  };

  /* PHASE 4 (#133) — "Play again for fun".
     Mounts the SAME component with the SAME dailyRng seed (so it is genuinely
     today's puzzle, not a random one) and a bumped resetKey, but with
     practiceMode on: handleWin/handleLose bail out before any endpoint, and no
     /start claim happens because we never call startRun. */
  const startPractice = async (game, opts) => {
    if (!game) return;
    // Same rule as startRun: a corpus game must not deal from its fallback
    // just because practice skipped the screen that warms the table.
    if (CORPUS_GAMES.has(game.id)) await loadCorpus(game.id);
    /* #367 — `fresh` deals a RANDOM board (the pre-game Practice button), so
       the daily is not given away. Every other caller replays today's deal and
       must CLOSE any practice seed a previous run left open. */
    const fresh = !!(opts && opts.fresh);
    if (fresh) beginPracticeRun(); else endPracticeRun();
    setPracticeFresh(fresh);
    // Replay the deal the attempt was actually played on (#331). With no
    // attempt (e.g. the ?practice=1 deep link) Normal is the honest default —
    // it is the deal the day has always been. A fresh run uses the band the
    // pre-game screen is showing (the picker locks to the claimed band).
    const att = attempts[game.id];
    setPracticeBandId(opts && isDailyBand(opts.band)
      ? opts.band
      : (att && isDailyBand(att.band) ? att.band : 'normal'));
    setPlayMode('daily');
    setCurrentGame(game);
    setPracticeMode(true);
    setPracticeResult(null);
    setLockedReview(false);
    setWinData(null);
    setLoseData(null);
    setReviewMode(false);
    setStepCount(0);
    setPlayAgainKey(k => k + 1);
    setScreen('game');
  };

  const playAgain = () => {
    /* A deliberate restart, so the local resume record goes with it — without
       this the remount would hydrate straight back into the run that just
       ended (#187). */
    if (currentGame) {
      dropLocalRun(currentGame.id, playMode,
        playMode === 'arcade' ? arcadeBandId : storyBand);
    }
    setWinData(null);
    setLoseData(null);
    setReviewMode(false);
    setStepCount(0);
    setPlayAgainKey(k => k + 1);
    // Keep classicLastResult for the Game Menu.
  };

  /* PHASE 1 — `?result=1` screenshot-state deep link.
     The whole point of this phase is a screen that only exists AFTER a run
     ends, and neither the proposal checks nor the before/after screenshots can
     play a game to get there. This mounts a game and puts a representative
     results card over its (frozen, still-mounted) board, so the card, the
     "👁 View board" button, the collapsed minibar and the backdrop dismiss are
     all reachable by URL.

     Writes NOTHING: for a daily it uses the inert practiceMode path (#133's
     guarantee), and for a classic it only sets local `loseData` UI state — no
     endpoint is called on either path, which is why this link is deliberately
     NOT staging-gated (the "before" screenshot comes from production). */
  const RESULT_DEMO = { score: 8432, steps: 214, timeSecs: 372, tile: 512 };
  /* `?result=win` is the WIN card, which `?result=1` never reached: its daily
     branch goes through practiceResult and its classic branch sets loseData,
     so the one screen this issue is about had no URL at all. Same guarantee as
     the rest of the link — it is local UI state and calls no endpoint (the
     only daily write on this path is retryDailyFinish, which needs a press). */
  const winResultDemo = (game) => ({
    score: 1200, bonus: 240, finalScore: 1440, steps: 37, timeSecs: 214,
    multiplier: 1.2, effectiveStreak: 6, hintsUsed: 1, prevBest: 1180,
    gameId: game.id, demo: true,
    justAchievement: { icon: '🧩', name: 'Puzzler' },
    activeBadge: { icon: '🔥', name: 'Kindling' },
    share: `Game Corner ${game.name} — 1440 pts`,
  });
  const openResultDemo = (game, wantWin) => {
    if (!game) return;
    setCurrentGame(game);
    setLockedReview(false);
    // `&review=1` alongside `?result=1` lands with the card already collapsed
    // into its minibar — i.e. the "View board" state, which is the other half
    // of this phase and equally unreachable without clicking.
    setReviewMode(new URLSearchParams(window.location.search).get('review') === '1');
    setWinData(null);
    setLoseData(null);
    setPracticeResult(null);
    setPreLaunchGame(null);
    setClassicGameMode(null);
    setClassicGameModeOpts(null);
    setStepCount(0);
    setScreen('game');
    if (wantWin) {
      setPracticeMode(false);
      if (game.daily) setPlayMode('daily');
      // #331 — `?band=easy|hard` with `?result=win` shows the win card as a
      // band run ends: the caption under the earned score and the Difficulty
      // row in the details. Pure local UI state, like the rest of the demo.
      const rDemo = new URLSearchParams(window.location.search).get('band');
      const rBand = (rDemo === 'easy' || rDemo === 'hard') ? rDemo : 'normal';
      setDailyBand(rBand);
      setWinData(game.daily
        ? { ...winResultDemo(game), band: rBand }
        : { ...winResultDemo(game), isClassic: true, bestScore: 1180, multiplier: 1, bonus: 0 });
      return;
    }
    if (game.daily) {
      setPracticeMode(true);
      setPracticeResult({
        score: RESULT_DEMO.score, steps: RESULT_DEMO.steps,
        timeSecs: RESULT_DEMO.timeSecs, won: false, gameId: game.id,
      });
      return;
    }
    setPracticeMode(false);
    /* #213 — `?result=1&pmode=story|arcade` shows the result card as it looks
       at the END OF A MODE RUN rather than a free-play one, which is where
       "Continue Story Quest" lives. A lost story rung is reachable no other
       way: you would have to actually lose one, and neither a proposal check
       nor a screenshot can play. Still writes nothing — this is local UI state
       on the same inert path the rest of ?result=1 uses. */
    const demoMode = new URLSearchParams(window.location.search).get('pmode');
    const modeLabel = demoMode === 'story' && supportsMode(game.id, 'story') ? 'Story'
      : demoMode === 'arcade' && supportsMode(game.id, 'arcade') ? 'Arcade'
      : null;
    if (modeLabel) setPlayMode(modeLabel === 'Story' ? 'story' : 'arcade');
    setLoseData({
      steps: RESULT_DEMO.steps,
      timeSecs: RESULT_DEMO.timeSecs,
      score: RESULT_DEMO.score,
      finalScore: RESULT_DEMO.score,
      scoreLabel: game.id === '2048' ? 'Highest tile' : 'Best run',
      scoreValue: game.id === '2048' ? RESULT_DEMO.tile : RESULT_DEMO.score,
      share: `Game Corner ${game.name} — ${RESULT_DEMO.score} pts`,
      winnerLabel: modeLabel ? 'Game Over' : undefined,
      modeLabel: modeLabel || undefined,
      isClassic: !modeLabel,
      gameId: game.id,
    });
  };

  // Game Menu "New Game": optionally re-mount the current classic game in a
  // chosen mode (Versus Bot / 2 Players / Online), clearing the prior result.
  const handleNewGameMode = (mode, opts) => {
    setClassicGameMode(mode || null);
    setClassicGameModeOpts(opts || null);
    setClassicLastResult(null);
    setWinData(null);
    setLoseData(null);
    setStepCount(0);
    setPlayAgainKey(k => k + 1);
  };

  // Game Menu "Save Game": persist the active Versus-Bot game's snapshot via
  // the generic user_game_state store.
  const handleSaveGame = async () => {
    if (!currentGame) return { ok: false };
    const snap = ClassicBridge.getSnapshot ? ClassicBridge.getSnapshot() : null;
    if (!snap) return { ok: false };
    const { ok } = await api(`/api/state/${currentGame.id}`, {
      method: 'PUT',
      body: JSON.stringify({ state: { mode: 'bot', savedAt: Date.now(), ...snap } }),
    }).catch(() => ({ ok: false }));
    return { ok: !!ok };
  };

  // Build the menu config passed into ClassicShell for classic games.
  const classicMenuConfig = (currentGame && currentGame.category === 'classic') ? {
    game: currentGame,
    gameMode: classicGameMode,
    lastResult: classicLastResult,
    onNewGameMode: handleNewGameMode,
    onSaveGame: handleSaveGame,
  } : null;

  const fmtTime = s =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const GameComponent = currentGame ? currentGame.component : null;

  // Render the active game's body according to its declarative `shell` flag.
  // Collapses what used to be a thicket of id/category/SELF_SHELL_GAMES checks
  // into one switch — adding a game is now purely a matter of its registry entry.
  const renderGameBody = () => {
    if (!currentGame) return null;
    /* #176 — every shell hands the game the same mode context, so a game
       component never has to know which shell it is under to know how it was
       opened. Games that predate the play-mode axis ignore all four and behave
       exactly as before, which is what keeps this backward-compatible.
         playMode  — 'daily' | 'story' | 'arcade' | null
         band      — story: the rung index; arcade: the Easy/Normal/Hard id
         gameId    — the registry id, so a component shared by two entries
                     (Sudoku and Sudoku Mini) can tell which one it is
         onBandCleared — story only: report a rung finished so it can be ticked */
    const modeProps = {
      gameId: currentGame.id,
      playMode,
      /* #331 — the daily's band. A daily runs on its band whether or not the
         shell knows the mode (the ?practice=1 link mounts with playMode null),
         so the gate is the game's daily flag, not playMode === 'daily'. A
         practice replay runs on the attempt's band; a live run on the picked
         one. Classics keep null exactly as before. */
      band: playMode === 'arcade' ? arcadeBandId
        : playMode === 'story' ? storyBand
        : currentGame.daily ? (practiceMode ? practiceBandId : dailyBandId)
        : null,
      onBandCleared: playMode === 'story' ? handleBandCleared : undefined,
    };
    /* #185 — a story game caches its board in a useRef at mount, so moving the
       band is only visible if the component REMOUNTS. This key is that remount,
       and it is scoped to story on purpose: every other mode keeps its identity
       across a re-render exactly as before. playAgainKey rides along so "Try
       this band again" re-deals the same band. */
    const bodyKey = playMode === 'story'
      ? `story-${currentGame.id}-${storyBand}-${playAgainKey}` : undefined;
    /* ONLY A DAILY RESUMES *INTO THE ATTEMPT ROW*. That row is keyed by
       (user, game, UTC day) and exists only once /start has claimed the day, so
       a story or arcade run saving into it 409s (a console error, which trips
       the no-console-errors check) and READING from it is worse: a
       half-finished daily board would hydrate into a story rung that is
       supposed to be a fixed, retryable deal.

       Every word of that is about the SERVER, and none of it was ever a reason
       for a story rung to lose ten minutes of work to a reload (#187 / #196) —
       which is exactly what happened, because with both props null the game had
       nowhere to write anything down. Story and arcade now resume from a
       DEVICE-LOCAL record instead, so the attempt row is untouched and the
       twenty-odd game components need no changes: they already know how to
       hydrate from savedProgress and to write through onSaveProgress. */
    const resumable = playMode === 'daily' && !practiceMode;
    const localResumable = (playMode === 'story' || playMode === 'arcade') && !practiceMode;
    switch (currentGame.shell) {
      case 'self':
        // Full-screen, gesture-first game that renders its own ClassicShell.
        return (
          <GameComponent
            key={bodyKey}
            {...modeProps}
            game={currentGame}
            onBack={() => goBack('classic')}
            onWin={handleWin}
            onLose={handleLose}
            onStepChange={setStepCount}
            offset={offset}
            /* #215 — `resultShown` is gone with the panel it silenced. Phase 1
               (#160) added it because Hash Rush drew an end panel of its own;
               that panel turned out to exist only in the gap before the shared
               card arrived, so it was deleted and no shell:'self' game has one
               now. Keep it that way: the shared results card is the ending. */
            resetKey={playAgainKey}
            menuConfig={classicMenuConfig}
            gameMode={classicGameMode}
            gameModeOpts={classicGameModeOpts}
            onModeChange={setClassicGameMode}
          />
        );
      case 'classic': {
        // In-frame classic game wrapped in the shared ClassicShell.
        const classicSections = [
          ...(currentGame.leaderboard
            ? [cgLeaderboardSection(currentGame.id, currentGame.leaderboardOpts)]
            : []),
          // Registry-declared extra sheet sections (e.g. Minesweeper's
          // "My Best Runs" history) — same declarative pattern as the flags.
          ...(typeof currentGame.sheetExtras === 'function' ? currentGame.sheetExtras() : []),
        ];
        return (
          <ClassicShell
            game={currentGame}
            onExit={() => goBack('classic')}
            onNewGame={() => setPlayAgainKey(k => k + 1)}
            menuConfig={classicMenuConfig}
            sheetSections={classicSections}
            onHowTo={currentGame.howToPlay && currentGame.howToPlay.length > 0
              ? () => setHowToGame(currentGame) : undefined}
            onChat={authOk ? () => setChatGame(currentGame) : undefined}
          >
            {/* PHASE 3 — the classic stage keeps .cg-scroll DELIBERATELY: making
                it overflow:hidden would CLIP a tall setup screen rather than fit
                it, which is the exact failure Daily Cipher had. What stops the
                scrolling is upstream — useScrollLock owns the document while a
                run is live, and the five phase-5 board games honour the
                --cg-board viewport cap (folded into .brg-canvas-box's
                max-width), so board + status + legend fit at 390x844. */}
            <div className="cg-stage cg-scroll">
              <GameComponent
                key={bodyKey}
                {...modeProps}
                onWin={handleWin}
                onLose={handleLose}
                onStepChange={setStepCount}
                offset={offset}
                resetKey={playAgainKey}
                gameMode={classicGameMode}
                gameModeOpts={classicGameModeOpts}
                onModeChange={setClassicGameMode}
                onBack={() => goBack('classic')}
              />
            </div>
          </ClassicShell>
        );
      }
      case 'daily':
      default: {
        // Daily puzzle (and any back-header game-wrap game): resumable, locked.
        // The Daily Tile Match reports its own engine-shaped moves through
        // onMoveTile; the other dailies get their onStepChange calls recorded
        // as timestamp-only events (recording BOTH for the tile match would
        // double every tap in the log and skew the timing heuristics).
        const logsOwnMoves = currentGame.id === 'tilematchingdaily';
        // `fitShell` (slice 1) opts a daily into the non-scrolling
        // viewport-height column; the game body then flexes to fill it and
        // sizes its own board with useFitBox. Games without the flag keep the
        // original scrolling game-wrap untouched.
        return (
          <div className={'game-wrap' + (currentGame.fitShell ? ' fit' : '')}>
            <div className="game-head">
              <button className="back-btn" onClick={() => goBack()}>← Back</button>
              <div className="game-title">
                <span>{currentGame.icon}</span> {currentGame.name}
              </div>
              {authOk && (
                <button
                  className="help-btn"
                  title="Game chat"
                  aria-label="Game chat"
                  onClick={() => setChatGame(currentGame)}
                >💬</button>
              )}
              {currentGame.howToPlay && currentGame.howToPlay.length > 0 && (
                <button
                  className="help-btn"
                  title="How to play"
                  aria-label="How to play"
                  onClick={() => setHowToGame(currentGame)}
                >?</button>
              )}
            </div>
            <GameComponent
              /* #198 — the REPLAY controls on a daily's result card ("Play
                 again for fun", "Another practice run") go through
                 startPractice, which bumps playAgainKey and clears the
                 overlay. But nothing consumed that: `resetKey` is passed
                 below and NO daily reads it (only three classics do), and
                 without a key React reuses this component in place, because
                 the element type and position never change. So the card
                 vanished and the finished run stayed exactly as it was — a
                 dead board with its clock at zero, which is the reported
                 "Play Again fails to launch".

                 Keying on playAgainKey makes the replay an actual remount, so
                 every daily restarts from its own initial state without any of
                 the 23 game components needing to know about it. The key
                 changes ONLY at the four deliberate start-fresh moments
                 (startPractice, playAgain, a classic mode change, and
                 ClassicShell's New Game), so a normal run is never remounted
                 mid-play. */
              key={bodyKey || playAgainKey}
              {...modeProps}
              onWin={handleWin}
              onLose={handleLose}
              onStepChange={logsOwnMoves ? setStepCount : (n) => {
                // A practice run must never contribute to the verification log.
                if (!practiceMode) recordDailyMove({ k: 'step' });
                setStepCount(n);
              }}
              onMoveTile={logsOwnMoves && !practiceMode ? recordDailyMove : undefined}
              offset={offset}
              savedProgress={resumable ? progressFor(attempts[currentGame.id])
                : localResumable ? localRunProgress : null}
              onSaveProgress={resumable ? handleSaveProgress
                : localResumable ? saveLocalRun : null}
              resetKey={playAgainKey}
            />
          </div>
        );
      }
    }
  };

  // The card-table home (the Ladder tab keeps its own layout). The felt itself
  // is the whole app's palette now, painted on <html> and <body>.
  const deckFelt = screen === 'lobby' && lobbyTab !== 'ladder';

  // Home derivations. featuredGame resolves the server's daily_featured row
  // against the client registry; matchItems are the viewer's online matches
  // (waiting or active, from /api/rooms/mine) for the Your matches row.
  const featuredGame = featured ? GAMES.find((g) => g.id === featured.gameId) : null;
  const matchItems = myRooms
    .map((r) => {
      const game = GAMES.find((g) => g.id === r.gameId);
      return { room: r, game, card: game ? CARD_BY_GAME_ID[game.id] : null };
    })
    .filter((x) => x.card);

  /* ---- The open card (flip-deck lobby) ----
     Opening a card is NOT navigation: the lobby stays the page, and the card's
     back is the game's pre-game panel. Its mode and bands live on `deckOpen`
     (null = the default) until Play, when they are written into App state and
     the run starts exactly as the pre-game screen's own Play starts it. */
  const openDeckCard = (card, faceEl, preferMode) => {
    if (loading || !card) return;
    let src = null;
    try {
      const r = faceEl && faceEl.getBoundingClientRect ? faceEl.getBoundingClientRect() : null;
      if (r && r.width > 0) src = { x: r.left, y: r.top, w: r.width };
    } catch (e) {}
    const mode = preferMode && card.modes.some(m => m.mode === preferMode) ? preferMode : null;
    setDeckOpen({ key: card.key, mode, story: null, arcade: null, daily: null, src, closing: false });
  };
  const closeDeckCard = () => setDeckOpen(d => (d && !d.closing ? { ...d, closing: true } : d));
  const setDeck = (patch) => setDeckOpen(d => (d ? { ...d, ...patch } : d));
  const deckCard = deckOpen ? CARD_BY_KEY[deckOpen.key] || null : null;
  /* The tab a card opens on: today's daily while it is still to play, else the
     first other way to play, else the (finished) daily. */
  const deckMode = !deckCard ? null : (deckOpen.mode || (() => {
    const daily = deckDailyState(deckCard, attempts);
    if (daily && daily !== 'done') return 'daily';
    const other = deckCard.modes.find(m => m.mode !== 'daily');
    return other ? other.mode : (deckCard.modes[0] ? deckCard.modes[0].mode : null);
  })());
  const deckEntry = deckCard && deckMode ? deckCard.modes.find(m => m.mode === deckMode) : null;
  const deckGame = deckCard ? GAMES.find(g => g.id === (deckEntry ? deckEntry.gameId : deckCard.gameId)) || null : null;
  const deckStoryBand = deckOpen && deckOpen.story != null ? deckOpen.story : (deckGame ? nextUnclearedBand(deckGame.id) : 0);
  const deckArcadeBand = (deckOpen && deckOpen.arcade) || arcadeBandId;
  const deckDailyBand = (deckOpen && deckOpen.daily) || dailyBandId;
  /* The panel's ways out leave the card open: it goes when the screen
     changes (the effect below). A daily's Play waits on its /start claim, and
     closing the card first would leave a lobby-without-card history entry in
     between, so back from the game would not return to the card. */
  const deckPlay = () => {
    if (!deckGame || loading) return;
    const g = deckGame, mode = deckMode;
    // The state launchGame prepares for the pre-game screen, then that
    // screen's Play: one path into a run, whichever door it came through.
    endPracticeRun();
    allowProgressSave(g.id);
    setPlayMode(mode);
    if (mode === 'story') setStoryBand(deckStoryBand);
    if (mode === 'arcade') setArcadeBandId(deckArcadeBand);
    if (mode === 'daily') setDailyBand(deckDailyBand);
    setCurrentGame(g);
    setWinData(null);
    setLoseData(null);
    setPracticeMode(false);
    setArcadeReplaySeed(null);
    startRun(g, { mode, arcadeBand: deckArcadeBand, dailyBand: deckDailyBand });
  };
  // A card with no play modes: the head-to-head games go to their opponent
  // screen, Escape from Dracula opens straight into its reader.
  const deckStart = () => {
    if (!deckGame || loading) return;
    const g = deckGame;
    if (g.modeSelect) { openOpponentScreen(g); return; }
    setClassicGameMode(null);
    setClassicGameModeOpts(null);
    launchGame(g);
  };
  // A played daily's "See today's result" is the locked result screen.
  const deckSeeResult = () => {
    if (!deckGame) return;
    launchGame(deckGame, 'daily');
  };

  /* The arcade tab's "Best on this band", the same read the pre-game screen
     makes for itself (see the effect above), for the card that is open. */
  useEffect(() => {
    if (!deckOpen || deckMode !== 'arcade' || !deckGame || !authOk) {
      setDeckArcadeBest(null);
      return;
    }
    let live = true;
    api(`/api/arcade/${deckGame.id}/leaderboard?band=${encodeURIComponent(deckArcadeBand)}`)
      .then(r => { if (live && r.ok && r.body) setDeckArcadeBest(r.body.me || null); })
      .catch(() => {});
    return () => { live = false; };
  }, [deckOpen && deckOpen.key, deckMode, deckGame && deckGame.id, deckArcadeBand, authOk]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving the lobby takes the open card with it (Play, a deep link, …).
  useEffect(() => {
    if (screen !== 'lobby' || lobbyTab !== 'home') setDeckOpen(null);
  }, [screen, lobbyTab]);

  /* ?card=<game id or card key> opens that card on the lobby, already turned
     over, and ?cmode=daily|story|arcade picks its tab; ?card=gotd is whatever
     today's Game of the day is. The card's back is otherwise reachable only by
     a tap, which proposal checks and before/after screenshots cannot make.
     Consumed once, after the day has loaded (the tab a card opens on depends
     on today's attempts, and gotd on today's featured game). */
  const deckLinkedRef = useRef(false);
  useEffect(() => {
    if (loading || deckLinkedRef.current) return;
    deckLinkedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const id = params.get('card');
    if (!id || params.get('game')) return;
    const card = id === 'gotd'
      ? (featuredGame ? CARD_BY_GAME_ID[featuredGame.id] : null)
      : CARD_BY_KEY[id] || CARD_BY_KEY['card:' + id] || CARD_BY_GAME_ID[id];
    if (!card) return;
    const cm = params.get('cmode');
    setDeckOpen({ key: card.key, mode: card.modes.some(m => m.mode === cm) ? cm : null, story: null, arcade: null, daily: null, src: null, closing: false });
  }, [loading]);

  // Re-enter an active online match from the in-progress row: pre-seat the
  // player (roomId + seat number) through the classic game-mode opts so
  // BoardRoomGame / Chutes & Ladders skip the create/join setup screen.
  const resumeRoom = (room) => {
    const g = GAMES.find((x) => x.id === room.gameId);
    if (!g || loading) return;
    setClassicGameMode('online');
    setClassicGameModeOpts({ roomId: room.id, myPlayerNum: room.myPlayerNum });
    launchGame(g);
  };

  // Pin the shell to exactly one viewport while a fit-mode game is on screen
  // (slice 1), so the board's flex column measures against real space instead
  // of growing the document. Every other screen keeps normal page scrolling.
  // Server-anchored reset clock for the merged grid's daily note (slice 2) —
  // the same hook LockedScreen and the pre-game screen use, so every countdown
  // in the app ticks off one clock.
  /* The home page's midnight trigger. #234 removed the note that RENDERED this
     string — the Game-of-the-Day hero directly above it runs the same clock —
     but the call stays, because it is also what fires onReset at 00:00 UTC.
     The hero has its own useCountdown, so on most days either would do; when
     there is no featured game the hero falls back to a plain formatted string
     with no expiry hook at all, and this is the only thing left watching. */
  useCountdown(nextResetUtc, offset, onReset);

  /* PHASE 1 (#158/#160/#162) — one `resultData` for every kind of ending, so
     the frozen board, the minibar, the backdrop dismiss and "View board" all
     key off the same value instead of three near-copies of the same condition.
     A practice result is a result: it used to leave winData/loseData null,
     which is precisely why the practice overlay had no way back to the board. */
  const practiceResultData = (practiceMode && practiceResult)
    ? { ...practiceResult, isPractice: true }
    : null;
  const resultData = winData || loseData || practiceResultData;

  const fitActive = (screen === 'game' && !!currentGame && !!currentGame.fitShell
    && (!resultData || reviewMode))
    || (screen === 'locked' && !!currentGame && !!currentGame.fitShell && lockedReview);

  /* PHASE 4 (#122) — a locked day can show the solved board only if the finished
     attempt carries a snapshot. `finish` now writes one in the SAME UPDATE as
     score/steps/finished_at (no second request, so the no-save-on-the-winning-
     move rule is untouched), and /api/daily returns it for finished rows.
     Real-time dailies with no resume (Daily Snake, Daily Bounce, Word Sprint)
     legitimately have nothing to snapshot — stated behaviour, not a bug. */
  const lockedAttempt = screen === 'locked' && currentGame ? attempts[currentGame.id] : null;
  const lockedReviewable = !!(lockedAttempt && lockedAttempt.finishedAt && lockedAttempt.progress);

  /* Whether the finished board can be shown under the results card (slice 4).
     Guarded on the result belonging to the CURRENTLY mounted game, so a stale
     board can never be presented as this run's.

     PHASE 1 (#157/#160) — the `shell !== 'self'` exclusion is GONE. Its comment
     claimed those classics draw their own game-over overlay; they do not
     (SnakeGameplay has only a `paused` overlay), so the exclusion just made the
     render below unmount the body and put the results card over a blank page.
     Snake, Block Fit, Diamond Rush and Hash Rush now keep their final board
     frozen behind the card like every other game. */
  /* #195 — `reviewBoard: false` in the registry opts a game out of the review
     step. Reviewing a frozen board is worth a tap when the board IS the result
     (a solved nonogram, a final 2048 grid); for Daily Cipher the result card
     already reveals the answer and the score, so the board behind it repeats
     what you just read and the overlay is one more thing to dismiss. It is a
     declarative flag rather than an id check here, because "does my board say
     anything after the run" is a property of a game, not of the shell. */
  const boardReviewable = screen === 'game' && !!currentGame && !!resultData
    && currentGame.reviewBoard !== false
    && (!resultData.gameId || resultData.gameId === currentGame.id);

  /* #162 — dismissing a results card reveals the board behind it. One handler
     for all three overlays: only a press on the SCRIM itself counts (a press on
     the card bubbles to the same node, hence the target check), and it fires on
     pointerdown so it lands on finger-DOWN like the shared tap primitive. */
  /* #241 — the result card opens as the arcade moment and nothing else; the
     breakdown, the badge furniture and the leaderboard are one tap away. It
     resets whenever the result does, so the next win opens on the moment
     again rather than on whatever the last one was left showing. */
  const [winDetails, setWinDetails] = useState(false);
  useEffect(() => { setWinDetails(false); }, [winData, loseData, practiceResult]);

  const dismissResultCard = (e) => {
    if (e && e.target !== e.currentTarget) return;
    if (!boardReviewable) return;
    setReviewMode(true);
  };

  // Escape does the same thing, for keyboard/desktop players.
  useEffect(() => {
    if (!resultData || reviewMode || !boardReviewable) return;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setReviewMode(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [resultData, reviewMode, boardReviewable]);

  // What the collapsed minibar says, per result kind.
  const resultMinibarLabel = () => {
    if (winData) {
      return `${winData.winnerLabel || 'Solved'} · +${winData.finalScore != null ? winData.finalScore : winData.score}`;
    }
    if (loseData) {
      return `Game over · +${loseData.finalScore != null ? loseData.finalScore : 0}`;
    }
    if (practiceResultData) {
      return `${practiceResultData.won ? 'Practice solve' : 'Practice run over'} · ${practiceResultData.score}`;
    }
    return 'Result';
  };

  /* NOTE: <style>{css}</style> is deliberately NOT rendered here any more — it
     is a sibling ABOVE AppErrorBoundary at the root mount (see the bottom of
     this file). When a render threw, React unmounted this whole subtree and
     took the stylesheet with it, so the failure mode was a *styled* blank page
     followed by an unstyled one (#150). Keeping the stylesheet outside the
     boundary is what lets the fallback panel render styled. */
  return (
    /* data-nav-depth is what a proposal check can actually see: a check can
       navigate but cannot press back, and the case worth guarding is the cold
       deep link, where depth 0 is the difference between falling back to the
       lobby and stepping the embedding page out of the app. */
    <div className={'app' + (fitActive ? ' app-fit' : '')} data-nav-depth={navDepthTick}>
      <nav className="nav felt">
        <div className="nav-brand">
          <span className="logo" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="26" height="26"><circle cx="16" cy="16" r="15" fill="#D9B35E" /><circle cx="16" cy="16" r="13.6" fill="none" stroke="#2A1E05" strokeWidth="3" strokeDasharray="4 4.8" opacity="0.35" /><circle cx="16" cy="16" r="9.5" fill="#C29A45" /><circle cx="16" cy="16" r="5" fill="#2A1E05" opacity="0.8" /></svg>
          </span>
          <span className="brandword">Game Corner</span>
        </div>
        {/* The bar is the mark and your profile, nothing else (flip-deck
            redesign). The day's score and streak are the lobby's Today strip;
            Friends and Settings are on your profile, and the theme is in
            Settings. A signed-out visitor has no profile, so the Settings
            gear stands in for it — it is where the theme lives. */}
        <div className="nav-right">
          {!loading && (!authOk || !user) && (
            <button
              className="nav-settings-btn"
              title="Settings"
              aria-label="Settings"
              onClick={() => setSettingsOpen(true)}
            >
              ⚙
            </button>
          )}
          <AccountChip
            loading={loading}
            failed={dailyErr}
            authOk={authOk}
            user={user}
            onOpen={() => {
              if (user && user.id) { setSelectedUserId(user.id); setScreen('profile'); }
            }}
          />
        </div>
      </nav>

      {screen === 'profile' && selectedUserId && (
        <ProfileScreen
          userId={selectedUserId}
          user={user}
          myScores={myScores}
          onBack={() => goBack()}
          onOpenFriends={() => setScreen('friends')}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}

      {screen === 'friends' && (
        <FriendsListScreen
          onSelectUser={(userId) => { setSelectedUserId(userId); setScreen('profile'); }}
          onBack={() => goBack()}
        />
      )}

      {screen === 'lobby' && (
        <div className={'lobby screen-in' + (deckFelt ? ' fd-lobby' : '')}>
          {lobbyTab === 'ladder' ? (
            <React.Fragment>
              <button className="home-back-btn" onClick={() => setLobbyTab('home')}>← Home</button>
              <div className="lobby-head">
                <h1>Rating Ladder</h1>
                <p>Head-to-head Elo — win online matches to climb.</p>
              </div>
              {/* Gated on !loading so a ?demo=ladder fixture (seeded inside
                  loadDaily's /api/daily call) lands before the ladder fetches. */}
              {!loading && <LadderScreen />}
            </React.Fragment>
          ) : (
            /* The flip-deck home: Game of the day → Today (streak, points) →
               Today's dailies → Your matches → All games, on felt. Every game
               is a card and the card is the way in: it opens (DeckOpenCard)
               into the pre-game panel. The Rating Ladder remains reachable via
               the ?tab=ladder deep link. */
            <React.Fragment>
              {commitNotice && (
                <div className="commit-notice" onClick={() => setCommitNotice(null)}>{commitNotice}</div>
              )}
              {(() => {
                /* Everything below reads the same attempts / pins / favorites
                   the old grid read, so a card can never disagree with the row
                   or the shelf it also appears in. */
                const favoriteSet = new Set();
                for (const id of favorites) {
                  const c = CARD_BY_GAME_ID[id];
                  if (c) favoriteSet.add(c.key);
                }
                const pinnedSet = new Set();
                for (const id of pins) {
                  const c = CARD_BY_GAME_ID[id];
                  if (c) pinnedSet.add(c.key);
                }
                const starredCount = favoriteSet.size;
                const dailyCards = GAME_CARDS.filter(c => cardDailyId(c));
                const doneCount = dailyCards.filter(c => deckDailyState(c, attempts) === 'done').length;
                const dailyRow = deckDailyOrder(dailyCards, attempts, myScores, featuredGame ? featuredGame.id : null);
                const featuredCard = featuredGame ? CARD_BY_GAME_ID[featuredGame.id] || null : null;
                const shelfCards = (id) => GAME_CARDS.filter(c => DECK_SHELF_OF[c.key] === id);
                /* The chip narrows the shelves to one (or to your favorites);
                   the search narrows whatever the chip shows. Pinned cards
                   (#232) sit on their own shelf above the rest and are taken
                   out of their usual one, so a card appears once. */
                const chipCards = homeFilter === 'favorites'
                  ? GAME_CARDS.filter(c => favoriteSet.has(c.key))
                  : DECK_SHELF_IDS.indexOf(homeFilter) !== -1 ? shelfCards(homeFilter) : GAME_CARDS;
                const query = homeSearch.trim();
                const searched = chipCards.filter(c => homeSearchMatch(c, homeSearch));
                const pinnedCards = homeFilter === 'all' && !query ? GAME_CARDS.filter(c => pinnedSet.has(c.key)) : [];
                const dailySub = (c) => {
                  const st = deckDailyState(c, attempts);
                  if (st === 'live') return { sub: 'In progress', subCls: 'fd-sub go' };
                  if (st === 'done') {
                    const a = attempts[cardDailyId(c)];
                    return { sub: `Played · +${a && a.score != null ? a.score : 0}`, subCls: 'fd-sub' };
                  }
                  if (featuredCard && c.key === featuredCard.key) return { sub: 'Game of the day', subCls: 'fd-sub go' };
                  return {};
                };
                const cardBtn = (c, extra) => (
                  <DeckCardBtn key={c.key} card={c} attempts={attempts} onOpen={(card, el) => openDeckCard(card, el)} {...(extra || {})} />
                );
                const scrollRow = (dir) => {
                  const row = document.querySelector('.fd-dailies');
                  if (row && row.scrollBy) row.scrollBy({ left: dir * row.clientWidth * 0.8, behavior: cgReducedMotion() ? 'auto' : 'smooth' });
                };
                const pipSvg = (suit) => (
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d={DECK_PIP[suit]} fill="currentColor" /></svg>
                );
                const ringDash = dailyCards.length ? (doneCount / dailyCards.length) * 44 : 0;
                return (
                  <React.Fragment>
                    {loading && !featuredGame ? (
                      /* Holds the hero's footprint while /api/daily is in
                         flight, so nothing below jumps when it lands. Static:
                         no motion, so the reduce-motion lists need no entry. */
                      <div className="fd-hero fd-hero-skel" aria-hidden="true">
                        <div className="fd-skel-card" />
                        <div className="fd-skel-info"><div className="fd-skel-bar w1" /><div className="fd-skel-bar w2" /><div className="fd-skel-bar w3" /></div>
                      </div>
                    ) : featuredGame && featuredCard ? (
                      <DeckHero
                        card={featuredCard}
                        game={featuredGame}
                        attempts={attempts}
                        attempt={attempts[featuredGame.id]}
                        authOk={authOk}
                        nextResetUtc={nextResetUtc}
                        offset={offset}
                        onReset={onReset}
                        onOpen={(card, el) => openDeckCard(card, el, 'daily')}
                      />
                    ) : dailyErr ? (
                      /* A 5xx used to leave nothing where the hero sits. Say
                         so, and offer the refetch, in the hero's own frame. */
                      <div className="fd-hero fd-hero-err">
                        <span className="fd-err-line">Couldn't load today's game.</span>
                        <button className="fd-btn fd-err-retry" onClick={retryDaily}>Try again</button>
                      </div>
                    ) : null}

                    {authOk && !loading && (
                      <div className="fd-today" aria-label="Today">
                        <div className="fd-stat fd-streak" data-streak={streak} data-best={Math.max(bestStreak, streak)}>
                          <div className="fd-num">
                            <svg className="fd-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c.8 3.4 5 5.4 5 10.2a5 5 0 0 1-10 0c0-2.4 1.3-3.9 2.4-4.9.3 1.7 1.1 2.6 2.4 2.9-.4-3 .6-5.6.2-8.2z" /></svg>
                            {streak}
                          </div>
                          {/* #362 — the record the streak is chasing rides
                              beside it, once there is one above it. */}
                          <div className="fd-lbl2">day streak{Math.max(bestStreak, streak) > streak ? ` · best ${Math.max(bestStreak, streak)}` : ''}</div>
                        </div>
                        <div className="fd-stat fd-points">
                          <div className="fd-num">
                            <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="#B83227" /><circle cx="16" cy="16" r="13" fill="none" stroke="#F3EBD8" strokeWidth="3.5" strokeDasharray="5 5.2" opacity="0.9" /><circle cx="16" cy="16" r="8.5" fill="#9E2A20" stroke="#F3EBD8" strokeWidth="1" strokeOpacity="0.6" /></svg>
                            {totalScore.toLocaleString()}
                          </div>
                          <div className="fd-lbl2">points today</div>
                        </div>
                      </div>
                    )}

                    <section className="fd-sec" aria-labelledby="fd-dl-h">
                      <div className="fd-sec-head">
                        <h2 id="fd-dl-h">Today's dailies</h2>
                        <div className="fd-sec-r">
                          <span className="fd-count" data-done={doneCount}>
                            <svg viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="7" className="fd-ring-bg" /><circle cx="9" cy="9" r="7" className="fd-ring-fg" strokeDasharray={`${ringDash} 44`} transform="rotate(-90 9 9)" /></svg>
                            <b>{doneCount}</b> of {dailyCards.length} played
                          </span>
                          <div className="fd-row-nav">
                            <button type="button" className="fd-rn" aria-label="Scroll the dailies back" onClick={() => scrollRow(-1)}>
                              <svg className="fd-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
                            </button>
                            <button type="button" className="fd-rn" aria-label="Scroll the dailies on" onClick={() => scrollRow(1)}>
                              <svg className="fd-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                            </button>
                          </div>
                        </div>
                      </div>
                      <p className="fd-hint">The ones you play most come first. Tap a card to open it.</p>
                      {/* Keyed on what leads the row: a scroll-snapped row keeps
                          its snap on the SAME card when cards are inserted ahead
                          of it, so when the day loads and the game of the day
                          moves to the front, the old row would open scrolled one
                          card in, hiding it. A new row starts at the start. */}
                      <div
                        key={'dl-' + (loading ? 'loading' : (dailyRow[0] ? dailyRow[0].key : ''))}
                        className="fd-row fd-dailies"
                        role="list"
                        aria-label="Today's daily games"
                      >
                        {dailyRow.map(c => cardBtn(c, dailySub(c)))}
                      </div>
                    </section>

                    {authOk && matchItems.length > 0 && (
                      /* The only way back into an online match is from here,
                         so the row stays — and only shows when there is one. */
                      <section className="fd-sec" aria-labelledby="fd-m-h">
                        <div className="fd-sec-head"><h2 id="fd-m-h" className="minor">Your matches</h2></div>
                        <div className="fd-row fd-matches">
                          {matchItems.map(({ room, card }) => {
                            const expH = roomExpiresInHours(room);
                            const sub = room.waiting ? 'Waiting for a player' : room.myTurn ? 'Your turn' : 'Their move';
                            const sub2 = room.waiting
                              ? `Room ${room.id}`
                              : `vs ${room.opponentName}${expH != null ? ` · expires in ${expH}h` : ''}`;
                            return (
                              <DeckCardBtn
                                key={'r-' + room.id}
                                card={card}
                                attempts={attempts}
                                live={!!room.myTurn}
                                label={`${card.name}: ${sub}, ${sub2}`}
                                onOpen={() => resumeRoom(room)}
                                sub={sub}
                                subCls={room.myTurn ? 'fd-sub go' : 'fd-sub'}
                                sub2={sub2}
                                sub2Cls={expH != null && expH <= 6 && !room.waiting ? 'fd-sub2 warn' : 'fd-sub2'}
                              />
                            );
                          })}
                        </div>
                      </section>
                    )}

                    <section className="fd-sec" aria-labelledby="fd-all-h">
                      <div className="fd-sec-head"><h2 id="fd-all-h" className="home-all-title">All games</h2></div>
                      {/* #350 — type-to-filter, then the chips. The input stays
                          directly before the chips in the DOM (one narrowing
                          row); on a wide screen the search sits on the right. */}
                      <div className="fd-tools">
                        <input
                          type="text"
                          className="home-search-input"
                          placeholder="Search games"
                          aria-label="Search games"
                          value={homeSearch}
                          onChange={(e) => setHomeSearch(e.target.value)}
                        />
                        <div className="home-filter-chips" role="tablist" aria-label="Filter games">
                          {[
                            { id: 'all', label: 'All', n: GAME_CARDS.length },
                            ...DECK_SHELVES.map(sh => ({ id: sh.id, label: sh.label, n: shelfCards(sh.id).length, suit: sh.suit })),
                            /* Signed in only: a signed-out visitor cannot star
                               anything. Kept when the daily load failed — the
                               viewer is presumably signed in, the API just
                               didn't answer. */
                            ...((authOk || dailyErr) ? [{ id: 'favorites', label: 'Favorites', n: starredCount }] : []),
                          ].map(f => (
                            <button
                              key={f.id}
                              role="tab"
                              aria-selected={homeFilter === f.id}
                              className={'home-chip' + (homeFilter === f.id ? ' on' : '')}
                              data-chip={f.id}
                              onClick={() => setHomeFilter(f.id)}
                            >{f.suit && pipSvg(f.suit)}{f.label} <span className="n">{f.n}</span></button>
                          ))}
                        </div>
                      </div>
                      {pinNotice && <div className="home-pin-full">{pinNotice}</div>}
                      {homeFilter === 'favorites' && starredCount === 0 && (
                        <div className="home-fav-empty">
                          No favorites yet. Open a game's card and tap Favorite to add it here.
                        </div>
                      )}
                      {query && searched.length === 0 && chipCards.length > 0 && (
                        <div className="home-search-empty">No games match "{query}".</div>
                      )}
                      {(query || homeFilter !== 'all') ? (
                        searched.length > 0 && (
                          <div className="fd-grid home-results" data-filter={homeFilter}>
                            {searched.map(c => cardBtn(c))}
                          </div>
                        )
                      ) : (
                        <React.Fragment>
                          {pinnedCards.length > 0 && (
                            <React.Fragment>
                              <div className="fd-shelf-h home-pinned-title">
                                <h3>📌 Pinned</h3>
                                <span className="home-pin-count">{pins.length}/{PIN_LIMIT}</span>
                              </div>
                              <div className="fd-row fd-shelf home-pinned-grid">
                                {pinnedCards.map(c => cardBtn(c))}
                              </div>
                            </React.Fragment>
                          )}
                          {DECK_SHELVES.map(sh => {
                            const cards = shelfCards(sh.id).filter(c => !pinnedSet.has(c.key));
                            if (!cards.length) return null;
                            return (
                              <React.Fragment key={sh.id}>
                                <div className="fd-shelf-h" data-shelf={sh.id}>
                                  <h3>{pipSvg(sh.suit)}{sh.label}</h3>
                                  <button type="button" className="fd-link" onClick={() => setHomeFilter(sh.id)}>See all {shelfCards(sh.id).length}</button>
                                </div>
                                <div className="fd-row fd-shelf">
                                  {cards.map(c => cardBtn(c))}
                                </div>
                              </React.Fragment>
                            );
                          })}
                        </React.Fragment>
                      )}
                    </section>

                    {deckOpen && deckCard && (
                      <DeckOpenCard
                        key={deckCard.key}
                        card={deckCard}
                        icons={deckIconSpec(deckCard, attempts)}
                        src={deckOpen.src}
                        closing={!!deckOpen.closing}
                        onClose={closeDeckCard}
                        onClosed={() => setDeckOpen(null)}
                        labelId="fd-open-name"
                      >
                        <DeckPanelHead card={deckCard} labelId="fd-open-name" stat={authOk ? cardMyScoreBit(deckCard, myScores) : null} />
                        <DeckModeTabs
                          card={deckCard}
                          mode={deckMode}
                          dailyDone={deckDailyState(deckCard, attempts) === 'done'}
                          onMode={(m) => setDeck({ mode: m, story: null })}
                        />
                        {!deckCard.modes.length ? (
                          <DeckNoModes
                            card={deckCard}
                            onStart={deckStart}
                            onHowTo={() => setHowToGame(deckGame)}
                            onChat={authOk && deckGame ? () => setChatGame(deckGame) : undefined}
                          />
                        ) : deckGame && deckMode === 'daily' && attempts[deckGame.id] && attempts[deckGame.id].finishedAt ? (
                          <DeckPlayed
                            attempt={attempts[deckGame.id]}
                            nextResetUtc={nextResetUtc}
                            offset={offset}
                            onReset={onReset}
                            onSeeResult={deckSeeResult}
                            onPractice={deckGame.daily ? () => startPractice(deckGame, { fresh: true, band: deckDailyBand }) : null}
                          />
                        ) : deckGame ? (
                          <PreGameScreen
                            variant="deck"
                            game={deckGame}
                            attempt={attempts[deckGame.id]}
                            best={bests[deckGame.id]}
                            streak={streak}
                            authOk={authOk}
                            nextResetUtc={nextResetUtc}
                            offset={offset}
                            onReset={onReset}
                            onPlay={deckPlay}
                            onPractice={deckGame.daily ? (band) => startPractice(deckGame, { fresh: true, band }) : null}
                            playMode={deckMode}
                            storyProgress={storyProgress}
                            storyBand={deckStoryBand}
                            onStoryBand={(i) => setDeck({ story: i })}
                            arcadeBandId={deckArcadeBand}
                            onArcadeBand={(b) => setDeck({ arcade: b })}
                            arcadeBest={deckArcadeBest}
                            onReplayRun={(run) => replayArcadeRun(deckGame, run)}
                            dailyBandId={deckDailyBand}
                            onDailyBand={(b) => setDeck({ daily: b })}
                            onHowTo={() => setHowToGame(deckGame)}
                            onChat={authOk ? () => setChatGame(deckGame) : undefined}
                          />
                        ) : null}
                        <DeckPanelActions
                          card={deckCard}
                          favorited={favoriteSet.has(deckCard.key)}
                          onFavorite={authOk ? toggleFavorite : null}
                          pinned={pinnedSet.has(deckCard.key)}
                          onPin={authOk ? togglePin : null}
                          pinDisabled={pins.length >= PIN_LIMIT}
                        />
                      </DeckOpenCard>
                    )}
                  </React.Fragment>
                );
              })()}
            </React.Fragment>
          )}
        </div>
      )}

      {screen === 'pregame' && currentGame && (
        <div className="game-wrap screen-in">
          <div className="game-head">
            <button className="back-btn" onClick={() => goBack()}>← Back</button>
            <div className="game-title">
              <span>{currentGame.icon}</span> {currentGame.name}
            </div>
          </div>
          <PreGameScreen
            game={currentGame}
            attempt={attempts[currentGame.id]}
            best={bests[currentGame.id]}
            streak={streak}
            authOk={authOk}
            nextResetUtc={nextResetUtc}
            offset={offset}
            onReset={onReset}
            onPlay={() => startRun(currentGame)}
            /* #367 — a fresh random board, using the band the picker shows. */
            onPractice={currentGame.daily ? (band) => startPractice(currentGame, { fresh: true, band }) : null}
            playMode={playMode}
            storyProgress={storyProgress}
            storyBand={storyBand}
            onStoryBand={setStoryBand}
            arcadeBandId={arcadeBandId}
            onArcadeBand={setArcadeBandId}
            arcadeBest={arcadeBest}
            onReplayRun={(run) => replayArcadeRun(currentGame, run)}
            dailyBandId={dailyBandId}
            onDailyBand={setDailyBand}
            onHowTo={() => setHowToGame(currentGame)}
            onChat={authOk ? () => setChatGame(currentGame) : undefined}
          />
        </div>
      )}

      {screen === 'opponent' && preLaunchGame && (
        <div className="game-wrap screen-in">
          <div className="game-head">
            <button className="back-btn" onClick={() => goBack('classic')}>← Back</button>
            <div className="game-title">
              <span>{preLaunchGame.icon}</span> {preLaunchGame.name}
            </div>
          </div>
          <OpponentScreen
            game={preLaunchGame}
            onHowTo={() => setHowToGame(preLaunchGame)}
            onChat={authOk ? () => setChatGame(preLaunchGame) : undefined}
            onPlay={(mode, opts) => {
              const g = preLaunchGame;
              setClassicGameMode(mode === 'solo' ? null : mode);
              setClassicGameModeOpts(opts || null);
              setPreLaunchGame(null);
              launchGame(g);
            }}
          />
        </div>
      )}

      {screen === 'locked' && currentGame && (
        // `.fit` only while the review BOARD is on show — it must match
        // `fitActive` above. With the result card showing (lockedReview
        // false) there is no .fit-col in this wrap, so `.game-wrap.fit`
        // would clip the card AND fail the registry-fitshell self-test —
        // exactly what the ?demo=solvedboard checks caught.
        <div className={'game-wrap screen-in-fade' + (lockedReviewable && lockedReview ? ' fit' : '')}>
          <div className="game-head">
            <button className="back-btn" onClick={() => goBack()}>← Back</button>
            <div className="game-title">
              <span>{currentGame.icon}</span> {currentGame.name}
            </div>
          </div>
          {/* PHASE 4 (#122) — when the finished attempt carries a board snapshot,
              re-mount the game read-only under the result card so "View board"
              shows the puzzle you actually solved. Games that can't snapshot
              (real-time dailies with no resume) fall through to result-only. */}
          {lockedReviewable && lockedReview ? (
            <div className="game-body frozen">
              {React.createElement(currentGame.component, {
                onWin: () => {}, onLose: () => {}, onStepChange: () => {},
                offset,
                savedProgress: attempts[currentGame.id].progress,
                onSaveProgress: null,
                readOnly: true,
                resetKey: 0,
              })}
            </div>
          ) : (
            <LockedScreen
              game={currentGame}
              attempt={attempts[currentGame.id]}
              nextResetUtc={nextResetUtc}
              offset={offset}
              onReset={onReset}
              onBack={() => goBack()}
              best={bests[currentGame.id]}
              onReview={lockedReviewable ? () => setLockedReview(true) : null}
              onPractice={() => startPractice(currentGame)}
            />
          )}
          {lockedReviewable && lockedReview && (
            <button className="result-minibar" onClick={() => setLockedReview(false)}>
              <span className="rmb-text">
                {`Today's result · +${attempts[currentGame.id].score}`}
              </span>
              <span className="rmb-cta">↑ Results</span>
            </button>
          )}
        </div>
      )}

      {/* The finished board stays MOUNTED under the results card (slice 4) so
          "View board" has something to reveal. Every game sets its own `done`
          flag on finish, which stops its timer and short-circuits input; the
          .frozen wrapper makes that visible and blocks stray taps.

          PHASE 1 (#157/#158/#160) — this now covers EVERY ending: wins, losses,
          practice runs, and shell:'self' classics. The old `: null` branch is
          what unmounted Snake's board the instant it crashed, leaving the
          results card floating over an empty page with nothing to go back to.

          The wrapper is rendered UNCONDITIONALLY and only its class changes.
          Swapping between `<div class="game-body frozen">{body}</div>` and a
          bare `{body}` changes the element at this position, so React unmounted
          and REMOUNTED the whole game at the exact moment the run ended: 2048
          came back as a fresh 2-tile board (its mount reads the saved-board key
          that the loss had just cleared), so "the final board" was a brand new
          one. Keeping one stable element preserves the subtree's state. */}
      {screen === 'game' && currentGame && (
        <div className={'game-body screen-in-fade' + (boardReviewable ? ' frozen' : '')}>
          {renderGameBody()}
        </div>
      )}

      {screen === 'game' && resultData && reviewMode && (
        <button className="result-minibar" onClick={() => setReviewMode(false)}>
          <span className="rmb-text">{resultMinibarLabel()}</span>
          <span className="rmb-cta">↑ Results</span>
        </button>
      )}

      {/* PHASE 4 (#133) — an unmissable practice marker, and #176 made it
          matter more: an arcade REPLAY is a practice run, and arcade replays
          reach games on all three shells. It used to be rendered inside the
          daily shell's game-wrap, so replaying 2048 or Block Fit showed no
          marker at all — the one case where "this does not count" is least
          obvious, because the board looks exactly like the scored one. Pinned
          rather than in-flow so it needs no cooperation from a shell. */}
      {screen === 'game' && practiceMode && !winData && !loseData && !practiceResult && !advance && (
        <div className="practice-ribbon pinned" data-practice={practiceFresh ? 'random' : 'today'}>🎲 Practice — not scored</div>
      )}

      {/* #185 — between-bands overlay. A sibling of .game-body, like the
          practice ribbon above, so it sits over all three shells and the
          wrapper itself stays untouched. The gameId guard is the same one the
          practice card uses: a result must belong to the mounted game. */}
      {screen === 'game' && advance && currentGame && advance.gameId === currentGame.id && (
        <div
          className="adv-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={advance.phase === 'complete' ? 'Ladder complete' : 'Next band'}
          onPointerDown={(e) => { if (e.target === e.currentTarget) dismissAdvance(); }}
        >
          {advance.phase === 'complete' ? (
            <div className="adv-card">
              <div className="adv-crown">🏆</div>
              <div className="adv-done-title">Ladder complete</div>
              <div className="adv-note">
                You cleared all {advance.total} bands in {currentGame.name}.
                Replay any band for practice, or try Arcade for a fresh board every run.
              </div>
              {/* Issue #183 — the ladder-completion badge. The auto-advance
                  overlay is what actually shows on a final-band clear now, so
                  the celebration has to render here too or it never appears. */}
              {advance.storyBadge && (
                <div className="badge-unlock">
                  <div className="bu-icon">{advance.storyBadge.icon}</div>
                  <div>
                    <div className="bu-title">Badge unlocked!</div>
                    <div className="bu-name">{advance.storyBadge.name} · {advance.storyBadge.desc}</div>
                  </div>
                </div>
              )}
              <div className="adv-actions">
                <button className="primary-btn tappable" {...tapProps(() => backToLadder())}>
                  📖 Back to the ladder
                </button>
                <button className="primary-btn review-btn tappable" {...tapProps(() => { cancelAdvance(); backToLobby(); })}>
                  Back to Lobby
                </button>
              </div>
            </div>
          ) : (
            <div className="adv-card">
              <div className="adv-tally">
                <div className="adv-tally-label">Band {advance.fromBand + 1} cleared</div>
                <div className="adv-tally-num" aria-live="polite">
                  {advance.awarded > 0 ? '+' + advance.awarded : '+0'}
                </div>
                <div className="adv-note">
                  {advance.awarded > 0
                    ? 'points added to your total'
                    : 'Replays do not pay. Points land on the first clear.'}
                </div>
              </div>
              {advance.phase === 'count' && (
                <div className="adv-next">
                  <div className="adv-banner">
                    <span className="adv-banner-band">Band {advance.toBand + 1}</span>
                    <span className="adv-banner-of">of {advance.total}</span>
                  </div>
                  <div className="adv-count-row">
                    <span className="adv-note">Starting in</span>
                    <span className="adv-count" key={advance.secs}>{advance.secs}</span>
                  </div>
                </div>
              )}
              <div className="adv-actions">
                <button className="primary-btn tappable" {...tapProps(() => startAdvanceBand(advance.toBand))}>
                  ▶ Start now
                </button>
                <button className="primary-btn review-btn tappable" {...tapProps(() => backToLadder())}>
                  📖 Back to the ladder
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {screen === 'game' && winData && !reviewMode && (() => {
      /* #176 — the card used to read `!isClassic` as "this is a daily", which
         was true when there were only two kinds of run. A story rung and an
         arcade run are neither: they showed a streak-badge progress panel that
         cannot move, a guest sign-in pitch about "today's leaderboard", and an
         offline-retry note for an endpoint they never called. The daily
         furniture now asks for a daily. */
      const isDailyResult = !winData.isClassic && !winData.modeLabel;
      /* One line of context under the number, not three blocks of it. In
         priority order: what you just unlocked, then a personal best. The
         full record is still in the details panel. */
      const flourish = winData.justAchievement
        ? `${winData.justAchievement.icon} Badge unlocked — ${winData.justAchievement.name}`
        : winData.justBadge
          ? `${winData.justBadge.icon} ${winData.justBadge.name} — ${winData.justBadge.min}-day streak`
          : winData.storyBadge
          ? `${winData.storyBadge.icon} Ladder complete — ${winData.storyBadge.name}`
          : (!winData.isClassic && winData.prevBest !== undefined
             && (winData.prevBest == null || winData.finalScore > winData.prevBest))
            ? '🏅 New personal best'
            : null;
      const scoreRows = (
            <div className="score-rows">
              <div className="score-row">
                <span className="k">Base score</span>
                <span className="v mono">{winData.score}</span>
              </div>
              {winData.isClassic && winData.multiplier > 1 && (
                <div className="score-row bonus">
                  <span className="k">Lock In ×{winData.multiplier}</span>
                  <span className="v mono">×{winData.multiplier}</span>
                </div>
              )}
              {!winData.isClassic && winData.multiplier > 1 && (
                <div className="score-row bonus">
                  <span className="k">Streak ×{winData.multiplier} · {winData.effectiveStreak}-day</span>
                  <span className="v mono">+{winData.bonus}</span>
                </div>
              )}
              {/* #331 — a daily's difficulty band. Only off the default board:
                  Normal's multiplier is 1, so the row would say nothing. Story
                  and arcade wins carry no `band`, and classic wins are gated
                  out, so this renders on the daily path alone. */}
              {!winData.isClassic && winData.band && winData.band !== 'normal'
                && DAILY_BAND_MULT[winData.band] != null && (
                <div className="score-row bonus">
                  <span className="k">Difficulty · {winData.band === 'hard' ? 'Hard' : 'Easy'}</span>
                  <span className="v mono">×{DAILY_BAND_MULT[winData.band]}</span>
                </div>
              )}
              {Number.isFinite(winData.wordsTotal) && (
                <div className="score-row">
                  <span className="k">Words solved</span>
                  <span className="v mono">{winData.wordsSolved} / {winData.wordsTotal}</span>
                </div>
              )}
              {/* Free-form rows a game reports in its win meta (Snakes &
                  Ladders V2 sends its placement, and in a ranked match the
                  rank points it moved). A game that reports none renders
                  nothing here, so every other game is unchanged. */}
              {(winData.extraRows || []).map((r, i) => (
                <div className="score-row" key={'xr' + i}>
                  <span className="k">{r.k}</span>
                  <span className="v mono">{r.v}</span>
                </div>
              ))}
              <div className="score-row">
                <span className="k">Steps · Time</span>
                <span className="v mono">{winData.steps} · {fmtTime(winData.timeSecs)}</span>
              </div>
              {winData.hintsUsed > 0 && (
                <div className="score-row">
                  <span className="k">💡 Hints used</span>
                  <span className="v mono">{winData.hintsUsed}</span>
                </div>
              )}
              <div className="score-row total">
                <span className="k">Earned</span>
                <span className="v mono">+{winData.finalScore}</span>
              </div>
              {!winData.isClassic && winData.prevBest !== undefined && (
                winData.prevBest == null || winData.finalScore > winData.prevBest ? (
                  <div className="score-row bonus">
                    <span className="k">🏅 New personal best!</span>
                    <span className="v mono">+{winData.finalScore}</span>
                  </div>
                ) : (
                  <div className="score-row">
                    <span className="k">Personal best</span>
                    <span className="v mono">+{winData.prevBest}</span>
                  </div>
                )
              )}
              {winData.isClassic && winData.bestScore !== undefined && (
                <div className="score-row">
                  <span className="k">Best score</span>
                  <span className="v mono">{winData.bestScore}</span>
                </div>
              )}
              {winData.isClassic && winData.longestSnake !== undefined && (
                <div className="score-row">
                  <span className="k">Longest</span>
                  <span className="v mono">{winData.longestSnake} cells</span>
                </div>
              )}
            </div>
      );
      /* Everything the report called "too much": the seven-row breakdown, the
         badge furniture and today's leaderboard. None of it is gone — it is
         one tap down, below the actions so opening it never moves them. */
      const detailsPanel = (
        <div className="win-details">
          {scoreRows}
              {currentGame && playMode === 'daily' && (
                <Leaderboard
                  gameId={currentGame.id}
                  solved={true}
                  defaultBand={isDailyBand(winData.band) ? winData.band : 'normal'}
                />
              )}
              {isDailyResult && winData.justBadge && (
                <div className="badge-unlock">
                  <div className="bu-icon">{winData.justBadge.icon}</div>
                  <div className="bu-title">Milestone reached!</div>
                  <div className="bu-name">{winData.justBadge.name} · {winData.justBadge.min}-day streak</div>
                </div>
              )}
              {isDailyResult && !winData.justBadge && winData.activeBadge && (
                <div className="win-badge-row">
                  <span className="wbr-icon">{winData.activeBadge.icon}</span>
                  <span>{winData.activeBadge.name} badge active</span>
                </div>
              )}
              {isDailyResult && winData.justAchievement && (
                <div className="badge-unlock">
                  <div className="bu-icon">{winData.justAchievement.icon}</div>
                  <div className="bu-title">Badge unlocked!</div>
                  <div className="bu-name">{winData.justAchievement.name}</div>
                </div>
              )}
              {isDailyResult && !winData.guest && (() => {
                // Next-milestone progress so every solve shows forward motion even
                // when nothing unlocked this run. Streak progress is based on the
                // streak this win landed in; solve progress on the lifetime count.
                const hints = badgeProgressHints(winData.effectiveStreak || 0, solveCount);
                if (!hints.length) return null;
                return (
                  <div className="win-progress">
                    {hints.map(h => (
                      <span key={h.key} className="badge-progress-pill">
                        <span>{h.icon}</span> {h.text}
                      </span>
                    ))}
                  </div>
                );
              })()}
              {winData.modeLabel === 'Story' && winData.storyBadge && (
                <div className="badge-unlock">
                  <div className="bu-icon">{winData.storyBadge.icon}</div>
                  <div>
                    <div className="bu-title">Ladder complete!</div>
                    <div className="bu-name">{winData.storyBadge.name} · {winData.storyBadge.desc}</div>
                  </div>
                </div>
              )}
        </div>
      );
      return (
        <div className="win-overlay" onPointerDown={dismissResultCard}>
          <div className="win-card" data-win-details={winDetails ? 'open' : 'closed'}>
            <div className="trophy">{winData.cashOut ? '💰' : '🏆'}</div>
            <h2>{winData.winnerLabel || (winData.cashOut ? 'Locked In! 🔒' : 'Solved!')}</h2>
            <div className="sub">{currentGame && currentGame.name}</div>
            <div className="win-earned">
              <span className="we-k">Earned</span>
              <WinEarned value={winData.finalScore} />
              {winData.multiplier > 1 && (
                <span className="we-note">
                  {winData.isClassic
                    ? `Lock In ×${winData.multiplier}`
                    : `Streak ×${winData.multiplier} · ${winData.effectiveStreak}-day`}
                </span>
              )}
              {/* #331 — the run's difficulty, when it is not the default board.
                  A caption, not a block: #241 keeps the card's opening on ONE
                  number, and the band is a qualifier of that number. */}
              {!winData.isClassic && winData.band && winData.band !== 'normal'
                && DAILY_BAND_MULT[winData.band] != null && (
                <span className="we-note">
                  {winData.band === 'hard' ? 'Hard board' : 'Easy board'} · ×{DAILY_BAND_MULT[winData.band]}
                </span>
              )}
            </div>
            {flourish && <div className="win-flourish">{flourish}</div>}
            {/* Final table for a multi-seat local match. Seat 1 is the device's
                own player, so its row is marked rather than left to be counted
                out of the list. */}
            {(winData.standings || []).length > 2 && (
              <div className="win-standings" data-snl-standings={winData.standings.length}>
                <div className="ws-title">Final standings</div>
                {winData.standings.map((r) => (
                  <div className={'ws-row' + (r.seat === 1 ? ' me' : '')} key={r.seat}>
                    <span className="ws-place mono">{r.place}</span>
                    <span className="ws-name">{r.label}{r.bot ? ' 🤖' : ''}</span>
                    <span className="ws-sq mono">{r.square >= 100 ? '🏁 100' : r.square}</span>
                  </div>
                ))}
              </div>
            )}
            {/* PHASE 4 (#132) — the old wording ("Couldn't sync your result —
                your puzzle is still locked for today") read like the win had
                been thrown away, and used "locked" to describe a FAILURE, which
                collides with the daily lock the same word means everywhere else.
                The run is already saved in pc_pending_runs_v1 and retries
                automatically; the button is a fallback, not the only path. */}
            {isDailyResult && (winData.syncError || syncFailDemo) && (
              <div className="win-sync-note">
                ✔ Saved on this device — we'll send your result automatically as
                soon as you're back online. Your score and streak are safe.
                <br />
                <button className="tappable" {...tapProps(retryDailyFinish, { disabled: winData.syncing })}>
                  {winData.syncing ? 'Sending…' : 'Send now'}
                </button>
              </div>
            )}
            {winData.guest && (
              <div className="guest-cta">
                <div className="guest-rank">
                  {Number.isFinite(winData.guestRank)
                    ? <span>You'd be <strong>#{winData.guestRank}</strong> of {winData.guestOf} on today's board</span>
                    : <span>Great solve — today's board takes signed-in entries</span>}
                </div>
                <div className="guest-note">
                  🔑 <strong>Make it count.</strong> Sign in and this exact run joins
                  today's leaderboard and starts your streak.
                  {winData.guestSaved && ' Your run is saved on this device. It counts if you sign in before midnight UTC.'}
                </div>
                {canAskForAccount() && (
                  <button className="tappable guest-signin" {...tapProps(() => askForAccount('count this run'))}>
                    Sign in
                  </button>
                )}
              </div>
            )}
            {/* Issue #183 — the Story ladder's completion badge. Deliberately a
                SEPARATE block from the three daily badge celebrations above:
                those are gated on isDailyResult and must stay that way, since
                a story run never touches the daily attempt row, streak or
                daily badges. */}
            {winData.modeLabel === 'Story' && winData.bandTotal > 0 && (
              <div className="mode-result">
                <div className="mode-result-title">📖 Story · level {winData.bandIndex + 1} of {winData.bandTotal}</div>
                <div className="mode-result-note">
                  {winData.ladderComplete
                    ? 'Every level cleared. The completion badge is on your profile; replay any level for practice.'
                    : (storyProgress[currentGame && currentGame.id] || {}).cleared > winData.bandIndex
                      ? 'Level ticked off. Points are paid once, on first clear — replay it any time for practice.'
                      : 'Cleared. The next level is now open.'}
                </div>
              </div>
            )}
            {winData.modeLabel === 'Arcade' && (
              <div className="mode-result">
                <div className="mode-result-title">
                  🎮 Arcade · {arcadeBand(winData.arcadeBand).label}
                  {winData.arcadeRank ? ` · #${winData.arcadeRank}` : ''}
                </div>
                <div className="mode-result-note">
                  {!winData.arcadeVerified
                    ? 'This run was not anchored to a server clock, so it stays in your history but does not move your best or your rank.'
                    : winData.arcadeFirstRun
                      ? 'First run on this band — this is your baseline. Beat it and the difference pays.'
                      : winData.arcadeBeatBest
                        ? `New best on this band — up from ${winData.arcadePrevBest}.`
                        : `Your best on this band is still ${winData.arcadePrevBest}.`}
                  {winData.arcadeAwarded > 0 ? ` +${winData.arcadeAwarded} points.` : ''}
                </div>
              </div>
            )}
            {/* DAILY board only. `/api/daily/:gameId/leaderboard` validates
                :gameId against GAME_IDS and 400s on a classic id, and a 400 is
                a console error the no-console-errors check fails on. Classics
                reach their all-time board through ClassicShell's ☰ sheet. */}
            <ShareButton text={winData.share} />
            {winData.isClassic && (
              <button className="primary-btn play-again-btn tappable" {...tapProps(playAgain)}>
                Play Again
              </button>
            )}
            {boardReviewable && (
              <button className="primary-btn review-btn tappable" {...tapProps(() => setReviewMode(true))}>
                👁 View board
              </button>
            )}
            {/* PHASE 4 (#133) — replay today's exact puzzle, scored but not
                recorded. Daily games only: a classic already has Play Again,
                and story/arcade are replayable from their pre-game screen. */}
            {isDailyResult && currentGame && (
              <button className="primary-btn review-btn tappable" {...tapProps(() => startPractice(currentGame))}>
                🎲 Play again for fun <span className="practice-note">(not scored)</span>
              </button>
            )}
            {winData.modeLabel && currentGame && (
              <button className="primary-btn review-btn tappable" {...tapProps(() => launchGame(currentGame, playMode))}>
                {winData.modeLabel === 'Arcade' ? '🎮 Another run' : '📖 Back to the levels'}
              </button>
            )}
            {/* One primary action per card. Where Play Again exists it is the
                primary, so leaving steps down to the quiet style; a daily has
                no Play Again, so Back to Lobby stays the primary there. */}
            <button className={'primary-btn tappable' + (winData.isClassic ? ' review-btn' : '')} {...tapProps(() => backToLobby(winData.isClassic ? 'classic' : null))}>Back to Lobby</button>
            <button className="win-more tappable" aria-expanded={winDetails} {...tapProps(() => setWinDetails(v => !v))}>
              {winDetails ? 'Hide the details ▴' : 'Score, badges & leaderboard ▾'}
            </button>
            {winDetails && detailsPanel}
          </div>
        </div>
      );
      })()}

      {screen === 'game' && loseData && !reviewMode && (
        <div className="win-overlay" onPointerDown={dismissResultCard}>
          <div className="win-card">
            <div className="trophy">{loseData.isClassic ? '💥' : '💀'}</div>
            {/* #213 — a game's OWN ending label, when it sent one. Every game
                already passes `winnerLabel` through reportRunEnd (Marble Loop,
                Hash Rush, Snake and Bounce all send 'Game Over'), and the win
                card has read it since #158 — handleLose simply dropped it, so a
                lost story rung of a marble game announced itself as "Out of
                guesses". That default stays for the games that send nothing,
                which is Daily Cipher, the one it was written for.
                The "Guesses · Time" row below is the same copy problem and is
                deliberately NOT touched here: no game sends a label for it, so
                fixing it would mean inventing one for thirty games rather than
                threading through one they already send. */}
            <h2>{loseData.winnerLabel || (loseData.isClassic ? 'Game Over' : 'Out of guesses')}</h2>
            <div className="sub">{currentGame && currentGame.name}</div>
            <div className="score-rows">
              {loseData.answer && (
                <div className="score-row">
                  <span className="k">Answer</span>
                  <span className="v mono">{loseData.answer}</span>
                </div>
              )}
              {Number.isFinite(loseData.wordsTotal) && (
                <div className="score-row">
                  <span className="k">Words solved</span>
                  <span className="v mono">{loseData.wordsSolved} / {loseData.wordsTotal}</span>
                </div>
              )}
              <div className="score-row">
                <span className="k">{loseData.isClassic ? 'Steps' : 'Guesses'} · Time</span>
                <span className="v mono">{loseData.steps} · {fmtTime(loseData.timeSecs)}</span>
              </div>
              {/* PHASE 3 (#161) — the run's own headline stat (2048's highest
                  tile, Diamond Rush's gems). Only rendered by games that pass
                  one, so pass/fail dailies are unchanged. */}
              {loseData.scoreLabel && loseData.scoreValue != null && (
                <div className="score-row">
                  <span className="k">{loseData.scoreLabel}</span>
                  <span className="v mono">{loseData.scoreValue}</span>
                </div>
              )}
              {loseData.hintsUsed > 0 && (
                <div className="score-row">
                  <span className="k">💡 Hints used</span>
                  <span className="v mono">{loseData.hintsUsed}</span>
                </div>
              )}
              {/* PHASE 3 (#161) — a lost run that still scored says so. This was
                  hard-coded "+0" even though the score had ALREADY been sent to
                  the leaderboard, which read as "that run counted for nothing". */}
              <div className="score-row total">
                <span className="k">Earned</span>
                <span className="v mono">+{loseData.finalScore != null ? loseData.finalScore : 0}</span>
              </div>
            </div>
            {loseData.guest && (
              <div className="guest-note" style={{ marginBottom: '0.8rem' }}>
                🔑 Playing as a guest. Sign in to keep a streak and appear on
                daily boards.
                {canAskForAccount() && (
                  <button className="tappable guest-signin" {...tapProps(() => askForAccount('keep a streak'))}>
                    Sign in
                  </button>
                )}
              </div>
            )}
            {/* Daily board only — see the note on the win card above. */}
            {currentGame && playMode === 'daily' && (
              <Leaderboard
                gameId={currentGame.id}
                solved={false}
                defaultBand={attempts[currentGame.id] && isDailyBand(attempts[currentGame.id].band) ? attempts[currentGame.id].band : 'normal'}
              />
            )}
            <ShareButton text={loseData.share} />
            {loseData.isClassic && (
              <button className="primary-btn play-again-btn tappable" {...tapProps(playAgain)}>
                Play Again
              </button>
            )}
            {boardReviewable && (
              <button className="primary-btn review-btn tappable" {...tapProps(() => setReviewMode(true))}>
                👁 View board
              </button>
            )}
            {/* #185 — a story band is a fixed, retryable deal, so the useful
                move after a loss is another go at THIS band, not the ladder
                screen. Remounts through the same key the auto-advance uses. */}
            {loseData.modeLabel === 'Story' && currentGame && (
              <button className="primary-btn review-btn tappable" {...tapProps(() => startAdvanceBand(storyBand))}>
                🔁 Try this band again
              </button>
            )}
            {/* #213 — A LOST RUN IN A MODE HAS TO BE ABLE TO STAY IN IT.

                The win card has carried a mode action since #176 ("📖 Back to
                the levels" / "🎮 Another run"); the loss card never did. So the
                only way out of a failed story rung was Back to Lobby — the
                reported "forced lobby exit" — which is exactly backwards: a
                rung is a fixed, retryable deal, and failing one is the moment
                you most want to go straight at it again. The label says
                Continue rather than Back because after a loss that is what the
                button is for.

                This is the shared card, so it fixes the exit for every story
                and arcade game, not only the one the issue was filed against. */}
            {loseData.modeLabel && currentGame && (
              <button className="primary-btn play-again-btn tappable" {...tapProps(() => launchGame(currentGame, playMode))}>
                {loseData.modeLabel === 'Arcade' ? '🎮 Another run' : '📖 Continue Story Quest'}
              </button>
            )}
            {/* Daily only. "Play again for fun" is the daily's replay of TODAY'S
                board through the inert practice path (#133); offering it on a
                story or arcade loss sent you to a practice run of the daily
                instead of back to the rung you just failed. The win card has
                always gated this on `!modeLabel` — the loss card did not. */}
            {!loseData.isClassic && !loseData.modeLabel && currentGame && (
              <button className="primary-btn review-btn tappable" {...tapProps(() => startPractice(currentGame))}>
                🎲 Play again for fun <span className="practice-note">(not scored)</span>
              </button>
            )}
            {/* Same rule as the win card: one primary action, and where there
                is a Play Again it is not the one that leaves. */}
            <button className={'primary-btn tappable' + (loseData.isClassic || loseData.modeLabel ? ' review-btn' : '')} {...tapProps(() => backToLobby(loseData.isClassic ? 'classic' : null))}>Back to Lobby</button>
          </div>
        </div>
      )}

      {/* PHASE 4 (#133) — practice result. Deliberately NOT the win overlay: no
          streak row, no leaderboard, no Verified badge, no share-to-board CTA —
          nothing that implies the run counted. */}
      {screen === 'game' && practiceMode && practiceResult && !reviewMode && (
        <div className="win-overlay" onPointerDown={dismissResultCard}>
          <div className="win-card">
            <div className="trophy">🎲</div>
            <h2>{practiceResult.won ? 'Solved — practice run' : 'Practice run over'}</h2>
            <div className="sub">{currentGame && currentGame.name}</div>
            {/* #367 — a random board says so; today's replay keeps its line. */}
            <div className="practice-ribbon">
              {practiceFresh
                ? "Not scored · random board · today's daily is untouched"
                : 'Not scored — your real result for today stands'}
            </div>
            <div className="score-breakdown">
              <div className="score-row">
                <span className="k">Practice score</span>
                <span className="v mono">{practiceResult.score}</span>
              </div>
              <div className="score-row">
                <span className="k">Steps · Time</span>
                <span className="v mono">{practiceResult.steps} · {fmtTime(practiceResult.timeSecs)}</span>
              </div>
            </div>
            {practiceResult.answer && (
              <div className="sub">{practiceResult.answer}</div>
            )}
            {/* PHASE 1 (#158) — the practice card had NO way back to the board:
                no View board, no minibar, no backdrop dismiss. That was the
                whole "there is some practice run screen you can't go back to
                view board after" report. */}
            {boardReviewable && (
              <button className="primary-btn review-btn tappable" {...tapProps(() => setReviewMode(true))}>
                👁 View board
              </button>
            )}
            <button className="primary-btn review-btn tappable"
              {...tapProps(() => startPractice(currentGame, practiceFresh ? { fresh: true, band: practiceBandId } : undefined))}>
              🎲 Another practice run
            </button>
            <button className="primary-btn tappable" {...tapProps(() => backToLobby())}>Back to Lobby</button>
          </div>
        </div>
      )}

      {whatsNewOpen && <WhatsNewSheet onClose={() => setWhatsNewOpen(false)} />}

      {settingsOpen && (
        <SettingsSheet
          onClose={() => setSettingsOpen(false)}
          onWhatsNew={() => { setSettingsOpen(false); setWhatsNewOpen(true); }}
        />
      )}

      {chatGame && (
        <ChatPanel
          game={chatGame}
          user={user}
          onClose={() => setChatGame(null)}
        />
      )}

      {howToGame && (
        <HowToPlayModal
          game={howToGame}
          onClose={() => setHowToGame(null)}
        />
      )}
    </div>
  );
}
