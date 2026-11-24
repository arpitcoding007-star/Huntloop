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
  intentBand: "hot" | "warm" | "cool" | null;
  lastConfirmedAt: string;
}

export type DimensionKey = "category" | "geography" | "budget" | "quantity" | "availability" | "trust" | "requirement";

export interface MatchView {
  id: string;
  score: number | null;
  dimensions: Partial<Record<DimensionKey, number | null>>;
  explanation: string | null;
  computedAt: string;
  state: "new" | "shortlisted" | "dismissed";
  offering: {
    id: string;
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
  /** The supplier evidence the explanation cites (0062), readable by the buyer. */
  cited: EvidenceView[];
}

export interface EvidenceView {
  id: string;
  kind: "fact" | "inference" | "unknown";
  claim: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
  observedAt: string;
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
  productId: string | null;
  evidence: EvidenceView[];
}

export interface SupplierView {
  profile: ProviderProfile | null;
  offerings: OfferingView[];
  /** This workspace's products, to prefill an offering from. */
  products: { id: string; name: string; description: string | null; website: string | null }[];
}

type Row = Record<string, unknown>;
const one = (v: unknown): Row | null => ((Array.isArray(v) ? v[0] : v) as Row | null | undefined) ?? null;
const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function toEvidence(e: Row): EvidenceView {
  return {
    id: String(e.id),
    kind: (str(e.kind) ?? "unknown") as EvidenceView["kind"],
    claim: String(e.claim),
    sourceUrl: str(e.source_url),
    sourceTitle: str(e.source_title),
    observedAt: String(e.observed_at),
  };
}

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
  "visibility, status, created_at, last_confirmed_at, intent_band, requirement, exchange_categories(name, matching_enabled, attributes, parent_id)";

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
    intentBand: (str(r.intent_band) as NeedSummary["intentBand"]) ?? null,
    lastConfirmedAt: String(r.last_confirmed_at ?? r.created_at),
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
            `${NEED_COLUMNS}, exchange_matches(id, score, dimensions, explanation, cited, computed_at, buyer_state, ` +
              "exchange_offerings(id, title, description, price_from, price_to, currency, moq, availability, " +
              "serves_global, serves_countries, exchange_provider_profiles(name, country, verified_at, claimed_at), " +
              "exchange_offering_evidence(id, kind, claim, source_url, source_title, observed_at)))",
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
          const citedIds = new Set(Array.isArray(m.cited) ? (m.cited as unknown[]).map(String) : []);
          const evidence = o && Array.isArray(o.exchange_offering_evidence) ? (o.exchange_offering_evidence as Row[]).map(toEvidence) : [];
          return {
            id: String(m.id),
            score: num(m.score),
            dimensions: (m.dimensions ?? {}) as MatchView["dimensions"],
            explanation: str(m.explanation),
            computedAt: String(m.computed_at),
            state: (str(m.buyer_state) ?? "new") as MatchView["state"],
            offering: o
              ? {
                  id: String(o.id),
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
            cited: evidence.filter((e) => citedIds.has(e.id)),
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
      const [profile, offerings, cats, products] = await Promise.all([
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
              "availability_as_of, serves_global, serves_countries, status, updated_at, product_id, " +
              "exchange_offering_evidence(id, kind, claim, source_url, source_title, observed_at)",
          )
          .eq("org_id", orgId)
          .is("deleted_at", null)
          .order("updated_at", { ascending: false })
          .limit(200),
        listExchangeCategories(),
        db.from("products").select("id, name, description, website").eq("org_id", orgId).is("deleted_at", null).order("name").limit(100),
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
          productId: str(o.product_id),
          evidence: (Array.isArray(o.exchange_offering_evidence) ? (o.exchange_offering_evidence as Row[]) : []).map(toEvidence),
        })),
        products: ((products.data ?? []) as Row[]).map((r) => ({
          id: String(r.id),
          name: String(r.name),
          description: str(r.description),
          website: str(r.website),
        })),
      };
    },
    () => ({ profile: null, offerings: [], products: [] }),
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

