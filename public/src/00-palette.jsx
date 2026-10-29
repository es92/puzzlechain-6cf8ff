const { useState, useEffect, useRef } = React;

/* ============================================================
   Design system — color palette: the card table
   The app's own chrome is felt. The flip-deck lobby set the look (deep green
   felt, cream ink, brass for actions and wins, darker panels laid on it), and
   everything that stays the same from game to game wears it — the nav, a
   game's header, sheets, the pre-game and result cards. The things a game
   brings to the table — its board, pills and buttons — sit on the felt in the
   game's light or dark look (PALETTES.light / .dark below). The token names are the ones the stylesheet has always used,
   so every ${C.*} re-colours in place.
   ------------------------------------------------------------
   The palette is not baked into the stylesheet as hex: `PALETTES.felt` holds
   the raw values, `paletteVars()` emits them as CSS custom properties on
   :root, and `C` interpolates `var(--c-*)` references. Two escape hatches:
   - `ca('gold','1f')` for the hex-alpha idiom (`var()` can't be
     string-concatenated with an alpha byte), and
   - `PAL.*`, a plain object holding the same values, for the handful of
     <canvas> sites that need a real colour value.
   Felt is a DARK scheme: text is light, surfaces are dark, and a solid fill
   in any accent hue carries dark ink (`var(--c-accent-ink)`), never white.
   ============================================================ */
const PALETTES = {
  felt: {
    bg:      '#0F4A36', // the felt
    surface: '#0A3326', // deep felt — nav, sheets, the page under a card
    card:    '#0C3D2C', // a panel laid on the felt (the lobby's rgba(0,0,0,0.2) tiles)
    border:  '#2A5C4A', // hairline
    accent:  '#D9B35E', // brass — actions, links, the selected thing
    gold:    '#E8C677', // bright brass — streaks, wins, medals, live numbers
    emerald: '#7DD3A0', // mint (success, live states)
    violet:  '#B9A6F5',
    rose:    '#F48C78', // coral (errors, danger)
    text:    '#F3EBD8', // cream ink
    muted:   '#A8C3B4', // sage
    dim:     '#4D7A67', // faint text, dashed rules
  },
  /* A game's things — its board, pills and buttons — sit on the felt like a
     chess board and a clock on a table, in the game's look, which follows the
     device's light/dark setting (or the Game boards choice in Settings).
     These two are the light and dark themes the app shipped before felt,
     kept verbatim because every board was tuned against them. See GAME
     AREAS in 02-prefs-theme.jsx. Same keys as felt, in the same order. */
  light: {
    bg:      '#FAF6EE', // ivory paper
    surface: '#F3EDDF', // deeper paper
    card:    '#FFFFFF',
    border:  '#E7DFCC',
    accent:  '#0B7A70', // teal ink
    gold:    '#C9A227',
    emerald: '#1E8F63',
    violet:  '#7B5CD6',
    rose:    '#CD4B3A',
    text:    '#1F2B47', // ink navy
    muted:   '#5E6A87',
    dim:     '#A9A38F',
  },
  dark: {
    bg:      '#0A0D14',
    surface: '#12161F',
    card:    '#181D29',
    border:  '#2A3342',
    accent:  '#0E8C80',
    gold:    '#FBBF24',
    emerald: '#34D399',
    violet:  '#A78BFA',
    rose:    '#FB7185',
    text:    '#ECEFF6',
    muted:   '#8B95A8',
    dim:     '#39424F',
  },
};

/* Derived, semantically-named tokens: the shadow/scrim/well/hover values
   and the ink that sits on a solid accent fill. */
const DERIVED = {
  felt: {
    'shadow-sm':     'rgba(0,0,0,0.22)',
    'shadow-md':     'rgba(0,0,0,0.30)',
    'shadow-lg':     'rgba(0,0,0,0.45)',
    'scrim':         'rgba(3,20,14,0.68)',
    'well':          'rgba(0,0,0,0.16)',
    'well-strong':   'rgba(0,0,0,0.26)',
    'accent-hover':  '#E8C677',
    'emerald-hover': '#9BE3B6',
    'gold-hover':    '#F0D490',
    'accent-ink':    '#2A1E05', // text on a brass / mint / coral / lavender fill
  },
  light: {
    'shadow-sm':     'rgba(63,51,24,0.06)',
    'shadow-md':     'rgba(63,51,24,0.14)',
    'shadow-lg':     'rgba(63,51,24,0.22)',
    'scrim':         'rgba(38,33,18,0.52)',
    'well':          'rgba(0,0,0,0.035)',
    'well-strong':   'rgba(0,0,0,0.055)',
    'accent-hover':  '#09635B',
    'emerald-hover': '#059669',
    'gold-hover':    '#A8871C',
    'accent-ink':    '#FFFFFF',
  },
  dark: {
    'shadow-sm':     'rgba(0,0,0,0.45)',
    'shadow-md':     'rgba(0,0,0,0.5)',
    'shadow-lg':     'rgba(0,0,0,0.6)',
    'scrim':         'rgba(4,6,12,0.66)',
    'well':          'rgba(255,255,255,0.045)',
    'well-strong':   'rgba(255,255,255,0.07)',
    'accent-hover':  '#12A596',
    'emerald-hover': '#6EE7B7',
    'gold-hover':    '#FCD34D',
    'accent-ink':    '#FFFFFF',
  },
};

