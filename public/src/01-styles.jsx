const css = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&family=Fraunces:ital,opsz,wght@0,9..144,500..900;1,9..144,500..900&family=DM+Serif+Display&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');

/* ---- Theme tokens ----
   Light is the :root default; dark is one attribute flip away. The inline
   boot script in index.html sets data-theme before first paint, so a
   dark-mode player never sees an ivory flash. */
:root {
${paletteVars('light')}
}
:root[data-theme="dark"] {
${paletteVars('dark')}
}

/* The hosted native kit's accent follows ours in both themes, so kit
   switches, action sheets, toasts and pull-to-refresh match the teal.
   Overridden here, never by forking kit CSS. */
:root, :root[data-theme="dark"] {
  --un-accent: var(--c-accent);
  --un-accent-contrast: #fff;
  /* The toast surface is dark in both themes, so its action label is a
     light teal in both. */
  --un-toast-action: #5EEAD4;
}

/* ---- Safe-area insets (platform-forwarded) ----
   Inside the platform's app frame env(safe-area-inset-*) is always 0px: a
   cross-origin iframe is never the top-level document, so the browser hides
   the notch and the home indicator from it. The hosted bridge forwards the
   rectangle that actually applies to this frame instead, as
   --un-safe-inset-top/right/bottom/left on <html> (px), and leaves them
   unset when the app is opened standalone — where bare env() is the right
   answer. Reading them through the var(--pc-safe-*) tokens below is what
   makes every rule in this file correct in both hosts; a bare env() in an
   app rule is inert in-frame, which is the bug the audit fixed.

   On a desktop or an un-notched phone every forwarded value is 0, so each
   calc() below collapses to exactly the spacing it had before — the change
   is a no-op in the common case, not a restyle. */
:root {
  --pc-safe-top: var(--un-safe-inset-top, env(safe-area-inset-top, 0px));
  --pc-safe-right: var(--un-safe-inset-right, env(safe-area-inset-right, 0px));
  --pc-safe-bottom: var(--un-safe-inset-bottom, env(safe-area-inset-bottom, 0px));
  --pc-safe-left: var(--un-safe-inset-left, env(safe-area-inset-left, 0px));
}

/* A padded box that must also reach the screen edge (a sticky or fixed
   bottom strip): same idea, but the caller already owns its own padding
   and only the inset is added, so the surface still touches the edge. */
.safe-bottom { padding-bottom: calc(var(--pc-pad-b, 0px) + var(--pc-safe-bottom)); }
* { box-sizing: border-box; margin: 0; padding: 0; }

/* Painted on <html> too, so overscroll/rubber-band areas match the theme. */
html { background: ${C.bg}; }

body {
  font-family: 'Space Grotesk', system-ui, sans-serif;
  background: ${C.bg};
  color: ${C.text};
  -webkit-font-smoothing: antialiased;
  /* No faux bold/italic: a style we didn't load should fail visibly,
     not render as a browser-synthesized slant (the old masthead bug). */
  font-synthesis: none;
}

.mono { font-family: 'JetBrains Mono', monospace; }

#root { min-height: 100vh; min-height: 100dvh; }

.app {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex; flex-direction: column;
  /* The bottom inset lifts every scrolling screen clear of the home
     indicator; each screen supplies its own horizontal gutter, so only the
     bottom is added here. A fit shell (.app-fit) is pinned to one viewport,
     so its own chrome carries the bottom inset instead and this resets to 0
     or the box would overflow by the inset. */
  padding-bottom: var(--pc-safe-bottom);
}
.app.app-fit { padding-bottom: 0; }

/* ---- Nav bar ---- */
/* #223 — the bar was 78px tall at 390px wide, and it is sticky, so it cost
   that on EVERY screen, above every board. Two thirds of it was one thing:
   "Game Corner" plus the score/streak/gear/avatar cluster came to 374px of
   min-content inside a 350px content box, so the wordmark WRAPPED to two
   lines and set the bar's height from the brand rather than from the stats.
   Nothing is dropped here — the wordmark is held on one line, the type is
   stepped down, and the padding and gaps are tightened until the stats are
   the tallest thing in the bar again. Measured back to 50px. */
.nav {
  background: ${C.surface};
  border-bottom: 1px solid ${C.border};
  padding: 0.45rem 1.25rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: sticky;
  top: var(--pc-safe-top);
  z-index: 10;
}
.nav-brand {
  font-weight: 700;
  font-size: 1.02rem;
  line-height: 1.2;
  /* Load-bearing: without it the wordmark wraps and the bar grows 24px.
     It raises the brand's min-content width, which is why the narrow
     media queries below tighten the cluster to match (see #236). */
  white-space: nowrap;
  letter-spacing: -0.01em;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.nav-brand .logo { color: ${C.accent}; }
/* The stacked label + value is the bar's height floor now, so both carry an
   explicit line-height: the default leading was adding 8px of nothing. */
/* Earned-badge collection strip (lobby + profile) */
.badge-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.75rem;
}
.badge-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: ${C.text};
  background: ${C.surface};
  border: 1px solid ${C.border};
  border-radius: 999px;
  padding: 0.28rem 0.65rem;
  white-space: nowrap;
}
.badge-chip .badge-chip-icon { font-size: 1rem; line-height: 1; }
.badge-chip.locked { opacity: 0.35; }
.badge-chip.active { border-color: ${C.emerald}; color: ${C.emerald}; background: ${ca('emerald','14')}; }
/* Win-overlay "milestone unlocked" flourish */
.badge-unlock {
  margin: 0.4rem 0 0.9rem;
  padding: 0.7rem 0.9rem;
  border-radius: 12px;
  text-align: center;
  background: linear-gradient(135deg, ${ca('emerald','22')}, ${ca('gold','22')});
  border: 1px solid ${ca('emerald','55')};
  animation: badgePop 0.5s ease;
}
.badge-unlock .bu-icon { font-size: 1.8rem; line-height: 1; }
.badge-unlock .bu-title { font-size: 0.7rem; letter-spacing: 0.08em; text-transform: uppercase; color: ${C.muted}; margin-top: 0.25rem; }
.badge-unlock .bu-name { font-size: 1.05rem; font-weight: 700; color: ${C.emerald}; }
@keyframes badgePop {
  0% { transform: scale(0.8); opacity: 0; }
  60% { transform: scale(1.05); }
  100% { transform: scale(1); opacity: 1; }
}
.win-badge-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  margin-bottom: 0.6rem;
  font-size: 0.85rem;
  color: ${C.muted};
}
.win-badge-row .wbr-icon { font-size: 1.1rem; }
.badge-chip .badge-chip-name { line-height: 1; }
/* Badge collection wrapper (lobby + profile) */
.badge-strip-wrap { margin-top: 1rem; }
.badge-strip-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: ${C.muted};
}
.badge-strip-head .badge-strip-count { color: ${C.text}; }
/* Sub-heading inside the badge collection — separates the story-ladder chips
   (one per game with a story mode) from the streak/achievement chips above. */
.badge-strip-sub {
  margin-top: 0.85rem;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: ${C.muted};
}
/* Badge accordion trigger — base styles, mobile activation via @media (max-width: 560px) */
.badge-strip-trigger {
  display: flex; align-items: center; justify-content: space-between;
  width: 100%; background: none; border: none; padding: 0;
  font: inherit; color: inherit; cursor: default; text-align: left;
  font-size: 0.8rem; font-weight: 700; letter-spacing: 0.04em;
  text-transform: uppercase; pointer-events: none;
}
.badge-strip-trigger .badge-strip-count { color: ${C.text}; }
.badge-chevron {
  display: none; /* hidden on desktop */
  margin-left: 0.4rem; font-size: 0.85rem; color: ${C.muted};
  transition: transform 280ms ease; flex-shrink: 0;
}
.badge-chevron.open { transform: rotate(180deg); }
/* On desktop the body is always visible — transitions only activate at ≤560px */
.badge-strip-body { display: block; }
@media (max-width: 640px) {
  .badge-strip {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.5rem;
  }
  .badge-chip {
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    border-radius: 12px;
    padding: 0.65rem 0.3rem;
    gap: 0.25rem;
    white-space: normal;
  }
  .badge-chip .badge-chip-icon { font-size: 1.8rem; }
  .badge-chip .badge-chip-name { font-size: 0.62rem; line-height: 1.2; }
}
/* Today's Top Scores leaderboard tweaks (reuses .lboard) */
.lboard .lrow.clickable { cursor: pointer; }
.lboard .lrow.clickable:hover { background: ${C.border}; }
/* Win-overlay "couldn't sync" note + retry */
.win-sync-note {
  margin: 0.4rem 0 0.7rem;
  padding: 0.55rem 0.7rem;
  border-radius: 10px;
  font-size: 0.82rem;
  text-align: center;
  color: ${C.gold};
  background: ${ca('gold','14')};
  border: 1px solid ${ca('gold','55')};
}
.win-sync-note button {
  margin-top: 0.4rem;
  font: inherit;
  font-weight: 700;
  color: ${C.text};
  background: ${C.surface};
  border: 1px solid ${C.border};
  border-radius: 8px;
  padding: 0.3rem 0.7rem;
  cursor: pointer;
}

/* ---- Account indicator ---- */
.nav-right { display: flex; align-items: center; gap: 0.75rem; }
.account-chip {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  background: ${C.card};
  border: 1px solid ${C.border};
  border-radius: 999px;
  padding: 0.25rem 0.6rem 0.25rem 0.3rem;
  cursor: default;
}
.account-chip .avatar {
  width: 1.35rem;
  height: 1.35rem;
  border-radius: 50%;
  background: ${C.accent};
  color: white;
  font-size: 0.8rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}
.account-chip .who { display: flex; align-items: center; line-height: 1.2; }
.account-chip .uname { font-size: 0.82rem; font-weight: 600; }
.account-chip .dot {
  width: 0.5rem; height: 0.5rem; border-radius: 50%; flex: 0 0 auto;
}
.account-chip.off { border-color: ${C.rose}; }
.account-chip.off .dot { background: ${C.rose}; }
.account-chip.off .who { color: ${C.rose}; font-size: 0.82rem; font-weight: 600; }
.account-chip.on { cursor: pointer; font-family: inherit; color: ${C.text}; transition: border-color 0.12s ease; }
.account-chip.on:hover { border-color: ${C.accent}; }

/* #236 — the page wrapper shared by the profile and friends screens.
   These sit directly under .app, which is a COLUMN flex container, so they
   are flex items — and an auto horizontal margin opts a flex item out of
   align-items: stretch. That is the same trap the .fit-col boards hit: with
   no definite width the box falls back to fit-content, and fit-content is
   clamped UP to min-content. The profile's min-content is ~460px (an
   unbreakable username plus a recent-games row that cannot shrink), so the
   whole page scrolled sideways on every phone — 70px at 390, 140px at 320.
   width: 100% restores a definite width; max-width still centres it on
   desktop. min-width: 0 keeps the item shrinkable if the container ever
   becomes a ROW flex, where the automatic minimum size would apply instead. */
.social-page {
  width: 100%;
  min-width: 0;
  max-width: 620px;
  margin: 0 auto;
  /* A profile or friends page is a normal scrolling screen: its own gutters
     grow by the forwarded x insets so content clears a landscape notch. */
  padding: 1.5rem calc(1.25rem + var(--pc-safe-right)) 1.5rem calc(1.25rem + var(--pc-safe-left));
}
/* A username is user-supplied and can be one long unbreakable token, which is
   what made min-content exceed the viewport in the first place. Let it wrap
   rather than push the page wide, and let its column shrink. */
.profile-id { min-width: 0; }
/* Recent-games row. The date and the score are fixed-width monospace and do
   not shrink, so on a narrow card they left the game name almost nothing —
   "Daily Cipher" truncating to "Dail…". Below 460px the meta pair drops to
   its own line instead of competing with the name for the same one. */
