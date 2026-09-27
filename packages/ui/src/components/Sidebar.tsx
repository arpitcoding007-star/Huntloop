"use client";

import {
  useCallback,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { cn } from "../utils/cn";
import { Anchor, type LinkComponent } from "../utils/link";
import { Badge, type BadgeVariant } from "./Badge";

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
 * Blue rather than the brand green: green already means "source-verified
 * fact / system state" everywhere else in this system (see tokens.css), and
 * a green "2" beside Inbox would read as a status rather than as a summons.
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
   * The search affordance. A full-width field when expanded, a single icon
   * button in the rail. Omitted entirely when absent — the same rule TopBar
   * follows, and the reason this is a prop rather than always-on: a search
   * box for a palette that does not exist teaches a habit and then breaks it.
   */
  search?: {
    label: string;
    /** e.g. "⌘K". Display only. */
    shortcut?: string;
    onClick: () => void;
  };
  header?: ReactNode;
  footer?: ReactNode;
  /**
   * Router-aware link component, e.g. `next/link`. Defaults to a plain `<a>`.
   * See utils/link.ts — this is the seam that keeps the package
   * framework-agnostic without leaving the app on full page reloads.
   */
  linkComponent?: LinkComponent;
  className?: string;
}

const EXPANDED_W = "w-[264px]";
const RAIL_W = "w-[72px]";

/**
 * The primary nav.
 *
 * ── The shape ───────────────────────────────────────────────────────────
 *
 * A floating panel rather than a column welded to the window edge: one
 * hairline border all the way round, radius `xl`, sitting on the canvas with
 * a gutter. It is the single change that does most to make the app read as
 * composed rather than as a frame with regions in it, and it is why the
 * sidebar and the content area no longer share a border.
 *
 * ── Quiet by default ────────────────────────────────────────────────────
 *
 * Seventeen destinations is a lot to put on one surface, so the row at rest
 * spends almost nothing: 13.5px label, 16px icon at 1.6 stroke, secondary
 * grey. Exactly two things are allowed to be louder — where you are (a
 * raised chip, one step up the surface ramp, with a contact shadow) and what
 * needs you (a blue count). Everything else, including every merely
 * informational number, stays grey.
 *
 * That is a deliberate reversal of what was here before, which painted the
 * active item in brand green. Green is the product's "verified fact" colour;
 * spending it on "you are on this page" both weakened the signal and said
 * something untrue.
 */
export function Sidebar({
  groups,
  activeHref,
  collapsed = false,
  pinned,
  search,
  header,
  footer,
  linkComponent: Link = Anchor,
  className,
}: SidebarProps) {
  const tip = useTooltip(collapsed);

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

  return (
    <>
      <nav
        aria-label="Primary"
        className={cn(
          "flex h-full flex-col overflow-hidden rounded-xl border border-line-subtle bg-panel",
          "shadow-raised transition-[width] duration-[180ms] ease-out-hl motion-reduce:transition-none",
          collapsed ? RAIL_W : EXPANDED_W,
          className,
        )}
      >
        {header && (
          <div className={cn("px-3 pt-3", collapsed && "flex justify-center px-0")}>
            {header}
          </div>
        )}

        {search && (
          <div className={cn("px-3 pt-3", collapsed && "flex justify-center px-0")}>
            <SearchControl {...search} collapsed={collapsed} tip={tip} />
          </div>
        )}

        {/* `overscroll-contain` so flicking past the end of a long nav does
            not start scrolling the page behind it. */}
        <div className="flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-3 py-3">
          {pinned && pinned.length > 0 && (
            <ul className="mb-1 flex flex-col gap-0.5">{pinned.map(renderItem)}</ul>
          )}

          {groups.map((group) => (
            <div key={group.label}>
              {collapsed ? (
                /* In the rail the group label has nowhere to go, so the
                   grouping is carried by a rule instead. Presentational —
                   the groups are still announced by the labels below. */
                <hr
                  aria-hidden
                  className="mx-auto my-2 w-6 border-0 border-t border-line-subtle"
                />
              ) : (
                <div className="hl-label px-2.5 pt-4 pb-1.5 first:pt-1">
                  {group.label}
                </div>
              )}
              <ul className="flex flex-col gap-0.5">{group.items.map(renderItem)}</ul>
            </div>
          ))}
        </div>

        {footer && (
          <div className={cn("border-t border-line-subtle p-3", collapsed && "px-2")}>
            {footer}
          </div>
        )}
      </nav>

      {tip.node}
    </>
  );
}

