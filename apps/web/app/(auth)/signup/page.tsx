import { AuthForm } from "../AuthForm";

export default function SignupPage() {
  return (
    <>
      <h1 className="text-[24px] leading-8 font-semibold text-fg">
        Create your account
      </h1>
      <p className="mt-1.5 mb-6 text-[13px] text-fg-muted">
        Next you&rsquo;ll add your company website, and Huntloop will work out what
        you sell.
      </p>

      <AuthForm mode="signup" />

      <p className="mt-6 text-[13px] text-fg-muted">
        Already have an account?{" "}
        <a
          href="/login"
          className="hl-focusable rounded-sm text-brand-text underline underline-offset-2"
        >
          Sign in
        </a>
      </p>
    </>
  );
}

export const metadata = { title: "Create account · Huntloop" };
