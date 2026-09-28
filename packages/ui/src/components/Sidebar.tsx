"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "../utils/cn";
import { Anchor, type LinkComponent } from "../utils/link";
import { Badge, type BadgeVariant } from "./Badge";
import { JumpTo, type JumpToItem } from "./JumpTo";

/**
 * How a trailing number on a nav row should read.
 *
 * The distinction is the whole reason the prop exists. "8 opportunities"
 * and "2 replies waiting for you" are not the same fact, and painting both
 * as a coloured pill trains the user to ignore the colour — which costs
 * exactly the one the second number needed.
 *
 *  · `attention` — something is waiting on the user. Solid blue pill.
 *  · `muted` — this is simply how many there are. Grey numeral, no pill.
 */
export type CountTone = "attention" | "muted";

type Icon = ComponentType<{ className?: string; strokeWidth?: number }>;

export interface NavItem {
  label: string;
  href: string;
  icon: Icon;
  /** e.g. AI / NEW / BETA — a trailing tag. */
  badge?: { label: string; variant?: BadgeVariant };
  /** A number at the end of the row. See {@link CountTone}. */
  count?: number;
  /** Defaults to `muted`: a bare number claims nothing until it says so. */
  countTone?: CountTone;
  /** Single-key shortcut hint. Display only — binding it is the caller's job. */
  hint?: string;
  /** Bare presence dot with no number. */
  dot?: boolean;
  /**
   * The destination does not exist yet.
   *
   * Renders the item as a non-interactive label instead of a link. The nav is
   * a deliberate surface map, but an item that *looks* like a link and
   * returns a 404 is not a map, it is a broken app.
   */
  unbuilt?: boolean;
}

/**
 * One entry in the primary rail, and the contents of the panel beside it.
 *
 * The rail entry links to the section's first built item, so a section is
 * never a dead click: choosing "Hunt" lands on Opportunities and opens the
 * Hunt panel in the same motion. A section with a single item has no panel —
 * a list of one is a heading, not navigation — and the page gets the width.
 */
export interface NavSection {
  /** Stable key. Also what the rail reports as selected. */
  id: string;
  /** The rail caption — one short word. */
  label: string;
  /** The panel's title, when it should say more than the caption. */
  title?: string;
  /** One line under the panel title. */
  description?: string;
  icon: Icon;
  items: NavItem[];
}

export interface SidebarProps {
  /** The rail, top to bottom. */
  sections: NavSection[];
  /** Pinned to the bottom of the rail — Settings. */
  footerSections?: NavSection[];
  /** The current route's nav href — see OrgShell for the prefix rule. */
  activeHref: string;
  /**
   * Whether the secondary panel is shown. The rail always is. Hiding the
   * panel is the "collapse": the page gains 240px and the rail still says
   * where you are.
   */
  panelOpen?: boolean;
  /**
   * Rail taps choose a section instead of navigating. For the mobile drawer,
   * where navigating would close the drawer before the user could pick the
   * page they wanted inside the section.
   */
  railSelects?: boolean;
  /**
   * "Search or jump to". When given, the sidebar binds ⌘K / Ctrl+K and opens
   * {@link JumpTo} over every built destination. Controlled when `open` is
   * passed — the app's top-bar search field opens the same palette.
   */
  jumpTo?: {
    onNavigate: (href: string) => void;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  };
  /** Pinned to the bottom of the panel — the plan meter. */
  panelFooter?: ReactNode;
  /** Pinned to the bottom of the rail, under the footer sections. */
  railFooter?: ReactNode;
  /**
   * Router-aware link component, e.g. `next/link`. Defaults to a plain `<a>`.
   * See utils/link.ts — this is the seam that keeps the package
   * framework-agnostic without leaving the app on full page reloads.
   */
  linkComponent?: LinkComponent;
  className?: string;
}

const firstHref = (s: NavSection) => s.items.find((i) => !i.unbuilt)?.href ?? null;
const hasPanel = (s: NavSection | undefined) => !!s && s.items.length > 1;

/**
 * Two-level navigation: a 76px rail of sections, and a 240px panel listing
 * the selected section's pages.
 *
 * ── Why two levels ──────────────────────────────────────────────────────
 *
 * Seventeen destinations in one column made every page start with a scroll
 * through the whole product. The rail holds the seven stages of the loop —
 * few enough to learn by position — and the panel holds only what belongs to
 * the stage you are in.
 *
 * ── Quiet by default ────────────────────────────────────────────────────
 *
 * Exactly two things are louder than ink: where you are (a tinted capsule
 * and brand ink) and what needs you (a blue count). Everything else stays
 * grey, so both still mean something.
 */
