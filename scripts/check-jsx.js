#!/usr/bin/env node
// Pre-deploy guard: compile the concatenated frontend source with a SECOND
// toolchain (Babel's react preset, classic-script mode) so a syntax error is
// caught HERE — at `npm run check` / CI — and not only when the deployed
// bundle fails to parse, which takes the whole app down with a blank screen.
//
// It reads the same concatenation the real build does (scripts/build.js
// --print), so it sees exactly what ships, including file-ordering mistakes.
// Two independent parsers is the point: esbuild builds, Babel double-checks.
//
// This is a CHECK, not a build: it produces no output and does not change how
// the browser loads the app. Run it manually or in CI; it is intentionally
// NOT chained into `prestart` so a missing devDependency can never block boot.
const path = require('path');

const { execFileSync } = require('child_process');
const BUILD = path.join(__dirname, 'build.js');

let babel;
try {
  babel = require('@babel/core');
} catch (e) {
  console.error('[check] @babel/core is not installed. Run `npm install` (devDependencies) first.');
  process.exit(2);
}

let src;
try {
  src = execFileSync(process.execPath, [BUILD, '--print'], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
} catch (e) {
  console.error('[check] could not assemble public/src:', e.message);
  process.exit(2);
}

try {
  babel.transform(src, {
    presets: ['@babel/preset-react'],
    sourceType: 'script',
    configFile: false,
    babelrc: false,
    filename: 'app.concat.jsx',
    // Mirror the browser bootstrap (index.html): compact:true keeps Babel's
    // code generator off its "auto" path, so it never logs the
    // "deoptimised the styling ... exceeds the max of 500KB" note for a >500KB
    // bundle.
    compact: true,
    comments: false,
  });
  console.log('[check] public/src concatenation compiles cleanly ✓');
} catch (e) {
  console.error('[check] public/src FAILED to compile:\n' + (e.message || e));
  process.exit(1);
}
