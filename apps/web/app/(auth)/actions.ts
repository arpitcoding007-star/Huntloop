"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createTenantClient } from "@huntloop/db";
import { authModeSchema, emailSchema, parseInput } from "../../lib/validation";
import { safeNextPath } from "../../lib/safe-next";
import { siteUrl } from "../../lib/site-url";

/**
 * Sign-in, moved off the client.
 *
 * `AuthForm` used to call `createClientSideClient()` directly, which pulled
 * `@supabase/supabase-js` into the browser bundle: `/login` and `/signup` were
 * **217 kB** of First Load JS against a 136 kB baseline (audit PERF-02). They
 * are the first pages an unauthenticated visitor loads, which makes them the
 * worst place in the app to ship the largest bundle — and none of that code
 * was doing anything the server could not.
 *
 * Both actions below do the same work server-side. The client keeps the form
 * state and nothing else.
 *
 * ── What did not change, and must not ────────────────────────────────────
 *
 * The responses stay enumeration-safe. `signInWithOtp` is not allowed to
 * report whether an address is already registered — that distinction lets
 * anyone check whether a given person is a Huntloop customer — so the success
 * path returns the same state either way and the failure path never echoes
 * Supabase's message.
 *
 * ── Rate limiting ────────────────────────────────────────────────────────
 *
 * Deliberately none here. Supabase already enforces magic-link limits (2
 * emails/hour on the built-in sender, 30 OTPs/hour project-wide, a 60-second
 * per-user window, 360 verifications/hour per IP), and `consume_rate_limit`
 * cannot run for a caller who has no session and no org — it requires both.
 * A second limiter in the app would duplicate Supabase's while doing a worse
 * job, because a serverless function cannot reliably identify the caller's IP.
 * See audit API-02b, and the trap recorded there: moving to custom SMTP, which
 * you must, makes the email cap yours to set.
 */

export interface AuthFormState {
  status: "idle" | "sent" | "error";
  /** Shown to the user. Never carries a provider message — see below. */
  message: string;
  /** Echoed back so the "check your email" screen can name the address. */
  email: string;
}

export const initialAuthState: AuthFormState = {
  status: "idle",
  message: "",
  email: "",
};

function client() {
  return cookies().then((store) =>
    createTenantClient({
      getAll: () => store.getAll().map((c) => ({ name: c.name, value: c.value })),
      setAll: (all) => {
        for (const c of all) {
          try {
            store.set(c.name, c.value, c.options);
          } catch {
            // Server Components cannot set cookies; middleware refreshes the
            // session instead.
          }
        }
      },
    }),
  );
}

export async function sendMagicLink(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = parseInput(emailSchema, formData.get("email"), "email address");
  if (!email.ok) return { status: "error", message: email.error, email: "" };

  const mode = parseInput(authModeSchema, formData.get("mode"), "request");
  if (!mode.ok) return { status: "error", message: mode.error, email: "" };

  // Validated here as well as on the way back in `auth/callback`. It is a
  // round trip through an email, so the value that returns is not necessarily
  // the value that left — and this is the cheaper place to reject it.
  const next = safeNextPath(
    typeof formData.get("next") === "string" ? String(formData.get("next")) : null,
  );

  const supabase = await client();
  const callback = new URL("/auth/callback", siteUrl());
  callback.searchParams.set("next", next);

  const { error } = await supabase.auth.signInWithOtp({
    email: email.value,
    options: {
      emailRedirectTo: callback.toString(),
      shouldCreateUser: mode.value === "signup",
    },
  });

  if (error) {
    /*
     * One message for every failure, and it does not say what went wrong.
     *
     * Supabase's own error text distinguishes "Signups not allowed for otp"
     * (the address does not exist and this was a login) from a rate limit from
     * a malformed address. Forwarding it would rebuild the account-enumeration
     * oracle that the rest of this flow is careful to avoid — the copy on the
     * success screen says "If an account can be created or found for…"
     * precisely so that this branch can stay vague.
     */
    return {
      status: "error",
      message: "That didn't work. Check the address and try again.",
      email: "",
    };
  }

  return { status: "sent", message: "", email: email.value };
}

/**
 * Google OAuth, as a server-issued redirect.
 *
 * `signInWithOAuth` on the server does not navigate — it returns the provider
 * URL to send the browser to, which is exactly what is wanted here: no SDK in
 * the bundle, and the redirect is a 303 from our origin rather than a
 * client-side `window.location` assignment.
 */
export async function signInWithGoogle(formData: FormData): Promise<void> {
  const next = safeNextPath(
    typeof formData.get("next") === "string" ? String(formData.get("next")) : null,
  );

  const callback = new URL("/auth/callback", siteUrl());
  callback.searchParams.set("next", next);

  const supabase = await client();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callback.toString() },
  });

  if (error || !data?.url) {
    // No detail in the URL. Which provider failed and why is not something to
    // hand to whoever loaded the page.
    redirect("/login?error=oauth");
  }

  // Outside the try/catch shape on purpose: `redirect()` works by throwing, so
  // wrapping it turns a successful redirect into a caught error.
  redirect(data.url);
}
