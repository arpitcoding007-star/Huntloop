import { cn } from "../utils/cn";

export interface BreakdownItem {
  label: string;
  value: number;
}

export interface BreakdownListProps {
  items: BreakdownItem[];
  /** Formats the right-aligned number; defaults to plain integer. */
  formatValue?: (value: number) => string;
  className?: string;
}

const CHART_VARS = [
  "var(--hl-chart-1)",
  "var(--hl-chart-2)",
  "var(--hl-chart-3)",
  "var(--hl-chart-4)",
  "var(--hl-chart-5)",
  "var(--hl-chart-6)",
];

/**
 * Kima's "By Customer Type" / "By Product" — label, right-aligned count,
 * horizontal bar sized relative to the largest item, color cycling the
 * chart ramp so adjacent rows are always visually distinct.
 */
export function BreakdownList({ items, formatValue, className }: BreakdownListProps) {
  const max = Math.max(1, ...items.map((i) => i.value));

  return (
    <ul className={cn("flex flex-col gap-2.5", className)}>
      {items.map((item, i) => {
        const pct = Math.max(2, (item.value / max) * 100);
        const color = CHART_VARS[i % CHART_VARS.length];
        return (
          <li key={item.label} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2 text-[13px]">
              <span className="truncate text-fg-secondary">{item.label}</span>
              <span className="hl-tabular shrink-0 font-medium text-fg">
                {formatValue ? formatValue(item.value) : item.value}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-active">
              <div
                className="h-full rounded-full transition-[width] duration-[180ms]"
                style={{ width: `${pct}%`, backgroundColor: color }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
