import "server-only";
import { APPLY_THRESHOLD, PREFERENCE_CATEGORIES, confidenceOf, type PreferenceCategory } from "@huntloop/db/preferences";
import { canAdmin, currentViewer } from "./membership";
import { currentUserId, requireOrgId } from "./org";
import { load, type Loaded } from "./source";

/**
 * What Huntloop knows about how one person works — Settings → You (K2, `0044`).
 *
 * Everything here is the caller's own: RLS gives a person their user-scoped
 * memories, signals and questions and nobody else's, admins included. The two
 * exceptions are labelled as what they are: the workspace's own policy (read
 * only, because it is not theirs to change here), and — for an admin —
 * personal preferences a teammate chose to share so they can be promoted.
 */

export type PreferenceStatus = "proposed" | "active" | "paused" | "rejected";

export interface PreferenceEvidence {
  id: string;
  kind: string;
  note: string | null;
  features: Record<string, unknown>;
  subjectType: string | null;
  subjectId: string | null;
  createdAt: string;
}

export interface PersonalPreference {
  id: string;
  content: string;
  key: string | null;
  category: PreferenceCategory | null;
  origin: "stated" | "learned" | "promoted";
  status: PreferenceStatus;
  risk: "low" | "high";
  appliesTo: string[];
  support: number;
  contradicts: number;
  /** 0–1, now. 1 for anything the person wrote. */
  confidence: number;
  /** Learned, active, and no longer confident enough to be applied. */
  fading: boolean;
  lastReinforcedAt: string | null;
  lastAppliedAt: string | null;
  createdAt: string | null;
  sharedAt: string | null;
  evidence: PreferenceEvidence[];
}

export interface WorkspacePolicy {
  id: string;
  content: string;
  key: string | null;
  origin: "stated" | "learned" | "promoted";
}

export interface SharedPreference {
  id: string;
  content: string;
  category: PreferenceCategory | null;
  sharedAt: string;
  ownerName: string;
}

export interface MyLearning {
  preferences: PersonalPreference[];
  workspace: WorkspacePolicy[];
  shared: SharedPreference[];
  learningPaused: boolean;
  isAdmin: boolean;
  /** False before `0044`: the page says so instead of showing an empty list. */
  available: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped PostgREST rows (DB-03). */

export async function getMyLearning(orgSlug: string): Promise<Loaded<MyLearning>> {
  const viewer = await currentViewer(orgSlug);
  const isAdmin = canAdmin(viewer);
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "getMyLearning");
      const me = await currentUserId(db);
      if (!me) throw new Error("getMyLearning: no session");

      const columns =
        "id, scope, scope_id, key, content, origin, category, risk, status, applies_to, support, " +
        "contradicts, last_reinforced_at, last_applied_at, created_at, shared_at";

      const [mine, workspace, profile] = await Promise.all([
        db
          .from("memories")
          .select(columns)
          .eq("org_id", orgId)
          .eq("scope", "user")
          .eq("scope_id", me)
          .is("deleted_at", null)
          .neq("status", "rejected")
          .order("created_at", { ascending: false })
          .limit(200),
        db
          .from("memories")
          .select("id, key, content, origin, status, promoted_from")
          .eq("org_id", orgId)
          .eq("scope", "organization")
          .eq("kind", "durable")
          .eq("status", "active")
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(50),
        db.from("profiles").select("learning_paused").eq("id", me).maybeSingle(),
      ]);

      /* Before `0044` the new columns do not exist and the query says so. */
      if (mine.error?.code === "42703" || workspace.error?.code === "42703") {
        return { preferences: [], workspace: [], shared: [], learningPaused: false, isAdmin, available: false };
      }
      if (mine.error) throw new Error(`getMyLearning: ${mine.error.message}`);

      const rows = (mine.data ?? []) as any[];
      const ids = rows.map((r) => String(r.id));
      const evidence = ids.length
        ? await db
            .from("memory_evidence")
            .select("memory_id, preference_signals(id, kind, note, features, subject_type, subject_id, created_at)")
            .in("memory_id", ids)
            .limit(1000)
        : { data: [] as any[] };

