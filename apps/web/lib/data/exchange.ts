import "server-only";
import { attributesFor, type IntakeAttribute, type Requirement } from "@huntloop/ai";
import { requireOrgId } from "./org";
import { load, type Loaded } from "./source";
import type { NeedStatus, Timeline, Visibility } from "../exchange/requirement";

/**
 * Exchange reads (0060) for the buyer's and the supplier's screens.
 *
 * Everything here goes through the session client, so RLS is the boundary:
 * a workspace reads its own needs, its own matches, active offerings and
 * live provider profiles. With no database the screens say so rather than
 * show an invented marketplace — every fallback is empty.
 */

export interface ExchangeCategory {
  id: string;
  slug: string;
  name: string;
  /** "Electronics › GPUs & AI accelerators". */
  path: string;
  parentId: string | null;
  regulated: boolean;
  matchingEnabled: boolean;
  attributes: IntakeAttribute[];
}

export interface NeedSummary {
  id: string;
  kind: "buy" | "partner";
  summary: string;
  categoryId: string | null;
  categoryPath: string | null;
  matchingEnabled: boolean;
  quantity: number | null;
  unit: string | null;
  budgetMax: number | null;
  currency: string | null;
  country: string | null;
  timeline: Timeline | null;
  visibility: Visibility;
  status: NeedStatus | "draft" | "expired";
  createdAt: string;
  matches: number;
  shortlisted: number;
}

export type DimensionKey = "category" | "geography" | "budget" | "quantity" | "availability" | "trust";

export interface MatchView {
  id: string;
  score: number | null;
  dimensions: Partial<Record<DimensionKey, number | null>>;
  explanation: string | null;
  computedAt: string;
  state: "new" | "shortlisted" | "dismissed";
  offering: {
    title: string;
    description: string | null;
    priceFrom: number | null;
    priceTo: number | null;
    currency: string | null;
    moq: number | null;
    availability: string | null;
    servesGlobal: boolean;
    servesCountries: string[];
  } | null;
  provider: { name: string; country: string | null; verified: boolean; claimed: boolean } | null;
}

export interface NeedDetail extends NeedSummary {
  requirement: Requirement;
  attributes: IntakeAttribute[];
  deliverTo: string | null;
  matchList: MatchView[];
}

export interface ProviderProfile {
  id: string;
  kind: "company" | "individual";
  name: string;
  domain: string | null;
  description: string | null;
  country: string | null;
  verified: boolean;
}

export interface OfferingView {
  id: string;
  title: string;
  description: string | null;
  categoryId: string | null;
  categoryPath: string | null;
  priceModel: string | null;
  priceFrom: number | null;
  priceTo: number | null;
  currency: string | null;
  moq: number | null;
  availability: string | null;
  availabilityAsOf: string | null;
  servesGlobal: boolean;
  servesCountries: string[];
  status: "draft" | "active" | "paused";
  updatedAt: string;
}

export interface SupplierView {
  profile: ProviderProfile | null;
  offerings: OfferingView[];
}

type Row = Record<string, unknown>;
const one = (v: unknown): Row | null => ((Array.isArray(v) ? v[0] : v) as Row | null | undefined) ?? null;
const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Every active category with its full path and attribute template, parents first. */
export async function listExchangeCategories(): Promise<Loaded<ExchangeCategory[]>> {
  return load(
    async (db) => {
      const { data, error } = await db
        .from("exchange_categories")
        .select("id, slug, name, parent_id, regulated, matching_enabled, attributes, sort")
        .eq("active", true)
        .order("sort", { ascending: true })
        .limit(1000);
      if (error) throw new Error(`listExchangeCategories: ${error.message}`);
      return toCategories((data ?? []) as Row[]);
    },
    () => [],
  );
}

export function toCategories(rows: Row[]): ExchangeCategory[] {
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const out: ExchangeCategory[] = rows.map((r) => {
    const parent = r.parent_id ? byId.get(String(r.parent_id)) : undefined;
    return {
      id: String(r.id),
      slug: String(r.slug),
      name: String(r.name),
      path: parent ? `${String(parent.name)} › ${String(r.name)}` : String(r.name),
      parentId: str(r.parent_id),
      regulated: r.regulated === true,
      matchingEnabled: r.matching_enabled === true,
      attributes: attributesFor(r.attributes, parent?.attributes),
    };
  });
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

const NEED_COLUMNS =
  "id, kind, summary, category_id, quantity, unit, budget_max, currency, country, deliver_to, timeline, " +
  "visibility, status, created_at, requirement, exchange_categories(name, matching_enabled, attributes, parent_id)";

function toNeedSummary(r: Row, categories: Map<string, ExchangeCategory>): NeedSummary {
  const cat = r.category_id ? categories.get(String(r.category_id)) : undefined;
  const embeddedCat = one(r.exchange_categories);
  const matches = Array.isArray(r.exchange_matches) ? (r.exchange_matches as Row[]) : [];
  return {
    id: String(r.id),
    kind: r.kind === "partner" ? "partner" : "buy",
    summary: String(r.summary),
    categoryId: str(r.category_id),
    categoryPath: cat?.path ?? str(embeddedCat?.name),
    matchingEnabled: cat?.matchingEnabled ?? embeddedCat?.matching_enabled === true,
    quantity: num(r.quantity),
    unit: str(r.unit),
    budgetMax: num(r.budget_max),
    currency: str(r.currency),
    country: str(r.country),
    timeline: (str(r.timeline) as Timeline | null) ?? null,
    visibility: Number(r.visibility ?? 1) as Visibility,
    status: String(r.status) as NeedSummary["status"],
    createdAt: String(r.created_at),
    matches: matches.filter((m) => m.buyer_state !== "dismissed").length,
    shortlisted: matches.filter((m) => m.buyer_state === "shortlisted").length,
  };
}

export async function listMyNeeds(orgSlug: string): Promise<Loaded<NeedSummary[]>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "listMyNeeds");
      const [{ data, error }, cats] = await Promise.all([
        db
          .from("exchange_needs")
          .select(`${NEED_COLUMNS}, exchange_matches(buyer_state)`)
          .eq("org_id", orgId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(200),
        listExchangeCategories(),
      ]);
      if (error) throw new Error(`listMyNeeds: ${error.message}`);
      const byId = new Map(cats.data.map((c) => [c.id, c]));
      return ((data ?? []) as unknown as Row[]).map((r) => toNeedSummary(r, byId));
    },
    () => [],
  );
}

