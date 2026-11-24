"use client";

import { useState, useTransition } from "react";
import { Card, CardHeader, ConfirmButton, FormMessage, Select } from "@huntloop/ui";
import { Trash2 } from "lucide-react";
import { VISIBILITY } from "../../../../../lib/exchange/requirement";
import { deleteMyIntakeSessionsAction, updateNeedAction } from "../actions";

type Result = { ok: true; message?: string } | { ok: false; error: string } | null;

export function PrivacyControls({
  org,
  needs,
  sessions,
  canWrite,
}: {
  org: string;
  needs: { id: string; summary: string; visibility: number }[];
  sessions: number;
  canWrite: boolean;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result>(null);
  const act = (fn: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>) =>
    start(async () => {
      const res = await fn();
      setResult(res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
    });

  return (
    <>
      <Card>
        <CardHeader title="Your requests" description="Change who may see each one." />
        <div className="mt-3 divide-y divide-line-subtle">
          {needs.length === 0 ? (
            <p className="py-2 text-[13px] text-fg-muted">You have not filed any requests.</p>
          ) : (
            needs.map((n) => (
              <div key={n.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <p className="min-w-0 flex-1 truncate text-[13px] text-fg">{n.summary}</p>
                <Select
                  aria-label={`Who may see “${n.summary}”`}
                  className="mt-0 w-56"
                  value={String(n.visibility)}
                  disabled={!canWrite || pending}
                  onChange={(e) => act(() => updateNeedAction(org, n.id, { visibility: Number(e.target.value) }))}
                >
                  {VISIBILITY.map((v) => (
                    <option key={v.level} value={v.level}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Questionnaire transcripts"
          description="The conversations you had while filing requests. The requests themselves are kept if you delete these."
        />
        <div className="mt-3 flex items-center gap-3 text-[13px] text-fg">
          <span>
            {sessions === 0 ? "None kept." : `${sessions} ${sessions === 1 ? "transcript" : "transcripts"} kept.`}
          </span>
          {sessions > 0 && (
            <ConfirmButton
              size="sm"
              icon={Trash2}
              label="Delete my questionnaire transcripts"
              confirmLabel="Delete all"
              disabled={pending}
              pending={pending}
              onConfirm={() => act(() => deleteMyIntakeSessionsAction(org))}
            />
          )}
        </div>
      </Card>
      <FormMessage result={result} />
    </>
  );
}
