import { load, type Loaded } from "./source";

/**
 * The plan catalogue, for the pricing section.
 *
 * ── Why this reads the database ──────────────────────────────────────────
 *
 * Because `usage_limit()` in `0007` resolves every quota by joining
 * `organizations.plan_id` to `plans.limits`, and that function is what
 * actually stops a customer running another AI call. A pricing page with its
 * numbers typed into JSX is a page that can disagree with the product — and
 * the first time it does, the disagreement is discovered by a customer who
 * paid for one thing and was metered at another.
 *
 * So the numbers come from the same rows the enforcement reads. An operator
 * who negotiates a limit in `plans` sees it on the site.
 *
 * ── The fallback ────────────────────────────────────────────────────────
 *
 * `plans` is catalogue data seeded by `0007` and `plans_read` grants
 * `using (true)`, so an anonymous visitor can read it — the landing page needs
 * no session. When there is no database at all (a preview deployment, a fresh
 * checkout) the constants below stand in, and they are the literals from
 * `0007`'s own INSERT rather than a second opinion about pricing.
 */

export interface PlanLimits {
  opportunities: number | null;
  aiRuns: number | null;
  emails: number | null;
  enrich: number | null;
  seats: number | null;
}

export interface Plan {
  id: string;
  name: string;
  priceCents: number;
  limits: PlanLimits;
}

/**
 * `0007`'s seeded catalogue, verbatim.
 *
 * Kept in this order because it is the order the page renders and the order
 * the tiers ascend. Not sorted by price at read time: a fourth plan priced
 * between two others should appear where the catalogue says, not where
 * arithmetic puts it.
 */
const SEEDED: Plan[] = [
  {
    id: "free",
    name: "Free",
    priceCents: 0,
    limits: { opportunities: 50, aiRuns: 100, emails: 0, enrich: 25, seats: 2 },
  },
  {
    id: "growth",
    name: "Growth",
    priceCents: 9900,
    limits: { opportunities: 1000, aiRuns: 3000, emails: 5000, enrich: 1000, seats: 10 },
  },
  {
    id: "scale",
    name: "Scale",
    priceCents: 29900,
    limits: { opportunities: 10000, aiRuns: 20000, emails: 50000, enrich: 10000, seats: 50 },
  },
];

const ORDER = new Map(SEEDED.map((p, i) => [p.id, i]));

export async function listPlans(): Promise<Loaded<Plan[]>> {
  return load(
    async (db) => {
      const { data, error } = await db.from("plans").select("id, name, price_cents, limits");

      // A pricing page that failed to a blank section would be worse than one
      // showing the catalogue it was seeded with — the visitor cannot tell the
      // difference between "we have no plans" and "the query broke".
      if (error || !data || data.length === 0) return SEEDED;

      return (data as { id: string; name: string; price_cents: number; limits: unknown }[])
        .map((row) => ({
          id: String(row.id),
          name: String(row.name),
          priceCents: Number(row.price_cents ?? 0),
          limits: parseLimits(row.limits),
        }))
        /* Catalogue order, with anything unrecognised last. A plan added to the
           table without a decision here still renders rather than vanishing. */
        .sort((a, b) => (ORDER.get(a.id) ?? 99) - (ORDER.get(b.id) ?? 99));
    },
    () => SEEDED,
  );
}

/**
 * `limits` is jsonb, so its shape is a contract enforced by nothing.
 *
 * A missing key means *unlimited* rather than zero, because that is what
 * `usage_limit()` does with it — the function returns NULL when the key is
 * absent, and `increment_usage` reads NULL as "no ceiling". Reading it as zero
 * here would advertise a plan that permits nothing.
 */
function parseLimits(value: unknown): PlanLimits {
  const raw = (value ?? {}) as Record<string, unknown>;
  const n = (key: string): number | null => {
    const v = raw[key];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  return {
    opportunities: n("opportunities"),
    aiRuns: n("ai_runs"),
    emails: n("emails"),
    enrich: n("enrich"),
    seats: n("seats"),
  };
}

/** "Unlimited" is a real answer and is not the same as a large number. */
export function describeLimit(value: number | null): string {
  if (value === null) return "Unlimited";
  return value.toLocaleString();
}
