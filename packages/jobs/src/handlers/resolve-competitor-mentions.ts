/**
 * `resolve_competitor_mentions` — connect what a source said about a prospect
 * to the competitor list, so "they already use Outreach" reaches the person
 * writing the email.
 *
 * ── Why this is not a model call ─────────────────────────────────────────
 *
 * The question is "does this text name one of these twelve companies, and in
 * what grammatical relationship". The competitor list is known, closed, and
 * short. A model would answer it well and would also, occasionally,
 * confidently name a competitor the text does not mention — and the output of
 * this job becomes a badge on an opportunity that changes what a salesperson
 * says in a first call.
 *
 * Deterministic matching gets that wrong in a way a person can see and fix:
 * the signal cites the evidence row, the evidence row carries the excerpt, and
 * the excerpt either contains the name or it does not. An `inference` that can
 * be checked in one click is worth more here than a better guess that cannot.
 *
 * ── What it deliberately will not do ─────────────────────────────────────
 *
 * Create competitors. A name in a prospect's blog post is not evidence that a
 * company competes with *us* — `0015` has a `discovered` origin for that, and
 * filling it from string matches would produce a competitor list made of every
 * vendor any prospect has ever mentioned. This job only links to competitors a
 * person or the onboarding step already put on the list.
 */
import { enqueue } from "../queue.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

export interface ResolveCompetitorMentionsPayload {
  companyId: string;
}

/** How many of a company's evidence rows one pass reads. */
const EVIDENCE_LIMIT = 200;

/**
 * `0015`'s relationships, strongest first.
 *
 * The order is the resolution order, and it is by consequence rather than by
 * confidence. `partner` is checked before `uses` because "integrates with
 * Salesforce" and "runs on Salesforce" are the same words about a different
 * fact, and calling a partnership a displacement opportunity is the mistake
 * that gets a salesperson laughed at. `former` beats `uses` because "moved off
 * Outreach last year" contains both patterns and only one of them is now true.
 */
export type Relationship = "partner" | "former" | "evaluating" | "uses" | "mentions";

interface Pattern {
  relationship: Relationship;
  /**
   * Matched against a window of text around the competitor's name. `NAME`
   * stands in for the matched name, so a pattern can require adjacency rather
   * than mere co-occurrence in the same paragraph.
   */
  test: RegExp;
}

/**
 * The phrasings that carry a relationship.
 *
 * Kept small on purpose. Every pattern here is a phrase whose meaning does not
 * depend on the sentence around it; anything requiring context to disambiguate
 * belongs in `mentions`, which is honest about knowing only that the name
 * appeared.
 */
const PATTERNS: Pattern[] = [
  {
    relationship: "partner",
    test: /\b(?:partner(?:s|ed|ship)?|integrat(?:es|ion|ed)|available on|listed on|built on top of)\b[^.]{0,40}NAME|NAME[^.]{0,30}\b(?:integration|marketplace|partnership)\b/i,
  },
  {
    relationship: "former",
    test: /\b(?:migrat(?:ed|ing)|mov(?:ed|ing)|switch(?:ed|ing)|replac(?:ed|ing)|churn(?:ed)?|left|away)\s+(?:from\s+|off\s+(?:of\s+)?)NAME|\bformerly\s+(?:used\s+)?NAME/i,
  },
  {
    relationship: "evaluating",
    test: /\b(?:evaluat(?:ing|ion)|considering|compar(?:ing|ison)|shortlist(?:ed|ing)?|trial(?:ling|ing)?|RFP|proof of concept|vs\.?)\b[^.]{0,40}NAME|NAME\s+(?:vs\.?|versus)\s/i,
  },
  {
    relationship: "uses",
    test: /\b(?:uses?|using|used|runs? on|running on|powered by|deployed|rolled out|standardi[sz]ed on|customer of|implemented)\b[^.]{0,30}NAME|NAME\s+(?:user|customer|stack|instance|tenant|admin)\b/i,
  },
];

