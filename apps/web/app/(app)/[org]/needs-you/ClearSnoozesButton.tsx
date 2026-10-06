"use client";

import { useState, useTransition } from "react";
import { Button, FormMessage } from "@huntloop/ui";
import { clearSnoozesAction } from "./actions";

/** "Bring them back" — undoes every snooze this person set. */
export function ClearSnoozesButton({ org }: { org: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: true; message?: string } | { ok: false; error: string } | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await clearSnoozesAction(org);
            setResult(res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
          })
        }
      >
        {pending ? "Bringing back…" : "Bring them back now"}
      </Button>
      <FormMessage result={result} />
    </span>
  );
}
