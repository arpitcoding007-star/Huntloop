/**
 * The first sixty seconds of a workspace.
 *
 * ── Why this exists as its own module ────────────────────────────────────
 *
 * Everything a new workspace needs already runs — `discover_companies`,
 * `enrich_company`, `score_opportunity`, `rank_contacts`, `explain_why_now`
 * are all real handlers driven by the queue and a cron tick. What did not
 * exist is the thing that makes them *arrive while the user is still looking
 * at the screen*.
 *
 * That distinction is the whole first-run experience. A user who finishes
 * onboarding and is dropped on an empty dashboard with "we'll let you know"
 * has been given a promise; a user who watches three companies appear, with
 * scores and cited evidence, has been given the product. The engine is the
 * same either way — the difference is whether anybody drives it inside a
 * request.
 *
 * ── Why it drives the handlers directly instead of the queue ─────────────
 *
 * `tick()` is the right thing for a cron and the wrong thing here for two
 * reasons. It claims work for *every* tenant, so a user's setup request would
 * run somebody else's scheduled scan and be billed for the latency; and it
 * claims in queue order, so the progress bar could not say what stage it was
 * at — the one thing this screen has to do.
 *
 * So the stages below are explicit and ordered, each one bounded, and each one
 * reporting what it did. The handlers are the same objects the runner calls,
 * with the same `OrgScope`, so there is exactly one implementation of
 * discovery and this file is not a second one that can drift.
 *
 * ── Why every stage degrades independently ───────────────────────────────
 *
 * Because they fail for unrelated reasons and the useful ones fail last. No
 * Apollo key means no discovery, and the workspace is still correctly
 * configured. A contact reveal that runs out of credits leaves the company
 * recommendation and its why-now completely intact. A stage that took the
 * whole run down with it would turn a partial success — which is genuinely
 * useful — into an error screen.
 */
import { canonicalFilters, translateIcp, type DiscoveryFilters } from "@huntloop/db/discovery";
import { parseIcp, type Icp } from "@huntloop/db/icp";
import { HANDLERS, type JobContext } from "./registry.ts";
import { OrgScope, adminClient } from "./scope.ts";
import { expandWithLookAlikes, type LookAlikeResult } from "./look-alike.ts";
import type { JobRow } from "./queue.ts";

/** The stages, in the order the screen shows them. */
export const FIRST_RUN_STAGES = [
  "discover",
  "enrich",
  "score",
  "contacts",
  "explain",
] as const;

export type FirstRunStage = (typeof FIRST_RUN_STAGES)[number];

export interface StageResult {
  stage: FirstRunStage;
  /** `skipped` is a first-class outcome — see the header. */
  status: "done" | "skipped" | "failed";
  /** One sentence for the screen. Always present, never a stack trace. */
  detail: string;
  /** How many things this stage produced, when that is a meaningful number. */
  count: number;
}

/**
 * How much of the market a first run touches.
 *
 * Twenty-five companies is enough to prove the product and cheap enough that a
 * trial cannot be emptied by one signup. The rest of the market is not lost —
 * the saved query keeps running on a schedule — so this is a pacing decision
 * rather than a limit on what the user gets.
 */
const FIRST_RUN_PAGES = 1;
const FIRST_RUN_CREDITS = 40;

/**
 * How many companies get a paid contact reveal on the first run.
 *
 * Three, and deliberately not more. A revealed contact is the most expensive
 * per-record call the product makes, and three is enough to demonstrate the
 * capability on the companies the user will actually look at. Twenty-five
 * would be a four-figure surprise on a free trial.
 */
const FIRST_RUN_CONTACTS = 3;

/* ── The discovery query ─────────────────────────────────────────────────── */

/**
 * The saved search this workspace's profile translates to.
 *
 * Upserted on `filters_hash` rather than created blindly, because `0014` makes
 * `(org_id, filters_hash)` unique — two runs of onboarding, or a user who goes
 * back and forward, must produce one query rather than a unique-violation on
 * the last step of setup.
 *
 * It is created **enabled** with an interval. That is the difference between a
 * one-off search and a product: the same profile keeps finding companies next
 * week without anyone pressing anything, which is what the user asked for when
 * they picked `discover` as a goal.
 */
