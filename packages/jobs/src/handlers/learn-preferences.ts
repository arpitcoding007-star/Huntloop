/**
 * `learn_preferences` — what one person's own actions say about how they
 * work (K3, COMMAND.md §16.3-K, `0044`).
 *
 * Reads the person's signals from the last `WINDOW_DAYS`, and:
 *
 *   1. counts what can be counted — `styleCandidates` over draft edits
 *      (length, sign-off, greeting, bullets, phrases they delete);
 *   2. reads what cannot — `infer_preferences` over the notes they typed
 *      (redraft notes, corrections, rejection and disqualification reasons),
 *      only when there are new ones;
 *   3. merges each candidate into the person's memories by `key`: a new one is
 *      inserted as learned (active when low-risk, *proposed* when it is about
 *      who to target); a learned one is reinforced; anything the person stated,
 *      or declined, is left alone — their word, and their "no", win;
 *   4. links every learned memory to the signals behind it (`memory_evidence`),
 *      marks the new signals considered, and drops signals past retention.
 *
 * Every candidate cites at least three of the person's own actions. Nothing
 * here reads prospect content: signals are written only from what a person
 * did (`recordSignal`).
 */
import { inferPreferences, MIN_PREFERENCE_SUPPORT, type InferInput } from "@huntloop/ai";
import { styleCandidates, type StyleSignal } from "@huntloop/db/style";
import { AiUnavailable, runForOrg } from "../ai.ts";
import { OrgScope } from "../scope.ts";
import type { JobContext, JobOutcome } from "../registry.ts";

export const WINDOW_DAYS = 90;
export const RETENTION_DAYS = 180;
/** New notes needed before a model call is worth making. */
export const MIN_NEW_NOTES = MIN_PREFERENCE_SUPPORT;

const NOTE_WHERE: Record<string, InferInput["notes"][number]["where"]> = {
  draft_regenerated: "redraft",
  assistant_correction: "assistant",
  draft_rejected: "rejection",
  disqualified: "disqualified",
  score_override: "score",
  task_instruction: "instruction",
};

const HIGH_RISK = new Set(["targeting"]);

interface Candidate {
  key: string;
  category: string;
  content: string;
  appliesTo: string[];
  signalIds: string[];
  contradictingIds: string[];
}

interface SignalRow {
  id: string;
  kind: string;
  note: string | null;
  features: Record<string, unknown> | null;
  subject_id: string | null;
  learned_at: string | null;
}

interface MemoryRow {
  id: string;
  key: string | null;
  content: string;
  origin: string;
  status: string;
  support: number;
  deleted_at: string | null;
}

