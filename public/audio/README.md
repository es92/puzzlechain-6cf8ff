# Audio assets

Background-music and other audio assets served statically from `/audio/…`
(via `express.static('public')` in `server.js`).

## `minesweeper-bg.mp3`

The looping background track for Minesweeper. It is loaded by the
`startBackgroundMusic()` audio manager in `public/app.jsx`, decoded with the
Web Audio API's `decodeAudioData`, and played on a `loop: true` buffer source.

**This committed file is a placeholder.** It is a small (~344 KB), royalty-free,
procedurally-generated ambient pad (a 4-chord progression that swells in and out
so it loops seamlessly). It can be swapped for a real, properly-mastered MP3 at
any time — drop a replacement at this same path and nothing in the code needs to
change.

## `bounce-bg.mp3`

The looping background track for Bounce. Same loader (`startBackgroundMusic()`)
and same constant-URL pattern as Minesweeper (`BOUNCE_MUSIC_URL` in
`public/app.jsx`), started on the first ball launch and paused/resumed via the
in-game audio panel.

**This committed file is also a placeholder.** It's a small (~344 KB),
royalty-free, procedurally-generated chiptune loop — a four-chord arpeggiated
lead over a steady bass pulse and an 8th-note percussion click, faster and
more energetic than the Minesweeper ambient pad to match Bounce's arcade feel.
It fades in/out at the loop boundary so it repeats seamlessly, and can be
swapped for a real, properly-mastered track at any time by replacing this
file.

Note: `decodeAudioData` decodes from the raw bytes, independent of the file
extension or HTTP `Content-Type`, so the loader works regardless of the exact
container of the asset placed here.
