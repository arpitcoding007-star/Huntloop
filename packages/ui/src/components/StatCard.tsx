import type { ComponentType, ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "../utils/cn";

export type StatTone =
  | "neutral"
  | "brand"
  | "ai"
  | "success"
  | "warning"
  | "danger"
  | "info"
  /* The §15 verdict scale. Separate names from the status tones even though
     they resolve to the same hues — a HOT count is not an error, and a card
     reading `tone="danger"` would teach the next reader that it is. */
  | "hot"
  | "warm"
  | "watch"
  | "ignore";

export interface StatCardProps {
  label: string;
  value: number | string;
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>;
  tone?: StatTone;
  /** Renders the "Click to view →" affordance and makes the card a link. */
  href?: string;
  /** Short qualifier under the value, e.g. "of 1,000 this month". */
  hint?: ReactNode;
  /** Marks the number as model-produced — tints the icon tile violet. */
  aiGenerated?: boolean;
  className?: string;
}

const ICON_TONE: Record<StatTone, string> = {
  neutral: "bg-surface-active text-fg-secondary",
  brand: "bg-brand-surface text-brand",
  ai: "bg-ai-surface text-ai",
  success: "bg-success-surface text-success",
  warning: "bg-warning-surface text-warning",
  danger: "bg-danger-surface text-danger",
  info: "bg-info-surface text-info",
  hot: "bg-hot-surface text-hot",
  warm: "bg-warm-surface text-warm",
  watch: "bg-watch-surface text-watch",
  ignore: "bg-ignore-surface text-ignore",
};

/**
 * Kima's pipeline stat card rendered with Supabase's label + border treatment.
 * Icon tile · uppercase label · tabular metric · optional drill-in affordance.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "neutral",
  href,
  hint,
  aiGenerated,
  className,
}: StatCardProps) {
  const effectiveTone: StatTone = aiGenerated ? "ai" : tone;
  const Root = (href ? "a" : "div") as "a";

  return (
    <Root
      {...(href ? { href } : {})}
      className={cn(
        "hl-focusable group relative flex flex-col justify-between rounded-md border border-line-subtle bg-surface p-4",
        "min-h-[132px] transition-colors duration-[120ms]",
        href && "hover:border-line hover:bg-surface-hover",
        className,
      )}
    >
      <div className="flex items-start justify-between">
        {Icon && (
          <span
            className={cn(
              "flex size-10 items-center justify-center rounded-md",
              ICON_TONE[effectiveTone],
            )}
          >
            <Icon className="size-[18px]" strokeWidth={1.75} />
          </span>
        )}
        {href && (
          <ArrowUpRight
            aria-hidden
            className="size-4 text-fg-muted opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100"
            strokeWidth={1.75}
          />
        )}
      </div>

      <div className="mt-4">
        <div className="hl-tabular text-[32px] leading-9 font-semibold text-fg">
          {value}
        </div>
        <div className="mt-1 text-[11px] leading-4 font-medium tracking-[0.06em] text-fg-muted uppercase">
          {label}
        </div>
        {hint && <div className="mt-1.5 text-[12px] text-fg-muted">{hint}</div>}
        {href && !hint && (
          <div className="mt-1.5 text-[12px] text-fg-muted transition-colors duration-[120ms] group-hover:text-fg-secondary">
            Click to view →
          </div>
        )}
      </div>
    </Root>
  );
}

export function StatGrid({
  children,
  columns = 4,
  className,
}: {
  children: ReactNode;
  columns?: 3 | 4;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-3 sm:grid-cols-2",
        columns === 4 ? "xl:grid-cols-4" : "xl:grid-cols-3",
        className,
      )}
    >
      {children}
    </div>
  );
}
