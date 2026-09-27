import type { AnchorHTMLAttributes, ComponentType, Ref } from "react";

/**
 * The seam that lets `packages/ui` stay framework-agnostic while the app that
 * consumes it still gets client-side routing.
 *
 * The package renders plain `<a>` by default, and that default is correct: a
 * design system that imports `next/link` can only ever be used inside Next,
 * and the components here are meant to outlive that choice. But the app-side
 * counterpart was never built, so *every* internal navigation in Huntloop —
 * sidebar, stat cards, breadcrumbs — was a full document reload: the App
 * Router thrown away, the shared JS re-parsed, React re-hydrated, and the
 * server re-rendering from scratch (audit PERF-01).
 *
 * A prop rather than a module-level registry or a React context: it is one
 * value, passed at the two call sites that need it, visible in the JSX of the
 * component doing the linking. A context would hide *which* links are routed
 * behind a provider three files up, and the answer to "why did this navigate
 * differently" should be readable where the link is written.
 *
 * `next/link` satisfies this shape structurally — it accepts `href` plus the
 * ordinary anchor attributes — so `linkComponent={Link}` typechecks with no
 * adapter, and so does a plain `"a"`.
 */

/**
 * Everything an `<a>` takes, with `href` promoted to required.
 *
 * This was a hand-written list of four attributes — href, className,
 * children, title — which was accurate for the two call sites that existed
 * and wrong for the third. Menu gives a link a `role`, a `tabIndex`, an
 * `onClick` and a ref; Sidebar gives one pointer and focus handlers for the
 * rail tooltip. Adding those one at a time as each consumer appears is how
 * the list eventually grows a `[key: string]: unknown` and stops typing
 * anything at all.
 */
export interface LinkComponentProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string;
  /** React 19 passes refs as an ordinary prop; `next/link` forwards them. */
  ref?: Ref<HTMLAnchorElement>;
}

export type LinkComponent = ComponentType<LinkComponentProps>;

/**
 * The default: an ordinary anchor, and a full document navigation.
 *
 * A real component rather than the string `"a"`, because `"a"` is an
 * `ElementType` and not a `ComponentType` — defaulting the prop to it either
 * fails to typecheck or needs a cast that asserts something untrue. Six lines
 * here is cheaper than a lie in a type annotation, and it keeps the prop's
 * type honest for every consumer.
 */
export const Anchor: LinkComponent = ({ children, ...rest }) => (
  <a {...rest}>{children}</a>
);
