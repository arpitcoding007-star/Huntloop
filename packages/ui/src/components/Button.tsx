import type { ButtonHTMLAttributes, ComponentType, ReactNode } from "react";
import { cn } from "../utils/cn";
import { Anchor, type LinkComponent } from "../utils/link";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>;
  children?: ReactNode;
  /**
   * Why this control cannot act yet — e.g. "Outreach isn't built yet".
   *
   * The button half of the `unbuilt` nav flag, and it exists for the same
   * reason (audit UX-01). Twenty-one controls across six screens rendered as
   * live primary and secondary actions and did nothing at all when pressed:
   * no handler, no disabled state, no explanation. From the user's side that
   * is indistinguishable from a broken app, and it is the §7 failure aimed at
   * ourselves — an affordance drawn before the behaviour exists.
   *
   * `NAV-02` could not catch them. It greps for placeholder hrefs, and a
   * button has no href to inspect; `NAV-03` is the check that does.
   *
   * `aria-disabled` rather than `disabled`, deliberately. A `disabled` button
   * leaves the tab order, so the reason is unreachable by exactly the users
   * who most need it stated — and "why is this greyed out" is the question
   * this prop exists to answer. The control stays focusable, announces as
   * dimmed, carries the reason as its description, and refuses the click.
   *
   * Delete the prop in the same commit that adds the handler.
   */
  pending?: string;
  /**
   * Renders as a link with button styling. For destinations that exist —
   * a control that navigates should be an anchor, so it opens in a new tab,
   * previews its target on hover, and reaches the route without JavaScript.
   *
   * Pass `linkComponent={Link}` alongside it for client-side routing; see
   * `utils/link.tsx` for why the seam is a prop.
   */
  href?: string;
  linkComponent?: LinkComponent;
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
  pending,
  href,
  linkComponent: Link = Anchor,
  onClick,
  ...rest
}: ButtonProps) {
  const iconOnly = !children;
  const classes = cn(
    "hl-focusable inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap",
    "transition-colors duration-[120ms]",
    "disabled:cursor-not-allowed disabled:opacity-50",
    // The aria-disabled twin of the line above. Both are needed: `disabled`
    // is still the right answer for a control that is momentarily busy, and
    // `pending` is the right answer for one that has nothing to do yet.
    "aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
    SIZES[size],
    iconOnly && (size === "sm" ? "w-7 px-0" : size === "lg" ? "w-10 px-0" : "w-8 px-0"),
    VARIANTS[variant],
    className,
  );

  const content = (
    <>
      {Icon && <Icon className="size-4 shrink-0" strokeWidth={1.75} />}
      {children}
    </>
  );

  // A real destination. Checked before `pending` only because the two are
  // never both meaningful — a link that goes somewhere is not pending.
  if (href && !pending) {
    return (
      <Link href={href} className={classes}>
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      {...rest}
      aria-disabled={pending ? true : undefined}
      /* Exposed as the accessible description rather than folded into the
         name, so the control still announces as "Draft outreach" and the
         reason follows it. */
      title={pending ?? rest.title}
      /*
         `undefined`, not a handler that calls preventDefault().

         The first version of this synthesized `e => e.preventDefault()` for
         every pending button, and the browser suite failed nine tests within a
         minute: most of these controls are rendered by Server Components, and
         a function cannot cross that boundary — "Event handlers cannot be
         passed to Client Component props", which took out the whole app shell.

         Dropping the handler is also the more honest implementation. There is
         nothing to prevent: a pending button has no behaviour by definition,
         and `type="button"` never submits a surrounding form.
      */
      onClick={pending ? undefined : onClick}
      className={classes}
    >
      {content}
    </button>
  );
}