.prr {
  display: flex; align-items: center; gap: 0.6rem;
  padding: 0.5rem 0.2rem; font-size: 0.88rem;
}
.prr-icon { font-size: 1.1rem; flex: 0 0 auto; }
.prr-name { flex: 1 1 auto; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.prr-meta { display: flex; align-items: center; gap: 0.6rem; flex: 0 0 auto; }
.prr-date { color: ${C.muted}; font-size: 0.78rem; }
.prr-score { font-size: 0.82rem; white-space: nowrap; }
@media (max-width: 460px) {
  .prr { flex-wrap: wrap; row-gap: 0.15rem; }
  /* The name takes the rest of the first line beside the icon; the meta pair
     wraps below and lines up under the name, not the icon. */
  .prr-meta { width: 100%; padding-left: 1.7rem; justify-content: flex-start; }
}
.profile-id h2 { overflow-wrap: anywhere; }
.bounce-start-btn {
  pointer-events: auto;
  min-height: 44px; padding: 0 1.4rem; margin-top: 0.35rem;
  font-size: 0.95rem; font-weight: 700;
}
.bounce-start-hint { font-size: 0.75rem; color: ${C.muted}; }
/* #214 — Match 3's end-of-puzzle screen. The game set a 'won'/'lost' phase
   that nothing rendered, so a finished puzzle showed "Loading..." forever. */
.m3-result {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 0.5rem; padding: 2rem 1.25rem; text-align: center;
}
.m3-result-icon { font-size: 2.6rem; line-height: 1; }
.m3-result-title { font-size: 1.25rem; font-weight: 700; color: ${C.text}; }
.m3-result-sub { font-size: 0.88rem; color: ${C.muted}; }
.m3-result-actions { display: flex; flex-wrap: wrap; gap: 0.6rem; margin-top: 1rem; justify-content: center; }
.m3-result-btn { min-height: 44px; padding: 0 1.2rem; border-radius: 12px; font-family: inherit; font-size: 0.9rem; font-weight: 600; cursor: pointer; }
.m3-result-btn-quiet { background: ${C.surface}; border: 1px solid ${C.border}; color: ${C.text}; }
/* Profile "Connections" section — Friends entry, shown on mobile only. */
.account-connection-row {
  display: flex; align-items: center; gap: 0.6rem; width: 100%;
  background: ${C.dim}; border: 1px solid ${C.border};
  border-radius: 10px; padding: 0.7rem 0.9rem;
  font-size: 0.9rem; font-weight: 600; color: ${C.text};
  cursor: pointer; text-align: left; transition: border-color 0.15s;
}
.account-connection-row:hover { border-color: ${C.accent}; }
.account-connection-row .chev { margin-left: auto; color: ${C.muted}; }
/* The Connections section is only shown at narrow widths — above 560px the
   Friends button lives in the top bar instead. */
@media (min-width: 561px) {
  .account-connections { display: none; }
  /* …except the Settings entry, which has no desktop equivalent elsewhere
     on the profile (the nav gear is the other entry point). */
  .account-connections.account-connections-always { display: block; }
  /* Force badge accordion always-open on desktop/tablet regardless of JS state */
  .badge-strip-body { max-height: none !important; opacity: 1 !important; overflow: visible !important; }
  .badge-strip-trigger { cursor: default; pointer-events: none; }
  .badge-chevron { display: none !important; }
}

@media (max-width: 560px) {
  .account-chip .who { display: none; }
  .account-chip { padding: 0.25rem; }
  .nav-right { gap: 0.6rem; }
  /* The phones are where the forwarded insets actually apply, so the gutter
     grows by them here rather than being replaced by a bare shorthand. */
  .lobby { padding: 1rem calc(0.75rem + var(--pc-safe-right)) 1rem calc(0.75rem + var(--pc-safe-left)); }
  .lobby-head h1 { font-size: 1.3rem; }
  .lobby-head p { font-size: 0.85rem; }
  /* The Friends chip moves into the profile's Connections section
     on mobile. Scoped under .nav-right so it outranks the base chip rules
     defined later in this stylesheet regardless of source order. */
  /* Badge accordion: trigger is interactive on mobile */
  .badge-strip-body { overflow: hidden; transition: max-height 280ms ease, opacity 280ms ease; }
  .badge-strip-body.closed { max-height: 0; opacity: 0; }
  .badge-strip-body.open { max-height: 600px; opacity: 1; } /* 600px > any realistic badge grid height */
  .badge-chevron { display: inline-block; }
  .badge-strip-trigger { cursor: pointer; pointer-events: auto; }
}

/* The top bar's own contribution to horizontal scroll, and the last 9px of
   #236. The brand and the stats/settings/account cluster are both flex items
   with an automatic minimum size, so neither shrinks: below ~330px their
   combined min-content simply exceeds the viewport and the WHOLE app scrolls
   sideways, profile included. Nothing is dropped here — the gaps and the
   bar's own padding are just tightened enough to fit a 320px screen. */
@media (max-width: 380px) {
  .nav { padding-left: 0.6rem; padding-right: 0.6rem; }
  .nav-right { gap: 0.4rem; }
  /* The wordmark is nowrap now, so it can no longer absorb the squeeze by
     wrapping. On the smallest screens it TRUNCATES instead — never
     display:none, because a clipped node still reports its full text to
     innerText, so the checks that assert on "Game Corner" from a game
     screen keep passing, and #236's horizontal scroll still cannot happen. */
  .nav-brand { min-width: 0; }
  .nav-brand .brandword { overflow: hidden; text-overflow: ellipsis; }
}

/* ---- Lobby ---- */
.lobby { max-width: 920px; margin: 0 auto; padding: 1.75rem calc(1.25rem + var(--pc-safe-right)) 1.75rem calc(1.25rem + var(--pc-safe-left)); width: 100%; }
.lobby-head { margin-bottom: 1.5rem; }
.lobby-head h1 { font-size: 1.6rem; font-weight: 700; letter-spacing: -0.02em; }
.lobby-head p { color: ${C.muted}; margin-top: 0.25rem; font-size: 0.92rem; }
.lobby-head .reset-countdown {
  margin-top: 0.5rem;
  color: ${C.accent};
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: 0.01em;
}

/* #182 — phones get TWO cards per row, not one.

   The old rule here was a single-column override below 380px, but the
   one-column phone grid was never really that rule's doing: .lobby drops to
   0.75rem side padding at 560px, so the content box is (viewport - 24px), and
   auto-fill needs 200 + 16 + 200 = 416px for a second track. 320/390/430px
   phones all fall short, so EVERY phone got one column and a ~9,800px scroll
   through 30 cards. Removing the override alone fixes nothing — the track
   floor has to come down too, which is what this rule does.

   minmax(0, 1fr) rather than a bare 1fr: 1fr is minmax(auto, 1fr), whose auto
   floor is the card's min-content width, and a long unbroken game name would
   push the track wider than half the row and overflow. grid-auto-rows: 1fr
   above still applies, so the uniform-tile-height guarantee is untouched. */

/* Card icon on a rounded tile in the game's tint, so the grid scans by game
   art first and text second (Poki/CrazyGames picture-first tiles). */
/* #167 — clamped, so a long name or blurb can never grow its own tile (and,
   with grid-auto-rows: 1fr, can never grow the whole wall). The desc keeps a
   two-line floor as well as its new two-line ceiling, so short and long blurbs
   push the footer to exactly the same place. */

/* #167 — the state footer. margin-top: auto is what pins it to the bottom of a
   stretched tile; .card-desc's margin-bottom is the minimum gap above it. .tag
   is an inline-block pill and a flex item gets blockified, so without
   align-self it would stretch to the full card width. These .card > X
   selectors outrank the plain margin-top declarations in .tag / .card-lock /
   .card-resume / .card-modes by specificity, whatever the source order. */

.tag {
  display: inline-block;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.62rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 0.2rem 0.5rem;
  border-radius: 999px;
  margin-top: 0.75rem;
}

/* ---- Game screen ---- */
.game-wrap { max-width: 620px; margin: 0 auto; padding: 1.5rem calc(1.25rem + var(--pc-safe-right)) 1.5rem calc(1.25rem + var(--pc-safe-left)); width: 100%; }

/* Fit-to-viewport layout mode (slice 1). A daily game that opts in renders
   header + board + controls inside one non-scrolling column: the board region
   is the only flexible child, and useFitBox measures it to size the cells.
   The .app-fit class pins the whole shell to one viewport (100dvh, not vh, so
   mobile browser chrome collapsing doesn't clip the pad) and the wrap then
   takes whatever is left BELOW the nav — sizing the wrap itself to 100dvh
   would push the nav's height back out into a scrollbar.
   NOTE: no backticks in this block — the whole stylesheet is one template
   literal, so a stray backtick silently ends the string. */
.app.app-fit { height: 100dvh; min-height: 0; overflow: hidden; }
.app.app-fit .nav { flex: 0 0 auto; }
.game-wrap.fit {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* A fit shell is pinned to one viewport (.app-fit), so .app adds no bottom
     padding and this wrap must carry the inset itself or its footer sits
     under the home indicator. The x insets keep a landscape notch off the
     board. */
  padding: 0.7rem calc(0.9rem + var(--pc-safe-right)) calc(0.7rem + var(--pc-safe-bottom)) calc(0.9rem + var(--pc-safe-left));
  gap: 0.45rem;
}
.game-wrap.fit .game-head { flex: 0 0 auto; margin-bottom: 0; }
.game-wrap.fit .fit-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.game-wrap.fit .fit-board {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
/* In fit mode the hint is a fixed footer line, not a scroll-away paragraph —
   the board flexes around it so it can never be pushed off the viewport. */
.game-wrap.fit .p6-hint { flex: 0 0 auto; margin-top: 0; font-size: 11.5px; line-height: 1.35; }
/* A daily's own root, inside .game-wrap.fit: a column whose board region is
   the single flexible child. Games opt in by adding .fit-col to their root. */
.fit-col {
  display: flex; flex-direction: column; min-height: 0; flex: 1 1 auto; gap: 0.5rem;
  /* Pin the column to the available width. Without this a wide min-content
     child (a five-pill status bar is ~400px) grows the column past the
     viewport and the overflow gets clipped instead of wrapping. */
  width: 100%; max-width: 100%; min-width: 0;
}
/* Stat pills wrap rather than forcing the column wider than the phone —
   a five-pill row is ~400px and would push the board off a 360px screen. */
/* Everything that is NOT the board is fixed-size, so only the board flexes.
   Miss one of these and it gets crushed to zero height by the board. */
.fit-col .p6-hint,
.fit-col .word-list,
.fit-col .p6-banner,
/* PHASE 3 — Daily Cipher never opted into the fit column, so its 8-row board
   plus 3-row keyboard was CLIPPED by the fit shell's overflow:hidden rather
   than fitted; players lost sight of Enter on long words. Everything except the
   board is fixed-size so only the board flexes. Word Sprint / Anagram Sprint
   growing lists get their own scroll strip below. */
.fit-col .wspr-found, .fit-col .an-solved,
.fit-col .dsnk-hint, .fit-col .dbnc-effects,

/* Growing lists must never push the board off screen (#131, #130). */
.fit-col .wspr-found, .fit-col .an-solved, .fit-col .word-list {
  max-height: 5.2rem; overflow-y: auto; overscroll-behavior: contain;
}
/* PHASE 3 — no page scroll while a run is live. useScrollLock() owns the
   document; these kill the inner rubber-band / pull-to-refresh on the boards
   the finger actually drags across. */
.cg-stage, .game-wrap, .dbnc-wrap, .dsnk-board, .fit-scale-box,
.wordsearch, .tm-stage, .bb-board-wrap, .dr-board {
  overscroll-behavior: contain;
}
html.un-scroll-locked, body.un-scroll-locked {
  overflow: hidden !important;
  overscroll-behavior: none;
  touch-action: pan-x pan-y;
}
/* #149 — an AUTO CROSS-AXIS MARGIN OPTS A FLEX ITEM OUT OF align-items:stretch,
   collapsing it to its fit-content size. Every one of these boards carries
   "margin: … auto" for centering outside the fit column, and inside it that
   silently shrank them: at 390px (a 361px column) sudoku rendered 220px, the
   numpad 121px (tall thin ovals instead of digit keys), word search 224px,
   word sprint 150px — and Daily Snake 16px, i.e. unplayable.
   "width: 100%" makes the cross size DEFINITE again, so the autos resolve to 0
   (or centre the board within its own max-width) instead of driving the size.
   The fitcol-auto-margin self-test guards the whole class of bug. */
/* Fluid square grids (Sudoku, Word Hunt) fit BOTH axes natively — no
   transform needed, so their pointer-drag selection math is untouched. */
.fit-col .sudoku, .fit-col .wordsearch {
  width: 100%; height: auto; max-width: 100%; max-height: 100%;
  margin: 0 auto; aspect-ratio: 1;
}
/* Same collapse, same cure: Word Sprint's 4×4 grid and Daily Snake's board
   keep their own max-width caps (320 / 340) and centre within the column. */
.fit-col .wspr-grid, .fit-col .dsnk-board { width: 100%; }
/* Sudoku's difficulty chooser is a fixed-size card, not a board. */
.fit-col .sdk-choose { flex: 0 0 auto; width: 100%; }
/* Controls wave — the shared frame host. A migrated game's whole frame
   (pills, board, buttons) is ONE canvas inside this box; the legacy board
   class stays on the box so width rules and probes keep holding. In a fit
   column the frame IS the flexible child; these overrides out-rank the
   square-board rules above by source order. */
.cui-frame {
  display: flex; align-items: flex-start; justify-content: center;
  width: 100%; margin: 0 auto; touch-action: none;
}
.fit-col .cui-frame {
  flex: 1 1 auto; min-height: 0;
  height: auto; max-height: 100%; aspect-ratio: auto;
}
/* The control strip for real-time boards (CuiBar). */
.cui-bar { width: 100%; flex: 0 0 auto; touch-action: none; }
.cui-bar-canvas { display: block; }
/* #170 — the canvas board box is the flexible region (the .dbnc-wrap idiom):
   useFitBox measures it and the canvas sizes its cards/tiles to fill it.
   Klondike first; Spider and Mahjong joined in the wave-1 migration. */
.kl-board-box, .sp-board-box, .mj-board-box {
  position: relative; flex: 1 1 auto; min-height: 0; min-width: 0;
  display: flex; align-items: flex-start; justify-content: center;
  overscroll-behavior: contain;
}

/* Scale-to-fit board wrapper (slice 5). The box is the flexible region; the
   content keeps its natural layout size and is scaled as one unit. */
.fit-scale-box {
  flex: 1 1 auto; min-height: 0; min-width: 0;
  display: flex; align-items: center; justify-content: center; overflow: hidden;
}
.fit-scale-content { transform-origin: center center; flex: 0 0 auto; }

/* Interactive board cells must never wait on double-tap-to-zoom detection —
   that browser delay is most of the "laggy clicking" in the daily grids.
   PHASE 2: this list is now registry-wide. An audit of all 33 games found the
   delay on ~20 of them; a game whose tappable element is NOT in this list (or
   does not carry .tappable) pays ~300ms per tap on touch.

   #163 — GENERATED from TAPPABLE_CLASSES, one rule per class, and the same
   generator emits the .${TAP_CANARY_CLASS} probe rule. A comma list was
   all-or-nothing: one selector the engine rejects drops every class with it,
   which is exactly the failure that was being reported. Adding a game means
   adding its cell class to TAPPABLE_CLASSES — the CSS and the self-test both
   follow automatically. */
${emitTouchActionRules()}
/* Canvases that own their own drag/long-press recognizer take the pointer
   stream outright, so the browser never scrolls or zooms out from under it.
   Emitted AFTER the generated block so it wins on source order. */
.board-canvas { touch-action: none; display: block; }

/* PHASE 2 — the one press idiom. Generalised from .ng-mode-btn/.mf-mode-btn,
   which were the only correct examples in the file. Before this, the app had 8
   :active rules against 69 :hover rules, and a finger never fires :hover —
   which is the whole "I tapped and nothing happened" complaint. Set
   [data-pressed] on pointerdown so the feedback lands on finger-DOWN, not on
   the delayed click, and clear it on up/cancel/lostpointercapture so it can
   never stick. */
${emitTapHighlightRules()}
/* NO BACKTICKS in this comment — it lives inside the css template literal.

   #173 turned almost every tappable BOARD into a canvas and removed the
   per-class selectors that used to follow this one — but it removed the
   rule's BODY with them, leaving the .tappable:active/[data-pressed] selector
   list ending in a comma directly above .sr-only. A trailing comma does not
   end a selector list, so the two became ONE rule and every tappable control
   in the app inherited the visually-hidden treatment: absolutely positioned,
   clipped to 1px, gone from layout for exactly as long as it was held down.

   That is not only a cosmetic flicker. An element that leaves the flow on
   pointerdown is not under the cursor on pointerup, so the click lands on
   whatever moved into its place and the press never completes — the button
   vanishes while held and does nothing when released.

   Only .tappable is left to style: every other entry in TAPPABLE_CLASSES is a
   canvas now, and a canvas must NOT be scaled here — it draws its own pressed
   state through cuiDrawControls. The press-feedback-visible self-test asserts
   a held control still occupies space, so this cannot come back quietly. */
.tappable:active, .tappable[data-pressed] {
  filter: brightness(0.9);
  transform: scale(0.96);
}
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

/* End-screen board review (slice 4). The finished board stays mounted under
   the results card; .frozen makes it inert and visually settled, and the
   minibar is what the card collapses into. */
/* PHASE 1 — the wrapper is now ALWAYS rendered (see the render note in App), so
   it must be layout-transparent: without this the fit column's flex: 1 1 auto
   would resolve against a plain block instead of .app.app-fit and collapse.
   A flex pass-through, NOT display:contents — contents generates no box, so
   .frozen's filter/pointer-events below would have nothing to apply to.
   NOTE: no backticks in this block (see the stylesheet warning above). */
.game-body { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.game-body.frozen { pointer-events: none; filter: saturate(0.85); }
.game-body.frozen .game-wrap { padding-bottom: 5.5rem; }
/* PHASE 1 (#157/#160) — shell:'self' classics (Snake, Block Fit, Diamond Rush,
   Hash Rush) are frozen behind the results card now too. Their ClassicShell is
   a fixed full-viewport layer, so the fixed minibar would sit on top of the
   bottom of the stage; reserve the same gutter .game-wrap already gets. */
.game-body.frozen .cg-stage { padding-bottom: 5.5rem; }
/* PHASE 4 (#134) — the freeze used to kill the whole reviewed subtree, INCLUDING
   the header the shell renders inside it. That is why Back stopped working after
   "View board", and it hit every in-frame classic game's whole topbar (exit, ☰,
   ?, 💬) too, not just the dailies. Chrome stays live; only the board goes
   inert. */
.game-body.frozen .game-head,
.game-body.frozen .game-head *,
.game-body.frozen .cg-topbar,
.game-body.frozen .cg-topbar *,
.game-body.frozen .result-minibar { pointer-events: auto; }

.result-minibar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 60;
  display: flex; align-items: center; justify-content: space-between; gap: 1rem;
  /* The bar reaches the screen edge; only its CONTENT is lifted clear of the
     home indicator by the forwarded bottom inset. */
  padding: 0.85rem 1.1rem calc(0.85rem + var(--pc-safe-bottom));
  background: ${C.card}; border: none; border-top: 1px solid ${C.border};
  box-shadow: 0 -6px 22px rgba(63,51,24,0.14);
  font-family: inherit; font-size: 0.92rem; font-weight: 600; color: ${C.text};
  cursor: pointer; width: 100%; touch-action: manipulation;
}
.result-minibar .rmb-cta { color: ${C.accent}; font-size: 0.82rem; white-space: nowrap; }
.game-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}
.back-btn {
  background: ${C.card};
  border: 1px solid ${C.border};
  color: ${C.text};
  border-radius: 10px;
  padding: 0.45rem 0.8rem;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.85rem;
  transition: border-color 0.12s ease;
}
.back-btn:hover { border-color: ${C.accent}; }
.game-title { font-size: 1.25rem; font-weight: 600; display: flex; align-items: center; gap: 0.5rem; }


/* ---- Sudoku ---- */
/* The box hosts the board canvas; sizing is what fit-col rules and the
   self-tests measure, unchanged. Gridlines + box separators draw inside. */
.sudoku {
  display: flex; align-items: center; justify-content: center;
  border: 2px solid ${C.border};
  border-radius: 10px;
  overflow: hidden;
  max-width: 360px;
  margin: 0 auto;
  aspect-ratio: 1;
  touch-action: none;
}
.sdk-choose { max-width: 380px; margin: 1.5rem auto; text-align: center; }
.sdk-choose-title { font-size: 1.15rem; font-weight: 700; margin-bottom: 0.35rem; }
.sdk-choose-sub { color: ${C.muted}; font-size: 0.82rem; margin-bottom: 1.1rem; }
.sdk-choice {
  display: block; width: 100%; margin-bottom: 0.7rem; padding: 0.9rem 1rem;
  background: ${C.card}; border: 1px solid ${C.border}; border-radius: 12px;
  cursor: pointer; text-align: left; font-family: inherit; color: inherit;
  transition: border-color 0.12s ease, transform 0.12s ease;
}
.sdk-choice:hover { border-color: ${C.accent}; transform: translateY(-1px); }
.sdk-choice-name { display: block; font-size: 1.05rem; font-weight: 700; }
.sdk-choice-note { display: block; color: ${C.muted}; font-size: 0.78rem; margin-top: 0.15rem; }
/* ---- Word Sprint (daily Boggle-style word grid) ---- */
/* The grid box hosts the letter canvas now; its width/aspect constraints are
   what the fit-col rules and self-tests measure, unchanged. */
.wspr-grid {
  display: flex; align-items: center; justify-content: center;
  max-width: 320px; margin: 0 auto; aspect-ratio: 1;
  touch-action: none;
}
/* PHASE 3 (#131) — this list was unbounded and grew the document as you played,
   pushing the grid off screen. Own scroll strip, fixed height. */
.wspr-found {
  display: flex; flex-wrap: wrap; gap: 0.35rem; justify-content: center;
  max-width: 360px; margin: 0 auto;
  max-height: 5.2rem; overflow-y: auto; overscroll-behavior: contain;
}
.wspr-found span {
  background: ${C.card}; border: 1px solid ${C.border}; border-radius: 999px;
  padding: 0.15rem 0.6rem; font-size: 0.75rem; font-family: 'JetBrains Mono', monospace;
}
/* ---- Daily Snake / Daily Bounce (seeded daily arcade variants) ---- */
.dsnk-board {
  background: ${C.card}; border: 2px solid ${C.border};
  border-radius: 10px; overflow: hidden; max-width: 340px; margin: 0 auto; aspect-ratio: 1;
  touch-action: none;
}
/* The snake canvas fills whichever board box hosts it (classic or daily). */
.snake-canvas-fill {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
}
.dsnk-hint { text-align: center; color: ${C.muted}; font-size: 0.8rem; margin-top: 0.6rem; }
/* #149 — this is the flexible region of Daily Bounce's fit column, and its
   measured box is what sizeCanvas() reads to scale the canvas. Before, the
   canvas was pinned to its logical 320×430 and left ~135px of dead space. */
.dbnc-wrap { display: flex; justify-content: center; align-items: center; }
.fit-col .dbnc-wrap { flex: 1 1 auto; min-height: 0; min-width: 0; }
.dbnc-canvas {
  border: 2px solid ${C.border}; border-radius: 10px; background: #10131c;
  touch-action: none; max-width: 100%;
}
/* ---- Win overlay ---- */
.win-overlay {
  position: fixed;
  inset: 0;
  background: var(--c-scrim);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  /* A centred card: every gutter grows by the forwarded inset so it cannot
     run under the notch or the home indicator. */
  padding: calc(1.25rem + var(--pc-safe-top)) calc(1.25rem + var(--pc-safe-right))
           calc(1.25rem + var(--pc-safe-bottom)) calc(1.25rem + var(--pc-safe-left));
  overflow-y: auto;
  overscroll-behavior: contain;
}
.win-card {
  background: ${C.card};
  border: 1px solid ${C.border};
  border-radius: 18px;
  padding: 2rem 1.75rem;
  text-align: center;
  max-width: 360px;
  width: 100%;
  box-shadow: 0 20px 50px var(--c-shadow-lg);
  max-height: calc(100vh - 2.5rem - var(--pc-safe-top) - var(--pc-safe-bottom));
  max-height: calc(100dvh - 2.5rem - var(--pc-safe-top) - var(--pc-safe-bottom));
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}
.win-card .trophy { font-size: 2.6rem; }
.win-card h2 { font-size: 1.5rem; font-weight: 700; margin: 0.5rem 0 0.25rem; }
.win-card .sub { color: ${C.muted}; font-size: 0.9rem; margin-bottom: 1.25rem; }
.score-rows {
  text-align: left;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.9rem;
  border-top: 1px solid ${C.border};
  border-bottom: 1px solid ${C.border};
  padding: 0.9rem 0;
  margin-bottom: 1.25rem;
}
.score-row { display: flex; justify-content: space-between; padding: 0.18rem 0; }
.score-row .k { color: ${C.muted}; }
.score-row.bonus .v { color: ${C.emerald}; }
.score-row.total { font-weight: 600; font-size: 1.05rem; padding-top: 0.5rem; }
.score-row.total .v { color: ${C.gold}; }

/* #241 — the arcade moment. The card's default state is the ONE thing a
   player just earned, at a size you can read across a room; the breakdown,
   the badge furniture and the leaderboard live behind .win-more. Measured at
   390x780 before the split: 955px of content in a 740px box, and that was
   with an EMPTY leaderboard. */
.win-earned { margin: 0.1rem 0 1.1rem; }
.win-earned .we-k {
  display: block; font-size: 0.68rem; letter-spacing: 0.16em;
  text-transform: uppercase; color: ${C.muted};
}
.win-earned .we-v {
  display: block; font-family: 'JetBrains Mono', monospace;
  font-size: 3.1rem; line-height: 1.08; font-weight: 700; color: ${C.gold};
  font-variant-numeric: tabular-nums;
}
.win-earned .we-note { display: block; font-size: 0.82rem; color: ${C.emerald}; }
.win-flourish {
  font-size: 0.92rem; font-weight: 600; color: ${C.text};
  background: var(--c-well); border-radius: 999px;
  padding: 0.4rem 0.9rem; display: inline-block; margin-bottom: 1.1rem;
}
.win-more {
  width: 100%; margin-top: 0.35rem; background: none; border: none;
  color: ${C.muted}; font-family: inherit; font-size: 0.85rem;
  padding: 0.55rem; cursor: pointer; border-radius: 10px;
}
.win-more:hover { color: ${C.text}; background: var(--c-well); }
.win-details { margin-top: 0.5rem; }
.win-details > *:last-child { margin-bottom: 0; }

/* The pop is on the TROPHY, never on the number: an animation that does not
   run (a hidden tab, a screenshot capture) must not leave the score unreadable,
   and this one only ever affects an emoji. */
@keyframes un-win-pop {
  0%   { transform: scale(0.4) rotate(-14deg); }
  62%  { transform: scale(1.14) rotate(4deg); }
  100% { transform: scale(1) rotate(0); }
}
.win-card .trophy { animation: un-win-pop 420ms cubic-bezier(0.2, 0.8, 0.3, 1.2); }

.primary-btn {
  width: 100%;
  background: ${C.accent};
  color: white;
  border: none;
  border-radius: 12px;
  padding: 0.8rem;
  font-family: inherit;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s ease;
}
.primary-btn:hover { background: var(--c-accent-hover); }

/* Result-card button hierarchy. These MUST sit after .primary-btn.

   #216 — .review-btn was declared ~150 lines earlier, at the same specificity,
   so .primary-btn's accent background won and every secondary button on the
   result card rendered as a primary one. It had never applied. That is also
   why Play Again carried an inline copy of these exact declarations twice:
   inline was the only way to beat the cascade, and it left the card with one
   dark button among a column of purple ones — the button the report says is
   hard to see. Moving the rule down fixes the whole column at once. */
.review-btn {
  margin-bottom: 0.6rem; background: ${C.surface};
  border: 1px solid ${C.border}; color: ${C.text};
}
.review-btn:hover { border-color: ${C.accent}; background: var(--c-well); }

/* Play Again is the PRIMARY action on a result card: you have just finished a
   game, and the loudest thing on the screen should not be leaving. The ring is
   an OUTLINE and the glow a FILTER, deliberately — box-shadow is not ours to
   use here, because the hosted native kit puts its own shadow on every button
   and wins, so a box-shadow glow would silently do nothing. Outline costs no
   layout either: it draws outside the border box, so nothing on the card
   moves. */
.play-again-btn {
  margin-bottom: 0.6rem;
  background: ${C.accent};
  color: white;
  border: 1px solid ${ca('accent', '99')};
  outline: 2px solid ${ca('accent', '7a')};
  outline-offset: 2px;
  filter: drop-shadow(0 0 6px ${ca('accent', '66')});
}
.play-again-btn:hover {
  background: var(--c-accent-hover);
  outline-color: ${ca('accent', 'b3')};
  filter: drop-shadow(0 0 9px ${ca('accent', '8c')});
}

/* ---- Locked screen ---- */
.locked-card {
  background: ${C.card};
  border: 1px solid ${C.border};
  border-radius: 18px;
  padding: 2rem 1.75rem;
  text-align: center;
  max-width: 420px;
  margin: 1rem auto 0;
  box-shadow: 0 12px 34px var(--c-shadow-md);
}
.locked-card .lock-icon { font-size: 2.6rem; }
.locked-card h2 { font-size: 1.4rem; font-weight: 700; margin: 0.5rem 0 0.25rem; }
.locked-card .sub { color: ${C.muted}; font-size: 0.9rem; margin-bottom: 1.25rem; }
.countdown-block {
  background: ${C.surface};
  border: 1px solid ${C.border};
  border-radius: 14px;
  padding: 1rem;
  margin-bottom: 1.25rem;
}
.countdown-block .clabel {
  font-size: 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: ${C.muted};
  margin-bottom: 0.35rem;
}
.countdown-block .ctime {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 600;
  font-size: 2rem;
  color: ${C.gold};
  letter-spacing: 0.04em;
}
.locked-result {
  text-align: left;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.85rem;
  border-top: 1px solid ${C.border};
  padding-top: 0.9rem;
  margin-bottom: 1.25rem;
}
.locked-result .score-row { display: flex; justify-content: space-between; padding: 0.18rem 0; }
.locked-result .k { color: ${C.muted}; }
.locked-result .v { color: ${C.gold}; }

/* ---- Pre-game screen (shell-owned chrome, phase 3) ---- */
.pregame-card {
  max-width: 440px; margin: 1.5rem auto; padding: 2rem 1.5rem;
  background: ${C.card}; border: 1px solid ${C.border}; border-radius: 18px;
  text-align: center;
}
.pregame-icon { font-size: 3rem; margin-bottom: 0.5rem; }
.pregame-card h2 { font-size: 1.4rem; font-weight: 700; margin-bottom: 0.3rem; }
.pregame-card .sub { color: ${C.muted}; font-size: 0.9rem; margin-bottom: 1rem; }
.pregame-chips {
  display: flex; gap: 0.4rem; justify-content: center; flex-wrap: wrap;
  margin-bottom: 1rem;
}
.pregame-chip {
  font-size: 0.72rem; padding: 0.25rem 0.6rem; border-radius: 999px;
  background: ${C.surface}; border: 1px solid ${C.border}; color: ${C.muted};
  white-space: nowrap;
}
.pregame-stats {
  display: flex; gap: 0.6rem; justify-content: center; margin-bottom: 1rem;
}
.pregame-stat {
  flex: 1; max-width: 130px; background: ${C.surface};
  border: 1px solid ${C.border}; border-radius: 12px; padding: 0.6rem 0.4rem;
}
.pregame-stat .l {
  font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em;
  color: ${C.muted}; margin-bottom: 0.2rem;
}
.pregame-stat .v { font-weight: 700; font-size: 1rem; }
/* This rule used to be missing its semicolon AND its closing brace, and the
   declarations that belong to it had been stranded ~70 lines further down
   behind a stray brace-semicolon. Everything in between — the whole band-picker family,
   the resume note, the Play button — was swallowed into one invalid rule and
   silently discarded by the CSS parser. Verified before fixing: NONE of
   .pregame-deal, .pregame-band, .pregame-band.on, .pregame-band-row,
   .pregame-bands-label, .pregame-band-note, .pregame-resume-note or
   .pregame-play appeared in document.styleSheets. */
.pregame-deal {
  font-size: 0.82rem; color: ${C.text};
  background: ${ca('accent', '14')};
  border: 1px solid ${ca('accent', '44')}; border-radius: 10px;
  padding: 0.6rem 0.8rem; margin-bottom: 1rem;
}

/* #176 — the band pickers. Story's is a numbered level list walked in order
   (cleared behind you, one open level ahead, the rest locked); arcade's is
   three wide buttons with no lock at all, because all three difficulties are
   open from the first run and the recommendation steers instead of gating. */
.pregame-bands { margin-top: 0.9rem; text-align: left; }
.pregame-bands-label {
  font-family: 'JetBrains Mono', monospace; font-size: 0.62rem;
  letter-spacing: 0.12em; text-transform: uppercase; color: ${C.muted};
  margin-bottom: 0.4rem;
}
/* #335 — the heading and its Copy link share one line. The button is the same
   small outlined control as an arcade run's Share, because it does the same
   thing: copy a link, then say so for a moment. */
.pregame-bands-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 0.5rem; margin-bottom: 0.4rem;
}
.pregame-bands-head .pregame-bands-label { margin-bottom: 0; }
.pregame-link-btn {
  flex: 0 0 auto; border: 1px solid ${C.border}; background: ${C.card};
  color: ${C.text}; border-radius: 8px; padding: 0.25rem 0.45rem;
  font: inherit; font-size: 0.72rem; cursor: pointer;
}
.pregame-link-btn[data-pressed] { background: var(--c-well-strong); }
.pregame-band-row { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.pregame-band-row.wide { display: grid; grid-template-columns: repeat(3, 1fr); }
.pregame-band {
  min-width: 44px; min-height: 44px; padding: 0.4rem 0.6rem;
  font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; font-weight: 600;
  color: ${C.text}; background: ${C.card};
  border: 1px solid ${C.border}; border-radius: 10px; cursor: pointer;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  -webkit-tap-highlight-color: transparent;
  transition: border-color 0.12s ease, background 0.12s ease, color 0.12s ease;
}
.pregame-band.wide { font-family: inherit; font-size: 0.8rem; }
.pregame-band.on {
  border-color: var(--accent, ${C.accent});
  background: ${ca('accent', '14')};
  color: var(--accent, ${C.accent});
}
.pregame-band.done { color: ${C.emerald}; border-color: ${ca('emerald', '55')}; }
.pregame-band.locked { opacity: 0.4; cursor: not-allowed; }
.pregame-band[data-pressed] { background: var(--c-well); }
.pregame-band .rec {
  display: block; font-family: 'JetBrains Mono', monospace;
  font-size: 0.5rem; letter-spacing: 0.06em; text-transform: uppercase;
  color: ${C.muted}; margin-top: 0.1rem;
}
/* #188 — the leaderboards panel. A centred sheet rather than a bottom sheet:
   it is a thing you read, not a menu you act from, and the tab row plus three
   or four rows of names sits badly hugging the bottom edge on a phone. */
.gb-sheet-backdrop {
  position: fixed; inset: 0; z-index: 70;
  background: var(--c-scrim);
  display: flex; align-items: center; justify-content: center;
  /* A centred panel: demote it into the safe frame, and cap it so it never
     runs under the notch or the home indicator. */
  padding: calc(1rem + var(--pc-safe-top)) calc(1rem + var(--pc-safe-right))
           calc(1rem + var(--pc-safe-bottom)) calc(1rem + var(--pc-safe-left));
}
.gb-sheet {
  width: 100%; max-width: 420px;
  max-height: calc(82dvh - var(--pc-safe-top) - var(--pc-safe-bottom));
  overflow-y: auto;
  background: ${C.surface}; border: 1px solid ${C.border};
  border-radius: 18px; padding: 0.9rem 1rem 1rem;
  box-shadow: 0 20px 50px var(--c-shadow-lg);
}
.gb-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 0.5rem; font-weight: 700; margin-bottom: 0.7rem;
}
.gb-close {
  min-width: 32px; min-height: 32px; flex: 0 0 auto;
  background: transparent; border: 1px solid ${C.border}; border-radius: 8px;
  color: ${C.muted}; font-family: inherit; cursor: pointer;
}
.gb-close:hover { color: ${C.text}; border-color: ${C.accent}; }
.gb-bands { margin-bottom: 0.6rem; }

.pregame-band-note {
  margin-top: 0.45rem; font-size: 0.72rem; line-height: 1.4; color: ${C.muted};
}
.pregame-resume-note {
  font-size: 0.82rem; color: ${C.gold}; margin-bottom: 0.8rem;
}
.pregame-play { width: 100%; }
.pregame-play:disabled { opacity: 0.5; cursor: default; }
/* #367 — the practice run sits directly under Play, wearing the result card's
   "this does not count" look (the .review-btn secondary). Its own rule only
   stops review-btn's bottom margin doubling up with .pregame-actions. */
.pregame-practice { margin-top: 0.6rem; margin-bottom: 0; }
.pregame-signedout { font-size: 0.78rem; color: ${C.muted}; margin-top: 0.6rem; }
/* #240 — "How to play" and the game's chat room were trailing text links
   under the Play button: no border, no background, 0.3rem of padding and a
   ~28px tap target, sitting in the position a page gives its footnotes. One of
   them is the game's instructions, which a first-time player needs BEFORE
   pressing Play, and the other is the only social surface a game has.
   They are a pair of real buttons on their own row now, each filling half the
   width with a 44px target — visible without competing with Play, which keeps
   the filled accent treatment to itself. */
.pregame-actions {
  display: flex; gap: 0.5rem; margin-top: 0.8rem;
}
.pregame-howto-btn {
  flex: 1 1 0; min-width: 0; min-height: 44px;
  display: flex; align-items: center; justify-content: center; gap: 0.35rem;
  background: ${C.surface}; border: 1px solid ${C.border}; border-radius: 12px;
  color: ${C.text}; font-family: inherit; font-size: 0.85rem; font-weight: 600;
  cursor: pointer; padding: 0.3rem 0.5rem;
  transition: border-color 0.12s, color 0.12s;
}
.pregame-howto-btn:hover { border-color: ${C.accent}; color: ${C.accent}; }
/* #239 — "one page wherever possible, and not require scrolling".
   The pre-game screen is the first thing a tap on a game card lands on, and
   at 390x667 (an iPhone SE / 8, and any phone in a shorter window) it stood
   716px tall: the Play button and the How-to-play / Game chat links sat below
   the fold, so the screen whose entire job is a Play button opened without one
   in sight. Nothing is removed or hidden — the card's own breathing room is
   spent instead, and only on viewports too short to afford it. Keyed on
   max-HEIGHT, so a roomy phone is untouched. */
