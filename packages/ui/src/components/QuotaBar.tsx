import { cn } from "../utils/cn";
import { Badge } from "./Badge";

export interface QuotaBarProps {
  label: string;
  used: number;
  limit: number;
  /** e.g. "/day" — appended after the used/limit fraction. */
  unit?: string;
  className?: string;
}

/**
 * Kima's "Lead Queue Quotas", repointed in Huntloop at mailbox sending
 * capacity (plan §2 — the real constraint is deliverability, not lead count).
 * brand <80% · warning 80–99% · danger at/over cap, with a FULL badge.
 */
export function QuotaBar({ label, used, limit, unit, className }: QuotaBarProps) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const full = used >= limit;
  const tone = full ? "danger" : pct >= 80 ? "warning" : "brand";

  /* The fill is a graphic, so it takes the vivid blue (board 04) until the
     meter is nearly spent; amber and red then say so before the word does. */
  const trackColor =
    tone === "danger"
      ? "bg-danger"
      : tone === "warning"
        ? "bg-warning"
        : "bg-brand-vivid";

  return (
    /* The reference's stacked meter: label and "used / limit" on one line,
       a 5px bar under them. */
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between gap-3 text-[12px] leading-4">
        <span className="min-w-0 truncate text-fg-secondary" title={label}>
          {label}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="hl-tabular text-fg">
            {used.toLocaleString("en-US")} / {limit.toLocaleString("en-US")}
            {unit}
          </span>
          {full && (
            <Badge variant="danger" size="sm">
              Full
            </Badge>
          )}
        </span>
      </div>

      <div
        role="progressbar"
        aria-label={`${label}: ${used} of ${limit}${unit ?? ""}`}
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={limit}
        className="h-[5px] w-full overflow-hidden rounded-full bg-surface-active"
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-[280ms] ease-out-hl", trackColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function QuotaBarGroup({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("flex flex-col gap-3.5", className)}>{children}</div>;
}
