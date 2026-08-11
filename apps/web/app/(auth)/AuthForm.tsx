"use client";

import { useState } from "react";
import { Button } from "@huntloop/ui";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { createClientSideClient } from "@huntloop/db";

/**
 * Login / signup form.
 *
 * Deliberately does not have a password field. Supabase magic links avoid
 * storing password hashes, avoid a reset flow, and avoid the class of bugs
 * that comes with both — for a product at this stage that is a straight win.
 * Google OAuth sits alongside it for people who'd rather not check email.
 *
 * The error text below never distinguishes "no such account" from "wrong
 * details". That distinction is an account-enumeration oracle: it lets anyone
 * check whether a given person is a Huntloop customer.
 */
export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    try {
      const supabase = createClientSideClient();
      const next = new URLSearchParams(window.location.search).get("next") ?? "";
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
          shouldCreateUser: mode === "signup",
        },
      });
      if (error) throw error;
      setState("sent");
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  async function signInWithGoogle() {
    try {
      const supabase = createClientSideClient();
      await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

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
          <a
            href="/acme/dashboard"
            className="hl-focusable rounded-sm text-brand-text underline underline-offset-2"
          >
            open the Command Center
          </a>
          .
        </p>
      </div>
    );
  }

  if (state === "sent") {
    return (
      <div className="rounded-md border border-brand-border bg-brand-surface p-4">
        <p className="flex items-center gap-2 text-[13px] font-medium text-brand-text">
          <CheckCircle2 className="size-4" strokeWidth={1.75} />
          Check your email
        </p>
        <p className="mt-1.5 text-[13px] leading-[1.5] text-fg-secondary">
          If an account can be created or found for{" "}
          <span className="text-fg">{email}</span>, a sign-in link is on its way.
          It expires in an hour.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <form onSubmit={sendLink} className="space-y-3">
        <div>
          <label
            htmlFor="email"
            className="block text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase"
          >
            Work email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="hl-focusable mt-1.5 h-10 w-full rounded-md border border-line bg-surface px-3 text-[14px] text-fg placeholder:text-fg-muted"
          />
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full"
          disabled={state === "sending"}
        >
          {state === "sending"
            ? "Sending…"
            : mode === "signup"
              ? "Create account"
              : "Email me a sign-in link"}
        </Button>
      </form>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-line-subtle" />
        <span className="text-[11px] tracking-[0.06em] text-fg-muted uppercase">or</span>
        <span className="h-px flex-1 bg-line-subtle" />
      </div>

      <Button variant="secondary" size="lg" className="w-full" onClick={signInWithGoogle}>
        Continue with Google
      </Button>

      {state === "error" && (
        <p role="alert" className="text-[13px] text-danger">
          {message}
        </p>
      )}
    </div>
  );
}
