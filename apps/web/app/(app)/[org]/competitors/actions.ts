"use server";

import { revalidatePath } from "next/cache";
import { canonicalizeDomain } from "@huntloop/db/identity";
import { recordAudit } from "../../../../lib/data/audit";
import { engineReadiness } from "../../../../lib/data/engine";
import { canSpend, currentViewer } from "../../../../lib/data/membership";
import { currentUserId, fail, mutate, ok, type ActionResult } from "../../../../lib/data/org";
import {
  competitorCreateSchema,
  competitorUpdateSchema,
  parseForm,
  parseInput,
  uuidSchema,
} from "../../../../lib/validation";

/**
 * Competitor writes — COMMAND.md §16.3-D.
 *
 * What a person owns here, and the model never does: the list itself, each
 * competitor's tier, and the two positioning sentences ("we win when…",
 * "they win when…"). Research writes the profile; it never touches these.
 */

function revalidate(org: string, id?: string) {
  revalidatePath(`/${org}/competitors`);
  if (id) revalidatePath(`/${org}/competitors/${id}`);
}

/** A domain as research needs it, or null; a value that is not one is an error. */
function domainOf(raw: string | undefined): { ok: true; value: string | null } | { ok: false } {
  if (!raw?.trim()) return { ok: true, value: null };
  const value = canonicalizeDomain(raw.trim());
  return value ? { ok: true, value } : { ok: false };
}

export async function addCompetitorAction(
  org: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = parseForm(competitorCreateSchema, input);
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);
  const domain = domainOf(parsed.value.domain);
  if (!domain.ok) return fail("That doesn't look like a website address.", { domain: "Use a domain like rival.com." });

  return mutate(org, "addCompetitor", async ({ db, orgId }) => {
    const userId = await currentUserId(db);
    const { data, error } = await db
      .from("competitors")
      .insert({
        org_id: orgId,
        name: parsed.value.name,
        domain: domain.value,
        tier: parsed.value.tier || null,
        origin: "user",
        status: "active",
        created_by: userId,
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") return fail("That competitor is already on your list.");
      return fail(`That competitor could not be added: ${error.message}`);
    }
    await recordAudit(db, orgId, {
      action: "competitor.added",
      targetType: "competitor",
      targetId: String(data.id),
      meta: { name: parsed.value.name },
    });
    revalidate(org);
    return ok({ id: String(data.id) }, `${parsed.value.name} added.`);
  });
}

export async function updateCompetitorAction(
  org: string,
  input: unknown,
): Promise<ActionResult<undefined>> {
  const parsed = parseForm(competitorUpdateSchema, input);
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);
  const v = parsed.value;
  const domain = domainOf(v.domain);
  if (!domain.ok) return fail("That doesn't look like a website address.", { domain: "Use a domain like rival.com." });

  return mutate(org, "updateCompetitor", async ({ db, orgId }) => {
    const { error } = await db
      .from("competitors")
      .update({
        name: v.name,
        domain: domain.value,
        tier: v.tier || null,
        our_advantage: v.ourAdvantage?.trim() || null,
        their_advantage: v.theirAdvantage?.trim() || null,
        prospect_customers: v.prospectCustomers,
      })
      .eq("id", v.id)
      .eq("org_id", orgId)
      .is("deleted_at", null);
    if (error) {
      if (error.code === "23505") return fail("Another competitor already has that name or domain.");
      return fail(`That competitor could not be saved: ${error.message}`);
    }
    revalidate(org, v.id);
    return ok(
      undefined,
      v.prospectCustomers
        ? "Saved. Customers they name on their own site will be researched after the next research run — never contacted automatically."
        : "Saved.",
    );
  });
}

/** Accept a proposed competitor, dismiss one, or bring a dismissed one back. */
export async function setCompetitorStatusAction(
  org: string,
  id: string,
  status: "active" | "dismissed",
): Promise<ActionResult<undefined>> {
  const parsed = parseInput(uuidSchema, id, "competitor");
  if (!parsed.ok) return fail(parsed.error);
  if (status !== "active" && status !== "dismissed") return fail("That isn't a status a competitor can have.");

  return mutate(org, "setCompetitorStatus", async ({ db, orgId }) => {
    const { error } = await db
      .from("competitors")
      .update({ status, ...(status === "dismissed" ? { prospect_customers: false, research_requested_at: null } : {}) })
      .eq("id", parsed.value)
      .eq("org_id", orgId)
      .is("deleted_at", null);
    if (error) return fail(`That could not be changed: ${error.message}`);
    revalidate(org, parsed.value);
    return ok(
      undefined,
      status === "active"
        ? "On your list. Its signals now count in scoring rules."
        : "Dismissed. Its signals no longer count, and it is not researched.",
    );
  });
}

/**
 * "Research" — read the competitor's own site. Queued through the request
 * column (0039), which `schedule_followups` turns into a job; the request
 * path may not enqueue. Refused when nothing would pick it up.
 */
export async function requestCompetitorResearchAction(
  org: string,
  id: string,
): Promise<ActionResult<undefined>> {
  const parsed = parseInput(uuidSchema, id, "competitor");
  if (!parsed.ok) return fail(parsed.error);

  const viewer = await currentViewer(org);
  if (!canSpend(viewer)) return fail("Your role is read-only, so you cannot start research.");

  return mutate(org, "requestCompetitorResearch", async ({ db, orgId }) => {
    const { data: row } = await db
      .from("competitors")
      .select("id, domain, status")
      .eq("id", parsed.value)
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!row) return fail("That competitor is no longer on your list.");
    if (row.status === "dismissed") return fail("That competitor is dismissed. Restore it first.");
    if (!row.domain) return fail("Add their website first — research reads their own site.");

    const engine = await engineReadiness(db, orgId);
    if (!engine.driven) {
      return fail("Nothing is running the engine for this workspace yet, so research would never start.");
    }

    const { error } = await db
      .from("competitors")
      .update({ research_requested_at: new Date().toISOString() })
      .eq("id", parsed.value)
      .eq("org_id", orgId);
    if (error) return fail(`Research could not be requested: ${error.message}`);
    revalidate(org, parsed.value);
    return ok(undefined, "Research requested. It starts on the engine's next run, usually within a few minutes.");
  });
}

export async function deleteCompetitorAction(
  org: string,
  id: string,
): Promise<ActionResult<undefined>> {
  const parsed = parseInput(uuidSchema, id, "competitor");
  if (!parsed.ok) return fail(parsed.error);

  return mutate(org, "deleteCompetitor", async ({ db, orgId }) => {
    const { error } = await db
      .from("competitors")
      .update({ deleted_at: new Date().toISOString(), prospect_customers: false, research_requested_at: null })
      .eq("id", parsed.value)
      .eq("org_id", orgId);
    if (error) return fail(`That competitor could not be removed: ${error.message}`);
    await recordAudit(db, orgId, {
      action: "competitor.removed",
      targetType: "competitor",
      targetId: parsed.value,
    });
    revalidate(org);
    return ok(undefined, "Removed.");
  });
}
