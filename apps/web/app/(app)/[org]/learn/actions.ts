"use server";

import { revalidatePath } from "next/cache";
import type { FindingProposal } from "@huntloop/ai";
import { InvalidRuleError, validateExpression } from "@huntloop/db/rules";
import {
  currentUserId,
  fail,
  mutate,
  ok,
  type ActionResult,
} from "../../../../lib/data/org";
import { uuidSchema } from "../../../../lib/validation";

/**
 * Learning — requesting an analysis, and deciding on what it found.
 *
 * ── Why requesting is a row and not a job ────────────────────────────────
 *
 * `enqueue()` writes through the service-role client, and calling it from a
 * Server Action would put the RLS bypass on a public POST endpoint — the whole
 * argument in `packages/db/src/admin.ts`. So this writes a `learning_runs` row
 * in state `requested` and `schedule_learning` turns it into a job on the next
 * tick. Same seam `sources.next_scan_at` already uses, and the same property:
 * exactly one writer to `job_executions`.
 *
 * ── Why approval is one finding at a time ────────────────────────────────
 *
 * There is no "approve all", and the absence is the feature.
 *
 * The reference system Huntloop is a second draft of stored an analysis as one
 * row of free-text arrays with a single Approve button that bulk-inserted every
 * proposed rule as immediately active. A report with one good idea and four bad
 * ones offered a choice between all five and none, and since the good idea was
 * usually in there, the answer was always all five. That is not a review; it is
 * a confirmation dialog with extra reading.
 *
 * ── What approving actually does ─────────────────────────────────────────
 *
 * Exactly one thing, and it is visible before you press it: a scoring rule
 * lands in `scoring_rules` **inactive**, or a note lands in `memories` with
 * `source = 'derived'`. Nothing else changes. A finding with no proposal can
 * still be approved — that records that somebody read it and agreed, which is
 * worth keeping — and it writes nothing anywhere.
 */

