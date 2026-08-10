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

  const trackColor =
    tone === "danger"
      ? "bg-danger"
      : tone === "warning"
        ? "bg-warning"
        : "bg-brand";

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span className="w-36 shrink-0 truncate text-[13px] text-fg-secondary" title={label}>
        {label}
      </span>

      <div className="min-w-0 flex-1">
        <div
          role="progressbar"
          aria-label={`${label}: ${used} of ${limit}${unit ?? ""}`}
          aria-valuenow={used}
          aria-valuemin={0}
          aria-valuemax={limit}
          className="h-1 w-full overflow-hidden rounded-full bg-surface-active"
        >
          <div
            className={cn("h-full rounded-full transition-[width] duration-[180ms]", trackColor)}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <span className="hl-tabular w-20 shrink-0 text-right text-[12px] text-fg-muted">
        {used}/{limit}
        {unit}
      </span>

      {full && (
        <Badge variant="danger" size="sm" className="shrink-0">
          Full
        </Badge>
      )}
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
  return <div className={cn("flex flex-col gap-3", className)}>{children}</div>;
}
