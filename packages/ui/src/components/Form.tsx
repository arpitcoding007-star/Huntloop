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
        className="block text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase"
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

const CONTROL =
  "hl-focusable mt-1.5 w-full rounded-md border border-line bg-surface px-3 text-[14px] text-fg placeholder:text-fg-muted " +
  "disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger-border";

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

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cn(CONTROL, "h-10 pr-8", className)}>
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
          ? "border-success-border bg-success-surface text-success"
          : "border-danger-border bg-danger-surface text-danger",
        className,
      )}
    >
      {text}
    </p>
  );
}
