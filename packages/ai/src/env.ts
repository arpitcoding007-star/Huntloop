/**
 * Environment access for the AI layer, in one place for the same reason
 * packages/db keeps it in one place: a missing key should fail with a sentence,
 * not with `undefined` reaching an HTTP header.
 *
 * Note the deliberate asymmetry with `required()` in @huntloop/db. There, a
 * missing key is always an error, because a configured Supabase project is the
 * only way the app works at all. Here, a missing key is a *normal* state — the
 * product has real screens that run without a model, and §7's rule against
 * presenting the unverified as established applies to ourselves: an app with no
 * key must say it has no key, not invent a company profile.
 */

/** True when a model can actually be called. Checked before every task. */
export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function anthropicApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      "Missing ANTHROPIC_API_KEY. Add it to apps/web/.env.local — see SETUP.md. " +
        "Callers that can degrade gracefully should check isAiConfigured() first " +
        "rather than catching this.",
    );
  }
  return key;
}
