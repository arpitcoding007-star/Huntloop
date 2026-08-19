import "server-only";
import type { TenantClient } from "@huntloop/db";
import { OPPORTUNITIES } from "../fixtures/opportunities";
import type { Role } from "./membership";
import { requireOrgId } from "./org";
import { load, type Loaded } from "./source";

/**
 * The team — master context §38, and the role enum from `0001`.
 *
 * ── Why a member has no name here ────────────────────────────────────────
 *
 * Because there is nowhere to read one from. `memberships` holds `user_id`,
 * `role` and the invite trail; the name and email live in `auth.users`, which
 * Supabase does not expose through PostgREST, and reaching them would need the
 * service-role client that `apps/web` is forbidden to import (there is a CI
 * check for exactly that: `packages/db/scripts/check-admin-imports.ts`).
 *
 * There is no `profiles` table yet. The usual pattern — a public row per user,
 * populated by a trigger on `auth.users`, readable by co-members — is the fix,
 * and it is a migration rather than something this loader can work around.
 * It is recorded as `TEAM-01` in the backlog.
 *
 * So the screen shows what is true: roles, when each member joined, and which
 * one is you. Inventing a display name from a uuid would be the §7 failure
 * this codebase is built to avoid, and showing a blank where a name goes
 * would read as "this person has no name" rather than "we cannot see it".
 */

export interface Member {
  id: string;
  userId: string;
  role: Role;
  joinedAt: string | null;
  /** True for the signed-in user. The only identity this screen can resolve. */
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

      return (data ?? []).map((row) => ({
        id: String(row.id),
        userId: String(row.user_id),
        role: ROLES.includes(row.role as Role) ? (row.role as Role) : "viewer",
        joinedAt: row.created_at ?? null,
        isYou: String(row.user_id) === viewerId,
      }));
    },
    () => DEMO_MEMBERS,
  );
}

const ROLES: readonly Role[] = ["owner", "admin", "member", "viewer"];

/* ── Assignments ─────────────────────────────────────────────────────────── */

/**
 * An opportunity and who owns it.
 *
 * `opportunities.owner_id` references `auth.users`, so the same identity
 * problem applies: an owner can be recognised as *you* or as "another member",
 * and nothing finer until `TEAM-01` lands. What the screen can do fully is the
 * part that matters — assign, reassign and unassign — because that writes a
 * uuid it already has from the members list.
 */
export interface Assignment {
  id: string;
  company: string;
  priority: "hot" | "warm" | "watch" | "ignore";
  priorityReason: string;
  status: string;
  ownerId: string | null;
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

      /* eslint-disable @typescript-eslint/no-explicit-any --
         The row type for a nested select is generated from a live project's
         schema. Confined to this mapping. */
      return (data ?? []).map((row: any) => {
        const company = Array.isArray(row.companies) ? row.companies[0] : row.companies;
        return {
          id: String(row.id),
          company: String(company?.name ?? "Unknown company"),
          priority: row.priority,
          priorityReason: String(row.priority_reason ?? ""),
          status: String(row.status ?? "discovered"),
          ownerId: row.owner_id ?? null,
          ownerIsYou: Boolean(row.owner_id) && String(row.owner_id) === viewerId,
        };
      });
      /* eslint-enable @typescript-eslint/no-explicit-any */
    },
    () => DEMO_ASSIGNMENTS,
  );
}

/** The signed-in user's id, used only to mark a row as yours. */
async function currentUserId(db: TenantClient): Promise<string | null> {
  const { data } = await db.auth.getUser();
  return data.user?.id ?? null;
}

/* ── Demo ────────────────────────────────────────────────────────────────── */

const DEMO_MEMBERS: Member[] = [
  {
    id: "demo-member-1",
    userId: "00000000-0000-4000-8000-000000000001",
    role: "owner",
    joinedAt: null,
    isYou: true,
  },
  {
    id: "demo-member-2",
    userId: "00000000-0000-4000-8000-000000000002",
    role: "member",
    joinedAt: null,
    isYou: false,
  },
  {
    id: "demo-member-3",
    userId: "00000000-0000-4000-8000-000000000003",
    role: "viewer",
    joinedAt: null,
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
  ownerIsYou: i === 0,
}));