/* Every ${C.x} in `css` (and in inline style objects) resolves through a
   custom property. */
const C = Object.keys(PALETTES.felt).reduce((o, k) => {
  o[k] = 'var(--c-' + k + ')';
  return o;
}, {});

/* The palette as real hex, for canvas games — ctx.fillStyle = 'var(--c-bg)'
   draws nothing. `accentInk` rides along (the ink on a solid accent fill).
   While a game's canvas draws, withPal() swaps in the game's look. */
const PAL = Object.assign({}, PALETTES.felt, { accentInk: DERIVED.felt['accent-ink'] });

function hexToRgbTriplet(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
  ].join(' ');
}

/* The hex-alpha escape hatch: `${C.gold}1f` used to concatenate an alpha byte
   onto a hex literal, which a var() reference can't do. `ca('gold','1f')`
   emits rgb(var(--c-gold-rgb) / 12%) instead — same result, theme-aware, and
   far wider browser support than color-mix(). */
function ca(token, hh) {
  const pct = Math.round((parseInt(hh, 16) / 255) * 1000) / 10;
  return 'rgb(var(--c-' + token + '-rgb) / ' + pct + '%)';
}

/* Emit the palette's tokens as a custom-property block body. */
function paletteVars(theme) {
  const p = PALETTES[theme];
  const d = DERIVED[theme];
  const lines = [];
  for (const k of Object.keys(p)) {
    lines.push('  --c-' + k + ': ' + p[k] + ';');
    lines.push('  --c-' + k + '-rgb: ' + hexToRgbTriplet(p[k]) + ';');
  }
  for (const k of Object.keys(d)) lines.push('  --c-' + k + ': ' + d[k] + ';');
  lines.push('  color-scheme: ' + (theme === 'light' ? 'light' : 'dark') + ';');
  return lines.join('\n');
}

/* One bright accent per game (Appendix A: coral / sky / lime / violet /
   teal family). Assigned to each GAMES entry's tagColor, which already
   flows into the lobby card's --accent top rule, tag pill, GotD hero and
   game modal — so a single hue recolors all of a game's chrome. */
const GA = {
  coral:  '#E4604E',
  sky:    '#3D87C9',
  lime:   '#71A122',
  violet: '#7B5CD6',
  teal:   '#1D9E8F',
  plum:   '#B14A82',
  amber:  '#D97E23',
};

/* PHASE 2 (#163) — the ONE registry of tappable board-cell classes.
   This array is the single source of truth for three things that used to be
   maintained by hand and had already drifted apart:
     1. the `touch-action: manipulation` rules in `css`,
     2. the `-webkit-tap-highlight-color: transparent` rules in `css`,
     3. the `registry-touch-action` self-test's probe list.
   They are now all GENERATED from this array, so the test can never disagree
   with the stylesheet about which classes are supposed to be covered.

   Crucially the rules are emitted ONE PER CLASS rather than as a single
   30-selector comma list. A comma list is all-or-nothing: one selector an
   engine rejects drops the WHOLE rule, which is the only mechanism that
   produces the reported "touch-action:auto on <all 18 classes>" signature with
   the stylesheet present. Per-class rules make a bad entry cost exactly one
   class, and the self-test then names that one class. */
const TAPPABLE_CLASSES = [
  'tappable',
  'mf-canvas', 'board-canvas',
  'music-btn',
  'pregame-practice',
  'pregame-link-btn',
];

/* The subset that also suppresses the grey iOS tap flash. Descendant selectors
   can't live in TAPPABLE_CLASSES — that array is probed with a bare class
   name — so they're appended verbatim by the emitters below. (Empty since the
   anagram rack moved onto its canvas; the plumbing stays for the next one.) */
const TAP_HIGHLIGHT_EXTRA_SELECTORS = [];

/* The canary is emitted from the SAME generator as the real rules, so probing
   it answers "is this stylesheet applying at all?" independently of whether any
   individual game class is healthy. Without it, a sheet that never applied
   reported 18 phantom class failures — which is how #149 got filed against the
   tap-target registry when the real cause was elsewhere (#150). */
const TAP_CANARY_CLASS = 'un-selftest-canary';

function emitTouchActionRules() {
  const out = [TAP_CANARY_CLASS].concat(TAPPABLE_CLASSES)
    .map((c) => '.' + c + ' { touch-action: manipulation; }');
  for (const sel of TAP_HIGHLIGHT_EXTRA_SELECTORS) {
    out.push(sel + ' { touch-action: manipulation; }');
  }
  return out.join('\n');
}

function emitTapHighlightRules() {
  return TAPPABLE_CLASSES.concat([])
    .map((c) => '.' + c + ' { -webkit-tap-highlight-color: transparent; }')
    .concat(TAP_HIGHLIGHT_EXTRA_SELECTORS.map(
      (sel) => sel + ' { -webkit-tap-highlight-color: transparent; }'))
    .join('\n');
}

/* ============================================================
   Global stylesheet (injected via <style>)
   ============================================================ */