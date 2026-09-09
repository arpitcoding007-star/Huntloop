/**
 * `research_competitor` — establish what a competitor says about itself, and
 * record where every word of it came from.
 *
 * ── The rule this handler exists to enforce ──────────────────────────────
 *
 * **No competitor claim without provenance.** `0015` states it, the AI task
 * refuses at the model boundary, and this is the third place it has to hold:
 * a finding that arrives without a source must not become a profile field
 * that renders like every other profile field.
 *
 * Three layers for one rule is not belt-and-braces. The layers fail
 * differently. The prompt can be talked out of it by a persuasive page, the
 * parser only sees one response at a time, and neither knows what is already
 * in the database. This layer is the one that decides what a *person* sees.
 *
 * ── Why the profile is replaced and the competitor row is not ────────────
 *
 * `competitor_profiles` is entirely researched output: re-running research
 * replaces it wholesale, which is why `0015` made it a separate table from
 * `competitors`. The `competitors` row holds what a person owns —
 * `our_advantage`, `their_advantage`, `tier`, `status` — and this job writes
 * exactly two of its columns: `last_researched_at` always, and `name` only
 * when the competitor is still known by the domain it was created from.
 *
 * ── Evidence, and why it is `first_party` ────────────────────────────────
 *
 * Everything here comes off the competitor's own website. That is the
 * strongest reliability band in `0020` and it is also the narrowest: it means
 * "they said this about themselves", not "this is true". A competitor's
 * homepage claiming enterprise-grade security is first-party evidence of the
 * claim, which is exactly what a salesperson needs to know before repeating
 * it.
 */
import {
  COMPETITOR_FIELD_LABELS,
  researchCompetitor,
  type CompetitorField,
} from "@huntloop/ai";
import { canonicalizeDomain } from "@huntloop/db/identity";
import { parseCriteria } from "@huntloop/db/icp";
import { AiUnavailable, runForOrg } from "../ai.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

export interface ResearchCompetitorPayload {
  competitorId: string;
  /** Re-research even if the profile is current. A person pressed a button. */
  force?: boolean;
}

/**
 * How long a competitor profile stays current.
 *
 * Thirty days, matching `research_company`, and for the same reason: this
 * establishes positioning and pricing model, not news. A competitor's funding
 * round is a *signal* and arrives through sources like any other.
 */
const FRESH_FOR_MS = 30 * 24 * 3600_000;

/** Findings that map to a scalar column on `competitor_profiles`. */
const TEXT_COLUMNS: Partial<Record<CompetitorField, string>> = {
  positioning: "positioning",
  value_prop: "value_prop",
  pricing_model: "pricing_model",
};

/** Findings that map to a `text[]` column. */
const LIST_COLUMNS: Partial<Record<CompetitorField, string>> = {
  target_markets: "target_markets",
};

/** Findings kept as structured claims: each value beside its provenance. */
const JSON_COLUMNS: Partial<Record<CompetitorField, string>> = {
  products: "products",
  differentiators: "differentiators",
  customer_examples: "customer_examples",
  strengths: "strengths",
};

/**
 * A finding's value as a list.
 *
 * The model is asked for prose, and prose that enumerates arrives either as
 * newline-separated lines or as a comma list. Splitting on both and trimming
 * is deliberately dumb: a wrong split produces a slightly odd chip on a
 * screen, whereas anything cleverer produces a confident mis-parse. The digit
 * guard keeps "1,000 seats" in one piece, which is the split that would
 * otherwise be wrong most often.
 */
export function splitList(value: string): string[] {
  return value
    .split(/\r?\n|(?<!\d),(?!\d)/)
    .map((part) => part.replace(/^[-*•\s]+/, "").trim())
    .filter((part) => part.length > 0)
    .slice(0, 20);
}

/**
 * Which of this competitor's stated markets we also sell to.
 *
 * Computed rather than asked for, per `0015`: it is the intersection of what
 * the competitor says about itself with what the customer said about
 * themselves, and neither party's model gets to invent it.
 *
 * Matching is case-insensitive containment in both directions, so "mid-market
 * SaaS" and "SaaS" overlap. An exact-string intersection of two free-text
 * lists is almost always empty, and an empty overlap renders as "we do not
 * compete for the same buyers" — a confident wrong answer, which is worse
 * than the occasional loose match this produces.
 */
