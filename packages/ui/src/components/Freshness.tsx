import { cn } from "../utils/cn";

/**
 * Master context §81: "A six-month-old signal should not be treated the same
 * as a signal from yesterday." Freshness is the visible half of that rule —
 * it renders how old a trigger is and lets age dim it.
 *
 * It is presentation only. The bands below decide how the age *reads*; they
 * are not a decay curve and must not be borrowed as one. §81 records the
 * actual decay logic as UNKNOWN, and §51 forbids inventing weights and then
 * treating them as Huntloop's scoring model.
 */
export type FreshnessBand = "fresh" | "recent" | "aging" | "stale";

export interface FreshnessProps {
  /** When the event happened — §52's `event_date`, not when we crawled it. */
  date: Date | string;
  /**
   * Reference point for the elapsed calculation. Pass the server's clock when
   * this renders inside a client component, otherwise server and client
   * render different strings and React reports a hydration mismatch.
   */
  now?: Date | string;
  /** Prefix, e.g. "Triggered" → "Triggered 3 days ago". */
  label?: string;
  className?: string;
}

const DAY_MS = 86_400_000;

export function freshnessBand(days: number): FreshnessBand {
  if (days <= 7) return "fresh";
  if (days <= 30) return "recent";
  if (days <= 90) return "aging";
  return "stale";
}

const BAND_STYLE: Record<FreshnessBand, string> = {
  fresh: "text-brand-text",
  recent: "text-fg-secondary",
  aging: "text-fg-muted",
  stale: "text-fg-muted",
};

/** Whole units only — "3 days ago", never "3.4 days ago". */
export function elapsedLabel(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

export function Freshness({ date, now, label, className }: FreshnessProps) {
  const at = date instanceof Date ? date : new Date(date);
  const ref = now ? (now instanceof Date ? now : new Date(now)) : new Date();
  const days = Math.floor((ref.getTime() - at.getTime()) / DAY_MS);
  const band = freshnessBand(days);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[12px]",
        BAND_STYLE[band],
        className,
      )}
    >
      {/* Age is carried by the text; the dot only reinforces it. Fresh signals
          get a filled dot, stale ones a hollow ring — never colour alone. */}
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          band === "fresh" && "bg-brand",
          band === "recent" && "bg-fg-secondary",
          band === "aging" && "bg-fg-muted opacity-70",
          band === "stale" && "border border-current",
        )}
      />
      {/* The exact instant stays machine-readable even though the visible
          string is rounded — a screen reader or a copy-paste gets the truth. */}
      <time dateTime={at.toISOString()}>
        {label ? `${label} ` : ""}
        {elapsedLabel(days)}
      </time>
      {band === "stale" && (
        <span className="rounded-sm border border-line px-1 text-[10px] tracking-[0.06em] uppercase">
          Stale
        </span>
      )}
    </span>
  );
}
