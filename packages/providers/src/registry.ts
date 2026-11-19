/**
 * Capability → the adapter that serves it.
 *
 * ── Reversing a decision, and why ────────────────────────────────────────
 *
 * `packages/jobs/src/providers.ts` argued, at length and correctly, against a
 * `ENRICHMENT_PROVIDER` variable:
 *
 *   > a second variable that has to agree with the first is a
 *   > misconfiguration waiting to happen — the failure being a live
 *   > deployment sending Hunter's key to Apollo's endpoint and reporting "no
 *   > results" rather than "wrong credentials".
 *
 * That reasoning is right and the conclusion it reached — sniff the vendor
 * from the key's shape — was right for one optional capability with two
 * possible vendors.
 *
 * It does not survive five capabilities. "Apollo for company search, Hunter
 * for email finding, ZeroBounce for verification" is three vendors serving
 * different questions, and there is no shape of a single key that expresses
 * it. So the variable comes back — but the failure it was avoiding is
 * addressed directly rather than avoided structurally:
 *
 *   **`verifyCredentials()` is called at configuration time, and a key that
 *   does not work says "wrong credentials".**
 *
 * That is a stronger guarantee than the sniffing gave. Sniffing prevented one
 * specific mix-up; this catches every credential failure, including an
 * expired key, a revoked key, and a key for the right vendor on the wrong
 * account — none of which the old design could see.
 *
 * ── Environment ─────────────────────────────────────────────────────────
 *
 *   APOLLO_API_KEY               company.search, company.enrich,
 *                                person.search, person.match
 *   ENRICHMENT_API_KEY           person.match  (Hunter — the existing name,
 *                                kept so no deployment breaks)
 *   EMAIL_VERIFICATION_API_KEY   email.verify  (ZeroBounce)
 *
 * When both Apollo and Hunter are configured, Hunter wins `person.match`. It
 * is the specialist, it is cheaper per lookup, and preferring it leaves
 * Apollo's more expensive credits for the searching only Apollo can do.
 * Apollo stays second in line: when Hunter is refused (breaker, budget, a
 * known-bad key) or fails after its retries, `index.ts` asks Apollo. A Hunter
 * "no match" is an answer and does not fall through.
 */
import type { AdminClient } from "@huntloop/db/admin";
import { apolloAdapter } from "./adapters/apollo.ts";
import { hunterAdapter } from "./adapters/hunter.ts";
import { zerobounceAdapter } from "./adapters/zerobounce.ts";
import { CAPABILITIES, type Capability, type ProviderAdapter } from "./contract.ts";

/* eslint-disable @typescript-eslint/no-explicit-any -- see cache.ts */
type Query = any;

/**
 * Built once per process.
 *
 * Memoised because a serverless instance handles many jobs and constructing
 * three adapters per job is pointless — and because `configuredProviders()`
 * is called by a health screen that would otherwise re-read the environment
 * on every render.
 */
let cached: Map<Capability, ProviderAdapter[]> | null = null;

export function resetRegistryForTests(): void {
  cached = null;
}

/**
 * Every configured adapter for each capability, most preferred first.
 *
 * Registration order is preference order. Hunter is registered before
 * Apollo, so with both keys `person.match` is `[hunter, apollo]`: the
 * specialist first (see the note above), Apollo as the fallback (debt #11).
 */
function build(): Map<Capability, ProviderAdapter[]> {
  const map = new Map<Capability, ProviderAdapter[]>();

  const apolloKey = process.env.APOLLO_API_KEY?.trim();
  const enrichmentKey = process.env.ENRICHMENT_API_KEY?.trim();
  const verifyKey = process.env.EMAIL_VERIFICATION_API_KEY?.trim();

  const register = (adapter: ProviderAdapter) => {
    for (const capability of adapter.capabilities) {
      const chain = map.get(capability) ?? [];
      chain.push(adapter);
      map.set(capability, chain);
    }
  };

  if (enrichmentKey) register(hunterAdapter(enrichmentKey));
  if (apolloKey) register(apolloAdapter(apolloKey));
  if (verifyKey) register(zerobounceAdapter(verifyKey));

  return map;
}

/**
 * The adapters that can serve a capability, in the order to try them.
 *
 * Empty is a normal state (see `adapterFor`). More than one means a refusal
 * or a failure from the first does not end the question: `index.ts` tries
 * the next before giving up. An empty answer does end it, because asking a
 * second vendor the same question is a spending decision nobody made.
 */
