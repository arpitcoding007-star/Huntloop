/**
 * `rank_contacts` — find the people, score the fit, choose one.
 *
 * ── What this replaces ───────────────────────────────────────────────────
 *
 * `people.is_decision_maker`, a boolean set by whatever wrote the row. It
 * could not rank two people who were both true, could not say why either was,
 * and a person looking at it had to take it on faith.
 *
 * ── The division of labour, which is the point ───────────────────────────
 *
 *   provider        who works there                    (paid, cached)
 *   @huntloop/db    how well each fits the persona     (deterministic, free)
 *   this handler    which one, and writing it down     (deterministic)
 *   the model       what to say to them                (NOT here — see below)
 *
 * The angle is deliberately not produced here. "Given this person and this
 * evidence, what is worth saying" is a genuine judgement and belongs with the
 * other model tasks, where it can be evidence-checked. What this handler
 * writes is `why_this_person`, which is a statement of fact about the match
 * and needs no model at all.
 *
 * ── Idempotency ─────────────────────────────────────────────────────────
 *
 * `contact_fit_scores` is append-only, so a re-run adds a row rather than
 * overwriting — the same decision `opportunity_scores` makes, for the same
 * reason. `people` are upserted on the provider id, so a re-run finds the
 * same rows. The only mutation is `opportunities.primary_person_id`, and
 * writing the same id twice is harmless.
 *
 * ── The one thing it will not overwrite ──────────────────────────────────
 *
 * A contact a person chose. `contact_selected_by = 'user'` is respected on
 * every subsequent run, because a system that quietly reverts a human
 * decision teaches people that their decisions do not stick.
 */
import { ProviderRefused, searchPeople } from "@huntloop/providers";
import {
  classifyTitle,
  rankContacts as rank,
  type ContactSubject,
  type PersonaSpec,
} from "@huntloop/db/contact";
import { OrgScope } from "../scope.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

export interface RankContactsPayload {
  opportunityId: string;
  /** Ask the provider for more people, rather than ranking who we have. */
  discover?: boolean;
}

/**
 * How many people one call asks for.
 *
 * Small. A company has three or four people worth contacting and a hundred
 * who are not, and paying to enumerate the hundred to rank them is money
 * spent proving something the persona filter already said. The provider does
 * the filtering; we do the ranking.
 */
const DISCOVER_LIMIT = 25;