/** An anonymous card, as `exchange_matched_cards` returns it (0062, spec §5). */
export interface MatchedCard {
  matchId: string;
  needId: string;
  offeringTitle: string;
  categoryPath: string | null;
  level: 2 | 3;
  quantityBand: string | null;
  budgetBand: string | null;
  place: string | null;
  timeline: Timeline | null;
  summary: string | null;
  mustHaves: string | null;
  unit: string | null;
  score: number | null;
  computedAt: string;
}

/**
 * The requests this workspace's offerings were matched to, as anonymous cards.
 * Reading them is a reveal: each card is logged for the buyer by the database
 * function itself, so there is no path that shows a card without logging it.
 */
export async function getMatchedCards(orgSlug: string): Promise<Loaded<MatchedCard[]>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "getMatchedCards");
      const [{ data, error }, cats] = await Promise.all([
        db.rpc("exchange_matched_cards", { p_org: orgId }),
        listExchangeCategories(),
      ]);
      if (error) throw new Error(`getMatchedCards: ${error.message}`);
      const byId = new Map(cats.data.map((c) => [c.id, c.path]));
      return ((data ?? []) as Row[]).map((r) => ({
        matchId: String(r.match_id),
        needId: String(r.need_id),
        offeringTitle: String(r.offering_title ?? ""),
        categoryPath: r.category_id ? (byId.get(String(r.category_id)) ?? null) : null,
        level: (Number(r.level) >= 3 ? 3 : 2) as 2 | 3,
        quantityBand: str(r.quantity_band),
        budgetBand: str(r.budget_band),
        place: str(r.place),
        timeline: (str(r.timeline) as Timeline | null) ?? null,
        summary: str(r.summary),
        mustHaves: str(r.must_haves),
        unit: str(r.unit),
        score: num(r.score),
        computedAt: String(r.computed_at),
      }));
    },
    () => [],
  );
}

export interface RevealEntry {
  needId: string;
  needSummary: string | null;
  viewer: string | null;
  level: number;
  what: "card" | "intro";
  day: string;
  views: number;
  lastSeenAt: string;
}

/** Who has seen this workspace's requests, newest first (DN-69). */
export async function getRevealLog(orgSlug: string): Promise<Loaded<RevealEntry[]>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "getRevealLog");
      const { data, error } = await db
        .from("exchange_reveal_log")
        .select("need_id, viewer_name, level, what, day, views, last_seen_at, exchange_needs(summary)")
        .eq("org_id", orgId)
        .order("last_seen_at", { ascending: false })
        .limit(500);
      if (error) throw new Error(`getRevealLog: ${error.message}`);
      return ((data ?? []) as unknown as Row[]).map((r) => ({
        needId: String(r.need_id),
        needSummary: str(one(r.exchange_needs)?.summary),
        viewer: str(r.viewer_name),
        level: Number(r.level),
        what: r.what === "intro" ? ("intro" as const) : ("card" as const),
        day: String(r.day),
        views: Number(r.views ?? 1),
        lastSeenAt: String(r.last_seen_at),
      }));
    },
    () => [],
  );
}

/* ── Introductions (0063) ─────────────────────────────────────────────── */

export type IntroState = "requested" | "accepted" | "declined" | "withdrawn" | "closed" | "stale";

export interface IntroListItem {
  id: string;
  side: "buyer" | "provider";
  direction: "buyer" | "provider";
  state: IntroState;
  matchId: string | null;
  /** Null for the supplier until the buyer accepts (0066). */
  needId: string | null;
  offeringTitle: string;
  providerName: string | null;
  /** Null for the supplier until the buyer accepts. */
  buyerName: string | null;
  needSummary: string | null;
  categoryPath: string | null;
  message: string | null;
  unread: boolean;
  lastActivityAt: string;
  createdAt: string;
}

