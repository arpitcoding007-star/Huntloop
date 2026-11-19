/**
 * `fetch_company_signals` — ask a provider what a company is hiring for, and
 * write each posting in as evidence.
 *
 * ── Why this is not a field on `enrich_company` ──────────────────────────
 *
 * `enrich_company` fills static attributes — industry, headcount, funding —
 * that change on the order of months and are cached for 30 days. A hiring
 * signal is the opposite: several rows per company, each with its own date
 * and its own citation, refreshed every 48 hours because staleness here is
 * dangerous rather than merely wasteful (`packages/providers/src/cache.ts`).
 * Folding the two together would mean either enrich_company runs every two
 * days — repricing every static field to match the volatile one — or signals
 * inherit a 30-day cache and go stale silently. Separate jobs, separate
 * cadences, same evidence table.
 *
 * ── Why every posting becomes its own evidence row ────────────────────────
 *
 * §7 again: "Company is hiring" is a weaker, vaguer claim than "Company
 * posted a Senior AE role in Austin on September 1st", and the vaguer version
 * is also unfalsifiable — nobody can check it. One row per posting, each with
 * the provider's own URL as `source_url` where one exists, keeps every claim
 * checkable individually rather than collapsing five postings into one
 * sentence nobody can verify.
 */
import { ProviderRefused, searchCompanySignals } from "@huntloop/providers";
import { OrgScope } from "../scope.ts";
import { atsApiUrl, careersPages, findAtsBoards, parseAtsPostings, type AtsBoard } from "../ats.ts";
import { fetchPage } from "../fetch.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

export interface FetchCompanySignalsPayload {
  companyId: string;
}

export async function fetchCompanySignals(ctx: JobContext): Promise<JobOutcome> {
  const { scope, payload } = ctx;
  const companyId = String(payload.companyId ?? "");
  if (!companyId) {
    return { ok: false, permanent: true, error: "fetch_company_signals: no companyId in payload." };
  }

  const { data: company, error } = await scope
    .select("companies", "id, canonical_domain, name")
    .eq("id", companyId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) return { ok: false, error: `fetch_company_signals: ${error.message}` };
  if (!company) return { ok: true, result: { skipped: "the company no longer exists" } };

  /* P2-5: the company's own job board first. Free, needs no provider key,
     and cites the board itself. Apollo below still runs when an id exists. */
  const board = await boardSignals(ctx, companyId, String(company.canonical_domain ?? ""), undefined, String(company.name ?? "") || null);

  /* The job-postings resource is scoped to a provider id, not a domain (see
     the adapter). No id, no call — and no credit spent finding that out. */
  const { data: external } = await scope
    .select("external_ids", "provider, provider_id")
    .eq("entity_type", "company")
    .eq("entity_id", companyId)
    .eq("provider", "apollo")
    .limit(1);

  const providerId =
    Array.isArray(external) && external.length
      ? String((external[0] as { provider_id: string }).provider_id)
      : null;

  if (!providerId) {
    await scope.update("companies", { last_signal_checked_at: new Date().toISOString() }).eq("id", companyId);
    return {
      ok: true,
      result: board.found
        ? { found: board.found, boards: board.boards, apollo: "no provider id on file" }
        : { skipped: "no job board linked from the company site and no provider id on file", boards: board.boards },
    };
  }

  let result;
  try {
    result = await searchCompanySignals(
      { db: OrgScope.global(), orgId: scope.orgId, entity: { type: "company", id: companyId } },
      {
        companyDomain: String(company.canonical_domain ?? "") || null,
        companyName: String(company.name ?? "") || null,
        companyProviderId: providerId,
        kinds: ["hiring"],
        cursor: null,
        limit: 25,
      },
    );
  } catch (e) {
    if (e instanceof ProviderRefused) {
      /* FLOW-104: stamped even when refused, or this company stays at the head
         of the cross-tenant queue and is re-enqueued every tick. */
      await scope.update("companies", { last_signal_checked_at: new Date().toISOString() }).eq("id", companyId);
      return { ok: true, result: { skipped: e.meta.refusal, detail: e.meta.error, board_found: board.found } };
    }
    return { ok: false, error: `fetch_company_signals: ${e instanceof Error ? e.message : String(e)}` };
  }

  await scope.update("companies", { last_signal_checked_at: new Date().toISOString() }).eq("id", companyId);

  const postings = result.data.items;
  if (!postings.length) {
    return { ok: true, result: { found: board.found, board_found: board.found, provider: result.meta.provider, credits: result.meta.credits } };
  }

  const observedAt = new Date().toISOString();
  const rows = postings.map((signal) => {
    const where = signal.location ? ` (${signal.location})` : "";
    const dept = signal.department ? `${signal.department} — ` : "";
    return {
      subject_type: "company",
      subject_id: companyId,
      claim: `Posted a job — ${dept}${signal.title}${where} — according to ${result.meta.provider}.`,
      /* A posting with a real URL is a fact with somewhere to check it; one
         without degrades to inference rather than being written as a fact
         with no citation — the same rule `enrich_company` applies to a
         provider claim it cannot construct a record URL for. */
      kind: signal.url ? "fact" : "inference",
      confidence: "medium",
      reliability: "provider_attested",
      source_url: signal.url,
      /* TRUST-103: when we looked; the provider's date is the event. */
      observed_at: observedAt,
      event_date: signal.observedAt ?? null,
      /* Distinguishes one posting from the next under the same dedup target.
         Falls back to the bare field when neither a provider id nor a URL is
         available to key on — a real but rare limitation, worth naming
         rather than hiding: two such postings for the same company collapse
         into one evidence row. */
      field: signal.providerId ? `hiring_signal:${signal.providerId}` : "hiring_signal",
    };
  });

  const { error: evidenceError } = await scope.upsert("evidence", rows, {
    // evidence_live_source_key_uidx (0032); see TRUST-001.
    onConflict: "org_id,subject_type,subject_id,field,live_source_key",
    ignoreDuplicates: false,
  });
  if (evidenceError) {
    return { ok: false, error: `fetch_company_signals evidence: ${evidenceError.message}` };
  }

  await scope.rpc("flag_contradictions", {
    p_org: scope.orgId,
    p_subject_type: "company",
    p_subject: companyId,
  });

  return {
    ok: true,
    result: {
      found: postings.length + board.found,
      board_found: board.found,
      provider: result.meta.provider,
      credits: result.meta.credits,
      cached: result.meta.outcome === "cache_hit",
    },
  };
}

