/* ============================================================
   Phase 6 — Shared card/tile engine + Lane A daily games
   ------------------------------------------------------------
   A small client-side engine every card/tile daily rides:
   seeded deck building + Fisher-Yates shuffling (mulberry32 via
   dailyRng, same PRNG family as lib/dapp.js's tile-match board
   generator), the intrinsic-art card/tile draw helpers the canvas
   boards share (klDrawCard and friends), and a layered-tile
   layout helper (free-tile rule + reverse-deal solvable dealing,
   the same layer/overlap model as lib/dapp.js's tileBoard).
   All phase-6 games are tier B server-side (snapshot + timing
   heuristics through settleDailySession); their onStepChange
   calls feed the shared daily run log automatically.
   ============================================================ */

// ---- Card primitives -------------------------------------------------------
const CE_SUIT_GLYPH = ['♠', '♥', '♦', '♣'];
const CE_RANK_LABEL = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const ceIsRed = (card) => card.s === 1 || card.s === 2;

// Fisher-Yates over a seeded rng — the engine's single shuffle primitive.
function ceShuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Build n standard decks as {id, s (suit 0-3), r (rank 0=A..12=K), up}.
// `suits` restricts the suit pool (Spider's 1-suit variant passes [0]).
function ceDeck(nDecks, suits, rng) {
  const cards = [];
  let id = 0;
  for (let d = 0; d < nDecks; d++) {
    for (const s of (suits || [0, 1, 2, 3])) {
      for (let r = 0; r < 13; r++) cards.push({ id: id++, s, r, up: false });
    }
  }
  return rng ? ceShuffle(cards, rng) : cards;
}

/* The DOM card renderer (CeCard/CeSlot) and the elementFromPoint drag hook
   (useCardDrag) that carried the pre-canvas solitaires were REMOVED in the
   wave-1 migration: Spider was their last consumer, and both solitaires now
   hit-test drags in board coordinates on their canvases (#170's pattern). */

/* ---- Klondike Solitaire (daily) -------------------------------------------
   Classic single-deck patience: 7 tableau columns, draw-1 stock with
   unlimited recycles, 4 foundations by suit. Tap a face-up card to select
   it (and the run below it), tap a destination to move; tapping the
   selected card again sends it to a foundation when legal.

   #170 — the board is a CANVAS. The DOM board laid its piles out at a fixed
   400px and FitScale-shrank the whole thing, so on a phone every card (and
   every tap target) rendered tiny, and drag hit-testing ran elementFromPoint
   against scaled elements. The canvas sizes cards from the measured column
   instead — they GROW to fill a phone screen — the tableau fan compresses to
   fit the measured height, and drag/tap hit-testing is plain coordinate math
   in the exact layout the frame was drawn from. Game rules, state shape,
   progress save/resume, scoring and the #123/#124/#125 affordances (drag,
   the ghost K on empty columns, Give up) are all unchanged. Canvas chrome
   (slots, hints, selection ring) reads PAL; the card faces/backs are
   intrinsic art and stay hardcoded like every other deck in the app. */

function klDeal(rng) {
  const deck = ceDeck(1, null, rng);
  const tab = [];
  let idx = 0;
  for (let p = 0; p < 7; p++) {
    const col = [];
    for (let i = 0; i <= p; i++) {
      const c = deck[idx++];
      col.push({ ...c, up: i === p });
    }
    tab.push(col);
  }
  const stock = deck.slice(idx).map((c) => ({ ...c, up: false }));
  return { stock, waste: [], found: [[], [], [], []], tab, moves: 0 };
}

function klValidState(st) {
  return st && Array.isArray(st.stock) && Array.isArray(st.waste) &&
    Array.isArray(st.found) && st.found.length === 4 &&
    Array.isArray(st.tab) && st.tab.length === 7 && Number.isFinite(st.moves);
}

/* Foundations are SUIT-SLOTTED: pile fi is the CE_SUIT_GLYPH[fi] slot the
   empty board draws. Saves from before that rule could hold a pile on any
   slot (an ace used to start wherever it landed first); piles are single-suit
   by construction either way — one ace per suit — so re-home each onto its
   suit's slot on hydrate. */
function klSlotFoundations(st) {
  const found = [[], [], [], []];
  for (const f of st.found) {
    if (!f.length) continue;
    if (found[f[0].s].length) return st; // two piles, one suit: corrupt — keep as saved
    found[f[0].s] = f;
  }
  return { ...st, found };
}

/* One geometry object drives BOTH the draw pass and the pointer hit-tests,
   so what you see is exactly what your finger hits. Card width comes from
   the measured box (7 columns); the tableau fan steps compress — and then
   the cards themselves shrink — until the deepest column fits the measured
   height, so nothing ever scrolls or clips mid-run. */
function klLayout(w, h, st) {
  const gap = Math.max(4, Math.min(10, Math.round(w * 0.014)));
  const build = (cw) => {
    const ch = Math.round(cw * 1.42);
    const fontPx = Math.max(10, Math.min(17, Math.round(cw * 0.3)));
    const totalW = cw * 7 + gap * 6;
    const x0 = Math.floor((w - totalW) / 2);
    const tabY = ch + Math.max(8, Math.round(ch * 0.16));
    let upStep = Math.max(fontPx + 7, Math.round(ch * 0.34));
    let downStep = Math.max(5, Math.round(ch * 0.14));
    const needed = (us, ds) => {
      let need = ch;
      for (const col of st.tab) {
        let y = 0;
        for (let i = 1; i < col.length; i++) y += col[i - 1].up ? us : ds;
        need = Math.max(need, y + ch);
      }
      return need;
    };
    const avail = Math.max(0, h - tabY);
    // Compress the fan before shrinking the cards — a readable top card
    // beats a taller sliver of a buried one.
    let guard = 0;
    while (avail > 0 && needed(upStep, downStep) > avail && guard++ < 60) {
      if (downStep > 5) downStep -= 1;
      else if (upStep > 13) upStep -= 1;
      else break;
    }
    const fits = avail === 0 || needed(upStep, downStep) <= avail;
    return { w, h, gap, cw, ch, fontPx, x0, tabY, upStep, downStep, fits };
  };
  let cw = Math.min(76, Math.floor((w - gap * 6) / 7));
  let ly = build(cw);
  let guard = 0;
  while (!ly.fits && cw > 30 && guard++ < 30) { cw -= 2; ly = build(cw); }
  ly.colX = (p) => ly.x0 + p * (ly.cw + ly.gap);
  ly.stockX = ly.colX(0);
  ly.wasteX = ly.colX(1);
  ly.foundX = [3, 4, 5, 6].map((p) => ly.colX(p));
  // Absolute y of every tableau card, shared by draw + hit-test.
  ly.colYs = st.tab.map((col) => {
    let y = ly.tabY;
    return col.map((c) => { const yy = y; y += c.up ? ly.upStep : ly.downStep; return yy; });
  });
  return ly;
}

// Topmost thing under a canvas point: stock / waste / a foundation / a
// tableau card (i null = the empty column itself). Top-row targets are
// padded out to the gap so finger-sized taps land.
function klHitAt(ly, st, x, y) {
  const pad = ly.gap / 2 + 2;
  const inTop = (rx) => x >= rx - pad && x < rx + ly.cw + pad && y < ly.ch + pad;
  if (y < ly.tabY) {
    if (inTop(ly.stockX)) return { z: 'stock' };
    if (inTop(ly.wasteX)) return { z: 'waste' };
    for (let fi = 0; fi < 4; fi++) if (inTop(ly.foundX[fi])) return { z: 'found', p: fi };
    return null;
  }
  const p = Math.floor((x - ly.x0 + ly.gap / 2) / (ly.cw + ly.gap));
  if (p < 0 || p > 6) return null;
  const col = st.tab[p];
  for (let i = col.length - 1; i >= 0; i--) {
    if (y >= ly.colYs[p][i] && y < ly.colYs[p][i] + ly.ch) return { z: 'tab', p, i };
  }
  // The column band below the stack still targets the column — same as the
  // DOM board's tap-the-column-background behaviour.
  return { z: 'tab', p, i: col.length ? col.length - 1 : null };
}

