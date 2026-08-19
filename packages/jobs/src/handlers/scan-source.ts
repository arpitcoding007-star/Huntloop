/**
 * `scan_source` — read one source, and turn what it published into evidence.
 *
 * This is the loop the product is named after, and it is five steps:
 *
 *   fetch     one HTTP request, bounded and SSRF-checked (`fetch.ts`)
 *   extract   markup or feed → documents (`extract.ts`)
 *   dedupe    §60, on both content and canonical URL
 *   signals   documents → §33's normalized `source_events`, via the model
 *   resolve   events → companies, triggers, and §52 evidence rows
 *
 * ── What happens when a step cannot run ──────────────────────────────────
 *
 * Each step degrades to the step before it rather than failing the scan. With
 * no `ANTHROPIC_API_KEY` the fetch and the dedupe still happen and the
 * documents are stored; the result says extraction was skipped and why. That
 * is the difference between a scan that did four fifths of its job and one
 * that reports success having produced nothing — and the source screen shows
 * the document count, so the difference is visible rather than asserted.
 *
 * ── Why nothing here creates an opportunity ──────────────────────────────
 *
 * §78 forbids a strong trigger lifting a poor-fit company, and this handler
 * has no ICP — it does not know what a good fit is. It produces companies,
 * triggers and evidence, and enqueues `score_opportunity`, which does. Letting
 * the scanner decide would put the qualification verdict in the one place with
 * the least context to make it.
 */
import { extractSignals, type ExtractedSignal } from "@huntloop/ai";
import { AiUnavailable, runForOrg } from "../ai.ts";
import { canonicalize, extract, urlHash, UnreadableContent } from "../extract.ts";
import { FetchRefused, fetchPage } from "../fetch.ts";
import { enqueue } from "../queue.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

/**
 * How many new documents one scan will read with a model.
 *
 * A cap on spend per tick, not on ingestion: every new document is stored, and
 * the ones past the cap are picked up by the next scan because they are still
 * missing their events. A feed that publishes eighty items overnight therefore
 * costs eighty extractions spread over several ticks rather than eighty at
 * once — which is the shape that keeps a runaway source from emptying a
 * month's quota before anyone sees the bill.
 */
const MAX_EXTRACTIONS_PER_SCAN = 10;

export interface ScanPayload {
  sourceId: string;
}

