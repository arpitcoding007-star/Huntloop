"use client";

import { usePathname } from "next/navigation";

/**
 * The settings section's heading.
 *
 * This was a tab row. The Settings panel in the sidebar now lists the same
 * six pages, and two navs for one set of pages is one too many — so what is
 * left here is the job the tabs did implicitly: saying which page this is.
 * A client component only because it needs `usePathname`.
 */
const PAGES: Record<string, { title: string; description: string }> = {
  "": {
    title: "General",
    description: "The workspace's name, and the voice Huntloop writes in.",
  },
  "/product": {
    title: "Product",
    description: "What this organisation sells.",
  },
  "/icp": {
    title: "ICP",
    description: "Who this organisation sells to, and what a good fit looks like.",
  },
  "/scoring": {
    title: "Scoring",
    description: "How opportunities are weighed against each other.",
  },
  "/integrations": {
    title: "Integrations",
    description: "The CRM Huntloop keeps in sync with your pipeline.",
  },
  "/privacy": {
    title: "Data & privacy",
    description: "What is kept, for how long, and how to take it back.",
  },
};

export function SettingsHeading({ org }: { org: string }) {
  const pathname = usePathname();
  const rest = pathname.slice(`/${org}/settings`.length);
  const key = Object.keys(PAGES)
    .filter((k) => rest === k || rest.startsWith(`${k}/`))
    .sort((a, b) => b.length - a.length)[0];
  const page = PAGES[key ?? ""];

  return (
    <header>
      <p className="hl-label">Settings</p>
      <h1 className="hl-heading mt-1.5 text-fg">{page.title}</h1>
      <p className="mt-1 text-[13px] text-fg-muted">{page.description}</p>
    </header>
  );
}
