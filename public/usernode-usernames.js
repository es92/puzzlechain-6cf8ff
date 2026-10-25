// usernode-usernames.js — stub for dev mode
// Vendor this from usernode-dapp-starter for the on-chain upgrade.
(function () {
  if (typeof window === 'undefined') return;
  window.createUsernamesCache = window.createUsernamesCache || function () {
    return {
      get: function () { return null; },
      resolve: function () { return Promise.resolve(null); },
      subscribe: function () { return function () {}; },
    };
  };
})();
