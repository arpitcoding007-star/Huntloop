import Link from "next/link";
import { BrandMark } from "@huntloop/ui";

/**
 * The Huntloop mark and wordmark for the standalone pages — marketing
 * sub-pages, onboarding, the workspace picker, sign-in.
 *
 * One component means the next header gets the real mark by default rather
 * than by remembering. `size="lg"` is the sign-in and sign-up lockup, where
 * the brand is the first thing on the page rather than a corner of it.
 *
 * `href` omitted renders plain text — onboarding has nowhere useful for the
 * logo to go mid-flow, and a link that only redirects back is a detour.
 */
export function BrandLink({ href, size = "md" }: { href?: string; size?: "md" | "lg" }) {
  const lg = size === "lg";
  const inner = (
    <>
      <BrandMark className={lg ? "size-8 text-fg" : "size-[22px] text-fg"} />
      <span
        className={`font-semibold text-fg ${
          lg ? "text-[22px] tracking-[-0.035em]" : "text-[15px] tracking-[-0.02em]"
        }`}
      >
        Huntloop
      </span>
    </>
  );

  const gap = lg ? "gap-2.5" : "gap-2";
  if (!href) return <span className={`flex items-center ${gap}`}>{inner}</span>;

  return (
    <Link href={href} className={`hl-focusable flex items-center ${gap} rounded-sm`}>
      {inner}
    </Link>
  );
}
