"use client";

import type { ReactNode } from "react";
import { Avatar, Sidebar, TopBar, type NavGroup } from "@huntloop/ui";
import {
  BarChart3,
  Building2,
  Download,
  GraduationCap,
  Inbox as InboxIcon,
  Lightbulb,
  Send,
  Settings,
  Sparkles,
  Target,
  Users,
  Zap,
} from "lucide-react";

/**
 * Client-side nav shell. Icon components (lucide-react) can't cross the
 * server→client boundary as props — React can only serialize plain data
 * from a Server Component into a Client Component, not component
 * references — so the nav array is built HERE, inside the client
 * component, rather than in the server layout and passed down.
 */
export function OrgShell({ org, children }: { org: string; children: ReactNode }) {
  const groups: NavGroup[] = [
    {
      label: "Company",
      items: [
        { label: "Product", href: `/${org}/settings/product`, icon: Building2 },
        {
          label: "ICP",
          href: `/${org}/settings/icp`,
          icon: Target,
          badge: { label: "AI", variant: "ai" },
        },
      ],
    },
    {
      label: "Intelligence",
      items: [
        {
          label: "Co-Pilot",
          href: `/${org}/co-pilot`,
          icon: Sparkles,
          badge: { label: "AI", variant: "ai" },
        },
        { label: "Today's Command", href: `/${org}/dashboard`, icon: Zap, dot: true },
        { label: "Intelligence", href: `/${org}/intelligence`, icon: Lightbulb },
      ],
    },
    {
      label: "Pipeline",
      items: [
        { label: "Leads", href: `/${org}/leads`, icon: Users },
        { label: "Campaigns", href: `/${org}/campaigns`, icon: Send },
        { label: "Inbox", href: `/${org}/inbox`, icon: InboxIcon, count: 12 },
      ],
    },
    {
      label: "Reports",
      items: [
        { label: "Analytics", href: `/${org}/analytics`, icon: BarChart3 },
        {
          label: "Learning",
          href: `/${org}/intelligence/learning`,
          icon: GraduationCap,
          badge: { label: "AI", variant: "ai" },
        },
        { label: "Exports", href: `/${org}/exports`, icon: Download },
      ],
    },
    {
      label: "Settings",
      items: [{ label: "Settings", href: `/${org}/settings`, icon: Settings }],
    },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      <Sidebar
        groups={groups}
        activeHref={`/${org}/dashboard`}
        header={
          <div className="flex items-center gap-2 px-1">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-brand-surface text-[13px] font-bold text-brand">
              H
            </span>
            <span className="truncate text-[13px] font-semibold text-fg">Huntloop</span>
          </div>
        }
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          breadcrumbs={[
            { label: org },
            { label: "Q3 Outbound", badge: { label: "Live", variant: "brand" } },
          ]}
          onSearchClick={() => {}}
          feedbackHref="#"
          helpHref="#"
          avatar={<Avatar initials={org} />}
        />

        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
