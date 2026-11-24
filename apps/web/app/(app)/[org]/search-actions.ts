"use server";

import { likePattern, SEARCH_MIN, type RecordHit } from "../../../lib/record-search";
import { parseInput, recordSearchSchema } from "../../../lib/validation";
import { fail, mutate, ok, type ActionResult } from "../../../lib/data/org";

const PER_KIND = 5;

/**
 * Records for the jump-to palette: opportunities, companies and people.
 *
 * Reads through the caller's own session, so row-level security decides what
 * it can find; the org filter keeps one workspace's palette to itself when a
 * person belongs to several. Viewers may search: they may open every screen
 * these link to.
 */
export async function searchRecordsAction(org: string, query: string): Promise<ActionResult<RecordHit[]>> {
  const parsed = parseInput(recordSearchSchema, query, "search");
  if (!parsed.ok) return fail(parsed.error);
  const q = parsed.value;
  if (q.length < SEARCH_MIN) return ok([]);
  const like = likePattern(q);

  return mutate(
    org,
    "searchRecords",
    async ({ db, orgId }) => {
      const companies = () =>
        db.from("companies").select("id, name, canonical_domain").eq("org_id", orgId).is("deleted_at", null).is("merged_into_id", null);
      const opportunities = () =>
        db
          .from("opportunities")
          .select("id, status, companies!inner(name, canonical_domain, deleted_at)")
          .eq("org_id", orgId)
          .is("deleted_at", null)
          .is("companies.deleted_at", null);
      const people = () =>
        db.from("people").select("id, first_name, last_name, title, company_id").eq("org_id", orgId).is("deleted_at", null);

      /* One request per column rather than an `or=(…)`: the filter's own
         syntax never meets what the person typed. */
      const [on, od, cn, cd, pl, pf] = await Promise.all([
        opportunities().ilike("companies.name", like).limit(PER_KIND),
        opportunities().ilike("companies.canonical_domain", like).limit(PER_KIND),
        companies().ilike("name", like).limit(PER_KIND),
        companies().ilike("canonical_domain", like).limit(PER_KIND),
        people().ilike("last_name", like).limit(PER_KIND),
        people().ilike("first_name", like).limit(PER_KIND),
      ]);
      const failed = [on, od, cn, cd, pl, pf].find((r) => r.error);
      if (failed?.error) return fail(`Search is unavailable: ${failed.error.message}`);

      const hits = new Map<string, RecordHit>();
      const add = (hit: RecordHit) => {
        if (!hits.has(hit.href)) hits.set(hit.href, hit);
      };
      for (const o of [...(on.data ?? []), ...(od.data ?? [])].slice(0, PER_KIND * 2)) {
        const c = (Array.isArray(o.companies) ? o.companies[0] : o.companies) as { name?: string; canonical_domain?: string } | null;
        add({ label: String(c?.name ?? c?.canonical_domain ?? "Opportunity"), href: `/${org}/opportunities/${o.id}`, group: `Opportunity · ${o.status}` });
      }
      for (const c of [...(cn.data ?? []), ...(cd.data ?? [])]) {
        add({ label: String(c.name ?? c.canonical_domain), href: `/${org}/companies/${c.id}`, group: "Company" });
      }
      for (const p of [...(pl.data ?? []), ...(pf.data ?? [])]) {
        const name = [p.first_name, p.last_name].filter(Boolean).join(" ");
        if (!name || !p.company_id) continue;
        add({ label: p.title ? `${name}, ${p.title}` : name, href: `/${org}/companies/${p.company_id}?person=${p.id}`, group: "Person" });
      }
      return ok([...hits.values()].slice(0, 15));
    },
    { minRole: "viewer" },
  );
}
