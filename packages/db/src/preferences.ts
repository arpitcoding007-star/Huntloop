/**
 * Which preferences apply to a request — the one place that decides (0044).
 *
 * `memory.ts`'s rule holds here too: retrieval filters on
 * `(org_id, scope, scope_id)` in `packages/db`, never per call site. This adds
 * what a learning layer needs on top of it:
 *
 *   · only `status = 'active'` rows apply — a proposed, paused or rejected
 *     memory is listed on Settings → You and never reaches a prompt;
 *   · a learned memory's confidence fades when nothing reinforces it, and one
 *     whose contradictions caught up with its support stops applying;
 *   · `applies_to` narrows a memory to the tasks it was learned for;
 *   · a fixed precedence — this task's instruction, then what the person
 *     told us, then what we learned about them, then the opportunity's and the
 *     account's notes, then the workspace's — and within one `key`, the
 *     highest wins and the rest are returned as *suppressed*, so a screen can
 *     say "your preference overrode the workspace's" instead of a prompt
 *     quietly holding both.
 *
 * Task-only instructions are passed in and never read from the table: they
 * are not stored (§4 of docs/product/personalization-plan.md).
 */

/** The minimal query surface both the tenant and the admin client provide. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = { from: (table: string) => any };

export type PreferenceKind = "task" | "stated" | "learned" | "account" | "opportunity" | "team" | "workspace";

export type PreferenceCategory =
  | "writing_style"
  | "output_format"
  | "research"
  | "targeting"
  | "workflow"
  | "context"
  | "interface";

export const PREFERENCE_CATEGORIES: readonly PreferenceCategory[] = [
  "writing_style",
  "output_format",
  "research",
  "targeting",
  "workflow",
  "context",
  "interface",
];

export interface PreferenceRow {
  id: string;
  scope: "organization" | "team" | "user" | "account" | "opportunity";
  key: string | null;
  content: string;
  origin: "stated" | "learned" | "promoted";
  category: PreferenceCategory | null;
  appliesTo: string[];
  support: number;
  contradicts: number;
  lastReinforcedAt: string | null;
  createdAt: string | null;
}

export interface AppliedPreference {
  /** Null for a task-only instruction, which has no row. */
  id: string | null;
  kind: PreferenceKind;
  /** Who concluded it: a person (stated, promoted) or Huntloop (learned). */
  origin: PreferenceRow["origin"] | "task";
  scope: PreferenceRow["scope"] | "task";
  key: string | null;
  text: string;
  category: PreferenceCategory | null;
  /** 0–1. A stated memory is 1; a learned one is earned and fades. */
  confidence: number;
  /** Observations behind a learned memory. 0 for anything a person wrote. */
  evidenceCount: number;
}

export interface SuppressedPreference extends AppliedPreference {
  /** The id (or "task") of the preference that won over this one. */
  suppressedBy: string;
}

export interface Resolved {
  /** Highest precedence first. */
  applied: AppliedPreference[];
  suppressed: SuppressedPreference[];
}

export interface PreferenceContext {
  orgId: string;
  /** The person the output is for (the asker, or the sender of an email). */
  userId?: string | null;
  /** The task name, matched against `applies_to`. */
  task: string;
  accountId?: string | null;
  opportunityId?: string | null;
  /** This request's own instructions. Highest precedence; never stored. */
  temporary?: string[];
}

/** Below this, a learned memory is listed as fading and no longer applied. */
export const APPLY_THRESHOLD = 0.4;
/** A learned memory's confidence halves every this many unreinforced days. */
export const HALF_LIFE_DAYS = 90;
/** Bounded so a long history cannot flood a prompt. */
export const MAX_APPLIED = 24;
const LIMIT_PER_SCOPE = 15;

const RANK: Record<PreferenceKind, number> = {
  task: 0,
  stated: 1,
  learned: 2,
  opportunity: 3,
  account: 4,
  team: 5,
  workspace: 6,
};

export function kindOf(row: Pick<PreferenceRow, "scope" | "origin">): PreferenceKind {
  switch (row.scope) {
    case "user":
      return row.origin === "learned" ? "learned" : "stated";
    case "opportunity":
      return "opportunity";
    case "account":
      return "account";
    case "team":
      return "team";
    default:
      return "workspace";
  }
}

/**
 * How sure we are, now. Anything a person wrote (or a workspace adopted) is 1.
 * A personal learned memory starts from its support against its
 * contradictions, and halves every `HALF_LIFE_DAYS` without reinforcement.
 */
export function confidenceOf(row: PreferenceRow, now: Date = new Date()): number {
  if (row.scope !== "user" || row.origin !== "learned") return 1;
  // Contradicted as often as supported is not a preference; it is a question.
  if (row.contradicts >= row.support) return 0;
  const base = row.support / (row.support + row.contradicts + 1);
  const since = row.lastReinforcedAt ?? row.createdAt;
  const days = since ? Math.max(0, (now.getTime() - new Date(since).getTime()) / 86_400_000) : 0;
  return base * Math.pow(0.5, days / HALF_LIFE_DAYS);
}

