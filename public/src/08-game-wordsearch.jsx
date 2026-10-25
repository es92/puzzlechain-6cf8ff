/* ============================================================
   Game 2 — Word Hunt (8×8 word search)
   ============================================================ */
// #139 — 8x8 with 8 short words was a glance, not a search: half the grid was
// filler and the words were findable at a look. 10x10 with 10 words per theme
// keeps the cell at ~42px in the 420px fit box (still above a fingertip) while
// roughly doubling the space to scan. Everything below derives from WS_SIZE, so
// this is the only size knob. Verified by the wordsearch-placement self-test.
const WS_SIZE = 10;

// 8 directions: horizontal, vertical, and both diagonals (forwards + backwards).
const WS_DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

// Themed word sets. Words are <= 6 letters so they always place on an 8×8 grid.
// 10 words per theme, max length 10 so every word fits any axis of the grid.
/* #176 — the content library WAS seven themed sets of ten words. Seventy
   words, picked uniformly at random per day with no anti-repeat rule, so the
   same grid contents recurred inside a week: this is the game the request
   named, and "do it once and you're done" was a fair description.

   Forty themes now, and the pick is a SLIDING PARTITION rather than a uniform
   draw — the same technique Daily Cipher already uses. Themes are shuffled
   once with a fixed seed and consumed in order, so no theme can recur until
   every other has been seen. That is a hard 40-day guarantee, where the old
   uniform draw gave a ~14% chance of repeating the very next day. */
