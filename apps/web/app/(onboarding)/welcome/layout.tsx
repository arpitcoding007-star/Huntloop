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
        <div className="mx-auto flex max-w-[860px] items-center gap-2 px-6 py-3">
          {/* To the landing page, with `?home=1` so a signed-in visitor is
              shown it rather than redirected straight back here. */}
          <BrandLink href="/?home=1" />
          <ThemeToggle className="ml-auto" />
        </div>
      </header>

      <div className="mx-auto max-w-[860px] px-6 py-8">
        <OnboardingProgress />
        <div className="mt-8">{children}</div>
      </div>
    </div>
  );
}
