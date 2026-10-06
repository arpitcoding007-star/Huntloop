import "server-only";
import { requireOrgId } from "./org";
import { listMembers } from "./team";
import { load, type Loaded } from "./source";

/**
 * What a memory can be about, by name — so the Memory screen offers a picker
 * instead of asking for a raw id (§14.2). One list per subject-taking scope;
 * `team` has no teams table to pick from and is not offered for new memories.
 */

export interface SubjectOption {
  id: string;
  label: string;
}

export interface MemorySubjects {
  user: SubjectOption[];
  account: SubjectOption[];
  opportunity: SubjectOption[];
}

/** Bounded: a picker over thousands of rows is a search box, and this is a list. */
const LIMIT = 500;

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped PostgREST rows (DB-03). */

export async function listMemorySubjects(orgSlug: string): Promise<Loaded<MemorySubjects>> {
  const { data: members } = await listMembers(orgSlug);
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "listMemorySubjects");
      const [companies, opportunities] = await Promise.all([
        db
          .from("companies")
          .select("id, name, canonical_domain")
          .eq("org_id", orgId)
          .is("deleted_at", null)
          .order("name", { ascending: true })
          .limit(LIMIT),
        db
          .from("opportunities")
          .select("id, companies!inner(name), icps(name)")
          .eq("org_id", orgId)
          .is("deleted_at", null)
          .order("updated_at", { ascending: false })
          .limit(LIMIT),
      ]);
      return {
        user: members.map((m) => ({
          id: m.userId,
          label: m.isYou ? `${m.name ?? m.email ?? "You"} (you)` : (m.name ?? m.email ?? "A member"),
        })),
        account: ((companies.data ?? []) as any[]).map((c) => ({
          id: String(c.id),
          label: `${c.name} · ${c.canonical_domain}`,
        })),
        opportunity: ((opportunities.data ?? []) as any[]).map((o) => {
          const company = Array.isArray(o.companies) ? o.companies[0] : o.companies;
          const icp = Array.isArray(o.icps) ? o.icps[0] : o.icps;
          return {
            id: String(o.id),
            label: `${company?.name ?? "An opportunity"}${icp?.name ? ` · ${icp.name}` : ""}`,
          };
        }),
      };
    },
    () => ({ user: [], account: [], opportunity: [] }),
  );
}

/* eslint-enable @typescript-eslint/no-explicit-any */