export function Sidebar({
  sections,
  footerSections = [],
  activeHref,
  panelOpen = true,
  railSelects = false,
  jumpTo,
  panelFooter,
  railFooter,
  linkComponent: Link = Anchor,
  className,
}: SidebarProps) {
  const all = [...sections, ...footerSections];

  /*
   * Which section owns the current page.
   *
   * A page can sit in two sections — ICP is both a Company page and a
   * Settings page — so the section the user came from wins while it still
   * contains the page. Otherwise the first section that does. Without the
   * sticky rule, choosing ICP under Settings would jump the rail to Company.
   *
   * A rail tap in `railSelects` mode previews a section without leaving the
   * page; it wins the tie too, since a page picked from a previewed panel was
   * picked *from* that section. Cleared when the route moves, so a preview
   * can never outlive the drawer it was made in.
   *
   * Derived during render (React's "adjust state on prop change" pattern)
   * rather than in effects, so the rail never paints one frame behind.
   */
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [stickyId, setStickyId] = useState<string | null>(null);
  const [seenHref, setSeenHref] = useState(activeHref);
  const owners = all.filter((s) => s.items.some((i) => i.href === activeHref));
  const routeSection =
    owners.find((s) => s.id === previewId) ?? owners.find((s) => s.id === stickyId) ?? owners[0];
  if (activeHref !== seenHref) {
    setSeenHref(activeHref);
    setPreviewId(null);
  }
  if (routeSection && routeSection.id !== stickyId) setStickyId(routeSection.id);
  const shown = all.find((s) => s.id === previewId) ?? routeSection;

  /* ── ⌘K ─────────────────────────────────────────────────────────────── */
  const [ownJumpOpen, setOwnJumpOpen] = useState(false);
  const controlled = jumpTo?.open !== undefined;
  const jumpOpen = controlled ? !!jumpTo?.open : ownJumpOpen;
  const onOpenChange = jumpTo?.onOpenChange;
  const setJumpOpen = useCallback(
    (next: boolean) => (controlled ? onOpenChange?.(next) : setOwnJumpOpen(next)),
    [controlled, onOpenChange],
  );
  const jumpOpenRef = useRef(jumpOpen);
  jumpOpenRef.current = jumpOpen;
  const hasJump = !!jumpTo;
  useEffect(() => {
    if (!hasJump) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.key.toLowerCase() !== "k") return;
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      e.preventDefault();
      setJumpOpen(!jumpOpenRef.current);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasJump, setJumpOpen]);

  /* Deduplicated by href: a page listed in two sections is one destination. */
  const seen = new Set<string>();
  const jumpItems: JumpToItem[] = all
    .flatMap((s) => s.items.map((item) => ({ item, group: s.title ?? s.label })))
    .filter(({ item }) => !item.unbuilt && !seen.has(item.href) && !!seen.add(item.href))
    .map(({ item, group }) => ({ label: item.label, href: item.href, icon: item.icon, group }));

  const renderRail = (s: NavSection) => {
    const href = firstHref(s);
    const selected = s.id === shown?.id;
    return (
      <RailItem
        key={s.id}
        section={s}
        href={href}
        selected={selected}
        current={s.id === routeSection?.id}
        Link={Link}
        onSelect={
          railSelects && hasPanel(s)
            ? (e) => {
                e.preventDefault();
                setPreviewId(s.id);
              }
            : undefined
        }
      />
    );
  };

  const panelVisible = panelOpen && hasPanel(shown);

  return (
    <>
      <nav aria-label="Primary" className={cn("flex h-full", className)}>
        {/* ── Rail ── */}
        <div className="flex h-full w-[76px] shrink-0 flex-col items-center border-r border-line-subtle bg-sidebar">
          <ul
            className="flex min-h-0 w-full flex-1 flex-col items-center gap-0.5 overflow-x-hidden overflow-y-auto overscroll-contain pt-2.5 pb-2"
            /* The rail scrolls only on very short windows, and a scrollbar
               would eat a third of its width when it does. */
            style={{ scrollbarWidth: "none" }}
          >
            {sections.map(renderRail)}
          </ul>
          {(footerSections.length > 0 || railFooter) && (
            <div className="flex w-full shrink-0 flex-col items-center gap-0.5 pt-1.5 pb-2.5">
              <span aria-hidden className="mb-1 block h-px w-8 bg-line-subtle" />
              {footerSections.length > 0 && (
                <ul className="flex w-full flex-col items-center gap-0.5">
                  {footerSections.map(renderRail)}
                </ul>
              )}
              {railFooter}
            </div>
          )}
        </div>

        {/* ── Panel ──
            Width animates so the page slides rather than jumps; the inner
            column keeps its width so text never reflows mid-transition. */}
        <div
          className={cn(
            "h-full shrink-0 overflow-hidden bg-sidebar",
            "transition-[width] duration-[220ms] ease-out-hl motion-reduce:transition-none",
            panelVisible ? "w-[240px] border-r border-line-subtle" : "w-0",
          )}
          aria-hidden={!panelVisible || undefined}
          inert={!panelVisible || undefined}
        >
          {shown && hasPanel(shown) && (
            <div className="flex h-full w-[240px] flex-col">
              <div className="shrink-0 px-5 pt-5 pb-3">
                <h2 className="truncate text-[19px] leading-[1.2] font-semibold tracking-[-0.022em] text-fg">
                  {shown.title ?? shown.label}
                </h2>
                {shown.description && (
                  <p className="mt-1 text-[12px] leading-[1.45] text-fg-muted">
                    {shown.description}
                  </p>
                )}
              </div>
              <ul
                aria-label={shown.title ?? shown.label}
                className="relative flex min-h-0 flex-1 flex-col gap-px overflow-y-auto overscroll-contain px-3 pb-3"
              >
                {shown.items.map((item) => (
                  <PanelRow
                    key={item.href}
                    item={item}
                    active={item.href === activeHref && !item.unbuilt}
                    Link={Link}
                  />
                ))}
              </ul>
              {panelFooter && <div className="shrink-0 px-3 pt-2 pb-3">{panelFooter}</div>}
            </div>
          )}
        </div>
      </nav>

      {jumpTo && (
        <JumpTo
          open={jumpOpen}
          onClose={() => setJumpOpen(false)}
          items={jumpItems}
          onNavigate={jumpTo.onNavigate}
        />
      )}
    </>
  );
}

