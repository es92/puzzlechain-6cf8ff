const { useState, useEffect, useRef } = React;

/* ============================================================
   Design system — color palette
   "The Daily Page, Warmed" (Game Corner spec, Appendix A): an
   editorial daily-newspaper look. Ivory paper, ink-navy text, warm
   hairlines, white card surfaces, and brass reserved for streaks /
   wins / medals. Same token names as before so every ${C.*} in the
   stylesheet re-themes in place.
   ------------------------------------------------------------
   THEMING (light/dark/system): the palette is no longer baked into
   the stylesheet as hex. `PALETTES` holds the raw values for both
   themes; they are emitted as CSS custom properties on :root (light)
   and :root[data-theme="dark"] (dark) by `paletteVars()` below, and
   `C` interpolates `var(--c-*)` references — so all ~900 ${C.*} sites
   in `css` re-theme at runtime with no rebuild. Two escape hatches:
   - `ca('gold','1f')` for the hex-alpha idiom (`var()` can't be
     string-concatenated with an alpha byte), and
   - `PAL.*`, a live plain object mirroring the RESOLVED palette, for
     the handful of <canvas> sites that need a real colour value.
   ============================================================ */
const PALETTES = {
  light: {
    bg:      '#FAF6EE', // ivory paper
    surface: '#F3EDDF', // deeper paper — nav, wells, sheets
    card:    '#FFFFFF', // card-weight white surfaces
    border:  '#E7DFCC', // warm hairline
    accent:  '#0B7A70', // vivid teal — shell links/buttons/tabs (5.2:1 with white text)
    gold:    '#C9A227', // brass — reserved for streaks, wins, medals
    emerald: '#1E8F63', // deep green (success, live states)
    violet:  '#7B5CD6',
    rose:    '#CD4B3A', // warm coral-red (errors, danger)
    text:    '#1F2B47', // ink navy
    muted:   '#5E6A87', // muted ink
    dim:     '#A9A38F', // faded newsprint — faint text, dashed rules
  },
  // The deep neutral-dark scheme this app shipped with before the
  // "Daily Page, Warmed" retheme — designed against this same stylesheet.
  dark: {
    bg:      '#0A0D14',
    surface: '#12161F',
    card:    '#181D29',
    border:  '#2A3342',
    accent:  '#0E8C80', // teal, balanced for white text on it AND teal text on the dark page
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
   that used to be hardcoded warm-brown rgba() literals (invisible on a dark
   page) or hand-darkened hues. One knob per theme instead of ~30 literals. */
const DERIVED = {
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
  },
};

/* Every ${C.x} in `css` (and in inline style objects) resolves through a
   custom property, so one attribute flip on <html> re-themes everything. */
const C = Object.keys(PALETTES.light).reduce((o, k) => {
  o[k] = 'var(--c-' + k + ')';
  return o;
}, {});

/* Live mirror of the RESOLVED palette, kept in sync by applyTheme(). Canvas
   games read real hex from here — ctx.fillStyle = 'var(--c-bg)' draws nothing. */
const PAL = Object.assign({}, PALETTES.light);

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

/* Emit one theme's tokens as a custom-property block body. */
function paletteVars(theme) {
  const p = PALETTES[theme];
  const d = DERIVED[theme];
  const lines = [];
  for (const k of Object.keys(p)) {
    lines.push('  --c-' + k + ': ' + p[k] + ';');
    lines.push('  --c-' + k + '-rgb: ' + hexToRgbTriplet(p[k]) + ';');
  }
  for (const k of Object.keys(d)) lines.push('  --c-' + k + ': ' + d[k] + ';');
  lines.push('  color-scheme: ' + theme + ';');
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
  'card-pin',
  'dl-check',
  'nav-theme-btn',
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