/* ── Row ─────────────────────────────────────────────────────────────────
   One component for links, pinned items and unbuilt labels, so the three
   cannot drift apart. The geometry is the reference spec: 30px tall, radius
   `md`, 16px icon at 1.6 stroke, 13.5px label. */

const ROW =
  "relative flex h-[30px] items-center gap-2.5 rounded-md px-2.5 text-[13.5px] " +
  "transition-[background-color,color,box-shadow,border-color] duration-[120ms] ease-out-hl";

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

  /* The trailing slot, in priority order. A row shows one of these, never
     two — "Soon", a tag, a count, a shortcut hint and a presence dot all
     compete for the same 40px, and a row carrying three of them is how a
     nav stops being scannable. */
  const trailing = item.unbuilt ? (
    <span className="shrink-0 text-[10px] tracking-label text-fg-muted uppercase">
      Soon
    </span>
  ) : item.badge ? (
    <Badge variant={item.badge.variant ?? "ai"} size="sm">
      {item.badge.label}
    </Badge>
  ) : typeof item.count === "number" && item.count > 0 ? (
    <CountPill value={item.count} tone={item.countTone ?? "muted"} />
  ) : item.hint ? (
    <kbd className="shrink-0 font-mono text-[11px] font-normal text-fg-muted">
      {item.hint}
    </kbd>
  ) : item.dot ? (
    <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-attention" />
  ) : null;

  const inner = (
    <>
      <Icon className="size-4 shrink-0" strokeWidth={1.6} />
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {trailing}
        </>
      )}
      {/* In the rail there is no label, so an attention count has to survive
          as a mark on the icon itself — otherwise collapsing the sidebar
          silently hides every "something is waiting for you" in the app. */}
      {collapsed &&
        !item.unbuilt &&
        ((typeof item.count === "number" && item.count > 0 && item.countTone === "attention") ||
          item.dot) && (
          <span
            aria-hidden
            className="absolute top-1 right-1.5 size-1.5 rounded-full bg-attention ring-2 ring-panel"
          />
        )}
    </>
  );

  const shared = cn(ROW, collapsed && "h-9 justify-center gap-0 px-0");

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
            ? /* One step up the surface ramp, plus a hairline and a contact
                 shadow: the same "raised chip" the rest of the system uses
                 for the thing in front. It reads in both themes without
                 spending a hue on it. */
              "border border-line-subtle bg-surface font-medium text-fg shadow-raised"
            : /* The inactive row carries a transparent border of the same
                 width, so becoming active does not shift the label by 1px. */
              "border border-transparent text-fg-secondary hover:bg-surface-hover hover:text-fg",
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
    return (
      <span className="hl-tabular shrink-0 text-[12px] text-fg-muted">{value}</span>
    );
  }
  return (
    <span className="hl-tabular flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-attention px-1.5 text-[11px] font-semibold text-attention-ink">
      {value}
    </span>
  );
}

/* ── Search ──────────────────────────────────────────────────────────────
   A recessed well when expanded (canvas sits *below* panel on the ramp, so
   painting the field with it reads as something you type into rather than
   something that sits on top), a plain icon button in the rail. */

