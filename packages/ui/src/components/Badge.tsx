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

const VARIANTS: Record<BadgeVariant, string> = {
  neutral:
    "bg-surface-active border-line text-fg-secondary",
  brand:
    "bg-brand-surface border-brand-border text-brand-text",
  ai: "bg-ai-surface border-ai-border text-ai-text",
  success:
    "bg-success-surface border-success-border text-brand-text",
  warning:
    "bg-warning-surface border-warning-border text-warning",
  danger:
    "bg-danger-surface border-danger-border text-danger",
  info: "bg-info-surface border-info-border text-info",
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
        "inline-flex items-center gap-1.5 rounded-sm border font-medium whitespace-nowrap",
        "tracking-[0.04em] uppercase",
        size === "sm"
          ? "h-[18px] px-1.5 text-[10px]"
          : "h-[22px] px-2 text-[11px]",
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
