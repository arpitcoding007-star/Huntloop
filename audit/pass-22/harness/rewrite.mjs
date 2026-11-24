/* eslint-disable */
// Preload: sends vendor calls to the simulator on 127.0.0.1:3196. Nothing else is changed;
// pages are still read from the real internet through the product's own guarded fetch.
const VENDORS = new Set(["api.apollo.io","api.hunter.io","api.zerobounce.net","api.hubapi.com","gmail.googleapis.com","oauth2.googleapis.com","graph.microsoft.com","login.microsoftonline.com","api.resend.com"]);
const real = globalThis.fetch;
globalThis.fetch = function (input, init) {
  try {
    const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (VENDORS.has(u.hostname)) return real(`http://127.0.0.1:3196/${u.hostname}${u.pathname}${u.search}`, init);
  } catch {}
  return real(input, init);
};