/** Every introduction this workspace is party to, on either side, through `exchange_intro_list`. */
export async function getIntroList(orgSlug: string): Promise<Loaded<IntroListItem[]>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "getIntroList");
      const [{ data, error }, cats] = await Promise.all([db.rpc("exchange_intro_list", { p_org: orgId }), listExchangeCategories()]);
      if (error) throw new Error(`getIntroList: ${error.message}`);
      const byId = new Map(cats.data.map((c) => [c.id, c.path]));
      return ((data ?? []) as Row[]).map((r) => ({
        id: String(r.id),
        side: r.side === "provider" ? ("provider" as const) : ("buyer" as const),
        direction: r.direction === "provider" ? ("provider" as const) : ("buyer" as const),
        state: String(r.state) as IntroState,
        matchId: str(r.match_id),
        needId: str(r.need_id),
        offeringTitle: String(r.offering_title ?? ""),
        providerName: str(r.provider_name),
        buyerName: str(r.buyer_name),
        needSummary: str(r.need_summary),
        categoryPath: r.category_id ? (byId.get(String(r.category_id)) ?? null) : null,
        message: str(r.message),
        unread: r.unread === true,
        lastActivityAt: String(r.last_activity_at),
        createdAt: String(r.created_at),
      }));
    },
    () => [],
  );
}

export interface IntroMessage {
  id: string;
  side: "buyer" | "provider";
  body: string;
  createdAt: string;
}

export interface IntroDetail {
  id: string;
  side: "buyer" | "provider";
  direction: "buyer" | "provider";
  state: IntroState;
  message: string | null;
  createdAt: string;
  decidedAt: string | null;
  opportunityId: string | null;
  contact: { name: string | null; email: string | null } | null;
  contactSharedAt: string | null;
  buyerName: string | null;
  providerName: string | null;
  offering: { id: string; title: string; description: string | null };
  need: {
    /** Empty for the supplier until the buyer accepts (0066). */
    id: string;
    categoryPath: string | null;
    summary: string | null;
    requirement: Record<string, { value: string | null; kind: string } | undefined> | null;
    attributes: IntakeAttribute[];
    quantity: number | null;
    unit: string | null;
    budgetMax: number | null;
    currency: string | null;
    country: string | null;
    deliverTo: string | null;
    timeline: Timeline | null;
    quantityBand: string | null;
    budgetBand: string | null;
  };
  outcomes: { side: "buyer" | "provider"; outcome: string; reason: string | null; at: string }[];
  messages: IntroMessage[];
}

