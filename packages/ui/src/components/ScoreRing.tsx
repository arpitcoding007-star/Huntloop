import { cn } from "../utils/cn";

/**
 * At or above this, a ring is green; below it, amber. The Meridian comps are
 * green at 78 / 84 / 89 / 92 and amber at 72, and 75 is the break that
 * reproduces every one of them.
 */
export const SCORE_RING_THRESHOLD = 75;

export type ScoreRingSize = "sm" | "md" | "lg" | "xl";
export type ScoreRingTone = "auto" | "neutral";

export interface ScoreRingProps {
  /** 0–100. Clamped. */
  score: number;
  /** 34 (card header) / 38 (table row) / 52 (detail) / 200 (hero figure). */
  size?: ScoreRingSize;
  /**
   * `auto` — green at or above {@link SCORE_RING_THRESHOLD}, amber below.
   * `neutral` — ink on a quiet track, for the one large ring whose job is to
   * be inspected rather than judged (the evidence figure).
   */
  tone?: ScoreRingTone;
  /** A small tracked word under the number. Only rendered at `xl`. */
  caption?: string;
  /** Accessible name. Defaults to "Score {n}". */
  label?: string;
  className?: string;
}

/* Everything in the 40-unit viewBox, as drawn in the comp, so the stroke and
   the numeral scale together. The 200px ring has its own 200-unit geometry
   because its stroke is proportionally thinner. */
const GEOMETRY: Record<
  ScoreRingSize,
  { px: number; box: number; r: number; stroke: number; font: number; y: number }
> = {
  sm: { px: 34, box: 40, r: 16, stroke: 3, font: 12.5, y: 24.5 },
  md: { px: 38, box: 40, r: 16, stroke: 3, font: 12.5, y: 24.5 },
  lg: { px: 52, box: 40, r: 16, stroke: 3, font: 12.5, y: 24.5 },
  xl: { px: 200, box: 200, r: 80, stroke: 6, font: 56, y: 104 },
};

/**
 * A thin score ring — Meridian's signature figure.
 *
 * The number is always printed inside the ring in full-contrast ink: the
 * arc's colour is a graphic (held to 3:1, which --hl-success and
 * --hl-warning clear against their own tracks), and the verdict is never
 * carried by the colour alone.
 *
 * Distinct from `ScorePill`, which stays the table-cell treatment and owns
 * the explanation popover. A ring is a figure, not a control; pair it with
 * a pill or an explanation when the score has to be accountable.
 */
export function ScoreRing({
  score,
  size = "md",
  tone = "auto",
  caption,
  label,
  className,
}: ScoreRingProps) {
  const g = GEOMETRY[size];
  const value = Math.round(Math.min(100, Math.max(0, score)));
  const c = g.box / 2;
  const high = value >= SCORE_RING_THRESHOLD;

  const track =
    tone === "neutral"
      ? "stroke-surface-active"
      : high
        ? "stroke-success-surface"
        : "stroke-warning-surface";
  const arc = tone === "neutral" ? "stroke-fg" : high ? "stroke-success" : "stroke-warning";

  return (
    <svg
      width={g.px}
      height={g.px}
      viewBox={`0 0 ${g.box} ${g.box}`}
      role="img"
      aria-label={label ?? `Score ${value}`}
      className={cn("shrink-0", className)}
    >
      <circle cx={c} cy={c} r={g.r} fill="none" strokeWidth={g.stroke} className={track} />
      {value > 0 && (
        <circle
          cx={c}
          cy={c}
          r={g.r}
          fill="none"
          strokeWidth={g.stroke}
          pathLength={100}
          strokeDasharray={`${value} 100`}
          strokeLinecap="round"
          transform={`rotate(-90 ${c} ${c})`}
          className={cn(arc, "transition-[stroke-dasharray] duration-[280ms] ease-out-hl")}
        />
      )}
      <text
        x={c}
        y={g.y}
        textAnchor="middle"
        fontSize={g.font}
        fontWeight={600}
        letterSpacing={size === "xl" ? -2 : 0}
        className="fill-fg font-sans"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </text>
      {size === "xl" && caption && (
        <text
          x={c}
          y={128}
          textAnchor="middle"
          fontSize={11}
          letterSpacing={3}
          className="fill-fg-muted font-sans"
        >
          {caption}
        </text>
      )}
    </svg>
  );
}
