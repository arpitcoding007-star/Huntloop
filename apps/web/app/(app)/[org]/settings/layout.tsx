import type { ReactNode } from "react";
import { SettingsNav } from "./SettingsNav";

/**
 * Shell for the settings section.
 *
 * The three tabs underneath it are one subject — what this organisation is and
 * what it sells — split across pages because they are edited at different
 * times, not because they are unrelated. The sidebar reaches Product and ICP
 * directly, which is why they are top-level nav entries as well as tabs here:
 * during onboarding they are the work, and afterwards they are settings.
 */
export default async function SettingsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;

  return (
    <div className="mx-auto w-full max-w-[880px] px-6 py-8 lg:px-8">
      <header>
        <h1 className="text-[30px] leading-9 font-semibold text-fg">Settings</h1>
        <p className="mt-1 text-[13px] text-fg-muted">
          What this organisation is, what it sells, and who it sells to.
        </p>
      </header>

      <div className="mt-6">
        <SettingsNav org={org} />
      </div>

      <div className="mt-6">{children}</div>
    </div>
  );
}
