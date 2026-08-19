"use server";

import { revalidatePath } from "next/cache";
import { enqueueScan, isEngineRunning } from "../../../../lib/data/engine";
import { getActiveIcp } from "../../../../lib/data/icp";
import { canSpend, currentViewer } from "../../../../lib/data/membership";
import { fail, mutate, ok, type ActionResult } from "../../../../lib/data/org";
import { recommend } from "../../../../lib/ai/sources";
import {
  parseForm,
  scanIntervalSchema,
  sourceSchema,
  uuidSchema,
} from "../../../../lib/validation";
import { recordAudit } from "../../../../lib/data/audit";

/**
 * Source writes — master context §10, §58.
 *
 * §10 puts the user in control of what a hunt reads: Huntloop recommends, the
 * user accepts, removes or adds. Each of those is an action here, and each
 * maps to one column rather than to a new concept — see the note in
 * `lib/data/hunt-source.ts` on why a pending recommendation is
 * `is_enabled = false`.
 */

export interface SourceInput {
  id?: string;
  name: string;
  kind:
    | "news"
    | "blog"
    | "jobs"
    | "social"
    | "github"
    | "funding"
    | "regulatory"
    | "community"
    | "podcast"
    | "custom";
  url: string;
  icpId: string;
}

export async function saveSourceAction(
  org: string,
  input: SourceInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = parseForm(sourceSchema, input);
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);
  const value = parsed.value;

  return mutate(org, "saveSource", async ({ db, orgId }) => {
    const row = {
      org_id: orgId,
      name: value.name,
      kind: value.kind,
      url: value.url || null,
      icp_id: value.icpId || null,
    };

    if (value.id) {
      const { error } = await db
        .from("sources")
        .update(row)
        .eq("id", value.id)
        .eq("org_id", orgId)
        .is("deleted_at", null);
      if (error) return fail(`That source could not be saved: ${error.message}`);

      revalidatePath(`/${org}/sources`);
      return ok({ id: value.id }, "Source saved.");
    }

    /* A source the user added themselves is enabled immediately — they asked
       for it, so there is nothing to accept. `recommended_by` records which
       it was, which is what lets the learning loop later ask whether system
       picks or user picks produced better opportunities (§10). */
    const { data, error } = await db
      .from("sources")
      .insert({ ...row, is_enabled: true, recommended_by: "user" })
      .select("id")
      .single();
    if (error) return fail(`That source could not be added: ${error.message}`);

    revalidatePath(`/${org}/sources`);
    return ok({ id: String(data.id) }, "Source added. It will be read on the next hunt.");
  });
}

/**
 * Accept a recommendation, or pause a monitored source.
 *
 * One action for both directions because it is one column, and because the
 * pair reads better as a toggle than as `acceptSource` / `pauseSource` — two
 * names for one flip is how the two ends drift apart.
 */
export async function setSourceEnabledAction(
  org: string,
  id: string,
  enabled: boolean,
): Promise<ActionResult<undefined>> {
  return mutate(org, "setSourceEnabled", async ({ db, orgId }) => {
    const parsed = uuidSchema.safeParse(id);
    if (!parsed.success) return fail("That source reference isn't valid.");

    const { error } = await db
      .from("sources")
      .update({ is_enabled: enabled })
      .eq("id", parsed.data)
      .eq("org_id", orgId)
      .is("deleted_at", null);
    if (error) return fail(`That source could not be changed: ${error.message}`);

    revalidatePath(`/${org}/sources`);
    return ok(
      undefined,
      enabled
        ? "Accepted. It will be read on the next hunt."
        : "Paused. Nothing will be read from it until you turn it back on.",
    );
  });
}

/**
 * Soft delete.
 *
 * `evidence.source_id` references this row with `on delete set null`, so a
 * hard delete would strip the provenance from every claim the source
 * produced — turning a fact with a source into a fact with none, which §52's
 * whole check constraint exists to prevent.
 */
