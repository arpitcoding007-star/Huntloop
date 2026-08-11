import { AuthForm } from "../AuthForm";

export default function LoginPage() {
  return (
    <>
      <h1 className="text-[24px] leading-8 font-semibold text-fg">Sign in</h1>
      <p className="mt-1.5 mb-6 text-[13px] text-fg-muted">
        Know who needs you before you reach out.
      </p>

      <AuthForm mode="login" />

      <p className="mt-6 text-[13px] text-fg-muted">
        No account?{" "}
        <a
          href="/signup"
          className="hl-focusable rounded-sm text-brand-text underline underline-offset-2"
        >
          Create one
        </a>
      </p>
    </>
  );
}

export const metadata = { title: "Sign in · Huntloop" };