export function icpOverlap(
  targetMarkets: readonly string[],
  ours: readonly string[],
): string[] {
  const overlap: string[] = [];
  for (const theirs of targetMarkets) {
    const t = theirs.toLowerCase().trim();
    if (!t) continue;
    for (const mine of ours) {
      const m = mine.toLowerCase().trim();
      if (!m) continue;
      if (t.includes(m) || m.includes(t)) {
        overlap.push(theirs.trim());
        break;
      }
    }
  }
  return [...new Set(overlap)];
}

export async function researchCompetitorJob(ctx: JobContext): Promise<JobOutcome> {
  const { scope, payload, now } = ctx;
  const competitorId = String(payload.competitorId ?? "");
  if (!competitorId) {
    return {
      ok: false,
      permanent: true,
      error: "research_competitor: no competitorId in payload.",
    };
  }

  const { data: competitor, error } = await scope
    .select("competitors", "id, name, domain, company_id, status, last_researched_at")
    .eq("id", competitorId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) return { ok: false, error: `research_competitor: ${error.message}` };
  if (!competitor) return { ok: true, result: { skipped: "the competitor no longer exists" } };

  /* A dismissed competitor is one a person looked at and said no to. Spending
     a model call on it would be spending their money to contradict them. */
  if (competitor.status === "dismissed") {
    return { ok: true, result: { skipped: "the competitor was dismissed" } };
  }

  const domain = canonicalizeDomain(String(competitor.domain ?? ""));
  if (!domain) {
    /* Named during onboarding, not yet resolved to a domain. Retrying will
       not produce one — resolution will, and that path re-enqueues this job. */
    return {
      ok: false,
      permanent: true,
      error:
        "research_competitor: the competitor has no domain, so there is no site to read. " +
        "Resolve it to a company first.",
    };
  }

  if (!payload.force && competitor.last_researched_at) {
    const age = now.getTime() - new Date(String(competitor.last_researched_at)).getTime();
    if (age < FRESH_FOR_MS) {
      return {
        ok: true,
        result: { skipped: `researched ${Math.round(age / 86_400_000)} days ago; still current` },
      };
    }
  }

  let profile;
  try {
    const run = await runForOrg(scope, researchCompetitor, {
      url: `https://${domain}`,
      knownAs: String(competitor.name ?? "") || null,
    });
    profile = run.output;
  } catch (e) {
    if (e instanceof AiUnavailable) return { ok: true, result: { skipped: e.message } };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  /* ── Evidence first ──────────────────────────────────────────────────
     Written before the profile, so that a crash between the two leaves
     evidence without a profile rather than a profile citing rows that do not
     exist. The first is the "not researched yet" state the screen already
     has; the second is a dangling citation, which is the one failure this
     subsystem must not produce. */
  const cited = profile.findings.filter((f) => f.value.trim());
  const observedAt = new Date().toISOString();

  const { data: evidenceRows, error: evidenceError } = await scope
    .upsert(
      "evidence",
      cited.map((f) => ({
        subject_type: "competitor",
        subject_id: competitorId,
        claim: `${COMPETITOR_FIELD_LABELS[f.field]}: ${f.value.trim()}`,
        kind: f.kind,
        confidence: f.confidence,
        /* Their own site. `0020`'s strongest band, and its narrowest: it
           records that they said it, not that it is so. An unknown is nobody's
           statement, so it carries no reliability at all. */
        reliability: f.kind === "unknown" ? null : "first_party",
        source_url: f.sourceUrl,
        observed_at: observedAt,
        field: f.field,
      })),
      {
        // `evidence_one_per_source_field` from `0020`: re-researching updates
        // the row for a field rather than appending a second answer to it.
        onConflict: "org_id,subject_type,subject_id,field,source_id,source_url",
        ignoreDuplicates: false,
      },
    )
    .select("id, field");

  if (evidenceError) {
    return { ok: false, error: `research_competitor: ${evidenceError.message}` };
  }

  const evidenceIdByField = new Map<string, string>(
    (Array.isArray(evidenceRows) ? evidenceRows : []).map(
      (row: { id: unknown; field: unknown }) => [String(row.field), String(row.id)],
    ),
  );

  if (evidenceIdByField.size) {
    await scope.upsert(
      "competitor_evidence",
      [...evidenceIdByField].map(([field, evidenceId]) => ({
        competitor_id: competitorId,
        evidence_id: evidenceId,
        field,
      })),
      {
        // `0015`'s unique (org, competitor, evidence, field). A second run that
        // updated the same evidence row must not fail on its own link.
        onConflict: "org_id,competitor_id,evidence_id,field",
        ignoreDuplicates: true,
      },
    );
  }

  /* Two live sources disagreeing about one field. Rare on a single-site read
     — it happens on the *second* run, when the pricing page has changed and
     the previous row is still live. Flagged rather than silently overwritten,
     because which of the two is right is not this job's call. */
  await scope.rpc("flag_contradictions", {
    p_org: scope.orgId,
    p_subject_type: "competitor",
    p_subject: competitorId,
  });

  /* ── The profile ─────────────────────────────────────────────────────
     `claims` carries the §7 triple per field, so a screen can render an
     inference as an inference and an unknown as "we looked and could not
     tell" — a different sentence from the field being absent because nobody
     asked. */
  const row: Record<string, unknown> = {
    competitor_id: competitorId,
    researched_at: observedAt,
  };
  const claims: Record<string, unknown> = {};
  let targetMarkets: string[] = [];
  let unknowns = 0;

  for (const finding of cited) {
    const evidenceId = evidenceIdByField.get(finding.field) ?? null;
    claims[finding.field] = {
      kind: finding.kind,
      confidence: finding.confidence,
      evidenceIds: evidenceId ? [evidenceId] : [],
      note: finding.kind === "unknown" ? finding.value.trim() : null,
    };

    /* An unknown is a claim, not a value. It belongs in `claims`, where it
       records that we looked; putting its prose in the column would render
       "No published pricing was found" as though it were the pricing model. */
    if (finding.kind === "unknown") {
      unknowns++;
      continue;
    }

    const text = TEXT_COLUMNS[finding.field];
    if (text) {
      row[text] = finding.value.trim();
      continue;
    }

    const list = LIST_COLUMNS[finding.field];
    if (list) {
      const values = splitList(finding.value);
      row[list] = values;
      if (finding.field === "target_markets") targetMarkets = values;
      continue;
    }

    const json = JSON_COLUMNS[finding.field];
    if (json) {
      row[json] = splitList(finding.value).map((value) => ({
        value,
        kind: finding.kind,
        confidence: finding.confidence,
        evidenceId,
      }));
    }
  }

  row.claims = claims;
  row.icp_overlap = targetMarkets.length
    ? icpOverlap(targetMarkets, await ourSegments(ctx))
    : [];

  const { error: profileError } = await scope.upsert("competitor_profiles", row, {
    onConflict: "org_id,competitor_id",
    ignoreDuplicates: false,
  });
  if (profileError) {
    return { ok: false, error: `research_competitor: ${profileError.message}` };
  }

  /* ── The competitor row ──────────────────────────────────────────────
     `last_researched_at` always. The name only when the row is still called
     by the domain it was created from, which is what the mention resolver
     names one — a name a person typed is theirs, even when the site disagrees
     with it. */
  const update: Record<string, unknown> = { last_researched_at: observedAt };
  if (profile.competitorName && String(competitor.name ?? "").toLowerCase() === domain) {
    update.name = profile.competitorName;
  }
  await scope.update("competitors", update).eq("id", competitorId);

  return {
    ok: true,
    result: {
      fields: cited.map((f) => f.field),
      unknown: unknowns,
      evidence: evidenceIdByField.size,
      icpOverlap: row.icp_overlap,
    },
  };
}

/**
 * The org's own market segments, for the overlap.
 *
 * An org with no ICP yet is normal — `0015` puts the competitor step *before*
 * the ICP step during onboarding, precisely so that "who else do your buyers
 * consider" informs it — and produces an empty overlap rather than an error.
 */
async function ourSegments(ctx: JobContext): Promise<string[]> {
  const { data } = await ctx.scope
    .select("icps", "criteria")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return [];
  try {
    const criteria = parseCriteria(data.criteria);
    return [...(criteria.segments ?? []), ...(criteria.industries ?? [])];
  } catch {
    /* An unreadable ICP is a real problem and `discover_companies` fails
       loudly on it. It is not this job's to report: the overlap is a
       convenience field, and losing a whole competitor profile over it would
       be the wrong trade. */
    return [];
  }
}