export async function learnPreferencesJob(ctx: JobContext): Promise<JobOutcome> {
  const { scope, now } = ctx;
  const userId = typeof ctx.payload.userId === "string" ? ctx.payload.userId : null;
  if (!userId) return { ok: false, error: "learn_preferences: no userId in payload", permanent: true };

  const finish = async (result: Record<string, unknown>): Promise<JobOutcome> => {
    await scope.upsert(
      "preference_state",
      { user_id: userId, last_learned_at: now.toISOString(), requested_at: null },
      { onConflict: "org_id,user_id" },
    );
    return { ok: true, result };
  };

  if (await isPaused(userId)) return finish({ skipped: "learning is paused" });

  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString();
  const [{ data: signalData, error }, { data: memoryData }] = await Promise.all([
    scope
      .select("preference_signals", "id, kind, note, features, subject_id, learned_at")
      .eq("user_id", userId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(500),
    scope
      .select("memories", "id, key, content, origin, status, support, deleted_at")
      .eq("scope", "user")
      .eq("scope_id", userId)
      .limit(500),
  ]);
  if (error) return { ok: false, error: `learn_preferences: ${error.message}` };

  const signals = (signalData ?? []) as SignalRow[];
  const pending = signals.filter((s) => !s.learned_at);
  if (pending.length === 0) return finish({ skipped: "no new signals" });

  const memories = (memoryData ?? []) as MemoryRow[];
  const candidates: Candidate[] = [];

  /* 1 · Counted. */
  const edits: StyleSignal[] = signals
    .filter((s) => s.kind === "draft_edited")
    .map((s) => ({ id: String(s.id), subjectId: s.subject_id, features: (s.features ?? {}) as StyleSignal["features"] }));
  for (const c of styleCandidates(edits)) candidates.push({ ...c, appliesTo: [...c.appliesTo] });

  /* 2 · Read — only when something new was typed. */
  const notes = signals.filter((s) => s.note && NOTE_WHERE[s.kind]);
  const newNotes = notes.filter((s) => !s.learned_at);
  let inferred = 0;
  if (newNotes.length >= MIN_NEW_NOTES && notes.length >= MIN_PREFERENCE_SUPPORT) {
    try {
      const run = await runForOrg(scope, inferPreferences, {
        notes: notes.map((s) => ({ id: String(s.id), where: NOTE_WHERE[s.kind]!, text: String(s.note) })),
        known: memories
          .filter((m) => !m.deleted_at)
          .map((m) => ({ key: m.key, content: String(m.content) })),
      });
      for (const p of run.output.preferences) {
        candidates.push({ ...p, contradictingIds: [] });
        inferred++;
      }
    } catch (e) {
      if (!(e instanceof AiUnavailable)) return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /* 3 · Merged. */
  const pendingIds = new Set(pending.map((s) => String(s.id)));
  let created = 0;
  let reinforced = 0;
  for (const c of candidates) {
    const existing = memories.find((m) => m.key === c.key);
    if (existing && (existing.deleted_at || existing.status === "rejected" || existing.origin !== "learned")) continue;

    const fresh = c.signalIds.some((id) => pendingIds.has(id));
    let memoryId: string | null = existing?.id ?? null;
    if (existing) {
      if (!fresh) continue;
      await scope
        .update("memories", {
          content: c.content,
          support: Math.max(Number(existing.support ?? 0), c.signalIds.length),
          contradicts: c.contradictingIds.length,
          last_reinforced_at: now.toISOString(),
        })
        .eq("id", existing.id);
      reinforced++;
    } else {
      const risk = HIGH_RISK.has(c.category) ? "high" : "low";
      const { data: inserted } = await scope
        .insert("memories", {
          scope: "user",
          scope_id: userId,
          kind: "durable",
          key: c.key,
          content: c.content,
          source: "derived",
          origin: "learned",
          category: c.category,
          risk,
          status: risk === "high" ? "proposed" : "active",
          applies_to: c.appliesTo,
          support: c.signalIds.length,
          contradicts: c.contradictingIds.length,
          last_reinforced_at: now.toISOString(),
        })
        .select("id")
        .single();
      memoryId = inserted?.id ? String(inserted.id) : null;
      if (memoryId) created++;
    }

    if (memoryId) {
      await scope.upsert(
        "memory_evidence",
        c.signalIds.map((signalId) => ({ memory_id: memoryId, signal_id: signalId, user_id: userId })),
        { onConflict: "memory_id,signal_id", ignoreDuplicates: true },
      );
    }
  }

  /* 4 · Considered, and kept no longer than retention. */
  await scope
    .update("preference_signals", { learned_at: now.toISOString() })
    .in("id", [...pendingIds]);
  await scope
    .delete("preference_signals")
    .eq("user_id", userId)
    .lt("created_at", new Date(now.getTime() - RETENTION_DAYS * 86_400_000).toISOString());

  return finish({ considered: pending.length, candidates: candidates.length, created, reinforced, inferred });
}

/**
 * "Pause learning" holds here too, for signals recorded before it was pressed.
 * `profiles` has no `org_id`, so it is read through the global client — one
 * row, by primary key, of the person this job is about.
 */
async function isPaused(userId: string): Promise<boolean> {
  const { data } = await OrgScope.global()
    .from("profiles")
    .select("learning_paused")
    .eq("id", userId)
    .maybeSingle();
  return Boolean((data as { learning_paused?: boolean } | null)?.learning_paused);
}