export async function deleteSourceAction(
  org: string,
  id: string,
): Promise<ActionResult<undefined>> {
  return mutate(org, "deleteSource", async ({ db, orgId }) => {
    const parsed = uuidSchema.safeParse(id);
    if (!parsed.success) return fail("That source reference isn't valid.");

    const { error } = await db
      .from("sources")
      .update({ deleted_at: new Date().toISOString(), is_enabled: false })
      .eq("id", parsed.data)
      .eq("org_id", orgId);
    if (error) return fail(`That source could not be removed: ${error.message}`);

    revalidatePath(`/${org}/sources`);
    return ok(undefined, "Source removed.");
  });
}

/**
 * Ask the model for sources, and store them as pending.
 *
 * ── Why this is a button and not a page load ─────────────────────────────
 *
 * It costs money. `recommend()` is a real Opus call, metered into `ai_runs`
 * and bounded by the rate limiter, and running it on every render of this
 * screen would bill an org for looking at its own settings. §77 Principle 7
 * also wants the user to have asked.
 *
 * The rows are written with `is_enabled = false`, so a recommendation the
 * user never looks at still reads nothing. That is the difference between
 * recommending and enabling, and it has to be true in the database.
 */
export async function suggestSourcesAction(
  org: string,
): Promise<ActionResult<{ added: number; metered: boolean; aiConfigured: boolean }>> {
  // Checked before the model call rather than after: a viewer must not be able
  // to spend the org's budget, and `mutate` below would only refuse the write.
  const viewer = await currentViewer(org);
  if (!canSpend(viewer)) {
    return fail("Your role is read-only, so you cannot start a model run.");
  }

  return mutate(org, "suggestSources", async ({ db, orgId }) => {
    const { data: icp } = await getActiveIcp(orgId);
    if (!icp) {
      return fail(
        "There is no active ICP to recommend from yet. Define one under Settings → ICP first.",
      );
    }

    const outcome = await recommend(org, icp);
    if (!outcome.ok) return fail(outcome.error);

    const { recommendations, source, metered } = outcome.result;
    if (recommendations.length === 0) {
      return fail("The model returned no sources it could justify from your ICP.");
    }

    /* Only what is not already on the list, matched on name. `sources` has no
       unique constraint — two feeds can legitimately share a URL — so this is
       the check that stops pressing the button twice doubling the list. */
    const { data: existing, error: existingError } = await db
      .from("sources")
      .select("name")
      .eq("org_id", orgId)
      .is("deleted_at", null);
    if (existingError) return fail(`The suggestions could not be saved: ${existingError.message}`);

    const known = new Set((existing ?? []).map((s) => String(s.name).toLowerCase()));
    const fresh = recommendations.filter((r) => !known.has(r.name.toLowerCase()));

    if (fresh.length === 0) {
      return ok(
        { added: 0, metered, aiConfigured: source === "live" },
        "Nothing new — every source it suggested is already on your list.",
      );
    }

    const { error } = await db.from("sources").insert(
      fresh.map((r) => ({
        org_id: orgId,
        name: r.name,
        kind: KINDS.includes(r.kind as Kind) ? r.kind : "custom",
        url: r.url ?? null,
        is_enabled: false,
        recommended_by: "system",
      })),
    );
    if (error) return fail(`The suggestions could not be saved: ${error.message}`);

    revalidatePath(`/${org}/sources`);
    return ok(
      { added: fresh.length, metered, aiConfigured: source === "live" },
      `${fresh.length} suggested. Nothing is read from them until you accept.`,
    );
  });
}

/**
 * The `source_kind` enum from 0002.
 *
 * Checked rather than trusted: `kind` arrives from a model, and a value
 * outside the enum fails the insert for the whole batch — so one unfamiliar
 * word would lose every other suggestion in the same call. `custom` is what
 * the enum has for exactly this.
 */
const KINDS = [
  "news",
  "blog",
  "jobs",
  "social",
  "github",
  "funding",
  "regulatory",
  "community",
  "podcast",
  "custom",
] as const;
type Kind = (typeof KINDS)[number];

