import type { ReactNode } from "react";
import { OnboardingProgress } from "./OnboardingProgress";

/**
 * Onboarding shell — master context §8 → §9 → §10, in that order.
 *
 * The order is not arbitrary and shouldn't be reshuffled for convenience:
 * the ICP is built *from* the company research (§9, "USER INPUT + COMPANY
 * RESEARCH = ICP"), and sources are recommended *from* the ICP (§10). Each
 * step is the input to the next, so skipping one leaves the next guessing.
 */
export default function WelcomeLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line-subtle bg-panel">
        <div className="mx-auto flex max-w-[860px] items-center gap-2 px-6 py-3">
          <span className="flex size-6 items-center justify-center rounded-md bg-brand-surface text-[13px] font-bold text-brand">
            H
          </span>
          <span className="text-[13px] font-semibold text-fg">Huntloop</span>
        </div>
      </header>

      <div className="mx-auto max-w-[860px] px-6 py-8">
        <OnboardingProgress />
        <div className="mt-8">{children}</div>
      </div>
    </div>
  );
}
