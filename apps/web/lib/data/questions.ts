import "server-only";
import type { QuestionSurface } from "../questions/catalog";
import { nextQuestion, type QuestionState } from "../questions/planner";
import { getOnboardingState } from "./onboarding";
import { currentUserId, requireOrgId } from "./org";
import { load } from "./source";

/**
 * The one question to ask on a screen, if any (K4). Reads only the caller's
 * own rows; returns the catalog key, which the card looks up — the question's
 * words never come from the database.
 */
export async function getQuestionFor(orgSlug: string, surface: QuestionSurface): Promise<string | null> {
  const { data } = await load<string | null>(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "getQuestionFor");
      const me = await currentUserId(db);
      if (!me) return null;
      const [states, memories, onboarding] = await Promise.all([
        db.from("user_questions").select("question_key, status, snooze_until, updated_at").eq("org_id", orgId).eq("user_id", me),
        db.from("memories").select("key").eq("org_id", orgId).eq("scope", "user").eq("scope_id", me).is("deleted_at", null).not("key", "is", null),
        getOnboardingState(orgSlug),
      ]);
      // Before 0044 there is nowhere to keep an answer: ask nothing.
      if (states.error) return null;
      const q = nextQuestion(
        surface,
        {
          memoryKeys: new Set(((memories.data ?? []) as { key: string }[]).map((m) => String(m.key))),
          workspaceKind: onboarding?.workspaceKind ?? "company",
          hasProduct: onboarding?.hasProduct ?? true,
          hasIcp: onboarding?.hasIcp ?? true,
        },
        ((states.data ?? []) as { question_key: string; status: QuestionState["status"]; snooze_until: string | null; updated_at: string }[]).map(
          (s) => ({ key: s.question_key, status: s.status, snoozeUntil: s.snooze_until, updatedAt: s.updated_at }),
        ),
      );
      return q?.key ?? null;
    },
    () => null,
  );
  return data;
}