// Rounded-rect path helper (roundRect isn't on every mobile 2D context).
function klRR(ctx, x, y, w, h, r) {
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Card faces/backs are intrinsic art (hardcoded, matching the DOM deck the
// other card games still render); only chrome reads the theme.
const KL_FACE = '#F4F6FB', KL_FACE_EDGE = '#C9D2E4',
      KL_RED = '#DC2626', KL_BLACK = '#1E293B',
      KL_BACK = '#3730A3', KL_BACK_STRIPE = '#4338CA', KL_BACK_EDGE = '#312E81';
const KL_FLIP_MS = 260; // stock→waste draw-flip duration

function klDrawCard(ctx, ly, x, y, card, opts) {
  const o = opts || {};
  const { cw, ch, fontPx } = ly;
  const r = Math.max(3, Math.round(cw * 0.11));
  klRR(ctx, x, y, cw, ch, r);
  if (o.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 4;
  }
  ctx.fillStyle = card.up ? KL_FACE : KL_BACK;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.lineWidth = 1;
  ctx.strokeStyle = card.up ? KL_FACE_EDGE : KL_BACK_EDGE;
  ctx.stroke();
  if (!card.up) {
    // The DOM deck's 135° indigo stripes.
    ctx.save();
    klRR(ctx, x + 1, y + 1, cw - 2, ch - 2, r);
    ctx.clip();
    ctx.strokeStyle = KL_BACK_STRIPE;
    ctx.lineWidth = 4;
    for (let s = -ch; s < cw + ch; s += 9) {
      ctx.beginPath();
      ctx.moveTo(x + s, y - 2);
      ctx.lineTo(x + s + ch + 4, y + ch + 2);
      ctx.stroke();
    }
    ctx.restore();
  } else {
    const ink = ceIsRed(card) ? KL_RED : KL_BLACK;
    const pad = Math.max(2, Math.round(cw * 0.08));
    ctx.fillStyle = ink;
    ctx.font = '700 ' + fontPx + 'px "JetBrains Mono", monospace';
    ctx.textBaseline = 'top';
    // Corner index (rank left, suit right) so a fanned card reads from its
    // exposed strip alone — the mobile complaint the canvas exists to fix.
    ctx.textAlign = 'left';
    ctx.fillText(CE_RANK_LABEL[card.r], x + pad, y + pad);
    ctx.textAlign = 'right';
    ctx.fillText(CE_SUIT_GLYPH[card.s], x + cw - pad, y + pad);
    // Big centre pip on the lower half (visible on a fully exposed card).
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = Math.round(cw * 0.52) + 'px "JetBrains Mono", monospace';
    ctx.fillText(CE_SUIT_GLYPH[card.s], x + cw / 2, y + ch - ch * 0.32);
  }
  if (o.sel) {
    klRR(ctx, x - 1.5, y - 1.5, cw + 3, ch + 3, r + 1);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = PAL.gold;
    ctx.stroke();
  }
}

function klDrawSlot(ctx, ly, x, y, label) {
  const r = Math.max(3, Math.round(ly.cw * 0.11));
  klRR(ctx, x + 0.75, y + 0.75, ly.cw - 1.5, ly.ch - 1.5, r);
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = PAL.dim;
  ctx.stroke();
  ctx.setLineDash([]);
  if (label) {
    ctx.fillStyle = PAL.dim;
    ctx.font = '700 ' + Math.round(ly.cw * 0.42) + 'px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + ly.cw / 2, y + ly.ch / 2);
  }
}

function KlondikeGame({ onWin, onLose, onStepChange, offset, savedProgress, onSaveProgress, playMode, band }) {
  const dayNum = useRef(utcDayNum(offset)).current;
  /* #176 — story and arcade deal from a RATED seed: one that an offline solver
     confirmed is winnable, in the difficulty band that was asked for. #331 —
     the daily's Easy/Hard do the same, at the corpus ladder's own ends (the
     klondike corpus is rated into six effort bands), each seeded from its own
     mixed deal so the rated pick differs from Normal's. Normal is untouched
     (today's server seed like every other daily), and if the corpus has not
     loaded the mode falls back to an ordinary seeded deal — you lose the
     guarantee, not the game. */
  const dailyBand = playMode === 'daily' && (band === 'easy' || band === 'hard') ? band : null;
  const kdBand = playMode === 'story' ? Math.max(0, band || 0)
    : playMode === 'arcade'
      ? [0, 2, 5][Math.max(0, ARCADE_BANDS.findIndex(b => b.id === band))]
      : dailyBand === 'easy' ? 0
      : dailyBand === 'hard' ? 5
      : null;
  const kdSeeded = useRef(null);
  if (kdSeeded.current === null && kdBand !== null) {
    const { rng } = modeSeed(playMode, 'klondike', playMode === 'daily' ? (dailyBand || kdBand) : kdBand, offset);
    const rated = corpusSeed('klondike', kdBand, rng);
    kdSeeded.current = rated != null ? mulberry32(rated >>> 0) : rng;
  }
  const freshDeal = useRef(null);
  if (!freshDeal.current) freshDeal.current = klDeal(kdSeeded.current || dailyRng(offset, 'klondike'));
  const resumed = savedProgress && savedProgress.dayNum === dayNum && klValidState(savedProgress.st)
    ? klSlotFoundations(savedProgress.st) : null;

  const [st, setSt] = useState(() => resumed || freshDeal.current);
  const [sel, setSel] = useState(null); // {z:'waste'} | {z:'tab',p,i} | {z:'found',p}
  const [done, setDone] = useState(false);
  const initialSecs = savedProgress && Number.isFinite(savedProgress.elapsedSecs) ? savedProgress.elapsedSecs : 0;
  const { secs, fmt } = useTimer(!done, initialSecs);

  const stateRef = useRef({});
  stateRef.current = { st, secs };
  useAutosave(
    onSaveProgress,
    () => ({ progress: { dayNum, st: stateRef.current.st }, steps: stateRef.current.st.moves, secs: stateRef.current.secs }),
    !done
  );
  const commit = (next) => {
    setSt(next);
    setSel(null);
    onStepChange(next.moves);
    const won = next.found.every((f) => f.length === 13);
    // Don't autosave the winning move — the finish call is about to close the
    // attempt, and a progress write racing it 409s against the finished row.
    if (!won && onSaveProgress) onSaveProgress({ dayNum, st: next }, next.moves, secs);
    if (won) {
      setDone(true);
      const score = Math.max(1600 - next.moves * 3 - secs, 300);
      onWin(score, next.moves, secs, {
        share: `Game Corner Klondike Solitaire — solved today's deal in ${fmt} (${next.moves} moves) 🃏`,
      });
    }
  };

  const clone = () => ({
    stock: st.stock.slice(), waste: st.waste.slice(),
    found: st.found.map((f) => f.slice()), tab: st.tab.map((c) => c.slice()),
    moves: st.moves,
  });

  /* Stock-draw flip — presentation only. tapStock commits the draw instantly
     (rules, saves and the move count all see the settled state); for KL_FLIP_MS
     afterwards the canvas draws the new waste top mid-flight, travelling
     stock→waste while flipping face-up. One repaint per rAF is driven by a
     counter in the draw deps; progress is read off the clock at draw time.
     Reduced-motion players get the instant appearance they had before. */
  const flipRef = useRef(null);
  const [flipSeq, setFlipSeq] = useState(0);        // (re)arms the rAF loop per draw
  const [flipFrame, setFlipFrame] = useState(0);    // one bump = one repaint (a draw dep)
  useEffect(() => {
    if (!flipRef.current) return;
    let raf = 0;
    const tick = () => {
      if (!flipRef.current) return;
      if (performance.now() - flipRef.current.t0 >= KL_FLIP_MS) flipRef.current = null;
      setFlipFrame((f) => f + 1); // the last bump paints the settled board
      if (flipRef.current) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [flipSeq]);
  const cancelFlip = () => {
    if (!flipRef.current) return;
    flipRef.current = null;
    setFlipFrame((f) => f + 1); // settle immediately (a grab mid-flight)
  };

  const tapStock = () => {
    if (done) return;
    const n = clone();
    if (n.stock.length) {
      const c = n.stock.pop();
      n.waste.push({ ...c, up: true });
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        flipRef.current = { t0: performance.now() };
        setFlipSeq((q) => q + 1);
      }
    } else if (n.waste.length) {
      n.stock = n.waste.slice().reverse().map((c) => ({ ...c, up: false }));
      n.waste = [];
    } else return;
    n.moves++;
    commit(n);
  };

  /* #124 — the empty-column rule. `card.r === 12` means ONLY A KING may start
     an empty column, and nothing in the UI ever said so: an illegal drop just
     did nothing, which reads as a broken tap. The rule is now stated three
     ways — a ghost "K" in every empty column, a how-to-play card, and the
     inline note below when you actually try it. */
  const canTab = (card, destTop) =>
    destTop ? (ceIsRed(card) !== ceIsRed(destTop) && card.r === destTop.r - 1) : card.r === 12;
  // Suit-slotted: pile fi only ever takes suit fi (the glyph its empty slot
  // shows), starting from the Ace — an ace can no longer start any old pile.
  const canFound = (card, fi) => {
    if (card.s !== fi) return false;
    const f = st.found[fi];
    return f.length ? card.r === f[f.length - 1].r + 1 : card.r === 0;
  };

  const [note, setNote] = useState('');
  const noteTimer = useRef(null);
  const say = (msg) => {
    setNote(msg);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(''), 2200);
  };
  useEffect(() => () => { if (noteTimer.current) clearTimeout(noteTimer.current); }, []);

  // Why a specific move was refused — a silent no-op is indistinguishable from
  // an unresponsive tap, which is what #123 and #124 were both reporting.
  const explainTab = (card, destTop) => {
    if (!destTop) return card.r === 12 ? '' : 'Only a King can start an empty column.';
    if (ceIsRed(card) === ceIsRed(destTop)) return 'Build down in alternating colours.';
    if (card.r !== destTop.r - 1) return `That card must go on a ${CE_RANK_LABEL[card.r + 1] || '?'}.`;
    return '';
  };

  // The selected run (array of cards) plus a mutator that removes it.
  const takeSel = (n, s) => {
    if (s.z === 'waste') return [n.waste.pop()];
    if (s.z === 'found') return [n.found[s.p].pop()];
    const run = n.tab[s.p].splice(s.i);
    const col = n.tab[s.p];
    if (col.length && !col[col.length - 1].up) col[col.length - 1] = { ...col[col.length - 1], up: true };
    return run;
  };
  const selCards = (s) => {
    if (!s) return [];
    if (s.z === 'waste') return st.waste.slice(-1);
    if (s.z === 'found') return st.found[s.p].slice(-1);
    return st.tab[s.p].slice(s.i);
  };

  const tryFoundation = (s) => {
    const cards = selCards(s);
    if (cards.length !== 1) return false;
    const fi = cards[0].s; // its one legal home now
    if (!canFound(cards[0], fi)) return false;
    const n = clone();
    n.found[fi].push({ ...takeSel(n, s)[0], up: true });
    n.moves++;
    commit(n);
    return true;
  };

  const moveSelToTab = (p, src) => {
    const s = src || sel;
    const cards = selCards(s);
    if (!cards.length) return false;
    const destTop = st.tab[p].length ? st.tab[p][st.tab[p].length - 1] : null;
    if (!canTab(cards[0], destTop)) {
      const why = explainTab(cards[0], destTop);
      if (why) say(why);
      return false;
    }
    const n = clone();
    n.tab[p] = n.tab[p].concat(takeSel(n, s));
    n.moves++;
    commit(n);
    return true;
  };
  // `src` (a drag payload) overrides the tap selection, same as moveSelToTab.
  // Refusals explain themselves here so tap and drag get the same note (#123).
  const moveSelToFound = (fi, src) => {
    const s = src || sel;
    const cards = selCards(s);
    if (cards.length !== 1) { say('Send one card home at a time.'); return false; }
    if (!canFound(cards[0], fi)) {
      say(cards[0].s !== fi
        ? `${CE_SUIT_GLYPH[cards[0].s]} builds on its own slot, Ace first.`
        : 'Foundations build up by suit from the Ace.');
      return false;
    }
    const n = clone();
    n.found[fi].push({ ...takeSel(n, s)[0], up: true });
    n.moves++;
    commit(n);
    return true;
  };

  const isSel = (z, p, i) => sel && sel.z === z && sel.p === p && (z !== 'tab' || sel.i === i);

  const tapWaste = () => {
    if (done || !st.waste.length) return;
    if (isSel('waste')) { if (!tryFoundation(sel)) setSel(null); return; }
    setSel({ z: 'waste' });
  };
  const tapFound = (fi) => {
    if (done) return;
    if (sel && !isSel('found', fi)) { if (moveSelToFound(fi)) return; }
    if (isSel('found', fi)) { setSel(null); return; }
    if (st.found[fi].length) setSel({ z: 'found', p: fi });
  };
  const tapTab = (p, i) => {
    if (done) return;
    const col = st.tab[p];
    // Tap on empty column or anywhere in a column while a selection exists →
    // try to move there first.
    if (sel && !isSel('tab', p, i)) {
      if (moveSelToTab(p)) return;
    }
    if (i == null || i < 0 || !col[i] || !col[i].up) { setSel(null); return; }
    if (isSel('tab', p, i)) {
      // Second tap on the same card: auto-send to a foundation (top card only).
      if (i === col.length - 1 && tryFoundation(sel)) return;
      setSel(null);
      return;
    }
    setSel({ z: 'tab', p, i });
  };

  /* #125 — a way out. Without this the only exit from a dead deal was to close
     the tab, which left a claimed-but-unfinished attempt hanging. onLose is the
     harness's existing loss path: score 0, day locks, streak NOT broken. */
  const giveUp = () => {
    if (done) return;
    setDone(true);
    const home = st.found.reduce((a, f) => a + f.length, 0);
    onLose && onLose(st.moves, secs, {
      share: `Game Corner Klondike Solitaire — gave up today's deal at ${home}/52 home 🃏`,
      answer: null,
    });
  };

  /* #170 — canvas plumbing, now the whole FRAME (controls wave): pills, the
     board, the refusal note and Give up draw on one canvas. The box is the
     fit column's flexible region; useFitBox re-measures it on resize/rotate
     and the board layout is recomputed from the CURRENT state each render,
     so the fan tightens as columns grow. */
  const canvasRef = useRef(null);
  const boxRef = useRef(null);
  const { boxW, boxH } = useFitBox(boxRef, { cols: 7, rows: 1 });
  const W = Math.floor(boxW), H = Math.floor(boxH);
  const KL_GAP = 8, KL_PILL_H = 46, KL_NOTE_H = 18, KL_BTN_H = 36;
  const klChrome = KL_PILL_H + KL_GAP + KL_GAP + KL_NOTE_H + 4 + KL_BTN_H + 4;
  const klBoardY = KL_PILL_H + KL_GAP;
  const boardH = Math.max(80, H - klChrome);
  const ly = W > 80 && H > 80 ? klLayout(W, boardH, st) : null;
  const lyRef = useRef(ly);
  lyRef.current = ly;
  const klTopRef = useRef(klBoardY);
  klTopRef.current = klBoardY;

  const home = st.found.reduce((a, f) => a + f.length, 0);
  const klControls = [];
  if (W > 80) {
    const pr = cuiRow(0, 0, W, KL_PILL_H, 3);
    klControls.push({ id: 'p-time', kind: 'pill', r: pr[0], label: 'Time', value: fmt, gold: true });
    klControls.push({ id: 'p-moves', kind: 'pill', r: pr[1], label: 'Moves', value: st.moves });
    klControls.push({ id: 'p-home', kind: 'pill', r: pr[2], label: 'Home', value: `${home}/52` });
    const noteY = klBoardY + boardH + KL_GAP;
    if (note) klControls.push({ id: 'note', kind: 'label', r: [0, noteY, W, KL_NOTE_H], label: note, gold: true, font: 12 });
    klControls.push({ id: 'giveup', kind: 'button', r: [Math.floor(W * 0.28), noteY + KL_NOTE_H + 4, Math.floor(W * 0.44), KL_BTN_H], label: '🏳️ Give up', disabled: done, action: () => giveUp() });
  }
  const klCtlRef = useRef([]);
  klCtlRef.current = klControls;
  const [klPressed, setKlPressed] = useState(null);

  /* #123 — drag, now hit-tested in board coordinates. A press on the waste,
     a foundation top or a face-up tableau card arms a potential drag; pointer
     travel past the tolerance turns it into one (otherwise the tap path runs,
     so both input styles keep working). The authoritative drag lives in a ref
     — pointer events outrun React renders — and the state copy only schedules
     repaints. */
  const [drag, setDrag] = useState(null); // { src, cards, x, y, gx, gy }
  const dragRef = useRef(null);
  const pendRef = useRef(null);
  const setDragBoth = (d) => { dragRef.current = d; setDrag(d); };

  // Resolve a drag release from the same layout the frame was drawn with.
  // Only foundations live in the top band; anywhere in a column band is a
  // tableau drop, and illegal drops explain themselves (#123/#124).
  const dropAt = (src, cards, pt) => {
    const l = lyRef.current;
    if (!l || !cards.length) return;
    if (pt.y < l.tabY) {
      for (let fi = 0; fi < 4; fi++) {
        if (pt.x >= l.foundX[fi] - l.gap / 2 && pt.x < l.foundX[fi] + l.cw + l.gap / 2) {
          if (src.z === 'found' && src.p === fi) return; // dropped on itself
          moveSelToFound(fi, src); // says why when refused
          return;
        }
      }
      return; // stock / waste / dead space — snap back
    }
    const p = Math.max(0, Math.min(6, Math.floor((pt.x - l.x0 + l.gap / 2) / (l.cw + l.gap))));
    if (src.z === 'tab' && src.p === p) return; // dropped on itself
    moveSelToTab(p, src);
  };

  usePointerCell(canvasRef, cuiWrapHandlers(klCtlRef, setKlPressed, cuiShiftHandlers({
    onDown: (pt) => {
      pendRef.current = null;
      if (dragRef.current) setDragBoth(null); // a cancelled drag left a ghost
      cancelFlip(); // a grab mid-flight settles the board first
      const l = lyRef.current;
      if (done || !l) return;
      const hit = klHitAt(l, st, pt.x, pt.y);
      if (!hit) return;
      if (hit.z === 'waste' && st.waste.length) {
        pendRef.current = { src: { z: 'waste' }, cards: st.waste.slice(-1), x0: l.wasteX, y0: 0, px: pt.x, py: pt.y };
      } else if (hit.z === 'found' && st.found[hit.p].length) {
        pendRef.current = { src: { z: 'found', p: hit.p }, cards: st.found[hit.p].slice(-1), x0: l.foundX[hit.p], y0: 0, px: pt.x, py: pt.y };
      } else if (hit.z === 'tab' && hit.i != null && st.tab[hit.p][hit.i].up) {
        pendRef.current = {
          src: { z: 'tab', p: hit.p, i: hit.i }, cards: st.tab[hit.p].slice(hit.i),
          x0: l.colX(hit.p), y0: l.colYs[hit.p][hit.i], px: pt.x, py: pt.y,
        };
      }
    },
    onDrag: (pt, info) => {
      const pend = pendRef.current;
      if (done || !pend || !info.moved) return;
      const d = dragRef.current ||
        { src: pend.src, cards: pend.cards, gx: pend.px - pend.x0, gy: pend.py - pend.y0 };
      setDragBoth({ ...d, x: pt.x, y: pt.y });
    },
    onUp: (pt) => {
      pendRef.current = null;
      const d = dragRef.current;
      if (!d) return;
      setDragBoth(null);
      if (!done) dropAt(d.src, d.cards, pt);
    },
    onTap: (pt) => {
      const l = lyRef.current;
      if (done || !l) return;
      const hit = klHitAt(l, st, pt.x, pt.y);
      if (!hit) { setSel(null); return; }
      if (hit.z === 'stock') tapStock();
      else if (hit.z === 'waste') tapWaste();
      else if (hit.z === 'found') tapFound(hit.p);
      else tapTab(hit.p, hit.i);
    },
  }, klTopRef)), { moveTolerance: 8 });

  useCanvasBoard(canvasRef, {
    width: W,
    height: H,
    deps: [st, sel, drag, done, W, H, flipFrame, fmt, note, klPressed],
    draw: (ctx) => {
      cuiDrawControls(ctx, klCtlRef.current, klPressed);
      const l = lyRef.current;
      if (!l) return;
      ctx.save();
      ctx.translate(0, klTopRef.current);
      const dragSrc = drag && drag.src;
      const hideWaste = dragSrc && dragSrc.z === 'waste' ? 1 : 0;
      const hideFound = dragSrc && dragSrc.z === 'found' ? dragSrc.p : -1;

      // Stock — face-down top card with a remaining count, or the recycle slot.
      if (st.stock.length) {
        klDrawCard(ctx, l, l.stockX, 0, { up: false });
        ctx.fillStyle = 'rgba(255,255,255,0.9)'; // on the indigo back — intrinsic
        ctx.font = '700 ' + Math.max(10, l.fontPx - 2) + 'px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(st.stock.length), l.stockX + l.cw / 2, l.ch / 2);
      } else {
        klDrawSlot(ctx, l, l.stockX, 0, '↻');
      }

      // Waste — the top card (or the one beneath it while that's dragged, or
      // still in flight from the stock).
      const flip = flipRef.current;
      const wTop = st.waste.length - 1 - hideWaste - (flip ? 1 : 0);
      if (wTop >= 0) klDrawCard(ctx, l, l.wasteX, 0, st.waste[wTop], { sel: isSel('waste') });
      else klDrawSlot(ctx, l, l.wasteX, 0);

      // Foundations.
      for (let fi = 0; fi < 4; fi++) {
        const f = st.found[fi];
        const top = f.length - 1 - (hideFound === fi ? 1 : 0);
        if (top >= 0) klDrawCard(ctx, l, l.foundX[fi], 0, f[top], { sel: isSel('found', fi) });
        else klDrawSlot(ctx, l, l.foundX[fi], 0, CE_SUIT_GLYPH[fi]);
      }

      // Tableau. #124 — the ghost K states the empty-column rule on the board.
      for (let p = 0; p < 7; p++) {
        const col = st.tab[p];
        const hideFrom = dragSrc && dragSrc.z === 'tab' && dragSrc.p === p ? dragSrc.i : Infinity;
        if (!col.length || hideFrom === 0) klDrawSlot(ctx, l, l.colX(p), l.tabY, 'K');
        for (let i = 0; i < col.length && i < hideFrom; i++) {
          klDrawCard(ctx, l, l.colX(p), l.colYs[p][i], col[i],
            { sel: sel && sel.z === 'tab' && sel.p === p && i >= sel.i });
        }
      }

      /* The stock-draw flight: the real top waste card, travelling
         stock→waste while a horizontal squeeze flips it from back to face
         at the halfway point. Drawn over the board, under the drag ghost. */
      if (flip && st.waste.length) {
        const fp = Math.min(1, (performance.now() - flip.t0) / KL_FLIP_MS);
        const ease = 1 - (1 - fp) * (1 - fp); // easeOutQuad travel
        const x = l.stockX + (l.wasteX - l.stockX) * ease;
        const sx = Math.max(0.06, Math.abs(Math.cos(Math.PI * fp))); // 1→0→1
        const cx = x + l.cw / 2;
        ctx.save();
        ctx.translate(cx, 0);
        ctx.scale(sx, 1);
        ctx.translate(-cx, 0);
        klDrawCard(ctx, l, x, 0, { ...st.waste[st.waste.length - 1], up: fp >= 0.5 }, { shadow: true });
        ctx.restore();
      }

      // The dragged run rides the finger, drawn last so it's on top.
      if (drag) {
        const dx = drag.x - drag.gx, dy = drag.y - drag.gy;
        drag.cards.forEach((c, i) => klDrawCard(ctx, l, dx, dy + i * l.upStep, c, { shadow: i === 0 }));
      }
      ctx.restore();
    },
  });

  return (
    <div className="kl-game fit-col">
      <div className="kl-board-box cui-frame" ref={boxRef}>
        <canvas
          ref={canvasRef}
          className="kl-canvas board-canvas"
          role="img"
          aria-label={`Klondike board — ${home}/52 home, ${st.stock.length} in stock, ${st.moves} moves`}
        />
      </div>
      <CuiTwin controls={klControls} />
      <div className="p6-hint">Drag a card (or tap it, then its destination). Tap a selected card again to send it home. Only a King starts an empty column.</div>
    </div>
  );
}

/* ---- Spider Solitaire (daily, 1 suit) --------------------------------------
   104 spade cards over 10 columns. Move any descending run; complete
   K→A runs clear to the foundation; deal a row from the stock. */

function spDeal(rng) {
  const deck = ceDeck(8, [0], rng); // 8 × A..K of one suit = 104
  const cols = [];
  let idx = 0;
  for (let p = 0; p < 10; p++) {
    const size = p < 4 ? 6 : 5;
    const col = [];
    for (let i = 0; i < size; i++) {
      const c = deck[idx++];
      col.push({ ...c, up: i === size - 1 });
    }
    cols.push(col);
  }
  return { cols, stock: deck.slice(idx).map((c) => ({ ...c, up: false })), done8: 0, moves: 0 };
}

function spValidState(st) {
  return st && Array.isArray(st.cols) && st.cols.length === 10 &&
    Array.isArray(st.stock) && Number.isFinite(st.done8) && Number.isFinite(st.moves);
}

// Remove any completed K→A run from a column (mutates), returns count removed.
function spSweep(n) {
  let swept = 0;
  for (let p = 0; p < 10; p++) {
    const col = n.cols[p];
    if (col.length < 13) continue;
    const tail = col.slice(-13);
    let run = tail.every((c) => c.up) && tail[0].r === 12;
    if (run) for (let i = 1; i < 13; i++) if (tail[i].r !== tail[i - 1].r - 1) { run = false; break; }
    if (run) {
      n.cols[p] = col.slice(0, -13);
      const nc = n.cols[p];
      if (nc.length && !nc[nc.length - 1].up) nc[nc.length - 1] = { ...nc[nc.length - 1], up: true };
      swept++;
    }
  }
  return swept;
}

/* The Spider board is a CANVAS now — the #170 Klondike treatment: the DOM
   board fixed every column at 44px and FitScale-shrank the whole tableau,
   so ten columns on a phone meant ~30px cards and elementFromPoint drag
   hit-testing against scaled elements. The canvas sizes cards from the
   measured box (they grow to fill a phone screen), the fan compresses
   before the cards shrink, and drag/tap hit-testing is coordinate math in
   the exact layout each frame was drawn from. Rules, state shape, progress
   save/resume and scoring are unchanged; the cards reuse Klondike's
   intrinsic deck art (klDrawCard/klDrawSlot read sizes off this layout). */
function spLayout(w, h, st) {
  const gap = Math.max(3, Math.min(8, Math.round(w * 0.01)));
  const build = (cw) => {
    const ch = Math.round(cw * 1.36);
    const fontPx = Math.max(9, Math.min(15, Math.round(cw * 0.32)));
    const totalW = cw * 10 + gap * 9;
    const x0 = Math.floor((w - totalW) / 2);
    let upStep = Math.max(fontPx + 6, Math.round(ch * 0.34));
    let downStep = Math.max(4, Math.round(ch * 0.13));
    const needed = (us, ds) => {
      let need = ch;
      for (const col of st.cols) {
        let y = 0;
        for (let i = 1; i < col.length; i++) y += col[i - 1].up ? us : ds;
        need = Math.max(need, y + ch);
      }
      return need;
    };
    const avail = Math.max(0, h);
    // Compress the fan before shrinking the cards (the Klondike rule): a
    // readable top card beats a taller sliver of a buried one.
    let guard = 0;
    while (avail > 0 && needed(upStep, downStep) > avail && guard++ < 80) {
      if (downStep > 4) downStep -= 1;
      else if (upStep > 11) upStep -= 1;
      else break;
    }
    const fits = avail === 0 || needed(upStep, downStep) <= avail;
    return { w, h, gap, cw, ch, fontPx, x0, upStep, downStep, fits };
  };
  let cw = Math.min(60, Math.floor((w - gap * 9) / 10));
  let ly = build(cw);
  let guard = 0;
  while (!ly.fits && cw > 24 && guard++ < 30) { cw -= 2; ly = build(cw); }
  ly.colX = (p) => ly.x0 + p * (ly.cw + ly.gap);
  // Absolute y of every card, shared by the draw pass and the hit-test.
  ly.colYs = st.cols.map((col) => {
    let y = 0;
    return col.map((c) => { const yy = y; y += c.up ? ly.upStep : ly.downStep; return yy; });
  });
  return ly;
}

// Topmost card under a canvas point (i null = the empty column itself); a
// point below a stack still targets the column, like the DOM board's
// tap-the-column-background behaviour.
function spHitAt(ly, st, x, y) {
  const p = Math.floor((x - ly.x0 + ly.gap / 2) / (ly.cw + ly.gap));
  if (p < 0 || p > 9) return null;
  const col = st.cols[p];
  for (let i = col.length - 1; i >= 0; i--) {
    if (y >= ly.colYs[p][i] && y < ly.colYs[p][i] + ly.ch) return { p, i };
  }
  return { p, i: col.length ? col.length - 1 : null };
}

function SpiderGame({ onWin, onLose, onStepChange, offset, savedProgress, onSaveProgress, playMode, band }) {
  const dayNum = useRef(utcDayNum(offset)).current;
  /* Spider's traditional progression is SUIT COUNT (1 → 2 → 4), but this
     build deals one suit at every level (see spDeal), so the difficulty comes
     entirely from the RATED SEED: public/corpus/spider.json cuts 400 solved
     deals into six effort bands and each level draws from its own.

     Arcade's three buttons therefore index [0, 2, 5] — the bottom, middle and
     TOP of those six. The raw findIndex 0/1/2 that used to be here was right
     while the corpus had exactly three bands; after #184 raised it to six it
     would have quietly made arcade Hard the third-easiest deal of six. */
  const spBand = playMode === 'story' ? Math.max(0, band || 0)
    : playMode === 'arcade'
      ? [0, 2, 5][Math.max(0, ARCADE_BANDS.findIndex(b => b.id === band))]
      /* #331 — the daily's Easy/Hard draw from the corpus ladder's own ends,
         each seeded from its own mixed deal. Normal stays today's server
         seed. */
      : (playMode === 'daily' && (band === 'easy' || band === 'hard'))
        ? (band === 'easy' ? 0 : 5)
      : null;
  const spSeeded = useRef(null);
  if (spSeeded.current === null && spBand !== null) {
    const { rng } = modeSeed(playMode, 'spider',
      playMode === 'daily' ? (band === 'easy' || band === 'hard' ? band : spBand) : spBand, offset);
    const rated = corpusSeed('spider', spBand, rng);
    spSeeded.current = rated != null ? mulberry32(rated >>> 0) : rng;
  }
  const freshDeal = useRef(null);
  if (!freshDeal.current) freshDeal.current = spDeal(spSeeded.current || dailyRng(offset, 'spider'));
  const resumed = savedProgress && savedProgress.dayNum === dayNum && spValidState(savedProgress.st)
    ? savedProgress.st : null;

  const [st, setSt] = useState(() => resumed || freshDeal.current);
  const [sel, setSel] = useState(null); // {p, i}
  const [done, setDone] = useState(false);
  const initialSecs = savedProgress && Number.isFinite(savedProgress.elapsedSecs) ? savedProgress.elapsedSecs : 0;
  const { secs, fmt } = useTimer(!done, initialSecs);

  const stateRef = useRef({});
  stateRef.current = { st, secs };
  useAutosave(
    onSaveProgress,
    () => ({ progress: { dayNum, st: stateRef.current.st }, steps: stateRef.current.st.moves, secs: stateRef.current.secs }),
    !done
  );

  const commit = (n) => {
    n.done8 += spSweep(n);
    setSt(n);
    setSel(null);
    onStepChange(n.moves);
    const won = n.done8 >= 8;
    if (!won && onSaveProgress) onSaveProgress({ dayNum, st: n }, n.moves, secs);
    if (won) {
      setDone(true);
      const score = Math.max(2000 - n.moves * 3 - secs, 300);
      onWin(score, n.moves, secs, {
        share: `Game Corner Spider Solitaire — cleared today's deal in ${fmt} (${n.moves} moves) 🕷️`,
      });
    }
  };
  const clone = () => ({ cols: st.cols.map((c) => c.slice()), stock: st.stock.slice(), done8: st.done8, moves: st.moves });

  // A selection is valid if cards i..end are all face-up and strictly descending.
  const runOk = (col, i) => {
    if (!col[i] || !col[i].up) return false;
    for (let k = i + 1; k < col.length; k++) if (!col[k].up || col[k].r !== col[k - 1].r - 1) return false;
    return true;
  };

  const dealRow = () => {
    if (done || !st.stock.length) return;
    const n = clone();
    for (let p = 0; p < 10 && n.stock.length; p++) {
      const c = n.stock.pop();
      n.cols[p] = n.cols[p].concat({ ...c, up: true });
    }
    n.moves++;
    commit(n);
  };

  const [note, setNote] = useState('');
  const noteTimer = useRef(null);
  const say = (msg) => {
    setNote(msg);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(''), 2200);
  };
  useEffect(() => () => { if (noteTimer.current) clearTimeout(noteTimer.current); }, []);

  // Shared by tap and drag so both paths refuse a move for the same reason.
  const moveRun = (fromP, fromI, toP) => {
    if (fromP === toP) return false;
    const moving = st.cols[fromP].slice(fromI);
    if (!moving.length || !runOk(st.cols[fromP], fromI)) return false;
    const col = st.cols[toP];
    const destTop = col.length ? col[col.length - 1] : null;
    if (destTop && destTop.r !== moving[0].r + 1) {
      say(`That run must go on a ${CE_RANK_LABEL[moving[0].r + 1] || '?'}.`);
      return false;
    }
    const n = clone();
    const run = n.cols[fromP].splice(fromI);
    const src = n.cols[fromP];
    if (src.length && !src[src.length - 1].up) src[src.length - 1] = { ...src[src.length - 1], up: true };
    n.cols[toP] = n.cols[toP].concat(run);
    n.moves++;
    commit(n);
    return true;
  };

  const tapCol = (p, i) => {
    if (done) return;
    const col = st.cols[p];
    if (sel && sel.p !== p) {
      if (moveRun(sel.p, sel.i, p)) return;
    }
    if (i == null || !runOk(col, i)) { setSel(null); return; }
    if (sel && sel.p === p && sel.i === i) { setSel(null); return; }
    setSel({ p, i });
  };

  // #125 — same give-up path as Klondike.
  const giveUp = () => {
    if (done) return;
    setDone(true);
    onLose && onLose(st.moves, secs, {
      share: `Game Corner Spider Solitaire — gave up today's deal at ${st.done8}/8 runs 🕷️`,
      answer: null,
    });
  };

  /* #123/#170 — canvas plumbing + drag, the Klondike pattern: the box is the
     fit column's flexible region, the layout is recomputed from the CURRENT
     state each render, the authoritative drag lives in a ref (pointer events
     outrun React renders) and the state copy only schedules repaints. */
  const canvasRef = useRef(null);
  const boxRef = useRef(null);
  const { boxW, boxH } = useFitBox(boxRef, { cols: 10, rows: 1 });
  const W = Math.floor(boxW), H = Math.floor(boxH);
  const SP_GAP = 8, SP_PILL_H = 46, SP_NOTE_H = 18, SP_BTN_H = 36;
  const spChrome = SP_PILL_H + SP_GAP + SP_GAP + SP_NOTE_H + 4 + SP_BTN_H + 4;
  const spBoardY = SP_PILL_H + SP_GAP;
  const spBoardH = Math.max(80, H - spChrome);
  const ly = W > 80 && H > 80 ? spLayout(W, spBoardH, st) : null;
  const lyRef = useRef(ly);
  lyRef.current = ly;
  const spTopRef = useRef(spBoardY);
  spTopRef.current = spBoardY;

  const spControls = [];
  if (W > 80) {
    const pr = cuiRow(0, 0, W, SP_PILL_H, 4);
    spControls.push({ id: 'p-time', kind: 'pill', r: pr[0], label: 'Time', value: fmt, gold: true });
    spControls.push({ id: 'p-moves', kind: 'pill', r: pr[1], label: 'Moves', value: st.moves });
    spControls.push({ id: 'p-runs', kind: 'pill', r: pr[2], label: 'Runs', value: `${st.done8}/8` });
    spControls.push({ id: 'deal', kind: 'button', r: pr[3], label: `Deal +10 (${Math.floor(st.stock.length / 10)})`, font: 12, primary: true, disabled: !st.stock.length, action: dealRow });
    const noteY = spBoardY + spBoardH + SP_GAP;
    if (note) spControls.push({ id: 'note', kind: 'label', r: [0, noteY, W, SP_NOTE_H], label: note, gold: true, font: 12 });
    spControls.push({ id: 'giveup', kind: 'button', r: [Math.floor(W * 0.28), noteY + SP_NOTE_H + 4, Math.floor(W * 0.44), SP_BTN_H], label: '🏳️ Give up', disabled: done, action: giveUp });
  }
  const spCtlRef = useRef([]);
  spCtlRef.current = spControls;
  const [spPressed, setSpPressed] = useState(null);

  const [drag, setDrag] = useState(null); // { src:{p,i}, cards, x, y, gx, gy }
  const dragRef = useRef(null);
  const pendRef = useRef(null);
  const setDragBoth = (d) => { dragRef.current = d; setDrag(d); };

  usePointerCell(canvasRef, cuiWrapHandlers(spCtlRef, setSpPressed, cuiShiftHandlers({
    onDown: (pt) => {
      pendRef.current = null;
      if (dragRef.current) setDragBoth(null); // a cancelled drag left a ghost
      const l = lyRef.current;
      if (done || !l) return;
      const hit = spHitAt(l, st, pt.x, pt.y);
      if (!hit || hit.i == null) return;
      if (!runOk(st.cols[hit.p], hit.i)) return;
      pendRef.current = {
        src: { p: hit.p, i: hit.i }, cards: st.cols[hit.p].slice(hit.i),
        x0: l.colX(hit.p), y0: l.colYs[hit.p][hit.i], px: pt.x, py: pt.y,
      };
    },
    onDrag: (pt, info) => {
      const pend = pendRef.current;
      if (done || !pend || !info.moved) return;
      const d = dragRef.current ||
        { src: pend.src, cards: pend.cards, gx: pend.px - pend.x0, gy: pend.py - pend.y0 };
      setDragBoth({ ...d, x: pt.x, y: pt.y });
    },
    onUp: (pt) => {
      pendRef.current = null;
      const d = dragRef.current;
      if (!d) return;
      setDragBoth(null);
      if (done) return;
      const l = lyRef.current;
      if (!l) return;
      const p = Math.max(0, Math.min(9, Math.floor((pt.x - l.x0 + l.gap / 2) / (l.cw + l.gap))));
      moveRun(d.src.p, d.src.i, p); // refusals explain themselves in moveRun
    },
    onTap: (pt) => {
      const l = lyRef.current;
      if (done || !l) return;
      const hit = spHitAt(l, st, pt.x, pt.y);
      if (!hit) { setSel(null); return; }
      tapCol(hit.p, hit.i);
    },
  }, spTopRef)), { moveTolerance: 8 });

  useCanvasBoard(canvasRef, {
    width: W,
    height: H,
    deps: [st, sel, drag, done, W, H, fmt, note, spPressed],
    draw: (ctx) => {
      cuiDrawControls(ctx, spCtlRef.current, spPressed);
      const l = lyRef.current;
      if (!l) return;
      ctx.save();
      ctx.translate(0, spTopRef.current);
      const dragSrc = drag && drag.src;
      for (let p = 0; p < 10; p++) {
        const col = st.cols[p];
        const hideFrom = dragSrc && dragSrc.p === p ? dragSrc.i : Infinity;
        if (!col.length || hideFrom === 0) klDrawSlot(ctx, l, l.colX(p), 0);
        for (let i = 0; i < col.length && i < hideFrom; i++) {
          klDrawCard(ctx, l, l.colX(p), l.colYs[p][i], col[i],
            { sel: sel && sel.p === p && i >= sel.i });
        }
      }
      // The dragged run rides the finger, drawn last so it's on top.
      if (drag) {
        const dx = drag.x - drag.gx, dy = drag.y - drag.gy;
        drag.cards.forEach((c, i) => klDrawCard(ctx, l, dx, dy + i * l.upStep, c, { shadow: i === 0 }));
      }
      ctx.restore();
    },
  });

  return (
    <div className="sp-game fit-col">
      <div className="sp-board-box cui-frame" ref={boxRef}>
        <canvas
          ref={canvasRef}
          className="sp-canvas board-canvas"
          role="img"
          aria-label={`Spider board — ${st.done8}/8 runs cleared, ${Math.floor(st.stock.length / 10)} deals left, ${st.moves} moves`}
        />
      </div>
      <CuiTwin controls={spControls} />
      <div className="p6-hint">One suit: drag (or tap) any descending run. Build K→A to clear a run — 8 clears win.</div>
    </div>
  );
}

/* ---- Mahjong Solitaire (daily) ----------------------------------------------
   60-tile stepped pyramid. A tile is free when nothing rests on it and its
   left or right side is open. The deal is generated by reverse-removal, so
   today's board is always solvable in at least one order. */

/* PHASE 8 (#121) — Mahjong needed something to think about.
   The single fixed silhouette meant the only variable was tapping speed. Six
   layouts now rotate by weekday, ordered gentlest-first by MEASURED solver win
   rate (see MJ_LAYOUTS below), exactly as TM_LAYOUTS/TM_WEEK do for Daily Tile
   Match. Every layout has EXACTLY 60 slots so the resume shape (faces/removed
   arrays of length 60) is unchanged across layouts.

   Difficulty here comes from STRUCTURE — how many tiles sit under other tiles
   and how deep the stacks go — not from the tile count. If you retune these,
   RE-MEASURE with the solver rather than eyeballing the shape; free-tile count
   alone predicts difficulty poorly (the lesson recorded for issue #116). */
function mjRect(z, x0, y0, cols, rows) {
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    out.push({ x: x0 + c * 2, y: y0 + r * 2, z });
  }
  return out;
}