export async function scanSource(ctx: JobContext): Promise<JobOutcome> {
  const { scope, payload } = ctx;
  const sourceId = String(payload.sourceId ?? "");
  if (!sourceId) return { ok: false, permanent: true, error: "scan_source: no sourceId in payload." };

  const { data: source, error } = await scope.select("sources", "id, name, kind, url, is_enabled, config")
    .eq("id", sourceId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) return { ok: false, error: `scan_source: ${error.message}` };
  if (!source) {
    // Deleted between enqueue and claim. Not a failure — the work is moot.
    return { ok: true, result: { skipped: "the source no longer exists" } };
  }
  if (!source.is_enabled) {
    return { ok: true, result: { skipped: "the source is paused" } };
  }
  if (!source.url) {
    /* A source with no address cannot be scanned and will not acquire one by
       being retried. Marked on the row rather than only in the job, because
       the person who can fix it is looking at the sources screen. */
    await scope.rpc("record_source_failure", {
      p_source: sourceId,
      p_error: "This source has no URL, so there is nothing to read.",
    });
    return { ok: false, permanent: true, error: "scan_source: the source has no URL." };
  }

  /* ── fetch ─────────────────────────────────────────────────────────── */

  let page;
  try {
    page = await fetchPage(String(source.url), {
      etag: (source.config as Record<string, unknown> | null)?.etag as string | undefined,
    });
  } catch (e) {
    const refusal = e instanceof FetchRefused ? e : null;
    const message = e instanceof Error ? e.message : String(e);
    await scope.rpc("record_source_failure", { p_source: sourceId, p_error: message });
    // A refusal that cannot succeed on retry — a bad scheme, a private
    // address, a 404 — is permanent here *and* still scheduled on the source
    // row, so the user can fix the URL and the next tick picks it up.
    return { ok: false, permanent: refusal ? !refusal.retryable : false, error: message };
  }

  if (page.status === 304) {
    // Nothing changed since last time. A success, and a cheap one — the whole
    // reason the etag is sent.
    await scope.rpc("record_source_success", { p_source: sourceId });
    return { ok: true, result: { unchanged: true, documents: 0, events: 0 } };
  }

  let extraction;
  try {
    extraction = extract(page);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await scope.rpc("record_source_failure", { p_source: sourceId, p_error: message });
    return { ok: false, permanent: e instanceof UnreadableContent, error: message };
  }

  /* ── store, deduplicated ───────────────────────────────────────────── */

  const fresh: { id: string; url: string; title: string | null; publishedAt: string | null; text: string }[] = [];
  let duplicates = 0;

  for (const doc of extraction.documents) {
    const canonical = canonicalize(doc.canonicalUrl ?? doc.url);
    const row = {
      source_id: sourceId,
      url: doc.url,
      canonical_url: canonical,
      title: doc.title,
      published_at: doc.publishedAt,
      content_hash: doc.contentHash,
      url_hash: urlHash(canonical),
    };

    /* Insert and let the two unique indexes from `0002` and `0008` arbitrate,
       rather than selecting first. A read-then-write would be a race against
       every other scan reaching the same syndicated article, and §60 is a
       claim about the data, not about the order jobs happen to run in. */
    const { data: inserted, error: insertError } = await scope
      .insert("source_documents", row)
      .select("id")
      .maybeSingle();

    if (insertError) {
      if (insertError.code === "23505") {
        duplicates++;
        continue;
      }
      return { ok: false, error: `scan_source: storing a document failed: ${insertError.message}` };
    }
    if (!inserted) continue;

    fresh.push({
      id: String(inserted.id),
      url: doc.url,
      title: doc.title,
      publishedAt: doc.publishedAt,
      text: doc.text,
    });
  }

  /* ── extract signals ───────────────────────────────────────────────── */

  let events = 0;
  let companies = 0;
  let skippedExtraction: string | null = null;

  for (const doc of fresh.slice(0, MAX_EXTRACTIONS_PER_SCAN)) {
    /* An empty document is a fetch that succeeded and produced nothing to read
       — a JS-rendered page, or a feed item with a title and no body. Sending
       it to the model would bill for the certainty that there is nothing
       there. */
    if (doc.text.trim().length < 200) continue;

    let signals: ExtractedSignal[];
    try {
      const run = await runForOrg(scope, extractSignals, {
        url: doc.url,
        title: doc.title,
        publishedAt: doc.publishedAt,
        text: doc.text,
      });
      signals = run.output;
    } catch (e) {
      if (e instanceof AiUnavailable) {
        // Stop asking. Every remaining document would fail the same way, and
        // the reason is a deployment fact rather than a per-document one.
        skippedExtraction = e.message;
        break;
      }
      /* One document the model could not read does not fail the scan. It is
         recorded against the source so a systematically unreadable feed shows
         up as degraded rather than as silence. */
      await scope.rpc("record_source_failure", {
        p_source: sourceId,
        p_error: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    for (const signal of signals) {
      const resolved = await recordSignal(ctx, sourceId, doc.id, doc.url, signal);
      if (resolved.recorded) events++;
      if (resolved.companyCreated) companies++;
    }
  }

  /* ── close out ─────────────────────────────────────────────────────── */

  await scope.rpc("record_source_success", { p_source: sourceId });

  if (extraction.discoveredFeeds.length > 0 && extraction.format === "html") {
    /* Recorded, not adopted. Switching the source to a feed we found would
       change what the user's source list says it is, without them asking —
       and the sources screen offers "use this feed instead" from this field. */
    await scope.update("sources", {
        config: {
          ...((source.config as Record<string, unknown> | null) ?? {}),
          discovered_feeds: extraction.discoveredFeeds.slice(0, 5),
        },
      })
      .eq("id", sourceId);
  }

  return {
    ok: true,
    result: {
      format: extraction.format,
      documents: fresh.length,
      duplicates,
      events,
      companies,
      ...(skippedExtraction ? { extraction_skipped: skippedExtraction } : {}),
    },
  };
}

/**
 * One extracted signal → the rows §33 and §52 require.
 *
 * Four writes, in this order, because each depends on the one before it:
 *
 *   companies        the §59 entity, resolved on canonical_domain
 *   source_events    the normalized event the engine reads
 *   evidence         the §52 claim, with its excerpt and provenance
 *   company_triggers the "why now" input, linked to that evidence
 *
 * A signal with no domain gets the first three and not the fourth: without a
 * resolution key there is no company row to hang a trigger on, and matching on
 * name would merge two companies called Northwind.
 */
async function recordSignal(
  ctx: JobContext,
  sourceId: string,
  documentId: string,
  documentUrl: string,
  signal: ExtractedSignal,
): Promise<{ recorded: boolean; companyCreated: boolean }> {
  const { scope } = ctx;
  let companyId: string | null = null;
  let companyCreated = false;

  if (signal.companyDomain) {
    const { data: existing } = await scope.select("companies", "id")
      .eq("canonical_domain", signal.companyDomain)
      .maybeSingle();

    if (existing) {
      companyId = String(existing.id);
    } else {
      const { data: created, error } = await scope
        .insert("companies", {
          canonical_domain: signal.companyDomain,
          name: signal.companyName ?? signal.companyDomain,
          website: `https://${signal.companyDomain}`,
          discovered_via: "scan",
        })
        .select("id")
        .maybeSingle();

      /* 23505 means a concurrent scan created it between the select and the
         insert. Re-reading is the correct resolution, and it is why this is
         not written as an upsert: an upsert would overwrite a researched
         company's name with whatever a news article happened to call it. */
      if (error?.code === "23505") {
        const { data: raced } = await scope.select("companies", "id")
          .eq("canonical_domain", signal.companyDomain)
          .maybeSingle();
        companyId = raced ? String(raced.id) : null;
      } else if (created) {
        companyId = String(created.id);
        companyCreated = true;
      }
    }
  }

  const { error: eventError } = await scope.insert("source_events", {
    source_document_id: documentId,
    company_id: companyId,
    event_type: signal.eventType,
    event_date: signal.eventDate,
    description: signal.description,
    confidence: signal.confidence,
    kind: signal.kind,
    url: documentUrl,
  });
  if (eventError) return { recorded: false, companyCreated };

  if (!companyId) return { recorded: true, companyCreated };

  /* §52. The excerpt is the whole value of the row — it is what lets a person
     answer "why do you think this?" without re-reading the page, and
     `extract_signals` refuses to return one that is not in the document. */
  const { data: evidence } = await scope
    .insert("evidence", {
      subject_type: "company",
      subject_id: companyId,
      claim: signal.description,
      kind: signal.kind,
      confidence: signal.confidence,
      source_id: sourceId,
      // Required by `evidence_fact_needs_source` when kind is 'fact', and
      // correct for an inference too: the page is where the reasoning started.
      source_url: documentUrl,
      excerpt: signal.excerpt,
      event_date: signal.eventDate,
    })
    .select("id")
    .maybeSingle();

  /* Only event types that are genuinely *timed* become triggers. A trigger
     with no date cannot be aged, and §81's whole point is that old evidence
     stops counting as current — a trigger that is always fresh is worse than
     no trigger, because it scores. */
  if (signal.eventDate && TRIGGER_TYPES.has(signal.eventType)) {
    await scope.insert("company_triggers", {
      company_id: companyId,
      trigger_type: signal.eventType,
      event_date: signal.eventDate,
      strength: STRENGTH[signal.confidence],
      evidence_id: evidence ? String(evidence.id) : null,
    });
  }

  /* The scan does not qualify. It hands the company to the step that has the
     ICP, keyed so that ten articles about one company in one tick produce one
     scoring job rather than ten. */
  await enqueue({
    orgId: scope.orgId,
    name: "score_opportunity",
    payload: { companyId },
    idempotencyKey: `score:${companyId}`,
  });

  return { recorded: true, companyCreated };
}

/**
 * Which events are "why now" material.
 *
 * Deliberately not all of them. A public complaint is real evidence about a
 * company and is not a reason to contact them this week; a technology adoption
 * is a fit signal rather than a timing one. §13 is about urgency, and widening
 * this set is how every company ends up with a trigger and the ranking stops
 * meaning anything.
 */
const TRIGGER_TYPES = new Set<string>([
  "funding",
  "hiring",
  "product_launch",
  "leadership_change",
  "expansion",
  "partnership",
  "acquisition",
  "regulatory",
  "layoffs",
]);

/**
 * Trigger strength from the extractor's confidence.
 *
 * A deliberately coarse mapping of three values onto three, not a formula. §51
 * records the combination rule as NOT DEFINED and warns against inventing one
 * and presenting it as the model's arithmetic — so this is stated as what it
 * is: how sure the extractor was that the event happened at all.
 */
const STRENGTH: Record<string, number> = { high: 80, medium: 55, low: 30 };
