"use client";

import { useState, useTransition } from "react";
import { Button, Card, CardBody, CardHeader, Freshness } from "@huntloop/ui";
import { Check, X } from "lucide-react";
import type { PendingJoinRequest } from "../../../../lib/data/directory";
import { approveJoinAction, declineJoinAction } from "./actions";

/**
 * People at this company asking to be let in.
 *
 * ── Why this is not the invitations list ─────────────────────────────────
 *
 * An invitation is issued by an admin to an address they chose; a join request
 * is made by a person to an org that has not chosen them. They look alike on
 * screen and they trust opposite parties, which is why `0027` gives them
 * separate tables and why they get separate panels here. Merging them would
 * produce one list where half the rows are "we asked them" and half are "they
 * asked us", and an admin would have to read carefully to tell which.
 *
 * ── Why a request is not an automatic join ───────────────────────────────
 *
 * Because a shared email domain is evidence that somebody works at a company,
 * not evidence that they should see its pipeline. A contractor, a departed
 * employee whose address still resolves, and an unrelated department all match
 * on domain. The address is shown in full so the decision is made on the thing
 * that actually identifies the person.
 */
export function JoinRequests({
  org,
  requests,
}: {
  org: string;
  requests: PendingJoinRequest[];
}) {
  /* Decided rows disappear locally rather than waiting for a revalidation, so
     an admin working through four requests sees the list shrink as they go. */
  const [decided, setDecided] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const open = requests.filter((r) => !decided.includes(r.id));
  if (open.length === 0) return null;

  const decide = (id: string, action: typeof approveJoinAction) =>
    startTransition(async () => {
      setError(null);
      const result = await action(org, id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDecided((prev) => [...prev, id]);
    });

  return (
    <Card flush className="mt-6">
      <CardHeader
        title="Asking to join"
        description="People at your company's domain who found this workspace and asked to be let in."
      />
      <CardBody>
        <ul className="space-y-2">
          {open.map((request) => (
            <li
              key={request.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-line-subtle bg-surface px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-fg">
                  {request.email}
                </p>
                <p className="text-[12px] text-fg-muted">
                  <Freshness date={request.requestedAt} label="Asked" />
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={X}
                  disabled={pending}
                  onClick={() => decide(request.id, declineJoinAction)}
                >
                  Decline
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  icon={Check}
                  disabled={pending}
                  onClick={() => decide(request.id, approveJoinAction)}
                >
                  Let them in
                </Button>
              </div>
            </li>
          ))}
        </ul>

        {error && (
          <p role="alert" className="mt-3 text-[13px] text-danger">
            {error}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
