"use server";

import { revalidatePath } from "next/cache";
import {
  detectColumns,
  field,
  parseCsv,
  parseEmployeeCount,
  type ColumnKey,
  type CsvRow,
} from "../../../../lib/csv";
import { normalizeDomain } from "../../../../lib/domain";
import { fail, mutate, ok, type ActionResult } from "../../../../lib/data/org";
import { csvSchema, parseInput } from "../../../../lib/validation";

/**
 * CSV import — master context §59, §60.
 *
 * ── The whole design is "never import something twice" ───────────────────
 *
 * §60 forbids the same company appearing as two rows, and §59 makes the
 * normalized domain the key that prevents it. An importer is where that rule
 * is most easily broken, because the same spreadsheet gets pasted twice: once
 * to see what happens, once for real.
 *
 * So every insert here is conflict-tolerant rather than blind:
 *
 *   companies       `ON CONFLICT DO NOTHING` against
 *                   `unique (org_id, canonical_domain)`. An existing company
 *                   is left exactly as it is — an import must not overwrite
 *                   researched fields with a spreadsheet's blanks.
 *   contact_points  the same, against `unique (org_id, kind, value)`.
 *   people          has no unique constraint, so the duplicate check is done
 *                   in this function. See `existingPeople` below.
 *
 * ── Why the server re-parses ─────────────────────────────────────────────
 *
 * The screen parses the pasted text to build a preview, and sends the *text*
 * rather than the parsed rows. Sending parsed rows would mean the user
 * approves one thing and the server imports whatever was posted; re-parsing
 * the same string with the same function means the preview is a promise the
 * server keeps.
 */

/** Past what anyone pastes, and far short of what hurts. See `csvSchema`. */
const MAX_ROWS = 1000;

export interface ImportSummary {
  /** Rows the parser accepted. */
  parsed: number;
  /** Rows dropped for having the wrong number of fields. */
  malformed: number;
  /** Rows with no usable domain — they cannot be keyed, so they are skipped. */
  unusable: number;
  /** True when the file was longer than `MAX_ROWS`. */
  truncated: boolean;
  companiesAdded: number;
  companiesAlreadyPresent: number;
  peopleAdded: number;
  emailsAdded: number;
  /** Which known fields the file's headers supplied. */
  recognised: ColumnKey[];
  /** Headers the importer did not recognise, so the screen can name them. */
  ignored: string[];
}

interface CompanyCandidate {
  domain: string;
  name: string;
  industry: string | null;
  website: string | null;
  country: string | null;
  region: string | null;
  businessModel: string | null;
  description: string | null;
  employeeCount: number | null;
}

interface PersonCandidate {
  domain: string;
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  linkedin: string | null;
  email: string | null;
}

