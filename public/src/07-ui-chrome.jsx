/* ============================================================
   Account indicator — confirms the signed-in Usernode account. Renders
   nothing while the auth check is in flight, so "Signed out" only ever
   shows after sign-in has definitively failed.
   ============================================================ */
function AccountChip({ loading, authOk, user, onOpen }) {
  if (loading) return null;
  if (!authOk || !user) {
    return (
      <div className="account-chip off" title="Not signed in — progress won't be saved. Open this app inside Usernode.">
        <span className="dot" /> <span className="who">Signed out</span>
      </div>
    );
  }
  const name = user.username || 'Linked account';
  const initial = (user.username || '?').charAt(0).toUpperCase();
  return (
    <button
      type="button"
      className="account-chip on"
      title={`Signed in as ${name} — tap to open your profile.`}
      onClick={onOpen}
    >
      <span className="avatar mono">{initial}</span>
      <span className="who">
        <span className="uname">{name}</span>
      </span>
    </button>
  );
}


/* ============================================================
   Daily leaderboard — today's solvers for one game, ranked by fastest
   completion time, then fewest steps. Highlights the current user and
   pins their row when they're outside the visible top N.
   ============================================================ */
const lbFmtTime = s =>
  s == null ? '—' : `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/* #331 — Easy | Normal | Hard band pills for the daily per-game boards,
   reusing the lb-scope-tab styling. Rendered through the small helper so the
   loading state and the data state share one markup. */
function LbBandTabsInner(band, onChange) {
  return DAILY_BANDS.map(b => (
    <button
      key={b}
      className={'lb-scope-tab' + (band === b ? ' active' : '')}
      onClick={() => onChange(b)}
    >{b[0].toUpperCase() + b.slice(1)}</button>
  ));
}

function Leaderboard({ gameId, solved, defaultBand }) {
  const [state, setState] = useState({ loading: true });
  const [scope, setScope] = useState(lbInitialScope);
  // #331 — the per-band boards. A daily's difficulty is its own ranked board,
  // so the table defaults to the band the viewer played today (the caller
  // passes it from the attempt row) and `?lbband=` deep-links a band, the same
  // way ?lbscope= does for scope.
  const [band, setBand] = useState(() => {
    try {
      const q = new URLSearchParams(window.location.search).get('lbband');
      if (q && isDailyBand(q)) return q;
    } catch (e) {}
    return isDailyBand(defaultBand) ? defaultBand : 'normal';
  });

  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    (async () => {
      const qs = [];
      if (scope === 'friends') qs.push('scope=friends');
      if (band !== 'normal') qs.push('band=' + encodeURIComponent(band));
      const { ok, body } = await api(`/api/daily/${gameId}/leaderboard${qs.length ? '?' + qs.join('&') : ''}`);
      if (!alive) return;
      if (ok && body) setState({ loading: false, ...body });
      else setState({ loading: false, entries: [], me: null, total: 0, error: true });
    })();
    return () => { alive = false; };
  }, [gameId, scope, band]);

  if (state.loading) {
    return <div className="lboard"><div className="lboard-title">Today's leaderboard</div><LbScopeTabs scope={scope} onChange={setScope} /><div className="lb-band-tabs">{LbBandTabsInner(band, setBand)}</div><div className="lboard-empty">Loading…</div></div>;
  }

  const entries = state.entries || [];
  const me = state.me || null;
  const meVisible = me && entries.some(e => e.isCurrentUser);

  return (
    <div className="lboard">
      <div className="lboard-title">
        Today's leaderboard
        {state.total > 0 && <span className="lboard-count">{state.total} solved</span>}
      </div>
      <LbScopeTabs scope={scope} onChange={setScope} />
      <div className="lb-band-tabs">{LbBandTabsInner(band, setBand)}</div>
      {entries.length === 0 ? (
        <div className="lboard-empty">
          {scope === 'friends'
            ? LB_FRIENDS_EMPTY
            : band !== 'normal'
              ? `No one has solved today's ${band === 'hard' ? 'Hard' : 'Easy'} board yet.`
              : "Be the first to solve today's puzzle."}
        </div>
      ) : (
        <div className="lboard-rows">
          {entries.map(e => (
            <div key={e.rank} className={`lrow${e.isCurrentUser ? ' me' : ''}`}>
              <span className="lrank mono">#{e.rank}</span>
              <span className="lname">{e.username}{e.isCurrentUser ? ' (you)' : ''}</span>
              <span className="ltime mono">{lbFmtTime(e.timeSecs)}</span>
              <span className="lsteps mono">{e.steps != null ? `${e.steps} st` : '—'}</span>
            </div>
          ))}
          {me && !meVisible && (
            <div className="lrow me pinned">
              <span className="lrank mono">#{me.rank}</span>
              <span className="lname">{me.username} (you)</span>
              <span className="ltime mono">{lbFmtTime(me.timeSecs)}</span>
              <span className="lsteps mono">{me.steps != null ? `${me.steps} st` : '—'}</span>
            </div>
          )}
        </div>
      )}
      {solved === false && (
        <div className="lboard-note">You didn't solve today's puzzle — no ranking this round.</div>
      )}
    </div>
  );
}

/* ============================================================
   Today's Top Scores — everyone who finished today's GAME OF THE DAY,
   ranked by score (fastest time breaks ties). The server resolves the
   featured game and returns its id so the board can name it. Reuses
   the per-game leaderboard styles. Tapping a row opens that player's
   profile via onSelectUser.
   ============================================================ */
