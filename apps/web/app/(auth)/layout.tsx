import type { ReactNode } from "react";
import { ThemeToggle } from "@huntloop/ui";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-canvas px-6 py-12">
      <ThemeToggle className="absolute top-4 right-4" />
      <div className="w-full max-w-[380px]">
        <div className="mb-8">
          {/* Intrinsic dimensions, so the sign-in card does not jump when a
              ~250 kB lockup decodes. `h-9 w-auto` still sizes it; these give
              the browser the aspect ratio to reserve the box with, which is
              the whole of the layout-shift fix. The two files differ
              slightly in size, so each carries its own. */}
          <img
            src="/brand/huntloop-lockup-light.png"
            alt="Huntloop"
            width={1849}
            height={543}
            className="hl-brand-light h-9 w-auto"
          />
          <img
            src="/brand/huntloop-lockup-dark.png"
            alt="Huntloop"
            width={1851}
            height={596}
            className="hl-brand-dark h-9 w-auto"
          />
        </div>
        {children}
      </div>
    </div>
  );
}
