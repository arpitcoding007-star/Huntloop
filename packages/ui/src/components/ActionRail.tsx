import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "../utils/cn";
import { Badge, type BadgeVariant } from "./Badge";
import { Button } from "./Button";

export interface ActionRailItemProps {
  title: string;
  /** e.g. "LinkedIn", "Email", "AI" — where this item came from. */
  source?: string;
  sourceVariant?: BadgeVariant;
  /** e.g. "37d overdue" — kept terse; the rail should be scannable, not a report. */
  meta?: ReactNode;
  primaryLabel: string;
  onPrimary?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  onDismiss?: () => void;
}

export function ActionRailItem({
  title,
  source,
  sourceVariant = "neutral",
  meta,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  onDismiss,
}: ActionRailItemProps) {
  return (
    <div className="rounded-md border border-line-subtle bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-fg">{title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {source && (
              <Badge variant={sourceVariant} size="sm">
                {source}
              </Badge>
            )}
            {meta && <span className="text-[11px] text-fg-muted">{meta}</span>}
          </div>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label={`Dismiss ${title}`}
            className="hl-focusable shrink-0 rounded-sm p-0.5 text-fg-muted transition-colors duration-[120ms] hover:text-fg-secondary"
          >
            <X className="size-3.5" strokeWidth={1.75} />
          </button>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" variant="primary" onClick={onPrimary} className="flex-1">
          {primaryLabel}
        </Button>
        {secondaryLabel && (
          <Button size="sm" variant="secondary" onClick={onSecondary}>
            {secondaryLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

export interface ActionRailProps {
  title?: string;
  children: ReactNode;
  /** Total count behind the visible items, for the "+N more" footer link. */
  moreCount?: number;
  onMoreClick?: () => void;
  className?: string;
}

/**
 * Kima's follow-up queue, repointed at "what blocks the loop right now"
 * (plan §2). Renders as a normal block-level column — it never uses fixed
 * or absolute positioning, so it cannot overlay page content. The
 * responsive rule from the plan ("must never overlay content <1440px") is
 * enforced by the CALLER: place this in the third grid column on wide
 * layouts and let it fall to a full-width stacked section below the main
 * content on narrower ones (see the dashboard route for the grid classes).
 */
export function ActionRail({
  title = "Needs you",
  children,
  moreCount,
  onMoreClick,
  className,
}: ActionRailProps) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {title && (
        <div className="text-[11px] leading-4 font-medium tracking-[0.06em] text-fg-muted uppercase">
          {title}
        </div>
      )}
      <div className="flex flex-col gap-2">{children}</div>
      {typeof moreCount === "number" && moreCount > 0 && (
        <button
          type="button"
          onClick={onMoreClick}
          className="hl-focusable rounded-sm text-left text-[12px] text-fg-muted transition-colors duration-[120ms] hover:text-fg-secondary"
        >
          +{moreCount} more →
        </button>
      )}
    </div>
  );
}
