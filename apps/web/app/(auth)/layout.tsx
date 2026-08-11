import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6 py-12">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-brand-surface text-[15px] font-bold text-brand">
            H
          </span>
          <span className="text-[15px] font-semibold text-fg">Huntloop</span>
        </div>
        {children}
      </div>
    </div>
  );
}
