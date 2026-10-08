import Link from "next/link";
import type { ReachOutProgress } from "../../../../lib/data/needs-you";

/**
 * "Reached out today" — the daily share of the weekly goal set under
 * Performance → Your pace, and how far along this person is.
 *
 * Derived, not a second setting: a daily goal typed separately from the weekly
 * one would be two numbers that drift apart. Counted from the activity ledger
 * the same way Performance counts, so the two pages agree. With no goal set,
 * it still shows the counts — they are true and worth seeing — and offers the
 * goal to the people who can set it.
 */
export function ReachOutGoal({
  org,
  progress,
  canSetGoals,
}: {
  org: string;
  progress: ReachOutProgress;
  canSetGoals: boolean;
}) {
  const { today, week, dailyGoal, weeklyGoal } = progress;
  const done = dailyGoal !== null && today >= dailyGoal;
  const width = dailyGoal ? Math.min(100, Math.round((today / dailyGoal) * 100)) : 0;

  return (
    <section
      aria-label="Your reach-outs"
      className="rounded-lg border border-line-subtle bg-surface px-4 py-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[13px] text-fg-secondary">
          Reached out today{" "}
          <span className="hl-tabular text-[15px] font-medium text-fg">{today}</span>
          {dailyGoal !== null && <span className="text-fg-muted"> of {dailyGoal}</span>}
          {done && <span className="ml-1.5 text-[12px] text-success-text">Today's goal met</span>}
        </p>
        <p className="text-[12px] text-fg-muted">
          <span className="hl-tabular">{week}</span>
          {weeklyGoal !== null ? ` of ${weeklyGoal}` : ""} this week
          {dailyGoal === null && canSetGoals && (
            <>
              {" · "}
              <Link
                href={`/${org}/performance#goals`}
                className="hl-focusable rounded-sm underline underline-offset-2 hover:text-fg-secondary"
              >
                Set a goal
              </Link>
            </>
          )}
        </p>
      </div>
      {dailyGoal !== null && (
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-line-subtle"
          role="meter"
          aria-label="Reach-outs today"
          aria-valuemin={0}
          aria-valuemax={dailyGoal}
          aria-valuenow={today}
        >
          <div className={done ? "h-full bg-success" : "h-full bg-brand"} style={{ width: `${width}%` }} />
        </div>
      )}
    </section>
  );
}
