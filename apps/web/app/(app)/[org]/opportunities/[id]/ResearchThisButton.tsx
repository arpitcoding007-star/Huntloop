"use client";

import { useState, useTransition } from "react";
import { Button, FormMessage } from "@huntloop/ui";
import { RefreshCw } from "lucide-react";
import { askResearchAction } from "./brief-actions";

export function ResearchThisButton({
  org,
  opportunityId,
  queued,
  lastResearchedAt,
}: {
  org: string;
  opportunityId: string;
  queued: boolean;
  lastResearchedAt: string | null;
}) {
  const [result, setResult] = useState<{ ok: true; message?: string } | { ok: false; error: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          icon={RefreshCw}
          disabled={pending || queued}
          onClick={() =>
            start(async () => {
              const res = await askResearchAction(org, opportunityId);
              setResult(res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
            })
          }
        >
          {queued ? "Research queued" : pending ? "Requesting…" : "Research this"}
        </Button>
        <span className="text-[12px] text-fg-muted">
          {lastResearchedAt ? `Last researched ${new Date(lastResearchedAt).toLocaleDateString()}.` : "Not researched yet."}
        </span>
      </div>
      <FormMessage result={result} />
    </div>
  );
}
