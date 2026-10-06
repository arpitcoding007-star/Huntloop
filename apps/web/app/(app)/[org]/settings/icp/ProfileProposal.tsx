"use client";

import { useState, useTransition } from "react";
import { Button, Card, CardBody, CardHeader, FormMessage } from "@huntloop/ui";
import { Check } from "lucide-react";
import type { IcpProposalView } from "../../../../../lib/data/icp-proposal";
import type { ProposalItem } from "../../../../../lib/icp-proposal";
import { applyIcpProposalAction } from "./actions";

const FIELD_LABEL: Record<ProposalItem["field"], string> = {
  industries: "Industry",
  sizes: "Company size",
  regions: "Region",
  exclusions: "Not a fit",
};

/**
 * "What the companies you took on have in common" — the tighter profile the
 * dashboard nudge promises (M-12). Every suggestion names the companies behind
 * it and what it would have changed; nothing is applied until a person picks
 * it, and applying only ever adds to the profile.
 */
export function ProfileProposal({
  org,
  view,
  canWrite,
}: {
  org: string;
  view: IcpProposalView;
  canWrite: boolean;
}) {
  const { proposal } = view;
  const key = (i: ProposalItem) => `${i.field}:${i.value}`;
  const [picked, setPicked] = useState<Set<string>>(() => new Set(proposal.items.map(key)));
  const [result, setResult] = useState<
    { ok: true; message?: string } | { ok: false; error: string } | null
  >(null);
  const [pending, start] = useTransition();

  // Items re-render from the server after applying; count only what is shown.
  const chosen = proposal.items.filter((i) => picked.has(key(i)));

  const toggle = (k: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <Card id="proposal">
      <CardHeader
        title="Suggested from your decisions"
        description={`From ${proposal.basis.accepted} companies you took on${
          proposal.basis.declined ? ` and ${proposal.basis.declined} you marked not a fit` : ""
        }. Counted, not guessed — each line names the companies behind it.`}
      />
      <CardBody className="space-y-4">
        {proposal.items.length === 0 ? (
          <p className="text-[13px] text-fg-muted">
            Your profile already says what these companies have in common. Nothing to add.
          </p>
        ) : (
          <ul className="space-y-2">
            {proposal.items.map((item) => {
              const k = key(item);
              const on = picked.has(k);
              return (
                <li key={k}>
                  {/* Text spans are direct children of the label, laid out by the
                      grid, so the checkbox has an accessible name (see YouForm). */}
                  <label className="hl-focusable-within grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-x-3 rounded-md border border-line bg-surface p-3 hover:bg-hover">
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!canWrite || pending}
                      onChange={() => toggle(k)}
                      className="row-span-2 mt-0.5 size-4 shrink-0 accent-[var(--color-brand)]"
                    />
                    <span className="text-[13px] text-fg">
                      {FIELD_LABEL[item.field]}: {item.value}
                    </span>
                    <span className="mt-0.5 text-[12px] leading-[1.5] text-fg-muted">
                        {item.field === "exclusions"
                          ? `Marked not a fit ${item.declined} times and never taken on. Listing it would have kept ${item.declined === 1 ? "that company" : `those ${item.declined}`} off your list.`
                          : `${item.accepted} of ${proposal.basis.accepted} companies you took on${
                              item.declined ? `, and ${item.declined} you turned down` : ""
                            }.`}{" "}
                        {item.examples.length > 0 && <>For example {item.examples.join(", ")}.</>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        {canWrite && proposal.items.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              icon={Check}
              disabled={pending || chosen.length === 0}
              onClick={() =>
                start(async () => {
                  setResult(null);
                  const picks = chosen.map((i) => ({ field: i.field, value: i.value }));
                  const res = await applyIcpProposalAction(org, { icpId: view.icpId, picks });
                  setResult(res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
                })
              }
            >
              {pending ? "Adding…" : `Add ${chosen.length} to ${view.icpName}`}
            </Button>
            <span className="text-[12px] text-fg-muted">
              Adds to the profile; nothing on it is removed.
            </span>
          </div>
        )}

        <FormMessage result={result} />
      </CardBody>
    </Card>
  );
}
