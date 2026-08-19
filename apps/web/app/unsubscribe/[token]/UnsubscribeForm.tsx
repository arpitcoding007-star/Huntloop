"use client";

import { useState, useTransition } from "react";
import { Button } from "@huntloop/ui";
import { unsubscribeAction } from "./actions";

/**
 * One button, and the states it can end in.
 *
 * No form fields and nothing to get wrong. The person reading this did not
 * choose to be here and owes us nothing, so the whole interaction is: press
 * this, and it stops.
 *
 * The failure text is shown as plainly as the success. An unsubscribe that
 * silently did not work is the one outcome this page must never present as
 * done — they would find out by receiving the next message.
 */
export function UnsubscribeForm({ token }: { token: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<"idle" | "done" | { error: string }>("idle");

  if (state === "done") {
    return (
      <div className="rounded-md border border-success-border bg-success-surface px-4 py-3">
        <p className="text-[14px] text-success">You have been unsubscribed.</p>
        <p className="mt-1 text-[13px] text-fg-secondary">
          You will not receive further messages from this sender. Nothing else on
          this page needs doing, and you can close it.
        </p>
      </div>
    );
  }

  return (
    <>
      <Button
        variant="primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const outcome = await unsubscribeAction(token);
            setState(outcome.ok ? "done" : { error: outcome.error });
          })
        }
      >
        {pending ? "Unsubscribing…" : "Unsubscribe me"}
      </Button>

      {typeof state === "object" && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-danger-border bg-danger-surface px-3 py-2 text-[13px] text-danger"
        >
          {state.error}
        </p>
      )}
    </>
  );
}