@media (max-height: 730px) {
  .pregame-card { margin: 0.75rem auto; padding: 1.25rem 1.25rem; }
  .pregame-icon { font-size: 2.1rem; margin-bottom: 0.25rem; }
  .pregame-card .sub { margin-bottom: 0.7rem; }
  .pregame-chips { margin-bottom: 0.7rem; }
  .pregame-stats { margin-bottom: 0.7rem; }
  .pregame-actions { margin-top: 0.5rem; }
}

/* ---- How-to-Play modal (shell-owned chrome, phase 3) ---- */
.howto-overlay {
  position: fixed; inset: 0; background: var(--c-scrim); z-index: 220;
  display: flex; align-items: center; justify-content: center;
  padding: calc(1rem + var(--pc-safe-top)) calc(1rem + var(--pc-safe-right))
           calc(1rem + var(--pc-safe-bottom)) calc(1rem + var(--pc-safe-left));
}
.howto-card {
  background: ${C.card}; border: 1px solid ${C.border}; border-radius: 16px;
  padding: 1.4rem 1.3rem; width: min(95vw, 420px);
  max-height: calc(85dvh - var(--pc-safe-top) - var(--pc-safe-bottom));
  overflow-y: auto;
}
.howto-head {
  display: flex; align-items: center; gap: 0.6rem; margin-bottom: 1rem;
}
.howto-icon { font-size: 1.6rem; }
.howto-head h3 { font-size: 1.05rem; font-weight: 700; }
.howto-list { display: flex; flex-direction: column; gap: 0.8rem; margin-bottom: 1.2rem; }
.howto-step { display: flex; gap: 0.7rem; align-items: flex-start; }
.howto-step-num {
  flex: none; width: 1.6rem; height: 1.6rem; border-radius: 50%;
  background: ${ca('accent','22')}; color: ${C.accent}; font-weight: 700;
  display: flex; align-items: center; justify-content: center; font-size: 0.8rem;
}
.howto-step-title { font-weight: 600; font-size: 0.9rem; margin-bottom: 0.15rem; }
.howto-step-body { font-size: 0.82rem; color: ${C.muted}; line-height: 1.45; }

/* "?" help button in the in-game headers */
/* #240 — the daily header's "?" and chat buttons were 1.9rem muted circles,
   while the SAME two controls in the classic shell's topbar are 2.4rem and
   full-contrast (.cg-btn). Two shells disagreeing about how important the
   instructions are is not a design decision, and the daily side lost: at
   30px these sat under the 44px tap target the rest of the app aims for and
   read as disabled. Sized and coloured to match .cg-btn. */
.help-btn {
  margin-left: auto; background: ${C.surface}; border: 1px solid ${C.border};
  border-radius: 50%; width: 2.4rem; height: 2.4rem; color: ${C.text};
  font-family: inherit; font-size: 1.05rem; font-weight: 700; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: border-color 0.12s, color 0.12s;
}
.help-btn:hover { border-color: ${C.accent}; color: ${C.accent}; }
/* Only the first of the pair pushes off the title; the second sits beside it
   rather than opening a second gap. */
.help-btn + .help-btn { margin-left: 0; }

/* ---- Locked lobby card ---- */

/* ---- Dual-mode (paired) lobby card (#146) ----
   A game that exists in BOTH an endless free-play form and a once-a-day form
   gets ONE card with two buttons instead of two near-duplicate cards. The card
   itself is never dimmed/locked — only the daily button changes state, so
   finishing today's daily can't make the free-play half look unavailable. */
/* #167 — the two mode buttons sit SIDE BY SIDE, not stacked. Stacked, they made
   a paired card tower over a single-mode card, which is the whole reason the
   grid used to let cards hug their content (see .grid). Two equal columns with
   a clamped label/caption bring the paired card within a tile's padding of a
   single one, so one uniform height suits both. */
/* #176 — a card can now carry one, two or THREE mode buttons. Three across a
   200px column would leave ~50px of text each, which ellipsises to nothing, so
   the three-up case drops to a 2+1 grid: the two most-used modes share the top
   row and the third spans beneath. Column count is explicit per arity rather
   than auto-fit, because auto-fit would silently reflow to 1-up at the narrow
   end and tower the card again (the exact regression #167 fixed). */
/* The state line replaces per-button chatter: the card says where you stand,
   and the buttons say where you can go. Tabular figures so "Story 4/8" does not
   jitter as the numerator grows. */
/* One line each, ellipsised. At the grid's narrowest column (200px) the two
   buttons share ~166px, i.e. ~74px of text each, so anything that wraps costs
   every OTHER tile in the grid the same height (see .grid). The ellipsis is the
   safety net, not the plan — keep the caption copy in GAME_CARDS, and the
   dynamic strings in GameCard, inside that budget. The full captions live
   on the pre-game screen. */
/* An unplayed daily is marked by its BORDER and its label, not by a filled
   accent panel. Every card carried one, so the grid read as a wall of colour
   competing with the game art, and the daily looked like the only real button
   on a card that has three. The NEW TODAY badge above it already says the
   same thing. */

/* ---- Leaderboard scope tabs + rating ladder (phase 4) ---- */
.lb-scope-tabs { display: flex; gap: 0.35rem; margin: 0.5rem 0 0.6rem; flex-wrap: wrap; }
.lb-scope-tab {
  padding: 0.25rem 0.7rem; border-radius: 999px; font-size: 0.75rem;
  font-family: inherit; cursor: pointer; white-space: nowrap;
  background: ${C.card}; border: 1px solid ${C.border}; color: ${C.muted};
  transition: border-color 0.12s, color 0.12s;
}
.lb-scope-tab:not(.active):hover { border-color: ${C.accent}; color: ${C.text}; }
.lb-scope-tab.active { background: ${C.accent}; border-color: ${C.accent}; color: #fff; }
.lboard.ladder { max-width: 640px; margin: 0.5rem auto; }
/* Ladder rows carry five cells (rank, name, streak, elo, delta) — the base
   .lrow grid is four columns, so widen it here. */
.lboard.ladder .lrow { grid-template-columns: 2.4rem 1fr auto auto auto; }
.ladder-games { display: flex; gap: 0.35rem; flex-wrap: wrap; margin-bottom: 0.6rem; }
.ladder-note { font-size: 0.78rem; color: ${C.muted}; margin-bottom: 0.8rem; line-height: 1.45; }
.ladder-movers {
  font-size: 0.8rem; color: ${C.text}; background: ${ca('emerald','14')};
  border: 1px solid ${ca('emerald','44')}; border-radius: 8px;
  padding: 0.45rem 0.7rem; margin-bottom: 0.7rem;
}
.ladder-streak { min-width: 2.6rem; text-align: right; color: ${C.gold}; font-size: 0.8rem; }
.ladder-delta { min-width: 2.8rem; text-align: right; font-size: 0.8rem; }
.ladder-delta.up { color: ${C.emerald}; }
.ladder-delta.down { color: ${C.rose}; }
.ladder-delta.flat { color: ${C.muted}; }

/* ---- Daily leaderboard ---- */
.lboard {
  margin: 1rem 0 0.25rem;
  text-align: left;
  background: ${C.surface};
  border: 1px solid ${C.border};
  border-radius: 12px;
  padding: 0.75rem 0.85rem;
}
.lboard-title {
  font-weight: 600;
  font-size: 0.85rem;
  margin-bottom: 0.6rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.lboard-count {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
  color: ${C.muted};
  font-weight: 400;
}
.lboard-empty { color: ${C.muted}; font-size: 0.82rem; padding: 0.4rem 0; }
.lboard-note {
  margin-top: 0.55rem;
  font-size: 0.76rem;
  color: ${C.muted};
  border-top: 1px dashed ${C.border};
  padding-top: 0.5rem;
}
.lboard-rows { display: flex; flex-direction: column; gap: 0.15rem; max-height: 280px; overflow-y: auto; }
.lrow {
  display: grid;
  grid-template-columns: 2.4rem 1fr auto auto;
  gap: 0.5rem;
  align-items: center;
  padding: 0.32rem 0.45rem;
  border-radius: 8px;
  font-size: 0.82rem;
}
.lrow .lrank { color: ${C.muted}; font-size: 0.76rem; }
.lrow .lname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lrow .ltime { color: ${C.text}; font-size: 0.78rem; }
.lrow .lsteps { color: ${C.muted}; font-size: 0.74rem; }
.lrow.me { background: ${ca('accent','22')}; }
.lrow.me .lrank, .lrow.me .lname { color: ${C.accent}; font-weight: 600; }
.lrow.pinned { margin-top: 0.3rem; border-top: 1px dashed ${C.border}; padding-top: 0.5rem; }

/* ---- Word Hunt ---- */
/* The box hosts the letter canvas; its sizing is what the fit-col rules and
   self-tests measure, unchanged. Gridlines are drawn inside the canvas. */
.wordsearch {
  display: flex; align-items: center; justify-content: center;
  border: 2px solid ${C.border};
  border-radius: 10px;
  overflow: hidden;
  max-width: 420px;
  margin: 0 auto;
  aspect-ratio: 1;
  touch-action: none;
}

.word-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  justify-content: center;
  max-width: 420px;
  margin: 1.1rem auto 0;
}
.word-chip {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.78rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.3rem 0.6rem;
  border-radius: 999px;
  background: ${C.card};
  border: 1px solid ${C.border};
  color: ${C.muted};
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}
.word-chip.found {
  background: ${ca('emerald','1a')};
  border-color: ${C.emerald};
  color: ${C.emerald};
  text-decoration: line-through;
}

/* ---- Crypto Wordle ---- */

}
/* The guess grid is a canvas; the box stays the ONE flexible child inside the
   fit column (PHASE 3's rule) so the keyboard, clue and tracker keep their
   place, and the canvas sizes its tiles from whatever the box measures. The
   invalid-guess shake is drawn (a brief rAF wiggle of the current row). */
.cw-board {
  display: flex; align-items: center; justify-content: center;
  /* The box hosts the whole FRAME now (pills + clue + grid + keyboard), so
     the old 330px board cap would squeeze the keyboard; the guess grid caps
     itself via boardWidth inside the canvas. */
  max-width: 480px;
  margin: 0 auto;
  width: 100%;
}
.fit-col .cw-board {
  flex: 1 1 auto; min-height: 0; overflow: hidden;
}

     color: ${C.muted}; }

/* ---- Lobby tab switcher ---- */
.lobby-tabs { display: flex; gap: 0.35rem; margin-bottom: 1.1rem; flex-wrap: wrap; }
.lobby-tab {
  padding: 0.45rem 1.1rem;
  background: ${C.card};
  border: 1px solid ${C.border};
  border-radius: 999px;
  font-size: 0.87rem;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  color: ${C.text};
  transition: border-color 0.12s, background 0.12s;
}
.lobby-tab.active { background: ${C.accent}; border-color: ${C.accent}; color: #fff; }
.lobby-tab:not(.active):hover { border-color: ${C.accent}; }

@media (max-width: 480px) {
  .lobby-tab { padding: 0.35rem 0.8rem; font-size: 0.8rem; }

  /* #182 — compact card metrics for the two-up phone grid. At 390px each
     track is ~178px, so the card's desktop padding/type scale eats most of
     the tile. Everything the card shows is KEPT and scaled down: two of the
     merged cards name their variants only in .card-desc (and dapp.json
     asserts those strings), so hiding it would remove real content, not just
     decoration. .card-mode-btn's min-height stays 44px — only its horizontal
     padding gives way. */
}

/* ---- Minesweeper ---- */
/* The board is a canvas (Mine Finder's exact pattern); the box keeps the old
   .ms-grid footprint. Its light/dark look still keys off the RESOLVED theme
   (the old data-ms-theme override pair) rather than raw PAL tokens. */
.ms-boardbox {
  width: min(92vw, 360px, var(--cg-board, 360px));
  max-width: 100%;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1; /* real height for useFitBox — see .kt-boardbox */
  flex: 0 0 auto;
  touch-action: none;
}
@keyframes ms-pulse {
  0%, 100% { box-shadow: 0 0 0 0 ${ca('emerald','40')}; }
  50% { box-shadow: 0 0 0 6px ${ca('emerald','00')}; }
}
.ms-cashout-btn {
  width: 100%;
  background: ${C.emerald};
  color: white;
  border: none;
  border-radius: 12px;
  padding: 0.8rem;
  font-family: inherit;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s ease;
  animation: ms-pulse 1.8s ease infinite;
}
.ms-cashout-btn:hover { background: var(--c-emerald-hover); }
.ms-cashout-btn.disabled {
  opacity: 0.4;
  cursor: not-allowed;
  animation: none;
  background: ${C.dim};
}
.ms-settings-section { margin-bottom: 1.25rem; }
.ms-settings-section h4 {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: ${C.muted};
  margin-bottom: 0.6rem;
}
.ms-settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 0.75rem;
  background: ${C.card};
  border: 1px solid ${C.border};
  border-radius: 10px;
  margin-bottom: 0.4rem;
}
.ms-settings-row .ms-settings-label {
  font-size: 0.88rem;
  font-weight: 500;
}
.ms-theme-toggle {
  background: ${C.surface};
  border: 1px solid ${C.border};
  color: ${C.text};
  border-radius: 8px;
  padding: 0.25rem 0.75rem;
  cursor: pointer;
  font-size: 0.82rem;
  font-family: inherit;
  font-weight: 600;
  transition: border-color 0.12s;
}
.ms-theme-toggle:hover { border-color: ${C.accent}; }
.ms-action-row {
  display: flex;
  gap: 0.6rem;
  max-width: 360px;
  margin: 0.9rem auto 0;
}
.ms-action-row .ms-cashout-wrap { flex: 2; }
.ms-action-row .ms-newgame-btn {
  flex: 1;
  background: ${C.card};
  border: 1px solid ${C.border};
  color: ${C.text};
  border-radius: 12px;
  padding: 0.8rem 0.5rem;
  font-family: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.12s;
}
.ms-action-row .ms-newgame-btn:hover { border-color: ${C.accent}; }
.ms-action-row .ms-music-btn {
  flex: 0 0 auto;
  width: 3rem;
  background: ${C.card};
  border: 1px solid ${C.border};
  color: ${C.text};
  border-radius: 12px;
  padding: 0.8rem 0.5rem;
  font-family: inherit;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.12s, color 0.12s, opacity 0.12s;
}
.ms-action-row .ms-music-btn:hover:not(:disabled) { border-color: ${C.accent}; }
.ms-action-row .ms-music-btn.paused { color: ${C.gold}; border-color: ${ca('gold','66')}; }
.ms-action-row .ms-music-btn.off { opacity: 0.5; cursor: default; }
.ms-action-row .ms-music-btn:disabled { cursor: default; }
.ms-bottom-nav {
  display: flex;
  border-top: 1px solid ${C.border};
  background: ${C.surface};
  position: sticky;
  bottom: 0;
  margin: 1rem -1.25rem -1.5rem;
}
.ms-tab {
  flex: 1;
  padding: 0.7rem;
  font-size: 0.82rem;
  border: none;
  background: transparent;
  color: ${C.muted};
  cursor: pointer;
  font-family: inherit;
  font-weight: 500;
  border-top: 2px solid transparent;
  transition: color 0.12s, border-color 0.12s;
}
.ms-tab.active { color: ${C.accent}; border-top-color: ${C.accent}; }
.ms-history-list { overflow-y: auto; max-height: 60vh; padding: 0.5rem 0; }
.ms-history-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid ${C.border};
  padding: 0.55rem 0;
  font-size: 0.82rem;
}
.ms-outcome-chip {
  display: inline-block;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.62rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.15rem 0.45rem;
  border-radius: 999px;
}
.ms-outcome-chip.win { background: ${ca('emerald','22')}; color: ${C.emerald}; border: 1px solid ${ca('emerald','44')}; }
.ms-outcome-chip.loss { background: ${ca('rose','22')}; color: ${C.rose}; border: 1px solid ${ca('rose','44')}; }
.ms-leaderboard-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  border-bottom: 1px solid ${C.border};
  padding: 0.55rem 0;
  font-size: 0.82rem;
}
.ms-leaderboard-row .ms-rank {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  color: ${C.muted};
  width: 1.5rem;
  text-align: center;
}
.ms-empty-state {
  color: ${C.muted};
  text-align: center;
  padding: 2rem 0;
  font-size: 0.9rem;
}
/* Light theme overrides for minesweeper board only */

/* ---- Mancala ---- */
/* The board (stores, pits, stones) is one canvas — see MncBoardCanvas. */
.mnc-board {
  max-width: 480px;
  margin: 0 auto;
  display: flex; justify-content: center;
  touch-action: none;
}
.mnc-canvas { border-radius: 16px; }

.mnc-banner {
  text-align: center;
  font-size: 0.92rem;
  font-weight: 600;
  color: ${C.gold};
  padding: 0.4rem 0.6rem;
  background: ${ca('gold','1a')};
  border: 1px solid ${ca('gold','33')};
  border-radius: 8px;
  margin: 0.6rem 0 0;
  min-height: 2.1rem;
  display: flex;
  align-items: center;
  justify-content: center;
}
.mnc-controls {
  display: flex;
  gap: 0.5rem;
  max-width: 480px;
  margin: 0.8rem auto 0;
}
.mnc-controls button {
  flex: 1;
  min-width: 0;
  background: ${C.card};
  border: 1px solid ${C.border};
  color: ${C.text};
  border-radius: 10px;
  padding: 0.5rem 0.3rem;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.82rem;
  font-weight: 500;
  transition: border-color 0.12s;
  white-space: nowrap;
}
.mnc-controls button:hover { border-color: ${C.accent}; }
.mnc-controls button:disabled { opacity: 0.38; cursor: not-allowed; }
.mnc-controls button:disabled:hover { border-color: ${C.border}; }
.mnc-bottom-nav {
  display: flex;
  border-top: 1px solid ${C.border};
  background: ${C.surface};
  position: sticky;
  bottom: 0;
  margin: 1rem -1.25rem -1.5rem;
}
.mnc-tab {
  flex: 1;
  padding: 0.7rem;
  font-size: 0.82rem;
  border: none;
  background: transparent;
  color: ${C.muted};
  cursor: pointer;
  font-family: inherit;
  font-weight: 500;
  border-top: 2px solid transparent;
  transition: color 0.12s, border-color 0.12s;
}
.mnc-tab.active { color: ${C.accent}; border-top-color: ${C.accent}; }
.mnc-history-list { overflow-y: auto; max-height: 55vh; padding: 0.5rem 0; }
.mnc-history-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid ${C.border};
  padding: 0.55rem 0;
  font-size: 0.82rem;
  gap: 0.5rem;
}
.mnc-outcome-chip {
  display: inline-block;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.62rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.15rem 0.45rem;
  border-radius: 999px;
  flex-shrink: 0;
}
.mnc-outcome-chip.p1win { background: ${ca('accent','22')}; color: ${C.accent}; border: 1px solid ${ca('accent','44')}; }
.mnc-outcome-chip.p2win { background: ${ca('rose','22')}; color: ${C.rose}; border: 1px solid ${ca('rose','44')}; }
.mnc-outcome-chip.draw { background: ${ca('muted','22')}; color: ${C.muted}; border: 1px solid ${ca('muted','44')}; }
.mnc-stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
  padding: 0.5rem 0;
}
.mnc-stat-card {
  background: ${C.card};
  border: 1px solid ${C.border};
  border-radius: 10px;
  padding: 0.75rem;
  text-align: center;
}
.mnc-stat-card .mnc-stat-val {
  font-family: 'JetBrains Mono', monospace;
  font-size: 1.3rem;
  font-weight: 700;
  color: ${C.gold};
}
.mnc-stat-card .mnc-stat-lbl {
  font-size: 0.62rem;
  color: ${C.muted};
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-top: 0.15rem;
}
.mnc-empty-state {
  color: ${C.muted};
  text-align: center;
  padding: 2rem 0;
  font-size: 0.9rem;
}

