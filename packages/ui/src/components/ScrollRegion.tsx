import type { ReactNode } from "react";
import { cn } from "../utils/cn";

/**
 * A horizontally scrolling area a keyboard can actually reach.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * Nine places in this codebase wrapped wide content in `overflow-x-auto`:
 * the comparison tables, the pipeline board, the ops board, the import
 * preview, `DataTable`. Every one of them scrolled with a mouse wheel or a
 * finger and could not be scrolled at all with a keyboard, because a plain
 * `<div>` is not focusable and arrow keys go to whatever is.
 *
 * On a phone that is the difference between seeing three columns of a
 * comparison table and seeing all six. Axe found it on the mobile project
 * and not on desktop, which is exactly right — desktop is wide enough that
 * nothing overflows, so the bug only exists where it is hardest to notice.
 *
 * ── Why it is always focusable ───────────────────────────────────────────
 *
 * The alternative is measuring `scrollWidth > clientWidth` and adding
 * `tabIndex` only when it is true. That needs a resize observer, it is
 * wrong for one frame on every mount, and it makes the tab order depend on
 * the viewport — so a keyboard user's muscle memory changes when they
 * rotate their phone. A labelled region that is always reachable is the
 * behaviour WCAG 2.1.1 is asking for, and one extra tab stop in front of a
 * table is a fair price.
 *
 * `role="region"` with a name, rather than a bare `tabIndex`: a focus stop
 * that announces nothing is its own accessibility problem, and a screen
 * reader should say what the thing is when it lands there.
 */
export function ScrollRegion({
  label,
  className,
  children,
}: {
  /** What a screen reader says on landing here, e.g. "Plan comparison". */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn("hl-focusable overflow-x-auto", className)}
    >
      {children}
    </div>
  );
}
