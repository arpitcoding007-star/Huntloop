import Link from "next/link";

/**
 * The Huntloop mark and wordmark for the standalone pages — marketing
 * sub-pages, onboarding, the workspace picker.
 *
 * Those headers each drew a blue "H" square in the mark's place: a
 * placeholder from before the real mark existed (commit de3e50d), copied
 * page to page. One component means the next header gets the real mark by
 * default rather than by remembering.
 *
 * `href` omitted renders plain text — onboarding has nowhere useful for the
 * logo to go mid-flow, and a link that only redirects back is a detour.
 */
export function BrandLink({ href }: { href?: string }) {
  const inner = (
    <>
      {/* Intrinsic dimensions for the aspect ratio, so the header does not
          reflow when the image decodes. */}
      <img
        src="/brand/huntloop-mark.png"
        alt=""
        width={1343}
        height={638}
        className="hl-mark size-[22px] shrink-0 object-contain"
      />
      <span className="text-[15px] font-semibold tracking-[-0.02em] text-fg">Huntloop</span>
    </>
  );

  if (!href) return <span className="flex items-center gap-2">{inner}</span>;

  return (
    <Link href={href} className="hl-focusable flex items-center gap-2 rounded-sm">
      {inner}
    </Link>
  );
}
