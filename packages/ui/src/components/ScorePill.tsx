import { cn } from "../utils/cn";

export interface ScoreFactor {
  label: string;
  /** Signed contribution to the score, e.g. +18 or -6. */
  impact: number;
}

export interface ScorePillProps {
  score: number;
  /**
   * Why this score. REQUIRED by design — the plan forbids showing an
   * unexplained model-produced number (spec Part 7 §7, explainable AI).
   */
  explanation: string;
  factors?: ScoreFactor[];
  size?: "sm" | "md";
  className?: string;
}

type Band = "poor" | "fair" | "good" | "excellent";

function band(score: number): Band {
  if (score >= 90) return "excellent";
  if (score >= 70) return "good";
  if (score >= 40) return "fair";
  return "poor";
}

const BAND_VAR: Record<Band, string> = {
  poor: "var(--hl-score-poor)",
  fair: "var(--hl-score-fair)",
  good: "var(--hl-score-good)",
  excellent: "var(--hl-score-excellent)",
};

const BAND_LABEL: Record<Band, string> = {
  poor: "Poor fit",
  fair: "Fair fit",
  good: "Good fit",
  excellent: "Excellent fit",
};

export function ScorePill({
  score,
  explanation,
  factors,
  size = "md",
  className,
}: ScorePillProps) {
  const b = band(score);
  const color = BAND_VAR[b];

  return (
    <span className={cn("group relative inline-flex", className)}>
      <span
        tabIndex={0}
        role="button"
        aria-label={`Score ${score} of 100. ${BAND_LABEL[b]}. ${explanation}`}
        className={cn(
          "hl-focusable hl-tabular inline-flex cursor-help items-center justify-center rounded-full border font-semibold",
          size === "sm"
            ? "h-5 min-w-[28px] px-1.5 text-[11px]"
            : "h-6 min-w-[34px] px-2 text-[12px]",
        )}
        style={{
          color,
          borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
          backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`,
        }}
      >
        {score}
      </span>

      {/* Explanation surfaces on hover AND keyboard focus. */}
      <span
        role="tooltip"
        className={cn(
          // `hidden`, not `invisible`: a visibility:hidden tooltip still
          // contributes to the page scroll box and pushes horizontal overflow.
          "pointer-events-none absolute top-full left-1/2 z-30 mt-2 hidden w-64 max-w-[calc(100vw-2rem)]",
          "-translate-x-1/2 rounded-lg border border-line bg-panel p-3",
          "shadow-[0_8px_24px_rgba(0,0,0,0.4)]",
          "group-hover:block group-focus-within:block",
        )}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase">
            {BAND_LABEL[b]}
          </span>
          <span className="hl-tabular text-[11px] font-semibold" style={{ color }}>
            {score}/100
          </span>
        </span>

        <span className="mt-2 block text-[12px] leading-[1.5] text-fg-secondary">
          {explanation}
        </span>

        {factors && factors.length > 0 && (
          <span className="mt-2.5 block border-t border-line-subtle pt-2.5">
            {factors.map((f) => (
              <span
                key={f.label}
                className="flex items-center justify-between gap-3 py-0.5 text-[12px]"
              >
                <span className="truncate text-fg-muted">{f.label}</span>
                <span
                  className="hl-tabular shrink-0 font-medium"
                  style={{
                    color:
                      f.impact >= 0 ? "var(--hl-brand)" : "var(--hl-danger)",
                  }}
                >
                  {f.impact >= 0 ? "+" : ""}
                  {f.impact}
                </span>
              </span>
            ))}
          </span>
        )}
      </span>
    </span>
  );
}
