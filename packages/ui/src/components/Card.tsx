import type { ReactNode } from "react";
import { cn } from "../utils/cn";

export interface CardProps {
  children: ReactNode;
  className?: string;
  /** Removes body padding — for tables and lists that own their own insets. */
  flush?: boolean;
  /** An anchor target, e.g. a deep link to one conversation in a list. */
  id?: string;
}

/**
 * --hl-surface on --hl-canvas, one hairline border, radius `lg` (16px) and
 * the reference's wide, faint `shadow-card`. The shadow is low enough in
 * opacity that fourteen cards on one screen still read as one surface rather
 * than a pile of paper, and it resolves to none in dark.
 */
export function Card({ children, className, flush, id }: CardProps) {
  return (
    <section
      id={id}
      className={cn(
        "min-w-0 rounded-lg border border-line-subtle bg-surface shadow-card",
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
        /* No rule under the header: the reference runs title, description
           and content as one block, separated by space alone. */
        "flex items-start justify-between gap-4 px-5 pt-5 pb-1",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="font-display text-[17px] font-semibold tracking-heading text-fg">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-[13px] text-fg-secondary">{description}</p>
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

/**
 * The title of a section of a page — the reference's "Outcomes": sentence
 * case, 19px, set in the heading ink. `eyebrow` is the small tracked-caps
 * label, for a label nested inside a card where a heading would outrank the
 * card's own title.
 */
export function SectionLabel({
  children,
  className,
  variant = "heading",
}: {
  children: ReactNode;
  className?: string;
  variant?: "heading" | "eyebrow";
}) {
  return (
    <div
      className={cn(
        variant === "heading"
          ? "font-display text-[19px] leading-6 font-semibold tracking-heading text-fg"
          : "text-[11px] leading-4 font-medium tracking-label text-fg-muted uppercase",
        className,
      )}
    >
      {children}
    </div>
  );
}
