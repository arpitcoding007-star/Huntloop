"use client";

import type { ReactNode } from "react";
import { ChevronDown, HelpCircle, Menu, Search } from "lucide-react";
import { cn } from "../utils/cn";
import { useShortcutLabel } from "../utils/shortcut";
import { Badge, type BadgeVariant } from "./Badge";

export interface BreadcrumbSwitcher {
  label: string;
  badge?: { label: string; variant?: BadgeVariant };
  onClick?: () => void;
}

export interface TopBarProps {
  logo?: ReactNode;
  /** Org → workspace → campaign chain, each rendered as a chevron combobox. */
  breadcrumbs: BreadcrumbSwitcher[];
  onSearchClick?: () => void;
  searchShortcut?: string;
  feedbackHref?: string;
  helpHref?: string;
  /** Rendered as-is — pass an <img> or initials avatar. */
  avatar?: ReactNode;
  /** Extra controls before the avatar, e.g. a "Connect" button. */
  actions?: ReactNode;
  /**
   * Opens the off-canvas nav. The hamburger renders below `lg` only — at
   * that width the Sidebar is a drawer, so this is the sole way to reach
   * navigation and must not be omitted by the app shell.
   */
  onMenuClick?: () => void;
  className?: string;
}

/**
 * Org / project / branch chain from Supabase's topbar, rendered generically
 * as a breadcrumb of switchers (plan §1.4 #11). Each switcher is a plain
 * button — wire the actual dropdown menu at the call site.
 */
export function TopBar({
  logo,
  breadcrumbs,
  onSearchClick,
  searchShortcut,
  feedbackHref,
  helpHref,
  avatar,
  actions,
  onMenuClick,
  className,
}: TopBarProps) {
  const platformShortcut = useShortcutLabel();
  const shortcut = searchShortcut ?? platformShortcut;
  return (
    /* The reference's full-width bar: brand at the left over the sidebar
       column, search centred over the content, controls at the right. The
       left block is the sidebar's width at lg, so the search field starts
       where the page does. */
    <header
      className={cn(
        "flex h-16 shrink-0 items-center gap-4 border-b border-line-subtle bg-toolbar px-4",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-1 lg:w-[240px] lg:shrink-0">
        {onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            aria-label="Open navigation"
            className="hl-focusable -ml-1 flex size-8 shrink-0 items-center justify-center rounded-md text-fg-secondary transition-colors duration-[120ms] hover:bg-toolbar-hover hover:text-fg lg:hidden"
          >
            <Menu className="size-4" strokeWidth={1.75} />
          </button>
        )}

        {logo && <div className="mr-1 flex min-w-0 items-center">{logo}</div>}

        {breadcrumbs.map((crumb, i) => (
          <div
            key={i}
            /* Only the last crumb survives on a phone — the full chain cannot
               fit beside the search and avatar controls at 375px. */
            className={cn(
              "min-w-0 items-center gap-1",
              i < breadcrumbs.length - 1 ? "hidden md:flex" : "flex",
            )}
          >
            {i > 0 && <span className="mx-0.5 hidden text-fg-muted select-none md:inline">/</span>}
            {/*
              The chevron goes with the handler (audit UX-12).

              A ChevronDown is the universal promise of a menu, and both crumbs
              rendered one with `onClick` undefined — a focusable control that
              announced as a button, showed a dropdown affordance, and did
              nothing. Without a handler this is now plain text: no button, no
              focus ring, no chevron. Same rule as the `unbuilt` nav flag and
              the topbar's own Feedback and Help links.
            */}
            {crumb.onClick ? (
              <button
                type="button"
                onClick={crumb.onClick}
                className="hl-focusable flex h-8 min-w-0 items-center gap-1.5 rounded-md px-2 text-[13px] text-fg transition-colors duration-[120ms] hover:bg-toolbar-hover"
              >
                <span className="max-w-[160px] truncate">{crumb.label}</span>
                {crumb.badge && (
                  <Badge variant={crumb.badge.variant ?? "neutral"} size="sm">
                    {crumb.badge.label}
                  </Badge>
                )}
                <ChevronDown className="size-3.5 shrink-0 text-fg-muted" strokeWidth={1.75} />
              </button>
            ) : (
              <span className="flex h-8 min-w-0 items-center gap-1.5 px-2 text-[13px] text-fg">
                <span className="max-w-[160px] truncate">{crumb.label}</span>
                {crumb.badge && (
                  <Badge variant={crumb.badge.variant ?? "neutral"} size="sm">
                    {crumb.badge.label}
                  </Badge>
                )}
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="flex min-w-0 flex-1 justify-end md:justify-center">
        {onSearchClick && (
          <button
            type="button"
            onClick={onSearchClick}
            aria-label="Search or jump to"
            /* Collapses to a 36px icon button below md; the labelled field
               cannot share a phone's width with the brand and controls. */
            className="hl-focusable flex size-9 shrink-0 items-center justify-center gap-2.5 rounded-[10px] border border-transparent bg-toolbar-well text-[14px] text-fg-muted transition-colors duration-[120ms] ease-out-hl hover:border-line hover:bg-toolbar-hover hover:text-fg-secondary md:w-full md:max-w-[660px] md:justify-start md:px-3.5"
          >
            <Search className="size-4 shrink-0 text-fg" strokeWidth={1.75} />
            <span className="hidden flex-1 truncate text-left md:inline">Search or jump to…</span>
            {shortcut && (
              <kbd className="hidden shrink-0 rounded-[6px] bg-canvas px-1.5 py-0.5 font-mono text-[11px] font-normal text-fg-muted md:inline">
                {shortcut}
              </kbd>
            )}
          </button>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">

        {feedbackHref && (
          <a
            href={feedbackHref}
            className="hl-focusable hidden h-8 items-center rounded-md px-2.5 text-[13px] text-fg-secondary transition-colors duration-[120ms] hover:bg-toolbar-hover hover:text-fg sm:inline-flex"
          >
            Feedback
          </a>
        )}

        {helpHref && (
          <a
            href={helpHref}
            aria-label="Help"
            className="hl-focusable flex size-8 items-center justify-center rounded-md text-fg-secondary transition-colors duration-[120ms] hover:bg-toolbar-hover hover:text-fg"
          >
            <HelpCircle className="size-4" strokeWidth={1.75} />
          </a>
        )}

        {actions}

        {avatar && <div className="ml-1 flex shrink-0 items-center">{avatar}</div>}
      </div>
    </header>
  );
}

/** "Dana Whitfield" → "DW", "dana@acme.com" → "DA", "Demo workspace" → "DW". */
function toInitials(name: string): string {
  const words = name.split(/[\s@._-]+/).filter(Boolean);
  const letters =
    words.length >= 2 && !name.includes("@")
      ? words[0]![0]! + words[1]![0]!
      : name.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2);
  return letters.toUpperCase();
}

export function Avatar({
  initials,
  className,
}: {
  initials: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex size-7 items-center justify-center rounded-full bg-ai-surface text-[11px] font-semibold text-ai-text",
        className,
      )}
    >
      {toInitials(initials)}
    </div>
  );
}
