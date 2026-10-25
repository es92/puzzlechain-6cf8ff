/* ============================================================
   Snakes & Ladders V2 — the board canvas
   ============================================================
   Two-layer drawing: the static layer (cells, numbers, Moksha labels,
   every illustrated snake and ladder) renders ONCE into an offscreen
   canvas cached per (layout, variant, skin, side, theme), and each
   frame blits the cache and draws only the pawns + the 130ms glide.
   The old board redrew everything per glide frame — fine for straight
   lines, not for illustrated art.

   DOM contract (existing dapp.json checks pin these): the canvas keeps
   classes `cnl-canvas board-canvas`, sits under `.cnl-board-wrap` (the
   caller renders that wrapper), and carries data-cnl-p2="diamond"
   unconditionally — every V2 board has a Player 2. */

// Static layer: board chrome reads PAL (re-themes live); the illustrations
// are intrinsic art with hardcoded palettes from 01-art.jsx.
function cnlv2DrawBoardStatic(ctx, side, { V, isMoksha, isLegend, gildAll, skinId }) {
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
      const meaning = isMoksha ? CNL_MOKSHA_MEANINGS[n] : null;
      if (meaning) {
        const isL = V.ladders[n] !== undefined;
        ctx.font = `700 ${Math.max(5, Math.round(cs * 0.14))}px 'Space Grotesk', sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = isL ? PAL.emerald : PAL.rose;
        let name = meaning.name.toUpperCase();
        while (name.length > 2 && ctx.measureText(name).width > cs - 3) name = name.slice(0, -1);
        ctx.fillText(name, x + cs / 2, y + cs - Math.max(6, Math.round(cs * 0.17)));
      }
    }
  }
  // Illustrations over the cells: ladders first, snakes on top.
  const tint = CNLV2_ART_TINTS[isMoksha ? 'plain' : skinId] || CNLV2_ART_TINTS.plain;
  for (const k of Object.keys(V.ladders)) {
    const from = parseInt(k, 10), to = V.ladders[from];
    const [ax, ay] = pct(cnlCenterPct(from));
    const [bx, by] = pct(cnlCenterPct(to));
    const rowsSpanned = Math.floor((to - 1) / 10) - Math.floor((from - 1) / 10);
    cnlv2DrawLadder(ctx, ax, ay, bx, by, cs, tint, gildAll || rowsSpanned >= 3);
  }
  for (const k of Object.keys(V.chutes)) {
    const from = parseInt(k, 10), to = V.chutes[from];
    const [ax, ay] = pct(cnlCenterPct(from));
    const [bx, by] = pct(cnlCenterPct(to));
    cnlv2DrawSnake(ctx, ax, ay, bx, by, cs, from, { dragon: isLegend, tint });
  }
  // Outer border.
  klRR(ctx, 1, 1, side - 2, side - 2, 12);
  ctx.lineWidth = 2;
  ctx.strokeStyle = PAL.border;
  ctx.stroke();
}

/* ============================================================
   VFX layer (particles + screen shake)
   ============================================================
   Both live INSIDE this component's existing rAF glide loop rather than in a
   second canvas or a CSS animation. Two reasons: the loop already owns the
   only per-frame paint in the game (no setState per frame — see the
   PERFORMANCE CONTRACT below), and a CSS transform on the canvas element would
   scale rasterised pixels and go soft, the same trap Daily Bounce's sizeCanvas
   documents.

   The loop's continue condition therefore widens from "a glide is running" to
   "a glide OR a particle OR a shake is running". Miss that and particles paint
   exactly one frame and freeze. */
const SNLV2_FX_MAX = 90;      // hard cap; a stuck spawner cannot melt the frame
const SNLV2_FX_LIFE = 520;    // ms
const SNLV2_SHAKE_MS = 260;

/* positions: array of squares, one per seat (0 = off-board). `layoutKey`
   names the static art (tier id / variant) for the cache.

   PERFORMANCE CONTRACT. The static layer (cells, numbers, every illustrated
   snake/dragon/ladder) is drawn ONCE per (layout, variant, skin, side, theme)
   into an offscreen canvas; every frame after that is one drawImage blit plus
   the pawns. The glide is driven by a dedicated rAF loop that paints the
   canvas DIRECTLY — no setState per frame. The first build used a per-frame
   setState to "animate", which did the worst of both worlds: React re-rendered
   every frame (the lag) while useCanvasBoard's deps never changed, so the
   interpolation frames never painted — pawns froze ~12% into each lerp and
   only snapped forward on the next state change (the ghost).

   `fx` / `shake` / `slide` are one-shot signals carrying a monotonic `seq`:
   the effect fires when the seq changes, so replaying the same kind twice in a
   row still animates. `finishOrder` lists seat numbers in placement order and
   is what dims a finished pawn and stamps its medal. */
function SnLV2Board({ V, isMoksha, isLegend, gildAll, SK, positions, vsBot,
  finishOrder, fx, shake, slide, quiet }) {
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const { boxW } = useFitBox(boxRef, { cols: 10, rows: 10 });
  const side = Math.max(0, Math.floor(boxW));
  const seats = positions.length;
  const themeV = useThemeVersion();
  const skinId = SK ? (Object.keys(CNL_SKINS).find((k) => CNL_SKINS[k] === SK) || 'plain') : 'plain';
  const layoutKey = [isMoksha ? 'moksha' : 'tier', isLegend ? 1 : 0, gildAll ? 1 : 0,
    Object.keys(V.jumps).join('.')].join('|');
  const posKey = positions.join(',');
  const done = finishOrder || [];
  const doneKey = done.join(',');
  // The app-level motion pref, the OS pref and ?snlquiet=1 all silence the
  // extra motion; the glide itself stays, because a pawn teleporting between
  // squares is a correctness problem, not polish.
  const calm = !!quiet || cgReducedMotion();

  // Static-layer cache; rebuilt only when an art input changes.
  const staticRef = useRef({ key: null, cv: null });

  // Pawn glide state: each pawn's previous square, target square, lerp start
  // time, and (per move) how long and with what easing. A snake slide is a
  // longer, accelerating drop; everything else keeps the 130ms ease-out.
  const glideRef = useRef(positions.map((p) => ({ from: p, to: p, t0: 0, ms: SNLV2_GLIDE_MS, ease: 'out' })));
  const fxRef = useRef([]);
  const shakeRef = useRef({ t0: 0, mag: 0 });
  const rafRef = useRef(0);

  /* One painter shared by BOTH redraw paths (React-scheduled repaints on
     dep/theme/size changes, and the rAF glide loop below). Reassigned every
     render so it always closes over the current props; the ref indirection is
     what lets the rAF loop paint without any React work per frame. */
  const paintRef = useRef(null);
  paintRef.current = (ctx) => {
    if (side < 80) return;
    const pad = 4;
    const inner = side - pad * 2;
    const cs = inner / 10;
    const pct = (p) => [pad + (p.x / 100) * inner, pad + (p.y / 100) * inner];
    const now = performance.now();

    /* Screen shake wraps the WHOLE frame. The canvas carries no pointer
       handlers (every control is DOM), so nothing needs a hit-test
       correction for the offset. */
    const sh = shakeRef.current;
    const sp = sh.mag ? (now - sh.t0) / SNLV2_SHAKE_MS : 2;
    ctx.save();
    if (sp < 1) {
      const decay = 1 - sp;
      ctx.translate(Math.sin(sp * Math.PI * 4) * sh.mag * decay,
        Math.cos(sp * Math.PI * 5) * sh.mag * decay * 0.6);
    }

    // Blit the cached static layer (rebuild if any art input moved).
    const key = [layoutKey, skinId, side, themeV].join('~');
    let st = staticRef.current;
    if (st.key !== key || !st.cv) {
      const dpr = canvasDpr();
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(side * dpr));
      cv.height = Math.max(1, Math.round(side * dpr));
      const c2 = guardCanvasCtx(cv.getContext('2d'));
      if (!c2) { ctx.restore(); return; }
      c2.setTransform(dpr, 0, 0, dpr, 0, 0);
      cnlv2DrawBoardStatic(c2, side, { V, isMoksha, isLegend, gildAll, skinId });
      st = staticRef.current = { key, cv };
    }
    ctx.drawImage(st.cv, 0, 0, side, side);

    // Dynamic layer: pawns gliding between squares (t clamped to 1, so a
    // settled pawn always sits EXACTLY on its square, never mid-lerp).
    const g = glideRef.current.length === seats
      ? glideRef.current
      : positions.map((p) => ({ from: p, to: p, t0: 0, ms: SNLV2_GLIDE_MS, ease: 'out' }));
    const pos = g.map((gp) => {
      const p = Math.min(1, (now - gp.t0) / (gp.ms || SNLV2_GLIDE_MS));
      // A snake drop accelerates (ease-in); everything else settles (ease-out).
      const e = gp.ease === 'in' ? p * p : 1 - (1 - p) * (1 - p);
      const [fx0, fy0] = pct(cnlCenterPct(gp.from));
      const [tx, ty] = pct(cnlCenterPct(gp.to));
      return [fx0 + (tx - fx0) * e, fy0 + (ty - fy0) * e];
    });
    // Co-located pawns fan out in a small ring so all six stay visible
    // even at the 320px minimum board width.
    const groups = {};
    g.forEach((gp, i) => { (groups[gp.to] = groups[gp.to] || []).push(i); });
    for (const sq of Object.keys(groups)) {
      const idxs = groups[sq];
      if (idxs.length < 2) continue;
      const rr = cs * (idxs.length === 2 ? 0.24 : 0.3);
      idxs.forEach((i, j) => {
        const ang = idxs.length === 2 ? (j === 0 ? Math.PI : 0) : (-Math.PI / 2 + (j * 2 * Math.PI) / idxs.length);
        pos[i][0] += Math.cos(ang) * rr;
        pos[i][1] += Math.sin(ang) * rr;
      });
    }
    const ph = cs * 0.85; // chess pieces ~1.6x the old token radius
    for (let i = 0; i < seats; i++) {
      const place = done.indexOf(i + 1);
      ctx.save();
      // A finished pawn stays on the board (it is the proof of the result) but
      // steps back visually so the live race still reads at a glance.
      if (place >= 0) ctx.globalAlpha = 0.5;
      cnlv2DrawPawn(ctx, pos[i][0], pos[i][1] - ph * 0.08, ph, i + 1);
      ctx.restore();
      if (place >= 0) cnlv2DrawPlaceChip(ctx, pos[i][0], pos[i][1] - ph * 0.72, cs, place + 1);
    }

    // Particles last, over the pawns.
    const parts = fxRef.current;
    for (let i = 0; i < parts.length; i++) {
      const pt = parts[i];
      const age = (now - pt.t0) / SNLV2_FX_LIFE;
      if (age >= 1) continue;
      ctx.save();
      ctx.globalAlpha = (1 - age) * pt.alpha;
      ctx.fillStyle = palOf(pt.color, '#C9A227');
      const px = pt.x + pt.vx * age * SNLV2_FX_LIFE;
      const py = pt.y + pt.vy * age * SNLV2_FX_LIFE + 0.00045 * pt.g * Math.pow(age * SNLV2_FX_LIFE, 2);
      if (pt.spark) {
        // 4-point sparkle: two crossed slivers read brighter than a dot.
        const r = pt.size * (1 - age * 0.5);
        ctx.beginPath();
        ctx.moveTo(px - r, py); ctx.lineTo(px, py - r * 0.35);
        ctx.lineTo(px + r, py); ctx.lineTo(px, py + r * 0.35);
        ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(px, py - r); ctx.lineTo(px + r * 0.35, py);
        ctx.lineTo(px, py + r); ctx.lineTo(px - r * 0.35, py);
        ctx.closePath(); ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(px, py, Math.max(0.5, pt.size * (1 - age * 0.6)), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
    ctx.textBaseline = 'top';
  };

  const sideRef = useRef(side);
  sideRef.current = side;

  /* The single animation driver. Every source of motion (glide, particles,
     shake) calls kick(); the loop terminates itself once all three are idle,
     so an idle board costs zero frames. */
  const kickRef = useRef(null);
  kickRef.current = () => {
    if (rafRef.current) return;
    const step = () => {
      rafRef.current = 0;
      const canvas = canvasRef.current;
      const paint = paintRef.current;
      if (!canvas || !paint) return;
      const ctx = guardCanvasCtx(canvas.getContext('2d'));
      if (!ctx) return;
      const s = sideRef.current;
      const dpr = canvasDpr();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, s, s);
      paint(ctx);
      const now = performance.now();
      const gliding = glideRef.current.some((gp) => now - gp.t0 < (gp.ms || SNLV2_GLIDE_MS) + 10);
      // Retiring dead particles here (not in the painter) keeps the painter
      // pure — useCanvasBoard calls it too, on React's schedule.
      fxRef.current = fxRef.current.filter((pt) => now - pt.t0 < SNLV2_FX_LIFE);
      const shaking = shakeRef.current.mag && (now - shakeRef.current.t0) < SNLV2_SHAKE_MS;
      if (gliding || fxRef.current.length || shaking) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  };

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  /* Position changes update the glide targets, then the shared loop paints the
     canvas directly at display rate until every lerp lands. The loop's last
     pass paints with t = 1 (the liveness check runs AFTER the paint), so the
     animation always ends with pawns pinned to their squares. */
  useEffect(() => {
    const g = glideRef.current;
    if (g.length !== seats) {
      glideRef.current = positions.map((p) => ({ from: p, to: p, t0: 0, ms: SNLV2_GLIDE_MS, ease: 'out' }));
      return;
    }
    let changed = false;
    positions.forEach((pos, i) => {
      if (g[i].to === pos) return;
      const useSlide = slide && slide.seat === i + 1 && !calm;
      g[i] = {
        from: g[i].to,
        to: pos,
        t0: performance.now(),
        ms: useSlide ? slide.ms : SNLV2_GLIDE_MS,
        ease: useSlide ? slide.ease : 'out',
      };
      changed = true;
    });
    if (!changed) return;
    if (kickRef.current) kickRef.current();
  }, [posKey, seats]);

  // Particle burst. `fx.seq` is the trigger, so two ladders in a row both fire.
  useEffect(() => {
    if (!fx || !fx.kind || calm) return;
    const s = sideRef.current;
    if (s < 80) return;
    const pad = 4, inner = s - pad * 2, cs = inner / 10;
    const c = cnlCenterPct(fx.square || 1);
    const cx = pad + (c.x / 100) * inner, cy = pad + (c.y / 100) * inner;
    const spec = fx.kind === 'ladder'
      ? { n: 18, spark: true, colors: ['gold', 'emerald'], speed: 0.075, g: -0.02, size: cs * 0.13, alpha: 1 }
      : { n: 14, spark: false, colors: ['muted', 'border'], speed: 0.045, g: 0.06, size: cs * 0.1, alpha: 0.8 };
    const add = [];
    for (let i = 0; i < spec.n; i++) {
      const ang = (i / spec.n) * Math.PI * 2 + Math.random() * 0.5;
      const sp = spec.speed * (0.5 + Math.random());
      add.push({
        x: cx, y: cy,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - (spec.spark ? 0.02 : 0),
        g: spec.g, t0: performance.now(), alpha: spec.alpha,
        color: spec.colors[i % spec.colors.length],
        size: spec.size * (0.6 + Math.random() * 0.7), spark: spec.spark,
      });
    }
    fxRef.current = fxRef.current.concat(add).slice(-SNLV2_FX_MAX);
    if (kickRef.current) kickRef.current();
  }, [fx && fx.seq]);

  useEffect(() => {
    if (!shake || !shake.mag || calm) return;
    shakeRef.current = { t0: performance.now(), mag: shake.mag };
    if (kickRef.current) kickRef.current();
  }, [shake && shake.seq]);

  // React-scheduled repaints: mount, resize, theme flip, board/skin change,
  // and a safety repaint on any position change (idempotent with the loop).
  useCanvasBoard(canvasRef, {
    width: side,
    height: side,
    deps: [posKey, layoutKey, skinId, side, seats, doneKey],
    draw: (ctx) => { const f = paintRef.current; if (f) f(ctx); },
  });

  const seatDesc = positions.map((p, i) => {
    const piece = (i + 1) % 2 === 1 ? 'knight' : 'rook';
    const extra = (i === 1 ? ', diamond emblem' : '') + (vsBot && i === 1 ? ', bot' : '');
    const place = done.indexOf(i + 1);
    if (place >= 0) return `seat ${i + 1} (${piece}${extra}) finished in place ${place + 1}`;
    return `seat ${i + 1} (${piece}${extra}) on square ${p || 0}`;
  }).join(', ');

  return (
    <div className="cnl-board-canvas-fill" ref={boxRef}>
      <canvas
        ref={canvasRef}
        className="cnl-canvas board-canvas"
        role="img"
        data-cnl-p2="diamond"
        aria-label={`Board — ${seatDesc}`}
      />
    </div>
  );
}
