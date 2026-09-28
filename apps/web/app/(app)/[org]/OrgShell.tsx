"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Avatar,
  Menu,
  Sidebar,
  SidebarAccount,
  SidebarCollapseButton,
  SidebarQuota,
  ThemeToggle,
  TopBar,
  type NavGroup,
  type NavItem,
} from "@huntloop/ui";
import type { ShellChrome } from "../../../lib/data/chrome";
import {
  Activity,
  BarChart3,
  Brain,
  Building2,
  ChevronsUpDown,
  Flame,
  LogOut,
  MoreHorizontal,
  Globe,
  GraduationCap,
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
export function OrgShell({
  org,
  chrome,
  children,
}: {
  org: string;
  chrome: ShellChrome;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  /** Icon-rail collapse — desktop only, where the sidebar is in flow. */
  const [collapsed, setCollapsed] = useState(false);
  /** Off-canvas drawer — below lg, where 264px of nav would leave ~110px of content. */
  const [navOpen, setNavOpen] = useState(false);
  /** Submitted by the account menu's "Sign out". See the item for why. */
  const signOutForm = useRef<HTMLFormElement>(null);
  /** The jump-to palette. Opened from the top bar's search field; the
      Sidebar still binds ⌘K and supplies the destinations. */
  const [jumpOpen, setJumpOpen] = useState(false);

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
   * Every destination here is now built. It was not always: this list is the
   * §45 surface map, and for most of the project's life two thirds of it were
   * ordinary links onto a 404 — the app asserting a capability it did not
   * have, which is the §7 failure pointed at ourselves.
   *
   * The fix was the `unbuilt` flag, which renders an item as a label rather
   * than a link, and the rule that it comes off in the same commit that adds
   * the page. Seventeen of seventeen have now had it removed, so no item
   * carries it today.
   *
   * Keep the flag and the rule. The next destination added to this map will
   * need both, and `audit.mjs` NAV-01 fails the build for a nav item pointing
   * at a route that does not exist — which is what makes "add the label, not
   * the link" the cheaper option rather than a discipline to remember.
   */
  /*
   * Command Center is pinned above the groups rather than sitting inside
   * Hunt. It is the one destination that is not a stage of the loop — it is
   * the view *of* the loop — and giving it its own row at the top is what
   * makes the five groups below read as five equal stages instead of one
   * lopsided first group.
   */
  const pinned: NavItem[] = [
    { label: "Command Center", href: `/${org}/dashboard`, icon: Zap },
  ];

  const groups: NavGroup[] = [
    {
      label: "Hunt",
      items: [
        { label: "Opportunities", href: `/${org}/opportunities`, icon: Flame },
        { label: "Companies", href: `/${org}/companies`, icon: Building2 },
        { label: "Analyze a URL", href: `/${org}/analyze`, icon: Globe },
        { label: "Imports", href: `/${org}/imports`, icon: Upload },
      ],
    },
    {
      label: "Engage",
      items: [
        { label: "Outreach", href: `/${org}/outreach`, icon: Send },
        // No count until something counts it. "12" was a fixture, and an
        // unread badge that is always 12 is a notification about nothing —
        // worse than none, because it is the one number a user learns to
        // stop reading.
        { label: "Inbox", href: `/${org}/inbox`, icon: InboxIcon },
        { label: "Pipeline", href: `/${org}/pipeline`, icon: KanbanSquare },
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
        },
        /* The Learn stage of §4, which had no destination until the analysis
           behind it existed. Same rule as everything else in this list: the
           entry and the route arrive together, and `audit.mjs` NAV-01 fails
           the build if they ever do not. */
        {
          label: "What we've learned",
          href: `/${org}/learn`,
          icon: GraduationCap,
          badge: { label: "AI", variant: "ai" },
        },
        { label: "Memory", href: `/${org}/memory`, icon: Brain },
      ],
    },
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
        { label: "Sources", href: `/${org}/sources`, icon: Radar },
      ],
    },
    {
      label: "Team",
      items: [
        { label: "Members", href: `/${org}/team`, icon: Users },
        {
          label: "Assignments",
          href: `/${org}/team/assignments`,
          icon: UserCheck,
        },
      ],
    },
    {
      label: "Operate",
      items: [
        /* `JOB-01`. Grouped rather than top-level: it answers "why has
           nothing happened", which is a question asked occasionally and
           urgently, not a workflow of its own. */
        { label: "Engine", href: `/${org}/ops`, icon: Activity },
      ],
    },
  ];

  /* Settings sits in the footer beside the collapse control, as in the
     Meridian sidebar, rather than in a group: it is where you go to change
     the loop, not a stage of it. Same row, same active treatment. */
  const footerItems: NavItem[] = [
    { label: "Settings", href: `/${org}/settings`, icon: Settings },
  ];

  /* Stable across renders, because the Sidebar binds ⌘K against it. The
     drawer closes on a jump for the same reason it closes on Escape: below
     lg it covers the page the user just asked to see. */
  const jumpTo = useMemo(
    () => ({
      onNavigate: (href: string) => {
        setNavOpen(false);
        router.push(href);
      },
      open: jumpOpen,
      onOpenChange: setJumpOpen,
      /* The top bar carries the search field, as in the reference; a second
         one in the sidebar would be two controls for one palette. */
      trigger: false,
    }),
    [router, jumpOpen],
  );

  return (
    /*
      One scroller, not two. The shell is exactly one viewport tall and only
      <main> scrolls. `relative` makes this box the containing block for
      absolutely positioned descendants: without it, every `sr-only` span in a
      page (the fact/inference labels alone number dozens) is positioned
      against the document, escapes the overflow clip, and stretches <html>
      past the viewport — a second scrollbar that drags the whole shell,
      sidebar and top bar included, off-screen. `h-dvh` rather than
      `h-screen` because 100vh on mobile includes the collapsing URL bar,
      which produces the same double scroll on phones.
    */
    <div className="relative flex h-dvh flex-col overflow-hidden bg-canvas">
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

      <TopBar
        /*
          No crumbs: the workspace is named by the switcher in `logo`, which
          is the one thing a crumb here ever said that was true (audit UX-12
          removed a hard-coded ICP crumb). Restore an ICP crumb, from the
          org's real ICP, in the commit that loads one.
        */
        breadcrumbs={[]}
        logo={
          /*
           * The workspace, not the product.
           *
           * This used to read "Huntloop" beside the mark, which is the one
           * thing a signed-in user already knows and never needs the
           * top bar to tell them. What they do need — especially anyone in
           * more than one workspace — is which workspace they are looking
           * at and what it is paying for, so the header states both and
           * doubles as the switcher.
           */
          <Link
            href="/orgs"
            title="Switch workspace"
            className="hl-focusable flex h-10 max-w-full min-w-0 items-center gap-2.5 rounded-[10px] pr-2 pl-1.5 transition-colors duration-[120ms] hover:bg-nav-hover"
          >
            {/* The real mark (commit de3e50d). Intrinsic dimensions given so
                the bar does not reflow when it decodes; CSS sizes it, these
                only supply the aspect ratio the browser reserves space with. */}
            <img
              src="/brand/huntloop-mark.png"
              alt=""
              width={1343}
              height={638}
              className="hl-mark h-7 w-[42px] shrink-0 object-contain"
            />
            <span className="flex min-w-0 flex-col items-start leading-[1.15]">
              <span className="max-w-full truncate text-[16px] font-semibold tracking-[-0.02em] text-fg">
                {chrome.orgName}
              </span>
              {chrome.planLabel && (
                <span className="max-w-full truncate text-[11px] text-fg-muted">
                  {chrome.planLabel}
                </span>
              )}
            </span>
            <ChevronsUpDown
              aria-hidden
              className="ml-0.5 size-3.5 shrink-0 text-fg-faint"
              strokeWidth={1.8}
            />
          </Link>
        }
        onMenuClick={() => setNavOpen(true)}
        /*
          Opens the jump-to palette the Sidebar builds and binds ⌘K for.
          This was once `() => {}` — a search field for a shortcut nothing
          bound (audit UX-02) — which is why TopBar omits the control
          entirely when no handler is passed.
        */
        onSearchClick={() => setJumpOpen(true)}
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
        /* The signed-in person when there is one; the workspace otherwise
           (demo mode). It was the URL slug — "AC" for /acme — which named
           neither. */
        avatar={
          <Avatar
            initials={chrome.account?.name ?? chrome.orgName}
            className="size-9 text-[12px]"
          />
        }
        /* Sign-out used to live here as well. It belongs with the
             account it signs out of, which is now a real row at the foot of
             the sidebar with its own menu — and two sign-out controls on one
             screen is one more than any screen needs. */
        /* Below sm the bar cannot fit the toggle beside the workspace name
           and search; it moves into the drawer's footer instead (below). */
        actions={<ThemeToggle className="max-sm:hidden" />}
      />

      <div className="relative flex min-h-0 flex-1">
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
            "lg:shrink-0",
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
              [...pinned, ...groups.flatMap((g) => g.items), ...footerItems]
                .map((i) => i.href)
                .filter(
                  (href) =>
                    pathname === href || pathname.startsWith(`${href}/`),
                )
                .sort((a, b) => b.length - a.length)[0] ?? ""
            }
            // The rail is only collapsible where it is in flow; inside the
            // drawer the control would fight the drawer's own dismissal.
            collapsed={collapsed}
            pinned={pinned}
            footerItems={footerItems}
            jumpTo={jumpTo}
            className="h-full"
            quota={
              /* Omitted, not zeroed, when the plan is unlimited or unknown —
               a meter with no maximum is a bar that can only be empty. */
              chrome.quota && (
                <SidebarQuota
                  label={chrome.quota.label}
                  used={chrome.quota.used}
                  limit={chrome.quota.limit}
                  collapsed={collapsed}
                />
              )
            }
            footerAction={
              <>
                {/* The rail is only collapsible where it is in flow; inside
                    the drawer the control would fight the drawer's own
                    dismissal. */}
                <SidebarCollapseButton
                  collapsed={collapsed}
                  onToggle={() => setCollapsed((c) => !c)}
                  className="max-lg:hidden"
                />
                {/* The phone's theme control — the top bar drops its own
                    below sm. */}
                <ThemeToggle className="sm:hidden" />
              </>
            }
            account={
              /* Demo mode: there is no signed-in person, so the row that
               would name one is not rendered at all. */
              chrome.account && (
                <SidebarAccount
                  collapsed={collapsed}
                  avatar={
                    <Avatar
                      initials={chrome.account.name}
                      className={collapsed ? "size-8" : "size-[30px]"}
                    />
                  }
                  name={chrome.account.name}
                  secondary={chrome.account.email}
                  action={
                    <Menu
                      align="start"
                      side="top"
                      linkComponent={Link}
                      items={[
                        {
                          label: "Workspace settings",
                          href: `/${org}/settings`,
                        },
                        { label: "Switch workspace", href: "/orgs" },
                        {
                          label: "Sign out",
                          icon: LogOut,
                          tone: "danger",
                          separated: true,
                          /* `requestSubmit` on the real form below rather
                           than a fetch: sign-out changes state, so it
                           has to be a POST, and submitting the form the
                           browser already knows about keeps that true
                           without this component learning how the
                           endpoint works. */
                          onSelect: () => signOutForm.current?.requestSubmit(),
                        },
                      ]}
                      trigger={(props) => (
                        <button
                          type="button"
                          {...props}
                          aria-label="Account menu"
                          className="hl-focusable flex size-7 shrink-0 items-center justify-center rounded-[8px] text-fg-muted transition-colors duration-[120ms] hover:bg-nav-hover hover:text-fg"
                        >
                          <MoreHorizontal
                            className="size-[15px]"
                            strokeWidth={1.6}
                          />
                        </button>
                      )}
                    />
                  }
                />
              )
            }
          />
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/*
          `tabIndex={-1}` is what makes the skip link actually skip. Without
          it, following `#main` moves the scroll position but leaves focus
          where it was, so the next Tab returns to the second nav item and the
          user is back in the sidebar they just escaped.
        */}
          <main
            id="main"
            tabIndex={-1}
            className="relative min-h-0 min-w-0 flex-1 overflow-y-auto"
          >
            {children}
          </main>

          {/*
          A real form POST rather than a link: sign-out changes state, and a
          GET that any page could trigger is a CSRF. See
          app/auth/signout/route.ts.

          Rendered here rather than inside the menu that submits it: the menu
          unmounts on select, and a form that unmounts in the same tick as
          its own submit does not submit.
        */}
          <form
            ref={signOutForm}
            action="/auth/signout"
            method="post"
            className="hidden"
          >
            <button type="submit" tabIndex={-1}>
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
