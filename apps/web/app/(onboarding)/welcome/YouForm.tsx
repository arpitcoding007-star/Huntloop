"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@huntloop/ui";
import { ROLE_OPTIONS, type UserRole } from "../../../lib/onboarding/steps";
import { saveYou, type YouResult } from "./actions";
import type { ActionResult } from "../../../lib/data/org";

/**
 * Step one: who is using this.
 *
 * ── Why this step exists at all ──────────────────────────────────────────
 *
 * It did not, and its absence was the reason nothing in Huntloop could be
 * personalised. `profiles` held `email`, `full_name` and `avatar_url` —
 * mirrored from `auth.users` by a trigger — and every onboarding question was
 * about the *company*. A founder, an SDR and a RevOps lead answered the same
 * five screens and got byte-identical dashboards.
 *
 * Two questions is the whole step, and the second one is the one that matters.
 *
 * ── Why the role options say what they change ────────────────────────────
 *
 * A role picker with bare labels is a personality quiz: people pick the
 * flattering option rather than the accurate one, and the layout they get is
 * wrong. Each option names what it *does* — "you work a daily outreach queue"
 * — so the choice is about their work rather than their title.
 */
export function YouForm({
  initialName,
  carry,
}: {
  initialName: string;
  /** `&d=domain` when the visitor was already researched. See page.tsx. */
  carry: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [role, setRole] = useState<UserRole | null>(null);

  const [state, formAction, pending] = useActionState<
    ActionResult<YouResult> | null,
    FormData
  >(saveYou, null);

  /* The action decides the destination, because it depends on a fact the
     client does not have: whether this person already belongs to a workspace
     somebody else configured. See the note in `actions.ts`. */
  useEffect(() => {
    if (!state?.ok) return;
    /* The carry is appended here rather than inside the action, because the
       action decides *which* step comes next and this only decorates it. A
       destination that already carries a query string takes an `&`. */
    const next = carry && state.data.next.includes("?")
      ? `${state.data.next}${carry}`
      : carry
        ? `${state.data.next}?${carry.slice(1)}`
        : state.data.next;
    router.push(next);
  }, [state, router, carry]);

  return (
    <form action={formAction} className="space-y-6">
      <div className="max-w-md">
        <label
          htmlFor="fullName"
          className="block text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase"
        >
          Your name
        </label>
        <input
          id="fullName"
          name="fullName"
          required
          maxLength={120}
          /* Same narrow exception the other onboarding steps take: a dedicated
             step whose entire content is a labelled field and a choice. There
             is nothing above it to skip past. */
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={!initialName}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Alex Rivera"
          className="hl-focusable mt-1.5 h-10 w-full rounded-md border border-line bg-surface px-3 text-[14px] text-fg placeholder:text-fg-muted"
        />
        {initialName && (
          <p className="mt-1.5 text-[12px] text-fg-muted">
            From your account. Change it if it&rsquo;s not how you sign off.
          </p>
        )}
        {state && !state.ok && state.fieldErrors?.fullName && (
          <p role="alert" className="mt-1.5 text-[13px] text-danger">
            {state.fieldErrors.fullName}
          </p>
        )}
      </div>

      <fieldset>
        <legend className="text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase">
          What do you do?
        </legend>
        <p className="mt-1 text-[13px] text-fg-muted">
          This decides what your dashboard leads with. You can change it later.
        </p>

        {/* A radio group rather than a `<select>`: seven options each needing a
            sentence of explanation is not a dropdown, and the explanation is
            the part that makes the answer accurate.

            The two text spans below are direct children of the label rather
            than wrapped in a positioning element. A wrapper reads better in the
            markup and buries the label's text one level deeper than
            `jsx-a11y/label-has-associated-control` inspects — at which point
            the control has no accessible name and the rule is right to say so.
            The grid does the layout instead of a wrapper. */}
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {ROLE_OPTIONS.map((option) => {
            const selected = role === option.value;
            return (
              <label
                key={option.value}
                className={[
                  "hl-focusable-within grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 rounded-md border p-3 transition-colors duration-[120ms]",
                  selected
                    ? "border-brand-border bg-brand-surface"
                    : "border-line bg-surface hover:border-line-strong",
                ].join(" ")}
              >
                <input
                  type="radio"
                  name="role"
                  value={option.value}
                  checked={selected}
                  onChange={() => setRole(option.value)}
                  className="row-span-2 mt-0.5 size-4 shrink-0 self-start accent-[var(--color-brand)]"
                />
                <span
                  className={[
                    "text-[13px] font-medium",
                    selected ? "text-brand-text" : "text-fg",
                  ].join(" ")}
                >
                  {option.label}
                </span>
                <span className="mt-0.5 text-[12px] leading-[1.5] text-fg-muted">
                  {option.description}
                </span>
              </label>
            );
          })}
        </div>

        {state && !state.ok && state.fieldErrors?.role && (
          <p role="alert" className="mt-2 text-[13px] text-danger">
            {state.fieldErrors.role}
          </p>
        )}
      </fieldset>

      {state && !state.ok && !state.fieldErrors && (
        <p role="alert" className="text-[13px] text-danger">
          {state.error}
        </p>
      )}

      <Button
        type="submit"
        variant="primary"
        size="lg"
        /* Disabled until a role is chosen rather than defaulting to one. A
           silent default here would give most users the generalist layout
           while the screen implies they picked it. */
        disabled={pending || !role || !name.trim()}
      >
        {pending ? "Saving…" : "Continue"}
      </Button>
    </form>
  );
}
