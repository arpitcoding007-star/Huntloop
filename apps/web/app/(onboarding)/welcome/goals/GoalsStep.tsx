"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button } from "@huntloop/ui";
import { Check } from "lucide-react";
import {
  CHANNEL_OPTIONS,
  GOAL_OPTIONS,
  MAX_GOALS,
  type Goal,
  type OutreachChannel,
} from "../../../../lib/onboarding/steps";
import { saveGoals } from "../actions";

/**
 * Step three: what you want out of this.
 *
 * ── Why this is worth a screen ───────────────────────────────────────────
 *
 * It is the difference between a product that has features and a product that
 * has a *first screen*. The answer decides which jobs get scheduled, what the
 * dashboard leads with, and what the very next thing Huntloop does for this
 * user is. Without it every workspace runs every job and every dashboard shows
 * everything, which is the same as showing nothing.
 *
 * ── Why at most two ─────────────────────────────────────────────────────
 *
 * Because the answer's only job is to *rank*. A user who picks all five has
 * expressed no ranking, and the dashboard would fall back to the generic
 * layout while the screen implied they had chosen one. The cap forces the
 * discrimination that makes the answer useful — and `0024` enforces it in a
 * CHECK, so it holds for the seed and the API too.
 *
 * ── Why the channel question is a preference, not a connection ───────────
 *
 * Connecting a mailbox is the single most abandonment-prone thing in any B2B
 * onboarding: it is an OAuth consent screen for a scope that reads mail,
 * shown to somebody who has been using the product for ninety seconds.
 * Asking what they *intend* costs one click and lets the connection be offered
 * later, in context, when there is a drafted message waiting to go out.
 */
export function GoalsStep({ org }: { org: string }) {
  const router = useRouter();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [channel, setChannel] = useState<OutreachChannel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(goal: Goal) {
    setGoals((prev) => {
      if (prev.includes(goal)) return prev.filter((g) => g !== goal);
      // Oldest out when a third is picked, rather than refusing the click.
      // Refusing would leave the user pressing a button that does nothing and
      // guessing why; this makes the cap visible by demonstrating it.
      if (prev.length >= MAX_GOALS) return [...prev.slice(1), goal];
      return [...prev, goal];
    });
  }

  function submit() {
    if (!channel || goals.length === 0) return;
    setError(null);
    startTransition(async () => {
      const result = await saveGoals(org, goals, channel);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/welcome/icp?org=${org}`);
    });
  }

  return (
    <>
      <h1 className="text-[26px] leading-8 font-semibold text-fg">
        What do you want Huntloop to do?
      </h1>
      <p className="mt-1.5 max-w-lg text-[14px] leading-[1.6] text-fg-muted">
        Pick one or two. This decides what your workspace leads with and which
        work runs on a schedule — not what you&rsquo;re allowed to use.
      </p>

      <div className="mt-6 max-w-2xl">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase">
            Mainly
          </span>
          <span className="hl-tabular text-[12px] text-fg-muted">
            {goals.length}/{MAX_GOALS}
          </span>
        </div>

        <div role="group" aria-label="What you want Huntloop to do" className="mt-2 space-y-2">
          {GOAL_OPTIONS.map((option) => {
            const on = goals.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(option.value)}
                className={[
                  "hl-focusable flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors duration-[120ms]",
                  on
                    ? "border-brand-border bg-brand-surface"
                    : "border-line bg-surface hover:border-line-strong",
                ].join(" ")}
              >
                <span
                  aria-hidden
                  className={[
                    "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border",
                    on ? "border-brand bg-brand text-fg-inverse" : "border-line",
                  ].join(" ")}
                >
                  {on && <Check className="size-3" strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span
                      className={[
                        "text-[13px] font-medium",
                        on ? "text-brand-text" : "text-fg",
                      ].join(" ")}
                    >
                      {option.label}
                    </span>
                    {/* The loop stage, named the same way the nav, the docs and
                        the landing page name it. One vocabulary everywhere. */}
                    <Badge variant="neutral">{option.stage}</Badge>
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-[1.5] text-fg-muted">
                    {option.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <fieldset className="mt-8 max-w-2xl">
        <legend className="text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase">
          How do you want to reach people?
        </legend>
        <p className="mt-1 text-[13px] text-fg-muted">
          Nothing is ever sent without you approving it, whichever you pick.
        </p>

        {/* The label's two text spans are direct children rather than wrapped,
            for the reason spelled out in `YouForm.tsx`: a wrapper buries them
            one level deeper than `jsx-a11y/label-has-associated-control`
            inspects, and the control ends up with no accessible name. The grid
            does the layout a wrapper would have done. */}
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {CHANNEL_OPTIONS.map((option) => {
            const selected = channel === option.value;
            return (
              <label
                key={option.value}
                className={[
                  "hl-focusable-within grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 rounded-md border p-3 transition-colors duration-[120ms]",
                  selected
                    ? "border-brand-border bg-brand-surface"
                    : "border-line bg-surface hover:border-line-strong",
                ].join(" ")}
              >
                <input
                  type="radio"
                  name="channel"
                  value={option.value}
                  checked={selected}
                  onChange={() => setChannel(option.value)}
                  className="row-span-2 mt-0.5 size-4 shrink-0 self-start accent-[var(--color-brand)]"
                />
                <span
                  className={[
                    "text-[13px] font-medium",
                    selected ? "text-brand-text" : "text-fg",
                  ].join(" ")}
                >
                  {option.label}
                </span>
                <span className="mt-0.5 text-[12px] leading-[1.5] text-fg-muted">
                  {option.description}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="mt-4 text-[13px] text-danger">
          {error}
        </p>
      )}

      <div className="mt-6">
        <Button
          variant="primary"
          size="lg"
          disabled={pending || goals.length === 0 || !channel}
          onClick={submit}
        >
          {pending ? "Saving…" : "Continue"}
        </Button>
      </div>
    </>
  );
}
