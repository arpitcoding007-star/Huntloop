/**
 * Autonomy 2, "Approve the first": a person approves the opening message, and
 * follow-ups then go on their own.
 *
 * Asked where a message is queued (`advance_enrollments`) and again where it
 * is sent (`send_message`), because a message queued before the level was
 * lowered to 2 carries a `scheduled_at` nobody gave it.
 */
import type { OrgScope } from "./scope.ts";

export const APPROVE_FIRST = 2;

/**
 * Has a person approved a message in this sequence? Keyed on `approved_by`
 * rather than the step's position: a rejected opening, a sequence that begins
 * with a wait, and a campaign lowered from a higher level are all still
 * sequences nobody has approved.
 *
 * Throws when it cannot be read, so the job retries. Neither answer is safe
 * to guess.
 */
export async function openingApproved(scope: OrgScope, enrollmentId: string): Promise<boolean> {
  const { data, error } = await scope
    .select("messages", "id")
    .eq("enrollment_id", enrollmentId)
    .eq("direction", "outbound")
    .not("approved_by", "is", null)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`the opening message's approval could not be read: ${error.message}`);
  return Boolean(data);
}
