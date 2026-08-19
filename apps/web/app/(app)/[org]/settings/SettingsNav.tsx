"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@huntloop/ui";

/**
 * Tabs across the settings section.
 *
 * A client component only because it needs `usePathname` to mark the current
 * tab. Everything it links to is a real route — the section is deliberately
 * not a place to park "coming soon" tabs, since a settings screen that cannot
 * change a setting is the most frustrating kind of placeholder.
 */
const TABS = [
  { slug: "", label: "Organisation" },
  { slug: "/product", label: "Product" },
  { slug: "/icp", label: "ICP" },
];

export function SettingsNav({ org }: { org: string }) {
  const pathname = usePathname();
  const base = `/${org}/settings`;

  return (
    <div
      role="tablist"
      aria-label="Settings sections"
      className="flex items-center gap-1 border-b border-line-subtle"
    >
      {TABS.map((tab) => {
        const href = `${base}${tab.slug}`;
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            role="tab"
            aria-selected={active}
            className={cn(
              "hl-focusable -mb-px border-b-2 px-3 py-2 text-[13px] transition-colors duration-[120ms]",
              active
                ? "border-brand font-medium text-fg"
                : "border-transparent text-fg-secondary hover:text-fg",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
