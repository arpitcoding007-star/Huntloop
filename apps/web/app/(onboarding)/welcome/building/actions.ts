"use server";

import {
  stageContacts,
  stageDiscover,
  stageEnrich,
  stageExplain,
  stageScore,
  type StageResult,
} from "@huntloop/jobs";
import type { EngineStage, FirstRunStage } from "../../../../lib/onboarding/steps";
import { draftRulesAction } from "../../../(app)/[org]/settings/scoring/actions";
import { fail, mutate, ok, type ActionResult } from "../../../../lib/data/org";
import { resolveDataSource } from "../../../../lib/data/source";
import { firstRunStageSchema, orgSlugSchema, parseInput } from "../../../../lib/validation";


/**
 * The building screen's one action: run a stage, report what happened.
 *
 * ── Why one stage per request ────────────────────────────────────────────
 *
 * Three reasons, and the third is the one that decided it.
 *
 *   1. **Serverless deadlines.** A discovery search plus five enrichments plus
 *      ten scores plus three contact reveals is minutes of work, and a Vercel
 *      function is 60 seconds on Hobby. One stage per call fits; the whole
 *      chain does not.
 *   2. **Progress is real.** The screen shows what is happening because the
 *      server is telling it, not because a spinner is guessing.
 *   3. **Failure is partial.** A stage that fails leaves every earlier one
 *      standing. A single long call that failed at minute two would have to
 *      report the whole run as failed, and the user would lose twenty-five
 *      discovered companies to a contact provider being out of credits.
 *
 * ── Why the client drives the sequence ───────────────────────────────────
 *
 * It looks like something the server should own, and the server *does* own
 * what each stage means — the client only says "next". The alternative is a
 * background job plus a polling endpoint plus a status table, which is three
 * new moving parts to achieve the same visible result on a flow that runs once
 * per workspace.
 *
 * The cost is that a user who closes the tab mid-run stops the run. That is
 * handled where it matters rather than here: the discovery query created by
 * the first stage is `is_enabled` with a daily interval, so the scheduled
 * runner picks up exactly where this left off without anyone doing anything.
 * Closing the tab delays the workspace; it does not break it.
 */

/**
 * A stage result as the *screen* understands it.
 *
 * `StageResult` from `@huntloop/jobs` narrows `stage` to the five stages that
 * package knows about — correct for it, and one short for the screen, because
 * `rules` is an `apps/web` model call and deliberately not a job. Widening the
 * field here rather than loosening the type over there keeps the jobs package
 * honest about what it actually runs.
 */
export type ScreenStageResult = Omit<StageResult, "stage"> & { stage: FirstRunStage };

export interface StageState {
  result?: ScreenStageResult;
  error?: string;
}

/**
 * The five stages that drive job handlers.
 *
 * Typed over `EngineStage` rather than `FirstRunStage`, which is what keeps the
 * two lists honest: adding a stage to `@huntloop/jobs` without adding it here
 * is a missing-key type error, and adding one here without adding it there is
 * an unknown-key one.
 */
const RUNNERS: Record<EngineStage, (orgId: string) => Promise<StageResult>> = {
  discover: stageDiscover,
  enrich: stageEnrich,
  score: stageScore,
  contacts: stageContacts,
  explain: stageExplain,
};

function isEngineStage(stage: FirstRunStage): stage is EngineStage {
  return stage !== "rules";
}

/**
 * Drafts the starting scoring rules from the profile's triggers.
 *
 * ── Why a first-run user gets rules at all ───────────────────────────────
 *
 * Because the scoring screen shipped empty, and an empty scoring screen asks
 * somebody on their first day to invent a rubric for a market they have not
 * seen Huntloop's view of yet. Drafting from their own triggers means the
 * first scores decompose into rules they *recognise* — which is the whole
 * claim the product makes about its scores.
 *
 * ── Why they arrive inactive, and why that is not a half-measure ─────────
 *
 * `draftRulesAction` writes every proposal with `is_active: false`, and the
 * comment on that line calls it the most important in the file. A rule a
 * customer has not read runs against every company thereafter; a flow that
 * activated them to make the first run look better would be approving policy
 * on the user's behalf.
 *
 * So the stage's job is to put something reviewable in front of them, and to
 * say so. `stageExplain` and this one are the two stages whose value is
 * realised later rather than on the screen.
 */
async function runRulesStage(org: string): Promise<ScreenStageResult> {
  const result = await draftRulesAction(org);

  if (!result.ok) {
    return { stage: "rules", status: "failed", detail: result.error, count: 0 };
  }

  const { drafted } = result.data;

  return {
    stage: "rules",
    status: drafted > 0 ? "done" : "skipped",
    detail:
      drafted > 0
        ? `Drafted ${drafted} scoring rule${drafted === 1 ? "" : "s"} from your triggers. ` +
          `None is active until you read it.`
        : "Your profile is too thin to propose a specific rule yet — add a trigger or two and try from Settings → Scoring.",
    count: drafted,
  };
}

export async function runStageAction(
  org: string,
  stage: string,
): Promise<ActionResult<ScreenStageResult>> {
  const slug = parseInput(orgSlugSchema, org, "organisation");
  if (!slug.ok) return fail(slug.error);

  const parsed = parseInput(firstRunStageSchema, stage, "step");
  if (!parsed.ok) return fail(parsed.error);

  /*
   * Demo mode is `skipped`, not `failed`.
   *
   * `mutate` would refuse here with a perfectly accurate sentence, and the
   * screen would draw five red warning triangles — which reads as "the product
   * is broken" on the one configuration where nothing is wrong. Nothing failed;
   * there is simply nowhere for the work to run. The distinction is the same
   * one the whole screen is built around, so it has to hold for this case too.
   */
  const { db } = await resolveDataSource();
  if (!db) {
    return ok({
      stage: parsed.value as FirstRunStage,
      status: "skipped",
      detail:
        "This deployment has no database connected, so there is nothing to " +
        "search or save. Connect Supabase to run this for real.",
      count: 0,
    });
  }

  const resolved = parsed.value as FirstRunStage;

  /* The rules stage does its own `mutate` — `draftRulesAction` is a Server
     Action in its own right, with the membership check, the rate limit and the
     monthly budget already on it. Wrapping it in a second `mutate` would
     resolve the same membership twice to reach a function that does not need
     the org id. */
  if (!isEngineStage(resolved)) {
    return ok(await runRulesStage(slug.value));
  }

  /* `mutate` rather than a bare read. Every stage spends money — provider
     credits, model calls, or both — so this needs the same refusals every
     other spending path gets: not a member, read-only role. It also resolves
     the org id from a *verified membership*, which is what makes it safe to
     hand that id to code running under the service-role client. */
  return mutate(slug.value, "runFirstRunStage", async ({ orgId }) => {
    const result = await RUNNERS[resolved](orgId);
    return ok(result);
  });
}
