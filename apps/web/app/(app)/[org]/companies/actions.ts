"use server";

import { revalidatePath } from "next/cache";
import { fail, mutate, ok, type ActionResult } from "../../../../lib/data/org";
import { normalizeDomain } from "../../../../lib/domain";
import { companySchema, parseForm, uuidSchema } from "../../../../lib/validation";

/**
 * Company writes — master context §12, §59.
 *
 * ── canonical_domain is the whole entity-resolution story ────────────────
 *
 * §59 makes the normalized domain the key that keeps one company one row when
 * it arrives from GitHub and from a news article, and 0003 enforces that with
 * `unique (org_id, canonical_domain)`. The normalization is explicitly the
 * application's job — the migration says so — so it happens here, in the one
 * function every write goes through, rather than being repeated by each
 * caller with slightly different rules.
 *
 * A user typing `https://www.Acme.com/pricing` and a user typing `acme.com`
 * mean the same company, and if `normalizeDomain` does not say so the database
 * cannot. It lives in `lib/domain.ts` because the CSV importer needs the same
 * rule — see the note there on why two copies of it would not be a key.
 */

export interface CompanyInput {
  id?: string;
  name: string;
  domain: string;
  industry: string;
  website: string;
  country: string;
  region: string;
  employeeCount: number | null;
  businessModel: string;
  description: string;
}

export async function saveCompanyAction(
  org: string,
  input: CompanyInput,
): Promise<ActionResult<{ id: string }>> {
  const parsed = parseForm(companySchema, input);
  if (!parsed.ok) return fail(parsed.error, parsed.fieldErrors);
  const value = parsed.value;

  const domain = normalizeDomain(value.domain);
  if (!domain) {
    return fail("That domain isn't one we can use.", {
      domain: "Enter a company domain, like acme.com.",
    });
  }

  return mutate(org, "saveCompany", async ({ db, orgId }) => {
    const row = {
      org_id: orgId,
      canonical_domain: domain,
      name: value.name,
      website: value.website || null,
      industry: value.industry || null,
      country: value.country || null,
      region: value.region || null,
      business_model: value.businessModel || null,
      description: value.description || null,
      employee_count: value.employeeCount ?? null,
    };

    if (value.id) {
      const { error } = await db
        .from("companies")
        .update(row)
        .eq("id", value.id)
        .eq("org_id", orgId)
        .is("deleted_at", null);
      if (error) return fail(duplicateOr(error, domain, "saved"));

      revalidatePath(`/${org}/companies`);
      return ok({ id: value.id }, "Company saved.");
    }

    const { data, error } = await db
      .from("companies")
      .insert(row)
      .select("id")
      .single();
    if (error) return fail(duplicateOr(error, domain, "created"));

    revalidatePath(`/${org}/companies`);
    return ok({ id: String(data.id) }, "Company added.");
  });
}

/**
 * The unique-violation case said plainly.
 *
 * 23505 here always means the `(org_id, canonical_domain)` key, and the user
 * can act on that — they already have this company. The raw constraint name
 * tells them nothing, so it is replaced rather than passed through; every
 * other error keeps its message, because a constraint in this schema is
 * usually a product rule worth reading.
 */
function duplicateOr(
  error: { code?: string; message: string },
  domain: string,
  verb: string,
): string {
  if (error.code === "23505") {
    return `${domain} is already on your list. Companies are one row per domain, so the existing one is the one to edit.`;
  }
  return `That company could not be ${verb}: ${error.message}`;
}

/**
 * Soft delete.
 *
 * `opportunities.company_id` cascades on delete, so a hard delete here would
 * silently take every opportunity, score and piece of evidence about the
 * company with it — including the reasoning that justified them. Removing a
 * company from a list should not destroy the record of why it was ever on it.
 */
export async function deleteCompanyAction(
  org: string,
  id: string,
): Promise<ActionResult<undefined>> {
  return mutate(org, "deleteCompany", async ({ db, orgId }) => {
    const parsed = uuidSchema.safeParse(id);
    if (!parsed.success) return fail("That company reference isn't valid.");

    const { error } = await db
      .from("companies")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", parsed.data)
      .eq("org_id", orgId);
    if (error) return fail(`That company could not be removed: ${error.message}`);

    revalidatePath(`/${org}/companies`);
    return ok(undefined, "Company removed.");
  });
}