/* ---- Mancala mode selection ---- */
.mnc-mode-select {
  max-width: 480px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.mnc-mode-btn {
  background: ${C.card};
  border: 2px solid ${C.border};
  border-radius: 14px;
  padding: 1rem 1.1rem;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  color: ${C.text};
  transition: border-color 0.15s, background 0.15s;
  display: flex;
  align-items: center;
  gap: 0.9rem;
  width: 100%;
}
.mnc-mode-btn:hover { border-color: ${C.gold}; background: ${ca('gold','08')}; }
.mnc-mode-btn.active { border-color: ${C.gold}; background: ${ca('gold','14')}; }
.mnc-mode-icon { font-size: 1.7rem; flex-shrink: 0; }
.mnc-mode-text { display: flex; flex-direction: column; gap: 0.1rem; }
.mnc-mode-name { font-weight: 600; font-size: 1rem; }
.mnc-mode-desc { font-size: 0.78rem; color: ${C.muted}; }
.mnc-mode-sub {
  background: ${C.surface};
  border: 1px solid ${C.border};
  border-radius: 10px;
  padding: 0.85rem 1rem;
}
.mnc-difficulty-row {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
.mnc-difficulty-pill {
  flex: 1;
  padding: 0.45rem 0.4rem;
  background: ${C.card};
  border: 1.5px solid ${C.border};
  border-radius: 8px;
  font-family: inherit;
  font-size: 0.82rem;
  font-weight: 500;
  color: ${C.muted};
  cursor: pointer;
  transition: border-color 0.12s, color 0.12s, background 0.12s;
  text-align: center;
}
.mnc-difficulty-pill:hover { border-color: ${C.gold}; color: ${C.text}; }
.mnc-difficulty-pill.active { border-color: ${C.gold}; color: ${C.gold}; background: ${ca('gold','14')}; font-weight: 600; }
.mnc-daily-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 0.5rem; flex-wrap: wrap;
  max-width: 480px; margin: 0 auto 0.6rem;
}
.mnc-daily-title { font-weight: 700; font-size: 0.95rem; color: ${C.text}; }
.mnc-daily-pills { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; }
.mnc-record-pill {
  font-size: 0.74rem; font-weight: 700;
  background: ${ca('gold','14')}; color: ${C.gold};
  border: 1px solid ${ca('gold','55')};
  border-radius: 999px; padding: 0.18rem 0.55rem;
  white-space: nowrap;
}
.mnc-streak-chip {
  font-size: 0.74rem; font-weight: 700;
  background: ${ca('rose','1f')}; color: ${C.rose};
  border: 1px solid ${ca('rose','55')};
  border-radius: 999px; padding: 0.18rem 0.55rem;
  white-space: nowrap;
}
.mnc-mode-start-btn {
  width: 100%;
  padding: 0.65rem;
  background: ${C.gold};
  color: #000;
  border: none;
  border-radius: 10px;
  font-family: inherit;
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.12s;
}
.mnc-mode-start-btn:hover { background: var(--c-gold-hover); }
.mnc-online-actions { display: flex; gap: 0.5rem; }
.mnc-online-actions button {
  flex: 1;
  padding: 0.6rem 0.5rem;
  background: ${C.card};
  border: 1.5px solid ${C.border};
  border-radius: 10px;
  font-family: inherit;
  font-size: 0.87rem;
  font-weight: 600;
  color: ${C.text};
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s;
}
.mnc-online-actions button:hover { border-color: ${C.gold}; background: ${ca('gold','0d')}; }

/* ---- Mancala online waiting / join screen ---- */
.mnc-room-waiting { max-width: 480px; margin: 0 auto; text-align: center; }
.mnc-room-code {
  font-family: 'JetBrains Mono', monospace;
  font-size: 2.4rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: ${C.gold};
  background: ${ca('gold','14')};
  border: 2px solid ${ca('gold','44')};
  border-radius: 14px;
  padding: 0.75rem 1.25rem;
  margin: 0.85rem 0;
  display: inline-block;
}
.mnc-spinner {
  display: inline-block;
  width: 1.4rem;
  height: 1.4rem;
  border: 2.5px solid ${C.border};
  border-top-color: ${C.gold};
  border-radius: 50%;
  animation: mnc-spin 0.8s linear infinite;
  vertical-align: middle;
  margin-right: 0.5rem;
}
@keyframes mnc-spin { to { transform: rotate(360deg); } }
.mnc-join-form { max-width: 480px; margin: 0 auto; }
.mnc-join-input {
  width: 100%;
  padding: 0.7rem 0.9rem;
  background: ${C.card};
  border: 1.5px solid ${C.border};
  border-radius: 10px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 1.3rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  color: ${C.text};
  text-transform: uppercase;
  outline: none;
  transition: border-color 0.12s;
  margin-bottom: 0.6rem;
  box-sizing: border-box;
  text-align: center;
}
.mnc-join-input:focus { border-color: ${C.gold}; }
.mnc-join-error { color: ${C.rose}; font-size: 0.82rem; margin-bottom: 0.6rem; text-align: center; }

/* ---- Mancala online in-game UI ---- */
.mnc-connection-status {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.75rem;
  color: ${C.muted};
  margin-bottom: 0.45rem;
  max-width: 480px;
  margin-left: auto;
  margin-right: auto;
}

/* ---- Mancala AI thinking banner ---- */
.mnc-ai-thinking {
  text-align: center;
  font-size: 0.82rem;
  font-weight: 500;
  color: ${C.muted};
  padding: 0.35rem 0.6rem;
  background: ${C.card};
  border: 1px solid ${C.border};
  border-radius: 8px;
  margin: 0.5rem 0 0;
  max-width: 480px;
  margin-left: auto;
  margin-right: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
}

/* ---- 2048 ---- */
.t2048-board-wrap {
  position: relative;
  max-width: 360px;
  margin: 0 auto;
}
/* The board is a canvas (#142's slide/pop animation is drawn — see
   T2048BoardCanvas); the grid box keeps the panel look and the frozen-board
   selector the end-of-run tests assert on. */
.t2048-grid {
  position: relative;
  display: flex; align-items: center; justify-content: center;
  aspect-ratio: 1;
  background: ${C.card};
  border: 2px solid ${C.border};
  border-radius: 12px;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
.t2048-canvas-fill {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
}
@keyframes t2048-float-up {
  from { opacity: 1; transform: translateY(0); }
  to   { opacity: 0; transform: translateY(-22px); }
}
.t2048-banner {
  font-size: 0.72rem;
  color: ${C.muted};
  margin-bottom: 0.75rem;
  padding: 0.3rem 0.6rem;
  background: ${C.card};
  border-radius: 8px;
  display: inline-block;
  border: 1px solid ${C.border};
}
.t2048-bottom-nav {
  display: flex;
  border-top: 1px solid ${C.border};
  background: ${C.surface};
  position: sticky;
  bottom: 0;
  margin: 1rem -1.25rem -1.5rem;
}
.t2048-tab {
  flex: 1;
  padding: 0.7rem;
  font-size: 0.82rem;
  border: none;
  background: transparent;
  color: ${C.muted};
  cursor: pointer;
  font-family: inherit;
  font-weight: 500;
  border-top: 2px solid transparent;
  transition: color 0.12s, border-color 0.12s;
}
.t2048-tab.active { color: ${C.accent}; border-top-color: ${C.accent}; }
.t2048-history-list { overflow-y: auto; max-height: 60vh; padding: 0.5rem 0; }
.t2048-history-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid ${C.border};
  padding: 0.55rem 0;
  font-size: 0.82rem;
  gap: 0.4rem;
  flex-wrap: wrap;
}
.t2048-outcome-chip {
  display: inline-block;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.62rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.15rem 0.45rem;
  border-radius: 999px;
  flex-shrink: 0;
}
.t2048-outcome-chip.win  { background: ${ca('emerald','22')}; color: ${C.emerald}; border: 1px solid ${ca('emerald','44')}; }
.t2048-outcome-chip.loss { background: ${ca('rose','22')};    color: ${C.rose};    border: 1px solid ${ca('rose','44')}; }
.t2048-stats-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
  padding: 0.5rem 0;
}
.t2048-stat-card {
  background: ${C.card};
  border: 1px solid ${C.border};
  border-radius: 10px;
  padding: 0.75rem;
  text-align: center;
}
.t2048-stat-card .t2048-stat-val {
  font-family: 'JetBrains Mono', monospace;
  font-size: 1.3rem;
  font-weight: 700;
  color: ${C.gold};
}
.t2048-stat-card .t2048-stat-lbl {
  font-size: 0.62rem;
  color: ${C.muted};
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-top: 0.15rem;
}
.t2048-empty-state {
  color: ${C.muted};
  text-align: center;
  padding: 2rem 0;
  font-size: 0.9rem;
}
.t2048-overlay {
  position: absolute;
  inset: 0;
  background: ${ca('bg','ee')};
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  z-index: 5;
  padding: 1rem;
}
.t2048-overlay h3 { font-size: 1.35rem; font-weight: 700; }
.t2048-overlay-score {
  font-family: 'JetBrains Mono', monospace;
  font-size: 1.6rem;
  font-weight: 700;
  color: ${C.gold};
}
.t2048-overlay-btns {
  display: flex;
  gap: 0.6rem;
  width: 100%;
  max-width: 280px;
  margin-top: 0.3rem;
}
.t2048-overlay-btns button {
  flex: 1;
  border-radius: 10px;
  padding: 0.65rem 0.4rem;
  font-family: inherit;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.12s;
}
.t2048-keep-btn   { background: ${C.accent}; color: #fff; border: none; }
.t2048-keep-btn:hover   { opacity: 0.88; }
.t2048-finish-btn { background: ${C.card}; color: ${C.text}; border: 1px solid ${C.border}; }
.t2048-finish-btn:hover { border-color: ${C.accent}; }

/* ---- Snake ---- */
.snake-board-wrap {
  position: relative;
  display: inline-block;
  margin: 0 auto;
  width: 100%;
}
.snake-dpad {
  display: grid;
  grid-template-columns: repeat(3, 56px);
  grid-template-rows: repeat(2, 56px);
  gap: 0.4rem;
  justify-content: center;
  margin: 0.9rem auto 0;
}
.snake-dpad button {
  background: ${C.card};
  border: 1px solid ${C.border};
  color: ${C.text};
  border-radius: 10px;
  font-size: 1.2rem;
  cursor: pointer;
  font-family: inherit;
  transition: border-color 0.12s, background 0.12s;
}
.snake-dpad button:active { background: ${C.accent}; border-color: ${C.accent}; }
.snake-dpad .snake-dpad-up    { grid-column: 2; grid-row: 1; }
.snake-dpad .snake-dpad-left  { grid-column: 1; grid-row: 2; }
.snake-dpad .snake-dpad-down  { grid-column: 2; grid-row: 2; }
.snake-dpad .snake-dpad-right { grid-column: 3; grid-row: 2; }
.snake-start-overlay {
  position: absolute;
  inset: 0;
  background: ${ca('bg','cc')};
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  z-index: 5;
  cursor: pointer;
  color: ${C.text};
  font-size: 0.9rem;
  text-align: center;
  padding: 1rem;
}
.snake-lb-list { overflow-y: auto; max-height: 60vh; padding: 0.5rem 0; }
.snake-lb-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  border-bottom: 1px solid ${C.border};
  padding: 0.55rem 0.3rem;
  font-size: 0.85rem;
}
.snake-lb-row.snake-lb-me { background: ${ca('accent','1a')}; border-radius: 8px; }
.snake-lb-row .snake-lb-rank {
  font-family: 'JetBrains Mono', monospace;
  color: ${C.muted};
  width: 2.2rem;
  flex-shrink: 0;
  text-align: right;
}
.snake-lb-row .snake-lb-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.snake-lb-row .snake-lb-score { font-family: 'JetBrains Mono', monospace; color: ${C.gold}; font-weight: 600; }
.snake-lb-divider { text-align: center; color: ${C.muted}; padding: 0.4rem 0; font-size: 0.8rem; letter-spacing: 0.2em; }
.snake-lb-empty { color: ${C.muted}; text-align: center; padding: 2rem 0; font-size: 0.9rem; }
.snake-pause-overlay {
  position: absolute;
  inset: 0;
  background: ${ca('bg','cc')};
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 4;
}
.snake-pause-text {
  font-size: 2rem;
  font-weight: 700;
  color: ${C.gold};
  letter-spacing: 0.1em;
}

/* ---- Bounce (Breakout) ---- */
.bounce-board-wrap {
  position: relative;
  max-width: 360px;
  margin: 0 auto;
  aspect-ratio: 3 / 4;
}
.bounce-canvas {
  width: 100%;
  height: 100%;
  display: block;
  background: ${C.bg};
  border: 2px solid ${C.border};
  border-radius: 12px;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  cursor: pointer;
}
.bounce-start-overlay {
  position: absolute;
  inset: 0;
  background: ${ca('bg','cc')};
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  z-index: 5;
  /* #211 — the backdrop is INERT so a finger reaches the canvas underneath,
     which is what aims the paddle and launches. Only the button takes input. */
  pointer-events: none;
  color: ${C.text};
  font-size: 0.9rem;
  text-align: center;
  padding: 1rem;
}

/* ---- Zuma ---- */
.zuma-wrap {
  position: relative;
  max-width: 300px;
  margin: 0 auto;
  aspect-ratio: 3 / 4;
}
.zuma-canvas {
  width: 100%;
  height: 100%;
  display: block;
  background: ${C.bg};
  border: 2px solid ${C.border};
  border-radius: 12px;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  cursor: crosshair;
}

/* ---- Block Blast ---- */
.bb-board-wrap {
  position: relative;
  max-width: 360px;
  margin: 0 auto;
}
.bb-score-delta {
  position: absolute;
  top: -1.4rem;
  right: 0.1rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.8rem;
  font-weight: 700;
  color: ${C.emerald};
  pointer-events: none;
  animation: bb-float-up 700ms ease-out forwards;
  white-space: nowrap;
}
@keyframes bb-float-up {
  from { opacity: 1; transform: translateY(0); }
  to   { opacity: 0; transform: translateY(-28px); }
}
.bb-tray {
  display: flex;
  justify-content: center;
  gap: 0.75rem;
  max-width: 360px;
  margin: 0.9rem auto 0;
  flex-wrap: wrap;
}
.bb-piece-btn {
  cursor: pointer;
  padding: 0.5rem;
  border: 2px solid ${C.border};
  border-radius: 10px;
  background: ${C.card};
  transition: border-color 0.12s, opacity 0.12s;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 56px;
  min-height: 56px;
}
.bb-piece-btn:hover { border-color: ${C.accent}; }
.bb-piece-btn.selected { border-color: ${C.accent}; background: ${ca('accent','1a')}; }
.bb-piece-btn.used { opacity: 0.2; pointer-events: none; }
.bb-piece-grid {
  display: grid;
  gap: 2px;
}
.bb-piece-cell {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: var(--bb-color);
}
.bb-bottom-nav {
  display: flex;
  border-top: 1px solid ${C.border};
  background: ${C.surface};
  position: sticky;
  bottom: 0;
  margin: 1rem -1.25rem -1.5rem;
}
.bb-tab {
  flex: 1;
  padding: 0.7rem;
  font-size: 0.82rem;
  border: none;
  background: transparent;
  color: ${C.muted};
  cursor: pointer;
  font-family: inherit;
  font-weight: 500;
  border-top: 2px solid transparent;
  transition: color 0.12s, border-color 0.12s;
}
.bb-tab.active { color: ${C.accent}; border-top-color: ${C.accent}; }
.bb-history-list { overflow-y: auto; max-height: 60vh; padding: 0.5rem 0; }
.bb-history-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid ${C.border};
  padding: 0.55rem 0;
  font-size: 0.82rem;
  gap: 0.4rem;
  flex-wrap: wrap;
}
.bb-best-row { color: ${C.gold}; font-weight: 600; }
.bb-empty-state {
  color: ${C.muted};
  text-align: center;
  padding: 2rem 0;
  font-size: 0.9rem;
}
/* ---- Tile Match ---- */
/* width:100% is load-bearing, not decorative (#210, same class of bug as
   #149): .cg-stage is align-items:center, so with only an auto margin this
   wrap took its FIT-CONTENT width, which is the canvas's own CSS width, which
   useCanvasBoard writes back from the measured box. That loop settles at the
   UA's default 300px canvas on every device, which is what made the free-play
   tile holder hang off the frame. A definite width breaks the loop. */
.tm-wrap { width: 100%; max-width: 400px; margin: 0 auto; }
.tm-wrap.fit-col { max-width: 520px; }
/* The canvas board box (both variants): the daily's carries tm-board-fit so
   it is the fit column's flexible region; classic takes natural height and
   the shell scrolls, as it always did. */
