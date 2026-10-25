/* ============================================================
   Mancala helpers
   ============================================================ */
const MNC_HISTORY_KEY = 'puzzlechain_mancala_history';

// Stone rendering helpers
const MNC_STONE_COLORS = ['#C8A87A', '#A07845', '#D4B896', '#8B5E3C', '#BF9E5A'];

// Deterministic float in [0,1) from two integer seeds — sin hash (stable, well-distributed).
function mncRandVal(pitSeed, i) {
  const x = Math.sin(pitSeed * 127.1 + i * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// Stone diameter as a fraction of the pit/store element's smaller dimension.
function mncStoneSizeFactor(count, isStore) {
  if (isStore) {
    if (count <= 3)  return 0.20;
    if (count <= 6)  return 0.17;
    if (count <= 12) return 0.14;
    if (count <= 18) return 0.11;
    return 0.09;
  }
  if (count <= 4)  return 0.26;
  if (count <= 8)  return 0.21;
  if (count <= 16) return 0.17;
  return 0.13;
}

/* The Mancala board as ONE canvas shared by all four modes — local 2P, Daily
   Challenge, Versus Bot, and Online (#170 treatment). The carved-wood palette
   stays intrinsic (hardcoded, as CLAUDE.md requires); stones keep their
   seeded uniform-disk layouts (the exact MncPitStones math, drawn). Each
   caller passes its own pitState(idx) → { clickable, flash, capture } so the
   four modes' turn/animation rules stay exactly where they lived. */
const MNC_WOOD = { board: '#7B4F2E', edge: '#5A2F14', pit: '#4A1E09', pitEdge: '#3A1206', pitHot: '#9E7A5A', text: '#C8A87A', label: '#9E7A5A', flashBg: '#5E2E12' };
function MncBoardCanvas({ pits, pitState, storeGlowL, storeGlowR, labelL, labelR, onPit }) {
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const { boxW } = useFitBox(boxRef, { cols: 8, rows: 2 });
  const W = Math.max(0, Math.floor(boxW));
  const storeW = Math.round(W * 0.13);
  const pad = 8, gap = 5;
  const cell = Math.floor((W - pad * 2 - storeW * 2 - gap * 7) / 6);
  const H = pad * 2 + cell * 2 + gap;
  const geoRef = useRef({});
  geoRef.current = { W, H, storeW, pad, gap, cell };

  // Pit centers: p2 row (indices 12..7) on top, p1 row (0..5) below.
  const pitCenter = (idx) => {
    const g = geoRef.current;
    const topRow = idx >= 7 && idx <= 12;
    const col = topRow ? 12 - idx : idx;
    const x = g.pad + g.storeW + g.gap + col * (g.cell + g.gap) + g.cell / 2;
    const y = topRow ? g.pad + g.cell / 2 : g.pad + g.cell + g.gap + g.cell / 2;
    return [x, y];
  };

  usePointerCell(canvasRef, {
    onTap: (p) => {
      const g = geoRef.current;
      for (let idx = 0; idx <= 12; idx++) {
        if (idx === 6) continue;
        const [cx, cy] = pitCenter(idx);
        if (Math.hypot(p.x - cx, p.y - cy) <= g.cell / 2 + 3) {
          if (pitState(idx).clickable) onPit(idx);
          return;
        }
      }
    },
  });

  useCanvasBoard(canvasRef, {
    width: W,
    height: H,
    // pitState is a fresh closure each parent render, so flash/capture/turn
    // changes repaint even though the sets live in the caller.
    deps: [pits, storeGlowL, storeGlowR, W, pitState],
    draw: (ctx) => {
      if (W < 120) return;
      const g = geoRef.current;
      ctx.textAlign = 'center';
      // Carved-wood board.
      klRR(ctx, 1, 1, g.W - 2, g.H - 2, 16);
      ctx.fillStyle = MNC_WOOD.board;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = MNC_WOOD.edge;
      ctx.stroke();

      // Seeded stone layout — the MncPitStones math, drawn.
      const drawStones = (idx, cx, cy, radius, isStore) => {
        const count = pits[idx];
        const sf = mncStoneSizeFactor(count, isStore);
        const maxR = (0.5 - sf / 2) * 0.82;
        for (let i = 0; i < count; i++) {
          const rr = Math.sqrt(mncRandVal(idx, i * 3)) * maxR;
          const theta = mncRandVal(idx, i * 3 + 1) * 2 * Math.PI;
          const sVar = 0.85 + mncRandVal(idx, i * 3 + 2) * 0.30;
          const sx = cx + rr * Math.cos(theta) * radius * 2;
          const sy = cy + rr * Math.sin(theta) * radius * 2;
          ctx.beginPath();
          ctx.arc(sx, sy, Math.max(2, sf * sVar * radius), 0, Math.PI * 2);
          ctx.fillStyle = MNC_STONE_COLORS[i % MNC_STONE_COLORS.length];
          ctx.fill();
        }
      };

      // Stores: idx 13 left, idx 6 right, pill-shaped, spanning both rows.
      const storeH = g.H - g.pad * 2;
      const stores = [
        { idx: 13, x: g.pad, glow: storeGlowL, label: labelL || 'P2' },
        { idx: 6, x: g.W - g.pad - g.storeW, glow: storeGlowR, label: labelR || 'P1' },
      ];
      for (const s of stores) {
        klRR(ctx, s.x, g.pad, g.storeW, storeH, g.storeW / 2);
        ctx.fillStyle = MNC_WOOD.pit;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = s.glow ? palOf(s.glow, MNC_WOOD.pitHot) : MNC_WOOD.pitEdge;
        ctx.stroke();
        ctx.save();
        klRR(ctx, s.x, g.pad, g.storeW, storeH, g.storeW / 2);
        ctx.clip();
        drawStones(s.idx, s.x + g.storeW / 2, g.pad + storeH / 2, g.storeW / 2.4, true);
        ctx.restore();
        /* #202 — the COUNT has moved to the HUD. It used to be drawn here, in
           the middle of the store, directly over the seed pile it was counting
           — so the number obscured the thing it described and the thing it
           described obscured the number. The store now holds seeds and a name;
           the score is a pill above the board, where a score belongs. */
        ctx.font = `600 ${Math.max(6, Math.round(g.storeW * 0.16))}px 'Space Grotesk', sans-serif`;
        ctx.fillStyle = MNC_WOOD.label;
        ctx.fillText(s.label.toUpperCase().slice(0, 6), s.x + g.storeW / 2, g.pad + storeH * 0.18);
        ctx.fillStyle = MNC_WOOD.label;
        ctx.fillText('STORE', s.x + g.storeW / 2, g.pad + storeH * 0.86);
      }

      // Pits.
      for (let idx = 0; idx <= 12; idx++) {
        if (idx === 6) continue;
        const st = pitState(idx);
        const [cx, cy] = pitCenter(idx);
        const radius = g.cell / 2 - 2;
        ctx.save();
        if (!st.clickable && !st.flash && !st.capture) ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = st.flash ? MNC_WOOD.flashBg : MNC_WOOD.pit;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = st.capture ? PAL.gold : st.flash || st.clickable ? MNC_WOOD.pitHot : MNC_WOOD.pitEdge;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, radius - 1, 0, Math.PI * 2);
        ctx.clip();
        drawStones(idx, cx, cy, radius, false);
        ctx.restore();
        // Count bubble so buried stones stay countable at a glance.
        ctx.font = `600 ${Math.max(8, Math.round(g.cell * 0.2))}px 'JetBrains Mono', monospace`;
        ctx.fillStyle = MNC_WOOD.text;
        ctx.fillText(String(pits[idx]), cx, cy + radius - Math.max(3, g.cell * 0.06));
      }
    },
  });

  return (
    <div className="mnc-board" ref={boxRef}>
      <canvas
        ref={canvasRef}
        className="mnc-canvas board-canvas"
        role="img"
        aria-label={`Mancala board — ${labelL || 'P2'} store ${pits[13]}, ${labelR || 'P1'} store ${pits[6]}`}
      />
    </div>
  );
}

const MNC_HISTORY_MAX = 50;
const MNC_SOUND_KEY = 'puzzlechain_mancala_sound';

function mncLoadHistory() { return loadHistory(MNC_HISTORY_KEY); }
function mncSaveEntry(entry) { saveHistory(MNC_HISTORY_KEY, entry, MNC_HISTORY_MAX); }

function mncInitBoard() {
  return [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0];
}

// Pit directly across the board from pit i. Formula: 12 - i works for both sides:
// P1 pit 0 ↔ P2 pit 12, P1 pit 5 ↔ P2 pit 7, etc.
function mncOpposite(i) { return 12 - i; }

// Shared AudioContext for stone-click sounds (lazy, satisfies browser autoplay policy).
let _mncAudioCtx = null;
function mncPlayClick() {
  try {
    if (!_mncAudioCtx) _mncAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _mncAudioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = 360 + Math.floor(Math.random() * 120);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.07);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.08);
  } catch {}
}

