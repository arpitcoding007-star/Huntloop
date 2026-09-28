import type { ReactNode } from "react";
import { ThemeToggle } from "@huntloop/ui";
import { BrandLink } from "../BrandLink";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-canvas px-6 py-12">
      <ThemeToggle className="absolute top-4 right-4" />
      <div className="w-full max-w-[380px]">
        {/* The inline SVG lockup. This was a pair of ~250 kB PNGs swapped by
            theme; the mark now follows the theme through `currentColor`, so
            one element serves both and the sign-in page stops shipping half
            a megabyte of logo. Links home, as a logo does. */}
        <div className="mb-8">
          <BrandLink href="/" size="lg" />
        </div>
        {children}
      </div>
    </div>
  );
}
