// usernode-loading.js — stub for dev mode
// Vendor this from usernode-dapp-starter for the on-chain upgrade.
(function () {
  if (typeof window === 'undefined') return;
  window.createLoadingState = window.createLoadingState || function (initial) {
    var state = initial || {};
    var listeners = [];
    return {
      get: function () { return state; },
      set: function (key, val) { state[key] = val; listeners.forEach(function (fn) { try { fn(state); } catch (_) {} }); },
      subscribe: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (l) { return l !== fn; }); }; },
    };
  };
})();