export async function ensureDiscoveryQuery(
  orgId: string,
  options: { enabled: boolean } = { enabled: true },
): Promise<{
  queryId: string | null;
  filters: DiscoveryFilters;
  empty: boolean;
  reason?: string;
  /** What the example companies contributed, when there were any. */
  lookAlike?: LookAlikeResult;
}> {
  const scope = new OrgScope(orgId, adminClient());

  const { data: icpRow } = await scope
    .select("icps", "id, current_version_id, criteria, negative_criteria")
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!icpRow) {
    return {
      queryId: null,
      filters: emptyFilters(),
      empty: true,
      reason: "This workspace has no active customer profile yet.",
    };
  }

  let icp: Icp;
  try {
    icp = parseIcp(icpRow.criteria, icpRow.negative_criteria);
  } catch (error) {
    return {
      queryId: null,
      filters: emptyFilters(),
      empty: true,
      reason: error instanceof Error ? error.message : "The customer profile could not be read.",
    };
  }

  const translation = translateIcp(icp);

  /* A search with no filters is a search for "all companies". It costs money
     and returns the internet — and the companies it produced would be
     presented as matching a profile they were never checked against. */
  if (translation.empty) {
    return {
      queryId: null,
      filters: translation.filters,
      empty: true,
      reason:
        "Nothing in this profile can be turned into a company search yet. " +
        "Adding a segment, an industry or a size band is what makes it searchable.",
    };
  }

  /*
   * The example companies, turned from description into filters.
   *
   * `translateIcp` files `exampleCompanies` under unmapped with the note that
   * they "describe the target rather than filter for it" — true of the names,
   * and no longer true once they are resolved into attributes. See
   * `look-alike.ts` for why this is an enrichment fold rather than a vendor's
   * similar-company endpoint.
   *
   * It runs *after* the empty check, so a profile whose only content is a list
   * of example domains is still refused. Expanding from nothing but examples
   * would produce a search built entirely out of attributes the user never
   * stated, presented as matching their profile.
   */
  const lookAlike = await expandWithLookAlikes(
    orgId,
    translation.filters,
    icp.criteria.exampleCompanies ?? [],
  );

  /* Hashed from the *expanded* filters, so a profile whose examples changed
     gets its own saved query rather than silently reusing the one built before
     they were added. `(org_id, filters_hash)` is unique, and the hash is the
     only thing that distinguishes two searches. */
  const hash = await sha256(canonicalFilters(lookAlike.filters));

  const { data: existing } = await scope
    .select("discovery_queries", "id")
    .eq("filters_hash", hash)
    .is("deleted_at", null)
    .maybeSingle();

  if (existing?.id) {
    /* Re-enabled rather than left as found. A user who reaches this step has
       just asked for discovery; a query they disabled last month and then
       rebuilt the same profile is asking for it again. */
    await scope
      .update("discovery_queries", {
        is_enabled: options.enabled,
        is_saved: true,
        icp_id: icpRow.id,
        icp_version_id: icpRow.current_version_id ?? null,
        unmappable: translation.unmapped,
        next_run_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    return { queryId: String(existing.id), filters: lookAlike.filters, empty: false, lookAlike };
  }

  const { data: created, error } = await scope
    .insert("discovery_queries", {
      icp_id: icpRow.id,
      icp_version_id: icpRow.current_version_id ?? null,
      name: "From your customer profile",
      filters: lookAlike.filters,
      filters_hash: hash,
      /* Recorded rather than dropped. A customer whose "uses Kubernetes"
         criterion silently vanished would reasonably believe the results
         honour it — `DSC-02`'s honesty requirement, in a column. */
      unmappable: translation.unmapped,
      is_saved: true,
      is_enabled: options.enabled,
      /* Daily. Frequent enough that a trigger is caught while it is still news,
         infrequent enough that a market of a few thousand companies is not
         re-enumerated hourly at the customer's expense. */
      interval_minutes: 1440,
      next_run_at: new Date().toISOString(),
      credit_budget: FIRST_RUN_CREDITS,
      max_pages: FIRST_RUN_PAGES,
    })
    .select("id")
    .maybeSingle();

  if (error || !created) {
    return {
      queryId: null,
      filters: lookAlike.filters,
      empty: true,
      reason: error?.message ?? "The discovery search could not be created.",
    };
  }

  return { queryId: String(created.id), filters: lookAlike.filters, empty: false, lookAlike };
}

/* ── Running a stage ─────────────────────────────────────────────────────── */

/**
 * Runs one handler directly, outside the queue.
 *
 * The synthetic `JobRow` is honest about what it is: no handler in this repo
 * reads anything off it except through `payload`, which is passed properly.
 * Giving it a real row would mean writing a `job_executions` row for work that
 * is being done inline and would then have to be reconciled — two records of
 * one execution, which is how a queue ends up double-running something.
 */
async function runHandler(
  orgId: string,
  name: keyof typeof HANDLERS,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; detail: string; result: Record<string, unknown> }> {
  const handler = HANDLERS[name];
  if (!handler) return { ok: false, detail: `No handler for ${String(name)}.`, result: {} };

  const job: JobRow = {
    id: `first-run-${String(name)}`,
    org_id: orgId,
    job_name: name,
    status: "running",
    attempts: 1,
    max_attempts: 1,
    payload,
    run_at: new Date().toISOString(),
    error: null,
  };

  const ctx: JobContext = {
    scope: new OrgScope(orgId, adminClient()),
    payload,
    job,
    now: new Date(),
  };

  try {
    const outcome = await handler(ctx);
    return outcome.ok
      ? { ok: true, detail: "", result: outcome.result }
      : { ok: false, detail: outcome.error, result: {} };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      result: {},
    };
  }
}

