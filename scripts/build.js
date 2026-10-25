#!/usr/bin/env node
/*
 * Frontend build: concatenate public/src/*.jsx in the order declared by
 * public/src/ORDER, then hand the result to esbuild's JSX transform.
 *
 * WHY CONCATENATION AND NOT ES MODULES
 * ------------------------------------
 * The app used to be one 26k-line public/app.jsx. Splitting it was overdue,
 * but converting it to real ES modules would have meant hand-resolving a
 * dependency graph over ~560 top-level declarations that all share one global
 * scope today — with import cycles almost guaranteed between the registry (it
 * names every game component) and the chrome (it reads the registry).
 *
 * Concatenating in a declared order keeps the EXACT semantics the app has
 * always had: one classic script, one global scope, definitions in the same
 * order as before. The split was therefore provably behaviour-preserving: at
 * the commit that performed it, this concatenation was byte-identical to the
 * old public/app.jsx and the compiled public/app.js did not change by a single
 * byte. Nothing about the app could have moved.
 *
 * The payoff is navigability, which is the thing that actually mattered: 32
 * files named after what they contain instead of one file nobody can hold in
 * their head.
 *
 * CONSEQUENCES WHEN EDITING
 * -------------------------
 *  - Still NO `import` / `export` in public/src/*.jsx. They are concatenated,
 *    not linked. Cross-file references work because everything shares one
 *    scope, exactly as before.
 *  - ORDER IS LOAD-BEARING. A `const` used at module-evaluation time (the css
 *    template reads the palette, the registry reads game components) must be
 *    declared in an earlier file. Function declarations hoist within their own
 *    file only after concatenation, so treat the order as real.
 *  - Adding a file means adding it to public/src/ORDER at the right position.
 */
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'public', 'src');
const OUT_JS = path.join(__dirname, '..', 'public', 'app.js');
const CONCAT = path.join(__dirname, '..', 'public', '.app.concat.jsx');

function readOrder() {
  const orderFile = path.join(SRC_DIR, 'ORDER');
  const names = fs.readFileSync(orderFile, 'utf8')
    .split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'));

  // Every .jsx in src must be listed, or a new file silently never ships.
  // ORDER entries may name files one subdirectory deep (e.g.
  // snakesladders-v2/03-game.jsx), so the drift check recurses one level.
  const onDisk = [];
  for (const ent of fs.readdirSync(SRC_DIR, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      for (const f of fs.readdirSync(path.join(SRC_DIR, ent.name))) {
        if (f.endsWith('.jsx')) onDisk.push(ent.name + '/' + f);
      }
    } else if (ent.name.endsWith('.jsx')) {
      onDisk.push(ent.name);
    }
  }
  onDisk.sort();
  const listed = new Set(names);
  const missing = onDisk.filter(f => !listed.has(f));
  if (missing.length) {
    console.error('[build] these files are in public/src but not in ORDER:\n  ' + missing.join('\n  '));
    process.exit(1);
  }
  for (const n of names) {
    if (!fs.existsSync(path.join(SRC_DIR, n))) {
      console.error('[build] ORDER lists a file that does not exist: ' + n);
      process.exit(1);
    }
  }
  return names;
}

function concat() {
  return readOrder()
    .map(n => fs.readFileSync(path.join(SRC_DIR, n), 'utf8'))
    .join('\n');
}

function build() {
  const source = concat();
  fs.writeFileSync(CONCAT, source);

  let esbuild;
  try {
    esbuild = require('esbuild');
  } catch (e) {
    console.error('[build] esbuild is not installed. Run `npm install` first.');
    process.exit(2);
  }

  const result = esbuild.buildSync({
    entryPoints: [CONCAT],
    outfile: OUT_JS,
    bundle: false,
    loader: { '.jsx': 'jsx' },
    logLevel: 'info',
  });
  fs.unlinkSync(CONCAT);
  if (result.errors && result.errors.length) process.exit(1);

  const kb = (fs.statSync(OUT_JS).size / 1024).toFixed(1);
  console.log(`[build] public/app.js  ${kb}kb  (${readOrder().length} source files)`);
}

// `node scripts/build.js --print` writes the concatenation to stdout instead of
// building — used by build:verify and by scripts/check-jsx.js.
if (process.argv.includes('--print')) process.stdout.write(concat());
else build();
