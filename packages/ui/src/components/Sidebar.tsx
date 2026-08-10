"use client";

import type { ComponentType, ReactNode } from "react";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "../utils/cn";
import { Badge, type BadgeVariant } from "./Badge";

export interface NavItem {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  /** e.g. AI / NEW / BETA — trailing tag from the reference nav. */
  badge?: { label: string; variant?: BadgeVariant };
  /** Unread-style count, e.g. inbox "● 12". */
  count?: number;
  /** Bare presence dot with no number, e.g. "Command ●". */
  dot?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export interface SidebarProps {
  groups: NavGroup[];
  activeHref: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  header?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/**
 * Grouped nav — Kima's grouping (COMPANY / INTELLIGENCE / PIPELINE / REPORTS
 * / SETTINGS), Supabase's active-item treatment (filled surface + left bar,
 * not just a color change). Plain <a> tags so packages/ui stays framework-
 * agnostic; the app wraps hrefs with next/link routing where it matters.
 */
export function Sidebar({
  groups,
  activeHref,
  collapsed = false,
  onToggleCollapse,
  header,
  footer,
  className,
}: SidebarProps) {
  return (
    <nav
      aria-label="Primary"
      className={cn(
        "flex h-full flex-col border-r border-line-subtle bg-panel transition-[width] duration-[180ms]",
        collapsed ? "w-14" : "w-60",
        className,
      )}
    >
      {header && (
        <div
          className={cn(
            "flex items-center border-b border-line-subtle px-3 py-3",
            collapsed && "justify-center px-0",
          )}
        >
          {header}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2 py-3">
        {groups.map((group) => (
          <div key={group.label} className="mb-4 last:mb-0">
            {!collapsed && (
              <div className="px-2 pb-1.5 text-[11px] leading-4 font-medium tracking-[0.06em] text-fg-muted uppercase">
                {group.label}
              </div>
            )}
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = item.href === activeHref;
                return (
                  <li key={item.href}>
                    <a
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "hl-focusable relative flex h-8 items-center gap-2 rounded-md px-2 text-[13px]",
                        "transition-colors duration-[120ms]",
                        collapsed && "justify-center px-0",
                        active
                          ? "bg-brand-surface font-medium text-brand-text"
                          : "text-fg-secondary hover:bg-surface-hover hover:text-fg",
                      )}
                    >
                      {active && (
                        <span
                          aria-hidden
                          className="absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-r-full bg-brand"
                        />
                      )}
                      <Icon className="size-4 shrink-0" strokeWidth={1.75} />
                      {!collapsed && (
                        <>
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                          {item.badge && (
                            <Badge variant={item.badge.variant ?? "ai"} size="sm">
                              {item.badge.label}
                            </Badge>
                          )}
                          {typeof item.count === "number" && item.count > 0 && (
                            <span className="hl-tabular flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-surface px-1 text-[10px] font-semibold text-brand-text">
                              {item.count}
                            </span>
                          )}
                          {item.dot && (
                            <span
                              aria-hidden
                              className="size-1.5 shrink-0 rounded-full bg-brand"
                            />
                          )}
                        </>
                      )}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {footer && (
        <div className={cn("border-t border-line-subtle p-2", collapsed && "px-0")}>
          {footer}
        </div>
      )}

      {onToggleCollapse && (
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "hl-focusable flex h-8 items-center gap-2 border-t border-line-subtle px-2 text-fg-muted",
            "transition-colors duration-[120ms] hover:bg-surface-hover hover:text-fg-secondary",
            collapsed && "justify-center",
          )}
        >
          {collapsed ? (
            <ChevronsRight className="size-4" strokeWidth={1.75} />
          ) : (
            <>
              <ChevronsLeft className="size-4" strokeWidth={1.75} />
              <span className="text-[12px]">Collapse</span>
            </>
          )}
        </button>
      )}
    </nav>
  );
}
