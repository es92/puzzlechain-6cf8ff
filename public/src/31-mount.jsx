/* ============================================================
   Error boundary (#150) — never strand a player on a blank page.

   A throw during render in React 18 unmounts the ENTIRE root. Before this
   existed, one bad value in navState blanked the app with no way back except
   a browser reload. The boundary catches it and renders a small recovery
   panel instead; "Back to Home" strips deep-link params (so the param that
   caused it can't immediately re-trigger) and remounts App under a fresh key,
   which is the reset-to-lobby the spec asks for.

   The stylesheet is mounted as a SIBLING above this boundary, so the fallback
   is styled even though App's subtree is gone.
   ============================================================ */
class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null, resetKey: 0 };
  }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) {
    // Deliberately not env-gated: this must always reach the dev console.
    console.error('[app] render error caught by boundary:', err && err.message,
      info && info.componentStack ? String(info.componentStack).split('\n')[1] : '');
  }
  handleReset = () => {
    try {
      // Drop the query string — a deep-link param may be what threw.
      window.history.replaceState({}, '', window.location.pathname);
    } catch {}
    this.setState(s => ({ err: null, resetKey: s.resetKey + 1 }));
  };
  render() {
    if (this.state.err) {
      return (
        <div className="app">
          <div className="err-fallback">
            <div className="err-icon">⚠️</div>
            <h2>Something went wrong</h2>
            <p>That screen hit an unexpected error. Your streak and today's
              results are safe — nothing was lost.</p>
            <button className="primary-btn" onClick={this.handleReset}>Back to Home</button>
          </div>
        </div>
      );
    }
    return this.props.children(this.state.resetKey);
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.Fragment>
    <style>{css}</style>
    <AppErrorBoundary>{(k) => <App key={k} />}</AppErrorBoundary>
  </React.Fragment>
);
// Signal to the boot-shell watchdog (index.html) that React has mounted, so
// it clears the "taking longer than usual" timer and never flashes the card.
window.__puzzlechainMounted = true;

/* Load-time self-tests (mirrors the server's boot self-tests). Wrapped so a
   throw can never take the app down — a failure logs a console error, which
   trips the platform's no-console-errors check and blocks the merge. That is the
   point: every invariant these phases established is now enforced, not just
   documented.

   Scheduling matters: the touch-action sweep reads COMPUTED style, so it has to
   wait until React has actually committed the root's <style> element (a sibling
   of AppErrorBoundary since #150). One rAF is not enough under React 18's
   concurrent render (the first attempt here reported every class as
   touch-action:auto because no stylesheet existed yet), so poll for the
   stylesheet with a bounded retry rather than guessing a delay. */
(function scheduleSelfTests(tries) {
  /* #163 — readiness is now the CANARY'S COMPUTED VALUE, not a text scan of
     <style> contents. The text scan answered "is the CSS in the DOM", which is
     strictly weaker than "is the CSS applying" — a sheet present but inert
     passed the old gate and then reported every tappable class as broken.

     The retry ladder also no longer relies on rAF alone: requestAnimationFrame
     does not fire in a hidden or throttled tab (headless screenshot runs and
     background tabs both hit this), which would silently skip the entire
     suite. Alternate rAF with a setTimeout so progress is guaranteed. */
  const ready = tapCanaryApplied();
  const n = tries || 0;
  if (!ready && n < 60) {
    const again = () => scheduleSelfTests(n + 1);
    if (n % 2 === 0 && typeof requestAnimationFrame === 'function') requestAnimationFrame(again);
    else setTimeout(again, 16);
    return;
  }
  /* #149 — pass the readiness verdict through instead of running the sweep
     regardless. Exhausting the budget used to be reported as "touch-action:auto
     on <all 18 classes>", which pointed the bug report at the tap-target
     registry when the actual cause was a crash that took the stylesheet with
     it. Now it reports `stylesheet-missing` once and skips those checks. */
  try { runClientSelfTests(ready); }
  catch (e) { console.error('[self-test] harness threw:', e && e.message); }
})(0);
