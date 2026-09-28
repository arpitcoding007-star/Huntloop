import { BRAND_MARK_DOT_R, BRAND_MARK_PATH, BRAND_MARK_STROKE } from "../brand";
import { cn } from "../utils/cn";

/**
 * The Huntloop mark: a loop that spirals in and closes on a single target.
 *
 * It is the product in one shape — many companies at the outer edge, the
 * loop narrowing as each is qualified, and the blue dot where it arrives:
 * the one opportunity worth pursuing. The same ring-and-node language as
 * the loop diagram on the landing page, so the mark and the explanation of
 * the product reinforce each other.
 *
 * ── Why these numbers ────────────────────────────────────────────────────
 *
 * An Archimedean spiral, radius 12.2 → 6.3 over 1.05 turns from -60°, drawn
 * as fourteen circular arcs rather than a polyline so it stays smooth at
 * 128px as well as 16px. The 3.4 stroke keeps a ~2.5-unit gap between the
 * turns, which is what survives at favicon size — thinner and the turns
 * merge into a disc, thicker and the gap closes. Regenerate rather than
 * hand-edit: the path is a function of those five numbers.
 *
 * ── Colour ───────────────────────────────────────────────────────────────
 *
 * The loop is `currentColor`, so it takes whatever ink its container sets —
 * `text-fg` in the chrome, white on a brand fill. The dot is --hl-mark-dot,
 * a per-theme token. The file served as the favicon (app/icon.svg) cannot
 * see either, and restates both as literals.
 *
 * Created and designed by Chandra Mani Sharma.
 */

export function BrandMark({
  className,
  title,
}: {
  className?: string;
  /** Accessible name. Omit when a visible "Huntloop" sits beside the mark. */
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={cn("size-6 shrink-0", className)}
      {...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true })}
    >
      <path
        d={BRAND_MARK_PATH}
        stroke="currentColor"
        strokeWidth={BRAND_MARK_STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r={BRAND_MARK_DOT_R} fill="var(--hl-mark-dot)" />
    </svg>
  );
}
