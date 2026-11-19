"use client";

import { useState, useTransition } from "react";
import { Button, FormMessage } from "@huntloop/ui";
import { RefreshCw } from "lucide-react";
import { refreshWhyNowAction } from "./actions";

/**
 * Asks for "why now" to be worked out from the evidence on file and saved
 * (TRUST-301, 0054). One model call, so it is shown only to members who may
 * spend, and the action refuses everyone else anyway.
 */
export function WhyNowButton({
  org,
  opportunityId,
  hasText,
}: {
  org: string;
  opportunityId: string;
  hasText: boolean;
}) {
  const [result, setResult] = useState<{ ok: true; message?: string } | { ok: false; error: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="mt-3 space-y-2">
      <Button
        variant="secondary"
        size="sm"
        icon={RefreshCw}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await refreshWhyNowAction(org, opportunityId);
            setResult(res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
          })
        }
      >
        {pending ? "Working it out…" : hasText ? "Work it out again" : "Work out why now"}
      </Button>
      <FormMessage result={result} />
    </div>
  );
}
