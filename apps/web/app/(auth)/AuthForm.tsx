"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Note } from "@huntloop/ui";
import { sendMagicLink, signInWithGoogle } from "./actions";
import { initialAuthState } from "./auth-state";
import { DEMO_HOME } from "../../lib/demo";

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
  // Remounting is the only way to return `useActionState` to its initial
  // state, which is what "use a different address" means.
  const [attempt, setAttempt] = useState(0);
  return (
    <AuthFormBody
      key={attempt}
      mode={mode}
      next={next}
      onReset={() => setAttempt((n) => n + 1)}
    />
  );
}

/**
 * Google sign-in is offered only when the deployment says the provider is
 * enabled in Supabase. Rendering it otherwise sends every click to
 * `/login?error=oauth`.
 */
const GOOGLE_ENABLED = process.env.NEXT_PUBLIC_AUTH_GOOGLE === "true";

function AuthFormBody({
  mode,
  next,
  onReset,
}: {
  mode: "login" | "signup";
  next: string;
  onReset: () => void;
}) {
  const [state, formAction] = useActionState(sendMagicLink, initialAuthState);
  const [resent, setResent] = useState(false);

  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );

  /*
    Both values are inlined at build time, so on a hosted deployment this
    branch means the *build* ran without them — the variables are missing
    from that project's environment, or were added after the last deploy.
    The fix there is the host's settings and a redeploy, not a local file,
    so visitors to a deployed site get a plain statement rather than
    instructions only the developer can follow.
  */
  if (!configured) {
    const local = process.env.NODE_ENV !== "production";
    return (
      <Note tone="warning">
        <p className="font-medium">
          {local ? "Supabase is not configured" : "Sign-in isn’t available here yet"}
        </p>
        <p className="mt-1.5 text-fg-secondary">
          {local ? (
            <>
              There is nothing to sign in to yet. Copy{" "}
              <span className="font-mono text-[12px]">.env.example</span> to{" "}
              <span className="font-mono text-[12px]">apps/web/.env.local</span>, fill
              in the Supabase URL and publishable key, and restart the dev server.
            </>
          ) : (
            <>
              This deployment was built without its account service connected, so
              there is no way to create an account or sign in on it yet.
            </>
          )}
        </p>
        <p className="mt-3 text-fg-secondary">
          Until then the app runs on demo data —{" "}
          <Link
            href={DEMO_HOME}
            className="hl-focusable rounded-sm text-brand-text underline underline-offset-2"
          >
            open the Command Center
          </Link>
          .
        </p>
      </Note>
    );
  }

  if (state.status === "sent") {
    return (
      <div className="space-y-3">
        <Note tone="success">
          <p className="font-medium">Check your email</p>
          <p className="mt-1.5 text-fg-secondary">
            If an account can be created or found for{" "}
            <span className="text-fg">{state.email}</span>, a sign-in link is on
            its way. It expires in an hour.
          </p>
          {resent && (
            <p className="mt-1.5 text-fg-secondary">
              Sent again. Only the newest link works.
            </p>
          )}
        </Note>
        <div className="flex flex-wrap items-center gap-2">
          {/* The same submission again. Supabase allows one email per address
              per minute; a resend inside that window comes back as the
              generic error below, which is the honest answer. */}
          <form action={formAction} onSubmit={() => setResent(true)}>
            <input type="hidden" name="mode" value={mode} />
            <input type="hidden" name="next" value={next} />
            <input type="hidden" name="email" value={state.email} />
            <ResendButton />
          </form>
          <Button type="button" variant="ghost" size="sm" onClick={onReset}>
            Use a different address
          </Button>
        </div>
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
            className="block text-[11px] font-medium tracking-label text-fg-muted uppercase"
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
            className="hl-focusable mt-1.5 h-10 w-full rounded-md border border-line bg-field px-3 text-[14px] text-fg placeholder:text-fg-muted transition-[border-color,background-color] duration-[120ms] ease-out-hl hover:border-line-strong focus:bg-surface"
          />
        </div>

        <SubmitButton
          label={mode === "signup" ? "Create account" : "Email me a sign-in link"}
        />
      </form>

      {GOOGLE_ENABLED && (
        <form action={signInWithGoogle}>
          <input type="hidden" name="next" value={next} />
          <GoogleButton />
        </form>
      )}

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

function ResendButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" size="sm" disabled={pending}>
      {pending ? "Sending…" : "Send it again"}
    </Button>
  );
}

function GoogleButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="secondary"
      size="lg"
      className="w-full"
      disabled={pending}
    >
      {pending ? "Opening Google…" : "Continue with Google"}
    </Button>
  );
}