/* Ordered GENTLEST-FIRST BY MEASUREMENT, not by how the shape looks. Win rates
   are from a boosterless greedy solver (no lookahead, no undo/hint/shuffle) over
   1200 seeded deals per layout — the "careless player" baseline:

     Courtyard 35.8%   Tower 35.7%   Fortress 31.7%
     Terrace   30.3%   Pyramid 30.2%   Bridge 27.3%

   Note how weakly the shape predicts the rate: Tower (5 layers) ties Courtyard
   (2 layers), and Fortress beats Pyramid. That is the same trap recorded for
   issue #116 — RE-MEASURE after any retune instead of trusting the silhouette.
   Real players do considerably better than these numbers: they get 3 undos, 3
   hints and a solvability-preserving shuffle.
   Every layout has EXACTLY 60 slots (asserted by the mahjong-layouts self-test)
   so the saved faces/removed arrays are layout-independent. */
const MJ_LAYOUTS = [
  // Broad and shallow — most tiles are open from the start.
  { name: 'Courtyard', pos: [].concat(mjRect(0, 0, 0, 8, 6), mjRect(1, 2, 1, 6, 2)) },
  { name: 'Tower',     pos: [].concat(mjRect(0, 0, 0, 7, 4), mjRect(1, 2, 1, 6, 3), mjRect(2, 4, 2, 4, 2), mjRect(3, 4, 3, 2, 2), [{ x: 8, y: 5, z: 4 }, { x: 6, y: 5, z: 4 }]) },
  { name: 'Fortress',  pos: [].concat(mjRect(0, 0, 0, 6, 4), mjRect(1, 0, 1, 5, 4), mjRect(2, 2, 2, 3, 3), mjRect(3, 4, 3, 2, 2), [{ x: 6, y: 5, z: 4 }, { x: 4, y: 5, z: 4 }, { x: 8, y: 5, z: 4 }]) },
  { name: 'Terrace',   pos: [].concat(mjRect(0, 0, 0, 8, 5), mjRect(1, 2, 1, 6, 3), [{ x: 6, y: 3, z: 2 }, { x: 8, y: 3, z: 2 }]) },
  // The original shipped silhouette.
  { name: 'Pyramid',   pos: [].concat(mjRect(0, 0, 0, 8, 4), mjRect(1, 2, 1, 6, 3), mjRect(2, 4, 2, 4, 2), [{ x: 6, y: 3, z: 3 }, { x: 8, y: 3, z: 3 }]) },
  // Hardest measured: a wide flat base with a narrow bridge over it.
  { name: 'Bridge',    pos: [].concat(mjRect(0, 0, 0, 9, 4), mjRect(1, 2, 1, 6, 3), mjRect(2, 6, 2, 2, 2), [{ x: 8, y: 3, z: 3 }, { x: 10, y: 3, z: 3 }]) },
];

// Weekday → window of the ladder. Monday gentlest, weekend hardest — the same
// shape of progression Daily Tile Match uses.
const MJ_WEEK = [
  [2, 4], // Sun
  [0, 2], // Mon
  [0, 3], // Tue
  [1, 3], // Wed
  [2, 4], // Thu
  [3, 5], // Fri
  [4, 5], // Sat
];

// Pick today's layout deterministically from the day number (so every player
// gets the same silhouette) within that weekday's difficulty window.
function mjLayoutForDay(dayNum) {
  // Day 0 (1970-01-01) was a Thursday; +4 aligns weekday 0 to Sunday.
  const weekday = (((dayNum + 4) % 7) + 7) % 7;
  const [lo, hi] = MJ_WEEK[weekday];
  const span = hi - lo + 1;
  const rng = mulberry32(hashStr('mj-layout:' + dayNum));
  return MJ_LAYOUTS[lo + Math.floor(rng() * span) % span];
}

// Back-compat default (the original 'Pyramid' silhouette) for any caller that
// hasn't been threaded a layout yet — every slot count is 60 either way.
const MJ_LAYOUT = MJ_LAYOUTS[4].pos;

/* Balance knobs (#121). All three are costs, so the score stays bounded and
   MONOTONE — mahjongsol is tier B, and settleDailySession's plausibility check
   marks a run `disputed` if a claimed score can exceed the recomputable ceiling.
   Ceiling = MJ_BASE + layer + chain bonuses at zero time with nothing spent. */
const MJ_UNDOS = 3;
const MJ_HINTS = 3;
const MJ_SHUFFLES = 1;
const MJ_BASE = 1500;
function mjScore(secs, shufflesLeft, undosLeft, layerPts, chainPts) {
  const spentShuffles = MJ_SHUFFLES - shufflesLeft;
  const spentUndos = MJ_UNDOS - undosLeft;
  return Math.max(
    MJ_BASE - secs * 2 - spentShuffles * 150 - spentUndos * 60 + layerPts + chainPts,
    300
  );
}
const MJ_FACES = ['🌸', '🎋', '🌊', '🔥', '⛰️', '🌙', '☀️', '⭐', '🐉', '🐢', '🦅', '🎐', '🍂', '❄️', '🌈', '🪷'];

function mjIsFree(i, removed, layout) {
  const L = layout || MJ_LAYOUT;
  const p = L[i];
  for (let j = 0; j < L.length; j++) {
    if (j === i || removed[j]) continue;
    const q = L[j];
    if (q.z === p.z + 1 && Math.abs(q.x - p.x) < 2 && Math.abs(q.y - p.y) < 2) return false;
  }
  let left = false, right = false;
  for (let j = 0; j < L.length; j++) {
    if (j === i || removed[j]) continue;
    const q = L[j];
    if (q.z !== p.z || Math.abs(q.y - p.y) >= 2) continue;
    if (q.x === p.x - 2) left = true;
    if (q.x === p.x + 2) right = true;
  }
  return !(left && right);
}

/* All currently-free indices in ONE pass instead of an O(n^2) mjIsFree per tile
   per render. On a 60-tile board the old pattern ran ~7200 comparisons every
   render (plus another pass for mjHasMove), which is the render-cost half of
   "tiles don't respond" in #120. */
function mjFreeSet(removed, layout) {
  const L = layout || MJ_LAYOUT;
  const free = new Set();
  for (let i = 0; i < L.length; i++) {
    if (!removed[i] && mjIsFree(i, removed, L)) free.add(i);
  }
  return free;
}

// Reverse-deal: repeatedly pick two currently-free slots and give them the
// same face, then remove them. Playing back in that order solves the board,
// so the deal is guaranteed winnable. Conceptual sibling of lib/dapp.js's
// tileBoard (same layered-board model, solvability added).
function mjDeal(rng, present, layout) {
  const L = layout || MJ_LAYOUT;
  const faces = new Array(L.length).fill(-1);
  const removed = L.map((_, i) => !present[i]);
  let remaining = present.filter(Boolean).length;
  let pairIdx = 0;
  while (remaining >= 2) {
    const free = [];
    for (let i = 0; i < L.length; i++) if (!removed[i] && mjIsFree(i, removed, L)) free.push(i);
    let a, b;
    if (free.length >= 2) {
      const ai = Math.floor(rng() * free.length);
      a = free.splice(ai, 1)[0];
      b = free[Math.floor(rng() * free.length)];
    } else {
      const rest = [];
      for (let i = 0; i < removed.length; i++) if (!removed[i]) rest.push(i);
      a = rest[0]; b = rest[1];
    }
    faces[a] = pairIdx % MJ_FACES.length;
    faces[b] = pairIdx % MJ_FACES.length;
    pairIdx++;
    removed[a] = true;
    removed[b] = true;
    remaining -= 2;
  }
  return faces;
}

// The first free matching pair, or null. Also serves as the "show me a pair"
// hint (#121) so the hint and the stuck-detection can never disagree.
function mjFindPair(faces, removed, layout, freeSet) {
  const L = layout || MJ_LAYOUT;
  const free = freeSet ? Array.from(freeSet) : Array.from(mjFreeSet(removed, L));
  for (let a = 0; a < free.length; a++) {
    for (let b = a + 1; b < free.length; b++) {
      if (faces[free[a]] === faces[free[b]]) return [free[a], free[b]];
    }
  }
  return null;
}

// Any free matching pair left on the board?
function mjHasMove(faces, removed, layout, freeSet) {
  return !!mjFindPair(faces, removed, layout, freeSet);
}

/* The Mahjong board is a CANVAS now (#170 treatment): the DOM board
   positioned 60 absolutely-placed 44px tiles at fixed pixel offsets and
   FitScale-shrank the whole stack, so phones got sub-fingertip tiles.
   Tiles now size from the measured box, and the tap hit-test walks the
   same painter's order the frame was drawn in, so overlapping layers
   resolve exactly as they look. Layout coords are half-tile units
   (p.x, p.y); a layer lifts p.z * lift px, like the DOM's -5px steps. */
function mjGeom(w, h, L) {
  let maxX = 0, maxY = 0, maxZ = 0;
  for (const p of L) { maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); maxZ = Math.max(maxZ, p.z); }
  const padX = 6;
  const build = (tw) => {
    const th = Math.round(tw * 1.27);
    const lift = Math.max(3, Math.round(th * 0.09));
    return { tw, th, lift, bw: maxX * (tw / 2) + tw + padX * 2, bh: maxY * (th / 2) + th + maxZ * lift + 10 };
  };
  let tw = Math.min(56, Math.floor((w - padX * 2) / (maxX / 2 + 1)));
  let g = build(tw);
  let guard = 0;
  while (g.bh > h && tw > 20 && guard++ < 60) { tw -= 1; g = build(tw); }
  const ox = Math.floor((w - g.bw) / 2) + padX;
  const oy = maxZ * g.lift + 4;
  const at = (p) => [ox + p.x * (g.tw / 2), oy + p.y * (g.th / 2) - p.z * g.lift];
  return { ...g, w, h, ox, oy, at, glyphPx: Math.round(g.tw * 0.52) };
}

// Painter's order — z asc, then y, then x — matching the DOM zIndex rule
// (z*100 + y). Hit-testing walks it in reverse so the topmost tile wins.
function mjPaintOrder(L) {
  return L.map((_, i) => i).sort((a, b) =>
    (L[a].z - L[b].z) || (L[a].y - L[b].y) || (L[a].x - L[b].x));
}

function mjHitAt(geo, L, removed, order, x, y) {
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k];
    if (removed[i]) continue;
    const [tx, ty] = geo.at(L[i]);
    if (x >= tx && x < tx + geo.tw && y >= ty && y < ty + geo.th) return i;
  }
  return null;
}

// Intrinsic tile art (the DOM .mj-tile look, hardcoded like every deck in
// the app): edge-colour rounded rect with a 3px bottom lip, ivory vertical
// gradient face, centred emoji glyph. Chrome states (selection ring, hint
// glow, blocked scrim, refusal flash) draw over it; only they read PAL.
const MJ_EDGE_BY_Z = ['#B7C2D8', '#A3B0CB', '#8E9DBD', '#8E9DBD', '#8E9DBD'];
function mjDrawTile(ctx, geo, p, x, y, glyph, o) {
  const { tw, th } = geo;
  const r = Math.max(3, Math.round(tw * 0.13));
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 3;
  klRR(ctx, x, y, tw, th, r);
  ctx.fillStyle = MJ_EDGE_BY_Z[Math.min(p.z, MJ_EDGE_BY_Z.length - 1)];
  ctx.fill();
  ctx.restore();
  const grad = ctx.createLinearGradient(0, y, 0, y + th);
  grad.addColorStop(0, '#F8FAFF');
  grad.addColorStop(1, '#DDE4F2');
  klRR(ctx, x + 1, y + 1, tw - 2, th - 4, Math.max(2, r - 1));
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.font = geo.glyphPx + 'px "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#1E293B';
  ctx.fillText(glyph, x + tw / 2, y + th / 2 - 1);
  if (o && o.blocked) {
    klRR(ctx, x, y, tw, th, r);
    ctx.fillStyle = 'rgba(9,14,24,0.38)'; // ≈ the DOM brightness(.62) dim
    ctx.fill();
  }
  if (o && (o.sel || o.hinted || o.flash)) {
    klRR(ctx, x - 1.5, y - 1.5, tw + 3, th + 3, r + 1);
    ctx.lineWidth = o.hinted ? 3 : 2.5;
    ctx.strokeStyle = o.flash ? PAL.rose : PAL.gold;
    ctx.stroke();
  }
}