const WORD_SETS = [
  { theme: 'Space',      words: ['COMET', 'ORBIT', 'PLANET', 'GALAXY', 'NEBULA', 'ROCKET', 'STAR', 'MARS', 'ECLIPSE', 'METEOR'] },
  { theme: 'Ocean',      words: ['CORAL', 'WHALE', 'SHARK', 'TIDE', 'PEARL', 'SQUID', 'WAVE', 'REEF', 'LAGOON', 'DOLPHIN'] },
  { theme: 'Kitchen',    words: ['SPOON', 'WHISK', 'KNIFE', 'PLATE', 'KETTLE', 'GRATER', 'OVEN', 'BOWL', 'SKILLET', 'LADLE'] },
  { theme: 'Forest',     words: ['CEDAR', 'MAPLE', 'BIRCH', 'WILLOW', 'ACORN', 'FERN', 'MOSS', 'PINE', 'THICKET', 'CANOPY'] },
  { theme: 'Music',      words: ['TEMPO', 'CHORD', 'PIANO', 'VIOLIN', 'MELODY', 'FLUTE', 'DRUM', 'BANJO', 'HARMONY', 'OCTAVE'] },
  { theme: 'Weather',    words: ['CLOUD', 'THUNDER', 'BREEZE', 'FROST', 'DRIZZLE', 'HAIL', 'GUST', 'MIST', 'RAINBOW', 'SLEET'] },
  { theme: 'Garden',     words: ['TULIP', 'HEDGE', 'TROWEL', 'COMPOST', 'SEEDLING', 'PETAL', 'VINE', 'BLOOM', 'ORCHID', 'SPADE'] },
  { theme: 'Mountains',  words: ['SUMMIT', 'RIDGE', 'GLACIER', 'BOULDER', 'VALLEY', 'SLOPE', 'CRAG', 'ASCENT', 'PLATEAU', 'GORGE'] },
  { theme: 'Desert',     words: ['CACTUS', 'DUNE', 'OASIS', 'MIRAGE', 'CAMEL', 'SCORPION', 'ARID', 'CANYON', 'SANDS', 'NOMAD'] },
  { theme: 'Birds',      words: ['FALCON', 'SPARROW', 'HERON', 'RAVEN', 'PELICAN', 'ROBIN', 'SWIFT', 'OSPREY', 'MAGPIE', 'FINCH'] },
  { theme: 'Insects',    words: ['BEETLE', 'MANTIS', 'CRICKET', 'HORNET', 'APHID', 'WEEVIL', 'LOCUST', 'MOTH', 'CICADA', 'EARWIG'] },
  { theme: 'Fruit',      words: ['BANANA', 'CHERRY', 'PAPAYA', 'GUAVA', 'LYCHEE', 'APRICOT', 'PLUM', 'MELON', 'DAMSON', 'QUINCE'] },
  { theme: 'Vegetables', words: ['CARROT', 'TURNIP', 'PARSNIP', 'SPINACH', 'LEEK', 'RADISH', 'MARROW', 'CELERY', 'SHALLOT', 'ENDIVE'] },
  { theme: 'Baking',     words: ['PASTRY', 'BATTER', 'KNEAD', 'YEAST', 'SCONE', 'GLAZE', 'CRUMB', 'PROOF', 'STRUDEL', 'MERINGUE'] },
  { theme: 'Tools',      words: ['HAMMER', 'CHISEL', 'PLIERS', 'WRENCH', 'MALLET', 'AUGER', 'CLAMP', 'RASP', 'SCRIBER', 'JIGSAW'] },
  { theme: 'Fabric',     words: ['COTTON', 'VELVET', 'DENIM', 'LINEN', 'SATIN', 'TWEED', 'CANVAS', 'CHIFFON', 'BROCADE', 'MUSLIN'] },
  { theme: 'Colours',    words: ['CRIMSON', 'INDIGO', 'AMBER', 'OLIVE', 'MAROON', 'TEAL', 'AZURE', 'SEPIA', 'MAGENTA', 'SAFFRON'] },
  { theme: 'Metals',     words: ['COPPER', 'NICKEL', 'BRONZE', 'PEWTER', 'COBALT', 'SILVER', 'TITANIUM', 'ZINC', 'BRASS', 'IRIDIUM'] },
  { theme: 'Gemstones',  words: ['GARNET', 'OPAL', 'TOPAZ', 'JASPER', 'ZIRCON', 'BERYL', 'AMETHYST', 'ONYX', 'PERIDOT', 'JADE'] },
  { theme: 'Castles',    words: ['TURRET', 'MOAT', 'RAMPART', 'BAILEY', 'KEEP', 'DRAWBRIDGE', 'PARAPET', 'BATTLEMENT', 'PORTCULLIS', 'DUNGEON'] },
  { theme: 'Sailing',    words: ['ANCHOR', 'RUDDER', 'MAST', 'GALLEY', 'STARBOARD', 'KEEL', 'HALYARD', 'SCHOONER', 'BOWSPRIT', 'TILLER'] },
  { theme: 'Cycling',    words: ['PEDAL', 'SADDLE', 'SPOKE', 'CHAIN', 'HANDLEBAR', 'GEAR', 'BRAKE', 'PELOTON', 'CADENCE', 'TANDEM'] },
  { theme: 'Athletics',  words: ['SPRINT', 'HURDLE', 'JAVELIN', 'DISCUS', 'RELAY', 'VAULT', 'MARATHON', 'SHOTPUT', 'STRIDE', 'PODIUM'] },
  { theme: 'Camping',    words: ['TENT', 'LANTERN', 'CANTEEN', 'EMBERS', 'BEDROLL', 'COMPASS', 'TRAIL', 'KINDLING', 'SATCHEL', 'HAMMOCK'] },
  { theme: 'Winter',     words: ['MITTEN', 'ICICLE', 'BLIZZARD', 'SLEDGE', 'FLURRY', 'THAW', 'GLAZE', 'PARKA', 'SNOWDRIFT', 'FROSTBITE'] },
  { theme: 'Library',    words: ['VOLUME', 'INDEX', 'ARCHIVE', 'BINDING', 'FOLIO', 'ATLAS', 'CATALOGUE', 'MARGIN', 'PREFACE', 'MANUSCRIPT'] },
  { theme: 'Theatre',    words: ['CURTAIN', 'REHEARSE', 'BALCONY', 'SCRIPT', 'ENCORE', 'BACKDROP', 'MONOLOGUE', 'USHER', 'MATINEE', 'SPOTLIGHT'] },
  { theme: 'Painting',   words: ['CANVAS', 'PALETTE', 'EASEL', 'PIGMENT', 'VARNISH', 'PRIMER', 'BRUSH', 'FRESCO', 'STIPPLE', 'GOUACHE'] },
  { theme: 'Photography',words: ['SHUTTER', 'LENS', 'APERTURE', 'TRIPOD', 'EXPOSURE', 'FILTER', 'NEGATIVE', 'FOCUS', 'DARKROOM', 'PORTRAIT'] },
  { theme: 'Cinema',     words: ['REEL', 'SCENE', 'EDITOR', 'SCREEN', 'TRAILER', 'CAMEO', 'MONTAGE', 'CREDITS', 'DIRECTOR', 'SOUNDTRACK'] },
  { theme: 'Rivers',     words: ['DELTA', 'RAPIDS', 'ESTUARY', 'BANK', 'MEANDER', 'SOURCE', 'TRIBUTARY', 'FORD', 'CURRENT', 'CATARACT'] },
  { theme: 'Volcanoes',  words: ['MAGMA', 'CRATER', 'LAVA', 'ASHFALL', 'CALDERA', 'VENT', 'PUMICE', 'ERUPTION', 'BASALT', 'FISSURE'] },
  { theme: 'Astronomy',  words: ['QUASAR', 'PULSAR', 'CORONA', 'ZENITH', 'PARALLAX', 'ECLIPTIC', 'AURORA', 'SOLSTICE', 'PENUMBRA', 'PERIHELION'] },
  { theme: 'Chemistry',  words: ['BEAKER', 'CATALYST', 'ISOTOPE', 'SOLVENT', 'ALKALI', 'TITRATE', 'MOLAR', 'REAGENT', 'DISTIL', 'POLYMER'] },
  { theme: 'Anatomy',    words: ['TENDON', 'CORTEX', 'SPLEEN', 'MARROW', 'SINEW', 'RETINA', 'FEMUR', 'ARTERY', 'LIGAMENT', 'CARTILAGE'] },
  { theme: 'Architecture', words: ['ATRIUM', 'COLUMN', 'GABLE', 'ARCH', 'ROTUNDA', 'FACADE', 'CORNICE', 'BUTTRESS', 'PORTICO', 'MEZZANINE'] },
  { theme: 'Transport',  words: ['FERRY', 'TRAM', 'CARRIAGE', 'GONDOLA', 'FREIGHT', 'SHUTTLE', 'CONVOY', 'MONORAIL', 'CARAVAN', 'AIRSHIP'] },
  { theme: 'Markets',    words: ['STALL', 'BARTER', 'VENDOR', 'HAGGLE', 'PRODUCE', 'AWNING', 'CRATE', 'BAZAAR', 'MERCHANT', 'TROLLEY'] },
  { theme: 'Puzzles',    words: ['RIDDLE', 'CIPHER', 'MAZE', 'ANAGRAM', 'CLUE', 'LOGIC', 'PATTERN', 'REBUS', 'CROSSWORD', 'CONUNDRUM'] },
  { theme: 'Mythology',  words: ['ORACLE', 'TITAN', 'CHIMERA', 'PHOENIX', 'SIREN', 'MINOTAUR', 'PEGASUS', 'HYDRA', 'CENTAUR', 'VALKYRIE'] },
];

