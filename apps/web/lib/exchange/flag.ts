/**
 * The Exchange feature flag (build plan DN-01, EX-1).
 *
 * The Exchange screens ship dark: the nav section and every route under
 * `/<org>/exchange` exist only when `HUNTLOOP_EXCHANGE=on` is set on the
 * deployment. With it off, the routes 404 exactly like any unknown path, so
 * a half-launched marketplace is never discoverable by guessing a URL.
 *
 * An env var rather than a per-workspace switch for now: the first users are
 * invited by hand, and the decision to open it is one decision for the whole
 * deployment. Per-workspace rollout is a later change to this one function.
 */
export function isExchangeEnabled(): boolean {
  return process.env.HUNTLOOP_EXCHANGE?.trim().toLowerCase() === "on";
}

/**
 * Page metadata that says nothing while the flag is off. Next resolves a
 * page's metadata alongside its layout, so a static `metadata` export would
 * put "My requests" in the tab title of the 404 the layout renders.
 */
export function exchangeMetadata(title: string): () => { title?: string } {
  return () => (isExchangeEnabled() ? { title } : {});
}
