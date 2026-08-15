"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@huntloop/ui";
import { slugify } from "../../../lib/slug";
import { createOrganisation, type OrgFormState } from "./actions";

/**
 * Organisation creation.
 *
 * The slug preview updates as you type, because the slug becomes part of every
 * URL in the product and is not editable afterwards. Showing it only *after*
 * submission is how people end up with `acme-inc-2` forever — and it is the
 * mitigation for slugify's rough edges with non-decomposing letters.
 */
export function OrgForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [state, formAction, pending] = useActionState<OrgFormState, FormData>(
    createOrganisation,
    {},
  );

  const slug = slugify(name);

  // When there's no database the action can't redirect (nothing was written),
  // so it hands the slug back and navigation happens here instead.
  useEffect(() => {
    if (state.slug) router.push(`/welcome/product?org=${state.slug}`);
  }, [state.slug, router]);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label
          htmlFor="name"
          className="block text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase"
        >
          Organisation name
        </label>
        <input
          id="name"
          name="name"
          required
          /* jsx-a11y bans autoFocus outright, and it is right to by default:
             stealing focus on a content page skips whatever the user was
             about to read. This is the narrow case where it doesn't — a
             dedicated onboarding step whose entire content is one labelled
             field and a button. There is nothing above to skip past. */
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Acme Inc"
          className="hl-focusable mt-1.5 h-10 w-full rounded-md border border-line bg-surface px-3 text-[14px] text-fg placeholder:text-fg-muted"
        />
        <p className="mt-1.5 text-[12px] text-fg-muted">
          Your URL will be{" "}
          <span className="font-mono text-fg-secondary">
            /{slug || "your-org"}
          </span>
          {" — this can't be changed later."}
        </p>
      </div>

      {state.error && (
        <p role="alert" className="text-[13px] text-danger">
          {state.error}
        </p>
      )}

      <Button type="submit" variant="primary" size="lg" disabled={pending}>
        {pending ? "Creating…" : "Continue"}
      </Button>
    </form>
  );
}
