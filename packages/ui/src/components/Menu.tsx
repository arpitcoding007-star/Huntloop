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

type IconType = ComponentType<{ className?: string; strokeWidth?: number }>;

export interface MenuChoice {
  value: string;
  label: string;
  icon: IconType;
}

export interface MenuItem {
  label: string;
  icon?: IconType;
  /** A destination. Renders an anchor — mutually exclusive with `onSelect`. */
  href?: string;
  /** Opens `href` in a new tab. For destinations outside the product. */
  external?: boolean;
  onSelect?: () => void;
  /** Right-aligned secondary text — a keyboard shortcut, usually. */
  hint?: string;
  /** Destructive actions are the last item and the only coloured one. */
  tone?: "default" | "danger";
  disabled?: boolean;
  /** Draws a rule above this item. For separating a group, not decoration. */
  separated?: boolean;
  /**
   * Renders the row as an inline, icon-only single choice — the label on
   * the left, one `menuitemradio` per choice on the right. For a setting
   * with two to four options that is changed from the menu itself (theme),
   * where a submenu would be a second menu to open for one click.
   */
  choices?: {
    options: MenuChoice[];
    value: string | null;
    onChange: (value: string) => void;
  };
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
  /** Non-interactive content above the items — who is signed in, say. */
  header?: ReactNode;
  /** Accessible name for the menu. Defaults to nothing, as before. */
  label?: string;
  /** Which edge of the trigger the menu lines up with. */
  align?: "start" | "end";
  /** Above or below the trigger. Flips automatically when there is no room. */
  side?: "top" | "bottom";
  linkComponent?: LinkComponent;
  className?: string;
}

/** One focus stop: a whole item, or one choice inside a `choices` row. */
interface Stop {
  item: number;
  choice?: number;
}

/**
 * A dropdown menu.
 *
 * ── Positioning ─────────────────────────────────────────────────────────
 *
 * Fixed, from the trigger's measured rect, rather than absolute inside a
 * relatively positioned wrapper. Every place this component is actually
 * used — a table row's overflow control, the top bar's account menu, a card
 * header — is inside something with `overflow: hidden` or `overflow: auto`,
 * and an absolutely positioned menu is clipped by the first such ancestor.
 * That is the bug this avoids, and it is worth the measurement.
 *
 * If the menu would run off the bottom of the viewport and there is more
 * room above, it opens upward; horizontally it is clamped inside the
 * viewport; and if it is taller than the room on either side, it caps its
 * own height and scrolls, so no item is ever unreachable off-screen.
 *
 * ── Keyboard ────────────────────────────────────────────────────────────
 *
 * `role="menu"` commits to a specific contract, so the contract is
 * implemented rather than half-implemented: arrows move within the menu
 * (Home/End to the ends), the items are not individually tabbable, Tab and
 * Escape both close, and focus returns to the trigger. A `role="menu"` you
 * can only operate with Tab is worse than a list of buttons, because it has
 * told the screen reader to expect the arrow keys.
 *
 * A `choices` row contributes one stop per option, so Up/Down walk through
 * them like any other item, and Left/Right move within the row.
 */
