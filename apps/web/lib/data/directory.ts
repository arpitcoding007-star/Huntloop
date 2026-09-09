import "server-only";
import { resolveDataSource } from "./source";
import { hasOnboardingSchema } from "./onboarding-schema";
import { fail, mutate, ok, type ActionResult } from "./org";

/**
 * Workspaces at the caller's own company, and asking to join one.
 *
 * ── The failure this prevents ────────────────────────────────────────────
 *
 * A second person at a customer signs up, sees an empty onboarding flow, and
 * builds a *second workspace* for a company that already has one — with its
 * own ICP, its own sources, and its own provider bill. Nobody finds out until
 * two colleagues describe the same pipeline differently.
 *
 * ── Why it needs `0027` and could not be done in application code ────────
 *
 * RLS resolves every organisation read through `user_org_ids()`, so a user who
 * is not a member of an org cannot learn that it exists. That is correct, and
 * it is exactly what makes the duplicate undetectable from here. The
 * SECURITY DEFINER function is the narrow, audited exception: it answers only
 * for the caller's *own verified email domain*, returns only a name, a slug
 * and a member count, and takes no argument for a caller to tamper with.
 */

export interface DiscoverableWorkspace {
  orgId: string;
  name: string;
  slug: string;
  memberCount: number;
}

/**
 * Workspaces at this person's email domain that they are not already in.
 *
 * Empty is by far the commonest answer and is not an error — most people are
 * the first at their company. Every caller renders nothing for it.
 */
export async function listDiscoverableWorkspaces(): Promise<DiscoverableWorkspace[]> {
  const { db } = await resolveDataSource();
  if (!db) return [];

  // Before `0027` the function does not exist, and calling it would surface a
  // PostgREST error on a screen where the honest answer is "nothing found".
  if (!(await hasOnboardingSchema(db))) return [];

  const { data, error } = await db.rpc("discoverable_workspaces");
  if (error || !Array.isArray(data)) return [];

  return (data as {
    org_id: string;
    org_name: string;
    org_slug: string;
    member_count: number | string;
  }[]).map((row) => ({
    orgId: String(row.org_id),
    name: String(row.org_name),
    slug: String(row.org_slug),
    memberCount: Number(row.member_count ?? 0),
  }));
}

/**
 * Ask an existing workspace to let you in.
 *
 * ── Why this does not use `mutate` ───────────────────────────────────────
 *
 * `mutate` resolves the caller's membership of the org and refuses without
 * one — which is right for every other write in the product and exactly wrong
 * here. The whole premise is a caller who is *not* a member. The authorization
 * lives in `request_to_join`, which refuses any org the caller could not have
 * seen through `discoverable_workspaces()`.
 */
export async function requestToJoin(orgId: string): Promise<ActionResult<undefined>> {
  const { db } = await resolveDataSource();
  if (!db) return fail("This deployment has no database connected.");

  const { error } = await db.rpc("request_to_join", { p_org: orgId });

  if (error) {
    /* The function raises with a sentence — "that workspace is not one you can
       ask to join" — and that sentence is the whole explanation. The prefix
       Postgres adds is stripped for the same reason `accept_invitation`'s is. */
    return fail(error.message.replace(/^.*?:\s*/, ""));
  }

  return ok(undefined);
}

/* ── What each workspace is costing ──────────────────────────────────────── */

export interface WorkspaceUsage {
  orgId: string;
  /** This calendar month, keyed by metric. Absent metrics have not been used. */
  used: Record<string, number>;
}

/**
 * This month's usage for every workspace the caller belongs to.
 *
 * ── Why an agency needs this and nobody else does much ───────────────────
 *
 * Somebody with one workspace has a usage screen inside it. An agency with ten
 * has ten screens and no way to answer "what did this client cost me", which
 * is the question that decides what they invoice. The `/for/agencies` page
 * names cross-workspace billing as something Huntloop does not do; this is the
 * half of it that is real today, and it is the actionable half — a per-client
 * number an agency can put on their own invoice.
 *
 * ── Why this is not billing ──────────────────────────────────────────────
 *
 * Because there is no billing. `subscriptions` has existed since `0001` and
 * nothing reads it; the Stripe variables in `.env.example` are reserved and
 * unused. Building a "billing group" abstraction on top of a billing system
 * that does not exist would be a speculative abstraction whose first real
 * requirement would break it. Usage is a fact the schema already records, so
 * that is what this reports.
 *
 * One query rather than one per workspace: `usage_read` in `0001` scopes
 * `usage_counters` to the caller's orgs, so a single `in` filter returns
 * exactly what they may see and nothing else.
 */
