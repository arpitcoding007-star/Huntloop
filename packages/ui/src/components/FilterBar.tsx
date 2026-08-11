"use client";

import type { ReactNode } from "react";
import { ChevronDown, Search } from "lucide-react";
import { cn } from "../utils/cn";

export interface FilterScope {
  value: string;
  label: string;
}

export interface FilterBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** The "Email address ⌄" dropdown from the Supabase Users toolbar. */
  scopes?: FilterScope[];
  scope?: string;
  onScopeChange?: (scope: string) => void;
  /** Right-hand slot: refresh, column picker, primary action. */
  actions?: ReactNode;
  /** Shown in place of the search field when rows are selected. */
  selectionCount?: number;
  selectionActions?: ReactNode;
  className?: string;
}

export function FilterBar({
  value,
  onChange,
  placeholder = "Search…",
  scopes,
  scope,
  onScopeChange,
  actions,
  selectionCount = 0,
  selectionActions,
  className,
}: FilterBarProps) {
  if (selectionCount > 0) {
    return (
      <div
        className={cn(
          "flex h-12 items-center justify-between gap-3 rounded-md border border-brand-border bg-brand-surface px-3",
          className,
        )}
      >
        <span className="hl-tabular text-[13px] font-medium text-brand-text">
          {selectionCount} selected
        </span>
        <div className="flex items-center gap-2">{selectionActions}</div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3", className)}>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {scopes && scopes.length > 0 && (
          <div className="relative shrink-0">
            <select
              aria-label="Search field"
              value={scope}
              onChange={(e) => onScopeChange?.(e.target.value)}
              className={cn(
                "hl-focusable h-8 appearance-none rounded-md border border-line bg-surface pr-7 pl-2.5",
                "text-[13px] text-fg-secondary transition-colors duration-[120ms]",
                "hover:border-line-strong focus:border-line-strong",
              )}
            >
              {scopes.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden
              className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-fg-muted"
              strokeWidth={1.75}
            />
          </div>
        )}

        <div className="relative min-w-[200px] flex-1 sm:max-w-[360px]">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-muted"
            strokeWidth={1.75}
          />
          <input
            type="search"
            value={value}
            placeholder={placeholder}
            // A placeholder is not an accessible name — it disappears on
            // input and axe flags the field as unlabelled without this.
            aria-label={placeholder}
            onChange={(e) => onChange(e.target.value)}
            className={cn(
              "hl-focusable h-8 w-full rounded-md border border-line bg-surface pr-3 pl-8",
              "text-[13px] text-fg placeholder:text-fg-muted",
              "transition-colors duration-[120ms] hover:border-line-strong focus:border-line-strong",
            )}
          />
        </div>
      </div>

      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
