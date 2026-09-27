"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@huntloop/ui";
import { ChevronRight } from "lucide-react";

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
export function DomainInput({
  size = "lg",
  /**
   * Whether the anonymous read is actually switched on.
   *
   * `PUBLIC_RESEARCH_ENABLED` is off by default and for a good reason — an
   * unauthenticated endpoint that calls Opus with web fetching is the most
   * expensive misconfiguration in this codebase. But with it off, this box
   * sent people to a page that could only apologise. Sending them straight
   * to sign-up with the domain already attached is the same destination
   * `/discover` would have routed them to, one screen sooner and without
   * the dead end in between.
   */
  canResearch = true,
  /** For an in-page link that should land on the field, e.g. "Try it on your domain". */
  id,
}: {
  size?: "md" | "lg";
  canResearch?: boolean;
  id?: string;
}) {
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
        router.push(
          canResearch
            ? `/discover?d=${encodeURIComponent(cleaned)}`
            : `/signup?d=${encodeURIComponent(cleaned)}`,
        );
      }}
      className="w-full max-w-[560px]"
    >
      <div className="flex flex-col gap-2.5 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <input
            id={id}
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
            /* Meridian's CTA field: 52px at radius 11 on a surface, no icon.
               Inside a dark band the same tokens give the design's #101113
               well on a #232427 hairline. */
            className={[
              "hl-focusable w-full border border-line bg-surface text-fg placeholder:text-fg-muted transition-[border-color] duration-[120ms] ease-out-hl hover:border-line-strong",
              size === "lg"
                ? "h-[52px] rounded-[11px] px-[18px] text-[15px]"
                : "h-10 rounded-md px-3 text-[14px]",
            ].join(" ")}
          />
        </div>
        <Button
          type="submit"
          variant="primary"
          size={size === "lg" ? "xl" : "md"}
          disabled={pending || !plausible}
          className={size === "lg" ? "h-[52px]! rounded-[11px]!" : undefined}
        >
          {pending ? "Reading…" : "See what Huntloop finds"}
          <ChevronRight aria-hidden className="-mr-1 size-4" strokeWidth={1.8} />
        </Button>
      </div>
      {/* The promise follows the switch. With the anonymous read off the
          box goes to sign-up, so "no account" would be untrue. */}
      <p className="mt-3 text-[13px] text-fg-muted">
        {canResearch
          ? "No card. No account. Just your domain."
          : "No card. Create a free account and we’ll read your site first."}
      </p>
    </form>
  );
}
