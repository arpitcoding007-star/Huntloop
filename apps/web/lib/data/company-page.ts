import "server-only";
import { requireOrgId } from "./org";
import { OPPORTUNITIES } from "../fixtures/opportunities";
import { load, type Loaded } from "./source";

/**
 * The company page's own reads (§14.2 "no company detail page"): every
 * opportunity against the company — one per profile it fits — and the people
 * on file. The brief sections and the timeline come from `company-intel.ts`
 * and `activity.ts`, shared with the opportunity page.
 */

export interface CompanyOpportunity {
  id: string;
  icpName: string | null;
  priority: "hot" | "warm" | "watch" | "ignore";
  status: string;
  score: number | null;
  estimatedValueCents: number | null;
}

export interface CompanyPerson {
  id: string;
  name: string;
  title: string | null;
  isDecisionMaker: boolean;
  linkedin: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped PostgREST rows (DB-03). */

export async function getCompanyRelations(
  orgSlug: string,
  companyId: string,
): Promise<Loaded<{ opportunities: CompanyOpportunity[]; people: CompanyPerson[] }>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "getCompanyRelations");
      const [opps, people] = await Promise.all([
        db
          .from("opportunities")
          .select("id, priority, status, estimated_value_cents, icps(name), opportunity_scores(score, computed_at)")
          .eq("org_id", orgId)
          .eq("company_id", companyId)
          .is("deleted_at", null)
          .order("updated_at", { ascending: false })
          .limit(20),
        db
          .from("people")
          .select("id, first_name, last_name, title, is_decision_maker, linkedin_url")
          .eq("org_id", orgId)
          .eq("company_id", companyId)
          .is("deleted_at", null)
          .order("is_decision_maker", { ascending: false })
          .limit(50),
      ]);
      if (opps.error) throw new Error(`getCompanyRelations: ${opps.error.message}`);

      return {
        opportunities: ((opps.data ?? []) as any[]).map((o) => {
          const scores = (Array.isArray(o.opportunity_scores) ? o.opportunity_scores : []).sort(
            (a: any, b: any) => String(b.computed_at).localeCompare(String(a.computed_at)),
          );
          const icp = Array.isArray(o.icps) ? o.icps[0] : o.icps;
          return {
            id: String(o.id),
            icpName: icp?.name ?? null,
            priority: o.priority,
            status: String(o.status),
            score: typeof scores[0]?.score === "number" ? scores[0].score : null,
            estimatedValueCents:
              o.estimated_value_cents === null || o.estimated_value_cents === undefined
                ? null
                : Number(o.estimated_value_cents),
          };
        }),
        people: ((people.data ?? []) as any[]).map((p) => ({
          id: String(p.id),
          name: [p.first_name, p.last_name].filter(Boolean).join(" ") || "Unnamed contact",
          title: p.title ?? null,
          isDecisionMaker: Boolean(p.is_decision_maker),
          linkedin: p.linkedin_url ?? null,
        })),
      };
    },
    () => demoRelations(companyId),
  );
}

/**
 * RT-001. The demo company list derives `demo-company-N` from the N-th
 * opportunity fixture and says "1 open"; this page's fallback was empty and
 * said "Not qualified yet". Same derivation, so the two screens agree.
 */
export function demoRelations(companyId: string): { opportunities: CompanyOpportunity[]; people: CompanyPerson[] } {
  const n = /^demo-company-(\d+)$/.exec(companyId)?.[1];
  const o = n ? OPPORTUNITIES[Number(n) - 1] : undefined;
  if (!o) return { opportunities: [], people: [] };
  return {
    opportunities: [
      { id: o.id, icpName: null, priority: o.priority, status: o.status, score: o.score, estimatedValueCents: null },
    ],
    people: o.buyers.map((b, i) => ({
      id: `${o.id}-buyer-${i + 1}`,
      name: b.name,
      title: b.title,
      isDecisionMaker: b.isDecisionMaker,
      linkedin: null,
    })),
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