export interface CompetitorRef {
  id: string;
  name: string;
  domain: string | null;
}

export interface Mention {
  competitorId: string;
  relationship: Relationship;
  /** Which token matched — the name or the domain. Kept for the audit trail. */
  matched: string;
}

/** Escapes a competitor's name for use inside a pattern. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Names too short or too generic to match on.
 *
 * A competitor legitimately called "Apollo" or "Close" will match prose that
 * has nothing to do with them, and a false "they use Close" is worse than a
 * missed signal: the missed one leaves the salesperson where they were, and
 * the false one sends them into a call with a wrong belief.
 *
 * So a name is only matched when it is either long enough to be distinctive or
 * capitalised in the text the way a product name is. The domain is always
 * safe to match on, which is why an unresolved competitor is worth resolving.
 */
const AMBIGUOUS = new Set([
  "close", "apollo", "outreach", "lever", "front", "amplitude", "attention",
  "clay", "instantly", "reply", "smartlead", "seamless", "lusha", "hunter",
]);

function isAmbiguous(name: string): boolean {
  return name.trim().length < 5 || AMBIGUOUS.has(name.trim().toLowerCase());
}

/**
 * Every competitor named in one piece of text, with the relationship its
 * phrasing supports.
 *
 * Pure, exported, and tested directly: this function is the whole judgement of
 * the job, and everything around it is reads and writes.
 */
export function detectMentions(text: string, competitors: readonly CompetitorRef[]): Mention[] {
  const found = new Map<string, Mention>();
  if (!text.trim()) return [];

  for (const competitor of competitors) {
    const tokens: string[] = [];
    if (competitor.domain) tokens.push(competitor.domain);
    if (competitor.name.trim()) tokens.push(competitor.name.trim());

    for (const token of tokens) {
      const isDomain = token === competitor.domain;
      /* An ambiguous name must appear the way a product name appears —
         capitalised — before it counts. The domain never needs this. */
      const flags = isDomain || isAmbiguous(token) ? "" : "i";
      const boundary = isDomain
        ? new RegExp(`(?<![\\w.@-])${escapeRegExp(token)}(?![\\w-])`, "i")
        : new RegExp(`(?<![\\w-])${escapeRegExp(token)}(?![\\w-])`, flags);

      const match = boundary.exec(text);
      if (!match) continue;

      /* The window the relationship is judged in. Wide enough to hold "they
         are migrating away from X", narrow enough that a competitor named in
         one sentence does not inherit the verb of the previous one. */
      const start = Math.max(0, match.index - 80);
      const window = text.slice(start, match.index + match[0].length + 60);
      const named = escapeRegExp(match[0]);

      let relationship: Relationship = "mentions";
      for (const pattern of PATTERNS) {
        const test = new RegExp(pattern.test.source.replaceAll("NAME", named), "i");
        if (test.test(window)) {
          relationship = pattern.relationship;
          break;
        }
      }

      const existing = found.get(competitor.id);
      /* One row per competitor per pass. A named relationship beats a bare
         mention; between two named ones the first in `PATTERNS` order wins,
         which is the order they are checked in. */
      if (!existing || (existing.relationship === "mentions" && relationship !== "mentions")) {
        found.set(competitor.id, { competitorId: competitor.id, relationship, matched: match[0] });
      }
      if (relationship !== "mentions") break;
    }
  }

  return [...found.values()];
}

