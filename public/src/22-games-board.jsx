/* ============================================================
   Phase 5 board games — Checkers, Reversi, Four in a Row, Gomoku,
   Ludo. Online head-to-head only: the SERVER is the referee (rules
   modules in lib/board-rules.js over classic_rooms), so these
   components only render polled state and submit move intents —
   there are no client-side rules to drift out of sync.
   ============================================================ */

// Create/Join setup for the online-only board games (reuses the Mancala
// mode-select styling).
function OnlineRoomSetup({ gameId, onReady }) {
  const [action, setAction] = useState(null);
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Ludo seats 2–4 players (change-list item 10); every other board game is
  // strictly head-to-head.
  const multiSeat = gameId === 'ludo';
  const [players, setPlayers] = useState(2);

  /* #145 — "Your rooms".
     A room you hosted and then left (backgrounded the app, phone slept) used to
     be unreachable: it wasn't listed anywhere, and typing your own code came
     back "Room is full or you created it" with no way forward. /api/rooms/mine
     now returns WAITING rooms as well as active ones, and Rejoin goes through
     the same onReady pre-seating the home in-progress row already uses. */
  const [myRooms, setMyRooms] = useState(null); // null = still loading
  const [closing, setClosing] = useState(null);

  const loadMine = async () => {
    const { ok, body } = await api('/api/rooms/mine');
    setMyRooms(ok && body && Array.isArray(body.rooms)
      ? body.rooms.filter(r => r.gameId === gameId) : []);
  };
  useEffect(() => { loadMine(); }, [gameId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close a room nobody ever joined. Same guarded forfeit endpoint as an
  // in-match concede — with no opponent it can't touch the ladder (the server
  // only rates on an active→finished transition WITH a player 2).
  const closeRoom = async (room) => {
    setClosing(room.id);
    await api(`/api/classic/${gameId}/rooms/${room.id}/finish`, {
      method: 'POST', body: JSON.stringify({}),
    });
    setClosing(null);
    loadMine();
  };

  const start = async () => {
    if (action === 'create') {
      setBusy(true);
      const { ok, body } = await api(`/api/classic/${gameId}/rooms`, {
        method: 'POST',
        body: JSON.stringify(multiSeat ? { players } : {}),
      });
      setBusy(false);
      if (ok && body) onReady(body.id, 1);
      else setError('Could not create room. Try again.');
    } else if (action === 'join') {
      const code = joinCode.trim().toUpperCase();
      if (code.length < 4) { setError('Enter a valid room code.'); return; }
      setBusy(true);
      const { ok, status, body } = await api(`/api/classic/${gameId}/rooms/${code}/join`, { method: 'POST' });
      setBusy(false);
      if (ok) { onReady(code, (body && body.yourPlayerNum) || 2); return; }
      if (status === 404) setError('Room not found. Check the code.');
      // #145 — your own code is no longer a dead end: rejoin it.
      else if (status === 409 && body && body.ownRoom) {
        onReady(code, body.yourPlayerNum || 1);
      }
      else if (status === 409) setError('That room is already full or finished.');
      else setError('Could not join. Try again.');
    }
  };

  return (
    <div className="mnc-mode-select">
      {myRooms && myRooms.length > 0 && (
        <div className="brd-myrooms">
          <div className="brd-myrooms-label">Your rooms</div>
          {myRooms.map(r => (
            <div key={r.id} className="brd-myroom">
              <div className="brd-myroom-meta">
                <span className="brd-myroom-code mono">{r.id}</span>
                <span className={'brd-myroom-sub' + (r.myTurn ? ' yourturn' : '')}>
                  {r.waiting
                    ? `Waiting for ${r.maxPlayers > 2 ? `${r.maxPlayers - r.seatsFilled} more player(s)` : 'an opponent'}`
                    : r.myTurn ? 'Your turn' : `${r.opponentName}'s turn`}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '0.35rem' }}>
                {r.waiting && (
                  <button
                    className="ghost"
                    onClick={() => closeRoom(r)}
                    disabled={closing === r.id}
                  >{closing === r.id ? '…' : 'Close'}</button>
                )}
                <button onClick={() => onReady(r.id, r.myPlayerNum)}>Rejoin</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="brg-intro">
        {multiSeat
          ? <>🌐 Online Ludo — 2, 3, or 4 players via room code. 2-player wins count on the <strong>Rating Ladder</strong>.</>
          : <>🌐 Online head-to-head — play a friend via room code. Wins count on the <strong>Rating Ladder</strong>.</>}
      </div>
      <div className="mnc-online-actions">
        <div className="mnc-mode-sub">
          <button className={'mnc-difficulty-pill' + (action === 'create' ? ' active' : '')} onClick={() => { setAction('create'); setError(''); }}>Create Room</button>
          <button className={'mnc-difficulty-pill' + (action === 'join' ? ' active' : '')} onClick={() => { setAction('join'); setError(''); }}>Join Room</button>
        </div>
        {multiSeat && action !== 'join' && (
          <div className="mnc-mode-sub" style={{ marginTop: '0.5rem' }}>
            <span style={{ alignSelf: 'center', color: C.muted, fontSize: '0.78rem', marginRight: '0.3rem' }}>Players:</span>
            {[2, 3, 4].map(n => (
              <button
                key={n}
                className={'mnc-difficulty-pill' + (players === n ? ' active' : '')}
                onClick={() => setPlayers(n)}
              >{n} players</button>
            ))}
          </div>
        )}
        {action === 'join' && (
          <div className="mnc-join-form">
            <input
              className="mnc-join-input"
              placeholder="Room code (e.g. AB3K7P)"
              value={joinCode}
              onChange={e => { setJoinCode(e.target.value.toUpperCase()); setError(''); }}
              maxLength={8}
            />
          </div>
        )}
      </div>
      {error && <div className="mnc-join-error">{error}</div>}
      {action && (
        <button
          className="mnc-mode-start-btn"
          onClick={start}
          disabled={busy || (action === 'join' && joinCode.trim().length < 4)}
        >{busy ? 'Please wait…' : action === 'create' ? 'Create & share code' : 'Join game'}</button>
      )}
    </div>
  );
}

// ---- Per-game board views ----------------------------------------------
// Each gets { st, myPlayerNum, isMyTurn, submit } — pure render + intent.

function ckOwnerOf(v) { return v === 1 || v === 3 ? 1 : v === 2 || v === 4 ? 2 : 0; }

/* All five board-game views draw their boards on canvases now (#170
   treatment) — the SAME components in the SAME BOARD_VIEWS registry, so
   online rooms, pass-and-play and Versus Bot all inherit the change with
   the move payloads untouched. Intrinsic art (checkers browns, Reversi
   felt, the goban, Ludo seat colours) stays hardcoded per the palette
   rules; only chrome reads PAL. The controls wave folded the notes, legends,
   Gomoku's confirm bar and Ludo's move list into the same canvases, each
   control twinned in the sr-only layer. */
/* The box owns the WIDTH (per-board --brg-cap composed with the --cg-board
   viewport cap in one max-width); the views derive their cell size from that
   width alone, and since the controls wave their canvases carry the whole
   frame (board + notes + legends + buttons), the box height simply follows
   the canvas. `children` hosts the frame's CuiTwin. */
function BrgBoardBox({ boxRef, canvasRef, className, cap, ariaLabel, children }) {
  return (
    <div className="brg-canvas-box" style={{ '--brg-cap': cap }} ref={boxRef}>
      <canvas ref={canvasRef} className={className + ' board-canvas'} role="img" aria-label={ariaLabel} />
      {children}
    </div>
  );
}

function CheckersBoardView({ st, myPlayerNum, isMyTurn, submit }) {
  const [sel, setSel] = useState(null);
  const board = st.board || [];
  const click = (i) => {
    if (!isMyTurn) return;
    const owner = ckOwnerOf(board[i]);
    if (owner === myPlayerNum) { setSel(i === sel ? null : i); return; }
    if (sel != null && board[i] === 0) { submit({ from: sel, to: i }); setSel(null); }
  };
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const { boxW } = useFitBox(boxRef, { cols: 1, rows: 1, maxCell: 100000 });
  /* #323 — the caps below are finger-size for phones; on a desktop box the
   cells grow with it. The gate is the BOX width: phones and tablets cap at
   340–380 (the base --brg-cap), the desktop media query lifts it to 476–532,
   and 440 sits between. The box is still bounded by --cg-board, which folds
   in the viewport height, so nothing can overflow. */
  const brgCellCap = (boxW > 440) ? Infinity : 48;
  const cell = Math.max(28, Math.min(brgCellCap, Math.floor(Math.floor(boxW) / 8)));
  const side = cell * 8;
  const showNote = st.mustJumpFrom != null && isMyTurn;
  const NOTE_H = showNote ? 22 : 0, LEG_H = 24;
  const H = side + 4 + NOTE_H + LEG_H;
  const controls = [];
  if (showNote) controls.push({ id: 'note', kind: 'label', r: [0, side + 4, side, 20], label: 'Chain jump! Continue with the same piece.', gold: true, font: 12 });
  controls.push({ id: 'legend', kind: 'label', noDraw: true, r: [0, 0, 0, 0], label: 'Player 1 (moves down) · Player 2 (moves up)' });
  const liveRef = useRef({});
  liveRef.current = { cell, board, isMyTurn };
  usePointerCell(canvasRef, {
    onTap: (p) => {
      const lv = liveRef.current;
      const c = Math.floor(p.x / lv.cell), r = Math.floor(p.y / lv.cell);
      if (c < 0 || c > 7 || r < 0 || r > 7) return;
      if ((r + c) % 2 === 1) click(r * 8 + c);
    },
  });
  useCanvasBoard(canvasRef, {
    width: side,
    height: H,
    deps: [board, sel, cell, showNote],
    draw: (ctx) => {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < 64; i++) {
        const r = Math.floor(i / 8), c = i % 8;
        const dark = (r + c) % 2 === 1;
        const x = c * cell, y = r * cell;
        ctx.fillStyle = dark ? '#7a5a3a' : '#d8c49a'; // intrinsic checkers browns
        ctx.fillRect(x, y, cell, cell);
        if (sel === i) {
          ctx.lineWidth = 3;
          ctx.strokeStyle = PAL.gold;
          ctx.strokeRect(x + 1.5, y + 1.5, cell - 3, cell - 3);
        }
        const owner = ckOwnerOf(board[i]);
        if (owner !== 0) {
          ctx.beginPath();
          ctx.arc(x + cell / 2, y + cell / 2, cell * 0.37, 0, Math.PI * 2);
          ctx.fillStyle = owner === 1 ? palOf(C.accent, '#3A6ECD') : '#2b2f3d';
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = owner === 1 ? 'rgba(0,0,0,0.35)' : '#555';
          ctx.stroke();
          if (board[i] > 2) {
            ctx.font = `${Math.round(cell * 0.4)}px system-ui, sans-serif`;
            ctx.fillStyle = 'rgba(255,255,255,0.8)';
            ctx.fillText('\u265b', x + cell / 2, y + cell / 2 + 1);
          }
        }
      }
      ctx.lineWidth = 2;
      ctx.strokeStyle = PAL.border;
      ctx.strokeRect(1, 1, side - 2, side - 2);
      cuiDrawControls(ctx, controls, null);
      // Legend with drawn swatch dots.
      const ly = side + 4 + NOTE_H + 11;
      ctx.font = '500 11px ' + CUI_FONT;
      ctx.textBaseline = 'middle';
      const t1 = ' Player 1 (moves down)', t2 = ' Player 2 (moves up)';
      const w1 = ctx.measureText(t1).width, w2 = ctx.measureText(t2).width;
      let lx = Math.max(4, (side - (w1 + w2 + 40)) / 2);
      ctx.beginPath(); ctx.arc(lx + 6, ly, 6, 0, Math.PI * 2); ctx.fillStyle = palOf(C.accent, '#3A6ECD'); ctx.fill();
      ctx.fillStyle = PAL.muted; ctx.textAlign = 'left';
      ctx.fillText(t1, lx + 14, ly);
      lx += w1 + 34;
      ctx.beginPath(); ctx.arc(lx + 6, ly, 6, 0, Math.PI * 2); ctx.fillStyle = '#2b2f3d'; ctx.fill();
      ctx.strokeStyle = '#555'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = PAL.muted;
      ctx.fillText(t2, lx + 14, ly);
      ctx.textAlign = 'center';
    },
  });
  return (
    <BrgBoardBox boxRef={boxRef} canvasRef={canvasRef} className="ck-canvas" cap="360px"
      ariaLabel="Checkers board">
      <CuiTwin controls={controls} />
    </BrgBoardBox>
  );
}

// Reversi disc — the DOM disc's flat face + bottom inset shade, drawn.
function rvDrawDisc(ctx, cx, cy, r, side) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = side === 1 ? '#171a24' : '#f2f0e8';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = side === 1 ? '#444' : 'rgba(0,0,0,0.25)';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r - 1.5, Math.PI * 0.2, Math.PI * 0.8);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.stroke();
}

function ReversiBoardView({ st, myPlayerNum, isMyTurn, submit }) {
  const board = st.board || [];
  const p1 = board.filter(x => x === 1).length;
  const p2 = board.filter(x => x === 2).length;
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const { boxW } = useFitBox(boxRef, { cols: 1, rows: 1, maxCell: 100000 });
  const cell = Math.max(26, Math.min((boxW > 440) ? Infinity : 44, Math.floor((Math.floor(boxW) - 4 - 14) / 8)));
  const step = cell + 2;
  const side = step * 8 - 2 + 4; // 2px gutters between felt cells + 2px frame
  const NOTE_H = 24;
  const H = NOTE_H + 4 + side;
  const boardY = NOTE_H + 4;
  const controls = [
    { id: 'counts', kind: 'label', noDraw: true, r: [0, 0, 0, 0],
      label: `Dark ${p1} · Light ${p2}${st.passed ? ' · Opponent had no move — you go again.' : ''}` },
  ];
  const liveRef = useRef({});
  liveRef.current = { step, board, isMyTurn, boardY };
  usePointerCell(canvasRef, {
    onTap: (p) => {
      const lv = liveRef.current;
      const c = Math.floor((p.x - 2) / lv.step), r = Math.floor((p.y - lv.boardY - 2) / lv.step);
      if (c < 0 || c > 7 || r < 0 || r > 7) return;
      const i = r * 8 + c;
      if (lv.isMyTurn && lv.board[i] === 0) submit({ cell: i });
    },
  });
  useCanvasBoard(canvasRef, {
    width: side,
    height: H,
    deps: [board, cell, st.passed],
    draw: (ctx) => {
      // Counts band: two drawn discs + live totals (+ the pass note).
      ctx.textBaseline = 'middle';
      ctx.font = '600 12px ' + CUI_FONT;
      const passTxt = st.passed ? '   Opponent had no move — you go again.' : '';
      const t1 = ` ${p1}`, t2 = ` ${p2}`;
      const total = 16 + ctx.measureText(t1).width + 26 + 16 + ctx.measureText(t2).width + ctx.measureText(passTxt).width;
      let lx = Math.max(4, (side - total) / 2);
      const ly = NOTE_H / 2 + 2;
      rvDrawDisc(ctx, lx + 7, ly, 7, 1);
      ctx.fillStyle = PAL.text;
      ctx.textAlign = 'left';
      ctx.fillText(t1, lx + 16, ly);
      lx += 16 + ctx.measureText(t1).width + 26;
      rvDrawDisc(ctx, lx + 7, ly, 7, 2);
      ctx.fillStyle = PAL.text;
      ctx.fillText(t2, lx + 16, ly);
      if (passTxt) {
        ctx.fillStyle = PAL.gold;
        ctx.fillText(passTxt, lx + 16 + ctx.measureText(t2).width, ly);
      }
      ctx.textAlign = 'center';
      ctx.save();
      ctx.translate(0, boardY);
      klRR(ctx, 0, 0, side, side, 8);
      ctx.fillStyle = PAL.border; // the gutter grid shows through between cells
      ctx.fill();
      for (let i = 0; i < 64; i++) {
        const r = Math.floor(i / 8), c = i % 8;
        const x = 2 + c * step, y = 2 + r * step;
        ctx.fillStyle = '#1d5c3a'; // intrinsic Reversi felt
        ctx.fillRect(x, y, cell, cell);
        if (board[i] !== 0) rvDrawDisc(ctx, x + cell / 2, y + cell / 2, cell * 0.38, board[i]);
      }
      ctx.restore();
    },
  });
  return (
    <BrgBoardBox boxRef={boxRef} canvasRef={canvasRef} className="rv-canvas" cap="360px"
      ariaLabel={`Reversi board — ${p1} dark, ${p2} light`}>
      <CuiTwin controls={controls} />
    </BrgBoardBox>
  );
}

function FourInARowView({ st, myPlayerNum, isMyTurn, submit }) {
  const board = st.board || [];
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const { boxW } = useFitBox(boxRef, { cols: 1, rows: 1, maxCell: 100000 });
  const cell = Math.max(30, Math.min((boxW > 440) ? Infinity : 46, Math.floor((Math.floor(boxW) - 16 - 24) / 7)));
  const step = cell + 4;
  const W = step * 7 - 4 + 16, BH = step * 6 - 4 + 16;
  const LEG_H = 24;
  const H = BH + 4 + LEG_H;
  const controls = [
    { id: 'legend', kind: 'label', noDraw: true, r: [0, 0, 0, 0], label: 'Player 1 · Player 2 · Tap a column to drop' },
  ];
  const liveRef = useRef({});
  liveRef.current = { step, isMyTurn };
  usePointerCell(canvasRef, {
    // The whole column is the target — a drop game wants the fattest hit area.
    onTap: (p) => {
      const lv = liveRef.current;
      if (p.y > BH) return;
      const col = Math.floor((p.x - 8) / lv.step);
      if (col < 0 || col > 6 || !lv.isMyTurn) return;
      submit({ col });
    },
  });
  useCanvasBoard(canvasRef, {
    width: W,
    height: H,
    deps: [board, st.lastMove, cell],
    draw: (ctx) => {
      klRR(ctx, 0, 0, W, BH, 12);
      ctx.fillStyle = '#22335e'; // intrinsic Four-in-a-Row panel blue
      ctx.fill();
      for (let i = 0; i < 42; i++) {
        const r = Math.floor(i / 7), c = i % 7;
        const cx = 8 + c * step + cell / 2, cy = 8 + r * step + cell / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, cell / 2, 0, Math.PI * 2);
        ctx.fillStyle = PAL.bg; // the punched-hole look
        ctx.fill();
        const v = board[i];
        if (v !== 0) {
          ctx.beginPath();
          ctx.arc(cx, cy, cell * 0.43, 0, Math.PI * 2);
          ctx.fillStyle = v === 1 ? palOf(C.rose, '#CD4B3A') : palOf(C.gold, '#D9A54A');
          ctx.fill();
          ctx.beginPath();
          ctx.arc(cx, cy, cell * 0.43 - 1.5, Math.PI * 0.2, Math.PI * 0.8);
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(0,0,0,0.28)';
          ctx.stroke();
        }
        if (st.lastMove === i) {
          ctx.beginPath();
          ctx.arc(cx, cy, cell / 2 - 1, 0, Math.PI * 2);
          ctx.lineWidth = 2;
          ctx.strokeStyle = palOf(C.gold, '#D9A54A');
          ctx.stroke();
        }
      }
      // Legend band with drawn swatch discs.
      const ly = BH + 4 + LEG_H / 2;
      ctx.font = '500 11px ' + CUI_FONT;
      ctx.textBaseline = 'middle';
      const t1 = ' Player 1', t2 = ' Player 2', t3 = 'Tap a column to drop';
      const w1 = ctx.measureText(t1).width, w2 = ctx.measureText(t2).width, w3 = ctx.measureText(t3).width;
      let lx = Math.max(4, (W - (w1 + w2 + w3 + 72)) / 2);
      ctx.textAlign = 'left';
      ctx.beginPath(); ctx.arc(lx + 6, ly, 6, 0, Math.PI * 2); ctx.fillStyle = palOf(C.rose, '#CD4B3A'); ctx.fill();
      ctx.fillStyle = PAL.muted; ctx.fillText(t1, lx + 14, ly);
      lx += w1 + 32;
      ctx.beginPath(); ctx.arc(lx + 6, ly, 6, 0, Math.PI * 2); ctx.fillStyle = palOf(C.gold, '#D9A54A'); ctx.fill();
      ctx.fillStyle = PAL.muted; ctx.fillText(t2, lx + 14, ly);
      lx += w2 + 32;
      ctx.fillText(t3, lx, ly);
      ctx.textAlign = 'center';
    },
  });
  return (
    <BrgBoardBox boxRef={boxRef} canvasRef={canvasRef} className="fir-canvas" cap="340px"
      ariaLabel="Four in a Row board">
      <CuiTwin controls={controls} />
    </BrgBoardBox>
  );
}

/* PHASE 2 — Gomoku ghost-confirm.
   15x15 is ~24px per intersection — about a quarter of a fingertip — and the
   old single tap committed a PERMANENT stone. The first tap places a ghost;
   slide it, then confirm. The confirm bar draws in the same canvas now
   (controls wave); the move payload is unchanged. */
function GomokuBoardView({ st, myPlayerNum, isMyTurn, submit }) {
  const board = st.board || [];
  const [pending, setPending] = useState(null);

  // Never leave a ghost hanging over the opponent's turn or a filled cell.
  useEffect(() => {
    if (!isMyTurn || (pending != null && board[pending] !== 0)) setPending(null);
  }, [isMyTurn, st.lastMove]); // eslint-disable-line react-hooks/exhaustive-deps

  const place = () => {
    if (pending == null || !isMyTurn) return;
    submit({ cell: pending });
    setPending(null);
  };
  const pick = (i) => {
    if (!isMyTurn || board[i] !== 0) return;
    // Tapping the same intersection twice is a shortcut for Place.
    if (pending === i) { place(); return; }
    setPending(i);
  };

  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const { boxW } = useFitBox(boxRef, { cols: 1, rows: 1, maxCell: 100000 });
  const cell = Math.max(18, Math.min((boxW > 440) ? Infinity : 26, Math.floor((Math.floor(boxW) - 4 - 14) / 15)));
  const step = cell + 1;
  const side = step * 15 - 1 + 4;
  const BAR_H = isMyTurn ? 52 : 0;
  const H = side + (BAR_H ? 6 + BAR_H : 0);
  const rc = pending == null ? null : [Math.floor(pending / 15) + 1, (pending % 15) + 1];
  const controls = [];
  if (isMyTurn) {
    const br = cuiRow(2, side + 8, side - 4, 46, 2);
    controls.push({ id: 'cancel', kind: 'button', r: br[0], label: 'Cancel', disabled: pending == null, action: () => setPending(null) });
    controls.push({ id: 'place', kind: 'button', r: br[1], label: pending == null ? 'Tap a point' : `Place stone (row ${rc[0]}, col ${rc[1]})`, font: 13, solid: pending != null, disabled: pending == null, action: place });
  }
  const ctlRef = useRef([]);
  ctlRef.current = controls;
  const [pressedId, setPressedId] = useState(null);
  const liveRef = useRef({});
  liveRef.current = { step, pick };
  usePointerCell(canvasRef, cuiWrapHandlers(ctlRef, setPressedId, {
    onTap: (p) => {
      const lv = liveRef.current;
      if (p.y > side) return;
      const c = Math.floor((p.x - 2) / lv.step), r = Math.floor((p.y - 2) / lv.step);
      if (c < 0 || c > 14 || r < 0 || r > 14) return;
      lv.pick(r * 15 + c);
    },
  }));
  useCanvasBoard(canvasRef, {
    width: side,
    height: H,
    deps: [board, pending, st.lastMove, cell, isMyTurn, pressedId],
    draw: (ctx) => {
      cuiDrawControls(ctx, ctlRef.current, pressedId);
      klRR(ctx, 0, 0, side, side, 6);
      ctx.fillStyle = '#b08b4f'; // intrinsic goban wood
      ctx.fill();
      ctx.strokeStyle = PAL.border;
      ctx.lineWidth = 1;
      for (let i = 1; i < 15; i++) {
        const at = 2 + i * step - 0.5;
        ctx.beginPath(); ctx.moveTo(at, 2); ctx.lineTo(at, side - 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(2, at); ctx.lineTo(side - 2, at); ctx.stroke();
      }
      for (let i = 0; i < 225; i++) {
        const r = Math.floor(i / 15), c = i % 15;
        const x = 2 + c * step, y = 2 + r * step;
        const cx = x + cell / 2, cy = y + cell / 2;
        const v = board[i];
        if (v !== 0) {
          ctx.beginPath();
          ctx.arc(cx, cy, cell * 0.39, 0, Math.PI * 2);
          ctx.fillStyle = v === 1 ? '#171a24' : '#f2f0e8';
          ctx.fill();
          if (v === 2) { ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.stroke(); }
        } else if (pending === i) {
          ctx.beginPath();
          ctx.arc(cx, cy, cell * 0.31, 0, Math.PI * 2);
          ctx.setLineDash([4, 3]);
          ctx.lineWidth = 2;
          ctx.strokeStyle = palOf(C.gold, '#D9A54A');
          ctx.stroke();
          ctx.setLineDash([]);
        }
        if (st.lastMove === i) {
          ctx.lineWidth = 2;
          ctx.strokeStyle = palOf(C.gold, '#D9A54A');
          ctx.strokeRect(x + 1, y + 1, cell - 2, cell - 2);
        }
      }
    },
  });
  return (
    <BrgBoardBox boxRef={boxRef} canvasRef={canvasRef} className="gmk-canvas" cap="380px"
      ariaLabel="Gomoku board, 15 by 15">
      <CuiTwin controls={controls} />
    </BrgBoardBox>
  );
}

// Ludo board geometry — 15×15 grid mirror of the server module's relative
// track (lib/board-rules.js): 52-cell ring, per-player 6-cell home column,
// center home. [col,row] pairs; ring index 0 = P1 start, 26 = P2 start.
const LUDO_RING_XY = [
  [1,6],[2,6],[3,6],[4,6],[5,6], [6,5],[6,4],[6,3],[6,2],[6,1],[6,0], [7,0],[8,0],
  [8,1],[8,2],[8,3],[8,4],[8,5], [9,6],[10,6],[11,6],[12,6],[13,6],[14,6], [14,7],[14,8],
  [13,8],[12,8],[11,8],[10,8],[9,8], [8,9],[8,10],[8,11],[8,12],[8,13],[8,14], [7,14],[6,14],
  [6,13],[6,12],[6,11],[6,10],[6,9], [5,8],[4,8],[3,8],[2,8],[1,8],[0,8], [0,7],[0,6],
];
const LUDO_HOME_XY = {
  1: [[1,7],[2,7],[3,7],[4,7],[5,7],[6,7]],
  2: [[13,7],[12,7],[11,7],[10,7],[9,7],[8,7]],
  3: [[7,1],[7,2],[7,3],[7,4],[7,5],[7,6]],
  4: [[7,13],[7,12],[7,11],[7,10],[7,9],[7,8]],
};
const LUDO_BASE_XY = {
  1: [[2,2],[4,2],[2,4],[4,4]],
  2: [[10,10],[12,10],[10,12],[12,12]],
  3: [[10,2],[12,2],[10,4],[12,4]],
  4: [[2,10],[4,10],[2,12],[4,12]],
};
// Ring entry offsets — mirrors LUDO_START in lib/board-rules.js.
const LUDO_START_ABS = { 1: 0, 2: 26, 3: 13, 4: 39 };
const LUDO_SEAT_COLORS = { 1: C.accent, 2: C.rose, 3: C.gold, 4: GA.teal };

/* #217 — direct piece selection. Tokens used to be drawn at a fixed 5px
   down-right step per token INDEX, so a lone token sat off-centre and four
   tokens sharing a cell sat in a 5px diagonal smear that no finger can pick
   apart. They fan out around the centre of the cell they actually occupy
   instead: one token is dead centre at full size, and a stack spreads far
   enough that every member keeps at least the old 5px of separation while
   the whole group still fits inside its cell. The move pad stays — it is
   still the unambiguous path, and this is a second, bigger target, not a
   swap. */
const LUDO_TAP_SLOP = 8;    // matches the old DOM token's hit-slop
/* n -> [ring radius, token radius], both as fractions of a cell. Each pair
   sums to at most 0.5, so however many tokens share a cell the group still
   fits inside it; and the gap between two neighbours stays at least the old
   5px even at the smallest cell the board ever draws (18px). Past four the
   ring is only the 🏁 centre pile, which is never tappable. */
const LUDO_STACK = { 1: [0, 0.425], 2: [0.22, 0.28], 3: [0.225, 0.275], 4: [0.23, 0.27] };
const LUDO_STACK_MANY = [0.26, 0.24];

function ludoStackLayout(n, cell) {
  const [ringK, rK] = LUDO_STACK[n] || LUDO_STACK_MANY;
  const ring = cell * ringK;
  return {
    r: cell * rK,
    at: (j) => {
      if (n <= 1) return [0, 0];
      const a = (j / n) * Math.PI * 2 - Math.PI / 2;
      return [ring * Math.cos(a), ring * Math.sin(a)];
    },
  };
}

/* Nearest CENTRE wins, not the topmost of the draw order. With tokens a few
   pixels apart "topmost" is simply the highest token number, which is not
   what the finger aimed at; every candidate carries its own radius because a
   lone token is a bigger target than one in a stack. */
function ludoPickToken(cands, x, y) {
  let best = null, bestD = Infinity;
  for (const t of cands) {
    const dx = x - t.cx, dy = y - t.cy, d = dx * dx + dy * dy;
    const rr = t.r + LUDO_TAP_SLOP;
    if (d <= rr * rr && d < bestD) { bestD = d; best = t; }
  }
  return best;
}

/* The dice roll, drawn as a die rather than a digit, and tumbled rather than
   snapped. The VALUE is always the referee's — the tumble is only the wait
   made visible — so the face sequence here is deterministic (and checkable)
   and the real number replaces it the moment the roll has landed. */
const LUDO_PIPS = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};
const LUDO_TUMBLE = [3, 6, 2, 5, 1, 4];   // no two neighbours alike, incl. the wrap
const LUDO_ROLL_MS = 720;                 // tumble length once the player taps Roll
const LUDO_ROLL_SETTLE_MS = 180;          // ...and how long it keeps tumbling after
const LUDO_ROLL_TICK_MS = 70;             // the value actually arrives

function ludoDrawDie(ctx, x, y, size, face, spin) {
  ctx.save();
  ctx.translate(x + size / 2, y + size / 2);
  if (spin) ctx.rotate(spin);
  klRR(ctx, -size / 2, -size / 2, size, size, Math.round(size * 0.22));
  ctx.fillStyle = PAL.card;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = PAL.border;
  ctx.stroke();
  const pips = LUDO_PIPS[face];
  if (!pips) {
    ctx.fillStyle = PAL.muted;
    ctx.font = `${Math.round(size * 0.42)}px ` + CUI_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('\u2013', 0, 0);
    ctx.restore();
    return;
  }
  const off = size * 0.26, r = size * 0.088;
  ctx.fillStyle = PAL.text;
  for (const [px, py] of pips) {
    ctx.beginPath();
    ctx.arc(px * off, py * off, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* `?ludo=stack` seats a deterministic mid-game position: two of P1's tokens
   share one ring cell, one is a step behind, and the die is already rolled.
   Both halves of this issue are invisible on a fresh board — nothing is on
   the ring and nothing has been rolled — and a proposal check can navigate
   but cannot tap Roll, so without this link neither the fan-out nor the
   in-move chrome is reachable by a check or a screenshot. */
function ludoDemoState(which) {
  if (which !== 'stack') return null;
  const seats = { 1: [11, 11, 6, -1], 2: [-1, 3, 20, 33] };
  return {
    nPlayers: 2, seats, p1: seats[1], p2: seats[2], forfeited: [],
    currentPlayer: 1, phase: 'move', die: 3, lastEvent: null,
  };
}

function ludoTokenXY(player, pos, tokenIdx) {
  if (pos === -1) return LUDO_BASE_XY[player][tokenIdx];
  if (pos >= 51 && pos <= 56) return LUDO_HOME_XY[player][pos - 51];
  if (pos >= 57) return [7, 7];
  return LUDO_RING_XY[(LUDO_START_ABS[player] + pos) % 52];
}

// Seats map with legacy fallback: pre-multi-seat states carry only p1/p2.
function ludoSeatsOf(st) {
  if (st.seats) return { n: st.nPlayers || 2, seats: st.seats, forfeited: st.forfeited || [] };
  return { n: 2, seats: { 1: st.p1 || [], 2: st.p2 || [] }, forfeited: [] };
}

function LudoBoardView({ st, myPlayerNum, isMyTurn, submit }) {
  const phase = st.phase || 'roll';
  const { n: nPlayers, seats, forfeited } = ludoSeatsOf(st);
  const seatList = Array.from({ length: nPlayers }, (_, i) => i + 1);
  const canMoveToken = (pos) => {
    if (phase !== 'move' || !isMyTurn || st.die == null) return false;
    if (pos >= 57) return false;
    if (pos === -1) return st.die === 6;
    return pos + st.die <= 57;
  };
  // Tokens flattened in DRAW order (seat asc, token asc). Their pixel centres
  // are assigned below, once the cell size is known.
  const toks = [];
  for (const p of seatList) {
    const out = forfeited.includes(p);
    (seats[p] || []).forEach((pos, i) => {
      const [gx, gy] = ludoTokenXY(p, pos, i);
      toks.push({ p, i, pos, gx, gy, out, movable: p === myPlayerNum && !out && canMoveToken(pos) });
    });
  }

  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const { boxW } = useFitBox(boxRef, { cols: 1, rows: 1, maxCell: 100000 });
  const cell = Math.max(18, Math.min((boxW > 440) ? Infinity : 26, Math.floor((Math.floor(boxW) - 6 - 14) / 15)));
  const step = cell + 1;
  const PADI = 3;
  const side = step * 15 - 1 + PADI * 2;
  // Fan out whatever actually shares a cell — across seats, since a safe cell
  // and the 🏁 centre both hold tokens of more than one colour.
  const stacks = {};
  for (const t of toks) {
    const k = t.gx + ',' + t.gy;
    (stacks[k] || (stacks[k] = [])).push(t);
  }
  for (const k in stacks) {
    const grp = stacks[k];
    const lay = ludoStackLayout(grp.length, cell);
    grp.forEach((t, j) => {
      const [dx, dy] = lay.at(j);
      t.cx = PADI + t.gx * step + cell / 2 + dx;
      t.cy = PADI + t.gy * step + cell / 2 + dy;
      t.r = lay.r;
    });
  }

  // The move pad (the unambiguous full-size path for stacked tokens), the
  // die, the roll button, the event notes and the legend all draw in-frame.
  const myTokens = (seats[myPlayerNum] || []);
  const movableList = phase === 'move' && isMyTurn && st.die != null
    ? myTokens.map((pos, i) => ({ i, pos })).filter(t => canMoveToken(t.pos))
    : [];
  const describe = (pos) => {
    if (pos === -1) return 'in base — a 6 brings it out';
    if (pos >= 51) return `home column, ${57 - pos} to finish`;
    const dest = pos + st.die;
    return `step ${pos} → ${dest >= 51 ? 'home column' : dest}`;
  };
  /* The tumble. It starts on the tap (so there is no dead beat while an
     online roll is in flight) and ends a short settle AFTER the real value
     lands, whenever that is — `until` only ever moves forward, so a local
     roll, which resolves in the same tick, still spins for its full length
     rather than twice over. */
  const [tumble, setTumble] = useState(0);
  const spinRef = useRef({ until: 0, timer: null });
  const spinFor = (ms) => {
    if (cgReducedMotion()) return;
    const sp = spinRef.current;
    sp.until = Math.max(sp.until, Date.now() + ms);
    if (sp.timer) return;
    setTumble(1);
    sp.timer = setInterval(() => {
      if (Date.now() >= spinRef.current.until) {
        clearInterval(spinRef.current.timer);
        spinRef.current.timer = null;
        setTumble(0);
        return;
      }
      setTumble(t => t + 1);
    }, LUDO_ROLL_TICK_MS);
  };
  useEffect(() => () => { if (spinRef.current.timer) clearInterval(spinRef.current.timer); }, []);
  // An opponent's roll arrives as a state change with no tap of ours behind it.
  const lastDie = useRef(st.die);
  useEffect(() => {
    const prev = lastDie.current;
    lastDie.current = st.die;
    if (st.die != null && st.die !== prev) spinFor(LUDO_ROLL_SETTLE_MS);
  }, [st.die]); // eslint-disable-line react-hooks/exhaustive-deps
  const dieFace = tumble ? LUDO_TUMBLE[tumble % LUDO_TUMBLE.length] : st.die;

  const notes = [];
  if (st.lastEvent === 'no-move') notes.push('No legal move for that roll — turn passed.');
  if (st.lastEvent === 'capture') notes.push('💥 Capture! Token sent back to base.');
  if (forfeited.length > 0) notes.push(`${forfeited.map(p => 'P' + p).join(', ')} forfeited — the match continues.`);
  if (nPlayers > 2 && !isMyTurn) notes.push(`Waiting on P${st.currentPlayer || 1}…`);

  const HINT_H = movableList.length ? 16 : 0;
  const MOVE_H = movableList.length ? 18 + movableList.length * 50 : 0;
  const ROLL_H = 54;
  const NOTES_H = notes.length * 18;
  const LEG_H = 18;
  const H = side + (HINT_H ? 4 + HINT_H : 0) + (MOVE_H ? 6 + MOVE_H : 0) + 6 + ROLL_H
    + (NOTES_H ? 4 + NOTES_H : 0) + 4 + LEG_H;
  let by = side + 4;
  const hintY = by; if (HINT_H) by += HINT_H + 6;
  const moveY = by; if (MOVE_H) by += MOVE_H + 6;
  const rollY = by; by += ROLL_H + 4;
  const notesY = by; if (NOTES_H) by += NOTES_H + 4;
  const legY = by;

  const controls = [];
  if (movableList.length) {
    // Say the board is tappable. It always was, technically, but nothing on
    // screen said so and the tokens were too small to invite the attempt.
    controls.push({
      id: 'ml-hint', kind: 'label', r: [0, hintY, side, HINT_H], gold: true, font: 11,
      label: 'Tap a glowing token to move it',
    });
    controls.push({ id: 'ml-label', kind: 'label', r: [0, moveY, side, 16], label: `OR PICK ONE HERE · ROLLED ${st.die}`, font: 10 });
    movableList.forEach((t, k) => {
      controls.push({
        id: 'mv' + t.i, kind: 'button',
        r: [Math.floor(side * 0.05), moveY + 18 + k * 50, Math.floor(side * 0.9), 46],
        label: `Token ${t.i + 1}`, sub: describe(t.pos),
        action: () => submit({ type: 'move', token: t.i }),
      });
    });
  }
  const dieX = Math.floor(side / 2) - 24;
  controls.push({
    id: 'die', kind: 'label', noDraw: true, r: [dieX, rollY, 48, 48],
    label: tumble ? 'Rolling…' : st.die == null ? 'Die: not rolled yet' : `Die: ${st.die}`,
  });
  const rollW = Math.floor(side * 0.34);
  controls.push({
    id: 'roll', kind: 'button', r: [side - rollW - 4, rollY + 4, rollW, 44],
    label: !isMyTurn ? 'Waiting…' : phase === 'roll' ? 'Roll' : 'Pick a token',
    font: 13, solid: isMyTurn && phase === 'roll',
    bg: isMyTurn && phase === 'roll' ? palOf(LUDO_SEAT_COLORS[myPlayerNum] || C.accent, '#3A6ECD') : undefined,
    ink: isMyTurn && phase === 'roll' ? '#fff' : undefined,
    disabled: !isMyTurn || phase !== 'roll',
    action: () => { spinFor(LUDO_ROLL_MS); submit({ type: 'roll' }); },
  });
  notes.forEach((n, k) => controls.push({ id: 'note' + k, kind: 'label', r: [0, notesY + k * 18, side, 18], label: n, gold: true, font: 11.5 }));
  controls.push({ id: 'legend', kind: 'label', r: [0, legY, side, 16], label: '🎲 6 leaves base & rolls again · ★ safe cells · Exact roll to finish', font: 10.5 });

  const ctlRef = useRef([]);
  ctlRef.current = controls;
  const [pressedId, setPressedId] = useState(null);
  const liveRef = useRef({});
  liveRef.current = { toks, side };
  usePointerCell(canvasRef, cuiWrapHandlers(ctlRef, setPressedId, {
    onTap: (pt) => {
      const lv = liveRef.current;
      if (pt.y > lv.side) return;
      const hit = ludoPickToken(lv.toks.filter(t => t.movable), pt.x, pt.y);
      if (hit) submit({ type: 'move', token: hit.i });
    },
  }));
  useCanvasBoard(canvasRef, {
    width: side,
    height: H,
    deps: [st, cell, myPlayerNum, nPlayers, pressedId, isMyTurn, tumble],
    draw: (ctx) => {
      cuiDrawControls(ctx, ctlRef.current, pressedId);
      klRR(ctx, 0, 0, side, side, 10);
      ctx.fillStyle = PAL.surface;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = PAL.border;
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const seatColor = (p) => palOf(LUDO_SEAT_COLORS[p], '#888');
      const cellRect = (gx, gy) => [PADI + gx * step, PADI + gy * step];
      // Ring — a start cell is safe (and tinted) only for seats actually playing.
      LUDO_RING_XY.forEach(([gx, gy], i) => {
        const [x, y] = cellRect(gx, gy);
        const startOwner = seatList.find(p => LUDO_START_ABS[p] === i) || 0;
        const safe = i === 0 || i === 13 || i === 26 || i === 39;
        klRR(ctx, x, y, cell, cell, 3);
        ctx.fillStyle = PAL.card;
        ctx.fill();
        if (startOwner) {
          ctx.save();
          ctx.globalAlpha = 0.2;
          ctx.fillStyle = seatColor(startOwner);
          ctx.fill();
          ctx.restore();
        }
        ctx.lineWidth = 1;
        ctx.strokeStyle = startOwner ? seatColor(startOwner) : PAL.border;
        ctx.stroke();
        if (safe) {
          ctx.font = `${Math.round(cell * 0.5)}px system-ui, sans-serif`;
          ctx.fillStyle = palOf(C.gold, '#D9A54A');
          ctx.fillText('★', x + cell / 2, y + cell / 2 + 0.5);
        }
      });
      // Home columns + bases (only for seats in this match)
      for (const p of seatList) {
        const col = seatColor(p);
        for (const [gx, gy] of LUDO_HOME_XY[p]) {
          const [x, y] = cellRect(gx, gy);
          klRR(ctx, x, y, cell, cell, 3);
          ctx.save();
          ctx.globalAlpha = 0.13;
          ctx.fillStyle = col;
          ctx.fill();
          ctx.globalAlpha = 0.4;
          ctx.setLineDash([3, 2]);
          ctx.lineWidth = 1;
          ctx.strokeStyle = col;
          ctx.stroke();
          ctx.restore();
        }
        for (const [gx, gy] of LUDO_BASE_XY[p]) {
          const [x, y] = cellRect(gx, gy);
          ctx.beginPath();
          ctx.arc(x + cell / 2, y + cell / 2, cell / 2 - 0.5, 0, Math.PI * 2);
          ctx.save();
          ctx.globalAlpha = 0.1;
          ctx.fillStyle = col;
          ctx.fill();
          ctx.globalAlpha = 0.35;
          ctx.lineWidth = 1;
          ctx.strokeStyle = col;
          ctx.stroke();
          ctx.restore();
        }
      }
      { // center 🏁
        const [x, y] = cellRect(7, 7);
        klRR(ctx, x, y, cell, cell, 3);
        ctx.save();
        ctx.globalAlpha = 0.13;
        ctx.fillStyle = palOf(C.gold, '#D9A54A');
        ctx.fill();
        ctx.restore();
        ctx.lineWidth = 1;
        ctx.strokeStyle = palOf(C.gold, '#D9A54A');
        ctx.stroke();
        ctx.font = `${Math.round(cell * 0.7)}px system-ui, sans-serif`;
        ctx.fillText('🏁', x + cell / 2, y + cell / 2 + 0.5);
      }
      // Tokens — a movable one draws LAST so its gold ring is never clipped
      // by a neighbour sharing the same cell (sort is stable, so the seat
      // order within each group is untouched).
      for (const t of toks.slice().sort((a, b) => (a.movable ? 1 : 0) - (b.movable ? 1 : 0))) {
        const cx = t.cx, cy = t.cy, r = t.r;
        ctx.save();
        if (t.out) ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = seatColor(t.p);
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.stroke();
        if (t.movable) {
          ctx.beginPath();
          ctx.arc(cx, cy, r + 1.5, 0, Math.PI * 2);
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = palOf(C.gold, '#D9A54A');
          ctx.shadowColor = palOf(C.gold, '#D9A54A');
          ctx.shadowBlur = 6;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
        ctx.font = `700 ${Math.max(7, Math.round(r * 0.98))}px system-ui, sans-serif`;
        ctx.fillStyle = '#fff';
        ctx.fillText(String(t.i + 1), cx, cy + 0.5);
        ctx.restore();
      }
      // The die, drawn last so its tumble repaints over nothing else.
      ludoDrawDie(ctx, dieX, rollY, 48, dieFace, tumble ? (tumble % 4) * 0.13 - 0.2 : 0);
    },
  });

  return (
    <BrgBoardBox boxRef={boxRef} canvasRef={canvasRef} className="ludo-canvas" cap="380px"
      ariaLabel={`Ludo board, ${nPlayers} players`}>
      <CuiTwin controls={controls} />
    </BrgBoardBox>
  );
}

const BOARD_VIEWS = {
  checkers: CheckersBoardView,
  reversi: ReversiBoardView,
  fourinarow: FourInARowView,
  gomoku: GomokuBoardView,
  ludo: LudoBoardView,
};

// Polling room shell shared by all five board games (mirrors the Chutes &
// Ladders online flow: waiting screen → status bar → board → finish → onWin).
function BoardOnlineRoom({ gameId, roomId, myPlayerNum, onWin, onStepChange }) {
  const { room, pollingError, opponentDisconnected, submitMove } = useClassicRoom(gameId, roomId);
  const winCalledRef = useRef(false);
  // #145 — concede / close. Declared up here so both the waiting-room branch and
  // the live-match branch below can reach it (they return early).
  const [ending, setEnding] = useState(false);
  const endGame = async (isWaitingRoom) => {
    const other = myPlayerNum === 1 ? 2 : 1;
    const msg = isWaitingRoom
      ? 'Close this room? Nobody has joined yet, so nothing is rated.'
      : 'End this game? Your opponent wins and it counts on the Rating Ladder.';
    if (window.unNative && window.unNative.alert) {
      const r = await window.unNative.alert({
        title: isWaitingRoom ? 'Close room' : 'End game',
        message: msg,
        buttons: [
          { label: 'Cancel', style: 'cancel' },
          { label: isWaitingRoom ? 'Close' : 'End game', style: 'destructive' },
        ],
      });
      if (!r || !r.button || r.button.style !== 'destructive') return;
    } else if (!window.confirm(msg)) {
      return;
    }
    setEnding(true);
    // A waiting room has no winner to declare; a concede hands it to the other
    // seat. The server ignores `winner` unless it makes the transition.
    await api(`/api/classic/${gameId}/rooms/${roomId}/finish`, {
      method: 'POST',
      body: JSON.stringify(isWaitingRoom ? {} : { winner: String(other) }),
    });
    setEnding(false);
  };
  /* #145 gave a live match a way out — before it, the only exit was to abandon
     the match and let the 48h turn timer settle it. It concedes through the
     existing guarded forfeit endpoint, which rates the match exactly once on
     the active→finished transition and is idempotent.

     #201 moved WHERE it is offered. It was a rose-outlined button eleven pixels
     under the board, directly beneath cells the player taps; it is published
     into the ☰ sheet's "This match" group now (see useCgShellAction). Passing
     null while the room is not active withdraws it, so a finished match stops
     offering to forfeit itself. */
  useCgShellAction(room && room.status === 'active' ? {
    id: 'endgame', danger: true, disabled: ending,
    label: ending ? 'Ending…' : '🏳️ End game',
    onSelect: () => endGame(false),
  } : null);
  const { secs, fmt } = useTimer(!!(room && room.status === 'active'));
  const secsRef = useRef(0); secsRef.current = secs;
  const movesRef = useRef(0);

  useEffect(() => {
    if (!room || room.status !== 'finished' || winCalledRef.current) return;
    winCalledRef.current = true;
    const name = (GAMES.find(g => g.id === gameId) || {}).name || gameId;
    const draw = room.winner === 'draw';
    const youWin = room.winner === String(myPlayerNum);
    const multi = (room.maxPlayers || 2) > 2;
    onWin(youWin ? 200 : 0, movesRef.current, secsRef.current, {
      winnerLabel: draw ? "It's a draw 🤝" : youWin ? 'You win! 🎉' : (multi ? `Player ${room.winner} wins` : 'Opponent wins'),
      share: `♟️ ${name} online — ${draw ? 'we drew!' : youWin ? 'I won!' : 'good game!'}`,
    });
  }, [room && room.status]);

  if (!room && !pollingError) {
    return <div style={{ textAlign: 'center', padding: '2rem' }}><div className="mnc-spinner" style={{ margin: '0 auto 0.75rem' }} /><div style={{ color: C.muted, fontSize: '0.85rem' }}>Connecting…</div></div>;
  }
  if (pollingError === 'room_not_found') {
    return <div style={{ textAlign: 'center', padding: '1.5rem', color: C.rose }}>Room not found.</div>;
  }
  if (room && room.status === 'waiting') {
    const maxP = room.maxPlayers || 2;
    return (
      <div style={{ textAlign: 'center', padding: '1rem 0' }}>
        <div style={{ color: C.muted, marginBottom: '0.6rem', fontSize: '0.85rem' }}>
          {maxP > 2
            ? `Waiting for players — ${room.seatsFilled || 1}/${maxP} joined…`
            : 'Waiting for opponent to join…'}
        </div>
        <div className="mnc-room-code">{roomId}</div>
        <div style={{ color: C.muted, fontSize: '0.78rem', marginTop: '0.4rem' }}>Share this room code</div>
        <div className="mnc-spinner" style={{ margin: '1rem auto 0' }} />
      </div>
    );
  }

  const st = room.state || {};
  const isMyTurn = room.status === 'active' && (st.currentPlayer || 1) === myPlayerNum;
  const seatColors = { 1: C.accent, 2: C.rose, 3: C.gold, 4: GA.teal };
  const myColor = seatColors[myPlayerNum] || C.accent;
  const multiSeat = (room.maxPlayers || 2) > 2;
  const turnLabel = room.status === 'finished'
    ? (room.winner === 'draw' ? 'Draw' : room.winner === String(myPlayerNum) ? 'You win! 🎉' : (multiSeat ? `P${room.winner} wins` : 'Opponent wins'))
    : isMyTurn ? 'Your turn' : (multiSeat ? `P${st.currentPlayer || 1}'s turn` : "Opponent's turn");
  const View = BOARD_VIEWS[gameId];
  const submit = (move) => {
    movesRef.current += 1;
    onStepChange && onStepChange(movesRef.current);
    submitMove({ move });
  };

  return (
    <div>
      <CuiBar height={opponentDisconnected ? 68 : 46} build={(W) => {
        const pr = cuiRow(0, 0, W, 46, 4);
        const out = [
          { id: 'p-time', kind: 'pill', r: pr[0], label: 'Time', value: fmt, gold: true },
          { id: 'p-turn', kind: 'pill', r: pr[1], label: 'Turn', value: turnLabel, color: isMyTurn ? palOf(myColor, undefined) : PAL.muted },
          { id: 'p-you', kind: 'pill', r: pr[2], label: 'You', value: 'P' + myPlayerNum, color: palOf(myColor, undefined) },
          { id: 'p-conn', kind: 'pill', r: pr[3], label: 'Online', value: '●', color: opponentDisconnected ? PAL.gold : PAL.emerald },
        ];
        if (opponentDisconnected) out.push({ id: 'disc', kind: 'label', r: [0, 50, W, 18], label: 'Opponent connection lost — waiting for reconnect…', gold: true, font: 12 });
        return out;
      }} />
      {room.status === 'active' && (() => {
        // Correspondence turn timer: the server auto-forfeits the side to move
        // after turnTimeoutHours without a move — surface the remaining window.
        const expH = roomExpiresInHours(room);
        return expH != null ? (
          <div style={{ textAlign: 'center', color: expH <= 6 ? C.rose : C.muted, fontSize: '0.78rem', marginBottom: '0.5rem' }}>
            ⏱ {isMyTurn ? 'Your move' : 'Their move'} · expires in {expH}h
          </div>
        ) : null;
      })()}
      <View st={st} myPlayerNum={myPlayerNum} isMyTurn={isMyTurn} submit={submit} />
    </div>
  );
}

// Top-level component per board game: create/join setup, then the room.
/* ============================================================
   PHASE 7 (#144) — local pass-and-play + Versus Bot for the five board games.

   These were online-only, so if nobody joined you couldn't play at all. The
   rules come from window.boardRules — the SAME pure module server.js referees
   with (served at /board-rules.js, see its footer) — so an offline game and an
   online game can never disagree about a legal move.

   Unrated by construction: applyMatchRating only ever runs in the four server
   finish paths, and these modes never call the server. We also skip
   submitClassicScore so the all-time board stays comparable.
   ============================================================ */

// A bot is a pure function (state, player) -> move | null. One strength per
// game; difficulty tiers are deferred. Each is deliberately beatable.
/* #176 — bot difficulty tiers.
   Search DEPTH was always a plain argument to boardNegamax, so wiring a
   selector to it is trivial. What is NOT trivial, and is the actual work here:
   SHALLOW IS NOT EASY. A depth-1 Four in a Row bot still blocks every
   immediate threat and still wins the centre — to a beginner it is
   indistinguishable from the depth-4 one. A believable easy tier needs a
   deliberate BLUNDER RATE: some fraction of the time it plays a legal move
   that is not the best one it found.

   Mancala already shipped Easy/Medium/Hard (it is the only bot in the app that
   did), so its selector is the UI pattern the five others copy. */
const BOARD_BOT_LEVELS = [
  { id: 'easy',   label: 'Easy',   depthDelta: -2, blunder: 0.45 },
  { id: 'medium', label: 'Medium', depthDelta: -1, blunder: 0.15 },
  { id: 'hard',   label: 'Hard',   depthDelta: 0,  blunder: 0 },
];
const boardBotLevel = (id) => BOARD_BOT_LEVELS.find(l => l.id === id) || BOARD_BOT_LEVELS[2];

/* Wrap a bot so it sometimes plays a legal-but-not-best move.
   Candidates come from the SAME move generators the search uses, and each one
   is then validated against the real rules module by calling applyMove and
   catching its throw — so a blundering bot can only ever play badly, never
   illegally. A game with no generator here (Reversi's weighted bot, Ludo's
   dice) simply keeps its pick and gets its difficulty from depth alone. */
const BOARD_BOT_MOVES = {
  fourinarow: (state) => firMoves(state),
  gomoku: (state) => gmkMoves(state),
  checkers: (state, me) => ckMoves(state, me),
  reversi: (state) => (state.board || []).map((_, i) => ({ cell: i })),
};
function boardBlunder(gameId, rules, state, me, best, rate) {
  if (!rate || Math.random() >= rate) return best;
  const gen = BOARD_BOT_MOVES[gameId];
  if (!gen) return best;
  let candidates = [];
  try { candidates = gen(state, me) || []; } catch (e) { return best; }
  const legal = candidates.filter((mv) => {
    try { rules.applyMove(state, me, mv); return true; } catch (e) { return false; }
  });
  if (legal.length < 2) return best;   // no alternative to blunder into
  return legal[Math.floor(Math.random() * legal.length)];
}

const BOARD_BOTS = {
  // Reversi: positional weights (corners high, X-squares poisonous) with a
  // 1-ply lookahead over the flip count.
  reversi: (rules, state, me) => {
    const W = [
      120, -20, 20, 5, 5, 20, -20, 120,
      -20, -40, -5, -5, -5, -5, -40, -20,
      20, -5, 15, 3, 3, 15, -5, 20,
      5, -5, 3, 3, 3, 3, -5, 5,
      5, -5, 3, 3, 3, 3, -5, 5,
      20, -5, 15, 3, 3, 15, -5, 20,
      -20, -40, -5, -5, -5, -5, -40, -20,
      120, -20, 20, 5, 5, 20, -20, 120,
    ];
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < 64; i++) {
      if ((state.board || [])[i] !== 0) continue;
      let r;
      try { r = rules.applyMove(state, me, { cell: i }); } catch { continue; }
      const mine = (r.state.board || []).filter(x => x === me).length;
      const sc = W[i] + mine * 2;
      if (sc > bestScore) { bestScore = sc; best = { cell: i }; }
    }
    return best;
  },

  // Four in a Row: shallow negamax over a threat heuristic.
  fourinarow: (rules, state, me, lvl) => boardNegamax(rules, state, me, Math.max(1, 4 + boardBotLevel(lvl).depthDelta), firScore, firMoves),

  // Gomoku: the same search, shallower (15x15 branching is 225 wide) with a
  // candidate filter to cells near existing stones.
  gomoku: (rules, state, me, lvl) => boardNegamax(rules, state, me, Math.max(1, 2 + boardBotLevel(lvl).depthDelta), gmkScore, gmkMoves),

  // Checkers: negamax over material + kings + advancement.
  checkers: (rules, state, me, lvl) => boardNegamax(rules, state, me, Math.max(1, 3 + boardBotLevel(lvl).depthDelta), ckScore, ckMoves),

  // Ludo: pure move ordering — capture > finish > leave base > advance leader.
  // (No search: the dice make deep lookahead worthless.)
  ludo: (rules, state, me) => {
    if ((state.phase || 'roll') === 'roll') return { type: 'roll' };
    const toks = (state['p' + me] || (state.seats && state.seats[me]) || []);
    const die = state.die;
    if (die == null) return { type: 'roll' };
    const cand = [];
    for (let i = 0; i < toks.length; i++) {
      const pos = toks[i];
      if (pos >= 57) continue;
      if (pos === -1) { if (die === 6) cand.push({ i, rank: 3 }); continue; }
      if (pos + die > 57) continue;
      const dest = pos + die;
      let rank = 1 + dest / 100;             // advance the leader, gently
      if (dest === 57) rank = 5;             // finish a token
      else if (dest >= 51) rank = 4;         // reach the home column
      cand.push({ i, rank });
    }
    if (!cand.length) return null;
    cand.sort((a, b) => b.rank - a.rank);
    return { type: 'move', token: cand[0].i };
  },
};

// ---- Bot search plumbing (pure; no DOM, no rules duplication) --------------
// Every candidate move is validated by calling the REAL applyMove and catching
// its throw, so a bot can never make a move the referee would reject.
function boardNegamax(rules, state, me, depth, evalFn, movesFn) {
  const other = me === 1 ? 2 : 1;
  let best = null, bestScore = -Infinity;
  for (const mv of movesFn(state, me)) {
    let r;
    try { r = rules.applyMove(state, me, mv); } catch { continue; }
    let sc;
    if (r.gameOver) sc = r.winner === String(me) ? 1e6 : r.winner === 'draw' ? 0 : -1e6;
    else if (depth <= 1) sc = evalFn(r.state, me);
    else sc = -negaValue(rules, r.state, other, me, depth - 1, -Infinity, Infinity, evalFn, movesFn);
    if (sc > bestScore) { bestScore = sc; best = mv; }
  }
  return best;
}

function negaValue(rules, state, turn, me, depth, alpha, beta, evalFn, movesFn) {
  if (depth <= 0) return turn === me ? evalFn(state, me) : -evalFn(state, me);
  const other = turn === 1 ? 2 : 1;
  let best = -Infinity, any = false;
  for (const mv of movesFn(state, turn)) {
    let r;
    try { r = rules.applyMove(state, turn, mv); } catch { continue; }
    any = true;
    let sc;
    if (r.gameOver) sc = r.winner === String(turn) ? 1e6 : r.winner === 'draw' ? 0 : -1e6;
    else sc = -negaValue(rules, r.state, other, me, depth - 1, -beta, -alpha, evalFn, movesFn);
    if (sc > best) best = sc;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  if (!any) return turn === me ? evalFn(state, me) : -evalFn(state, me);
  return best;
}

const firMoves = (state) => {
  const out = [];
  for (let c = 0; c < 7; c++) if ((state.board || [])[c] === 0) out.push({ col: c });
  return out;
};
// Count open 2s/3s for both sides; prefer the centre column.
function firScore(state, me) {
  const b = state.board || [];
  const other = me === 1 ? 2 : 1;
  let s = 0;
  const lines = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) {
    for (const [dr, dc] of lines) {
      let mine = 0, theirs = 0, ok = true;
      for (let k = 0; k < 4; k++) {
        const rr = r + dr * k, cc = c + dc * k;
        if (rr < 0 || rr >= 6 || cc < 0 || cc >= 7) { ok = false; break; }
        const v = b[rr * 7 + cc];
        if (v === me) mine++; else if (v === other) theirs++;
      }
      if (!ok) continue;
      if (mine && !theirs) s += mine * mine;
      if (theirs && !mine) s -= theirs * theirs * 1.2; // slightly defensive
    }
    if (c === 3 && b[r * 7 + 3] === me) s += 3;
  }
  return s;
}

// Only intersections adjacent to an existing stone — 225-wide branching is
// otherwise hopeless, and an isolated stone is never the best Gomoku move.
const gmkMoves = (state) => {
  const b = state.board || [];
  const out = [];
  const has = b.some(v => v !== 0);
  if (!has) return [{ cell: 7 * 15 + 7 }]; // centre opening
  for (let i = 0; i < 225; i++) {
    if (b[i] !== 0) continue;
    const r = Math.floor(i / 15), c = i % 15;
    let near = false;
    for (let dr = -2; dr <= 2 && !near; dr++) for (let dc = -2; dc <= 2; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= 15 || cc < 0 || cc >= 15) continue;
      if (b[rr * 15 + cc] !== 0) { near = true; break; }
    }
    if (near) out.push({ cell: i });
  }
  return out.slice(0, 40);
};
function gmkScore(state, me) {
  const b = state.board || [];
  const other = me === 1 ? 2 : 1;
  let s = 0;
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) {
    for (const [dr, dc] of dirs) {
      let mine = 0, theirs = 0, ok = true;
      for (let k = 0; k < 5; k++) {
        const rr = r + dr * k, cc = c + dc * k;
        if (rr < 0 || rr >= 15 || cc < 0 || cc >= 15) { ok = false; break; }
        const v = b[rr * 15 + cc];
        if (v === me) mine++; else if (v === other) theirs++;
      }
      if (!ok) continue;
      if (mine && !theirs) s += Math.pow(mine, 3);
      if (theirs && !mine) s -= Math.pow(theirs, 3) * 1.3;
    }
  }
  return s;
}

const ckMoves = (state, player) => {
  const b = state.board || [];
  const out = [];
  // Enumerate from-squares owned by `player`; applyMove validates the rest, so
  // this only has to be a superset of the legal moves.
  const from = state.mustJumpFrom != null ? [state.mustJumpFrom] : b.map((_, i) => i);
  for (const f of from) {
    const v = b[f];
    if (v === 0) continue;
    const owner = v === 1 || v === 3 ? 1 : 2;
    if (owner !== player) continue;
    const r = Math.floor(f / 8), c = f % 8;
    for (const dr of [-2, -1, 1, 2]) for (const dc of [-2, -1, 1, 2]) {
      if (Math.abs(dr) !== Math.abs(dc)) continue;
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= 8 || cc < 0 || cc >= 8) continue;
      const t = rr * 8 + cc;
      if (b[t] !== 0) continue;
      out.push({ from: f, to: t });
    }
  }
  return out;
};
function ckScore(state, me) {
  const b = state.board || [];
  let s = 0;
  for (let i = 0; i < 64; i++) {
    const v = b[i];
    if (!v) continue;
    const owner = v === 1 || v === 3 ? 1 : 2;
    const king = v > 2;
    const row = Math.floor(i / 8);
    // Advancement: player 1 moves down the board, player 2 up.
    const adv = owner === 1 ? row : 7 - row;
    const val = (king ? 20 : 10) + adv * 0.6;
    s += owner === me ? val : -val;
  }
  return s;
}

function BoardLocalGame({ gameId, vsBot, onWin, onStepChange, resetKey, seats, botLevel }) {
  const rules = (window.boardRules && window.boardRules.getRules)
    ? window.boardRules.getRules(gameId) : null;
  /* #176 — local play was 2-seat ONLY because this called initialState() with
     no argument. The ludo rules module has always been seat-generic
     (`initialState(nPlayers = 2)`, `maxPlayers: 4`) and online has always
     offered 2–4, so local was the odd one out for no reason but a missing
     parameter. Games whose rules take no argument ignore it. */
  const nSeats = Math.min(rules && rules.maxPlayers ? rules.maxPlayers : 2,
                          Math.max(2, Number(seats) || 2));
  // A seeded opening position, for the deep links that have to reach a
  // mid-game board (see ludoDemoState). Consumed once, on mount.
  const demoRef = useRef(gameId === 'ludo'
    ? ludoDemoState(new URLSearchParams(window.location.search).get('ludo'))
    : null);
  const [state, setState] = useState(() => demoRef.current || (rules ? rules.initialState(nSeats) : null));
  const [over, setOver] = useState(null); // { winner }
  const [err, setErr] = useState('');
  const [thinking, setThinking] = useState(false);
  const [moves, setMoves] = useState(0);
  const submittedRef = useRef(false);
  const onWinRef = useRef(onWin); onWinRef.current = onWin;

  useEffect(() => {
    if (!rules) return;
    // The mount pass would otherwise clobber a seeded position immediately —
    // the same trap SnakeGame's reset-to-chooser effect had to skip.
    if (demoRef.current) { demoRef.current = null; return; }
    setState(rules.initialState(nSeats));
    setOver(null); setErr(''); setMoves(0); setThinking(false);
    submittedRef.current = false;
  }, [resetKey, gameId, nSeats]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!rules) {
    return (
      <div className="brg-intro">
        Offline play needs the rules module, which didn't load. Try reloading, or
        use <strong>Online</strong> mode.
      </div>
    );
  }

  const finish = (winner) => {
    setOver({ winner });
    if (submittedRef.current) return;
    submittedRef.current = true;
    const label = winner === 'draw' ? 'Draw'
      : vsBot ? (String(winner) === '1' ? 'You win! 🎉' : 'Bot wins')
      : `Player ${winner} wins! 🎉`;
    // Unrated and unscored on purpose — a local result must not sit on the same
    // board as online matches (and the ladder is server-side only anyway).
    onWinRef.current && onWinRef.current(0, moves, 0, { winnerLabel: label, localOnly: true });
  };

  const apply = (player, move) => {
    let r;
    try {
      r = rules.applyMove(state, player, move);
    } catch (e) {
      // The referee's own message — never a second copy of the rules.
      setErr(e && e.message ? e.message : 'Illegal move');
      setTimeout(() => setErr(''), 2200);
      return null;
    }
    setErr('');
    setState(r.state);
    setMoves(m => { const n = m + 1; onStepChange && onStepChange(n); return n; });
    if (r.gameOver) finish(r.winner);
    return r;
  };

  // Bot turn. Sliced through setTimeout so a deep search never blocks paint,
  // and re-checked against the CURRENT state so a fast human tap can't race it.
  const botPlayer = 2;
  useEffect(() => {
    if (!vsBot || over || !state) return;
    if (Number(state.currentPlayer) !== botPlayer) return;
    let alive = true;
    setThinking(true);
    const t = setTimeout(() => {
      if (!alive) return;
      setThinking(false);
      const pick = BOARD_BOTS[gameId];
      const lvl = botLevel || 'hard';
      const raw = pick ? pick(rules, state, botPlayer, lvl) : null;
      const mv = raw ? boardBlunder(gameId, rules, state, botPlayer, raw, boardBotLevel(lvl).blunder) : null;
      if (!mv) {
        // No legal move the bot can find — Ludo rolls again, others concede.
        if (gameId === 'ludo') apply(botPlayer, { type: 'roll' });
        return;
      }
      apply(botPlayer, mv);
    }, 350);
    return () => { alive = false; clearTimeout(t); setThinking(false); };
  }, [state, vsBot, over, botLevel]); // eslint-disable-line react-hooks/exhaustive-deps

  const View = BOARD_VIEWS[gameId];
  const cur = Number(state.currentPlayer) || 1;
  const myTurn = !over && (!vsBot || cur !== botPlayer);
  const label = (p) => (vsBot ? (p === 1 ? 'You' : 'Bot') : `Player ${p}`);

  return (
    <div>
      <CuiBar height={36} build={(W) => ([{
        id: 'intro', kind: 'label', r: [0, 4, W, 28], font: 13, bold: true, color: PAL.text,
        label: over
          ? (over.winner === 'draw' ? "It's a draw." : `${label(Number(over.winner))} ${vsBot && over.winner === '1' ? 'win' : 'wins'}! 🎉`)
          : thinking ? 'Bot is thinking…'
          : `${label(cur)} to move`,
      }])} />
      {err && <div className="mnc-join-error">{err}</div>}
      <View
        st={state}
        myPlayerNum={cur}
        isMyTurn={myTurn}
        submit={(move) => { if (myTurn) apply(cur, move); }}
      />
    </div>
  );
}

function BoardRoomGame({ gameId, onWin, onStepChange, resetKey, gameMode, gameModeOpts }) {
  // A pre-seated room (phase 7 in-progress row) skips the create/join setup:
  // the home your-turn card passes { roomId, myPlayerNum } through the classic
  // game-mode opts to land straight back in the live match.
  const [roomInfo, setRoomInfo] = useState(() =>
    gameModeOpts && gameModeOpts.roomId && gameModeOpts.myPlayerNum
      ? { roomId: gameModeOpts.roomId, myPlayerNum: gameModeOpts.myPlayerNum }
      : null
  );
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) setRoomInfo(null);
    else mounted.current = true;
  }, [resetKey]);

  // #144 — mode dispatch. 'bot' and '2p' use the shared rules module locally;
  // 'online' (and the legacy null default) keep the existing room flow.
  if (gameMode === 'bot' || gameMode === '2p') {
    return (
      <BoardLocalGame
        gameId={gameId}
        vsBot={gameMode === 'bot'}
        onWin={onWin}
        onStepChange={onStepChange}
        resetKey={resetKey}
        botLevel={(gameModeOpts && gameModeOpts.botLevel) || 'medium'}
        seats={(gameModeOpts && gameModeOpts.seats) || 2}
      />
    );
  }
  if (!roomInfo) {
    return <OnlineRoomSetup gameId={gameId} onReady={(roomId, myPlayerNum) => setRoomInfo({ roomId, myPlayerNum })} />;
  }
  return <BoardOnlineRoom gameId={gameId} roomId={roomInfo.roomId} myPlayerNum={roomInfo.myPlayerNum} onWin={onWin} onStepChange={onStepChange} />;
}

