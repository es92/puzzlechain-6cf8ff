#!/usr/bin/env node
/*
 * Cross-file registry check (#176).
 *
 * The client (public/src/29-cards.jsx, public/src/28-registry.jsx) and the
 * server (server.js) each hold a statement about what every game is, and the
 * two have to agree. Historically that agreement was maintained by hand and
 * documented in a comment — "keep the two in sync" — which is exactly the kind
 * of invariant this repo has repeatedly discovered was silently broken (a game
 * in GAMES but not GAME_IDS just fails to start; a mode declared on the client
 * with no server story-band count pays zero and looks like a server bug).
 *
 * So it is checked, at build time, rather than asked for politely:
 *
 *   1. The registry id sets match exactly.
 *   2. Every id declaring a 'daily' play mode is in the server's GAME_IDS
 *      (which is what the daily routes validate against), and vice versa.
 *   3. Every id declaring 'story' has a STORY_BANDS level count, and vice versa
 *      (a story with no levels is unfinishable, and levels on a game with no
 *      story are unreachable points), and every count sits inside the
 *      STORY_LEVEL_MIN..STORY_LEVEL_MAX bound declared in server.js (#184).
 *   4. Nothing declares a mode that does not exist.
 *   5. The CLIENT agrees about how many levels each story has. STORY_BANDS is
 *      what the server pays out against, but the difficulty of level i comes
 *      from a per-game table on the client (WS_BANDS, MJ_LAYOUTS, a rated-seed
 *      corpus, a constant...). Raise a server count without raising its client
 *      table and the top levels silently replay the old hardest board: nothing
 *      throws, no parser complains, and the only symptom is a ladder whose last
 *      two rungs feel identical. That is the failure this rule exists to catch.
 *
 * The tables are extracted by slicing the object literals out of the sources
 * and evaluating them. That is deliberate: parsing them means this check sees
 * what the code actually says, not a third copy of the same claim.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Slice `const NAME = { ... };` out of a source and evaluate the literal. The
// object literals here are data (no calls, no references), so a bare eval of
// the slice is enough and avoids depending on a parser.
function literal(src, name, file) {
  const start = src.indexOf(`const ${name} = {`);
  if (start < 0) fail(`${file}: could not find \`const ${name} = {\``);
  const open = src.indexOf('{', start);
  let depth = 0, end = -1;
  let inStr = null, inLine = false, inBlock = false;
  for (let i = open; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (inLine) { if (c === '\n') inLine = false; continue; }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++; } continue; }
    if (inStr) { if (c === '\\') i++; else if (c === inStr) inStr = null; continue; }
    if (c === '/' && n === '/') { inLine = true; i++; continue; }
    if (c === '/' && n === '*') { inBlock = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) fail(`${file}: unbalanced braces in ${name}`);
  // eslint-disable-next-line no-eval
  return eval('(' + src.slice(open, end + 1) + ')');
}

// Slice `const NAME = [ ... ];` and count its TOP-LEVEL elements. Counting
// rather than evaluating is deliberate: some of these tables call helpers
// (MJ_LAYOUTS builds its slots with mjRect()), and the only thing this check
// wants from them is how many entries they have.
function arrayLength(src, name, file) {
  const start = src.search(new RegExp(`(^|\\n)\\s*const ${name} = \\[`));
  if (start < 0) { fail(`${file}: could not find \`const ${name} = [\``); return null; }
  const open = src.indexOf('[', start);
  // `count` closes an element at each top-level comma; `pending` remembers
  // whether anything followed the last one, so a trailing comma does not
  // invent a final entry.
  let depth = 0, count = 0, pending = false;
  let inStr = null, inLine = false, inBlock = false;
  for (let i = open; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (inLine) { if (c === '\n') inLine = false; continue; }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++; } continue; }
    if (inStr) { if (c === '\\') i++; else if (c === inStr) inStr = null; continue; }
    if (c === '/' && n === '/') { inLine = true; i++; continue; }
    if (c === '/' && n === '*') { inBlock = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; pending = true; continue; }
    if (c === '[' || c === '{' || c === '(') { depth++; if (depth > 1) pending = true; continue; }
    if (c === ']' || c === '}' || c === ')') {
      depth--;
      if (depth === 0) return count + (pending ? 1 : 0);
      continue;
    }
    if (c === ',' && depth === 1) { count++; pending = false; continue; }
    if (!/\s/.test(c)) pending = true;
  }
  fail(`${file}: unbalanced brackets in ${name}`);
  return null;
}

// Read `const NAME = <integer>;` (module scope or inside a function body).
function numberConst(src, name, file) {
  const m = src.match(new RegExp(`(^|\\n)\\s*const ${name} = (-?\\d+);`));
  if (!m) { fail(`${file}: could not find \`const ${name} = <number>;\``); return null; }
  return Number(m[2]);
}

const problems = [];
function fail(msg) { problems.push(msg); }

const cards = fs.readFileSync(path.join(ROOT, 'public/src/29-cards.jsx'), 'utf8');
const registry = fs.readFileSync(path.join(ROOT, 'public/src/28-registry.jsx'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

const PLAY_MODES = literal(cards, 'PLAY_MODES', '29-cards.jsx');
const PLAY_MODES_BY_ID = literal(cards, 'PLAY_MODES_BY_ID', '29-cards.jsx');
const GAME_REGISTRY = literal(server, 'GAME_REGISTRY', 'server.js');
const STORY_BANDS = literal(server, 'STORY_BANDS', 'server.js');
// The bound is READ from server.js, never re-declared here — a second copy of
// the numbers is the thing this whole script exists to avoid.
const LEVEL_MIN = numberConst(server, 'STORY_LEVEL_MIN', 'server.js');
const LEVEL_MAX = numberConst(server, 'STORY_LEVEL_MAX', 'server.js');
const LEVEL_DEFAULT = numberConst(server, 'STORY_LEVEL_DEFAULT', 'server.js');
if (LEVEL_MIN !== null && LEVEL_MAX !== null && LEVEL_MIN > LEVEL_MAX) {
  fail(`server.js: STORY_LEVEL_MIN (${LEVEL_MIN}) is above STORY_LEVEL_MAX (${LEVEL_MAX})`);
}
if (LEVEL_DEFAULT !== null && (LEVEL_DEFAULT < LEVEL_MIN || LEVEL_DEFAULT > LEVEL_MAX)) {
  fail(`server.js: STORY_LEVEL_DEFAULT (${LEVEL_DEFAULT}) is outside its own ${LEVEL_MIN}-${LEVEL_MAX} bound`);
}

// Client registry ids: `id: '...'` entries in the GAMES array.
const clientIds = new Set();
for (const m of registry.matchAll(/^\s{4}id:\s*'([^']+)'/gm)) clientIds.add(m[1]);
if (!clientIds.size) fail('28-registry.jsx: found no `id:` entries — has GAMES moved?');

const serverIds = new Set(Object.keys(GAME_REGISTRY));
const dailyIds = new Set(Object.keys(GAME_REGISTRY).filter(
  id => GAME_REGISTRY[id].category === 'daily' || GAME_REGISTRY[id].dailyMode));

const diff = (a, b) => [...a].filter(x => !b.has(x)).sort();

// 1. id sets
for (const id of diff(clientIds, serverIds)) fail(`${id}: in the client GAMES array but not in server GAME_REGISTRY`);
for (const id of diff(serverIds, clientIds)) fail(`${id}: in server GAME_REGISTRY but not in the client GAMES array`);

// 4. every declared mode exists, and every registry entry has an opinion
const modeNames = new Set(Object.keys(PLAY_MODES));
for (const [id, modes] of Object.entries(PLAY_MODES_BY_ID)) {
  if (!clientIds.has(id)) fail(`${id}: PLAY_MODES_BY_ID names a game that is not in GAMES`);
  for (const m of modes) if (!modeNames.has(m)) fail(`${id}: declares unknown play mode '${m}'`);
}
for (const id of clientIds) {
  if (!Object.prototype.hasOwnProperty.call(PLAY_MODES_BY_ID, id)) {
    fail(`${id}: missing from PLAY_MODES_BY_ID — every game must say what it offers, even if that is nothing`);
  }
}

const declares = (mode) => new Set(
  Object.keys(PLAY_MODES_BY_ID).filter(id => PLAY_MODES_BY_ID[id].indexOf(mode) !== -1));

// 2. daily modes <-> the set the daily routes validate against
const clientDaily = declares('daily');
for (const id of diff(clientDaily, dailyIds)) {
  fail(`${id}: declares a 'daily' play mode, but server GAME_IDS excludes it — ` +
       `/api/daily/${id}/start would 400. Add \`dailyMode: true\` to its GAME_REGISTRY row.`);
}
for (const id of diff(dailyIds, clientDaily)) {
  fail(`${id}: server treats it as a daily (category 'daily' or dailyMode), but the client declares no 'daily' mode`);
}

// 3. stories <-> level counts, and the 6-10 bound (#184)
const clientStory = declares('story');
const bandIds = new Set(Object.keys(STORY_BANDS));
for (const id of diff(clientStory, bandIds)) fail(`${id}: declares a 'story' mode with no STORY_BANDS level count — the story has no levels`);
for (const id of diff(bandIds, clientStory)) fail(`${id}: has STORY_BANDS levels but declares no 'story' mode — the points are unreachable`);
for (const [id, n] of Object.entries(STORY_BANDS)) {
  if (!Number.isInteger(n)) { fail(`${id}: STORY_BANDS must be an integer, got ${n}`); continue; }
  if (n < LEVEL_MIN || n > LEVEL_MAX) {
    fail(`${id}: STORY_BANDS is ${n}, outside the ${LEVEL_MIN}-${LEVEL_MAX} bound ` +
         `(STORY_LEVEL_MIN/STORY_LEVEL_MAX in server.js). Widen the bound deliberately, ` +
         `and note that LOWERING a count strands game_progress rows above it.`);
  }
}

/* 6. Daily difficulty bands (#331). Every id that declares a 'daily' mode is
      playable on Easy/Normal/Hard, and DAILY_BAND_NOTES (29-cards.jsx) is the
      copy the pre-game picker shows beside each. An id with no entry means a
      picker row that has nothing to say about what its band changes; an entry
      with no daily id means copy for a picker that can never render. Same
      shape as rules 2 and 3 — one declaration table checked against another. */