/**
 * Scan now — put this source at the front of the queue.
 *
 * ── What "now" means, and why it is said out loud ────────────────────────
 *
 * It enqueues; it does not scan. The work happens in the runner, which the
 * cron tick invokes, so a source scanned "now" is read within one tick rather
 * than before this action returns. Fetching several pages and calling a model
 * inline would tie the result to a Server Action's timeout and give the user a
 * spinner that fails at 60 seconds having half-done the work.
 *
 * The message therefore says "queued", not "scanned". A button that claims to
 * have done something it has only scheduled is the same class of lie as an
 * invented figure, and the sources screen is where a user goes when they
 * already suspect nothing is running.
 *
 * ── When nothing is running ──────────────────────────────────────────────
 *
 * With no `CRON_SECRET` the tick endpoint refuses every request, so a queued
 * job would sit there forever. The action says so and does not enqueue, which
 * is the difference between "nothing happened" and "nothing will happen".
 */
export async function scanSourceNowAction(
  org: string,
  sourceId: string,
): Promise<ActionResult<{ queued: boolean }>> {
  const viewer = await currentViewer(org);
  if (!canSpend(viewer)) {
    return fail("Your role is read-only, so you cannot start a scan.");
  }

  return mutate(org, "scanSourceNow", async ({ db, orgId }) => {
    const parsed = uuidSchema.safeParse(sourceId);
    if (!parsed.success) return fail("That source reference isn't valid.");

    if (!isEngineRunning()) {
      return fail(
        "Nothing is running the scanner on this deployment. Set CRON_SECRET in " +
          "the project's environment variables — the schedule at " +
          "/api/jobs/tick refuses every request without it, so a queued scan " +
          "would never be picked up.",
      );
    }

    const { data: source, error } = await db
      .from("sources")
      .select("id, name, url, is_enabled")
      .eq("id", parsed.data)
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) return fail(`That source could not be read: ${error.message}`);
    if (!source) return fail("That source is no longer on your list.");
    if (!source.url) {
      return fail("That source has no URL, so there is nothing to read.");
    }
    if (!source.is_enabled) {
      return fail("That source is paused. Accept it first and it will be read.");
    }

    /* Due now, rather than enqueued directly: the sweeper is the one thing
       that decides what gets scanned, and having two writers to the queue with
       different ideas of "due" is how a source ends up scanned twice a tick.
       Setting next_scan_at is the same instruction the scheduler already
       understands. */
    const queued = await enqueueScan(db, orgId, String(source.id));

    await recordAudit(db, orgId, {
      action: "source.scanned",
      targetType: "source",
      targetId: String(source.id),
      meta: { name: source.name, manual: true },
    });

    revalidatePath(`/${org}/sources`);
    return ok(
      { queued },
      queued
        ? `${source.name} is queued. It is read on the next tick, within about five minutes.`
        : `${source.name} was already queued.`,
    );
  });
}

/**
 * How often a source is re-read.
 *
 * Five minutes is the floor, enforced by a CHECK in `0008` as well as here.
 * The reason for a floor at all is that this is somebody else's server: a
 * source polled every thirty seconds is a source whose operator blocks us, and
 * the setting that does it is one number in a dropdown.
 */
export async function setScanIntervalAction(
  org: string,
  sourceId: string,
  minutes: number,
): Promise<ActionResult<undefined>> {
  const parsed = scanIntervalSchema.safeParse(minutes);
  if (!parsed.success) {
    return fail("That isn't one of the intervals a source can be read on.");
  }

  return mutate(org, "setScanInterval", async ({ db, orgId }) => {
    const id = uuidSchema.safeParse(sourceId);
    if (!id.success) return fail("That source reference isn't valid.");

    const { error } = await db
      .from("sources")
      .update({ scan_interval_minutes: parsed.data })
      .eq("id", id.data)
      .eq("org_id", orgId)
      .is("deleted_at", null);

    if (error) return fail(`That interval could not be saved: ${error.message}`);

    revalidatePath(`/${org}/sources`);
    return ok(undefined, "Saved. It takes effect after the next scan.");
  });
}
