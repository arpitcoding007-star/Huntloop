"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check } from "lucide-react";

/**
 * The four onboarding steps, and where you are in them.
 *
 * Completed steps are links; the current one and anything ahead are not.
 * Going *back* has to be possible — §77 Principle 7 gives the user control
 * over the ICP and sources, and a wizard you can only move forward through
 * quietly removes that. Going *forward* by clicking is not offered, because
 * each step consumes the previous one's output.
 */
const STEPS = [
  { href: "/welcome", label: "Organisation" },
  { href: "/welcome/product", label: "Your company" },
  { href: "/welcome/icp", label: "Ideal customer" },
  { href: "/welcome/sources", label: "Sources" },
] as const;

export function OnboardingProgress() {
  const pathname = usePathname();
  const current = Math.max(
    0,
    STEPS.findIndex((s) => s.href === pathname),
  );

  return (
    <nav aria-label="Setup progress">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-2">
        {STEPS.map((step, i) => {
          const done = i < current;
          const active = i === current;

          const dot = (
            <span
              className={[
                "flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                done && "border-brand-border bg-brand-surface text-brand-text",
                active && "border-brand bg-brand text-fg-inverse",
                !done && !active && "border-line bg-surface text-fg-muted",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {done ? <Check className="size-3" strokeWidth={2.5} /> : i + 1}
            </span>
          );

          const label = (
            <span
              className={[
                "text-[13px] whitespace-nowrap",
                active ? "font-medium text-fg" : "text-fg-muted",
              ].join(" ")}
            >
              {step.label}
            </span>
          );

          return (
            <li key={step.href} className="flex items-center gap-2">
              {done ? (
                <Link
                  href={step.href}
                  className="hl-focusable flex items-center gap-2 rounded-sm hover:opacity-80"
                >
                  {dot}
                  {label}
                </Link>
              ) : (
                <span
                  className="flex items-center gap-2"
                  aria-current={active ? "step" : undefined}
                >
                  {dot}
                  {label}
                </span>
              )}
              {i < STEPS.length - 1 && (
                <span aria-hidden className="h-px w-4 bg-line sm:w-8" />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