function MahjongSolitaireGame({ onWin, onLose, onStepChange, offset, savedProgress, onSaveProgress, playMode, band }) {
  const dayNum = useRef(utcDayNum(offset)).current;
  /* #176 — the cheapest story ladder in the app: MJ_LAYOUTS is ALREADY
     ordered by a measured boosterless solver win rate (Courtyard 35.8% down
     to Bridge 27.3%), so "play them in order" is a real difficulty
     progression with no new content and no rating work. Band index is the
     layout index. Arcade maps its three difficulties onto the same ordering
     rather than inventing a second scale. */
  const bandIdx = playMode === 'story'
    ? Math.min(MJ_LAYOUTS.length - 1, Math.max(0, band || 0))
    : playMode === 'arcade'
      ? Math.round((Math.max(0, ARCADE_BANDS.findIndex(b => b.id === band)) / 2) * (MJ_LAYOUTS.length - 1))
      /* #331 — the daily's Easy/Hard take the measured ladder's own ends
         (gentlest/hardest layout); Normal keeps the day's silhouette. */
      : (playMode === 'daily' && (band === 'easy' || band === 'hard'))
        ? (band === 'easy' ? 0 : MJ_LAYOUTS.length - 1)
      : null;
  const seedBase = useRef(null);
  if (seedBase.current == null) {
    if (playMode === 'story' || playMode === 'arcade') {
      seedBase.current = modeSeed(playMode, 'mahjongsol', bandIdx, offset).seed >>> 0;
    } else if (playMode === 'daily' && (band === 'easy' || band === 'hard')) {
      // Easy/Hard seed their own deal off the band-mixed rng (modeSeed's daily
      // branch returns seed null, so draw straight from the rng).
      seedBase.current = (dailyRng(offset, 'mahjongsol', band)() * 4294967296) >>> 0;
    } else {
      const srv = serverDailySeed('mahjongsol');
      seedBase.current = srv != null ? srv : ((utcDayNum(offset) + hashStr('mahjongsol')) >>> 0);
    }
  }
  // PHASE 8 — today's silhouette. Saved progress carries the layout name so a
  // resumed board is the one you left, even if the ladder is retuned later.
  const layout = useRef(null);
  if (!layout.current) {
    if (bandIdx != null) {
      layout.current = MJ_LAYOUTS[bandIdx];
    } else {
      const saved = savedProgress && savedProgress.dayNum === dayNum && savedProgress.layout
        ? MJ_LAYOUTS.find(l => l.name === savedProgress.layout) : null;
      layout.current = saved || mjLayoutForDay(dayNum);
    }
  }
  const L = layout.current.pos;

  const resumed = savedProgress && savedProgress.dayNum === dayNum &&
    Array.isArray(savedProgress.faces) && savedProgress.faces.length === L.length &&
    Array.isArray(savedProgress.removed)
    ? savedProgress : null;

  const [faces, setFaces] = useState(() =>
    resumed ? resumed.faces.slice() : mjDeal(mulberry32(seedBase.current), L.map(() => true), L)
  );
  const [removed, setRemoved] = useState(() =>
    resumed ? resumed.removed.map(Boolean) : L.map(() => false)
  );
  // #121 — 1 SAFE shuffle (re-dealt with reverse-removal, so it is guaranteed to
  // leave the board solvable) replaces 2 blind ones, plus 3 undos and a capped
  // hint. Old saves carrying shuffles: 2 clamp down.
  const [shuffles, setShuffles] = useState(
    resumed && Number.isFinite(resumed.shuffles) ? Math.min(resumed.shuffles, MJ_SHUFFLES) : MJ_SHUFFLES
  );
  const [undos, setUndos] = useState(
    resumed && Number.isFinite(resumed.undos) ? resumed.undos : MJ_UNDOS
  );
  const [sel, setSel] = useState(null);
  const [pairs, setPairs] = useState(resumed && Number.isFinite(resumed.pairs) ? resumed.pairs : 0);
  const [done, setDone] = useState(false);
  // Scoring inputs (#121): reward clearing buried/high tiles and hint-free
  // chains rather than raw tapping speed.
  const [layerPts, setLayerPts] = useState(resumed && Number.isFinite(resumed.layerPts) ? resumed.layerPts : 0);
  const [chainPts, setChainPts] = useState(resumed && Number.isFinite(resumed.chainPts) ? resumed.chainPts : 0);
  const [chain, setChain] = useState(0);
  const [hintPair, setHintPair] = useState(null);
  const [warn, setWarn] = useState('');
  const history = useRef([]); // undo stack: { sel, i, faces? }
  const initialSecs = savedProgress && Number.isFinite(savedProgress.elapsedSecs) ? savedProgress.elapsedSecs : 0;
  const { secs, fmt } = useTimer(!done, initialSecs);

  const hints = useDailyHints({ gameId: 'mahjongsol', maxHints: MJ_HINTS });

  const remaining = removed.filter((r) => !r).length;
  // #120 — ONE free-set computation per render, shared by the tile renderer, the
  // tap handler, the hint and the stuck check. This used to be an O(n^2) scan
  // per tile plus a second full scan for mjHasMove, every render.
  const freeSet = React.useMemo(() => mjFreeSet(removed, L), [removed, L]);
  const stuck = !done && remaining > 0 && !mjHasMove(faces, removed, L, freeSet);

  // Canvas plumbing — the whole FRAME (controls wave): pills, banner/warn,
  // board and the Undo/Hint/Shuffle row draw on one canvas.
  const canvasRef = useRef(null);
  const boxRef = useRef(null);
  const { boxW, boxH } = useFitBox(boxRef, { cols: 9, rows: 5 });
  const W = Math.floor(boxW), H = Math.floor(boxH);
  const MJ_GAPY = 8, MJ_PILL_H = 46, MJ_MSG_H = 20, MJ_BTN_H = 44;
  const showBanner = stuck && shuffles > 0;
  // The message band is ALWAYS reserved so the board never jumps when a
  // warn/banner appears mid-game (warn wins when both fire).
  const mjChrome = MJ_PILL_H + MJ_GAPY + MJ_MSG_H + 4 + MJ_GAPY + MJ_BTN_H + 4;
  const mjBoardY = MJ_PILL_H + MJ_GAPY + MJ_MSG_H + 4;
  const mjBoardH = Math.max(80, H - mjChrome);
  const geo = W > 80 && H > 80 ? mjGeom(W, mjBoardH, L) : null;
  const geoRef = useRef(geo);
  geoRef.current = geo;
  const order = React.useMemo(() => mjPaintOrder(L), [L]);
  const mjTopRef = useRef(mjBoardY);
  mjTopRef.current = mjBoardY;

  // #120's blocked-tap feedback, canvas edition: a brief rose ring on the
  // tile next to the warn line. One repaint per rAF while the flash lives.
  const flashRef = useRef(null); // { i, t0 }
  const [flashSeq, setFlashSeq] = useState(0);
  const [flashFrame, setFlashFrame] = useState(0);
  useEffect(() => {
    if (!flashRef.current) return;
    let raf = 0;
    const tick = () => {
      if (!flashRef.current) return;
      if (performance.now() - flashRef.current.t0 >= 450) flashRef.current = null;
      setFlashFrame((f) => f + 1);
      if (flashRef.current) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [flashSeq]);

  const stateRef = useRef({});
  stateRef.current = { faces, removed, shuffles, pairs, secs, undos, layerPts, chainPts };
  const buildProgress = () => ({
    dayNum,
    layout: layout.current.name,
    faces: stateRef.current.faces,
    removed: stateRef.current.removed.map((r) => (r ? 1 : 0)),
    shuffles: stateRef.current.shuffles,
    pairs: stateRef.current.pairs,
    undos: stateRef.current.undos,
    layerPts: stateRef.current.layerPts,
    chainPts: stateRef.current.chainPts,
  });
  useAutosave(
    onSaveProgress,
    () => ({ progress: buildProgress(), steps: stateRef.current.pairs, secs: stateRef.current.secs }),
    !done
  );
  const saveNow = (over) =>
    onSaveProgress && onSaveProgress(
      Object.assign(buildProgress(), over || {}),
      (over && over.pairs) != null ? over.pairs : pairs,
      secs
    );

  const tap = (i) => {
    if (done || removed[i] || !freeSet.has(i)) {
      // #120 — a blocked tile used to absorb the tap silently, which is
      // indistinguishable from an unresponsive board. Now it says so: the
      // warn line plus a brief flash ring on the tile (canvas edition of
      // the old DOM nudge shake).
      if (!done && !removed[i]) {
        flashRef.current = { i, t0: performance.now() };
        setFlashSeq((q) => q + 1);
        setWarn('That tile is covered or blocked on both sides.');
        setTimeout(() => setWarn(''), 1600);
      }
      return;
    }
    setHintPair(null);
    if (sel === i) { setSel(null); return; }
    if (sel != null && faces[sel] === faces[i]) {
      const rm = removed.slice();
      rm[sel] = true;
      rm[i] = true;
      const pr = pairs + 1;
      // Layer bonus: a pair pulled off the upper layers was harder to reach.
      const lp = layerPts + (L[sel].z + L[i].z) * 12;
      // Chain bonus: consecutive matches with no hint and no undo in between.
      const ch = chain + 1;
      const cp = chainPts + Math.min(ch, 6) * 8;
      history.current.push({ a: sel, b: i });
      setRemoved(rm); setSel(null); setPairs(pr);
      setLayerPts(lp); setChainPts(cp); setChain(ch);
      onStepChange(pr);
      const won = rm.every(Boolean);
      // Win-move autosave is deliberately skipped — the finish call closes the
      // attempt and a racing progress write 409s against the finished row.
      if (!won) {
        saveNow({ removed: rm.map(r => (r ? 1 : 0)), pairs: pr, layerPts: lp, chainPts: cp });
      }
      if (won) {
        setDone(true);
        onWin(mjScore(secs, shuffles, undos, lp, cp), pr, secs, {
          share: `Game Corner Mahjong Solitaire — cleared today's ${layout.current.name} in ${fmt} 🀄`,
        });
      }
      return;
    }
    setSel(i);
  };

  // #121 — undo. Puts the last cleared pair back; breaks the chain bonus and
  // costs points at the end, so it is a real decision rather than a free rewind.
  const doUndo = () => {
    if (done || undos <= 0 || !history.current.length) return;
    const last = history.current.pop();
    const rm = removed.slice();
    rm[last.a] = false;
    rm[last.b] = false;
    const pr = Math.max(0, pairs - 1);
    const u = undos - 1;
    setRemoved(rm); setPairs(pr); setUndos(u); setSel(null); setChain(0); setHintPair(null);
    onStepChange(pr);
    saveNow({ removed: rm.map(r => (r ? 1 : 0)), pairs: pr, undos: u });
  };

  // #121 — hint. Counted server-side through the shared daily_hints cap, like
  // Word Search's, so it can't be reset by reloading.
  const buyHint = async () => {
    if (done) return;
    const pair = mjFindPair(faces, removed, L, freeSet);
    if (!pair) { setWarn('No free pair right now — try a shuffle.'); setTimeout(() => setWarn(''), 1800); return; }
    const ok = await hints.buy();
    if (!ok) return;
    setHintPair(pair);
    setChain(0); // a hinted match doesn't extend the chain bonus
  };

  const doShuffle = () => {
    if (done || shuffles <= 0 || remaining === 0) return;
    // Reverse-removal re-deal of the REMAINING slots: the shuffle is guaranteed
    // to leave the board solvable from here, which a blind re-deal was not.
    const rng = mulberry32((seedBase.current + remaining * 7919 + shuffles * 104729) >>> 0);
    const nf = mjDeal(rng, removed.map((r) => !r), L);
    const merged = faces.map((f, i) => (removed[i] ? f : nf[i]));
    const sh = shuffles - 1;
    setFaces(merged);
    setShuffles(sh);
    setSel(null);
    setHintPair(null);
    setChain(0);
    history.current = []; // the pre-shuffle board no longer exists to undo into
    saveNow({ faces: merged, shuffles: sh });
  };

  // Out of moves and out of shuffles → the day is lost.
  useEffect(() => {
    if (stuck && shuffles <= 0 && !done) {
      setDone(true);
      onLose && onLose(pairs, secs, {
        share: `Game Corner Mahjong Solitaire — today's ${layout.current.name} got the better of me 🀄`,
        answer: `${remaining} tiles were left with no free pair.`,
      });
    }
  }, [stuck, shuffles, done]);

  const mjControls = [];
  if (W > 80) {
    const pr = cuiRow(0, 0, W, MJ_PILL_H, 4);
    mjControls.push({ id: 'p-time', kind: 'pill', r: pr[0], label: 'Time', value: fmt, gold: true });
    mjControls.push({ id: 'p-tiles', kind: 'pill', r: pr[1], label: 'Tiles', value: `${remaining}/${L.length}` });
    mjControls.push({ id: 'p-chain', kind: 'pill', r: pr[2], label: 'Chain', value: `×${Math.min(chain, 6)}` });
    mjControls.push({ id: 'p-board', kind: 'pill', r: pr[3], label: 'Board', value: layout.current.name });
    const msgY = MJ_PILL_H + MJ_GAPY;
    if (warn) mjControls.push({ id: 'warn', kind: 'label', r: [0, msgY, W, MJ_MSG_H], label: warn, color: PAL.rose, font: 12 });
    else if (showBanner) mjControls.push({ id: 'banner', kind: 'label', r: [0, msgY, W, MJ_MSG_H], label: 'No free pair left — use your shuffle to keep going.', gold: true, font: 12 });
    const btnY = mjBoardY + mjBoardH + MJ_GAPY;
    const br = cuiRow(Math.floor(W * 0.02), btnY, Math.floor(W * 0.96), MJ_BTN_H, 3);
    mjControls.push({ id: 'undo', kind: 'button', r: br[0], label: `↶ Undo (${undos})`, font: 13, disabled: undos <= 0 || !history.current.length || done, action: doUndo });
    mjControls.push({ id: 'hint', kind: 'button', r: br[1], label: `💡 Hint (${hints.hintsLeft})`, font: 13, disabled: done || hints.exhausted || hints.buying, action: buyHint });
    mjControls.push({ id: 'shuffle', kind: 'button', r: br[2], label: `🔀 Shuffle (${shuffles})`, font: 13, disabled: shuffles <= 0 || done, action: doShuffle });
  }
  const mjCtlRef = useRef([]);
  mjCtlRef.current = mjControls;
  const [mjPressed, setMjPressed] = useState(null);

  usePointerCell(canvasRef, cuiWrapHandlers(mjCtlRef, setMjPressed, cuiShiftHandlers({
    onTap: (pt) => {
      const g = geoRef.current;
      if (done || !g) return;
      const i = mjHitAt(g, L, removed, order, pt.x, pt.y);
      if (i == null) { setSel(null); return; }
      tap(i);
    },
  }, mjTopRef)), { moveTolerance: 10 });

  useCanvasBoard(canvasRef, {
    width: W,
    height: H,
    deps: [faces, removed, sel, hintPair, done, W, H, flashFrame, fmt, warn, showBanner, undos, shuffles, hints.hintsLeft, mjPressed],
    draw: (ctx) => {
      cuiDrawControls(ctx, mjCtlRef.current, mjPressed);
      const g = geoRef.current;
      if (!g) return;
      ctx.save();
      ctx.translate(0, mjTopRef.current);
      const flash = flashRef.current;
      for (const i of order) {
        if (removed[i]) continue;
        const [tx, ty] = g.at(L[i]);
        mjDrawTile(ctx, g, L[i], tx, ty, MJ_FACES[faces[i]], {
          blocked: !freeSet.has(i),
          sel: sel === i,
          hinted: hintPair && (hintPair[0] === i || hintPair[1] === i),
          flash: flash && flash.i === i,
        });
      }
      ctx.restore();
    },
  });

  return (
    <div className="mj-game fit-col">
      <div className="mj-board-box cui-frame" ref={boxRef}>
        <canvas
          ref={canvasRef}
          className="mj-canvas board-canvas"
          role="img"
          aria-label={`Mahjong board — ${remaining}/${L.length} tiles left, ${layout.current.name} layout`}
        />
      </div>
      <CuiTwin controls={mjControls} />
      <div className="p6-hint">
        Tap two matching free tiles (uncovered, with an open side). Upper-layer clears and
        hint-free chains are worth more — undos and shuffles cost points.
      </div>
    </div>
  );
}

/* ---- Nonogram (daily) --------------------------------------------------------
   8×8 picture-logic puzzle. Fill cells so every row and column matches its
   run clues; any grid satisfying all clues wins. */

const NG_GAP = 2;

function ngClues(line) {
  const out = [];
  let run = 0;
  for (const v of line) {
    if (v === 1) run++;
    else if (run) { out.push(run); run = 0; }
  }
  if (run) out.push(run);
  return out.length ? out : [0];
}

/* ============================================================
   Nonogram — line-solvability and structured pictures (#176)
   ============================================================
   Two problems, and the second is the one that matters.

   1. THE PICTURE. The generator filled cells at 55% at random, which produces
      static, not a picture. Real picross puzzles are recognisable shapes, and
      the request asked for silhouettes. ngGenerateShape draws with SYMMETRY
      and CONNECTIVITY instead of noise: a mirrored blob grown from a seed
      cluster reads as an object even when it is not a specific one.

   2. SOLVABILITY. A nonogram is only fair if it can be solved LINE BY LINE
      without ever guessing — which an arbitrary picture usually cannot be.
      ngLineSolve is the gate: it repeatedly intersects every legal placement
      of each row and column clue against what is already known, and a puzzle
      ships only if that alone completes it. This is the same shape of
      constraint as Mine Finder's no-guess check, and it was built alongside it
      for that reason.

   Difficulty is grid size crossed with how much work the line solver needs,
   which is the honest measure: a big sparse picture can be easier than a small
   dense one.
   ============================================================ */

/* Every arrangement of a clue in a line of length n, as bitmask pairs
   (filled, known) — memoised per (clue, length) because the solver asks for
   the same line shapes over and over. */
const NG_PLACEMENT_CACHE = new Map();
function ngPlacements(clue, n) {
  const key = n + ':' + clue.join(',');
  const hit = NG_PLACEMENT_CACHE.get(key);
  if (hit) return hit;
  const out = [];
  const blocks = clue.filter(v => v > 0);
  const build = (idx, pos, acc) => {
    if (out.length > 20000) return;                // pathological line: bail
    if (idx === blocks.length) {
      out.push(acc.concat(new Array(n - acc.length).fill(0)));
      return;
    }
    const remaining = blocks.slice(idx).reduce((a, b) => a + b, 0) + (blocks.length - idx - 1);
    for (let start = pos; start + remaining <= n; start++) {
      const next = acc.concat(
        new Array(start - acc.length).fill(0),
        new Array(blocks[idx]).fill(1)
      );
      build(idx + 1, start + blocks[idx] + 1, next);
    }
  };
  build(0, 0, []);
  NG_PLACEMENT_CACHE.set(key, out);
  return out;
}

/* Solve by line intersection alone. `grid` is -1 unknown / 0 empty / 1 filled.
   Returns { solved, passes } — `passes` is how many full sweeps it needed,
   which is the difficulty signal: a puzzle solved in two sweeps is gentle, one
   that takes eight is work. */
function ngLineSolve(rowClues, colClues, rows, cols) {
  const grid = Array.from({ length: rows }, () => new Array(cols).fill(-1));
  let passes = 0;

  const solveLine = (cells, clue) => {
    const options = ngPlacements(clue, cells.length)
      .filter(opt => opt.every((v, i) => cells[i] === -1 || cells[i] === v));
    if (!options.length) return null;              // contradiction
    const out = cells.slice();
    for (let i = 0; i < cells.length; i++) {
      if (out[i] !== -1) continue;
      const first = options[0][i];
      if (options.every(o => o[i] === first)) out[i] = first;
    }
    return out;
  };

  for (;;) {
    let changed = false;
    passes += 1;
    if (passes > 40) return { solved: false, passes };
    for (let r = 0; r < rows; r++) {
      const next = solveLine(grid[r], rowClues[r]);
      if (!next) return { solved: false, passes };
      for (let c = 0; c < cols; c++) if (next[c] !== grid[r][c]) { grid[r][c] = next[c]; changed = true; }
    }
    for (let c = 0; c < cols; c++) {
      const col = grid.map(row => row[c]);
      const next = solveLine(col, colClues[c]);
      if (!next) return { solved: false, passes };
      for (let r = 0; r < rows; r++) if (next[r] !== grid[r][c]) { grid[r][c] = next[r]; changed = true; }
    }
    if (!changed) break;
  }
  const solved = grid.every(row => row.every(v => v !== -1));
  return { solved, passes };
}

/* Draw a silhouette rather than static: grow a connected blob from a few seed
   cells, then mirror it. Symmetry is what makes a low-resolution shape read as
   an object — it is why almost every hand-authored picross picture has it. */
function ngGenerateShape(rng, rows, cols, density) {
  const g = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const halfW = Math.ceil(cols / 2);
  const target = Math.round(rows * halfW * density);
  const seeds = Math.max(2, Math.round(halfW / 2));
  const stack = [];
  for (let i = 0; i < seeds; i++) {
    stack.push([Math.floor(rng() * rows), Math.floor(rng() * halfW)]);
  }
  let filled = 0;
  let guard = rows * cols * 40;
  while (filled < target && stack.length && guard-- > 0) {
    const [r, c] = stack[Math.floor(rng() * stack.length)];
    if (r < 0 || r >= rows || c < 0 || c >= halfW) continue;
    if (!g[r][c]) { g[r][c] = 1; filled += 1; }
    // Grow orthogonally so the shape stays connected and blocky.
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    const [dr, dc] = dirs[Math.floor(rng() * 4)];
    stack.push([r + dr, c + dc]);
    if (stack.length > 400) stack.splice(0, 200);
  }
  // Mirror the left half onto the right.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < halfW; c++) g[r][cols - 1 - c] = g[r][c];
  }
  return g;
}

/* The ladder: grid size, with density rising a little alongside it. Each band
   is verified line-solvable before it ships. */
const NG_BANDS = [
  { rows: 5,  cols: 5,  density: 0.55 },
  { rows: 8,  cols: 8,  density: 0.55 },
  { rows: 10, cols: 10, density: 0.52 },
  { rows: 12, cols: 12, density: 0.50 },
  { rows: 15, cols: 15, density: 0.48 },
  { rows: 15, cols: 15, density: 0.44 },
];

function ngBuildForBand(rng, bandIdx) {
  const spec = NG_BANDS[Math.min(NG_BANDS.length - 1, Math.max(0, bandIdx))];
  const { rows, cols } = spec;
  let fallback = null;
  for (let attempt = 0; attempt < 150; attempt++) {
    const grid = ngGenerateShape(rng, rows, cols, spec.density);
    // Reject degenerate pictures: an empty row or column makes a boring clue
    // and a nearly-full grid is not a silhouette.
    const total = grid.flat().filter(Boolean).length;
    if (total < rows * cols * 0.2 || total > rows * cols * 0.75) continue;
    if (!grid.every(row => row.some(Boolean))) continue;
    if (!grid[0].every((_, c) => grid.some(row => row[c]))) continue;

    const rowClues = grid.map(ngClues);
    const colClues = grid[0].map((_, c) => ngClues(grid.map(row => row[c])));
    const check = ngLineSolve(rowClues, colClues, rows, cols);
    const out = { grid, rowClues, colClues, rows, cols, passes: check.passes };
    if (check.solved) return out;
    if (!fallback) fallback = out;
  }
  /* Nothing verified in 150 tries. Hand back the last shape rather than hang.
     This is the one place a nonogram could ship needing a guess; measured over
     20 boards per band it does not fire at all, and the sparse top band was
     retuned from 0.40 to 0.44 density precisely because at 0.40 it fired a
     quarter of the time.

     `fallback` is only assigned by attempts that got PAST the degenerate-shape
     filters, so a seed whose every attempt is rejected there leaves it null —
     and a null board is not a fallback, it is a crash at mount two lines later
     (`built.current.rows`). A generator's last resort has to be a board. */
  return fallback || ngBuildPlainBoard(rows, cols);
}

/* The unconditional last resort: a checkerboard-ish silhouette built without
   any rng, so it is always well-formed and always passes the shape filters by
   construction. It exists to be a board, not to be a good puzzle. */
function ngBuildPlainBoard(rows, cols) {
  const grid = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => ((r + c) % 3 === 0 || r === c ? 1 : 0)));
  const rowClues = grid.map(ngClues);
  const colClues = grid[0].map((_, c) => ngClues(grid.map(row => row[c])));
  return { grid, rowClues, colClues, rows, cols, passes: 0 };
}

/* ---- Nonogram validation (#218) --------------------------------------------
   Every check below reads the CLUES, never the generated picture. That is
   deliberate: ngBuildForBand's last-resort paths (`fallback`, and
   ngBuildPlainBoard below it) can ship a board whose clues admit more than one
   arrangement, so diffing the player's grid against `target` would call a
   perfectly legal alternative solution a mistake. Sudoku takes exactly the
   same stance (see sudokuConflicts: "no hidden correct answer comparison").

   Cell values are the component's: 0 blank, 1 filled, 2 marked empty. */

/* 'done'  the line's filled runs match its clue exactly.
   'error' no arrangement of the clue is reachable from this line any more.
   'open'  neither yet. */
function ngLineState(cells, clue) {
  const want = clue && clue.length ? clue : [0];
  const got = ngClues(cells.map((v) => (v === 1 ? 1 : 0)));
  if (got.length === want.length && got.every((v, k) => v === want[k])) return 'done';
  const places = ngPlacements(want, cells.length);
  /* ngPlacements BAILS past 20000 arrangements, and a truncated list would let
     a still-reachable line be called an error. An unprovable error is not an
     error, so an incomplete enumeration reads as 'open'. */
  if (!places || !places.length || places.length > 20000) return 'open';
  for (const p of places) {
    let ok = true;
    for (let i = 0; i < cells.length; i++) {
      /* A filled cell must fall inside a run, and a mark is the player
         asserting the cell is empty, so a run needing it is ruled out. */
      if ((cells[i] === 1 && !p[i]) || (cells[i] === 2 && p[i])) { ok = false; break; }
    }
    if (ok) return 'open';
  }
  return 'error';
}

/* One pass over the board: the per-line states the clue tints read, the counts
   the pills read, and the two completion facts the banner branches on.

   `complete` means "the player has committed to a whole picture". It is true
   when the filled count reaches the clue total OR when no blank cell is left,
   because plenty of players never place a single mark, so "no blanks" alone
   would never fire for them. */
function ngValidate(grid, rowClues, colClues) {
  const rows = grid.length, cols = rows ? grid[0].length : 0;
  const rowStates = rowClues.map((cl, r) => ngLineState(grid[r], cl));
  const colStates = colClues.map((cl, c) => ngLineState(grid.map((row) => row[c]), cl));
  let filled = 0, blanks = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (grid[r][c] === 1) filled++;
    else if (grid[r][c] === 0) blanks++;
  }
  const targetFilled = rowClues.reduce((n, cl) => n + cl.reduce((a, b) => a + b, 0), 0);
  const errorCount = rowStates.filter((s) => s === 'error').length +
                     colStates.filter((s) => s === 'error').length;
  const doneCount = rowStates.filter((s) => s === 'done').length +
                    colStates.filter((s) => s === 'done').length;
  const solved = rowStates.every((s) => s === 'done') && colStates.every((s) => s === 'done');
  return {
    rowStates, colStates, errorCount, doneCount, solved, filled, blanks, targetFilled,
    lines: rows + cols,
    complete: solved || (targetFilled > 0 && filled === targetFilled) || blanks === 0,
  };
}

/* Board geometry, extracted so it is testable and so the board can never again
   be DRAWN at one size and CLICKED at another.

   #176 made the grid a band property (5x5 up to 15x15) while this game kept
   three literal 8s: the cell fit was over a fixed 10 tracks, the board width
   was `cellStep * 8`, and the hit test clamped to `r > 7 || c > 7`. So on
   10x10 and up the trailing rows and columns were drawn outside the canvas and
   could not be tapped at all, which made the win UNREACHABLE on story rungs 3
   to 6; and on 5x5 a tap in the phantom area returned { r: 6, c: 6 } and threw
   at the top of apply(), which is a blank screen. This is the bug class
   CLAUDE.md names: a canvas board reads its dimensions from the run.

   The gutters are sized from the ACTUAL clue content (the longest row clue
   string, the tallest column clue stack) rather than a flat two cells, because
   a 15-wide line's clue does not fit inside two of its own cells. */
function ngGeometry(W, availH, rows, cols, m) {
  const GAP = 8, PILL_H = 46, MODE_H = 48;
  const chrome = PILL_H + MODE_H + GAP * 2;
  const availW = Math.max(0, Math.floor(W)) - 8;
  const availB = Math.max(0, Math.floor(availH) - chrome) - 8;
  const rowChars = Math.max(1, (m && m.rowChars) || 1);
  const colLines = Math.max(1, (m && m.colLines) || 1);
  /* A 15x15 cell cannot be a 20px fingertip and still fit a phone column, so
     the floor scales with the board: a big band shrinks rather than clips. */
  const minCell = Math.max(rows, cols) > 8 ? 13 : 20;
  const fontOf = (px) => Math.max(9, Math.round(px * 0.42));
  let cell = minCell, gutterX = 0, gutterY = 0;
  // Cell size and gutter size each depend on the other, so settle them.
  for (let pass = 0; pass < 3; pass++) {
    const byW = Math.floor((availW - gutterX - NG_GAP * (cols - 1)) / Math.max(1, cols));
    const byH = Math.floor((availB - gutterY - NG_GAP * (rows - 1)) / Math.max(1, rows));
    cell = Math.max(minCell, Math.min(42, Math.min(byW, byH)));
    const f = fontOf(cell);
    gutterX = Math.max(cell, Math.ceil(rowChars * f * 0.62) + 8);
    gutterY = Math.max(cell, colLines * (f + 2) + 6);
  }
  const cellStep = cell + NG_GAP;
  const boardW = gutterX + cellStep * cols - NG_GAP;
  const boardH = gutterY + cellStep * rows - NG_GAP;
  return {
    GAP, PILL_H, MODE_H, chrome, cell, cellStep, clueFont: fontOf(cell),
    gutterX, gutterY, boardW, boardH,
    H: chrome + boardH,
    boardX: Math.floor((Math.floor(W) - boardW) / 2),
    boardY: PILL_H + GAP,
    modesY: PILL_H + GAP + boardH + GAP,
  };
}

/* The hit test, bounded by the board that was actually dealt. */
function ngCellAt(geom, rows, cols, p) {
  const c = Math.floor((p.x - geom.boardX - geom.gutterX) / geom.cellStep);
  const r = Math.floor((p.y - geom.boardY - geom.gutterY) / geom.cellStep);
  if (c < 0 || c >= cols || r < 0 || r >= rows) return null;
  return { r, c };
}

function ngReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/* ?ngfill=wrong|error|solved seeds a board state that proposal checks and the
   before/after screenshots can NAVIGATE to. Every one of these states is
   otherwise reachable only by tapping cells, and neither a check nor a
   screenshot can tap. Honoured only where there is no attempt to write into
   (see the call site), so it can never fabricate progress in a claimed daily.

   'solved' the day's picture, completed.
   'wrong'  fully decided, provably not a solution.
   'error'  partial, with one line that can no longer match its clue. */
function ngDeepLinkGrid(target, rowClues, colClues) {
  let v = null;
  try { v = new URLSearchParams(window.location.search).get('ngfill'); } catch {}
  if (v !== 'wrong' && v !== 'error' && v !== 'solved') return null;
  const rows = target.length, cols = target[0].length;
  if (v === 'error') {
    /* One solid row. Its clue sums to less than the width on any real board
       (the generator caps a picture at 75% of the cells), so the row holds more
       filled cells than the clue allows and can never match, while the blanks
       everywhere else keep the grid incomplete. */
    const g = Array.from({ length: rows }, () => new Array(cols).fill(0));
    let r0 = rowClues.findIndex((cl) => cl.reduce((a, b) => a + b, 0) < cols);
    if (r0 < 0) r0 = 0;
    for (let c = 0; c < cols; c++) g[r0][c] = 1;
    return g;
  }
  const g = target.map((row) => row.map((x) => (x ? 1 : 2)));
  if (v === 'solved') return g;
  /* 'wrong': swap one filled cell with one empty one. The filled COUNT stays
     right (so the grid still reads as complete) while the two lines the swap
     touched hold one cell too few and one too many, neither of which any
     arrangement of their clues can absorb. */
  let a = null, b = null;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!a && g[r][c] === 1) a = [r, c];
    if (!b && g[r][c] === 2) b = [r, c];
  }
  if (a && b) { g[a[0]][a[1]] = 2; g[b[0]][b[1]] = 1; }
  return g;
}

