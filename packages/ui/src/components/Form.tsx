"use client";

import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "../utils/cn";

/**
 * Form primitives.
 *
 * These exist because the app went from two forms to roughly forty in one
 * release, and the alternative was forty copies of
 *
 *   "hl-focusable mt-1.5 h-10 w-full rounded-md border border-line bg-surface
 *    px-3 text-[14px] text-fg placeholder:text-fg-muted"
 *
 * — which is not a design system, it is a design system's shadow. The class
 * strings here are lifted verbatim from `OrgForm`, so nothing about the look
 * changes; what changes is that there is now one place to change it.
 *
 * The part that is not cosmetic is `Field`. It wires the label, the hint and
 * the error to the control with real ids and `aria-describedby`, which is the
 * half that hand-rolled forms consistently omit — a screen reader user
 * otherwise hears "Website, edit text" and never hears "must start with
 * https://" or "that address is not valid".
 */

export interface FieldProps {
  label: ReactNode;
  /** Explanatory text under the control. Announced with the input. */
  hint?: ReactNode;
  /** Validation failure. Announced with the input and marks it invalid. */
  error?: string;
  required?: boolean;
  className?: string;
  /**
   * Receives the ids to put on the control. A render prop rather than cloning
   * the child: cloning breaks the moment the control is wrapped in anything,
   * and this form is explicit about which element is the labelled one.
   */
  children: (props: {
    id: string;
    "aria-describedby": string | undefined;
    "aria-invalid": boolean | undefined;
    required: boolean | undefined;
  }) => ReactNode;
}

export function Field({
  label,
  hint,
  error,
  required,
  className,
  children,
}: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className={className}>
      <label
        htmlFor={id}
        className="block text-[11px] leading-4 font-medium tracking-label text-fg-muted uppercase"
      >
        {label}
        {required && (
          <span aria-hidden className="ml-1 text-danger">
            *
          </span>
        )}
      </label>

      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        required: required || undefined,
      })}

      {hint && !error && (
        <p id={hintId} className="mt-1.5 text-[12px] text-fg-muted">
          {hint}
        </p>
      )}
      {error && (
        /* `role="alert"` so a failure that appears after submit is announced
           rather than silently rendered below the fold. */
        <p id={errorId} role="alert" className="mt-1.5 text-[12px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/*
 * One control surface, four controls.
 *
 * `bg-panel` rather than `bg-surface`: a form sits inside a Card, which is
 * already `--hl-surface`, and an input painted the same value as the card
 * behind it is a rectangle defined entirely by its 1px border. Dropping the
 * field one step down the ramp makes it read as a well — the thing you type
 * into — in both themes, and it is the reason the light theme's white cards
 * now have visibly recessed fields rather than outlined ones.
 *
 * The hover border and the transition are not decoration. A 1px hairline at
 * rest is quiet by design, and `hover:border-line-strong` is what tells a
 * pointer user the quiet rectangle is live before they commit a click.
 */
const CONTROL =
  "hl-focusable mt-1.5 w-full rounded-md border border-line bg-panel px-3 text-[14px] text-fg placeholder:text-fg-muted " +
  "transition-[border-color,background-color,box-shadow] duration-[120ms] ease-out-hl " +
  "hover:border-line-strong focus:bg-surface " +
  "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-line " +
  "aria-[invalid=true]:border-danger-border aria-[invalid=true]:hover:border-danger";

export function Input({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cn(CONTROL, "h-10", className)} />;
}

export function Textarea({
  className,
  rows = 4,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...rest}
      rows={rows}
      className={cn(CONTROL, "py-2 leading-[1.5]", className)}
    />
  );
}

/*
 * The disclosure chevron, as a background image.
 *
 * `appearance-none` removes the platform's own arrow, which is the only way
 * to stop a <select> looking like a different control from every <input>
 * beside it — on Windows it renders a grey square button, on macOS a blue
 * one. What replaces it has to be drawn by CSS rather than by a sibling
 * element, because a <select> cannot contain one and an absolutely
 * positioned overlay would swallow the click that opens the menu.
 *
 * `currentColor` in the data URI would be ideal and does not work — an SVG
 * loaded as an image has no access to the document's computed colour. So the
 * stroke is `--hl-text-muted`, read through a CSS variable at paint time,
 * which does follow the theme. The URI is single-quoted so the inner
 * attribute quotes survive.
 */
const SELECT_CHEVRON =
  "appearance-none bg-[length:16px] bg-[right_0.625rem_center] bg-no-repeat " +
  "bg-[image:var(--hl-select-chevron)]";

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cn(CONTROL, "h-10 pr-9", SELECT_CHEVRON, className)}>
      {children}
    </select>
  );
}

/**
 * A comma-or-newline separated list, entered as text.
 *
 * Deliberately not a token/chip editor. Every jsonb list in this schema —
 * value props, segments, exclusions, title patterns — is a handful of short
 * phrases a user pastes from a document, and a chip editor makes pasting five
 * lines a five-step interaction. `splitList` is the matching parser.
 */
export function ListInput({
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <Textarea {...rest} className={className} />;
}

/** Parses what `ListInput` produces. Exported so the server parses it identically. */
export function splitList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The inverse, for rendering a stored list back into a `ListInput`. */
export function joinList(value: readonly string[] | null | undefined): string {
  return (value ?? []).join("\n");
}

/**
 * A form's inline result banner.
 *
 * Success and failure share one component so a screen cannot accidentally
 * render one and forget the other — which is the usual shape of "the save
 * silently did nothing".
 */
export function FormMessage({
  result,
  className,
}: {
  result: { ok: true; message?: string } | { ok: false; error: string } | null;
  className?: string;
}) {
  if (!result) return null;
  const good = result.ok;
  const text = good ? (result.message ?? "Saved.") : result.error;

  return (
    <p
      role={good ? "status" : "alert"}
      className={cn(
        "rounded-md border px-3 py-2 text-[13px]",
        good
          ? "border-success-border bg-success-surface text-success-text"
          : "border-danger-border bg-danger-surface text-danger-text",
        className,
      )}
    >
      {text}
    </p>
  );
}