/* ── The stages ──────────────────────────────────────────────────────────── */

/**
 * Stage one: find companies.
 *
 * The single most important rule here, inherited from `discover_companies`
 * itself: **a failed search must never look like an empty market.** A customer
 * who reads "0 companies match your profile" edits a profile that was fine, or
 * concludes the product does not work — and neither is recoverable by us,
 * because nothing looks broken. Every exit below says which of the two it is.
 */
export async function stageDiscover(orgId: string): Promise<StageResult> {
  const query = await ensureDiscoveryQuery(orgId);

  if (!query.queryId) {
    return {
      stage: "discover",
      status: "skipped",
      detail: query.reason ?? "There was nothing to search for.",
      count: 0,
    };
  }

  const run = await runHandler(orgId, "discover_companies", { queryId: query.queryId });

  if (!run.ok) {
    return {
      stage: "discover",
      status: "failed",
      // The handler's own message, which distinguishes "no provider is
      // configured" from "the provider refused" from "the budget is spent".
      detail: run.detail,
      count: 0,
    };
  }

  const created = Number(run.result.created ?? run.result.companies ?? 0);

  /*
   * What the example companies contributed, said out loud.
   *
   * An expansion the user cannot see is an expansion they cannot disagree
   * with — and this one widens a search they are paying for, using attributes
   * they never typed. Naming them is the difference between a look-alike
   * feature and a search that quietly does something else.
   */
  const lookAlike = query.lookAlike;
  const expansion =
    lookAlike && lookAlike.added.length > 0
      ? ` Widened from ${lookAlike.resolved.join(", ")} — added ${lookAlike.added.join("; ")}.`
      : lookAlike?.skipped
        ? ` ${lookAlike.skipped}`
        : "";

  return {
    stage: "discover",
    status: "done",
    detail:
      (created > 0
        ? `Found ${created} matching ${created === 1 ? "company" : "companies"}.`
        : "The search ran and returned nothing new — every match is already in your workspace.") +
      expansion,
    count: created,
  };
}

/**
 * The companies worth spending a model call on, newest first.
 *
 * Bounded because every one of these becomes paid work. `discover_companies`
 * already caps what it auto-researches for the same reason; this is the
 * interactive equivalent.
 */
async function recentCompanies(orgId: string, limit: number): Promise<{ id: string; domain: string; name: string }[]> {
  const scope = new OrgScope(orgId, adminClient());
  const { data } = await scope
    .select("companies", "id, canonical_domain, name")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map((c: { id: string; canonical_domain: string; name: string }) => ({
    id: String(c.id),
    domain: String(c.canonical_domain),
    name: String(c.name ?? c.canonical_domain),
  }));
}

/** Stage two: fill in what the provider knows about each company. */
export async function stageEnrich(orgId: string, limit = 10): Promise<StageResult> {
  const companies = await recentCompanies(orgId, limit);
  if (companies.length === 0) {
    return {
      stage: "enrich",
      status: "skipped",
      detail: "No companies to enrich yet.",
      count: 0,
    };
  }

  let done = 0;
  for (const company of companies) {
    const run = await runHandler(orgId, "enrich_company", { companyId: company.id });
    if (run.ok) done++;
  }

  return {
    stage: "enrich",
    status: done > 0 ? "done" : "skipped",
    detail:
      done > 0
        ? `Filled in details for ${done} ${done === 1 ? "company" : "companies"}.`
        : "No enrichment provider is connected, so we used what the search returned.",
    count: done,
  };
}