export async function importCsvAction(
  org: string,
  csv: string,
): Promise<ActionResult<ImportSummary>> {
  const parsedInput = parseInput(csvSchema, csv, "file");
  if (!parsedInput.ok) return fail(parsedInput.error);

  const { headers, rows, malformed, truncated } = parseCsv(parsedInput.value, MAX_ROWS);
  if (rows.length === 0) {
    return fail(
      malformed > 0
        ? `Nothing could be read from that. ${malformed} ${malformed === 1 ? "row has" : "rows have"} a different number of columns than the header.`
        : "That file has a header but no rows under it.",
    );
  }

  const columns = detectColumns(headers);
  if (!columns.domain && !columns.name) {
    return fail(
      "That file has no column this importer recognises as a company. Name one of them `company` and one `domain`.",
    );
  }
  if (!columns.domain) {
    return fail(
      "That file has company names but no domain column. A domain is what keeps one company one row, so an import without it would create duplicates on the next run.",
    );
  }

  /* Deduplicated *within the file* before anything is sent. The same company
     twice in one spreadsheet is common, and `ON CONFLICT DO NOTHING` does not
     help: both rows are in the same statement, so Postgres rejects the whole
     insert rather than skipping the second. First occurrence wins. */
  const companies = new Map<string, CompanyCandidate>();
  const people: PersonCandidate[] = [];
  let unusable = 0;

  for (const row of rows) {
    const domain = normalizeDomain(field(row, columns, "domain"));
    if (!domain) {
      unusable++;
      continue;
    }

    if (!companies.has(domain)) {
      companies.set(domain, {
        domain,
        // A file with a domain and no name still identifies a company, and
        // the domain is a better label than an empty string in a list.
        name: field(row, columns, "name") || domain,
        industry: value(row, columns, "industry"),
        website: value(row, columns, "domain")?.startsWith("http")
          ? field(row, columns, "domain")
          : `https://${domain}`,
        country: value(row, columns, "country"),
        region: value(row, columns, "region"),
        businessModel: value(row, columns, "businessModel"),
        description: value(row, columns, "description"),
        employeeCount: parseEmployeeCount(field(row, columns, "employeeCount")),
      });
    }

    const person = personFrom(row, columns, domain);
    if (person) people.push(person);
  }

  if (companies.size === 0) {
    return fail(
      `None of those ${rows.length} rows had a usable company domain. Check that the domain column holds something like acme.com.`,
    );
  }

  return mutate(org, "importCsv", async ({ db, orgId }) => {
    const domains = [...companies.keys()];

    /* Which of these we already have. Read before the insert so the summary
       can distinguish "added" from "already there" — an importer that reports
       "300 imported" when 300 already existed has told the user nothing. */
    const { data: before, error: beforeError } = await db
      .from("companies")
      .select("id, canonical_domain")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .in("canonical_domain", domains);
    if (beforeError) return fail(`The import could not run: ${beforeError.message}`);

    const known = new Map(
      (before ?? []).map((c) => [String(c.canonical_domain), String(c.id)]),
    );

    const toInsert = [...companies.values()].filter((c) => !known.has(c.domain));

    if (toInsert.length > 0) {
      const { error } = await db.from("companies").insert(
        toInsert.map((c) => ({
          org_id: orgId,
          canonical_domain: c.domain,
          name: c.name,
          industry: c.industry,
          website: c.website,
          country: c.country,
          region: c.region,
          business_model: c.businessModel,
          description: c.description,
          employee_count: c.employeeCount,
        })),
      );
      if (error) return fail(`The companies could not be imported: ${error.message}`);
    }

    /* Re-read to get every id, including the ones just written. A `.select()`
       on the insert would return only the new rows, and people attach to both
       new and existing companies. */
    const { data: after, error: afterError } = await db
      .from("companies")
      .select("id, canonical_domain")
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .in("canonical_domain", domains);
    if (afterError) return fail(`The import could not finish: ${afterError.message}`);

    const idByDomain = new Map(
      (after ?? []).map((c) => [String(c.canonical_domain), String(c.id)]),
    );

    const { peopleAdded, emailsAdded, error: peopleError } = await importPeople(
      db,
      orgId,
      people,
      idByDomain,
    );
    if (peopleError) return fail(peopleError);

    revalidatePath(`/${org}/companies`);
    revalidatePath(`/${org}/imports`);

    return ok(
      {
        parsed: rows.length,
        malformed,
        unusable,
        truncated,
        companiesAdded: toInsert.length,
        companiesAlreadyPresent: known.size,
        peopleAdded,
        emailsAdded,
        recognised: Object.keys(columns) as ColumnKey[],
        ignored: headers.filter((h) => !Object.values(columns).includes(h)),
      },
      summarise(toInsert.length, known.size, peopleAdded),
    );
  });
}

/* ── People ──────────────────────────────────────────────────────────────── */

/**
 * People, skipping the ones already on file.
 *
 * `people` has no unique constraint — deliberately, because two real people
 * can share a name at one company — so the duplicate check happens here
 * rather than in the database. Two identities are used, in order:
 *
 *   1. **Email.** `contact_points` is unique on `(org_id, kind, value)`, so an
 *      address already on file belongs to somebody, and importing a second
 *      person for it would split one contact across two rows.
 *   2. **Company plus name**, for rows with no email. Weaker, and it is the
 *      reason the summary reports what it added rather than claiming the file
 *      is now fully represented.
 */
