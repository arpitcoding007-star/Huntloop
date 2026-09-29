"use client";

import { useState, useTransition } from "react";
import { Button, FormMessage } from "@huntloop/ui";
import { Radar } from "lucide-react";
import { huntNowAction } from "./actions";

/** Starts discovery against the active customer profile (FLOW-008). */
export function HuntNowButton({ org }: { org: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<
    { ok: true; message?: string } | { ok: false; error: string } | null
  >(null);

  return (
    <>
      <Button
        icon={Radar}
        variant="secondary"
        size="lg"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const outcome = await huntNowAction(org);
            setResult(outcome.ok ? { ok: true, message: outcome.message } : outcome);
          })
        }
      >
        {pending ? "Starting…" : "Hunt now"}
      </Button>
      {result && <FormMessage result={result} className="basis-full" />}
    </>
  );
}
