import "server-only";
import { resolveDataSource } from "./source";
import { currentViewer } from "./membership";

/**
 * What Huntloop should ask this workspace next.
 *
 * ── The idea ─────────────────────────────────────────────────────────────
 *
 * Onboarding collects maybe a fifth of what Huntloop should know about a
 * customer. The rest arrives from use — which approvals stuck, which
 * rejections repeated, which message got a reply — and every one of those is
 * already recorded: `human_overrides` since `0016`, `outcomes` since `0004`,
 * `opportunities.status` since `0003`.
 *
 * What was missing is anybody *asking*. A learning loop that only runs on a
 * schedule improves the scoring silently and never converts a pattern into a
 * question, so the customer is never given the one thing they can answer
 * better than any model: *why*.
 *
 * ── The rule: at most one, and only when it has earned the interruption ──
 *
 * Each nudge has a floor high enough that a handful of clicks cannot trip it,
 * because a product that asks "should we tighten your profile?" after two
 * approvals is asking about noise. And only the highest-priority one renders:
 * three suggestions on a working screen is a backlog, and a backlog on a
 * dashboard is ignored wholesale — including the one that mattered.
 *
 * ── Why these three ──────────────────────────────────────────────────────
 *
 * They are the three moments where the customer knows something the system
 * cannot infer:
 *
 *   · **Approvals accumulate.** They have said yes ten times. What those ten
 *     have in common is a better ICP than the one they guessed at on day one.
 *   · **Rejections repeat.** The system scored five companies highly and the
 *     customer passed on all of them. Something in the profile is wrong and
 *     only they know which part.
 *   · **Something worked.** A reply is the only unambiguous signal in the
 *     product, and the moment after one is the moment to ask for more like it.
 */

export type NudgeKind = "tighten-icp" | "rejection-streak" | "first-reply";

export interface Nudge {
  kind: NudgeKind;
  title: string;
  body: string;
  action: { label: string; href: string };
}

/** Approvals before it is worth asking what they have in common. */
const APPROVAL_FLOOR = 10;

/**
 * Rejections of high-scoring opportunities before the pattern is real.
 *
 * Five, and they must be *overrides* — a person actively marking down
 * something the system rated highly — rather than opportunities that merely
 * went stale. Someone who ignores their pipeline for a week has not disagreed
 * with anything.
 */
const REJECTION_FLOOR = 5;

/**
 * The one thing to ask, or nothing.
 *
 * Returns null far more often than not, which is the intended behaviour: most
 * visits to the dashboard are somebody doing their work, and the right number
 * of interruptions then is zero.
 */
export async function getNudge(orgSlug: string): Promise<Nudge | null> {
  const { db } = await resolveDataSource();
  if (!db) return null;

  const viewer = await currentViewer(orgSlug);
  if (!viewer || viewer.kind !== "member") return null;
  const orgId = viewer.orgId;

  /* All three counts in one round trip. They are independent questions and
     asking them in sequence would put three round trips on every dashboard
     render for an answer that is usually "nothing to say". */
  const [approved, rejections, replies, versions] = await Promise.all([
    db
      .from("opportunities")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .in("status", ["assigned", "contacted", "replied", "meeting", "proposal", "won"]),

    db
      .from("human_overrides")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("subject", "opportunity_priority")
      .is("consumed_at", null),

    db
      .from("outcomes")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .in("kind", ["reply", "positive"]),

    /* How many times the profile has been revised. A workspace on version 1
       has never acted on what it learned, which is exactly who the first
       nudge is for — and one on version 4 is already doing this, so asking
       again would be nagging somebody who is ahead of us. */
    db
      .from("icp_versions")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId),
  ]);

  const approvals = approved.count ?? 0;
  const overrides = rejections.count ?? 0;
  const replyCount = replies.count ?? 0;
  const versionCount = versions.count ?? 0;

  /*
   * Priority order, and it is deliberate.
   *
   * A rejection streak outranks everything: it means the profile is actively
   * wrong and the customer is paying for searches that produce companies they
   * do not want. A first reply outranks accumulated approvals because it is
   * time-sensitive — "that worked, want more like it?" lands the day it
   * happens and is noise a month later.
   */
  if (overrides >= REJECTION_FLOOR) {
    return {
      kind: "rejection-streak",
      title: `You've overruled ${overrides} of our verdicts`,
      body:
        "That is a pattern rather than a one-off, and it means the profile is " +
        "scoring something we cannot see. Telling us what those companies had " +
        "in common turns the disagreement into a rule.",
      action: { label: "Review what we got wrong", href: `/${orgSlug}/learn` },
    };
  }

  if (replyCount > 0 && versionCount <= 1) {
    return {
      kind: "first-reply",
      title: "Something worked",
      body:
        "You've had a reply. The trigger and the message behind it are the " +
        "most useful thing this workspace knows — worth locking in before the " +
        "next hundred companies are judged without it.",
      action: { label: "See what worked", href: `/${orgSlug}/learn` },
    };
  }

  if (approvals >= APPROVAL_FLOOR && versionCount <= 1) {
    return {
      kind: "tighten-icp",
      title: `You've taken on ${approvals} companies`,
      body:
        "Enough for what they have in common to be worth more than the profile " +
        "you sketched on day one. We can propose a tighter one and show you " +
        "exactly what would have scored differently.",
      action: { label: "Tighten my profile", href: `/${orgSlug}/learn` },
    };
  }

  return null;
}
