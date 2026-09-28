"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "../utils/cn";

export type ModalSize = "sm" | "md" | "lg";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Sub-heading under the title. Announced as the dialog's description. */
  description?: ReactNode;
  children?: ReactNode;
  /** The action row. Primary action last, as everywhere else in the system. */
  footer?: ReactNode;
  size?: ModalSize;
  /**
   * Suppresses backdrop-click and Escape dismissal.
   *
   * For the one case that earns it: a dialog whose work is already underway
   * and cannot be abandoned half-done. Not for "are you sure" — a confirm
   * dialog the user cannot back out of is a trap, and the cancel button is
   * right there.
   */
  dismissible?: boolean;
  className?: string;
}

const SIZES: Record<ModalSize, string> = {
  sm: "max-w-[400px]",
  md: "max-w-[520px]",
  lg: "max-w-[720px]",
};

/**
 * A modal dialog, built on the native `<dialog>` element.
 *
 * ── Why native, and not a div with `role="dialog"` ──────────────────────
 *
 * Because `showModal()` gives, for free, the four things hand-rolled modals
 * consistently get wrong: the rest of the document goes inert (so a screen
 * reader cannot wander out of the dialog and a Tab cannot land behind it),
 * focus moves in and is trapped, Escape closes, and the dialog is promoted
 * to the top layer — above every `z-index` on the page, including the
 * sidebar's rail tooltip, without joining the z-index arms race.
 *
 * The parts that still need writing are the parts the platform leaves open:
 * the backdrop click (the element's own click target spans the backdrop, so
 * "outside" has to be measured against the panel's rect), and telling React
 * about a close the browser performed itself.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  dismissible = true,
  className,
}: ModalProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;
  const ref = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  /* Drive the element from the prop. `showModal()` is not idempotent — it
     throws if the dialog is already open — so both directions check first. */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  /*
   * Escape is handled by the browser, which fires `cancel` and then closes
   * the element without telling React. Left alone, the dialog vanishes while
   * `open` stays true, and the next `open={true}` render is a no-op — the
   * dialog can never be reopened. Preventing the default and routing through
   * `onClose` keeps the element's state and the prop in step.
   */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onCancel = (e: Event) => {
      e.preventDefault();
      if (dismissible) onClose();
    };

    /* True only while a press is in progress that began on the backdrop. */
    let pressedOutside = false;

    const outside = (e: MouseEvent) => {
      const box = panel.current?.getBoundingClientRect();
      if (!box) return false;
      return (
        e.clientX < box.left ||
        e.clientX > box.right ||
        e.clientY < box.top ||
        e.clientY > box.bottom
      );
    };

    const onMouseDown = (e: MouseEvent) => {
      pressedOutside = outside(e);
    };
    const onClick = (e: MouseEvent) => {
      if (dismissible && pressedOutside && outside(e)) onClose();
      pressedOutside = false;
    };

    el.addEventListener("cancel", onCancel);
    el.addEventListener("mousedown", onMouseDown);
    el.addEventListener("click", onClick);
    return () => {
      el.removeEventListener("cancel", onCancel);
      el.removeEventListener("mousedown", onMouseDown);
      el.removeEventListener("click", onClick);
    };
  }, [dismissible, onClose]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      className={cn(
        // The element's own box is the full viewport; the visible panel is
        // the div inside. `open:flex` because <dialog> is display:none until
        // it is open, and a flex display would override that.
        "m-0 h-full max-h-none w-full max-w-none bg-transparent p-4 open:flex",
        "items-center justify-center",
        // Styling the backdrop is the one thing that must reach outside the
        // element, and the pseudo-element is how.
        "backdrop:bg-overlay backdrop:backdrop-blur-[2px]",
      )}
    >
      <div
        ref={panel}
        className={cn(
          "flex max-h-full w-full flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-modal",
          // Entrance. `open:` rather than a mount transition, because the
          // element is in the DOM the whole time.
          "duration-[280ms] ease-emphasis motion-reduce:transition-none",
          SIZES[size],
          className,
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line-subtle px-5 py-4">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="font-display text-base font-semibold tracking-heading text-fg"
            >
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-1 text-[13px] text-fg-muted">
                {description}
              </p>
            )}
          </div>
          {dismissible && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="hl-focusable -mt-1 -mr-1 flex size-7 shrink-0 items-center justify-center rounded-sm text-fg-muted transition-colors duration-[120ms] hover:bg-hover hover:text-fg"
            >
              <X className="size-4" strokeWidth={1.75} />
            </button>
          )}
        </header>

        {children && (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-[13px] leading-[1.6] text-fg-secondary">
            {children}
          </div>
        )}

        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-line-subtle px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </dialog>
  );
}