function NonogramGame({ onWin, onStepChange, offset, savedProgress, onSaveProgress, playMode, band }) {
  const dayNum = useRef(utcDayNum(offset)).current;
  /* #176 — every board is now a symmetric silhouette that has been PROVEN
     line-solvable, including the daily. Band 1 keeps the daily's 8×8 shape, so
     it does not change size; it stops being random static and starts being a
     picture you can always reason your way through. */
  const bandIdx = playMode === 'story' ? Math.max(0, band || 0)
    : playMode === 'arcade'
      ? [0, 2, 4][Math.max(0, ARCADE_BANDS.findIndex(b => b.id === band))]
      /* #331 — the daily's Easy/Hard take NG_BANDS' own ends (the 5×5 and the
         sparse 15×15); Normal keeps the daily's 8×8 shape. */
      : (playMode === 'daily' && (band === 'easy' || band === 'hard'))
        ? (band === 'easy' ? 0 : NG_BANDS.length - 1)
      : 1;
  const built = useRef(null);
  if (!built.current) {
    const { rng } = playMode === 'story' || playMode === 'arcade'
      ? modeSeed(playMode, 'nonogram', bandIdx, offset)
      : { rng: dailyRng(offset, 'nonogram',
          playMode === 'daily' && (band === 'easy' || band === 'hard') ? band : undefined) };
    built.current = ngBuildForBand(rng, bandIdx);
  }
  const NG_ROWS = built.current.rows, NG_COLS = built.current.cols;
  const target = useRef(built.current.grid);
  const rowClues = built.current.rowClues;
  const colClues = built.current.colClues;

  /* The saved grid has to MATCH THIS BOARD, not merely be an array. #176 made
     the board size a band property (5x5 up to 15x15), so a snapshot from a
     different band — or a staging fixture that hardcodes one size — hydrates a
     grid the draw loop then indexes out of bounds: `grid[r][c]` on a missing
     row throws at mount, and a mount-time throw is a blank screen, not a
     graceful fallback. Dimensions are cheap to check; a wrong-sized snapshot
     is simply not a resume. */
  const ngFits = (g) => Array.isArray(g) && g.length === NG_ROWS &&
    g.every((row) => Array.isArray(row) && row.length === NG_COLS);
  const resumed = savedProgress && savedProgress.dayNum === dayNum && ngFits(savedProgress.grid)
    ? savedProgress : null;
  // 0 = blank, 1 = filled, 2 = marked ✗
  /* ?ngfill=wrong|error|solved. Honoured ONLY when there is no attempt to save
     into: onSaveProgress is absent in practice, review and the signed-out
     path, so a seeded board can never fabricate progress inside a claimed
     daily. It exists because the states below are reachable only by tapping
     cells, and neither a proposal check nor a screenshot can tap. */
  const seeded = useRef(null);
  if (seeded.current === null) {
    seeded.current = onSaveProgress
      ? false
      : (ngDeepLinkGrid(built.current.grid, rowClues, colClues) || false);
  }
  const [grid, setGrid] = useState(() =>
    seeded.current ? seeded.current.map((row) => row.slice())
      : resumed ? resumed.grid.map((row) => row.slice())
        : Array.from({ length: NG_ROWS }, () => new Array(NG_COLS).fill(0))
  );
  /* Completed-but-wrong pictures, counted across the whole run. Saves written
     before #218 have no `mistakes` key, so the default is 0 rather than a
     hydration failure. */
  const [mistakes, setMistakes] = useState(() =>
    resumed && Number.isFinite(resumed.mistakes) ? resumed.mistakes : 0);
  const [mode, setMode] = useState('fill'); // 'fill' | 'mark'
  const [steps, setSteps] = useState(() => (savedProgress && Number.isFinite(savedProgress.steps) ? savedProgress.steps : 0));
  const [done, setDone] = useState(false);
  const initialSecs = savedProgress && Number.isFinite(savedProgress.elapsedSecs) ? savedProgress.elapsedSecs : 0;
  const { secs, fmt } = useTimer(!done, initialSecs);

  const stateRef = useRef({});
  stateRef.current = { grid, steps, secs, mistakes };
  useAutosave(
    onSaveProgress,
    () => ({
      progress: { dayNum, grid: stateRef.current.grid, mistakes: stateRef.current.mistakes },
      steps: stateRef.current.steps,
      secs: stateRef.current.secs,
    }),
    !done
  );

  /* Re-render on a theme flip: the Errors pill bakes a resolved PAL colour
     into its control object at render time, and useCanvasBoard's own theme
     redraw would otherwise repaint a stale one. */
  const themeV = useThemeVersion();

  /* One validation pass per board state, memoised on grid IDENTITY (every edit
     replaces the array), because ngLineState enumerates clue placements and the
     draw loop, the pills and the banner all want the same answer. */
  const vcache = useRef({ key: null, val: null });
  if (vcache.current.key !== grid) {
    vcache.current = { key: grid, val: ngValidate(grid, rowClues, colClues) };
  }
  const view = vcache.current.val;

  /* A wrong picture is one mistake, not one per tap: counted on the TRANSITION
     into "complete and not a solution", so nudging cells around inside a wrong
     grid does not rack up a tally. */
  const wrongRef = useRef(view.complete && !view.solved);
  const mistakesRef = useRef(mistakes);
  mistakesRef.current = mistakes;

  const [flash, setFlash] = useState(null); // 'err' | 'ok' | null
  const flashT = useRef(null);
  const pulse = (kind) => {
    if (ngReducedMotion()) return;
    setFlash(kind);
    clearTimeout(flashT.current);
    flashT.current = setTimeout(() => setFlash(null), 600);
  };
  useEffect(() => () => clearTimeout(flashT.current), []);

  // ---- Responsive canvas frame (controls wave) ----------------------------
  // Clue gutters live inside the canvas, and so do the pills and the Fill/Mark
  // toggle — the whole frame scales as one unit. Geometry is a pure function of
  // the board that was actually dealt (see ngGeometry), so a 5×5 rung and a
  // 15×15 rung are both drawn and hit-tested at their own size.
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const { boxW, boxH } = useFitBox(boxRef, { cols: 1, rows: 1, maxCell: 100000 });
  const W = Math.floor(boxW);
  const geom = ngGeometry(W, boxH, NG_ROWS, NG_COLS, {
    rowChars: rowClues.reduce((n, cl) => Math.max(n, cl.join(' ').length), 1),
    colLines: colClues.reduce((n, cl) => Math.max(n, cl.length), 1),
  });
  const { GAP, PILL_H, MODE_H, cell, cellStep, clueFont, gutterX, gutterY, H, boardX, boardY, modesY } = geom;

  const liveRef = useRef({});
  liveRef.current = { grid, mode, done, steps, secs, geom };
  /* The step counter, advanced SYNCHRONOUSLY. pointermove is not a discrete
     event, so React batches a stroke's paints into one render — reading
     `steps` from liveRef for each of them would count a five-cell sweep as one
     step, making a drag cheaper than five taps on a scored board (#222). It is
     re-synced from state on every render, so the two can never drift. */
  const stepsRef = useRef(0);
  stepsRef.current = steps;

  const cellAt = (p) => ngCellAt(liveRef.current.geom, NG_ROWS, NG_COLS, p);

  const finish = (ns, sc, nm) => {
    setDone(true);
    pulse('ok');
    // Each completed-but-wrong picture costs 50, on the same floor as before.
    const score = Math.max(1400 - ns * 4 - sc * 2 - nm * 50, 250);
    onWin(score, ns, sc, {
      share: `Game Corner Nonogram: today's ${NG_COLS}×${NG_ROWS} picture in ${fmt}`
        + (nm ? `, ${nm} mistake${nm === 1 ? '' : 's'}` : ', no mistakes') + ' 🖼️',
    });
  };

  // `paintMode` is applied rather than the live mode, so long-press can invert
  // the action exactly the way Mine Finder does.
  /* One place decides what a changed grid MEANS — validation, the mistake
     counter, the step, the save and the win — so a tap and a drag stroke can
     never diverge on any of it (#222). `apply` toggles one cell and hands the
     result here; a stroke paints into its own copy and hands it here too. */
  const commitGrid = (g) => {
    const cur = liveRef.current;
    if (cur.done) return;
    const ns = stepsRef.current + 1;
    stepsRef.current = ns;
    const res = ngValidate(g, rowClues, colClues);
    const won = res.solved;
    const nowWrong = res.complete && !won;
    let nm = mistakesRef.current;
    if (nowWrong && !wrongRef.current) {
      nm = nm + 1;
      mistakesRef.current = nm;
      setMistakes(nm);
      pulse('err');
    }
    wrongRef.current = nowWrong;
    setGrid(g);
    setSteps(ns);
    onStepChange(ns);
    // Skip the save on the winning move — the finish closes the attempt and a
    // racing progress write would 409 against the closed row.
    if (!won && onSaveProgress) onSaveProgress({ dayNum, grid: g, mistakes: nm }, ns, cur.secs);
    if (won) finish(ns, cur.secs, nm);
  };

  const apply = (r, c, paintMode) => {
    const cur = liveRef.current;
    if (cur.done) return;
    const g = cur.grid.map((row) => row.slice());
    const v = g[r][c];
    if (paintMode === 'fill') g[r][c] = v === 1 ? 0 : 1;
    else g[r][c] = v === 2 ? 0 : 2;
    commitGrid(g);
  };

  /* A board seeded solved by ?ngfill=solved has to report itself: the win is
     detected inside commitGrid(), and nothing was tapped. */
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current || !seeded.current || !view.solved || done) return;
    firedRef.current = true;
    finish(steps, secs, mistakes);
  }, [view.solved]);

  const filled = view.filled;
  const controls = [];
  if (W > 80) {
    const pr = cuiRow(0, 0, W, PILL_H, 4);
    controls.push({ id: 'p-time', kind: 'pill', r: pr[0], label: 'Time', value: fmt, gold: true });
    controls.push({ id: 'p-steps', kind: 'pill', r: pr[1], label: 'Steps', value: steps });
    controls.push({ id: 'p-filled', kind: 'pill', r: pr[2], label: 'Filled', value: `${filled}/${view.targetFilled}` });
    // PAL (not C) — a pill's colour is painted onto a canvas.
    controls.push({
      id: 'p-errors', kind: 'pill', r: pr[3], label: 'Errors', value: view.errorCount,
      color: view.errorCount ? PAL.rose : undefined,
    });
    const bw = Math.min(170, Math.floor((W - GAP) / 2));
    const bx = Math.floor((W - bw * 2 - GAP) / 2);
    controls.push({ id: 'mode-fill', kind: 'button', r: [bx, modesY, bw, MODE_H], label: '⬛ Fill', on: mode === 'fill', action: () => setMode('fill') });
    controls.push({ id: 'mode-mark', kind: 'button', r: [bx + bw + GAP, modesY, bw, MODE_H], label: '✗ Mark', on: mode === 'mark', action: () => setMode('mark') });
  }
  const ctlRef = useRef([]);
  ctlRef.current = controls;
  const [pressedId, setPressedId] = useState(null);

  /* Four tones, one line, always present. `info` is the running progress
     report; `warn` fires the moment a line becomes impossible, which is what
     turns "I filled it all in and nothing happened" into feedback you get
     while there is still something to do about it. */
  const tone = view.solved ? 'ok' : view.complete ? 'err' : view.errorCount ? 'warn' : 'info';
  const nErr = view.errorCount;
  const statusText = view.solved
    ? 'Solved! Every row and column matches its clues.'
    : view.complete
      ? (nErr
        ? `Not quite. The grid is full, and ${nErr} ${nErr === 1 ? 'line does' : 'lines do'} not match ${nErr === 1 ? 'its clue' : 'their clues'} (shown in red).`
        : 'Not quite. The grid is full, but the picture does not match the clues.')
      : nErr
        ? `${nErr} ${nErr === 1 ? 'line can' : 'lines can'} no longer match ${nErr === 1 ? 'its clue' : 'their clues'}. Look for the red numbers.`
        : `${filled} of ${view.targetFilled} cells filled. ${view.doneCount} of ${view.lines} lines done.`;

  /* #222 — drag to paint a run of cells.

     A nonogram is played in RUNS: you read "7" and want seven cells, not seven
     taps. The board only had onTap, so a 15x15 band cost 225 separate taps.

     The stroke decides its value from the FIRST cell and then SETS every cell
     it crosses, rather than toggling each one. Toggling per cell is what makes
     a drag destroy its own work — cross a cell twice on the way back and you
     undo it. This is also why the stroke carries its own grid copy: pointermove
     is not a discrete event, so React batches it, and two paints in one batch
     would both read the same pre-batch state and the second would clobber the
     first. `seen` keeps a wobble over one cell from costing a step per frame.

     Painting waits for `d.moved` (the 10px tolerance) on purpose. Below it the
     gesture is still a tap, and usePointerCell will fire onTap on release —
     painting early would apply the same cell twice. */
  const strokeRef = useRef(null);
  const beginStroke = (p) => {
    strokeRef.current = null;
    const t = cellAt(p);
    if (!t) return;
    const cur = liveRef.current;
    if (cur.done) return;
    const v = cur.grid[t.r][t.c];
    const want = cur.mode === 'fill' ? (v === 1 ? 0 : 1) : (v === 2 ? 0 : 2);
    strokeRef.current = { want, origin: t, started: false, seen: new Set(), grid: cur.grid.map((row) => row.slice()) };
  };
  const strokePaint = (st, r, c) => {
    const k = r + ',' + c;
    if (st.seen.has(k)) return;
    st.seen.add(k);
    if (st.grid[r][c] === st.want) return;
    st.grid[r][c] = st.want;
    commitGrid(st.grid.map((row) => row.slice()));
  };
  const strokeTo = (p, d) => {
    const st = strokeRef.current;
    if (!st || !d || !d.moved) return;
    /* The cell the finger went DOWN on belongs to the run. It cannot be
       painted on pointerdown — below the 10px tolerance the gesture is still a
       tap, and onTap would then apply it a second time — so it is painted here,
       the moment the gesture commits to being a drag. Without this a run drawn
       left-to-right silently starts one cell late. */
    if (!st.started) { st.started = true; strokePaint(st, st.origin.r, st.origin.c); }
    const t = cellAt(p);
    if (t) strokePaint(st, t.r, t.c);
  };
  const endStroke = () => { strokeRef.current = null; };

  usePointerCell(canvasRef, cuiWrapHandlers(ctlRef, setPressedId, {
    onDown: (p) => beginStroke(p),
    onDrag: (p, d) => strokeTo(p, d),
    onUp: () => endStroke(),
    onTap: (p) => { endStroke(); const t = cellAt(p); if (t) apply(t.r, t.c, liveRef.current.mode); },
    // Long-press = the opposite tool, same idiom as Mine Finder.
    onLongPress: (p) => {
      endStroke();
      const t = cellAt(p);
      if (t) apply(t.r, t.c, liveRef.current.mode === 'fill' ? 'mark' : 'fill');
    },
    onContext: (p) => { endStroke(); const t = cellAt(p); if (t) apply(t.r, t.c, 'mark'); },
  }));

  useCanvasBoard(canvasRef, {
    width: W,
    height: H,
    deps: [cell, grid, done, W, fmt, steps, mode, pressedId, flash, nErr, view.doneCount, themeV],
    draw: (ctx) => {
      cuiDrawControls(ctx, ctlRef.current, pressedId);
      ctx.save();
      ctx.translate(boardX, boardY);
      const radius = Math.max(2, Math.round(cell * 0.14));
      const gridW = cellStep * NG_COLS, gridH = cellStep * NG_ROWS;
      const xEnd = gutterX + gridW - NG_GAP, yEnd = gutterY + gridH - NG_GAP;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      /* Clue colour IS the validation surface: red for a line no arrangement
         of its clue can still satisfy, faded for a line already done, plain
         otherwise. PAL (not C) — canvas cannot resolve var() properties. */
      const clueColor = (st) => (st === 'error' ? PAL.rose : st === 'done' ? PAL.dim : PAL.muted);

      // Column clues, bottom-aligned in the top gutter.
      ctx.font = `${clueFont}px 'JetBrains Mono', monospace`;
      colClues.forEach((cl, c) => {
        const x = gutterX + c * cellStep + cell / 2;
        ctx.fillStyle = clueColor(view.colStates[c]);
        cl.forEach((v, k) => {
          const y = gutterY - 4 - (cl.length - 1 - k) * (clueFont + 2) - clueFont / 2;
          ctx.fillText(String(v), x, y);
        });
      });
      // Row clues, right-aligned in the left gutter.
      ctx.textAlign = 'right';
      rowClues.forEach((cl, r) => {
        const y = gutterY + r * cellStep + cell / 2;
        ctx.fillStyle = clueColor(view.rowStates[r]);
        ctx.fillText(cl.join(' '), gutterX - 6, y);
      });
      ctx.textAlign = 'center';

      for (let r = 0; r < NG_ROWS; r++) for (let c = 0; c < NG_COLS; c++) {
        const v = grid[r][c];
        const x = gutterX + c * cellStep, y = gutterY + r * cellStep;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, cell, cell, radius);
        else ctx.rect(x, y, cell, cell);
        ctx.fillStyle = v === 1 ? PAL.accent : PAL.card;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = v === 1 ? PAL.accent : PAL.border;
        ctx.stroke();
        if (v === 2) {
          ctx.fillStyle = PAL.dim;
          ctx.font = `${Math.round(cell * 0.5)}px system-ui, sans-serif`;
          ctx.fillText('✗', x + cell / 2, y + cell / 2 + 1);
        }
      }

      /* A faint rose wash across every impossible line. The tint says WHERE,
         the red clue numbers say which rule was broken. */
      if (nErr) {
        ctx.save();
        ctx.globalAlpha = 0.1;
        ctx.fillStyle = PAL.rose;
        view.rowStates.forEach((st, r) => {
          if (st === 'error') ctx.fillRect(gutterX - NG_GAP, gutterY + r * cellStep - NG_GAP / 2, gridW, cellStep);
        });
        view.colStates.forEach((st, c) => {
          if (st === 'error') ctx.fillRect(gutterX + c * cellStep - NG_GAP / 2, gutterY - NG_GAP, cellStep, gridH);
        });
        ctx.restore();
      }

      ctx.strokeStyle = PAL.dim;
      ctx.lineWidth = 1.5;
      /* Major separators every 5 cells plus the far edge, PER AXIS. The old
         single list ran to max(rows, cols) and drew both axes to one length,
         which on a non-square board put rules outside the grid. */
      const axis = (n) => {
        const out = [];
        for (let k = 0; k <= n; k += 5) out.push(k);
        if (out[out.length - 1] !== n) out.push(n);
        return out;
      };
      for (const k of axis(NG_COLS)) {
        const off = gutterX + k * cellStep - NG_GAP / 2;
        ctx.beginPath(); ctx.moveTo(off, gutterY - NG_GAP); ctx.lineTo(off, yEnd); ctx.stroke();
      }
      for (const k of axis(NG_ROWS)) {
        const off = gutterY + k * cellStep - NG_GAP / 2;
        ctx.beginPath(); ctx.moveTo(gutterX - NG_GAP, off); ctx.lineTo(xEnd, off); ctx.stroke();
      }

      // One pulse of the board edge on a wrong picture or a win.
      if (flash) {
        ctx.strokeStyle = flash === 'err' ? PAL.rose : PAL.emerald;
        ctx.lineWidth = 3;
        ctx.strokeRect(gutterX - NG_GAP - 1.5, gutterY - NG_GAP - 1.5, gridW + 3, gridH + 3);
      }
      ctx.restore();
    },
  });

  return (
    // .fit-col: fitShell WITHOUT it clips instead of fitting — asserted by
    // the registry-fitshell self-test the moment this board is mounted.
    <div className="ng-game fit-col">
      <div
        className={'ng-status p6-banner ' + tone}
        role="status"
        aria-live="polite"
        data-ng-tone={tone}
      >
        {statusText}
      </div>
      <div className="ng-boardbox cui-frame" ref={boxRef}>
        <canvas
          ref={canvasRef}
          className="ng-canvas board-canvas"
          role="grid"
          aria-label={`Nonogram, ${NG_COLS} by ${NG_ROWS} picture grid, ${filled} of ${view.targetFilled} cells filled, ${nErr} lines not matching their clues`}
        />
      </div>
      <CuiTwin controls={controls} />
      <div className="p6-hint">
        Numbers are runs of filled cells, in order. Long-press uses the other tool.
        {mistakes ? ` Mistakes so far: ${mistakes} (each costs 50 points).` : ''}
      </div>
    </div>
  );
}

/* ---- Mine Finder (daily) -----------------------------------------------------
   9×9 with 10 mines, same board for everyone. A safe opening area is
   revealed for you; one wrong tap ends the day. */

function mfFlood(startIdx, counts, cols = 9, rows = 9) {
  const out = new Set([startIdx]);
  const queue = [startIdx];
  while (queue.length) {
    const i = queue.pop();
    if (counts[i] !== 0) continue;
    const r = Math.floor(i / 9), c = i % 9;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= 9 || cc < 0 || cc >= 9) continue;
      const j = rr * 9 + cc;
      if (!out.has(j) && counts[j] >= 0) { out.add(j); queue.push(j); }
    }
  }
  return out;
}

// Adjacency-digit palette, matching the classic Minesweeper .ms-nN rules so
// both mine games read the same. Index = digit. These are palette TOKEN NAMES,
// resolved through PAL at draw time (the BOUNCE_ROW_COLORS pattern) — capturing
// C.* here would bake in unusable var() strings at module scope AND freeze the
// colours against a theme flip. The two hex entries have no palette token.
const MF_NUM_COLORS = [null, 'accent', 'emerald', 'rose', 'violet', 'gold', '#06b6d4', '#be123c', 'muted'];
const MF_GAP = 3;

/* #294 — dark-mode tiles for BOTH mine games. They used to be PAL.card
   (#181D29) for a covered cell and PAL.surface (#12161F) for an uncovered
   one: a 1.07:1 difference with the same hairline on both, so on a dark
   screen an empty uncovered cell and a covered one looked the same. Like the
   light board's MS_LIGHT greys these are board art, pinned here rather than
   added as palette tokens. A covered cell is a raised slate key (1.9:1 against
   an uncovered cell, with a lit top edge and a dark lip along the bottom). An
   uncovered cell is a flat dark well with a faint outline. The digits sit on
   the darker well, so each one has slightly more contrast than before. Light
   mode does not use these. */
const MINE_DARK_TILES = {
  hidden:     '#3A4458', // raised face
  hiddenHi:   '#56627A', // lit top edge
  hiddenLip:  '#1A202B', // bottom lip / outline
  revealed:   '#0E121A', // recessed well
  revealedLn: '#222A37', // well outline
};

/* Draw one covered cell in dark mode: lip, face, then the lit top edge.
   Shared by Mine Finder and Mine Finder Classic. */
function mineDrawDarkHidden(ctx, x, y, cell, radius) {
  const T = MINE_DARK_TILES;
  const lip = Math.max(2, Math.round(cell * 0.08));
  klRR(ctx, x, y, cell, cell, radius);
  ctx.fillStyle = T.hiddenLip;
  ctx.fill();
  klRR(ctx, x, y, cell, cell - lip, radius);
  ctx.fillStyle = T.hidden;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = T.hiddenHi;
  ctx.beginPath();
  ctx.moveTo(x + radius, y + 0.5);
  ctx.lineTo(x + cell - radius, y + 0.5);
  ctx.stroke();
}

/* ============================================================
   Mine Finder — no-guess generation (#176)
   ============================================================
   The difficulty ladder needed a solver, but the solver turned out to matter
   more than the ladder: WITHOUT it, a generated minefield can require a coin
   flip. A board you lose to a 50/50 is not "hard", it is unfair, and rating
   such a board is meaningless because the rating describes logic the player
   never got to use.

   So generation is now: place mines → try to solve by pure deduction → keep
   only boards that fall. The rules, in the order a person would reach for
   them, are also the difficulty ladder:

     0 count-complete   a number's mines are all flagged ⇒ the rest are safe
     1 count-forced     a number's unknowns equal its remaining mines ⇒ all mines
     2 subset           one number's unknowns are a subset of another's; the
                        difference resolves (this is the 1-2-1 pattern and
                        friends, and it is where the game gets interesting)

   Anything needing more than these is rejected rather than shipped as "very
   hard", the same rule Sudoku's grader uses.
   ============================================================ */
const MF_RULES = ['count-complete', 'count-forced', 'subset'];

// Board geometry is a parameter now (the ladder grows the grid), so neighbours
// are computed against a width rather than the old hardcoded 9.
function mfNeighborsN(i, cols, rows) {
  const r = Math.floor(i / cols), c = i % cols;
  const out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const rr = r + dr, cc = c + dc;
    if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) out.push(rr * cols + cc);
  }
  return out;
}

/* Deduction-only solve from a given opening. Returns { solved, hardest }.
   `known` mirrors what a player would know: 0 unknown, 1 revealed safe,
   2 deduced mine. */
function mfSolveGraded(mines, counts, cols, rows, start) {
  const n = cols * rows;
  const known = new Array(n).fill(0);
  let hardest = -1;

  const reveal = (i) => {
    if (known[i]) return;
    known[i] = 1;
    if (counts[i] === 0) for (const j of mfNeighborsN(i, cols, rows)) reveal(j);
  };
  reveal(start);

  for (;;) {
    let acted = false;

    // 0 / 1 — the two counting rules, applied to every revealed number.
    for (let i = 0; i < n && !acted; i++) {
      if (known[i] !== 1 || counts[i] <= 0) continue;
      const nb = mfNeighborsN(i, cols, rows);
      const unknown = nb.filter(j => known[j] === 0);
      const flagged = nb.filter(j => known[j] === 2).length;
      if (!unknown.length) continue;
      if (flagged === counts[i]) {
        for (const j of unknown) reveal(j);
        hardest = Math.max(hardest, 0); acted = true;
      } else if (unknown.length === counts[i] - flagged) {
        for (const j of unknown) known[j] = 2;
        hardest = Math.max(hardest, 1); acted = true;
      }
    }
    if (acted) continue;

    /* 2 — subset. For two revealed numbers A and B whose unknown neighbours
       satisfy U(A) ⊂ U(B), the cells in U(B)\U(A) account for exactly
       remaining(B) − remaining(A) mines. When that difference is 0 they are all
       safe; when it equals the set size they are all mines. */
    const cells = [];
    for (let i = 0; i < n; i++) {
      if (known[i] !== 1 || counts[i] <= 0) continue;
      const nb = mfNeighborsN(i, cols, rows);
      const unknown = nb.filter(j => known[j] === 0);
      if (!unknown.length) continue;
      const flagged = nb.filter(j => known[j] === 2).length;
      cells.push({ set: unknown, need: counts[i] - flagged });
    }
    for (let a = 0; a < cells.length && !acted; a++) {
      for (let b = 0; b < cells.length; b++) {
        if (a === b) continue;
        const A = cells[a], B = cells[b];
        if (A.set.length >= B.set.length) continue;
        if (!A.set.every(x => B.set.indexOf(x) !== -1)) continue;
        const diff = B.set.filter(x => A.set.indexOf(x) === -1);
        const need = B.need - A.need;
        if (need === 0) {
          for (const j of diff) reveal(j);
          hardest = Math.max(hardest, 2); acted = true; break;
        }
        if (need === diff.length) {
          for (const j of diff) known[j] = 2;
          hardest = Math.max(hardest, 2); acted = true; break;
        }
      }
    }
    if (acted) continue;

    // Nothing fired. Solved iff every non-mine cell is revealed.
    for (let i = 0; i < n; i++) {
      if (!mines.has(i) && known[i] !== 1) return { solved: false, hardest: MF_RULES.length };
    }
    return { solved: true, hardest: Math.max(hardest, 0) };
  }
}

/* The ladder: grid size crossed with mine density. Both matter and they are
   not interchangeable — a dense small board is a different kind of hard from a
   sparse large one — so each band names both. */
const MF_BANDS = [
  { cols: 7,  rows: 7,  mines: 6 },
  { cols: 9,  rows: 9,  mines: 10 },
  { cols: 9,  rows: 9,  mines: 14 },
  { cols: 11, rows: 11, mines: 20 },
  { cols: 11, rows: 11, mines: 26 },
  { cols: 13, rows: 13, mines: 38 },
];

