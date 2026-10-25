/* ============================================================
   Chutes & Ladders — 2-player local (pass-and-play) classic game
   ============================================================ */
// Standard Milton-Bradley layout. Ladders climb (bottom -> top),
// chutes slide (top -> bottom). One flat map keyed by landing square.
const CNL_LADDERS = { 1: 38, 4: 14, 9: 31, 21: 42, 28: 84, 36: 44, 51: 67, 71: 91, 80: 100 };
const CNL_CHUTES  = { 16: 6, 47: 26, 49: 11, 56: 53, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 78 };
const CNL_JUMPS   = Object.assign({}, CNL_LADDERS, CNL_CHUTES);

/* ---- Moksha Patam — the original Indian board (slice 7) --------------------
   Ladders sit on VIRTUES, snakes on VICES, and vices outnumber virtues 11 to 5.
   That imbalance is the moral point the original was making, and it makes the
   climb genuinely slower than the Milton-Bradley board — which is why Classic
   stays the default and this is opt-in per game.

   These tables MUST stay byte-identical to CNL_MOKSHA_* in lib/board-rules.js:
   the server referees online rooms off its copy and the client renders off
   this one. Square numbers follow the commonly published Moksha Patam
   virtue/vice list; the DESTINATIONS are this app's balance choice, not
   historical record (surviving boards disagree with each other). */
const CNL_MOKSHA_LADDERS = { 12: 38, 51: 67, 57: 74, 76: 91, 78: 97 };
const CNL_MOKSHA_CHUTES  = {
  41: 20, 44: 22, 49: 9, 52: 35, 58: 40, 62: 19, 69: 33, 84: 63, 92: 73, 95: 24, 98: 78,
};
const CNL_MOKSHA_JUMPS = Object.assign({}, CNL_MOKSHA_LADDERS, CNL_MOKSHA_CHUTES);

// Square → { name, sanskrit, blurb }. Drives the on-board labels, the landing
// banner and the glossary modal.
const CNL_MOKSHA_MEANINGS = {
  12: { name: 'Faith',        sanskrit: 'Shraddha',  blurb: 'Trust in the path — the first step that makes any climb possible.' },
  51: { name: 'Reliability',  sanskrit: 'Vishwas',   blurb: 'Being someone others can depend on, steadily and without fuss.' },
  57: { name: 'Generosity',   sanskrit: 'Dāna',      blurb: 'Giving freely, without keeping score of what was given.' },
  76: { name: 'Knowledge',    sanskrit: 'Jñāna',     blurb: 'Understanding that changes how you act, not just what you know.' },
  78: { name: 'Asceticism',   sanskrit: 'Tapas',     blurb: 'Disciplined restraint — the last stretch before liberation.' },
  41: { name: 'Disobedience', sanskrit: 'Avajña',    blurb: 'Disregarding good counsel, and sliding back for it.' },
  44: { name: 'Arrogance',    sanskrit: 'Ahankara',  blurb: 'The ego that mistakes itself for the whole self.' },
  49: { name: 'Vulgarity',    sanskrit: 'Ashlilata', blurb: 'Coarseness of speech and conduct that drags others down too.' },
  52: { name: 'Theft',        sanskrit: 'Chaurya',   blurb: 'Taking what was never offered.' },
  58: { name: 'Lying',        sanskrit: 'Asatya',    blurb: 'Untruth — the vice that quietly undoes every other virtue.' },
  62: { name: 'Drunkenness',  sanskrit: 'Madya',     blurb: 'Intoxication that clouds judgement and loosens restraint.' },
  69: { name: 'Debt',         sanskrit: 'Rina',      blurb: 'Obligation left unsettled, weighing on every step after.' },
  84: { name: 'Anger',        sanskrit: 'Krodha',    blurb: 'Rage that burns away progress made patiently.' },
  92: { name: 'Greed',        sanskrit: 'Lobha',     blurb: 'Wanting more precisely when you already have enough.' },
  95: { name: 'Pride',        sanskrit: 'Mada',      blurb: 'Conceit near the summit — the longest fall on the board.' },
  98: { name: 'Lust',         sanskrit: 'Kama',      blurb: 'Craving two squares from liberation, back to where discipline begins.' },
};

const CNL_VARIANTS = {
  classic: { label: 'Classic', ladders: CNL_LADDERS, chutes: CNL_CHUTES, jumps: CNL_JUMPS },
  moksha:  { label: 'Moksha Patam', ladders: CNL_MOKSHA_LADDERS, chutes: CNL_MOKSHA_CHUTES, jumps: CNL_MOKSHA_JUMPS },
};
function cnlVariant(v) { return CNL_VARIANTS[v] ? v : 'classic'; }

