import "server-only";
import { requireOrgId } from "./org";
import { load, type Loaded } from "./source";

/**
 * The Competitors screen — COMMAND.md §16.3-D.
 *
 * Read side only: `competitors` and `competitor_profiles` (0015), the
 * evidence each profile field cites, the prospects with a recorded
 * relationship (`company_competitor_signals`), and the deals lost to each one
 * (`outcomes.competitor_id`, 0037). Every count of relationships here counts
 * evidence-backed signals only — the same rule scoring applies.
 */

export type CompetitorTier = "direct" | "adjacent" | "incumbent" | "diy";
export type CompetitorStatus = "proposed" | "active" | "dismissed";
export type Relationship = "uses" | "evaluating" | "former" | "mentions" | "partner";

export interface CompetitorSummary {
  id: string;
  name: string;
  domain: string | null;
  tier: CompetitorTier | null;
  origin: string;
  status: CompetitorStatus;
  ourAdvantage: string | null;
  theirAdvantage: string | null;
  prospectCustomers: boolean;
  lastResearchedAt: string | null;
  researchRequestedAt: string | null;
  customersSoughtAt: string | null;
  positioning: string | null;
  /** Companies with each relationship, counting evidence-backed signals only. */
  signals: Record<Relationship, number>;
  /** Deals recorded as lost to this competitor. */
  losses: number;
}

export interface ProfileClaim {
  kind: "fact" | "inference" | "unknown";
  confidence: "high" | "medium" | "low" | null;
  evidence: { id: string; claim: string; sourceUrl: string | null; observedAt: string }[];
  note: string | null;
}

export interface CompetitorProfileView {
  positioning: string | null;
  valueProp: string | null;
  pricingModel: string | null;
  targetMarkets: string[];
  products: string[];
  differentiators: string[];
  customerExamples: { value: string; kind: string }[];
  strengths: string[];
  icpOverlap: string[];
  researchedAt: string;
  /** Field → its claim kind and the evidence behind it. */
  claims: Record<string, ProfileClaim>;
}

export interface CompetitorCompany {
  companyId: string;
  name: string;
  relationship: Relationship;
  hasEvidence: boolean;
  observedAt: string | null;
  opportunityId: string | null;
}

export interface CompetitorLoss {
  opportunityId: string | null;
  companyName: string | null;
  reason: string | null;
  occurredAt: string;
}

export interface CompetitorDetail extends CompetitorSummary {
  profile: CompetitorProfileView | null;
  companies: CompetitorCompany[];
  lossList: CompetitorLoss[];
  /** Companies found through "go after their customers". */
  prospected: number;
}

export const RELATIONSHIPS: Relationship[] = ["uses", "evaluating", "former", "mentions", "partner"];

const emptySignals = (): Record<Relationship, number> => ({
  uses: 0,
  evaluating: 0,
  former: 0,
  mentions: 0,
  partner: 0,
});

const COMPETITOR_COLUMNS =
  "id, name, domain, tier, origin, status, our_advantage, their_advantage, prospect_customers, " +
  "last_researched_at, research_requested_at, customers_sought_at";

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped PostgREST rows (DB-03). */

function toSummary(row: any): Omit<CompetitorSummary, "signals" | "losses" | "positioning"> {
  return {
    id: String(row.id),
    name: String(row.name),
    domain: row.domain ? String(row.domain) : null,
    tier: (row.tier ?? null) as CompetitorTier | null,
    origin: String(row.origin ?? "user"),
    status: (row.status ?? "active") as CompetitorStatus,
    ourAdvantage: row.our_advantage ?? null,
    theirAdvantage: row.their_advantage ?? null,
    prospectCustomers: Boolean(row.prospect_customers),
    lastResearchedAt: row.last_researched_at ?? null,
    researchRequestedAt: row.research_requested_at ?? null,
    customersSoughtAt: row.customers_sought_at ?? null,
  };
}

