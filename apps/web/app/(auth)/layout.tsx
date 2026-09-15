import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6 py-12">
      <div className="w-full max-w-[380px]">
        <div className="mb-8">
          <img
            src="/brand/huntloop-lockup-light.png"
            alt="Huntloop"
            className="hl-brand-light h-9 w-auto"
          />
          <img
            src="/brand/huntloop-lockup-dark.png"
            alt="Huntloop"
            className="hl-brand-dark h-9 w-auto"
          />
        </div>
        {children}
      </div>
    </div>
  );
}