// Standard 1-6 pip layouts on a 3x3 grid (row-major, 1 = pip present).
const CNL_DIE_PIPS = {
  1: [0, 0, 0, 0, 1, 0, 0, 0, 0],
  2: [1, 0, 0, 0, 0, 0, 0, 0, 1],
  3: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  4: [1, 0, 1, 0, 0, 0, 1, 0, 1],
  5: [1, 0, 1, 0, 1, 0, 1, 0, 1],
  6: [1, 0, 1, 1, 0, 1, 1, 0, 1],
};

// Cosmetic (client-only, per-device) Classic-board skins. These substitute
// only the ladder/chute glyphs and the label shown in the picker — the
// mechanical variant (ladders/chutes tables) is untouched, so a skin never
// needs to reach the server. Disabled when the mechanical variant is
// 'moksha' (which has its own snake/virtue art baked into the board).
const CNL_SKINS = {
  plain:   { label: 'Classic', icon: '🪜', ladderMark: '🪜', chuteMark: '🛝' },
  jungle:  { label: 'Jungle Vine', icon: '🌿', ladderMark: '🌿', chuteMark: '🐊' },
  space:   { label: 'Star Voyage', icon: '🚀', ladderMark: '🚀', chuteMark: '☄️' },
  pirate:  { label: 'Treasure Trail', icon: '🏴‍☠️', ladderMark: '⚓', chuteMark: '🦑' },
};
const CNL_SKIN_KEY = 'puzzlechain_cnl_skin';
function cnlSkinId(v) { return CNL_SKINS[v] ? v : 'plain'; }
function useCnlSkin() {
  const [skin, setSkinState] = useState(() => {
    // ?cnlskin=<id> is a screenshot-state deep link — it lets proposal tests
    // and before/after captures reach a skin that's otherwise only chosen by
    // clicking a pill, and it wins over the stored device preference.
    try {
      const q = new URLSearchParams(window.location.search).get('cnlskin');
      if (q && CNL_SKINS[q]) return q;
    } catch (e) {}
    try { return cnlSkinId(localStorage.getItem(CNL_SKIN_KEY)); } catch (e) { return 'plain'; }
  });
  const setSkin = (v) => {
    const id = cnlSkinId(v);
    setSkinState(id);
    try { localStorage.setItem(CNL_SKIN_KEY, id); } catch (e) {}
  };
  return [skin, setSkin];
}

// The glossary — reachable from the mode picker and the in-game header, so a
// player can read what a square means before or during a game.
function MokshaGlossaryModal({ onClose }) {
  const row = (sq, kind) => {
    const m = CNL_MOKSHA_MEANINGS[sq];
    const dest = CNL_MOKSHA_JUMPS[sq];
    return (
      <div key={sq} className="mok-row">
        <span className={'mok-sq ' + kind}>{sq}</span>
        <span className="mok-body">
          <span className="mok-name">
            {m.name} <em>({m.sanskrit})</em>
            <span className="mok-dest">{kind === 'up' ? '↑' : '↓'} {dest}</span>
          </span>
          <span className="mok-blurb">{m.blurb}</span>
        </span>
      </div>
    );
  };
  return (
    <div className="howto-overlay" onClick={onClose}>
      <div className="howto-card" onClick={(e) => e.stopPropagation()}>
        <h3>📖 Moksha Patam — what the squares mean</h3>
        <p className="mok-intro">
          Long before it was a children's board game, this was a teaching tool from
          India. Every ladder sits on a virtue and every snake on a vice, and the
          vices deliberately outnumber the virtues — progress up the board was meant
          to feel hard-won. Square 100 is <b>Moksha</b>: liberation.
        </p>
        <div className="mok-section">Virtues — ladders up</div>
        {Object.keys(CNL_MOKSHA_LADDERS).map(Number).sort((a, b) => a - b).map((s) => row(s, 'up'))}
        <div className="mok-section">Vices — snakes down</div>
        {Object.keys(CNL_MOKSHA_CHUTES).map(Number).sort((a, b) => a - b).map((s) => row(s, 'down'))}
        <button className="primary-btn" onClick={onClose}>Got it</button>
      </div>
    </div>
  );
}