/* ── Rail item ───────────────────────────────────────────────────────────
   An icon in a capsule with a caption beneath — the caption is what lets a
   76px rail be learned rather than hovered. The selected section fills the
   capsule; the label goes to full ink. A summons anywhere in the section
   survives as a dot on the icon, so it is visible from every other page. */

function RailItem({
  section,
  href,
  selected,
  current,
  Link,
  onSelect,
}: {
  section: NavSection;
  href: string | null;
  selected: boolean;
  current: boolean;
  Link: LinkComponent;
  onSelect?: (e: { preventDefault: () => void }) => void;
}) {
  const Icon = section.icon;
  const summons = section.items.some(
    (i) => !i.unbuilt && ((i.count ?? 0) > 0 && i.countTone === "attention"),
  );

  const body = (
    <>
      <span
        className={cn(
          "relative flex h-8 w-11 items-center justify-center rounded-[10px]",
          "transition-[background-color,color,transform] duration-[160ms] ease-out-hl",
          "group-active:scale-[0.94] motion-reduce:group-active:scale-100",
          selected
            ? "bg-nav-active text-brand-text"
            : "text-fg-muted group-hover:bg-nav-hover group-hover:text-fg",
        )}
      >
        <Icon className="size-[19px]" strokeWidth={selected ? 1.9 : 1.6} />
        {summons && (
          <span
            aria-hidden
            className="absolute top-1 right-2 size-[7px] rounded-full bg-attention ring-2 ring-sidebar"
          />
        )}
      </span>
      <span
        className={cn(
          "max-w-full truncate px-1 text-[10.5px] leading-none tracking-[-0.005em]",
          selected ? "font-semibold text-fg" : "font-medium text-fg-muted group-hover:text-fg",
        )}
      >
        {section.label}
      </span>
    </>
  );

  const shared = "group flex w-[68px] flex-col items-center gap-1 rounded-[12px] py-[5px]";

  if (!href) {
    return (
      <li>
        <span
          title={`${section.label} — not built yet`}
          aria-disabled="true"
          className={cn(shared, "cursor-default opacity-60")}
        >
          {body}
        </span>
      </li>
    );
  }

  return (
    <li>
      <Link
        href={href}
        aria-current={current ? "page" : undefined}
        title={section.title ?? section.label}
        className={cn(shared, "hl-focusable")}
        onClick={onSelect}
      >
        {body}
      </Link>
    </li>
  );
}

/* ── Panel row ───────────────────────────────────────────────────────────
   32px tall at radius 8, a 16px icon and a 13.5px label: the density of a
   Finder or Mail sidebar, which is the density of a list you scan rather
   than read. One component for links and unbuilt labels, so the two cannot
   drift apart. */

