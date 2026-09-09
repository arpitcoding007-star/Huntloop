/**
 * The ledger — every paid call, recorded.
 *
 * ── Why this is one RPC and not three writes ─────────────────────────────
 *
 * `record_provider_call` in `0011` writes the ledger row, the usage counter
 * and the breaker state together. Doing that as three statements from here
 * means a crash between the first and the third leaves a spend that no budget
 * can see — which is precisely the failure a budget exists to prevent, caused
 * by the code that implements it.
 *
 * ── Why a failure to record is not a failure of the call ─────────────────
 *
 * The call already happened and the money is already spent. Throwing here
 * would turn a bookkeeping problem into a lost result, and the caller would
 * retry — spending the money a second time to fix a problem with recording
 * that it was spent once.
 *
 * So a recording failure is logged loudly and swallowed. The consequence is
 * an under-counted budget, which is a reconciliation; the alternative is
 * double-spending, which is a bill.
 */
import type { AdminClient } from "@huntloop/db/admin";
import type { CallMeta } from "./contract.ts";

/* eslint-disable @typescript-eslint/no-explicit-any -- see cache.ts */
type Query = any;

export interface LedgerEntry {
  orgId: string;
  meta: CallMeta;
  requestHash: string;
  entity: { type: string; id: string } | null;
}

export async function recordCall(db: AdminClient, entry: LedgerEntry): Promise<void> {
  const { meta } = entry;

  const { error } = await (db.rpc as Query)("record_provider_call", {
    p_org: entry.orgId,
    p_capability: meta.capability,
    p_provider: meta.provider,
    p_hash: entry.requestHash,
    p_outcome: meta.outcome,
    p_credits: meta.credits,
    p_http_status: meta.httpStatus,
    p_latency_ms: meta.latencyMs,
    p_attempts: Math.max(meta.attempts, 1),
    p_error: meta.error,
    p_entity_type: entry.entity?.type ?? null,
    p_entity_id: entry.entity?.id ?? null,
  });

  if (error) {
    /* Loud, because an unrecorded spend is invisible everywhere else: not in
       the cost screen, not in the budget, not in the health view. This log
       line is the only trace it leaves. */
    console.error(
      `[providers] FAILED TO RECORD a ${meta.provider} ${meta.capability} call ` +
        `(${meta.outcome}, ${meta.credits} credits): ${error.message}`,
    );
  }
}

export interface ProviderUsage {
  provider: string;
  capability: string;
  calls: number;
  cacheHits: number;
  credits: number;
  failures: number;
}

/**
 * What one org spent this month, per provider.
 *
 * Reads the ledger rather than the counters, because the counters hold only
 * credits and the interesting questions — how often did the cache save us,
 * how often did a provider fail — need the outcomes.
 */
export async function usageThisMonth(
  db: AdminClient,
  orgId: string,
): Promise<ProviderUsage[]> {
  const since = new Date();
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);

  const { data, error } = await (db.from("provider_calls") as Query)
    .select("provider, capability, outcome, credits")
    .eq("org_id", orgId)
    .gte("created_at", since.toISOString())
    /* Bounded. A month of a busy org is tens of thousands of rows and this
       feeds a summary; the alternative is an aggregate in SQL, which is what
       `provider_health` already is for the 24-hour view. */
    .limit(50_000);

  if (error || !data) return [];

  const byKey = new Map<string, ProviderUsage>();
  for (const row of data as Array<{
    provider: string;
    capability: string;
    outcome: string;
    credits: number;
  }>) {
    const key = `${row.provider}::${row.capability}`;
    const entry = byKey.get(key) ?? {
      provider: row.provider,
      capability: row.capability,
      calls: 0,
      cacheHits: 0,
      credits: 0,
      failures: 0,
    };
    entry.calls++;
    if (row.outcome === "cache_hit") entry.cacheHits++;
    if (row.outcome === "failed" || row.outcome === "rate_limited") entry.failures++;
    entry.credits += Number(row.credits ?? 0);
    byKey.set(key, entry);
  }

  return [...byKey.values()].sort((a, b) => b.credits - a.credits);
}