/* #199 — Mine Finder's geometry and its hit test, as ONE pair of pure
   functions. This is the shape CLAUDE.md prescribes after Nonogram (#218),
   and Mine Finder had the identical defect: the draw loop already walked
   MF_COLS/MF_ROWS correctly, while the cell size, the board box, the centring
   and the hit test were all hardcoded to 9.

   Only the two 9x9 bands were ever right. On 7x7 (story band 1, arcade Easy) a
   tap was mapped through `r * 9 + c`, so it revealed a DIFFERENT cell than the
   one under the finger. On 11x11 and 13x13 the hit test rejected every column
   and row past 8 outright, so most of the board could not be tapped at all,
   and the board drew wider than the box that was measured for it. That is the
   "cells do not reveal on tap" report: silent, and invisible at the default
   band.

   Both functions are pure and take the board's real dimensions, so a band that
   changes size cannot desynchronise the two halves again. Asserted by
   `minefinder-board-bounds`. */
function mfGeometry(boxW, boxH, cols, rows) {
  const W = Math.max(0, Math.floor(boxW));
  const GAP = 8, PILL_H = 46, MODE_H = 48;
  const chrome = PILL_H + MODE_H + GAP * 2;
  const availW = Math.max(0, W - 8);
  const availH = Math.max(0, Math.floor(boxH) - chrome - 8);
  /* A 13x13 cell cannot be a 24px fingertip and still fit a phone column, so
     the floor scales with the board: a big band shrinks rather than clips. */
  const minCell = Math.max(cols, rows) > 9 ? 18 : 24;
  const byW = Math.floor((availW - MF_GAP * (cols - 1)) / Math.max(1, cols));
  const byH = Math.floor((availH - MF_GAP * (rows - 1)) / Math.max(1, rows));
  const cell = Math.max(minCell, Math.min(46, Math.min(byW, byH)));
  const cellStep = cell + MF_GAP;
  const boardW = cellStep * cols - MF_GAP;
  const boardH = cellStep * rows - MF_GAP;
  const boardX = Math.floor((W - boardW) / 2);
  const boardY = PILL_H + GAP;
  return {
    W, H: chrome + boardH, GAP, PILL_H, MODE_H, chrome,
    cell, cellStep, boardW, boardH, boardX, boardY,
    modeY: boardY + boardH + GAP,
  };
}

/* The hit test, reading the same numbers the draw loop does. A tap in the gap
   after a cell still belongs to that cell — fingers are wider than 3px — but a
   tap outside the board is -1 rather than an index past the end of the row. */
function mfCellAt(p, geo, cols, rows) {
  const c = Math.floor((p.x - geo.boardX) / geo.cellStep);
  const r = Math.floor((p.y - geo.boardY) / geo.cellStep);
  if (c < 0 || c >= cols || r < 0 || r >= rows) return -1;
  return r * cols + c;
}

/* Build a no-guess board for a band. Retries until the deduction solver clears
   it; falls back to the last board tried rather than hanging, because a
   slightly-unfair board is better than a frozen mount — and with these
   densities the fallback effectively never fires. */
function mfBuildForBand(rng, bandIdx) {
  const spec = MF_BANDS[Math.min(MF_BANDS.length - 1, Math.max(0, bandIdx))];
  const { cols, rows } = spec;
  const n = cols * rows;
  let last = null;
  for (let attempt = 0; attempt < 200; attempt++) {
    const idxs = ceShuffle(Array.from({ length: n }, (_, i) => i), rng);
    const mines = new Set(idxs.slice(0, spec.mines));
    const counts = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      if (mines.has(i)) { counts[i] = -1; continue; }
      counts[i] = mfNeighborsN(i, cols, rows).filter(j => mines.has(j)).length;
    }
    // Open on the largest zero-region, which is both the friendliest start and
    // the one that gives deduction the most to work with.
    let start = -1, bestSize = -1;
    const seen = new Set();
    for (let i = 0; i < n; i++) {
      if (counts[i] !== 0 || seen.has(i)) continue;
      const region = new Set(); const stack = [i];
      while (stack.length) {
        const cur = stack.pop();
        if (region.has(cur)) continue;
        region.add(cur); seen.add(cur);
        if (counts[cur] === 0) for (const j of mfNeighborsN(cur, cols, rows)) if (!region.has(j)) stack.push(j);
      }
      if (region.size > bestSize) { bestSize = region.size; start = i; }
    }
    if (start < 0) continue;               // no zero cell: nowhere safe to open
    last = { mines, counts, start, cols, rows, total: n - spec.mines };
    const { solved, hardest } = mfSolveGraded(mines, counts, cols, rows, start);
    if (solved) return { ...last, hardest };
  }
  return last ? { ...last, hardest: MF_RULES.length } : null;
}

function MineFinderGame({ onWin, onLose, onStepChange, offset, savedProgress, onSaveProgress, playMode, band }) {
  const dayNum = useRef(utcDayNum(offset)).current;
  /* #176 — every board now comes from the no-guess generator, INCLUDING the
     daily. Band 1 is the same 9×9 / 10-mine shape the daily has always had, so
     nothing about it changes size — but it can no longer hand a player a 50/50
     they have to lose to, which it previously could. That is a fairness fix
     that happens to fall out of building the ladder. */
  const bandIdx = playMode === 'story' ? Math.max(0, band || 0)
    : playMode === 'arcade'
      ? [0, 2, 4][Math.max(0, ARCADE_BANDS.findIndex(b => b.id === band))]
      /* #331 — the daily's Easy/Hard take MF_BANDS' own ends (7×7/6 and
         13×13/38); Normal keeps the 9×9 / 10-mine shape. */
      : (playMode === 'daily' && (band === 'easy' || band === 'hard'))
        ? (band === 'easy' ? 0 : MF_BANDS.length - 1)
      : 1;
  const board = useRef(null);
  if (!board.current) {
    const { rng } = playMode === 'story' || playMode === 'arcade'
      ? modeSeed(playMode, 'minefinder', bandIdx, offset)
      : { rng: dailyRng(offset, 'minefinder',
          playMode === 'daily' && (band === 'easy' || band === 'hard') ? band : undefined) };
    board.current = mfBuildForBand(rng, bandIdx);
  }
  const { mines, counts, start, cols: MF_COLS, rows: MF_ROWS } = board.current;

  const resumed = savedProgress && savedProgress.dayNum === dayNum && Array.isArray(savedProgress.revealed)
    ? savedProgress : null;
  const [revealed, setRevealed] = useState(() =>
    new Set(resumed ? resumed.revealed : [...mfFlood(start, counts, MF_COLS, MF_ROWS)])
  );
  const [flags, setFlags] = useState(() => new Set(resumed && Array.isArray(resumed.flags) ? resumed.flags : []));
  const [flagMode, setFlagMode] = useState(false);
  const [steps, setSteps] = useState(() => (savedProgress && Number.isFinite(savedProgress.steps) ? savedProgress.steps : 0));
  const [done, setDone] = useState(false);
  const [boom, setBoom] = useState(-1);
  // Transient feedback: a chord attempt whose flag count doesn't match pulses
  // the number instead of silently doing nothing.
  const [pulse, setPulse] = useState(-1);
  const [announce, setAnnounce] = useState('');
  const initialSecs = savedProgress && Number.isFinite(savedProgress.elapsedSecs) ? savedProgress.elapsedSecs : 0;
  const { secs, fmt } = useTimer(!done, initialSecs);

  const stateRef = useRef({});
  stateRef.current = { revealed, flags, steps, secs };
  useAutosave(
    onSaveProgress,
    () => ({
      progress: { dayNum, revealed: [...stateRef.current.revealed], flags: [...stateRef.current.flags] },
      steps: stateRef.current.steps, secs: stateRef.current.secs,
    }),
    !done
  );
  const saveNow = (rv, fl, ns) =>
    onSaveProgress && onSaveProgress({ dayNum, revealed: [...rv], flags: [...fl] }, ns, secs);

  // ---- Responsive canvas frame (controls wave) ----------------------------
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const { boxW, boxH } = useFitBox(boxRef, { cols: 1, rows: 1, maxCell: 100000 });
  // Geometry comes from the board this run actually dealt, never from a
  // constant — see mfGeometry. The hit test below reads the same object.
  const geo = mfGeometry(boxW, boxH, MF_COLS, MF_ROWS);
  const { W, H, PILL_H, MODE_H, cell, cellStep, boardX, boardY, modeY } = geo;

  // Mutable snapshot the pointer handlers read — usePointerCell binds its
  // listeners once, so it must not close over stale render state.
  const liveRef = useRef({});
  liveRef.current = { revealed, flags, flagMode, done, steps, secs, geo };

  const idxAt = (p) => mfCellAt(p, liveRef.current.geo, MF_COLS, MF_ROWS);

  // ---- Actions -------------------------------------------------------------
  // Every action funnels its outcome through here so the loss/win/save paths
  // exist exactly once regardless of how the cells got opened (single dig,
  // flood, or a chord).
  const applyReveal = (openIdxs, ns) => {
    const cur = liveRef.current;
    const rv = new Set(cur.revealed);
    let hitMine = -1;
    for (const i of openIdxs) {
      if (cur.flags.has(i) || rv.has(i)) continue;
      if (mines.has(i)) { hitMine = i; break; }
      if (counts[i] === 0) for (const j of mfFlood(i, counts, MF_COLS, MF_ROWS)) rv.add(j);
      else rv.add(i);
    }
    if (hitMine >= 0) {
      for (const m of mines) rv.add(m);
      setBoom(hitMine);
      setRevealed(rv);
      setDone(true);
      setAnnounce('Mine hit — the field is revealed.');
      onLose && onLose(ns, cur.secs, {
        share: `Game Corner Mine Finder — today's field got me 💥`,
        answer: 'You hit a mine — the field is revealed above.',
      });
      return;
    }
    setRevealed(rv);
    const won = rv.size >= board.current.total;
    // Deliberately skip the progress save on the winning move: the finish call
    // closes the attempt and a racing write would 409 against the closed row.
    if (!won) saveNow(rv, cur.flags, ns);
    if (won) {
      setDone(true);
      setAnnounce('Field swept — solved!');
      const score = Math.max(1000 - cur.secs * 3 - ns * 2, 200);
      onWin(score, ns, cur.secs, {
        share: `Game Corner Mine Finder — swept today's field in ${fmt} 🚩`,
      });
    } else {
      setAnnounce(`${rv.size} of ${board.current.total} safe cells uncovered.`);
    }
  };

  const bumpSteps = () => {
    const ns = liveRef.current.steps + 1;
    setSteps(ns);
    onStepChange(ns);
    return ns;
  };

  const doFlag = (i) => {
    const cur = liveRef.current;
    if (cur.done || cur.revealed.has(i)) return;
    const ns = bumpSteps();
    const fl = new Set(cur.flags);
    if (fl.has(i)) fl.delete(i); else fl.add(i);
    setFlags(fl);
    setAnnounce(fl.has(i) ? 'Flag placed.' : 'Flag removed.');
    saveNow(cur.revealed, fl, ns);
  };

  const doDig = (i) => {
    const cur = liveRef.current;
    if (cur.done || cur.revealed.has(i)) return;
    if (cur.flags.has(i)) return; // flagged cells don't reveal by accident
    // Step is counted only once every early return is past, so bumping a
    // flagged cell no longer inflates the leaderboard's steps tiebreak.
    const ns = bumpSteps();
    applyReveal([i], ns);
  };

  // Chording: tapping a revealed number whose adjacent flag count already
  // equals it opens every remaining neighbour. Wrong flags mean a mine — same
  // as any real minesweeper. One chord is ONE step, however many cells open.
  const doChord = (i) => {
    const cur = liveRef.current;
    if (cur.done || !cur.revealed.has(i) || counts[i] <= 0) return false;
    const nb = mfNeighborsN(i, MF_COLS, MF_ROWS);
    const flagged = nb.filter((j) => cur.flags.has(j)).length;
    const closed = nb.filter((j) => !cur.revealed.has(j) && !cur.flags.has(j));
    if (!closed.length) return false;
    if (flagged !== counts[i]) {
      setPulse(i);
      setTimeout(() => setPulse((p) => (p === i ? -1 : p)), 250);
      setAnnounce(`Needs ${counts[i]} flags, ${flagged} placed.`);
      return true;
    }
    const ns = bumpSteps();
    applyReveal(closed, ns);
    return true;
  };

  const minesLeftLive = Math.max(mines.size - flags.size, 0);
  const controls = [];
  if (W > 80) {
    const pr = cuiRow(0, 0, W, PILL_H, 3);
    controls.push({ id: 'p-time', kind: 'pill', r: pr[0], label: 'Time', value: fmt, gold: true });
    controls.push({ id: 'p-mines', kind: 'pill', r: pr[1], label: 'Mines', value: minesLeftLive });
    controls.push({ id: 'p-steps', kind: 'pill', r: pr[2], label: 'Steps', value: steps });
    const bw = Math.min(260, W - 20);
    controls.push({
      id: 'mode', kind: 'button', r: [Math.floor((W - bw) / 2), modeY, bw, MODE_H],
      label: `${flagMode ? '🚩' : '⛏'} Mode: ${flagMode ? 'Flag' : 'Dig'}`,
      sub: 'tap to switch', on: flagMode,
      action: () => setFlagMode(m => !m),
    });
  }
  const ctlRef = useRef([]);
  ctlRef.current = controls;
  const [pressedId, setPressedId] = useState(null);

  usePointerCell(canvasRef, cuiWrapHandlers(ctlRef, setPressedId, {
    onTap: (p) => {
      const i = idxAt(p);
      if (i < 0 || liveRef.current.done) return;
      if (liveRef.current.revealed.has(i)) { doChord(i); return; }
      if (liveRef.current.flagMode) doFlag(i); else doDig(i);
    },
    // Long press ALWAYS does the opposite of the current mode.
    onLongPress: (p) => {
      const i = idxAt(p);
      if (i < 0 || liveRef.current.done || liveRef.current.revealed.has(i)) return;
      if (liveRef.current.flagMode) doDig(i); else doFlag(i);
    },
    // Right-click flags, matching the classic Minesweeper game.
    onContext: (p) => {
      const i = idxAt(p);
      if (i < 0 || liveRef.current.done || liveRef.current.revealed.has(i)) return;
      doFlag(i);
    },
  }));

  // ---- Draw ----------------------------------------------------------------
  useCanvasBoard(canvasRef, {
    width: W,
    height: H,
    deps: [cell, revealed, flags, boom, pulse, done, W, fmt, steps, flagMode, pressedId],
    draw: (ctx) => {
      cuiDrawControls(ctx, ctlRef.current, pressedId);
      ctx.save();
      ctx.translate(boardX, boardY);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const radius = Math.max(3, Math.round(cell * 0.16));
      const dark = themeState.resolved === 'dark';
      for (let i = 0; i < MF_COLS * MF_ROWS; i++) {
        const r = Math.floor(i / MF_COLS), c = i % MF_COLS;
        const x = c * cellStep, y = r * cellStep;
        const isRev = revealed.has(i);
        const isMine = mines.has(i);

        // PAL, not C — see the canvas-colour note on guardCanvasCtx.
        let fill = PAL.card, stroke = PAL.border;
        if (isRev) {
          fill = dark ? MINE_DARK_TILES.revealed : PAL.surface;
          stroke = dark ? MINE_DARK_TILES.revealedLn : PAL.border;
        }
        let special = false;
        if (isRev && isMine) { fill = 'rgba(205,75,58,.20)'; stroke = PAL.rose; special = true; }
        if (i === boom) { fill = 'rgba(205,75,58,.55)'; stroke = PAL.rose; special = true; }
        if (i === pulse) { fill = 'rgba(201,162,39,.30)'; stroke = PAL.gold; special = true; }

        if (dark && !isRev && !special) {
          // #294 — a covered cell is a raised key in dark mode.
          mineDrawDarkHidden(ctx, x, y, cell, radius);
        } else {
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(x, y, cell, cell, radius);
          else ctx.rect(x, y, cell, cell);
          ctx.fillStyle = fill;
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = stroke;
          ctx.stroke();
        }

        const cx = x + cell / 2, cy = y + cell / 2;
        if (isRev && isMine) {
          ctx.font = `${Math.round(cell * 0.6)}px system-ui, sans-serif`;
          ctx.fillText('💣', cx, cy + 1);
        } else if (isRev && counts[i] > 0) {
          ctx.font = `700 ${Math.round(cell * 0.52)}px 'JetBrains Mono', monospace`;
          ctx.fillStyle = palOf(MF_NUM_COLORS[counts[i]], PAL.text);
          ctx.fillText(String(counts[i]), cx, cy + 1);
        } else if (!isRev && flags.has(i)) {
          ctx.font = `${Math.round(cell * 0.58)}px system-ui, sans-serif`;
          ctx.fillText('🚩', cx, cy + 1);
        }
      }
      ctx.restore();
    },
  });

  const minesLeft = minesLeftLive;

  return (
    // .fit-col: same registry-fitshell contract as the Nonogram root above.
    <div className="mf-game fit-col">
      <div className="mf-boardbox cui-frame" ref={boxRef}>
        <canvas
          ref={canvasRef}
          className="mf-canvas board-canvas"
          role="grid"
          aria-label={`Mine Finder, ${MF_COLS} by ${MF_ROWS} field, ${minesLeft} mines unflagged, ${revealed.size} of ${board.current.total} safe cells uncovered`}
        />
      </div>
      <CuiTwin controls={controls} />
      <div className="sr-only" aria-live="polite">{announce}</div>
      <div className="p6-hint">
        Numbers count adjacent mines. Long-press does the opposite of the current mode
        (right-click flags). Tap a number whose flags all match to clear around it.
      </div>
    </div>
  );
}

/* ---- Anagram Sprint (daily) --------------------------------------------------
   Unscramble five words back-to-back. Tap the shuffled letters to build
   your answer; wrong submissions cost steps, not the day. */

const AN_POOL_5 = ['APPLE', 'BEACH', 'CANDY', 'DANCE', 'EAGLE', 'FLAME', 'GRAPE', 'HONEY', 'IVORY', 'JUICE', 'LEMON', 'MANGO', 'NIGHT', 'OCEAN', 'PIANO', 'QUEEN', 'RIVER', 'STONE', 'TIGER', 'WHALE', 'ZEBRA', 'CLOUD', 'BRAVE', 'SPARK', 'TRAIL'];
const AN_POOL_6 = ['ANCHOR', 'BASKET', 'CAMERA', 'DRAGON', 'FOREST', 'GARDEN', 'HAMMER', 'ISLAND', 'JUNGLE', 'KERNEL', 'LEGEND', 'MARBLE', 'NECTAR', 'ORCHID', 'PLANET', 'RIDDLE', 'SILVER', 'TEMPLE', 'VELVET', 'WINTER', 'WIZARD', 'YELLOW', 'BREEZE', 'CASTLE', 'FALCON'];
const AN_POOL_7 = ['ANTIQUE', 'BALLOON', 'CAPTAIN', 'DOLPHIN', 'EMERALD', 'FORTUNE', 'GRANITE', 'HARVEST', 'IMAGINE', 'JOURNEY', 'KINGDOM', 'LIBRARY', 'MACHINE', 'NETWORK', 'OCTOPUS', 'PYRAMID', 'RAINBOW', 'SUNRISE', 'THUNDER', 'VILLAGE', 'WHISPER', 'CRYSTAL', 'LANTERN', 'PENGUIN', 'MONSOON'];

/* #176 — the three curated pools above are 75 words in total, i.e. about
   twelve days of non-overlapping play, which is why this game repeated itself
   so quickly. Word Sprint already ships a 3,477-word dictionary in the same
   bundle, so Anagram Sprint borrows it rather than growing a second list: one
   vocabulary, two games.

   The curated pools are KEPT as a preferred head. They are hand-picked to be
   pleasant to unscramble (no awkward letter runs), so drawing from them first
   and falling back to the dictionary gives breadth without losing the feel.

   Built lazily because WSPR_WORDS_RAW is declared in a later file: everything
   here runs at render time, long after every file has evaluated. */
const _anPoolCache = {};
function anPoolFor(len) {
  if (_anPoolCache[len]) return _anPoolCache[len];
  const curated = len === 5 ? AN_POOL_5 : len === 6 ? AN_POOL_6 : len === 7 ? AN_POOL_7 : [];
  let extra = [];
  try {
    extra = WSPR_WORDS_RAW.split(/\s+/)
      .map(w => w.replace(/[^a-z]/g, '').toUpperCase())
      .filter(w => w.length === len);
  } catch (e) { extra = []; }
  const seen = new Set(curated);
  _anPoolCache[len] = curated.concat(extra.filter(w => !seen.has(w) && (seen.add(w), true)));
  return _anPoolCache[len];
}

/* Word length mix per story level — the progression is length plus count,
   which is what actually makes an anagram harder. Level 1 is five short
   words; the top level is all sevens. anPoolFor only curates lengths 5, 6 and
   7 (4 falls back to the raw list), so the ladder stays inside that range. */
const AN_BANDS = [
  [4, 4, 5, 5, 5],
  [5, 5, 5, 6, 6],
  [5, 5, 6, 6, 7],
  [5, 6, 6, 7, 7],
  [6, 6, 7, 7, 7],
  [6, 7, 7, 7, 7],
];

function anPickWords(rng, bandIdx) {
  const lens = AN_BANDS[Math.min(AN_BANDS.length - 1, Math.max(0, bandIdx == null ? 2 : bandIdx))];
  const words = [];
  const used = new Set();
  for (const len of lens) {
    const pool = anPoolFor(len);
    if (!pool.length) continue;
    let w = pool[Math.floor(rng() * pool.length)];
    for (let g = 0; g < 30 && used.has(w); g++) w = pool[Math.floor(rng() * pool.length)];
    used.add(w);
    words.push(w);
  }
  return words;
}

function anScramble(word, rng) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const idx = ceShuffle(Array.from({ length: word.length }, (_, i) => i), rng);
    const s = idx.map((i) => word[i]).join('');
    if (s !== word) return idx.map((i) => ({ ch: word[i], used: false }));
  }
  // Degenerate scramble (e.g. repeated letters): rotate by one.
  const rot = (word.slice(1) + word[0]).split('');
  return rot.map((ch) => ({ ch, used: false }));
}