// Map a square number (1..100) to {row, col} on the boustrophedon board.
// row 0 is the BOTTOM row (squares 1..10), row 9 is the TOP (91..100).
// Even rows (0-indexed from bottom) run left->right; odd rows right->left.
function cnlRowCol(n) {
  const idx = n - 1;            // 0-based
  const row = Math.floor(idx / 10);
  const within = idx % 10;
  const col = (row % 2 === 0) ? within : (9 - within);
  return { row, col };
}

// Center of a square as a percentage of the board box (for SVG + pawns).
// Visual row 0 sits at the BOTTOM, so flip for top-origin coordinates.
/* The Snakes & Ladders board as ONE canvas shared by local and online play
   (#170 treatment): cells, the connector lines (Moksha's snakes keep their
   slither curves), the square marks/names, and both pawns — which glide
   between squares with the same 130ms ease the DOM transition gave them.
   Display-only: the Roll buttons are the input. Chrome reads PAL; the two
   pawn colors come from the callers, as before. */
function CnlBoardCanvas({ V, isMoksha, SK, p1Pos, p2Pos, p1Color, p2Color, p2Glyph }) {
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const { boxW } = useFitBox(boxRef, { cols: 10, rows: 10 });
  const side = Math.max(0, Math.floor(boxW));

  // Pawn glide: remember each pawn's previous square and lerp for 130ms.
  const glideRef = useRef({ p1: { from: p1Pos, to: p1Pos, t0: 0 }, p2: { from: p2Pos, to: p2Pos, t0: 0 } });
  const [, setGlideFrame] = useState(0);
  useEffect(() => {
    const g = glideRef.current;
    let changed = false;
    for (const [key, pos] of [['p1', p1Pos], ['p2', p2Pos]]) {
      if (g[key].to !== pos) { g[key] = { from: g[key].to, to: pos, t0: performance.now() }; changed = true; }
    }
    if (!changed) return;
    let raf = 0;
    const tick = () => {
      setGlideFrame((f) => f + 1);
      const now = performance.now();
      if (now - g.p1.t0 < 140 || now - g.p2.t0 < 140) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [p1Pos, p2Pos]);

  useCanvasBoard(canvasRef, {
    width: side,
    height: side,
    deps: [p1Pos, p2Pos, V, isMoksha, side, SK && SK.label, p2Glyph],
    draw: (ctx) => {
      if (side < 80) return;
      const pad = 4;
      const inner = side - pad * 2;
      const cs = inner / 10;
      const pct = (p) => [pad + (p.x / 100) * inner, pad + (p.y / 100) * inner];
      ctx.textBaseline = 'top';
      for (let visualRow = 0; visualRow < 10; visualRow++) {
        for (let col = 0; col < 10; col++) {
          const row = 9 - visualRow;
          const within = (row % 2 === 0) ? col : (9 - col);
          const n = row * 10 + within + 1;
          const x = pad + col * cs, y = pad + visualRow * cs;
          ctx.fillStyle = n === 100 ? 'rgba(201,162,39,0.13)' : ((row + col) % 2 ? PAL.surface : PAL.card);
          ctx.fillRect(x + 0.5, y + 0.5, cs - 1, cs - 1);
          ctx.font = `600 ${Math.max(7, Math.round(cs * 0.24))}px 'JetBrains Mono', monospace`;
          ctx.textAlign = 'left';
          ctx.fillStyle = n === 100 ? PAL.gold : PAL.muted;
          ctx.fillText(String(n), x + 3, y + 2);
          const isL = V.ladders[n] !== undefined;
          const mark = isL ? (SK ? SK.ladderMark : '🪜') : V.chutes[n] !== undefined ? (isMoksha ? '🐍' : (SK ? SK.chuteMark : '🛝')) : null;
          if (mark) {
            ctx.font = `${Math.round(cs * 0.34)}px system-ui, sans-serif`;
            ctx.textAlign = 'right';
            ctx.fillText(mark, x + cs - 2, y + cs - Math.round(cs * 0.38));
          }
          const meaning = isMoksha ? CNL_MOKSHA_MEANINGS[n] : null;
          if (meaning) {
            ctx.font = `700 ${Math.max(5, Math.round(cs * 0.14))}px 'Space Grotesk', sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillStyle = isL ? PAL.emerald : PAL.rose;
            let name = meaning.name.toUpperCase();
            while (name.length > 2 && ctx.measureText(name).width > cs - 3) name = name.slice(0, -1);
            ctx.fillText(name, x + cs / 2, y + cs - Math.max(6, Math.round(cs * 0.17)));
          }
        }
      }
      // Connectors over the cells.
      for (const k of Object.keys(V.jumps)) {
        const from = parseInt(k, 10), to = V.jumps[from];
        const [ax, ay] = pct(cnlCenterPct(from));
        const [bx, by] = pct(cnlCenterPct(to));
        const isLadder = V.ladders[from] !== undefined;
        ctx.strokeStyle = isLadder ? PAL.emerald : PAL.rose;
        ctx.lineCap = 'round';
        ctx.globalAlpha = isMoksha && !isLadder ? 0.65 : 0.6;
        ctx.lineWidth = Math.max(2, side * (isMoksha && !isLadder ? 0.014 : 0.011));
        ctx.beginPath();
        if (isMoksha && !isLadder) {
          const mx = (ax + bx) / 2, my = (ay + by) / 2;
          const dx = bx - ax, dy = by - ay;
          const len = Math.max(Math.hypot(dx, dy), 0.001);
          const off = Math.min(0.09 * side, len * 0.16);
          const nx = -dy / len * off, ny = dx / len * off;
          ctx.moveTo(ax, ay);
          ctx.quadraticCurveTo((ax + mx) / 2 + nx, (ay + my) / 2 + ny, mx, my);
          ctx.quadraticCurveTo((mx + bx) / 2 - nx, (my + by) / 2 - ny, bx, by);
        } else {
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // Pawns, gliding between squares; nudged apart when sharing one.
      const g = glideRef.current;
      const now = performance.now();
      const posOf = (gp) => {
        const p = Math.min(1, (now - gp.t0) / 130);
        const e = 1 - (1 - p) * (1 - p);
        const [fx, fy] = pct(cnlCenterPct(gp.from));
        const [tx, ty] = pct(cnlCenterPct(gp.to));
        return [fx + (tx - fx) * e, fy + (ty - fy) * e];
      };
      let [x1, y1] = posOf(g.p1);
      let [x2, y2] = posOf(g.p2);
      if (g.p1.to === g.p2.to) { x1 -= side * 0.024; x2 += side * 0.024; }
      const rp = side * 0.035;
      const glyphs = { p1: '1', p2: p2Glyph || '2' };
      for (const [key, x, y, color] of [['p1', x1, y1, p1Color], ['p2', x2, y2, p2Color]]) {
        ctx.beginPath();
        if (key === 'p2') {
          // Diamond token: same shape identity as #175's DOM pawn, so the two
          // players are tellable apart by form, not colour alone.
          const rd = rp * 1.25;
          ctx.moveTo(x, y - rd); ctx.lineTo(x + rd, y); ctx.lineTo(x, y + rd); ctx.lineTo(x - rd, y); ctx.closePath();
        } else {
          ctx.arc(x, y, rp, 0, Math.PI * 2);
        }
        ctx.fillStyle = palOf(color, PAL.accent);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        ctx.font = `800 ${Math.max(7, Math.round(rp * 1.05))}px 'Space Grotesk', sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        ctx.fillText(glyphs[key], x, y + 0.5);
      }
      ctx.textBaseline = 'top';
      // Outer border.
      klRR(ctx, 1, 1, side - 2, side - 2, 12);
      ctx.lineWidth = 2;
      ctx.strokeStyle = PAL.border;
      ctx.stroke();
    },
  });

  return (
    <div className="cnl-board-canvas-fill" ref={boxRef}>
      <canvas
        ref={canvasRef}
        className="cnl-canvas board-canvas"
        role="img"
        data-cnl-p2="diamond"
        aria-label={`Board — player 1 (round token) on square ${p1Pos || 0}, player 2 (diamond token${p2Glyph === '🤖' ? ', bot' : ''}) on square ${p2Pos || 0}`}
      />
    </div>
  );
}

function cnlCenterPct(n) {
  if (n <= 0) return { x: 50, y: 104 }; // off-board: just below the board
  const { row, col } = cnlRowCol(n);
  const visualRow = 9 - row;
  return { x: (col + 0.5) * 10, y: (visualRow + 0.5) * 10 };
}

// Local Chutes & Ladders board: hotseat 2-player, or vs Bot (P2 auto-rolls).
// `initialState` (a saved bot snapshot) offers an in-stage Resume banner.
function ChutesLaddersLocalGame({ onWin, onStepChange, resetKey, vsBot, initialState, onClearSave, variant, onGlossary }) {
  // Board tables for the chosen style. `variant` is 'classic' | 'moksha'.
  const vkey = cnlVariant(variant);
  const V = CNL_VARIANTS[vkey];
  const isMoksha = vkey === 'moksha';
  // Cosmetic board skin — a local per-device preference, independent of the
  // server-synced mechanical variant. Only applies on the Classic board.
  const [skin, setSkin] = useCnlSkin();
  const SK = CNL_SKINS[isMoksha ? 'plain' : skin];
  const cycleSkin = () => {
    const ids = Object.keys(CNL_SKINS);
    setSkin(ids[(ids.indexOf(skin) + 1) % ids.length]);
  };
  const [p1Pos, setP1Pos]   = useState(0);
  const [p2Pos, setP2Pos]   = useState(0);
  const [player, setPlayer] = useState(1);
  const [die, setDie]       = useState(null);
  const [rolls, setRolls]   = useState(0);
  const [animating, setAnimating] = useState(false);
  const [rolling, setRolling]     = useState(false);
  const [done, setDone]     = useState(false);
  const [winner, setWinner] = useState(null);
  const [banner, setBanner] = useState('');
  // Resume offer for a saved bot game; null once dismissed/applied.
  const [resumeOffer, setResumeOffer] = useState(initialState || null);

  const animatingRef = useRef(false);
  const winTimerRef  = useRef(null);
  const timersRef    = useRef([]);

  const { secs, fmt } = useTimer(!done);
  const secsRef = useRef(0);
  secsRef.current = secs;
  const rollsRef = useRef(0);
  rollsRef.current = rolls;

  const pLabel = (who) => vsBot ? (who === 1 ? 'You' : 'Bot') : `Player ${who}`;

  // Expose a save snapshot to the Game Menu while this is an active bot game.
  useClassicSaveSource(vsBot && !done, () => ({
    p1Pos, p2Pos, currentPlayer: player, rolls, secs: secsRef.current,
  }));

  const applyResume = () => {
    const s = resumeOffer; if (!s) return;
    setP1Pos(s.p1Pos || 0); setP2Pos(s.p2Pos || 0);
    setPlayer(s.currentPlayer || 1); setRolls(s.rolls || 0);
    rollsRef.current = s.rolls || 0;
    setResumeOffer(null);
  };
  const dismissResume = () => { setResumeOffer(null); if (onClearSave) onClearSave(); };

  const clearTimers = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    if (winTimerRef.current) { clearTimeout(winTimerRef.current); winTimerRef.current = null; }
  };

  const resetGame = () => {
    animatingRef.current = false;
    clearTimers();
    setP1Pos(0); setP2Pos(0);
    setPlayer(1); setDie(null); setRolls(0);
    setAnimating(false); setRolling(false);
    setDone(false); setWinner(null); setBanner('');
  };

  useEffect(() => { resetGame(); }, [resetKey]);
  useEffect(() => () => clearTimers(), []);

  const p1Color = C.accent;
  const p2Color = C.violet;
  const p1Token = 'accent';
  const p2Token = 'violet';
  const activeColor = done ? C.muted : (player === 1 ? p1Color : p2Color);
  const activeToken = done ? 'muted' : (player === 1 ? p1Token : p2Token);

  const setPos = (who, val) => { who === 1 ? setP1Pos(val) : setP2Pos(val); };

  const finishTurn = (who, landed) => {
    const jump = V.jumps[landed];
    // The win check must look at where the turn actually ENDS. A jump (e.g.
    // the 80->100 ladder) moves the pawn past `landed`, so checking `landed`
    // itself misses every jump-into-100 case and soft-locks the game.
    const finalSquare = jump !== undefined ? jump : landed;
    const settle = () => {
      // Win check: must land exactly on 100 (no chute sits on 100).
      if (finalSquare === 100) {
        setDone(true);
        setWinner(who);
        if (onClearSave) onClearSave();
        const label = `${pLabel(who)} win${vsBot && who === 1 ? '' : (vsBot ? 's' : 's')}! 🎉`;
        setBanner(label);
        const finalRolls = rollsRef.current;
        const finalSecs = secsRef.current;
        const score = Math.max(50, 300 - finalRolls * 5);
        const share = `🪜 Snakes & Ladders — ${pLabel(who)} won in ${finalRolls} rolls!`;
        winTimerRef.current = setTimeout(() => {
          winTimerRef.current = null;
          onWin(score, finalRolls, finalSecs, { winner: who, winnerLabel: label, share });
        }, 1300);
        return;
      }
      // Pass turn to the other player.
      animatingRef.current = false;
      setAnimating(false);
      setPlayer(who === 1 ? 2 : 1);
    };

    if (jump !== undefined) {
      // Brief pause so players see the landing, then climb/slide. On the
      // Moksha board the banner names the virtue or vice you landed on, so the
      // teaching content lands in the moment it applies.
      const isLadder = V.ladders[landed] !== undefined;
      const m = isMoksha ? CNL_MOKSHA_MEANINGS[landed] : null;
      setBanner(m
        ? `${m.name} (${m.sanskrit}) — ${isLadder ? 'climb up 🪜' : 'down you go 🐍'}`
        : (isLadder ? 'Ladder up! 🪜' : 'Down the chute! 🛝'));
      const t = setTimeout(() => {
        setPos(who, jump);
        const t2 = setTimeout(() => { setBanner(''); settle(); }, 320);
        timersRef.current.push(t2);
      }, 380);
      timersRef.current.push(t);
    } else {
      settle();
    }
  };

  const roll = (clickedWho) => {
    if (animatingRef.current || done || rolling) return;
    // Buttons pass which player tapped; ignore a tap that isn't the active player.
    if (clickedWho !== undefined && clickedWho !== player) return;
    const who = player;
    const value = Math.floor(Math.random() * 6) + 1;
    const from = who === 1 ? p1Pos : p2Pos;
    const newRolls = rolls + 1;

    setRolling(true);
    setDie(value);
    setBanner('');
    setRolls(newRolls);
    rollsRef.current = newRolls;
    onStepChange(newRolls);

    const rollT = setTimeout(() => {
      setRolling(false);

      // Overshoot 100 => stay put, pass turn.
      if (from + value > 100) {
        setBanner('Overshoot — stay put');
        const passT = setTimeout(() => {
          setBanner('');
          setPlayer(who === 1 ? 2 : 1);
        }, 700);
        timersRef.current.push(passT);
        return;
      }

      // Hop square-by-square to the landing square.
      animatingRef.current = true;
      setAnimating(true);
      const target = from + value;
      let cur = from;
      const hop = () => {
        if (!animatingRef.current) return;
        if (cur >= target) { finishTurn(who, target); return; }
        cur++;
        setPos(who, cur);
        const t = setTimeout(hop, 130);
        timersRef.current.push(t);
      };
      const t0 = setTimeout(hop, 130);
      timersRef.current.push(t0);
    }, 720);
    timersRef.current.push(rollT);
  };

  // Bot auto-rolls for Player 2 in Versus-Bot mode.
  useEffect(() => {
    if (!vsBot || done || resumeOffer) return;
    if (player !== 2 || animating || rolling) return;
    const t = setTimeout(() => roll(2), 650);
    return () => clearTimeout(t);
  }, [vsBot, player, animating, rolling, done, resumeOffer]);

  const bannerActive = !!banner;
  const bannerColor = done ? C.muted : activeColor;
  const bannerToken = done ? 'muted' : activeToken;

  return (
    <div>
      {resumeOffer && (
        <ClassicResumeBanner onResume={applyResume} onDismiss={dismissResume} />
      )}
      <CuiBar height={96} build={(W) => {
        const pr = cuiRow(0, 0, W, 46, 5);
        const out = [
          { id: 'p-time', kind: 'pill', r: pr[0], label: 'Time', value: fmt, gold: true },
          { id: 'p-turn', kind: 'pill', r: pr[1], label: 'Turn', value: done ? pLabel(winner) : pLabel(player), color: palOf(activeColor, undefined) },
          { id: 'p-1', kind: 'pill', r: pr[2], label: pLabel(1), value: p1Pos, color: palOf(p1Color, undefined) },
          { id: 'p-2', kind: 'pill', r: pr[3], label: pLabel(2), value: p2Pos, color: palOf(p2Color, undefined) },
          { id: 'p-rolls', kind: 'pill', r: pr[4], label: 'Rolls', value: rolls },
        ];
        if (isMoksha) {
          out.push({ id: 'glossary', kind: 'button', r: [Math.floor(W * 0.2), 52, Math.floor(W * 0.6), 40], label: '📖 What do these mean?', font: 12, action: onGlossary });
        } else {
          // Cosmetic board skin (per-device, never sent to the server) — the
          // same slot the Moksha board uses for its glossary button.
          out.push({ id: 'skin', kind: 'button', r: [Math.floor(W * 0.2), 52, Math.floor(W * 0.6), 40], label: `${SK.icon} ${SK.label}`, font: 12, action: cycleSkin });
        }
        return out;
      }} />

      <CuiBar height={30} build={(W) => ([{
        id: 'banner', kind: 'label', r: [0, 0, W, 28], font: 13, bold: true,
        color: palOf(bannerActive ? bannerColor : activeColor, undefined),
        label: done
          ? `Game over — ${pLabel(winner)} win${vsBot && winner === 1 ? '' : 's'}! 🎉`
          : (banner || `${pLabel(player)}'s turn`),
      }])} />

      <div className="cnl-board-wrap">
        <CnlBoardCanvas V={V} isMoksha={isMoksha} SK={SK} p1Pos={p1Pos} p2Pos={p2Pos} p1Color={p1Color} p2Color={p2Color} p2Glyph={vsBot ? '🤖' : '2'} />
      </div>

      <CuiBar height={54} build={(W) => {
        const bw = Math.floor((W - 78) / 2) - 8;
        return [
          { id: 'die', kind: 'button', r: [Math.floor(W / 2) - 24, 3, 48, 48], label: die == null ? '·' : String(die), twinLabel: die == null ? 'Die not yet rolled' : `Die showing ${die}`, pips: die == null ? null : CNL_DIE_PIPS[die], font: 20, mono: true, disabled: true },
          {
            id: 'roll1', kind: 'button', r: [4, 7, bw, 40],
            label: `${vsBot ? 'Your' : 'Player 1 -'} Roll`, solid: true, bg: palOf(p1Color, undefined), ink: '#fff',
            disabled: done || animating || rolling || player !== 1 || !!resumeOffer, action: () => roll(1),
          },
          vsBot
            ? { id: 'roll2', kind: 'button', r: [W - bw - 4, 7, bw, 40], label: player === 2 && !done ? 'Bot rolling…' : 'Bot', solid: true, bg: palOf(p2Color, undefined), ink: '#fff', disabled: true }
            : { id: 'roll2', kind: 'button', r: [W - bw - 4, 7, bw, 40], label: 'Player 2 - Roll', solid: true, bg: palOf(p2Color, undefined), ink: '#fff', disabled: done || animating || rolling || player !== 2, action: () => roll(2) },
        ];
      }} />
    </div>
  );
}

// Online Chutes & Ladders over classic_rooms. Server owns the dice; the client
// just sends a "roll" and renders the polled room state.
function ChutesLaddersOnlineGame({ onWin, onStepChange, roomId, myPlayerNum, onGlossary }) {
  const { room, pollingError, opponentDisconnected, submitMove } = useClassicRoom('chutes-ladders', roomId);
  const winCalledRef = useRef(false);
  const { secs, fmt } = useTimer(!!(room && room.status === 'active'));
  const secsRef = useRef(0); secsRef.current = secs;
  const movesRef = useRef(0);
  const [skin, setSkin] = useCnlSkin();
  const cycleSkin = () => {
    const ids = Object.keys(CNL_SKINS);
    setSkin(ids[(ids.indexOf(skin) + 1) % ids.length]);
  };

  useEffect(() => {
    if (!room || room.status !== 'finished' || winCalledRef.current) return;
    winCalledRef.current = true;
    const youWin = room.winner === String(myPlayerNum);
    const rolls = (room.state && room.state.rolls) || 0;
    const score = youWin ? Math.max(50, 300 - rolls * 5) : 0;
    const share = `🪜 Snakes & Ladders Online — ${youWin ? 'I won' : 'good game'} in ${rolls} rolls!`;
    onWin(score, movesRef.current, secsRef.current, { winnerLabel: youWin ? 'You win! 🎉' : 'Opponent wins', share });
  }, [room && room.status]);

  if (!room && !pollingError) {
    return <div style={{ textAlign: 'center', padding: '2rem' }}><div className="mnc-spinner" style={{ margin: '0 auto 0.75rem' }} /><div style={{ color: C.muted, fontSize: '0.85rem' }}>Connecting…</div></div>;
  }
  if (pollingError === 'room_not_found') {
    return <div style={{ textAlign: 'center', padding: '1.5rem', color: C.rose }}>Room not found.</div>;
  }

  const status = room ? room.status : 'waiting';
  if (status === 'waiting') {
    return (
      <div style={{ textAlign: 'center', padding: '1rem 0' }}>
        <div style={{ color: C.muted, marginBottom: '0.6rem', fontSize: '0.85rem' }}>Waiting for opponent to join…</div>
        <div className="mnc-room-code">{roomId}</div>
        <div style={{ color: C.muted, fontSize: '0.78rem', marginTop: '0.4rem' }}>Share this room code</div>
        <div className="mnc-spinner" style={{ margin: '1rem auto 0' }} />
      </div>
    );
  }

  const st = room.state || {};
  // The board style lives on the ROOM (the creator picked it), so the joining
  // player renders whatever board they actually joined.
  const vkey = cnlVariant(st.variant);
  const V = CNL_VARIANTS[vkey];
  const isMoksha = vkey === 'moksha';
  const SK = CNL_SKINS[isMoksha ? 'plain' : skin];
  const cur = st.currentPlayer || 1;
  const isMyTurn = status === 'active' && cur === myPlayerNum;
  const p1Color = C.accent, p2Color = C.violet;
  const myColor = myPlayerNum === 1 ? p1Color : p2Color;
  const myToken = myPlayerNum === 1 ? 'accent' : 'violet';

  const doRoll = () => {
    if (!isMyTurn) return;
    movesRef.current += 1; onStepChange && onStepChange(movesRef.current);
    submitMove({ type: 'roll' });
  };

  const turnLabel = status === 'finished'
    ? (room.winner === String(myPlayerNum) ? 'You win! 🎉' : 'Opponent wins')
    : isMyTurn ? 'Your turn' : "Opponent's turn";

  return (
    <div>
      <CuiBar height={(opponentDisconnected ? 20 : 0) + 96} build={(W) => {
        const pr = cuiRow(0, 0, W, 46, 4);
        const out = [
          { id: 'p-time', kind: 'pill', r: pr[0], label: 'Time', value: fmt, gold: true },
          { id: 'p-turn', kind: 'pill', r: pr[1], label: 'Turn', value: turnLabel, color: isMyTurn ? palOf(myColor, undefined) : PAL.muted },
          { id: 'p-you', kind: 'pill', r: pr[2], label: 'You', value: myPlayerNum === 1 ? (st.p1Pos || 0) : (st.p2Pos || 0), color: palOf(myColor, undefined) },
          { id: 'p-conn', kind: 'pill', r: pr[3], label: 'Online', value: '●', color: opponentDisconnected ? PAL.gold : PAL.emerald },
        ];
        let y = 50;
        if (isMoksha) { out.push({ id: 'glossary', kind: 'button', r: [Math.floor(W * 0.2), y, Math.floor(W * 0.6), 40], label: '📖 What do these mean?', font: 12, action: onGlossary }); y += 46; }
        else { out.push({ id: 'skin', kind: 'button', r: [Math.floor(W * 0.2), y, Math.floor(W * 0.6), 40], label: `${SK.icon} ${SK.label}`, font: 12, action: cycleSkin }); y += 46; }
        if (opponentDisconnected) out.push({ id: 'disc', kind: 'label', r: [0, y, W, 18], label: 'Opponent connection lost — waiting for reconnect…', gold: true, font: 12 });
        return out;
      }} />
      <div className="cnl-board-wrap">
        <CnlBoardCanvas V={V} isMoksha={isMoksha} SK={SK} p1Pos={st.p1Pos || 0} p2Pos={st.p2Pos || 0} p1Color={p1Color} p2Color={p2Color} p2Glyph={'2'} />
      </div>
      <CuiBar height={54} build={(W) => ([
        { id: 'die', kind: 'button', r: [Math.floor(W / 2) - 24, 3, 48, 48], label: st.die == null ? '·' : String(st.die), twinLabel: st.die == null ? 'Die not yet rolled' : `Die showing ${st.die}`, pips: st.die == null ? null : CNL_DIE_PIPS[st.die], font: 20, mono: true, disabled: true },
        { id: 'roll', kind: 'button', r: [W - Math.floor(W * 0.34) - 4, 7, Math.floor(W * 0.34), 40],
          label: status === 'finished' ? 'Game over' : isMyTurn ? 'Roll' : 'Waiting…',
          solid: isMyTurn, bg: isMyTurn ? palOf(myColor, undefined) : undefined, ink: isMyTurn ? '#fff' : undefined,
          disabled: !isMyTurn, action: doRoll },
      ])} />
    </div>
  );
}

const CNL_STREAK_KEY = 'puzzlechain_cnl_streak';

// Chutes & Ladders wrapper — picks a mode (2P / Versus Bot / Online) and
// delegates. Honors the Game Menu's gameMode/gameModeOpts props.