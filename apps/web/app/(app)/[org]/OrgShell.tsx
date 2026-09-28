"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BrandMark,
  Sidebar,
  SidebarCollapseButton,
  SidebarQuota,
  TopBar,
  type NavSection,
} from "@huntloop/ui";
import type { ShellChrome } from "../../../lib/data/chrome";
import { AccountMenu } from "./AccountMenu";
import {
  Activity,
  BarChart3,
  Brain,
  Building,
  Building2,
  ChevronsUpDown,
  Crosshair,
  Flame,
  Gauge,
  Globe,
  GraduationCap,
  House,
  Inbox as InboxIcon,
  KanbanSquare,
  Lightbulb,
  MessagesSquare,
  Package,
  Plug,
  Radar,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  Upload,
  UserCheck,
  Users,
  Zap,
} from "lucide-react";

const PANEL_KEY = "hl:sidebar-panel";

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
  /** Section panel hidden — desktop only, where the sidebar is in flow.
      Remembered per browser: it is a preference about this screen, not
      state anyone else needs. Read after mount so the server render and
      the first client render agree. */
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(PANEL_KEY) === "hidden") setCollapsed(true);
    } catch {
      /* Storage blocked — the panel simply starts open. */
    }
  }, []);
  const togglePanel = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(PANEL_KEY, next ? "hidden" : "shown");
    } catch {
      /* Not remembered; still toggled. */
    }
  };
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
   * Two levels, as sections: the rail carries the stages of the loop, the
   * panel beside it the pages of whichever stage you are in.
   *
   * Home comes first and on its own. It is the one destination that is not a
   * stage of the loop — it is the view *of* the loop — and as a single-item
   * section it has no panel, so the Command Center gets the full width.
   */
  const sections: NavSection[] = [
    {
      id: "home",
      label: "Home",
      icon: House,
      items: [{ label: "Command Center", href: `/${org}/dashboard`, icon: Zap }],
    },
    {
      id: "hunt",
      label: "Hunt",
      description: "Find and qualify the accounts worth pursuing.",
      icon: Crosshair,
      items: [
        { label: "Opportunities", href: `/${org}/opportunities`, icon: Flame },
        { label: "Companies", href: `/${org}/companies`, icon: Building2 },
        { label: "Analyze a URL", href: `/${org}/analyze`, icon: Globe },
        { label: "Imports", href: `/${org}/imports`, icon: Upload },
      ],
    },
    {
      id: "engage",
      label: "Engage",
      description: "Reach out, follow up and move deals forward.",
      icon: MessagesSquare,
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
      id: "learn",
      label: "Learn",
      description: "What the loop is teaching you.",
      icon: Sparkles,
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
      id: "company",
      label: "Company",
      description: "What you sell, and who you sell it to.",
      icon: Building2,
      items: [
        { label: "Product", href: `/${org}/settings/product`, icon: Package },
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
      id: "team",
      label: "Team",
      description: "Who is in this workspace, and who owns what.",
      icon: Users,
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
      id: "operate",
      label: "Operate",
      icon: Activity,
      items: [
        /* `JOB-01`. It answers "why has nothing happened", which is a
           question asked occasionally and urgently, not a workflow of its
           own — so a single page, and no panel. */
        { label: "Engine", href: `/${org}/ops`, icon: Activity },
      ],
    },
  ];

  /* Settings sits at the foot of the rail rather than among the stages: it
     is where you go to change the loop, not a stage of it. Its panel
     replaces the tab row the settings pages used to carry, so Product and
     ICP appear here and under Company — the Sidebar keeps whichever section
     you came from lit. */
  const footerSections: NavSection[] = [
    {
      id: "settings",
      label: "Settings",
      description: "How this workspace is set up.",
      icon: Settings,
      items: [
        { label: "General", href: `/${org}/settings`, icon: Building },
        { label: "Product", href: `/${org}/settings/product`, icon: Package },
        { label: "ICP", href: `/${org}/settings/icp`, icon: Target },
        { label: "Scoring", href: `/${org}/settings/scoring`, icon: Gauge },
        { label: "Integrations", href: `/${org}/settings/integrations`, icon: Plug },
        { label: "Data & privacy", href: `/${org}/settings/privacy`, icon: ShieldCheck },
      ],
    },
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
    }),
    [router, jumpOpen],
  );

  /* Longest matching prefix, so a detail route (/opportunities/alphio-ai)
     still lights up its page, while /settings/icp does not also light up
     /settings. An exact match alone would leave detail pages unlit. */
  const activeHref =
    [...sections, ...footerSections]
      .flatMap((s) => s.items.map((i) => i.href))
      .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
      .sort((a, b) => b.length - a.length)[0] ?? "";

  /* The drawer closes once a page is chosen: below lg it covers the page. */
  const [drawnAt, setDrawnAt] = useState(pathname);
  if (pathname !== drawnAt) {
    setDrawnAt(pathname);
    setNavOpen(false);
  }

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
            <BrandMark className="size-7 text-fg" />
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
            Was `"#"` — a Feedback link that looked live and went nowhere
            (audit ANL-03). `TopBar` omits it while the variable is unset, so
            it appears when a destination exists. Help used to sit beside it
            under the same rule; it now lives in the account menu, with the
            theme choice, rather than as two more icons in the bar.
          */
        feedbackHref={process.env.NEXT_PUBLIC_FEEDBACK_URL}
        /* The account menu: identity, workspace, theme, shortcuts, help and
           sign-out in one place, at every width — which is why the bar no
           longer carries a theme toggle, and the sidebar no longer carries
           an account row with a second, smaller copy of this menu. */
        avatar={
          <AccountMenu
            org={org}
            chrome={chrome}
            onSignOut={() => signOutForm.current?.requestSubmit()}
          />
        }
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
            sections={sections}
            footerSections={footerSections}
            /* The app-side half of the framework-agnostic `<a>` in packages/ui.
             Without it every item reloaded the whole document — the single
             largest user-perceived performance cost in the app (audit
             PERF-01). */
            linkComponent={Link}
            activeHref={activeHref}
            /* Inside the drawer the panel is always open — hiding it there
               would leave a rail of captions and nowhere to go — and a rail
               tap chooses a section rather than navigating away from it. */
            panelOpen={navOpen || !collapsed}
            railSelects={navOpen}
            jumpTo={jumpTo}
            className="h-full"
            panelFooter={
              /* Omitted, not zeroed, when the plan is unlimited or unknown —
               a meter with no maximum is a bar that can only be empty. */
              chrome.quota && (
                <SidebarQuota
                  label={chrome.quota.label}
                  used={chrome.quota.used}
                  limit={chrome.quota.limit}
                />
              )
            }
            railFooter={
              /* Only where the sidebar is in flow; inside the drawer the
                 control would fight the drawer's own dismissal. */
              <SidebarCollapseButton
                collapsed={collapsed}
                onToggle={togglePanel}
                className="max-lg:hidden"
              />
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
