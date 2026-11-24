import "server-only";
import { requireOrgId } from "./org";
import { load, type Loaded } from "./source";

/**
 * Demand intelligence — COMMAND.md §16.3-I, 0042.
 *
 * Themes (what prospects keep asking for or objecting to) with what is behind
 * each: how many statements, how many distinct deals, the recorded value of
 * those deals that are not won, and a few of the statements themselves with
 * where they came from. Plus the statements nobody has grouped yet.
 */

export type DemandKind = "request" | "objection" | "blocker";
export type ThemeStatus = "proposed" | "open" | "planned" | "shipped" | "wont" | "rejected" | "merged";

export interface DemandStatement {
  id: string;
  kind: DemandKind;
  statement: string;
  sourceType: "reply" | "outcome" | "note";
  /** PANEL-201: the model's paraphrase, not the prospect's words (`claim_kind = 'inference'`). */
  paraphrased: boolean;
  company: string | null;
  opportunityId: string | null;
  occurredAt: string;
  themeId: string | null;
}

export interface DemandTheme {
  id: string;
  title: string;
  description: string | null;
  kind: DemandKind;
  status: ThemeStatus;
  origin: "model" | "user";
  shippedAt: string | null;
  signals: number;
  opportunities: number;
  /** Recorded value of the deals behind it that are not won, in cents. */
  valueAtStakeCents: number;
  /** Deals behind it that are lost or closed as not a fit. */
  lostDeals: number;
  examples: DemandStatement[];
}

export interface Demand {
  themes: DemandTheme[];
  unthemed: DemandStatement[];
  unthemedCount: number;
  requestedAt: string | null;
  lastClusteredAt: string | null;
}

interface Weight {
  theme_id: string | null;
  signals: number;
  opportunities: number;
  value_cents: number;
  lost: number;
}

/** Enough for the examples and the ungrouped list; the totals come from SQL. */
const SIGNAL_LIMIT = 3000;

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped PostgREST rows (DB-03). */

export async function getDemand(orgSlug: string): Promise<Loaded<Demand>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "getDemand");
      const [themes, signals, state, weights] = await Promise.all([
        db
          .from("demand_themes")
          .select("id, title, description, kind, status, origin, shipped_at, updated_at")
          .eq("org_id", orgId)
          .not("status", "in", "(rejected,merged)")
          .order("updated_at", { ascending: false })
          .limit(200),
        db
          .from("demand_signals")
          .select(
            "id, kind, statement, source_type, claim_kind, opportunity_id, theme_id, occurred_at, " +
              "companies(name)",
          )
          .eq("org_id", orgId)
          .order("occurred_at", { ascending: false })
          .limit(SIGNAL_LIMIT),
        db.from("demand_state").select("requested_at, last_clustered_at").eq("org_id", orgId).maybeSingle(),
        db.rpc("demand_weights", { p_org: orgId }),
      ]);
      if (themes.error) throw new Error(`getDemand: ${themes.error.message}`);
      if (signals.error) throw new Error(`getDemand: ${signals.error.message}`);
      if (weights.error) throw new Error(`getDemand: ${weights.error.message}`);
      /* Totals from SQL (PANEL-208): the rows below stop at PostgREST's cap. */
      const weight = new Map(((weights.data ?? []) as Weight[]).map((w) => [w.theme_id ? String(w.theme_id) : null, w]));

      const one = (v: any) => (Array.isArray(v) ? v[0] : v) ?? null;
      const statements = ((signals.data ?? []) as any[]).map((s) => ({
        row: s,
        statement: {
          id: String(s.id),
          kind: s.kind as DemandKind,
          statement: String(s.statement),
          sourceType: s.source_type as DemandStatement["sourceType"],
          paraphrased: s.claim_kind !== "fact",
          company: one(s.companies)?.name ?? null,
          opportunityId: s.opportunity_id ? String(s.opportunity_id) : null,
          occurredAt: String(s.occurred_at),
          themeId: s.theme_id ? String(s.theme_id) : null,
        } satisfies DemandStatement,
      }));

      const byTheme = new Map<string, typeof statements>();
      for (const s of statements) {
        if (!s.statement.themeId) continue;
        const list = byTheme.get(s.statement.themeId) ?? [];
        list.push(s);
        byTheme.set(s.statement.themeId, list);
      }

      const order: ThemeStatus[] = ["proposed", "open", "planned", "shipped", "wont"];
      const result: DemandTheme[] = ((themes.data ?? []) as any[]).map((t) => {
        const list = byTheme.get(String(t.id)) ?? [];
        const w = weight.get(String(t.id));
        return {
          id: String(t.id),
          title: String(t.title),
          description: t.description ?? null,
          kind: t.kind as DemandKind,
          status: t.status as ThemeStatus,
          origin: t.origin === "user" ? "user" : "model",
          shippedAt: t.shipped_at ?? null,
          signals: Number(w?.signals ?? 0),
          opportunities: Number(w?.opportunities ?? 0),
          valueAtStakeCents: Number(w?.value_cents ?? 0),
          lostDeals: Number(w?.lost ?? 0),
          examples: list.slice(0, 4).map((s) => s.statement),
        };
      });
      // Proposals first (they need a decision), then by weight.
      result.sort(
        (a, b) =>
          order.indexOf(a.status) - order.indexOf(b.status) ||
          b.opportunities - a.opportunities ||
          b.signals - a.signals,
      );

      const unthemed = statements.filter((s) => !s.statement.themeId).map((s) => s.statement);
      const st = state.data as { requested_at?: string | null; last_clustered_at?: string | null } | null;
      return {
        themes: result,
        unthemed: unthemed.slice(0, 60),
        unthemedCount: Number(weight.get(null)?.signals ?? 0),
        requestedAt: st?.requested_at ?? null,
        lastClusteredAt: st?.last_clustered_at ?? null,
      };
    },
    () => ({ themes: [], unthemed: [], unthemedCount: 0, requestedAt: null, lastClusteredAt: null }),
  );
}

/* eslint-enable @typescript-eslint/no-explicit-any */