      const byMemory = new Map<string, PreferenceEvidence[]>();
      for (const row of (evidence.data ?? []) as any[]) {
        const s = Array.isArray(row.preference_signals) ? row.preference_signals[0] : row.preference_signals;
        if (!s) continue;
        const list = byMemory.get(String(row.memory_id)) ?? [];
        list.push({
          id: String(s.id),
          kind: String(s.kind),
          note: s.note ?? null,
          features: (s.features ?? {}) as Record<string, unknown>,
          subjectType: s.subject_type ?? null,
          subjectId: s.subject_id ?? null,
          createdAt: String(s.created_at),
        });
        byMemory.set(String(row.memory_id), list);
      }

      const now = new Date();
      const preferences = rows.map((r): PersonalPreference => {
        const origin = r.origin === "learned" || r.origin === "promoted" ? r.origin : "stated";
        const confidence = confidenceOf(
          {
            id: String(r.id),
            scope: "user",
            key: r.key ?? null,
            content: String(r.content ?? ""),
            origin,
            category: null,
            appliesTo: [],
            support: Number(r.support ?? 0),
            contradicts: Number(r.contradicts ?? 0),
            lastReinforcedAt: r.last_reinforced_at ?? null,
            createdAt: r.created_at ?? null,
          },
          now,
        );
        const status = (["proposed", "active", "paused", "rejected"] as const).includes(r.status) ? r.status : "active";
        return {
          id: String(r.id),
          content: String(r.content ?? ""),
          key: r.key ?? null,
          category: PREFERENCE_CATEGORIES.includes(r.category) ? r.category : null,
          origin,
          status,
          risk: r.risk === "high" ? "high" : "low",
          appliesTo: Array.isArray(r.applies_to) ? r.applies_to.map(String) : [],
          support: Number(r.support ?? 0),
          contradicts: Number(r.contradicts ?? 0),
          confidence,
          fading: origin === "learned" && status === "active" && confidence < APPLY_THRESHOLD,
          lastReinforcedAt: r.last_reinforced_at ?? null,
          lastAppliedAt: r.last_applied_at ?? null,
          createdAt: r.created_at ?? null,
          sharedAt: r.shared_at ?? null,
          evidence: (byMemory.get(String(r.id)) ?? []).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        };
      });

      let shared: SharedPreference[] = [];
      if (isAdmin) {
        const { data } = await db
          .from("memories")
          .select("id, scope_id, content, category, shared_at")
          .eq("org_id", orgId)
          .eq("scope", "user")
          .neq("scope_id", me)
          .not("shared_at", "is", null)
          .is("deleted_at", null)
          .order("shared_at", { ascending: false })
          .limit(50);
        const owners = [...new Set(((data ?? []) as any[]).map((r) => String(r.scope_id)))];
        const names = owners.length
          ? await db.from("profiles").select("id, full_name, email").in("id", owners)
          : { data: [] as any[] };
        const nameOf = new Map(((names.data ?? []) as any[]).map((p) => [String(p.id), p.full_name ?? p.email ?? "A teammate"]));
        const adopted = new Set(
          ((workspace.data ?? []) as any[]).map((w) => w.promoted_from).filter(Boolean).map(String),
        );
        shared = ((data ?? []) as any[]).filter((r) => !adopted.has(String(r.id))).map((r) => ({
          id: String(r.id),
          content: String(r.content ?? ""),
          category: PREFERENCE_CATEGORIES.includes(r.category) ? r.category : null,
          sharedAt: String(r.shared_at),
          ownerName: String(nameOf.get(String(r.scope_id)) ?? "A teammate"),
        }));
      }

      return {
        preferences,
        workspace: ((workspace.data ?? []) as any[]).map((r) => ({
          id: String(r.id),
          content: String(r.content ?? ""),
          key: r.key ?? null,
          origin: r.origin === "learned" || r.origin === "promoted" ? r.origin : "stated",
        })),
        shared,
        learningPaused: Boolean((profile.data as any)?.learning_paused),
        isAdmin,
        available: true,
      };
    },
    () => DEMO,
  );
}

/* eslint-enable @typescript-eslint/no-explicit-any */

