import type { ComponentType, ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "../utils/cn";
import type { LinkComponent } from "../utils/link";

export type StatTone =
  | "neutral"
  | "brand"
  | "ai"
  | "success"
  | "warning"
  | "danger"
  | "info"
  /* The reference's purple tile. A hue, not a meaning. */
  | "violet"
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
  /**
   * Renders the "Click to view →" affordance and makes the card a link.
   *
   * Omit it when there is nowhere to go. The affordance is the promise, so a
   * card given a placeholder href tells every user it is clickable and then
   * does nothing — which is what eight cards on the Command Center did until
   * audit NAV-02 went looking for them.
   */
  href?: string;
  /** Router-aware link component, e.g. `next/link`. See utils/link.ts. */
  linkComponent?: LinkComponent;
  /** Short qualifier under the value, e.g. "of 1,000 this month". */
  hint?: ReactNode;
  /** Marks the number as model-produced — tints the icon tile violet. */
  aiGenerated?: boolean;
  className?: string;
}

const ICON_TONE: Record<StatTone, string> = {
  neutral: "bg-tile-neutral text-tile-neutral-text",
  violet: "bg-violet-surface text-violet-text",
  brand: "bg-brand-surface text-brand-text",
  ai: "bg-ai-surface text-ai-text",
  success: "bg-success-surface text-success-text",
  warning: "bg-warning-surface text-warning-text",
  danger: "bg-danger-surface text-danger-text",
  info: "bg-info-surface text-info-text",
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
  linkComponent,
  hint,
  aiGenerated,
  className,
}: StatCardProps) {
  const effectiveTone: StatTone = aiGenerated ? "ai" : tone;
  // Three cases, not two: a routed link, a plain anchor, and a non-link card.
  // The cast keeps one JSX element below rather than branching the whole tree.
  const Root = (href ? (linkComponent ?? "a") : "div") as "a";

  return (
    <Root
      {...(href ? { href } : {})}
      className={cn(
        "hl-focusable group relative flex flex-col justify-between rounded-lg border border-line-subtle bg-surface p-5 shadow-card",
        "min-h-[150px] transition-[border-color,box-shadow] duration-[120ms] ease-out-hl",
        href && "hover:border-brand-border hover:shadow-raised",
        className,
      )}
    >
      {Icon && (
        <span
          className={cn(
            "flex size-12 items-center justify-center rounded-[12px]",
            ICON_TONE[effectiveTone],
          )}
        >
          <Icon className="size-[22px]" strokeWidth={1.75} />
        </span>
      )}

      <div className={cn("flex items-end justify-between gap-3", Icon && "mt-4")}>
        <div className="min-w-0">
          <div className="hl-tabular text-[36px] leading-10 font-bold tracking-[-0.02em] text-fg">
            {value}
          </div>
          <div className="mt-1.5 text-[12px] leading-4 font-medium tracking-label text-fg-secondary uppercase">
            {label}
          </div>
          {hint && <div className="mt-2 text-[12.5px] text-fg-muted">{hint}</div>}
          {href && (
            <div
              className={cn(
                "text-[13px] text-fg-muted transition-colors duration-[120ms] group-hover:text-fg-secondary",
                hint ? "mt-1" : "mt-2",
              )}
            >
              Click to view →
            </div>
          )}
        </div>
        {/* The reference's drill-in chevron, always shown: the whole card is
            the link, and the chevron is what says so before a hover. */}
        {href && (
          <ChevronRight
            aria-hidden
            className="mb-0.5 size-4 shrink-0 text-fg-faint transition-colors duration-[120ms] group-hover:text-brand-vivid"
            strokeWidth={1.75}
          />
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
        "grid gap-4 sm:grid-cols-2",
        columns === 4 ? "xl:grid-cols-4" : "xl:grid-cols-3",
        className,
      )}
    >
      {children}
    </div>
  );
}