export async function listCompetitors(orgSlug: string): Promise<Loaded<CompetitorSummary[]>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "listCompetitors");
      const [competitors, profiles, signals, losses] = await Promise.all([
        db
          .from("competitors")
          .select(COMPETITOR_COLUMNS)
          .eq("org_id", orgId)
          .is("deleted_at", null)
          .order("name", { ascending: true })
          .limit(200),
        db.from("competitor_profiles").select("competitor_id, positioning").eq("org_id", orgId).limit(200),
        db
          .from("company_competitor_signals")
          .select("competitor_id, relationship")
          .eq("org_id", orgId)
          .not("evidence_id", "is", null)
          .limit(5000),
        db
          .from("outcomes")
          .select("competitor_id")
          .eq("org_id", orgId)
          .eq("kind", "lost")
          .not("competitor_id", "is", null)
          .limit(5000),
      ]);
      if (competitors.error) throw new Error(`listCompetitors: ${competitors.error.message}`);

      const positioning = new Map(
        ((profiles.data ?? []) as any[]).map((p) => [String(p.competitor_id), p.positioning ?? null]),
      );
      const counts = new Map<string, Record<Relationship, number>>();
      for (const s of (signals.data ?? []) as any[]) {
        const c = counts.get(String(s.competitor_id)) ?? emptySignals();
        if (RELATIONSHIPS.includes(s.relationship)) c[s.relationship as Relationship] += 1;
        counts.set(String(s.competitor_id), c);
      }
      const lossCounts = new Map<string, number>();
      for (const o of (losses.data ?? []) as any[]) {
        lossCounts.set(String(o.competitor_id), (lossCounts.get(String(o.competitor_id)) ?? 0) + 1);
      }

      return ((competitors.data ?? []) as any[]).map((row) => ({
        ...toSummary(row),
        positioning: positioning.get(String(row.id)) ?? null,
        signals: counts.get(String(row.id)) ?? emptySignals(),
        losses: lossCounts.get(String(row.id)) ?? 0,
      }));
    },
    () => DEMO_COMPETITORS,
  );
}

