import { cn } from "../utils/cn";
import { HoverPanel } from "./HoverPanel";

/**
 * The four-level opportunity verdict from master context §15. This is the
 * product's headline classification — a HOT company is one with strong ICP
 * fit AND strong pain AND a strong recent trigger, not merely a high score.
 * Deliberately a closed union: a fifth value would have to be defined by the
 * product owner, not invented here.
 */
export type Priority = "hot" | "warm" | "watch" | "ignore";

export interface PriorityBadgeProps {
  priority: Priority;
  size?: "sm" | "md";
  /**
   * One line on why this verdict was reached. §15 and §46 both treat the
   * classification as an intelligence claim, and §77 Principle 4 requires
   * claims to be explainable — so the reason is required, exactly as
   * ScorePill requires its explanation.
   */
  reason: string;
  className?: string;
}

const STYLES: Record<Priority, string> = {
  hot: "bg-hot-surface border-hot-border text-hot",
  warm: "bg-warm-surface border-warm-border text-warm",
  watch: "bg-watch-surface border-watch-border text-watch",
  ignore: "bg-ignore-surface border-ignore-border text-ignore",
};

const DOTS: Record<Priority, string> = {
  hot: "bg-hot",
  warm: "bg-warm",
  watch: "bg-watch",
  ignore: "bg-ignore",
};

/** Spelled out for the accessible name — "WATCH" alone is ambiguous read aloud. */
const MEANING: Record<Priority, string> = {
  hot: "Hot — strong fit, strong pain, strong recent trigger",
  warm: "Warm — good fit, reasonable pain, weaker trigger",
  watch: "Watch — possible fit, insufficient evidence so far",
  ignore: "Ignore — poor fit",
};

export function PriorityBadge({
  priority,
  size = "sm",
  reason,
  className,
}: PriorityBadgeProps) {
  return (
    <HoverPanel
      className={className}
      label={`${MEANING[priority]}. ${reason}`}
      width={224}
      triggerClassName={cn(
        "inline-flex items-center gap-1.5 rounded-sm border",
        "font-semibold tracking-[0.06em] whitespace-nowrap uppercase",
        size === "sm" ? "h-[18px] px-1.5 text-[10px]" : "h-[22px] px-2 text-[11px]",
        STYLES[priority],
      )}
      panel={
        <>
          <span className="block text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase">
            {priority}
          </span>
          <span className="mt-1.5 block text-[12px] leading-[1.5] text-fg-secondary">
            {reason}
          </span>
        </>
      }
    >
      {/* Shape as well as colour: the dot is filled for HOT and hollow as the
          verdict cools, so the ranking survives a greyscale print or a
          red-green deficiency without reading the word. */}
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          priority === "ignore" ? "border border-current" : DOTS[priority],
          priority === "watch" && "opacity-70",
        )}
      />
      {priority}
    </HoverPanel>
  );
}