function CheckersGame(props)   { return <BoardRoomGame gameId="checkers" {...props} />; }
function ReversiGame(props)    { return <BoardRoomGame gameId="reversi" {...props} />; }
function FourInARowGame(props) { return <BoardRoomGame gameId="fourinarow" {...props} />; }
function GomokuGame(props)     { return <BoardRoomGame gameId="gomoku" {...props} />; }
function LudoGame(props)       { return <BoardRoomGame gameId="ludo" {...props} />; }

function ChutesLaddersGame({ onWin, onStepChange, resetKey, gameMode, gameModeOpts, onModeChange }) {
  const [mode, setMode] = useState(gameMode || null);
  // Board style for LOCAL play. Online rooms carry their own variant on the
  // room state (the creator chose it), so the online view reads it from there.
  const [variant, setVariant] = useState(
    (gameModeOpts && gameModeOpts.variant) || 'classic');
  const [glossary, setGlossary] = useState(false);
  const [roomId, setRoomId] = useState((gameModeOpts && gameModeOpts.roomId) || null);
  const [myPlayerNum, setMyPlayerNum] = useState(
    gameModeOpts && gameModeOpts.myPlayerNum
      ? gameModeOpts.myPlayerNum
      : gameModeOpts && gameModeOpts.roomAction === 'join' ? 2 : 1
  );
  const [resumeState, setResumeState] = useState(null);
  const [resumeChecked, setResumeChecked] = useState(false);
  const { loadState, clearState } = useClassicSave('chutes-ladders');

  // Intercept onWin to track win streak in localStorage and submit to the server.
  // playerWon: meta.winner===1 for local/bot (player 1 = the human); score>0 for online.
  const handleWin = (score, steps, secs, meta) => {
    const playerWon = meta && meta.winner !== undefined ? meta.winner === 1 : score > 0;
    const prevStreak = parseInt(localStorage.getItem(CNL_STREAK_KEY) || '0', 10);
    const newStreak = playerWon ? prevStreak + 1 : 0;
    try { localStorage.setItem(CNL_STREAK_KEY, String(newStreak)); } catch (e) {}
    submitClassicScore('chutes-ladders', newStreak, { mode: mode || 'bot' });
    onWin(score, steps, secs, meta);
  };

  // Sync mode from the Game Menu's New Game selection.
  useEffect(() => {
    setMode(gameMode || null);
    if (gameModeOpts && gameModeOpts.variant) setVariant(gameModeOpts.variant);
    if (gameModeOpts && gameModeOpts.roomId) {
      setRoomId(gameModeOpts.roomId);
      setMyPlayerNum(gameModeOpts.roomAction === 'join' ? 2 : 1);
    }
  }, [gameMode, gameModeOpts, resetKey]);

  // Report active mode upward for the top-bar pill + Save visibility.
  useEffect(() => { onModeChange && onModeChange(mode); }, [mode]);

  // Check for a saved bot game when entering bot mode.
  useEffect(() => {
    let cancelled = false;
    if (mode === 'bot' && !resumeChecked) {
      loadState().then(s => { if (!cancelled) { setResumeState(s); setResumeChecked(true); } });
    } else if (mode !== 'bot') {
      setResumeChecked(false); setResumeState(null);
    }
    return () => { cancelled = true; };
  }, [mode]);

  const glossaryModal = glossary
    ? <MokshaGlossaryModal onClose={() => setGlossary(false)} />
    : null;

  /* No mode means the board was reached without passing the opponent screen
     (a bare deep link). Fall back to the SAME picker that screen renders —
     Snakes & Ladders used to have its own copy here, and a second picker is
     how the two screens drift apart. Its board style lives in the registry's
     `variantPicker` now; the cosmetic skin was never mode-selection at all and
     stays where it is used, on the ☰ cycle inside the game. */
  if (!mode) {
    return (
      <React.Fragment>
        <ClassicModePicker
          game={GAMES.find(g => g.id === 'chutes-ladders')}
          onGlossary={() => setGlossary(true)}
          onPlay={(m, opts) => {
            if (opts && opts.variant) setVariant(opts.variant);
            if (m === 'online') {
              setRoomId(opts.roomId);
              setMyPlayerNum(opts.myPlayerNum || (opts.roomAction === 'join' ? 2 : 1));
            }
            setMode(m);
          }}
        />
        {glossaryModal}
      </React.Fragment>
    );
  }
  if (mode === 'online') {
    return (
      <React.Fragment>
        <ChutesLaddersOnlineGame
          onWin={handleWin} onStepChange={onStepChange}
          roomId={roomId} myPlayerNum={myPlayerNum}
          onGlossary={() => setGlossary(true)}
        />
        {glossaryModal}
      </React.Fragment>
    );
  }
  if (mode === 'bot' && !resumeChecked) {
    return <div style={{ textAlign: 'center', padding: '2rem', color: C.muted }}>Loading…</div>;
  }
  return (
    <React.Fragment>
      <ChutesLaddersLocalGame
        onWin={handleWin}
        onStepChange={onStepChange}
        resetKey={resetKey}
        vsBot={mode === 'bot'}
        variant={variant}
        onGlossary={() => setGlossary(true)}
        initialState={mode === 'bot' ? resumeState : null}
        onClearSave={mode === 'bot' ? clearState : null}
      />
      {glossaryModal}
    </React.Fragment>
  );
}

// Declarative client game registry — the single source of truth for how each
// game is launched, wrapped, and scored on the client (mirrors the server's
// authoritative GAME_REGISTRY in server.js). Every entry MUST carry an `id`.
//
// Capability fields read by the App dispatch:
//   shell — how App renders the game body:
//     'daily'   → back-header game-wrap; receives savedProgress/onSaveProgress
//     'classic' → wrapped in ClassicShell + .cg-stage.cg-scroll (in-frame)
//     'self'    → game renders its own ClassicShell (full-screen, gesture-first)
//     'custom'  → App renders a bespoke screen (e.g. PvP Arena), not `component`
//   daily — true only for category 'daily' games: the single gate for the
//           per-day start/lock/finish/streak/resume machinery.
//   category — lobby tab grouping (maps 1:1 to the tabs).
