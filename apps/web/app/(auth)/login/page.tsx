import Link from "next/link";
import { Note } from "@huntloop/ui";
import { AuthForm } from "../AuthForm";

/**
 * What `auth/callback` and `signInWithGoogle` mean by each `?error=` code.
 * The codes carry no provider detail (see the callback), so neither does the
 * copy; an unknown code shows nothing rather than guessing.
 */
const ERRORS: Record<string, { title: string; body: string }> = {
  invalid_link: {
    title: "That sign-in link has expired or was already used",
    body: "Links work once and last an hour. Enter your email and we’ll send a new one.",
  },
  missing_code: {
    title: "That sign-in link was incomplete",
    body: "It may have been cut off when it was copied. Enter your email for a fresh link.",
  },
  oauth: {
    title: "Google sign-in didn’t finish",
    body: "Try again, or enter your email and we’ll send you a sign-in link instead.",
  },
};

/**
 * `next` is read here rather than in the form.
 *
 * `AuthForm` submits through a Server Action, which has no `window` to read
 * the query string from, so the destination has to travel with the request.
 * Reading it in the Server Component and passing it down keeps the form free
 * of any dependency on the browser URL — and it is validated again on the
 * server before it is used. See `lib/safe-next.ts`.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const next = typeof query.next === "string" ? query.next : "";
  const error =
    typeof query.error === "string" && Object.hasOwn(ERRORS, query.error)
      ? ERRORS[query.error]
      : undefined;

  return (
    <>
      <h1 className="hl-title text-fg">Sign in</h1>
      <p className="mt-1.5 mb-6 text-[13px] text-fg-muted">
        Know who needs you before you reach out.
      </p>

      {error && (
        <Note tone="warning" className="mb-4">
          <p className="font-medium">{error.title}</p>
          <p className="mt-1 text-fg-secondary">{error.body}</p>
        </Note>
      )}

      <AuthForm mode="login" next={next} />

      <p className="mt-6 text-[13px] text-fg-muted">
        No account?{" "}
        <Link
          href="/signup"
          className="hl-focusable rounded-sm text-brand-text underline underline-offset-2"
        >
          Create one
        </Link>
      </p>
    </>
  );
}

export const metadata = { title: "Sign in" };
