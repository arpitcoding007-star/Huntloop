import type { ReactNode } from "react";
import { OnboardingProgress } from "./OnboardingProgress";
import { BrandLink } from "../../BrandLink";
import { ThemeToggle } from "@huntloop/ui";

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
        {/* The lockup centred (logo board: auth, onboarding and /discover),
            with the theme control held to the right edge. */}
        <div className="mx-auto grid max-w-[860px] grid-cols-[1fr_auto_1fr] items-center gap-2 px-6 py-3">
          <span aria-hidden />
          {/* To the landing page, which offers "Continue setup" back here. */}
          <BrandLink href="/" />
          <ThemeToggle className="justify-self-end" />
        </div>
      </header>

      <div className="mx-auto max-w-[860px] px-6 py-8">
        <OnboardingProgress />
        <div className="mt-8">{children}</div>
      </div>
    </div>
  );
}
