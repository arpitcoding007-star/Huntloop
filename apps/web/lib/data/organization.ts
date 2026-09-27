import "server-only";
import { parseOrgProfile } from "@huntloop/db/org-profile";
import { requireOrgId } from "./org";
import { load, type Loaded } from "./source";

/**
 * The organisation itself — the tenant root of §38.
 *
 * Separate from `org.ts`, which is the write-side plumbing every module
 * shares. This file is the loader for the one row that plumbing resolves
 * against, and keeping them apart stops `org.ts` growing a query that its
 * own helpers then have to be careful not to recurse into.
 *
 * `settings` is jsonb and deliberately not modelled here. Nothing reads a key
 * out of it yet, and inventing a shape for a column no screen consumes is how
 * a contract gets written that the first real requirement contradicts. It is
 * carried through as an opaque object so the count of stored keys can be
 * shown without anyone pretending to know what they mean.
 */

export interface Organization {
  id: string;
  name: string;
  slug: string;
  planId: string | null;
  trialEndsAt: string | null;
  createdAt: string | null;
  settings: Record<string, unknown>;
  /**
   * The sender's physical postal address, rendered into every outbound email
   * footer. Parsed out of `settings` rather than left in the opaque blob,
   * because `send_message` refuses to send without it and a screen that can
   * block sending should not have to know the jsonb layout.
   */
  postalAddress: string | null;
  /** Null means keep everything — see `enforce-retention.ts`. */
  contactRetentionDays: number | null;
}

export async function getOrganization(orgSlug: string): Promise<Loaded<Organization | null>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "getOrganization");

      const { data, error } = await db
        .from("organizations")
        .select(
          "id, name, slug, plan_id, trial_ends_at, created_at, settings, contact_retention_days",
        )
        .eq("id", orgId)
        .is("deleted_at", null)
        .maybeSingle();

      if (error) throw new Error(`getOrganization: ${error.message}`);
      return data ? mapOrganization(data) : null;
    },
    () => ({ ...DEMO, slug: orgSlug }),
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any --
   Supabase row types are generated from a live project's schema; see the same
   note in icp.ts. Confined to the mapper so the rest of the file is checked. */
function mapOrganization(row: any): Organization {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    slug: String(row.slug ?? ""),
    planId: row.plan_id ?? null,
    trialEndsAt: row.trial_ends_at ?? null,
    createdAt: row.created_at ?? null,
    settings:
      row.settings && typeof row.settings === "object" && !Array.isArray(row.settings)
        ? (row.settings as Record<string, unknown>)
        : {},
    /* Through the profile parser rather than off the jsonb directly, so this
       screen and `send_message` agree about what counts as a set address —
       including the length floor, which is the difference between "saved"
       and "will actually satisfy the send precondition". */
    postalAddress: parseOrgProfile(row.settings).compliance.postalAddress,
    contactRetentionDays:
      row.contact_retention_days === null || row.contact_retention_days === undefined
        ? null
        : Number(row.contact_retention_days),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * The demo organisation.
 *
 * The slug is overwritten with the one in the URL rather than invented, so a
 * demo deployment does not show the user an organisation name that disagrees
 * with the address they are looking at.
 */
const DEMO: Organization = {
  id: "demo-org",
  name: "Acme",
  slug: "acme",
  planId: null,
  trialEndsAt: null,
  createdAt: null,
  settings: {},
  /* Both left unset rather than filled with a plausible-looking address and a
     tidy 365. The demo organisation is what an unconfigured workspace looks
     like, and these two fields are exactly the ones whose unconfigured state
     the product now has to be honest about. */
  postalAddress: null,
  contactRetentionDays: null,
};
