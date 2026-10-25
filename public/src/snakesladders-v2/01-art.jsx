/* ============================================================
   Snakes & Ladders V2 — hand-drawn canvas art
   ============================================================
   Illustrated snakes (dragons on Legend), wooden/golden ladders and
   chess-piece pawns. All of this is INTRINSIC GAME ART and stays
   hardcoded hex per the standing "only chrome re-themes" rule — the
   board chrome around it (cells, numbers, border) reads PAL in the
   board component instead.

   Skins select a tint set, not different draw code: the same ladder
   and snake routines take the palette from CNLV2_ART_TINTS. */

// Seat colors, 1-based seats 1–6 (P2 violet keeps the "player 2 is the
// diamond one" identity via the emblem drawn on its Rook's base).
const CNLV2_SEAT_COLORS = ['#4f7cff', '#8b5cf6', '#10b981', '#f59e0b', '#f43f5e', '#06b6d4'];

const CNLV2_ART_TINTS = {
  plain: {
    rail: '#a06b3a', railEdge: '#6b4423', rung: '#c68a4e',
    snake: '#3f9142', snakeDark: '#2e6f33', belly: '#d9e8c8', motif: null,
  },
  jungle: {
    rail: '#5d8a3c', railEdge: '#3e5f27', rung: '#7fae57',
    snake: '#2e8b57', snakeDark: '#1f6b41', belly: '#e2f0cf', motif: 'leaf',
  },
  space: {
    rail: '#9aa7bd', railEdge: '#5d6a80', rung: '#c3cddd',
    snake: '#7c6cf0', snakeDark: '#5646c8', belly: '#dfe3ff', motif: 'star',
  },
  pirate: {
    rail: '#c9a06a', railEdge: '#8f6b3e', rung: '#b78d55',
    snake: '#2b7a8c', snakeDark: '#1d5865', belly: '#d3ecef', motif: 'rope',
  },
};

// Dragon palette for the Legend tier — crimson body, ember belly.
const CNLV2_DRAGON_TINT = { snake: '#b91c1c', snakeDark: '#7f1d1d', belly: '#fbbf24' };

const CNLV2_GOLD = { rail: '#e0b23e', railEdge: '#96741f', rung: '#c9992e', highlight: '#fff0b8' };

function cnlv2Line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/* Wooden (or gilded) ladder: two parallel rails offset perpendicular to the
   climb, rungs every ~0.35 cell, rounded caps. */
function cnlv2DrawLadder(ctx, ax, ay, bx, by, cs, tint, gilded) {
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len, py = dx / len;
  const off = cs * 0.17;
  const railW = Math.max(2.5, cs * 0.1);
  const rail = gilded ? CNLV2_GOLD.rail : tint.rail;
  const railEdge = gilded ? CNLV2_GOLD.railEdge : tint.railEdge;

  ctx.save();
  ctx.lineCap = 'round';
  // Rungs first so the rails cap their ends.
  const n = Math.max(2, Math.round(len / (cs * 0.35)));
  ctx.strokeStyle = gilded ? CNLV2_GOLD.rung : tint.rung;
  ctx.lineWidth = Math.max(2, cs * 0.075);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const cx = ax + dx * t, cy = ay + dy * t;
    cnlv2Line(ctx, cx + px * off, cy + py * off, cx - px * off, cy - py * off);
  }
  for (const s of [-1, 1]) {
    ctx.strokeStyle = railEdge;
    ctx.lineWidth = railW + 2;
    cnlv2Line(ctx, ax + px * off * s, ay + py * off * s, bx + px * off * s, by + py * off * s);
    ctx.strokeStyle = rail;
    ctx.lineWidth = railW;
    cnlv2Line(ctx, ax + px * off * s, ay + py * off * s, bx + px * off * s, by + py * off * s);
  }
  if (gilded) {
    // Warm highlight stroke along one rail so the gilt reads at a glance.
    ctx.strokeStyle = CNLV2_GOLD.highlight;
    ctx.lineWidth = Math.max(1, railW * 0.3);
    cnlv2Line(ctx, ax + px * off, ay + py * off, bx + px * off, by + py * off);
  }
  // Small skin motifs along the rails (leaves / stars / rope wraps).
  if (tint.motif && !gilded) {
    const m = Math.max(2, Math.round(len / (cs * 0.9)));
    for (let i = 1; i < m; i++) {
      const t = (i - 0.5) / m;
      const s = i % 2 ? 1 : -1;
      const mx = ax + dx * t + px * off * s * 1.45;
      const my = ay + dy * t + py * off * s * 1.45;
      if (tint.motif === 'leaf') {
        ctx.fillStyle = '#7fae57';
        ctx.beginPath();
        ctx.ellipse(mx, my, cs * 0.07, cs * 0.035, Math.atan2(dy, dx) + s * 0.7, 0, Math.PI * 2);
        ctx.fill();
      } else if (tint.motif === 'star') {
        ctx.fillStyle = '#e8ecff';
        ctx.beginPath();
        ctx.arc(mx, my, cs * 0.03, 0, Math.PI * 2);
        ctx.fill();
      } else if (tint.motif === 'rope') {
        ctx.strokeStyle = '#8f6b3e';
        ctx.lineWidth = 1.5;
        const rx = ax + dx * t, ry = ay + dy * t;
        cnlv2Line(ctx, rx + px * off * 0.7, ry + py * off * 0.7 - 2, rx + px * off * 1.3, ry + py * off * 1.3 + 2);
      }
    }
  }
  ctx.restore();
}

