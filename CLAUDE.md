# Game Corner (formerly PuzzleChain) — notes for Claude Code

This app runs on **Usernode Social Vibecoding**. If you're Claude Code
editing this repo, read the platform conventions before making
changes:

**Platform conventions (authoritative, always current):**
https://my.onhomeroom.com/claude.md

Fetch that URL at the start of each session — it's the single source
of truth for platform-wide behavior (auth model, `USERNODE_ENV`,
public/private tables, "don't `git push`", etc.). The hosted copy is
updated in place when platform rules change, so fetching it gives you
today's rules, not a stale snapshot.

When running inside Usernode's dev-chat, those same conventions are
already injected into your system prompt, so the fetch is a no-op in
that path — but it's the right reflex when someone runs Claude Code
against this repo locally or from another harness.

If a rule below this line conflicts with the hosted conventions, the
hosted conventions win. This file is **app-specific** — write down
things about *this* app that belong in the repo: product intent,
data-model quirks, style preferences, opt-in policies (e.g. which
tables you've marked private), etc.

---

## About Game Corner

Game Corner (renamed from PuzzleChain via dapp.json's `name` — the repo
slug stays `puzzlechain-6cf8ff` and localStorage keys keep their
`puzzlechain_`/`pc_` prefixes on purpose) is a **games hub** — a "chain"
of bite-size games sharing one lobby, each offering up to **three ways
to play** (#176):

- **Daily** — one seeded deal a day, ranked, the same board for
  everyone, one attempt. Solving pops a "Solved!" celebration and the
  card locks until midnight UTC. Wins build a **streak** that multiplies
  points.
- **Story** — a ladder of difficulty bands you clear and tick off. Pays
  once, on first clear.
- **Arcade** — endless, a fresh board every run, three difficulty bands.
  Pays only for landing higher: beating your own best, or crossing a
  rank threshold for the first time.

34 registry entries, 62 (game, mode) pairs. See "Play modes (#176)"
below — the mode table is the single declaration of what exists.

## Play modes (#176) — daily / story / arcade

**A play mode is a property of a CARD, not of a registry entry.** That
distinction is what keeps the whole feature cheap, and it is the first
thing to understand before touching any of it.

- **Registry ids never move.** `daily_attempts`, `classic_scores`, chat,
  leaderboards, badges and every deep link key off them. The four games
  that ship as two ids (Snake / Daily Snake, Bounce / Daily Bounce, Tile
  Match / Daily Tile Match, Mine Finder / Mine Finder Classic) keep BOTH
  and merge only on the home card. Nothing migrated.
- **`PLAY_MODES_BY_ID` (`public/src/29-cards.jsx`) is the declaration.**
  The home grid, the pre-game screen, the deep links and the self-tests
  all read it. Omissions there are decisions, and the comment says why
  for each one.
- **`scripts/check-registry.js` enforces the client↔server agreement**
  at build time (it runs as part of `npm run check`): the id sets match,
  every id declaring `daily` is in the server's `GAME_IDS`, and every id
  declaring `story` has a `STORY_BANDS` rung count. This pair used to be
  hand-mirrored under a "keep these in sync" comment. It is not any more
  — do not add a third copy of the same claim, extend the check.

### Things that are easy to get wrong here

- **Branch on the MODE, never on `game.daily`.** Seven classics (2048,
  Knight's Tour, Block Fit, Diamond Rush, Marble Loop, Hash Rush,
  Match-3) have a daily while keeping `daily: false` and their classic
  shell. `handleWin`/`handleLose` reading the registry flag sent their
  daily runs down the classic path, where they recorded nothing. Server
  side those entries carry `dailyMode: true`, and `GAME_IDS` derives
  from it.
- **Only a daily resumes.** `savedProgress`/`onSaveProgress` are the
  daily attempt row. A story run saving into it 409s, and READING from
  it would hydrate a half-finished daily into a rung that is supposed to
  be a fixed retryable deal. `resumable` in `renderGameBody` is the gate.
- **A real-time game's "Game Over" is a WIN everywhere but story.**
  Marble Loop, Bounce, Snake and Hash Rush report both endings through
  `onWin` because the score is the result. In story that ticks the rung
  you just failed, so they route through **`reportRunEnd`**, which sends
  an uncleared story run to `onLose` and leaves every other mode alone.
  A story rung must also END when its content is cleared — Bounce used
  to rebuild the same wall forever, so the rung could only be ticked by
  dying.
- **The arcade seed belongs to the RUN, and the shell owns the run.**
  `beginArcadeRun()` / `currentArcadeSeed()` in `05-core-lib.jsx`. A game
  that rolled its own seed inside `modeSeed` left the finish with nothing
  to store, so there was no board to replay — and games that call
  `modeSeed` twice for one run would have got two unrelated boards.
- **A story rung's board must be STABLE** (same seed every visit, so it
  is a rung you can retry) and an arcade board must not be (fresh per
  run). `modeSeed` is the one place that decides this.

### Arcade settlement

Arcade pays for leaderboard position, so a run is **anchored** before it
is played: `POST /api/arcade/:gameId/start` stamps `started_at`, and the
finish compares the claimed `timeSecs` against the server's own clock
(`ARCADE_TIME_GRACE_SECS`, 30s, generous — it only has to catch a claim
that could not have been played). A run that is unanchored, replayed
against a finished row, or claims materially more time than passed is
recorded **unverified**: it stays in the player's own history and it does
NOT touch `arcade_bests`, the rank, or the point total. The rule is
about the CLOCK, deliberately — a per-game score ceiling would be a
second copy of every game's scoring formula, and the daily's replay
harness already exists for the games that warrant that depth.

`arcade_runs` is trimmed to 50 rows per (user, game); the history screen
shows 25. Nothing else bounds that table — arcade is unlimited by design,
so it has no equivalent of the daily's uniqueness constraint.

### Replays are inert

Replaying a past arcade run goes through `practiceMode`, so `handleWin`
/`handleLose` stop before any endpoint. Without that, the cheapest way to
top an arcade board would be to replay the friendliest seed you ever drew
until you played it perfectly — the opposite of what a fresh-board mode
is for. The practice ribbon is rendered **once, pinned, at the game-screen
level** so it appears over all three shells; it used to live inside the
daily shell, which is why replaying 2048 showed no marker at all.

### A parameterised board and a canvas renderer

#176 made several boards VARY in size or length — Word Search runs 8×8 to 15×15,
Knight's Tour 5×5 to 8×8 with blocked squares, Drop Stack's arcade bag is 20000
pieces against the daily's 200, Mine Finder's ladder runs 6 to 38 mines. The
canvas renderers those games gained in #173 were written against the fixed
originals, so every one of them had a constant baked into the drawing loop, the
hit test, the pill row and the aria-label at once.

**A canvas board reads its dimensions from the run, never from the module
constant.** The constant stays as the free-play default; the component derives
`size`/`total`/`bagLen` from the board it was actually given and threads that
through `useFitBox`, the draw loop and the pointer math together — miss one and
the board draws at one size and is clicked at another. This bug class is silent:
it neither throws nor fails a parser, and at the default band it looks correct.

Nonogram was the last one holding a hard-coded `8` (#218), and it shows how far
the damage goes: the fit maths, the board width and `cellAt` all assumed 8×8
while the draw loop correctly walked `NG_ROWS`/`NG_COLS`, so story rungs 3 to 6
drew their trailing rows outside the canvas and could not be tapped — the win
was unreachable, not merely unannounced — and on 5×5 a tap past the edge threw
on `g[6][c]`. Geometry and hit-testing are now one pair of pure functions,
`ngGeometry`/`ngCellAt`, and `nonogram-board-bounds` round-trips every corner of
every band through both. Put a new parameterised canvas board behind that same
pair-of-pure-functions shape: it is the only version of this that a self-test
can check.

Related, and the reason the browser sweep exists: a merge that keeps the tail of
a block and drops the head leaves an identifier referenced but undeclared. That
is a `ReferenceError` at mount, which `npm run check` cannot see (it is valid
syntax) and which only mounting the game reveals.

### Offline-generated content

Two games cannot rate their own content at mount time and ship a corpus
in `public/corpus/` instead:

- **Klondike / Spider** (`scripts/rate-seeds.js`) ship rated SEEDS —
  `[[seed, band], …]` — because the deal is cheap to re-derive and it was
  RATING it that cost a search.
- **Crate Push** (`scripts/gen-sokoban.js`) ships LEVELS, because Sokoban
  generation is a search either way. 200 rooms across 8 bands, 3 pushes
  up to ~35, each carrying its exact minimum solution length.

`loadCorpus` handles both shapes and caches per game. **`startRun` and
`startPractice` await it**; the pre-game screen only WARMS it. That is
not belt-and-braces: `?game=cratepush&play=1` skips the pre-game screen,
and when the warm-up was the only fetch it dealt from the hand-built
fallback rooms every time — silently, because a graceful fallback is by
design invisible.

**How gen-sokoban works, and why it is worth reading before touching it.**
A push and a pull are exact inverses, so breadth-first expanding the
SOLVED position under pulls walks the forward push-graph backwards. Every
position it reaches is solvable by construction, and its BFS depth IS the
exact minimum solution length in pushes — one search per room instead of
one per candidate. Two rules fall out, both learned the hard way:

- **The search bound must fall BETWEEN whole levels.** Sampling states
  within a level means their successors are not discovered there and turn
  up later by a longer route: an earlier build shipped levels recorded at
  35 pushes that a forward solver cracked in 16.
- **Expanding a state and normalising its successors need SEPARATE reach
  buffers.** Sharing one meant the first successor's scan destroyed the
  map the move loop was still iterating against, silently allowing and
  forbidding later moves. It was present in both directions at once, and
  only the two disagreeing exposed it.

`node scripts/gen-sokoban.js --verify` re-solves the shipped corpus
FORWARD with an independent search and checks the recorded depths. Both
bugs above were caught by it and nothing else. Run it after any retune.

### Deep links

`?pmode=daily|story|arcade` opens a card in a play mode; `?band=` picks
the rung (story: 1-based) or difficulty (arcade: `easy|normal|hard`);
`&play=1` mounts the board. Deliberately not `?mode=`, which already pins
a classic's opponent. Checked BEFORE the mode-select branch, or 2048 and
Block Fit surface the opponent chooser instead.

Without these the story ladder, the band pickers and every board behind
them are reachable only by TAPPING a card button — which navigation-driven
proposal checks and screenshots cannot do, so none of #176 would have been
verifiable. `demo=modes` seeds a half-walked ladder plus arcade rivals and
run history.

### The card is the way in (flip-deck lobby — this replaced "one button per mode")

Until the flip-deck redesign, a card's tap target was its mode buttons and
never the card itself (the old rule, kept here so it is not re-litigated by
accident): a single-mode card that was one big hit area read as a different
kind of thing from its neighbours, so `29-cards.jsx` gave every card buttons,
head-to-head games included. That rule was about CONSISTENCY, and the redesign
keeps the consistency by going the other way: **every** card is now one button,
the card itself, and the ways to play are on its back.

- **Tapping a card opens it** (`DeckOpenCard`, `29b-flip-deck.jsx`): it lifts
  out of its row, grows and turns over, and its back is that game's pre-game
  panel — `PreGameScreen` with `variant="deck"`, so the bands, practice run,
  resume, guest play, How to play / chat / leaderboards are the same component
  the `?game=` route renders, not a second copy. Daily / Story / Arcade are tabs
  on the back. A card with no play modes says what its axis is instead (Choose
  an opponent → `OpponentScreen`; Escape from Dracula → Start reading).
- **The face still says what a card offers**: the mode icons sit in its
  bottom-right corner, and the Daily icon carries today's state (a brass ✓ once
  played, a brass dot while in progress) — the job the old DAILY ✓ / ▶ RESUME
  badge and the outlined daily button did.
- **Pin (#232) and Favorite moved to the card's back** (`DeckPanelActions`).
  Same anchor-id storage (`cardAnchorId` / `cardPinId`), same server routes.
- **The panel keeps its OWN mode and bands until Play** (`deckOpen` in App).
  `playMode`, `storyBand`, `arcadeBandId`, `dailyBandId` and `currentGame` are
  part of navState's page key: writing them while the card is open would push a
  history entry per tab and scroll the lobby to the top behind the card (#239).
  `deckPlay` writes them and calls `startRun` exactly as the pre-game screen's
  Play does. The open card is itself a navState overlay (`'card'`, like
  Settings), counted only while the screen is the lobby, so device back closes
  it and back from a game returns to it.
- **`?card=<game id or card key>`** opens a card already turned over, and
  **`&cmode=daily|story|arcade`** picks its tab — the back is otherwise behind a
  tap, which checks and before/after shots cannot make. Consumed once, after
  the day loads.

### One opponent screen for all seven head-to-head games

`OpponentScreen` (`07-ui-chrome.jsx`, `screen === 'opponent'`) is the
pre-game screen for a game whose axis is the opponent rather than the play
mode. Before it there were **two** first screens and neither was good:
Mancala and Snakes & Ladders dropped you onto the board, which then
rendered its own full-page picker; the five phase-5 board games opened a
modal over the lobby that listed the modes and nothing else. The modal was
also where bot difficulty went missing — the tiers existed and were plumbed
through to the search, and simply had no control on that path, which is why
Checkers and Gomoku only ever played at full depth.

- **One picker: `ClassicModePicker`.** It already handled bot strength,
  Ludo's 2–4 local seats, online create/join and Snakes & Ladders' board
  variants. Add the next per-mode option there and every game gets it, at
  first launch and from the ☰ menu's New Game alike.
- **`MancalaModeSelect` is deleted, deliberately.** It was a second copy of
  the same screen that predated the shared one, and it is what made Mancala
  look unlike the other six. `MancalaGame` now reads `gameMode` /
  `gameModeOpts` like `ChutesLaddersGame` does. **Don't re-add a per-game
  picker** — a game that needs something the shared picker lacks should
  declare it (see `variantPicker`, `roomApiBase`).
- **A live match's destructive control lives in the ☰ sheet, not under the
  board.** "🏳️ End game" used to sit eleven pixels below the board in both
  `MancalaOnlineGame` and `BoardOnlineRoom`, directly beneath the pits/cells
  a player taps — and for a Mancala seat 2 or a flipped board there is no
  "safe" side, because whichever row is yours is the one you tap (#201). The
  game publishes it into the sheet's "This match" group with
  **`useCgShellAction`** (`03-classic-shell.jsx`) instead: the game is
  ClassicShell's `children`, so it cannot pass a `sheetSections` entry, and
  this context is the channel. Two rules come with it — the hook's effect
  deps are the button's LOOK (label, disabled) and the handler is called
  through a ref, because `onSelect` closes over live state and gets a fresh
  identity every render; and the Menu tab now exists whenever there is
  EITHER a `menuConfig` or a published action, so a shell without a menu
  cannot swallow one. Publishing `null` (match not active) withdraws it, so
  a finished match stops offering to forfeit itself. The waiting-room
  "Close this room" button stays inline: that screen has no board to mis-tap.
- **`?room=<code>&seat=1|2`** enters a live online match directly. Entering
  one was otherwise possible ONLY by tapping a your-turn card on Home, so no
  proposal check and no before/after screenshot could reach the in-match
  chrome at all. It is checked before the `modeSelect` branch, like
  `?result=1` and `?pmode=`. `?demo=yourturn` re-arms active checkers room
  `DEMOYT` with the viewer as player 2, which is what the checks pair it with.
- **`roomApiBase`** is the whole accommodation for Mancala's older room
  routes (`/api/mancala/rooms`, its own table): the flow, the copy and the
  error handling stay shared. Create responses are read as
  `body.id || body.roomId` because the two shapes differ.
- **`rankedModes`** says which of a game's opponents post a score. Only
  Mancala's bot does (it has a verified-session leaderboard of its own);
  the five board games' bots are unrated by construction. Its old picker
  spelled that out with a 🏆 Ranked pill, so the shared one does too —
  moving a game onto a shared screen must not quietly drop the thing that
  told a player their result counts.
- It is a SCREEN and not a popup because it can then say what the game is —
  the first two `howToPlay` cards render inline as `.opp-brief` — before
  asking who you want to play against.
- **2048 and Block Fit land here too** (nine games in all, the nine with a
  `modes` list). Their axis is a score race rather than an opponent, so the
  chips and the heading come off `modes` — "Choose how to play", not
  "Choose an opponent". They also keep the retired modal's one good extra,
  the all-time leaderboard preview (`.opp-lb`).

### The How-to-Play modal never opens by itself

Phase 3's first-open auto-show is removed, along with its
`pc_howto_seen_v1` key. A modal in front of a board you just tapped is
something to dismiss, not onboarding; the pre-game and opponent screens
carry the short version inline and "❓ How to play" is always one tap away.

## App-specific conventions

This is a **single-page React 18 app** built by concatenation rather
than by a module bundler. Read this before editing the frontend — the
loading mechanism is unusual on purpose.

- **The frontend is `public/src/*.jsx` — 31 files, concatenated.**
  `scripts/build.js` joins them in the order declared by
  `public/src/ORDER` and runs esbuild's JSX transform over the result,
  emitting `public/app.js`. `index.html` loads that as a plain script.
  Run `npm run build`; the Dockerfile does it at image build time.
  (Before Aug 2026 this was a single 26k-line `public/app.jsx`. The
  split is provably behaviour-preserving: at that commit the
  concatenation was byte-identical to the old file and the compiled
  `app.js` did not change by one byte.)
  - **Still never add `import` or `export`.** The files are
    concatenated, not linked — one classic script, one global scope,
    exactly as before. Cross-file references just work.
  - **`ORDER` is load-bearing.** Anything read at evaluation time —
    the `css` template reads the palette, `GAMES` names every game
    component — must be declared in an earlier file. A new file that
    isn't listed in `ORDER` fails the build rather than silently not
    shipping.
  - Use the globals: `const { useState, useEffect, useRef } = React;`
    and mount with `ReactDOM.createRoot`. `React`/`ReactDOM` are on
    `window`.
  - `npm run check` compiles the same concatenation with Babel — a
    second, independent parser as a syntax backstop.
- **Don't touch these parts of `index.html`:** the `<script src="/app.js">`
  load and its watchdog/error shell, the `// usernode-dev-console@1`
  block (platform log forwarder), and the inline data-URI favicon
  (its absence triggers a `/favicon.ico` 401 that logs a console
  error and trips the no-console-errors check).
- **Design system lives in `public/src/00-palette.jsx` and
  `01-styles.jsx`:** a `const C` color-palette
  object and a single global `css` template literal injected via
  `<style>{css}</style>`. Add component styles to `css` and reuse `C`
  tokens (e.g. `${C.accent}`); don't introduce a second stylesheet.
  Fonts are Space Grotesk (body) + JetBrains Mono (`.mono`); the flip-deck
  lobby uses DM Serif Display (headings, card names) + Plus Jakarta Sans.
- **Theming — `C` is CSS custom properties, not hex.** `PALETTES.light`
  / `PALETTES.dark` hold the raw values (plus `DERIVED` for
  shadow/scrim/well/hover tokens); `paletteVars()` emits them into
  `:root` and `:root[data-theme="dark"]` at the top of `css`, and every
  `C.x` is the string `var(--c-x)`. Consequences when writing styles:
  - Keep using `${C.accent}` — it re-themes for free, in `css` and in
    inline `style={{}}` objects alike.
  - **Never concatenate an alpha byte onto a token** (`${C.gold}1f` is
    broken now — `var()` isn't a hex string). Use **`ca('gold','1f')`**,
    which emits `rgb(var(--c-gold-rgb) / 12.2%)`.
  - **Canvas needs real colours**: `ctx.fillStyle = C.bg` draws nothing.
    Read from **`PAL`**, the live plain object `applyTheme()` keeps in
    sync with the resolved palette. If a canvas game caches colours,
    store palette **token names** and resolve via `PAL[name]` at draw
    time (see `BOUNCE_ROW_COLORS`) so a theme flip recolours mid-game.
  - Reach for `var(--c-shadow-sm|md|lg)`, `var(--c-scrim)`,
    `var(--c-well)`, `var(--c-well-strong)` and
    `var(--c-accent-hover|emerald-hover|gold-hover)` instead of
    hand-writing rgba shadows/scrims or hand-darkened hues.
  - **Intrinsic game art stays hardcoded on purpose** — Mancala's
    carved wood, checkers browns, Reversi felt, the goban, playing-card
    faces/suits, Mahjong ivory, and the 2048 / Tile Match / Drop Stack /
    tetromino palettes do NOT follow the theme. Only chrome re-colours.
  - The **preference** (`'system' | 'light' | 'dark'`, default
    `'system'`) lives in localStorage under `puzzlechain_theme`, device-
    local like every other pref. `applyTheme(pref, persist)` is the only
    writer; `useTheme()` → `{ pref, resolved, setPref }` is how
    components read it. A module-scope `prefers-color-scheme` listener
    re-resolves live while the pref is `'system'`.
  - `public/index.html` carries an **inline pre-paint script** that sets
    `data-theme` before the first style block (no ivory flash for
    dark-mode players) plus a self-contained dark boot-shell block. It
    duplicates the storage key and resolution rule from
    `public/src/02-prefs-theme.jsx` on
    purpose — **keep the two in sync**. `?theme=` and `?settings=1` are
    the deep links proposal tests use.
  - The control is `ThemeChoice` (a System/Light/Dark segmented control),
    rendered by `CgSettings` so the global `SettingsSheet` (⚙ in the nav,
    ⚙ Settings row on your own profile) and a classic game's ☰ →
    Settings tab always agree. **Minesweeper's private light/dark button
    was removed** — its board reads the resolved theme through
    `data-ms-theme` now (its base `.ms-*` rules are dark and
    `[data-ms-theme="light"]` overrides them). Don't re-add per-game
    theme toggles.
- **Shared timer:** `useTimer(running, initialSecs = 0)` counts **up**
  from `initialSecs` and returns `{ secs, fmt }`. Pass `!done` so it
  stops when the round ends; pass a saved elapsed value as `initialSecs`
  to **resume** the timer where a player left off.
- **Deterministic daily boards — server-issued seeds (phase 2):** all
  daily games derive their board from **today's server-issued seed**
  (the `daily_seeds` table, one row per game per UTC day, created
  lazily on first request and returned by `GET /api/daily`, `/start`,
  and the public `GET /api/public/daily`). Use `dailyRng(offset,
  gameId)` (server seed → `mulberry32`; falls back to the legacy
  UTC-day derivation when no seed arrived, so a partial deploy can't
  blank the dailies) and thread it through your generator instead of
  `Math.random()`. Never seed from raw `Date.now()`. NOTE: the
  server's seed **generation policy currently issues the
  legacy-derivation value** (`legacyDailySeed` in `server.js`) so both
  paths agree byte-for-byte; switching to unpredictable per-day seeds
  is a server-side knob for the Game-of-the-Day phase — flip it only
  at a UTC boundary.
- **Adding a game** (the extension point): write an
  `XxxGame({ onWin, onStepChange })` component that
  - renders a `.status-bar` of `.pill`s for its live stats,
  - calls `onStepChange(n)` as the player makes moves,
  - calls `onWin(score, steps, secs)` **exactly once** when solved;
  then add its CSS to `css` and append a **fully-declarative** entry
  `{ id, name, icon, category, shell, daily?, desc, tag, tagColor,
  component }` to the `GAMES` array. The root `App` reads those flags
  to auto-wire the lobby card, the daily one-play lock, the streak
  **multiplier** (see "Streak multiplier tiers" below), and the win
  overlay — the game component never touches that machinery.
  - **`id` is mandatory** and must match the server's `GAME_REGISTRY`
    key (it keys the lobby card, `attempts[id]`, posts, leaderboards,
    and the daily routes). A missing `id` silently breaks those lookups.
  - **`category`** is the lobby tab (`'daily'` or `'classic'`).
  - **`shell`** declares how `App` renders the game body (a single
    `switch` in `renderGameBody`, no per-id special-casing):
    - `'daily'` — back-header `game-wrap`; the component also receives
      `savedProgress` / `onSaveProgress` for resumability. Use for daily
      puzzles (and any plain back-header game).
    - `'classic'` — wrapped in `ClassicShell` + `.cg-stage.cg-scroll`
      (the standard in-frame classic layout).
    - `'self'` — the component renders its **own** `ClassicShell`
      (full-screen, gesture-first; it gets `game` + `onBack` too).
  - **`daily: true`** marks the four daily games and is the **single
    gate** for the per-day start/lock/finish/streak/resume machinery —
    `launchGame`, `handleWin`, and `handleLose` all branch on
    `!game.daily`. Omit it (falsy) for classic games.
  - The client `GAMES` array and the server `GAME_REGISTRY`
    (`server.js`) are two separate objects (one needs React
    components, the other DApp tiers) that must be kept **in sync** by
    `id` and `category`, exactly as `GAMES`↔`GAME_IDS` were before.
  - **Optional win/loss extras (backward-compatible).** `onWin` accepts
    an optional 4th `meta` arg — `onWin(score, steps, secs, { share })` —
    and `App` stashes `meta.share` so the win overlay can show a **Share**
    button (copies the string to the clipboard). For games that can be
    *lost* (e.g. Crypto Wordle), `App` also passes an optional
    `onLose(steps, secs, { share, answer })` prop: call it **once** when
    the round is lost. `handleLose` records a finished row with `score: 0`
    (so the day still locks) **without** incrementing the streak, and
    renders a loss overlay that reveals `answer` plus the same Share
    button. Win-only games simply never call `onLose` and ignore the
    extra props — no change needed. Games that need the server-anchored
    UTC day (e.g. a deterministic daily word) also receive `offset`
    (`serverNow − clientNow`, ms).
  - **Resumability (backward-compatible).** `App` also passes
    `savedProgress` (the merged in-progress state for today's claimed,
    unfinished attempt — `null` on a fresh start) and
    `onSaveProgress(progressObj, steps, secs)`. A resumable game should:
    on mount, hydrate from `savedProgress` **only when**
    `savedProgress.dayNum === utcDayNum(offset)` (and seed `useTimer`'s
    `initialSecs` from `savedProgress.elapsedSecs`); store its
    *mutable player state* in `progressObj` as `{ dayNum, … }` (the board
    itself is re-derived from the daily seed, so only moves go here); and
    call `onSaveProgress` on every meaningful move. Idle timer-advance
    and tab-close saves are handled for you by the shared `useAutosave`
    hook — `useAutosave(onSaveProgress, () => ({ progress, steps, secs }),
    !done)`. Per-game progress shapes today: sudoku `{ dayNum, grid }`,
    wordhunt `{ dayNum, found: [...words] }`, cryptowordle
    `{ dayNum, rounds: [[...guessStrings], ...], hintsByRound: [...ints] }`
    (multi-word: one guess-list + applied-hint count per daily word round),
    tilematchingdaily
    `{ dayNum, tiles: [...], bar: [...ids], moves, boosters }` (the tile
    snapshot is stored in full because the shuffle booster moves tiles).
    The lock is **finished-aware**:
    a row with `finishedAt` set is locked; a claimed-but-unfinished row
    resumes into the game (lobby card shows "▶ In progress · resume").
  - **Daily leaderboard.** The win overlay and `LockedScreen` render a
    `<Leaderboard gameId solved />` that calls
    `GET /api/daily/:gameId/leaderboard` (today's solvers ranked by
    fastest `time_secs`, then fewest `steps`), highlighting the current
    user and pinning their row when outside the top N. New games get this
    automatically; no game-component work needed.
  - **Also add the new `id` to `GAME_IDS` in `server.js`.** The daily
    routes validate `:gameId` against that set and reject unknown ids
    with `400`, so a game that's in `GAMES` but not in `GAME_IDS`
    silently fails to start. Keep the two in sync.

## Persistence — Postgres-backed daily attempts

As of the daily-lock feature, this app **has a database**. Don't
describe it as static-only.

- **`server.js`** is still the Express + JWT auth gate, but now also
  opens a single `pg.Pool` from `DATABASE_URL` and runs an idempotent
  `CREATE TABLE IF NOT EXISTS` migration on boot before listening.
- **Table `daily_attempts`** (PUBLIC — gameplay results, no sensitive
  data) stores one row per `(user_id, game_id, attempt_date)` with a
  `UNIQUE` constraint on that triple. `attempt_date` is the UTC day,
  computed server-side as `(now() AT TIME ZONE 'utc')::date`. The day
  **resets implicitly at midnight UTC**: a new date yields rows that no
  longer match today's lookups — there is no cron/cleanup. `score`,
  `steps`, `time_secs` are nullable (null between start and finish).
  Two more nullable columns back **resumability**: `progress JSONB`
  (game-specific in-progress moves) and `elapsed_secs INTEGER`
  (accumulated active timer). They're written during play and ignored
  once `finished_at` is set.
- **Auth-gated API** (all under `/api/`, so the existing deny-by-default
  middleware requires `req.user` — do **not** whitelist these):
  - `GET /api/daily` — today's state for the signed-in user: `user`
    (`{ username, id, usernodePubkey }`), `serverNowUtc`,
    `nextResetUtc` (next 00:00 UTC), `streak` (server-computed
    consecutive-day count — see below), and `attempts` keyed by
    `game_id`. A present key = that game is locked today.
  - `POST /api/daily/:gameId/start` — **consume-on-start**: claims the
    day's single attempt via `INSERT … ON CONFLICT DO NOTHING
    RETURNING *`. Empty result ⇒ already used ⇒ `409` (locked) with the
    existing row.
  - `POST /api/daily/:gameId/finish` — records `score/steps/time_secs`
    on today's already-claimed row, and returns the freshly recomputed
    `streak` so the client reconciles its optimistic value.
  - `POST /api/daily/:gameId/progress` — **autosave**: updates today's
    claimed, **unfinished** row with `progress/steps/elapsed_secs`. Never
    creates a row and never touches `finished_at/score`; a finished row
    is immutable here (`409` "No active attempt to save").
  - `GET /api/daily/:gameId/leaderboard` — today's solvers for one game
    (finished with `score > 0`, so Crypto Wordle losses are excluded),
    ranked `time_secs ASC, steps ASC, finished_at ASC`. Returns
    `{ entries: top-N, me, total }`; `me` is the current user's row/rank
    even when outside the top N (`null` if they haven't solved today).
- **Identity comes from `req.user`** (the iframe JWT), never the client.
  Progress is keyed to the Usernode account and persists across reloads
  and devices. The nav's `AccountChip` reads `user` from `/api/daily`
  to show the signed-in username on one line (nothing renders while the
  load is in flight or when the backend is unreachable). Tapping it opens
  the viewer's own profile screen (stats, recent games, badges). Signed
  out, it is a quiet "Sign in" button that opens the platform bridge's
  account sheet (`askForAccount`, top-level page at the app's own address
  only), or a plain "Guest" label where the bridge has no sheet (inside
  a frame). It is never an error state: signed out is how a visitor
  without an account plays.
- **Frontend** hydrates this on mount (`loadDaily`), claims on launch,
  persists on win, and renders a `LockedScreen` with an HH:MM:SS
  countdown driven by a **server-time offset** (`serverNowUtc −
  Date.now()`) so a wrong device clock can't unlock early.
- **Staging seed:** `GET /api/daily?demo=locked` (gated on
  `IS_STAGING`) upserts one finished `sudoku` attempt for the current
  viewer so the locked screen is demonstrable on a fresh staging DB.
  `GET /api/daily?demo=streak` (also `IS_STAGING`-only, idempotent)
  upserts finished `sudoku` attempts for the **10 UTC days before
  today**, giving the viewer a 10-day streak so the multiplier UI is
  demonstrable; today is left open so a tester can trigger a multiplied
  win. `GET /api/daily?demo=leaderboard` upserts ~6 obviously-fake
  solvers ("Staging demo Ada/Borg/…") per game for today so the per-game
  leaderboard ranking + tiebreakers are demonstrable.
  `GET /api/daily?demo=resume` upserts one **claimed, unfinished**
  `wordhunt` row for the current viewer (partial timer/steps) so the
  "In progress · resume" card and resume flow are demonstrable. It uses
  `wordhunt` (not `sudoku`) on purpose: `demo=locked`/`demo=streak`
  finish the viewer's sudoku row for today, and proposal checks share
  one staging DB, so a sudoku resume seed would collide and render
  locked instead. All strict no-ops in production.
- The nav **`Score`** is rehydrated from today's finished attempts.
  A per-game **daily leaderboard** now ships (see the API above);
  cross-day / all-time history remains **out of scope** (the public table
  leaves room for it).

## Streak multiplier tiers

The **streak is a real consecutive-day count** with **GotD-participation
semantics** (spec §6.3): server-computed in `computeStreak(userId)`, a
UTC day counts toward the streak only when that day's FEATURED game (its
`daily_featured` row) has a finished attempt — days before
`GOTD_STREAK_CUTOVER` (`server.js`, next to `GOTD_WEIGHTS`) keep the
legacy any-daily rule, grandfathering every previously earned day so the
changeover reset nobody. The unbroken run ends today (or yesterday if
today isn't played yet — a streak stays alive until a full day is
missed). It persists across reloads/devices and is returned as `streak`
from `/api/daily` (and refreshed by `finish`). Client-side,
`handleWin` extends the optimistic streak only for a first
featured-game win of the day; other dailies still earn points/badges at
the current day count. The `demo=streak`/`demo=badges` fixtures seed
prior days via `seedFeaturedStreakDays` (featured-game attempts + their
`daily_featured` rows) so they hold under the new rule.

The **all-time best daily streak** (#362) lives in
`user_stats_snapshot.best_daily_streak` — a lazily backfilled high-water
mark, not a recomputed value. NULL means "not backfilled yet": the first
`GET /api/daily` after the migration runs `computeBestStreak` (same
counted-day rule as `computeStreak`, shared `STREAK_DAYS_WHERE`, no
60-day cap, longest consecutive run) once and stores it, so a player
with history gets a real best straight away and one with none stores 0.
`finalizeDailyAttempt` bumps it with `bumpBestStreak` (GREATEST upsert,
so racing finishes are order-independent) on every finish; it only ever
rises. It is returned as `bestStreak` from `/api/daily` and `/finish`
and shown beside the current streak in the card's gold pill (#313's
`card-streak`), with `cardProps` passing `Math.max(bestStreak, streak)`
so an optimistic bump never under-shoots it. Streak rules themselves
are untouched.

The streak multiplies points via **tiers**, defined once in
`STREAK_TIERS` (`public/src/05-core-lib.jsx`) and applied client-side in
`streakMultiplier(streak)`:

| Streak (consecutive days) | Multiplier |
|---|---|
| 0–2 | 1.0× |
| 3–4 | 1.1× |
| 5–9 | 1.2× |
| 10–19 | 1.5× |
| 20+ | 2.0× |

- **Where applied:** `handleWin` computes `effectiveStreak` (the day's
  first win extends the streak by 1; a second game the same day reuses
  the same day count — the multiplier is per-day, not per-game), then
  `finalScore = round(base × streakMultiplier(effectiveStreak))`. The
  client persists `finalScore` via `finish`; the server stores it as-is
  (no server-side multiplier math today — see below).
- **Surfaced in UI:** a `×N` `.mult-badge` next to the nav Streak and a
  multiplier row in the win overlay (both hidden at 1.0× or when signed
  out). The masthead's streak/next-tier hint line was removed in the
  home/profile cleanup pass.
- **Tier table is the single balance knob** — editing `STREAK_TIERS`
  changes breakpoints/multipliers everywhere.
- **Deferred:** server-authoritative scoring (server applies the
  multiplier in `finish` instead of trusting the client `finalScore`)
  matters only if a leaderboard ships; the displayed multi-day streak
  has **no** grace-day/freeze — a missed UTC day resets it to 0.

## The flip-deck lobby

The home screen is a card table, in **felt in both themes** — like a game
board, it does not follow light/dark (its colours are fixed in the `.fd-*`
rules and the `.fd-lobby` / `.fd-ov` custom properties, and `html.felt-page`
paints the overscroll). Every screen past the lobby still follows the theme.

- **Files.** `29a-deck-art.jsx` — every card's picture, as DATA: a list of
  positioned "bits" on a 150 × 100 grid drawn by `DeckArt` (memoised; the lobby
  re-renders every second for its countdowns). The scene is cover-cropped into
  a square on the card, so what matters sits in x 25..125. `29b-flip-deck.jsx`
  — shelves, the card face (`DeckFace`, memoised on primitives), the card button,
  the Game of the day banner, the open card and its panel pieces. Both are in
  `ORDER` after `29-cards.jsx`.
- **Coverage is asserted.** `DECK_SHELF_OF` (card key → Puzzles / Words /
  Arcade / Board & cards) and `DECK_ART` must cover exactly `GAME_CARDS`; the
  `deck-coverage` self-test fails the build otherwise. **Adding a game means
  adding its shelf and its scene.**
- **Order of the home:** Game of the day (its card, tilted; Play opens it on the
  daily) → Today (day streak · best, and today's points — the old nav Score /
  Streak) → Today's dailies (one row, `deckDailyOrder`: in progress, the game of
  the day, then by all-time points earned as the measure of how much you play
  it, then the ones done today) → Your matches (online rooms only, and only when
  there is one — the only way back into a match) → All games (search, shelf
  chips + Favorites, a Pinned shelf, then a shelf per category; a chip or a
  search shows one grid).
- **Retired with it, deliberately:** the masthead, the "New this week" strip
  (What's new is a row in Settings now), the daily checklist (the dailies row
  is it), Recently played, Today's Top Scores on the home (the game's own
  leaderboards are on its card's back), the Daily / Classic chips and their
  Completed-today split (`?tab=daily|classic` land on All), the streak pill on
  every card (#313/#362 — the Today strip carries the streak and the best), and
  the bar's Score, Streak, Friends, theme and settings buttons (the bar is the
  mark and your avatar; Friends and Settings are on your profile; signed out,
  the gear stands in for the avatar). The game of the day's GotD-only board
  (`/api/daily/leaderboard/today`) is no longer read by the client.
- **The dailies row is keyed on its first card.** A scroll-snapped row keeps its
  snap on the same card when cards are inserted ahead of it, so when the day
  loads and the game of the day moves to the front, an un-keyed row opens one
  card in, hiding it.

## Game Corner phase 2 — harness formalization

Phase 2 of the Game Corner evolution added four things; keep them in
mind when touching the daily flow:

- **Registry manifest metadata.** Both `GAME_REGISTRY` (`server.js`)
  and `GAMES` (`public/src/28-registry.jsx`) now carry a per-game `manifest`:
  `{ scoreDirection, tieBreak, sessionLength, input, undo }` — the
  machine-relevant fields **must match by id across the two files**.
  The client entries additionally carry `howToPlay` card copy
  (`[{ title, body }, …]`), consumed by phase 3's shell-owned chrome
  (see below). `tieBreak` is the symbolic rule
  the leaderboard SQL implements (`'time-then-steps'` for dailies,
  `'first-to-score'` for classic all-time boards) — parameterize the
  SQL off it when the daily pool widens beyond fastest-solve games.
- **Server-issued daily seeds.** See "Deterministic daily boards"
  above. `daily_seeds` is PUBLIC (shared-by-definition data); rows are
  lazily upserted via `ensureDailySeed`, per-process cached per day.
- **Daily finishes route through `game_sessions` + `validateSession`.**
  `POST /api/daily/:gameId/finish` accepts optional `moves`
  (`[{ …, tsClient }]`, capped at 800) and `replay: bool`, collected
  client-side by App's shared `dailyRunLog` (the Daily Tile Match
  reports engine-shaped `{ tileType }` moves via `onMoveTile`; other
  dailies get their `onStepChange` calls logged as timestamp events).
  `settleDailySession` then runs **tier A** (full server-side replay
  re-simulation through `lib/dapp.js`'s engine + hash-chain ledger)
  when an engine exists and the run is replay-eligible, else **tier B**
  (snapshot chain + `antiCheat` timing heuristics + a wall-clock
  plausibility check). Replay eligibility breaks on resume and on
  boosters (`replayBreak` events) — those runs settle as tier B. A
  `disputed` verdict never blocks the attempt; it only withholds the
  win overlay's Verified badge. Sessions are bound to the server
  daily seed — the anchor phase 8's anonymous-commit check verifies
  against.
- **Public read allowlist.** `PUBLIC_API_GET` (regex list next to
  `PUBLIC_API_PATHS`) opens GET routes to anonymous callers:
  `GET /api/public/daily` (server time, reset, seeds, game directory —
  the signed-out substitute for `GET /api/daily`; the client falls
  back to it when signed out so the signed-out lobby stays
  server-anchored), plus the daily, classic, arcade, all-time and ladder
  leaderboards (all null-guard `req.user`: anonymous ⇒ `me: null`,
  `isCurrentUser: false`). Anonymous hits go through a simple
  in-memory per-IP sliding window (60/min, `publicRateLimited`);
  token-bearing traffic is not limited. Everything mutating stays
  deny-by-default — add new public reads to `PUBLIC_API_GET`
  consciously, with the same null-guard discipline.
- **Signed-out play is what Homeroom lists.** Homeroom's app directory
  shows "Try it" or "Sign in to use" from a probe that fetches `GET /`
  and `GET /api/` with no credentials; a 401 from `/api/` reads as
  "account required". So `GET /api` (with or without the slash) answers
  anyone with `{ app, signedIn }`, and `GET /api/daily` answers a
  signed-out caller `200 { signedIn: false }` rather than a 401, which
  the browser logs as a console error on every guest's first load. Keep
  both open, or the app goes back to being listed as sign-in only.
  A signed-out WRITE is answered `401 { error: 'account_required' }`,
  the answer the platform's edge gives a guest's browser writes, which
  the bridge turns into its "Make an account to continue" sheet; a
  signed-out read keeps `{ error: 'Not authenticated' }`, which it
  leaves alone. A guest-persona check (`"persona": "guest"` on `/`)
  holds the signed-out lobby to a clean console.

## Game Corner phase 3 — shell-owned chrome

Phase 3 gave the daily flow standard, shell-owned furniture. Key
pieces (all under `public/src/`):

- **Pre-game screen (`PreGameScreen`).** Opening a daily game now lands
  on `screen === 'pregame'` — game identity, manifest chips
  (session length / input / undo), personal best, streak, the reset
  countdown, and the "everyone plays this exact deal today" line.
  **Consume-on-start moved to the Play button**: `launchGame` only
  navigates; `startDailyRun` does the `/start` claim (or resume), so
  browsing the pre-game screen never burns the day's attempt. Personal
  bests come from `GET /api/daily`'s new `bests` map
  (`{ gameId: { score, timeSecs } }`, all-time, server-computed).
- **How-to-Play modal (`HowToPlayModal`).** Renders the manifest's
  `howToPlay` cards, reachable from the "?" on the pre-game / opponent
  screen, the daily in-game header and the ClassicShell topbar
  (`onHowTo` prop). It **never opens by itself** — the phase-3
  first-open auto-show and its `pc_howto_seen_v1` localStorage key were
  removed, because a modal in front of a game you just tapped is a
  thing to dismiss before playing, not onboarding. The pre-game and
  opponent screens carry the short version inline instead; the modal is
  the long form, on request.
- **End screen.** The existing shell-owned win overlay is the standard
  end screen (score breakdown: base → streak bonus → earned; share
  CTA; leaderboard; Verified badge). Phase 3 added the personal-best
  row ("🏅 New personal best!" when beaten, sourced from `bests`).
- **`?play=1` deep-link param** skips the pre-game screen and
  claims/mounts immediately — the pre-phase-3 behaviour. Proposal tests
  that assert on in-game UI use it; plain `?game=` deep links land on
  the pre-game screen.
- Classic `shell: 'self'` games (Snake, Block Blast, Diamond Rush,
  Hash Rush) render their own shell — extending the "?" affordance into
  their headers is the remaining game-by-game work.

## Game Corner phase 4 — leaderboard upgrades

- **Friends scope.** The daily per-game leaderboard, the cross-game
  "Today's Top Scores" board (formerly "Today's Champions"), and the classic all-time leaderboard all
  accept `?scope=friends`: same query filtered to the caller + the
  people they follow (`user_follows`), ranks recomputed within the
  filtered set. Anonymous callers get an empty board (no follow
  graph). Client-side every board renders shared `LbScopeTabs`
  (Global | Friends); `?lbscope=friends` in the URL preselects the
  Friends view (proposal tests use it). Boards with a custom `url`
  (snake, breakout) stay single-scope.
- **Rating ladder.** New PUBLIC `game_ratings` table (one row per
  user × head-to-head game: elo, win_streak, best_streak, W/L/D, and
  a `week_start_elo`/`week_start_date` snapshot so "weekly movers" =
  `elo − week_start_elo` needs no history table). `applyMatchRating`
  (K=32, start 1000, draw=0.5) settles both players; it's called from
  the four finish paths that transition a match to finished exactly
  once — Mancala move (CAS), Chutes & Ladders move (CAS), race
  both-scores-in (CAS), and the forfeit endpoint (now guarded on the
  active→finished transition; still idempotent for repeat calls).
  `H2H_GAME_IDS` = mancala, chutes-ladders, 2048, blockblast.
  `GET /api/ladder/:gameId` (public, null-guarded, in
  `PUBLIC_API_GET`) returns entries ranked elo → win_streak →
  earliest-updated, plus `movers` (top weekly climbers) and the
  pinned `me` row. The client's **Ladder lobby tab** (`?tab=ladder`)
  renders it with a game picker.
- **Friend search (home/profile cleanup pass).** The Friends screen
  carries a debounced search box backed by auth-gated
  `GET /api/social/search?q=` (≥2 chars, ILIKE with escaped wildcards,
  excludes the caller, LIMIT 20, returns `following` per row —
  deliberately NOT in `PUBLIC_API_GET`); "＋ Add friend" is an instant
  one-directional follow (no request/accept model). `?screen=friends`
  deep-links the screen.
- **Staging fixtures:** `demo=friends-lb` (fake "Staging friend …"
  users the viewer follows, with today's attempts + classic scores),
  `demo=friendsearch` (4 fake "Staging seeker …" `users` rows the
  viewer does NOT follow, so searching "Staging" returns addable
  results), and `demo=ladder` (8 "Staging rival …" ratings across
  chutes-ladders/2048 with varied streaks and week deltas, a viewer
  row, and backing finished `classic_rooms`). All idempotent,
  IS_STAGING-gated, seeded via `GET /api/daily?demo=…`; the ladder
  tab renders only after `loadDaily` settles so the fixture lands
  before the ladder fetch.

## Game Corner phase 5 — turn-based rules registry + board games

- **Rules registry (`lib/board-rules.js`).** Pure, DB-free rules
  modules shaped like `lib/dapp.js`'s `gameEngines`, one per
  turn-based game: `initialState()` (must include `currentPlayer`)
  and `applyMove(state, player, move)` → `{ state, gameOver, winner }`
  (throws on an illegal move; the endpoint surfaces it as a 400).
  Mancala's pure rules (`srvMncDistribute`/`srvMncApplyMove`) and the
  Chutes & Ladders roll logic were EXTRACTED here from server.js —
  server.js re-imports the mancala functions under their old names so
  the bot AI / ZK replay / daily-challenge call sites are untouched.
  Dice games own their randomness server-side (`crypto.randomInt`).
  `boardRules.selfTest()` runs at boot next to the dapp self-test.
- **Five new board games** — Checkers, Reversi, Four in a Row, Gomoku,
  Ludo (`BOARD_RULE_GAME_IDS`) — run on the EXISTING classic_rooms
  infrastructure: create/join by room code, turn ownership from
  `state.currentPlayer`, `move_seq` CAS, 1.5s polling, the guarded
  forfeit endpoint, and ladder rating on finish (all five are in
  `H2H_GAME_IDS`). The generic move endpoint dispatches on the
  registry; the move payload is game-specific under `{ move: {...} }`
  (chutes' legacy top-level roll body still works). They are
  **online-only and tier C**: the server referees every move, so the
  client (`BoardRoomGame` → `OnlineRoomSetup` + `BoardOnlineRoom` +
  per-game `BOARD_VIEWS` renderers) only renders polled state and
  submits move intents — no client-side rules to drift.
  - Checkers: captures not forced; multi-jump keeps the turn
    (`mustJumpFrom`); promotion ends a chain; no pieces/no moves loses.
  - Reversi: auto-pass when a side has no reply; disc count on double
    pass. Four in a Row: 7×6, draw on full board. Gomoku: 15×15,
    five-or-more wins. Ludo: relative token positions (−1 base,
    0–50 ring, 51–56 home column, 57 home), roll→move phases, 6 leaves
    base and re-rolls, ring captures except safe start cells, exact
    roll to finish.
- **Staging fixtures:** `demo=ladder` now also seeds checkers/reversi
  ratings; `demo=boardroom` (re-)arms a WAITING Checkers room with
  code `DEMOBG` whose state starts at `currentPlayer: 2`, so a tester
  who joins it moves immediately against a fake opponent.

## Game Corner phase 6 — shared card/tile engine + Lane A dailies

Phase 6 added a small client-side **card/tile engine** and eight new
daily games riding it (`public/src/24-engine-cards.jsx`, "Phase 6 —
Shared card/tile engine + Lane A daily games"):

- **Engine primitives:** `ceDeck(nDecks, suits, rng)` /
  `ceShuffle(arr, rng)` (Fisher-Yates over the shared mulberry32
  family — same PRNG as `lib/dapp.js`'s tile generator), the shared
  `<CeCard>` / `<CeSlot>` renderers, and the Mahjong layered-tile
  helpers (`MJ_LAYOUT`, `mjIsFree`, `mjDeal`) — `mjDeal` uses
  **reverse-removal dealing** so every daily board is solvable in at
  least one order (the same layer/overlap model as `tileBoard` in
  `lib/dapp.js`, with solvability added).
- **Eight new dailies**, ids `klondike`, `spider` (1-suit, 8 decks of
  spades), `mahjongsol`, `nonogram`, `minefinder`, `anagrams`,
  `cratepush`, `dropstack`. All are `category: 'daily'` + `shell:
  'daily'` + `daily: true`, so the existing machinery picked them up
  with zero route changes: server-issued seeds (`ensureDailySeeds`
  loops the derived `GAME_IDS`), consume-on-start locks, resume,
  streak multipliers, per-game leaderboards, pre-game/How-to-Play
  chrome, and `demo=leaderboard` staging rows (that fixture loops
  `GAME_IDS` too).
- **Validation tier:** all eight are **tier B** in `GAME_REGISTRY` —
  finishes settle through `settleDailySession`'s snapshot + timing
  heuristics (their `onStepChange` calls feed the shared
  `dailyRunLog` automatically). Registering a per-game engine in
  `lib/dapp.js` flips one to tier A without touching game code.
- **Loss paths:** `minefinder` (mine tap), `mahjongsol` (stuck with
  no shuffles left), and `dropstack` (top-out) call `onLose` — the
  day locks with score 0, streak not extended, like Crypto Wordle.
- **Win-move autosave rule:** these games deliberately **skip the
  progress save on the winning move** — the finish call closes the
  attempt immediately and a racing progress write 409s against the
  finished row (harmless but logs a console error, which trips
  proposal checks). Keep that pattern for future dailies.
- **IP hygiene (spec §8):** names are generic on purpose — "Nonogram"
  not "Picross", "Drop Stack" not "Tetris" (own palette, no trade
  dress), "Crate Push" not "Sokoban", "Anagram Sprint" not "Boggle".
  Keep it that way when touching copy.
- **Determinism quirks:** `cratepush` picks one of ten hand-authored
  always-solvable rooms (`CP_LEVELS`) via the daily seed; `dropstack`
  derives a fixed **200**-piece bag sequence; `anagrams` picks 2×5 + 2×6 +
  1×7 words from in-file pools. Progress shapes: klondike/spider
  `{ dayNum, st }` (full serialized deal state), mahjongsol
  `{ dayNum, faces, removed, shuffles, pairs }`, nonogram
  `{ dayNum, grid, mistakes }` (the counter added by #218; a save without it
  hydrates as 0), minefinder `{ dayNum, revealed, flags }`,
  anagrams `{ dayNum, solved }`, cratepush `{ dayNum, player, crates,
  moves }`, dropstack `{ dayNum, grid, pieceIdx, lines, points, level,
  hold }` (the last two added by the phase-9 rebuild; hydration still
  accepts the old shape and derives `level` from `lines`).
- The frontend was a single `app.jsx` through this phase; it was split
  into `public/src/*.jsx` in Aug 2026 (see "App-specific conventions").

### What makes a good Daily Tile Match board (issue #116)

Recorded here because the original board was **trivial** and the reason
was structural, not cosmetic. The pre-phase-9 daily dealt 72 tiles as
8 icons × 3 triples into a **fixed stack** (40 bottom / 28 middle /
4 top) — the same silhouette every single day, with only the icons
moving. About 22 tiles were tappable at once across just 8 types, so a
matching triple was nearly always available, and with 7 tray slots
against 8 types you essentially **could not be trapped**. There was no
dead end to avoid and no ordering decision that mattered; the only
variable was how fast you could tap 72 times. Winning always paid a
flat 150 points.

Three properties make one of these boards actually a puzzle, in order
of importance:

1. **Solvable but not trivially solvable.** A winning order must always
   exist, but plenty of orders must lose — otherwise nothing you do is
   a decision. `tmDealSolvable` guarantees the first half by dealing
   with **reverse-removal**: it fills slots in a random linear
   extension of the coverage order (a slot may only be filled once
   everything beneath it is filled), then chunks that fill order into
   triples. Removing in the reverse of the fill order is therefore
   always legal. This is the same technique `mjDeal` uses for Mahjong
   Solitaire, and it becomes **mandatory** once a board is tight enough
   to lose on.
2. **Type count is what makes the tray bind.** This was the surprise:
   difficulty is governed far more by the number of icon types than by
   how many tiles are free. 12 types against 7 slots means you can
   genuinely fill the tray with junk; 8 types cannot.
3. **Triples split across layers.** Chunking the fill order into
   triples naturally straddles layer boundaries, so a set's third tile
   is often buried under tiles you'd otherwise clear first — which is
   what punishes greedy top-first play.

**Balance note — a deliberate deviation from the original plan.** The
plan called for reducing the free-tile count to 8–14. Measured against
a competent solver, that combination (12 types AND ~10 free tiles) was
near-unwinnable at roughly 3%: with no choice of tile you cannot steer
away from a jam. The free-tile count is therefore left in the 30s and
the difficulty ladder is set by layout shape instead. `TM_LAYOUTS` is
ordered gentlest-first by **measured** solver win rate (Courtyard ~46%
down to Fortress ~20%), and `TM_WEEK` maps each weekday onto a window
of that ladder — Monday gentlest, weekend hardest. Those rates come
from a boosterless solver with no lookahead, so real players (3 undos,
2 shuffles, 1 clear) do better. **If you retune the layouts, re-measure
rather than eyeballing the shape** — free-tile count alone predicts
difficulty poorly.

**Tier-A coupling — the sharp edge.** `tilematchingdaily` is tier A, so
every finish is re-simulated by `lib/dapp.js`'s engine. That engine
models only the tray, so layouts are free to change, but the **type and
set counts** (`TM_DAILY_TYPES` / `TM_DAILY_SETS` ↔ `TM_CONFIG`) and the
**score ceiling** (`tmDailyScore` ↔ `tmDailyCeiling`) must be mirrored
across the two files in the same commit. `validateSession` rejects a
claimed score above the recomputed one, so the engine returns the
*ceiling* (zero elapsed time, every booster unspent) and the client
formula only ever subtracts from it. Get this wrong and finishes still
record but silently settle as `disputed`, losing the Verified badge.

## Game Corner phase 7 — Game of the Day, home reorg, per-game chat

- **Game of the Day.** New PUBLIC `daily_featured` table (seed_date PK →
  game_id, seed). `ensureDailyFeatured()` (`server.js`, next to
  `ensureDailySeeds`) picks today's game by a **deterministic weighted
  round-robin**: `gotdSchedule()` expands `GOTD_WEIGHTS` (flagship four = 2,
  every other daily = 1, pool = all Lane A dailies via `GAME_IDS`) into a
  round-interleaved schedule — round 0 lists every game, round r adds games
  with weight > r — and indexes it by UTC day number, so the same game never
  features on consecutive days and every process computes the same answer.
  The row is upserted lazily on the first request of the day and returned as
  `featured: { date, gameId, seed }` from BOTH `GET /api/daily` and the
  public `GET /api/public/daily` (so the signed-out hero renders too). The
  seed is the game's normal daily seed; streaks are **unchanged** (any daily
  play counts — GotD-participation streaks per spec §6.3 remain deferred).
- **Home reorg** (the layout below is history — the flip-deck lobby replaced
  it; see "The flip-deck lobby"). The three-tab lobby is retired. `lobbyTab` is now
  `'home' | 'ladder'` (legacy `?tab=daily/classic/feed` land on home;
  `?tab=ladder` still deep-links — the Community Feed screen, post/comment
  UI, Share-to-Feed, and profile follower counts were retired in the
  spec-audit pass; `user_follows` + the Friends screen stay, and the
  post/comment tables/routes remain retired-in-place). Home renders, in order
  (as revised by the home/profile cleanup pass): the dismissible "New this
  week" strip (in-repo `CHANGELOG` const; dismissal is deliberately
  per-page-load — plain state, no localStorage — ✕ hides it for that visit
  and it returns on refresh; its "See all ›" is the only entry to the
  What's-new sheet) → `GotdHero` (identity, "Next puzzle in" countdown,
  state-aware CTA; its old top-3 preview was removed as duplicate) →
  `TodayChampions` (GAME-OF-THE-DAY-ONLY board: `/api/daily/leaderboard/today`
  resolves today's featured game via `ensureDailyFeatured` and ranks its
  finishers by `score DESC, time_secs ASC, finished_at ASC`, returning
  `{ entries, me, total, gameId }` with `userId` per row for the
  row-tap → profile navigation) → `InProgressRow` (resumable daily attempts +
  the viewer's active online matches from the auth-gated
  `GET /api/rooms/mine`, your-turn flagged via `state.currentPlayer`, with an
  "expires in Xh" turn-timer line) → "Daily Puzzles" grid + "Classic Games"
  grid (same card markup as before — tests assert on its strings). The home
  badges panel and the Ladder/What's-new quick-link buttons are retired: the
  badge collection lives on the profile (`BadgeStrip`, now with the
  next-milestone progress pills), and the Rating Ladder is reachable only via
  the `?tab=ladder` deep link. Tapping a your-turn card re-enters the live
  room: it pre-seats `{ roomId, myPlayerNum }` through `classicGameModeOpts`,
  which `BoardRoomGame` (and Chutes & Ladders) read to skip the create/join
  setup screen.
- **Per-game public chat.** New tables `chat_messages` + `chat_reports` —
  both PUBLIC after the policy review: each game's room is open to every
  signed-in user in-app (the "already visible to other users" test), so
  staging may carry prod rows. Routes (all auth-gated — chat is an account
  moment; deliberately NOT in `PUBLIC_API_GET`):
  `GET /api/chat/:gameId?after=<id>` (ascending, last 50, 10s client poll),
  `POST /api/chat/:gameId` (`{ body }`, ≤500 chars), and
  `POST /api/chat/messages/:id/report` — one row per (message, reporter),
  auto-hide at `CHAT_REPORT_THRESHOLD = 3` distinct reporters. Hidden
  messages are tombstoned in reads (body/user nulled server-side, never
  deleted). Client `ChatPanel` is a bottom-sheet overlay reachable from the
  pre-game screen, the daily in-game header, and the ClassicShell topbar
  (new `onChat` prop); `?chat=<gameId>` deep-links it open (tests use it).
- **Staging fixtures** (in `GET /api/daily`, all idempotent, IS_STAGING):
  `demo=gotd` (6 fake finished attempts for today's featured game so the
  GotD-scoped Today's Top Scores board renders), `demo=chat` (10 messages across the featured game's
  room and the Checkers room — the hidden-by-reports example lives in
  **checkers** so tests have a stable `?chat=checkers` target), and
  `demo=yourturn` (re-arms active checkers room `DEMOYT` with the viewer as
  player 2 to move, so the your-turn card renders).

## Launch-set alignment pass (spec-v0.11 gap close — July 2026)

One PR closed the gap analysis against the Game Corner build spec v0.11:

- **Rename sweep (display names only; ids/storage keys never change):**
  `chutes-ladders` → "Snakes & Ladders" (Hasbro mark), `blockblast` →
  "Block Fit" (Hungry Studio's live title), `wordhunt` → "Word Search"
  (it IS a word search; frees the Word-Hunt mechanic name), `minesweeper`
  → "Mine Finder Classic" (family consistency with the daily), and
  `sudoku` → "Sudoku" (it now hosts both board sizes). Share strings and
  in-game copy were swept too; the CHANGELOG strip credits the renames
  and no longer references the old Zuma/Crypto Wordle marks.
- **`wordsprint` — Word Sprint** (the spec's Boggle-style launch game,
  new id because `wordhunt` was taken): 4×4 seeded letter grid
  (`WSPR_DICE`, own distribution), trace adjacent tiles, 90-second
  countdown (`WSPR_SECS`), open vocabulary against the in-file
  `WSPR_WORDS_RAW` set, per-length points (`WSPR_POINTS`). The countdown
  ending IS the win (score may be 0 — locks the day, never breaks a
  streak). **Its manifest `tieBreak` is `'score-then-time'`** — the daily
  per-game leaderboard and the public rank-preview both dispatch their
  ORDER BY / counting off that symbolic rule now (first non-fastest-solve
  daily). Progress `{ dayNum, found }`; autosave and per-word saves stop
  in the final 3 seconds so nothing races the clock-driven finish (409
  rule).
- **Sudoku difficulty (one entry, two boards):** an in-game chooser
  (before the timer starts) offers **9×9 Classic (×2 points)** or the
  original **6×6 Mini** (byte-identical board/stream to before). The 9×9
  derives a second stream from the same daily seed and generates with a
  uniqueness-checked dig (`generateSudoku9`/`sdk9CountSolutions`, 40
  givens). Progress gains `difficulty`; saves without it hydrate as mini.
  `boxAt`/`sudokuConflicts`/`sudokuSolved` are size-aware.
- **`snakedaily` / `bouncedaily`** — seeded, bounded daily variants of
  the free-play classics (which are untouched): Daily Snake eats a
  seeded apple SEQUENCE (skip-if-occupied), win at 20 apples, crash =
  `onLose`; Daily Bounce is one seeded brick wall, 3 balls, clear = win.
  Both are real-time and deliberately have **no mid-run resume** (a
  claimed unfinished attempt restarts the run; nothing is autosaved).
- **Ludo 2–4P:** `classic_rooms` grew `player3_*`/`player4_*`/
  `max_players` (default 2); the ludo rules module is seat-generic
  (`nPlayers`, `seats`, `forfeited`, legacy `{p1,p2}` states normalized
  in and mirrored back out), start offsets {1:0, 2:26, 3:13, 4:39}, all
  four start cells safe. Join fills seats 2→3→4 and activates when full
  (response carries `yourPlayerNum`); a multi-seat forfeit/expiry drops
  only that seat (`ludoForfeitSeat`) and the match continues —
  last-seat-standing wins. **Only 2P matches are rated**; 3–4P is
  unrated until multi-player Elo math is chosen. Staging fixture
  `demo=ludo4` re-arms a WAITING 3-seat room `DEMOL4` (two fake seats)
  so a tester who joins moves immediately.

## Post-launch spec-audit changes (do not undo)

- **48h correspondence turn timer:** active two-player rooms auto-forfeit
  the side to move after `TURN_TIMEOUT_HOURS` (48) without a move —
  enforced LAZILY on the room read/poll paths (`expireStaleClassicRoom`
  / `expireStaleMancalaRoom` in `server.js`, same active→finished CAS +
  single `rateMatch` as the manual forfeit). `demo=yourturn` seeds a
  second room `DEMOEX` backdated 46h to demo the expiry line.
- **dApps chrome removed** (nav chip, Account row, Minesweeper wallet
  section); the server integration (`/api/integration/*`) and the
  Verified badge / session receipts stay.
- **Share cards are three lines** (`buildShareCard` in App): edition/date,
  the game's spoiler-free result line, then "#N on today's board" + the
  no-login `?game=` link. Rank is threaded in after finish (leaderboard
  `me.rank`) or the guest rank preview.
- **IP naming sweep:** display names only — Marble Loop (id `zuma`),
  Daily Cipher (id `cryptowordle`, tag Words), Hash Rush tag Arcade,
  Minesweeper "Lock In" (was Cash Out). Registry ids NEVER change (they
  key daily_attempts/classic_scores/chat/deep links).

## Retired features (Game Corner phase 1 — do not resurrect)

As of the "Game Corner" evolution's phase-1 subtraction, the following
were **deliberately removed** and should not be re-added piecemeal:

- **The MATCH in-app currency** and everything that moved it: earn on
  daily wins, paid hints, streak freezes, tips, the Wallet screen, the
  nav balance chip, the MATCH on-chain ledger/memo anchoring, and the
  Tile Match wallet/daily-tasks/duels surfaces. **Hints are now free**
  — still capped per day and counted server-side (`daily_hints`), just
  no cost. Points, streaks, and badges are the only rewards.
- **Texas Hold 'Em**, **Idle Empire**, and the **PvP staking arena**
  (games and their routes/registry entries).
- Their **database tables remain in the schema** (`poker_chips`,
  `idle_game_state`, `pvp_matches`/`pvp_moves`, `tilematch_tokens`,
  `match_ledger*`, `token_*`, `tilematch_duels`,
  `tilematch_daily_tasks`) — the migrations are intentionally
  non-destructive; no code path touches them anymore.
- `REDIS_URL`/ioredis (only ever the PvP matchmaking fast path) and the
  UTGO wager contract/ABIs are gone.
- **The Verified badge, the session receipt and the verified leaderboard**
  (#224, at a usernode admin's request). The phase-1 subtraction carved these
  out of the dApps removal and kept them; that carve-out has ended. Gone: the
  badge on the win overlay, the `SessionReceipt` screen and its
  `?sid=` / `demo=dapp` / `demo=anchor` deep links, `VerifiedLeaderboard`, the
  whole `18-dapp-verified.jsx` module, their styles and their five checks —
  and with them the client-side `dappAnchor()`, which existed only to make the
  badge say "anchored on-chain" and which sent a transaction through the
  bridge to do it.
  **The verification MACHINERY is untouched**, deliberately: `lib/dapp.js`,
  `game_sessions` / `session_states`, `settleDailySession` and its tier A/B
  split, and the `/api/dapp/*` routes all stay. A request to stop SHOWING a
  verdict is not a request to stop reaching one, and the harness is what
  `validateSession` uses to refuse an impossible score. Don't re-add a badge;
  if the verdict needs surfacing again, that is a new decision.
- **The Account screen and the wallet ownership proof / "On-chain login"
  identity** (home/profile cleanup pass): the Usernode-pubkey display,
  Connect / Verify / Disconnect wallet controls, the avatar "verified"
  tick, and the routes `POST /api/wallet/link`, `GET /api/wallet/challenge`,
  `POST /api/wallet/prove`, `POST /api/wallet/disconnect`, and
  `GET /api/account` are all removed — with them the `ethers` dependency
  (its only use was `verifyMessage` in the prove route). The
  `user_wallets` / `wallet_ownership_proofs` tables remain in the schema
  (non-destructive migrations); no code path touches them. Tapping the
  nav account chip now opens the viewer's own profile
  (stats + recent games + badges); `?screen=account` deep links land
  there too.

The DApp-Mode verification framework (`lib/dapp.js`, `game_sessions` /
`session_states`, session receipts, the Verified leaderboard) is NOT
part of the retirement — it stays and is the seed of Game Corner's
anti-cheat harness.

## Cross-cutting remediation pass (#120–#145 — July 2026)

One PR closed all 26 open issues, in eight phases. The phases are ordered
because later ones use primitives the earlier ones build. **Four repo-wide
rules came out of it — break any of them and a self-test fails the build.**

### 1. Canvas colour: read `PAL`, never `C`

`C.x` is the string `'var(--c-x)'`. Assigning it to `ctx.fillStyle` is
**invalid, and the canvas silently keeps its previous colour** — which is
black on the first frame and "last frame's colour" thereafter. That single
mistake was issues #126 (black Nonogram), #127 (black Mine Finder) and #140
("Drop Stack's background keeps changing"). Rules now:

- Canvas code reads **`PAL`** (the live plain-object palette). For colours
  captured at module scope, store palette **token names** and resolve through
  **`palOf(name)`** / `PAL[name]` at draw time (`MF_NUM_COLORS`,
  `BOUNCE_ROW_COLORS`) so a theme flip recolours mid-game.
- **`guardCanvasCtx(ctx)`** wraps every one of the seven canvas contexts. It
  swallows a `var(...)` colour and logs a console error — deliberately NOT
  env-gated, so the bug class can never silently return.
- `useCanvasBoard` redraws on theme change (`useThemeVersion`), and the four
  hand-rolled loops (bounce, zuma, hashrush, bouncedaily) all cap DPR through
  **`canvasDpr()`** (max 3), matching the hook.
- **Intrinsic game art still stays hardcoded** — Drop Stack pieces, the Daily
  Bounce well/bricks/paddle, Hash Rush's miner/tokens/hazards, 2048 tiles,
  cards, Mahjong ivory. Only *chrome* re-themes. Hash Rush's background and
  lane markings moved to `PAL` because they were near-white and invisible in
  the light palette.

### 2. Tap targets: the allowlist is load-bearing

The `touch-action: manipulation` selector list (near the top of `css`) is now
registry-wide, and **`registry-touch-action` in `runClientSelfTests()` fails
if any listed class computes to `touch-action: auto`**. A game whose tappable
element is missing from that list pays ~300 ms per tap on touch.

- Use **`tapProps(onTap)`** on board cells: it sets `data-pressed` on
  `pointerdown` (feedback on finger-DOWN, not on the delayed click) and fires
  the action on `pointerup` for touch, falling through to `onClick` for mouse.
- Add press feedback for every new tappable class. `:hover` is not feedback —
  a finger never fires it. The app had 8 `:active` rules against 69 `:hover`
  rules before this pass.
- **Two boards are too dense to fix with feedback alone**, and their solutions
  are the pattern to copy: **Gomoku** (15×15 ⇒ ~24 px) uses ghost-then-confirm,
  and **Ludo** (tokens smaller than their cell) lists the legal moves as
  full-size buttons under the board. Both are built in the `BOARD_VIEWS`
  renderer, so online / pass-and-play / bot inherit them, and neither changes
  the move payload. Ludo's buttons are a SECOND path now, not the only one —
  see "Ludo: the board is a tap target too" below.

### Ludo: the board is a tap target too (#217)

The move buttons stayed — they are still the unambiguous path, and the issue
asked for direct selection, not for the buttons to go. What changed is that
the board became a target worth aiming at:

- **Tokens fan out around the cell they occupy, not by their index.** The old
  layout offset every token by `(i % 2, i / 2) * 5px`, which put a lone token
  permanently off-centre and turned four tokens on one cell into a 5 px
  diagonal smear. `ludoStackLayout(n, cell)` places whatever actually shares a
  cell (across seats — safe cells and the 🏁 centre hold more than one colour)
  on a ring around its centre, shrinking the radius as the group grows.
  `LUDO_STACK`'s pairs are tuned so `hypot(offset) + r <= cell / 2` (the group
  fits) and no two neighbours are closer than the old 5 px, at the smallest
  cell the board ever draws (18 px). `ludo-token-stack` asserts both, for every
  size in that range — **re-run it rather than eyeballing a retune**, because
  those two constraints pull against each other and the tight end of the range
  is where a change breaks.
- **The hit test takes the nearest CENTRE, not the topmost of the draw order.**
  `ludoPickToken` — topmost is just the highest token number, which is not what
  the finger aimed at. Each candidate carries its own radius, so a lone token
  is a bigger target than one in a stack, and a movable token draws last so its
  gold ring is never clipped by a neighbour.
- **The board never said it was tappable**, which is most of why #217 was filed
  against a board that already had a hit test: an in-frame line now says so
  whenever there is a legal move, and the move pad relabels itself as the
  alternative.

**The die is drawn as a die, and the tumble is only the wait made visible.**
`ludoDrawDie` renders pips; the value is ALWAYS the referee's (the rules module
locally, the server online). The tumble starts on the Roll tap — so an online
roll has no dead beat while it is in flight — and stops a short settle after
the real value lands, with `until` only ever moving forward so a local roll,
which resolves in the same tick, still spins once rather than twice. The face
cycle is a fixed repeat-free sequence (`LUDO_TUMBLE`) precisely so it is
checkable and so nothing about it can be mistaken for the outcome.
`cgReducedMotion()` skips it entirely.

**`?ludo=stack`** seats a deterministic mid-game position (two of P1's tokens
sharing a ring cell, a die already rolled). A fresh Ludo board has nothing on
the ring and nothing rolled, and a proposal check can navigate but cannot tap
Roll — so without this link neither the fan-out nor any in-move chrome is
reachable by a check or a screenshot. It is consumed once, on mount:
`BoardLocalGame`'s reset effect skips its own mount pass when a seeded position
is in play, the same trap `SnakeGame`'s reset-to-chooser effect had to skip.

### 3. Nothing scrolls during play

- **`useScrollLock(active)`** locks the *document* while a run is live. That is
  what makes the guarantee hold for all 33 games — `fitShell` only covers
  dailies that opted in, and `shell: 'self'` games bypass it entirely.
- **Every `category: 'daily'` game MUST set `fitShell: true`** — asserted by
  the `registry-fitshell` self-test — **and its root must carry `.fit-col`**.
  `fitShell` without `.fit-col` *clips* instead of fitting: that was Daily
  Cipher's bug (its keyboard fell off the bottom), and `wordsprint` /
  `snakedaily` / `bouncedaily` had neither.
- In a fit column, everything except the board is `flex: 0 0 auto` (see that
  selector list). A board sized by `aspect-ratio` must give it up there
  (`.fit-col .cw-tile`) or it overflows its row track.
- Growing lists (`.wspr-found`, `.an-solved`, `.word-list`) get their own
  `max-height` + `overflow-y: auto` scroll strip.
- `.cg-stage` keeps `.cg-scroll` **on purpose** — making it `overflow: hidden`
  would clip a tall setup screen. The five phase-5 board games instead honour
  the `--cg-board` viewport cap, the same way `.ms-grid` / `.t2048-board-wrap`
  / `.mnc-board` already did.

### 4. The freeze layer must not eat the chrome

`.game-body.frozen { pointer-events: none }` wrapped the whole reviewed
subtree **including the header inside it** — that was #134, and it silently
killed the entire `.cg-topbar` (exit, ☰, ?, 💬) of all 14 in-frame classic
games too. `.game-head`, `.cg-topbar` and `.result-minibar` are re-enabled
inside `.frozen`. Keep any new chrome in that list.

### 5. Never pass `backToLobby` (or any state setter) as a bare handler

`onClick={backToLobby}` hands React's SyntheticEvent to the function's first
parameter. That put a DOM-bearing object into `lobbyTab`, and the next render's
`JSON.stringify(navState)` threw `Converting circular structure to JSON` —
which, with no error boundary, **unmounted the entire React root**, stylesheet
included. That was #150, and the resulting missing stylesheet is what made the
`registry-touch-action` sweep report all 18 tappable classes as broken, which
is how #149 got filed against the tap-target registry. Three standing rules:

- **Always wrap**: `onClick={() => backToLobby()}`. `backToLobby` also ignores
  a non-string `tab` now, and a game **category** (`'daily'`/`'classic'`)
  routes to `setHomeFilter` — `lobbyTab` is only ever `'home'`/`'ladder'`.
- **Every `navState` field goes through `navPrimitive()`** — asserted by the
  `nav-state-primitives` self-test. If you add a field, coerce it.
- **`<style>{css}</style>` lives at the root mount, OUTSIDE `AppErrorBoundary`**
  (a sibling of `<App/>`), so the boundary's "Something went wrong / Back to
  Home" panel renders *styled*. Don't move it back inside `App`.

### 6. In a fit column, a board needs `width: 100%`, not just `margin: 0 auto`

**An auto cross-axis margin opts a flex item out of `align-items: stretch`**,
collapsing it to fit-content. Every board carries `margin: … auto` for
centering outside the fit column, and inside `.fit-col` that silently shrank
them — at 390px (a 361px column) sudoku rendered 220px, the numpad 121px, word
search 224px, word sprint 150px, and **Daily Snake 16px** (#149). The fix is a
definite width; the caps (`max-width`) still centre the board.

- New board in a `.fit-col`? Add it to the `.fit-col … { width: 100% }` rules.
  `fitcol-auto-margin` (static scan of `css`) and `fitcol-fill` (measures the
  mounted board) both fail the build otherwise. **`max-width` alone does NOT
  count as a definite width** — it can't restore stretch.
- The `background: ${C.border}` gridline idiom **needs a matching `gap`** or no
  separator ever renders (that was `.sudoku`/`.wordsearch` since commit one).
  When you add the gap, box separators must out-read it: sudoku's 3×3 borders
  moved from `C.border` to `C.muted` for exactly that reason.
- **Canvas boards fit by scaling the BACKING STORE, not a CSS transform** — see
  Daily Bounce's `sizeCanvas`: it measures `.dbnc-wrap` (the flexible region),
  keeps the logical 320×430 coordinate space untouched, and sets
  `ctx.setTransform(dpr * scale, …)`. A transform would scale rasterized pixels
  and go soft. Pointer math stays `getBoundingClientRect`-relative, so it is
  scale-free.
- `token-alpha-concat` scans `css` for `var(--c-…)` followed by hex digits —
  the CSS half of the mistake `guardCanvasCtx` catches on canvas. It found
  three dead Ludo seat-3 tints (`${C.gold}22` → `ca('gold','22')`).
- When the stylesheet genuinely never mounts, `runClientSelfTests(false)`
  reports **one** `stylesheet-missing` failure and skips the computed-style
  checks. Don't "fix" that by running them anyway — that's what sent #149 at
  the wrong subsystem.
- **`?sdk=9` / `?sdk=6`** deep-links Sudoku's 9×9 / 6×6 board past the
  difficulty chooser. It exists because `dapp.json` tests cannot click, so
  without it no route reached a Sudoku grid at all.

### Also worth knowing

- **Browser history exists now.** A single reducer pushes one entry per
  navigable state and a `popstate` listener *derives* state from the event
  (never navigates imperatively); `navLock` stops a pop from pushing again.
  Every deep-link param must survive a push — the URL keeps its query string.
- **`lib/board-rules.js` is dual-mode.** It runs in Node (`module.exports`) and
  in the browser (`window.boardRules`, served by `GET /board-rules.js` and
  loaded from `index.html` before the app). The whole file is wrapped in an
  IIFE because in the browser it shares global scope with `app.js`, which
  declares its own `CNL_LADDERS` etc. — without the wrapper the app fails to
  parse. Local pass-and-play and Versus Bot referee with these exact functions;
  **never reimplement the rules client-side.** Bots validate candidate moves by
  calling the real `applyMove` and catching its throw.
- **Local board modes are unrated by construction** — `applyMatchRating` only
  runs in the four server finish paths, and local modes never call the server.
  They also skip `submitClassicScore`.
- **`finish` can carry a final board snapshot.** `POST /api/daily/:gameId/finish`
  accepts optional `progress` and writes it in the **same UPDATE** as
  `score/steps/finished_at`, which is why the *no-autosave-on-the-winning-move*
  rule is untouched (a separate write would 409 against the row the finish just
  closed). That snapshot is what the locked-day review board (#122) renders;
  real-time dailies with no resume legitimately have nothing to snapshot.
- **Practice replays (#133) must stay inert.** `practiceMode` short-circuits
  `handleWin`/`handleLose` before any endpoint, and suppresses `dailyRunLog`,
  `savedProgress` and `onSaveProgress`. That early return is the only thing
  guaranteeing "play again for fun" can't move a streak or a leaderboard.
  **Practice has two seeds (#367).** "Play again for fun" and `?practice=1`
  replay TODAY'S deal; the pre-game screen's "🎲 Practice run" (and
  `?practice=random`) deals a fresh RANDOM board so warming up does not give
  the daily away. `serverDailySeed` returns `_practiceRunSeed` while one is
  open (`beginPracticeRun`/`practiceRunSeed`/`endPracticeRun` in
  `05-core-lib.jsx`), which is what makes it reach every generator — including
  Tile Match and Mahjong, which read it directly, and Daily Cipher, which
  draws a random block in `cwRoundsForMode`. **The shell must close it on
  every non-practice entry point** (`startRun`, `launchGame`, `backToLobby`,
  `openOpponentScreen`, `replayArcadeRun`, and `startPractice` without
  `fresh`), plus a `!practiceMode` effect for popstate; otherwise a later
  board draws from a seed that belongs to a run that is over.
- **Daily Cipher's rotation is a partition, not a sample.** Each theme is
  shuffled once with a fixed seed and cut into 5-word blocks; day N takes block
  `(N/4) mod blocks`. That gives a **sliding** no-repeat guarantee over
  `CW_CYCLE_LEN` (36) days, which reshuffling per cycle did NOT (a window
  straddling two shuffles could repeat). Verified by `cipher-rotation`.
- **Mahjong layouts are measured, not eyeballed.** `MJ_LAYOUTS` is ordered by a
  boosterless solver's win rate over 1200 seeded deals (Courtyard 35.8% →
  Bridge 27.3%). Note how weakly the silhouette predicts it: 5-layer Tower ties
  2-layer Courtyard. **Re-measure after any retune**, and keep every layout at
  exactly 60 slots (`mahjong-layouts` asserts it) or resume hydrates wrong.
- **Daily Bounce power-ups are pre-assigned at deal time**, not rolled on
  break — `spawnPowerup` uses `Math.random()`/`Date.now()` and would make a
  supposedly-fair daily differ per player. Two people playing today get
  identical drops from identical bricks.
- **Match 3 had three separate bugs that made it unplayable**, all found while
  giving it its design-system pass: its API routes were registered *after* the
  `app.get('*')` catch-all (so `/api/match3/progress` returned HTML and the
  campaign screen said "Loading..." forever); the unlock gate was
  `p.id <= highestPuzzle`, which locks all 50 puzzles for a new player; and
  `startPuzzle` sent a GET to a POST-only route. **Every real route must be
  registered above the catch-all.**
- **`usernode-native` is adopted for chrome only** (hosted tags in
  `index.html`, `unNative.alert` for destructive confirms). Do **not** apply
  native motion to boards, cells, cards or canvases — the kit's own fidelity
  rules forbid animating high-frequency interactions, and it fights the tap
  primitive.
- **Reduce-motion coverage is now app-wide.** The old query covered four
  selectors, one of which (`.tm-grid`) was dead CSS. Add new animations to it.
- **New staging fixtures:** `demo=solvedboard` (finished nonogram + solved-grid
  snapshot, for the review screen) and `demo=myroom` (the viewer's own waiting
  + active rooms across reversi/gomoku/ludo, for the Your-rooms list). New deep
  links: `?review=1`, `?practice=1`, `?rooms=mine`, `?mode=bot|2p`,
  `?syncfail=1`.

## End-of-run screen + tap-target registry (#158–#163, phases 1–3)

Four standing rules came out of the shared end-of-run pass. Three are enforced
by self-tests; the fourth is the kind of bug only a mounted browser shows.

### 1. `TAPPABLE_CLASSES` is the single source of truth for fast taps

`TAPPABLE_CLASSES` (`public/src/00-palette.jsx`, before `css`) is the ONE
list. Both
`touch-action: manipulation` and `-webkit-tap-highlight-color` are **generated**
from it (`emitTouchActionRules()` / `emitTapHighlightRules()`), and the
`registry-touch-action` self-test probes that same array. **Adding a game means
adding its cell class there — never to the stylesheet by hand**, or the two
drift (the old hand-copied probe list was missing 8 classes the CSS covered).

- Rules are emitted **one per class**, deliberately. A comma-separated selector
  list is all-or-nothing: one selector an engine rejects drops the whole rule,
  which is the only mechanism that yields the reported "touch-action:auto on
  <all 18 classes>" with the stylesheet present. Per-class rules make a bad
  entry cost exactly one class, and the test names that class.
- **The canary is the diagnosis.** `.un-selftest-canary` comes from the same
  generator; `tapCanaryApplied()` probes it first. Canary `auto` ⇒ ONE
  `stylesheet-not-applied` failure (with `document.styleSheets` counts and the
  app sheet's `cssRules` length) and every computed-style check is SKIPPED.
  That distinction is the whole point: #149 and #163 were both filed against
  the tap-target registry when the stylesheet was the actual suspect.
- `scheduleSelfTests` gates on the canary's **computed value**, not a text scan
  of `<style>` contents ("in the DOM" is strictly weaker than "applying"), and
  alternates rAF with `setTimeout` — rAF does not fire in a hidden/throttled
  tab, which silently skipped the whole suite.
- `touch-action-rules-emitted` is the static half: it fails even when the sheet
  is dead, proving the array and the emitted CSS are the same list.

### 1b. `tapProps`' de-dupe guard must OUTLIVE the render (#one-tap-two-letters)

`tapProps` fires the action on touch `pointerup` and then swallows the browser's
compatibility `click`. The guard that does the swallowing lived in the function's
own closure — and that is a **use-after-rerender** bug, because the action's
`setState` re-renders before the click arrives:

```
pointerup -> onTap() -> setState -> React 18 flushes SYNCHRONOUSLY (pointerup is
a discrete event) -> the element's props are replaced by a FRESH tapProps(...)
object -> the compat `click` dispatches against THAT object, whose per-render
`handledPointer` is back to false -> onTap() fires a SECOND time.
```

So **every tappable that changes state fired twice on every touch device** —
reported as Daily Cipher typing `LLEENND` instead of `LENDING`, but the Cipher
keyboard was only the most legible symptom, not the scope. The guard is now
module scope (`_tapHandledEl` / `_tapHandledAt`, one-shot, 700 ms window), so it
survives the re-render. Standing rules:

- **A tap guard may never be a per-render closure.** Anything that must span
  pointerup → click spans a re-render by construction.
- `tap-dedupe-survives-rerender` asserts it by simulating exactly that swap (two
  separate `tapProps(...)` objects against one element).
- Desktop had a second double path: with an on-screen key focused, Enter/Space
  fires that button's own click AND the window `keydown`. Daily Cipher's handler
  now ignores `e.repeat`/modifiers and defers Enter/Space to the focused button
  when `e.target.closest('.cw-kbd')` matches.
- `typeLetter`/`backspace` use **functional** `setCur`, so the length cap is
  evaluated against the live value and a batched double can never overflow the
  boxes.
- **`?cwtype=LEN-`** replays a real touch tap sequence (pointerdown → pointerup →
  compat click) against the on-screen keys at boot, and `.cw-board` carries
  `data-cw-typed`. That pair is what makes this testable at all: `dapp.json`
  checks can only navigate, so before it no check could see a tap-driven bug. A
  `-` means backspace. Keep the asserted strings **≤ 3 letters** — the day's word
  length varies (min 3) and `typeLetter` caps at it.

### 2. The `.game-body` wrapper is UNCONDITIONAL — never toggle it in/out

`{screen==='game' && <div className={'game-body' + (boardReviewable ? ' frozen'
: '')}>{renderGameBody()}</div>}`. It used to swap between a wrapped and an
unwrapped branch, which changes the element at that position, so **React
unmounted and remounted the entire game at the exact moment the run ended**.
2048 came back as a fresh 2-tile board (its mount reads the saved-board key the
loss had just cleared) — i.e. "the final board" was a brand new one. Keep one
stable element and change only its class. `.game-body` carries
`display:flex; flex-direction:column; flex:1 1 auto; min-height:0` so it is
layout-transparent (measured identical to the unwrapped baseline); **not**
`display:contents`, which generates no box and would drop `.frozen`'s
`filter`/`pointer-events`.

### 3. Every ending is a `resultData`

`resultData = winData || loseData || practiceResultData` drives the frozen
board, the minibar, the backdrop dismiss and "👁 View board" from one value.
Consequences:

- **`boardReviewable` no longer excludes `shell:'self'`.** Its old comment
  claimed Snake/Block Fit/Diamond Rush/Hash Rush draw their own game-over
  overlay; only Hash Rush did, and **it does not any more** (#215). It was
  given a `resultShown` prop to stand down behind the shared card, and standing
  down was all it ever did: a shared card always follows `reportRunEnd`, so the
  panel only existed in the gap before one arrived — never rendered at all in
  free play, one paint then swapped in the three modes whose finish awaits an
  endpoint, and flashed a second time on Play Again (winData clears a commit
  before the resetKey reset). That flash was the reported bug. **No
  `shell:'self'` game draws its own end panel now, and `resultShown` is gone
  — keep it that way; the shared results card is the ending.** Hash Rush's
  reset is a `useLayoutEffect` so Play Again cannot paint the dead board first,
  and `?hrdead=1` parks it in the finished-with-no-card state (writing nothing)
  so a check can assert the panel stays absent.
- Practice results carry a `gameId` so the "result belongs to the mounted game"
  guard still holds. The practice card was the one with no way back at all —
  no View board, no minibar, no dismiss (#158).
- Backdrop dismiss is `onPointerDown` with an `e.target === e.currentTarget`
  check (finger-DOWN, like `tapProps`), plus an `Escape` listener.
- **The daily `<Leaderboard>` renders only for `currentGame.daily`.**
  `/api/daily/:gameId/leaderboard` validates against `GAME_IDS` and 400s on a
  classic id — a console error that fails the no-console-errors check. Classics
  reach their all-time board via ClassicShell's ☰ sheet.

### The win card opens on ONE number (#241)

The feedback was "way too much going on, with the points, the badges, and the
leaderboard with lots of scrolling". Measured before touching it, at 390x780:
**955px of card content in a 740px box** — and that was with an EMPTY
leaderboard, so a real one scrolls further. After: **607px, no scroll.**

- **The moment** is the trophy, the headline, the game, the earned score at
  3.1rem, its multiplier caption, and ONE flourish line — in priority order a
  badge unlocked, a ladder completed, or a personal best. Then the actions.
- **Behind `.win-more`** ("Score, badges & leaderboard"): the seven-row
  breakdown, the "badge active" row, the unlock blocks, the next-milestone
  pills and today's leaderboard. Nothing was deleted. The toggle sits BELOW
  the action buttons on purpose, so opening it never moves the button you were
  reaching for, and `winDetails` resets on every new result so the next win
  opens on the moment again.
- **What stays on the moment besides the actions**: the offline sync note, the
  guest sign-in CTA, the multi-seat standings table and the story/arcade
  "what happens next" note. Those are outcomes or instructions, not trophies.
- **The loss card is deliberately untouched** — measured at 567px (classic)
  and 454px (daily practice), it already fits without scrolling, and a loss
  has no earned score to build a moment around.

**An animation must never be the only source of a number.** `WinEarned`
renders the REAL value first and starts its count-up from inside the first rAF
that actually runs, so a throttled background tab or a screenshot capture —
neither of which fires a frame — shows the finished score rather than "+0".
The trophy's CSS pop is on an emoji for the same reason. `data-win-earned`
carries the true value whatever the frame count, and the `dapp.json` check
asserts the rendered text, which is exactly the environment this protects.

**`?result=win`** is the deep link. `?result=1` never reached the WIN card at
all — its daily branch goes through `practiceResult` and its classic branch
sets `loseData` — so the screen this issue is about had no URL, which is why
no before screenshot of it exists anywhere. Like the rest of that link it is
local UI state and calls no endpoint: the only daily write on the win path is
`retryDailyFinish`, which needs a press.

**`${C.x}` only works for a PALETTE key.** `C` is built from
`PALETTES.light`'s keys, so a DERIVED token (`well`, `well-strong`, `scrim`,
the shadow trio, the `*-hover` pair) interpolates the string `undefined` and
the browser drops the whole declaration. `.review-btn:hover` and
`.pregame-band[data-pressed]` had been dead that way. Use `var(--c-well)`.
`css-no-undefined-token` scans the built stylesheet for it now — the same
silent-failure shape `token-alpha-concat` catches on the other side.

### 4. `meta.score` on the loss path is opt-in, per game

`handleLose(steps, timeSecs, meta)` takes `meta.score` (default 0) plus optional
`meta.scoreLabel`/`meta.scoreValue` for a headline-stat row. Games where a high
score IS the result pass it: **2048** (`Highest tile`) and **Diamond Rush**.
Snake and Bounce already route their game-over through `onWin` with
`winnerLabel: 'Game Over'`, so their score was never lost — leave them.

**Pass/fail dailies must keep score 0** (`cryptowordle`, `minefinder`,
`mahjongsol`, `dropstack`, `snakedaily`, `bouncedaily`): the daily leaderboard
filters `score > 0`, so a non-zero loss would put a FAILED run on the board.
Streaks are unaffected either way — `computeStreak` keys off `finished_at`.

### A daily deep link has to carry the daily MODE, not just the game

`?game=<id>&play=1` used to call `startRun(g)` on its own. `startRun` reads the
play mode from a **ref** and never sets it, so a link with no `?pmode=` left the
shell at `playMode === null` — and `resumable` in `renderGameBody` is
`playMode === 'daily'`, the single gate on whether a game is handed its
`savedProgress` at all. So a daily opened that way **could not resume**: a
claimed, half-played attempt mounted as a blank board with the clock at zero and
`onSaveProgress` null. That is the shape of link the share cards carry (the
no-login `?game=` link), and it is what made the merged check "Nonogram resumes
its mistake count" red on main against every proposal. The branch now does what
the `?pmode=` branch above it already did: `launchGame(g, defaultPlayMode(g))`
to set the mode, then `startRun(g, { mode })` to claim or resume in it. A
finished day still lands on the locked screen — both calls agree on that.

**`?practice=1` is deliberately left on the old path** (`playMode` stays null):
practice has no resume by design, and hoisting a default mode above that branch
would send `?game=<daily>&practice=1` into the pre-game screen instead.

### A staging fixture must ASSERT its state, not add to it

Staging carries one database across every check run and never resets, so two
fixtures that seed the same rows to different depths cannot both use
`ON CONFLICT DO NOTHING` — whichever ran first wins permanently and the other
becomes a silent no-op. `demo=storybadges` wants sudoku's ladder fully cleared;
`demo=modes` wants it three rungs in. Once storybadges had run, `demo=modes`
could never say what it means, and "Story picker calls each step a level"
(which asserts the half-walked note, not the all-cleared one) failed for
reasons nothing in its own proposal could explain. Both now delete the bands
above the depth they are claiming before inserting. Any new fixture that seeds
a COUNT of something owes the same treatment.

**The streak fixtures COUNT too, and they disagree.** `demo=streak` wants a
10-day streak; `demo=badges` wants 60. Both write through
`seedFeaturedStreakDays`, which now asserts its claim: days 1..n are
force-finished (DO UPDATE, the demo=resume idiom) and the viewer's finished
attempts OLDER than n days are deleted, so the streak is exactly n regardless
of which fixture or earlier suite seeded deeper. The runner account on the
shared staging DB carried badges' 60 days across suites, and the streak-pill
checks (`data-streak='10'`, #313 and #362) failed whenever a badges run landed
before their route. Either fixture re-seeds its own window on its next run, so
the two stay order-independent.

**"Today is left open" has to be MADE true, not assumed.** `demo=streak` and
`demo=badges` both promise a long streak with today still playable, and neither
finishes today — but `demo=locked` deliberately does, on the same viewer. So
the first time `demo=locked` ran, today's sudoku was finished forever, and
every later route that wanted the PRE-GAME screen got the locked screen
instead. That is what took out the two #188 leaderboards checks
(`?game=sudoku&boards=1&demo=streak`): the panel lives on the pre-game screen,
and the pre-game screen was never reached. Both now call `openTodayForDemo()`;
`demo=locked` still finishes today on its own routes, because it asserts its
state too. The two simply stop depending on which ran first.

**The LOCKED half of a fixture is state too.** `demo=storybadges` exists to put
an earned badge beside locked ones, so it has to be able to say a ladder is
unfinished rather than merely decline to finish it — one leftover
`story_complete` row renders the locked example as earned, and the check
asserting on it fails with nothing in its own proposal to explain why. It now
clears the `story_complete` achievement AND the progress rows for its two
unfinished examples (`minefinder`, one rung short; `cratepush`, never started)
before seeding the finished one. If a check asserts that something is ABSENT or
UNEARNED, the fixture has to make it so.

### Story and arcade resume from a DEVICE-LOCAL record (#187 / #196)

"Only a daily resumes" was a rule about the daily ATTEMPT ROW, and it was read
as a rule about players keeping their work. `savedProgress`/`onSaveProgress`
are that row: a story run writing into it 409s, and reading from it would
hydrate a half-finished daily into a rung meant to be a fixed, retryable deal.
Both reasons are about the SERVER. Neither was ever a reason for a story rung
to lose ten minutes of deduction to a reload — which is what it did, with both
props null and nothing written down anywhere. Reported as a crash (#187, P0)
and as "spontaneous reloads" (#196); measured, Sudoku Story L4 went from
`Steps 1 / Filled 41 / 00:08` to `Steps 0 / Filled 40 / 00:01` across a plain
reload.

Story and arcade now get `savedProgress`/`onSaveProgress` backed by
**localStorage**, one record per `(game, mode, band)`
(`readRunSave`/`writeRunSave`/`clearRunSave`/`hydrateRunSave` in
`05-core-lib.jsx`). **No game component changed** — they already know how to
hydrate from `savedProgress` and write through `onSaveProgress`; those props
just had nothing to point at outside a daily. The attempt row is untouched, so
the 409 rule stands exactly as before.

Four things hold it together, each for a concrete reason:

- **The board has to come back IDENTICAL**, so the two modes record different
  things. A story rung's seed has no day component, so it rebuilds the same
  board on any day from any device — nothing extra to store. An arcade board
  comes from the RUN's seed, so the record carries the seed **and** the run id
  it was anchored with, and `startRun` reopens with both; roll a fresh seed and
  the player gets a different board than their saved position belongs to, and a
  second `/start` anchors a run the finish will not claim.
- **Nothing is saved until a move is made** (`steps > 0`). A save of an
  untouched board is worthless, and worse: proposal checks mount story boards
  to assert on their FRESH state, and a save written by one would hydrate into
  the next.
- **The finish guard is the daily's guard.** `saveLocalRun` honours
  `saveQueueRef.current.blockedGameId`, which `cancelProgressSave()` sets at the
  top of `handleWin`/`handleLose` — otherwise `useAutosave`'s unmount flush
  writes the record back *after* the finish cleared it, and the next visit
  resumes a run that was already over. The record is dropped on every ending and
  in `playAgain`.
- **`dayNum` is stamped on the way out.** The games' gate is
  `savedProgress.dayNum === utcDayNum(offset)` — a same-BOARD check that a daily
  expresses as a same-day one. A story or arcade board is not day-scoped, so
  stamping says "yes, this is for the board you are about to build" in the only
  vocabulary twenty game components already speak.

Scoped to the `shell: 'daily'` branch of `renderGameBody`, which is where both
reported games live (Sudoku and Word Search) and where a saved position IS the
board you left. The classic-shell story games are real-time or score-attack, so
a mid-run snapshot is a much larger job and a separate decision.

`?resumedemo=1` writes the same record a real run leaves, so a part-played
board is reachable by URL. It is deliberately generic — step count and clock
with an empty progress object — so it works on any game; a board that does not
recognise the progress falls back to a fresh deal and still comes up mid-run on
the clock, which is the thing being asserted.

### A lost run in a MODE has to be able to stay in it (#213)

The win card has carried a mode action since #176 — "📖 Back to the levels" /
"🎮 Another run". The loss card never did, so the only way out of a failed
story rung was **Back to Lobby**: the reported "forced lobby exit", and exactly
backwards, because a rung is a fixed retryable deal and failing one is the
moment you most want to go straight at it again. The loss card now carries the
same action, labelled **"📖 Continue Story Quest"** after a loss.

Two smaller things fell out of the same block, both dropped fields rather than
decisions:

- **"🎲 Play again for fun" was showing on story and arcade losses.** It is the
  daily's replay of TODAY'S board through the inert practice path (#133), so on
  a story loss it sent you to a practice run of the daily instead of back to
  the rung. The win card had always gated it on `!modeLabel`; the loss card had
  not.
- **`handleLose` dropped `meta.winnerLabel`.** Every game already sends one
  through `reportRunEnd` (Marble Loop, Hash Rush, Snake and Bounce all send
  'Game Over') and the win card has read it since #158, so a lost story rung of
  a marble game announced itself as **"Out of guesses"** — copy written for
  Daily Cipher. The default stays for games that send nothing, which is Cipher,
  the one it was written for. The "Guesses · Time" row beside it is the same
  copy problem and is deliberately NOT touched: no game sends a label for it,
  so fixing it would mean inventing one for thirty games rather than threading
  through one they already send.

**`handleWin` still drops `winnerLabel` on its arcade and story branches**, so
a run you died in shows "🏆 Solved!" in those two modes. Same one-line
omission, but it belongs to every arcade game rather than to #213.

### Marble Loop's camouflage marble (#213)

Five shots in a row that each pop something drop a **camouflage marble** on the
cannon for `ZUMA_CAMO_MS`. It takes the colour of whatever it lands against
(`zumaWildColorAt` — the longer neighbouring run wins, ties go left), so it
always makes a match if one is there. It is spent by one shot and does **not**
consume the queue: it sits on top of the marble you already had.

It also **replaces the old `color-switch` power-up's wildcard, which never
worked**: that one fired a marble coloured `'#ffffff'` and `zumaCheckMatches`
compares colour strings exactly, so the "wildcard" matched nothing and left you
strictly worse off than the marble it replaced. One wildcard rule, in one pure
function, rather than two that disagree — `marbleloop-camouflage` asserts both
halves, including that the old white marble matched nothing.

`?zcamo=1` loads one at mount (writing nothing — it sets the same deadline the
fifth pop would) because the marble and its countdown are otherwise reachable
only by popping five shots in a row, which no check or screenshot can do.
`?result=1&pmode=story|arcade` does the same job for the mode result cards.
### Snake's turns QUEUE (#206)

"The snake fails to turn upon tap or swipe" is not a gesture problem. The
swipes arrive, `.snake-board` and `.dsnk-board` both carry `touch-action: none`
so the browser never steals them, and `useGestures` is wired identically in
both snakes. The bug was that **a turn had nowhere to wait.**

Both snakes held ONE pending direction (`nextDir`) and validated every new turn
against the direction currently being TRAVELLED. A corner is two turns and a
tick is 90-200 ms, so between them these ate a large share of real inputs:

- the second turn **overwrote** the first, so the snake never made the first
  one — swipe up then left around a corner and it simply goes left;
- or the second turn was **rejected as a reversal** of a direction the first
  turn was about to change. Heading up with left already pending, "down" is a
  legal move after that left; it was refused because down reverses *up*.
  Measured in a browser before the fix: that input returns having done nothing.

`snakeQueueTurn(dir, cur, queue)` is now the whole rule, pure and shared by
both snakes: turns queue up to `SNAKE_TURN_QUEUE` (2 — it remembers a corner,
it is not an input buffer) and each is checked against the last direction
**queued** rather than the last travelled, because that is the one it will
actually follow on from. One tick consumes one turn, which is what keeps
"a snake may not double back into itself" true however fast you swipe.

**A tap steers now as well** (`snakeTapDir`), which the issue asked for and
which previously only started the run. The board is cut into four triangles by
its diagonals and a tap means the one it lands in — absolute, so it needs no
knowledge of the current heading and cannot mean two things at once; dead
centre means nothing. It goes through the same queue, so the reverse rule still
protects you.

`snake-turn-queue` holds both halves. If you retune this, the property that
matters is that ONE tick consumes at most ONE turn — take that away and the
queue becomes a way to reverse into your own neck.

### Daily Cipher can hand typing to the DEVICE keyboard (#192)

The issue asked to replace the drawn keyboard with the system one. Replacing it
outright would have thrown away the only surface that carries the per-letter
state — which letters are placed, which are in the word, which are spent — so
the drawn keyboard stays the default and the device keyboard is a device-local
preference (`cgPrefs.devkbd`, Settings → Typing). In device mode the three key
rows are not drawn at all, the board gets that height back, and the letter
colours move to a compact non-interactive strip (`.cw-legend`) below the canvas.
**Flipping the default is one word** if the group decides the other way.

How it works, and each part is load-bearing:

- **A hidden, focusable input is the only way to ask for a system keyboard.**
  It is off-screen with `opacity: 0`, not `display: none`, because a hidden
  element cannot take focus. `font-size: 16px` stops iOS zooming on focus.
- **It holds one non-breaking space forever and is never allowed to change.**
  Every edit is read and cancelled. That is what makes BACKSPACE work: a
  browser will not report a delete on a field it believes is already empty, so
  a genuinely empty input can be typed into and never erased.
- **`beforeinput`, not `keydown`.** A phone keyboard often sends no usable
  `key` at all — predictive text reports `229` / `Unidentified`. What it always
  sends is the text it inserted, as `e.data`.
- **Bound NATIVELY, not through React's `onBeforeInput` prop.** React 18's
  synthetic beforeinput is a polyfill over `textInput` and does not see every
  `inputType` a phone produces, `deleteContentBackward` in particular.
- **THE DOUBLE-INPUT TRAP, in a new costume.** A physical keypress while the
  hidden input has focus fires both its `beforeinput` and the window `keydown`
  handler the game has always had — the same shape as #one-tap-two-letters,
  where one touch typed two letters. The window handler now stands down for any
  event whose target is that input. `?cwtype=` still exercises the drawn keys
  and still asserts `data-cw-typed`, in both modes.

`?devkbd=1|0` forces the mode at boot, because a device preference is otherwise
reachable only by opening Settings and tapping, which navigation cannot do.
`.cw-board` carries `data-cw-kbd="device"|"drawn"` so a check can see which is
live.

### Screen transitions (#235)

Navigation only — lobby, pre-game, opponent, the game, the locked day, the
profile and friends. **Not boards, cells, cards or canvases**: the hosted
native kit's own fidelity rules forbid animating high-frequency interactions,
and it fights the tap primitive, which gives its feedback on finger-DOWN
precisely so nothing has to wait. A card that animates when you tap it feels
slower, not more native.

**No JavaScript, and nothing remounts.** Each screen root genuinely mounts when
you navigate to it, so a plain CSS animation on its class is enough. That
matters: remounting a game at the wrong moment is how a finished 2048 board
came back as a fresh one (#158/#160), and a transition implemented with a
changing `key` would do exactly that.

**The one exception is the flip-deck's open card**, and it is a navigation
in all but name: the card BECOMES the pre-game panel. It still keeps the
rules that matter here. Nothing it shows measures a board (the board mounts on
the game screen, after it has gone), nothing remounts the lobby, the card's own
press feedback is still on finger-down (`tapProps`), and reduced motion (the
pref or the OS) opens and closes it with no motion at all (`cgReducedMotion` in
`DeckOpenCard`, plus both CSS lists). **At rest the 3D is switched off**, not
merely finished: a `transform`, `perspective` or `preserve-3d` ancestor is the
containing block of every `position: fixed` descendant, so the leaderboards
sheet inside the panel would otherwise open inside the card, rotated.

**Two variants, and the difference is not cosmetic.** A running `transform`
changes what `getBoundingClientRect` reports, and the boards here measure
themselves at mount (`useFitBox`, `sizeCanvas`). So:

- `.screen-in` — fade plus 6px of travel. Only on screens with **no measured
  board**: lobby, pre-game, opponent, profile, friends.
- `.screen-in-fade` — opacity only. `.game-body` and the locked day, both of
  which host a board that is measured on the frame it appears.

The fill mode is `backwards`, so nothing is left applied afterwards — a
lingering transform would make the element a containing block for the
`position: fixed` sheets that open over these screens.

**The in-app Reduced-motion pref now reaches CSS.** It had only ever reached JS
call sites, because the stylesheet could see the OS media query and not the
preference; `applyMotionPref()` mirrors it onto `<html data-reduce-motion="1">`.
The `:root[data-reduce-motion="1"]` block and the `prefers-reduced-motion`
media query list the same selectors — **add new motion to both**, or a player
gets it in one place and not the other. `?motion=reduce|full` forces it, the
way `?theme=` does.

### Marble Loop: aim, then fire (#212)

A tap used to fire immediately at wherever the finger landed, so on a phone you
found out where you had been aiming by watching the marble go there. **A touch
tap now aims; the next one fires** — the same ghost-then-confirm shape Gomoku
already uses for a board too dense to poke at. A tap pointing somewhere
materially different from the current aim RE-AIMS instead of firing
(`ZUMA_REAIM_RAD`), so correcting yourself never costs a marble. The **mouse is
unchanged**: hovering already shows the aim continuously, so on that input the
hover *is* the first tap.

**The trajectory guide is computed, not decorative.** `zumaAimPath` marches the
ray from the cannon and returns the first chain marble it would touch, using
the same 2R test the collision uses — so the line cannot promise a hit the
marble does not make. It is drawn only once an aim has been taken.

**The marble is bigger, and the number was measured.** `ZUMA_DIAM` is the
chain's spacing, so the radius is a difficulty knob whether you meant it or
not: a bigger marble makes the CHAIN longer and it reaches the skull sooner. At
R=13 the tightest board (free L3) goes from 53% to 62% of its own track, so
every level still starts with at least a third of the track empty.
**Re-measure if the levels or paths are retuned** — `marbleloop-aim` fails if
any level's chain exceeds 75% of its track.

**The supply bot.** Below `ZUMA_SUPPLY_AT` (5) marbles the cannon deals only
colours still ON the chain. A short chain can otherwise hold colours the cannon
has stopped dealing, and then the level cannot be finished at all. It picks a
*possible* colour, never the best one — which to fire and where is still the
player's problem.

**Touch is bound NATIVELY here, not through React's `onTouch*` props.** React 18
registers `touchmove` on the root as a PASSIVE listener, so `e.preventDefault()`
inside an `onTouchMove` prop does nothing — this file was calling it into the
void and relying on `.zuma-canvas { touch-action: none }`. A listener on the
element is also one a test can drive, which matters because touch now behaves
differently from the mouse and that difference IS the change.

`getCanvasCoords` also gained #208's length test. `e.touches` is always a
TouchList and a TouchList is an object, so `e.touches ? …` is true even when
EMPTY — which is exactly what touchend carries. Nothing hit it before because
touchend was only ever a bare "fire" signal that never asked where the finger
was; aim-on-tap asks.
### Mancala's sowing, and where a score belongs (#202)

**The sowing was never instant.** Every stone has been animated one at a time
since the start; the gap was a flat **80 ms**, which is under the ~100 ms a
person needs to register a discrete event — so a four-stone move was over in
320 ms and read as one jump rather than four placements. That is what the
report calls "turbo".

A flat number cannot fix it, because the pits are not all the same size:
whatever reads well for four stones drags for fifteen. `mncSowDelay(n)` derives
the gap from the COUNT — 170 ms each for a small handful, tightening as the
handful grows, bounded at both ends. 4 stones take 680 ms, 8 take 1100 ms,
15 take 1100 ms. **`MNC_SOW_BUDGET` is the single knob** — it is the length of
a typical move; the two bounds only stop the extremes being silly.
`cgReducedMotion()` collapses the wait to zero: the stones still land in order,
they just stop waiting to be watched.

**The store counts moved to the HUD.** They were drawn in the middle of each
store, directly over the seed pile they were counting — the number obscured the
thing it described and the thing it described obscured the number. The store
now holds seeds and a name; the score is a pill above the board in all three
modes (bot, local, online), where every other score in this app lives.

In the bot HUD the pill they replace was **"ZK"**, a verified/unverified
read-out with a tick, a cross and a lightning bolt. #224 removed every other
one of those at an admin's request and this was a third surface nobody had
spotted. The verification itself is untouched — it is the READ-OUT that goes,
exactly as in #224.

### The in-app "← Back" was never a back button (#186)

The reported "back resets to the main homepage" is not the browser's back
button and not the #134 reducer — both of those were already correct.
Measured, walking home → Story card → pre-game → Play in a browser:

| step | screen | history.length |
|---|---|---|
| start | lobby | 2 |
| tap Story | pregame | 3 |
| tap Play | game | 4 |
| **device back** | pregame | 4 |
| device back again | lobby | 4 |
| **in-app "← Back"** | **lobby** | **5** |

Every in-app back control called `backToLobby()`, which is a RESET — it clears
the game, the result, the mode and the practice flag and sets `screen` to
`'lobby'`. Because it changes state rather than unwinding, the reducer then
PUSHED another entry (4 → 5), so pressing in-app back and then device back went
*forward* into the board you had just left, and the history grew on every use.

**`goBack(fallbackTab)` is the fix, and it is the existing reducer rather than
a second one.** Each pushed entry now records its own depth (`unDepth`);
`goBack` calls `window.history.back()` when that depth is above zero and falls
back to `backToLobby(fallbackTab)` when it is not.

- **The depth-0 fallback is a safety rule, not a nicety.** This app runs in an
  iframe, and its `pushState` entries live in the JOINT session history. At
  depth 0 the entry behind us belongs to whoever loaded us, so `history.back()`
  there steps the EMBEDDING page rather than unwinding a screen. `navDepthOf`
  therefore reads 0 for anything that is not unambiguously one of our own
  entries — a foreign state object, a missing `un`, a non-finite or negative
  number — so a malformed entry fails toward "go home", never toward "leave the
  app". `nav-depth-fail-safe` asserts every one of those shapes.
- **What did NOT change**: the result cards' "Back to Lobby" buttons and the
  Ladder tab's "← Home". Their labels name a destination and going there is
  correct. Only the ← controls moved.
- The same bug existed on the social screens — Friends is reachable from your
  own profile, and its back went to the lobby, skipping the profile. Both now
  use `goBack()`.
- `data-nav-depth` on the app root is what a proposal check can see, since a
  check can navigate but cannot press back: home is `0` (the bottom of our
  stack) and a cold deep link is `1` (the lobby entry the deep-link effect
  pushed over, which is exactly what back returns to).

### New deep links

`?result=1` mounts a game and opens a representative results card over its
frozen board (`&review=1` lands collapsed into the minibar instead). It writes
NOTHING — dailies go through the inert `practiceMode` path, classics set local
`loseData` only — so it is deliberately **not** staging-gated and needs no seed
data (the "before" screenshot comes from production). It is checked **before**
the `modeSelect` branch in the deep-link effect, or 2048/Block Fit would
surface the mode chooser instead. `?snake=easy|normal|hard` preselects Snake's
difficulty so the board itself is URL-reachable (same role as `?sdk=9`); note
`SnakeGame`'s reset-to-chooser effect now skips its mount pass, which would
otherwise clobber the deep link immediately.

### Proposal tests: two traps this repo keeps falling into

Fixing five stale assertions (July 2026) turned up the same two causes each time.

**1. A test whose route is a `&play=1` daily is ORDER-DEPENDENT.** The whole
suite runs against one staging DB as one viewer, and several fixtures finish a
daily for that viewer — `demo=locked` and `demo=streak` finish `sudoku`,
`demo=solvedboard` finishes `nonogram`. Any test that later loads
`?game=<that game>&play=1` lands on the locked result screen and its board
assertion fails, depending purely on declaration order. **Point in-game daily
assertions at `?practice=1` instead**: it mounts the same board with the same
seed, claims nothing, and is not blocked by a finished day. `&play=1` is still
right for a route that specifically needs a *claimed* attempt (`demo=review`
seeds one on purpose).

**2. A screen reachable only by a tap is invisible to tests AND screenshots.**
Three merged tests asserted on the classic all-time leaderboard behind
ClassicShell's ☰ sheet, which navigation cannot open — so they had never actually
been checking a leaderboard. `?sheet=<sectionId>` now deep-links any sheet tab
(`menu`, `leaderboard`, `history`, `stats`, `settings`, ignored when the game has
no such section). Add a deep link rather than retargeting the assertion at
whatever the route happens to render.

Two real bugs were hiding behind those stale tests, which is the argument for
not just deleting them:

- **`ClassicLeaderboard` only read `data.entries`.** The per-game boards reached
  through `url` return `{ top }` (`/api/snake/leaderboard`), so Snake's sheet
  leaderboard rendered "No scores yet — play to rank!" however many scores
  existed. It now accepts either key.
- **Snake's difficulty chooser passed `sheetSections={[]}`**, so the leaderboard
  was unreachable until you had already committed to a difficulty — the one
  moment you'd most want it. It now carries that one section.

Also stale, and worth knowing when writing assertions: the phase-7 home reorg
deleted the "Daily Puzzles" / "Classic Games" section titles (it is one merged
**All Games** grid with filter chips now), and the rename sweep made "Mini
Sudoku" just **Sudoku**. Prefer `expectSelector` for structure and reserve
`expectText` for copy that is genuinely part of the product's voice — and note
that `innerText` reflects `text-transform`, so a `.plabel` reading "Board" in the
source matches "BOARD" at runtime.

## Hash Rush is a striking game now (#215)

Hash Rush used to be a lane dodger: you steered a miner and collected what it
ran into. It is **tap-to-mine**. Nothing steers — you hit what falls. Four
rules, and they are what the issue asked for, so don't quietly undo them:

- **⛏️ hash** — tapping it pays `HR_TOKEN_SCORE`, doubled while boosted.
- **⚡ lightning** — tapping it **ADDS** `HR_BOOST_SECS` to whatever boost you
  already have, capped at `HR_BOOST_MAX`. It used to *assign*, so a second bolt
  threw away the remainder of the first: that was the reported "redundant
  triggers", and it is why bolts now stack.
- **🧨 TNT** — tapping it costs `HR_TNT_PENALTY` points, floored at zero. It
  does **not** take a life: there is nothing to dodge any more, so the penalty
  *is* the hazard, and leaving it alone is the correct play.
- **A missed hash** — one that reaches the floor un-mined — is the only thing
  that costs a life, and running out of lives is what ends an endless run.

`hrPickAt` (which object a strike at x,y breaks) and `hrApplyStrike` (what it
does) are pure and are the only copies of either rule — the pointer path, the
keyboard path (1/2/3 or ← ↓ → strike the lowest thing in that lane) and
`hashrush-strike-rules` all go through them. Same pair-of-pure-functions shape
as `ngGeometry`/`ngCellAt`, for the same reason.

### The spawn schedule is a function of elapsed time, not of frames

The old loop accumulated a `spawnT` and fired when it crossed the interval,
which overshoots by up to one frame **every** spawn — so a slow device was
dealt a measurably shorter stream over the same 90 seconds. Survivable when the
score was "how long did you last"; not survivable now that a daily's content
and a level's target both come off that stream. `hrEveryAt` / `hrDrawObj` are
the one rule, and `hrSpawnPlan` (ahead of time) and the loop (as time passes)
are its two readers. **Keep them reading the same pair.**

### A level's target is DERIVED, not picked

"Clear winning thresholds per level" needs a number per level, and an eyeballed
number goes stale the moment any constant moves — the `TM_LAYOUTS` /
`MJ_LAYOUTS` trap. So `hrTargetFor` plays the level's own spawn plan with an
explicit model of a player (`HR_MODEL_TPS` taps/sec, `HR_MODEL_LAG` reaction,
`HR_MODEL_REACH` before an object is gone, never taps TNT) and takes
`HR_TARGET_FRACTION` of what that scores. Story seeds are stable per band and
the daily seed is shared, so two players on one level get the same target. It
is computed from a **second** rng on the same seed, because the run's own
generator is about to be consumed by play.

**`HR_TARGET_FRACTION` is the single balance knob** — there are no per-level
numbers to move. 0.7 comes from a second measurement: replaying each level 300
times with a player who mines only part of what it reaches and fumbles into
some TNT scores, as a share of the perfect model, ~0.92 (mines 95%, hits 3% of
TNT), ~0.78 (85% / 8%) and ~0.59 (72% / 15%) — and those rows are almost flat
across all six levels, which is why one constant does the job. The ladder's
difficulty lives in stream density and TNT share instead. Note the tap BUDGET
never binds: the model misses at most one object a level even at 3.1 spawns a
second, because it only strikes hashes and bolts. **This game asks for accuracy,
not speed.**

The one input here that is not measured is what share a real hand actually
mines on a phone. That is a playtest. If the ladder turns out too hard or too
soft, move `HR_TARGET_FRACTION` and re-run `hashrush-level-targets`, which
fails if any level asks for more than the model can score or if the targets
stop rising.