export async function resolveCompetitorMentions(ctx: JobContext): Promise<JobOutcome> {
  const { scope, payload } = ctx;
  const companyId = String(payload.companyId ?? "");
  if (!companyId) {
    return {
      ok: false,
      permanent: true,
      error: "resolve_competitor_mentions: no companyId in payload.",
    };
  }

  const { data: competitorRows, error: competitorError } = await scope
    .select("competitors", "id, name, domain")
    .in("status", ["active", "proposed"])
    .is("deleted_at", null);

  if (competitorError) {
    return { ok: false, error: `resolve_competitor_mentions: ${competitorError.message}` };
  }

  const competitors: CompetitorRef[] = (Array.isArray(competitorRows) ? competitorRows : []).map(
    (row: { id: unknown; name: unknown; domain: unknown }) => ({
      id: String(row.id),
      name: String(row.name ?? ""),
      domain: row.domain ? String(row.domain) : null,
    }),
  );

  /* An org that has named no competitors is the common case on day one, and
     it is a success with nothing to do rather than a failure. */
  if (!competitors.length) {
    return { ok: true, result: { skipped: "no competitors are on the list" } };
  }

  const { data: evidenceRows, error: evidenceError } = await scope
    .select("evidence", "id, claim, excerpt, observed_at, event_date")
    .eq("subject_type", "company")
    .eq("subject_id", companyId)
    .is("deleted_at", null)
    .order("observed_at", { ascending: false })
    .limit(EVIDENCE_LIMIT);

  if (evidenceError) {
    return { ok: false, error: `resolve_competitor_mentions: ${evidenceError.message}` };
  }

  /* One signal per (competitor, relationship), carrying the *newest* evidence
     that supports it. `0015`'s unique index enforces the same shape in the
     database; doing it here as well means one upsert per relationship rather
     than one per evidence row, and it is what decides which citation a person
     sees when three articles say the same thing. */
  const signals = new Map<string, {
    competitorId: string;
    relationship: Relationship;
    evidenceId: string;
    observedAt: string | null;
  }>();

  let scanned = 0;
  for (const row of Array.isArray(evidenceRows) ? evidenceRows : []) {
    const text = [row.claim, row.excerpt].filter(Boolean).join("\n");
    scanned++;
    for (const mention of detectMentions(text, competitors)) {
      const key = `${mention.competitorId}:${mention.relationship}`;
      if (signals.has(key)) continue;
      signals.set(key, {
        competitorId: mention.competitorId,
        relationship: mention.relationship,
        evidenceId: String(row.id),
        /* When the thing happened, not when we read about it. "Used a
           competitor in 2019" is not a signal, and `0015` keeps the two
           dates apart so a screen can say which it has. */
        observedAt: row.event_date ? String(row.event_date) : (row.observed_at ? String(row.observed_at) : null),
      });
    }
  }

  if (!signals.size) {
    return { ok: true, result: { scanned, signals: 0 } };
  }

  const { error: upsertError } = await scope.upsert(
    "company_competitor_signals",
    [...signals.values()].map((signal) => ({
      company_id: companyId,
      competitor_id: signal.competitorId,
      relationship: signal.relationship,
      /* Always an inference. A phrase match is evidence about the *text*, not
         about the company, and the difference is exactly what §7 exists to
         keep visible. A bare mention is weaker still. */
      claim_kind: "inference",
      confidence: signal.relationship === "mentions" ? "low" : "medium",
      evidence_id: signal.evidenceId,
      observed_at: signal.observedAt,
      detected_by: "resolve_competitor_mentions",
    })),
    {
      onConflict: "org_id,company_id,competitor_id,relationship",
      ignoreDuplicates: false,
    },
  );

  if (upsertError) {
    return { ok: false, error: `resolve_competitor_mentions: ${upsertError.message}` };
  }

  /* A prospect using a competitor changes what the qualifier should conclude
     and what the message should say, so the verdict is stale. Keyed per
     company, as everywhere else, so a scan that produced twenty evidence rows
     produces one rescore. */
  await enqueue({
    orgId: scope.orgId,
    name: "score_opportunity",
    payload: { companyId },
    idempotencyKey: `score:${companyId}`,
  });

  return {
    ok: true,
    result: {
      scanned,
      signals: signals.size,
      relationships: [...new Set([...signals.values()].map((s) => s.relationship))],
    },
  };
}
