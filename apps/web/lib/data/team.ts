import "server-only";
import type { TenantClient } from "@huntloop/db";
import { OPPORTUNITIES } from "../fixtures/opportunities";
import type { Role } from "./membership";
import { currentUserId, requireOrgId } from "./org";
import { load, type Loaded } from "./source";

/**
 * The team — master context §38, and the role enum from `0001`.
 *
 * ── Where the names come from ────────────────────────────────────────────
 *
 * `memberships` holds `user_id`, `role` and the invite trail. Names and email
 * addresses live in `auth.users`, which Supabase does not expose through
 * PostgREST and which would need the service-role client `apps/web` is
 * forbidden to import.
 *
 * `0007` closes that with `profiles`: one row per user, written by a trigger
 * on `auth.users`, readable only by people who share an org with you. So this
 * loader joins on a uuid it already has and gets back a name.
 *
 * The fallback is still the uuid, and that is deliberate. A profile row can
 * legitimately have no name — a magic-link signup supplies an address and
 * nothing else — and showing the address, or failing that the id, is true.
 * Inventing a display name from a uuid would be the §7 failure aimed at our
 * own interface.
 */

export interface Member {
  id: string;
  userId: string;
  role: Role;
  joinedAt: string | null;
  /** From `profiles`. Null when the user has never supplied one. */
  name: string | null;
  email: string | null;
  /** True for the signed-in user. */
  isYou: boolean;
}

export async function listMembers(orgSlug: string): Promise<Loaded<Member[]>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "listMembers");
      const viewerId = await currentUserId(db);

      const { data, error } = await db
        .from("memberships")
        .select("id, user_id, role, created_at")
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });

      if (error) throw new Error(`listMembers: ${error.message}`);

      const rows = data ?? [];
      /* A second query rather than an embed. `memberships.user_id` and
         `profiles.id` both reference `auth.users`; neither references the
         other, so there is no foreign key for PostgREST to embed through and
         asking for one returns an error rather than a join. */
      const profiles = await loadProfiles(
        db,
        rows.map((r) => String(r.user_id)),
      );

      return rows.map((row) => {
        const profile = profiles.get(String(row.user_id));
        return {
          id: String(row.id),
          userId: String(row.user_id),
          role: ROLES.includes(row.role as Role) ? (row.role as Role) : "viewer",
          joinedAt: row.created_at ?? null,
          name: profile?.name ?? null,
          email: profile?.email ?? null,
          isYou: String(row.user_id) === viewerId,
        };
      });
    },
    () => DEMO_MEMBERS,
  );
}

const ROLES: readonly Role[] = ["owner", "admin", "member", "viewer"];

/* ── Assignments ─────────────────────────────────────────────────────────── */

/**
 * An opportunity and who owns it.
 *
 * `opportunities.owner_id` references `auth.users`, and `profiles` resolves
 * it to a person for the same reason it does on the members list: an
 * assignment screen that can only distinguish "you" from "somebody" cannot be
 * used to hand work to a named colleague, which is the entire task.
 */
export interface Assignment {
  id: string;
  company: string;
  priority: "hot" | "warm" | "watch" | "ignore";
  priorityReason: string;
  status: string;
  ownerId: string | null;
  ownerName: string | null;
  ownerIsYou: boolean;
}

export async function listAssignments(orgSlug: string): Promise<Loaded<Assignment[]>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "listAssignments");
      const viewerId = await currentUserId(db);

      const { data, error } = await db
        .from("opportunities")
        .select("id, priority, priority_reason, status, owner_id, companies!inner(name)")
        .eq("org_id", orgId)
        .is("deleted_at", null)
        // Same ordering rule as the opportunity list: the verdict ranks, and
        // recency breaks ties. Unassigned work should be triaged in the order
        // it would be worked, not in insertion order.
        .order("priority", { ascending: true })
        .order("first_seen_at", { ascending: false });

      if (error) throw new Error(`listAssignments: ${error.message}`);

      const rows = data ?? [];
      const profiles = await loadProfiles(
        db,
        rows.map((r) => r.owner_id).filter(Boolean) as string[],
      );

      /* eslint-disable @typescript-eslint/no-explicit-any --
         The row type for a nested select is generated from a live project's
         schema. Confined to this mapping. */
      return rows.map((row: any) => {
        const company = Array.isArray(row.companies) ? row.companies[0] : row.companies;
        const owner = row.owner_id ? profiles.get(String(row.owner_id)) : undefined;
        return {
          id: String(row.id),
          company: String(company?.name ?? "Unknown company"),
          priority: row.priority,
          priorityReason: String(row.priority_reason ?? ""),
          status: String(row.status ?? "discovered"),
          ownerId: row.owner_id ?? null,
          ownerName: owner?.name ?? owner?.email ?? null,
          ownerIsYou: Boolean(row.owner_id) && String(row.owner_id) === viewerId,
        };
      });
      /* eslint-enable @typescript-eslint/no-explicit-any */
    },
    () => DEMO_ASSIGNMENTS,
  );
}

