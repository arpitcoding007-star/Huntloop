import type { ButtonHTMLAttributes, ComponentType, ReactNode } from "react";
import { cn } from "../utils/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>;
  children?: ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-fg-inverse border border-brand hover:bg-brand-hover active:bg-brand-active",
  secondary:
    "bg-surface text-fg border border-line hover:bg-surface-hover hover:border-line-strong",
  ghost:
    "bg-transparent text-fg-secondary border border-transparent hover:bg-surface-hover hover:text-fg",
  // Hover fills with --hl-danger, so the label flips to the inverse ink:
  // near-white on that red is 2.5:1, while #0f0f0f on it is 6.6:1. Mirrors
  // how `primary` treats its brand-green fill.
  danger:
    "bg-danger-surface text-danger border border-danger-border hover:bg-danger hover:text-fg-inverse",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-[12px] gap-1.5",
  md: "h-8 px-3 text-[13px] gap-2",
  lg: "h-10 px-4 text-[14px] gap-2",
};

export function Button({
  variant = "secondary",
  size = "md",
  icon: Icon,
  children,
  className,
  ...rest
}: ButtonProps) {
  const iconOnly = !children;
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "hl-focusable inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap",
        "transition-colors duration-[120ms]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        SIZES[size],
        iconOnly && (size === "sm" ? "w-7 px-0" : size === "lg" ? "w-10 px-0" : "w-8 px-0"),
        VARIANTS[variant],
        className,
      )}
    >
      {Icon && <Icon className="size-4 shrink-0" strokeWidth={1.75} />}
      {children}
    </button>
  );
}