// Catmull-Rom sampling through control points -> smooth polyline.
function cnlv2SampleSpline(pts, samples) {
  const out = [];
  const P = (i) => pts[Math.max(0, Math.min(pts.length - 1, i))];
  const segs = pts.length - 1;
  for (let s = 0; s < samples; s++) {
    const g = (s / (samples - 1)) * segs;
    const i = Math.min(segs - 1, Math.floor(g));
    const t = g - i;
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const t2 = t * t, t3 = t2 * t;
    out.push([
      0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
      0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
    ]);
  }
  return out;
}

/* Illustrated snake (or Legend dragon) from head square (ax,ay) to tail
   (bx,by). The pose is deterministic per head square via the shared
   mulberry32 family, so every board renders the same organic sprawl. */
function cnlv2DrawSnake(ctx, ax, ay, bx, by, cs, seedSq, opts) {
  const dragon = !!(opts && opts.dragon);
  const tint = dragon ? CNLV2_DRAGON_TINT : ((opts && opts.tint) || CNLV2_ART_TINTS.plain);
  const rng = mulberry32(9001 + seedSq * 131);
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const px = -uy, py = ux;

  // 2–3 perpendicular S-offsets between head and tail.
  const nMid = len > cs * 4.5 ? 3 : 2;
  const baseSign = rng() > 0.5 ? 1 : -1;
  const ctrl = [[ax, ay]];
  for (let i = 1; i <= nMid; i++) {
    const t = i / (nMid + 1);
    const sway = (0.5 + rng() * 0.5) * Math.min(cs * 0.85, len * 0.17) * (i % 2 ? 1 : -1) * baseSign;
    ctrl.push([ax + ux * len * t + px * sway, ay + uy * len * t + py * sway]);
  }
  ctrl.push([bx, by]);
  const pts = cnlv2SampleSpline(ctrl, 40);

  // Tapered filled body: wide behind the head, thin at the tail.
  const wHead = Math.max(3, cs * 0.16), wTail = Math.max(1, cs * 0.035);
  const left = [], right = [];
  for (let i = 0; i < pts.length; i++) {
    const t = i / (pts.length - 1);
    const w = wHead * (1 - t) * (1 - t * 0.35) + wTail * t;
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const sl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / sl, ny = (b[0] - a[0]) / sl;
    left.push([pts[i][0] + nx * w, pts[i][1] + ny * w]);
    right.push([pts[i][0] - nx * w, pts[i][1] - ny * w]);
  }
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (const p of left) ctx.lineTo(p[0], p[1]);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fillStyle = tint.snake;
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = tint.snakeDark;
  ctx.stroke();

  // Belly stripe + dorsal pattern.
  ctx.strokeStyle = tint.belly;
  ctx.lineWidth = Math.max(1, wHead * 0.34);
  ctx.beginPath();
  ctx.moveTo(pts[2][0], pts[2][1]);
  for (let i = 3; i < pts.length - 2; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
  ctx.fillStyle = tint.snakeDark;
  for (let i = 4; i < pts.length - 4; i += 4) {
    ctx.beginPath();
    ctx.arc(pts[i][0], pts[i][1], Math.max(1, wHead * 0.18), 0, Math.PI * 2);
    ctx.fill();
  }
  if (dragon) {
    // Dorsal spike triangles along the spine.
    for (let i = 3; i < pts.length - 5; i += 4) {
      const a = pts[i], b = pts[i + 2];
      const sl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nx = -(b[1] - a[1]) / sl, ny = (b[0] - a[0]) / sl;
      const mid = [(a[0] + b[0]) / 2 + nx * cs * 0.14, (a[1] + b[1]) / 2 + ny * cs * 0.14];
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(mid[0], mid[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.closePath();
      ctx.fillStyle = tint.snakeDark;
      ctx.fill();
    }
  }

  // Head at the TOP (start) square: skull, eyes, forked tongue.
  const hr = Math.max(3, cs * 0.2);
  const hd = pts[0];
  // Direction the head faces = away from the body.
  const bdx = hd[0] - pts[3][0], bdy = hd[1] - pts[3][1];
  const bl = Math.hypot(bdx, bdy) || 1;
  const fx = bdx / bl, fy = bdy / bl;
  ctx.beginPath();
  ctx.ellipse(hd[0], hd[1], hr, hr * 0.82, Math.atan2(fy, fx), 0, Math.PI * 2);
  ctx.fillStyle = tint.snake;
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = tint.snakeDark;
  ctx.stroke();
  if (dragon) {
    // Horn pair.
    for (const s of [-1, 1]) {
      const hx = hd[0] - fx * hr * 0.3 + -fy * s * hr * 0.7;
      const hy = hd[1] - fy * hr * 0.3 + fx * s * hr * 0.7;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx - fx * hr * 0.9 + -fy * s * hr * 0.6, hy - fy * hr * 0.9 + fx * s * hr * 0.6);
      ctx.lineTo(hx - fx * hr * 0.2 + -fy * s * hr * 0.25, hy - fy * hr * 0.2 + fx * s * hr * 0.25);
      ctx.closePath();
      ctx.fillStyle = tint.belly;
      ctx.fill();
    }
  }
  // Eyes.
  for (const s of [-1, 1]) {
    const ex = hd[0] + fx * hr * 0.25 + -fy * s * hr * 0.42;
    const ey = hd[1] + fy * hr * 0.25 + fx * s * hr * 0.42;
    ctx.beginPath(); ctx.arc(ex, ey, Math.max(1.2, hr * 0.2), 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.beginPath(); ctx.arc(ex + fx * 0.8, ey + fy * 0.8, Math.max(0.7, hr * 0.1), 0, Math.PI * 2); ctx.fillStyle = '#1a1a1a'; ctx.fill();
  }
  // Forked tongue.
  const tx = hd[0] + fx * hr * 1.05, ty = hd[1] + fy * hr * 1.05;
  ctx.strokeStyle = dragon ? '#fbbf24' : '#e0455a';
  ctx.lineWidth = Math.max(1, hr * 0.14);
  ctx.lineCap = 'round';
  cnlv2Line(ctx, tx, ty, tx + fx * hr * 0.7, ty + fy * hr * 0.7);
  for (const s of [-1, 1]) {
    cnlv2Line(ctx, tx + fx * hr * 0.7, ty + fy * hr * 0.7,
      tx + fx * hr * 1.15 + -fy * s * hr * 0.3, ty + fy * hr * 1.15 + fx * s * hr * 0.3);
  }
  ctx.restore();
}

/* Chess-piece pawn: Knight (horse-head profile) for odd seats, Rook
   (crenellated tower) for even seats. `h` is the piece height; the piece is
   drawn centered on (x, y). Seat 2's Rook carries a small diamond emblem —
   the attribute data-cnl-p2="diamond" stays honest. */
function cnlv2DrawPawn(ctx, x, y, h, seat) {
  const color = CNLV2_SEAT_COLORS[(seat - 1) % CNLV2_SEAT_COLORS.length];
  ctx.save();
  ctx.translate(x, y);
  const u = h; // unit
  ctx.beginPath();
  if (seat % 2 === 1) {
    // Knight — horse head profile over a base.
    ctx.moveTo(-0.30 * u, 0.5 * u);
    ctx.lineTo(-0.22 * u, 0.16 * u);
    ctx.quadraticCurveTo(-0.36 * u, 0.0, -0.26 * u, -0.18 * u);
    ctx.quadraticCurveTo(-0.16 * u, -0.36 * u, 0.0, -0.42 * u);
    ctx.lineTo(0.05 * u, -0.5 * u);        // ear
    ctx.lineTo(0.15 * u, -0.36 * u);
    ctx.quadraticCurveTo(0.36 * u, -0.28 * u, 0.36 * u, -0.12 * u);
    ctx.lineTo(0.18 * u, -0.08 * u);       // muzzle
    ctx.quadraticCurveTo(0.08 * u, -0.04 * u, 0.1 * u, 0.08 * u);
    ctx.lineTo(0.26 * u, 0.16 * u);
    ctx.lineTo(0.30 * u, 0.5 * u);
  } else {
    // Rook — crenellated tower.
    ctx.moveTo(-0.28 * u, 0.5 * u);
    ctx.lineTo(-0.26 * u, 0.06 * u);
    ctx.lineTo(-0.34 * u, 0.0);
    ctx.lineTo(-0.34 * u, -0.44 * u);
    ctx.lineTo(-0.20 * u, -0.44 * u);
    ctx.lineTo(-0.20 * u, -0.32 * u);
    ctx.lineTo(-0.07 * u, -0.32 * u);
    ctx.lineTo(-0.07 * u, -0.44 * u);
    ctx.lineTo(0.07 * u, -0.44 * u);
    ctx.lineTo(0.07 * u, -0.32 * u);
    ctx.lineTo(0.20 * u, -0.32 * u);
    ctx.lineTo(0.20 * u, -0.44 * u);
    ctx.lineTo(0.34 * u, -0.44 * u);
    ctx.lineTo(0.34 * u, 0.0);
    ctx.lineTo(0.26 * u, 0.06 * u);
    ctx.lineTo(0.28 * u, 0.5 * u);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, u * 0.055);
  ctx.strokeStyle = '#fff';
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Base plinth.
  ctx.beginPath();
  ctx.ellipse(0, 0.46 * u, 0.34 * u, 0.11 * u, 0, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = Math.max(1, u * 0.04);
  ctx.strokeStyle = '#fff';
  ctx.stroke();

  // Player 2's diamond emblem — form, not colour alone.
  if (seat === 2) {
    const d = 0.13 * u;
    ctx.beginPath();
    ctx.moveTo(0, 0.14 * u - d);
    ctx.lineTo(d, 0.14 * u);
    ctx.lineTo(0, 0.14 * u + d);
    ctx.lineTo(-d, 0.14 * u);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.fill();
  }

  // Seat number on the base.
  ctx.font = `800 ${Math.max(6, Math.round(u * 0.24))}px 'Space Grotesk', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.fillText(String(seat), 0, 0.45 * u);
  ctx.restore();
}

/* Medal chip stamped over a pawn that has already finished. Placement is the
   whole point of the multi-finisher match, so it has to be legible on the
   board itself, not only in the standings strip. Gold / silver / bronze for
   the podium, then a plain numbered disc. */
function cnlv2DrawPlaceChip(ctx, x, y, cs, place) {
  const r = Math.max(6, cs * 0.26);
  // Medal metals are intrinsic art (like the pawns themselves), so they stay
  // hardcoded; only the also-ran disc follows the theme.
  const fill = place === 1 ? '#D4AF37' : place === 2 ? '#B9BCC4'
    : place === 3 ? '#B87333' : palOf('card', '#FFFFFF');
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.16);
  ctx.strokeStyle = place <= 3 ? '#3A2E12' : palOf('border', '#DDD');
  ctx.stroke();
  ctx.fillStyle = place <= 3 ? '#231A05' : palOf('text', '#1A1A1A');
  ctx.font = `700 ${Math.round(r * 1.15)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(place), x, y + r * 0.05);
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
}
