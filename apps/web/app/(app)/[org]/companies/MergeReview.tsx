"use client";

import { useState, useTransition } from "react";
import { Badge, Button, Card, CardBody, CardHeader, FormMessage } from "@huntloop/ui";
import { GitMerge, X } from "lucide-react";
import { MATCH_REASONS, type MergeCandidate } from "../../../../lib/data/merge-candidates.shared";
import { mergeCompaniesAction, rejectMergeAction } from "./actions";

/**
 * Possible duplicates, one decision each (Phase 3.3).
 *
 * The resolver only proposes; a person merges. Each pair says which signal
 * matched, because "same provider id" and "similar name" deserve different
 * amounts of trust, and the reviewer picks which record survives.
 */
export function MergeReview({
  org,
  candidates,
  canWrite,
}: {
  org: string;
  candidates: MergeCandidate[];
  canWrite: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: true; message?: string } | { ok: false; error: string } | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());

  /* UX-001: a merge cannot be undone from here, so choosing a survivor arms
     the row and states what will happen; only the second click merges. */
  const [arming, setArming] = useState<{ id: string; keep: "a" | "b" } | null>(null);

  const open = candidates.filter((c) => !done.has(c.id));
  /* UX-002: when the last pair is decided, the panel says so once and goes,
     instead of announcing "0 pairs". */
  if (!open.length && !message) return null;

  const decide = (id: string, run: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    startTransition(async () => {
      const result = await run();
      setArming(null);
      if (result.ok) setDone((prev) => new Set(prev).add(id));
      setMessage(result.ok ? { ok: true, message: result.message ?? "Done." } : { ok: false, error: result.error ?? "That didn't work." });
    });

  return (
    <div className="px-6 pt-6 lg:px-8">
      <Card>
        <CardHeader
          title="Possible duplicates"
          description={
            open.length
              ? `${open.length}${candidates.length >= 50 ? "+" : ""} pair${open.length === 1 ? "" : "s"} that look like the same company. ` +
                "Merging keeps one record and moves its opportunities, people and evidence onto it."
              : "Nothing left to review."
          }
        />
        <CardBody>
          <FormMessage result={message} />
          <ul className="divide-y divide-[var(--border)]">
            {open.map((c) => (
              <li key={c.id} className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <p className="font-medium">
                    {c.a.name} <span className="text-[var(--text-muted)]">({c.a.domain})</span> and {c.b.name}{" "}
                    <span className="text-[var(--text-muted)]">({c.b.domain})</span>
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--text-muted)]">
                    {MATCH_REASONS[c.matchedOn] ?? c.matchedOn}
                    <Badge variant="neutral">{c.confidence} confidence</Badge>
                  </p>
                </div>
                {canWrite && arming?.id === c.id ? (
                  <div className="flex flex-col gap-2 md:items-end" role="group" aria-label="Confirm merge">
                    <p className="text-sm">
                      Merge {arming.keep === "a" ? c.b.name : c.a.name} into{" "}
                      <strong>{arming.keep === "a" ? c.a.name : c.b.name}</strong>? This cannot be undone here.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={pending}
                        onClick={() =>
                          decide(c.id, () => mergeCompaniesAction(org, c.id, arming.keep === "a" ? c.a.id : c.b.id))
                        }
                      >
                        <GitMerge size={14} aria-hidden /> Merge
                      </Button>
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => setArming(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : canWrite ? (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={pending} onClick={() => setArming({ id: c.id, keep: "a" })}>
                      <GitMerge size={14} aria-hidden /> Keep {c.a.name}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => setArming({ id: c.id, keep: "b" })}
                    >
                      <GitMerge size={14} aria-hidden /> Keep {c.b.name}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => decide(c.id, () => rejectMergeAction(org, c.id))}
                    >
                      <X size={14} aria-hidden /> Not the same
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