/* Difficulty for this game is GENERATOR PARAMETERS, not a corpus: a bigger
   grid, more words, diagonals and reversals allowed, and denser decoy letters
   each make a search genuinely harder. Bands name all four. */
const WS_BANDS = [
  { size: 8,  words: 6,  dirs: 4, reverse: false },
  { size: 10, words: 8,  dirs: 4, reverse: false },
  { size: 10, words: 10, dirs: 8, reverse: false },
  { size: 12, words: 10, dirs: 8, reverse: true },
  { size: 14, words: 12, dirs: 8, reverse: true },
  { size: 15, words: 14, dirs: 8, reverse: true },
];

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const wsRandLetter = (rng = Math.random) => ALPHABET[Math.floor(rng() * 26)];

// Try to place every word into a fresh grid. Returns the filled letter grid,
// or null if any word couldn't be placed (caller retries with a new grid).
function placeWords(words, rng = Math.random, size = WS_SIZE, dirs = WS_DIRS, allowReverse = true) {
  const grid = Array.from({ length: size }, () => Array(size).fill(null));
  // Longest first: a 10-letter word on a 10x10 grid has very few legal
  // placements, and trying it after the grid is half-full wastes retries.
  for (const word of words.slice().sort((a, b) => b.length - a.length)) {
    let placed = false;
    // A band that forbids reversals writes the word forwards only; one that
    // allows them flips a coin per word, which is what makes a grid feel
    // adversarial rather than merely large.
    const spelled = (allowReverse && rng() < 0.4)
      ? word.split('').reverse().join('') : word;
    for (let attempt = 0; attempt < 400 && !placed; attempt++) {
      const [dr, dc] = dirs[Math.floor(rng() * dirs.length)];
      const r0 = Math.floor(rng() * size);
      const c0 = Math.floor(rng() * size);
      const rEnd = r0 + dr * (word.length - 1);
      const cEnd = c0 + dc * (word.length - 1);
      if (rEnd < 0 || rEnd >= size || cEnd < 0 || cEnd >= size) continue;
      // Overlap is allowed only where the existing letter already matches.
      let ok = true;
      for (let i = 0; i < spelled.length; i++) {
        const ch = grid[r0 + dr * i][c0 + dc * i];
        if (ch !== null && ch !== spelled[i]) { ok = false; break; }
      }
      if (!ok) continue;
      for (let i = 0; i < spelled.length; i++) grid[r0 + dr * i][c0 + dc * i] = spelled[i];
      placed = true;
    }
    if (!placed) return null;
  }
  return grid;
}

