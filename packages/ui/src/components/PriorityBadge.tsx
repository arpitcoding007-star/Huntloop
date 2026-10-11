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
  hot: "bg-hot-dot",
  warm: "bg-warm-dot",
  watch: "bg-watch-dot",
  ignore: "bg-ignore-dot",
};

/* The visible word, in the reference's sentence case. */
const WORD: Record<Priority, string> = {
  hot: "Hot",
  warm: "Warm",
  watch: "Watch",
  ignore: "Ignore",
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
      /* The reference's priority chip (board 02): a pill, 12px / 600, a
         filled 6px dot in the scale's fill and the word in its text leaf. */
      triggerClassName={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-semibold whitespace-nowrap",
        size === "sm" ? "h-5 px-2 text-[11px]" : "h-6 px-2.5 text-[12px]",
        STYLES[priority],
      )}
      panel={
        <>
          <span className="block text-[11px] font-semibold tracking-label text-fg-muted uppercase">
            {priority}
          </span>
          <span className="mt-1.5 block text-[12px] leading-[1.5] text-fg-secondary">
            {reason}
          </span>
        </>
      }
    >
      {/* The word carries the verdict; the dot only reinforces it. */}
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", DOTS[priority])} />
      {WORD[priority]}
    </HoverPanel>
  );
}
