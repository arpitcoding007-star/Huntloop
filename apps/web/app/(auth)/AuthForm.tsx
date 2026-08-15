"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@huntloop/ui";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  initialAuthState,
  sendMagicLink,
  signInWithGoogle,
} from "./actions";

/**
 * Login / signup form.
 *
 * Deliberately does not have a password field. Supabase magic links avoid
 * storing password hashes, avoid a reset flow, and avoid the class of bugs
 * that comes with both — for a product at this stage that is a straight win.
 * Google OAuth sits alongside it for people who'd rather not check email.
 *
 * The error text never distinguishes "no such account" from "wrong details".
 * That distinction is an account-enumeration oracle: it lets anyone check
 * whether a given person is a Huntloop customer. The action returns one
 * message for every failure so this component cannot leak the difference even
 * by accident.
 *
 * ── Why there is no Supabase client in this file ─────────────────────────
 *
 * There used to be. `createClientSideClient()` here pulled
 * `@supabase/supabase-js` into the browser bundle and made these two pages
 * 217 kB against a 136 kB baseline — on the first pages an unauthenticated
 * visitor loads (audit PERF-02). Both submissions are Server Actions now, so
 * this component is a form and a spinner. Keep it that way: an import of
 * `@huntloop/db` here silently undoes it.
 */
export function AuthForm({ mode, next }: { mode: "login" | "signup"; next: string }) {
  const [state, formAction] = useActionState(sendMagicLink, initialAuthState);

  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );

  if (!configured) {
    return (
      <div className="rounded-md border border-warning-border bg-warning-surface p-4">
        <p className="flex items-center gap-2 text-[13px] font-medium text-warning">
          <AlertTriangle className="size-4" strokeWidth={1.75} />
          Supabase is not configured
        </p>
        <p className="mt-1.5 text-[13px] leading-[1.5] text-fg-secondary">
          There is nothing to sign in to yet. Copy{" "}
          <span className="font-mono text-[12px]">.env.example</span> to{" "}
          <span className="font-mono text-[12px]">apps/web/.env.local</span>, fill
          in the Supabase URL and publishable key, and restart the dev server.
        </p>
        <p className="mt-3 text-[13px] text-fg-muted">
          Until then the app runs on demo data —{" "}
          <Link
            href="/acme/dashboard"
            className="hl-focusable rounded-sm text-brand-text underline underline-offset-2"
          >
            open the Command Center
          </Link>
          .
        </p>
      </div>
    );
  }

  if (state.status === "sent") {
    return (
      <div className="rounded-md border border-brand-border bg-brand-surface p-4">
        <p className="flex items-center gap-2 text-[13px] font-medium text-brand-text">
          <CheckCircle2 className="size-4" strokeWidth={1.75} />
          Check your email
        </p>
        <p className="mt-1.5 text-[13px] leading-[1.5] text-fg-secondary">
          If an account can be created or found for{" "}
          <span className="text-fg">{state.email}</span>, a sign-in link is on its
          way. It expires in an hour.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-3">
        {/* Both carried in the form rather than read from `window.location`:
            the action runs on the server, where there is no window, and both
            are re-validated there anyway. */}
        <input type="hidden" name="mode" value={mode} />
        <input type="hidden" name="next" value={next} />

        <div>
          <label
            htmlFor="email"
            className="block text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase"
          >
            Work email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@company.com"
            className="hl-focusable mt-1.5 h-10 w-full rounded-md border border-line bg-surface px-3 text-[14px] text-fg placeholder:text-fg-muted"
          />
        </div>

        <SubmitButton
          label={mode === "signup" ? "Create account" : "Email me a sign-in link"}
        />
      </form>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-line-subtle" />
        <span className="text-[11px] tracking-[0.06em] text-fg-muted uppercase">or</span>
        <span className="h-px flex-1 bg-line-subtle" />
      </div>

      {/* A form rather than an onClick: the OAuth handoff is a server-issued
          redirect now, so it works before hydration and without the SDK. */}
      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={next} />
        <Button type="submit" variant="secondary" size="lg" className="w-full">
          Continue with Google
        </Button>
      </form>

      {state.status === "error" && (
        <p role="alert" className="text-[13px] text-danger">
          {state.message}
        </p>
      )}
    </div>
  );
}

/**
 * Split out because `useFormStatus` reads the state of the nearest enclosing
 * form, and only reports `pending` from a component *inside* it. Called in the
 * parent it returns false forever, which is the kind of bug that looks like a
 * slow network.
 */
function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="primary"
      size="lg"
      className="w-full"
      disabled={pending}
    >
      {pending ? "Sending…" : label}
    </Button>
  );
}