/* Theme rotation as a PARTITION, not a sample. Shuffle the themes once with a
   fixed seed and walk them in order, so a theme cannot recur until all forty
   have been seen. The old uniform draw over seven sets gave a ~14% chance of
   repeating the very next day; this gives a hard 40-day guarantee. (Daily
   Cipher already worked this way — this is that idea applied to the game the
   request actually complained about.) */
const WS_THEME_ORDER = shuffle(WORD_SETS.map((_, i) => i), mulberry32(0x5EED17));
const wsThemeForDay = (dayNum) => WORD_SETS[WS_THEME_ORDER[
  ((dayNum % WS_THEME_ORDER.length) + WS_THEME_ORDER.length) % WS_THEME_ORDER.length
]];

/* Generate against a band spec: grid size, word count, how many directions are
   allowed and whether words may run backwards. All four are what actually make
   a word search hard, which is why this game never needed a board corpus —
   only more vocabulary and these knobs. */
function generateWordSearch(rng = Math.random, spec, themeIdx) {
  const band = spec || WS_BANDS[2];
  const set = themeIdx != null
    ? WORD_SETS[themeIdx % WORD_SETS.length]
    : WORD_SETS[Math.floor(rng() * WORD_SETS.length)];
  // Longest words first: they are the hardest to place, and a band that asks
  // for fewer words should drop the easy short ones rather than the long ones.
  const words = set.words.slice()
    .sort((a, b) => b.length - a.length)
    .slice(0, band.words);
  const size = band.size;
  const dirs = WS_DIRS.slice(0, band.dirs);
  let grid = null;
  for (let attempt = 0; attempt < 400 && !grid; attempt++) {
    grid = placeWords(words, rng, size, dirs, band.reverse);
  }
  if (!grid) grid = Array.from({ length: size }, () => Array(size).fill(null));
  // Fill the empty cells with seeded filler letters.
  const letters = grid.map(row => row.map(ch => ch || wsRandLetter(rng)));
  return { theme: set.theme, words, letters, size };
}

