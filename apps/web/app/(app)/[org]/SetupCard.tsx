import Link from "next/link";
import { Button } from "@huntloop/ui";
import { ArrowRight } from "lucide-react";
import { stepPath } from "../../../lib/data/destination";
import type { OnboardingState } from "../../../lib/data/onboarding";
import { VISIBLE_STEPS } from "../../../lib/onboarding/steps";

/**
 * "You haven't finished setting up."
 *
 * ── Why the workspace is reachable at all before setup is finished ───────
 *
 * Because trapping somebody in a wizard is worse than showing them a
 * half-configured product, provided the product says which parts are not
 * working yet. A user who wants to look around before committing to five
 * screens should be able to, and one who was interrupted on step four should
 * not have to finish it before they can see what they already have.
 *
 * The cost is this card, which has to be honest about consequences rather than
 * nagging. Discovery genuinely does not run without an ICP, so it says that —
 * naming the missing thing and what it blocks, not "complete your profile".
 *
 * ── Why it uses the rows rather than the step ────────────────────────────
 *
 * `onboarding_step` is a hint about where to *send* somebody. What the
 * workspace can actually do is decided by whether the rows exist, and the two
 * can disagree: a user who reached `sources` and then deleted their ICP from
 * settings has a step that says one thing and a capability that says another.
 * The card describes capability.
 */
export function SetupCard({ state }: { state: OnboardingState }) {
  if (state.completedAt || state.step === "done") return null;

  const missing = [
    !state.hasProduct && {
      label: "What your company sells",
      why: "Every judgement Huntloop makes is measured against this.",
      href: `/welcome/company?org=${state.orgSlug}`,
    },
    !state.hasIcp && {
      label: "Your ideal customer profile",
      why: "Discovery and scoring are paused until this exists.",
      href: `/welcome/icp?org=${state.orgSlug}`,
    },
    state.hasIcp &&
      state.sourceCount === 0 && {
        label: "Sources to watch",
        why: "Optional — discovery still works, but we won't catch news about the companies it finds.",
        href: `/welcome/sources?org=${state.orgSlug}`,
      },
  ].filter((m): m is { label: string; why: string; href: string } => Boolean(m));

  // Everything is configured and only the marker is unset — which happens when
  // somebody closed the tab on the last screen. Nothing to nag about.
  if (missing.length === 0) return null;

  const done = VISIBLE_STEPS.length - missing.length;

  return (
    <section
      aria-labelledby="setup-heading"
      className="mx-auto w-full max-w-[1600px] px-6 pt-6 lg:px-8"
    >
      <div className="rounded-md border border-brand-border bg-brand-surface/30 p-4">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <h2 id="setup-heading" className="text-[14px] font-semibold text-fg">
              Finish setting up your workspace
            </h2>
            <p className="mt-0.5 text-[12px] text-fg-muted">
              {done} of {VISIBLE_STEPS.length} steps done. Everything you
              entered is saved.
            </p>

            <ul className="mt-3 space-y-1.5">
              {missing.map((m) => (
                <li key={m.label} className="flex items-start gap-2">
                  <span
                    aria-hidden
                    className="mt-1 size-3.5 shrink-0 rounded-full border border-line bg-surface"
                  />
                  <span className="min-w-0 text-[13px] leading-[1.5]">
                    <Link
                      href={m.href}
                      className="hl-focusable rounded-sm font-medium text-fg underline decoration-dotted underline-offset-2 hover:text-brand-text"
                    >
                      {m.label}
                    </Link>
                    <span className="text-fg-muted"> — {m.why}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <Button
            variant="primary"
            icon={ArrowRight}
            href={stepPath(state.orgSlug, state.step)}
            linkComponent={Link}
          >
            Continue setup
          </Button>
        </div>
      </div>
    </section>
  );
}