/* #202 — HOW FAST A STONE IS SOWN.

   The report calls the sowing "instant turbo", and it is not instant — every
   stone has been animated one at a time since the start. It is that the gap
   was a flat 80 ms, which is under the ~100 ms a person needs to register a
   discrete event, so a four-stone move was over in 320 ms and read as one
   jump rather than four placements.

   A flat number cannot fix that on its own, because the pits are not all the
   same size: whatever reads well for four stones drags for fifteen. So the
   per-stone gap is derived from the COUNT — generous for a small handful,
   tightening as the handful grows, and bounded at both ends so a big pit is
   still quick and a small one is still legible.

     4 stones  -> 170 ms each,  680 ms total
     8 stones  -> 137 ms each, 1100 ms total
    15 stones  ->  73 ms each, 1100 ms total

   MNC_SOW_BUDGET is the single knob: it is the length of a typical move, and
   the two bounds only stop the extremes from being silly. Pure, so
   `mancala-sowing` can hold the shape rather than the numbers. */
const MNC_SOW_MIN = 70, MNC_SOW_MAX = 170, MNC_SOW_BUDGET = 1100;

function mncSowDelay(stones) {
  const n = Math.max(1, stones | 0);
  return Math.round(Math.max(MNC_SOW_MIN, Math.min(MNC_SOW_MAX, MNC_SOW_BUDGET / n)));
}

// Pure distribution function: picks up stones from pitIdx for player and sows them.
// Returns { sequence, pits, lastIdx, extraTurn, captureFrom, captureAmount }.
// sequence = ordered list of pit indices that received a stone (for animation).
function mncDistribute(pits, pitIdx, player) {
  const p = pits.slice();
  const stones = p[pitIdx];
  p[pitIdx] = 0;
  const skipStore = player === 1 ? 13 : 6; // never place in opponent's store
  const ownStore  = player === 1 ? 6  : 13;
  const ownMin    = player === 1 ? 0  : 7;
  const ownMax    = player === 1 ? 5  : 12;
  const sequence  = [];
  let cur = pitIdx;

  for (let i = 0; i < stones; i++) {
    do { cur = (cur + 1) % 14; } while (cur === skipStore);
    p[cur]++;
    sequence.push(cur);
  }

  const lastIdx  = sequence[sequence.length - 1];
  const extraTurn = lastIdx === ownStore;

  // Capture: last stone lands in player's own previously-empty pit and opposite has stones.
  let captureFrom = -1, captureAmount = 0;
  if (!extraTurn && lastIdx >= ownMin && lastIdx <= ownMax && p[lastIdx] === 1) {
    const opp = mncOpposite(lastIdx);
    if (p[opp] > 0) {
      captureAmount = p[opp] + 1; // opposite stones + landing stone
      captureFrom   = opp;
      p[ownStore] += captureAmount;
      p[lastIdx]   = 0;
      p[opp]       = 0;
    }
  }

  return { sequence, pits: p, lastIdx, extraTurn, captureFrom, captureAmount };
}

/* ============================================================
   Mancala — AI Engine (pure functions, no side effects)
   ============================================================ */
function mncGetValidMoves(pits, player) {
  const min = player === 1 ? 0 : 7;
  const max = player === 1 ? 5 : 12;
  const moves = [];
  for (let i = min; i <= max; i++) if (pits[i] > 0) moves.push(i);
  return moves;
}

function mncEval(pits) { return pits[6] - pits[13]; }

