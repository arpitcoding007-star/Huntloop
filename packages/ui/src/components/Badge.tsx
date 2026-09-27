import type { ReactNode } from "react";
import { cn } from "../utils/cn";

export type BadgeVariant =
  | "neutral"
  | "brand"
  | "ai"
  | "success"
  | "warning"
  | "danger"
  | "info";

export interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  size?: "sm" | "md";
  /** Render a leading status dot instead of relying on color alone. */
  dot?: boolean;
  className?: string;
}

/*
 * Ink is always the `-text` leaf, never the fill.
 *
 * A status colour has two jobs — fill a 3:1 graphic, and be read as 10–11px
 * type on its own tint — and in the light theme one value cannot do both.
 * tokens.css splits them for exactly this component; three of these
 * variants were still painting the fill value as ink, which measured
 * 3.6–4.4:1 on the tint behind it. The dark theme aliases the two back
 * together, so this is one token name either way.
 */
const VARIANTS: Record<BadgeVariant, string> = {
  neutral: "bg-surface-active border-line text-fg-secondary",
  brand: "bg-brand-surface border-brand-border text-brand-text",
  // Borderless: the Meridian AI chip is a tint and a word, nothing else.
  ai: "bg-ai-surface border-transparent text-ai-text",
  success: "bg-success-surface border-success-border text-success-text",
  warning: "bg-warning-surface border-warning-border text-warning-text",
  danger: "bg-danger-surface border-danger-border text-danger-text",
  info: "bg-info-surface border-info-border text-info-text",
};

const DOTS: Record<BadgeVariant, string> = {
  neutral: "bg-fg-muted",
  brand: "bg-brand",
  ai: "bg-ai",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

export function Badge({
  children,
  variant = "neutral",
  size = "sm",
  dot = false,
  className,
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 border font-semibold whitespace-nowrap",
        "tracking-[0.06em] uppercase",
        /* Meridian chip: 18px at radius 5, 10px / 600 / .06em. A small
           rounded rectangle rather than a pill — the design sets every tag,
           from the sidebar AI chip to the evidence "Unknown", this way. */
        size === "sm"
          ? "h-[18px] rounded-[5px] px-1.5 text-[10px]"
          : "h-[22px] rounded-[6px] px-2 text-[11px]",
        VARIANTS[variant],
        className,
      )}
    >
      {dot && (
        <span
          aria-hidden
          className={cn("size-1.5 shrink-0 rounded-full", DOTS[variant])}
        />
      )}
      {children}
    </span>
  );
}

/** Status shown as dot + text — never color alone (a11y floor, plan §1.5). */
export function StatusDot({
  variant = "neutral",
  label,
  className,
}: {
  variant?: BadgeVariant;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-[13px] text-fg-secondary",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0 rounded-full", DOTS[variant])}
      />
      {label}
    </span>
  );
}