export async function listWorkspaceUsage(
  orgIds: string[],
): Promise<Map<string, WorkspaceUsage>> {
  const empty = new Map<string, WorkspaceUsage>();
  if (orgIds.length === 0) return empty;

  const { db } = await resolveDataSource();
  if (!db) return empty;

  /* `YYYY-MM` in UTC, matching how `increment_usage` writes the period. A
     locally-formatted month would disagree with the counter for the first
     hours of every month in half the world's timezones. */
  const period = new Date().toISOString().slice(0, 7);

  const { data, error } = await db
    .from("usage_counters")
    .select("org_id, metric, used")
    .in("org_id", orgIds)
    .eq("period", period);

  if (error || !data) return empty;

  for (const row of data as { org_id: string; metric: string; used: number }[]) {
    const orgId = String(row.org_id);
    const entry = empty.get(orgId) ?? { orgId, used: {} };
    entry.used[String(row.metric)] = Number(row.used ?? 0);
    empty.set(orgId, entry);
  }

  return empty;
}

/* ── The other side: an admin deciding ───────────────────────────────────── */

export interface PendingJoinRequest {
  id: string;
  email: string;
  requestedAt: string;
}

/**
 * Requests waiting on this org's admins.
 *
 * Readable through `join_request_admin` from `0027`, so this needs no
 * privileged client — a member who is not an admin gets an empty list from
 * RLS rather than a refusal, which is the correct shape for a panel that
 * simply does not render for them.
 */
export async function listPendingJoinRequests(
  orgSlug: string,
): Promise<PendingJoinRequest[]> {
  const { db } = await resolveDataSource();
  if (!db) return [];
  if (!(await hasOnboardingSchema(db))) return [];

  const { data: org } = await db
    .from("organizations")
    .select("id")
    .eq("slug", orgSlug)
    .maybeSingle();

  if (!org) return [];

  const { data, error } = await db
    .from("join_requests")
    .select("id, email, created_at")
    .eq("org_id", (org as { id: string }).id)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error || !data) return [];

  return (data as { id: string; email: string; created_at: string }[]).map((row) => ({
    id: String(row.id),
    email: String(row.email),
    requestedAt: row.created_at,
  }));
}

export async function approveJoinRequest(
  orgSlug: string,
  requestId: string,
): Promise<ActionResult<undefined>> {
  /* `minRole: "admin"` because letting somebody into the workspace is an
     administrative act, and `0027`'s policy agrees — a member's update finds
     no row. Asking here turns that into a sentence rather than a silent
     no-op. */
  return mutate(
    orgSlug,
    "approveJoinRequest",
    async ({ db }) => {
      const { error } = await db.rpc("approve_join_request", { p_request: requestId });
      if (error) return fail(error.message.replace(/^.*?:\s*/, ""));
      return ok(undefined);
    },
    { minRole: "admin" },
  );
}

export async function declineJoinRequest(
  orgSlug: string,
  requestId: string,
): Promise<ActionResult<undefined>> {
  return mutate(
    orgSlug,
    "declineJoinRequest",
    async ({ db, orgId }) => {
      /* Declined rather than deleted. The partial unique index only covers
         `pending`, so the person can ask again if circumstances change — and
         an admin can see that a decision was made rather than wondering
         whether the request was ever received. */
      const { error } = await db
        .from("join_requests")
        .update({ status: "declined", decided_at: new Date().toISOString() })
        .eq("id", requestId)
        .eq("org_id", orgId)
        .eq("status", "pending");

      if (error) return fail(`That request could not be declined: ${error.message}`);
      return ok(undefined);
    },
    { minRole: "admin" },
  );
}
