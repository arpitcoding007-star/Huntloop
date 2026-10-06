/**
 * The activity ledger’s vocabulary (migration 0037), as values.
 *
 * A subpath of its own (`@huntloop/db/activity`) because client components
 * render these labels and must not import the package root, which carries the
 * server client. Pure data: no imports, no I/O.
 */

/** Every kind `activities.kind` accepts. The SQL check is the authority. */
export const ACTIVITY_KINDS = [
  "discovered",
  "email_sent",
  "email_received",
  "email_bounced",
  "email_complained",
  "email_unsubscribed",
  "draft_rejected",
  "stage_changed",
  "priority_changed",
  "owner_changed",
  "override_recorded",
  "outcome_recorded",
  "note",
  "call",
  "meeting",
  "message",
  "connection_request",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** The kinds a person may log by hand; everything else is written by a trigger. */
export const MANUAL_ACTIVITY_KINDS = [
  "note",
  "call",
  "meeting",
  "message",
  "connection_request",
] as const satisfies readonly ActivityKind[];
export type ManualActivityKind = (typeof MANUAL_ACTIVITY_KINDS)[number];

export const ACTIVITY_CHANNELS = [
  "email",
  "linkedin",
  "phone",
  "meeting",
  "chat",
  "other",
  "system",
] as const;
export type ActivityChannel = (typeof ACTIVITY_CHANNELS)[number];

export type ActivityDirection = "outbound" | "inbound" | "internal";

/** Why a deal ended — `outcomes.reason_category`. */
export const REASON_CATEGORIES = [
  "no_need",
  "no_budget",
  "timing",
  "chose_competitor",
  "missing_capability",
  "no_response",
  "not_a_fit",
  "wrong_contact",
  "other",
] as const;
export type ReasonCategory = (typeof REASON_CATEGORIES)[number];

