"use client";

import { useState, useTransition } from "react";
import { Button, FormMessage } from "@huntloop/ui";
import { Check } from "lucide-react";
import { acceptInvitationAction } from "./actions";

/**
 * The button that redeems the token.
 *
 * On success the action redirects, so this component never renders a success
 * state — the next thing the user sees is the organisation's dashboard.
 * That is the right shape: a "you have joined" screen with a link on it is a
 * dead end wearing a tick.
 */
export function AcceptInvite({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div>
      <Button
        variant="primary"
        icon={Check}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await acceptInvitationAction(token);
            /* Only reachable on failure: the action redirects on success, and
               a redirect from a Server Action unwinds through this transition
               rather than returning. */
            if (!result.ok) setError(result.error);
          })
        }
      >
        {pending ? "Joining…" : "Accept invitation"}
      </Button>

      <FormMessage result={error ? { ok: false, error } : null} className="mt-4" />
    </div>
  );
}
