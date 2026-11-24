"use client";

import { useState, useTransition } from "react";
import { Button, FormMessage } from "@huntloop/ui";
import { Download } from "lucide-react";
import { exportExchangeDataAction } from "../actions";

type Result = { ok: true; message?: string } | { ok: false; error: string } | null;

/** Downloads everything the Exchange holds about this workspace as a buyer, as JSON. */
export function ExportButton({ org }: { org: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        size="sm"
        variant="secondary"
        icon={Download}
        disabled={pending}
        pending={pending ? "Preparing…" : undefined}
        onClick={() =>
          start(async () => {
            const res = await exportExchangeDataAction(org);
            if (!res.ok) {
              setResult({ ok: false, error: res.error });
              return;
            }
            const url = URL.createObjectURL(new Blob([res.data.json], { type: "application/json" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = `exchange-data-${org}-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            setResult({ ok: true, message: "Downloaded." });
          })
        }
      >
        Download my Exchange data
      </Button>
      <FormMessage result={result} />
    </div>
  );
}