export type BoardFetcher = (url: string) => Promise<{ status: number; body: string }>;

let boardFetcher: BoardFetcher = (url) => fetchPage(url, { maxBytes: 2 * 1024 * 1024 });

/** For the test suite: job-board reads go here instead of the network. */
export function setBoardFetcherForTests(fetcher: BoardFetcher | null): void {
  boardFetcher = fetcher ?? ((url) => fetchPage(url, { maxBytes: 2 * 1024 * 1024 }));
}

/**
 * Postings from the job boards the company's own site links to, written as
 * `first_party` facts citing each posting. Every failure here is quiet — a
 * site with no careers page is normal — and never fails the job.
 */
export async function boardSignals(
  ctx: JobContext,
  companyId: string,
  domain: string,
  fetcher: BoardFetcher = boardFetcher,
  companyName: string | null = null,
): Promise<{ found: number; boards: string[] }> {
  if (!domain) return { found: 0, boards: [] };
  let boards: AtsBoard[] = [];
  for (const page of careersPages(domain)) {
    try {
      const res = await fetcher(page);
      if (res.status < 400) boards = findAtsBoards(res.body);
    } catch {
      continue;
    }
    if (boards.length) break;
  }
  if (!boards.length) return { found: 0, boards: [] };

  /* `observed_at` is when we looked; the posting's own date is `event_date`. */
  const observedAt = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];
  const live = new Map<string, Set<string>>();
  for (const board of boards.slice(0, 2)) {
    let parsed: unknown;
    try {
      const res = await fetcher(atsApiUrl(board));
      if (res.status >= 400) continue;
      parsed = JSON.parse(res.body);
    } catch {
      continue;
    }
    /* TRUST-102: a board is the company's own only when its slug looks like
       the company. Anything else linked from the site — a partner, a
       portfolio company — is recorded as an inference about a link. */
    const own = boardBelongsTo(board.slug, domain, companyName);
    const fields = new Set<string>();
    live.set(board.kind, fields);
    for (const p of parseAtsPostings(board.kind, parsed).slice(0, 50)) {
      if (!postingOnBoardHost(board.kind, p.url)) continue;
      const where = p.location ? ` (${p.location})` : "";
      const dept = p.department ? `${p.department} — ` : "";
      const field = `hiring_signal:${board.kind}:${p.id}`;
      fields.add(field);
      rows.push({
        subject_type: "company",
        subject_id: companyId,
        claim: own
          ? `Posted a job — ${dept}${p.title}${where} — on its own ${board.kind} job board.`
          : `Its website links to a ${board.kind} job board ("${board.slug}") listing ${dept}${p.title}${where}.`,
        kind: own ? "fact" : "inference",
        confidence: own ? "high" : "low",
        reliability: own ? "first_party" : "inferred",
        source_url: p.url,
        observed_at: observedAt,
        event_date: p.postedAt,
        field,
      });
    }
  }
  if (rows.length) {
    const { error } = await ctx.scope.upsert("evidence", rows, {
      onConflict: "org_id,subject_type,subject_id,field,live_source_key",
      ignoreDuplicates: false,
    });
    if (error) return { found: 0, boards: boards.map((b) => `${b.kind}:${b.slug}`) };
  }

  /* TRUST-103: a posting the board no longer lists is a filled or withdrawn
     role, not a live hiring signal. Retired for each board read this run. */
  for (const [kind, fields] of live) {
    const { data: existing } = await ctx.scope
      .select("evidence", "id, field")
      .eq("subject_type", "company")
      .eq("subject_id", companyId)
      .like("field", `hiring_signal:${kind}:%`)
      .is("deleted_at", null);
    const stale = (Array.isArray(existing) ? existing : [])
      .filter((e) => !fields.has(String((e as { field: string }).field)))
      .map((e) => String((e as { id: string }).id));
    if (stale.length) {
      await ctx.scope.update("evidence", { deleted_at: observedAt }).in("id", stale);
    }
  }

  return { found: rows.length, boards: boards.map((b) => `${b.kind}:${b.slug}`) };
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Whether a board slug plausibly names this company: its domain label or its name. */
export function boardBelongsTo(slug: string, domain: string, companyName: string | null = null): boolean {
  const s = squash(slug);
  if (s.length < 3) return false;
  const candidates = [domain.split(".")[0] ?? "", companyName ?? ""].map(squash).filter((c) => c.length >= 3);
  return candidates.some((c) => s === c || s.startsWith(c) || c.startsWith(s));
}

const BOARD_HOSTS: Record<string, RegExp> = {
  greenhouse: /(^|\.)greenhouse\.io$/i,
  lever: /(^|\.)lever\.co$/i,
  ashby: /(^|\.)ashbyhq\.com$/i,
  workable: /(^|\.)workable\.com$/i,
};

/** A posting's citation must be on the board's own host, not wherever the JSON says. */
function postingOnBoardHost(kind: string, url: string): boolean {
  try {
    return BOARD_HOSTS[kind]?.test(new URL(url).hostname) ?? false;
  } catch {
    return false;
  }
}
