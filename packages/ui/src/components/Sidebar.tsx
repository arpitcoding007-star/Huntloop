"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { cn } from "../utils/cn";
import { Anchor, type LinkComponent } from "../utils/link";
import { useShortcutLabel } from "../utils/shortcut";
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
 *
 * Blue because blue is the one accent, and it is spent only on "act on
 * this" — see tokens.css.
 */
export type CountTone = "attention" | "muted";

export interface NavItem {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  /** e.g. AI / NEW / BETA — trailing tag from the reference nav. */
  badge?: { label: string; variant?: BadgeVariant };
  /** A number at the end of the row. See {@link CountTone}. */
  count?: number;
  /** Defaults to `muted`: a bare number claims nothing until it says so. */
  countTone?: CountTone;
  /**
   * Single-key shortcut hint, rendered as a dim glyph at the end of the row
   * (the reference nav shows `U` beside "Analyze a URL"). Display only —
   * binding the key is the caller's job, and a hint for a key nothing binds
   * is the same broken promise as a link onto a 404.
   */
  hint?: string;
  /** Bare presence dot with no number, e.g. "Command ●". */
  dot?: boolean;
  /**
   * The destination does not exist yet.
   *
   * Renders the item as a non-interactive label instead of a link. The nav is
   * a deliberate surface map — it shows the shape of the product while it is
   * being built — but an item that *looks* like a link and returns a 404 is
   * not a map, it is a broken app. This keeps the entry visible and stops it
   * lying about being reachable.
   */
  unbuilt?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export interface SidebarProps {
  groups: NavGroup[];
  activeHref: string;
  collapsed?: boolean;
  /**
   * Items shown above the first group, with no group label of their own —
   * the reference nav's "Command Center" row. Rendered with the same row
   * component as everything else, so the active treatment is identical.
   */
  pinned?: NavItem[];
  /**
   * "Search or jump to". When given, the sidebar renders the search row (an
   * icon button in the rail), binds ⌘K / Ctrl+K, and opens {@link JumpTo}
   * over every built destination in the nav. `onNavigate` performs the jump —
   * pass the router's `push`.
   *
   * Omitted entirely when absent, the same rule TopBar follows: a search box
   * for a palette that does not exist teaches a habit and then breaks it.
   */
  jumpTo?: {
    onNavigate: (href: string) => void;
    /**
     * Controlled mode, for a shell that opens the palette from somewhere
     * else too — the app's top-bar search field. The sidebar still owns the
     * ⌘K binding and the item list; it just reports instead of deciding.
     */
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    /** `false` hides the sidebar's own search row, when the shell has one. */
    trigger?: boolean;
  };
  /** The workspace switcher at the top. */
  header?: ReactNode;
  /** The 32px icon control at the right of the header. Hidden in the rail. */
  headerAction?: ReactNode;
  /** The plan readout at the top of the footer — see {@link SidebarQuota}. */
  quota?: ReactNode;
  /**
   * Rows pinned to the footer rather than to a group — the reference puts
   * Settings here, beside the collapse control. Same row component, so the
   * active treatment is identical.
   */
  footerItems?: NavItem[];
  /** Sits on the footer row beside `footerItems` — the collapse control. */
  footerAction?: ReactNode;
  /** The account row at the very bottom — see {@link SidebarAccount}. */
  account?: ReactNode;
  /**
   * Router-aware link component, e.g. `next/link`. Defaults to a plain `<a>`.
   * See utils/link.ts — this is the seam that keeps the package
   * framework-agnostic without leaving the app on full page reloads.
   */
  linkComponent?: LinkComponent;
  className?: string;
}

const EXPANDED_W = "w-[272px]";
const RAIL_W = "w-[72px]";

/**
 * The primary nav, in its three states: light expanded, the 72px rail, and
 * dark (the same markup; the tokens flip).
 *
 * ── The shape ───────────────────────────────────────────────────────────
 *
 * The reference screenshot's flat column: full height under the app's top
 * bar, one hairline on the right, a ground a step darker than the page.
 *
 * ── Quiet by default ────────────────────────────────────────────────────
 *
 * Seventeen destinations is a lot to put on one surface, so the row at rest
 * is plain ink with a muted icon. Exactly two things are allowed to be
 * louder — where you are (a blue tint with blue ink) and what needs you (a
 * blue count). Everything else, including every merely informational
 * number, stays grey.
 */
export function Sidebar({
  groups,
  activeHref,
  collapsed = false,
  pinned,
  jumpTo,
  header,
  headerAction,
  quota,
  footerItems,
  footerAction,
  account,
  linkComponent: Link = Anchor,
  className,
}: SidebarProps) {
  const tip = useTooltip(collapsed);
  const [ownJumpOpen, setOwnJumpOpen] = useState(false);
  const controlled = jumpTo?.open !== undefined;
  const jumpOpen = controlled ? !!jumpTo?.open : ownJumpOpen;
  const onOpenChange = jumpTo?.onOpenChange;
  const setJumpOpen = useCallback(
    (next: boolean) => (controlled ? onOpenChange?.(next) : setOwnJumpOpen(next)),
    [controlled, onOpenChange],
  );
  /* Read by the key handler, so toggling does not rebind it on every open. */
  const jumpOpenRef = useRef(jumpOpen);
  jumpOpenRef.current = jumpOpen;
  const shortcut = useShortcutLabel();
  const showTrigger = jumpTo?.trigger !== false;

  /* ⌘K / Ctrl+K toggles the palette from anywhere in the app. The row
     advertises the shortcut, so the shortcut has to work wherever the row
     is on screen — and is bound only while the palette exists. */
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

  const jumpItems: JumpToItem[] = [
    ...(pinned ?? []).map((item) => ({ item, group: undefined })),
    ...groups.flatMap((g) => g.items.map((item) => ({ item, group: g.label }))),
    ...(footerItems ?? []).map((item) => ({ item, group: undefined })),
  ]
    .filter(({ item }) => !item.unbuilt)
    .map(({ item, group }) => ({ label: item.label, href: item.href, icon: item.icon, group }));

  const renderItem = (item: NavItem) => (
    <SidebarRow
      key={item.href}
      item={item}
      active={item.href === activeHref && !item.unbuilt}
      collapsed={collapsed}
      Link={Link}
      tip={tip}
    />
  );

  const openJump = () => setJumpOpen(true);
  const rowList = cn("flex flex-col gap-0.5", collapsed && "items-center gap-0.5");

  return (
    <>
      <nav
        aria-label="Primary"
        className={cn(
          "flex h-full flex-col overflow-hidden border-r border-line-subtle bg-sidebar",
          "transition-[width] duration-[180ms] ease-out-hl motion-reduce:transition-none",
          collapsed ? RAIL_W : EXPANDED_W,
          className,
        )}
      >
        {collapsed ? (
          <div className="flex shrink-0 flex-col items-center gap-0.5 pt-3">
            {header && <div className="mb-3 flex justify-center">{header}</div>}
            {jumpTo && showTrigger && (
              <button
                type="button"
                onClick={openJump}
                aria-label="Search or jump to"
                className="hl-focusable flex size-10 items-center justify-center rounded-[10px] text-fg-muted transition-colors duration-[120ms] hover:bg-nav-hover hover:text-fg"
                {...tip.bind("Search or jump to")}
              >
                <Search className="size-[18px]" strokeWidth={1.6} />
              </button>
            )}
          </div>
        ) : (
          <>
            {(header || headerAction) && (
              <div className="flex h-[58px] shrink-0 items-center justify-between gap-2 pr-2.5 pl-3">
                <div className="min-w-0 flex-1">{header}</div>
                {headerAction}
              </div>
            )}
            {jumpTo && showTrigger && (
              <div className="shrink-0 px-3 pb-2.5">
                <button
                  type="button"
                  onClick={openJump}
                  className="hl-focusable flex h-[34px] w-full items-center gap-[9px] rounded-[9px] border border-line-subtle bg-sidebar-raised pr-2 pl-[11px] text-left text-[13px] text-fg-muted transition-colors duration-[120ms] ease-out-hl hover:border-line hover:text-fg-secondary"
                >
                  <Search aria-hidden className="size-[15px] shrink-0" strokeWidth={1.7} />
                  <span className="min-w-0 flex-1 truncate">Search or jump to</span>
                  <kbd className="shrink-0 rounded-[5px] border border-line-subtle bg-canvas px-[5px] py-px font-mono text-[10.5px] font-normal text-fg-muted">
                    {shortcut}
                  </kbd>
                </button>
              </div>
            )}
          </>
        )}

        {/* `overscroll-contain` so flicking past the end of a long nav does
            not start scrolling the page behind it. `relative` so this
            scroller is the containing block for any absolutely positioned
            descendant (an `sr-only` label, say) — otherwise it escapes the
            clip and lengthens the document. `min-h-0` lets it shrink below
            its content inside the column instead of pushing the footer out. */}
        <div
          className={cn(
            "relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain",
            collapsed
              ? "flex flex-col items-center pt-2 pb-2"
              : cn(
                  "px-3 pb-2",
                  /* Flush under a header or search row; given its own inset
                     when the nav is the first thing in the panel. */
                  header || headerAction || (jumpTo && showTrigger) ? "pt-1" : "pt-4",
                ),
          )}
        >
          {pinned && pinned.length > 0 && (
            <>
              {collapsed && <RailRule />}
              <ul className={rowList}>{pinned.map((i) => renderItem(i))}</ul>
            </>
          )}

          {groups.map((group) => (
            <div key={group.label} className={cn(collapsed && "flex flex-col items-center")}>
              {collapsed ? (
                /* In the rail the group label has nowhere to go, so the
                   grouping is carried by a rule instead. Presentational —
                   every link still carries its own name. */
                <RailRule />
              ) : (
                /* 10.5px eyebrow. The design sets it in --ink-4, which is
                   2.7:1 — `hl-label`'s muted grey is the next step up. */
                <div
                  className={cn(
                    /* `!` because `.hl-label` is unlayered CSS and outranks utilities. */
                    "hl-label mx-3 mt-5 mb-1.5 text-[11.5px]!",
                    !pinned?.length && "first:mt-1",
                  )}
                >
                  {group.label}
                </div>
              )}
              <ul className={rowList}>{group.items.map((i) => renderItem(i))}</ul>
            </div>
          ))}
        </div>

        {(quota || footerItems?.length || footerAction || account) && (
          <div
            className={cn(
              "flex shrink-0 flex-col gap-2",
              collapsed
                ? "items-center pt-2 pb-3"
                : "border-t border-line-subtle px-3 pt-2.5 pb-3",
            )}
          >
            {quota}
            {(footerItems?.length || footerAction) && (
              <div className={cn("flex items-center gap-1", collapsed && "flex-col gap-2")}>
                {footerItems?.length ? (
                  <ul className={cn("flex min-w-0 flex-1 flex-col", collapsed && "items-center")}>
                    {footerItems.map((i) => renderItem(i))}
                  </ul>
                ) : null}
                {footerAction}
              </div>
            )}
            {account}
          </div>
        )}
      </nav>

      {tip.node}

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

function RailRule() {
  return <span aria-hidden className="my-1.5 block h-px w-7 shrink-0 bg-line-subtle" />;
}

/* ── Row ─────────────────────────────────────────────────────────────────
   One component for links, pinned items and unbuilt labels, so the three
   cannot drift apart. The geometry is the reference screenshot: every row
   40px tall at radius 10, an 18px icon, a 14.5px label, and the active row
   a blue tint with blue ink. In the rail: a 40px square target.

   Any active ring is a box-shadow rather than a border, so becoming
   active cannot shift the label by a pixel. */

function SidebarRow({
  item,
  active,
  collapsed,
  Link,
  tip,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  Link: LinkComponent;
  tip: Tooltip;
}) {
  const Icon = item.icon;
  const count = typeof item.count === "number" && item.count > 0 ? item.count : 0;
  const attention = count > 0 && item.countTone === "attention";

  /* The trailing slot, in priority order. A row shows one of these, never
     two — "Soon", a tag, a count, a shortcut hint and a presence dot all
     compete for the same 40px, and a row carrying three of them is how a
     nav stops being scannable. */
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
          "shrink-0 transition-colors duration-[120ms]",
          "size-[18px]",
          active ? "text-brand-text" : "text-fg-muted group-hover:text-fg",
        )}
        strokeWidth={1.7}
      />
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {trailing}
        </>
      )}
      {/* In the rail there is no label, so "something is waiting" has to
          survive as a mark on the icon itself — a ringed count where there
          is a number, a dot where there is only presence. Otherwise
          collapsing the sidebar silently hides every summons in the app. */}
      {collapsed && !item.unbuilt && attention && (
        <span
          aria-hidden
          className="hl-tabular absolute top-[3px] right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-attention px-1 text-[10px] font-semibold text-attention-ink ring-2 ring-sidebar"
        >
          {count}
        </span>
      )}
      {collapsed && !item.unbuilt && !attention && item.dot && (
        <span
          aria-hidden
          className="absolute top-1.5 right-1.5 size-[7px] rounded-full bg-attention ring-2 ring-sidebar"
        />
      )}
    </>
  );

  const shared = cn(
    "group relative flex items-center rounded-[10px] text-[14.5px]",
    "transition-[background-color,color,box-shadow] duration-[120ms] ease-out-hl",
    collapsed
      ? "size-10 justify-center rounded-[10px]"
      : "h-10 gap-3 px-3",
  );

  if (item.unbuilt) {
    /* A span, not a disabled link: there is no destination to disable. Kept
       out of the tab order for the same reason — a keyboard user landing on
       it would have nowhere to go. `title` carries the explanation at every
       width, since the "Soon" marker is hidden while collapsed. */
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
            ? "bg-nav-active font-medium text-brand-text shadow-nav-active"
            : "text-fg hover:bg-nav-hover",
        )}
        {...tip.bind(collapsed ? item.label : undefined, item.count, item.countTone)}
      >
        {inner}
      </Link>
    </li>
  );
}