function AnagramsGame({ onWin, onStepChange, offset, savedProgress, onSaveProgress, playMode, band }) {
  const dayNum = useRef(utcDayNum(offset)).current;
  const anBand = playMode === 'story' ? Math.max(0, band || 0)
    : playMode === 'arcade'
      ? [0, 2, 5][Math.max(0, ARCADE_BANDS.findIndex(b => b.id === band))]
      /* #331 — the daily's Easy/Hard take AN_BANDS' own ends (shortest and
         longest word ladders); Normal keeps the mid band. */
      : (playMode === 'daily' && (band === 'easy' || band === 'hard'))
        ? (band === 'easy' ? 0 : AN_BANDS.length - 1)
      : 2;
  const deal = useRef(null);
  if (!deal.current) {
    const { rng } = playMode === 'story' || playMode === 'arcade'
      ? modeSeed(playMode, 'anagrams', anBand, offset)
      : { rng: dailyRng(offset, 'anagrams',
          playMode === 'daily' && (band === 'easy' || band === 'hard') ? band : undefined) };
    const words = anPickWords(rng, anBand);
    deal.current = { words, tiles: words.map((w) => anScramble(w, rng)) };
  }
  const { words, tiles } = deal.current;

  const resumed = savedProgress && savedProgress.dayNum === dayNum && Number.isFinite(savedProgress.solved)
    ? savedProgress : null;
  const [wordIdx, setWordIdx] = useState(() => Math.min(resumed ? resumed.solved : 0, words.length - 1));
  const [solvedCount, setSolvedCount] = useState(resumed ? resumed.solved : 0);
  const [picked, setPicked] = useState([]); // [{tileIdx, ch}]
  const [flash, setFlash] = useState(false);
  const [steps, setSteps] = useState(() => (savedProgress && Number.isFinite(savedProgress.steps) ? savedProgress.steps : 0));
  const [done, setDone] = useState(false);
  const initialSecs = savedProgress && Number.isFinite(savedProgress.elapsedSecs) ? savedProgress.elapsedSecs : 0;
  const { secs, fmt } = useTimer(!done, initialSecs);

  const stateRef = useRef({});
  stateRef.current = { solvedCount, steps, secs };
  useAutosave(
    onSaveProgress,
    () => ({ progress: { dayNum, solved: stateRef.current.solvedCount }, steps: stateRef.current.steps, secs: stateRef.current.secs }),
    !done
  );

  const word = words[wordIdx];
  const rack = tiles[wordIdx];
  const usedSet = new Set(picked.map((p) => p.tileIdx));

  const tapTile = (i) => {
    if (done || usedSet.has(i) || picked.length >= word.length) return;
    setPicked(picked.concat({ tileIdx: i, ch: rack[i].ch }));
  };
  const backspace = () => setPicked(picked.slice(0, -1));
  const submit = () => {
    if (done || picked.length !== word.length) return;
    const ns = steps + 1;
    setSteps(ns);
    onStepChange(ns);
    const guess = picked.map((p) => p.ch).join('');
    if (guess === word) {
      const sc = solvedCount + 1;
      setSolvedCount(sc);
      setPicked([]);
      const won = sc >= words.length;
      if (!won && onSaveProgress) onSaveProgress({ dayNum, solved: sc }, ns, secs);
      if (won) {
        setDone(true);
        const score = Math.max(1300 - ns * 25 - secs * 2, 250);
        onWin(score, ns, secs, {
          share: `Game Corner Anagram Sprint — unscrambled all ${words.length} words in ${fmt} 🔀`,
        });
      } else {
        setWordIdx(sc);
      }
    } else {
      setFlash(true);
      setTimeout(() => setFlash(false), 500);
      if (onSaveProgress) onSaveProgress({ dayNum, solved: solvedCount }, ns, secs);
    }
  };

  /* The whole frame is ONE canvas (controls wave): pills, word-progress
     chips, slots + rack, and the Undo/Submit buttons draw together; only
     the hint paragraph stays DOM. Tap a rack tile to place its letter, tap
     anywhere on the slot row to take one back — the DOM grammar exactly.
     A wrong guess wiggles the slot row in rose. */
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const { boxW } = useFitBox(boxRef, { cols: Math.max(word.length, 5), rows: 2 });
  const anGap = 6;
  const anW = Math.max(120, Math.floor(boxW));
  const tileW = Math.max(34, Math.min(52, Math.floor((anW - anGap * (word.length - 1)) / word.length)));
  const tileH = Math.round(tileW * 1.12);
  const bandGap = 16;
  const anBW = tileW * word.length + anGap * (word.length - 1);
  const anBH = tileH * 2 + bandGap;
  const anX0 = Math.floor((anW - anBW) / 2);
  const GAP = 8, PILL_H = 46, DOTS_H = 26, ACT_H = 44;
  const dotsY = PILL_H + GAP;
  const boardY = dotsY + DOTS_H + GAP;
  const actY = boardY + anBH + GAP;
  const H = actY + ACT_H;

  const controls = [];
  if (anW > 80) {
    const pr = cuiRow(0, 0, anW, PILL_H, 3);
    controls.push({ id: 'p-time', kind: 'pill', r: pr[0], label: 'Time', value: fmt, gold: true });
    controls.push({ id: 'p-word', kind: 'pill', r: pr[1], label: 'Word', value: `${Math.min(solvedCount + 1, words.length)}/${words.length}` });
    controls.push({ id: 'p-tries', kind: 'pill', r: pr[2], label: 'Tries', value: steps });
    const ar = cuiRow(0, actY, anW, ACT_H, 2);
    controls.push({ id: 'undo', kind: 'button', r: ar[0], label: '⌫ Undo letter', disabled: !picked.length, action: backspace });
    controls.push({ id: 'submit', kind: 'button', r: ar[1], label: 'Submit', primary: true, disabled: picked.length !== word.length, action: submit });
  }
  const ctlRef = useRef([]);
  ctlRef.current = controls;
  const [pressedId, setPressedId] = useState(null);

  const flashRef = useRef(null);
  const [flashFrame, setFlashFrame] = useState(0);
  useEffect(() => {
    if (!flash) { flashRef.current = null; return; }
    flashRef.current = { t0: performance.now() };
    let raf = 0;
    const tick = () => {
      if (!flashRef.current) return;
      if (performance.now() - flashRef.current.t0 >= 450) flashRef.current = null;
      setFlashFrame((f) => f + 1);
      if (flashRef.current) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [flash]);

  const anGeoRef = useRef({});
  anGeoRef.current = { tileW, tileH, bandGap, anX0, gap: anGap, n: word.length, boardY };
  usePointerCell(canvasRef, cuiWrapHandlers(ctlRef, setPressedId, {
    onTap: (p) => {
      const g = anGeoRef.current;
      if (done) return;
      const y = p.y - g.boardY;
      if (y < -4) return;
      if (y <= g.tileH + 4) { backspace(); return; }
      if (y >= g.tileH + g.bandGap - 4 && y <= g.tileH * 2 + g.bandGap + 4) {
        const i = Math.floor((p.x - g.anX0 + g.gap / 2) / (g.tileW + g.gap));
        if (i >= 0 && i < g.n) tapTile(i);
      }
    },
  }));
  useCanvasBoard(canvasRef, {
    width: anW,
    height: H,
    deps: [picked, wordIdx, done, tileW, flashFrame, fmt, steps, solvedCount, pressedId, anW],
    draw: (ctx) => {
      cuiDrawControls(ctx, ctlRef.current, pressedId);
      // Word-progress chips (display only): solved words spelled out, the
      // rest as letter counts, the live word ringed in accent.
      {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `600 11px 'JetBrains Mono', monospace`;
        const labels = words.map((w, i) => (i < solvedCount ? w : String(w.length)));
        const pad = 10, gapC = 6;
        const widths = labels.map((t) => Math.ceil(ctx.measureText(t).width) + pad * 2);
        let x = Math.max(2, Math.floor((anW - (widths.reduce((a, b) => a + b, 0) + gapC * (labels.length - 1))) / 2));
        labels.forEach((t, i) => {
          const cw = widths[i];
          klRR(ctx, x, dotsY, cw, DOTS_H, 12);
          ctx.fillStyle = i < solvedCount ? 'rgba(45,159,102,0.12)' : PAL.card;
          ctx.fill();
          ctx.lineWidth = 1.2;
          ctx.strokeStyle = i < solvedCount ? PAL.emerald : (i === wordIdx && !done) ? PAL.accent : PAL.border;
          ctx.stroke();
          ctx.fillStyle = i < solvedCount ? PAL.emerald : (i === wordIdx && !done) ? PAL.text : PAL.muted;
          ctx.fillText(t, x + cw / 2, dotsY + DOTS_H / 2 + 0.5);
          x += cw + gapC;
        });
      }
      ctx.save();
      ctx.translate(0, boardY);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const fl = flashRef.current;
      const p01 = fl ? (performance.now() - fl.t0) / 450 : 1;
      const wiggle = fl ? Math.sin(p01 * Math.PI * 4) * 4 * (1 - p01) : 0;
      ctx.font = `700 ${Math.round(tileW * 0.42)}px 'JetBrains Mono', monospace`;
      for (let i = 0; i < word.length; i++) {
        const x = anX0 + i * (tileW + anGap) + (picked[i] ? wiggle : 0);
        const has = !!picked[i];
        klRR(ctx, x + 1, 1, tileW - 2, tileH - 2, 8);
        if (has) {
          ctx.fillStyle = fl ? 'rgba(205,75,58,0.12)' : 'rgba(58,110,205,0.10)';
          ctx.fill();
          ctx.setLineDash([]);
          ctx.strokeStyle = fl ? PAL.rose : PAL.accent;
        } else {
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = PAL.dim;
        }
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
        if (has) {
          ctx.fillStyle = PAL.text;
          ctx.fillText(picked[i].ch, x + tileW / 2, tileH / 2 + 1);
        }
      }
      const ry = tileH + bandGap;
      for (let i = 0; i < rack.length; i++) {
        const x = anX0 + i * (tileW + anGap);
        ctx.save();
        if (usedSet.has(i)) ctx.globalAlpha = 0.25;
        klRR(ctx, x + 1, ry + 1, tileW - 2, tileH - 2, 8);
        ctx.fillStyle = PAL.card;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = PAL.border;
        ctx.stroke();
        ctx.fillStyle = PAL.text;
        ctx.fillText(rack[i].ch, x + tileW / 2, ry + tileH / 2 + 1);
        ctx.restore();
      }
      ctx.restore();
    },
  });

  return (
    <div className="an-game fit-col">
      <div className="an-boardbox cui-frame" ref={boxRef}>
        <canvas
          ref={canvasRef}
          className="an-canvas board-canvas"
          role="img"
          aria-label={`Anagram — ${picked.length} of ${word.length} letters placed, word ${Math.min(solvedCount + 1, words.length)} of ${words.length}`}
        />
      </div>
      <CuiTwin controls={controls} />
      <div className="p6-hint">Tap letters to build the word, tap a slot to take one back. Wrong guesses cost tries, never the day.</div>
    </div>
  );
}

/* ---- Crate Push (daily + story) ------------------------------------------------
   Push every crate onto a goal pad. Moves are undoable and the room restartable.

   #176 — WHERE THE ROOMS COME FROM. Ten hand-built rooms could not carry a
   difficulty ladder, and Sokoban is the one game in the app whose content can
   never be rated at mount time: deciding whether a room is solvable is a
   PSPACE-complete search, not a deduction. So rooms are generated offline by
   scripts/gen-sokoban.js and shipped as public/corpus/cratepush.json — 200
   rooms across 8 bands, each one carrying the exact length of its shortest
   solution in pushes (3 at the bottom of the ladder, ~35 at the top).

   The ten hand-built rooms below stay as the FALLBACK. If the corpus has not
   arrived, the day still has a warehouse — you lose the difficulty guarantee,
   never the game, which is the same bargain Klondike and Spider strike. */

const CP_LEVELS = [
  ['#######',
   '#     #',
   '# .$@ #',
   '#     #',
   '#######'],
  ['#######',
   '#  .  #',
   '#  $  #',
   '#  @  #',
   '#     #',
   '#######'],
  ['########',
   '#      #',
   '# .$@$.#',
   '#      #',
   '########'],
  ['#######',
   '#. $  #',
   '#  @  #',
   '#  $ .#',
   '#######'],
  ['########',
   '#   #  #',
   '# @$  .#',
   '#   #  #',
   '########'],
  ['#######',
   '#  .  #',
   '# $$  #',
   '# .@  #',
   '#######'],
  ['########',
   '#  ..  #',
   '#  $$  #',
   '#      #',
   '#  @   #',
   '########'],
  ['#########',
   '#       #',
   '# @$  . #',
   '#       #',
   '# .  $  #',
   '#       #',
   '#########'],
  ['#######',
   '#     #',
   '# $.$ #',
   '# . . #',
   '#  $  #',
   '#  @  #',
   '#######'],
  ['########',
   '# @    #',
   '# $$$  #',
   '# ...  #',
   '#      #',
   '########'],
];

function cpParse(rows) {
  const walls = new Set(), goals = new Set();
  const crates = [];
  let player = null;
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      const key = x + ',' + y;
      if (ch === '#') walls.add(key);
      if (ch === '.' || ch === '*' || ch === '+') goals.add(key);
      if (ch === '$' || ch === '*') crates.push([x, y]);
      if (ch === '@' || ch === '+') player = [x, y];
    }
  }
  return { walls, goals, crates, player, w: Math.max(...rows.map((r) => r.length)), h: rows.length };
}

/* Which corpus band today's daily draws from. The ladder is 8 rungs and the
   week is 7 days, so a straight weekday->band map would never show band 7 and
   would make Monday permanently trivial. Instead the weekday picks a WINDOW of
   the ladder and the daily seed picks inside it: gentle at the start of the
   week, hardest at the weekend, with real variation on any given weekday. This
   is the same shape TM_WEEK uses for Daily Tile Match. */
const CP_WEEK = [
  { from: 0, to: 3, label: 'Warm-up' },   // Sun
  { from: 0, to: 3, label: 'Warm-up' },   // Mon
  { from: 1, to: 4, label: 'Easy' },      // Tue
  { from: 2, to: 5, label: 'Steady' },    // Wed
  { from: 3, to: 6, label: 'Tricky' },    // Thu
  { from: 4, to: 7, label: 'Hard' },      // Fri
  { from: 5, to: 8, label: 'Weekend' },   // Sat
];

