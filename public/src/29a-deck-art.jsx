/* ============================================================
   Deck art — the picture on every lobby card
   ============================================================
   Each card shows a small scene of its own board: a sudoku grid, a snake on
   its checkerboard, a tableau of solitaire. A scene is DATA, not an image: a
   list of absolutely positioned "bits" laid out on a 150 x 100 grid, which
   `DeckArt` renders as spans inside a container-query box, so one scene draws
   crisply at every size a card is shown at (the row, the shelf, the opened
   card's banner) and costs no network request.

   The scene is cover-cropped into a square on the card, so whatever matters
   sits in the middle two thirds (x 25..125). Several scenes were recomposed for
   that crop; keep it in mind when touching one.

   Intrinsic game art, like the boards themselves: these colours are fixed and
   do not follow the light/dark theme (see "Intrinsic game art stays hardcoded").
   Everything lives inside one IIFE because the frontend is one concatenated
   script with one global scope — `bit`, `grid` and `line` would otherwise be
   globals every other file could collide with.
   ============================================================ */
const DECK_ART = (() => {
  const F = { sans: "'Plus Jakarta Sans',system-ui,sans-serif", serif: "'DM Serif Display',Georgia,serif", sym: "system-ui,'Segoe UI Symbol','Apple Symbols',sans-serif" };
  const q = (n) => Math.round(n * 100) / 100;
  const bit = (x, y, w, h, bg, o) => {
    o = o || {};
    return {
      l: q(x / 1.5), t: q(y), w: q(w / 1.5), h: q(h), bg: bg || 'transparent',
      r: o.r === undefined ? '0' : (typeof o.r === 'number' ? q(o.r / 1.5) + 'cqw' : o.r),
      tx: o.t === undefined ? '' : String(o.t), c: o.c || '#fff', fs: q((o.fs || 0) / 1.5),
      fw: o.fw || 700, ff: F[o.ff || 'sans'], rot: o.rot || 0, sh: o.sh || 'none',
      op: o.op === undefined ? 1 : o.op, cp: o.cp || 'none',
    };
  };
  const dot = (cx, cy, d, bg, o) => bit(cx - d / 2, cy - d / 2, d, d, bg, Object.assign({ r: '50%' }, o));
  const line = (x1, y1, x2, y2, th, bg, o) => {
    const L = Math.hypot(x2 - x1, y2 - y1), a = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
    return bit((x1 + x2) / 2 - L / 2, (y1 + y2) / 2 - th / 2, L, th, bg, Object.assign({ r: th / 2, rot: q(a) }, o));
  };
  const ball = (c1, c2) => 'radial-gradient(circle at 35% 30%, ' + c1 + ', ' + c2 + ')';
  const SH = '0 0.6cqw 1.4cqw rgba(0,0,0,0.3)';
  const BOLT = 'polygon(55% 0, 10% 55%, 45% 55%, 30% 100%, 90% 40%, 55% 40%, 75% 0)';
  const grid = (c, r, line, bgc) => 'linear-gradient(90deg, ' + line + ' 0.3cqw, transparent 0.3cqw) 0 0 / ' + c + ', linear-gradient(' + line + ' 0.3cqw, transparent 0.3cqw) 0 0 / ' + r + ', ' + bgc;

  const ART = {
    sudoku() {
      const s = 13, x0 = 16.5, y0 = -8, N = 117;
      const b = [bit(x0, y0, N, N, '#fff', { sh: '0 1cqw 3cqw rgba(20,40,80,0.25)' }), bit(x0, y0 + 4 * s, N, s, '#E8F0FC'), bit(x0 + 3 * s, y0, s, N, '#E8F0FC'), bit(x0 + 3 * s, y0 + 4 * s, s, s, '#C3D7F7')];
      for (let i = 0; i <= 9; i++) {
        const th = i % 3 === 0 ? 1.1 : 0.4, col = i % 3 === 0 ? '#2E3A52' : '#C9D2DF';
        b.push(bit(x0 + i * s - th / 2, y0, th, N, col), bit(x0, y0 + i * s - th / 2, N, th, col));
      }
      ['534678912', '672195348', '198342567', '859761423', '426853791', '713924856', '961537284', '287419635', '345286179'].forEach((row, r) => row.split('').forEach((d, c) => {
        const given = (r * 7 + c * 3) % 5 < 2, mine = !given && (r + c * 2) % 7 === 0;
        if (given || mine) b.push(bit(x0 + c * s, y0 + r * s, s, s, '', { t: d, c: given ? '#1F2B47' : '#2F6FDB', fs: 8, fw: given ? 700 : 600 }));
      }));
      return { bg: '#DCE7F5', bits: b };
    },
    sudokumini() {
      const s = 15, x0 = 30, y0 = 5, N = 90;
      const b = [bit(x0, y0, N, N, '#fff', { sh: '0 1cqw 3cqw rgba(10,60,55,0.22)' }), bit(x0 + 4 * s, y0 + 2 * s, s, s, '#BFE6DF')];
      for (let i = 0; i <= 6; i++) {
        const tv = i % 3 === 0, th = i % 2 === 0;
        b.push(bit(x0 + i * s - (tv ? 0.55 : 0.2), y0, tv ? 1.1 : 0.4, N, tv ? '#24433F' : '#C8DAD6'));
        b.push(bit(x0, y0 + i * s - (th ? 0.55 : 0.2), N, th ? 1.1 : 0.4, th ? '#24433F' : '#C8DAD6'));
      }
      ['123456', '456123', '231564', '564231', '312645', '645312'].forEach((row, r) => row.split('').forEach((d, c) => {
        const k = (r * 5 + c * 2) % 3;
        if (k !== 1) b.push(bit(x0 + c * s, y0 + r * s, s, s, '', { t: d, c: k === 0 ? '#1F2B47' : '#14857A', fs: 9 }));
      }));
      return { bg: '#D9EFEB', bits: b };
    },
    wordhunt() {
      const s = 15, x0 = 7.5, y0 = 5;
      const b = [
        bit(x0 + 2 * s + 1, y0 + 1.5, 6 * s - 2, s - 3, 'rgba(61,135,201,0.30)', { r: 6 }),
        bit(x0 + 2 * s + 1, y0 + s + 1.5, 6 * s - 2, s - 3, 'rgba(123,92,214,0.32)', { r: 6 }),
        bit(x0 + 1.5, y0 + 2 * s + 1, s - 3, 4 * s - 2, 'rgba(228,96,78,0.30)', { r: 6 }),
      ];
      ['HTSEARCHO', 'XRPUZZLEM', 'GBNTIWQDK', 'AFOLVYJUS', 'MCDEPZRWN', 'EKYHUTAGL'].forEach((row, r) => row.split('').forEach((ch, c) => b.push(bit(x0 + c * s, y0 + r * s, s, s, '', { t: ch, c: '#2D2550', fs: 8.5, fw: 800 }))));
      return { bg: '#F1ECFB', bits: b };
    },
    cryptowordle() {
      const s = 15, g = 3, x0 = 31.5, y0 = 6.5, C = { g: '#3E9B5F', y: '#C9A227', x: '#4A5560' };
      const b = [];
      [['CHAIN', 'yxxxx'], ['TOKEN', 'xyyxx'], ['CLOCK', 'xgggg'], ['BLOCK', 'ggggg'], ['', '']].forEach(([w, k], r) => {
        for (let c = 0; c < 5; c++) {
          const x = x0 + c * (s + g), y = y0 + r * (s + g);
          b.push(w ? bit(x, y, s, s, C[k[c]], { r: 1.5, t: w[c], fs: 9, fw: 800 }) : bit(x, y, s, s, '', { r: 1.5, sh: 'inset 0 0 0 0.45cqw #3B4A55' }));
        }
      });
      return { bg: '#1E2A33', bits: b };
    },
    minefinder() {
      const s = 15, NC = { 1: '#1976D2', 2: '#388E3C', 3: '#D32F2F' }, b = [];
      ['....1221..', '...1000F1.', '..1100001.', '..1000001.', '.F2100012.', '...11111..', '....F.....'].forEach((row, r) => row.split('').forEach((ch, c) => {
        const x = c * s, y = r * s;
        if (ch === 'F') b.push(bit(x + 5.5, y + 3, 1.2, 9.5, '#4E342E'), bit(x + 6.5, y + 3, 6.5, 5.5, '#F23607', { cp: 'polygon(0 0, 100% 50%, 0 100%)' }), bit(x + 3.5, y + 11.5, 6, 1.6, '#4E342E', { r: 0.8 }));
        else if (ch !== '.') b.push(bit(x, y, s, s, (r + c) % 2 ? '#D7B899' : '#E5C29F', { t: ch === '0' ? '' : ch, c: NC[ch] || '#333', fs: 9, fw: 800 }));
      }));
      return { bg: 'repeating-conic-gradient(#AAD751 0 25%, #A2D149 0 50%) 0 0 / 20% 30%', bits: b };
    },
    mancala() {
      const pit = 'radial-gradient(circle at 50% 35%, #4A2A10, #6B3F1C)', ish = 'inset 0 0.8cqw 1.4cqw rgba(0,0,0,0.5)';
      const stones = ['#EEF2F5', '#7FB3D5', '#F5B7B1', '#A3E4D7', '#F9E79F', '#D7BDE2'], off = [[-2.6, -2], [2.4, -1.4], [-0.6, 2.6], [2.8, 2.6]];
      const b = [bit(6, 20, 138, 60, 'linear-gradient(180deg,#A26A38,#7A4A22)', { r: 30, sh: '0 1.2cqw 2.6cqw rgba(0,0,0,0.35), inset 0 0.5cqw 0 rgba(255,255,255,0.18)' }), bit(12, 27, 19, 46, pit, { r: 9.5, sh: ish }), bit(119, 27, 19, 46, pit, { r: 9.5, sh: ish })];
      for (let r = 0; r < 2; r++) for (let c = 0; c < 6; c++) {
        const cx = 42 + c * 13.2, cy = r ? 61 : 39, n = 1 + ((r * 6 + c) * 5) % 4;
        b.push(dot(cx, cy, 11.5, pit, { sh: ish }));
        for (let k = 0; k < n; k++) b.push(dot(cx + off[k][0], cy + off[k][1], 3.6, stones[(r * 6 + c + k) % 6]));
      }
      [[18, 40], [24, 46], [19, 55], [25, 60], [21, 64]].forEach(([x, y], i) => b.push(dot(x, y, 3.6, stones[i])));
      [[125, 38], [130, 47], [126, 58]].forEach(([x, y], i) => b.push(dot(x, y, 3.6, stones[i + 2])));
      return { bg: '#EFE3CC', bits: b };
    },
    'chutes-ladders'() {
      const s = 25, cols = ['#FCE7A8', '#F7B7A3', '#A8DADC', '#C7E9B0'], b = [];
      for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
        const row = 3 - r, n = row % 2 === 0 ? row * 6 + c + 1 : row * 6 + (6 - c);
        b.push(bit(c * s, r * s, s, s, cols[(r + c) % 4]), bit(c * s + 1.5, r * s + 1.5, 9, 7, '', { t: n, c: '#5A4A3A', fs: 5.5, fw: 800 }));
      }
      const L = (x1, y1, x2, y2) => line(x1, y1, x2, y2, 2.2, '#8B5A2B');
      b.push(L(28, 92, 56, 22), L(38, 96, 66, 26));
      for (let k = 1; k < 6; k++) { const t = k / 6; b.push(L(28 + 28 * t, 92 - 70 * t, 38 + 28 * t, 96 - 70 * t)); }
      for (let k = 12; k >= 1; k--) { const t = k / 12; b.push(dot(96 + 30 * t + 7 * Math.sin(t * Math.PI * 3), 16 + 68 * t, 8.5 - 3.5 * t, k % 2 ? '#2E9E5B' : '#3DB56B')); }
      b.push(dot(96, 16, 11, '#2E9E5B'), dot(93.5, 14.5, 2.4, '#fff'), dot(98.5, 14.5, 2.4, '#fff'), dot(93.5, 14.8, 1.1, '#111'), dot(98.5, 14.8, 1.1, '#111'));
      return { bg: '#FCE7A8', bits: b };
    },
    '2048'() {
      const T = { 0: '#CDC1B4', 2: '#EEE4DA', 4: '#EDE0C8', 8: '#F2B179', 16: '#F59563', 32: '#F67C5F', 64: '#F65E3B', 128: '#EDCF72', 256: '#EDCC61', 512: '#EDC850', 2048: '#EDC22E' };
      const b = [bit(27.5, 2.5, 95, 95, '#BBADA0', { r: 4, sh: SH })];
      [[2, 4, 8, 16], [0, 32, 64, 2], [4, 128, 256, 0], [2, 512, 2048, 4]].forEach((row, r) => row.forEach((n, c) => {
        const len = String(n).length;
        b.push(bit(30.5 + c * 23, 5.5 + r * 23, 20, 20, T[n], { r: 2.5, t: n || '', c: n <= 4 ? '#776E65' : '#F9F6F2', fs: len >= 4 ? 6 : len === 3 ? 7.5 : 9.5, fw: 800, sh: n >= 128 ? '0 0 2cqw rgba(237,194,46,0.45)' : 'none' }));
      }));
      return { bg: '#FAF8EF', bits: b };
    },
    'knights-tour'() {
      const s = 150 / 9, b = [], path = [[0, 5], [1, 3], [2, 1], [4, 0], [6, 1], [7, 3], [5, 4]];
      path.forEach(([c, r], i) => {
        const last = i === path.length - 1;
        b.push(bit(c * s, r * s, s, s, last ? 'rgba(246,246,105,0.8)' : 'rgba(31,43,71,0.55)', { t: last ? '' : i + 1, c: '#F3EBD8', fs: 8, fw: 800 }));
      });
      [[3, 3], [3, 5], [4, 2], [6, 2], [7, 5]].forEach(([c, r]) => b.push(dot(c * s + s / 2, r * s + s / 2, 5, 'rgba(0,0,0,0.22)')));
      b.push(bit(5 * s, 4 * s - 1, s, s, '', { t: '♞', c: '#1C1A17', fs: 15, ff: 'sym', fw: 400 }));
      return { bg: 'repeating-conic-gradient(#B58863 0 25%, #F0D9B5 0 50%) 0 0 / 22.222% 33.333%', bits: b };
    },
    snake() {
      const s = 12.5, b = [], body = [[2, 5], [3, 5], [4, 5], [5, 5], [5, 4], [5, 3], [6, 3], [7, 3], [8, 3]];
      for (let i = 1; i < body.length; i++) {
        const [c1, r1] = body[i - 1], [c2, r2] = body[i], hz = c1 !== c2;
        b.push(bit(Math.min(c1, c2) * s + (hz ? s / 2 : 0.8), Math.min(r1, r2) * s + (hz ? 0.8 : s / 2), hz ? s : s - 1.6, hz ? s - 1.6 : s, '#4E7CF6'));
      }
      body.forEach(([c, r], i) => b.push(bit(c * s + 0.8, r * s + 0.8, s - 1.6, s - 1.6, i === body.length - 1 ? '#3F6AE0' : '#4E7CF6', { r: 3.5 })));
      b.push(dot(8 * s + 8.5, 3 * s + 4, 3.4, '#fff'), dot(8 * s + 8.5, 3 * s + 8.5, 3.4, '#fff'), dot(8 * s + 9.2, 3 * s + 4, 1.6, '#111'), dot(8 * s + 9.2, 3 * s + 8.5, 1.6, '#111'));
      b.push(dot(9.5 * s, 3.5 * s + 0.5, 9, ball('#FF8A65', '#E53935')), bit(9 * s + 6.5, 3 * s + 0.8, 3.2, 2.2, '#2E7D32', { r: '50%', rot: -30 }));
      return { bg: 'repeating-conic-gradient(#AAD751 0 25%, #A2D149 0 50%) 0 0 / 16.667% 25%', bits: b };
    },
    blockblast() {
      const s = 11, x0 = 31, y0 = 6, CC = { r: '#F25F5C', y: '#FFD23F', g: '#3BCEAC', b: '#3A86FF', p: '#9B5DE5', o: '#FF8C42' };
      const bev = 'inset 0 -0.8cqw 0 rgba(0,0,0,0.25), inset 0 0.6cqw 0 rgba(255,255,255,0.35)';
      const b = [bit(x0 - 2, y0 - 2, 92, 92, grid('7.333cqw 7.333cqw', '7.333cqw 7.333cqw', 'rgba(255,255,255,0.07)', '#121A36'), { r: 3, sh: SH })];
      ['........', '.....bb.', '.....b..', 'pp......', 'pp..yyy.', 'g..oyrr.', 'gggo.rrb', 'ggoo.bbb'].forEach((row, r) => row.split('').forEach((k, c) => { if (k !== '.') b.push(bit(x0 + c * s + 0.6, y0 + r * s + 0.6, s - 1.2, s - 1.2, CC[k], { r: 1.6, sh: bev })); }));
      [[0, 0], [1, 0], [2, 0], [2, 1]].forEach(([c, r]) => b.push(bit(124 + c * 7.5, 30 + r * 7.5, 7, 7, CC.o, { r: 1.2, sh: bev })));
      return { bg: 'linear-gradient(160deg,#2C3F7C,#1A2550)', bits: b };
    },
    diamondrush() {
      const G = ['linear-gradient(135deg,#FF8A80,#C62828)', 'linear-gradient(135deg,#82B1FF,#1E50E0)', 'linear-gradient(135deg,#B9F6CA,#00A844)', 'linear-gradient(135deg,#FFF59D,#F9A800)', 'linear-gradient(135deg,#EA80FC,#9C00E6)'];
      const b = [];
      for (let r = 0; r < 5; r++) for (let c = 0; c < 8; c++) {
        const hot = r === 2 && c >= 3 && c <= 5, k = hot ? 3 : (r * 3 + c * 2 + (r * c) % 3) % 5;
        b.push(bit(c * 18.75 + 4, r * 20 + 4.5, 11, 11, G[k], { rot: 45, r: 1.5, sh: hot ? '0 0 2.4cqw rgba(255,240,170,0.95)' : 'inset 0.6cqw 0.6cqw 0 rgba(255,255,255,0.35), 0 0.6cqw 1cqw rgba(0,0,0,0.35)' }));
      }
      return { bg: 'radial-gradient(circle at 50% 30%, #4A2C7A, #1F1038)', bits: b };
    },
    tilematching() {
      const S = [['●', '#E4604E'], ['▲', '#3D87C9'], ['■', '#71A122'], ['◆', '#7B5CD6'], ['★', '#D97E23']];
      const tile = (x, y, k, o) => bit(x, y, 17, 21, '#FFF8E7', Object.assign({ r: 2.5, sh: '0 1.1cqw 0 #CDB88E, 0 1.6cqw 1.6cqw rgba(0,0,0,0.25)', t: S[k][0], c: S[k][1], fs: 11, ff: 'sym', fw: 400 }, o || {}));
      const b = [];
      [14, 33, 52, 71, 90, 109].forEach((x, i) => b.push(tile(x, 30, i % 5)));
      [24, 43, 62, 81, 100].forEach((x, i) => b.push(tile(x, 18, (i + 2) % 5)));
      [52, 71].forEach((x, i) => b.push(tile(x, 6, (i + 4) % 5)));
      b.push(bit(14, 68, 122, 27, 'rgba(70,40,110,0.28)', { r: 5, sh: 'inset 0 0.6cqw 1.2cqw rgba(0,0,0,0.2)' }));
      [0, 1, 2].forEach((i) => b.push(tile(18 + i * 17.5, 71, 4)));
      b.push(tile(70.5, 71, 0));
      return { bg: 'linear-gradient(180deg,#E9DEFA,#CDB9F2)', bits: b };
    },
    bounce() {
      const cols = ['#E4604E', '#F28C38', '#F2C94C', '#6FCF97', '#56CCF2'], b = [];
      for (let r = 0; r < 5; r++) for (let c = 0; c < 8; c++) {
        if ((r === 4 && (c === 2 || c === 3 || c === 6)) || (r === 3 && c === 3)) continue;
        b.push(bit(4.5 + c * 17.8, 8 + r * 8, 16.3, 6.5, cols[r], { r: 1.2, sh: 'inset 0 -0.6cqw 0 rgba(0,0,0,0.22), inset 0 0.5cqw 0 rgba(255,255,255,0.3)' }));
      }
      b.push(dot(78, 66, 4, 'rgba(255,255,255,0.18)'), dot(83, 60, 4.5, 'rgba(255,255,255,0.35)'), dot(88, 54, 5.5, '#fff', { sh: '0 0 2cqw rgba(255,255,255,0.8)' }));
      b.push(bit(56, 88, 34, 4.5, 'linear-gradient(180deg,#F3EBD8,#C9BFA8)', { r: 2.25, sh: '0 0 2cqw rgba(86,204,242,0.5)' }));
      return { bg: 'linear-gradient(180deg,#16244A,#0B1328)', bits: b };
    },
    zuma() {
      const cols = [['#FF8A80', '#D32F2F'], ['#82B1FF', '#1565C0'], ['#FFF59D', '#F9A825'], ['#B9F6CA', '#2E7D32']];
      const b = [bit(14, 18, 122, 72, '', { r: '50%', sh: 'inset 0 0 0 4cqw rgba(120,80,30,0.16)' })];
      const at = (i) => { const a = (200 + i * 15) * Math.PI / 180; return [75 + 56 * Math.cos(a), 54 + 33 * Math.sin(a)]; };
      const end = at(20);
      b.push(dot(end[0], end[1], 13, 'radial-gradient(circle, #1B1208 40%, #5A3A18)'));
      [0, 0, 1, 1, 1, 2, 3, 3, 0, 2, 2, 1, 3, 3, 3, 0, 1, 2, 2, 0].forEach((k, i) => { const [x, y] = at(i); b.push(dot(x, y, 11, ball(cols[k][0], cols[k][1]), { sh: '0 0.5cqw 0.8cqw rgba(0,0,0,0.3)' })); });
      b.push(dot(75, 54, 26, ball('#7BD389', '#2E7D32'), { sh: '0 1cqw 2cqw rgba(0,0,0,0.35)' }), dot(75, 46, 10, ball('#FFF59D', '#F9A825')), dot(70, 57, 4, '#fff'), dot(80, 57, 4, '#fff'), dot(70.5, 57.5, 2, '#111'), dot(80.5, 57.5, 2, '#111'));
      return { bg: 'radial-gradient(circle at 50% 55%, #F6DFAE, #D9A85B)', bits: b };
    },
    match3() {
      const C = [['#FF7B7B', '#E01E37'], ['#FFC56E', '#FF7F11'], ['#FFF07C', '#F4C400'], ['#8CF08C', '#1FAA35'], ['#8FC2FF', '#2A6FF0'], ['#D8A6FF', '#8A3FE0']];
      const b = [bit(4, 2, 142, 96, 'rgba(255,255,255,0.35)', { r: 6 })];
      for (let r = 0; r < 5; r++) for (let c = 0; c < 7; c++) {
        const k = (r * 4 + c * 3 + ((r + c) % 2) * 2) % 6, cx = 15 + c * 20, cy = 12 + r * 19, shape = k % 3;
        const bg = 'radial-gradient(circle at 35% 30%, #ffffffcc 0 12%, ' + C[k][0] + ' 30%, ' + C[k][1] + ')';
        if (shape === 0) b.push(dot(cx, cy, 15, bg, { sh: SH }));
        else if (shape === 1) b.push(bit(cx - 7.5, cy - 7.5, 15, 15, bg, { r: 4, sh: SH }));
        else b.push(bit(cx - 8.5, cy - 5.5, 17, 11, bg, { r: 5.5, sh: SH }));
      }
      return { bg: 'linear-gradient(180deg,#FFD6E7,#F29CC1)', bits: b };
    },
    hashrush() {
      const blk = (x, y, s, bg, t, rot, o) => bit(x, y, s, s, bg, Object.assign({ r: 3, t, fs: s * 0.5, fw: 800, rot, sh: 'inset 0 -0.8cqw 0 rgba(0,0,0,0.25), 0 1cqw 2cqw rgba(0,0,0,0.35)' }, o || {}));
      const b = [];
      [[22, 0, 30], [58, 18, 22], [98, 4, 26], [126, 40, 18], [36, 46, 20]].forEach(([x, y, l]) => b.push(bit(x + 7, y - l, 1.2, l, 'linear-gradient(180deg, transparent, rgba(94,234,212,0.5))')));
      b.push(blk(22, 0, 16, '#1D9E8F', '#', -8), blk(58, 18, 14, '#B14A82', '#', 6), blk(98, 4, 18, '#1D9E8F', '#', 4), blk(126, 40, 13, '#3D87C9', '#', -10), blk(36, 46, 15, '#B14A82', '#', 12));
      b.push(blk(80, 56, 20, '#D62828', 'TNT', -6, { fs: 6.5 }), blk(110, 70, 17, '#FFD23F', '', 8), bit(114, 72.5, 9, 12, '#7A4B00', { cp: BOLT, rot: 8 }));
      b.push(bit(0, 90, 150, 10, 'linear-gradient(180deg, transparent, rgba(29,158,143,0.35))'));
      return { bg: 'linear-gradient(180deg,#0E1C2B,#16344D)', bits: b };
    },
    jetrun() {
      const b = [];
      const cloud = (x, y, k, col) => [bit(x - 2 * k, y - 1 * k, 28 * k, 8 * k, col, { r: 4 * k }), dot(x, y, 14 * k, col), dot(x + 9 * k, y - 4 * k, 18 * k, col), dot(x + 20 * k, y, 14 * k, col)];
      cloud(10, 22, 1, 'rgba(255,255,255,0.9)').concat(cloud(64, 84, 0.8, 'rgba(255,255,255,0.85)'), cloud(112, 70, 1.1, '#6B7385')).forEach((x) => b.push(x));
      b.push(bit(114, 78, 7, 12, '#FFD23F', { cp: BOLT }));
      b.push(bit(96, -2, 11, 34, 'linear-gradient(90deg,#F28C38,#D96A12)', { r: 2, sh: SH }), bit(94, 28, 15, 5, '#B85410', { r: 1.5 }));
      b.push(bit(96, 62, 11, 40, 'linear-gradient(90deg,#F28C38,#D96A12)', { r: 2, sh: SH }), bit(94, 60, 15, 5, '#B85410', { r: 1.5 }));
      b.push(bit(108, 38, 14, 14, '', { t: '★', c: '#FFD23F', fs: 14, ff: 'sym', fw: 400 }));
      b.push(line(6, 52, 36, 50, 1.2, 'rgba(255,255,255,0.7)'), line(10, 58, 36, 55, 1, 'rgba(255,255,255,0.5)'));
      b.push(bit(34, 40, 34, 20, 'linear-gradient(180deg,#F5F7FA,#C9D3DE)', { cp: 'polygon(100% 50%, 72% 38%, 54% 0, 45% 0, 50% 36%, 14% 38%, 6% 16%, 0 16%, 3% 50%, 0 84%, 6% 84%, 14% 62%, 50% 64%, 45% 100%, 54% 100%, 72% 62%)', rot: -6 }));
      b.push(bit(54, 46, 6, 3.5, '#3D87C9', { r: 1.5, rot: -6 }));
      return { bg: 'linear-gradient(180deg,#4FA8EE,#BFE4FB)', bits: b };
    },
    checkers() {
      const s = 150 / 9, b = [], red = ball('#FF6B6B', '#C1121F'), blk = ball('#5A5A5A', '#151515');
      [[0, 0, 'r'], [2, 0, 'r'], [6, 0, 'r'], [1, 1, 'r'], [5, 1, 'r'], [7, 1, 'r'], [4, 2, 'r'], [3, 3, 'k'], [0, 4, 'b'], [2, 4, 'b'], [6, 4, 'b'], [8, 4, 'b'], [1, 5, 'b'], [5, 5, 'b'], [7, 5, 'b']].forEach(([c, r, t]) => {
        const cx = c * s + s / 2, cy = r * s + s / 2;
        b.push(dot(cx, cy, 13, t === 'b' ? blk : red, { sh: 'inset 0 0 0 1.1cqw rgba(0,0,0,0.18), 0 0.7cqw 0 rgba(0,0,0,0.4)' }));
        if (t === 'k') b.push(dot(cx, cy, 7, '', { sh: 'inset 0 0 0 0.6cqw #FFD23F' }));
      });
      b.push(dot(5.5 * s, 3.5 * s, 6, 'rgba(255,255,255,0.35)'));
      return { bg: 'repeating-conic-gradient(#F3D6B2 0 25%, #8B5A2B 0 50%) 0 0 / 22.222% 33.333%', bits: b };
    },
    reversi() {
      const s = 150 / 9, b = [], W = ball('#FFFFFF', '#CFCFCF'), K = ball('#5A5A5A', '#0E0E0E');
      ['.........', '...wb....', '..bbbw...', '...wwbb..', '..wbw....', '....b....'].forEach((row, r) => row.split('').forEach((ch, c) => { if (ch !== '.') b.push(dot(c * s + s / 2, r * s + s / 2, 13.5, ch === 'w' ? W : K, { sh: '0 0.6cqw 0.8cqw rgba(0,0,0,0.4)' })); }));
      [[5, 1], [6, 2], [1, 4]].forEach(([c, r]) => b.push(dot(c * s + s / 2, r * s + s / 2, 4, 'rgba(0,0,0,0.28)')));
      return { bg: grid('11.111% 16.667%', '11.111% 16.667%', 'rgba(0,0,0,0.35)', '#1E8050'), bits: b };
    },
    fourinarow() {
      const b = [bit(18, 3, 114, 100, 'linear-gradient(180deg,#2F6BE8,#1E4FC2)', { r: 5, sh: SH })];
      const R = ball('#FF6B6B', '#D62828'), Y = ball('#FFE066', '#F0A500'), who = ['ryryr', 'yryry', 'rry', 'yyrry', 'r', '', 'yr'];
      for (let c = 0; c < 7; c++) for (let r = 0; r < 6; r++) {
        const k = who[c][5 - r];
        b.push(dot(26 + c * 16, 11 + r * 16, 12, k ? (k === 'r' ? R : Y) : '#E9F0FB', { sh: k ? '0 0 0 0.3cqw rgba(0,0,0,0.15)' : 'inset 0 0.6cqw 0.8cqw rgba(0,0,0,0.35)' }));
      }
      return { bg: '#E9F0FB', bits: b };
    },
    gomoku() {
      const b = [], at = (i, j) => [6 + 12 * i, 6 + 12 * j], B = ball('#666', '#0D0D0D'), Wt = ball('#FFFFFF', '#D6D6D6'), sh = '0 0.5cqw 0.8cqw rgba(0,0,0,0.35)';
      [[4, 2], [6, 4], [5, 3], [7, 3], [9, 4], [6, 6], [3, 4]].forEach(([i, j]) => { const [x, y] = at(i, j); b.push(dot(x, y, 10, Wt, { sh })); });
      [[3, 2], [4, 3], [5, 4], [6, 5], [7, 6], [8, 2], [5, 2]].forEach(([i, j], n) => { const [x, y] = at(i, j); b.push(dot(x, y, 10, B, { sh: n < 5 ? '0 0 0 0.5cqw #FFD23F, ' + sh : sh })); });
      return { bg: 'linear-gradient(90deg, rgba(70,40,10,0.55) 0.3cqw, transparent 0.3cqw) 3.85cqw 0 / 8cqw 8cqw, linear-gradient(rgba(70,40,10,0.55) 0.3cqw, transparent 0.3cqw) 0 3.85cqw / 8cqw 8cqw, linear-gradient(135deg,#E8BF77,#D6A456)', bits: b };
    },
    ludo() {
      const tok = '0 0 0 0.7cqw #fff, 0 0.4cqw 0.9cqw rgba(0,0,0,0.35)';
      const b = [bit(25, 0, 100, 100, grid('4.444cqw 4.444cqw', '4.444cqw 4.444cqw', 'rgba(0,0,0,0.12)', '#FFFFFF'), { sh: SH })];
      [['#E53935', 25, 0], ['#43A047', 85, 0], ['#FDD835', 85, 60], ['#1E88E5', 25, 60]].forEach(([col, x, y]) => {
        b.push(bit(x, y, 40, 40, col), bit(x + 7, y + 7, 26, 26, '#FFFFFF', { r: 3 }));
        [[14, 14], [26, 14], [14, 26], [26, 26]].forEach(([dx, dy]) => b.push(dot(x + dx, y + dy, 7.5, col, { sh: tok })));
      });
      b.push(bit(71.67, 6.67, 6.67, 33.33, '#43A047'), bit(85, 46.67, 33.33, 6.67, '#FDD835'), bit(71.67, 60, 6.67, 33.33, '#1E88E5'), bit(31.67, 46.67, 33.33, 6.67, '#E53935'));
      b.push(bit(65, 40, 20, 20, 'conic-gradient(from 45deg, #FDD835 0 25%, #1E88E5 0 50%, #E53935 0 75%, #43A047 0)'), dot(98, 50, 6, '#E53935', { sh: tok }));
      return { bg: '#EFE6D2', bits: b };
    },
    klondike() {
      let out = [];
      const card = (x, y, lab, red, face) => face
        ? [bit(x, y, 22, 31, '#fff', { r: 2, sh: SH }), bit(x + 1.5, y + 1.5, 12, 7, '', { t: lab, c: red ? '#C62828' : '#1C1A17', fs: 6, fw: 800, ff: 'sym' })]
        : [bit(x, y, 22, 31, 'repeating-linear-gradient(45deg,#C0392B 0 0.8cqw,#A93226 0.8cqw 1.6cqw)', { r: 2, sh: 'inset 0 0 0 0.8cqw #fff, ' + SH })];
      const cols = [[['K♠', 0, 1], ['Q♦', 1, 1], ['J♣', 0, 1]], [['', 0, 0], ['10♥', 1, 1], ['9♠', 0, 1], ['8♦', 1, 1]], [['', 0, 0], ['', 0, 0], ['Q♥', 1, 1]], [['A♥', 1, 1]]];
      cols.forEach((col, i) => col.forEach(([lab, red, face], j) => { out = out.concat(card(28 + i * 24, 30 + j * 10, lab, red, face)); }));
      [['A♠', 0], ['2♥', 1]].forEach(([lab, red], i) => { out = out.concat(card(52 + i * 24, -14, lab, red, 1)); });
      cols.forEach((col, i) => { const last = col[col.length - 1]; out.push(bit(28 + i * 24, 30 + (col.length - 1) * 10 + 9, 22, 20, '', { t: last[0].slice(-1), c: last[1] ? '#C62828' : '#1C1A17', fs: 14, ff: 'sym', fw: 400 })); });
      return { bg: 'radial-gradient(ellipse at 50% 20%, #2F74B5, #163E66)', bits: out };
    },
    spider() {
      let out = [];
      const back = (x, y) => bit(x, y, 20, 28, 'repeating-linear-gradient(45deg,#3D5A99 0 0.8cqw,#33508A 0.8cqw 1.6cqw)', { r: 2, sh: 'inset 0 0 0 0.7cqw #fff, 0 0.4cqw 0.8cqw rgba(0,0,0,0.35)' });
      const face = (x, y, lab) => [bit(x, y, 20, 28, '#fff', { r: 2, sh: '0 0.4cqw 0.8cqw rgba(0,0,0,0.35)' }), bit(x + 1.2, y + 1.2, 11, 6.5, '', { t: lab, c: '#1C1A17', fs: 5.5, fw: 800, ff: 'sym' })];
      [[4, ['K♠', 'Q♠']], [5, ['9♠']], [3, ['J♠', '10♠', '9♠']], [5, ['6♠']], [4, ['Q♠', 'J♠']], [3, ['5♠', '4♠', '3♠']]].forEach(([n, faces], i) => {
        const x = 5 + i * 24.2;
        for (let k = 0; k < n; k++) out.push(back(x, 6 + k * 6));
        faces.forEach((lab, j) => { out = out.concat(face(x, 6 + n * 6 + j * 11, lab)); });
        out.push(bit(x, 6 + n * 6 + (faces.length - 1) * 11 + 9, 20, 17, '', { t: '♠', c: '#1C1A17', fs: 12, ff: 'sym', fw: 400 }));
      });
      return { bg: 'radial-gradient(ellipse at 50% 20%, #5B3F8C, #2A1B48)', bits: out };
    },
    mahjongsol() {
      const S = [['●', '#1F8A5B'], ['◆', '#C62828'], ['▲', '#1E5AA8'], ['★', '#B14A82'], ['■', '#1F8A5B']];
      const tile = (x, y, k) => bit(x, y, 16, 21, 'linear-gradient(160deg,#FFFDF5,#F1E6C8)', { r: 2.5, sh: '0.7cqw 1cqw 0 #BFA978, 1cqw 1.6cqw 1.6cqw rgba(0,0,0,0.4)', t: S[k][0], c: S[k][1], fs: 10, ff: 'sym', fw: 400 });
      const b = [];
      for (let i = 0; i < 5; i++) b.push(tile(30 + i * 18, 64, i % 5));
      for (let i = 0; i < 4; i++) b.push(tile(39 + i * 18, 46, (i + 2) % 5));
      for (let i = 0; i < 3; i++) b.push(tile(48 + i * 18, 28, (i + 1) % 5));
      b.push(tile(66, 10, 1));
      return { bg: 'radial-gradient(ellipse at 50% 40%, #93303C, #4A1119)', bits: b };
    },
    nonogram() {
      const pic = ['.##...##..', '####.####.', '#########.', '.#######..', '..#####...', '...###....', '....#.....'];
      const s = 8.4, x0 = 40, y0 = 24;
      const runs = (arr) => { const o = []; let n = 0; arr.forEach((v) => { if (v) n++; else if (n) { o.push(n); n = 0; } }); if (n) o.push(n); return o.length ? o.join(' ') : '0'; };
      const b = [bit(0, 0, 150, y0 - 1, '#ECE6D6'), bit(0, 0, x0 - 1, 100, '#ECE6D6'), bit(x0, y0, 10 * s, 7 * s + 4, grid('5.6cqw 5.6cqw', '5.6cqw 5.6cqw', '#CFC8B6', '#FFFFFF'))];
      pic.forEach((row, r) => {
        row.split('').forEach((ch, c) => {
          if (ch === '#') b.push(bit(x0 + c * s + 0.5, y0 + r * s + 0.5, s - 1, s - 1, '#2B2D42', { r: 0.8 }));
          else if ((r + c) % 4 === 1) b.push(bit(x0 + c * s, y0 + r * s, s, s, '', { t: '×', c: '#B8B09C', fs: 7, fw: 600 }));
        });
        b.push(bit(25, y0 + r * s, x0 - 27, s, '', { t: runs(row.split('').map((ch) => ch === '#')), c: '#3A3F55', fs: 5.5, fw: 800 }));
      });
      for (let c = 0; c < 10; c++) b.push(bit(x0 + c * s, 2, s, y0 - 5, '', { t: runs(pic.map((row) => row[c] === '#')), c: '#3A3F55', fs: 5.2, fw: 800 }));
      return { bg: '#F7F4EC', bits: b };
    },
    anagrams() {
      const T = (x, y, ch, o) => bit(x, y, 17, 19, 'linear-gradient(180deg,#FFF3DC,#F4D9A8)', Object.assign({ r: 2.5, t: ch, c: '#5A3A12', fs: 11, fw: 400, ff: 'serif', sh: '0 1cqw 0 #C9A06A, 0 1.6cqw 1.8cqw rgba(80,40,0,0.3)' }, o || {}));
      const b = [bit(17, 9, 116, 4, 'rgba(90,50,10,0.25)', { r: 2 }), bit(17, 9, 76, 4, '#FFF3DC', { r: 2 })];
      'SPR'.split('').forEach((ch, i) => b.push(T(22 + i * 18.5, 26, ch)));
      for (let i = 3; i < 6; i++) b.push(bit(22 + i * 18.5, 26, 17, 19, 'rgba(255,243,220,0.25)', { r: 2.5, sh: 'inset 0 0 0 0.4cqw rgba(255,243,220,0.6)' }));
      [['T', -8], ['I', 6], ['N', -4]].forEach(([ch, rot], i) => b.push(T(42 + i * 24, 64, ch, { rot })));
      return { bg: 'linear-gradient(160deg,#F6B26B,#D2711A)', bits: b };
    },
    cratepush() {
      const s = 18.75, b = [];
      const crate = (ch) => 'linear-gradient(45deg, transparent 44%, #8B5A2B 44% 56%, transparent 56%), linear-gradient(-45deg, transparent 44%, #8B5A2B 44% 56%, transparent 56%), ' + (ch === '*' ? '#9FD08C' : '#E0A866');
      ['########', '#..o..B#', '#.B#...#', '#..@.o.#', '##...*.#', '########'].forEach((row, r) => row.split('').forEach((ch, c) => {
        const x = c * s, y = r * s - 6;
        if (ch === '#') b.push(bit(x, y, s, s, 'linear-gradient(#5A2E17 0.3cqw, transparent 0.3cqw) 0 0 / 100% 50%, linear-gradient(90deg, #5A2E17 0.3cqw, transparent 0.3cqw) 6cqw 0 / 100% 100%, #9C5432', { sh: 'inset 0 -0.8cqw 0 rgba(0,0,0,0.25)' }));
        if (ch === 'o') b.push(dot(x + s / 2, y + s / 2, 7, '', { sh: 'inset 0 0 0 0.8cqw #E4604E' }));
        if (ch === 'B' || ch === '*') b.push(bit(x + 1.5, y + 1.5, s - 3, s - 3, crate(ch), { r: 1.5, sh: 'inset 0 0 0 0.8cqw #8B5A2B, 0 0.8cqw 1cqw rgba(0,0,0,0.3)' }));
        if (ch === '@') b.push(dot(x + s / 2, y + s / 2 + 2, 11, ball('#7FB6F0', '#2F6DB5')), dot(x + s / 2, y + s / 2 - 4, 7, '#F6D2A8'));
      }));
      return { bg: grid('12.5cqw 12.5cqw', '12.5cqw 12.5cqw', 'rgba(0,0,0,0.07)', '#CDBB9F'), bits: b };
    },
    dropstack() {
      const s = 7, x0 = 40, CC = { I: '#22D3EE', O: '#FACC15', T: '#A855F7', S: '#22C55E', Z: '#EF4444', J: '#3B82F6', L: '#F97316' };
      const bev = 'inset 0 -0.5cqw 0 rgba(0,0,0,0.3), inset 0 0.4cqw 0 rgba(255,255,255,0.35)';
      const b = [bit(x0 - 1, -2, 72, 104, 'linear-gradient(90deg, rgba(255,255,255,0.05) 0.2cqw, transparent 0.2cqw) 0.67cqw 0 / 4.667cqw 4.667cqw, #0B0F22', { sh: 'inset 0 0 0 0.5cqw rgba(255,255,255,0.12)' })];
      ['..........', '..........', '.......OO.', 'T....L.OOJ', 'TT...L.JJJ', 'TSS..LL.Z.', 'SSZZIIIIZZ', 'JJJZ.TTTLZ'].forEach((row, i) => row.split('').forEach((k, c) => { if (k !== '.') b.push(bit(x0 + c * s, 44 + i * s, s - 0.6, s - 0.6, CC[k], { r: 0.8, sh: bev })); }));
      [[3, 1], [4, 1], [5, 1], [4, 2]].forEach(([c, r]) => b.push(bit(x0 + c * s, 8 + r * s, s - 0.6, s - 0.6, CC.T, { r: 0.8, sh: bev + ', 0 0 1.4cqw rgba(168,85,247,0.6)' })));
      b.push(bit(118, 10, 26, 26, 'rgba(255,255,255,0.06)', { r: 3, sh: 'inset 0 0 0 0.3cqw rgba(255,255,255,0.15)' }));
      [[0, 0], [1, 0], [1, 1], [2, 1]].forEach(([c, r]) => b.push(bit(122 + c * 6, 17 + r * 6, 5.5, 5.5, CC.Z, { r: 0.8, sh: bev })));
      b.push(bit(118, 40, 26, 8, '', { t: 'NEXT', c: 'rgba(255,255,255,0.55)', fs: 4.6, fw: 800 }));
      return { bg: 'linear-gradient(180deg,#1C2147,#0E1226)', bits: b };
    },
    wordsprint() {
      const sel = { '0,0': 1, '1,1': 1, '1,2': 1, '2,3': 1 }, s = 20, g = 3, x0 = 33.5, y0 = 7.5;
      const cen = (r, c) => [x0 + c * (s + g) + s / 2, y0 + r * (s + g) + s / 2];
      const b = [bit(30, 4, 92, 92, 'linear-gradient(160deg,#245C93,#183F69)', { r: 6, sh: SH })];
      ['SXEL', 'OTAN', 'RMPR', 'DIGE'].forEach((row, r) => row.split('').forEach((ch, c) => b.push(bit(x0 + c * (s + g), y0 + r * (s + g), s, s, sel[r + ',' + c] ? 'linear-gradient(180deg,#FFE29A,#FFC94D)' : 'linear-gradient(180deg,#FFFDF6,#EFE6CF)', { r: 3, t: ch, c: '#1F2B47', fs: 11, fw: 800, sh: '0 0.8cqw 0 rgba(0,0,0,0.25)' }))));
      const p = [[0, 0], [1, 1], [1, 2], [2, 3]].map(([r, c]) => cen(r, c));
      for (let i = 1; i < p.length; i++) b.push(line(p[i - 1][0], p[i - 1][1], p[i][0], p[i][1], 1.8, 'rgba(228,96,78,0.6)'));
      b.push(bit(126, 8, 22, 10, 'rgba(0,0,0,0.25)', { r: 5, t: '1:23', fs: 5.5, fw: 800 }));
      return { bg: 'linear-gradient(160deg,#4C97D6,#2B6AA5)', bits: b };
    },
    dracula() {
      const sil = '#160C22';
      const b = [dot(112, 26, 30, 'radial-gradient(circle at 40% 40%, #FFF7DC, #EBCB7E)', { sh: '0 0 6cqw rgba(255,236,190,0.45)' })];
      [[40, 18, 9, 0], [52, 26, 7, 8], [30, 30, 6, -10]].forEach(([x, y, w, rot]) => b.push(bit(x, y, w * 1.6, w, sil, { cp: 'polygon(0 30%, 18% 0, 32% 38%, 50% 22%, 68% 38%, 82% 0, 100% 30%, 76% 62%, 50% 100%, 24% 62%)', rot })));
      b.push(bit(0, 82, 150, 18, sil));
      [[14, 52, 18, 30], [56, 36, 26, 46], [100, 56, 16, 26], [124, 66, 12, 16]].forEach(([x, y, w, h]) => b.push(bit(x, y, w, h + 20, sil), bit(x - 2, y - w * 0.9, w + 4, w * 0.9 + 0.5, sil, { cp: 'polygon(50% 0, 100% 100%, 0 100%)' })));
      b.push(bit(31, 70, 8, 12, sil), bit(82, 64, 18, 20, sil));
      [[20, 62], [64, 48], [72, 48], [68, 62], [106, 66]].forEach(([x, y]) => b.push(bit(x, y, 3, 4.5, '#F2C14E', { r: '1.5cqw 1.5cqw 0 0', sh: '0 0 1.5cqw rgba(242,193,78,0.8)' })));
      return { bg: 'linear-gradient(180deg,#24173A 0%,#4A2B5C 62%,#7E3E5E 100%)', bits: b };
    },
  };
  // Card key -> scene. Every card in GAME_CARDS needs one; the deck-coverage
  // self-test fails the build otherwise.
  const BY_CARD = {
    'card:dracula': 'dracula', 'card:sudoku': 'sudoku', 'card:sudokumini': 'sudokumini',
    'card:wordhunt': 'wordhunt', 'card:cryptowordle': 'cryptowordle', 'card:minefinder': 'minefinder',
    'card:mancala': 'mancala', 'card:chutes-ladders': 'chutes-ladders', 'card:2048': '2048',
    'card:knights-tour': 'knights-tour', 'card:snake': 'snake', 'card:blockblast': 'blockblast',
    'card:diamondrush': 'diamondrush', 'card:tilematch': 'tilematching', 'card:bounce': 'bounce',
    'card:zuma': 'zuma', 'card:match3': 'match3', 'card:hashrush': 'hashrush', 'card:jetrun': 'jetrun',
    'card:checkers': 'checkers', 'card:reversi': 'reversi', 'card:fourinarow': 'fourinarow',
    'card:gomoku': 'gomoku', 'card:ludo': 'ludo', 'card:klondike': 'klondike', 'card:spider': 'spider',
    'card:mahjongsol': 'mahjongsol', 'card:nonogram': 'nonogram', 'card:anagrams': 'anagrams',
    'card:cratepush': 'cratepush', 'card:dropstack': 'dropstack', 'card:wordsprint': 'wordsprint',
  };
  // Built on first use and kept: a scene is a few dozen small objects, and the
  // lobby asks for the same one from the row, the shelf and the open card.
  const cache = {};
  return {
    has: (cardKey) => !!(BY_CARD[cardKey] && ART[BY_CARD[cardKey]]),
    scene: (cardKey) => {
      if (!cache[cardKey]) {
        const make = ART[BY_CARD[cardKey]];
        cache[cardKey] = make ? make() : { bg: '#2A3A33', bits: [] };
      }
      return cache[cardKey];
    },
  };
})();

/* One scene, drawn. Memoised on the card key alone: the lobby re-renders every
   second (its countdowns tick), and a scene never changes, so without this the
   whole deck's few thousand spans would be diffed once a second for nothing. */
const DeckArt = React.memo(function DeckArt({ cardKey }) {
  const s = DECK_ART.scene(cardKey);
  return (
    <span className="fd-scene" style={{ background: s.bg }} aria-hidden="true">
      {s.bits.map((b, i) => (
        <span
          key={i}
          className="fd-bit"
          style={{
            left: b.l + '%', top: b.t + '%', width: b.w + '%', height: b.h + '%',
            background: b.bg, borderRadius: b.r, color: b.c,
            fontSize: b.fs ? b.fs + 'cqw' : undefined, fontWeight: b.fw, fontFamily: b.ff,
            transform: b.rot ? 'rotate(' + b.rot + 'deg)' : undefined,
            boxShadow: b.sh !== 'none' ? b.sh : undefined,
            opacity: b.op !== 1 ? b.op : undefined,
            clipPath: b.cp !== 'none' ? b.cp : undefined,
          }}
        >{b.tx}</span>
      ))}
    </span>
  );
});
