import "server-only";
import { parseIcp } from "@huntloop/db/icp";
import { currentViewer } from "./membership";
import { resolveDataSource } from "./source";
import {
  proposeTighterProfile,
  type IcpProposal,
  type ProposalCompany,
} from "../icp-proposal";

/** Statuses that mean somebody took the company on. */
const ACCEPTED = ["assigned", "contacted", "replied", "meeting", "proposal", "won"];

/** Enough history to see a pattern, bounded so the read stays cheap. */
const LIMIT = 500;

export interface IcpProposalView {
  icpId: string;
  icpName: string;
  proposal: IcpProposal;
}

/**
 * The tighter-profile proposal for the active ICP, or null when there is no
 * active profile or too little history to propose from. See `lib/icp-proposal.ts`.
 */
export async function getIcpProposal(orgSlug: string): Promise<IcpProposalView | null> {
  const { db } = await resolveDataSource();
  if (!db) return null;
  const viewer = await currentViewer(orgSlug);
  if (!viewer || viewer.kind !== "member") return null;
  const orgId = viewer.orgId;

  const { data: icpRow } = await db
    .from("icps")
    .select("id, name, criteria, negative_criteria")
    .eq("org_id", orgId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!icpRow) return null;

  let criteria;
  let exclusions;
  try {
    const icp = parseIcp(icpRow.criteria, icpRow.negative_criteria);
    criteria = icp.criteria;
    exclusions = icp.exclusions;
  } catch {
    return null;
  }

  const [acceptedRows, outcomeRows, overrideRows] = await Promise.all([
    db
      .from("opportunities")
      .select("id, companies!inner(id, name, industry, employee_count, region)")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .in("status", ACCEPTED)
      .order("updated_at", { ascending: false })
      .limit(LIMIT),
    // Marked not a fit, or lost because it was not one.
    db
      .from("outcomes")
      .select("opportunity_id, kind, reason_category")
      .eq("org_id", orgId)
      .or("kind.eq.disqualified,and(kind.eq.lost,reason_category.eq.not_a_fit)")
      .not("opportunity_id", "is", null)
      .order("occurred_at", { ascending: false })
      .limit(LIMIT),
    // Moved to Ignore by a person.
    db
      .from("human_overrides")
      .select("entity_id")
      .eq("org_id", orgId)
      .eq("subject", "opportunity_priority")
      .eq("human_value", "ignore")
      .order("created_at", { ascending: false })
      .limit(LIMIT),
  ]);

  /* eslint-disable @typescript-eslint/no-explicit-any -- embedded-select rows. */
  const companyOf = (row: any) => (Array.isArray(row.companies) ? row.companies[0] : row.companies);
  const toCompany = (row: any, outcome: ProposalCompany["outcome"]): ProposalCompany | null => {
    const c = companyOf(row);
    if (!c) return null;
    return {
      id: String(c.id),
      name: String(c.name ?? ""),
      industry: typeof c.industry === "string" ? c.industry : null,
      employeeCount: typeof c.employee_count === "number" ? c.employee_count : null,
      region: typeof c.region === "string" ? c.region : null,
      outcome,
    };
  };

  const accepted = ((acceptedRows.data ?? []) as any[])
    .map((r) => toCompany(r, "accepted"))
    .filter((c): c is ProposalCompany => c !== null);
  const acceptedIds = new Set(((acceptedRows.data ?? []) as any[]).map((r) => String(r.id)));

  const declinedOppIds = [
    ...new Set([
      ...((outcomeRows.data ?? []) as any[]).map((r) => String(r.opportunity_id)),
      ...((overrideRows.data ?? []) as any[]).map((r) => String(r.entity_id)),
    ]),
  ].filter((id) => !acceptedIds.has(id));

  let declined: ProposalCompany[] = [];
  if (declinedOppIds.length > 0) {
    const { data } = await db
      .from("opportunities")
      .select("id, companies!inner(id, name, industry, employee_count, region)")
      .eq("org_id", orgId)
      .in("id", declinedOppIds.slice(0, LIMIT));
    declined = ((data ?? []) as any[])
      .map((r) => toCompany(r, "declined"))
      .filter((c): c is ProposalCompany => c !== null);
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // One vote per company: several opportunities for one company are one decision.
  const seen = new Set<string>();
  const companies = [...accepted, ...declined].filter((c) => {
    const key = `${c.outcome}:${c.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const proposal = proposeTighterProfile(companies, {
    industries: criteria.industries ?? [],
    segments: criteria.segments ?? [],
    sizes: criteria.sizes ?? [],
    regions: criteria.regions ?? [],
    exclusions: exclusions.exclusions ?? [],
  });
  if (!proposal) return null;

  return { icpId: String(icpRow.id), icpName: String(icpRow.name ?? "Your profile"), proposal };
}