/** The signed-in user's id, used only to mark a row as yours. */
/**
 * uuid → name and email, for the ids on this page only.
 *
 * The `in` filter matters as much as the RLS policy behind it. `profiles` is
 * readable for every user who shares *any* org with you, so an unfiltered
 * select on a screen scoped to one org would also return your colleagues from
 * the others — correct by policy, wrong by page.
 *
 * A read failure yields an empty map rather than throwing: names are a display
 * concern, and losing the whole members screen because one lookup failed is a
 * worse outcome than showing uuids for a render.
 */
async function loadProfiles(
  db: TenantClient,
  userIds: string[],
): Promise<Map<string, { name: string | null; email: string | null }>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return new Map();

  const { data, error } = await db
    .from("profiles")
    .select("id, full_name, email")
    .in("id", ids);

  if (error) return new Map();

  return new Map(
    (data ?? []).map((row) => [
      String(row.id),
      {
        name: ((row.full_name as string | null) ?? "").trim() || null,
        email: ((row.email as string | null) ?? "").trim() || null,
      },
    ]),
  );
}

/* ── Invitations (0007) ──────────────────────────────────────────────────── */

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  invitedByName: string | null;
  createdAt: string;
  expiresAt: string;
  /**
   * True once past `expires_at`. Shown rather than filtered out: an
   * invitation that lapsed is usually the answer to "why has nobody joined?",
   * and hiding it turns that into a mystery.
   */
  expired: boolean;
}

/**
 * Invitations still awaiting an answer.
 *
 * Admin-only by policy, not by this query — `invitation_admin` in `0007` is
 * `has_org_role(org_id, 'admin')`, so a member calling it gets zero rows
 * rather than a refusal. The screen renders that as the section not being
 * there, which is the truthful reading of the row count it was given.
 */
export async function listInvitations(orgSlug: string): Promise<Loaded<Invitation[]>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "listInvitations");

      const { data, error } = await db
        .from("invitations")
        .select("id, email, role, invited_by, created_at, expires_at")
        .eq("org_id", orgId)
        .is("accepted_at", null)
        .is("revoked_at", null)
        .order("created_at", { ascending: false });

      if (error) throw new Error(`listInvitations: ${error.message}`);

      const rows = data ?? [];
      const profiles = await loadProfiles(
        db,
        rows.map((r) => r.invited_by).filter(Boolean) as string[],
      );
      const now = Date.now();

      return rows.map((row) => {
        const by = row.invited_by ? profiles.get(String(row.invited_by)) : undefined;
        return {
          id: String(row.id),
          email: String(row.email),
          role: ROLES.includes(row.role as Role) ? (row.role as Role) : "member",
          invitedByName: by?.name ?? by?.email ?? null,
          createdAt: String(row.created_at),
          expiresAt: String(row.expires_at),
          expired: new Date(String(row.expires_at)).getTime() < now,
        };
      });
    },
    () => [],
  );
}

/* ── Demo ────────────────────────────────────────────────────────────────── */

const DEMO_MEMBERS: Member[] = [
  {
    id: "demo-member-1",
    userId: "00000000-0000-4000-8000-000000000001",
    role: "owner",
    joinedAt: null,
    name: "Dana Whitfield",
    email: "dana@example.com",
    isYou: true,
  },
  {
    id: "demo-member-2",
    userId: "00000000-0000-4000-8000-000000000002",
    role: "member",
    joinedAt: null,
    name: "Rafi Osman",
    email: "rafi@example.com",
    isYou: false,
  },
  {
    /* No name, on purpose. A magic-link signup supplies an address and nothing
       else, so "an account with an email and no name" is a state the members
       screen has to render — and the demo is the only place it can be seen
       without creating one. */
    id: "demo-member-3",
    userId: "00000000-0000-4000-8000-000000000003",
    role: "viewer",
    joinedAt: null,
    name: null,
    email: "viewer@example.com",
    isYou: false,
  },
];

/**
 * Derived from the opportunity fixtures rather than written again, so the
 * assignment screen and the opportunity list cannot disagree about what work
 * exists. One is deliberately unowned — an assignment screen where everything
 * is already assigned shows none of what it is for.
 */
const DEMO_ASSIGNMENTS: Assignment[] = OPPORTUNITIES.map((o, i) => ({
  id: o.id,
  company: o.company,
  priority: o.priority,
  priorityReason: o.priorityReason,
  status: o.status,
  ownerId: i === 0 ? "00000000-0000-4000-8000-000000000001" : null,
  ownerName: i === 0 ? "Dana Whitfield" : null,
  ownerIsYou: i === 0,
}));
