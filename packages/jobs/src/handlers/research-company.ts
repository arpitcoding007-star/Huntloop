/**
 * `research_company` — fill in what a company *is*, so the qualifier has
 * something to judge against.
 *
 * Runs before scoring for a company that arrived with nothing but a domain: a
 * CSV import, or a scan that learned only that "Northwind Logistics" exists at
 * northwind.co. §12 splits a company's problems, gaps and triggers apart
 * rather than collapsing them into one bag, and this is what populates the
 * first two — the scanner populates triggers, because triggers are events and
 * events are what sources publish.
 *
 * ── Why this is a separate job from scoring ──────────────────────────────
 *
 * Cost and freshness have different shapes. A company's business model changes
 * rarely and is expensive to establish; its triggers change weekly and are
 * cheap. Folding them together would re-read the whole website on every scan
 * — or, worse, would make the freshness of the trigger depend on how recently
 * anyone looked at the About page.
 *
 * `last_researched_at` is therefore the gate: a company researched inside the
 * window is skipped, and the job says so rather than silently doing nothing.
 */
import { FIELD_LABELS, researchCompany, type ResearchFinding } from "@huntloop/ai";
import { AiUnavailable, runForOrg } from "../ai.ts";
import { enqueue } from "../queue.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

export interface ResearchPayload {
  companyId: string;
  /** Re-research even if it was done recently. Set by the Re-research button. */
  force?: boolean;
}

/**
 * How long a company's research stays current.
 *
 * Thirty days is a judgement about what this task establishes — what they
 * sell, who to, how they operate — not about how fast news moves. Anything
 * that moves faster than a month is a *trigger*, and triggers arrive through
 * sources, which run on their own interval.
 */
const FRESH_FOR_MS = 30 * 24 * 3600_000;

export async function researchCompanyJob(ctx: JobContext): Promise<JobOutcome> {
  const { scope, payload, now } = ctx;
  const companyId = String(payload.companyId ?? "");
  if (!companyId) {
    return { ok: false, permanent: true, error: "research_company: no companyId in payload." };
  }

  const { data: company, error } = await scope.select("companies", "id, name, canonical_domain, website, last_researched_at")
    .eq("id", companyId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) return { ok: false, error: `research_company: ${error.message}` };
  if (!company) return { ok: true, result: { skipped: "the company no longer exists" } };

  if (!payload.force && company.last_researched_at) {
    const age = now.getTime() - new Date(String(company.last_researched_at)).getTime();
    if (age < FRESH_FOR_MS) {
      return {
        ok: true,
        result: {
          skipped: `researched ${Math.round(age / 86_400_000)} days ago; still current`,
        },
      };
    }
  }

  let understanding;
  try {
    const run = await runForOrg(scope, researchCompany, {
      url: String(company.website || `https://${company.canonical_domain}`),
    });
    understanding = run.output;
  } catch (e) {
    if (e instanceof AiUnavailable) return { ok: true, result: { skipped: e.message } };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const findings = new Map<string, ResearchFinding>(
    understanding.findings.map((f) => [f.field, f]),
  );

  /* Only what was actually established. A field the research could not
     determine is left alone rather than written as null — overwriting a value
     a person typed with an absence a model produced is the §7 failure running
     in the most annoying possible direction.

     Two of `research_company`'s five fields map to a column; the other three
     — buyers, problem, trigger — are claims rather than attributes, and they
     land in `evidence` and `company_problems` below. Forcing them into
     columns would flatten a claim with a confidence and a source into a
     string with neither. */
  const update: Record<string, unknown> = { last_researched_at: new Date().toISOString() };
  const set = (column: string, field: string) => {
    const finding = findings.get(field);
    if (finding && finding.kind !== "unknown" && finding.value.trim()) {
      update[column] = finding.value.trim();
    }
  };

  set("description", "sells");
  set("business_model", "business_model");

  // The company's own name, when the site gave a better one than the domain we
  // guessed from. Never overwrites a name a person typed — see the check.
  if (
    understanding.companyName &&
    understanding.companyName !== understanding.canonicalDomain &&
    String(company.name) === String(company.canonical_domain)
  ) {
    update.name = understanding.companyName;
  }

  const { error: updateError } = await scope.update("companies", update)
    .eq("id", companyId);
  if (updateError) return { ok: false, error: `research_company: ${updateError.message}` };

  /* Every finding becomes evidence, unknowns included — the §7 triple is the
     product's central claim, and a research run that recorded only what it
     found would leave the unknowns as an absence indistinguishable from never
     having looked. */
  const evidenceRows = understanding.findings
    .filter((f) => f.value.trim())
    .map((f) => ({
      subject_type: "company",
      subject_id: companyId,
      /* Prefixed with the field's human label rather than its key, because
         this string is rendered directly in the evidence list — "What they
         sell: …", not "sells: …". `FIELD_LABELS` is the same map the analyze
         screen renders from, so the two cannot drift. */
      claim: `${FIELD_LABELS[f.field] ?? f.label}: ${f.value.trim()}`,
      kind: f.kind,
      confidence: f.confidence,
      source_url: f.sourceUrl,
      excerpt: null,
    }));

  if (evidenceRows.length) {
    await scope.insert("evidence", evidenceRows);
  }

  /* §12's problems list. It comes out of research rather than out of scanning
     because a problem is a property of the company rather than an event in the
     world — and the qualifier reads problems, gaps and triggers separately so
     that "strong trigger, unclear problem" stays a representable state.

     A `trigger` finding is deliberately NOT turned into a `company_triggers`
     row here. The site has no date on it, and a trigger that cannot be aged is
     a trigger that is permanently fresh — which scores, and which §81 exists
     to prevent. It is recorded as evidence, where it is true and inert. */
  const problems = understanding.findings.filter(
    (f) => f.field === "problem" && f.kind !== "unknown" && f.value.trim(),
  );
  if (problems.length) {
    await scope.insert(
      "company_problems",
      problems.map((f) => ({
        company_id: companyId,
        problem: f.value.trim(),
        // No invented severity. §51's warning about unversioned weights
        // applies here too: a number nobody computed reads as a measurement.
        severity: null,
      })),
    );
  }

  // Research changes what the qualifier would conclude, so the verdict is
  // stale the moment this lands.
  await enqueue({
    orgId: scope.orgId,
    name: "score_opportunity",
    payload: { companyId },
    idempotencyKey: `score:${companyId}`,
  });

  return {
    ok: true,
    result: {
      fields: [...findings.keys()],
      evidence: evidenceRows.length,
      problems: problems.length,
    },
  };
}