export function adaptersFor(capability: Capability): ProviderAdapter[] {
  cached ??= build();
  return [...(cached.get(capability) ?? [])];
}

/**
 * The preferred adapter for a capability, or null.
 *
 * Null is a normal state and every caller is written around it. Contact
 * discovery is a paid third-party service, "no provider" is an ordinary
 * deployment, and the failure mode to avoid is a product that guesses
 * `first.last@company.com` and presents it as a finding. Unchanged from
 * `providers.ts`, and it now applies to five capabilities rather than one.
 */
export function adapterFor(capability: Capability): ProviderAdapter | null {
  return adaptersFor(capability)[0] ?? null;
}

export function providerFor(capability: Capability): string | null {
  return adapterFor(capability)?.name ?? null;
}

export interface ConfiguredProvider {
  capability: Capability;
  provider: string | null;
}

/** What this deployment can actually do. Rendered on the settings screen. */
export function configuredProviders(): ConfiguredProvider[] {
  return CAPABILITIES.map((capability) => ({
    capability,
    provider: providerFor(capability),
  }));
}

/**
 * Prove every configured key works, and record the answer.
 *
 * ── The whole argument of `PRV-01`, in one function ──────────────────────
 *
 * Without this, a deployment with a wrong or expired key reports "no results"
 * — indistinguishable from a market with no companies in it — and does so
 * forever, because nothing ever asks. The customer edits an ICP that was
 * fine, concludes the product does not work, and nobody sees an error at any
 * point.
 *
 * Called from the settings screen and from `npm run smoke`. Writes the result
 * to `provider_accounts.credential_status`, so the answer is visible without
 * re-running it and so the call path can refuse early on a known-bad key
 * rather than paying to discover it again.
 *
 * ── Why it is per-org even though the key is per-deployment ──────────────
 *
 * Because `provider_accounts` is an org table and the budget lives on it. A
 * shared key with per-org budgets is the deployment shape this product
 * actually has, and giving each org its own row means an admin sees the state
 * of their own configuration rather than a global one they cannot act on.
 */
export interface CredentialCheck {
  capability: Capability;
  provider: string;
  ok: boolean;
  detail: string;
}

export async function verifyCredentials(
  db: AdminClient,
  orgId: string,
): Promise<CredentialCheck[]> {
  const results: CredentialCheck[] = [];
  /* One check per *adapter*, not per capability: Apollo serving four
     capabilities is one key, and checking it four times would spend four
     credits to answer one question. */
  const seen = new Map<string, { ok: boolean; detail: string }>();

  for (const capability of CAPABILITIES) {
    const adapter = adapterFor(capability);
    if (!adapter) continue;

    let outcome = seen.get(adapter.name);
    if (!outcome) {
      outcome = await adapter.verifyCredentials();
      seen.set(adapter.name, outcome);
    }

    results.push({ capability, provider: adapter.name, ...outcome });

    const { error } = await (db.from("provider_accounts") as Query).upsert(
      {
        org_id: orgId,
        capability,
        provider: adapter.name,
        credential_status: outcome.ok ? "valid" : "invalid",
        credential_checked_at: new Date().toISOString(),
        credential_error: outcome.ok ? null : outcome.detail.slice(0, 500),
      },
      { onConflict: "org_id,capability" },
    );

    if (error) {
      console.warn(`[providers] could not record credential status: ${error.message}`);
    }
  }

  return results;
}

/**
 * Is this org's key for this capability known to be broken?
 *
 * Read before spending. `unverified` is treated as usable — a deployment that
 * has never run the check should still work — because refusing on "we have
 * not looked" would make the check mandatory, and a mandatory check is a
 * setup step that blocks a customer who just wants to try the product.
 *
 * Only a *confirmed* `invalid` refuses.
 */
export async function credentialsKnownBad(
  db: AdminClient,
  orgId: string,
  capability: Capability,
  /** The adapter about to be called. The row records one provider's key, and
      a fallback adapter's key is a different key that it does not condemn. */
  provider?: string,
): Promise<boolean> {
  const { data, error } = await (db.from("provider_accounts") as Query)
    .select("provider, credential_status, is_enabled")
    .eq("org_id", orgId)
    .eq("capability", capability)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !data) return false;
  const row = data as { provider?: string | null; credential_status: string; is_enabled: boolean };
  /* A disabled capability is the org's decision and holds for every vendor. */
  if (row.is_enabled === false) return true;
  if (provider && row.provider && row.provider !== provider) return false;
  return row.credential_status === "invalid";
}
