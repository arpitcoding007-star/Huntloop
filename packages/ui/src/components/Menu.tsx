"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { cn } from "../utils/cn";
import { Anchor, type LinkComponent } from "../utils/link";

export interface MenuItem {
  label: string;
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>;
  /** A destination. Renders an anchor — mutually exclusive with `onSelect`. */
  href?: string;
  onSelect?: () => void;
  /** Destructive actions are the last item and the only coloured one. */
  tone?: "default" | "danger";
  disabled?: boolean;
  /** Draws a rule above this item. For separating a group, not decoration. */
  separated?: boolean;
}

export interface MenuProps {
  /**
   * The control that opens the menu. Receives the props it must spread —
   * a render prop rather than a cloned child, because cloning breaks the
   * moment the trigger is wrapped in anything.
   */
  trigger: (props: {
    ref: (el: HTMLElement | null) => void;
    onClick: () => void;
    "aria-haspopup": "menu";
    "aria-expanded": boolean;
    "aria-controls": string | undefined;
  }) => ReactNode;
  items: MenuItem[];
  /** Which edge of the trigger the menu lines up with. */
  align?: "start" | "end";
  /** Above or below the trigger. Flips automatically when there is no room. */
  side?: "top" | "bottom";
  linkComponent?: LinkComponent;
  className?: string;
}

/**
 * A dropdown menu.
 *
 * ── Positioning ─────────────────────────────────────────────────────────
 *
 * Fixed, from the trigger's measured rect, rather than absolute inside a
 * relatively positioned wrapper. Every place this component is actually
 * used — a table row's overflow control, the sidebar's account row, a card
 * header — is inside something with `overflow: hidden` or `overflow: auto`,
 * and an absolutely positioned menu is clipped by the first such ancestor.
 * That is the bug this avoids, and it is worth the measurement.
 *
 * The flip is deliberate but minimal: if the menu would run off the bottom
 * of the viewport and there is more room above, it opens upward. No
 * collision handling beyond that — this is a menu of five items, not a
 * combobox, and a full positioning engine here would be more code than the
 * component.
 *
 * ── Keyboard ────────────────────────────────────────────────────────────
 *
 * `role="menu"` commits to a specific contract, so the contract is
 * implemented rather than half-implemented: arrows move within the menu
 * (Home/End to the ends), the items are not individually tabbable, Tab and
 * Escape both close, and focus returns to the trigger. A `role="menu"` you
 * can only operate with Tab is worse than a list of buttons, because it has
 * told the screen reader to expect the arrow keys.
 */
