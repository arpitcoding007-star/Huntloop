"use client";

import { useCallback, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "../utils/cn";

/**
 * A small explanation panel that opens on hover AND keyboard focus, and is
 * positioned so it always lands on screen.
 *
 * This exists because CSS alone cannot do it. Both `ScorePill` and
 * `PriorityBadge` previously anchored their panel statically, and every
 * static anchor fails somewhere: measured on the Command Center, centring
 * clipped 64px off the right at 1280 and 82px at 375; right-anchoring then
 * clipped 209px off the *left* when the trigger had wrapped to the start of a
 * line; and `position: fixed` with `top: auto` resolves against the unscrolled
 * container, dropping the panel ~800px below its trigger. So the placement is
 * measured at open time and clamped to the viewport.
 *
 * Why this matters more than a normal tooltip nit: master context §51 and §77
 * Principle 4 require the score and the priority verdict to be explainable,
 * and an explanation the user cannot read has not been given.
 */
export interface HoverPanelProps {
  /** Accessible name for the trigger — the full explanation, read in one go. */
  label: string;
  /** Trigger content (the pill, the badge). */
  children: ReactNode;
  /** Panel content. */
  panel: ReactNode;
  /** Preferred panel width in px; clamped to the viewport on small screens. */
  width?: number;
  triggerClassName?: string;
  triggerStyle?: CSSProperties;
  className?: string;
}

/** Gap between trigger and panel, and the minimum margin to any viewport edge. */
const GAP = 8;
const EDGE = 16;
/** Below this much room underneath the trigger, the panel flips above it. */
const MIN_BELOW = 160;

type Placement = {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
};

export function HoverPanel({
  label,
  children,
  panel,
  width = 288,
  triggerClassName,
  triggerStyle,
  className,
}: HoverPanelProps) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  const open = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const w = Math.min(width, vw - EDGE * 2);
    // Prefer right-aligned with the trigger — scores and verdicts sit at the
    // right of a row — then clamp into the viewport from both sides.
    const left = Math.min(Math.max(EDGE, r.right - w), vw - EDGE - w);

    const roomBelow = vh - r.bottom - GAP - EDGE;
    setPlacement(
      roomBelow >= MIN_BELOW
        ? { left, width: w, top: r.bottom + GAP, maxHeight: roomBelow }
        : { left, width: w, bottom: vh - r.top + GAP, maxHeight: r.top - GAP - EDGE },
    );
  }, [width]);

  const close = useCallback(() => setPlacement(null), []);

  return (
    <span className={cn("relative inline-flex", className)}>
      <span
        ref={triggerRef}
        tabIndex={0}
        role="button"
        aria-label={label}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        className={cn("hl-focusable cursor-help", triggerClassName)}
        style={triggerStyle}
      >
        {children}
      </span>

      {placement && (
        <span
          role="tooltip"
          // Fixed, with an explicit top/bottom, so a scrolling ancestor can
          // neither clip it nor offset it from its trigger.
          style={{
            position: "fixed",
            left: placement.left,
            width: placement.width,
            top: placement.top,
            bottom: placement.bottom,
            maxHeight: placement.maxHeight,
          }}
          className={cn(
            "pointer-events-none z-50 overflow-y-auto rounded-lg border border-line bg-panel p-3",
            "shadow-[0_8px_24px_rgba(0,0,0,0.4)]",
          )}
        >
          {panel}
        </span>
      )}
    </span>
  );
}
