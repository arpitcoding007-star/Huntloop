import "server-only";
import { cache } from "react";
import { PostHog } from "posthog-node";
import { resolveDataSource } from "./data/source";

/**
 * Product analytics, server-side only.
 *
 * ANL-01b. `NEXT_PUBLIC_POSTHOG_KEY` had been reserved in `.env.example` since
 * the beginning and nothing was installed, so there was no measurement of
 * anything — most importantly of onboarding, which is a four-step pipeline
 * where each step feeds the next and nobody knew where people dropped out.
 *
 * ── Why `posthog-node` and not `posthog-js` ──────────────────────────────
 *
 * The browser SDK is the default choice and it is the wrong one here. It costs
 * roughly 50 kB of client bundle, and the audit has a live finding about
 * exactly that: adding Sentry cost +33 kB, nobody noticed until it was
 * measured, and PERF-06 exists to put a budget in CI. Spending another 50 kB
 * in the same week that PERF-02 removed 66 kB from the sign-in pages would be
 * taking the win back for nothing.
 *
 * "For nothing" because of what is being measured. The onboarding funnel is
 * four server-rendered pages and four Server Actions. Every step transition
 * already passes through the server, so the server can see the whole funnel.
 * What the client SDK would add — autocapture, rage clicks, session tracking —
 * is not what this is for, and two of those three raise the same questions
 * about recording a customer's prospecting that kept Session Replay switched
 * off in Sentry.
 *
 * Revisit if a question arrives that genuinely needs client-side behaviour.
 * That is a different decision with a different cost, and it should be made on
 * its own rather than inherited from this one.
 *
 * ── What is deliberately never sent ──────────────────────────────────────
 *
 * No email addresses, no company names, no URLs a user pasted, no ICP text.
 * Those are the customer's commercial data and their prospects' identities —
 * `properties` below is typed to a closed set so sending them takes a
 * deliberate edit rather than an autocomplete. `distinctId` is the Supabase
 * user id, which is already an opaque uuid.
 */

/**
 * The events this app emits, as a closed union.
 *
 * A string parameter would let two spellings of the same event coexist for
 * months, which produces a funnel that quietly under-counts and a dashboard
 * nobody can debug.
 */
export type AnalyticsEvent =
  | "onboarding_step_viewed"
  | "onboarding_step_completed"
  | "onboarding_step_failed"
  | "analysis_requested"
  | "analysis_refused";

export type OnboardingStep = "organisation" | "product" | "icp" | "sources";

/** Closed set, for the reason given above: no free-form strings leave here. */
export interface AnalyticsProperties {
  step?: OnboardingStep;
  /** Which org, so a funnel can be read per tenant. An opaque uuid. */
  orgId?: string;
  /** Whether a model actually ran, or the screen showed its worked example. */
  aiConfigured?: boolean;
  /** Why something was refused — our own enum, never a provider message. */
  reason?: "rate_limited" | "unresolvable_org" | "no_icp" | "invalid_input" | "model_refused";
  /** Wall-clock duration of a step, in milliseconds. */
  durationMs?: number;
}

let client: PostHog | null | undefined;

/**
 * Lazily constructed, and `null` forever when unconfigured.
 *
 * `undefined` means "not yet asked", `null` means "asked, and there is no
 * key" — distinguishing them stops the constructor being re-attempted on
 * every event in the (normal) local and CI case where no key exists.
 */
function posthog(): PostHog | null {
  if (client !== undefined) return client;

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) {
    client = null;
    return null;
  }

  client = new PostHog(key, {
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com",
    /*
     * Send immediately rather than batching.
     *
     * Batching is the right default for a long-lived process and wrong for a
     * serverless function, which is frozen the moment the response is
     * returned: a queued event is simply lost. `flushAt: 1` with an awaited
     * flush at the call site trades a little latency for events that actually
     * arrive.
     */
    flushAt: 1,
    flushInterval: 0,
  });

  return client;
}

/**
 * Records an event. Never throws, never blocks the caller's real work.
 *
 * Analytics is the least important thing on any code path it appears on. A
 * PostHog outage must not fail a sign-up, so every error is swallowed — and
 * swallowed silently rather than reported, because a reporting call inside the
 * failure handler of a reporting call is how one outage becomes two.
 */
export async function capture(
  event: AnalyticsEvent,
  distinctId: string,
  properties: AnalyticsProperties = {},
): Promise<void> {
  const posthogClient = posthog();
  if (!posthogClient) return;

  try {
    posthogClient.capture({ distinctId, event, properties });
    await posthogClient.flush();
  } catch {
    // Deliberately empty. See above.
  }
}

/**
 * The signed-in user's id, or null.
 *
 * Wrapped in React's `cache` so several `captureForViewer` calls in one
 * request share a single `auth.getUser()` — that call goes to Supabase's auth
 * server rather than reading the cookie, which is the correct, verified way to
 * do it (see middleware.ts) and also the more expensive one. Deduping is what
 * makes it affordable to instrument more than one thing per request.
 *
 * Returns null in demo mode, so instrumentation is simply absent rather than
 * attributed to a fabricated id.
 */
const viewerId = cache(async (): Promise<string | null> => {
  const { db } = await resolveDataSource();
  if (!db) return null;
  try {
    const { data } = await db.auth.getUser();
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
});

/**
 * Records an event against the signed-in user, if there is one.
 *
 * The user id is the `distinctId` throughout rather than the org, and that is
 * a deliberate choice about what the funnel measures: onboarding is completed
 * by a *person*, and the org does not exist until step one succeeds — so
 * keying on the org would leave the first step unattributable and the funnel
 * starting at step two, which is precisely the step nobody needed measured.
 *
 * The org travels as a property instead, so the funnel can still be read per
 * tenant. Note that the org *slug* is never sent: it is derived from the
 * customer's company name, and a company name is their data.
 */
export async function captureForViewer(
  event: AnalyticsEvent,
  properties: AnalyticsProperties = {},
): Promise<void> {
  if (!posthog()) return; // Cheap exit before the auth round trip.
  const id = await viewerId();
  if (!id) return;
  await capture(event, id, properties);
}
