"use client";

import type { ReactNode } from "react";
import { ChevronDown, HelpCircle, Search } from "lucide-react";
import { cn } from "../utils/cn";
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
  searchShortcut = "⌘K",
  feedbackHref,
  helpHref,
  avatar,
  actions,
  className,
}: TopBarProps) {
  return (
    <header
      className={cn(
        "flex h-12 items-center justify-between gap-4 border-b border-line-subtle bg-panel px-3",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-1">
        {logo && <div className="mr-1 flex shrink-0 items-center">{logo}</div>}

        {breadcrumbs.map((crumb, i) => (
          <div key={i} className="flex items-center gap-1">
            {i > 0 && <span className="mx-0.5 text-fg-muted select-none">/</span>}
            <button
              type="button"
              onClick={crumb.onClick}
              className="hl-focusable flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] text-fg transition-colors duration-[120ms] hover:bg-surface-hover"
            >
              <span className="max-w-[160px] truncate">{crumb.label}</span>
              {crumb.badge && (
                <Badge variant={crumb.badge.variant ?? "neutral"} size="sm">
                  {crumb.badge.label}
                </Badge>
              )}
              <ChevronDown className="size-3.5 shrink-0 text-fg-muted" strokeWidth={1.75} />
            </button>
          </div>
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {onSearchClick && (
          <button
            type="button"
            onClick={onSearchClick}
            className="hl-focusable flex h-8 w-56 items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-[13px] text-fg-muted transition-colors duration-[120ms] hover:border-line-strong"
          >
            <Search className="size-3.5 shrink-0" strokeWidth={1.75} />
            <span className="flex-1 text-left">Search…</span>
            {searchShortcut && (
              <span className="font-mono text-[11px] text-fg-muted">{searchShortcut}</span>
            )}
          </button>
        )}

        {feedbackHref && (
          <a
            href={feedbackHref}
            className="hl-focusable hidden h-8 items-center rounded-md px-2.5 text-[13px] text-fg-secondary transition-colors duration-[120ms] hover:bg-surface-hover hover:text-fg sm:inline-flex"
          >
            Feedback
          </a>
        )}

        {helpHref && (
          <a
            href={helpHref}
            aria-label="Help"
            className="hl-focusable flex size-8 items-center justify-center rounded-md text-fg-secondary transition-colors duration-[120ms] hover:bg-surface-hover hover:text-fg"
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
      {initials.slice(0, 2).toUpperCase()}
    </div>
  );
}
