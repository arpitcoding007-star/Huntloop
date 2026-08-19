"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@huntloop/ui";

/**
 * Tabs across the team section.
 *
 * The same component and the same reasoning as `SettingsNav`: a client
 * component only because it needs `usePathname` to mark the current tab, and
 * everything it links to is a real route. Both tabs are also sidebar entries,
 * because Members and Assignments are separately reachable jobs — the tabs are
 * for moving between them once you are here.
 */
const TABS = [
  { slug: "", label: "Members" },
  { slug: "/assignments", label: "Assignments" },
];

export function TeamNav({ org }: { org: string }) {
  const pathname = usePathname();
  const base = `/${org}/team`;

  return (
    <div
      role="tablist"
      aria-label="Team sections"
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
