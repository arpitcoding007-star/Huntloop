/**
 * The kill switch (0053, PROD-207 / HL-1606): is this kind of work paused?
 *
 * One reader for the three places that spend or send: `send_message`, every
 * model call, every paid provider call. Each decides what an unreadable
 * answer means for itself. A send fails closed (it waits); spend keeps its
 * documented fail-open posture, because a housekeeping read failing must not
 * stop a customer's product.
 *
 * Before 0053 the function does not exist, and nothing is paused.
 */

export type PauseScope = "sends" | "ai" | "providers";

export interface PauseState {
  paused: boolean;
  /** The operator's reason, shown to whoever is waiting. */
  reason: string | null;
  /** True when the answer could not be read (not "the migration is missing"). */
  unreadable: boolean;
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- tenant, admin and OrgScope clients all expose rpc */
type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => any };

let warnedMissing = false;

export async function pauseState(db: RpcClient, scope: PauseScope, orgId: string | null): Promise<PauseState> {
  const { data, error } = (await db.rpc("platform_paused", { p_scope: scope, p_org: orgId })) as {
    data: unknown;
    error: { code?: string | null; message?: string } | null;
  };

  if (error) {
    if (error.code === "42883" || error.code === "PGRST202") {
      if (!warnedMissing) {
        warnedMissing = true;
        console.warn("[pause] platform_paused is missing; the kill switch is unavailable until 0053 is applied.");
      }
      return { paused: false, reason: null, unreadable: false };
    }
    return { paused: false, reason: null, unreadable: true };
  }

  const reason = typeof data === "string" && data.trim() ? data.trim() : null;
  return { paused: reason !== null, reason, unreadable: false };
}