// Minimax with alpha-beta pruning. player = whose turn it currently is.
function mncMinimax(pits, player, depth, alpha, beta) {
  const p1Empty = pits.slice(0, 6).every(v => v === 0);
  const p2Empty = pits.slice(7, 13).every(v => v === 0);
  if (p1Empty || p2Empty) {
    const p = pits.slice();
    for (let i = 0; i < 6;  i++) { p[6]  += p[i]; p[i] = 0; }
    for (let i = 7; i < 13; i++) { p[13] += p[i]; p[i] = 0; }
    return mncEval(p);
  }
  if (depth === 0) return mncEval(pits);
  const moves = mncGetValidMoves(pits, player);
  if (moves.length === 0) return mncEval(pits);
  if (player === 1) {
    let best = -Infinity;
    for (const idx of moves) {
      const { pits: np, extraTurn } = mncDistribute(pits, idx, 1);
      const score = mncMinimax(np, extraTurn ? 1 : 2, depth - 1, alpha, beta);
      if (score > best) best = score;
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const idx of moves) {
      const { pits: np, extraTurn } = mncDistribute(pits, idx, 2);
      const score = mncMinimax(np, extraTurn ? 2 : 1, depth - 1, alpha, beta);
      if (score < best) best = score;
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }
}

// Return the best pit index for P2 at the given difficulty, or -1 if no moves.
function mncAIMove(pits, difficulty) {
  const moves = mncGetValidMoves(pits, 2);
  if (moves.length === 0) return -1;
  if (difficulty === 'easy') return shuffle(moves)[0];
  // Medium: greedy single-ply
  if (difficulty === 'medium') {
    let bestIdx = moves[0], bestScore = Infinity;
    for (const idx of moves) {
      const { pits: np } = mncDistribute(pits, idx, 2);
      const s = mncEval(np);
      if (s < bestScore) { bestScore = s; bestIdx = idx; }
    }
    return bestIdx;
  }
  // Hard: minimax depth 7 (AI's own move is at depth 0; 6 additional plies)
  let bestIdx = moves[0], bestScore = Infinity;
  for (const idx of moves) {
    const { pits: np, extraTurn } = mncDistribute(pits, idx, 2);
    const s = mncMinimax(np, extraTurn ? 2 : 1, 6, -Infinity, Infinity);
    if (s < bestScore) { bestScore = s; bestIdx = idx; }
  }
  return bestIdx;
}

/* ============================================================
   Mancala — Networking (polling hook for online multiplayer)
   ============================================================ */
const MNC_ONLINE_SESSION_KEY = 'puzzlechain_mancala_online_session';

function useMancalaRoom(roomId) {
  const [room, setRoom]                         = useState(null);
  const [pollingError, setPollingError]         = useState(null);
  const [opponentDisconnected, setOpponentDisconnected] = useState(false);
  const consecutiveErrors = useRef(0);
  const intervalRef       = useRef(null);

  const fetchRoom = async () => {
    if (!roomId) return;
    try {
      const { ok, status, body } = await api('/api/mancala/rooms/' + roomId);
      if (ok && body) {
        setRoom(body);
        setPollingError(null);
        consecutiveErrors.current = 0;
        setOpponentDisconnected(false);
      } else if (status === 404) {
        setPollingError('room_not_found');
        consecutiveErrors.current++;
      } else {
        consecutiveErrors.current++;
        if (consecutiveErrors.current >= 3) {
          setOpponentDisconnected(true);
          setPollingError('connection_error');
        }
      }
    } catch {
      consecutiveErrors.current++;
      if (consecutiveErrors.current >= 3) {
        setOpponentDisconnected(true);
        setPollingError('connection_error');
      }
    }
  };

  useEffect(() => {
    if (!roomId) { setRoom(null); setPollingError(null); return; }
    consecutiveErrors.current = 0;
    fetchRoom();
    intervalRef.current = setInterval(() => {
      setRoom(r => {
        if (r && r.status === 'finished') {
          clearInterval(intervalRef.current);
          return r;
        }
        return r;
      });
      fetchRoom();
    }, 1500);
    return () => clearInterval(intervalRef.current);
  }, [roomId]);

  const submitMove = async (pitIdx) => {
    if (!room || room.status !== 'active') return;
    const player = pitIdx <= 5 ? 1 : 2;
    const moveSeq = room.moveSeq + 1;
    // Optimistic update
    try {
      const { pits: afterPits, extraTurn } = mncDistribute(room.pits, pitIdx, player);
      const p1Empty = afterPits.slice(0, 6).every(v => v === 0);
      const p2Empty = afterPits.slice(7, 13).every(v => v === 0);
      let finalPits = afterPits.slice();
      let gameOver = false, winner = null;
      if (p1Empty || p2Empty) {
        for (let i = 0; i < 6;  i++) { finalPits[6]  += finalPits[i]; finalPits[i] = 0; }
        for (let i = 7; i < 13; i++) { finalPits[13] += finalPits[i]; finalPits[i] = 0; }
        winner = finalPits[6] > finalPits[13] ? '1' : finalPits[13] > finalPits[6] ? '2' : 'draw';
        gameOver = true;
      }
      const nextPlayer = gameOver ? null : (extraTurn ? player : (player === 1 ? 2 : 1));
      setRoom(r => ({ ...r, pits: finalPits, currentPlayer: nextPlayer, status: gameOver ? 'finished' : 'active', winner, moveSeq }));
    } catch {}
    // Confirm with server
    try {
      const { ok, body } = await api('/api/mancala/rooms/' + roomId + '/move', {
        method: 'POST',
        body: JSON.stringify({ pitIdx, moveSeq }),
      });
      if (ok && body) { setRoom(body); }
      else { fetchRoom(); }
    } catch { fetchRoom(); }
  };

  return { room, pollingError, opponentDisconnected, submitMove };
}

/* ============================================================
   Game 5 — Mancala (Kalah variant, pass-and-play)
   ============================================================ */
function MancalaLocalGame({ onWin, onStepChange, resetKey }) {
  const [pits, setPits]           = useState(mncInitBoard);
  const [player, setPlayer]       = useState(1);
  const [done, setDone]           = useState(false);
  const [winner, setWinner]       = useState(null);
  const [moves, setMoves]         = useState(0);
  const [flashPits, setFlashPits] = useState(() => new Set());
  const [captureFlash, setCaptureFlash] = useState(() => new Set());
  const [bannerMsg, setBannerMsg] = useState('');
  const [activeTab, setActiveTab] = useState('game');
  const [history, setHistory]     = useState(() => mncLoadHistory());
  const [soundOn, setSoundOn]     = useState(() => localStorage.getItem(MNC_SOUND_KEY) !== '0');

  const animatingRef  = useRef(false);
  const soundOnRef    = useRef(soundOn);
  const winTimerRef   = useRef(null);
  soundOnRef.current  = soundOn;

  const { secs, fmt } = useTimer(!done);
  const secsRef = useRef(0);
  secsRef.current = secs;

  const resetGame = () => {
    // Cancel any in-flight win callback and animation
    animatingRef.current = false;
    if (winTimerRef.current) { clearTimeout(winTimerRef.current); winTimerRef.current = null; }
    setPits(mncInitBoard());
    setPlayer(1);
    setDone(false);
    setWinner(null);
    setMoves(0);
    setFlashPits(new Set());
    setCaptureFlash(new Set());
    setBannerMsg('');
  };

  // Reset when parent increments resetKey (Play Again)
  useEffect(() => { resetGame(); }, [resetKey]);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    soundOnRef.current = next;
    try { localStorage.setItem(MNC_SOUND_KEY, next ? '1' : '0'); } catch {}
  };

  const finishMove = (newPits, currentPlayer, extraTurn, captureFrom, newMoves) => {
    const p = newPits.slice();

    // Sweep any remaining stones when one side is emptied
    const p1Empty = p.slice(0, 6).every(v => v === 0);
    const p2Empty = p.slice(7, 13).every(v => v === 0);
    const isGameOver = p1Empty || p2Empty;

    if (isGameOver) {
      for (let i = 0; i < 6; i++) { p[6] += p[i]; p[i] = 0; }
      for (let i = 7; i < 13; i++) { p[13] += p[i]; p[i] = 0; }
    }

    setPits(p);
    setMoves(newMoves);
    onStepChange(newMoves);

    if (isGameOver) {
      const w = p[6] > p[13] ? 1 : p[13] > p[6] ? 2 : 'draw';
      setWinner(w);
      setDone(true);
      const wLabel = w === 1 ? 'Player 1 wins! 🎉' : w === 2 ? 'Player 2 wins! 🎉' : "It's a draw! 🤝";
      setBannerMsg(wLabel);

      const entry = {
        id: String(Date.now()),
        date: new Date().toISOString().slice(0, 10),
        winner: w,
        p1Score: p[6],
        p2Score: p[13],
        moves: newMoves,
        secs: secsRef.current,
      };
      mncSaveEntry(entry);
      setHistory(mncLoadHistory());

      winTimerRef.current = setTimeout(() => {
        winTimerRef.current = null;
        setBannerMsg('');
        const score = Math.max(Math.abs(p[6] - p[13]) * 15 - secsRef.current, 50);
        const share = `Mancala ${entry.date} — 🫘 P1 ${p[6]} · P2 ${p[13]} · ${newMoves} moves · ${secsRef.current}s`;
        onWin(score, newMoves, secsRef.current, { winner: w, share, winnerLabel: wLabel });
      }, 1500);

    } else if (extraTurn) {
      setBannerMsg('Extra turn! 🔄');
      setTimeout(() => setBannerMsg(msg => msg === 'Extra turn! 🔄' ? '' : msg), 1200);
    } else {
      setPlayer(currentPlayer === 1 ? 2 : 1);
      setBannerMsg('');
    }
  };

  const handlePitClick = (idx) => {
    if (animatingRef.current || done) return;
    const ownMin = player === 1 ? 0 : 7;
    const ownMax = player === 1 ? 5 : 12;
    if (idx < ownMin || idx > ownMax || pits[idx] === 0) return;

    const { sequence, pits: newPits, extraTurn, captureFrom } = mncDistribute(pits, idx, player);
    const newMoves = moves + 1;

    animatingRef.current = true;
    const working = pits.slice();
    working[idx] = 0;
    setPits(working.slice());
    setFlashPits(new Set());

    let step = 0;
    const animate = () => {
      if (!animatingRef.current) { setFlashPits(new Set()); return; }
      if (step >= sequence.length) {
        // All stones placed — show capture flash if any, then finish
        setFlashPits(new Set());
        if (captureFrom >= 0) {
          setCaptureFlash(new Set([captureFrom]));
          setTimeout(() => {
            if (!animatingRef.current) return;
            setCaptureFlash(new Set());
            animatingRef.current = false;
            finishMove(newPits, player, extraTurn, captureFrom, newMoves);
          }, 350);
        } else {
          animatingRef.current = false;
          finishMove(newPits, player, extraTurn, captureFrom, newMoves);
        }
        return;
      }
      const pitIdx = sequence[step];
      working[pitIdx]++;
      setPits(working.slice());
      setFlashPits(new Set([pitIdx]));
      if (soundOnRef.current) mncPlayClick();
      step++;
      setTimeout(animate, 80);
    };
    setTimeout(animate, 0);
  };

  // Board display order: P2 pits shown right-to-left (pit 12 at left, pit 7 at right)

  const p1Color = C.accent;
  const p2Color = C.rose;
  const activeColor = player === 1 ? p1Color : p2Color;

  // Aggregate stats
  const stats = history.reduce((acc, h) => {
    acc.total++;
    if (h.winner === 1) acc.p1++;
    else if (h.winner === 2) acc.p2++;
    else acc.draws++;
    if (h.moves > acc.longest) acc.longest = h.moves;
    return acc;
  }, { total: 0, p1: 0, p2: 0, draws: 0, longest: 0 });

  const fmtDate = (d) => {
    const [y, m, day] = d.split('-');
    return `${m}/${day}/${y.slice(2)}`;
  };

  return (
    <div>
      {activeTab === 'game' && (
        <div>
          <CuiBar height={72} build={(W) => {
            // #202 — the two stores are SCORES, so they are pills like every
            // other score in this app rather than numbers painted over seeds.
            const pr = cuiRow(0, 0, W, 46, 4);
            return [
              { id: 'p-p1', kind: 'pill', r: pr[0], label: 'P1', value: pits[6], color: palOf(p1Color, undefined) },
              { id: 'p-p2', kind: 'pill', r: pr[1], label: 'P2', value: pits[13], color: palOf(p2Color, undefined) },
              { id: 'p-time', kind: 'pill', r: pr[2], label: 'Time', value: fmt, gold: true },
              { id: 'p-turn', kind: 'pill', r: pr[3], label: 'Turn', value: done ? (winner === 'draw' ? 'Draw' : `P${winner}`) : `P${player}`, color: done ? undefined : palOf(activeColor, undefined) },
              { id: 'banner', kind: 'label', r: [0, 50, W, 20], font: 12.5, bold: true, color: done ? PAL.muted : palOf(activeColor, undefined),
                label: done ? (winner === 'draw' ? "Game over — It's a draw! 🤝" : `Game over — Player ${winner} wins! 🎉`) : `Player ${player}'s turn` },
            ];
          }} />

          {/* Board */}
          <MncBoardCanvas
            pits={pits}
            pitState={(idx) => {
              const ownMin = player === 1 ? 0 : 7, ownMax = player === 1 ? 5 : 12;
              return {
                clickable: !done && !animatingRef.current && idx >= ownMin && idx <= ownMax && pits[idx] > 0,
                flash: flashPits.has(idx),
                capture: captureFlash.has(idx),
              };
            }}
            storeGlowL={!done && player === 2 ? p2Color : null}
            storeGlowR={!done && player === 1 ? p1Color : null}
            onPit={handlePitClick}
          />

          {bannerMsg && <div className="mnc-banner">{bannerMsg}</div>}

          <div className="mnc-controls">
            <button onClick={resetGame}>↺ New Game</button>
            <button onClick={resetGame}>⟳ Restart</button>
            <button onClick={toggleSound} title={soundOn ? 'Sound on' : 'Sound off'}>
              {soundOn ? '🔊' : '🔇'}
            </button>
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <div>
          <div className="mnc-history-list">
            {history.length === 0
              ? <div className="mnc-empty-state">No games recorded yet</div>
              : history.map(h => (
                <div key={h.id} className="mnc-history-row">
                  <span className={`mnc-outcome-chip ${h.winner === 1 ? 'p1win' : h.winner === 2 ? 'p2win' : 'draw'}`}>
                    {h.winner === 1 ? 'P1 Win' : h.winner === 2 ? 'P2 Win' : 'Draw'}
                  </span>
                  <span style={{ color: C.muted, fontSize: '0.75rem' }}>{fmtDate(h.date)}</span>
                  <span className="mono" style={{ color: C.gold }}>{h.p1Score}–{h.p2Score}</span>
                  <span style={{ color: C.muted, fontSize: '0.75rem' }}>{h.moves} moves</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {activeTab === 'stats' && (
        <div>
          {history.length === 0
            ? <div className="mnc-empty-state">No games recorded yet</div>
            : (
              <div className="mnc-stats-grid">
                <div className="mnc-stat-card">
                  <div className="mnc-stat-val">{stats.total}</div>
                  <div className="mnc-stat-lbl">Games Played</div>
                </div>
                <div className="mnc-stat-card">
                  <div className="mnc-stat-val" style={{ color: p1Color }}>{stats.p1}</div>
                  <div className="mnc-stat-lbl">P1 Wins</div>
                </div>
                <div className="mnc-stat-card">
                  <div className="mnc-stat-val" style={{ color: p2Color }}>{stats.p2}</div>
                  <div className="mnc-stat-lbl">P2 Wins</div>
                </div>
                <div className="mnc-stat-card">
                  <div className="mnc-stat-val" style={{ color: C.muted }}>{stats.draws}</div>
                  <div className="mnc-stat-lbl">Draws</div>
                </div>
                <div className="mnc-stat-card" style={{ gridColumn: '1 / 3' }}>
                  <div className="mnc-stat-val">{stats.longest || '—'}</div>
                  <div className="mnc-stat-lbl">Longest Game (moves)</div>
                </div>
              </div>
            )}
        </div>
      )}

      <div className="mnc-bottom-nav safe-bottom">
        {['game', 'history', 'stats'].map(tab => (
          <button
            key={tab}
            className={'mnc-tab' + (activeTab === tab ? ' active' : '')}
            onClick={() => { setActiveTab(tab); if (tab !== 'game') setHistory(mncLoadHistory()); }}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   Mancala ZK helpers (commit-reveal proof, browser-side)
   ============================================================ */
async function mncStartSession(difficulty) {
  try {
    const nonceBytes = new Uint8Array(16);
    window.crypto.getRandomValues(nonceBytes);
    const nonceHex = Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    const initBoard = [4,4,4,4,4,4,0,4,4,4,4,4,4,0];
    const msgBuf = new TextEncoder().encode(nonceHex + '||' + JSON.stringify(initBoard));
    const hashBuf = await window.crypto.subtle.digest('SHA-256', msgBuf);
    const commitment = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
    const { ok, body } = await api('/api/mancala/score/start', {
      method: 'POST',
      body: JSON.stringify({ commitment, difficulty }),
    });
    if (ok && body && body.sessionId) {
      return { sessionId: body.sessionId, nonce: nonceHex };
    }
    return null;
  } catch { return null; }
}

async function mncVerifySession(sessionId, nonce, moveLog, finalPits, timeSecs) {
  try {
    const { ok, body } = await api('/api/mancala/score/verify', {
      method: 'POST',
      body: JSON.stringify({ sessionId, nonce, moveLog, finalPits, timeSecs }),
    });
    if (ok && body) return body;
    return { verified: false, reason: 'network_error' };
  } catch { return { verified: false, reason: 'network_error' }; }
}

/* ============================================================
   Mancala Leaderboard component (used inside AI game tab)
   ============================================================ */
function MncLeaderboard() {
  const [diff, setDiff]       = useState('hard');
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);
    api('/api/mancala/leaderboard?difficulty=' + diff)
      .then(({ ok, body }) => {
        if (ok && body) setData(body);
        else setError(true);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [diff]);

  const fmtSecs = s => {
    if (!s && s !== 0) return '—';
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  const tabs = ['easy', 'medium', 'hard'];
  const meInTop = data && data.me && data.top && data.top.some(r => r.rank === data.me.rank);

  return (
    <div style={{ marginTop: '0.5rem' }}>
      <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'center', marginBottom: '0.75rem' }}>
        {tabs.map(t => (
          <button
            key={t}
            className={'mnc-difficulty-pill' + (diff === t ? ' active' : '')}
            onClick={() => setDiff(t)}
            style={{ textTransform: 'capitalize' }}
          >{t}</button>
        ))}
      </div>
      {loading && <div style={{ textAlign: 'center', color: C.muted, padding: '1rem', fontSize: '0.85rem' }}>Loading…</div>}
      {error && <div style={{ textAlign: 'center', color: C.rose, padding: '1rem', fontSize: '0.85rem' }}>Could not load leaderboard.</div>}
      {!loading && !error && data && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '2rem 1fr auto auto', gap: '0 0.5rem', fontSize: '0.75rem', color: C.muted, padding: '0 0.25rem 0.3rem', borderBottom: `1px solid ${C.border}` }}>
            <span>#</span><span>Player</span><span>Score</span><span>Time</span>
          </div>
          {data.top.length === 0 && (
            <div style={{ textAlign: 'center', color: C.muted, padding: '1.25rem', fontSize: '0.85rem' }}>No scores yet — be the first!</div>
          )}
          {data.top.map((row, i) => {
            const isMe = data.me && row.rank === data.me.rank;
            return (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '2rem 1fr auto auto', gap: '0 0.5rem',
                padding: '0.4rem 0.25rem', fontSize: '0.82rem',
                borderBottom: `1px solid ${ca('border','22')}`,
                background: isMe ? ca('accent','18') : 'transparent',
                borderRadius: isMe ? '6px' : '0',
              }}>
                <span style={{ color: row.rank <= 3 ? C.gold : C.muted, fontWeight: row.rank <= 3 ? 700 : 400 }}>{row.rank}</span>
                <span style={{ color: isMe ? C.accent : C.text, fontWeight: isMe ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.username || '—'}</span>
                <span style={{ color: C.gold, fontFamily: 'monospace' }}>{row.bestScore}</span>
                <span style={{ color: C.muted }}>{fmtSecs(row.bestTimeSecs)}</span>
              </div>
            );
          })}
          {data.me && !meInTop && (
            <div>
              <div style={{ textAlign: 'center', color: C.muted, fontSize: '0.7rem', padding: '0.2rem 0' }}>…</div>
              <div style={{
                display: 'grid', gridTemplateColumns: '2rem 1fr auto auto', gap: '0 0.5rem',
                padding: '0.4rem 0.25rem', fontSize: '0.82rem',
                background: ca('accent','18'), borderRadius: '6px',
              }}>
                <span style={{ color: C.accent, fontWeight: 600 }}>{data.me.rank}</span>
                <span style={{ color: C.accent, fontWeight: 600 }}>{data.me.username || 'You'}</span>
                <span style={{ color: C.gold, fontFamily: 'monospace' }}>{data.me.bestScore}</span>
                <span style={{ color: C.muted }}>{fmtSecs(data.me.bestTimeSecs)}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Game 5b — Mancala AI variant (human P1 vs AI P2)
   ============================================================ */
function MancalaAIGame({ onWin, onStepChange, resetKey, difficulty }) {
  const [pits, setPits]                 = useState(mncInitBoard);
  const [player, setPlayer]             = useState(1);
  const [done, setDone]                 = useState(false);
  const [winner, setWinner]             = useState(null);
  const [moves, setMoves]               = useState(0);
  const [flashPits, setFlashPits]       = useState(() => new Set());
  const [captureFlash, setCaptureFlash] = useState(() => new Set());
  const [bannerMsg, setBannerMsg]       = useState('');
  const [aiThinking, setAiThinking]     = useState(false);
  const [history, setHistory]           = useState(() => mncLoadHistory());
  const [soundOn, setSoundOn]           = useState(() => localStorage.getItem(MNC_SOUND_KEY) !== '0');
  const [activeTab, setActiveTab]       = useState('game');
  // ZK session state
  const [verifying, setVerifying]       = useState(false);
  const [verified, setVerified]         = useState(null); // null | true | false

  const animatingRef  = useRef(false);
  const soundOnRef    = useRef(soundOn);
  const winTimerRef   = useRef(null);
  const applyMoveRef  = useRef(null);
  const pitsRef       = useRef(pits);
  const movesRef      = useRef(moves);
  const playerRef     = useRef(player);
  const doneRef       = useRef(done);
  // AI turn-loop timers (thinking delay + last-resort watchdog)
  const aiTimerRef    = useRef(null);
  const aiWatchdogRef = useRef(null);
  // ZK proof refs
  const sessionIdRef  = useRef(null);
  const nonceRef      = useRef(null);
  const moveLogRef    = useRef([]);
  soundOnRef.current  = soundOn;
  pitsRef.current     = pits;
  movesRef.current    = moves;
  playerRef.current   = player;
  doneRef.current     = done;

  const { secs, fmt } = useTimer(!done);
  const secsRef = useRef(0);
  secsRef.current = secs;

  // Game Menu Save/Resume for the Versus-Bot (AI) Mancala game.
  const { loadState, clearState } = useClassicSave('mancala');
  const [resumeOffer, setResumeOffer] = useState(null);
  const resumeCheckedRef = useRef(false);
  useClassicSaveSource(!done, () => ({
    difficulty, pits: pitsRef.current, currentPlayer: playerRef.current,
    moves: movesRef.current, secs: secsRef.current,
  }));
  useEffect(() => {
    if (resumeCheckedRef.current) return;
    resumeCheckedRef.current = true;
    loadState().then(s => { if (s && Array.isArray(s.pits)) setResumeOffer(s); });
  }, []);
  const applyResume = () => {
    const s = resumeOffer; if (!s) return;
    setPits(s.pits); pitsRef.current = s.pits;
    setPlayer(s.currentPlayer || 1); playerRef.current = s.currentPlayer || 1;
    setMoves(s.moves || 0); movesRef.current = s.moves || 0;
    setDone(false); doneRef.current = false;
    setResumeOffer(null);
  };
  const dismissResume = () => { setResumeOffer(null); clearState(); };

  const startSession = async () => {
    sessionIdRef.current = null;
    nonceRef.current = null;
    moveLogRef.current = [];
    const result = await mncStartSession(difficulty);
    if (result) {
      sessionIdRef.current = result.sessionId;
      nonceRef.current = result.nonce;
    }
  };

  useEffect(() => { resetGame(); }, [resetKey]);

  const resetGame = () => {
    animatingRef.current = false;
    cancelAiTimers();
    if (winTimerRef.current) { clearTimeout(winTimerRef.current); winTimerRef.current = null; }
    setPits(mncInitBoard());
    setPlayer(1);
    setDone(false);
    setWinner(null);
    setMoves(0);
    setFlashPits(new Set());
    setCaptureFlash(new Set());
    setBannerMsg('');
    setAiThinking(false);
    setVerifying(false);
    setVerified(null);
    startSession();
  };

  useEffect(() => { startSession(); }, []);

  const finishMove = (newPits, currentPlayer, extraTurn, captureFrom, newMoves) => {
    const p = newPits.slice();
    const p1Empty = p.slice(0, 6).every(v => v === 0);
    const p2Empty = p.slice(7, 13).every(v => v === 0);
    const isGameOver = p1Empty || p2Empty;
    if (isGameOver) {
      for (let i = 0; i < 6;  i++) { p[6]  += p[i]; p[i]  = 0; }
      for (let i = 7; i < 13; i++) { p[13] += p[i]; p[i]  = 0; }
    }
    setPits(p);
    setMoves(newMoves);
    onStepChange(newMoves);
    if (isGameOver) {
      cancelAiTimers();
      const w = p[6] > p[13] ? 1 : p[13] > p[6] ? 2 : 'draw';
      setWinner(w);
      setDone(true);
      doneRef.current = true;
      setAiThinking(false);
      clearState(); // a finished bot game has no save to resume
      const wLabel = w === 1 ? 'You win! 🎉' : w === 2 ? 'AI wins! 🤖' : "It's a draw! 🤝";
      setBannerMsg(wLabel);
      const entry = {
        id: String(Date.now()),
        date: new Date().toISOString().slice(0, 10),
        winner: w,
        p1Score: p[6],
        p2Score: p[13],
        moves: newMoves,
        secs: secsRef.current,
        mode: 'ai',
        difficulty,
      };
      mncSaveEntry(entry);
      setHistory(mncLoadHistory());

      // ZK verify on player win, then fire onWin
      const finalSecs = secsRef.current;
      const base = Math.max(Math.abs(p[6] - p[13]) * 15 - finalSecs, 50);
      const share = `Mancala vs AI (${difficulty}) — 🫘 You ${p[6]} · AI ${p[13]} · ${newMoves} moves · ${finalSecs}s`;

      if (w === 1 && sessionIdRef.current && nonceRef.current) {
        setVerifying(true);
        const sid = sessionIdRef.current;
        const nonce = nonceRef.current;
        const log = moveLogRef.current.slice();
        const fp = p.slice();
        // Race: verify within 3s max, then proceed regardless
        const verifyTimeout = setTimeout(() => {
          setVerifying(false);
          setVerified(false);
          winTimerRef.current = setTimeout(() => {
            winTimerRef.current = null;
            setBannerMsg('');
            onWin(base, newMoves, finalSecs, { winner: w, share, verified: false });
          }, 500);
        }, 3000);
        mncVerifySession(sid, nonce, log, fp, finalSecs).then(result => {
          clearTimeout(verifyTimeout);
          setVerifying(false);
          const ok = result && result.verified;
          setVerified(ok);
          winTimerRef.current = setTimeout(() => {
            winTimerRef.current = null;
            setBannerMsg('');
            onWin(ok ? (result.score || base) : base, newMoves, finalSecs, { winner: w, share, verified: ok });
          }, 600);
        });
      } else {
        winTimerRef.current = setTimeout(() => {
          winTimerRef.current = null;
          setBannerMsg('');
          onWin(w === 1 ? base : w === 'draw' ? 50 : 0, newMoves, finalSecs, { winner: w, share, verified: false });
        }, 1500);
      }
    } else if (extraTurn) {
      setBannerMsg(currentPlayer === 2 ? 'AI gets another turn! 🔄' : 'Extra turn! 🔄');
      setTimeout(() => setBannerMsg(m => (m === 'Extra turn! 🔄' || m === 'AI gets another turn! 🔄') ? '' : m), 1200);
      // The AI keeps the turn on an extra turn; the [player, done] effect
      // won't re-fire (player is unchanged), so re-arm the AI loop directly.
      if (currentPlayer === 2) scheduleAiMove();
    } else {
      if (currentPlayer === 2) cancelAiTimers();
      setPlayer(currentPlayer === 1 ? 2 : 1);
      setBannerMsg('');
    }
  };

  const applyMove = (idx, currentPlayer) => {
    if (animatingRef.current) return;
    const curPits = pitsRef.current;
    if (curPits[idx] === 0) return;
    const { sequence, pits: newPits, extraTurn, captureFrom } = mncDistribute(curPits, idx, currentPlayer);
    const newMoves = movesRef.current + 1;
    moveLogRef.current.push(idx);
    animatingRef.current = true;
    const working = curPits.slice();
    working[idx] = 0;
    setPits(working.slice());
    setFlashPits(new Set());
    let step = 0;
    const animate = () => {
      if (!animatingRef.current) { setFlashPits(new Set()); return; }
      if (step >= sequence.length) {
        setFlashPits(new Set());
        if (captureFrom >= 0) {
          setCaptureFlash(new Set([captureFrom]));
          setTimeout(() => {
            if (!animatingRef.current) return;
            setCaptureFlash(new Set());
            animatingRef.current = false;
            finishMove(newPits, currentPlayer, extraTurn, captureFrom, newMoves);
          }, 350);
        } else {
          animatingRef.current = false;
          finishMove(newPits, currentPlayer, extraTurn, captureFrom, newMoves);
        }
        return;
      }
      working[sequence[step]]++;
      setPits(working.slice());
      setFlashPits(new Set([sequence[step]]));
      if (soundOnRef.current) mncPlayClick();
      step++;
      // Reduced motion means reduced motion: the stones still land in order,
      // they just stop waiting to be watched.
      setTimeout(animate, cgReducedMotion() ? 0 : mncSowDelay(sequence.length));
    };
    setTimeout(animate, 0);
  };
  applyMoveRef.current = applyMove;

  // --- AI turn loop -------------------------------------------------------
  // Cancel any pending AI thinking timer + watchdog.
  const cancelAiTimers = () => {
    if (aiTimerRef.current)    { clearTimeout(aiTimerRef.current);    aiTimerRef.current = null; }
    if (aiWatchdogRef.current) { clearTimeout(aiWatchdogRef.current); aiWatchdogRef.current = null; }
  };

  // Settle every remaining stone into its owner's store and end the game.
  // Used when the AI has no legal move, or as the watchdog's last resort so
  // the board can never stay frozen on "AI is thinking…".
  const forceEndGame = () => {
    cancelAiTimers();
    if (doneRef.current) return;
    const p = pitsRef.current.slice();
    for (let i = 0; i < 6;  i++) { p[6]  += p[i]; p[i] = 0; }
    for (let i = 7; i < 13; i++) { p[13] += p[i]; p[i] = 0; }
    animatingRef.current = false;
    setAiThinking(false);
    // p has both sides empty, so finishMove detects game-over and runs the
    // full winner / history / ZK / onWin flow exactly as a normal end would.
    finishMove(p, 2, false, -1, movesRef.current);
  };

  // Last-resort safety net: if the AI ever fails to produce a move within a
  // generous window, force the game to a result rather than hang forever.
  const armWatchdog = () => {
    if (aiWatchdogRef.current) { clearTimeout(aiWatchdogRef.current); aiWatchdogRef.current = null; }
    aiWatchdogRef.current = setTimeout(() => {
      aiWatchdogRef.current = null;
      if (doneRef.current || playerRef.current !== 2) return;
      // A real move may still be animating — give it more time, don't cut in.
      if (animatingRef.current) { armWatchdog(); return; }
      forceEndGame();
    }, 12000);
  };

  // Compute and play the AI's move. Defends against a thrown engine, a missing
  // legal move, and a still-running animation (retry instead of dropping it).
  const performAiMove = () => {
    aiTimerRef.current = null;
    if (doneRef.current || playerRef.current !== 2) { setAiThinking(false); return; }
    if (animatingRef.current) {
      // Previous animation hasn't settled yet — retry shortly so the busy
      // guard in applyMove never silently swallows the AI's move.
      aiTimerRef.current = setTimeout(performAiMove, 120);
      return;
    }
    let idx = -1;
    try {
      idx = mncAIMove(pitsRef.current, difficulty);
    } catch (e) {
      const legal = mncGetValidMoves(pitsRef.current, 2);
      idx = legal.length ? legal[Math.floor(Math.random() * legal.length)] : -1;
    }
    if (idx < 0) { setAiThinking(false); forceEndGame(); return; }
    setAiThinking(false);
    applyMoveRef.current(idx, 2);
  };

  // Arm a single AI step (thinking delay + watchdog). Cancels any prior timer
  // first, so chained extra turns never stack up.
  const scheduleAiMove = () => {
    if (aiTimerRef.current) { clearTimeout(aiTimerRef.current); aiTimerRef.current = null; }
    if (doneRef.current || playerRef.current !== 2) return;
    setAiThinking(true);
    armWatchdog();
    const delay = difficulty === 'easy' ? 500 : difficulty === 'medium' ? 700 : 1100;
    aiTimerRef.current = setTimeout(performAiMove, delay);
  };

  // Kick off the AI loop whenever it becomes P2's turn. Chained extra turns
  // are re-armed from finishMove (player is unchanged, so this won't re-fire).
  useEffect(() => {
    if (player !== 2 || done) { cancelAiTimers(); return; }
    scheduleAiMove();
    return () => cancelAiTimers();
  }, [player, done]);

  // Cancel all AI timers on unmount.
  useEffect(() => () => cancelAiTimers(), []);

  const handlePitClick = (idx) => {
    if (player !== 1 || done || animatingRef.current) return;
    if (idx < 0 || idx > 5 || pits[idx] === 0) return;
    applyMove(idx, 1);
  };

  const p1Color = C.accent;
  const p2Color = C.rose;
  const activeColor = player === 1 ? p1Color : p2Color;

  const aiHistory = history.filter(h => h.mode === 'ai');
  const stats = aiHistory.reduce(
    (acc, h) => { acc.total++; if (h.winner === 1) acc.wins++; else if (h.winner === 2) acc.losses++; else acc.draws++; return acc; },
    { total: 0, wins: 0, losses: 0, draws: 0 },
  );
  const fmtDate = (d) => { const [y, m, day] = d.split('-'); return `${m}/${day}/${y.slice(2)}`; };

  return (
    <div>
      {resumeOffer && <ClassicResumeBanner onResume={applyResume} onDismiss={dismissResume} />}
      <CuiBar height={72} build={(W) => {
        /* #202 — the two stores are SCORES and belong in pills, not painted
           over the seed pile they are counting.

           The pill they replace was "ZK", a verified/unverified indicator with
           a tick, a cross and a lightning bolt. #224 has just removed every
           other one of those at an admin's request; this was a third surface
           nobody had spotted, and the HUD needed the room. The verification
           itself is untouched — it is the READ-OUT that goes, exactly as in
           #224. */
        const pr = cuiRow(0, 0, W, 46, 4);
        return [
          { id: 'p-you', kind: 'pill', r: pr[0], label: 'You', value: pits[6], color: palOf(p1Color, undefined) },
          { id: 'p-ai', kind: 'pill', r: pr[1], label: 'AI', value: pits[13], color: palOf(p2Color, undefined) },
          { id: 'p-time', kind: 'pill', r: pr[2], label: 'Time', value: fmt, gold: true },
          { id: 'p-diff', kind: 'pill', r: pr[3], label: 'Diff', value: String(difficulty).toUpperCase() },
          { id: 'banner', kind: 'label', r: [0, 50, W, 20], font: 12.5, bold: true, color: done ? PAL.muted : palOf(activeColor, undefined),
            label: done
              ? (winner === 'draw' ? "Game over — It's a draw! 🤝" : winner === 1 ? 'Game over — You win! 🎉' : 'Game over — AI wins! 🤖')
              : player === 2 ? 'AI is thinking… 🤖' : 'Your turn' },
        ];
      }} />

      <MncBoardCanvas
        pits={pits}
        pitState={(idx) => ({
          clickable: !done && player === 1 && idx <= 5 && pits[idx] > 0 && !animatingRef.current,
          flash: flashPits.has(idx),
          capture: captureFlash.has(idx),
        })}
        storeGlowL={!done && player === 2 ? p2Color : null}
        storeGlowR={!done && player === 1 ? p1Color : null}
        labelL="AI"
        labelR="You"
        onPit={handlePitClick}
      />

      {bannerMsg && <div className="mnc-banner">{bannerMsg}</div>}

      <div className="mnc-controls">
        <button onClick={resetGame}>↺ New Game</button>
        <button onClick={() => { const next = !soundOn; setSoundOn(next); soundOnRef.current = next; try { localStorage.setItem(MNC_SOUND_KEY, next ? '1' : '0'); } catch {} }}>
          {soundOn ? '🔊' : '🔇'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: '0', marginTop: '1.25rem', borderBottom: `1px solid ${C.border}` }}>
        {['game', 'leaderboard'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1, padding: '0.45rem', fontSize: '0.82rem', fontWeight: activeTab === tab ? 700 : 400,
              background: 'none', border: 'none', borderBottom: activeTab === tab ? `2px solid ${C.accent}` : '2px solid transparent',
              color: activeTab === tab ? C.accent : C.muted, cursor: 'pointer', textTransform: 'capitalize',
            }}
          >{tab === 'game' ? '📊 Stats' : '🏆 Leaderboard'}</button>
        ))}
      </div>

      {activeTab === 'game' && aiHistory.length > 0 && (
        <div className="mnc-stats-grid" style={{ marginTop: '0.75rem' }}>
          <div className="mnc-stat-card"><div className="mnc-stat-val">{stats.total}</div><div className="mnc-stat-lbl">Games</div></div>
          <div className="mnc-stat-card"><div className="mnc-stat-val" style={{ color: p1Color }}>{stats.wins}</div><div className="mnc-stat-lbl">Wins</div></div>
          <div className="mnc-stat-card"><div className="mnc-stat-val" style={{ color: p2Color }}>{stats.losses}</div><div className="mnc-stat-lbl">Losses</div></div>
          <div className="mnc-stat-card"><div className="mnc-stat-val" style={{ color: C.muted }}>{stats.draws}</div><div className="mnc-stat-lbl">Draws</div></div>
        </div>
      )}
      {activeTab === 'game' && aiHistory.length === 0 && (
        <div style={{ textAlign: 'center', color: C.muted, fontSize: '0.82rem', padding: '1rem 0' }}>No games yet — play one!</div>
      )}
      {activeTab === 'leaderboard' && <MncLeaderboard />}
    </div>
  );
}

/* ============================================================
   Game 5c — Mancala Online variant (polling multiplayer)
   ============================================================ */
function MancalaOnlineGame({ onWin, onStepChange, roomId, myPlayerNum }) {
  const { room, pollingError, opponentDisconnected, submitMove } = useMancalaRoom(roomId);
  const [myMoves, setMyMoves] = useState(0);
  const winCalledRef = useRef(false);
  /* #145 — concede / close. The button below has been in this branch since
     #145 but its state never was, so reaching the waiting room threw a
     ReferenceError at mount (valid syntax, invisible to `npm run check`).
     Declared here because both the waiting-room branch and the live-match
     branch return early, exactly as in BoardOnlineRoom. */
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
    await api(`/api/mancala/rooms/${roomId}/finish`, {
      method: 'POST',
      body: JSON.stringify(isWaitingRoom ? {} : { winner: String(other) }),
    });
    setEnding(false);
  };
  /* #145 gave a live match the same concede affordance the five board games
     have; without it the only exit is the 48h turn timer.

     #201 moved WHERE it is offered. It sat eleven pixels under the board,
     directly beneath the row of pits a player taps to move — and there is no
     "safe" side to put it on, because whichever row is yours is the one you
     tap. It is published into the ☰ sheet's "This match" group now, off the
     board entirely and two deliberate taps away, on top of the confirm dialog
     that already guarded it. Passing null while the room is not active
     withdraws it. The waiting-room "Close this room" button below stays where
     it is: there is no board on that screen to mis-tap. */
  useCgShellAction(room && room.status === 'active' ? {
    id: 'endgame', danger: true, disabled: ending,
    label: ending ? 'Ending…' : '🏳️ End game',
    onSelect: () => endGame(false),
  } : null);
  const { secs, fmt } = useTimer(!!(room && room.status === 'active'));
  const secsRef = useRef(0);
  secsRef.current = secs;

  useEffect(() => {
    if (!room || room.status !== 'finished' || winCalledRef.current) return;
    winCalledRef.current = true;
    const p = room.pits;
    const w = room.winner;
    const youWin = (w === String(myPlayerNum));
    const isDraw  = (w === 'draw');
    const base = Math.max(Math.abs(p[6] - p[13]) * 15 - secsRef.current, 50);
    const date = new Date().toISOString().slice(0, 10);
    const share = `Mancala Online ${date} — 🫘 P1 ${p[6]} · P2 ${p[13]} · ${secsRef.current}s`;
    onWin(youWin ? base : isDraw ? 50 : 0, myMoves, secsRef.current, { winner: w, share });
  }, [room && room.status]);

  if (!room && !pollingError) {
    return (
      <div style={{ textAlign: 'center', padding: '2rem' }}>
        <div className="mnc-spinner" style={{ margin: '0 auto 0.75rem' }} />
        <div style={{ color: C.muted, fontSize: '0.85rem' }}>Connecting…</div>
      </div>
    );
  }

  if (pollingError === 'room_not_found') {
    return <div style={{ textAlign: 'center', padding: '1.5rem', color: C.rose }}>Room not found.</div>;
  }

  const pits = room ? room.pits : Array(14).fill(0);
  const status = room ? room.status : 'waiting';
  const currentPlayer = room ? room.currentPlayer : null;
  const isMyTurn = status === 'active' && currentPlayer === myPlayerNum;
  const p1Color = C.accent;
  const p2Color = C.rose;
  const myColor = myPlayerNum === 1 ? p1Color : p2Color;

  if (status === 'waiting') {
    return (
      <div style={{ textAlign: 'center', padding: '1rem 0' }}>
        <div style={{ color: C.muted, marginBottom: '0.6rem', fontSize: '0.85rem' }}>Waiting for opponent to join…</div>
        <div className="mnc-room-code">{roomId}</div>
        <div style={{ color: C.muted, fontSize: '0.78rem', marginTop: '0.4rem' }}>Share this room code</div>
        <div className="mnc-spinner" style={{ margin: '1rem auto 0' }} />
        {/* #145 — close a room nobody joined. No opponent, so the server can't
            rate it: it just goes finished and stops showing in Your rooms. */}
        <button className="brd-endgame" onClick={() => endGame(true)} disabled={ending}>
          {ending ? 'Closing…' : 'Close this room'}
        </button>
      </div>
    );
  }

  const handleClick = (idx) => {
    if (!isMyTurn) return;
    const ownMin = myPlayerNum === 1 ? 0 : 7;
    const ownMax = myPlayerNum === 1 ? 5 : 12;
    if (idx < ownMin || idx > ownMax || pits[idx] === 0) return;
    const next = myMoves + 1;
    setMyMoves(next);
    onStepChange(next);
    submitMove(idx);
  };


  const p1Name = room && room.player1Name ? room.player1Name : 'P1';
  const p2Name = room && room.player2Name ? room.player2Name : 'P2';
  const myName  = myPlayerNum === 1 ? p1Name : p2Name;
  const oppName = myPlayerNum === 1 ? p2Name : p1Name;

  const turnLabel = status === 'finished'
    ? (room.winner === String(myPlayerNum) ? 'You win! 🎉' : room.winner === 'draw' ? "Draw! 🤝" : `${oppName} wins!`)
    : isMyTurn ? 'Your turn' : `${oppName}'s turn`;

  return (
    <div>
      <CuiBar height={opponentDisconnected ? 68 : 46} build={(W) => {
        const pr = cuiRow(0, 0, W, 46, 4);
        const out = [
          { id: 'p-p1', kind: 'pill', r: pr[0], label: 'P1', value: pits[6] },
          { id: 'p-p2', kind: 'pill', r: pr[1], label: 'P2', value: pits[13] },
          { id: 'p-turn', kind: 'pill', r: pr[2], label: 'Turn', value: turnLabel, color: isMyTurn ? palOf(myColor, undefined) : PAL.muted },
          { id: 'p-conn', kind: 'pill', r: pr[3], label: 'Online', value: opponentDisconnected ? '●' : '●', color: opponentDisconnected ? PAL.gold : PAL.emerald },
        ];
        if (opponentDisconnected) {
          out.push({ id: 'disc', kind: 'label', r: [0, 50, W, 18], label: 'Opponent connection lost — waiting for reconnect…', gold: true, font: 12 });
        }
        return out;
      }} />

      <MncBoardCanvas
        pits={pits}
        pitState={(idx) => {
          const isP1Pit = idx <= 5;
          const isMyPit = myPlayerNum === 1 ? isP1Pit : !isP1Pit;
          return { clickable: isMyTurn && isMyPit && pits[idx] > 0, flash: false, capture: false };
        }}
        storeGlowL={currentPlayer === 2 && status === 'active' ? p2Color : null}
        storeGlowR={currentPlayer === 1 && status === 'active' ? p1Color : null}
        labelL={myPlayerNum === 2 ? 'You' : oppName}
        labelR={myPlayerNum === 1 ? 'You' : oppName}
        onPit={handleClick}
      />
    </div>
  );
}

/* ============================================================
   Game 5 — Mancala wrapper (delegates to mode sub-components)
   ============================================================ */
function MancalaGame({ onWin, onStepChange, resetKey, gameMode, gameModeOpts, onModeChange, offset }) {
  /* #176 — the Daily Challenge is RETIRED. It was a second, entirely parallel
     daily system: its own table, routes, resume, record-streak and Today /
     All-Time leaderboard, none of it wired into daily_attempts. Rather than
     converge two daily systems, Mancala goes back to being purely a
     head-to-head game — its axis is the opponent, not the play mode.

     The opponent is now chosen BEFORE the game mounts, on the shared opponent
     screen, exactly as it is for the other six head-to-head games. Mancala
     therefore reads `gameMode` / `gameModeOpts` instead of asking again — the
     same contract ChutesLaddersGame uses. Its internal names predate the
     shared ones, hence the one-line translation. */
  const modeFromProps = (m) => (m === 'bot' ? 'ai' : m === '2p' ? 'local' : m === 'online' ? 'online' : null);
  const [mode, setMode]               = useState(() => modeFromProps(gameMode));
  const [difficulty, setDifficulty]   = useState((gameModeOpts && gameModeOpts.botLevel) || 'medium');
  const [roomId, setRoomId]           = useState((gameModeOpts && gameModeOpts.roomId) || null);
  const [myPlayerNum, setMyPlayerNum] = useState(
    gameModeOpts && gameModeOpts.myPlayerNum
      ? gameModeOpts.myPlayerNum
      : gameModeOpts && gameModeOpts.roomAction === 'join' ? 2 : 1
  );

  // Re-derive on "Play Again" / Game-Menu New Game: the menu's picker is the
  // same ClassicModePicker, so a new choice arrives as new props.
  useEffect(() => {
    setMode(modeFromProps(gameMode));
    if (gameModeOpts && gameModeOpts.botLevel) setDifficulty(gameModeOpts.botLevel);
    if (gameModeOpts && gameModeOpts.roomId) {
      setRoomId(gameModeOpts.roomId);
      setMyPlayerNum(gameModeOpts.myPlayerNum || (gameModeOpts.roomAction === 'join' ? 2 : 1));
    }
  }, [gameMode, gameModeOpts, resetKey]);

  // Report the active mode upward so the top-bar pill + Save toggle reflect it.
  useEffect(() => {
    if (!onModeChange) return;
    onModeChange(mode === 'ai' ? 'bot' : mode === 'local' ? '2p' : mode === 'online' ? 'online' : null);
  }, [mode]);

  // No mode yet means the player reached the board without passing the
  // opponent screen (a bare deep link). Send them back to it rather than
  // rendering a second, divergent picker here.
  if (!mode) {
    return (
      <div className="mnc-mode-select" style={{ padding: 0 }}>
        <ClassicModePicker
          game={GAMES.find(g => g.id === 'mancala')}
          onPlay={(m, opts) => {
            setDifficulty((opts && opts.botLevel) || 'medium');
            if (opts && opts.roomId) {
              setRoomId(opts.roomId);
              setMyPlayerNum(opts.myPlayerNum || (opts.roomAction === 'join' ? 2 : 1));
            }
            setMode(modeFromProps(m));
          }}
        />
      </div>
    );
  }

  if (mode === 'local') return React.createElement(MancalaLocalGame, { onWin, onStepChange, resetKey });
  if (mode === 'ai')    return React.createElement(MancalaAIGame,    { onWin, onStepChange, resetKey, difficulty });
  if (mode === 'online') return React.createElement(MancalaOnlineGame, { onWin, onStepChange, roomId, myPlayerNum });
  return null;
}