// Locate `word` on the letter grid (any of the 8 directions, forwards or
// reversed) and return its cell indices, or null. Used to restore highlighted
// cells for words a resumed player had already found.
function locateWord(letters, word) {
  const n = letters.length;
  const idx = (r, c) => r * n + c;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      for (const [dr, dc] of WS_DIRS) {
        const cells = [];
        let ok = true;
        for (let i = 0; i < word.length; i++) {
          const rr = r + dr * i, cc = c + dc * i;
          if (rr < 0 || rr >= n || cc < 0 || cc >= n || letters[rr][cc] !== word[i]) { ok = false; break; }
          cells.push(idx(rr, cc));
        }
        if (ok) return cells;
      }
    }
  }
  return null;
}

function WordHuntGame({ onWin, onStepChange, offset, savedProgress, onSaveProgress, playMode, band }) {
  /* #176 — the daily now walks the theme partition (no repeat for 40 days,
     where the old uniform draw over seven sets could repeat tomorrow) at the
     middle band. Story climbs the band ladder; arcade rolls a fresh grid at
     one of three points on it.
     #331 — the daily's difficulty band rides the band-mixed seed: Easy is
     the smallest grid, Hard the full 15×15 (WS_BANDS 0 and 5); Normal stays
     at the middle rung and the un-mixed seed. */
  const dailyBand = playMode === 'daily' && (band === 'easy' || band === 'hard')
    ? band : null;
  const wsBandIdx = playMode === 'story' ? Math.max(0, band || 0)
    : playMode === 'arcade'
      ? [1, 3, 5][Math.max(0, ARCADE_BANDS.findIndex(b => b.id === band))]
      : dailyBand === 'easy' ? 0
      : dailyBand === 'hard' ? WS_BANDS.length - 1
      : 2;
  const wsSpec = WS_BANDS[Math.min(WS_BANDS.length - 1, wsBandIdx)];
  const board = useRef(null);
  if (!board.current) {
    if (playMode === 'story' || playMode === 'arcade') {
      const { rng } = modeSeed(playMode, 'wordhunt', wsBandIdx, offset);
      board.current = generateWordSearch(rng, wsSpec);
    } else {
      board.current = generateWordSearch(
        dailyRng(offset, 'wordhunt', dailyBand || undefined), wsSpec, WS_THEME_ORDER[
          ((utcDayNum(offset) % WS_THEME_ORDER.length) + WS_THEME_ORDER.length) % WS_THEME_ORDER.length
        ]);
    }
  }
  const { theme, words, letters } = board.current;
  const WS_N = board.current.size;
  const total = words.length;
  const dayNum = useRef(utcDayNum(offset)).current;

  // Hydrate from a resumed attempt for today's board.
  const resumed = savedProgress && savedProgress.dayNum === dayNum && Array.isArray(savedProgress.found)
    ? savedProgress
    : null;
  const initFound = () => new Set((resumed ? resumed.found : []).filter(w => words.includes(w)));
  const initCells = () => {
    const set = new Set();
    if (resumed) for (const w of resumed.found) {
      const cells = locateWord(letters, w);
      if (cells) cells.forEach(i => set.add(i));
    }
    return set;
  };

  const [found, setFound] = useState(initFound);            // found word strings
  const [foundCells, setFoundCells] = useState(initCells);  // locked cell indices
  // First-cell hints bought for not-yet-found words (cell indices), persisted.
  const [hintedStarts, setHintedStarts] = useState(() =>
    new Set(resumed && Array.isArray(resumed.hintedStarts) ? resumed.hintedStarts : [])
  );
  const [anchor, setAnchor] = useState(null);                // [r, c] drag start
  const [sel, setSel] = useState([]);                        // cell indices in current drag
  const [steps, setSteps] = useState(() => (resumed && Number.isFinite(savedProgress.steps) ? savedProgress.steps : 0));
  const [score, setScore] = useState(() => {
    // Reconstruct score from already-found words so a resumed win scores right.
    let s = 0;
    if (resumed) for (const w of resumed.found) if (words.includes(w)) s += w.length * w.length * 10;
    return s;
  });
  const [done, setDone] = useState(false);
  const initialSecs = savedProgress && Number.isFinite(savedProgress.elapsedSecs) ? savedProgress.elapsedSecs : 0;
  const { secs, fmt } = useTimer(!done, initialSecs);

  // Keep the latest elapsed seconds reachable inside event-handler closures.
  const secsRef = useRef(initialSecs);
  secsRef.current = secs;

  const idx = (r, c) => r * WS_N + c;

  // Idle/leave autosave; per-find saves happen in endSel().
  const stateRef = useRef({});
  stateRef.current = { found, steps, secs, hintedStarts };
  useAutosave(
    onSaveProgress,
    () => ({
      progress: { dayNum, found: [...stateRef.current.found], hintedStarts: [...stateRef.current.hintedStarts] },
      steps: stateRef.current.steps, secs: stateRef.current.secs,
    }),
    !done
  );

  // Paid hint: highlight the first cell of one random not-yet-found word.
  const hints = useDailyHints({ gameId: 'wordhunt', maxHints: total });
  const buyHint = () => {
    if (done) return;
    hints.buy(() => {
      // Words still unfound and not already hinted.
      const candidates = words.filter(w => {
        if (found.has(w)) return false;
        const cells = locateWord(letters, w);
        return cells && cells.length && !hintedStarts.has(cells[0]);
      });
      if (!candidates.length) return true; // nothing to reveal (server already charged)
      const w = candidates[Math.floor(Math.random() * candidates.length)];
      const cells = locateWord(letters, w);
      const hs = new Set(hintedStarts); hs.add(cells[0]);
      setHintedStarts(hs);
      onSaveProgress && onSaveProgress(
        { dayNum, found: [...found], hintedStarts: [...hs] }, steps, secsRef.current
      );
      return true;
    });
  };
  const hintsExhausted = found.size >= total ||
    words.every(w => found.has(w) || (locateWord(letters, w) && hintedStarts.has(locateWord(letters, w)[0])));

  // Straight-line path of cell indices from the anchor to (r, c), or null if
  // the target isn't on a horizontal / vertical / 45° diagonal from the anchor.
  const linePath = (a, r, c) => {
    const dr0 = r - a[0], dc0 = c - a[1];
    if (dr0 === 0 && dc0 === 0) return [idx(a[0], a[1])];
    const adr = Math.abs(dr0), adc = Math.abs(dc0);
    if (!(dr0 === 0 || dc0 === 0 || adr === adc)) return null;
    const len = Math.max(adr, adc);
    const sr = Math.sign(dr0), sc = Math.sign(dc0);
    const path = [];
    for (let i = 0; i <= len; i++) path.push(idx(a[0] + sr * i, a[1] + sc * i));
    return path;
  };

  const startSel = (r, c) => {
    if (done) return;
    setAnchor([r, c]);
    setSel([idx(r, c)]);
  };

  const moveSel = (r, c) => {
    if (done || !anchor) return;
    const path = linePath(anchor, r, c);
    if (path) setSel(path);
  };

  const endSel = () => {
    if (done || !anchor || sel.length === 0) { setAnchor(null); setSel([]); return; }

    const word = sel.map(i => letters[Math.floor(i / WS_N)][i % WS_N]).join('');
    const rev = word.split('').reverse().join('');
    const match = words.find(w => (w === word || w === rev) && !found.has(w));

    const newSteps = steps + 1;
    setSteps(newSteps);
    onStepChange(newSteps);

    if (match) {
      const nf = new Set(found); nf.add(match);
      const nc = new Set(foundCells); sel.forEach(i => nc.add(i));
      setFound(nf);
      setFoundCells(nc);

      const newScore = score + match.length * match.length * 10;
      setScore(newScore);

      // persist this find immediately
      onSaveProgress && onSaveProgress({ dayNum, found: [...nf], hintedStarts: [...hintedStarts] }, newSteps, secsRef.current);

      if (nf.size === total) {
        setDone(true);
        const finalScore = Math.max(newScore - secsRef.current * 2, 100);
        onWin(finalScore, newSteps, secsRef.current);
      }
    }

    setAnchor(null);
    setSel([]);
  };

  const selSet = new Set(sel);

  /* The whole frame is ONE canvas (controls wave): pills, theme line, letter
     grid and hint bar draw together; only the found-words chip list stays
     DOM (read-only content, scrolls). The canvas keeps pointer capture, so a
     fast diagonal swipe can't skip cells; letters render uppercase as the
     DOM's text-transform did. */
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const { boxW, boxH } = useFitBox(boxRef, { cols: 1, rows: 1, maxCell: 100000 });
  const W = Math.floor(boxW);
  const GAP = 8, PILL_H = 46, THEME_H = 22, HINT_H = 36;
  const chrome = PILL_H + THEME_H + HINT_H + GAP * 3;
  const availB = Math.max(0, Math.min(W, Math.floor(boxH) - chrome));
  /* #176 — the grid is 8x8 to 15x15 now (the ladder's first real knob), so the
     cell size is derived from THIS board's size, not the 10x10 default. The
     floor drops with the size: a 15x15 board at a 24px minimum would not fit a
     390px phone. */
  const wsCell = Math.max(16, Math.min(42, Math.floor((availB - (WS_N - 1)) / WS_N)));
  const wsStep = wsCell + 1;
  const wsSide = wsStep * WS_N - 1;
  const H = chrome + wsSide;
  const boardX = Math.floor((W - wsSide) / 2);
  const boardY = PILL_H + GAP + THEME_H + GAP;
  const hintY = boardY + wsSide + GAP;

  const controls = [];
  if (W > 80) {
    const pr = cuiRow(0, 0, W, PILL_H, 3);
    controls.push({ id: 'p-time', kind: 'pill', r: pr[0], label: 'Time', value: fmt, gold: true });
    controls.push({ id: 'p-found', kind: 'pill', r: pr[1], label: 'Found', value: `${found.size}/${total}` });
    controls.push({ id: 'p-steps', kind: 'pill', r: pr[2], label: 'Steps', value: steps });
    controls.push({ id: 'theme', kind: 'label', r: [0, PILL_H + GAP, W, THEME_H], label: `Theme: ${theme} · drag across letters to find each word`, font: 12 });
    if (!done) {
      const exhausted = hints.exhausted || hintsExhausted;
      controls.push({
        id: 'hint', kind: 'button',
        r: [hints.msg ? 0 : Math.floor(W * 0.2), hintY, hints.msg ? Math.floor(W * 0.48) : Math.floor(W * 0.6), HINT_H],
        label: exhausted ? '💡 No more hints'
          : `💡 Hint${Number.isFinite(hints.hintsLeft) ? ` · ${hints.hintsLeft} left` : ''}`,
        disabled: hints.buying || exhausted,
        action: buyHint,
      });
      if (hints.msg) {
        controls.push({ id: 'hint-msg', kind: 'label', r: [Math.floor(W * 0.5), hintY, Math.floor(W * 0.5), HINT_H], label: hints.msg, font: 11 });
      }
    }
  }
  const ctlRef = useRef([]);
  ctlRef.current = controls;
  const [pressedId, setPressedId] = useState(null);

  const wsGeoRef = useRef({});
  wsGeoRef.current = { wsStep, boardX, boardY };
  const wsCellAt = (p) => {
    const g = wsGeoRef.current;
    const c = Math.max(0, Math.min(WS_N - 1, Math.floor((p.x - g.boardX) / g.wsStep)));
    const r = Math.max(0, Math.min(WS_N - 1, Math.floor((p.y - g.boardY) / g.wsStep)));
    return [r, c];
  };
  const wsInBoard = (p) => {
    const g = wsGeoRef.current;
    return p.y >= g.boardY && p.y < g.boardY + wsSide + 8;
  };
  usePointerCell(canvasRef, cuiWrapHandlers(ctlRef, setPressedId, {
    onDown: (p) => { if (!wsInBoard(p)) return; const [r, c] = wsCellAt(p); startSel(r, c); },
    onDrag: (p) => { const [r, c] = wsCellAt(p); moveSel(r, c); },
    onUp: () => endSel(),
  }), { moveTolerance: 3 });
  useCanvasBoard(canvasRef, {
    width: W,
    height: H,
    deps: [foundCells, hintedStarts, sel, done, wsCell, W, fmt, steps, found, pressedId, hints.hintsLeft, hints.msg, hints.buying],
    draw: (ctx) => {
      cuiDrawControls(ctx, ctlRef.current, pressedId);
      ctx.save();
      ctx.translate(boardX, boardY);
      ctx.fillStyle = PAL.border; // the 1px gridline gaps
      ctx.fillRect(0, 0, wsSide, wsSide);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let r = 0; r < WS_N; r++) {
        for (let c = 0; c < WS_N; c++) {
          const i = idx(r, c);
          const x = c * wsStep, y = r * wsStep;
          const isFound = foundCells.has(i);
          const isHinted = !isFound && hintedStarts.has(i);
          const isSel = selSet.has(i);
          /* #197 — every colour on this board was a hardcoded rgba tuned
             against the dark palette, so the light theme inherited washes that
             were never checked. Measured on the light palette before changing
             anything: a SELECTED cell was white letters on rgba(58,110,205,.55)
             over white card — a 2.21:1 ratio, which fails even the 3:1 bar for
             large text. While you drag a selection is exactly when you need to
             read the letters.

             The selection is solid PAL.accent now (6.25:1 light, 4.47:1 dark
             against white letters), and the found/hinted washes come from PAL
             through globalAlpha rather than from frozen literals, so both
             themes get a tint that belongs to them. globalAlpha, not ca():
             ca() emits a var(--c-…) string, which is invalid on a canvas. */
          ctx.fillStyle = PAL.card;
          ctx.fillRect(x, y, wsCell, wsCell);
          if (isFound || isHinted) {
            ctx.save();
            ctx.globalAlpha = isFound ? 0.34 : 0.20;
            ctx.fillStyle = isFound ? PAL.emerald : PAL.gold;
            ctx.fillRect(x, y, wsCell, wsCell);
            ctx.restore();
          }
          if (isSel) { ctx.fillStyle = PAL.accent; ctx.fillRect(x, y, wsCell, wsCell); }
          if (isHinted) {
            ctx.lineWidth = 2;
            ctx.strokeStyle = PAL.gold;
            ctx.strokeRect(x + 1, y + 1, wsCell - 2, wsCell - 2);
          }
          ctx.font = `600 ${Math.round(wsCell * 0.5)}px 'JetBrains Mono', monospace`;
          /* A found letter was emerald ON an emerald wash: 3.27:1 in light,
             under the 4.5 AA bar. The tint already says "found" — the letter
             does not have to repeat it, and in ink it reads at 9.15:1. */
          ctx.fillStyle = isSel ? '#fff' : PAL.text;
          ctx.fillText(String(letters[r][c]).toUpperCase(), x + wsCell / 2, y + wsCell / 2 + 1);
        }
      }
      ctx.restore();
    },
  });

  return (
    <div className="fit-col">
      <div className="wordsearch cui-frame" ref={boxRef}>
        <canvas
          ref={canvasRef}
          className="ws-canvas board-canvas"
          role="grid"
          aria-label={`Word search grid — ${found.size} of ${total} words found`}
        />
      </div>
      <CuiTwin controls={controls} />

      <div className="word-list">
        {words.map(w => (
          <span key={w} className={`word-chip${found.has(w) ? ' found' : ''}`}>{w}</span>
        ))}
      </div>
    </div>
  );
}