.tm-board-box {
  position: relative; width: 100%;
  display: flex; align-items: center; justify-content: center;
}
.tm-board-fit { flex: 1 1 auto; min-height: 0; overscroll-behavior: contain; }
.tm-canvas { border-radius: 8px; }
/* Today's layout + difficulty band (slice 8), so the shape and the weekly
   curve are legible before the first tap. */

}
.tm-level-select { max-width: 400px; margin: 0 auto; }
.tm-level-select h2 { font-size: 1.1rem; font-weight: 600; margin-bottom: 0.2rem; }
.tm-level-select p { font-size: 0.85rem; color: ${C.muted}; margin-bottom: 1rem; }
.tm-tier-label {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: ${C.muted};
  margin: 0.75rem 0 0.35rem;
  font-weight: 600;
}
.tm-level-grid {
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  gap: 0.35rem;
  margin-bottom: 0.25rem;
}
.tm-level-btn {
  aspect-ratio: 1;
  border-radius: 8px;
  background: ${C.card};
  border: 1px solid ${C.border};
  color: ${C.muted};
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s, color 0.12s;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  padding: 0;
}
.tm-level-btn:hover { border-color: ${C.accent}; color: ${C.text}; }
.tm-level-btn.selected { border-color: ${C.accent}; background: ${ca('accent','22')}; color: ${C.accent}; }
.tm-level-btn.done { border-color: ${ca('emerald','44')}; color: ${C.emerald}; }
.tm-level-btn.done.selected { border-color: ${C.emerald}; background: ${ca('emerald','22')}; }
.tm-level-btn .tm-check {
  position: absolute;
  top: 1px; right: 2px;
  font-size: 0.45rem;
  color: ${C.emerald};
}
.tm-play-btn {
  width: 100%;
  margin-top: 1rem;
  background: ${C.accent};
  color: #fff;
  border: none;
  border-radius: 12px;
  padding: 0.8rem;
  font-family: inherit;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s;
}
.tm-play-btn:hover { background: var(--c-accent-hover); }
.tm-level-won {
  background: ${C.card};
  border: 1px solid ${ca('emerald','55')};
  border-radius: 16px;
  padding: 1.5rem;
  text-align: center;
  max-width: 360px;
  margin: 0 auto;
}
.tm-level-won .trophy { font-size: 2.2rem; margin-bottom: 0.4rem; }
.tm-level-won h3 { font-size: 1.2rem; font-weight: 700; margin-bottom: 0.15rem; }
.tm-level-won .sub { color: ${C.muted}; font-size: 0.85rem; margin-bottom: 1rem; }
.tm-level-stats {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.85rem;
  border-top: 1px solid ${C.border};
  border-bottom: 1px solid ${C.border};
  padding: 0.75rem 0;
  margin-bottom: 1rem;
  text-align: left;
}
.tm-level-stat-row { display: flex; justify-content: space-between; padding: 0.15rem 0; }
.tm-level-stat-row .k { color: ${C.muted}; }
.tm-level-stat-row .v { color: ${C.gold}; font-weight: 600; }
.tm-level-won-btns { display: flex; gap: 0.6rem; }
.tm-next-btn {
  flex: 2;
  background: ${C.emerald};
  color: #fff;
  border: none;
  border-radius: 10px;
  padding: 0.7rem;
  font-family: inherit;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s;
}
.tm-next-btn:hover { background: var(--c-emerald-hover); }
.tm-end-btn {
  flex: 1;
  background: ${C.card};
  border: 1px solid ${C.border};
  color: ${C.text};
  border-radius: 10px;
  padding: 0.7rem;
  font-family: inherit;
  font-size: 0.88rem;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 0.12s;
}
.tm-end-btn:hover { border-color: ${C.accent}; }
/* Timer pill */
  background: ${ca('rose','22')} !important;
  color: ${C.rose} !important;
  animation: tm-timer-pulse 0.9s ease infinite alternate;
}
@keyframes tm-timer-pulse {
  from { box-shadow: 0 0 0 0 ${ca('rose','33')}; }
  to   { box-shadow: 0 0 0 5px ${ca('rose','00')}; }
}
/* Tier overview */
.tm-tier-overview {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.tm-tier-card {
  background: ${C.card};
  border: 1px solid ${C.border};
  border-radius: 12px;
  padding: 0.75rem 0.6rem;
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s;
  text-align: left;
}
.tm-tier-card:hover { border-color: ${C.accent}; background: ${ca('accent','0a')}; }
.tm-tier-card-name {
  font-size: 0.88rem;
  font-weight: 600;
  color: ${C.text};
  margin-bottom: 0.15rem;
}
.tm-tier-card-range {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
  color: ${C.muted};
  margin-bottom: 0.2rem;
}
.tm-tier-card-progress {
  font-size: 0.72rem;
  color: ${C.emerald};
  font-weight: 600;
}
/* Per-tier nav */
.tm-tier-back-btn {
  background: none;
  border: none;
  color: ${C.accent};
  font-family: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  padding: 0 0 0.5rem;
  display: inline-block;
}
.tm-tier-page-title {
  font-size: 1rem;
  font-weight: 700;
  margin-bottom: 0.6rem;
}
@media (max-width: 380px) {
  .tm-level-grid { grid-template-columns: repeat(10, 1fr); gap: 0.25rem; }
}

/* ============================================================
   Classic Games shared shell (.cg-*)
   ============================================================ */
.cg-shell {
  position: fixed;
  inset: 0;
  height: 100vh;
  height: 100dvh;
  width: 100vw;
  display: flex;
  flex-direction: column;
  background: ${C.bg};
  overflow: hidden;
  overscroll-behavior: none;
  z-index: 40;
  /* The classic shell is the fixed layout root for every classic game, so it
     pads all four sides; the forwarded x insets matter in landscape on a
     notched phone or the top bar's left edge clips. Bare env() is inert
     in-frame, so these are the platform tokens. */
  padding-top: var(--pc-safe-top);
  padding-right: var(--pc-safe-right);
  padding-bottom: var(--pc-safe-bottom);
  padding-left: var(--pc-safe-left);
  --cg-chrome: 3.6rem;
  /* The stage is inside the padded box, so it is already short by all four
     insets; the 100dvh cap must lose them too or the stage overflows by
     exactly the padding on a notched phone. */
  --cg-board: min(94vw, calc(100dvh - var(--cg-chrome) - 5.5rem - var(--pc-safe-top) - var(--pc-safe-bottom)), 560px);
}
.cg-topbar {
  flex: 0 0 auto;
  height: var(--cg-chrome);
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 0.7rem;
  border-bottom: 1px solid ${C.border};
  background: ${C.surface};
}
.cg-title {
  flex: 1;
  min-width: 0;
  font-weight: 600;
  font-size: clamp(0.95rem, 3.5vw, 1.15rem);
  display: flex;
  align-items: center;
  gap: 0.45rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cg-btn {
  flex: 0 0 auto;
  background: ${C.card};
  border: 1px solid ${C.border};
  color: ${C.text};
  border-radius: 10px;
  min-width: 2.4rem;
  height: 2.4rem;
  padding: 0 0.6rem;
  font-family: inherit;
  font-size: 1.05rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.12s ease, background 0.12s ease;
}
.cg-btn:hover { border-color: ${C.accent}; }
.cg-btn:active { background: ${ca('accent','22')}; }
.cg-stage {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: clamp(0.5rem, 2vh, 1rem);
  padding: clamp(0.5rem, 2vh, 1rem) 0.6rem;
  overflow: hidden;
}
.cg-stage.cg-scroll { overflow-y: auto; justify-content: flex-start; }
/* .cg-scroll is the classic stage's content scroller. Its padding is hidden
   by .cg-shell, so oversized content would otherwise be clipped top and
   bottom; scroll-padding-block restores the reach. */
.cg-stage.cg-scroll {
  scroll-padding-top: var(--pc-safe-top);
  scroll-padding-bottom: var(--pc-safe-bottom);
}

/* Bottom sheet */
.cg-sheet-backdrop {
  position: absolute;
  inset: 0;
  background: var(--c-scrim);
  z-index: 45;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
}
.cg-sheet-backdrop.open { opacity: 1; pointer-events: auto; }
.cg-sheet {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 46;
  background: ${C.surface};
  border-top: 1px solid ${C.border};
  border-radius: 18px 18px 0 0;
  /* Bottom sheet: the forwarded inset lifts the panel clear of the home
     indicator and the scroller gets the same reach below. */
  padding: 0.5rem 1rem calc(1rem + var(--pc-safe-bottom));
  max-height: 82dvh;
  overflow-y: auto;
  scroll-padding-bottom: var(--pc-safe-bottom);
  transform: translateY(110%);
  transition: transform 0.24s cubic-bezier(0.32, 0.72, 0, 1);
}
.cg-sheet.open { transform: translateY(0); }
.cg-sheet-handle { width: 2.5rem; height: 0.28rem; border-radius: 999px; background: ${C.dim}; margin: 0.35rem auto 0.8rem; }
.cg-sheet-tabs { display: flex; gap: 0.35rem; margin-bottom: 0.8rem; }
.cg-sheet-tab {
  flex: 1;
  background: ${C.card};
  border: 1px solid ${C.border};
  color: ${C.muted};
  border-radius: 10px;
  padding: 0.5rem 0.3rem;
  font-family: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}
.cg-sheet-tab.active { background: ${C.accent}; border-color: ${C.accent}; color: #fff; }
.cg-sheet h4 { font-size: 0.95rem; font-weight: 600; margin-bottom: 0.6rem; }
.cg-setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.65rem 0;
  border-bottom: 1px solid ${C.border};
}
.cg-setting-row:last-child { border-bottom: none; }
.cg-setting-row .name { font-size: 0.9rem; }
/* A setting whose trade-off needs a line of explanation (#192). */
.cg-setting-row .cg-setting-note {
  display: block; font-size: 0.74rem; color: ${C.muted}; margin-top: 0.15rem;
  max-width: 15rem; line-height: 1.3;
}
/* #192 — the letter colours, with the drawn keyboard gone. Not tappable: the
   device keyboard is doing the typing, this is only the read-out it cannot
   show. */
.cw-legend {
  display: flex; flex-wrap: wrap; gap: 3px; justify-content: center;
  margin: 0.35rem auto 0; max-width: 480px;
}
.cw-legend-key {
  font-size: 0.66rem; font-weight: 700; line-height: 1;
  padding: 3px 4px; border-radius: 4px; min-width: 1.05rem; text-align: center;
  background: ${C.border}; color: ${C.text};
}
.cw-legend-key.on-green { background: ${C.emerald}; color: #fff; }
.cw-legend-key.on-yellow { background: ${C.gold}; color: #fff; }
.cw-legend-key.on-gray { background: ${C.rose}; color: #fff; }
/* The input the device keyboard types into. Focusable and off-screen rather
   than display:none, because a hidden element cannot take focus and so cannot
   open a keyboard at all. */
.cw-hidden-input {
  position: absolute; opacity: 0; pointer-events: none;
  width: 1px; height: 1px; left: 0; top: 0; border: 0; padding: 0;
  font-size: 16px;   /* iOS zooms a focused input under 16px */
}
.cg-settings-h4-spaced { margin-top: 1.15rem; }

/* ---- Theme picker (light / dark / system) ---- */
.theme-choice { margin: 0.35rem 0 0.2rem; }
.theme-seg {
  display: flex;
  gap: 0.35rem;
  background: ${C.surface};
  border: 1px solid ${C.border};
  border-radius: 10px;
  padding: 0.25rem;
}
.theme-seg-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  color: ${C.muted};
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 0.45rem 0.3rem;
  cursor: pointer;
  white-space: nowrap;
}
.theme-seg-btn:hover { color: ${C.text}; }
.theme-seg-btn.active {
  background: ${C.card};
  border-color: ${C.accent};
  color: ${C.accent};
}
.theme-seg-icon { font-size: 0.95rem; line-height: 1; }
.theme-caption {
  margin-top: 0.5rem;
  font-size: 0.74rem;
  color: ${C.muted};
  line-height: 1.35;
}

/* ---- Global Settings sheet ---- */
.settings-panel { height: min(58vh, 460px); }
.settings-list { padding: 0.9rem 1.1rem 1.4rem; }
/* The settings list is the sheet's scroller: its content needs the same
   reach as the sheet's own bottom padding above. */
.settings-list { scroll-padding-bottom: var(--pc-safe-bottom); }
.settings-list h4 {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: ${C.muted};
  margin-bottom: 0.5rem;
}
/* Icon-only nav gear. Deliberately NOT in the mobile-hide rule that hides
   .nav-friends-btn — the theme control must stay reachable on phones. The
   theme toggle shares the gear's look on purpose: same outline, size and
   muted icon colour, so the pair reads as one control group. */
.nav-settings-btn {
  background: transparent;
  border: 1px solid ${C.border};
  color: ${C.muted};
  border-radius: 8px;
  padding: 0.3rem 0.5rem;
  font-size: 0.95rem;
  line-height: 1;
  cursor: pointer;
}
.nav-settings-btn:hover { color: ${C.text}; border-color: ${C.accent}; }
.cg-toggle {
  width: 2.8rem;
  height: 1.5rem;
  border-radius: 999px;
  background: ${C.dim};
  border: none;
  position: relative;
  cursor: pointer;
  transition: background 0.15s ease;
  flex: 0 0 auto;
}
.cg-toggle.on { background: ${C.emerald}; }
.cg-toggle::after {
  content: '';
  position: absolute;
  top: 0.18rem;
  left: 0.18rem;
  width: 1.14rem;
  height: 1.14rem;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.15s ease;
}
.cg-toggle.on::after { transform: translateX(1.3rem); }
.cg-sheet-list {
  max-height: calc(50dvh - var(--pc-safe-bottom));
  overflow-y: auto;
  scroll-padding-bottom: var(--pc-safe-bottom);
}
.cg-sheet-row {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid ${C.border};
  font-size: 0.82rem;
}
.cg-sheet-empty { color: ${C.muted}; text-align: center; padding: 1.5rem 0; font-size: 0.9rem; }
.cg-stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
.cg-stat-card { background: ${C.card}; border: 1px solid ${C.border}; border-radius: 10px; padding: 0.7rem; text-align: center; }
.cg-stat-card .val { font-family: 'JetBrains Mono', monospace; font-size: 1.25rem; font-weight: 700; color: ${C.gold}; }
.cg-stat-card .lbl { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.06em; color: ${C.muted}; margin-top: 0.15rem; }
.cg-rules { font-size: 0.86rem; line-height: 1.5; color: ${C.text}; }
.cg-rules li { margin: 0.3rem 0 0.3rem 1rem; }
.cg-sheet-action {
  width: 100%;
  background: ${C.card};
  border: 1px solid ${C.border};
  color: ${C.text};
  border-radius: 10px;
  padding: 0.7rem;
  font-family: inherit;
  font-size: 0.9rem;
  cursor: pointer;
  margin-top: 0.5rem;
}
.cg-sheet-action:hover { border-color: ${C.accent}; }
/* #201 — the concede action. Destructive, so it reads as destructive, but it
   is a sheet row like the others rather than the loudest thing on the board. */
.cg-sheet-action.danger { color: ${C.rose}; border-color: ${ca('rose', '55')}; }
.cg-sheet-action.danger:hover { border-color: ${C.rose}; }
.cg-sheet-action[disabled] { opacity: 0.55; cursor: default; }

/* Game Menu (Menu tab) */
.cg-menu-section { display: flex; flex-direction: column; gap: 0.4rem; }
.cg-menu-label { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.08em; color: ${C.muted}; }
.cg-mode-pill {
  flex: 0 0 auto;
  font-size: 0.62rem;
  font-weight: 600;
  background: ${ca('accent','22')};
  color: ${C.accent};
  border: 1px solid ${ca('accent','55')};
  border-radius: 999px;
  padding: 0.1rem 0.45rem;
  margin-left: 0.4rem;
  white-space: nowrap;
}
.cg-resume-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  width: var(--cg-board);
  max-width: 94vw;
  background: ${ca('gold','14')};
  border: 1px solid ${ca('gold','55')};
  border-radius: 10px;
  padding: 0.5rem 0.7rem;
  font-size: 0.82rem;
  color: ${C.text};
}
.cg-resume-actions { display: flex; gap: 0.4rem; flex: 0 0 auto; }
.cg-resume-actions button {
  background: ${C.gold};
  color: #1a1205;
  border: none;
  border-radius: 8px;
  padding: 0.35rem 0.7rem;
  font-family: inherit;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
}
.cg-resume-actions button.ghost { background: transparent; color: ${C.muted}; border: 1px solid ${C.border}; }
.cg-onchain-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  margin-left: 0.4rem;
  font-size: 0.72rem;
  font-weight: 600;
  color: ${C.accent};
  text-decoration: none;
  opacity: 0.85;
}
.cg-onchain-badge:hover { opacity: 1; text-decoration: underline; }

/* Keep existing classic boards fitting inside the shell stage */
.cg-stage .ms-boardbox, .cg-stage .t2048-board-wrap { max-width: min(360px, var(--cg-board)) !important; }
.cg-stage .mnc-board { max-width: min(480px, var(--cg-board)) !important; }
.cg-stage .ms-bottom-nav, .cg-stage .mnc-bottom-nav, .cg-stage .t2048-bottom-nav { display: none; }
/* The five board-game canvases size from .brg-canvas-box, whose max-width
   composes the per-board cap (--brg-cap, set inline by BrgBoardBox) with the
   --cg-board viewport cap — the PHASE 3 "no scrolling to see whose turn it
   is" rule, now one declaration instead of per-board !important overrides. */
.cg-stage .cnl-board-wrap { max-width: min(480px, var(--cg-board)) !important; }
/* The board-game rooms stack status + board + legend + leaderboard, so cap the
   text chrome too — the board fitting is only half of "no scrolling to see
   whose turn it is". */

/* ---- Snake ---- */
.snake-board {
  width: var(--cg-board);
  height: var(--cg-board);
  max-width: 94vw;
  max-height: 94vw;
  background: ${C.surface};
  border: 2px solid ${C.border};
  border-radius: 12px;
  overflow: hidden;
  touch-action: none;
  position: relative;
}
.snake-hint { color: ${C.muted}; font-size: 0.8rem; text-align: center; }

/* ---- Block Blast ---- */
/* The grid is a canvas; the box keeps the panel look and the rect the drag
   origin math measures. */
.bb-grid {
  width: var(--cg-board);
  height: var(--cg-board);
  max-width: 94vw;
  max-height: 94vw;
  display: flex; align-items: center; justify-content: center;
  background: ${C.surface};
  border: 2px solid ${C.border};
  border-radius: 12px;
  padding: 4px;
  touch-action: none;
}
.bb-tray {
  display: flex;
  gap: 0.8rem;
  justify-content: center;
  align-items: center;
  width: var(--cg-board);
  max-width: 94vw;
  min-height: 5rem;
}
.bb-pcell { width: clamp(0.7rem, 3.5vw, 1.1rem); height: clamp(0.7rem, 3.5vw, 1.1rem); border-radius: 3px; }
.bb-pcell.on { background: ${C.accent}; }
.bb-drag-ghost { position: fixed; z-index: 60; pointer-events: none; display: grid; gap: 2px; opacity: 0.9; }
.bb-drag-ghost .bb-pcell.on { background: ${C.gold}; }

/* ---- Match 3 (PHASE 8) ----
   These rules existed under a .tm-grid prefix and were DEAD — nothing in the
   app ever rendered that class. Match 3 was the only game in the registry with
   no design system at all: hand-written inline styles, plain coloured blocks,
   a bare Bar: label. Renamed to .m3-* and actually wired up, which also earns
   it the Phase 2 touch-action/press rules and the Phase 3 fit sizing. */
/* The tile board is a canvas; the box keeps the width caps. */
.m3-grid {
  width: var(--cg-board);
  max-width: 94vw;
  display: flex; align-items: center; justify-content: center;
  touch-action: none;
}
.m3-level {
  padding: 0.85rem 0.6rem; min-height: 62px;
  background: ${C.card}; color: ${C.text};
  border: 1px solid ${C.border}; border-radius: 12px;
  font-family: inherit; cursor: pointer; text-align: center;
  touch-action: manipulation; -webkit-tap-highlight-color: transparent;
  transition: background 0.12s ease, border-color 0.12s ease;
}
.m3-level:active { transform: scale(0.98); }
.m3-level.solved { border-color: ${C.emerald}; color: ${C.emerald}; }
.m3-level.locked { opacity: 0.45; cursor: not-allowed; color: ${C.muted}; }
.m3-level.locked:active { transform: none; }
.m3-level-id { font-weight: 700; font-size: 1rem; }
.m3-level-name { font-size: 0.72rem; margin-top: 0.2rem; color: ${C.muted}; }

/* ---- Diamond Rush ---- */
/* The gem board is a canvas; the box keeps the panel look and sizing. */
.dr-grid {
  width: var(--cg-board);
  height: var(--cg-board);
  max-width: 94vw;
  max-height: 94vw;
  display: flex; align-items: center; justify-content: center;
  background: ${C.surface};
  border: 2px solid ${C.border};
  border-radius: 12px;
  padding: 4px;
  touch-action: none;
}
@keyframes timeBounce { 0% { opacity: 1; transform: translate(-50%, -50%) scale(0.5); } 100% { opacity: 0; transform: translate(-50%, -150%) scale(1); } }

@media (orientation: landscape) and (max-height: 560px) {
  .cg-shell { --cg-board: min(70vh, 44vw, 460px); }
  .cg-stage { flex-direction: row; flex-wrap: wrap; }
}
/* ---- Screen transitions (#235) ----
   Navigation only: lobby, pre-game, opponent, the game, the locked day, the
   profile. NOT boards, cells, cards or canvases — the hosted native kit's own
   fidelity rules forbid animating high-frequency interactions, and it fights
   the tap primitive, which gives its feedback on finger-DOWN precisely so
   nothing has to wait. A card that animates when you tap it feels slower.

   Each screen root really does mount when you navigate to it, so this needs no
   JavaScript and cannot remount anything — which matters here, because
   remounting a game at the wrong moment is how a finished 2048 board came back
   as a fresh one (#158/#160).

   TWO variants, and the difference is not cosmetic. A running transform
   changes what getBoundingClientRect reports, and the boards in this app
   measure themselves at mount (useFitBox, sizeCanvas). So any screen that
   hosts a measured board fades ONLY; the rest may also travel a few pixels.
   The fill mode is BACKWARDS so nothing is left applied afterwards: a
   lingering transform would make the element a containing block for the
   position:fixed sheets that open over these screens. */
@keyframes un-screen-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes un-screen-fade {
  from { opacity: 0; }
  to   { opacity: 1; }
}
.screen-in { animation: un-screen-in 190ms cubic-bezier(0.2, 0.7, 0.3, 1) backwards; }
.screen-in-fade { animation: un-screen-fade 150ms linear backwards; }

/* The in-app pref, now that the root carries it (#235). Same list as the OS
   media query below — add new motion to BOTH or a player gets it in one place
   and not the other. */
:root[data-reduce-motion="1"] .screen-in,
:root[data-reduce-motion="1"] .screen-in-fade,
:root[data-reduce-motion="1"] .cg-sheet,
:root[data-reduce-motion="1"] .badge-strip-body,
:root[data-reduce-motion="1"] .badge-chevron,
:root[data-reduce-motion="1"] .cnl-roll-btn,
:root[data-reduce-motion="1"] .ng-status.err,
:root[data-reduce-motion="1"] .ng-status.ok,
:root[data-reduce-motion="1"] .win-card .trophy,
:root[data-reduce-motion="1"] .fd-card,
:root[data-reduce-motion="1"] .fd-fc,
:root[data-reduce-motion="1"] .fd-fc-flip,
:root[data-reduce-motion="1"] .fd-back-body,
:root[data-reduce-motion="1"] .fd-back-x,
:root[data-reduce-motion="1"] .fd-ov-scrim {
  animation: none !important;
  transition: none !important;
}
:root[data-reduce-motion="1"] .tappable:active,
:root[data-reduce-motion="1"] .tappable[data-pressed] { transform: none !important; }

/* ---- #185 — between-bands auto-advance overlay ----
   z-index 55 sits it above the win overlay (50): cancelling swaps one for the
   other, so both exist for a frame. Colours come from tokens and ca() only —
   an alpha byte concatenated onto a var() token is not a colour at all (see
   the token-alpha-concat self-test). */
.adv-overlay {
  position: fixed;
  inset: 0;
  background: var(--c-scrim);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 55;
  padding: calc(1.25rem + var(--pc-safe-top)) calc(1.25rem + var(--pc-safe-right))
           calc(1.25rem + var(--pc-safe-bottom)) calc(1.25rem + var(--pc-safe-left));
  overflow-y: auto;
  overscroll-behavior: contain;
}
.adv-card {
  background: ${C.card};
  border: 1px solid ${C.border};
  border-radius: 18px;
  padding: 1.75rem 1.5rem;
  text-align: center;
  width: 100%;
  max-width: 340px;
  box-shadow: 0 20px 50px var(--c-shadow-lg);
  animation: advPop 0.24s ease-out;
}
.adv-tally-label {
  color: ${C.muted};
  font-size: 0.78rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.adv-tally-num {
  font-family: 'JetBrains Mono', monospace;
  font-size: 2.6rem;
  font-weight: 700;
  color: ${C.gold};
  line-height: 1.1;
  margin: 0.3rem 0 0.35rem;
  animation: advPop 0.34s ease-out;
}
.adv-note { color: ${C.muted}; font-size: 0.82rem; line-height: 1.45; }
.adv-next {
  margin-top: 1.25rem;
  padding-top: 1.1rem;
  border-top: 1px solid ${C.border};
}
.adv-banner {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 0.45rem;
  background: ${ca('accent','1f')};
  border: 1px solid ${ca('accent','44')};
  border-radius: 12px;
  padding: 0.6rem 0.9rem;
}
.adv-banner-band { font-size: 1.3rem; font-weight: 700; color: ${C.accent}; }
.adv-banner-of { font-size: 0.85rem; color: ${C.muted}; }
.adv-count-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.55rem;
  margin-top: 0.85rem;
}
.adv-count {
  font-family: 'JetBrains Mono', monospace;
  font-size: 1.9rem;
  font-weight: 700;
  color: ${C.text};
  min-width: 1.3rem;
  display: inline-block;
  animation: advCount 0.85s ease-out;
}
.adv-crown { font-size: 2.6rem; }
.adv-done-title { font-size: 1.4rem; font-weight: 700; margin: 0.4rem 0 0.55rem; }
.adv-actions { display: flex; flex-direction: column; gap: 0.6rem; margin-top: 1.35rem; }
.adv-actions .primary-btn { margin: 0; }
@keyframes advPop {
  from { transform: scale(0.9); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
@keyframes advCount {
  from { transform: scale(1.5); opacity: 0.35; }
  to { transform: scale(1); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .screen-in, .screen-in-fade { animation: none !important; }
  .cg-sheet { transition: none !important; }
  .badge-strip-body, .badge-chevron { transition: none !important; }
  /* PHASE 6 — the block used to cover four selectors, one of which (.tm-grid)
     was dead CSS. A player who asks their phone to calm animations down now
     actually gets that everywhere, including the two animations this phase
     adds (the 2048 tile slide and the Marble Loop insertion, which falls back
     to the old instant splice). */
  .cnl-roll-btn {
    animation: none !important;
    transition: none !important;
  }
  .ng-status.err, .ng-status.ok { animation: none !important; }
  .win-card .trophy { animation: none !important; }
  /* Keep the colour half of a press (the affordance) and drop the movement. */
  .tappable:active, .tappable[data-pressed] { transform: none !important; }
  /* #185 — the between-bands overlay still counts down; it just stops
     bouncing while it does. */
  .adv-card, .adv-tally-num, .adv-count { animation: none !important; }
  /* The flip-deck lobby: DeckOpenCard already skips the open/close motion
     under reduced motion (cgReducedMotion); these stop the hover lift too. */
  .fd-card, .fd-fc, .fd-fc-flip, .fd-back-body, .fd-back-x, .fd-ov-scrim { transition: none !important; }
}

/* ---- Knight's Tour ---- */
.kt-wrap { display: flex; flex-direction: column; align-items: center; gap: 1rem; }
.kt-boardbox {
  width: min(92vw, 480px, var(--cg-board, 480px)); max-width: 100%; margin: 0 auto;
  display: flex; align-items: center; justify-content: center;
  /* aspect-ratio hands useFitBox a real height; without it the measure loop's
     only height is the canvas's own, which pins the cell at minCell (~224px
     boards on a 390px phone). flex 0 0 auto stops the stage's flex column
     from shrinking the ratio box (and its width with it). */
  aspect-ratio: 1;
  flex: 0 0 auto;
  touch-action: none;
}
.kt-canvas { border-radius: 8px; }
.kt-undo-btn:hover:not(:disabled) { border-color: ${C.accent}; }
.kt-new-btn:hover { border-color: ${C.rose}; }
.kt-history-row.kt-row-new { background: ${ca('accent','11')}; border-radius: 6px; }
.kt-rank { font-size: 0.75rem; color: ${C.muted}; font-family: 'JetBrains Mono', monospace; min-width: 2rem; }
.kt-best { font-size: 0.82rem; color: ${C.gold}; margin-bottom: 0.75rem; text-align: center; font-weight: 600; }
.kt-empty { color: ${C.muted}; text-align: center; padding: 2.5rem 0; font-size: 0.9rem; }
.kt-bottom-nav { display: flex; border-top: 1px solid ${C.border}; margin-top: 0.75rem; }
.kt-tab {
  flex: 1;
  padding: 0.75rem;
  background: none;
  border: none;
  color: ${C.muted};
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: color 0.12s ease;
  font-family: 'Space Grotesk', system-ui, sans-serif;
}
.kt-tab.active { color: ${C.accent}; border-top: 2px solid ${C.accent}; margin-top: -1px; }
/* ---- Diamond Rush ---- */
.dr-wrap { display: flex; flex-direction: column; align-items: center; gap: 1rem; }
.dr-select { width: 100%; max-width: 520px; text-align: center; }
.dr-select h2 { font-size: 1.3rem; font-weight: 700; margin-bottom: 0.35rem; }
.dr-select p { color: ${C.muted}; font-size: 0.9rem; margin-bottom: 1.2rem; }
.dr-level-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  gap: 0.7rem; margin-bottom: 1.3rem;
}
.dr-level-btn {
  position: relative; aspect-ratio: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 0.15rem;
  background: ${C.card}; border: 1px solid ${C.border}; border-radius: 12px;
  color: ${C.text}; font-weight: 700; font-size: 1.1rem; cursor: pointer;
  transition: border-color 0.12s ease, transform 0.08s ease;
}
.dr-level-btn:not(.locked):hover { border-color: ${C.gold}; transform: translateY(-2px); }
.dr-level-btn.selected { border-color: ${C.gold}; box-shadow: 0 0 0 2px ${ca('gold','55')}; }
.dr-level-btn.locked { opacity: 0.4; cursor: not-allowed; }
.dr-level-btn.done { border-color: ${C.emerald}; }
.dr-level-meta { font-size: 0.62rem; font-weight: 500; color: ${C.muted}; font-family: 'JetBrains Mono', monospace; }
.dr-check { color: ${C.emerald}; font-size: 0.7rem; }
.dr-lock-icon { font-size: 0.85rem; }
.dr-play-btn {
  width: 100%; padding: 0.85rem; background: ${C.gold}; color: #1a1206;
  border: none; border-radius: 12px; font-weight: 700; font-size: 1rem;
  cursor: pointer; transition: filter 0.12s ease;
}
.dr-play-btn:hover { filter: brightness(1.08); }
.dr-play-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.dr-toolbar { display: flex; gap: 0.5rem; flex-wrap: wrap; justify-content: center; }
.dr-tool-btn {
  padding: 0.5rem 0.9rem; background: ${C.surface}; color: ${C.text};
  border: 1px solid ${C.border}; border-radius: 10px; font-weight: 600;
  font-size: 0.85rem; cursor: pointer; transition: border-color 0.12s ease;
}
.dr-tool-btn:hover { border-color: ${C.accent}; }
.dr-board {
  display: grid; gap: 2px; background: ${C.border}; padding: 4px;
  border-radius: 12px; touch-action: none; user-select: none;
  max-width: 92vw;
}
.dr-cell {
  display: flex; align-items: center; justify-content: center;
  background: ${C.surface}; border-radius: 4px; position: relative;
  font-size: clamp(14px, 5vw, 26px); line-height: 1;
}
.dr-cell.wall { background: ${C.dim}; }
.dr-cell.exit { background: ${ca('accent','33')}; }
.dr-cell.trap { background: ${ca('rose','22')}; }
.dr-cell.floor { background: ${C.surface}; }
.dr-sprite { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
.dr-hero { z-index: 3; }
.dr-enemy { z-index: 2; }
.dr-dpad {
  display: grid;
  grid-template-columns: repeat(3, 56px);
  grid-template-rows: repeat(3, 56px);
  gap: 0.35rem; justify-content: center;
}
.dr-dbtn {
  background: ${C.card}; border: 1px solid ${C.border}; border-radius: 10px;
  color: ${C.text}; font-size: 1.3rem; cursor: pointer; display: flex;
  align-items: center; justify-content: center; touch-action: manipulation;
}
.dr-dbtn:active { background: ${C.accent}; }
.dr-dpad .up { grid-column: 2; grid-row: 1; }
.dr-dpad .left { grid-column: 1; grid-row: 2; }
.dr-dpad .right { grid-column: 3; grid-row: 2; }
.dr-dpad .down { grid-column: 2; grid-row: 3; }
.dr-overlay-panel {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 0.8rem;
  background: ${ca('bg','cc')}; border-radius: 12px; z-index: 5;
}
.dr-board-shell { position: relative; }
.dr-paused-msg { font-weight: 700; font-size: 1.1rem; color: ${C.gold}; }
.dr-end {
  text-align: center; display: flex; flex-direction: column; align-items: center;
  gap: 0.6rem; padding: 1.5rem 0; width: 100%; max-width: 420px;
}
.dr-end .dr-emoji { font-size: 3rem; }
.dr-end h3 { font-size: 1.4rem; font-weight: 700; }
.dr-end .dr-stats { color: ${C.muted}; font-family: 'JetBrains Mono', monospace; font-size: 0.9rem; }
.dr-end-btns { display: flex; flex-direction: column; gap: 0.55rem; width: 100%; margin-top: 0.5rem; }
.dr-hint { color: ${C.muted}; font-size: 0.8rem; }

/* ---- Tile Match Puzzle menu & competitive tabs ---- */
.tm-menu { display: flex; flex-direction: column; max-width: 480px; margin: 0 auto; width: 100%; }
.tm-menu-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.5rem 0 0.6rem; gap: 0.5rem;
}
.tm-menu-header h2 { font-size: 1rem; font-weight: 700; margin: 0; flex: 1; }
.tm-menu-tabs {
  display: flex; gap: 0.15rem;
  border-bottom: 1px solid ${C.border};
  margin-bottom: 0.9rem; overflow-x: auto;
}
.tm-menu-tab {
  background: none; border: none; border-bottom: 2px solid transparent;
  padding: 0.45rem 0.75rem; font-family: inherit; font-size: 0.85rem;
  font-weight: 500; color: ${C.muted}; cursor: pointer;
  transition: color 0.12s, border-color 0.12s; white-space: nowrap;
  margin-bottom: -1px;
}
.tm-menu-tab:hover { color: ${C.text}; }
.tm-menu-tab.active { color: ${C.accent}; border-bottom-color: ${C.accent}; font-weight: 600; }

/* Leaderboard */
.tm-lb-tabs { display: flex; gap: 0.4rem; margin-bottom: 0.75rem; }
.tm-lb-sub-tab {
  background: ${C.card}; border: 1px solid ${C.border}; border-radius: 8px;
  padding: 0.3rem 0.7rem; font-family: inherit; font-size: 0.8rem;
  font-weight: 500; color: ${C.muted}; cursor: pointer; transition: all 0.12s;
}
.tm-lb-sub-tab.active { background: ${ca('accent','18')}; border-color: ${C.accent}; color: ${C.accent}; font-weight: 600; }
.tm-lb-row {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.45rem 0.5rem; border-radius: 8px;
  font-size: 0.84rem; transition: background 0.1s;
}
.tm-lb-row:hover { background: ${C.surface}; }
.tm-lb-row.me { background: ${ca('accent','12')}; border: 1px solid ${ca('accent','30')}; margin-top: 0.4rem; }
.tm-lb-rank { font-family: 'JetBrains Mono', monospace; font-weight: 700; color: ${C.gold}; min-width: 1.8rem; font-size: 0.78rem; }
.tm-lb-name { flex: 1; color: ${C.text}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tm-lb-stat { font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; color: ${C.accent}; font-weight: 600; }
.tm-lb-empty { color: ${C.muted}; font-size: 0.85rem; text-align: center; padding: 1.5rem 0; }

/* Duel Arena */
.tm-duel-tiers { display: flex; flex-direction: column; gap: 0.6rem; margin-bottom: 1rem; }
.tm-duel-tier-card {
  background: ${C.card}; border: 1px solid ${C.border}; border-radius: 12px;
  padding: 0.85rem 1rem; display: flex; align-items: center; gap: 0.75rem;
}
.tm-duel-tier-card .tm-duel-stake { font-size: 1.1rem; font-weight: 700; font-family: 'JetBrains Mono', monospace; color: ${C.gold}; min-width: 5rem; }
.tm-duel-tier-card .tm-duel-payout { flex: 1; font-size: 0.82rem; color: ${C.muted}; }
.tm-duel-tier-card .tm-duel-payout strong { color: ${C.emerald}; }
.tm-duel-find-btn {
  background: ${C.accent}; color: #fff; border: none; border-radius: 8px;
  padding: 0.45rem 0.85rem; font-family: inherit; font-size: 0.83rem;
  font-weight: 600; cursor: pointer; transition: background 0.12s;
}
.tm-duel-find-btn:hover:not(:disabled) { background: var(--c-accent-hover); }
.tm-duel-find-btn:disabled { opacity: 0.35; cursor: not-allowed; background: ${C.muted}; }
.tm-duel-matchmaking {
  text-align: center; padding: 2rem 1rem;
  display: flex; flex-direction: column; align-items: center; gap: 0.75rem;
}
.tm-duel-pulse {
  width: 3rem; height: 3rem; border-radius: 50%;
  background: ${ca('accent','33')}; border: 2px solid ${C.accent};
  animation: tm-duel-pulse-anim 1.2s ease-in-out infinite;
}
@keyframes tm-duel-pulse-anim {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.2); opacity: 0.6; }
}
.tm-duel-timer { font-family: 'JetBrains Mono', monospace; font-size: 1.1rem; font-weight: 700; color: ${C.accent}; }
.tm-duel-result {
  background: ${C.card}; border: 1px solid ${C.border}; border-radius: 14px;
  padding: 1.25rem; text-align: center;
}
.tm-duel-result .tm-duel-outcome { font-size: 1.6rem; margin-bottom: 0.2rem; }
.tm-duel-result h3 { font-size: 1.1rem; font-weight: 700; margin-bottom: 0.75rem; }
.tm-duel-result .tm-duel-balance { font-family: 'JetBrains Mono', monospace; color: ${C.gold}; font-size: 0.9rem; margin-bottom: 0.5rem; }
.tm-duel-back-btn {
  margin-top: 0.75rem; background: ${C.surface}; border: 1px solid ${C.border};
  border-radius: 8px; padding: 0.5rem 1rem; font-family: inherit;
  font-size: 0.85rem; color: ${C.text}; cursor: pointer; transition: border-color 0.12s;
}
.tm-duel-back-btn:hover { border-color: ${C.accent}; }

/* Daily Tasks */
.tm-task-card {
  background: ${C.card}; border: 1px solid ${C.border}; border-radius: 12px;
  padding: 0.85rem 1rem; margin-bottom: 0.6rem;
}
.tm-task-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.35rem; }
.tm-task-label { font-weight: 600; font-size: 0.9rem; }
.tm-task-reward { font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; color: ${C.gold}; font-weight: 600; }
.tm-task-desc { font-size: 0.8rem; color: ${C.muted}; margin-bottom: 0.55rem; }
.tm-task-bar-wrap { background: ${C.surface}; border-radius: 4px; height: 5px; margin-bottom: 0.5rem; }
.tm-task-bar-fill { height: 5px; border-radius: 4px; background: ${C.accent}; transition: width 0.3s; }
.tm-task-footer { display: flex; align-items: center; justify-content: space-between; }
.tm-task-progress-lbl { font-size: 0.76rem; color: ${C.muted}; font-family: 'JetBrains Mono', monospace; }
.tm-task-claim-btn {
  background: ${C.emerald}; color: #fff; border: none; border-radius: 7px;
  padding: 0.3rem 0.75rem; font-family: inherit; font-size: 0.8rem;
  font-weight: 600; cursor: pointer; transition: background 0.12s;
}
.tm-task-claim-btn:hover:not(:disabled) { background: var(--c-emerald-hover); }
.tm-task-claim-btn:disabled { opacity: 0.4; cursor: not-allowed; background: ${C.muted}; }
.tm-task-claimed { font-size: 0.8rem; color: ${C.emerald}; font-weight: 600; }
.tm-tasks-all-done {
  text-align: center; padding: 1.5rem 0;
  color: ${C.muted}; font-size: 0.88rem;
}

/* #224 — the Verified badge, the session receipt and the verified leaderboard
   are gone at an admin's request, and their styles with them. The verification
   MACHINERY is untouched (lib/dapp.js, game_sessions, settleDailySession's
   tier A/B split): a request to stop showing a verdict is not a request to
   stop reaching one. */

/* ---- Badge progress pills (profile BadgeStrip + win overlay) ---- */
.badge-progress { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0 0 0.7rem; }
.badge-progress-pill {
  font-size: 0.72rem; font-weight: 600; color: ${C.muted};
  background: ${ca('gold','0d')}; border: 1px solid ${ca('gold','33')};
  border-radius: 999px; padding: 0.2rem 0.55rem;
  display: inline-flex; gap: 0.3rem; align-items: center; white-space: nowrap;
}
/* Win overlay next-milestone progress. */
.win-progress { display: flex; flex-wrap: wrap; gap: 0.4rem; justify-content: center; margin: 0.6rem 0; }
/* ---- Phase 5 board games (Checkers / Reversi / Four in a Row / Gomoku / Ludo) ---- */
.brg-intro {
  font-size: 0.85rem; color: ${C.text}; background: ${ca('accent','14')};
  border: 1px solid ${ca('accent','44')}; border-radius: 10px;
  padding: 0.6rem 0.8rem; margin-bottom: 0.9rem; text-align: center;
}
.brg-legend {
  display: flex; gap: 0.9rem; justify-content: center; align-items: center;
  font-size: 0.72rem; color: ${C.muted}; margin-top: 0.6rem; flex-wrap: wrap;
}

/* All five boards draw on canvases inside .brg-canvas-box; only the legend
   swatches (.ck-piece-mini / .rv-disc-mini / .fir-disc-mini), the note/legend
   text and the DOM affordances (Gomoku's confirm bar, Ludo's move list)
   remain as elements. The box's max-width composes the per-board cap with
   the --cg-board viewport cap; aspect-ratio hands useFitBox a real height
   (see .kt-boardbox). */
.brg-canvas-box {
  /* A DEFINITE width, like the DOM boards' min(92vw, Npx) — width:100% would
     resolve against the shrink-wrapped view wrapper (i.e. the legend's text
     width). --cg-board folds in the viewport cap. */
  width: min(92vw, var(--brg-cap, 380px), var(--cg-board, 380px));
  max-width: 100%;
  margin: 0 auto;
  display: flex; align-items: center; justify-content: center;
  /* An aspect-ratio flex item SHRINKS on the stage's main axis, and the ratio
     drags the width down with it — refuse, and let .cg-scroll scroll instead
     (what the DOM boards did). */
  flex: 0 0 auto;
  touch-action: none;
}
.ck-piece-mini.p1 { background: ${C.accent}; }
/* PHASE 2 — Gomoku ghost-confirm. 15x15 in 380px is ~24px per intersection and
   a mis-tap used to place a stone permanently. The ghost stone itself is drawn
   on the canvas now; the confirm bar stays DOM. */
.brd-confirm-bar button.go { background: ${C.accent}; border-color: ${C.accent}; color: #fff; }
/* PHASE 7 — "Your rooms": a room you hosted was invisible once you left it. */
.brd-myrooms { display: flex; flex-direction: column; gap: 0.45rem; margin-bottom: 0.9rem; }
.brd-myrooms-label {
  font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.08em;
  color: ${C.muted}; font-weight: 700;
}
.brd-myroom {
  display: flex; align-items: center; justify-content: space-between; gap: 0.6rem;
  padding: 0.55rem 0.7rem; background: ${C.card};
  border: 1px solid ${C.border}; border-radius: 12px;
}
.brd-myroom-meta { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
.brd-myroom-code { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 0.92rem; }
.brd-myroom-sub { font-size: 0.72rem; color: ${C.muted}; }
.brd-myroom-sub.yourturn { color: ${C.emerald}; font-weight: 600; }
.brd-myroom button {
  min-height: 40px; padding: 0 0.85rem; border-radius: 10px; flex: 0 0 auto;
  background: ${C.accent}; border: none; color: #fff;
  font-family: inherit; font-size: 0.82rem; font-weight: 700; cursor: pointer;
}
.brd-myroom button.ghost { background: transparent; color: ${C.muted}; border: 1px solid ${C.border}; }
/* #201 left this on the waiting-room "Close this room" button only — the live
   match's concede moved into the ☰ sheet, where it is not under the board. */
.brd-endgame {
  min-height: 44px; padding: 0 1rem; margin: 0.7rem auto 0; display: block;
  background: transparent; border: 1px solid ${C.rose}; border-radius: 12px;
  color: ${C.rose}; font-family: inherit; font-size: 0.85rem; font-weight: 600; cursor: pointer;
}
.dbnc-effects { display: flex; gap: 0.4rem; justify-content: center; flex-wrap: wrap; }
.dbnc-effect {
  font-size: 0.72rem; font-weight: 600; padding: 0.15rem 0.5rem;
  border-radius: 999px; background: ${ca('gold', '22')}; color: ${C.gold};
  text-transform: capitalize;
}
  min-height: 1.1rem;
}
/* PHASE 4 — practice replay ribbon (#133). */
.practice-ribbon {
  display: flex; align-items: center; justify-content: center; gap: 0.4rem;
  padding: 0.35rem 0.7rem; border-radius: 999px;
  background: ${ca('violet', '1f')}; color: ${C.violet};
  font-size: 0.74rem; font-weight: 700; letter-spacing: 0.02em;
  text-transform: uppercase;
}
/* Pinned so it renders identically over all three shells. pointer-events:none
   because it floats over a live board — a marker must never eat a tap. */
.practice-ribbon.pinned {
  position: fixed; left: 50%; transform: translateX(-50%);
  bottom: calc(0.6rem + var(--pc-safe-bottom));
  z-index: 60; pointer-events: none;
  background: ${C.card}; border: 1px solid ${C.violet};
  box-shadow: var(--c-shadow-md);
}
.reset-line {
  text-align: center; font-size: 0.8rem; color: ${C.muted}; margin-top: 0.5rem;
}
.practice-note { font-weight: 500; opacity: 0.75; font-size: 0.82em; }

/* ---- Chutes & Ladders ---- */
.cnl-board-wrap {
  position: relative; max-width: 480px; margin: 0 auto;
  aspect-ratio: 1; width: 100%;
}
/* The board (cells, connectors, pawns) is one canvas — see CnlBoardCanvas. */
.cnl-board-canvas-fill {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
}
.cnl-canvas { border-radius: 12px; }
.cnl-variant-block { margin-top: 0.5rem; }
.cnl-variant-label {
  font-family: 'JetBrains Mono', monospace; font-size: 0.66rem; letter-spacing: 0.08em;
  text-transform: uppercase; color: ${C.muted}; margin-bottom: 0.4rem;
}
.cnl-variant-note {
  color: ${C.muted}; font-size: 0.78rem; line-height: 1.4; margin-top: 0.5rem;
}
.cnl-variant-link {
  background: none; border: none; padding: 0; color: ${C.accent};
  font-family: inherit; font-size: 0.78rem; font-weight: 600; cursor: pointer;
  text-decoration: underline;
}
/* ---- Snakes & Ladders V2 — difficulty picker ---- */
/* Seven pills need to wrap; .mnc-mode-sub alone stacks them full-width. */
.cnlv2-diff-row { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.cnlv2-diff-row .mnc-difficulty-pill { flex: 1 1 28%; min-width: 28%; }
.mnc-difficulty-pill.cnlv2-diff-locked {
  opacity: 0.55; border-style: dashed; cursor: not-allowed;
}
.mnc-difficulty-pill.cnlv2-diff-locked:hover { border-color: ${C.border}; color: ${C.muted}; }
.cnlv2-lock-note { color: ${C.gold}; }
/* ---- Snakes & Ladders V2 — Local Match roster + Ranked toggle ---- */
/* One row per seat, so a six-seat table reads top to bottom instead of
   wrapping into an unreadable pill soup. The seat label is a fixed column so
   the Human/Bot pills line up down the whole list. */
.cnlv2-roster-block { margin-top: 0.6rem; }
.cnlv2-roster-row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.4rem; }
.cnlv2-roster-row .mnc-difficulty-pill { flex: 1 1 0; min-width: 0; }
.cnlv2-roster-seat {
  flex: 0 0 2.1rem; font-family: 'JetBrains Mono', monospace; font-size: 0.72rem;
  font-weight: 700; color: ${C.muted};
}
.cnlv2-ranked-row {
  display: flex; flex-direction: column; gap: 0.3rem;
  margin-top: 0.6rem; padding-top: 0.6rem; border-top: 1px solid ${C.border};
}
.mnc-difficulty-pill.cnlv2-ranked-toggle { align-self: flex-start; }
.mnc-difficulty-pill.cnlv2-ranked-toggle.active {
  border-color: ${C.gold}; color: ${C.gold}; background: ${ca('gold', '1f')};
}
.cnlv2-ranked-note { color: ${C.muted}; font-size: 0.75rem; }
/* Final standings table on the win card (multi-seat local matches). */
.win-standings {
  margin-top: 0.7rem; padding: 0.55rem 0.6rem;
  border: 1px solid ${C.border}; border-radius: 10px; background: ${C.card};
}
.win-standings .ws-title {
  font-size: 0.7rem; letter-spacing: 0.06em; text-transform: uppercase;
  color: ${C.muted}; margin-bottom: 0.35rem;
}
.win-standings .ws-row {
  display: flex; align-items: center; gap: 0.55rem;
  padding: 0.22rem 0.3rem; border-radius: 7px; font-size: 0.82rem;
}
.win-standings .ws-row.me { background: ${ca('accent', '1f')}; color: ${C.text}; }
.win-standings .ws-place { flex: 0 0 1.2rem; color: ${C.gold}; font-weight: 700; }
.win-standings .ws-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.win-standings .ws-sq { flex: 0 0 auto; color: ${C.muted}; }

.cnlv2-rank-chip {
  display: inline-flex; align-items: center; gap: 0.3rem;
  padding: 0.1rem 0.45rem; border-radius: 999px;
  border: 1px solid ${C.gold}; color: ${C.gold}; background: ${ca('gold', '1a')};
  font-family: 'JetBrains Mono', monospace; font-size: 0.68rem; font-weight: 700;
}
.mok-intro { color: ${C.muted}; font-size: 0.85rem; line-height: 1.5; margin-bottom: 0.9rem; }
.mok-section {
  font-family: 'JetBrains Mono', monospace; font-size: 0.66rem; letter-spacing: 0.09em;
  text-transform: uppercase; color: ${C.muted};
  border-bottom: 1px solid ${C.border}; padding-bottom: 0.25rem; margin: 0.9rem 0 0.55rem;
}
.mok-row { display: flex; gap: 0.6rem; align-items: flex-start; margin-bottom: 0.55rem; }
.mok-sq {
  flex: 0 0 auto; min-width: 1.8rem; text-align: center; border-radius: 6px;
  font-family: 'JetBrains Mono', monospace; font-size: 0.74rem; font-weight: 700;
  padding: 0.15rem 0.3rem;
}
.mok-sq.up { background: rgba(30,143,99,.14); color: ${C.emerald}; }
.mok-sq.down { background: rgba(205,75,58,.14); color: ${C.rose}; }
.mok-body { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
.mok-name { font-size: 0.86rem; font-weight: 600; }
.mok-name em { color: ${C.muted}; font-weight: 400; }
.mok-dest { color: ${C.muted}; font-family: 'JetBrains Mono', monospace; font-size: 0.7rem; margin-left: 0.4rem; }
.mok-blurb { color: ${C.muted}; font-size: 0.78rem; line-height: 1.4; }

/* ---- Online race common ---- */
/* These two OUTLIVED the pre-launch modal they were named for: the online-race
   screens and Hash Rush's start panel use them as their primary / secondary
   button. Kept under the old names rather than renamed, because the names are
   in six call sites and nothing about them is modal-specific. */
.gm-play-btn {
  width: 100%; margin-top: 1rem; padding: 0.8rem; border: none; border-radius: 12px;
  background: var(--accent, ${C.accent}); color: #fff; font-weight: 700; font-size: 1rem;
  cursor: pointer; font-family: 'Space Grotesk', sans-serif;
}
.gm-play-btn:disabled { opacity: 0.4; cursor: default; }
.gm-link-btn {
  background: none; border: none; color: ${C.muted}; cursor: pointer;
  margin-top: 0.6rem; text-decoration: underline; font-size: 0.82rem;
}
.gm-race-center { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.6rem; text-align: center; padding: 2rem 1rem; min-height: 50vh; }
.gm-race-title { font-size: 1.3rem; font-weight: 700; }
.gm-race-sub { font-size: 0.9rem; color: ${C.muted}; }
.gm-race-code { font-size: 0.85rem; color: ${C.text}; }
.gm-countdown { font-size: 4rem; font-weight: 800; color: ${C.accent}; font-family: 'JetBrains Mono', monospace; }
.gm-opp-chip { display: inline-block; margin: 0.4rem auto; padding: 0.35rem 0.7rem; background: ${C.bg}; border: 1px solid ${C.border}; border-radius: 999px; font-size: 0.82rem; }
.gm-race-scores { display: flex; gap: 1.5rem; margin: 0.6rem 0; }
.gm-race-scores > div { display: flex; flex-direction: column; gap: 0.2rem; }
.gm-race-scores span { font-size: 0.75rem; color: ${C.muted}; }
.gm-race-scores b { font-size: 1.6rem; font-family: 'JetBrains Mono', monospace; color: ${C.gold}; }
.snake-lb { display: flex; flex-direction: column; gap: 0.2rem; }

/* ---- Hash Rush ---- */
.hr-wrap { position: relative; width: 100%; height: 62vh; max-height: 560px; border-radius: 14px; overflow: hidden; background: linear-gradient(180deg, #0c1020, #131a30); border: 1px solid ${C.border}; }
.hr-canvas { display: block; width: 100%; height: 100%; touch-action: none; }
.hr-boost-badge { position: absolute; top: 0.6rem; left: 50%; transform: translateX(-50%); background: rgba(34,211,238,0.18); border: 1px solid #22d3ee; color: #67e8f9; padding: 0.25rem 0.7rem; border-radius: 999px; font-size: 0.8rem; font-weight: 700; }
.hr-overlay { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.6rem; background: rgba(8,10,18,0.6); text-align: center; padding: 1rem; }
.hr-overlay-title { font-size: 1.6rem; font-weight: 800; }
.hr-overlay-sub { font-size: 0.85rem; color: ${C.muted}; }

/* Jet Run (request #326) — the same self-shell canvas stage Hash Rush runs.
   The dark gradient backdrop is intrinsic arcade art, not chrome: the sky the
   jet flies through is drawn over it, and the rest of the palette applies to
   the chrome around it. No animation here, so no reduced-motion addition. */
.jr-wrap { position: relative; width: 100%; height: 62vh; max-height: 560px; border-radius: 14px; overflow: hidden; background: linear-gradient(180deg, #0c1020, #131a30); border: 1px solid ${C.border}; }
.jr-canvas { display: block; width: 100%; height: 100%; touch-action: none; }
.jr-overlay { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.6rem; background: rgba(8,10,18,0.6); text-align: center; padding: 1rem; }
.jr-overlay-title { font-size: 1.6rem; font-weight: 800; }
.jr-overlay-sub { font-size: 0.85rem; color: ${C.muted}; }

/* ---- Phase 6: shared card/tile engine + Lane A dailies ---- */
.p6-hint { color: ${C.muted}; font-size: 12px; text-align: center; margin-top: 14px; line-height: 1.5; }
.p6-banner {
  background: rgb(var(--c-gold-rgb) / 12%); border: 1px solid rgb(var(--c-gold-rgb) / 40%); color: ${C.gold};
  border-radius: 10px; padding: 8px 12px; font-size: 13px; text-align: center; margin: 0 0 10px;
}
/* #218 — banner tones. The base rule is brass (a notice); these three carry a
   verdict, so they borrow the palette's own semantic hues. The info tone is the
   neutral running-progress state, deliberately quieter than the base. */
.p6-banner.info {
  background: var(--c-well); border-color: ${C.border}; color: ${C.muted};
}
.p6-banner.warn {
  background: rgb(var(--c-gold-rgb) / 14%); border-color: rgb(var(--c-gold-rgb) / 45%); color: ${C.gold};
}
.p6-banner.err {
  background: rgb(var(--c-rose-rgb) / 14%); border-color: rgb(var(--c-rose-rgb) / 45%); color: ${C.rose};
}
.p6-banner.ok {
  background: rgb(var(--c-emerald-rgb) / 14%); border-color: rgb(var(--c-emerald-rgb) / 45%); color: ${C.emerald};
}

/* #170 — the Klondike board is a canvas now (cards are drawn, not DOM), so
   the column can afford to be wide: cards grow with it, capped in klLayout.
   Wave 1 gave Spider and Mahjong the same treatment: their fixed-pixel DOM
   boards (and the FitScale shrink that made phone tiles sub-fingertip) are
   gone; everything below the status bar is one sized-from-the-column canvas. */
.kl-game { max-width: 620px; margin: 0 auto; }
.kl-canvas, .sp-canvas, .mj-canvas { border-radius: 8px; }

.sp-game { max-width: 620px; margin: 0 auto; }

.mj-game { display: flex; flex-direction: column; }

/* Nonogram — canvas board (slice 5). The clue gutters are drawn inside the
   canvas so grid + clues scale together off one useFitBox measurement. */
.ng-game { display: flex; flex-direction: column; min-height: 0; flex: 1 1 auto; gap: 0.5rem; }
/* The status line is always rendered (its text changes, never its presence), so
   it reserves its own height and the board below it never shifts as the verdict
   changes. Two lines' worth: the longest tone wraps on a phone. */
.ng-status {
  min-height: 2.9em; display: flex; align-items: center; justify-content: center;
  line-height: 1.35; margin: 0;
}
.ng-status.err, .ng-status.ok { animation: ngStatusPop 260ms ease-out; }
@keyframes ngStatusPop {
  0% { transform: scale(0.97); opacity: 0.5; }
  100% { transform: scale(1); opacity: 1; }
}
.ng-boardbox {
  flex: 1 1 auto; min-height: 0; display: flex; align-items: center; justify-content: center;
}
.ng-canvas {
  border-radius: 8px; cursor: pointer;
  -webkit-tap-highlight-color: transparent; user-select: none; -webkit-user-select: none;
}

.mf-game { display: flex; flex-direction: column; min-height: 0; flex: 1 1 auto; gap: 0.5rem; }
.mf-game .status-bar { align-items: center; gap: 8px; }
/* Canvas board (slice 3). The wrapper is the measured box — useFitBox reads
   its rect and the canvas is sized to an exact multiple of the cell, so the
   9×9 field is always centred and never clipped. */
.mf-boardbox {
  flex: 1 1 auto; min-height: 0; display: flex; align-items: center; justify-content: center;
}
.mf-canvas {
  border-radius: 8px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  user-select: none; -webkit-user-select: none;
}

.an-game { max-width: 420px; margin: 0 auto; text-align: center; }
/* Slots + rack draw on one canvas; the box centers it. */
.an-boardbox {
  width: 100%; display: flex; align-items: center; justify-content: center;
  margin-bottom: 12px; touch-action: none;
}

.cp-game { display: flex; flex-direction: column; align-items: center; }
.cp-boardbox {
  flex: 1 1 auto; min-height: 0; min-width: 0;
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 10px;
}
.cp-canvas { border-radius: 6px; }

/* Drop Stack — real-time well + side panel (slice 6). The well is a canvas
   sized by useFitBox; Next/Hold sit beside it so everything fits one screen. */
.ds-boardbox {
  position: relative; flex: 1 1 auto; min-height: 0; min-width: 0;
  display: flex; align-items: center; justify-content: center;
}
.ds-canvas {
  border-radius: 8px; background: rgba(0,0,0,.03);
  -webkit-tap-highlight-color: transparent; user-select: none; -webkit-user-select: none;
}
.ds-level-flash {
  position: absolute; left: 50%; top: 40%; transform: translate(-50%, -50%);
  font-size: 1.5rem; font-weight: 800; color: ${C.gold};
  text-shadow: 0 2px 10px rgba(0,0,0,.35); pointer-events: none;
  animation: ds-flash .9s ease forwards;
}
@keyframes ds-flash {
  0% { opacity: 0; transform: translate(-50%, -30%) scale(.8); }
  25% { opacity: 1; transform: translate(-50%, -50%) scale(1.1); }
  100% { opacity: 0; transform: translate(-50%, -70%) scale(1); }
}


/* ---- Phase 7: GotD hero, home reorg, chat ---- */
/* The hero icon sits on a rounded tile in the game's own tint (NYT-Games
   style), not as a bare emoji. --accent-tint is set inline on the hero. */
/* Review round 1 — loading skeleton: holds the hero's footprint while
   /api/daily is in flight so the grid doesn't jump when the panel arrives.
   Fallback is var(--c-well) and not the C.well token: well is DERIVED, so
   interpolating it here would emit a broken declaration. */
/* Review round 1 — error notice: what a 5xx leaves where the hero would sit,
   in the same card style (.gotd-hero carries the card chrome). The retry
   button reuses .primary-btn; only its inline sizing is adjusted. */

/* Phase 8 — anonymous play + "make it count" */
.guest-cta {
  border: 1px solid ${ca('accent','66')}; background: rgb(var(--c-accent-rgb) / 8%);
  border-radius: 12px; padding: 12px 14px; margin-bottom: 0.9rem; text-align: left;
}
.guest-rank { font-size: 15px; margin-bottom: 6px; }
.guest-rank strong { color: ${C.gold}; }
.guest-note { color: ${C.muted}; font-size: 12.5px; line-height: 1.5; }
.guest-note strong { color: ${C.text}; }
.commit-notice {
  border: 1px solid ${ca('emerald','66')}; background: rgb(var(--c-emerald-rgb) / 9%); color: ${C.text};
  border-radius: 12px; padding: 10px 14px; margin-bottom: 1rem; font-size: 13.5px;
  cursor: pointer;
}

/* "New this week" strip + What's-new sheet (weekly changelog) */
.wn-panel { height: min(64vh, 560px); }
.wn-list { gap: 16px; }
.wn-week-title {
  font-family: 'Fraunces', Georgia, serif; font-weight: 700; font-size: 14.5px;
  border-bottom: 1px solid ${C.border}; padding-bottom: 4px; margin-bottom: 6px;
}
.wn-items { margin: 0; padding-left: 1.15rem; display: flex; flex-direction: column; gap: 5px; }
.wn-items li { font-size: 13px; line-height: 1.5; color: ${C.text}; }
/* The count in a section header sits at the right edge (Poki/CrazyGames
   column-rule style). Headers without a count keep just the title. */
.home-back-btn {
  background: none; border: none; color: ${C.accent}; font-family: inherit;
  font-size: 14px; font-weight: 600; cursor: pointer; padding: 0; margin-bottom: 0.8rem;
}
/* Recently Played tiles (Recent goal) reuse the inprog-card look, but as real
   buttons: strip the browser chrome back to the shared card surface. */

/* Daily checklist (#295): a horizontal scroller of one chip per daily game.
   Scrollbar is hidden on purpose — the cut-off chip at the right edge is the
   affordance — and snap keeps a partial chip from landing half-read. States
   follow the daily badge palette: emerald done, gold resume, plain todo. */

.chat-overlay {
  position: fixed; inset: 0; background: var(--c-scrim); z-index: 240;
  display: flex; align-items: flex-end; justify-content: center;
}
.chat-panel {
  background: ${C.surface}; border: 1px solid ${C.border}; border-bottom: none;
  border-radius: 18px 18px 0 0; width: 100%; max-width: 560px;
  height: min(72vh, 640px); display: flex; flex-direction: column;
  /* Bottom sheet: the inset lifts the whole panel (and the input row at its
     foot) clear of the home indicator. The input row adds the keyboard
     inset on top, from --un-kb-inset, which the native kit maintains. */
  padding-bottom: var(--pc-safe-bottom);
}
.chat-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px 10px; border-bottom: 1px solid ${C.border};
}
.chat-title { font-weight: 700; font-size: 15px; }
.chat-close {
  background: ${C.card}; border: 1px solid ${C.border}; color: ${C.muted};
  border-radius: 8px; width: 30px; height: 30px; cursor: pointer; font-size: 13px;
}
.chat-list { flex: 1; overflow-y: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 10px; }
.chat-empty { color: ${C.muted}; font-size: 13px; text-align: center; margin-top: 24px; }
.chat-msg { background: ${C.card}; border: 1px solid ${C.border}; border-radius: 10px; padding: 8px 10px; max-width: 88%; }
.chat-msg.mine { align-self: flex-end; border-color: ${ca('accent','55')}; background: rgb(var(--c-accent-rgb) / 8%); }
.chat-msg.hidden-msg { background: none; border-style: dashed; }
.chat-tombstone { color: ${C.dim}; font-size: 12px; }
.chat-msg-top { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; }
.chat-author { color: ${C.violet}; font-size: 12px; font-weight: 700; }
.chat-report {
  background: none; border: none; cursor: pointer; font-size: 11px; opacity: 0.35;
  margin-left: auto; padding: 0 2px;
}
.chat-report:hover { opacity: 1; }
.chat-body { font-size: 13.5px; line-height: 1.45; word-break: break-word; }
.chat-notice { color: ${C.gold}; font-size: 12px; text-align: center; padding: 4px 0; }
.chat-input-row {
  display: flex; gap: 8px; border-top: 1px solid ${C.border};
  padding: 10px 14px 14px;
  padding-bottom: calc(14px + var(--un-kb-inset, 0px));
}
.chat-input {
  flex: 1; background: ${C.card}; border: 1px solid ${C.border}; color: ${C.text};
  border-radius: 10px; padding: 10px 12px; font-family: inherit; font-size: 13.5px; outline: none;
}
.chat-input:focus { border-color: ${C.accent}; }
.chat-send {
  background: ${C.accent}; border: none; color: white; border-radius: 10px;
  padding: 0 18px; font-family: inherit; font-weight: 700; font-size: 13.5px; cursor: pointer;
}
.chat-send:disabled { opacity: 0.4; cursor: default; }
.chat-btn-inline {
  background: ${C.card}; border: 1px solid ${C.border}; color: ${C.text};
  border-radius: 10px; padding: 8px 12px; font-family: inherit; font-size: 13px;
  font-weight: 600; cursor: pointer;
}
.chat-btn-inline:hover { border-color: ${C.accent}; }

/* ============================================================
   Appendix A — "The Daily Page, Warmed" editorial layer.
   Serif masthead + datelines, newsprint rules, card-weight white
   surfaces with soft warm shadows, brass reserved for streaks /
   wins / medals. Pure restyle: later rules of equal-or-greater
   specificity re-skin the same markup — no layout changes.
   ============================================================ */
.serif { font-family: 'Fraunces', Georgia, 'Times New Roman', serif; }

/* Serif display type on the shell's headline moments. */
.nav-brand, .lobby-head h1, .pregame-card h2, .win-card h2, .locked-card h2, .howto-head h3, .chat-title {
  font-family: 'Fraunces', Georgia, 'Times New Roman', serif;
  letter-spacing: 0;
}
.nav-brand { font-weight: 700; }
.nav-brand .logo { color: ${C.gold}; }

/* Brass for streaks (spec: brass = streaks/wins/medals; green stays a
   live/success color elsewhere). */

/* ---- Home masthead: numbered edition + dateline over a double rule ---- */
/* #372 — the home streak line. Same brass as the nav streak stat and the
   card-streak pill (gold is this app's reserved streak colour); the ×N tag is
   the nav's own .mult-badge, reused rather than restyled. */

/* Section headers as newspaper column rules. The base rule lives in the
   Phase 7 block above (one declaration; the count rides at the right edge). */

/* Merged all-games grid (slice 2): the reset note, the filter chips and the
   per-card daily indicator that replaces the two section headings. */
.home-daily-note {
  color: ${C.muted}; font-size: 0.82rem; margin: 0.5rem 0 0.6rem;
}
/* #350 — the All Games search field, above the chips. The Friends screen's
   search input graduated into a class so the two copies of the same control
   cannot drift (19-social.jsx styles it inline). Tokens only, so it re-themes
   for free. It is a TEXT INPUT, so it is deliberately NOT in
   TAPPABLE_CLASSES: native long-press selection must keep working, and no
   touch-action/tap-highlight rule should be generated for it. font-size is a
   full 16px on purpose — under that, focusing the field auto-zooms the page
   on iOS, and this is exactly the control a phone user will focus. */
.home-search-input {
  display: block; width: 100%; padding: 0.7rem 0.9rem; margin: 0 0 0.7rem;
  background: ${C.card}; border: 1px solid ${C.border}; border-radius: 10px;
  color: ${C.text}; font-family: inherit; font-size: 16px; outline: none;
}
.home-search-input:focus { border-color: ${C.accent}; }
.home-search-input::placeholder { color: ${C.dim}; }
/* The search's own empty state. Same register as .home-pin-empty and
   .home-fav-empty above — one muted line, no box, no icon. */
.home-search-empty {
  color: ${C.muted}; font-size: 0.78rem; margin: -0.35rem 0 0.7rem;
}
.home-filter-chips { display: flex; gap: 0.45rem; margin-bottom: 0.6rem; flex-wrap: wrap; }
.home-chip {
  background: ${C.card}; border: 1px solid ${C.border}; border-radius: 999px;
  padding: 0.35rem 0.95rem; font-family: inherit; font-size: 0.82rem; font-weight: 600;
  color: ${C.muted}; cursor: pointer; touch-action: manipulation;
}
.home-chip.on { border-color: ${C.accent}; color: ${C.accent}; background: ${ca('accent','1a')}; }
/* The pin control (#232). It sits in the card's top-right corner, which the
   daily badge already used, so the badge's right offset below clears it
   unconditionally rather than only on cards that render a pin, so a daily and
   a classic card line their badges up the same way. 44px square is the touch
   minimum; the glyph inside it is small, so the padding does the work. */

/* The favorite star. Same 44px touch square and corner placement as .card-pin,
   but stacked BELOW it so the two controls never collide, and clear of the
   daily badge (which .card-pin already pushed left). The unfilled star is a
   bare outline at the pin's resting opacity; the filled one is unfiltered and
   fully opaque, which is the whole "filled vs empty" read. */

/* The Pinned section's heading and the two lines that explain it. */
.home-pinned-title { display: flex; align-items: baseline; gap: 0.5rem; }
.home-pin-count {
  font-family: 'JetBrains Mono', monospace; font-size: 0.7rem; font-weight: 600;
  color: ${C.muted}; letter-spacing: 0.05em;
}
.home-pin-tip { color: ${C.muted}; font-size: 0.78rem; margin: 0 0 0.9rem; }
/* #226 — the Daily chip's completed / still-to-play split. Same column-rule
   heading as every other home section, so the grid reads as one page with two
   headings rather than two grids. The finished cards are dimmed a little, not
   collapsed: they still carry today's score and the tap that reviews the
   board, so hiding them would lose the thing you'd go looking for. */
.home-pin-full {
  color: ${C.rose}; font-size: 0.78rem; margin: 0 0 0.6rem; font-weight: 600;
}
/* #234 — the pin hint teaches a real feature, so it stays; it just stops
   being a boxed 58px banner between the filter chips and the first game. One
   muted line, in the same register as the chips it follows. */
/* The Favorites chip's empty state. Same register as .home-pin-empty above. */
.home-fav-empty {
  color: ${C.muted}; font-size: 0.78rem; margin: -0.35rem 0 0.7rem;
}

/* #313 — the per-card streak pill. It sits in the state footer beside the tag,
   reads the same brass the nav streak stat uses (gold is this app's reserved
   streak colour), and is deliberately a pill not a badge: it is status, not
   state, so it stays visible on played, resumed and fresh cards alike. */
/* #362 — the "best N" figure rides in the same pill: same gold and dimmed
   style as .cs-days, and nowrap so the label never breaks mid-pill. */

/* The footer row that carries the tag and (when the card has a daily) the
   streak pill. align-items: baseline keeps the two pill shapes on one line
   whatever the flame glyph does to the pill's inner baseline. */

/* Card-weight white surfaces: soft warm shadow at rest, lift on hover. */
.pregame-card, .win-card, .locked-card, .lboard, .howto-card {
  box-shadow: 0 1px 2px var(--c-shadow-sm), 0 6px 18px var(--c-shadow-sm);
}
.win-card, .howto-card { box-shadow: 0 20px 50px var(--c-shadow-lg); }

/* GotD hero reads as the front-page lead story: washed in the featured
   game's colour over the card surface (--accent-wash is set inline). */
/* GotD description stays serif but upright — the masthead tagline is the
   home screen's single italic moment. */

/* Per-game chrome picks up the game's accent (set as --accent inline on
   the lobby card, hero, and modal): accent Play buttons + tag pills. */
.pregame-card .pregame-play {
  background: var(--accent, ${C.accent});
}
.pregame-card .pregame-play:hover {
  background: var(--accent, ${C.accent}); filter: brightness(0.88);
}
/* Dark look: the raw game colour is tuned for the light card, where its
   white label falls below AA (sky measured 3.81:1 — review round 1). The
   deepened fill (--accent-deep, set inline by GotdHero) restores 4.5:1.
   Scoped to the hero button; the pre-game screen is untouched. */
.pregame-card { border-top: 3px solid var(--accent, ${C.accent}); }

/* Buttons: crisp editorial edges. */
.primary-btn { box-shadow: 0 1px 2px var(--c-shadow-md); }

/* Wins are brass moments. */
.win-card .trophy { filter: none; }
.win-card h2 { color: ${C.text}; }
.score-row.total .v { color: ${C.gold}; }

/* AppErrorBoundary fallback (#150). The stylesheet is mounted OUTSIDE the
   boundary precisely so this panel can be styled when App's tree is gone. */
.err-fallback {
  max-width: 420px; margin: 4rem auto; padding: 2rem 1.5rem;
  text-align: center; background: ${C.card};
  border: 1px solid ${C.border}; border-radius: 16px;
  box-shadow: 0 2px 10px var(--c-shadow-md);
}
.err-fallback .err-icon { font-size: 2.4rem; margin-bottom: 0.6rem; }
.err-fallback h2 { margin: 0 0 0.6rem; font-size: 1.2rem; }
.err-fallback p {
  color: ${C.muted}; font-size: 0.9rem; line-height: 1.5; margin: 0 0 1.4rem;
}

/* #176 — arcade run history rows on the pre-game screen. */
/* A growing list gets its own scroll strip rather than stretching the card —
   the same rule .wspr-found / .an-solved / .word-list follow. 25 runs would
   otherwise push the Play button several screens down. */
.arun-list {
  margin-top: .75rem; display: flex; flex-direction: column; gap: .35rem;
  max-height: 12.5rem; overflow-y: auto; padding-right: .15rem;
}
.arun-empty { margin-top: .75rem; font-size: .8rem; color: ${C.muted}; text-align: center; }
.arun-row {
  display: flex; align-items: center; gap: .45rem;
  padding: .4rem .5rem; border-radius: 10px;
  background: var(--c-well); font-size: .8rem;
}
.arun-band {
  flex: 0 0 auto; padding: .1rem .4rem; border-radius: 6px;
  font-size: .68rem; font-weight: 700; text-transform: uppercase; letter-spacing: .03em;
  background: ${ca('accent', '24')}; color: ${C.accent};
}
.arun-band.easy   { background: ${ca('emerald', '24')}; color: ${C.emerald}; }
.arun-band.hard   { background: ${ca('rose', '24')};    color: ${C.rose}; }
.arun-score { flex: 0 0 auto; font-weight: 700; color: ${C.text}; }
.arun-when  { flex: 1 1 auto; color: ${C.muted}; font-size: .72rem; }
.arun-btn {
  flex: 0 0 auto; border: 1px solid ${C.border}; background: ${C.card};
  color: ${C.text}; border-radius: 8px; padding: .25rem .45rem;
  font: inherit; font-size: .72rem; cursor: pointer;
}
.arun-btn[data-pressed] { background: var(--c-well-strong); }

/* #176 — story / arcade result block on the win card. */
.mode-result {
  margin: .5rem 0 .2rem; padding: .55rem .7rem; border-radius: 12px;
  background: var(--c-well); text-align: left;
}
.mode-result-title { font-weight: 700; font-size: .86rem; color: ${C.text}; }
.mode-result-note { margin-top: .2rem; font-size: .78rem; color: ${C.muted}; line-height: 1.35; }

/* Opponent screen — the two-line "what is this game" brief above the picker. */
.opp-brief {
  width: 100%; margin: .15rem 0 .35rem;
  display: flex; flex-direction: column; gap: .4rem;
  padding: .6rem .7rem; border-radius: 12px; background: var(--c-well);
  text-align: left; font-size: .8rem; line-height: 1.4; color: ${C.muted};
}
.opp-brief-row { display: flex; gap: .5rem; align-items: baseline; }
.opp-brief-row b { color: ${C.text}; font-weight: 600; }
.opp-brief-n {
  flex: 0 0 auto; width: 1.1rem; height: 1.1rem; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: ${ca('accent', '24')}; color: ${C.accent};
  font-size: .62rem; font-weight: 700;
}
.opp-lb { margin-top: 1.1rem; border-top: 1px solid ${C.border}; padding-top: 0.8rem; }
.mnc-ranked-pill {
  margin-left: .4rem; font-size: .68rem; font-weight: 700; vertical-align: middle;
  padding: .1rem .4rem; border-radius: 999px;
  background: ${ca('gold', '33')}; color: ${C.gold}; border: 1px solid ${ca('gold', '55')};
}

/* ============================================================
   Escape from Dracula — the paged reader (TextPager)
   ============================================================
   A chapter longer than the page is a measured layout, not a scroll and not a
   line-clamp: .tp-page is the box the pager measures (useFitBox), the prose is
   chunked to it, and only one page is in the DOM at a time. The card is the
   howto-card look, sized to the viewport so the measured box is real at any
   phone height. */
.drac-card {
  width: 100%; max-width: min(560px, 100%);
  height: 100%; min-height: 0; max-height: 680px;
  display: flex; flex-direction: column;
  background: ${C.card}; border: 1px solid ${C.border}; border-radius: 16px;
  overflow: hidden;
}
.drac-head { flex: 0 0 auto; padding: 1rem 1.3rem 0; }
.drac-kicker {
  font-size: 0.68rem; letter-spacing: 0.16em; text-transform: uppercase;
  color: ${C.muted};
}
.drac-title { margin: 0.15rem 0 0; font-size: 1.15rem; font-weight: 700; }

.tp-root { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; }
/* THE MEASURED BOX. overflow:hidden is the "nothing scrolls off screen" rule
   made structural: even if a block overshoots by a pixel, it cannot scroll. */
.tp-page {
  flex: 1 1 auto; min-height: 0; overflow: hidden;
  padding: 0.85rem 1.3rem 0;
  font-size: 0.94rem; line-height: 1.55; color: ${C.text};
  outline: none;
}
.tp-page.tp-tappable { cursor: pointer; }
.tp-page:focus-visible { box-shadow: inset 0 0 0 2px ${C.accent}; border-radius: 12px; }
.tp-page > .tp-text:first-child { margin-top: 0; }
.tp-text { margin: 0.7rem 0 0; }
.tp-foot { flex: 0 0 auto; padding: 0.4rem 1.3rem 1rem; }
.tp-dots { display: flex; gap: 6px; justify-content: center; margin-bottom: 0.4rem; }
.tp-dots i { width: 6px; height: 6px; border-radius: 50%; background: ${C.border}; display: block; }
.tp-dots i.on { background: ${C.accent}; }
/* The quiet reveal control, the same register as the result card's .win-more. */
.tp-more {
  width: 100%; margin: 0; background: none; border: none;
  color: ${C.muted}; font-family: inherit; font-size: 0.86rem; font-weight: 600;
  padding: 0.55rem; border-radius: 10px; text-align: center; cursor: pointer;
}
.tp-more:hover { color: ${C.text}; background: var(--c-well); }
.tp-more[data-pressed] { background: var(--c-well-strong); }
.tp-end { text-align: center; font-size: 0.8rem; color: ${C.muted}; padding: 0.4rem 0; }

/* #323 — games deserve more of a desktop window. Same rules as above, with
   the caps raised at >= 900px wide; the min-height clause keeps this block
   from overlapping the landscape/short-window --cg-board override, which
   still wins on a phone held sideways. Boards and canvases already size
   from their measured box (aspect-ratio DOM boards, useFitBox), so raising
   the caps is all that is needed; phones and tablets are unchanged, and the
   lobby grid, profile and friends screens keep their width on purpose.
   Daily Cipher is left out: its grid and keyboard sizes are fixed in the
   game's own drawing code, so a wider box would only add empty space. */
@media (min-width: 900px) and (min-height: 600px) {
  .game-wrap { max-width: 880px; }
  .kl-game, .sp-game { max-width: 880px; }
  .cg-shell { --cg-board: min(94vw, calc(100dvh - var(--cg-chrome) - 5.5rem - var(--pc-safe-top) - var(--pc-safe-bottom)), 760px); }
  .sudoku { max-width: 540px; }
  .wordsearch { max-width: 620px; }
  .wspr-grid { max-width: 480px; }
  .dsnk-board { max-width: 520px; }
  .tm-wrap.fit-col { max-width: 760px; }
  .ms-boardbox { width: min(92vw, 540px, var(--cg-board, 540px)); }
  .kt-boardbox { width: min(92vw, 680px, var(--cg-board, 680px)); }
  /* --brg-cap is set inline by BrgBoardBox, so scale it rather than override it. */
  .brg-canvas-box { width: min(92vw, calc(var(--brg-cap, 380px) * 1.4), var(--cg-board, 532px)); }
  .cg-stage .ms-boardbox, .cg-stage .t2048-board-wrap { max-width: min(540px, var(--cg-board)) !important; }
  .cg-stage .mnc-board { max-width: min(680px, var(--cg-board)) !important; }
  .cg-stage .cnl-board-wrap { max-width: min(680px, var(--cg-board)) !important; }
}
/* ============================================================
   The flip-deck lobby — felt, in BOTH themes
   ============================================================
   The lobby's home is a card table: deep green felt, brass accents, cards in
   cream. Like a game board it does not follow light/dark, so its colours are
   fixed here (as .fd-lobby / .fd-ov custom properties) rather than read
   from C. Every screen past the lobby keeps the theme. Fonts: DM Serif Display
   for headings and card names, Plus Jakarta Sans for the rest. */
html.felt-page, html.felt-page body { background: #0F4A36; }
html.felt-page body {
  background-image:
    radial-gradient(ellipse 80% 520px at 50% 0, #17644A, transparent),
    radial-gradient(rgba(255,255,255,0.035) 1px, transparent 1.4px),
    radial-gradient(rgba(0,0,0,0.13) 1px, transparent 1.4px);
  background-size: 100% 100%, 3px 3px, 5px 5px;
  background-position: 0 0, 0 0, 1px 2px;
}
.nav.felt { background: #0A3326; border-bottom-color: rgba(255,255,255,0.10); color: #F3EBD8; }
.nav .logo svg { display: block; }
.nav.felt .brandword {
  font-family: 'DM Serif Display', Georgia, serif; font-weight: 400; font-size: 1.32rem;
  letter-spacing: 0; color: #F3EBD8;
}
.nav.felt .account-chip, .nav.felt .account-chip.on {
  background: transparent; border-color: transparent; padding: 0; color: #F3EBD8;
}
.nav.felt .account-chip .avatar {
  width: 36px; height: 36px; font-size: 15px; font-weight: 800;
  background: #FBF6EA; color: #1C1A17; box-shadow: 0 0 0 2px #D9B35E;
}
.nav.felt .account-chip.off { border-color: rgba(242,160,145,0.6); padding: 0.25rem 0.6rem; }
.nav.felt .account-chip.off .who { color: #F2A091; }
.nav.felt .nav-settings-btn { color: #F3EBD8; border-color: rgba(255,255,255,0.10); background: rgba(255,255,255,0.06); }

.lobby.fd-lobby {
  --felt: #0F4A36; --felt-deep: #0A3326; --felt-lite: #17644A; --muted: #A8C3B4; --ivory: #F3EBD8;
  --line: rgba(255,255,255,0.10); --brass: #D9B35E; --brass-hi: #E8C677; --brass-ink: #2A1E05;
  --stock: #FBF6EA; --ink: #1C1A17;
  max-width: 1264px; display: flex; flex-direction: column; gap: 32px;
  padding: 18px calc(16px + var(--pc-safe-right)) 40px calc(16px + var(--pc-safe-left));
  color: var(--ivory); font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
}
.fd-lobby .commit-notice { margin: 0; }
.fd-ic { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

/* ---- The card ---- */
.fd-scene { position: absolute; inset: 0; display: block; overflow: hidden; container-type: inline-size; }
.fd-scene::after {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.16), inset 0 -40px 40px -36px rgba(0,0,0,0.3);
}
.fd-bit { position: absolute; display: grid; place-items: center; line-height: 1; white-space: nowrap; }
.fd-cardbtn {
  display: flex; flex-direction: column; align-items: stretch; min-width: 0;
  background: none; border: 0; padding: 0; margin: 0; text-align: left;
  font-family: inherit; color: var(--ivory, #F3EBD8); cursor: pointer;
}
.fd-card {
  position: relative; display: block; width: 100%; aspect-ratio: 9 / 14;
  container-type: inline-size; border-radius: 6% / 3.857%; overflow: hidden;
  background: #FBF6EA; color: #1C1A17;
  box-shadow: 0 1px 0 rgba(0,0,0,0.3), 0 12px 26px rgba(0,0,0,0.36);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
/* Press feedback on finger-DOWN (the tap primitive's data-pressed), and a lift
   only where there is a pointer that hovers. */
.fd-cardbtn[data-pressed] .fd-card { transform: translateY(2px) scale(0.98); }
@media (hover: hover) {
  .fd-cardbtn:hover .fd-card { transform: translateY(-6px) rotate(-1.2deg); box-shadow: 0 1px 0 rgba(0,0,0,0.3), 0 20px 36px rgba(0,0,0,0.45); }
}
.fd-cardbtn:focus-visible { outline: none; }
.fd-cardbtn:focus-visible .fd-card { outline: 2px solid #D9B35E; outline-offset: 3px; }
.fd-cardbtn.live .fd-card { box-shadow: 0 0 0 2px #D9B35E, 0 12px 26px rgba(0,0,0,0.36); }
.fd-in {
  position: absolute; inset: 0; display: flex; flex-direction: column; align-items: stretch; justify-content: center;
  padding: 13cqw 8cqw 14cqw; border: 1.4cqw solid; border-radius: inherit;
}
.fd-corner {
  position: absolute; top: 5.5cqw; left: 5.5cqw; display: flex; align-items: center; gap: 1.6cqw;
  font-family: 'Plus Jakarta Sans', system-ui, sans-serif; font-size: 5.6cqw; font-weight: 800;
  letter-spacing: 0.12em; text-transform: uppercase; white-space: nowrap; line-height: 1;
}
.fd-corner svg { width: 6cqw; height: 6cqw; flex: 0 0 auto; }
.fd-name {
  flex: 0 0 auto; min-height: 25cqw; display: flex; align-items: center; justify-content: center;
  padding: 2cqw 1cqw; text-align: center;
  font-family: 'DM Serif Display', Georgia, serif; font-weight: 400; font-size: 12cqw; line-height: 1.02; color: #1C1A17;
}
.fd-art {
  position: relative; display: block; flex: 0 0 auto; width: 100%; aspect-ratio: 1; margin-top: 3cqw;
  overflow: hidden; border-radius: 2.6cqw;
  box-shadow: 0 0 0 0.6cqw rgba(28,26,23,0.85), 0 1.4cqw 2.4cqw rgba(0,0,0,0.25);
}
/* The 3:2 scene, cover-cropped into the square window. */
.fd-art .fd-scene { inset: auto; top: 0; left: 50%; height: 100%; aspect-ratio: 3 / 2; transform: translateX(-50%); }
.fd-modes { position: absolute; right: 5.5cqw; bottom: 5.2cqw; display: flex; align-items: center; gap: 2.6cqw; }
.fd-mi { position: relative; display: inline-grid; }
.fd-mi svg { width: 6.4cqw; height: 6.4cqw; }
/* Today's daily on the Daily icon: a brass check once played, a dot while in progress. */
.fd-mi.done::after {
  content: '✓'; position: absolute; right: -2.2cqw; top: -2.4cqw; width: 4.8cqw; height: 4.8cqw;
  border-radius: 50%; background: #D9B35E; color: #2A1E05; font-size: 3.4cqw; font-weight: 800;
  display: grid; place-items: center; line-height: 1;
}
.fd-mi.live::after {
  content: ''; position: absolute; right: -1.2cqw; top: -1.2cqw; width: 3.2cqw; height: 3.2cqw;
  border-radius: 50%; background: #D9B35E; box-shadow: 0 0 0 0.6cqw #FBF6EA;
}
/* A phone-sized card keeps only the pip in its corner, and bigger icons. */
@container (max-width: 170px) {
  .fd-corner .fd-lbl { display: none; }
  .fd-corner svg { width: 8.5cqw; height: 8.5cqw; }
  .fd-mi svg { width: 8cqw; height: 8cqw; }
  .fd-modes { gap: 2.8cqw; }
}
.fd-sub { margin-top: 10px; font-size: 12.5px; line-height: 1.3; color: var(--muted, #A8C3B4); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fd-sub.go { color: #D9B35E; font-weight: 700; }
.fd-sub2 { margin-top: 2px; font-size: 12px; line-height: 1.3; color: var(--muted, #A8C3B4); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fd-sub2.warn { color: #F2A091; font-weight: 700; }

/* ---- Game of the day ---- */
.fd-hero {
  position: relative; border-radius: 24px; padding: 16px 18px 18px;
  background: radial-gradient(ellipse 90% 85% at 25% 15%, var(--felt-lite), var(--felt) 72%);
  box-shadow: inset 0 0 0 1px rgba(217,179,94,0.42), 0 20px 40px rgba(0,0,0,0.25);
}
.fd-hero::before { content: ''; position: absolute; inset: 7px; border: 1px solid rgba(217,179,94,0.22); border-radius: 18px; pointer-events: none; }
.fd-hero-in {
  position: relative; display: grid; grid-template-columns: 118px minmax(0, 1fr);
  grid-template-areas: "top top" "card info" "btn btn"; gap: 16px 20px; align-items: center;
}
.fd-hero-top {
  grid-area: top; display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 2px 2px 0;
  font-size: 11.5px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; color: var(--brass);
}
.fd-hero-top .fd-cd { color: var(--ivory); letter-spacing: 0.06em; font-variant-numeric: tabular-nums; }
.fd-hero-cardwrap { grid-area: card; padding: 4px 0 8px 4px; }
.fd-hero-cardwrap .fd-cardbtn { width: 100%; }
.fd-hero-cardwrap .fd-card { transform: rotate(-4deg); }
.fd-hero-info { grid-area: info; min-width: 0; }
.fd-hero-name { font-family: 'DM Serif Display', Georgia, serif; font-weight: 400; font-size: 28px; line-height: 1.05; color: var(--ivory); letter-spacing: 0; }
.fd-hero-desc { font-size: 14px; line-height: 1.45; color: var(--ivory); opacity: 0.88; margin-top: 8px; }
.fd-hero-meta { font-size: 12.5px; line-height: 1.4; color: var(--muted); margin-top: 8px; }
.fd-hero-guest { font-size: 12.5px; line-height: 1.4; color: var(--brass); margin-top: 8px; }
.fd-btn {
  display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; min-height: 50px; padding: 0 20px;
  border-radius: 999px; border: 0; background: #D9B35E; color: #2A1E05;
  font-family: inherit; font-weight: 800; font-size: 16px; cursor: pointer;
  box-shadow: 0 2px 0 #9C7A2E, 0 10px 22px rgba(0,0,0,0.28);
}
.fd-btn[data-pressed] { background: #C9A24D; box-shadow: 0 1px 0 #9C7A2E, 0 6px 14px rgba(0,0,0,0.28); }
@media (hover: hover) { .fd-btn:hover { background: #E8C677; } }
.fd-hero-btn { grid-area: btn; }
.fd-hero-skel { display: flex; align-items: center; gap: 20px; min-height: 230px; }
.fd-skel-card { flex: 0 0 auto; width: 118px; aspect-ratio: 9 / 14; border-radius: 10px; background: rgba(255,255,255,0.06); }
.fd-skel-info { flex: 1; display: flex; flex-direction: column; gap: 10px; }
.fd-skel-bar { height: 14px; border-radius: 7px; background: rgba(255,255,255,0.06); }
.fd-skel-bar.w1 { width: 40%; } .fd-skel-bar.w2 { width: 85%; } .fd-skel-bar.w3 { width: 60%; }
.fd-hero-err { display: flex; flex-direction: column; align-items: flex-start; gap: 14px; }
.fd-err-line { color: var(--ivory); font-size: 15px; }
.fd-hero-err .fd-btn { width: auto; }

/* ---- Today: the streak and the day's points ---- */
.fd-today {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-bottom: -8px;
  border-radius: 16px; overflow: hidden; background: rgba(0,0,0,0.2); box-shadow: inset 0 0 0 1px var(--line);
}
.fd-stat { display: flex; flex-direction: column; gap: 3px; min-width: 0; padding: 12px 14px 15px; }
.fd-stat + .fd-stat { border-left: 1px solid var(--line); }
.fd-num {
  display: flex; align-items: center; gap: 6px; white-space: nowrap;
  font-family: 'DM Serif Display', Georgia, serif; font-size: 24px; line-height: 1.1; color: var(--ivory); font-variant-numeric: tabular-nums;
}
.fd-num svg { width: 18px; height: 18px; flex: 0 0 auto; }
.fd-num .fd-ic { color: var(--brass); }
.fd-lbl2 { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ---- Sections and rows ---- */
.fd-sec-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.fd-sec-head h2 {
  font-family: 'DM Serif Display', Georgia, serif; font-weight: 400; font-size: 24px; line-height: 1.15;
  color: var(--ivory); letter-spacing: 0; margin: 0;
}
.fd-sec-head h2.minor { font-size: 21px; }
.fd-sec-r { display: flex; align-items: center; gap: 14px; }
.fd-count {
  display: inline-flex; align-items: center; gap: 7px; height: 32px; padding: 0 13px 0 8px; align-self: center;
  border-radius: 999px; background: rgba(0,0,0,0.22); border: 1px solid var(--line);
  font-size: 13px; font-weight: 600; color: var(--muted); white-space: nowrap;
}
.fd-count b { color: var(--ivory); font-weight: 800; }
.fd-count svg { width: 18px; height: 18px; flex: 0 0 auto; }
.fd-ring-bg { fill: none; stroke: rgba(255,255,255,0.18); stroke-width: 2.5; }
.fd-ring-fg { fill: none; stroke: #D9B35E; stroke-width: 2.5; stroke-linecap: round; }
.fd-row-nav { display: none; gap: 8px; }
.fd-rn {
  width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; cursor: pointer;
  background: rgba(0,0,0,0.2); border: 1px solid var(--line); color: var(--ivory);
}
.fd-rn svg { width: 18px; height: 18px; }
@media (hover: hover) { .fd-rn:hover { border-color: var(--brass); color: var(--brass); } }
.fd-hint { font-size: 13px; color: var(--muted); }
.fd-row {
  display: flex; align-items: flex-start; gap: 14px; overflow-x: auto; overscroll-behavior-x: contain;
  scroll-snap-type: x mandatory; scrollbar-width: none; scroll-padding-inline: 16px;
  margin: 0 -16px; padding: 14px 16px 16px;
  -webkit-mask-image: linear-gradient(90deg, #000 90%, transparent); mask-image: linear-gradient(90deg, #000 90%, transparent);
}
.fd-row::-webkit-scrollbar { display: none; }
.fd-row > .fd-cardbtn { flex: 0 0 auto; width: 148px; scroll-snap-align: start; }
.fd-row.fd-matches > .fd-cardbtn { width: 122px; }

/* ---- All games: search, shelves ---- */
.fd-tools { display: flex; flex-direction: column; gap: 10px; }
.fd-lobby .home-search-input {
  height: 46px; margin: 0; padding: 0 14px 0 42px; border-radius: 14px; border: 1px solid var(--line);
  background: rgba(0,0,0,0.24) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23A8C3B4' stroke-width='2' stroke-linecap='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='M20 20l-3.5-3.5'/%3E%3C/svg%3E") no-repeat 14px center / 18px;
  color: var(--ivory);
}
.fd-lobby .home-search-input::placeholder { color: var(--muted); }
.fd-lobby .home-search-input:focus { border-color: var(--brass); }
.fd-lobby .home-filter-chips {
  flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; margin: 0 -16px; padding: 0 16px;
}
.fd-lobby .home-filter-chips::-webkit-scrollbar { display: none; }
.fd-lobby .home-chip {
  flex: 0 0 auto; display: inline-flex; align-items: center; gap: 7px; height: 40px; padding: 0 15px;
  border-radius: 999px; background: rgba(0,0,0,0.22); border: 1px solid var(--line); color: var(--ivory);
  font-family: inherit; font-size: 14px; font-weight: 700;
}
.fd-lobby .home-chip svg { width: 14px; height: 14px; }
.fd-lobby .home-chip .n { color: var(--muted); font-weight: 600; }
.fd-lobby .home-chip.on { background: var(--stock); border-color: var(--stock); color: var(--ink); }
.fd-lobby .home-chip.on .n { color: #5B5446; }
.fd-shelf-h { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 22px; }
.fd-shelf-h h3 {
  display: flex; align-items: center; gap: 9px; margin: 0;
  font-family: 'DM Serif Display', Georgia, serif; font-weight: 400; font-size: 21px; color: var(--ivory);
}
.fd-shelf-h h3 svg { width: 16px; height: 16px; color: var(--brass); }
.fd-lobby .fd-shelf-h .home-pin-count { margin: 0; font-family: inherit; font-size: 13px; color: var(--muted); }
.fd-link {
  background: none; border: 0; padding: 0 4px; min-height: 44px; cursor: pointer;
  color: var(--brass); font-family: inherit; font-size: 14px; font-weight: 700;
}
.fd-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(148px, 1fr)); gap: 24px 14px; padding-top: 14px; }
.fd-lobby .home-pin-full, .fd-lobby .home-fav-empty, .fd-lobby .home-search-empty {
  margin: 14px 0 0; color: var(--muted); font-size: 14px;
}

/* ---- The open card: it grows from its place and turns over ---- */
.fd-ov {
  --muted: rgba(251,246,234,0.74); --line: rgba(251,246,234,0.16); --ivory: #F3EBD8;
  --brass: #D9B35E; --brass-ink: #2A1E05; --stock: #FBF6EA; --ink: #1C1A17;
  position: fixed; inset: 0; z-index: 60; color: var(--ivory);
  font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
}
.fd-ov-scrim {
  position: absolute; inset: 0; display: block; width: 100%; height: 100%; border: 0; padding: 0;
  background: rgba(4,12,9,0.68); cursor: pointer; opacity: 1; transition: opacity 0.3s ease;
}
.fd-ph-from .fd-ov-scrim, .fd-ph-back .fd-ov-scrim, .fd-ph-fade .fd-ov-scrim { opacity: 0; }
.fd-fc { position: absolute; z-index: 1; perspective: 1800px; }
.fd-ph-open .fd-fc, .fd-ph-back .fd-fc {
  transition: left 0.62s cubic-bezier(0.3,0.7,0.2,1), top 0.62s cubic-bezier(0.3,0.7,0.2,1),
              width 0.62s cubic-bezier(0.3,0.7,0.2,1), height 0.62s cubic-bezier(0.3,0.7,0.2,1);
}
.fd-fc-flip { position: absolute; inset: 0; transform-style: preserve-3d; }
.fd-ph-open .fd-fc-flip, .fd-ph-back .fd-fc-flip { transition: transform 0.62s cubic-bezier(0.45,0.05,0.2,1); }
/* At rest the 3D is OFF (see DeckOpenCard): perspective and preserve-3d would
   each make this the containing block of every fixed sheet inside it. */
.fd-fc.flat { perspective: none; }
.fd-fc.flat .fd-fc-flip { transform-style: flat; }
.fd-fc-face { position: absolute; inset: 0; -webkit-backface-visibility: hidden; backface-visibility: hidden; }
.fd-fc-front { container-type: size; display: grid; place-items: center; pointer-events: none; }
.fd-fc-front .fd-card { width: min(100cqw, calc(100cqh * 9 / 14)); box-shadow: 0 1px 0 rgba(0,0,0,0.3), 0 26px 60px rgba(0,0,0,0.55); }
.fd-fc-back {
  transform: rotateY(180deg); overflow: hidden; border-radius: 28px; color: var(--ivory);
  background-image:
    linear-gradient(180deg, rgba(0,0,0,0), rgba(0,0,0,0.42)),
    repeating-linear-gradient(45deg, rgba(255,255,255,0.06) 0 1px, transparent 1px 11px),
    repeating-linear-gradient(-45deg, rgba(255,255,255,0.06) 0 1px, transparent 1px 11px);
  box-shadow: 0 30px 80px rgba(0,0,0,0.55);
}
.fd-fc.flat .fd-fc-back { transform: none; }
.fd-back-frame { position: absolute; inset: 8px; z-index: 1; border: 1px solid rgba(251,246,234,0.26); border-radius: 21px; pointer-events: none; }
.fd-back-scroll { position: absolute; inset: 0; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; }
.fd-back-scroll::-webkit-scrollbar { display: none; }
.fd-back-body { display: flex; flex-direction: column; gap: 16px; padding: 26px 22px 28px; }
.fd-ph-from .fd-back-body, .fd-ph-from .fd-back-x { opacity: 0; }
.fd-ph-open .fd-back-body, .fd-ph-open .fd-back-x { opacity: 1; transition: opacity 0.28s ease 0.42s; }
.fd-ph-back .fd-back-body, .fd-ph-back .fd-back-x { opacity: 0; transition: opacity 0.12s ease; }
.fd-ph-fade .fd-fc { opacity: 0; transition: opacity 0.2s ease; }
.fd-back-x {
  position: absolute; top: 36px; right: 32px; z-index: 3; width: 44px; height: 44px; border-radius: 50%;
  display: grid; place-items: center; cursor: pointer;
  background: rgba(20,14,10,0.5); border: 1px solid rgba(251,246,234,0.2); color: var(--ivory);
}
.fd-back-x svg { width: 18px; height: 18px; }
.fd-back-x[data-pressed] { background: rgba(20,14,10,0.7); }
.fd-head { display: flex; flex-direction: column; gap: 14px; }
.fd-thumb {
  position: relative; display: block; width: 100%; aspect-ratio: 2 / 1; overflow: hidden; border-radius: 14px;
  box-shadow: 0 0 0 2px rgba(251,246,234,0.92), 0 10px 22px rgba(0,0,0,0.3);
}
.fd-thumb .fd-scene { inset: auto; left: 0; top: 50%; width: 100%; aspect-ratio: 3 / 2; transform: translateY(-50%); }
.fd-titles { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.fd-kicker {
  display: flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 800;
  letter-spacing: 0.14em; text-transform: uppercase; color: rgba(251,246,234,0.8);
}
.fd-kicker svg { width: 13px; height: 13px; flex: 0 0 auto; }
.fd-pname { font-family: 'DM Serif Display', Georgia, serif; font-weight: 400; font-size: 30px; line-height: 1.05; color: var(--ivory); letter-spacing: 0; margin: 0; }
.fd-pstat { font-size: 13px; font-weight: 700; color: var(--brass); }
.fd-pdesc { font-size: 14.5px; line-height: 1.5; color: var(--ivory); opacity: 0.9; margin: 0; }
.fd-phowto { font-size: 13.5px; line-height: 1.45; color: var(--ivory); opacity: 0.78; margin: 0; }
.fd-phowto strong { font-weight: 700; opacity: 1; }
.fd-tabs { display: flex; gap: 4px; padding: 4px; border-radius: 14px; background: rgba(0,0,0,0.28); }
.fd-tab {
  flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 40px;
  border-radius: 10px; border: 0; background: transparent; color: var(--muted);
  font-family: inherit; font-weight: 800; font-size: 14px; cursor: pointer;
}
.fd-tab svg { width: 16px; height: 16px; }
.fd-tab.on { background: var(--stock); color: var(--ink); }
.fd-tab[data-pressed]:not(.on) { background: rgba(255,255,255,0.08); }
.fd-blurb { font-size: 13.5px; line-height: 1.45; color: var(--muted); margin: 0; }
.fd-nomodes, .fd-played-wrap { display: flex; flex-direction: column; gap: 14px; }
.fd-played {
  display: flex; align-items: center; gap: 14px; padding: 14px 16px; border-radius: 16px;
  background: rgba(217,179,94,0.14); box-shadow: inset 0 0 0 1px rgba(217,179,94,0.5);
}
.fd-played-ic { width: 40px; height: 40px; flex: 0 0 auto; border-radius: 50%; display: grid; place-items: center; background: #D9B35E; color: #2A1E05; font-weight: 800; font-size: 18px; }
.fd-played b { display: block; font-weight: 800; font-size: 16px; }
.fd-played span { display: block; font-size: 13px; color: var(--muted); margin-top: 2px; }
.fd-played .mono { display: inline; color: var(--ivory); }
.fd-duo, .fd-actions { display: flex; gap: 8px; }
.fd-actions { padding-top: 14px; border-top: 1px solid var(--line); }
.fd-ghost {
  flex: 1; min-height: 44px; padding: 0 10px; border-radius: 999px; cursor: pointer;
  background: transparent; border: 1px solid var(--line); color: var(--ivory);
  font-family: inherit; font-weight: 700; font-size: 13.5px;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
}
.fd-ghost.on { border-color: #D9B35E; color: #D9B35E; }
.fd-ghost:disabled { opacity: 0.45; cursor: not-allowed; }
.fd-ghost[data-pressed] { background: rgba(255,255,255,0.08); }
.fd-play { margin: 0; }

/* The pre-game panel on the card's back (PreGameScreen variant="deck"): the
   same controls, on felt. */
.pregame-card.deck {
  max-width: none; margin: 0; padding: 0; background: none; border: 0; border-radius: 0; text-align: left;
  color: var(--ivory); display: flex; flex-direction: column; gap: 14px;
}
.pregame-card.deck > * { margin-top: 0; margin-bottom: 0; }
.pregame-card.deck .pregame-chips { justify-content: flex-start; }
.pregame-card.deck .pregame-chip { background: rgba(0,0,0,0.22); border-color: var(--line); color: var(--muted); }
.pregame-card.deck .pregame-stats { justify-content: stretch; gap: 8px; }
.pregame-card.deck .pregame-stat { max-width: none; background: rgba(0,0,0,0.2); border-color: var(--line); text-align: left; padding: 10px 12px; }
.pregame-card.deck .pregame-stat .l { color: var(--muted); }
.pregame-card.deck .pregame-stat .v { color: var(--ivory); }
.pregame-card.deck .pregame-deal { background: rgba(0,0,0,0.18); border-color: var(--line); color: var(--ivory); }
.pregame-card.deck .pregame-bands { margin-top: 0; }
.pregame-card.deck .pregame-bands-label, .pregame-card.deck .pregame-band-note { color: var(--muted); }
.pregame-card.deck .pregame-band { background: rgba(0,0,0,0.2); border-color: var(--line); color: var(--ivory); }
.pregame-card.deck .pregame-band.on { background: rgba(217,179,94,0.16); border-color: #D9B35E; color: #D9B35E; }
.pregame-card.deck .pregame-band.done { color: #9BD6A8; border-color: rgba(155,214,168,0.45); }
.pregame-card.deck .pregame-band[data-pressed] { background: rgba(255,255,255,0.08); }
.pregame-bands.deck-rows { display: flex; flex-direction: column; gap: 8px; }
.pregame-band-opt {
  display: flex; align-items: center; gap: 12px; width: 100%; min-height: 58px; padding: 9px 14px;
  border-radius: 14px; background: rgba(0,0,0,0.18); border: 1px solid var(--line);
  color: var(--ivory); font-family: inherit; text-align: left; cursor: pointer;
}
.pregame-band-opt.on { border-color: #D9B35E; background: rgba(217,179,94,0.16); }
.pregame-band-opt:disabled { opacity: 0.45; cursor: not-allowed; }
.pregame-band-opt[data-pressed] { background: rgba(255,255,255,0.08); }
.pbo-radio { width: 20px; height: 20px; flex: 0 0 auto; border-radius: 50%; box-shadow: inset 0 0 0 2px rgba(251,246,234,0.6); }
.pregame-band-opt.on .pbo-radio { box-shadow: inset 0 0 0 6px #D9B35E; }
.pbo-txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pbo-t { font-weight: 800; font-size: 15px; }
.pbo-s { font-size: 12.5px; line-height: 1.35; color: var(--muted); }
.pbo-m { margin-left: auto; padding-left: 8px; font-weight: 800; font-size: 14px; color: #D9B35E; white-space: nowrap; }
.pregame-card.deck .pregame-resume-note { color: #D9B35E; }
.pregame-card.deck .pregame-play, .fd-nomodes .fd-play {
  min-height: 50px; border-radius: 999px; background: #D9B35E; color: #2A1E05; border: 0;
  font-family: inherit; font-weight: 800; font-size: 16px; box-shadow: 0 2px 0 #9C7A2E, 0 10px 22px rgba(0,0,0,0.28);
}
.pregame-card.deck .pregame-play[data-pressed], .fd-nomodes .fd-play[data-pressed] { background: #C9A24D; }
/* Play stays in reach: pinned to the foot of the card's back while the panel
   above it scrolls, and back in its place once you reach it. */
.pregame-card.deck .pregame-play { position: sticky; bottom: 14px; z-index: 2; }
.pregame-card.deck .pregame-practice { background: transparent; border: 1px solid var(--line); color: var(--ivory); border-radius: 999px; }
.pregame-card.deck .pregame-signedout { color: var(--muted); }
.pregame-card.deck .pregame-actions, .fd-nomodes .pregame-actions { margin-top: 0; }
.fd-ov .pregame-howto-btn { background: transparent; border-color: var(--line); color: var(--ivory); border-radius: 999px; font-size: 13px; }
@media (hover: hover) {
  .fd-ov .pregame-howto-btn:hover, .fd-ghost:hover { border-color: #D9B35E; color: #D9B35E; }
}

/* 700px is where the open card stops filling the phone (deckOpenGeometry):
   from there it is a big card, its picture a square beside the name. */
@media (min-width: 700px) {
  .fd-back-body { padding: 32px 30px 30px; }
  .fd-head { flex-direction: row; align-items: center; padding-right: 48px; }
  .fd-thumb { flex: 0 0 auto; width: 84px; height: 84px; aspect-ratio: auto; border-radius: 12px; }
  .fd-thumb .fd-scene { left: 50%; top: 0; width: auto; height: 100%; transform: translateX(-50%); }
  .fd-pname { font-size: 34px; }
  .fd-back-x { top: 16px; right: 16px; }
}

@media (min-width: 900px) {
  .lobby.fd-lobby { gap: 44px; padding: 32px calc(32px + var(--pc-safe-right)) 64px calc(32px + var(--pc-safe-left)); }
  .fd-sec-head h2 { font-size: 30px; }
  .fd-sec-head h2.minor { font-size: 24px; }
  .fd-hero { padding: 26px 30px 30px; }
  .fd-hero-in {
    grid-template-columns: 210px minmax(0, 1fr); grid-template-areas: "card top" "card info" "card btn";
    grid-template-rows: auto 1fr auto; column-gap: 44px; row-gap: 16px;
  }
  .fd-hero-cardwrap { padding: 10px 0 10px 10px; }
  .fd-hero-info { align-self: center; }
  .fd-hero-name { font-size: 46px; }
  .fd-hero-desc { font-size: 16px; }
  .fd-hero-btn { width: auto; justify-self: start; padding: 0 32px; }
  .fd-today { max-width: 520px; }
  .fd-stat { padding: 14px 20px 16px; }
  .fd-num { font-size: 28px; }
  .fd-row-nav { display: flex; }
  .fd-row { margin: 0 -8px; padding: 14px 8px 18px; scroll-padding-inline: 8px; }
  .fd-row > .fd-cardbtn { width: 176px; }
  .fd-row.fd-matches > .fd-cardbtn { width: 150px; }
  .fd-tools { flex-direction: row; align-items: center; justify-content: space-between; }
  .fd-lobby .home-search-input { width: 340px; order: 2; }
  .fd-lobby .home-filter-chips { margin: 0; padding: 0; }
  .fd-shelf-h { margin-top: 30px; }
  .fd-shelf-h h3 { font-size: 23px; }
  .fd-shelf-h .fd-link { display: none; }
  .fd-row.fd-shelf {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 28px 22px;
    overflow: visible; margin: 0; padding: 16px 0 0; -webkit-mask-image: none; mask-image: none;
  }
  .fd-row.fd-shelf > .fd-cardbtn { width: auto; }
  .fd-grid { grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 28px 22px; }
}

/* Settings → What's new (its way in since the lobby's "New this week" strip
   was retired). Themed like the rest of the sheet. */
.settings-whatsnew {
  display: flex; align-items: center; gap: 0.6rem; width: 100%; min-height: 48px; margin-top: 0.9rem;
  padding: 0.6rem 0.85rem; background: ${C.card}; border: 1px solid ${C.border}; border-radius: 12px;
  color: ${C.text}; font-family: inherit; font-size: 0.92rem; font-weight: 600; text-align: left; cursor: pointer;
}
.settings-whatsnew .sw-sub { margin-left: auto; color: ${C.muted}; font-size: 0.78rem; font-weight: 500; }
.settings-whatsnew .sw-go { color: ${C.muted}; font-size: 1.1rem; line-height: 1; }
.settings-whatsnew[data-pressed] { background: var(--c-well); }
/* A match card's second line names the opponent and the clock: two lines. */
.fd-matches .fd-sub2 { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
`;