/** Ask for an analysis. The sweeper picks it up on the next tick. */
export async function requestAnalysisAction(
  org: string,
  windowDays = 90,
): Promise<ActionResult<{ runId: string }>> {
  const days = Math.max(7, Math.min(365, Math.round(Number(windowDays) || 90)));

  return mutate(org, "requestAnalysis", async ({ db, orgId }) => {
    const userId = await currentUserId(db);
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

    const { data, error } = await db
      .from("learning_runs")
      .insert({
        org_id: orgId,
        status: "requested",
        trigger: "manual",
        triggered_by: userId,
        window_start: start.toISOString(),
        window_end: end.toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      /* 23505 is `learning_runs_one_open_per_org`. A double-submit is the
         common cause and it is exactly what that index exists to catch: two
         clicks a second apart both pass any read-then-write guard, and each
         one costs an Opus call over three hundred records. */
      if (error.code === "23505") {
        return fail(
          "An analysis is already running for this organisation. It will appear here when it finishes.",
        );
      }
      return fail(`That analysis could not be started: ${error.message}`);
    }

    revalidatePath(`/${org}/learn`);
    return ok(
      { runId: String(data.id) },
      "Analysis requested. It starts on the next engine tick and takes a minute or two.",
    );
  });
}

/** What approving one finding produced, if anything. */
type Applied = { applied: "scoring_rule" | "memory" | null };

/**
 * Approve one finding, applying its proposal if it has one.
 *
 * The order is: write the thing, then mark the finding. On a crash between
 * them the finding stays `pending` and the rule or memory exists — so a second
 * approval would create a duplicate, which is visible and fixable. The other
 * order loses the proposal entirely with the finding marked done, which is
 * neither.
 */
export async function approveFindingAction(
  org: string,
  id: string,
): Promise<ActionResult<Applied>> {
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) return fail("That finding reference isn't valid.");

  return mutate<Applied>(org, "approveFinding", async ({ db, orgId }) => {
    const userId = await currentUserId(db);

    const { data: finding, error } = await db
      .from("learning_findings")
      .select("id, status, proposal, headline")
      .eq("id", parsed.data)
      .eq("org_id", orgId)
      .maybeSingle();

    if (error) return fail(`That finding could not be read: ${error.message}`);
    if (!finding) return fail("That finding no longer exists.");
    if (finding.status !== "pending") {
      /* Not an error. Two people reviewing the same list is normal, and the
         second one should be told what happened rather than shown a failure. */
      return ok<Applied>({ applied: null }, "That finding has already been decided.");
    }

    const proposal = (finding.proposal ?? null) as FindingProposal | null;
    let appliedType: "scoring_rule" | "memory" | null = null;
    let appliedId: string | null = null;

    if (proposal?.type === "scoring_rule") {
      /* Re-validated on the way out, even though `parse()` validated it on the
         way in. The row has been sitting in jsonb since, and the language may
         have moved on — a stored proposal that no longer parses must fail here
         with a reason rather than become a rule the engine silently skips. */
      try {
        validateExpression(proposal.expression);
      } catch (e) {
        if (e instanceof InvalidRuleError) {
          return fail(
            `That proposal can no longer be turned into a rule: ${e.message} ` +
              `You can still write the rule by hand under Settings → Scoring.`,
          );
        }
        throw e;
      }

      const { data: rule, error: ruleError } = await db
        .from("scoring_rules")
        .insert({
          org_id: orgId,
          name: proposal.name,
          expression: proposal.expression,
          effect: proposal.effect,
          weight: proposal.effect === "adjust" ? proposal.weight : null,
          floor_priority: proposal.effect === "floor" ? proposal.floorPriority : null,
          intent: proposal.intent,
          rationale: finding.headline,
          origin: "learned",
          /* Inactive. Approving a *finding* means "this conclusion is sound";
             activating a *rule* means "start applying it to every company".
             They are different decisions and the second one is made on the
             scoring screen, where the rule can be tested against real
             opportunities first. */
          is_active: false,
          proposed_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (ruleError) return fail(`That rule could not be created: ${ruleError.message}`);
      appliedType = "scoring_rule";
      appliedId = String(rule.id);
    }

    if (proposal?.type === "memory") {
      const { data: memory, error: memoryError } = await db
        .from("memories")
        .insert({
          org_id: orgId,
          scope: "organization",
          scope_id: null,
          kind: "durable",
          key: proposal.key,
          content: proposal.content,
          /* `derived`, not `user`. §7 applied to our own memory: a conclusion
             the product drew must not become indistinguishable from something
             a person wrote down, and the memory screen renders the two apart. */
          source: "derived",
          source_type: "text",
        })
        .select("id")
        .single();

      if (memoryError) return fail(`That note could not be saved: ${memoryError.message}`);
      appliedType = "memory";
      appliedId = String(memory.id);
    }

    const { error: markError } = await db
      .from("learning_findings")
      .update({
        status: "approved",
        decided_by: userId,
        decided_at: new Date().toISOString(),
        applied_type: appliedType,
        applied_id: appliedId,
      })
      .eq("id", parsed.data)
      .eq("org_id", orgId)
      /* Only from `pending`, so two simultaneous approvals apply the proposal
         once. The first update matches; the second matches zero rows and the
         message below says it was already decided. */
      .eq("status", "pending");

    if (markError) return fail(`That finding could not be marked: ${markError.message}`);

    revalidatePath(`/${org}/learn`);
    if (appliedType === "scoring_rule") {
      revalidatePath(`/${org}/settings/scoring`);
      return ok<Applied>(
        { applied: appliedType },
        "Approved. The rule is waiting under Settings → Scoring, and is not applying to anything until you activate it there.",
      );
    }
    if (appliedType === "memory") {
      revalidatePath(`/${org}/memory`);
      return ok<Applied>(
        { applied: appliedType },
        "Approved, and added to Memory. Everything Huntloop writes from now on reads it.",
      );
    }
    return ok<Applied>({ applied: null }, "Approved. Nothing to apply — this one was for you to read.");
  });
}

/**
 * Reject one finding.
 *
 * Kept rather than deleted. A record of what the product proposed and a person
 * declined is the more useful half of the review: it says what the analysis
 * gets wrong, which is the thing anybody tuning this feature needs and the
 * thing a delete would throw away.
 */
export async function rejectFindingAction(
  org: string,
  id: string,
): Promise<ActionResult<undefined>> {
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) return fail("That finding reference isn't valid.");

  return mutate(org, "rejectFinding", async ({ db, orgId }) => {
    const userId = await currentUserId(db);

    const { error } = await db
      .from("learning_findings")
      .update({
        status: "rejected",
        decided_by: userId,
        decided_at: new Date().toISOString(),
      })
      .eq("id", parsed.data)
      .eq("org_id", orgId)
      .eq("status", "pending");

    if (error) return fail(`That finding could not be rejected: ${error.message}`);

    revalidatePath(`/${org}/learn`);
    return ok(undefined, "Rejected. Nothing was applied.");
  });
}
