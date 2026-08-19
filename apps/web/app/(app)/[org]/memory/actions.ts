"use server";

import { revalidatePath } from "next/cache";
import { fail, mutate, ok, type ActionResult } from "../../../../lib/data/org";
import { memorySchema, parseForm, uuidSchema } from "../../../../lib/validation";

/**
 * Memory writes — master context §37, §54, and `0004`.
 *
 * ── The one rule this file has to get right ──────────────────────────────
 *
 * `memories_scope_id_presence`: organization scope takes no subject, and every
 * other scope requires one. It is a check constraint, so a wrong pairing is
 * refused by the database — but it would be refused as a constraint-violation
 * string, and the user would read a Postgres error where an explanation
 * belongs. So the pairing is checked here and reported in the terms the screen
 * uses, and the constraint stays as the thing that makes it true.
 *
 * The reason it matters is not tidiness. A user-scoped memory with a NULL
 * `scope_id` matches *every* user's retrieval filter — one person's private
 * note becomes everybody's context. That is the §37 leak the column exists to
 * prevent.
 *
 * ── Why `source` is always 'user' here ───────────────────────────────────
 *
 * The other value is `derived`, which means the product concluded it. A person
 * typing into a form has not derived anything, and letting this action write
 * `derived` would put hand-written notes into the same bucket the learning
 * loop treats as its own output. §7, applied to our own memory.
 */

export interface MemoryInput {
  id?: string;
  scope: "organization" | "team" | "user" | "account" | "opportunity";
  scopeId: string | null;
  key: string;
  content: string;
}

export async function saveMemoryAction(
  org: string,
  input: MemoryInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = parseForm(memorySchema, input);
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);
  const value = parsed.value;

  const isOrgScope = value.scope === "organization";
  const scopeId = value.scopeId?.trim() ? value.scopeId.trim() : null;

  if (isOrgScope && scopeId) {
    return fail("An organisation-wide memory has no subject.", {
      scopeId:
        "Leave this empty — organisation scope means the org itself, so there is nothing to point at.",
    });
  }
  if (!isOrgScope && !scopeId) {
    return fail(`A ${value.scope}-scoped memory needs a subject.`, {
      scopeId: `Which ${value.scope} is this about? Without it, this memory would be retrieved for every one of them.`,
    });
  }
  if (scopeId && !uuidSchema.safeParse(scopeId).success) {
    return fail("That subject reference isn't valid.", {
      scopeId: "This has to be the id of the thing the memory is about.",
    });
  }

  return mutate(org, "saveMemory", async ({ db, orgId }) => {
    const row = {
      org_id: orgId,
      scope: value.scope,
      scope_id: scopeId,
      key: value.key || null,
      content: value.content,
      source: "user" as const,
    };

    if (value.id) {
      const { error } = await db
        .from("memories")
        .update(row)
        .eq("id", value.id)
        .eq("org_id", orgId)
        .is("deleted_at", null);
      if (error) return fail(scopeError(error, "saved"));

      revalidatePath(`/${org}/memory`);
      return ok({ id: value.id }, "Memory saved.");
    }

    const { data, error } = await db
      .from("memories")
      .insert(row)
      .select("id")
      .single();
    if (error) return fail(scopeError(error, "created"));

    revalidatePath(`/${org}/memory`);
    return ok({ id: String(data.id) }, "Memory added.");
  });
}

/**
 * The check constraint said plainly.
 *
 * The guards above should make this unreachable. It is here because "should be
 * unreachable" is how a raw `23514` reaches a user — and because the
 * constraint, not the guard, is what actually holds.
 */
function scopeError(error: { code?: string; message: string }, verb: string): string {
  if (error.code === "23514" && /scope_id_presence/.test(error.message)) {
    return "That scope and subject don't go together: an organisation-wide memory takes no subject, and every other scope needs one.";
  }
  return `That memory could not be ${verb}: ${error.message}`;
}

/**
 * Soft delete.
 *
 * `deleted_at` rather than `delete from`, and `memories_retrieval_idx` is a
 * partial index on `deleted_at is null` — so a soft-deleted memory leaves the
 * retrieval path immediately. Keeping the row means a memory removed by
 * mistake is recoverable, which matters more here than elsewhere: nobody can
 * reconstruct what the agent used to know.
 */
export async function deleteMemoryAction(
  org: string,
  id: string,
): Promise<ActionResult<undefined>> {
  return mutate(org, "deleteMemory", async ({ db, orgId }) => {
    const parsed = uuidSchema.safeParse(id);
    if (!parsed.success) return fail("That memory reference isn't valid.");

    const { error } = await db
      .from("memories")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", parsed.data)
      .eq("org_id", orgId);

    if (error) return fail(`That memory could not be removed: ${error.message}`);

    revalidatePath(`/${org}/memory`);
    return ok(undefined, "Memory removed. The agent will stop using it.");
  });
}