/**
 * Stage three: judge each company against the profile.
 *
 * The stage that produces the thing the user actually came for. It runs even
 * when enrichment was skipped, because `qualify` reasons over evidence and a
 * company with only its search attributes is still judgeable — thinly, and it
 * says so in its own confidence.
 */
export async function stageScore(orgId: string, limit = 10): Promise<StageResult> {
  const companies = await recentCompanies(orgId, limit);
  if (companies.length === 0) {
    return { stage: "score", status: "skipped", detail: "Nothing to score yet.", count: 0 };
  }

  let scored = 0;
  const failures: string[] = [];

  for (const company of companies) {
    const run = await runHandler(orgId, "score_opportunity", { companyId: company.id });
    if (run.ok) scored++;
    else if (failures.length < 1) failures.push(run.detail);
  }

  if (scored === 0) {
    return {
      stage: "score",
      status: "failed",
      detail: failures[0] ?? "Nothing could be scored.",
      count: 0,
    };
  }

  return {
    stage: "score",
    status: "done",
    detail: `Scored ${scored} ${scored === 1 ? "company" : "companies"} against your profile.`,
    count: scored,
  };
}

/** Stage four: work out who to talk to. */
export async function stageContacts(orgId: string): Promise<StageResult> {
  const scope = new OrgScope(orgId, adminClient());

  /* The top opportunities rather than the newest companies. A contact reveal
     costs credits, and spending them on the companies the user is least likely
     to open is the wrong three. */
  const { data } = await scope
    .select("opportunities", "id, company_id, score")
    .is("deleted_at", null)
    .order("score", { ascending: false, nullsFirst: false })
    .limit(FIRST_RUN_CONTACTS);

  const rows = (data ?? []) as { id: string; company_id: string }[];
  if (rows.length === 0) {
    return {
      stage: "contacts",
      status: "skipped",
      detail: "No opportunities to find contacts for yet.",
      count: 0,
    };
  }

  let found = 0;
  let lastDetail = "";
  for (const row of rows) {
    /* `discover: true` — ask the provider for people rather than ranking the
       none we have. On a first run there are no contacts to rank, so the
       cheaper mode would return an empty list and report success, which is the
       worst of both: a credit not spent and a stage that looks done. */
    const run = await runHandler(orgId, "rank_contacts", {
      opportunityId: row.id,
      discover: true,
    });
    if (run.ok) found += Number(run.result.ranked ?? run.result.contacts ?? 1);
    else lastDetail = run.detail;
  }

  return {
    stage: "contacts",
    status: found > 0 ? "done" : "skipped",
    detail:
      found > 0
        ? `Found people to reach at ${rows.length} ${rows.length === 1 ? "company" : "companies"}.`
        : lastDetail ||
          "No contact provider is connected, so we haven't looked for people yet.",
    count: found,
  };
}

/**
 * Stage five: say why each of the best ones matters now.
 *
 * `research_company` rather than a why-now task directly: the job gathers the
 * evidence a why-now is *built from*, and an explanation with no evidence
 * behind it is the §7 failure this product exists not to commit. The three
 * companies the user is about to read are the three worth paying to research.
 */
export async function stageExplain(orgId: string): Promise<StageResult> {
  const scope = new OrgScope(orgId, adminClient());
  const { data } = await scope
    .select("opportunities", "id, company_id")
    .is("deleted_at", null)
    .order("score", { ascending: false, nullsFirst: false })
    .limit(3);

  const rows = (data ?? []) as { id: string; company_id: string }[];
  if (rows.length === 0) {
    return { stage: "explain", status: "skipped", detail: "Nothing to explain yet.", count: 0 };
  }

  let explained = 0;
  let lastDetail = "";
  for (const row of rows) {
    const run = await runHandler(orgId, "research_company", { companyId: row.company_id });
    if (run.ok) explained++;
    else lastDetail = run.detail;
  }

  return {
    stage: "explain",
    status: explained > 0 ? "done" : "skipped",
    detail:
      explained > 0
        ? `Worked out why now for your top ${explained}.`
        : lastDetail || "We'll explain these once there's more evidence to reason over.",
    count: explained,
  };
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function emptyFilters(): DiscoveryFilters {
  return {
    keywords: [],
    industries: [],
    locations: [],
    employeeMin: null,
    employeeMax: null,
    revenueBands: [],
    technologies: [],
    excludeDomains: [],
  };
}

/**
 * Hex sha256, via WebCrypto.
 *
 * `node:crypto` would be the obvious import and is avoided so this module
 * stays usable from any runtime the app is deployed on. `globalThis.crypto` is
 * present on Node 18+ and on every edge runtime.
 */
async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