/** One introduction as this workspace may see it (`exchange_intro_detail`), with its messages. */
export async function getIntroDetail(orgSlug: string, introId: string): Promise<Loaded<IntroDetail | null>> {
  return load(
    async (db) => {
      await requireOrgId(orgSlug, "getIntroDetail");
      const [{ data, error }, msgs, cats] = await Promise.all([
        db.rpc("exchange_intro_detail", { p_intro: introId }),
        db.from("exchange_messages").select("id, sender_side, body, created_at").eq("intro_id", introId).order("created_at").limit(500),
        listExchangeCategories(),
      ]);
      if (error) throw new Error(`getIntroDetail: ${error.message}`);
      if (!data) return null;
      const d = data as Row;
      const need = (d.need ?? {}) as Row;
      const offering = (d.offering ?? {}) as Row;
      const cat = need.categoryId ? cats.data.find((c) => c.id === String(need.categoryId)) : undefined;
      const contact = d.contact as Row | null;
      return {
        id: String(d.id),
        side: d.side === "provider" ? "provider" : "buyer",
        direction: d.direction === "provider" ? "provider" : "buyer",
        state: String(d.state) as IntroState,
        message: str(d.message),
        createdAt: String(d.createdAt),
        decidedAt: str(d.decidedAt),
        opportunityId: str(d.opportunityId),
        contact: contact ? { name: str(contact.name), email: str(contact.email) } : null,
        contactSharedAt: str(d.contactSharedAt),
        buyerName: str(d.buyerName),
        providerName: str(d.providerName),
        offering: { id: String(offering.id ?? ""), title: String(offering.title ?? ""), description: str(offering.description) },
        need: {
          id: String(need.id ?? ""),
          categoryPath: cat?.path ?? null,
          summary: str(need.summary),
          requirement: (need.requirement ?? null) as IntroDetail["need"]["requirement"],
          attributes: cat?.attributes ?? [],
          quantity: num(need.quantity),
          unit: str(need.unit),
          budgetMax: num(need.budgetMax),
          currency: str(need.currency),
          country: str(need.country),
          deliverTo: str(need.deliverTo),
          timeline: (str(need.timeline) as Timeline | null) ?? null,
          quantityBand: str(need.quantityBand),
          budgetBand: str(need.budgetBand),
        },
        outcomes: ((Array.isArray(d.outcomes) ? d.outcomes : []) as Row[]).map((o) => ({
          side: o.side === "provider" ? ("provider" as const) : ("buyer" as const),
          outcome: String(o.outcome),
          reason: str(o.reason),
          at: String(o.at),
        })),
        messages: ((msgs.data ?? []) as Row[]).map((m) => ({
          id: String(m.id),
          side: m.sender_side === "provider" ? ("provider" as const) : ("buyer" as const),
          body: String(m.body),
          createdAt: String(m.created_at),
        })),
      };
    },
    () => null,
  );
}

export interface NeedIntro {
  id: string;
  offeringId: string;
  direction: "buyer" | "provider";
  state: IntroState;
  message: string | null;
  providerName: string | null;
  offeringTitle: string | null;
  createdAt: string;
}

/** The introductions on one of this workspace's requests, for its request page. */
export async function getNeedIntros(orgSlug: string, needId: string): Promise<Loaded<NeedIntro[]>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "getNeedIntros");
      const { data, error } = await db
        .from("exchange_intros")
        .select("id, offering_id, direction, state, message, created_at, exchange_offerings(title, exchange_provider_profiles(name))")
        .eq("need_id", needId)
        .eq("buyer_org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(`getNeedIntros: ${error.message}`);
      return ((data ?? []) as unknown as Row[]).map((r) => {
        const o = one(r.exchange_offerings);
        const p = o ? one(o.exchange_provider_profiles) : null;
        return {
          id: String(r.id),
          offeringId: String(r.offering_id),
          direction: r.direction === "provider" ? ("provider" as const) : ("buyer" as const),
          state: String(r.state) as IntroState,
          message: str(r.message),
          providerName: str(p?.name),
          offeringTitle: str(o?.title),
          createdAt: String(r.created_at),
        };
      });
    },
    () => [],
  );
}

/* ── Notifications (0064) ─────────────────────────────────────────────── */

export interface ExchangePrefs {
  alerts: "off" | "digest" | "instant";
  /** Empty means every category this workspace offers in. */
  categoryIds: string[];
  emails: boolean;
  quietStart: number | null;
  quietEnd: number | null;
  digestHour: number;
  timezone: string;
  /** Categories this workspace has offerings in, for the picker. */
  offeredCategoryIds: string[];
}

const DEFAULT_PREFS: ExchangePrefs = {
  alerts: "digest",
  categoryIds: [],
  emails: true,
  quietStart: null,
  quietEnd: null,
  digestHour: 8,
  timezone: "UTC",
  offeredCategoryIds: [],
};