export async function getNeed(orgSlug: string, needId: string): Promise<Loaded<NeedDetail | null>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "getNeed");
      const [{ data, error }, cats] = await Promise.all([
        db
          .from("exchange_needs")
          .select(
            `${NEED_COLUMNS}, exchange_matches(id, score, dimensions, explanation, computed_at, buyer_state, ` +
              "exchange_offerings(title, description, price_from, price_to, currency, moq, availability, " +
              "serves_global, serves_countries, exchange_provider_profiles(name, country, verified_at, claimed_at)))",
          )
          .eq("id", needId)
          .eq("org_id", orgId)
          .is("deleted_at", null)
          .maybeSingle(),
        listExchangeCategories(),
      ]);
      if (error) throw new Error(`getNeed: ${error.message}`);
      if (!data) return null;
      const r = data as unknown as Row;
      const byId = new Map(cats.data.map((c) => [c.id, c]));
      const summary = toNeedSummary(r, byId);
      const cat = summary.categoryId ? byId.get(summary.categoryId) : undefined;
      const matchList = ((Array.isArray(r.exchange_matches) ? r.exchange_matches : []) as Row[])
        .map((m): MatchView => {
          const o = one(m.exchange_offerings);
          const p = o ? one(o.exchange_provider_profiles) : null;
          return {
            id: String(m.id),
            score: num(m.score),
            dimensions: (m.dimensions ?? {}) as MatchView["dimensions"],
            explanation: str(m.explanation),
            computedAt: String(m.computed_at),
            state: (str(m.buyer_state) ?? "new") as MatchView["state"],
            offering: o
              ? {
                  title: String(o.title),
                  description: str(o.description),
                  priceFrom: num(o.price_from),
                  priceTo: num(o.price_to),
                  currency: str(o.currency),
                  moq: num(o.moq),
                  availability: str(o.availability),
                  servesGlobal: o.serves_global === true,
                  servesCountries: Array.isArray(o.serves_countries) ? o.serves_countries.map(String) : [],
                }
              : null,
            provider: p
              ? { name: String(p.name), country: str(p.country), verified: !!p.verified_at, claimed: !!p.claimed_at }
              : null,
          };
        })
        .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
      return {
        ...summary,
        requirement: (r.requirement ?? {}) as Requirement,
        attributes: cat?.attributes ?? [],
        deliverTo: str(r.deliver_to),
        matchList,
      };
    },
    () => null,
  );
}

export async function getSupplier(orgSlug: string): Promise<Loaded<SupplierView>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "getSupplier");
      const [profile, offerings, cats] = await Promise.all([
        db
          .from("exchange_provider_profiles")
          .select("id, kind, name, domain, description, country, verified_at")
          .eq("org_id", orgId)
          .is("deleted_at", null)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle(),
        db
          .from("exchange_offerings")
          .select(
            "id, title, description, category_id, price_model, price_from, price_to, currency, moq, availability, " +
              "availability_as_of, serves_global, serves_countries, status, updated_at",
          )
          .eq("org_id", orgId)
          .is("deleted_at", null)
          .order("updated_at", { ascending: false })
          .limit(200),
        listExchangeCategories(),
      ]);
      if (profile.error) throw new Error(`getSupplier: ${profile.error.message}`);
      if (offerings.error) throw new Error(`getSupplier: ${offerings.error.message}`);
      const byId = new Map(cats.data.map((c) => [c.id, c]));
      const p = profile.data as Row | null;
      return {
        profile: p
          ? {
              id: String(p.id),
              kind: p.kind === "individual" ? "individual" : "company",
              name: String(p.name),
              domain: str(p.domain),
              description: str(p.description),
              country: str(p.country),
              verified: !!p.verified_at,
            }
          : null,
        offerings: ((offerings.data ?? []) as unknown as Row[]).map((o) => ({
          id: String(o.id),
          title: String(o.title),
          description: str(o.description),
          categoryId: str(o.category_id),
          categoryPath: o.category_id ? (byId.get(String(o.category_id))?.path ?? null) : null,
          priceModel: str(o.price_model),
          priceFrom: num(o.price_from),
          priceTo: num(o.price_to),
          currency: str(o.currency),
          moq: num(o.moq),
          availability: str(o.availability),
          availabilityAsOf: str(o.availability_as_of),
          servesGlobal: o.serves_global === true,
          servesCountries: Array.isArray(o.serves_countries) ? o.serves_countries.map(String) : [],
          status: (str(o.status) ?? "draft") as OfferingView["status"],
          updatedAt: String(o.updated_at),
        })),
      };
    },
    () => ({ profile: null, offerings: [] }),
  );
}

/** How many intake transcripts this person has kept, for the privacy page. */
export async function countMyIntakeSessions(orgSlug: string): Promise<Loaded<number>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "countMyIntakeSessions");
      const { count, error } = await db
        .from("exchange_intake_sessions")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId);
      if (error) throw new Error(`countMyIntakeSessions: ${error.message}`);
      return count ?? 0;
    },
    () => 0,
  );
}