export function Menu({
  trigger,
  items,
  header,
  label,
  align = "end",
  side = "bottom",
  linkComponent: Link = Anchor,
  className,
}: MenuProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  /** Index into `stops`. -1 = nothing focused yet, so the first ArrowDown lands on 0. */
  const [cursor, setCursor] = useState(-1);

  const triggerEl = useRef<HTMLElement | null>(null);
  const menuEl = useRef<HTMLDivElement>(null);
  const stopEls = useRef<(HTMLElement | null)[]>([]);

  const stops: Stop[] = [];
  items.forEach((item, i) => {
    if (item.disabled) return;
    if (item.choices) item.choices.options.forEach((_, c) => stops.push({ item: i, choice: c }));
    else stops.push({ item: i });
  });
  const stopIndex = (item: number, choice?: number) =>
    stops.findIndex((s) => s.item === item && s.choice === choice);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    setCursor(-1);
    setPos(null);
    if (restoreFocus) triggerEl.current?.focus();
  }, []);

  /* Measured after layout and before paint, so the menu never renders one
     frame at the wrong place. */
  useLayoutEffect(() => {
    if (!open) return;
    const t = triggerEl.current?.getBoundingClientRect();
    const m = menuEl.current;
    if (!t || !m) return;

    const EDGE = 8;
    const GAP = 6;
    const height = m.scrollHeight;
    const width = m.getBoundingClientRect().width;
    const roomBelow = window.innerHeight - t.bottom - GAP - EDGE;
    const roomAbove = t.top - GAP - EDGE;

    const openDown =
      side === "bottom" ? height <= roomBelow || roomBelow >= roomAbove : !(height <= roomAbove || roomAbove >= roomBelow);
    const maxHeight = Math.max(120, openDown ? roomBelow : roomAbove);
    const shown = Math.min(height, maxHeight);

    const top = openDown ? t.bottom + GAP : t.top - GAP - shown;
    const rawLeft = align === "end" ? t.right - width : t.left;
    /* Clamped into the viewport, so a trigger near the right edge does not
       push the menu off-screen. */
    const left = Math.min(Math.max(EDGE, rawLeft), Math.max(EDGE, window.innerWidth - width - EDGE));

    setPos({ top, left, maxHeight });
  }, [open, align, side, items.length]);

  /* Dismissal: a click anywhere outside, or the page moving under it. A
     menu that stays pinned to where the trigger *was* after a scroll is the
     single most common bug in fixed-positioned popovers. A scroll *inside*
     the menu (when it is capped and scrolls) is not the page moving. */
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (menuEl.current?.contains(target)) return;
      if (triggerEl.current?.contains(target)) return;
      close(false);
    };
    const onScroll = (e: Event) => {
      if (menuEl.current && e.target instanceof Node && menuEl.current.contains(e.target)) return;
      close(false);
    };
    const onResize = () => close(false);

    document.addEventListener("pointerdown", onPointerDown, true);
    // `capture: true` so a scroll inside any container, not just the window,
    // dismisses it.
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, close]);

  /* Move DOM focus to match the cursor, so the screen reader follows. Until
     an arrow key is pressed, focus sits on the menu itself so its keydown
     handler — and Escape — work straight after a pointer open. */
  useEffect(() => {
    if (!open || !pos) return;
    if (cursor >= 0) stopEls.current[cursor]?.focus();
    else menuEl.current?.focus();
  }, [open, pos, cursor]);

  const step = (delta: number) => {
    if (stops.length === 0) return;
    const next = cursor === -1 ? (delta > 0 ? 0 : stops.length - 1) : cursor + delta;
    // Wraps: from the last item, down goes to the first.
    setCursor(((next % stops.length) + stops.length) % stops.length);
  };

  /** Left/Right inside a choices row; elsewhere they do nothing. */
  const stepWithinRow = (delta: number) => {
    const at = stops[cursor];
    if (!at || at.choice === undefined) return;
    const count = items[at.item]?.choices?.options.length ?? 0;
    const target = stopIndex(at.item, (((at.choice + delta) % count) + count) % count);
    if (target >= 0) setCursor(target);
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
      case "ArrowRight":
        e.preventDefault();
        stepWithinRow(1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        stepWithinRow(-1);
        break;
      case "Home":
        e.preventDefault();
        if (stops.length) setCursor(0);
        break;
      case "End":
        e.preventDefault();
        if (stops.length) setCursor(stops.length - 1);
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

  const rowClasses = (item: MenuItem) =>
    cn(
      "hl-focusable flex h-8 w-full items-center gap-2.5 rounded-sm px-2 text-left text-[13px]",
      "transition-colors duration-[120ms]",
      item.disabled
        ? "cursor-not-allowed text-fg-muted/60"
        : item.tone === "danger"
          ? "text-danger hover:bg-danger-surface focus-visible:bg-danger-surface"
          : "text-fg-secondary hover:bg-hover hover:text-fg focus-visible:bg-hover focus-visible:text-fg",
    );

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
          aria-label={label}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          style={{
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            maxHeight: pos?.maxHeight,
          }}
          className={cn(
            "fixed z-[80] min-w-[180px] overflow-y-auto overscroll-contain rounded-lg border border-line bg-panel p-1 shadow-popover outline-none",
            // Hidden until measured, rather than rendered off-screen and
            // moved: a menu that visibly jumps on open reads as a bug.
            pos ? "opacity-100" : "opacity-0",
            className,
          )}
        >
          {header && (
            <div role="none" className="border-b border-line-subtle px-2 pt-1.5 pb-2.5 mb-1">
              {header}
            </div>
          )}

          {items.map((item, i) => {
            const Icon = item.icon;
            const rule = item.separated && i > 0 && (
              <hr aria-hidden className="my-1 border-0 border-t border-line-subtle" />
            );

            if (item.choices) {
              const { options, value, onChange } = item.choices;
              return (
                <div key={item.label} role="group" aria-label={item.label}>
                  {rule}
                  <div className="flex h-9 items-center gap-2.5 px-2 text-[13px] text-fg-secondary">
                    {Icon && <Icon className="size-4 shrink-0" strokeWidth={1.6} />}
                    <span aria-hidden className="min-w-0 flex-1 truncate">
                      {item.label}
                    </span>
                    <div className="flex items-center gap-0.5 rounded-[8px] border border-line-subtle bg-surface p-0.5">
                      {options.map((option, c) => {
                        const at = stopIndex(i, c);
                        const checked = value === option.value;
                        const OptionIcon = option.icon;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            role="menuitemradio"
                            aria-checked={checked}
                            aria-label={option.label}
                            title={option.label}
                            tabIndex={cursor === at ? 0 : -1}
                            ref={(el) => {
                              stopEls.current[at] = el;
                            }}
                            /* Stays open: the point of an inline choice is
                               to see the effect and keep going. */
                            onClick={() => {
                              onChange(option.value);
                              setCursor(at);
                            }}
                            className={cn(
                              "hl-focusable flex size-6 items-center justify-center rounded-[6px] transition-colors duration-[120ms]",
                              checked
                                ? "bg-toolbar-hover text-fg"
                                : "text-fg-muted hover:bg-hover hover:text-fg",
                            )}
                          >
                            <OptionIcon className="size-3.5" strokeWidth={1.75} />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            }

            const at = stopIndex(i);
            const content = (
              <>
                {Icon && <Icon className="size-4 shrink-0" strokeWidth={1.6} />}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.hint && (
                  <kbd className="shrink-0 font-sans text-[11.5px] text-fg-muted">{item.hint}</kbd>
                )}
              </>
            );

            return (
              <div key={item.label}>
                {rule}
                {item.href && !item.disabled ? (
                  <Link
                    href={item.href}
                    role="menuitem"
                    tabIndex={cursor === at ? 0 : -1}
                    {...(item.external ? { target: "_blank", rel: "noreferrer" } : {})}
                    ref={(el: HTMLElement | null) => {
                      stopEls.current[at] = el;
                    }}
                    onClick={() => close(false)}
                    className={rowClasses(item)}
                  >
                    {content}
                  </Link>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={at >= 0 && cursor === at ? 0 : -1}
                    disabled={item.disabled}
                    ref={(el) => {
                      if (at >= 0) stopEls.current[at] = el;
                    }}
                    onClick={() => {
                      if (item.disabled) return;
                      item.onSelect?.();
                      close();
                    }}
                    className={rowClasses(item)}
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