export async function getCompetitor(
  orgSlug: string,
  id: string,
): Promise<Loaded<CompetitorDetail | null>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "getCompetitor");
      const { data: row, error } = await db
        .from("competitors")
        .select(COMPETITOR_COLUMNS)
        .eq("org_id", orgId)
        .eq("id", id)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw new Error(`getCompetitor: ${error.message}`);
      if (!row) return null;

      const [profileRes, signalRes, lossRes, prospectRes] = await Promise.all([
        db.from("competitor_profiles").select("*").eq("org_id", orgId).eq("competitor_id", id).maybeSingle(),
        db
          .from("company_competitor_signals")
          .select(
            "company_id, relationship, evidence_id, observed_at, " +
              "companies!inner(name, deleted_at, opportunities(id, deleted_at))",
          )
          .eq("org_id", orgId)
          .eq("competitor_id", id)
          .order("observed_at", { ascending: false, nullsFirst: false })
          .limit(100),
        db
          .from("outcomes")
          .select("opportunity_id, reason, occurred_at, opportunities(companies(name))")
          .eq("org_id", orgId)
          .eq("kind", "lost")
          .eq("competitor_id", id)
          .order("occurred_at", { ascending: false })
          .limit(50),
        db
          .from("companies")
          .select("id", { count: "exact", head: true })
          .eq("org_id", orgId)
          .eq("discovered_via", `competitor:${id}`)
          .is("deleted_at", null),
      ]);

      const p = profileRes.data as any;
      let profile: CompetitorProfileView | null = null;
      if (p) {
        const rawClaims = (p.claims ?? {}) as Record<string, any>;
        const evidenceIds = [
          ...new Set(
            Object.values(rawClaims).flatMap((c) => (Array.isArray(c?.evidenceIds) ? c.evidenceIds : [])),
          ),
        ].map(String);
        const { data: evidence } = evidenceIds.length
          ? await db
              .from("evidence")
              .select("id, claim, source_url, observed_at")
              .eq("org_id", orgId)
              .in("id", evidenceIds)
          : { data: [] };
        const byId = new Map(((evidence ?? []) as any[]).map((e) => [String(e.id), e]));
        const claims: Record<string, ProfileClaim> = {};
        for (const [field, c] of Object.entries(rawClaims)) {
          claims[field] = {
            kind: c?.kind === "fact" || c?.kind === "inference" ? c.kind : "unknown",
            confidence: c?.confidence ?? null,
            note: c?.note ?? null,
            evidence: (Array.isArray(c?.evidenceIds) ? c.evidenceIds : [])
              .map((eid: unknown) => byId.get(String(eid)))
              .filter(Boolean)
              .map((e: any) => ({
                id: String(e.id),
                claim: String(e.claim),
                sourceUrl: e.source_url ?? null,
                observedAt: String(e.observed_at),
              })),
          };
        }
        const values = (v: unknown): string[] =>
          Array.isArray(v)
            ? v.map((x: any) => (typeof x === "string" ? x : String(x?.value ?? ""))).filter(Boolean)
            : [];
        profile = {
          positioning: p.positioning ?? null,
          valueProp: p.value_prop ?? null,
          pricingModel: p.pricing_model ?? null,
          targetMarkets: values(p.target_markets),
          products: values(p.products),
          differentiators: values(p.differentiators),
          customerExamples: (Array.isArray(p.customer_examples) ? p.customer_examples : [])
            .map((x: any) => ({ value: String(x?.value ?? x ?? ""), kind: String(x?.kind ?? "inference") }))
            .filter((x: { value: string }) => x.value),
          strengths: values(p.strengths),
          icpOverlap: values(p.icp_overlap),
          researchedAt: String(p.researched_at),
          claims,
        };
      }

      const signals = emptySignals();
      const companies: CompetitorCompany[] = [];
      for (const s of (signalRes.data ?? []) as any[]) {
        const company = Array.isArray(s.companies) ? s.companies[0] : s.companies;
        if (!company || company.deleted_at) continue;
        if (s.evidence_id && RELATIONSHIPS.includes(s.relationship)) {
          signals[s.relationship as Relationship] += 1;
        }
        const opp = (Array.isArray(company.opportunities) ? company.opportunities : []).find(
          (o: any) => !o.deleted_at,
        );
        companies.push({
          companyId: String(s.company_id),
          name: String(company.name),
          relationship: s.relationship as Relationship,
          hasEvidence: Boolean(s.evidence_id),
          observedAt: s.observed_at ?? null,
          opportunityId: opp ? String(opp.id) : null,
        });
      }

      const lossList: CompetitorLoss[] = ((lossRes.data ?? []) as any[]).map((o) => {
        const opp = Array.isArray(o.opportunities) ? o.opportunities[0] : o.opportunities;
        const company = opp ? (Array.isArray(opp.companies) ? opp.companies[0] : opp.companies) : null;
        return {
          opportunityId: o.opportunity_id ? String(o.opportunity_id) : null,
          companyName: company?.name ?? null,
          reason: o.reason ?? null,
          occurredAt: String(o.occurred_at),
        };
      });

      return {
        ...toSummary(row),
        positioning: profile?.positioning ?? null,
        signals,
        losses: lossList.length,
        profile,
        companies,
        lossList,
        prospected: prospectRes.count ?? 0,
      };
    },
    () => {
      const demo = DEMO_COMPETITORS.find((c) => c.id === id);
      return demo ? { ...demo, profile: null, companies: [], lossList: [], prospected: 0 } : null;
    },
  );
}

/* eslint-enable @typescript-eslint/no-explicit-any */

const DEMO_COMPETITORS: CompetitorSummary[] = [
  {
    id: "demo-competitor-1",
    name: "Example Rival",
    domain: "example-rival.com",
    tier: "direct",
    origin: "onboarding",
    status: "active",
    ourAdvantage: null,
    theirAdvantage: null,
    prospectCustomers: false,
    lastResearchedAt: null,
    researchRequestedAt: null,
    customersSoughtAt: null,
    positioning: null,
    signals: { uses: 2, evaluating: 1, former: 0, mentions: 3, partner: 0 },
    losses: 1,
  },
];