function SearchControl({
  label,
  shortcut,
  onClick,
  collapsed,
  tip,
}: NonNullable<SidebarProps["search"]> & { collapsed: boolean; tip: Tooltip }) {
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="hl-focusable flex size-9 items-center justify-center rounded-md text-fg-secondary transition-colors duration-[120ms] hover:bg-surface-hover hover:text-fg"
        {...tip.bind(label)}
      >
        <Search className="size-4" strokeWidth={1.6} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="hl-focusable flex h-9 w-full items-center gap-2 rounded-md border border-line-subtle bg-canvas px-2.5 text-left text-[13px] text-fg-muted transition-colors duration-[120ms] ease-out-hl hover:border-line hover:text-fg-secondary"
    >
      <Search className="size-4 shrink-0" strokeWidth={1.6} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {shortcut && (
        <kbd className="shrink-0 rounded-xs border border-line-subtle bg-surface px-1.5 py-0.5 font-mono text-[10px] font-normal text-fg-muted">
          {shortcut}
        </kbd>
      )}
    </button>
  );
}

/* ── Footer pieces ───────────────────────────────────────────────────────
   Exported because the app composes the footer, but the shapes belong to
   the design system — a quota readout and an account row invented per-app
   are how two products that share a component library stop looking alike. */

/** The plan/usage readout above the account row. */
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
        className={cn("mx-auto h-1 w-8 overflow-hidden rounded-full bg-surface-active", className)}
      >
        <div className="h-full rounded-full bg-attention" style={{ width: `${pct}%` }} />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-md border border-line-subtle bg-surface px-2.5 py-2",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[12px] font-medium text-fg">{label}</span>
        <span className="hl-tabular shrink-0 text-[12px] text-fg-muted">{text}</span>
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
        className="mt-2 h-1 w-full overflow-hidden rounded-full bg-surface-active"
      >
        <div
          className="h-full rounded-full bg-attention transition-[width] duration-[280ms] ease-out-hl motion-reduce:transition-none"
          style={{ width: `${Math.max(pct, pct > 0 ? 4 : 0)}%` }}
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
      <div title={secondary ? `${name} · ${secondary}` : name} className={cn("flex justify-center", className)}>
        {avatar}
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-2.5 px-0.5", className)}>
      {avatar}
      <div className="min-w-0 flex-1">
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
        "hl-focusable flex size-7 shrink-0 items-center justify-center rounded-sm text-fg-muted",
        "transition-colors duration-[120ms] hover:bg-surface-hover hover:text-fg",
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
   own rect.

   It is decoration, not content: `aria-hidden`, with the accessible name
   still carried by the link text (visually hidden at this width is not the
   same as absent — the label element is simply not rendered, so the link's
   name comes from `title`). Pointer-events off, so it can never intercept
   the click it is describing. */

interface Tooltip {
  node: ReactNode;
  bind: (
    label: string | undefined,
    count?: number,
    tone?: CountTone,
  ) => Record<string, unknown>;
}

function useTooltip(enabled: boolean): Tooltip {
  const [state, setState] = useState<
    { text: string; note?: string; top: number; left: number } | null
  >(null);
  const frame = useRef<number | null>(null);

  const show = useCallback((el: HTMLElement, text: string, note?: string) => {
    const rect = el.getBoundingClientRect();
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() =>
      setState({ text, note, top: rect.top + rect.height / 2, left: rect.right + 12 }),
    );
  }, []);

  const hide = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    setState(null);
  }, []);

  const bind: Tooltip["bind"] = (label, count, tone) => {
    if (!enabled || !label) return {};
    const note =
      tone === "attention" && typeof count === "number" && count > 0
        ? `${count} new`
        : undefined;
    return {
      title: label,
      onPointerEnter: (e: { currentTarget: HTMLElement }) =>
        show(e.currentTarget, label, note),
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
        className="pointer-events-none fixed z-[70] -translate-y-1/2 rounded-md bg-band px-2.5 py-1.5 text-[12px] whitespace-nowrap text-band-fg shadow-popover"
      >
        {state.text}
        {state.note && <span className="ml-2 text-band-fg-muted">{state.note}</span>}
      </div>
    ) : null;

  return { node, bind };
}
