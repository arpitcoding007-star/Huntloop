import Link from "next/link";
import { AuthForm } from "../AuthForm";
import { canonicalizeDomain } from "@huntloop/db/identity";

/**
 * `next` is read here for the reason given in ../login/page.tsx.
 *
 * ── The `d` parameter ────────────────────────────────────────────────────
 *
 * Set by `/discover`, and it carries the domain the visitor already had read
 * on the landing page. Two things happen with it, and neither trusts it:
 *
 *   · The copy changes, so the page acknowledges what they just did rather
 *     than greeting them as if they had arrived cold. It is echoed through
 *     `canonicalizeDomain`, which either yields a hostname or null — so a
 *     crafted value cannot put arbitrary text on the page.
 *   · It travels on as a `next` path, so the company step opens with the
 *     address already filled in.
 *
 * The *research* is not carried by this parameter. It is claimed server-side
 * from the caller's verified email domain (`claim_research` in `0025`), which
 * is the only version of this that cannot be pointed at somebody else's
 * company by editing a URL.
 */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const domain =
    typeof query.d === "string" ? canonicalizeDomain(query.d) : null;

  /* An explicit `next` still wins — an invitation link is the case that
     matters, and it must survive the round trip through email. */
  const next =
    typeof query.next === "string" && query.next
      ? query.next
      : domain
        ? `/welcome?d=${encodeURIComponent(domain)}`
        : "";

  return (
    <>
      <h1 className="text-[24px] leading-8 font-semibold text-fg">
        {domain ? "Keep going" : "Create your account"}
      </h1>
      <p className="mt-1.5 mb-6 text-[13px] leading-[1.5] text-fg-muted">
        {domain ? (
          <>
            We&rsquo;ve already read{" "}
            <span className="font-mono text-fg-secondary">{domain}</span>. Create
            an account and we&rsquo;ll pick up from there — you won&rsquo;t
            retype anything.
          </>
        ) : (
          <>
            Next you&rsquo;ll add your company website, and Huntloop will work
            out what you sell.
          </>
        )}
      </p>

      <AuthForm mode="signup" next={next} />

      <p className="mt-6 text-[13px] text-fg-muted">
        Already have an account?{" "}
        <Link
          href="/login"
          className="hl-focusable rounded-sm text-brand-text underline underline-offset-2"
        >
          Sign in
        </Link>
      </p>
    </>
  );
}

export const metadata = { title: "Create account" };