/** One of each kind, so the screen renders every state it has. */
const DEMO: MyLearning = {
  available: true,
  isAdmin: true,
  learningPaused: false,
  preferences: [
    {
      id: "demo-pref-1", content: "Sign off as \"Alex\" — no title, no phone number.", key: "outreach.signoff",
      category: "writing_style", origin: "stated", status: "active", risk: "low", appliesTo: ["personalize_message"],
      support: 0, contradicts: 0, confidence: 1, fading: false, lastReinforcedAt: null, lastAppliedAt: null,
      createdAt: null, sharedAt: null, evidence: [],
    },
    {
      id: "demo-pref-2", content: "Keep first-touch emails under about 80 words.", key: "email.length",
      category: "writing_style", origin: "learned", status: "active", risk: "low", appliesTo: ["personalize_message"],
      support: 4, contradicts: 0, confidence: 0.8, fading: false, lastReinforcedAt: null, lastAppliedAt: null,
      createdAt: null, sharedAt: null,
      evidence: [
        { id: "demo-sig-1", kind: "draft_edited", note: null, features: { wordsBefore: 142, wordsAfter: 81 }, subjectType: "message", subjectId: null, createdAt: "2026-10-01T10:00:00Z" },
        { id: "demo-sig-2", kind: "draft_edited", note: null, features: { wordsBefore: 128, wordsAfter: 74 }, subjectType: "message", subjectId: null, createdAt: "2026-10-03T10:00:00Z" },
        { id: "demo-sig-3", kind: "draft_edited", note: null, features: { wordsBefore: 150, wordsAfter: 90 }, subjectType: "message", subjectId: null, createdAt: "2026-10-05T10:00:00Z" },
      ],
    },
    {
      id: "demo-pref-3", content: "Treat companies under 20 people as a poor fit.", key: "targeting.min_size",
      category: "targeting", origin: "learned", status: "proposed", risk: "high", appliesTo: [],
      support: 3, contradicts: 0, confidence: 0.75, fading: false, lastReinforcedAt: null, lastAppliedAt: null,
      createdAt: null, sharedAt: null,
      evidence: [
        { id: "demo-sig-4", kind: "disqualified", note: "Too small", features: {}, subjectType: "opportunity", subjectId: null, createdAt: "2026-10-02T10:00:00Z" },
      ],
    },
  ],
  workspace: [
    { id: "demo-memory-1", content: "Never open with a compliment. Lead with the observation and the source.", key: "tone", origin: "stated" },
  ],
  shared: [],
};

/**
 * What Huntloop learned since the person last said "Got it" — the dashboard's
 * "I noticed…" card (K3). Learned items that apply themselves are announced
 * once; proposals stay until answered.
 */
export interface LearningNews {
  learned: { id: string; content: string }[];
  proposed: number;
}

export async function getLearningNews(orgSlug: string): Promise<LearningNews | null> {
  const { data } = await load<LearningNews | null>(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "getLearningNews");
      const me = await currentUserId(db);
      if (!me) return null;
      const { data: state } = await db
        .from("preference_state")
        .select("reviewed_at")
        .eq("org_id", orgId)
        .eq("user_id", me)
        .maybeSingle();
      const since = (state as { reviewed_at?: string | null } | null)?.reviewed_at ?? null;

      let learned = db
        .from("memories")
        .select("id, content")
        .eq("org_id", orgId)
        .eq("scope", "user")
        .eq("scope_id", me)
        .eq("origin", "learned")
        .eq("status", "active")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(3);
      if (since) learned = learned.gt("created_at", since);

      const [fresh, waiting] = await Promise.all([
        learned,
        db
          .from("memories")
          .select("id", { count: "exact", head: true })
          .eq("org_id", orgId)
          .eq("scope", "user")
          .eq("scope_id", me)
          .eq("status", "proposed")
          .is("deleted_at", null),
      ]);
      // Before 0044 these columns do not exist: no news is the right answer.
      if (fresh.error || waiting.error) return null;
      const items = ((fresh.data ?? []) as { id: string; content: string }[]).map((r) => ({
        id: String(r.id),
        content: String(r.content),
      }));
      const proposed = waiting.count ?? 0;
      return items.length || proposed ? { learned: items, proposed } : null;
    },
    () => null,
  );
  return data;
}