function CountPill({ value, tone }: { value: number; tone: CountTone }) {
  if (tone === "muted") {
    /* The design sets this numeral in --ink-4 (2.7:1); it is real text, so
       it reads one step up the ramp. */
    return <span className="hl-tabular shrink-0 text-[12px] text-fg-muted">{value}</span>;
  }
  return (
    <span className="hl-tabular flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[10px] bg-attention px-1.5 text-[11px] font-semibold text-attention-ink">
      {value}
    </span>
  );
}

/* ── Footer pieces ───────────────────────────────────────────────────────
   Exported because the app composes the footer, but the shapes belong to
   the design system — a quota readout and an account row invented per-app
   are how two products that share a component library stop looking alike. */

/** The plan/usage readout at the top of the footer. */
export function SidebarQuota({
  label,
  used,
  limit,
  collapsed,
  className,
}: {
  label: string;
  used: number;
  limit: number;
  collapsed?: boolean;
  className?: string;
}) {
  const pct = limit > 0 ? Math.min(100, Math.max(0, (used / limit) * 100)) : 0;
  const text = `${used.toLocaleString()} / ${limit.toLocaleString()}`;

  if (collapsed) {
    /* At 72px there is no room for the numbers, and a bare track with no
       scale is decoration. The title carries the whole fact instead. */
    return (
      <div
        title={`${label}: ${text}`}
        className={cn("mx-auto h-1 w-8 overflow-hidden rounded-[2px] bg-surface-active", className)}
      >
        <div
          className={cn("h-full rounded-[2px] bg-brand-vivid", used > 0 && "min-w-[3px]")}
          style={{ width: `${pct}%` }}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-[10px] border border-line-subtle bg-sidebar-raised px-3 py-2.5",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="truncate font-medium text-fg">{label}</span>
        <span className="hl-tabular shrink-0 text-fg-muted">{text}</span>
      </div>
      {/* `role="meter"` rather than `progressbar`: this is a level within a
          known range, not the progress of a task that completes. */}
      <div
        role="meter"
        aria-label={label}
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuetext={text}
        className="h-1 w-full overflow-hidden rounded-[2px] bg-surface-active"
      >
        {/* A 5px floor once anything is used, as in the design: 8 of 1,000
            is real usage, and a 0.8% bar is invisible. Zero stays empty. */}
        <div
          className={cn(
            "h-full rounded-[2px] bg-brand-vivid transition-[width] duration-[280ms] ease-out-hl motion-reduce:transition-none",
            used > 0 && "min-w-[5px]",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** The account row at the very bottom. */
export function SidebarAccount({
  avatar,
  name,
  secondary,
  action,
  collapsed,
  className,
}: {
  avatar: ReactNode;
  name: string;
  secondary?: string;
  /** The "…" overflow control. */
  action?: ReactNode;
  collapsed?: boolean;
  className?: string;
}) {
  if (collapsed) {
    return (
      <div
        title={secondary ? `${name} · ${secondary}` : name}
        className={cn("flex justify-center", className)}
      >
        {avatar}
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-2.5 rounded-[10px] p-1.5", className)}>
      {avatar}
      <div className="min-w-0 flex-1 leading-[1.25]">
        <div className="truncate text-[13px] font-medium text-fg">{name}</div>
        {secondary && (
          <div className="truncate font-mono text-[11px] text-fg-muted">{secondary}</div>
        )}
      </div>
      {action}
    </div>
  );
}

/** The rail toggle. Lives in the footer beside Settings, as in the reference. */
export function SidebarCollapseButton({
  collapsed,
  onToggle,
  className,
}: {
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      aria-expanded={!collapsed}
      className={cn(
        /* Muted rather than the design's --ink-4: this icon is the control's
           only label, so it is held to the 3:1 non-text floor. */
        "hl-focusable flex shrink-0 items-center justify-center text-fg-muted",
        "transition-colors duration-[120ms] hover:bg-nav-hover hover:text-fg",
        collapsed ? "size-10 rounded-[10px]" : "size-8 rounded-[8px]",
        className,
      )}
    >
      {collapsed ? (
        <PanelLeftOpen className="size-4" strokeWidth={1.6} />
      ) : (
        <PanelLeftClose className="size-4" strokeWidth={1.6} />
      )}
    </button>
  );
}

/* ── Rail tooltip ────────────────────────────────────────────────────────
   In the rail the label is gone, so hovering an icon has to say what it is.
   `title` alone is not enough — it waits a second, it is unstyled, and it
   never appears for a keyboard user at all.

   Why this needs JavaScript. The natural implementation is an absolutely
   positioned sibling inside the row, and it does not work here: the nav
   scrolls, `overflow-y: auto` computes `overflow-x` to `auto` as well, and
   the tooltip is clipped at the rail's 72px edge. So there is one fixed
   element outside the scroll container, positioned from the hovered row's
   own rect — 14px off its right edge, which is the design's `left: 54px`
   from a 40px target.

   It is decoration, not content: `aria-hidden`, with the accessible name
   still carried by the link text (visually hidden at this width is not the
   same as absent — the label element is simply not rendered, so the link's
   name comes from `title`). Pointer-events off, so it can never intercept
   the click it is describing. */

interface Tooltip {
  node: ReactNode;
  bind: (label: string | undefined, count?: number, tone?: CountTone) => Record<string, unknown>;
}

function useTooltip(enabled: boolean): Tooltip {
  const [state, setState] = useState<{
    text: string;
    note?: string;
    top: number;
    left: number;
  } | null>(null);
  const frame = useRef<number | null>(null);

  const show = useCallback((el: HTMLElement, text: string, note?: string) => {
    const rect = el.getBoundingClientRect();
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() =>
      setState({ text, note, top: rect.top + rect.height / 2, left: rect.right + 14 }),
    );
  }, []);

  const hide = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    setState(null);
  }, []);

  const bind: Tooltip["bind"] = (label, count, tone) => {
    if (!enabled || !label) return {};
    const note =
      tone === "attention" && typeof count === "number" && count > 0 ? `${count} new` : undefined;
    return {
      title: label,
      onPointerEnter: (e: { currentTarget: HTMLElement }) => show(e.currentTarget, label, note),
      onPointerLeave: hide,
      onFocus: (e: { currentTarget: HTMLElement }) => show(e.currentTarget, label, note),
      onBlur: hide,
    };
  };

  const node =
    enabled && state ? (
      <div
        aria-hidden
        style={{ top: state.top, left: state.left }}
        className="pointer-events-none fixed z-[70] flex -translate-y-1/2 items-center gap-2.5 rounded-[8px] bg-band px-2.5 py-[7px] text-[12.5px] font-medium whitespace-nowrap text-band-fg shadow-popover ring-1 ring-band-line"
      >
        {state.text}
        {state.note && (
          <span className="hl-tabular font-normal text-band-fg-secondary">{state.note}</span>
        )}
      </div>
    ) : null;

  return { node, bind };
}