function CratePushGame({ onWin, onStepChange, offset, savedProgress, onSaveProgress, playMode, band }) {
  const dayNum = useRef(utcDayNum(offset)).current;
  /* #331 — the daily's Easy/Hard jump to the corpus ladder's own ends
     (gentlest / hardest room); Normal keeps the weekday window. */
  const dailyBand = playMode === 'daily' && (band === 'easy' || band === 'hard') ? band : null;
  const picked = useRef(null);
  if (picked.current == null) {
    const { rng } = modeSeed(playMode, 'cratepush', band, offset);
    /* Story plays exactly its rung. The daily draws from the weekday's window,
       so today's room is the same for everyone but is not the same rung every
       Tuesday. */
    let want = 0;
    if (playMode === 'story') want = Math.max(0, band || 0);
    else if (dailyBand === 'easy') want = 0;
    else if (dailyBand === 'hard') want = 7;
    else {
      const w = CP_WEEK[new Date(Date.now() + (offset || 0)).getUTCDay()];
      want = w.from + Math.floor(rng() * (w.to - w.from));
    }
    const lv = corpusLevel('cratepush', want, rng);
    if (lv && Array.isArray(lv.g)) {
      picked.current = { rows: lv.g, pushes: lv.p, band: want, rated: true };
    } else {
      // Fallback: the hand-built rooms, still deterministic for the day.
      const i = Math.floor(rng() * CP_LEVELS.length);
      picked.current = { rows: CP_LEVELS[i], pushes: null, band: null, rated: false, idx: i };
    }
  }
  const levelInfo = picked.current;
  const level = useRef(cpParse(levelInfo.rows)).current;

  const resumed = savedProgress && savedProgress.dayNum === dayNum &&
    Array.isArray(savedProgress.player) && Array.isArray(savedProgress.crates)
    ? savedProgress : null;
  const [player, setPlayer] = useState(() => (resumed ? resumed.player.slice() : level.player.slice()));
  const [crates, setCrates] = useState(() =>
    (resumed ? resumed.crates : level.crates).map((c) => c.slice())
  );
  const [moves, setMoves] = useState(resumed && Number.isFinite(resumed.moves) ? resumed.moves : 0);
  const [hist, setHist] = useState([]);
  const [done, setDone] = useState(false);
  const initialSecs = savedProgress && Number.isFinite(savedProgress.elapsedSecs) ? savedProgress.elapsedSecs : 0;
  const { secs, fmt } = useTimer(!done, initialSecs);

  const stateRef = useRef({});
  stateRef.current = { player, crates, moves, secs, done };
  useAutosave(
    onSaveProgress,
    () => ({
      progress: { dayNum, player: stateRef.current.player, crates: stateRef.current.crates, moves: stateRef.current.moves },
      steps: stateRef.current.moves, secs: stateRef.current.secs,
    }),
    !done
  );
  const saveNow = (p, cr, m) =>
    onSaveProgress && onSaveProgress({ dayNum, player: p, crates: cr, moves: m }, m, secs);

  const crateAt = (cr, x, y) => cr.findIndex(([cx, cy]) => cx === x && cy === y);

  const move = (dx, dy) => {
    const cur = stateRef.current;
    if (cur.done) return;
    const [px, py] = cur.player;
    const nx = px + dx, ny = py + dy;
    if (level.walls.has(nx + ',' + ny)) return;
    const cr = cur.crates.map((c) => c.slice());
    const ci = crateAt(cr, nx, ny);
    if (ci >= 0) {
      const cx = nx + dx, cy = ny + dy;
      if (level.walls.has(cx + ',' + cy) || crateAt(cr, cx, cy) >= 0) return;
      cr[ci] = [cx, cy];
    }
    const m = cur.moves + 1;
    setHist((h) => h.concat([{ player: cur.player, crates: cur.crates, moves: cur.moves }]).slice(-200));
    setPlayer([nx, ny]);
    setCrates(cr);
    setMoves(m);
    onStepChange(m);
    const won = cr.every(([cx, cy]) => level.goals.has(cx + ',' + cy));
    if (!won) saveNow([nx, ny], cr, m);
    if (won) {
      setDone(true);
      /* A rated room knows its own par, so the ladder can pay for difficulty
         instead of only for speed — clearing a 35-push warehouse should not
         score like a 3-push one. Unrated fallback rooms keep the old curve. */
      const base = levelInfo.rated ? 600 + levelInfo.pushes * 40 : 1200;
      const score = Math.max(base - m * 6 - secs * 2, 250);
      onWin(score, m, secs, {
        share: levelInfo.rated
          ? `Game Corner Crate Push — cleared a ${levelInfo.pushes}-push warehouse in ${m} moves (${fmt}) 📦`
          : `Game Corner Crate Push — shifted today's warehouse in ${m} moves (${fmt}) 📦`,
      });
    }
  };

  const undo = () => {
    if (done || !hist.length) return;
    const prev = hist[hist.length - 1];
    setHist(hist.slice(0, -1));
    setPlayer(prev.player.slice());
    setCrates(prev.crates.map((c) => c.slice()));
    setMoves(prev.moves);
    onStepChange(prev.moves);
    saveNow(prev.player, prev.crates, prev.moves);
  };
  const restart = () => {
    if (done) return;
    setHist([]);
    setPlayer(level.player.slice());
    setCrates(level.crates.map((c) => c.slice()));
    setMoves(0);
    onStepChange(0);
    saveNow(level.player, level.crates, 0);
  };

  /* #225 — the D-pad walks while you HOLD it.

     The four arrows were plain `action` controls, and cuiWrapHandlers fires an
     action on pointer-UP: every step cost a full press-and-release, and holding
     an arrow did nothing at all, so crossing a room meant one deliberate tap
     per square. That is the "slow arrows" in the report — the keyboard handler
     itself measures ~0.1ms per press, so the delay was never the canvas.

     `holdDown`/`holdUp` is the mechanism the controls layer already has for
     exactly this (Bounce's paddle uses it): it engages on finger-DOWN and
     releases if the finger slides off. The cadence copies a keyboard — one
     step immediately, a pause so a single tap stays a single step, then a
     steady repeat. `move` reads stateRef, so every repeat sees the live board
     rather than the closure it was scheduled in. */
  const CP_HOLD_DELAY_MS = 320;
  const CP_HOLD_REPEAT_MS = 120;
  const holdRef = useRef({ t: null, iv: null });
  const stopHold = () => {
    const h = holdRef.current;
    if (h.t) { clearTimeout(h.t); h.t = null; }
    if (h.iv) { clearInterval(h.iv); h.iv = null; }
  };
  const startHold = (dx, dy) => {
    stopHold();
    move(dx, dy); // on PRESS, not on release
    holdRef.current.t = setTimeout(() => {
      holdRef.current.t = null;
      holdRef.current.iv = setInterval(() => move(dx, dy), CP_HOLD_REPEAT_MS);
    }, CP_HOLD_DELAY_MS);
  };
  useEffect(() => stopHold, []);

  /* The dep array matters: without it this effect re-ran on EVERY render, so
     the window listener was torn down and re-added once per move (measured: 17
     add/remove pairs across 8 moves). `move` reads stateRef.current, so the
     handler never needs rebinding to see fresh state. */
  useEffect(() => {
    const onKey = (e) => {
      const map = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
      if (map[e.key]) { e.preventDefault(); move(...map[e.key]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* The whole frame is ONE canvas (controls wave): pills, the room, the
     D-pad and Undo/Restart draw together (arrow keys still work); only the
     hint paragraph stays DOM. Room cells were never tappable — the D-pad and
     arrow keys are the input — so the board region is pure display:
     walls/goals read PAL, the crate/player stay emoji, and a crate on its
     pad gets a green ring. */
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const { boxW, boxH } = useFitBox(boxRef, { cols: level.w, rows: level.h });
  const W = Math.floor(boxW);
  const GAP = 8, PILL_H = 46, KEY_H = 44, ACT_H = 40;
  const padH = KEY_H * 2 + 6;
  const chrome = PILL_H + padH + ACT_H + GAP * 3;
  const cpCell = Math.max(18, Math.min(46,
    Math.floor(Math.min((W - 4) / level.w, (((Math.floor(boxH) || 300) - chrome) - 4) / level.h))));
  const cpW = cpCell * level.w, cpH = cpCell * level.h;
  const H = chrome + cpH;
  const boardX = Math.floor((W - cpW) / 2);
  const boardY = PILL_H + GAP;
  const padY = boardY + cpH + GAP;
  const actY = padY + padH + GAP;

  const controls = [];
  if (W > 80) {
    const pr = cuiRow(0, 0, W, PILL_H, 3);
    controls.push({ id: 'p-time', kind: 'pill', r: pr[0], label: 'Time', value: fmt, gold: true });
    controls.push({ id: 'p-moves', kind: 'pill', r: pr[1], label: 'Moves', value: moves });
    // A rated room knows its own shortest solution, which is a far more useful
    // third pill than an arbitrary room number.
    controls.push(levelInfo.rated
      ? { id: 'p-par', kind: 'pill', r: pr[2], label: 'Par', value: `${levelInfo.pushes} pushes` }
      : { id: 'p-room', kind: 'pill', r: pr[2], label: 'Room', value: '#' + (levelInfo.idx + 1) });
    const kw = 52, kg = 6;
    const px0 = Math.floor((W - kw * 3 - kg * 2) / 2);
    /* holdDown/holdUp, not action — see #225 above. The twin still carries a
       plain onClick through `action`, so the keyboard-and-screen-reader path
       keeps working: a twin click is one step, which is what it should be. */
    const arrow = (id, label, r, dx, dy) => ({
      id, kind: 'button', r, label, font: 16,
      holdDown: () => startHold(dx, dy),
      holdUp: stopHold,
      action: () => move(dx, dy),
    });
    controls.push(arrow('up', '▲', [px0 + kw + kg, padY, kw, KEY_H], 0, -1));
    controls.push(arrow('left', '◀', [px0, padY + KEY_H + 6, kw, KEY_H], -1, 0));
    controls.push(arrow('down', '▼', [px0 + kw + kg, padY + KEY_H + 6, kw, KEY_H], 0, 1));
    controls.push(arrow('right', '▶', [px0 + (kw + kg) * 2, padY + KEY_H + 6, kw, KEY_H], 1, 0));
    const ar = cuiRow(Math.floor(W * 0.1), actY, Math.floor(W * 0.8), ACT_H, 2);
    controls.push({ id: 'undo', kind: 'button', r: ar[0], label: '↶ Undo', disabled: !hist.length, action: undo });
    controls.push({ id: 'restart', kind: 'button', r: ar[1], label: '⟲ Restart', action: restart });
  }
  const ctlRef = useRef([]);
  ctlRef.current = controls;
  const [pressedId, setPressedId] = useState(null);
  usePointerCell(canvasRef, cuiWrapHandlers(ctlRef, setPressedId, {}));

  useCanvasBoard(canvasRef, {
    width: W,
    height: H,
    deps: [player, crates, done, cpCell, W, fmt, moves, hist.length, pressedId],
    draw: (ctx) => {
      cuiDrawControls(ctx, ctlRef.current, pressedId);
      ctx.save();
      ctx.translate(boardX, boardY);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let y = 0; y < level.h; y++) {
        for (let x = 0; x < level.w; x++) {
          const key = x + ',' + y;
          const px = x * cpCell, py = y * cpCell;
          if (level.walls.has(key)) {
            klRR(ctx, px + 1, py + 1, cpCell - 2, cpCell - 2, 3);
            ctx.fillStyle = PAL.dim;
            ctx.fill();
          } else if (level.goals.has(key)) {
            ctx.fillStyle = 'rgba(45,159,102,0.14)';
            ctx.fillRect(px, py, cpCell, cpCell);
            ctx.lineWidth = 2;
            ctx.strokeStyle = 'rgba(45,159,102,0.45)';
            ctx.strokeRect(px + 1.5, py + 1.5, cpCell - 3, cpCell - 3);
          }
        }
      }
      const glyph = (g, x, y, scale) => {
        ctx.font = `${Math.round(cpCell * scale)}px system-ui, sans-serif`;
        ctx.fillText(g, x * cpCell + cpCell / 2, y * cpCell + cpCell / 2 + 1);
      };
      for (const [cx, cy] of crates) {
        if (level.goals.has(cx + ',' + cy)) {
          ctx.beginPath();
          ctx.arc(cx * cpCell + cpCell / 2, cy * cpCell + cpCell / 2, cpCell * 0.46, 0, Math.PI * 2);
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = PAL.emerald;
          ctx.stroke();
        }
        glyph('📦', cx, cy, 0.72);
      }
      glyph('🧍', player[0], player[1], 0.72);
      ctx.restore();
    },
  });

  return (
    <div className="cp-game fit-col">
      <div className="cp-boardbox cui-frame" ref={boxRef}>
        <canvas
          ref={canvasRef}
          className="cp-canvas board-canvas"
          role="img"
          aria-label={`Crate Push — ${crates.filter(([cx, cy]) => level.goals.has(cx + ',' + cy)).length}/${crates.length} crates home, ${moves} moves`}
        />
      </div>
      <CuiTwin controls={controls} />
      <div className="p6-hint">Push every crate onto a green pad. You can push one crate at a time — never pull.</div>
    </div>
  );
}

/* ---- Drop Stack (daily) ---------------------------------------------------------
   Real-time falling blocks on today's fixed 200-piece bag — same order for
   everyone. Gravity runs on a rAF loop whose interval is set by the level
   (one level per 10 lines). Drag to slide, tap to rotate, swipe down to hard
   drop; a hold slot lets you bank one piece per lock. Survive the bag to win,
   top out and the day is lost. */

const DS_W = 9, DS_H = 16, DS_PIECES = 200;
/* Arcade's bag is long enough that no real run reaches the end — "endless" in
   practice, without an unbounded array or a refill seam mid-run. */
const DS_ARCADE_PIECES = 20000;
const DS_SHAPES = [
  { cells: [[0, 0], [1, 0], [2, 0], [3, 0]], color: '#38BDF8' },
  { cells: [[0, 0], [1, 0], [0, 1], [1, 1]], color: '#FBBF24' },
  { cells: [[0, 0], [1, 0], [2, 0], [1, 1]], color: '#A78BFA' },
  { cells: [[1, 0], [2, 0], [0, 1], [1, 1]], color: '#34D399' },
  { cells: [[0, 0], [1, 0], [1, 1], [2, 1]], color: '#FB7185' },
  { cells: [[0, 0], [0, 1], [1, 1], [2, 1]], color: '#818CF8' },
  { cells: [[2, 0], [0, 1], [1, 1], [2, 1]], color: '#F59E0B'  },
];
const DS_LINES_PER_LEVEL = 10;
const DS_GAP = 2;

// Deterministic 7-bag: every consecutive window of 7 is a permutation of the
// seven shapes, so the day's sequence is fair AND identical for every player.
function dsSequence(rng, n = DS_PIECES) {
  const seq = [];
  while (seq.length < n) {
    seq.push(...ceShuffle([0, 1, 2, 3, 4, 5, 6], rng));
  }
  return seq.slice(0, n);
}

// Rotate a shape's cells 90° clockwise `rot` times, normalized to (0,0).
function dsCells(shapeIdx, rot) {
  let cells = DS_SHAPES[shapeIdx].cells;
  for (let k = 0; k < (rot % 4 + 4) % 4; k++) {
    const maxY = Math.max(...cells.map(([, y]) => y));
    cells = cells.map(([x, y]) => [maxY - y, x]);
  }
  const minX = Math.min(...cells.map(([x]) => x));
  const minY = Math.min(...cells.map(([, y]) => y));
  return cells.map(([x, y]) => [x - minX, y - minY]);
}

function dsLevelFor(lines) { return 1 + Math.floor(lines / DS_LINES_PER_LEVEL); }
// Level 1 drops a row about once a second; each level is 15% quicker, floored
// so the top levels stay playable rather than impossible.
function dsGravityMs(level) { return Math.max(80, Math.round(1000 * Math.pow(0.85, level - 1))); }

/* #331 — Drop Stack's bands. Arcade's Easy/Normal/Hard picker was decorative
   (every band dealt the same bag at the same gravity), and the daily had no
   band at all. Gravity is the one dial that changes how a fixed bag FEELS
   without changing the bag itself — the sequence stays the fair 7-bag for
   everyone — so a band is a multiplier on the level gravity: Easy falls ~35%
   slower, Hard ~25% faster (floored so the top levels can't go silly).
   Normal stays 1.0, byte-identical to the pre-band game in both modes. */
const DS_BANDS = { easy: 1.35, normal: 1.0, hard: 0.75 };

function DropStackGame({ onWin, onLose, onStepChange, offset, savedProgress, onSaveProgress, playMode, band }) {
  const dayNum = useRef(utcDayNum(offset)).current;
  /* #176 — the daily is a FIXED 200-piece bag you either clear or top out of;
     arcade is the same game with an endless one. That is the whole difference,
     which is why this was one of the cheapest modes in the plan: the piece
     generator never cared how long the sequence was. */
  const isArcade = playMode === 'arcade';
  const dsBandMult = (playMode === 'arcade' || playMode === 'daily')
    && (band === 'easy' || band === 'hard') ? DS_BANDS[band] : 1.0;
  const seedRef = useRef(null);
  const seq = useRef(null);
  if (!seq.current) {
    if (isArcade) {
      const { rng, seed } = modeSeed('arcade', 'dropstack', 0, offset);
      seedRef.current = seed;
      seq.current = dsSequence(rng, DS_ARCADE_PIECES);
    } else {
      seq.current = dsSequence(dailyRng(offset, 'dropstack'));
    }
  }

  // Resume tolerates the pre-rebuild progress shape: rows saved by the old
  // turn-based version carry no level/hold, so derive level from lines and
  // start with an empty hold rather than refusing to resume mid-day.
  /* The saved well must be a grid of ROWS, checked before anything indexes
     into it — `grid[r][c]` against a missing row throws at mount, and a
     mount-time throw is a blank screen rather than a graceful fallback. Unlike
     the other resumable boards this one NORMALISES rather than rejects: the
     well is a fixed DS_W x DS_H, and a snapshot from the pre-rebuild 14-row
     well is padded to today's height just below. So the shape is what is
     checked here; the size is handled. */
  const dsFits = (g) => Array.isArray(g) && g.length > 0 && g.every((row) => Array.isArray(row));
  const resumed = savedProgress && savedProgress.dayNum === dayNum && dsFits(savedProgress.grid)
    ? savedProgress : null;
  const resumedGrid = resumed
    // An old 14-row well is padded at the TOP to today's 16 rows, so the stack
    // keeps its footing on the floor instead of floating.
    ? (() => {
      const g = resumed.grid.map((row) => row.slice(0, DS_W));
      while (g.length < DS_H) g.unshift(new Array(DS_W).fill(0));
      return g.slice(g.length - DS_H);
    })()
    : null;

  const [grid, setGrid] = useState(() =>
    resumedGrid || Array.from({ length: DS_H }, () => new Array(DS_W).fill(0)));
  const [pieceIdx, setPieceIdx] = useState(resumed && Number.isFinite(resumed.pieceIdx) ? resumed.pieceIdx : 0);
  const [lines, setLines] = useState(resumed && Number.isFinite(resumed.lines) ? resumed.lines : 0);
  const [points, setPoints] = useState(resumed && Number.isFinite(resumed.points) ? resumed.points : 0);
  const [hold, setHold] = useState(resumed && Number.isFinite(resumed.hold) ? resumed.hold : null);
  const [holdUsed, setHoldUsed] = useState(false);
  const [col, setCol] = useState(3);
  const [rot, setRot] = useState(0);
  // Fractional row the active piece has fallen to; gravity advances it and the
  // integer part is the collision row.
  const [fallY, setFallY] = useState(0);
  const [done, setDone] = useState(false);
  const [levelFlash, setLevelFlash] = useState(0);
  const initialSecs = savedProgress && Number.isFinite(savedProgress.elapsedSecs) ? savedProgress.elapsedSecs : 0;
  const { secs, fmt } = useTimer(!done, initialSecs);

  const level = dsLevelFor(lines);

  const stateRef = useRef({});
  stateRef.current = { grid, pieceIdx, lines, points, hold, secs };
  const buildProgress = () => ({
    progress: {
      dayNum, grid: stateRef.current.grid, pieceIdx: stateRef.current.pieceIdx,
      lines: stateRef.current.lines, points: stateRef.current.points,
      level: dsLevelFor(stateRef.current.lines), hold: stateRef.current.hold,
    },
    steps: stateRef.current.pieceIdx, secs: stateRef.current.secs,
  });
  useAutosave(onSaveProgress, buildProgress, !done);

  const bagLen = seq.current.length;
  const shapeIdx = pieceIdx < bagLen ? seq.current[pieceIdx] : 0;
  const cells = dsCells(shapeIdx, rot);
  const shapeW = Math.max(...cells.map(([x]) => x)) + 1;
  const clampedCol = Math.min(Math.max(col, 0), DS_W - shapeW);

  const canPlace = (g, atCol, yOff, cs = cells) =>
    cs.every(([dx, dy]) => {
      const x = atCol + dx, y = yOff + dy;
      return x >= 0 && x < DS_W && y < DS_H && y >= 0 && g[y][x] === 0;
    });

  const landingY = (g, atCol, cs = cells) => {
    let y = Math.floor(fallYRef.current);
    if (!canPlace(g, atCol, y, cs)) return -1;
    while (canPlace(g, atCol, y + 1, cs)) y++;
    return y;
  };

  // Mutable mirrors the rAF loop and pointer handlers read — both are bound
  // once and must never close over a stale render's state.
  const fallYRef = useRef(0);
  fallYRef.current = fallY;
  const liveRef = useRef({});
  liveRef.current = { grid, pieceIdx, lines, points, hold, holdUsed, clampedCol, rot, cells, shapeIdx, done, secs, fallY, shapeW };

  // Lock the active piece into the well, clear lines, and advance the bag.
  const lockPiece = (atY) => {
    const cur = liveRef.current;
    const g = cur.grid.map((row) => row.slice());
    for (const [dx, dy] of cur.cells) g[atY + dy][cur.clampedCol + dx] = cur.shapeIdx + 1;
    let cleared = 0;
    for (let r = DS_H - 1; r >= 0; r--) {
      if (g[r].every((v) => v !== 0)) {
        g.splice(r, 1);
        g.unshift(new Array(DS_W).fill(0));
        cleared++;
        r++;
      }
    }
    const lvl = dsLevelFor(cur.lines);
    const gained = ([0, 100, 250, 450, 700][cleared] || 0) * lvl;
    const np = cur.pieceIdx + 1, nl = cur.lines + cleared, npts = cur.points + gained;
    setGrid(g);
    setPieceIdx(np);
    setLines(nl);
    setPoints(npts);
    setRot(0);
    setCol(3);
    setFallY(0);
    fallYRef.current = 0;
    setHoldUsed(false);
    onStepChange(np);
    if (dsLevelFor(nl) > lvl) {
      setLevelFlash(dsLevelFor(nl));
      setTimeout(() => setLevelFlash(0), 900);
    }
    const won = np >= seq.current.length;
    if (!won && onSaveProgress) {
      onSaveProgress(
        { dayNum, grid: g, pieceIdx: np, lines: nl, points: npts, level: dsLevelFor(nl), hold: cur.hold },
        np, cur.secs
      );
    }
    if (won) {
      setDone(true);
      const score = npts + nl * 10 + dsLevelFor(nl) * 50 + 500;
      onWin(score, np, cur.secs, {
        share: `Game Corner Drop Stack — cleared the full ${seq.current.length}-piece bag, ${nl} lines, level ${dsLevelFor(nl)} 🧱`,
      });
    }
  };

  const topOut = () => {
    const cur = liveRef.current;
    setDone(true);
    onLose && onLose(cur.pieceIdx, cur.secs, {
      share: `Game Corner Drop Stack — topped out on piece ${cur.pieceIdx} at level ${dsLevelFor(cur.lines)} 🧱`,
      answer: `You reached level ${dsLevelFor(cur.lines)} with ${cur.lines} lines and ${cur.points} points.`,
    });
  };

  // Gravity. One rAF loop for the whole run: accumulate real elapsed time and
  // step the piece down whenever it exceeds the level's interval. Pausing on
  // a hidden tab means backgrounding the game never silently tops you out.
  useEffect(() => {
    if (done) return;
    let raf = 0, last = 0, acc = 0;
    const tick = (t) => {
      raf = requestAnimationFrame(tick);
      if (!last) { last = t; return; }
      const dt = t - last;
      last = t;
      if (document.visibilityState === 'hidden') return;
      const cur = liveRef.current;
      if (cur.done || cur.pieceIdx >= bagLen) return;
      acc += dt;
      const interval = Math.max(40, Math.round(dsGravityMs(dsLevelFor(cur.lines)) * dsBandMult));
      while (acc >= interval) {
        acc -= interval;
        const y = Math.floor(fallYRef.current);
        if (canPlace(cur.grid, cur.clampedCol, y + 1, cur.cells)) {
          fallYRef.current = y + 1;
          setFallY(y + 1);
        } else if (!canPlace(cur.grid, cur.clampedCol, y, cur.cells)) {
          // Spawn row already blocked — the well is full.
          topOut();
          return;
        } else {
          lockPiece(y);
          return;
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps

  const hardDrop = () => {
    const cur = liveRef.current;
    if (cur.done || cur.pieceIdx >= bagLen) return;
    const y = landingY(cur.grid, cur.clampedCol, cur.cells);
    if (y < 0) { topOut(); return; }
    lockPiece(y);
  };

  const rotate = () => {
    const cur = liveRef.current;
    if (cur.done) return;
    const next = dsCells(cur.shapeIdx, cur.rot + 1);
    const w = Math.max(...next.map(([x]) => x)) + 1;
    const atCol = Math.min(cur.clampedCol, DS_W - w);
    // Refuse a rotation that would clip the stack rather than letting it
    // overlap locked cells.
    if (!canPlace(cur.grid, atCol, Math.floor(fallYRef.current), next)) return;
    setRot((r) => r + 1);
    setCol(atCol);
  };

  const nudge = (d) => {
    const cur = liveRef.current;
    if (cur.done) return;
    const target = Math.min(Math.max(cur.clampedCol + d, 0), DS_W - cur.shapeW);
    if (canPlace(cur.grid, target, Math.floor(fallYRef.current), cur.cells)) setCol(target);
  };

  // Bank the active piece (or swap with the banked one). Once per lock, so it
  // can't be used to stall gravity indefinitely.
  const doHold = () => {
    const cur = liveRef.current;
    if (cur.done || holdUsed || cur.pieceIdx >= bagLen) return;
    const incoming = cur.hold;
    setHold(cur.shapeIdx);
    setHoldUsed(true);
    setRot(0);
    setCol(3);
    setFallY(0);
    fallYRef.current = 0;
    if (incoming == null) {
      // Nothing banked yet: consume the current piece from the bag.
      const np = cur.pieceIdx + 1;
      if (np >= seq.current.length) { setPieceIdx(np); return; }
      setPieceIdx(np);
      onStepChange(np);
    } else {
      // Swap: splice the banked shape into the bag at the current position so
      // the rest of the day's order is untouched.
      seq.current[cur.pieceIdx] = incoming;
    }
  };

  // Desktop keys. Registered ONCE (the old version had no dep array and
  // re-bound the listener on every render); the handlers all read liveRef.
  useEffect(() => {
    const onKey = (e) => {
      if (liveRef.current.done) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); nudge(1); }
      else if (e.key === 'ArrowUp' || e.key === 'x') { e.preventDefault(); rotate(); }
      else if (e.key === 'ArrowDown' || e.key === ' ') { e.preventDefault(); hardDrop(); }
      else if (e.key === 'c' || e.key === 'Shift') { e.preventDefault(); doHold(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Responsive canvas FRAME (controls wave) ----------------------------
  // Pills, the well, the Next queue, the Hold button and the D-pad draw on
  // one canvas; only the hint paragraph (and the level-flash overlay) stay
  // DOM. The well keeps its drag/tap/flick grammar, guarded to its region.
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const { boxW, boxH } = useFitBox(boxRef, { cols: 1, rows: 1, maxCell: 100000 });
  const W = Math.floor(boxW);
  const DS_GAPY = 8, DS_PILL_H = 46, DS_PAD_H = 44, DS_SIDE_W = 96, DS_NEXT_H = 116, DS_HOLD_H = 64;
  const dsChrome = DS_PILL_H + DS_GAPY + DS_GAPY + DS_PAD_H + 4;
  const availWell = Math.max(60, Math.floor(boxH) - dsChrome);
  const wellAvailW = Math.max(60, W - DS_SIDE_W - 8);
  const cell = Math.max(12, Math.min(34, Math.floor(Math.min(
    (wellAvailW - 8 - DS_GAP * (DS_W - 1)) / DS_W,
    (availWell - 8 - DS_GAP * (DS_H - 1)) / DS_H
  ))));
  const cellStep = cell + DS_GAP;
  const wellW = cellStep * DS_W - DS_GAP;
  const wellH = cellStep * DS_H - DS_GAP;
  const groupW = wellW + 8 + DS_SIDE_W;
  const gx0 = Math.max(0, Math.floor((W - groupW) / 2));
  const boardY = DS_PILL_H + DS_GAPY;
  const sideX = gx0 + wellW + 8;
  const padY = boardY + wellH + DS_GAPY;
  const H = padY + DS_PAD_H + 4;
  const dsGeoRef = useRef({});
  dsGeoRef.current = { gx0, boardY, wellW, wellH };

  const dsControls = [];
  if (W > 80) {
    const pr = cuiRow(0, 0, W, DS_PILL_H, 5);
    dsControls.push({ id: 'p-time', kind: 'pill', r: pr[0], label: 'Time', value: fmt, gold: true });
    dsControls.push({ id: 'p-level', kind: 'pill', r: pr[1], label: 'Level', value: level });
    dsControls.push({ id: 'p-lines', kind: 'pill', r: pr[2], label: 'Lines', value: lines });
    dsControls.push({ id: 'p-points', kind: 'pill', r: pr[3], label: 'Points', value: points });
    dsControls.push({ id: 'p-piece', kind: 'pill', r: pr[4], label: 'Piece', value: `${Math.min(pieceIdx + 1, bagLen)}/${bagLen}` });
    dsControls.push({
      id: 'hold', kind: 'button', r: [sideX, boardY + DS_NEXT_H + 8, DS_SIDE_W, DS_HOLD_H],
      label: 'Hold', font: 11, on: hold != null && !holdUsed,
      disabled: holdUsed || done, action: doHold,
    });
    const kr = cuiRow(Math.floor(W * 0.04), padY, Math.floor(W * 0.92), DS_PAD_H, 4);
    dsControls.push({ id: 'left', kind: 'button', r: kr[0], label: '◀', font: 16, action: () => nudge(-1) });
    dsControls.push({ id: 'rot', kind: 'button', r: kr[1], label: '⟳', font: 16, action: rotate });
    dsControls.push({ id: 'right', kind: 'button', r: kr[2], label: '▶', font: 16, action: () => nudge(1) });
    dsControls.push({ id: 'drop', kind: 'button', r: kr[3], label: '⬇ Drop', font: 14, primary: true, action: hardDrop });
  }
  const ctlRef = useRef([]);
  ctlRef.current = dsControls;
  const [pressedId, setPressedId] = useState(null);

  // Drag maps finger travel to columns; a fast downward flick hard-drops; a
  // tap that never became a drag rotates. Guarded to the well region so a
  // stray tap on the Next panel doesn't rotate.
  const dragRef = useRef({ startCol: 0, moved: false });
  const dsInWell = (pt) => {
    const g = dsGeoRef.current;
    return pt.x >= g.gx0 && pt.x <= g.gx0 + g.wellW && pt.y >= g.boardY && pt.y <= g.boardY + g.wellH;
  };
  usePointerCell(canvasRef, cuiWrapHandlers(ctlRef, setPressedId, {
    onDown: (pt) => {
      dragRef.current = { startCol: liveRef.current.clampedCol, moved: false, armed: dsInWell(pt) };
    },
    onDrag: (_p, info) => {
      const cur = liveRef.current;
      if (cur.done || !dragRef.current.armed) return;
      const steps = Math.round(info.dx / Math.max(cellStep, 1));
      const target = Math.min(Math.max(dragRef.current.startCol + steps, 0), DS_W - cur.shapeW);
      if (target !== cur.clampedCol && canPlace(cur.grid, target, Math.floor(fallYRef.current), cur.cells)) {
        dragRef.current.moved = true;
        setCol(target);
      }
      // A decisive downward flick counts as intent, not a stray wobble —
      // marking it here stops the release from also firing a rotate.
      if (Math.abs(info.dy) > cellStep * 2 && Math.abs(info.dy) > Math.abs(info.dx) * 1.5) {
        dragRef.current.moved = true;
        dragRef.current.swipeDown = info.dy > 0;
      }
    },
    onUp: () => {
      if (liveRef.current.done) return;
      if (dragRef.current.swipeDown) { dragRef.current.swipeDown = false; hardDrop(); }
    },
    // A press that never moved is a rotate. No long-press action on the well,
    // so the timer is effectively disabled.
    onTap: () => { if (dragRef.current.armed && !dragRef.current.moved) rotate(); },
  }), { moveTolerance: 6 });

  const ghostY = landingY(grid, clampedCol);
  const nextThree = [1, 2, 3]
    .map((n) => (pieceIdx + n < bagLen ? seq.current[pieceIdx + n] : null));

  // Side-panel mini pieces, drawn (the DOM 9px-cell idiom on canvas).
  const dsDrawMini = (ctx, idx, cx, cy, boxW2, boxH2) => {
    if (idx == null) {
      ctx.font = '600 12px ' + CUI_FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = PAL.muted;
      ctx.fillText('—', cx + boxW2 / 2, cy + boxH2 / 2);
      return;
    }
    const cs = dsCells(idx, 0);
    const w = Math.max(...cs.map(([x]) => x)) + 1;
    const h = Math.max(...cs.map(([, y]) => y)) + 1;
    const u = 9;
    const x0 = cx + (boxW2 - w * u) / 2, y0 = cy + (boxH2 - h * u) / 2;
    for (const [x, y] of cs) {
      ctx.fillStyle = DS_SHAPES[idx].color;
      ctx.fillRect(x0 + x * u, y0 + y * u, u - 1, u - 1);
    }
  };

  useCanvasBoard(canvasRef, {
    width: W,
    height: H,
    deps: [cell, grid, clampedCol, rot, fallY, pieceIdx, done, W, fmt, level, lines, points, hold, holdUsed, pressedId],
    draw: (ctx) => {
      cuiDrawControls(ctx, ctlRef.current, pressedId);
      // Next panel (display) + the queued minis; the Hold button's mini
      // draws over its control face.
      klRR(ctx, sideX, boardY, DS_SIDE_W, DS_NEXT_H, 10);
      ctx.fillStyle = PAL.card;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = PAL.border;
      ctx.stroke();
      ctx.font = '600 9px ' + CUI_FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = PAL.muted;
      ctx.fillText('NEXT', sideX + DS_SIDE_W / 2, boardY + 14);
      nextThree.forEach((n, k) => dsDrawMini(ctx, n, sideX + 4, boardY + 18 + k * 32, DS_SIDE_W - 8, 30));
      dsDrawMini(ctx, hold, sideX + 4, boardY + DS_NEXT_H + 8 + 24, DS_SIDE_W - 8, DS_HOLD_H - 30);
      ctx.save();
      ctx.translate(gx0, boardY);
      const radius = Math.max(2, Math.round(cell * 0.18));
      const box = (x, y, fill, stroke, alpha) => {
        ctx.globalAlpha = alpha == null ? 1 : alpha;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, cell, cell, radius);
        else ctx.rect(x, y, cell, cell);
        if (fill) { ctx.fillStyle = fill; ctx.fill(); }
        if (stroke) { ctx.lineWidth = 1.5; ctx.strokeStyle = stroke; ctx.stroke(); }
        ctx.globalAlpha = 1;
      };
      for (let r = 0; r < DS_H; r++) for (let c = 0; c < DS_W; c++) {
        const v = grid[r][c];
        // Empty-cell chrome comes from PAL; the tetromino palette is intrinsic
        // art and stays hardcoded. Passing C.card here was what made the whole
        // well repaint in the previous frame's piece colour.
        box(c * cellStep, r * cellStep, v ? DS_SHAPES[v - 1].color : PAL.card, v ? null : PAL.border);
      }
      if (!done && pieceIdx < bagLen) {
        const color = DS_SHAPES[shapeIdx].color;
        if (ghostY >= 0) {
          for (const [dx, dy] of cells) {
            box((clampedCol + dx) * cellStep, (ghostY + dy) * cellStep, null, color, 0.45);
          }
        }
        const y0 = Math.floor(fallY);
        for (const [dx, dy] of cells) {
          if (y0 + dy < 0) continue;
          box((clampedCol + dx) * cellStep, (y0 + dy) * cellStep, color, null);
        }
      }
      ctx.restore();
    },
  });

  return (
    <div className="ds-game fit-col">
      <div className="ds-boardbox cui-frame" ref={boxRef}>
        <canvas
          ref={canvasRef}
          className="ds-canvas board-canvas"
          role="grid"
          aria-label={`Drop Stack well, level ${level}, ${lines} lines cleared, piece ${Math.min(pieceIdx + 1, bagLen)} of ${bagLen}`}
        />
        {levelFlash > 0 && <div className="ds-level-flash">Level {levelFlash}</div>}
      </div>
      <CuiTwin controls={dsControls} />
      <div className="p6-hint">
        Drag to slide, tap to rotate, swipe down to drop. Speed rises every {DS_LINES_PER_LEVEL} lines.
      </div>
    </div>
  );
}

// Each entry also carries the Game Corner harness `manifest` (phase 2),
// mirrored by id in server.js's GAME_REGISTRY — machine-relevant fields
// (scoreDirection / tieBreak / sessionLength / input / undo) must match the
// server; `howToPlay` card copy lives ONLY here (display strings are the
// client's). Phase 3's shell-owned pre-game chrome renders these cards; until
// then they're declarative metadata.