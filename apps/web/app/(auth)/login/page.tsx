import Link from "next/link";
import { AuthForm } from "../AuthForm";

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

  return (
    <>
      <h1 className="text-[24px] leading-8 font-semibold text-fg">Sign in</h1>
      <p className="mt-1.5 mb-6 text-[13px] text-fg-muted">
        Know who needs you before you reach out.
      </p>

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