function TodayChampions({ onSelectUser }) {
  const [state, setState] = useState({ loading: true });
  const [scope, setScope] = useState(lbInitialScope);

  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    (async () => {
      const { ok, body } = await api(`/api/daily/leaderboard/today${scope === 'friends' ? '?scope=friends' : ''}`);
      if (!alive) return;
      if (ok && body) setState({ loading: false, ...body });
      else setState({ loading: false, entries: [], me: null, total: 0, error: true });
    })();
    return () => { alive = false; };
  }, [scope]);

  const featured = state.gameId ? GAMES.find(g => g.id === state.gameId) : null;
  const gameLabel = featured ? featured.name : 'Game of the Day';
  const title = (
    <div className="lboard-title">
      Today's Top Scores
      <span className="lboard-count">🎯 {featured ? `${featured.icon} ` : ''}{gameLabel}{state.total > 0 ? ` · ${state.total} finished` : ''}</span>
    </div>
  );

  if (state.loading) {
    return <div className="lboard champions"><div className="lboard-title">Today's Top Scores</div><LbScopeTabs scope={scope} onChange={setScope} /><div className="lboard-empty">Loading…</div></div>;
  }

  const entries = state.entries || [];
  const me = state.me || null;
  const meVisible = me && entries.some(e => e.isCurrentUser);
  const row = (e, pinned) => (
    <div
      key={pinned ? 'me-pinned' : e.rank}
      className={`lrow${e.isCurrentUser ? ' me' : ''}${pinned ? ' pinned' : ''}${onSelectUser ? ' clickable' : ''}`}
      onClick={onSelectUser && e.userId ? () => onSelectUser(e.userId) : undefined}
    >
      <span className="lrank mono">#{e.rank}</span>
      <span className="lname">{e.username}{e.isCurrentUser ? ' (you)' : ''}</span>
      <span className="ltime mono">{e.score} pts</span>
      <span className="lsteps mono">{lbFmtTime(e.timeSecs)}</span>
    </div>
  );

  return (
    <div className="lboard champions">
      {title}
      <LbScopeTabs scope={scope} onChange={setScope} />
      {entries.length === 0 ? (
        <div className="lboard-empty">
          {scope === 'friends' ? LB_FRIENDS_EMPTY : `No one has finished today's ${gameLabel} yet — be the first!`}
        </div>
      ) : (
        <div className="lboard-rows">
          {entries.map(e => row(e, false))}
          {me && !meVisible && row(me, true)}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Rating ladder (phase 4) — Elo standings for the head-to-head
   games, fed by online room/match results. Shows rating, current
   win streak, and this week's movement per player.
   ============================================================ */
const LADDER_GAMES = [
  'chutes-ladders', 'mancala', '2048', 'blockblast',
  // Phase 5 board games (rules modules over classic_rooms).
  'checkers', 'reversi', 'fourinarow', 'gomoku', 'ludo',
];

function LadderScreen() {
  const [gameId, setGameId] = useState(LADDER_GAMES[0]);
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    api(`/api/ladder/${gameId}`).then(({ ok, body }) => {
      if (!alive) return;
      setState(ok && body
        ? { loading: false, ...body }
        : { loading: false, entries: [], me: null, movers: [], error: true });
    }).catch(() => { if (alive) setState({ loading: false, entries: [], me: null, movers: [] }); });
    return () => { alive = false; };
  }, [gameId]);

  const games = GAMES.filter(g => LADDER_GAMES.includes(g.id));
  const entries = state.entries || [];
  const me = state.me || null;
  const meVisible = me && entries.some(e => e.isCurrentUser);
  const delta = (d) => d > 0
    ? <span className="ladder-delta up mono">▲{d}</span>
    : d < 0
    ? <span className="ladder-delta down mono">▼{-d}</span>
    : <span className="ladder-delta flat mono">—</span>;
  const row = (e, pinned) => (
    <div key={pinned ? 'me-pinned' : e.rank} className={`lrow${e.isCurrentUser ? ' me' : ''}${pinned ? ' pinned' : ''}`}>
      <span className="lrank mono">#{e.rank}</span>
      <span className="lname">{e.username}{e.isCurrentUser ? ' (you)' : ''}</span>
      <span className="ladder-streak mono" title="Current win streak">{e.winStreak > 0 ? `🔥${e.winStreak}` : '·'}</span>
      <span className="ltime mono" title="Elo rating">{e.elo}</span>
      {delta(e.weeklyDelta)}
    </div>
  );

  return (
    <div className="lboard ladder">
      <div className="ladder-games">
        {games.map(g => (
          <button
            key={g.id}
            className={'lb-scope-tab' + (gameId === g.id ? ' active' : '')}
            onClick={() => setGameId(g.id)}
          >{g.icon} {g.name}</button>
        ))}
      </div>
      <p className="ladder-note">
        Everyone starts at 1000 — win online matches to climb. 🔥 is the current
        win streak; ▲▼ show this week's rating movement.
      </p>
      {state.loading ? (
        <div className="lboard-empty">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="lboard-empty">
          No rated matches yet — play someone online (room code) to start this ladder.
        </div>
      ) : (
        <>
          {(state.movers || []).length > 0 && (
            <div className="ladder-movers">
              📈 <strong>Weekly movers:</strong>{' '}
              {state.movers.map(m => `${m.username} +${m.weeklyDelta}`).join(' · ')}
            </div>
          )}
          <div className="lboard-rows">
            {entries.map(e => row(e, false))}
            {me && !meVisible && row(me, true)}
          </div>
        </>
      )}
    </div>
  );
}

/* ============================================================
   Badge strip — the player's collected badges (streak milestones +
   non-streak achievements). Earned badges render solid; not-yet-earned
   render dimmed so there's a visible collection to complete. Lives on
   the profile screen (the home Badges panel was retired).
   ============================================================ */
// Build the canonical badge-chip list (streak milestones + non-streak
// achievements + lifetime solve milestones) with earned/locked state derived
// from the server-backed `badges` (earned day thresholds) and `achievements`
// ({ types, milestones }). Consumed by the profile BadgeStrip.
function badgeChips(badges, achievements) {
  const earnedDays = new Set(badges || []);
  const ach = achievements || { types: [], milestones: [], stories: [] };
  const earnedTypes = new Set(ach.types || []);
  const earnedMilestones = new Set(ach.milestones || []);
  const earnedStories = new Set(ach.stories || []);

  const chips = [];
  for (const b of STREAK_BADGES) {
    chips.push({ key: `s${b.min}`, icon: b.icon, name: b.name, sub: `${b.min}-day streak`, earned: earnedDays.has(b.min) });
  }
  for (const b of ACHIEVEMENT_BADGES) {
    chips.push({ key: `a${b.type}`, icon: b.icon, name: b.name, sub: b.desc, earned: earnedTypes.has(b.type) });
  }
  for (const b of SOLVE_MILESTONE_BADGES) {
    chips.push({ key: `m${b.count}`, icon: b.icon, name: b.name, sub: b.desc, earned: earnedMilestones.has(b.count) });
  }
  // Story-ladder completions — one chip per game that HAS a story ladder, so
  // the collection shows what is left to finish, not only what is done. The
  // list is derived from PLAY_MODES_BY_ID rather than hand-written, so a game
  // that gains or loses a story ladder needs no edit here; the order follows
  // GAMES so it matches the lobby grid.
  for (const g of (typeof GAMES !== 'undefined' ? GAMES : [])) {
    if (typeof supportsMode !== 'function' || !supportsMode(g.id, 'story')) continue;
    const chip = storyBadgeChip(g.id);
    if (!chip) continue;
    chips.push({ ...chip, group: 'story', earned: earnedStories.has(g.id) });
  }
  return chips;
}

function BadgeStrip({ badges, achievements, streak, solveCount }) {
  const allChips = badgeChips(badges, achievements);
  const chips = allChips.filter(c => c.group !== 'story');
  const storyChips = allChips.filter(c => c.group === 'story');
  const earnedCount = allChips.filter(c => c.earned).length;
  // Next-milestone progress pills (formerly on the home Badges panel) —
  // rendered only when the caller supplies the live streak/solve counts,
  // i.e. on the viewer's own profile.
  const hints = (streak != null || solveCount != null)
    ? badgeProgressHints(streak || 0, solveCount || 0)
    : [];

  return (
    <div className="badge-strip-wrap">
      <div className="badge-strip-head">
        <span>Badges</span>
        <span className="badge-strip-count mono">{earnedCount} / {allChips.length}</span>
      </div>
      {hints.length > 0 && (
        <div className="badge-progress">
          {hints.map(h => (
            <span key={h.key} className="badge-progress-pill">
              <span>{h.icon}</span> {h.text}
            </span>
          ))}
        </div>
      )}
      <div className="badge-strip">
        {chips.map(c => <BadgeChip key={c.key} chip={c} />)}
      </div>
      {storyChips.length > 0 && (
        <>
          <div className="badge-strip-sub">Story ladders</div>
          <div className="badge-strip">
            {storyChips.map(c => <BadgeChip key={c.key} chip={c} />)}
          </div>
        </>
      )}
    </div>
  );
}

/* One badge tile. `data-badge` carries the chip key so a navigation-only
   proposal check can assert on a specific badge's earned/locked state, which
   the class alone cannot express. */
function BadgeChip({ chip }) {
  return (
    <div
      className={`badge-chip${chip.earned ? ' active' : ' locked'}`}
      data-badge={chip.key}
      title={`${chip.name}${chip.earned ? '' : ' (locked)'} — ${chip.sub}`}
    >
      <span className="badge-chip-icon">{chip.icon}</span>
      <span className="badge-chip-name">{chip.name}</span>
    </div>
  );
}

/* ============================================================
   Locked screen — shown when today's attempt is already used
   ============================================================ */
/* ============================================================
   Shell-owned game chrome (phase 3) — How-to-Play + pre-game screen
   ============================================================ */

/* The How-to-Play cards NEVER open by themselves. They used to auto-show on a
   player's first open of each game, which meant every game began by covering
   itself with a modal you had not asked for — and on the pre-game screen it
   sat on top of the thing you were about to choose. It is reachable from the
   "?" in the daily header, the ClassicShell topbar, the pre-game screen and
   the opponent screen; that is enough.

   The per-browser "first open" record that gated it went with it: nothing
   reads it now, and a stored flag nobody consults is just a thing that can
   drift out of sync with the behaviour it claims to describe. */

// How-to-Play modal, rendered from the game's manifest `howToPlay` cards.
// Shell-owned and opened only on request, from the "?" in the in-game header,
// the ClassicShell topbar, the pre-game screen or the opponent screen.
function HowToPlayModal({ game, onClose }) {
  const cards = game.howToPlay || [];
  return (
    <div className="howto-overlay" onClick={onClose}>
      <div className="howto-card" onClick={(e) => e.stopPropagation()}>
        <div className="howto-head">
          <span className="howto-icon">{game.icon}</span>
          <h3>How to play {game.name}</h3>
        </div>
        <div className="howto-list">
          {cards.map((c, i) => (
            <div className="howto-step" key={i}>
              <div className="howto-step-num mono">{i + 1}</div>
              <div>
                <div className="howto-step-title">{c.title}</div>
                <div className="howto-step-body">{c.body}</div>
              </div>
            </div>
          ))}
        </div>
        <button className="primary-btn" onClick={onClose}>Got it</button>
      </div>
    </div>
  );
}

// Manifest chip copy for the pre-game screen.
const SESSION_LENGTH_LABEL = { short: '≈ 1–3 min', medium: '≈ 3–10 min', long: '10+ min' };
const INPUT_LABEL = { tap: '👆 Tap', drag: '✋ Drag', swipe: '👉 Swipe', keyboard: '⌨️ Type' };

// Standard pre-game screen (shell-owned chrome, phase 3): game identity,
// manifest chips, personal best, streak, and the daily-challenge context
// (countdown + same-deal-for-everyone). Consume-on-start only fires when the
// player hits Play — peeking at this screen never burns the day's attempt.
/* ============================================================
   Phase 7 — Game of the Day hero, home in-progress row, chat
   ============================================================ */

// Game of the Day hero card: today's featured game (from daily_featured via
// /api/daily), reset countdown, and a state-aware CTA. The full Today's
// Top Scores board renders directly below the hero, so the hero itself
// carries no leaderboard preview. Clicking anywhere routes through the
// normal launch flow, so the pre-game / resume / locked machinery is
// untouched.
// Review round 1: the raw game colour (GA.*) is tuned against the light card
// and its white Play label falls below AA in the dark look (sky #3D87C9
// measured 3.81:1). --accent-deep is the same hex with every channel pulled
// toward black; at 0.78 every GA colour clears 4.5:1 with white (sky 6.1,
// amber 4.7, lime 4.9). Raw hex in, raw hex out — no palette key, no var()
// concatenation.
function gotdDeepColor(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  return '#' + [1, 3, 5].map((i) =>
    Math.round(parseInt(m[1].slice(i - 1, i + 1), 16) * 0.78)
      .toString(16).padStart(2, '0')).join('');
}

function GotdHero({ game, attempt, authOk, nextResetUtc, offset, onReset, onPlay }) {
  const countdown = useCountdown(nextResetUtc, offset, onReset);
  const finished = !!(attempt && attempt.finishedAt);
  const inProgress = !!attempt && !finished;
  return (
    <div className="gotd-hero" style={{
      '--accent': game.tagColor,
      /* NYT-Games-style colour wash: the panel takes on the featured game's
         colour (raw hex from GA, so appending an alpha byte is fine here —
         the never-concat rule is about C.* tokens, which are var() strings). */
      '--accent-tint': game.tagColor + '24',
      '--accent-wash': game.tagColor + '12',
      '--accent-line': game.tagColor + '4d',
      '--accent-deep': gotdDeepColor(game.tagColor),
    }}>
      <div className="gotd-label mono">🎯 GAME OF THE DAY</div>
      <div className="gotd-main" onClick={onPlay}>
        <div className="gotd-icon">{game.icon}</div>
        <div className="gotd-info">
          <div className="gotd-name">{game.name}</div>
          <div className="gotd-desc">{game.desc}</div>
          <div className="gotd-meta mono">
            Next puzzle in {countdown} · 🌍 same deal for everyone · 🔥 keeps your streak
          </div>
        </div>
        <button className="primary-btn gotd-play" disabled={finished}>
          {finished ? `🔒 +${attempt.score != null ? attempt.score : 0}` : inProgress ? '▶ Resume' : 'Play'}
        </button>
      </div>
      {authOk === false && (
        <div className="gotd-signedout">Play today's deal free as a guest — sign in to join the board and keep a streak.</div>
      )}
    </div>
  );
}

// Home "in progress" row: resumable daily runs (claimed, unfinished attempts)
// and online matches where it's your turn. Horizontal card strip; each card
// re-enters through the normal launch/resume path.
// Hours until an active room's 48h turn timer forfeits it, from the server's
// lastMoveAt + turnTimeoutHours. Null when the room carries no timer info.
function roomExpiresInHours(room) {
  if (!room || !room.lastMoveAt || !Number.isFinite(room.turnTimeoutHours)) return null;
  const ms = new Date(room.lastMoveAt).getTime() + room.turnTimeoutHours * 3600 * 1000 - Date.now();
  return Math.max(0, Math.ceil(ms / 3600000));
}

function InProgressRow({ items, onOpenDaily, onOpenRoom }) {
  if (!items.length) return null;
  return (
    <div className="inprog-row-wrap">
      <div className="home-section-title">In progress</div>
      <div className="inprog-row">
        {items.map((it) => {
          if (it.type === 'daily') {
            return (
              <div key={'d-' + it.game.id} className="inprog-card" style={{ '--accent-tint': it.game.tagColor + '24' }} onClick={() => onOpenDaily(it.game)}>
                <div className="ip-icon">{it.game.icon}</div>
                <div className="ip-name">{it.game.name}</div>
                <div className="ip-sub resume">▶ Resume run</div>
              </div>
            );
          }
          const expH = roomExpiresInHours(it.room);
          // #145 — a room still waiting for an opponent now surfaces here too.
          // Previously /api/rooms/mine only returned ACTIVE rooms, so a room you
          // created and left simply vanished from your side of the app.
          if (it.room.waiting) {
            return (
              <div key={'r-' + it.room.id} className="inprog-card room" style={{ '--accent-tint': it.game.tagColor + '24' }} onClick={() => onOpenRoom(it.room)}>
                <div className="ip-icon">{it.game.icon}</div>
                <div className="ip-name">{it.game.name}</div>
                <div className="ip-sub">⏳ Waiting for opponent</div>
                <div className="ip-sub resume mono">code {it.room.id}</div>
              </div>
            );
          }
          return (
            <div key={'r-' + it.room.id} className="inprog-card room" style={{ '--accent-tint': it.game.tagColor + '24' }} onClick={() => onOpenRoom(it.room)}>
              <div className="ip-icon">{it.game.icon}</div>
              <div className="ip-name">{it.game.name}</div>
              <div className={'ip-sub' + (it.room.myTurn ? ' turn' : '')}>
                {it.room.myTurn ? '🔔 Your turn' : '⏳ Their move'} · vs {it.room.opponentName}
              </div>
              {expH != null && (
                <div className={'ip-sub' + (expH <= 6 ? ' expiring' : '')}>
                  ⏱ expires in {expH}h
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Daily checklist (#295): one chip per daily game, in a horizontal scroller,
// so a player can sweep every deal without hunting the grid. The checked
// state reads the SAME source the cards' "✓ PLAYED" badge reads —
// cardDailyId + attempts[id].finishedAt from /api/daily — so it cannot
// disagree with the grid and needs no second fetch. In-progress shows ▶,
// unplayed shows an empty circle. A tap launches the chip's daily id through
// the normal launch path (finished → locked screen, else pre-game), exactly
// like the card's own Daily button.
function DailyChecklist({ attempts, loading, onPlay }) {
  const cards = GAME_CARDS.filter((c) => cardDailyId(c));
  if (!cards.length) return null;
  const stateOf = (c) => {
    const id = cardDailyId(c);
    const a = id ? attempts[id] : null;
    if (a && a.finishedAt) return 'done';
    if (a) return 'resume';
    return 'todo';
  };
  const done = cards.filter((c) => stateOf(c) === 'done').length;
  return (
    <div className="dl-wrap">
      <div className="home-section-title">
        Daily checklist
        <span className="home-pin-count mono">{done}/{cards.length}</span>
      </div>
      <div className="dl-row" role="list" aria-label="Daily challenges to play today">
        {cards.map((c) => {
          const s = stateOf(c);
          const id = cardDailyId(c);
          return (
            <button
              key={c.key}
              role="listitem"
              className={'dl-check tappable ' + s}
              aria-label={`${c.name} daily — ${s === 'done' ? 'played today' : s === 'resume' ? 'in progress' : 'not played yet'}`}
              {...tapProps(() => { if (!loading) onPlay(id); })}
            >
              <span className="dl-mark" aria-hidden="true">{s === 'done' ? '✓' : s === 'resume' ? '▶' : ''}</span>
              <span className="dl-icon" aria-hidden="true">{c.icon}</span>
              <span className="dl-name">{c.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* Recently Played (Recent goal): the viewer's last five plays as one tappable
   tile each, mirroring InProgressRow's strip shape so the lobby keeps a single
   rhythm. Renders nothing at all when there is no history (the server only
   sends plays the signed-in viewer made), so an empty account simply shows the
   grid without the strip. GAMES is defined later in the bundle order, which is
   fine: the lookup runs at render time, not at parse time. */
function fmtPlayedAgo(iso, offset) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const mins = Math.max(1, Math.round((Date.now() + (offset || 0) - t) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function RecentlyPlayedRow({ items, onOpen, offset }) {
  if (!items || !items.length) return null;
  return (
    <div className="inprog-row-wrap">
      <div className="home-section-title">Recently Played</div>
      <div className="inprog-row recent-row">
        {items.map((p) => {
          const g = GAMES.find(x => x.id === p.gameId);
          if (!g) return null;
          return (
            <button
              key={p.gameId}
              className="inprog-card recent-card"
              style={{ '--accent-tint': g.tagColor + '24' }}
              aria-label={'Replay ' + g.name}
              {...tapProps(() => onOpen(p.gameId))}
            >
              <div className="ip-icon">{g.icon}</div>
              <div className="ip-name">{g.name}</div>
              <div className="ip-sub resume">▶ Replay</div>
              {p.playedAt && (
                <div className="ip-sub mono">{fmtPlayedAgo(p.playedAt, offset)}</div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Per-game public chat room (phase 7): one room per game, 10s polling, report-
// to-hide moderation (3 distinct reports auto-hide a message server-side).
function ChatPanel({ game, user, onClose }) {
  const [messages, setMessages] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const listRef = useRef(null);
  const lastIdRef = useRef(0);

  const merge = (incoming) => {
    if (!incoming.length) return;
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const merged = prev.concat(incoming.filter((m) => !seen.has(m.id)));
      return merged.slice(-200);
    });
  };

  useEffect(() => {
    let alive = true;
    const load = async (initial) => {
      const q = initial || !lastIdRef.current ? '' : `?after=${lastIdRef.current}`;
      const { ok, body } = await api(`/api/chat/${game.id}${q}`);
      if (alive && ok && body) {
        merge(body.messages || []);
        setLoaded(true);
      }
    };
    load(true);
    const t = setInterval(() => load(false), 10000);
    return () => { alive = false; clearInterval(t); };
  }, [game.id]);

  useEffect(() => {
    lastIdRef.current = messages.length ? messages[messages.length - 1].id : 0;
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  const send = async () => {
    const body = input.trim();
    if (!body || busy) return;
    setBusy(true);
    const { ok, body: resp } = await api(`/api/chat/${game.id}`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
    setBusy(false);
    if (ok && resp && resp.message) {
      merge([resp.message]);
      setInput('');
    } else {
      setNotice('Could not send — try again.');
      setTimeout(() => setNotice(''), 2500);
    }
  };

  const report = async (m) => {
    if (!window.confirm('Report this message? 3 reports hide it for everyone.')) return;
    const { ok, body } = await api(`/api/chat/messages/${m.id}/report`, { method: 'POST' });
    if (ok && body) {
      if (body.hidden) {
        setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, hidden: true, body: null, username: null } : x)));
      } else {
        setNotice('Reported — thanks for keeping the room clean.');
        setTimeout(() => setNotice(''), 2500);
      }
    }
  };

  const myId = user && user.id;
  return (
    <div className="chat-overlay" onClick={onClose}>
      <div className="chat-panel" onClick={(e) => e.stopPropagation()}>
        <div className="chat-head">
          <div className="chat-title">
            <span>{game.icon}</span> {game.name} · Chat
          </div>
          <button className="chat-close" onClick={onClose} aria-label="Close chat">✕</button>
        </div>
        <div className="chat-list" ref={listRef}>
          {!loaded && <div className="chat-empty">Loading room…</div>}
          {loaded && messages.length === 0 && (
            <div className="chat-empty">No messages yet — say hi to today's players.</div>
          )}
          {messages.map((m) =>
            m.hidden ? (
              <div key={m.id} className="chat-msg hidden-msg">
                <span className="chat-tombstone">🚫 Hidden by community reports</span>
              </div>
            ) : (
              <div key={m.id} className={'chat-msg' + (myId && m.userId === myId ? ' mine' : '')}>
                <div className="chat-msg-top">
                  <span className="chat-author">{m.username}</span>
                  {(!myId || m.userId !== myId) && (
                    <button className="chat-report" title="Report" onClick={() => report(m)}>🚩</button>
                  )}
                </div>
                <div className="chat-body">{m.body}</div>
              </div>
            )
          )}
        </div>
        {notice && <div className="chat-notice">{notice}</div>}
        <div className="chat-input-row">
          <input
            className="chat-input"
            placeholder="Message this game's room…"
            value={input}
            maxLength={500}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          />
          <button className="chat-send" onClick={send} disabled={busy || !input.trim()}>Send</button>
        </div>
      </div>
    </div>
  );
}


/* #176 — ARCADE RUN HISTORY. The request asked arcade to keep "a history to
   share / replay", and this is it: the player's last runs on this game, with
   the band and score they scored, a Share line, and a Replay that re-derives
   that exact board from its stored seed.

   Only the seed and the numbers are stored, never a board — every generator in
   this app is seeded and deterministic, so a run is a few hundred bytes. That
   is also why Replay can exist at all. */
function ArcadeRuns({ gameId, authOk, onReplay }) {
  const [runs, setRuns] = useState(null);
  const [copied, setCopied] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!authOk) { setRuns([]); return undefined; }
    api(`/api/arcade/${gameId}/runs`)
      .then(({ ok, body }) => { if (alive) setRuns(ok && body ? body.runs || [] : []); })
      .catch(() => { if (alive) setRuns([]); });
    return () => { alive = false; };
  }, [gameId, authOk]);

  if (!authOk) return null;
  if (runs === null) return <div className="arun-empty">Loading your runs…</div>;
  if (!runs.length) {
    return <div className="arun-empty">No runs yet — your last 25 will show up here to share or replay.</div>;
  }
  const share = (r) => {
    const line = `Game Corner ${gameId} — Arcade ${arcadeBand(r.band).label}: ${r.score} pts` +
      (r.timeSecs ? ` in ${Math.floor(r.timeSecs / 60)}:${String(r.timeSecs % 60).padStart(2, '0')}` : '') +
      ` 🎮 ${location.origin}/?game=${encodeURIComponent(gameId)}&mode=arcade`;
    copyText(line);
    setCopied(r.id);
    setTimeout(() => setCopied(c => (c === r.id ? null : c)), 1600);
  };
  return (
    <div className="arun-list">
      <div className="pregame-bands-label">Your recent runs</div>
      {runs.map(r => (
        <div className="arun-row" key={r.id}>
          <span className={'arun-band ' + r.band}>{arcadeBand(r.band).label}</span>
          <span className="arun-score mono">{r.score}</span>
          <span className="arun-when">{cgAgo(r.at)}</span>
          <button className="arun-btn tappable" {...tapProps(() => share(r))}>
            {copied === r.id ? '✓ Copied' : '↗ Share'}
          </button>
          <button className="arun-btn tappable" {...tapProps(() => onReplay && onReplay(r))}>↻ Replay</button>
        </div>
      ))}
      <div className="pregame-band-note">
        A replay is the same board again, for practice — it never moves a best or a rank.
      </div>
    </div>
  );
}


/* ============================================================
   Opponent screen — the pre-game screen for a head-to-head game
   ============================================================
   The seven opponent games had TWO different first screens. Mancala and
   Snakes & Ladders dropped you into the game, which then rendered its own
   full mode picker inline; the five phase-5 board games opened a MODAL over
   the lobby. The modal was also the poorer of the two: it offered the modes
   and nothing else, so Versus Bot on Checkers or Gomoku started at full search
   depth with no way to pick a level — the difficulty tiers existed, were
   plumbed all the way through to the search, and simply had no control
   attached to them on that path.

   So there is one screen now, and it is a SCREEN rather than a popup: it can
   afford to say what the game is before asking who you want to play against,
   which a modal sized to a mode list cannot. It renders ClassicModePicker —
   the picker that already handled bot strength, Ludo's 2-4 seats, online
   create/join and Snakes & Ladders' board variants — so the options are the
   same wherever you reach them from, and there is one place to add the next
   one.
   ============================================================ */
function OpponentScreen({ game, onPlay, onHowTo, onChat }) {
  /* The variant glossary belongs to this screen while it is the one asking the
     question, so it is local state rather than another app-level overlay —
     Snakes & Ladders is the only game with a board variant, and its own
     in-game header already owns the same modal once a match is running. */
  const [glossary, setGlossary] = useState(false);
  const m = game.manifest || {};
  const modes = game.modes || [];
  const hasBot = modes.indexOf('bot') !== -1;
  const hasLocal2p = modes.indexOf('2p') !== -1;
  /* 2048 and Block Fit reach this screen too, and their axis is a score race
     rather than an opponent across a board — so the chips and the heading come
     off `modes` instead of being hardcoded for the five board games. */
  const heading = hasBot || hasLocal2p ? 'Choose an opponent' : 'Choose how to play';
  return (
    <div className="pregame-card" style={{ '--accent': game.tagColor || C.accent }}>
      <div className="pregame-icon">{game.icon}</div>
      <h2>{game.name}</h2>
      <div className="sub">{game.desc}</div>
      <div className="pregame-chips">
        {m.sessionLength && SESSION_LENGTH_LABEL[m.sessionLength] && (
          <span className="pregame-chip">⏱ {SESSION_LENGTH_LABEL[m.sessionLength]}</span>
        )}
        {m.input && INPUT_LABEL[m.input] && <span className="pregame-chip">{INPUT_LABEL[m.input]}</span>}
        {hasLocal2p && <span className="pregame-chip">👥 2 players</span>}
        {hasBot && <span className="pregame-chip">🤖 Bot: 3 levels</span>}
        {modes.indexOf('online') !== -1 && <span className="pregame-chip">🌐 Online</span>}
      </div>

      {/* What the game actually is, in the player's own terms. The how-to
          cards are the long form behind the "?" — this is the one-line version
          you need before choosing an opponent. */}
      {game.howToPlay && game.howToPlay.length > 0 && (
        <div className="opp-brief">
          {game.howToPlay.slice(0, 2).map((c, i) => (
            <div className="opp-brief-row" key={i}>
              <span className="opp-brief-n">{i + 1}</span>
              <span><b>{c.title}</b> {c.body}</span>
            </div>
          ))}
        </div>
      )}

      <div className="pregame-bands-label">{heading}</div>
      <ClassicModePicker
        game={game}
        onPlay={onPlay}
        onGlossary={game.variantPicker ? () => setGlossary(true) : undefined}
      />
      {glossary && <MokshaGlossaryModal onClose={() => setGlossary(false)} />}

      {/* The retired modal showed a "Top players" preview for the two games
          with an all-time board; keeping it here is the one thing that screen
          had which this one otherwise wouldn't. */}
      {game.leaderboard && (
        <div className="opp-lb">
          <ClassicLeaderboard
            gameId={game.id}
            url={game.leaderboardOpts && game.leaderboardOpts.url}
            valueLabel={(game.leaderboardOpts && game.leaderboardOpts.valueLabel) || 'Score'}
            valueFmt={game.leaderboardOpts && game.leaderboardOpts.valueFmt}
          />
        </div>
      )}

      <div className="pregame-actions">
        <button className="pregame-howto-btn" onClick={onHowTo}>❓ How to play</button>
        {onChat && <button className="pregame-howto-btn" onClick={onChat}>💬 Game chat</button>}
      </div>
    </div>
  );
}


/* #188 — one place to see where you stand in a game, with the three rankings
   the report asks for.

   Two of the three already existed and simply had nowhere to be seen from: the
   daily board only ever appeared on the result card (so you had to finish
   today's puzzle to read it), and the per-band arcade boards were only reachable
   from an arcade run. All-time is the one that had no endpoint at all.

   "Level" is the arcade band ladder rather than the story rungs, deliberately.
   Story pays once on first clear, so a story ranking would be a list of who has
   finished, in the order they happened to arrive — not a standing. Arcade keeps
   a best per band, which is what a ladder means. */
const GB_TABS = [
  { id: 'daily', label: 'Daily' },
  { id: 'level', label: 'Level' },
  { id: 'alltime', label: 'All-time' },
];

function GbRows({ rows, me, cols, empty }) {
  const meVisible = me && rows.some((e) => e.isCurrentUser);
  if (!rows.length) return <div className="lboard-empty">{empty}</div>;
  const row = (e, pinned) => (
    <div key={(pinned ? 'me-' : '') + e.rank} className={'lrow' + (e.isCurrentUser ? ' me' : '') + (pinned ? ' pinned' : '')}>
      <span className="lrank mono">#{e.rank}</span>
      <span className="lname">{e.username}{e.isCurrentUser ? ' (you)' : ''}</span>
      <span className="ltime mono">{cols.a(e)}</span>
      <span className="lsteps mono">{cols.b(e)}</span>
    </div>
  );
  return (
    <div className="lboard-rows">
      {rows.map((e) => row(e, false))}
      {me && !meVisible && row(me, true)}
    </div>
  );
}

function GameBoards({ game, onClose }) {
  const [tab, setTab] = useState('daily');
  // #331 — the daily now has three ranked deals, so the Daily tab carries the
  // same Easy/Normal/Hard pills as the Level tab's arcade bands. `?lbband=`
  // deep-links a band, the same way the per-game Leaderboard reads it.
  const [band, setBand] = useState(() => {
    try {
      const q = new URLSearchParams(window.location.search).get('lbband');
      if (q && isDailyBand(q)) return q;
    } catch (e) {}
    return 'normal';
  });
  const [scope, setScope] = useState(lbInitialScope);
  const [state, setState] = useState({ loading: true });

  // Each tab is a different endpoint of the same shape, so one fetch serves all
  // three; band participates on the Daily and Level tabs (daily difficulty and
  // arcade band respectively — two dials that happen to share one state slot).
  const url = tab === 'daily'
    ? `/api/daily/${game.id}/leaderboard${band !== 'normal' ? '?band=' + encodeURIComponent(band) : ''}`
    : tab === 'level' ? `/api/arcade/${game.id}/leaderboard?band=${encodeURIComponent(band)}`
    : `/api/alltime/${game.id}/leaderboard`;

  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    (async () => {
      const q = scope === 'friends' ? (url.indexOf('?') === -1 ? '?scope=friends' : '&scope=friends') : '';
      const { ok, body } = await api(url + q);
      if (!alive) return;
      setState(ok && body ? { loading: false, ...body } : { loading: false, entries: [], me: null, total: 0, error: true });
    })();
    return () => { alive = false; };
  }, [url, scope]);

  const rows = state.entries || [];
  const cols = tab === 'alltime'
    ? { a: (e) => `${e.points} pts`, b: (e) => `${e.plays}d` }
    : tab === 'level'
      ? { a: (e) => `${e.bestScore != null ? e.bestScore : e.score || 0} pts`, b: (e) => (e.runs != null ? `${e.runs}r` : '—') }
      : { a: (e) => lbFmtTime(e.timeSecs), b: (e) => (e.steps != null ? `${e.steps} st` : '—') };
  const empty = scope === 'friends' ? LB_FRIENDS_EMPTY
    : tab === 'daily'
      ? band !== 'normal'
        ? `No one has solved today's ${band === 'hard' ? 'Hard' : 'Easy'} board yet.`
        : "Nobody has solved today's puzzle yet."
      : tab === 'level' ? 'No runs on this band yet.'
        : 'No finished games yet — play one and you are on the board.';

  return (
    <div className="gb-sheet-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="gb-sheet" role="dialog" aria-label={`${game.name} leaderboards`}>
        <div className="gb-head">
          <span>{game.icon} {game.name} — leaderboards</span>
          <button className="gb-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="cg-sheet-tabs">
          {GB_TABS.map((t) => (
            <button key={t.id} className={'cg-sheet-tab' + (tab === t.id ? ' active' : '')} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>
        {tab === 'daily' && (
          <div className="lb-band-tabs">{LbBandTabsInner(band, setBand)}</div>
        )}
        {tab === 'level' && (
          <div className="pregame-band-row wide gb-bands">
            {ARCADE_BANDS.map((b) => (
              <button key={b.id} className={'pregame-band wide tappable' + (b.id === band ? ' on' : '')}
                {...tapProps(() => setBand(b.id))}>{b.label}</button>
            ))}
          </div>
        )}
        <LbScopeTabs scope={scope} onChange={setScope} />
        {state.loading
          ? <div className="lboard-empty">Loading…</div>
          : <GbRows rows={rows} me={state.me} cols={cols} empty={empty} />}
        <div className="lboard-note">
          {tab === 'alltime'
            ? 'Total points across every daily you have finished. Ties go to fewer days played.'
            : tab === 'level'
              ? 'Your best arcade run on each difficulty band.'
              : "Today's solvers, fastest first."}
        </div>
      </div>
    </div>
  );
}

function PreGameScreen({ game, attempt, best, streak, authOk, nextResetUtc, offset, onReset, onPlay, onPractice, onHowTo, onChat,
                         playMode, storyProgress, storyBand, onStoryBand, arcadeBandId, onArcadeBand, arcadeBest,
                         onReplayRun, dailyBandId, onDailyBand }) {
  /* `?boards=1` opens the panel at mount. The boards are behind a tap, and a
     screen behind a tap is invisible to proposal checks and to the before/after
     screenshots alike — the same reason ?sheet= exists for the classic shell. */
  const [boardsOpen, setBoardsOpen] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('boards') === '1'; }
    catch (e) { return false; }
  });
  const countdown = useCountdown(nextResetUtc, offset, onReset);
  const resuming = !!(attempt && !attempt.finishedAt);
  const m = game.manifest || {};
  /* #176 — ONE component, three fillings. The screen keeps a fixed rhetorical
     shape — what am I playing · where do I stand · what's at stake — and each
     mode answers those three its own way. Forking it per mode would have meant
     three screens to keep in step; leaving it daily-shaped would have left
     story and arcade staring at a reset countdown that means nothing to them. */
  const mode = playMode || (game.daily ? 'daily' : null);
  const isDaily = mode === 'daily';
  const isStory = mode === 'story';
  const isArcade = mode === 'arcade';
  const prog = (storyProgress && storyProgress[game.id]) || null;
  const bandTotal = prog ? prog.total : 0;
  const bandCleared = prog ? prog.cleared : 0;
  // #331 — the daily band this pre-game screen would play. If today's attempt
  // already exists the band is fixed at whatever it was claimed on (server
  // rows carry `band`; pre-band rows read as 'normal'), and the picker locks.
  const claimed = !!attempt;
  const activeBand = claimed && attempt && isDailyBand(attempt.band)
    ? attempt.band : (dailyBandId || 'normal');
  return (
    <div className="pregame-card" style={{ '--accent': game.tagColor || C.accent }}>
      <div className="pregame-icon">{game.icon}</div>
      <h2>{game.name}</h2>
      <div className="sub">{game.desc}</div>
      <div className="pregame-chips">
        {m.sessionLength && SESSION_LENGTH_LABEL[m.sessionLength] && (
          <span className="pregame-chip">⏱ {SESSION_LENGTH_LABEL[m.sessionLength]}</span>
        )}
        {m.input && INPUT_LABEL[m.input] && <span className="pregame-chip">{INPUT_LABEL[m.input]}</span>}
        {m.undo === 'free' && <span className="pregame-chip">↩︎ Undo allowed</span>}
        {m.undo === 'booster' && <span className="pregame-chip">↩︎ Limited boosters</span>}
      </div>
      <div className="pregame-stats">
        <div className="pregame-stat">
          <div className="l">{isArcade ? 'Best on this band' : 'Personal best'}</div>
          <div className="v mono">
            {isArcade
              ? (arcadeBest && arcadeBest.score ? `+${arcadeBest.score}` : '—')
              : (best && best.score != null ? `+${best.score}` : '—')}
          </div>
        </div>
        {/* Streak is a DAILY idea — consecutive days played — so it appears
            only there rather than showing a number that cannot move. */}
        {isDaily && (
          <div className="pregame-stat">
            <div className="l">Streak</div>
            <div className="v mono">{authOk ? `${streak}d` : '—'}</div>
          </div>
        )}
        {isStory && bandTotal > 0 && (
          <div className="pregame-stat">
            <div className="l">Levels cleared</div>
            <div className="v mono">{bandCleared}/{bandTotal}</div>
          </div>
        )}
        {isArcade && (
          <div className="pregame-stat">
            <div className="l">Your rank</div>
            <div className="v mono">{arcadeBest && arcadeBest.rank ? `#${arcadeBest.rank}` : '—'}</div>
          </div>
        )}
        {isDaily && nextResetUtc && (
          <div className="pregame-stat">
            <div className="l">New deal in</div>
            <div className="v mono">{countdown}</div>
          </div>
        )}
      </div>
      {isDaily && (
        <div className="pregame-deal">
          🌍 Everyone on your difficulty plays this <strong>exact deal</strong> today — one attempt.
        </div>
      )}
      {/* #331 — the daily's difficulty band, before the one attempt is spent.
          The board is derived from the day's seed MIXED with the band, so Easy
          and Hard are different deals from the same day anchor, and each is
          ranked on its own board. Once today's attempt has been claimed the
          band is fixed (the lock is one attempt per day, not one per band), so
          the picker shows what was played rather than offering a switch. */}
      {isDaily && (
        <div className="pregame-bands" role="group" aria-label="Choose a difficulty">
          <div className="pregame-bands-label">Difficulty</div>
          <div className="pregame-band-row wide">
            {DAILY_BANDS.map(b => (
              <button
                key={b}
                className={'pregame-band wide tappable' + (b === activeBand ? ' on' : '') + (claimed ? ' locked' : '')}
                disabled={claimed}
                aria-label={b[0].toUpperCase() + b.slice(1)}
                {...tapProps(() => onDailyBand && onDailyBand(b))}
              >{b[0].toUpperCase() + b.slice(1)}</button>
            ))}
          </div>
          <div className="pregame-band-note">
            {activeBand === 'easy' ? 'Easy board · ×0.8 points'
              : activeBand === 'hard' ? 'Hard board · ×1.25 points'
              : 'Normal board · ×1 point'}
            {(DAILY_BAND_NOTES[game.id] && DAILY_BAND_NOTES[game.id][activeBand])
              ? ` · ${DAILY_BAND_NOTES[game.id][activeBand]}` : ''}
            {claimed ? ' — already played today, this was your board.' : ''}
          </div>
        </div>
      )}
      {isStory && bandTotal > 0 && (
        <div className="pregame-bands" role="group" aria-label="Choose a level">
          <div className="pregame-bands-label">Level</div>
          <div className="pregame-band-row">
            {Array.from({ length: bandTotal }, (_, i) => {
              const done = i < bandCleared;
              const locked = i > bandCleared;   // levels are walked in order
              return (
                <button
                  key={i}
                  className={'pregame-band tappable' + (i === storyBand ? ' on' : '') + (done ? ' done' : '') + (locked ? ' locked' : '')}
                  disabled={locked}
                  aria-label={`Level ${i + 1}${done ? ', cleared' : ''}`}
                  {...tapProps(() => { if (!locked) onStoryBand && onStoryBand(i); })}
                >{done ? '✓' : i + 1}</button>
              );
            })}
          </div>
          <div className="pregame-band-note">
            {bandCleared >= bandTotal
              ? 'All levels cleared: badge earned. Replay any level for practice; points are paid once, on first clear.'
              : 'Clearing a level for the first time pays. Replays are for practice.'}
          </div>
        </div>
      )}
      {isArcade && (
        <div className="pregame-bands" role="group" aria-label="Choose a difficulty">
          <div className="pregame-bands-label">Difficulty</div>
          <div className="pregame-band-row wide">
            {/* #195 — the per-band "recommended" tag is gone. It was steering
                rather than gating (all three bands are open from the first
                run), but it repeated what the band names already say: Easy is
                the easy one. The note under the row still explains what arcade
                scoring rewards, which is the part a player cannot infer. */}
            {ARCADE_BANDS.map(b => (
              <button
                key={b.id}
                className={'pregame-band wide tappable' + (b.id === arcadeBandId ? ' on' : '')}
                aria-label={b.label}
                {...tapProps(() => onArcadeBand && onArcadeBand(b.id))}
              >
                {b.label}
              </button>
            ))}
          </div>
          <div className="pregame-band-note">
            A fresh board every run. Beating your own best on this band scores;
            so does reaching the top 10, top 3 or #1 — once each.
          </div>
          <ArcadeRuns gameId={game.id} authOk={authOk} onReplay={onReplayRun} />
        </div>
      )}
      {resuming && (
        <div className="pregame-resume-note">▶ You have a run in progress — jump back in where you left off.</div>
      )}
      <button className="primary-btn pregame-play" onClick={onPlay}>
        {resuming ? '▶ Resume' : !authOk && game.daily ? 'Play as guest' : 'Play'}
      </button>
      {/* #367 — a RANDOM board, not today's deal: the daily is not given away
          and nothing is recorded. Secondary outline, the same look the result
          card gives "Play again for fun". Daily only: story and arcade deal a
          board you can already retry. */}
      {isDaily && onPractice && (
        <button className="primary-btn review-btn pregame-practice tappable"
          {...tapProps(() => onPractice(activeBand))}>
          🎲 Practice run <span className="practice-note">(not scored)</span>
        </button>
      )}
      {game.daily && !authOk && (
        <div className="pregame-signedout">
          Playing as a guest — finish today's board and sign in before midnight UTC
          to put your run on the leaderboard and start a streak.
        </div>
      )}
      {/* #240 — these two were trailing text links under the Play button, the
          quietest thing on the screen. They are the game's instructions and
          its room; a first-time player needs the first one before they press
          Play at all. Now a pair of real buttons on their own row, each a
          44px tap target. */}
      <div className="pregame-actions">
        <button className="pregame-howto-btn" onClick={onHowTo}>❓ How to play</button>
        {onChat && (
          <button className="pregame-howto-btn" onClick={onChat}>💬 Game chat</button>
        )}
        {/* #188 — the boards were only readable AFTER a run: today's from the
            result card, the arcade ladder from inside an arcade run. Here they
            are before you play, which is when "where do I stand" is a reason
            to press Play. */}
        <button className="pregame-howto-btn" onClick={() => setBoardsOpen(true)}>🏆 Leaderboards</button>
      </div>
      {boardsOpen && <GameBoards game={game} onClose={() => setBoardsOpen(false)} />}
    </div>
  );
}

/* PHASE 4 (#122) — a finished day is a RESULT screen, not a countdown screen.
   The lock icon and a giant "next puzzle in" clock was all you got for coming
   back; the reset time is now one line and the emphasis is your result, your
   personal best, today's board, and (new) a practice replay. Games that can
   snapshot their solved board also get a "View board" button — the review layer
   the win overlay already uses — wired by the caller through onReview. */
function LockedScreen({ game, attempt, nextResetUtc, offset, onReset, onBack, best, onReview, onPractice }) {
  const countdown = useCountdown(nextResetUtc, offset, onReset);
  const hasResult = attempt && attempt.score != null;
  const solved = !!(attempt && attempt.score != null && attempt.score > 0);
  const fmtTime = s =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return (
    <div className="locked-card">
      <div className="trophy">{solved ? '🏆' : '🎯'}</div>
      <h2>{solved ? "Today's result" : 'You played today'}</h2>
      <div className="sub">{game.name}</div>
      {hasResult && (
        <div className="locked-result">
          <div className="score-row"><span className="k">Score</span><span className="v">+{attempt.score}</span></div>
          {attempt.steps != null && (
            <div className="score-row"><span className="k">Steps</span><span className="v">{attempt.steps}</span></div>
          )}
          {attempt.timeSecs != null && (
            <div className="score-row"><span className="k">Time</span><span className="v">{fmtTime(attempt.timeSecs)}</span></div>
          )}
          {best && best.score != null && (
            <div className="score-row"><span className="k">Personal best</span><span className="v">+{best.score}</span></div>
          )}
          {/* #331 — name the board the day was played on when it wasn't the
              default. Rows pre-dating bands read as Normal and stay silent. */}
          {attempt && isDailyBand(attempt.band) && attempt.band !== 'normal' && (
            <div className="score-row"><span className="k">Difficulty</span><span className="v">{attempt.band === 'hard' ? 'Hard board · ×1.25' : 'Easy board · ×0.8'}</span></div>
          )}
        </div>
      )}
      <Leaderboard
        gameId={game.id}
        solved={solved}
        defaultBand={attempt && isDailyBand(attempt.band) ? attempt.band : 'normal'}
      />
      {onReview && (
        <button className="primary-btn review-btn" onClick={onReview}>👁 View board</button>
      )}
      {onPractice && (
        <button className="primary-btn review-btn" onClick={onPractice}>
          🎲 Play again for fun <span className="practice-note">(not scored)</span>
        </button>
      )}
      <div className="reset-line">Next puzzle in <span className="mono">{countdown}</span></div>
      <button className="primary-btn" onClick={onBack}>Back to Lobby</button>
    </div>
  );
}
