import type { AuditAction } from "./data/audit";

/**
 * What each audit action reads as on the Activity log.
 *
 * A `Record` over the closed `AuditAction` union rather than a switch with a
 * default, so adding an action to `audit.ts` without a label here is a type
 * error. A default branch would print the raw `subject.verb` for whichever
 * action somebody forgot, which is the one row an admin is most likely to be
 * looking for.
 */
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  "member.role_changed": "Changed a member's role",
  "member.removed": "Removed a member",
  "member.invited": "Invited someone",
  "member.invite_revoked": "Revoked an invitation",
  "member.invite_accepted": "Accepted an invitation",
  "opportunity.assigned": "Assigned an opportunity",
  "opportunity.created": "Created an opportunity",
  "opportunity.deleted": "Deleted an opportunity",
  "opportunity.status_changed": "Changed an opportunity's status",
  "opportunity.enrolled": "Enrolled an opportunity in a campaign",
  "organization.updated": "Updated workspace settings",
  "organization.plan_changed": "Changed the plan",
  "mailbox.connected": "Connected a mailbox",
  "mailbox.disconnected": "Disconnected a mailbox",
  "campaign.started": "Started a campaign",
  "campaign.paused": "Paused a campaign",
  "suppression.added": "Added an address to the do-not-contact list",
  "suppression.removed": "Removed an address from the do-not-contact list",
  "source.scanned": "Scanned a source",
  "ai.decision_overridden": "Overrode an AI decision",
  "data.exported": "Exported data",
  "competitor.added": "Added a competitor",
  "competitor.removed": "Removed a competitor",
  "icp.proposal_applied": "Applied an ICP proposal",
};

/**
 * Rows written by SQL rather than through `recordAudit` (an erasure from
 * `erase_contact`, say) can carry actions outside the TypeScript union. They
 * are shown as written instead of being dropped: a log that hides entries it
 * does not recognise is not a log.
 */
const SQL_ACTION_LABELS: Record<string, string> = {
  /* 0017's `erase_contact`. Its row keeps a hash, never the address. */
  "contact.erased": "Erased a person's data",
};

export function describeAuditAction(action: string): string {
  return (
    (AUDIT_ACTION_LABELS as Record<string, string>)[action] ??
    SQL_ACTION_LABELS[action] ??
    action
  );
}
