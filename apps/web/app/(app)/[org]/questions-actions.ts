"use server";

import { revalidatePath } from "next/cache";
import { currentUserId, fail, mutate, ok, type ActionResult } from "../../../lib/data/org";
import { recordSignal } from "../../../lib/data/signals";
import { questionByKey } from "../../../lib/questions/catalog";
import { SNOOZE_DAYS } from "../../../lib/questions/planner";

/**
 * Answering and declining just-in-time questions (K4). The answer is checked
 * against the catalog — a choice must be one of its values, text is bounded —
 * and becomes a *stated* preference, written in the catalog's words, never in
 * words the request supplies. Every write is the caller's own.
 */

const PERSONAL = { minRole: "viewer" as const };

export async function answerQuestionAction(
  org: string,
  key: string,
  answer: string,
): Promise<ActionResult<undefined>> {
  const q = questionByKey(key);
  if (!q) return fail("That question isn't one Huntloop asks.");
  const text = String(answer ?? "").trim();

  let preference: string | null;
  if (q.input.kind === "choice") {
    const choice = q.input.choices.find((c) => c.value === text);
    if (!choice) return fail("Pick one of the options.");
    preference = choice.preference;
  } else {
    if (!text) return fail("Type an answer, or press Not now.");
    if (text.length > q.input.maxLength) return fail(`Keep it under ${q.input.maxLength} characters.`);
    preference = q.writes.template!(text);
  }

  return mutate(
    org,
    "answerQuestion",
    async ({ db, orgId }) => {
      const me = await currentUserId(db);
      if (!me) return fail("Your session expired. Sign in again.");

      let memoryId: string | null = null;
      if (preference) {
        const { data, error } = await db
          .from("memories")
          .insert({
            org_id: orgId,
            scope: "user",
            scope_id: me,
            kind: "durable",
            key: q.writes.key,
            content: preference,
            category: q.writes.category,
            applies_to: q.writes.appliesTo,
            origin: "stated",
            source: "user",
            status: "active",
          })
          .select("id")
          .single();
        if (error) return fail(`That could not be saved: ${error.message}`);
        memoryId = String(data.id);
      }

      const { error: stateError } = await db.from("user_questions").upsert(
        {
          org_id: orgId,
          user_id: me,
          question_key: q.key,
          status: "answered",
          answered_at: new Date().toISOString(),
          answer: { value: q.input.kind === "choice" ? text : null },
          memory_id: memoryId,
        },
        { onConflict: "org_id,user_id,question_key" },
      );
      if (stateError) return fail(`That could not be saved: ${stateError.message}`);

      await recordSignal(db, orgId, { kind: "question_answered", subjectType: "question", note: q.key });
      revalidatePath(`/${org}`, "layout");
      return ok(undefined, preference ? "Thanks — Huntloop will work that way for you. Change it any time under Settings → You." : "Thanks — noted.");
    },
    PERSONAL,
  );
}

export async function declineQuestionAction(
  org: string,
  key: string,
  mode: "later" | "never",
): Promise<ActionResult<undefined>> {
  const q = questionByKey(key);
  if (!q) return fail("That question isn't one Huntloop asks.");
  if (mode !== "later" && mode !== "never") return fail("That isn't an option.");

  return mutate(
    org,
    "declineQuestion",
    async ({ db, orgId }) => {
      const me = await currentUserId(db);
      if (!me) return fail("Your session expired. Sign in again.");
      const { error } = await db.from("user_questions").upsert(
        {
          org_id: orgId,
          user_id: me,
          question_key: q.key,
          status: mode === "never" ? "dismissed" : "snoozed",
          snooze_until: mode === "later" ? new Date(Date.now() + SNOOZE_DAYS * 86_400_000).toISOString() : null,
        },
        { onConflict: "org_id,user_id,question_key" },
      );
      if (error) return fail(`That could not be saved: ${error.message}`);
      revalidatePath(`/${org}`, "layout");
      return ok(undefined);
    },
    PERSONAL,
  );
}