const DAILY_BAND_NOTES = literal(cards, 'DAILY_BAND_NOTES', '29-cards.jsx');
const bandNotesIds = new Set(Object.keys(DAILY_BAND_NOTES));
for (const id of diff(clientDaily, bandNotesIds)) {
  fail(`${id}: declares a 'daily' mode but has no DAILY_BAND_NOTES entry — ` +
       `the pre-game band picker would render a band with no copy`);
}
for (const id of diff(bandNotesIds, clientDaily)) {
  fail(`${id}: has a DAILY_BAND_NOTES entry but declares no 'daily' mode — ` +
       `copy for a band picker that never renders`);
}

/* 5. The client's per-game difficulty table has to be as long as the server's
      level count. Each entry names where level i's content comes from:
        count  — that table must have EXACTLY n entries
        min    — that table is indexed modulo its length, so it only has to be
                 long enough for n distinct levels
      Two games are deliberately absent. `cryptowordle` has no per-level
      content (every level is the day's word stack), and `tilematching` maps a
      level onto its own 1000-level campaign by formula, so neither has a table
      to be out of step with. */
const CLIENT_LEVEL_TABLES = [
  { id: 'sudoku',       file: 'public/src/06-game-sudoku.jsx',      objectKey: ['SDK_BAND_COUNT', 'sudoku'] },
  { id: 'sudokumini',   file: 'public/src/06-game-sudoku.jsx',      objectKey: ['SDK_BAND_COUNT', 'sudokumini'] },
  { id: 'wordhunt',     file: 'public/src/08-game-wordsearch.jsx',  array: 'WS_BANDS' },
  { id: 'knights-tour', file: 'public/src/15-game-knightstour.jsx', array: 'KT_BANDS' },
  { id: 'diamondrush',  file: 'public/src/13-games-arcade.jsx',     array: 'DR_BANDS' },
  { id: 'nonogram',     file: 'public/src/24-engine-cards.jsx',     array: 'NG_BANDS' },
  { id: 'minefinder',   file: 'public/src/24-engine-cards.jsx',     array: 'MF_BANDS' },
  { id: 'anagrams',     file: 'public/src/24-engine-cards.jsx',     array: 'AN_BANDS' },
  { id: 'mahjongsol',   file: 'public/src/24-engine-cards.jsx',     array: 'MJ_LAYOUTS' },
  { id: 'hashrush',     file: 'public/src/23-game-hashrush.jsx',    array: 'HR_STORY' },
  { id: 'hashrush',     file: 'public/src/23-game-hashrush.jsx',    number: 'HR_STORY_BANDS' },
  { id: 'jetrun',       file: 'public/src/32-game-jetrun.jsx',      array: 'DF_STORY' },
  { id: 'zuma',         file: 'public/src/20-game-marbleloop.jsx',  number: 'ZUMA_STORY_BANDS' },
  { id: 'match3',       file: 'public/src/20-game-marbleloop.jsx',  number: 'M3_STORY_BANDS' },
  { id: 'bounce',       file: 'public/src/17-game-bounce.jsx',      array: 'BOUNCE_PATTERNS', min: true },
  { id: 'klondike',     file: 'public/corpus/klondike.json',        corpus: true },
  { id: 'spider',       file: 'public/corpus/spider.json',          corpus: true },
  { id: 'cratepush',    file: 'public/corpus/cratepush.json',       corpus: true },
];

