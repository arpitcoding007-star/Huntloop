import { cn } from "../utils/cn";
import type { Confidence } from "./ClaimBadge";
import { HoverPanel } from "./HoverPanel";

/**
 * The eight dimensions master context §16/§51 scores an opportunity on.
 * Exported as a const so callers can't drift into a ninth name or a synonym —
 * §51 explicitly warns against inventing scoring structure and passing it off
 * as Huntloop's model.
 */
export const SCORE_DIMENSIONS = [
  "ICP fit",
  "Problem severity",
  "Evidence strength",
  "Trigger strength",
  "Trigger freshness",
  "Buying likelihood",
  "Product relevance",
  "Decision-maker accessibility",
] as const;

export type ScoreDimensionLabel = (typeof SCORE_DIMENSIONS)[number];

export interface ScoreDimension {
  label: ScoreDimensionLabel;
  /**
   * 0–100, or "unknown" when the evidence doesn't establish it. §78 requires
   * an unmeasured dimension to say so rather than default to zero — a zero
   * reads as "we checked and it's bad", which would be a fabricated finding.
   */
  value: number | "unknown";
  /** Optional one-liner on what drove this dimension. */
  note?: string;
}

export interface ScoreFactor {
  label: string;
  /** Signed contribution, e.g. +18 or -6. */
  impact: number;
}

export interface ScorePillProps {
  score: number;
  /**
   * Why this score. REQUIRED by design — §51 and §77 Principle 4 forbid
   * showing an unexplained model-produced number.
   */
  explanation: string;
  /**
   * The §51 dimension breakdown. Preferred over `factors`: it shows what the
   * model assessed without asserting how the dimensions were weighted, which
   * is precisely the thing §51 records as NOT DEFINED.
   */
  dimensions?: ScoreDimension[];
  /**
   * Signed per-factor contributions. Only pass these once a real, versioned
   * weighting exists to back them — a +18 on screen is a claim about the
   * model's arithmetic, not a decoration.
   */
  factors?: ScoreFactor[];
  /** §16: how much to trust the number itself. */
  confidence?: Confidence;
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

/**
 * The pill's ink and ground, as a matched pair.
 *
 * ── Why not a tint of the ink itself ────────────────────────────────────
 *
 * That is what this did: a 15% mix of the band colour over whatever was
 * behind it. It is a tidy one-liner and it is structurally incapable of
 * meeting AA, because text on a tint of itself has a contrast ceiling the
 * tint strength sets. Measured in the light theme it gave 2.70:1 for a
 * strong score and 3.36:1 for an excellent one — the two bands a user sees
 * most, on the number the whole product is about.
 *
 * Pairing an ink leaf with a designed surface leaf is what every other
 * status component here already does, and those pairs were measured when
 * they were chosen. This component was the one that mixed its own colour
 * instead of using them.
 *
 * `excellent` borrows the success surface rather than getting a fifth one.
 * It is the top of the same green scale, and its ink is distinct enough to
 * separate 90+ from 70–89 without a second background nobody would be able
 * to name.
 *
 * Found by axe, not by eye — see `e2e/a11y.spec.ts`.
 */
const BAND_INK: Record<Band, string> = {
  poor: "var(--hl-danger-text)",
  fair: "var(--hl-warning-text)",
  good: "var(--hl-success-text)",
  excellent: "var(--hl-score-excellent-text)",
};

const BAND_SURFACE: Record<Band, string> = {
  poor: "var(--hl-danger-surface)",
  fair: "var(--hl-warning-surface)",
  good: "var(--hl-success-surface)",
  excellent: "var(--hl-success-surface)",
};

const BAND_BORDER: Record<Band, string> = {
  poor: "var(--hl-danger-border)",
  fair: "var(--hl-warning-border)",
  good: "var(--hl-success-border)",
  excellent: "var(--hl-success-border)",
};

/* Was "Poor fit"…"Excellent fit", which mislabelled the composite as ICP fit
   alone. ICP fit is one of eight dimensions (§51) and §78 is explicit that a
   strong trigger must not drag a poor-fit company up — so the two readings
   have to stay separable in the UI as well as in the model. */
const BAND_LABEL: Record<Band, string> = {
  poor: "Weak opportunity",
  fair: "Fair opportunity",
  good: "Strong opportunity",
  excellent: "Exceptional opportunity",
};

export function ScorePill({
  score,
  explanation,
  dimensions,
  factors,
  confidence,
  size = "md",
  className,
}: ScorePillProps) {
  const b = band(score);
  const color = BAND_VAR[b];

  return (
    <HoverPanel
      className={className}
      // Everything a sighted user gets from the panel, in one accessible name.
      label={`Score ${score} of 100. ${BAND_LABEL[b]}.${
        confidence ? ` ${confidence} confidence.` : ""
      } ${explanation}`}
      width={288}
      triggerClassName={cn(
        "hl-tabular inline-flex items-center justify-center rounded-full border font-semibold",
        size === "sm"
          ? "h-5 min-w-[28px] px-1.5 text-[11px]"
          : "h-6 min-w-[34px] px-2 text-[12px]",
      )}
      triggerStyle={{
        color: BAND_INK[b],
        borderColor: BAND_BORDER[b],
        backgroundColor: BAND_SURFACE[b],
      }}
      panel={
        <>
          <span className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium tracking-label text-fg-muted uppercase">
              {BAND_LABEL[b]}
            </span>
            <span className="hl-tabular text-[11px] font-semibold" style={{ color }}>
              {score}/100
            </span>
          </span>

          <span className="mt-2 block text-[12px] leading-[1.5] text-fg-secondary">
            {explanation}
          </span>

          {dimensions && dimensions.length > 0 && (
            <span className="mt-2.5 block border-t border-line-subtle pt-2.5">
              {dimensions.map((d) => (
                <span key={d.label} className="block py-0.5">
                  <span className="flex items-center justify-between gap-3 text-[12px]">
                    <span className="truncate text-fg-muted">{d.label}</span>
                    {d.value === "unknown" ? (
                      <span className="shrink-0 text-[11px] tracking-label text-fg-muted uppercase">
                        Unknown
                      </span>
                    ) : (
                      <span className="hl-tabular shrink-0 font-medium text-fg-secondary">
                        {d.value}
                      </span>
                    )}
                  </span>
                  {/* A bar, not a percentage of the total — it reads a single
                      dimension's strength and implies nothing about weighting. */}
                  {d.value !== "unknown" && (
                    <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-surface-active">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${Math.max(0, Math.min(100, d.value))}%`,
                          backgroundColor: color,
                        }}
                      />
                    </span>
                  )}
                </span>
              ))}
            </span>
          )}

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
                      color: f.impact >= 0 ? "var(--hl-brand)" : "var(--hl-danger)",
                    }}
                  >
                    {f.impact >= 0 ? "+" : ""}
                    {f.impact}
                  </span>
                </span>
              ))}
            </span>
          )}

          {confidence && (
            <span className="mt-2.5 block border-t border-line-subtle pt-2 text-[11px] tracking-label text-fg-muted uppercase">
              {confidence} confidence in this score
            </span>
          )}
        </>
      }
    >
      {score}
    </HoverPanel>
  );
}