/** The pure half of `resolvePreferences`: order, fade, de-conflict. */
export function orderPreferences(
  rows: PreferenceRow[],
  input: { task: string; temporary?: string[] },
  now: Date = new Date(),
): Resolved {
  const candidates: AppliedPreference[] = [];

  for (const text of input.temporary ?? []) {
    const t = text.trim();
    if (t) {
      candidates.push({
        id: null, kind: "task", origin: "task", scope: "task", key: null, text: t,
        category: null, confidence: 1, evidenceCount: 0,
      });
    }
  }

  for (const row of rows) {
    const text = row.content.trim();
    if (!text) continue;
    if (row.appliesTo.length > 0 && !row.appliesTo.includes(input.task)) continue;
    const confidence = confidenceOf(row, now);
    if (confidence < APPLY_THRESHOLD) continue;
    candidates.push({
      id: row.id,
      kind: kindOf(row),
      origin: row.origin,
      scope: row.scope,
      key: row.key,
      text,
      category: row.category,
      confidence,
      evidenceCount: row.origin === "learned" ? row.support : 0,
    });
  }

  // Stable: equal ranks keep the order they arrived in (newest first per scope).
  candidates.sort((a, b) => RANK[a.kind] - RANK[b.kind] || b.confidence - a.confidence);

  const applied: AppliedPreference[] = [];
  const suppressed: SuppressedPreference[] = [];
  const winners = new Map<string, AppliedPreference>();
  for (const c of candidates) {
    const winner = c.key ? winners.get(c.key) : undefined;
    if (winner) {
      suppressed.push({ ...c, suppressedBy: winner.id ?? "task" });
      continue;
    }
    if (c.key) winners.set(c.key, c);
    if (applied.length < MAX_APPLIED) applied.push(c);
  }

  return { applied, suppressed };
}

/**
 * The preferences for one output, read and ordered. A database that has not
 * had `0044` yet is read the old way — every durable memory, all stated — so
 * deploying this before the migration degrades instead of failing every
 * prompt.
 */
export async function resolvePreferences(
  db: Client,
  context: PreferenceContext,
  now: Date = new Date(),
): Promise<Resolved> {
  const rows = await readRows(db, context, now);
  return orderPreferences(rows, context, now);
}

/**
 * For tasks whose prompt treats *later* guidance as overriding (the message
 * writer does): lowest precedence first, so the person's own word is last.
 */
export function asGuidance(resolved: Resolved): string[] {
  return [...resolved.applied].reverse().map((p) => p.text);
}

async function readRows(db: Client, context: PreferenceContext, now: Date): Promise<PreferenceRow[]> {
  const wanted: Array<{ scope: PreferenceRow["scope"]; id: string | null }> = [
    { scope: "organization", id: null },
  ];
  if (context.userId) wanted.push({ scope: "user", id: context.userId });
  if (context.accountId) wanted.push({ scope: "account", id: context.accountId });
  if (context.opportunityId) wanted.push({ scope: "opportunity", id: context.opportunityId });

  const iso = now.toISOString();
  const select = async (columns: string, withStatus: boolean) =>
    Promise.all(
      wanted.map(async ({ scope, id }) => {
        let query = db
          .from("memories")
          .select(columns)
          .eq("org_id", context.orgId)
          .eq("scope", scope)
          .eq("kind", "durable")
          .is("deleted_at", null)
          .or(`expires_at.is.null,expires_at.gt.${iso}`)
          .order("created_at", { ascending: false })
          .limit(LIMIT_PER_SCOPE);
        if (withStatus) query = query.eq("status", "active");
        query = id === null ? query.is("scope_id", null) : query.eq("scope_id", id);
        return query as Promise<{ data: Record<string, unknown>[] | null; error: { code?: string } | null }>;
      }),
    );

  let results = await select(
    "id, scope, key, content, source, origin, category, applies_to, support, contradicts, last_reinforced_at, created_at",
    true,
  );
  if (results.some((r) => r.error?.code === "42703")) {
    results = await select("id, scope, key, content, source, created_at", false);
  }

  return results.flatMap((r) => r.data ?? []).map(mapRow);
}

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped PostgREST rows. */
function mapRow(row: any): PreferenceRow {
  const origin = row.origin ?? (row.source === "derived" ? "learned" : "stated");
  return {
    id: String(row.id),
    scope: row.scope,
    key: row.key ?? null,
    content: String(row.content ?? ""),
    origin: origin === "learned" || origin === "promoted" ? origin : "stated",
    category: PREFERENCE_CATEGORIES.includes(row.category) ? row.category : null,
    appliesTo: Array.isArray(row.applies_to) ? row.applies_to.map(String) : [],
    support: Number(row.support ?? 0),
    contradicts: Number(row.contradicts ?? 0),
    lastReinforcedAt: row.last_reinforced_at ?? null,
    createdAt: row.created_at ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
