"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@huntloop/ui";
import { ArrowRight, Globe } from "lucide-react";

/**
 * The landing page's only primary call to action.
 *
 * ── Why a domain box and not a "Get started" button ──────────────────────
 *
 * Because it is the *same input as onboarding step two*. A visitor's first act
 * on the marketing site is literally the first step of the product, which
 * moves the sign-up wall from in front of the value to after it: they see what
 * Huntloop understood about their company before they are asked for an email
 * address, and the account they then create starts with that reading already
 * attached.
 *
 * The alternative — a button to a signup form — asks somebody to commit before
 * they have seen anything work. For a product whose entire claim is "we show
 * our working", making them take the first step on faith is the wrong opening.
 *
 * ── Why validation is deliberately loose ─────────────────────────────────
 *
 * People type `acme.co`, `www.acme.co`, and `https://acme.co/pricing`, and all
 * three are the same answer. Rejecting any of them at the door would be the
 * product being pedantic in the one place it is trying to be welcoming. The
 * real check is `canonicalizeDomain` on the server, which handles all three —
 * this only refuses input that could not possibly be a hostname, so the button
 * does not navigate to a page that will immediately fail.
 */
export function DomainInput({ size = "lg" }: { size?: "md" | "lg" }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);

  const cleaned = value.trim();
  // A dot and no whitespace is the whole test. Anything stricter rejects
  // hostnames that are real.
  const plausible = /^[^\s]+\.[^\s.]{2,}$/.test(
    cleaned.replace(/^https?:\/\//i, "").split(/[/?#]/)[0] ?? "",
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!plausible) return;
        setPending(true);
        router.push(`/discover?d=${encodeURIComponent(cleaned)}`);
      }}
      className="w-full max-w-lg"
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Globe
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted"
            strokeWidth={1.75}
          />
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label="Your company website"
            placeholder="yourcompany.com"
            /* Deliberately not autofocused. It is the control the page exists
               for, which is the usual argument for stealing focus — but on a
               landing page focus also scrolls the viewport to the input, and on
               a phone it opens the keyboard over the headline that was supposed
               to persuade them to use it. */
            autoComplete="url"
            className={[
              "hl-focusable w-full rounded-md border border-line bg-surface pr-3 pl-9 text-fg placeholder:text-fg-muted",
              size === "lg" ? "h-12 text-[15px]" : "h-10 text-[14px]",
            ].join(" ")}
          />
        </div>
        <Button
          type="submit"
          variant="primary"
          size={size === "lg" ? "lg" : "md"}
          icon={ArrowRight}
          disabled={pending || !plausible}
        >
          {pending ? "Reading…" : "See what Huntloop finds"}
        </Button>
      </div>
      <p className="mt-2 text-[12px] text-fg-muted">
        No card, no account yet. We&rsquo;ll read your site and show you who you
        should be selling to.
      </p>
    </form>
  );
}
