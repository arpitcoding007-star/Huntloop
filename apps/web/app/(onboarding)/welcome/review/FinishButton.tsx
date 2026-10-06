"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@huntloop/ui";
import { finishOnboarding } from "../actions";

/**
 * The last click of setup.
 *
 * It does two things a plain link could not: it marks the workspace `done`, so
 * the post-auth resolver stops sending this user back into the flow, and it
 * remembers the workspace so a returning multi-org user skips the picker.
 *
 * ── Why a failure does not trap anyone ───────────────────────────────────
 *
 * Because the user is finished either way. Everything they entered is already
 * saved — the profile, the sources, the discovered companies — and the only
 * thing this call writes is a progress marker. Trapping somebody on the last
 * screen of setup because a bookkeeping update failed would be the worst
 * possible trade: they would lose access to a workspace that is, in every
 * respect that matters, ready.
 *
 * So a failure says what happened and offers the workspace anyway. It used to
 * set the note and navigate in the same tick, so the note was never seen
 * (M-06). The cost of continuing is that the dashboard may offer setup again;
 * that is recoverable in one click, being stuck here is not.
 */
export function FinishButton({ org }: { org: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="primary"
        size="lg"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await finishOnboarding(org);
            if (!result.ok) {
              setNote(
                "Your workspace is ready — we just couldn't tick setup off, so " +
                  "you may be offered it again. Try once more, or open it anyway.",
              );
              return;
            }
            router.push(`/${org}/dashboard`);
          })
        }
      >
        {pending ? "Opening…" : note ? "Try again" : "Take me to my workspace"}
      </Button>
      {note && (
        <>
          <Button variant="ghost" size="lg" onClick={() => router.push(`/${org}/dashboard`)}>
            Open it anyway
          </Button>
          <p role="status" className="w-full text-[13px] text-fg-muted">
            {note}
          </p>
        </>
      )}
    </div>
  );
}
