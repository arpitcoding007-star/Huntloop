/**
 * Exercises the engine without a network, a database, or a key.
 *
 * What is worth testing here is not "does supabase-js work". It is the set of
 * properties that would keep *looking* correct if they were quietly removed:
 *
 *   · a scope cannot be talked out of its org filter, even by a caller
 *     supplying a different org_id;
 *   · the fetcher refuses the addresses that turn a scan into an SSRF, and
 *     re-checks them on every redirect hop;
 *   · the extractor produces one document per feed item and the same hash for
 *     the same article reached two ways (§60);
 *   · a tick claims, dispatches, records, and stops at its deadline rather
 *     than being killed holding a lock.
 *
 * Each subject lives in `verify-jobs/`. They run one after another, in this
 * order, because some share process-wide state (the admin client, `fetch`,
 * the environment) that each section sets and puts back.
 *
 *   npm test --workspace @huntloop/jobs
 */
import { report } from "./verify-jobs/harness.ts";

for (const subject of [
  "scope-and-fetch",
  "runner",
  "send-message",
  "sync-mailbox",
  "scheduling-and-scoring",
  "compliance",
  "competitors",
  "company-research",
  "hubspot",
  "enrollments",
  "digests",
  "exchange",
]) {
  await import(`./verify-jobs/${subject}.ts`);
}

report();
