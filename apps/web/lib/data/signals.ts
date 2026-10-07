import "server-only";
import type { TenantClient } from "@huntloop/db";
import { currentUserId } from "./org";

/**
 * Record what a person did, for the learning layer (`0044`, K2/K3).
 *
 * The one write path for `preference_signals`, so three rules hold everywhere:
 *
 *   · only the person's own actions — the caller passes what *they* did; a
 *     prospect's email or a page they read is never a signal, because a
 *     preference learned from content would be an instruction anyone could
 *     plant (docs/product/personalization-plan.md §3.7);
 *   · "Pause learning" stops new signals at once (`profiles.learning_paused`);
 *   · it never fails the action it rides on. Learning is a side effect: an
 *     approval, an edit or a rejection that could fail because a signal could
 *     not be written would be the learning layer getting in the way of work.
 */

export type SignalKind =
  | "draft_edited"
  | "draft_rejected"
  | "draft_regenerated"
  | "assistant_correction"
  | "score_override"
  | "disqualified"
  | "question_answered"
  | "applied_dismissed"
  | "task_instruction";

export interface SignalInput {
  kind: SignalKind;
  subjectType?: string | null;
  subjectId?: string | null;
  note?: string | null;
  features?: Record<string, unknown>;
}

export async function recordSignal(
  db: TenantClient,
  orgId: string,
  signal: SignalInput,
): Promise<string | null> {
  try {
    const me = await currentUserId(db);
    if (!me) return null;

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("learning_paused")
      .eq("id", me)
      .maybeSingle();
    // Before `0044` there is nowhere to write; paused means nothing is written.
    if (profileError || (profile as { learning_paused?: boolean } | null)?.learning_paused) return null;

    const { data, error } = await db
      .from("preference_signals")
      .insert({
        org_id: orgId,
        user_id: me,
        kind: signal.kind,
        subject_type: signal.subjectType ?? null,
        subject_id: signal.subjectId ?? null,
        note: signal.note ? signal.note.slice(0, 1000) : null,
        features: signal.features ?? {},
      })
      .select("id")
      .single();
    if (error) {
      console.error(`recordSignal(${signal.kind}): ${error.message}`);
      return null;
    }
    return String(data.id);
  } catch (e) {
    console.error(`recordSignal(${signal.kind}): ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}
