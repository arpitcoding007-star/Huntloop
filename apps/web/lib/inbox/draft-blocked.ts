/**
 * Why approving a sequence draft would send nothing, or null when it can go
 * (PANEL-304). The same parents `send_message`'s `withdrawnOrHeld` asks about;
 * this says it before the click instead of after. A paused campaign is not
 * blocked: an approved message waits for it.
 */
const CLOSED = new Set(["won", "lost", "archived"]);

type Row = Record<string, unknown> | null | undefined;
const one = (v: unknown): Row => (Array.isArray(v) ? v[0] : v) as Row;

export function draftBlocked(enrollment: unknown): string | null {
  const e = one(enrollment);
  if (!e || e.deleted_at) return "The sequence it belongs to was removed.";
  const campaign = one(e.campaigns);
  if (!campaign || campaign.deleted_at || campaign.status === "archived") return "Its campaign was archived.";
  const opportunity = one(e.opportunities);
  if (!opportunity || opportunity.deleted_at) return "Its opportunity was removed.";
  if (CLOSED.has(String(opportunity.status))) return `Its opportunity is ${String(opportunity.status)}.`;
  if (e.status === "stopped" || e.status === "completed") return "Its sequence was stopped.";
  return null;
}
