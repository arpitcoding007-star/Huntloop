"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar, Sidebar, TopBar, type NavGroup } from "@huntloop/ui";
import {
  BarChart3,
  Brain,
  Building2,
  Flame,
  Globe,
  Inbox as InboxIcon,
  KanbanSquare,
  Lightbulb,
  Radar,
  Send,
  Settings,
  Target,
  Upload,
  UserCheck,
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
  const pathname = usePathname();
  /** Icon-rail collapse — desktop only, where the sidebar is in flow. */
  const [collapsed, setCollapsed] = useState(false);
  /** Off-canvas drawer — below lg, where 240px of nav would leave ~135px of content. */
  const [navOpen, setNavOpen] = useState(false);

  // Escape closes the drawer; a nav that can only be dismissed by pointer is
  // a keyboard trap on the one breakpoint where it covers the whole page.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  /**
   * Nav follows the master context's loop — SIGNAL → CONTEXT → INTENT →
   * OPPORTUNITY (§4) — rather than a campaign tool's Leads/Campaigns/Inbox.
   * Three deliberate departures from what was here before:
   *
   *  · "Leads" → "Opportunities". §1 is explicit that the unit of the product
   *    is a qualified opportunity with evidence, not a lead, and the nav is
   *    where that vocabulary either sticks or quietly reverts.
   *  · Sources is promoted to a first-class destination (§10) — the user
   *    accepting, removing and adding sources is a confirmed requirement,
   *    not a settings sub-page.
   *  · Analyze a URL gets its own entry (§17), because "is this actually a
   *    good lead?" is a top-level job, not a filter on a list.
   *
   * Most of these routes are not built yet; they are the §45 surface map and
   * exist here so the shape of the product is visible while it is built.
   *
   * Those carry `unbuilt`, which renders them as labels rather than links.
   * Five of seventeen destinations exist today, and until this flag was added
   * the other twelve were ordinary links onto a 404 — the app asserting a
   * capability it does not have, which is the §7 failure pointed at ourselves.
   * Delete the flag in the same commit that adds the page.
   */
  const groups: NavGroup[] = [
    {
      label: "Company",
      items: [
        {
          label: "Product",
          href: `/${org}/settings/product`,
          icon: Building2,
          unbuilt: true,
        },
        {
          label: "ICP",
          href: `/${org}/settings/icp`,
          icon: Target,
          badge: { label: "AI", variant: "ai" },
          unbuilt: true,
        },
        { label: "Sources", href: `/${org}/sources`, icon: Radar },
      ],
    },
    {
      label: "Hunt",
      items: [
        { label: "Command Center", href: `/${org}/dashboard`, icon: Zap, dot: true },
        { label: "Opportunities", href: `/${org}/opportunities`, icon: Flame },
        {
          label: "Companies",
          href: `/${org}/companies`,
          icon: Building2,
          unbuilt: true,
        },
        { label: "Analyze a URL", href: `/${org}/analyze`, icon: Globe },
        { label: "Imports", href: `/${org}/imports`, icon: Upload, unbuilt: true },
      ],
    },
    {
      label: "Engage",
      items: [
        { label: "Outreach", href: `/${org}/outreach`, icon: Send, unbuilt: true },
        // The count goes with the flag: "12" was a fixture, and an unread
        // badge on a screen that does not exist is a notification about nothing.
        { label: "Inbox", href: `/${org}/inbox`, icon: InboxIcon, unbuilt: true },
        {
          label: "Pipeline",
          href: `/${org}/pipeline`,
          icon: KanbanSquare,
          unbuilt: true,
        },
      ],
    },
    {
      label: "Team",
      items: [
        { label: "Members", href: `/${org}/team`, icon: Users, unbuilt: true },
        {
          label: "Assignments",
          href: `/${org}/team/assignments`,
          icon: UserCheck,
          unbuilt: true,
        },
      ],
    },
    {
      label: "Learn",
      items: [
        // The flag goes in the same commit that adds the page — this one.
        { label: "Analytics", href: `/${org}/analytics`, icon: BarChart3 },
        {
          label: "Intelligence",
          href: `/${org}/intelligence`,
          icon: Lightbulb,
          badge: { label: "AI", variant: "ai" },
          unbuilt: true,
        },
        { label: "Memory", href: `/${org}/memory`, icon: Brain, unbuilt: true },
      ],
    },
    {
      label: "Settings",
      items: [
        { label: "Settings", href: `/${org}/settings`, icon: Settings, unbuilt: true },
      ],
    },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      {/*
        Skip link. Every authenticated page renders ~17 nav items before
        <main>, so without this a keyboard or screen-reader user tabs the
        entire sidebar again on every single page load (audit A11Y-02).

        It must be the first focusable thing in the document, which is why it
        sits above the scrim and the sidebar rather than somewhere tidier.

        Hidden until focused — `sr-only` keeps it in the accessibility tree and
        out of the visual design; `focus:not-sr-only` brings it back with real
        geometry. `display:none` would have removed it from the tab order,
        which is the usual way this gets built and the way that does nothing.
      */}
      <a
        href="#main"
        className="hl-focusable sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[60] focus:rounded-md focus:border focus:border-line-subtle focus:bg-surface focus:px-3 focus:py-2 focus:text-[13px] focus:font-medium focus:text-fg"
      >
        Skip to content
      </a>

      {/* Scrim — only exists below lg, where the sidebar is an overlay. */}
      {navOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-40 bg-overlay lg:hidden"
        />
      )}

      <div
        className={[
          "fixed inset-y-0 left-0 z-50 transition-transform duration-[180ms] ease-[cubic-bezier(0.16,1,0.3,1)]",
          "motion-reduce:transition-none lg:static lg:z-auto",
          // Scoped to max-lg deliberately: an unprefixed `-translate-x-full`
          // outranks `lg:translate-x-0` in Tailwind's cascade, which would
          // translate the sidebar off-screen on desktop too.
          navOpen ? "" : "max-lg:-translate-x-full",
        ].join(" ")}
      >
        <Sidebar
          groups={groups}
          /* The app-side half of the framework-agnostic `<a>` in packages/ui.
             Without it every one of these seventeen items reloaded the whole
             document — the single largest user-perceived performance cost in
             the app (audit PERF-01). */
          linkComponent={Link}
          /* Longest matching prefix, so a detail route
             (/opportunities/alphio-ai) still lights up its section, while
             /settings/icp does not also light up /settings. An exact match
             alone would leave every detail page with no active item. */
          activeHref={
            groups
              .flatMap((g) => g.items.map((i) => i.href))
              .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
              .sort((a, b) => b.length - a.length)[0] ?? ""
          }
          // The rail is only collapsible where it is in flow; inside the
          // drawer the control would fight the drawer's own dismissal.
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
          className="h-full"
          header={
            <div className="flex items-center gap-2 px-1">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-brand-surface text-[13px] font-bold text-brand">
                H
              </span>
              {!collapsed && (
                <span className="truncate text-[13px] font-semibold text-fg">Huntloop</span>
              )}
            </div>
          }
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          /* org → workspace, per the §38 tenancy hierarchy. The second crumb
             was a campaign, which put an execution artefact above the
             intelligence it comes from; the ICP is what a hunt is scoped by. */
          breadcrumbs={[
            { label: org },
            {
              label: "Web3 Infrastructure ICP",
              badge: { label: "Hunting", variant: "brand" },
            },
          ]}
          onMenuClick={() => setNavOpen(true)}
          onSearchClick={() => {}}
          /*
            Both were `"#"` — a Feedback link and a Help button that looked
            live, tabbed like links, and went nowhere (audit ANL-03).

            There is no feedback system and no help site yet, so the fix is not
            to invent a destination: `TopBar` already omits each control when
            its href is undefined, so an unset variable renders no affordance
            at all. Set them in the environment when the destinations exist and
            the controls appear — same rule as the `unbuilt` nav flag, applied
            to the topbar.

            `NEXT_PUBLIC_` because this is a Client Component; the value is a
            public URL, and there is nothing here worth hiding.
          */
          feedbackHref={process.env.NEXT_PUBLIC_FEEDBACK_URL}
          helpHref={process.env.NEXT_PUBLIC_HELP_URL}
          avatar={<Avatar initials={org} />}
          actions={
            /* A real form POST rather than a link: sign-out changes state, and
               a GET that any page could trigger is a CSRF. See
               app/auth/signout/route.ts. */
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="hl-focusable flex h-8 items-center rounded-md px-2 text-[13px] text-fg-secondary transition-colors duration-[120ms] hover:bg-surface-hover hover:text-fg"
              >
                Sign out
              </button>
            </form>
          }
        />

        {/*
          `tabIndex={-1}` is what makes the skip link actually skip. Without
          it, following `#main` moves the scroll position but leaves focus
          where it was, so the next Tab returns to the second nav item and the
          user is back in the sidebar they just escaped.
        */}
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