function PanelRow({
  item,
  active,
  Link,
}: {
  item: NavItem;
  active: boolean;
  Link: LinkComponent;
}) {
  const Icon = item.icon;
  const count = typeof item.count === "number" && item.count > 0 ? item.count : 0;

  /* One trailing mark, never two — a row carrying three is how a nav stops
     being scannable. */
  const trailing = item.unbuilt ? (
    <span className="shrink-0 text-[10px] tracking-[0.06em] text-fg-muted uppercase">Soon</span>
  ) : item.badge ? (
    <Badge variant={item.badge.variant ?? "ai"} size="sm">
      {item.badge.label}
    </Badge>
  ) : count ? (
    <CountPill value={count} tone={item.countTone ?? "muted"} />
  ) : item.hint ? (
    <kbd className="shrink-0 font-mono text-[10.5px] font-normal text-fg-muted">{item.hint}</kbd>
  ) : item.dot ? (
    <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-attention" />
  ) : null;

  const inner = (
    <>
      <Icon
        className={cn(
          "size-4 shrink-0 transition-colors duration-[120ms]",
          active ? "text-brand-text" : "text-fg-muted group-hover:text-fg",
        )}
        strokeWidth={active ? 1.9 : 1.7}
      />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {trailing}
    </>
  );

  const shared = cn(
    "group relative flex h-8 items-center gap-2.5 rounded-[8px] px-2.5 text-[13.5px] tracking-[-0.006em]",
    "transition-[background-color,color] duration-[120ms] ease-out-hl",
  );

  if (item.unbuilt) {
    /* A span, not a disabled link: there is no destination to disable. Out
       of the tab order for the same reason. `title` names it at every width. */
    return (
      <li>
        <span
          title={`${item.label} — not built yet`}
          aria-disabled="true"
          className={cn(shared, "cursor-default text-fg-muted/70")}
        >
          {inner}
        </span>
      </li>
    );
  }

  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          shared,
          "hl-focusable",
          active
            ? "bg-nav-active font-medium text-brand-text"
            : "text-fg-secondary hover:bg-nav-hover hover:text-fg",
        )}
      >
        {inner}
      </Link>
    </li>
  );
}

function CountPill({ value, tone }: { value: number; tone: CountTone }) {
  if (tone === "muted") {
    return <span className="hl-tabular shrink-0 text-[12px] text-fg-muted">{value}</span>;
  }
  return (
    <span className="hl-tabular flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-attention px-1.5 text-[10.5px] font-semibold text-attention-ink">
      {value}
    </span>
  );
}

/* ── Footer pieces ───────────────────────────────────────────────────────
   Exported because the app composes the footer, but the shapes belong to
   the design system. */

/** The plan/usage readout at the bottom of the panel. */
export function SidebarQuota({
  label,
  used,
  limit,
  className,
}: {
  label: string;
  used: number;
  limit: number;
  className?: string;
}) {
  const pct = limit > 0 ? Math.min(100, Math.max(0, (used / limit) * 100)) : 0;
  const text = `${used.toLocaleString()} / ${limit.toLocaleString()}`;

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-[12px] bg-sidebar-raised px-3 py-2.5 shadow-raised ring-1 ring-line-subtle",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="truncate font-medium text-fg">{label}</span>
        <span className="hl-tabular shrink-0 text-fg-muted">{text}</span>
      </div>
      {/* `role="meter"`: a level within a known range, not task progress. */}
      <div
        role="meter"
        aria-label={label}
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuetext={text}
        className="h-1 w-full overflow-hidden rounded-full bg-surface-active"
      >
        {/* A floor once anything is used: 8 of 1,000 is real usage, and a
            0.8% bar is invisible. Zero stays empty. */}
        <div
          className={cn(
            "h-full rounded-full bg-brand-vivid transition-[width] duration-[280ms] ease-out-hl motion-reduce:transition-none",
            used > 0 && "min-w-[5px]",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** Shows or hides the section panel. Lives at the foot of the rail. */
export function SidebarCollapseButton({
  collapsed,
  onToggle,
  className,
}: {
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const label = collapsed ? "Show sidebar" : "Hide sidebar";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      aria-expanded={!collapsed}
      className={cn(
        "hl-focusable flex h-8 w-11 shrink-0 items-center justify-center rounded-[10px] text-fg-muted",
        "transition-colors duration-[120ms] hover:bg-nav-hover hover:text-fg",
        className,
      )}
    >
      {collapsed ? (
        <PanelLeftOpen className="size-[17px]" strokeWidth={1.6} />
      ) : (
        <PanelLeftClose className="size-[17px]" strokeWidth={1.6} />
      )}
    </button>
  );
}
