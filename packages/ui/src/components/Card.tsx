import type { ReactNode } from "react";
import { cn } from "../utils/cn";

export interface CardProps {
  children: ReactNode;
  className?: string;
  /** Removes body padding — for tables and lists that own their own insets. */
  flush?: boolean;
}

/**
 * Supabase card: --hl-surface on --hl-canvas, 1px hairline border, radius 6.
 * No shadow — depth comes from the border and surface lightness.
 */
export function Card({ children, className, flush }: CardProps) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-md border border-line-subtle bg-surface",
        !flush && "p-5",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex items-start justify-between gap-4 border-b border-line-subtle px-5 py-4",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        {description && (
          <p className="mt-0.5 text-[13px] text-fg-muted">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function CardBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("p-5", className)}>{children}</div>;
}

/** The uppercase tracking-wide muted label — the Supabase signature. */
export function SectionLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "text-[11px] leading-4 font-medium tracking-[0.06em] text-fg-muted uppercase",
        className,
      )}
    >
      {children}
    </div>
  );
}