async function importPeople(
  db: import("@huntloop/db").TenantClient,
  orgId: string,
  candidates: PersonCandidate[],
  idByDomain: Map<string, string>,
): Promise<{ peopleAdded: number; emailsAdded: number; error?: string }> {
  const withCompany = candidates
    .map((p) => ({ ...p, companyId: idByDomain.get(p.domain) }))
    .filter((p): p is PersonCandidate & { companyId: string } => Boolean(p.companyId));

  if (withCompany.length === 0) return { peopleAdded: 0, emailsAdded: 0 };

  const emails = withCompany.map((p) => p.email).filter((e): e is string => Boolean(e));

  const [{ data: existingContacts, error: contactError }, { data: existingPeople, error: peopleError }] =
    await Promise.all([
      emails.length > 0
        ? db
            .from("contact_points")
            .select("value")
            .eq("org_id", orgId)
            .eq("kind", "email")
            .in("value", emails)
        : Promise.resolve({ data: [], error: null }),
      db
        .from("people")
        .select("first_name, last_name, company_id")
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .in("company_id", [...new Set(withCompany.map((p) => p.companyId))]),
    ]);

  if (contactError) return { peopleAdded: 0, emailsAdded: 0, error: `The contacts could not be read: ${contactError.message}` };
  if (peopleError) return { peopleAdded: 0, emailsAdded: 0, error: `The people could not be read: ${peopleError.message}` };

  const takenEmails = new Set((existingContacts ?? []).map((c) => String(c.value)));
  const takenNames = new Set(
    (existingPeople ?? []).map((p) => nameKey(String(p.company_id), p.first_name, p.last_name)),
  );

  const fresh: (PersonCandidate & { companyId: string })[] = [];
  for (const p of withCompany) {
    if (p.email && takenEmails.has(p.email)) continue;
    const key = nameKey(p.companyId, p.firstName, p.lastName);
    if (takenNames.has(key)) continue;

    // Also guards against the same person appearing twice in one file, which
    // would otherwise pass both checks above and insert two rows.
    if (p.email) takenEmails.add(p.email);
    takenNames.add(key);
    fresh.push(p);
  }

  if (fresh.length === 0) return { peopleAdded: 0, emailsAdded: 0 };

  const { data: inserted, error: insertError } = await db
    .from("people")
    .insert(
      fresh.map((p) => ({
        org_id: orgId,
        company_id: p.companyId,
        first_name: p.firstName,
        last_name: p.lastName,
        title: p.title,
        linkedin_url: p.linkedin,
        source: "import",
      })),
    )
    .select("id");

  if (insertError) {
    return { peopleAdded: 0, emailsAdded: 0, error: `The people could not be imported: ${insertError.message}` };
  }

  /* The returned ids are in insert order, which is what pairs each new row
     with the email that came with it. Anything that reorders `fresh` between
     the insert and here breaks that pairing silently. */
  const contactRows = (inserted ?? [])
    .map((row, i) => ({ id: String(row.id), email: fresh[i]?.email }))
    .filter((r): r is { id: string; email: string } => Boolean(r.email))
    .map((r) => ({
      org_id: orgId,
      person_id: r.id,
      kind: "email" as const,
      value: r.email,
      /* An address from a spreadsheet is unverified, and §25 makes that a
         property of the row rather than something the UI infers. Claiming
         `verified` here would make a guessed address indistinguishable from
         one a provider confirmed. */
      verification_status: "unverified",
      confidence: "low" as const,
      provider: "import",
    }));

  if (contactRows.length === 0) return { peopleAdded: fresh.length, emailsAdded: 0 };

  const { error: contactInsertError } = await db.from("contact_points").insert(contactRows);
  if (contactInsertError) {
    // The people did land. Reporting them as imported and the emails as not is
    // the honest summary — claiming the whole import failed would send the
    // user back to re-run something that half succeeded.
    return {
      peopleAdded: fresh.length,
      emailsAdded: 0,
      error: `The people were imported but their email addresses were not: ${contactInsertError.message}`,
    };
  }

  return { peopleAdded: fresh.length, emailsAdded: contactRows.length };
}

/* ── Row helpers ─────────────────────────────────────────────────────────── */

function value(
  row: CsvRow,
  columns: Partial<Record<ColumnKey, string>>,
  key: ColumnKey,
): string | null {
  // Empty and absent are the same thing coming out of a spreadsheet cell, and
  // both mean "not stated" — which is NULL, not "".
  return field(row, columns, key) || null;
}

function personFrom(
  row: CsvRow,
  columns: Partial<Record<ColumnKey, string>>,
  domain: string,
): PersonCandidate | null {
  let firstName = value(row, columns, "firstName");
  let lastName = value(row, columns, "lastName");

  // A single "contact name" column is split on the first space. Crude, and
  // right far more often than dropping the column: "Dana Whitfield" is a first
  // and last name, and a mononym lands entirely in `firstName`, which is
  // where a name with no surname belongs.
  const full = value(row, columns, "fullName");
  if (!firstName && !lastName && full) {
    const [first, ...rest] = full.split(/\s+/);
    firstName = first ?? null;
    lastName = rest.length > 0 ? rest.join(" ") : null;
  }

  const email = value(row, columns, "email")?.toLowerCase() ?? null;
  const title = value(row, columns, "title");
  const linkedin = value(row, columns, "linkedin");

  // A row with a company and nothing personal on it is a company row, not a
  // person with every field blank.
  if (!firstName && !lastName && !email) return null;

  return { domain, firstName, lastName, title, linkedin, email };
}

function nameKey(companyId: string, first: unknown, last: unknown): string {
  return `${companyId}|${String(first ?? "").trim().toLowerCase()}|${String(last ?? "").trim().toLowerCase()}`;
}

function summarise(added: number, present: number, people: number): string {
  const parts = [`${added} ${added === 1 ? "company" : "companies"} added`];
  if (present > 0) parts.push(`${present} already on your list`);
  if (people > 0) parts.push(`${people} ${people === 1 ? "person" : "people"}`);
  return `${parts.join(", ")}.`;
}
