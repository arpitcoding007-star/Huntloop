import "server-only";
import { OPPORTUNITIES } from "../fixtures/opportunities";
import { requireOrgId } from "./org";
import { load, type Loaded } from "./source";

/**
 * What changed in a workspace since a moment (debt #13): signals landed and
 * nothing said so. The Command Center counts them over the window
 * `resolveWindow` picks and lists the newest triggers.
 *
 * Three counts, each a fact a person can check on the screen it links to:
 * opportunities found, triggers recorded, replies received.
 */
export interface Changes {
  opportunities: number;
  triggers: number;
  replies: number;
  /** Newest triggers first, at most five. */
  recent: { companyId: string | null; company: string; trigger: string; at: string }[];
}

const RECENT_LIMIT = 5;

export async function getChangesSince(orgSlug: string, since: string): Promise<Loaded<Changes>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "getChangesSince");
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- PostgREST builder */
      const count = async (table: string, refine: (q: any) => any): Promise<number> => {
        const { count: n, error } = await refine(
          db.from(table).select("id", { count: "exact", head: true }).eq("org_id", orgId),
        );
        if (error) throw new Error(`getChangesSince ${table}: ${error.message}`);
        return Number(n ?? 0);
      };

      const [opportunities, triggers, replies, recent] = await Promise.all([
        count("opportunities", (q) => q.gt("first_seen_at", since).is("deleted_at", null)),
        count("company_triggers", (q) => q.gt("created_at", since).is("deleted_at", null)),
        count("activities", (q) => q.eq("direction", "inbound").gt("occurred_at", since).is("deleted_at", null)),
        db
          .from("company_triggers")
          .select("trigger_type, created_at, companies(id, name)")
          .eq("org_id", orgId)
          .gt("created_at", since)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(RECENT_LIMIT),
      ]);

      if (recent.error) throw new Error(`getChangesSince recent: ${recent.error.message}`);

      return {
        opportunities,
        triggers,
        replies,
        /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- embedded row */
        recent: ((recent.data ?? []) as any[]).map((r) => {
          const company = Array.isArray(r.companies) ? r.companies[0] : r.companies;
          return {
            companyId: company?.id ? String(company.id) : null,
            company: String(company?.name ?? "A company"),
            trigger: String(r.trigger_type ?? "signal").replace(/_/g, " "),
            at: String(r.created_at),
          };
        }),
      };
    },
    /* Demo: the fixtures' own triggers, so the card is visible and honest
       about what it would show. The layout's banner says it is demo data. */
    () => ({
      opportunities: 2,
      triggers: OPPORTUNITIES.length,
      replies: 1,
      /* `at` is when a trigger was *recorded*, as on the live path, not
         when it happened; the fixtures only carry the latter. */
      recent: OPPORTUNITIES.slice(0, RECENT_LIMIT).map((o, i) => ({
        companyId: null,
        company: o.company,
        trigger: o.trigger,
        at: new Date(Date.now() - (i + 1) * 5 * 3600_000).toISOString(),
      })),
    }),
  );
}
