import "server-only";
import { parseIcp } from "@huntloop/db/icp";
import { icpFit, type FitRow } from "../icp-fit";
import { requireOrgId } from "./org";
import { load, type Loaded } from "./source";
import type { Relationship } from "./competitor-intel";

/**
 * The parts of the decision brief that come from the company rather than the
 * opportunity row — COMMAND.md §16.3-C: why they fit (computed), what they use
 * (competitor signals with their evidence), and the problems and gaps research
 * recorded. Shared by the opportunity page and the company page.
 */

export interface SourcedLine {
  text: string;
  detail: string | null;
  sourceUrl: string | null;
  excerpt: string | null;
}

export interface CompetitorUse {
  competitorId: string;
  name: string;
  tier: string | null;
  relationship: Relationship;
  hasEvidence: boolean;
  claim: string | null;
  sourceUrl: string | null;
  observedAt: string | null;
  /** The person's "where we win", only for a direct competitor they use. */
  angle: string | null;
}

export interface CompanyIntel {
  companyId: string;
  fit: FitRow[];
  /** Name of the profile the fit was computed against, or null without one. */
  icpName: string | null;
  problems: (SourcedLine & { severity: number | null })[];
  gaps: SourcedLine[];
  competitors: CompetitorUse[];
  techStack: string[];
  funding: { stage: string | null; totalRaisedUsd: number | null; lastRoundAt: string | null } | null;
  leadership: { name: string; title: string | null }[];
  lastResearchedAt: string | null;
  /** A person asked for research and it has not run yet. */
  researchAskedAt: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped PostgREST rows (DB-03). */

export async function getCompanyIntel(
  orgSlug: string,
  companyId: string,
): Promise<Loaded<CompanyIntel | null>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "getCompanyIntel");
      const [company, problems, gaps, signals, icp] = await Promise.all([
        db
          .from("companies")
          .select(
            "id, name, industry, employee_count, region, country, tech_stack, business_model, " +
              "description, funding, leadership, last_researched_at, research_asked_at",
          )
          .eq("org_id", orgId)
          .eq("id", companyId)
          .is("deleted_at", null)
          .maybeSingle(),
        db
          .from("company_problems")
          .select("problem, severity, evidence(source_url, excerpt, claim)")
          .eq("org_id", orgId)
          .eq("company_id", companyId)
          .is("deleted_at", null)
          .order("severity", { ascending: false, nullsFirst: false })
          .limit(10),
        db
          .from("company_gaps")
          .select("gap, current_approach, evidence(source_url, excerpt, claim)")
          .eq("org_id", orgId)
          .eq("company_id", companyId)
          .is("deleted_at", null)
          .limit(10),
        db
          .from("company_competitor_signals")
          .select(
            "relationship, evidence_id, observed_at, " +
              "competitors!inner(id, name, tier, status, our_advantage, deleted_at), " +
              "evidence(claim, source_url, excerpt)",
          )
          .eq("org_id", orgId)
          .eq("company_id", companyId)
          .limit(30),
        db
          .from("icps")
          .select("name, criteria, negative_criteria")
          .eq("org_id", orgId)
          .eq("is_active", true)
          .is("deleted_at", null)
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (company.error) throw new Error(`getCompanyIntel: ${company.error.message}`);
      const c = company.data as any;
      if (!c) return null;

      let fit: FitRow[] = [];
      let icpName: string | null = null;
      if (icp.data) {
        try {
          const parsed = parseIcp((icp.data as any).criteria, (icp.data as any).negative_criteria);
          icpName = String((icp.data as any).name ?? "Your profile");
          fit = icpFit(
            {
              name: String(c.name),
              industry: c.industry ?? null,
              employeeCount: typeof c.employee_count === "number" ? c.employee_count : null,
              region: c.region ?? null,
              country: c.country ?? null,
              techStack: Array.isArray(c.tech_stack) ? c.tech_stack.map(String) : [],
              businessModel: c.business_model ?? null,
              description: c.description ?? null,
            },
            parsed.criteria,
            parsed.exclusions,
          );
        } catch {
          fit = [];
        }
      }

      const one = (v: any) => (Array.isArray(v) ? v[0] : v) ?? null;

      const competitors: CompetitorUse[] = [];
      for (const s of (signals.data ?? []) as any[]) {
        const comp = one(s.competitors);
        if (!comp || comp.deleted_at || comp.status !== "active") continue;
        const ev = one(s.evidence);
        competitors.push({
          competitorId: String(comp.id),
          name: String(comp.name),
          tier: comp.tier ?? null,
          relationship: s.relationship as Relationship,
          hasEvidence: Boolean(s.evidence_id),
          claim: ev?.excerpt ?? ev?.claim ?? null,
          sourceUrl: ev?.source_url ?? null,
          observedAt: s.observed_at ?? null,
          /* A displacement angle only where it is legitimate: a direct
             competitor they use or left, with evidence, and a sentence the
             person wrote themselves. */
          angle:
            comp.tier === "direct" &&
            (s.relationship === "uses" || s.relationship === "former") &&
            s.evidence_id &&
            comp.our_advantage
              ? String(comp.our_advantage)
              : null,
        });
      }
      const order: Relationship[] = ["uses", "evaluating", "former", "mentions", "partner"];
      competitors.sort((a, b) => order.indexOf(a.relationship) - order.indexOf(b.relationship));

      const funding = c.funding && typeof c.funding === "object" && Object.keys(c.funding).length
        ? {
            stage: c.funding.stage ?? null,
            totalRaisedUsd: typeof c.funding.totalRaisedUsd === "number" ? c.funding.totalRaisedUsd : null,
            lastRoundAt: c.funding.lastRoundAt ?? null,
          }
        : null;

      return {
        companyId,
        fit,
        icpName,
        problems: ((problems.data ?? []) as any[]).map((p) => {
          const ev = one(p.evidence);
          return {
            text: String(p.problem),
            detail: null,
            severity: typeof p.severity === "number" ? p.severity : null,
            sourceUrl: ev?.source_url ?? null,
            excerpt: ev?.excerpt ?? null,
          };
        }),
        gaps: ((gaps.data ?? []) as any[]).map((g) => {
          const ev = one(g.evidence);
          return {
            text: String(g.gap),
            detail: g.current_approach ?? null,
            sourceUrl: ev?.source_url ?? null,
            excerpt: ev?.excerpt ?? null,
          };
        }),
        competitors,
        techStack: Array.isArray(c.tech_stack) ? c.tech_stack.map(String).filter(Boolean) : [],
        funding,
        leadership: (Array.isArray(c.leadership) ? c.leadership : [])
          .map((l: any) => ({ name: String(l?.name ?? ""), title: l?.title ?? null }))
          .filter((l: { name: string }) => l.name)
          .slice(0, 8),
        lastResearchedAt: c.last_researched_at ?? null,
        researchAskedAt: c.research_asked_at ?? null,
      };
    },
    () => null,
  );
}

/* eslint-enable @typescript-eslint/no-explicit-any */
