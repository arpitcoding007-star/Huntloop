"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import { Button, type ButtonSize } from "./Button";
import { cn } from "../utils/cn";

/**
 * A destructive control that asks once before acting.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * Eleven destructive Server Actions fired on a single click with no
 * confirmation and no undo: deleting a company, a memory, a campaign, a
 * sequence step, an ICP, a persona, a product, a scoring rule; removing a
 * team member; revoking an invitation; disconnecting HubSpot. Every one of
 * them was an icon-only 28px button in a list row, which on a phone sits
 * next to the row's own tap target.
 *
 * ── Why a second click and not a dialog, and not an undo ────────────────
 *
 * Sources already solved this with an undo (`Confirmed`, tagged UX-14), and
 * undo is the better pattern where it fits — it costs the user nothing in
 * the common case. It fits there because `restoreSourceAction` exists. The
 * other ten would each need a restore action, a restored-state banner and a
 * piece of "what did I just delete" state held in the component, which is
 * ten opportunities to get one of them wrong.
 *
 * A modal is the other conventional answer and is worse here: it steals
 * focus, needs its own focus trap and escape handling, and for "remove this
 * row" it asks the user to read a paragraph to confirm something they can
 * see. Two clicks in place is proportionate to the consequence — every one
 * of these deletes is soft at the database level, so the cost of a mistake
 * is a support request, not lost data.
 *
 * ── The arming rules, which are the whole design ────────────────────────
 *
 * An armed button that stays armed is a trap: the user moves on, comes back,
 * and their next click deletes something. So arming is deliberately fragile —
 * it disarms on a timer, on blur, and on Escape. The only way to reach the
 * destructive call is two deliberate clicks close together.
 *
 * ── Touch target ────────────────────────────────────────────────────────
 *
 * The visible control stays on the design system's 32px scale, and an
 * invisible inset overlay takes the hit area past 44px. Growing the button
 * itself would change row height everywhere these appear; growing only what
 * the finger has to find costs nothing and is what the guidance is actually
 * about.
 */
export interface ConfirmButtonProps {
  /** The icon for the resting state. Icon-only until armed. */
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  /** Accessible name at rest, e.g. "Remove Acme". */
  label: string;
  /** Visible text once armed. Short — it sits in a table row. */
  confirmLabel?: string;
  onConfirm: () => void;
  disabled?: boolean;
  pending?: boolean;
  size?: ButtonSize;
  /** How long the armed state survives without a second click. */
  armedMs?: number;
  className?: string;
}

export function ConfirmButton({
  icon: Icon,
  label,
  confirmLabel = "Confirm",
  onConfirm,
  disabled,
  pending,
  size = "md",
  armedMs = 4000,
  className,
}: ConfirmButtonProps) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Cleared on unmount as well as on disarm: a row removed from the list
     while its button is armed would otherwise leave a timer holding a
     setState on a component that no longer exists. */
  useEffect(() => {
    if (!armed) return;
    timer.current = setTimeout(() => setArmed(false), armedMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [armed, armedMs]);

  /*
   * One button in both states, rather than two swapped out.
   *
   * The first version rendered a separate armed button and reached for
   * `autoFocus` to keep the keyboard on it — which `jsx-a11y/no-autofocus`
   * flags, correctly in general and awkwardly here, since focus was already
   * on the element being replaced and would otherwise fall to `<body>`.
   *
   * Keeping one element removes the question. Focus never moves because the
   * node never changes; the variant, the label and the children do. The
   * disarm-on-blur handler then means what it says — the user actually left
   * — instead of firing on a swap.
   */
  return (
    <>
      {/*
        The armed state, announced.
        A screen reader will not reliably re-read the accessible name of an
        element that is already focused, so the state change is put in a live
        region instead of relying on the label change alone.
      */}
      <span className="sr-only" role="status">
        {armed ? `${label} — press again to confirm, or press Escape to cancel.` : ""}
      </span>
      <Button
        size={size}
        variant={armed ? "danger" : "ghost"}
        icon={Icon}
        aria-label={armed ? undefined : label}
        disabled={disabled || pending}
        className={cn(
          /* Invisible hit-area expansion: 32px visible, 48px tappable. The
             row height stays where the design system put it. */
          "relative after:absolute after:-inset-2 after:content-['']",
          className,
        )}
        onClick={() => {
          if (!armed) {
            setArmed(true);
            return;
          }
          setArmed(false);
          onConfirm();
        }}
        onBlur={() => setArmed(false)}
        onKeyDown={(e) => {
          if (armed && e.key === "Escape") {
            e.stopPropagation();
            setArmed(false);
          }
        }}
      >
        {armed ? (pending ? "Working…" : confirmLabel) : undefined}
      </Button>
    </>
  );
}

