/* ============================================================
   Social Components — Profile & Friends
   ============================================================ */

/* All-time figures per game (myScores from /api/my/scores), in registry
   order, games with nothing recorded dropped. Read-only: the rows carry no
   tap target, so no TAPPABLE_CLASSES entry and no press feedback. */
const profileScoreRows = (myScores) => {
  if (!myScores) return [];
  const rows = [];
  for (const g of GAMES) {
    const s = myScores[g.id];
    if (!s) continue;
    const hasPts = Number.isFinite(s.pts) && s.pts > 0;
    const hasBest = Number.isFinite(s.best) && s.best > 0;
    const recTot = s.record ? (s.record.wins + s.record.losses + s.record.draws) : 0;
    if (!hasPts && !hasBest && recTot <= 0) continue;
    rows.push({ game: g, s, hasPts, hasBest, hasRec: recTot > 0 });
  }
  return rows;
};

function ProfileScreen({ userId, user: loggedInUser, myScores, onBack, onOpenFriends, onOpenSettings }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = async () => {
    const { ok, body } = await api(`/api/social/profile/${userId}`);
    if (ok && body) setProfile(body);
    setLoading(false);
  };

  useEffect(() => { loadProfile(); }, [userId]);

  const handleFollow = async () => {
    if (!profile) return;
    const { ok } = await api(`/api/social/follow/${profile.user.id}`, { method: 'POST' });
    if (ok) {
      setProfile(prev => ({ ...prev, following: true }));
    }
  };

  const handleUnfollow = async () => {
    if (!profile) return;
    const { ok } = await api(`/api/social/unfollow/${profile.user.id}`, { method: 'DELETE' });
    if (ok) {
      setProfile(prev => ({ ...prev, following: false }));
    }
  };

  if (loading) {
    return (
      <div className="social-page screen-in">
        <button className="back-btn" onClick={onBack}>← Back</button>
        <p style={{ color: C.muted, marginTop: '1rem' }}>Loading profile...</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="social-page screen-in">
        <button className="back-btn" onClick={onBack}>← Back</button>
        <p style={{ color: C.rose, marginTop: '1rem' }}>Profile not found</p>
      </div>
    );
  }

  const isOwnProfile = loggedInUser && loggedInUser.id === profile.user.id;
  const recentGames = Array.isArray(profile.recentGames) ? profile.recentGames : [];

  return (
    <div className="social-page screen-in">
      <button className="back-btn" onClick={onBack}>← Back</button>

      <div style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: '14px',
        padding: '1.5rem',
        marginTop: '1.5rem'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1.5rem', gap: '0.75rem' }}>
          <div className="profile-id">
            <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>{profile.user.username}</h2>
            <p style={{ color: C.muted, fontSize: '0.85rem', margin: '0.25rem 0 0', fontFamily: "'JetBrains Mono', monospace" }}>
              {new Date(profile.user.createdAt).toLocaleDateString()}
            </p>
            {isOwnProfile && <p style={{ color: C.emerald, fontSize: '0.8rem', margin: '0.5rem 0 0' }}>Your Profile</p>}
          </div>
          {!isOwnProfile && (
            <div style={{ display: 'flex', gap: '0.5rem', flexDirection: 'column', alignItems: 'flex-end' }}>
              <button
                className="primary-btn"
                style={{
                  background: profile.following ? C.surface : C.accent,
                  border: `1px solid ${profile.following ? C.border : C.accent}`,
                  color: profile.following ? C.text : 'white',
                  padding: '0.5rem 1rem',
                }}
                onClick={profile.following ? handleUnfollow : handleFollow}
              >
                {profile.following ? '✓ Friends' : '＋ Add friend'}
              </button>
            </div>
          )}
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '1rem',
          marginBottom: '1.5rem'
        }}>
          <div style={{ background: C.surface, padding: '1rem', borderRadius: '10px', textAlign: 'center' }}>
            <div style={{ fontSize: '0.75rem', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>Score</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: C.gold, fontFamily: "'JetBrains Mono', monospace" }}>{profile.stats.totalScore}</div>
          </div>
          <div style={{ background: C.surface, padding: '1rem', borderRadius: '10px', textAlign: 'center' }}>
            <div style={{ fontSize: '0.75rem', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>Streak</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: C.emerald, fontFamily: "'JetBrains Mono', monospace" }}>{profile.stats.currentStreak}</div>
          </div>
          <div style={{ background: C.surface, padding: '1rem', borderRadius: '10px', textAlign: 'center' }}>
            <div style={{ fontSize: '0.75rem', color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>Played</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: C.accent, fontFamily: "'JetBrains Mono', monospace" }}>{profile.stats.gamesPlayed}</div>
          </div>
        </div>

        {/* All-time scores — every game the viewer has any recorded figure
            for, in registry order. Own profile only: /api/my/scores is
            caller-keyed, so there is nothing to show for anyone else. */}
        {isOwnProfile && (() => {
          const scoreRows = profileScoreRows(myScores);
          return (
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.muted, marginBottom: '0.6rem' }}>
                All-time scores
              </div>
              {scoreRows.length === 0 ? (
                <div style={{ fontSize: '0.85rem', color: C.muted }}>
                  No scores yet. Play a game!
                </div>
              ) : (
                <div>
                  {scoreRows.map((row, i) => {
                    const { s } = row;
                    const recFigure = s.record
                      ? `${s.record.wins}W · ${s.record.losses}L${s.record.draws > 0 ? ` · ${s.record.draws}D` : ''}`
                      : null;
                    const recordOnly = row.hasRec && !row.hasPts && !row.hasBest;
                    return (
                      <div
                        key={row.game.id}
                        className="prr"
                        style={{ borderBottom: i < scoreRows.length - 1 ? `1px solid ${C.border}` : 'none' }}
                      >
                        <span className="prr-icon">{row.game.icon}</span>
                        <span className="prr-name">{row.game.name}</span>
                        <span className="prr-meta mono">
                          {recordOnly ? (
                            <span className="prr-score" style={{ color: C.emerald }}>{recFigure}</span>
                          ) : (
                            <React.Fragment>
                              <span className="prr-score" style={{ color: C.gold }}>
                                {row.hasPts ? `+${s.pts.toLocaleString()} pts` : `Best ${s.best.toLocaleString()}`}
                              </span>
                              {row.hasPts && row.hasBest && (
                                <span className="prr-date" style={{ color: C.muted }}>
                                  {` · Best ${s.best.toLocaleString()}`}
                                </span>
                              )}
                            </React.Fragment>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        {/* Recent games — the player's last 10 finished daily runs. */}
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.muted, marginBottom: '0.6rem' }}>
            Recent games
          </div>
          {recentGames.length === 0 ? (
            <div style={{ fontSize: '0.85rem', color: C.muted }}>
              No finished games yet — play today's puzzles!
            </div>
          ) : (
            <div>
              {recentGames.map((r, i) => {
                const g = GAMES.find(gm => gm.id === r.gameId);
                return (
                  <div
                    key={`${r.gameId}-${r.date}-${i}`}
                    className="prr"
                    style={{ borderBottom: i < recentGames.length - 1 ? `1px solid ${C.border}` : 'none' }}
                  >
                    <span className="prr-icon">{g ? g.icon : '🎮'}</span>
                    <span className="prr-name">{g ? g.name : r.gameId}</span>
                    <span className="prr-meta mono">
                      <span className="prr-date">{r.date}</span>
                      <span className="prr-score" style={{ color: r.score > 0 ? C.gold : C.muted }}>
                        {r.score > 0 ? `+${r.score} pts · ${lbFmtTime(r.timeSecs)}` : 'Played'}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ marginBottom: '1.25rem' }}>
          <BadgeStrip
            badges={Array.isArray(profile.badges) ? profile.badges : []}
            achievements={profile.achievements || { types: [], milestones: [], stories: [] }}
            streak={isOwnProfile ? profile.stats.currentStreak : null}
            solveCount={isOwnProfile ? profile.stats.dailiesCompleted : null}
          />
        </div>

        {/* Connections — Friends entry, mobile-only (the nav carries the
            Friends button on wide viewports). Own profile only. */}
        {isOwnProfile && onOpenFriends && (
          <div className="account-connections">
            <button
              type="button"
              className="account-connection-row"
              onClick={onOpenFriends}
            >
              👥 Friends
              <span className="chev">›</span>
            </button>
          </div>
        )}

        {/* Settings entry — own profile only, but shown on every viewport
            (unlike Friends, whose desktop home is the nav bar). */}
        {isOwnProfile && onOpenSettings && (
          <div className="account-connections account-connections-always">
            <button
              type="button"
              className="account-connection-row"
              onClick={onOpenSettings}
            >
              ⚙ Settings
              <span className="chev">›</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function FriendsListScreen({ onSelectUser, onBack }) {
  const [friends, setFriends] = useState([]);
  const [loading, setLoading] = useState(true);
  // Search-to-add: query text, debounced results, per-row "just added" state.
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);   // null = no search active
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);

  const loadFriends = async () => {
    const { ok, body } = await api('/api/social/friends');
    if (ok && body && body.friends) {
      setFriends(body.friends);
    }
    setLoading(false);
  };

  useEffect(() => { loadFriends(); }, []);

  // Debounced (300ms) name search; requires ≥2 chars. Stale responses are
  // dropped via the sequence counter so fast typing can't race.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++searchSeq.current;
    const t = setTimeout(async () => {
      const { ok, body } = await api(`/api/social/search?q=${encodeURIComponent(q)}`);
      if (seq !== searchSeq.current) return;
      setResults(ok && body && Array.isArray(body.results) ? body.results : []);
      setSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const addFriend = async (userId) => {
    // Optimistic flip; the friends list below refreshes on success.
    setResults(prev => (prev || []).map(r => r.id === userId ? { ...r, following: true } : r));
    const { ok } = await api(`/api/social/follow/${userId}`, { method: 'POST' });
    if (ok) loadFriends();
    else setResults(prev => (prev || []).map(r => r.id === userId ? { ...r, following: false } : r));
  };

  if (loading) {
    return (
      <div className="social-page screen-in">
        <button className="back-btn" onClick={onBack}>← Back</button>
        <p style={{ color: C.muted, marginTop: '1rem' }}>Loading friends...</p>
      </div>
    );
  }

  return (
    <div className="social-page screen-in">
      <button className="back-btn" onClick={onBack}>← Back</button>

      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '1.5rem 0 1rem' }}>Friends</h2>

      <input
        type="text"
        className="friends-search-input"
        placeholder="Search players by name…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{
          width: '100%', padding: '0.7rem 0.9rem', marginBottom: '1rem',
          background: C.card, border: `1px solid ${C.border}`, borderRadius: '10px',
          color: C.text, fontFamily: 'inherit', fontSize: '0.95rem', outline: 'none',
        }}
      />

      {results !== null && (
        <div style={{ marginBottom: '1.25rem' }}>
          {searching ? (
            <p style={{ color: C.muted, fontSize: '0.85rem' }}>Searching…</p>
          ) : results.length === 0 ? (
            <p style={{ color: C.muted, fontSize: '0.85rem' }}>No players match "{query.trim()}".</p>
          ) : (
            results.map(r => (
              <div
                key={r.id}
                style={{
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: '10px',
                  padding: '0.75rem 1rem',
                  marginBottom: '0.6rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '0.75rem'
                }}
              >
                <button
                  type="button"
                  style={{
                    all: 'unset', cursor: 'pointer', fontWeight: 600, fontSize: '0.95rem',
                    color: C.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                  }}
                  onClick={() => onSelectUser(r.id)}
                >
                  {r.username}
                </button>
                {r.following ? (
                  <span style={{ color: C.emerald, fontSize: '0.8rem', fontWeight: 700, whiteSpace: 'nowrap' }}>✓ Friends</span>
                ) : (
                  <button
                    className="primary-btn"
                    style={{
                      background: C.accent,
                      border: `1px solid ${C.accent}`,
                      padding: '0.4rem 0.8rem',
                      fontSize: '0.8rem',
                      whiteSpace: 'nowrap'
                    }}
                    onClick={() => addFriend(r.id)}
                  >
                    ＋ Add friend
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {friends.length === 0 ? (
        <div style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: '14px',
          padding: '2rem',
          textAlign: 'center',
          color: C.muted
        }}>
          <p>You haven't added any friends yet — search a player's name above to add them.</p>
        </div>
      ) : (
        <div>
          {friends.map(friend => (
            <div
              key={friend.id}
              style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: '10px',
                padding: '1rem',
                marginBottom: '0.75rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: '1rem' }}>{friend.username}</div>
                <div style={{ fontSize: '0.85rem', color: C.muted, marginTop: '0.25rem' }}>
                  Score: <span style={{ fontFamily: "'JetBrains Mono', monospace", color: C.gold }}>{friend.totalScore}</span>
                  {' · '}
                  Streak: <span style={{ fontFamily: "'JetBrains Mono', monospace", color: C.emerald }}>{friend.currentStreak}</span>
                </div>
              </div>
              <button
                className="primary-btn"
                style={{
                  background: C.accent,
                  border: `1px solid ${C.accent}`,
                  padding: '0.4rem 0.8rem',
                  fontSize: '0.8rem'
                }}
                onClick={() => onSelectUser(friend.id)}
              >
                View
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
