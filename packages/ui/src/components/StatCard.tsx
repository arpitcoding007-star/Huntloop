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
  /**
   * The link line’s words when `href` is set — the reference’s
   * "Open inbox →". Defaults to "View".
   */
  linkLabel?: string;
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
 * The reference stat card (board 04): an eyebrow label, a 32px tabular
 * metric, and one 12px line under it — a qualifier, or the link that says
 * where the card goes. An icon, when given, is a small tone tile beside the
 * label rather than the card’s headline.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "neutral",
  href,
  linkComponent,
  hint,
  linkLabel = "View",
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
        "hl-focusable group relative flex flex-col gap-1.5 rounded-lg border border-line-subtle bg-surface p-[18px] shadow-card",
        "transition-[border-color,box-shadow] duration-[120ms] ease-out-hl",
        href && "hover:border-brand-border hover:shadow-raised",
        className,
      )}
    >
      <div className="flex min-h-7 items-center justify-between gap-3">
        <span className="hl-label truncate">{label}</span>
        {Icon && (
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-[8px]",
              ICON_TONE[effectiveTone],
            )}
          >
            <Icon className="size-4" strokeWidth={1.75} />
          </span>
        )}
      </div>

      <div className="hl-tabular text-[32px] leading-9 font-semibold tracking-[-0.02em] text-fg">
        {value}
      </div>

      {hint && <div className="text-[12px] leading-4 text-fg-muted">{hint}</div>}

      {/* The whole card is the link; this line is what says so before a
          hover, and where it goes. */}
      {href && (
        <span className="inline-flex items-center gap-0.5 text-[12px] leading-4 text-brand-text group-hover:underline">
          {linkLabel}
          <ChevronRight aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
        </span>
      )}
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