/** This person's Exchange notification settings in this workspace. */
export async function getExchangePrefs(orgSlug: string): Promise<Loaded<ExchangePrefs>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "getExchangePrefs");
      const { data: auth } = await db.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) return DEFAULT_PREFS;
      const [{ data: pref }, { data: offered }] = await Promise.all([
        db
          .from("notification_preferences")
          .select("exchange_alerts, exchange_alert_category_ids, exchange_emails, quiet_start_hour, quiet_end_hour, digest_hour, timezone")
          .eq("org_id", orgId)
          .eq("user_id", userId)
          .maybeSingle(),
        db.from("exchange_offerings").select("category_id").eq("org_id", orgId).is("deleted_at", null).limit(500),
      ]);
      const p = pref as Row | null;
      return {
        alerts: (["off", "digest", "instant"].includes(String(p?.exchange_alerts)) ? p!.exchange_alerts : "digest") as ExchangePrefs["alerts"],
        categoryIds: Array.isArray(p?.exchange_alert_category_ids) ? (p!.exchange_alert_category_ids as unknown[]).map(String) : [],
        emails: p ? p.exchange_emails !== false : true,
        quietStart: num(p?.quiet_start_hour),
        quietEnd: num(p?.quiet_end_hour),
        digestHour: num(p?.digest_hour) ?? 8,
        timezone: str(p?.timezone) ?? "UTC",
        offeredCategoryIds: [...new Set(((offered ?? []) as Row[]).map((o) => str(o.category_id)).filter((x): x is string => !!x))],
      };
    },
    () => DEFAULT_PREFS,
  );
}

export interface ExchangeNotice {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string;
  readAt: string | null;
  createdAt: string;
}

/** This person's Exchange updates in this workspace, newest first (DN-78). */
export async function getExchangeNotices(orgSlug: string): Promise<Loaded<ExchangeNotice[]>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "getExchangeNotices");
      const { data, error } = await db
        .from("exchange_notifications")
        .select("id, kind, title, body, href, read_at, created_at")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw new Error(`getExchangeNotices: ${error.message}`);
      return ((data ?? []) as Row[]).map((r) => ({
        id: String(r.id),
        kind: String(r.kind),
        title: String(r.title),
        body: str(r.body),
        href: String(r.href),
        readAt: str(r.read_at),
        createdAt: String(r.created_at),
      }));
    },
    () => [],
  );
}

/* ── Trust and safety, and market demand (0065) ───────────────────────── */

/** Why this workspace is out of the Exchange, or null when it is not. */
export async function getMySuspension(orgSlug: string): Promise<Loaded<string | null>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "getMySuspension");
      const { data, error } = await db.rpc("exchange_my_suspension", { p_org: orgId });
      if (error) throw new Error(`getMySuspension: ${error.message}`);
      return typeof data === "string" && data ? data : null;
    },
    () => null,
  );
}

export interface DemandRow {
  categoryId: string;
  categoryPath: string;
  region: string;
  openRequests: number;
  new30d: number;
  hot: number;
}

/**
 * Open, counted requests by category and region (DN-55, DN-67). The database
 * returns a group only when at least ten requests from confirmed, un-suspended
 * buyers share it, so there is nothing here to filter: an absent row means
 * "fewer than ten", never zero.
 */
export async function getMarketDemand(orgSlug: string): Promise<Loaded<{ rows: DemandRow[]; hasProfile: boolean }>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "getMarketDemand");
      const [{ data, error }, cats, profile] = await Promise.all([
        db.rpc("exchange_market_demand", { p_org: orgId }),
        listExchangeCategories(),
        db.from("exchange_provider_profiles").select("id").eq("org_id", orgId).is("deleted_at", null).limit(1).maybeSingle(),
      ]);
      if (error) throw new Error(`getMarketDemand: ${error.message}`);
      const byId = new Map(cats.data.map((c) => [c.id, c.path]));
      return {
        hasProfile: !!profile.data,
        rows: ((data ?? []) as Row[]).map((r) => ({
          categoryId: String(r.category_id),
          categoryPath: byId.get(String(r.category_id)) ?? "Other",
          region: String(r.region),
          openRequests: Number(r.open_requests),
          new30d: Number(r.new_30d),
          hot: Number(r.hot),
        })),
      };
    },
    () => ({ rows: [], hasProfile: false }),
  );
}