export function Menu({
  trigger,
  items,
  align = "end",
  side = "bottom",
  linkComponent: Link = Anchor,
  className,
}: MenuProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  /** -1 = nothing focused yet, so the first ArrowDown lands on item 0. */
  const [cursor, setCursor] = useState(-1);

  const triggerEl = useRef<HTMLElement | null>(null);
  const menuEl = useRef<HTMLDivElement>(null);
  const itemEls = useRef<(HTMLElement | null)[]>([]);

  const enabled = items
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => !item.disabled);

  const close = useCallback(
    (restoreFocus = true) => {
      setOpen(false);
      setCursor(-1);
      if (restoreFocus) triggerEl.current?.focus();
    },
    [],
  );

  /* Measured after layout and before paint, so the menu never renders one
     frame at the wrong place. */
  useLayoutEffect(() => {
    if (!open) return;
    const t = triggerEl.current?.getBoundingClientRect();
    const m = menuEl.current?.getBoundingClientRect();
    if (!t) return;

    const height = m?.height ?? 0;
    const width = m?.width ?? 0;
    const GAP = 6;

    const belowFits = t.bottom + GAP + height <= window.innerHeight - 8;
    const openDown = side === "bottom" ? belowFits || t.top < height : !(t.top - GAP - height >= 8);

    const top = openDown ? t.bottom + GAP : t.top - GAP - height;
    const rawLeft = align === "end" ? t.right - width : t.left;
    /* Clamped into the viewport, so a trigger near the right edge does not
       push the menu off-screen. */
    const left = Math.min(Math.max(8, rawLeft), Math.max(8, window.innerWidth - width - 8));

    setPos({ top, left });
  }, [open, align, side, items.length]);

  /* Dismissal: a click anywhere outside, or the page moving under it. A
     menu that stays pinned to where the trigger *was* after a scroll is the
     single most common bug in fixed-positioned popovers. */
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (menuEl.current?.contains(target)) return;
      if (triggerEl.current?.contains(target)) return;
      close(false);
    };
    const onScrollOrResize = () => close(false);

    document.addEventListener("pointerdown", onPointerDown, true);
    // `capture: true` so a scroll inside any container, not just the window,
    // dismisses it.
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, close]);

  /* Move DOM focus to match the cursor, so the screen reader follows. */
  useEffect(() => {
    if (open && cursor >= 0) itemEls.current[cursor]?.focus();
  }, [open, cursor]);

  const step = (delta: number) => {
    if (enabled.length === 0) return;
    const at = enabled.findIndex(({ i }) => i === cursor);
    const next = at === -1 ? (delta > 0 ? 0 : enabled.length - 1) : at + delta;
    // Wraps: from the last item, down goes to the first.
    const wrapped = ((next % enabled.length) + enabled.length) % enabled.length;
    const target = enabled[wrapped];
    if (target) setCursor(target.i);
  };

  /** Jump to the first or last selectable item — Home and End. */
  const jump = (edge: "first" | "last") => {
    const target = edge === "first" ? enabled[0] : enabled[enabled.length - 1];
    if (target) setCursor(target.i);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        step(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        step(-1);
        break;
      case "Home":
        e.preventDefault();
        jump("first");
        break;
      case "End":
        e.preventDefault();
        jump("last");
        break;
      case "Escape":
        e.preventDefault();
        close();
        break;
      case "Tab":
        // Not prevented: Tab should leave, and leaving should close.
        close(false);
        break;
    }
  };

  return (
    <>
      {trigger({
        ref: (el) => {
          triggerEl.current = el;
        },
        onClick: () => (open ? close() : (setOpen(true), setCursor(-1))),
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "aria-controls": open ? id : undefined,
      })}

      {open && (
        <div
          ref={menuEl}
          id={id}
          role="menu"
          tabIndex={-1}
          onKeyDown={onKeyDown}
          style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
          className={cn(
            "fixed z-[80] min-w-[180px] rounded-lg border border-line bg-panel p-1 shadow-popover",
            // Hidden until measured, rather than rendered off-screen and
            // moved: a menu that visibly jumps on open reads as a bug.
            pos ? "opacity-100" : "opacity-0",
            className,
          )}
        >
          {items.map((item, i) => {
            const Icon = item.icon;
            const content = (
              <>
                {Icon && <Icon className="size-4 shrink-0" strokeWidth={1.6} />}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </>
            );

            const classes = cn(
              "hl-focusable flex h-8 w-full items-center gap-2.5 rounded-sm px-2 text-left text-[13px]",
              "transition-colors duration-[120ms]",
              item.disabled
                ? "cursor-not-allowed text-fg-muted/60"
                : item.tone === "danger"
                  ? "text-danger hover:bg-danger-surface"
                  : "text-fg-secondary hover:bg-surface-hover hover:text-fg",
            );

            return (
              <div key={item.label}>
                {item.separated && i > 0 && (
                  <hr aria-hidden className="my-1 border-0 border-t border-line-subtle" />
                )}
                {item.href && !item.disabled ? (
                  <Link
                    href={item.href}
                    role="menuitem"
                    tabIndex={cursor === i ? 0 : -1}
                    ref={(el: HTMLElement | null) => {
                      itemEls.current[i] = el;
                    }}
                    onClick={() => close(false)}
                    className={classes}
                  >
                    {content}
                  </Link>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={cursor === i ? 0 : -1}
                    disabled={item.disabled}
                    ref={(el) => {
                      itemEls.current[i] = el;
                    }}
                    onClick={() => {
                      if (item.disabled) return;
                      item.onSelect?.();
                      close();
                    }}
                    className={classes}
                  >
                    {content}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
