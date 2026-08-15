import Link from "next/link";
import { AuthForm } from "../AuthForm";

/** `next` is read here for the reason given in ../login/page.tsx. */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const next = typeof query.next === "string" ? query.next : "";

  return (
    <>
      <h1 className="text-[24px] leading-8 font-semibold text-fg">
        Create your account
      </h1>
      <p className="mt-1.5 mb-6 text-[13px] text-fg-muted">
        Next you&rsquo;ll add your company website, and Huntloop will work out what
        you sell.
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