const srcCache = new Map();
const readSrc = (file) => {
  if (!srcCache.has(file)) srcCache.set(file, fs.readFileSync(path.join(ROOT, file), 'utf8'));
  return srcCache.get(file);
};

const covered = new Set();
for (const t of CLIENT_LEVEL_TABLES) {
  const want = STORY_BANDS[t.id];
  if (want === undefined) { fail(`CLIENT_LEVEL_TABLES names '${t.id}', which has no STORY_BANDS entry`); continue; }
  covered.add(t.id);
  let got = null, what = '';
  if (t.corpus) {
    let json;
    try { json = JSON.parse(readSrc(t.file)); }
    catch (e) { fail(`${t.file}: not readable as JSON (${e.message})`); continue; }
    got = json.bands; what = `${t.file} "bands"`;
  } else if (t.array) {
    got = arrayLength(readSrc(t.file), t.array, t.file); what = `${t.array}.length`;
  } else if (t.number) {
    got = numberConst(readSrc(t.file), t.number, t.file); what = t.number;
  } else {
    const obj = literal(readSrc(t.file), t.objectKey[0], t.file);
    got = obj && obj[t.objectKey[1]]; what = `${t.objectKey[0]}.${t.objectKey[1]}`;
  }
  if (got === null || got === undefined) continue;   // the reader already failed
  if (t.min ? got < want : got !== want) {
    fail(`${t.id}: STORY_BANDS says ${want} level${want === 1 ? '' : 's'}, but ${what} ` +
         `is ${got}${t.min ? ` (needs at least ${want})` : ''} in ${t.file}. ` +
         `Level ${Math.min(got, want) + 1} and up would replay content instead of getting its own.`);
  }
}
const UNTABLED = new Set(['cryptowordle', 'tilematching']);
for (const id of bandIds) {
  if (!covered.has(id) && !UNTABLED.has(id)) {
    fail(`${id}: has STORY_BANDS levels but no CLIENT_LEVEL_TABLES entry — add where its ` +
         `per-level content comes from, or add it to UNTABLED with a reason.`);
  }
}

if (problems.length) {
  console.error('[check-registry] client and server registries disagree:\n  ' + problems.join('\n  '));
  process.exit(1);
}
const modeCount = Object.values(PLAY_MODES_BY_ID).reduce((a, m) => a + m.length, 0);
console.log(`[check-registry] ${clientIds.size} games, ${modeCount} play modes, ` +
  `${dailyIds.size} dailies, ${bandIds.size} stories (${LEVEL_MIN}-${LEVEL_MAX} levels each) ` +
  `— client and server agree ✓`);
