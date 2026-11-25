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