export async function rankContactsJob(ctx: JobContext): Promise<JobOutcome> {
  const { scope, payload } = ctx;
  const opportunityId = String(payload.opportunityId ?? "");
  if (!opportunityId) {
    return { ok: false, permanent: true, error: "rank_contacts: no opportunityId in payload." };
  }

  const { data: opportunity, error } = await scope
    .select(
      "opportunities",
      "id, company_id, icp_id, primary_person_id, contact_selected_by, " +
        "companies!inner(id, name, canonical_domain)",
    )
    .eq("id", opportunityId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) return { ok: false, error: `rank_contacts: ${error.message}` };
  if (!opportunity) return { ok: true, result: { skipped: "the opportunity no longer exists" } };

  const company = embeddedOne<{ id: string; name: string; canonical_domain: string }>(
    (opportunity as Record<string, unknown>).companies,
  );
  if (!company) return { ok: false, permanent: true, error: "rank_contacts: the opportunity has no company." };

  /* ── Personas ────────────────────────────────────────────────────────
     The profile's statement of who to talk to. With none defined the ranking
     falls back to seniority and reachability, reports low confidence, and
     says so in the reason — rather than pretending to know. */
  const personas = await loadPersonas(scope, opportunity.icp_id ? String(opportunity.icp_id) : null);

  /* ── Discovery ───────────────────────────────────────────────────────
     Only when asked. Ranking who we already have is free; asking a provider
     costs credits, and doing it on every rescore would bill for a question
     whose answer changes monthly at most. */
  let discovered = 0;
  let refusal: string | null = null;

  if (payload.discover === true) {
    try {
      discovered = await discoverPeople(scope, {
        companyId: company.id,
        companyName: company.name,
        domain: company.canonical_domain,
        personas,
      });
    } catch (e) {
      if (e instanceof ProviderRefused) {
        /* Not a failure. The ranking still runs over whoever we have, and the
           screen says why no new people arrived. */
        refusal = e.meta.error;
      } else {
        return { ok: false, error: `rank_contacts: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
  }

  /* ── Rank ────────────────────────────────────────────────────────────── */

  const people = await loadPeople(scope, company.id);
  if (!people.length) {
    return {
      ok: true,
      result: {
        skipped: "no people are known at this company",
        ...(refusal ? { refusal } : {}),
      },
    };
  }

  const ranked = rank(
    people.map((p) => p.subject),
    personas,
  );

  const now = new Date().toISOString();
  const rows = ranked.map((entry) => {
    const person = people.find((p) => p.subject === entry.subject);
    return {
      person_id: person?.id ?? null,
      icp_id: opportunity.icp_id ?? null,
      persona_id: entry.fit.personaId,
      score: entry.fit.score,
      base_score: entry.fit.score,
      dimensions: entry.fit.dimensions,
      rule_trace: [],
      confidence: entry.fit.confidence,
      reason: entry.fit.reason,
      computed_at: now,
    };
  }).filter((r) => r.person_id !== null);

  if (rows.length) await scope.insert("contact_fit_scores", rows);

  /* `is_decision_maker` is maintained here as a derived summary. It stays
     because four screens read it and a boolean is the right thing in a table
     cell — but the real answer, with its reasoning, is the score row. */
  for (const entry of ranked) {
    const person = people.find((p) => p.subject === entry.subject);
    if (!person) continue;
    await scope
      .update("people", {
        is_decision_maker: !entry.fit.vetoed && entry.fit.score >= 70,
        persona_id: entry.fit.personaId,
        department: classifyTitle(entry.subject.title).department,
        seniority_rank: classifyTitle(entry.subject.title).seniorityRank,
      })
      .eq("id", person.id);
  }

  /* ── Choose ──────────────────────────────────────────────────────────── */

  const best = ranked.find((entry) => !entry.fit.vetoed) ?? null;
  const bestPerson = best ? people.find((p) => p.subject === best.subject) : null;

  /* A human choice is never overwritten. A system that quietly reverts a
     person's decision teaches them that their decisions do not stick, which
     costs far more than a slightly better contact would gain. */
  const humanChose = opportunity.contact_selected_by === "user";

  if (bestPerson && best && !humanChose) {
    await scope
      .update("opportunities", {
        primary_person_id: bestPerson.id,
        why_this_person: best.fit.reason,
        contact_selected_at: now,
        contact_selected_by: "system",
      })
      .eq("id", opportunityId);
  }

  return {
    ok: true,
    result: {
      people: people.length,
      discovered,
      scored: rows.length,
      chosen: humanChose ? "left as the user set it" : (bestPerson?.id ?? null),
      vetoed: ranked.filter((r) => r.fit.vetoed).length,
      ...(refusal ? { refusal } : {}),
    },
  };
}

/* ── Loading ─────────────────────────────────────────────────────────────── */

async function loadPersonas(scope: OrgScope, icpId: string | null): Promise<PersonaSpec[]> {
  if (!icpId) return [];

  const { data } = await scope
    .select(
      "personas",
      "id, name, title_patterns, seniority, departments, exclude_titles, priority, is_primary",
    )
    .eq("icp_id", icpId)
    .is("deleted_at", null)
    .order("priority");

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ""),
    titlePatterns: (row.title_patterns as string[]) ?? [],
    seniority: (row.seniority as string[]) ?? [],
    departments: (row.departments as string[]) ?? [],
    excludeTitles: (row.exclude_titles as string[]) ?? [],
    priority: Number(row.priority ?? 1),
    isPrimary: row.is_primary === true,
  }));
}

interface LoadedPerson {
  id: string;
  subject: ContactSubject;
}

/**
 * People, with their best contact point folded in.
 *
 * The contact points are read in the same query rather than per person,
 * because a company with forty people would otherwise be forty round trips —
 * the N+1 the data-architecture audit asks about, in the one place a new
 * handler would naturally create it.
 */
async function loadPeople(scope: OrgScope, companyId: string): Promise<LoadedPerson[]> {
  const { data } = await scope
    .select(
      "people",
      "id, first_name, last_name, title, employment_status, last_verified_at, " +
        "contact_points(kind, value, confidence, verification_status)",
    )
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .limit(200);

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const points = (row.contact_points ?? []) as Array<{
      kind: string;
      confidence: string | null;
      verification_status: string | null;
    }>;

    /* "Best" means most actionable, not most recent. A verified email beats
       an unverified one beats a LinkedIn URL, because that is the order in
       which the product can actually do something with them. */
    const email = points.find((p) => p.kind === "email");
    const linkedin = points.find((p) => p.kind === "linkedin");
    const phone = points.find((p) => p.kind === "phone");
    const best = email ?? linkedin ?? phone ?? null;

    return {
      id: String(row.id),
      subject: {
        firstName: (row.first_name as string) ?? null,
        lastName: (row.last_name as string) ?? null,
        title: (row.title as string) ?? null,
        bestContactKind: (best?.kind as "email" | "phone" | "linkedin" | undefined) ?? null,
        bestContactConfidence: (best?.confidence as "low" | "medium" | "high" | null) ?? null,
        emailVerified: email?.verification_status === "deliverable",
        employmentStatus:
          (row.employment_status as "current" | "departed" | "unknown") ?? "unknown",
        lastVerifiedAt: row.last_verified_at ? new Date(String(row.last_verified_at)) : null,
      },
    };
  });
}

/* ── Discovery ───────────────────────────────────────────────────────────── */

async function discoverPeople(
  scope: OrgScope,
  input: {
    companyId: string;
    companyName: string;
    domain: string;
    personas: PersonaSpec[];
  },
): Promise<number> {
  /* The personas ARE the query. Asking the provider for everyone and
     filtering here would be paying to enumerate a hundred people to keep
     four, which is the expensive way round. */
  const titles = [...new Set(input.personas.flatMap((p) => p.titlePatterns))].slice(0, 20);
  const seniorities = [...new Set(input.personas.flatMap((p) => p.seniority))].slice(0, 10);
  const departments = [...new Set(input.personas.flatMap((p) => p.departments))].slice(0, 10);

  const { data: external } = await scope
    .select("external_ids", "provider_id")
    .eq("entity_type", "company")
    .eq("entity_id", input.companyId)
    .limit(1);

  const companyProviderId =
    Array.isArray(external) && external.length
      ? String((external[0] as { provider_id: string }).provider_id)
      : null;

  const result = await searchPeople(
    {
      db: OrgScope.global(),
      orgId: scope.orgId,
      entity: { type: "company", id: input.companyId },
    },
    {
      companyDomain: input.domain,
      companyName: input.companyName,
      companyProviderId,
      titles,
      seniorities,
      departments,
      cursor: null,
      limit: DISCOVER_LIMIT,
    },
  );

  let created = 0;

  for (const person of result.data.items) {
    /* Resolve on the provider id first: the same person found twice must be
       one row. `0012`'s `external_ids` is keyed on (org, provider,
       provider_id), so this is one indexed lookup. */
    const { data: existing } = await scope
      .select("external_ids", "entity_id")
      .eq("entity_type", "person")
      .eq("provider", result.meta.provider)
      .eq("provider_id", person.providerId)
      .maybeSingle();

    let personId = existing ? String((existing as { entity_id: string }).entity_id) : null;

    if (!personId) {
      const classification = classifyTitle(person.title);
      const { data: inserted } = await scope
        .insert("people", {
          company_id: input.companyId,
          first_name: person.firstName,
          last_name: person.lastName,
          title: person.title,
          seniority: person.seniority ? [person.seniority] : [],
          department: classification.department,
          seniority_rank: classification.seniorityRank,
          linkedin_url: person.linkedinUrl,
          source: `provider:${result.meta.provider}`,
          /* The provider says they work there today. `current` rather than
             `unknown`, and `last_verified_at` records when that was said —
             which is what lets a six-month-old assertion decay. */
          employment_status: "current",
          employment_checked_at: new Date().toISOString(),
          last_verified_at: new Date().toISOString(),
        })
        .select("id")
        .maybeSingle();

      if (!inserted) continue;
      personId = String((inserted as { id: string }).id);
      created++;

      await scope.upsert(
        "external_ids",
        {
          entity_type: "person",
          entity_id: personId,
          provider: result.meta.provider,
          provider_id: person.providerId,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "org_id,provider,provider_id" },
      );
    }

    for (const contact of person.contacts) {
      await scope.upsert(
        "contact_points",
        {
          person_id: personId,
          kind: contact.kind,
          value: contact.value,
          confidence: contact.confidence,
          provider: result.meta.provider,
          /* `verified` from the provider means the provider observed it, not
             that we did. It maps to `provider_verified`, which the outreach
             screen renders differently from a verifier's `deliverable` —
             because they are different claims and one of them is ours. */
          verification_status: contact.verified ? "provider_verified" : "unverified",
        },
        { onConflict: "org_id,kind,value", ignoreDuplicates: true },
      );
    }
  }

  return created;
}

/**
 * The one row of a to-one embed.
 *
 * Local rather than imported from `scope.ts` only because this file needs the
 * typed form; the reasoning is the same and is documented there.
 */
function embeddedOne<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return (value as T) ?? null;
}
