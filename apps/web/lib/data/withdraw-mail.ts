import "server-only";
import type { TenantClient } from "@huntloop/db";

/**
 * OUT-201: a person withdrew this outreach, so its queued mail says so now.
 *
 * `send_message` is the guard that matters: it re-reads the enrollment,
 * campaign, opportunity and workspace before anything leaves, and refuses
 * mail none of them still want. This is for the inbox. Without it, a message
 * deferred until tomorrow's business hours would go on reading "Waiting to
 * send" after the person pressed Stop, until the send job finally ran and
 * closed it out.
 *
 * Only unsent, unclaimed outbound mail is touched. A message whose send was
 * claimed may already be in the recipient's inbox, and is left for
 * `send_message`'s "delivery unknown" path.
 *
 * Best effort: the guard at send time does not depend on this write.
 */
export async function withdrawQueuedMail(
  db: TenantClient,
  orgId: string,
  enrollmentIds: string[],
  why: string,
): Promise<void> {
  if (enrollmentIds.length === 0) return;
  await db
    .from("messages")
    .update({ error: `Not sent: ${why}`.slice(0, 2000) })
    .eq("org_id", orgId)
    .in("enrollment_id", enrollmentIds)
    .eq("direction", "outbound")
    .is("sent_at", null)
    .is("send_attempted_at", null)
    .is("deleted_at", null);
}

/** The live enrollments of one opportunity, for {@link withdrawQueuedMail}. */
export async function enrollmentsOf(db: TenantClient, orgId: string, opportunityId: string): Promise<string[]> {
  const { data } = await db
    .from("enrollments")
    .select("id")
    .eq("org_id", orgId)
    .eq("opportunity_id", opportunityId)
    .is("deleted_at", null)
    .limit(50);
  return ((data ?? []) as { id: string }[]).map((r) => String(r.id));
}
