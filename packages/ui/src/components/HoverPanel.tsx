"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { cn } from "../utils/cn";

/**
 * A small explanation panel that opens on hover, on keyboard focus, and on tap,
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
 *
 * ── The two states, and why there are two ────────────────────────────────
 *
 * `hover` is the pointer case and behaves like a tooltip: it follows the
 * cursor's arrival and departure, and it does not take pointer events, so
 * moving the mouse toward it does not trap the cursor in a panel the user was
 * only passing over.
 *
 * `pinned` is what a tap or a click produces, and it is the state this
 * component was missing. A touch device has no hover: the panel opened on the
 * synthetic mouse events some browsers emit and closed on the next touch
 * anywhere, which on a phone made §51's explanation unreadable — the two
 * places the product's central claim is discharged, unreachable on the device
 * most likely to be reading them.
 *
 * Pinned takes pointer events, which is the other half of UX-13. The panel has
 * always carried `overflow-y-auto` for content taller than the viewport and
 * `pointer-events-none` alongside it, which are a contradiction: a panel that
 * advertises scrolling and refuses the pointer cannot be scrolled. Only the
 * pinned state can be scrolled, and only the pinned state accepts the pointer.
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

type Mode = "closed" | "hover" | "pinned";

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
  const panelRef = useRef<HTMLSpanElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [mode, setMode] = useState<Mode>("closed");
  const panelId = useId();

  const measure = useCallback(() => {
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

  /**
   * Set while Escape's returned focus is still landing on the trigger.
   *
   * Without it, Escape is self-cancelling: closing the panel and putting focus
   * back where the user was — which is the correct thing to do — fires
   * `onFocus`, which re-opens it as a hover panel. The dismissal has to
   * outlive the focus it causes.
   */
  const dismissedRef = useRef(false);

  const openHover = useCallback(() => {
    if (dismissedRef.current) return;
    /* A pinned panel is not disturbed by the pointer wandering over its
       trigger. Tapping produces synthetic mouse events on many browsers, and
       without this the tap that pinned it would immediately re-open it as a
       hover and the next one would close it. */
    setMode((current) => (current === "pinned" ? current : "hover"));
    measure();
  }, [measure]);

  const closeHover = useCallback(() => {
    /* Leaving the trigger entirely clears the dismissal, so coming back opens
       it again. Escape means "not now", not "never again". */
    dismissedRef.current = false;
    setMode((current) => (current === "pinned" ? current : "closed"));
  }, []);

  const togglePin = useCallback(() => {
    dismissedRef.current = false;
    setMode((current) => {
      if (current === "pinned") return "closed";
      measure();
      return "pinned";
    });
  }, [measure]);

  const close = useCallback(() => setMode("closed"), []);

  /* Dismissal for the pinned state only. A hover panel closes when the pointer
     leaves and needs none of this; a pinned one has to be closable by the
     three gestures people already expect — Escape, a click elsewhere, and
     pressing the trigger again — because on a phone there is no "elsewhere"
     that generates a mouseleave. */
  useEffect(() => {
    if (mode !== "pinned") return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dismissedRef.current = true;
        close();
        triggerRef.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      close();
    };
    /* Re-measured rather than closed. The panel is anchored to a trigger that
       moves with the page, and a pinned panel left behind at its old
       coordinates is worse than one that follows. */
    const onReflow = () => measure();

    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, [mode, close, measure]);

  const isOpen = mode !== "closed" && placement !== null;

  return (
    <span className={cn("relative inline-flex", className)}>
      <span
        ref={triggerRef}
        tabIndex={0}
        role="button"
        aria-label={label}
        aria-expanded={mode === "pinned"}
        aria-describedby={isOpen ? panelId : undefined}
        onMouseEnter={openHover}
        onMouseLeave={closeHover}
        onFocus={openHover}
        onBlur={closeHover}
        onClick={togglePin}
        onKeyDown={(event) => {
          // A `role="button"` that does not answer Enter and Space is a button
          // in name only, and this is the keyboard route to the pinned state.
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          togglePin();
        }}
        className={cn("hl-focusable cursor-help", triggerClassName)}
        style={triggerStyle}
      >
        {children}
      </span>

      {isOpen && (
        <span
          ref={panelRef}
          id={panelId}
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
            "z-50 overflow-y-auto rounded-lg border border-line bg-panel p-3",
            "shadow-[0_8px_24px_rgba(0,0,0,0.4)]",
            /* Only the pinned panel takes the pointer. A hover panel that did
               would trap a cursor merely passing over it, and would close
               itself the moment the pointer crossed the gap. */
            mode === "pinned" ? "pointer-events-auto" : "pointer-events-none",
          )}
        >
          {panel}
        </span>
      )}
    </span>
  );
}
