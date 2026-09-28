import type { ReactNode } from "react";
import { SettingsHeading } from "./SettingsHeading";

/**
 * Shell for the settings section.
 *
 * Navigation between the pages lives in the sidebar's Settings panel. Product
 * and ICP are also listed under Company, because during onboarding they are
 * the work, and afterwards they are settings; the sidebar keeps whichever
 * section you came from selected.
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
      <SettingsHeading org={org} />

      <div className="mt-8">{children}</div>
    </div>
  );
}
