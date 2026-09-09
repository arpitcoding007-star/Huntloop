"use client";

import { useState, useTransition } from "react";
import { Button } from "@huntloop/ui";
import { Building2, Check } from "lucide-react";
import type { DiscoverableWorkspace } from "../../../../lib/data/directory";
import { requestJoinAction } from "./actions";

/**
 * "Your company is already here."
 *
 * ── Why this sits on the company step rather than anywhere else ──────────
 *
 * Because it is the last screen before a duplicate workspace exists. Step two
 * is where `createWorkspace` runs; offering the choice afterwards would mean
 * offering it to somebody who has already made the thing the offer exists to
 * prevent.
 *
 * ── Why it does not block ────────────────────────────────────────────────
 *
 * A second workspace at the same domain is often exactly right — a large
 * company with two teams, an agency setting up a client that happens to share
 * their domain, someone deliberately starting fresh. So this is an offer with
 * the alternative left fully available underneath, not a wall. The failure it
 * addresses is people who did not *know*, and telling them is the whole fix.
 *
 * ── Why the request is not an instant join ───────────────────────────────
 *
 * Sharing an email domain is evidence that somebody works at a company, not
 * evidence that they should see its pipeline. A contractor, a departed
 * employee whose address still resolves, or a large company's unrelated
 * department all match on domain. An admin decides.
 */
export function JoinExisting({
  workspaces,
}: {
  workspaces: DiscoverableWorkspace[];
}) {
  const [requested, setRequested] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (workspaces.length === 0) return null;

  return (
    <section
      aria-labelledby="join-existing-heading"
      className="mt-6 max-w-lg rounded-md border border-brand-border bg-brand-surface/30 p-4"
    >
      <div className="flex items-start gap-3">
        <Building2 aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <h2 id="join-existing-heading" className="text-[14px] font-semibold text-fg">
            {workspaces.length === 1
              ? "Your company already has a workspace"
              : "Your company already has workspaces here"}
          </h2>
          <p className="mt-1 text-[13px] leading-[1.6] text-fg-muted">
            Joining shares the customer profile, the sources and the pipeline
            your colleagues have already built. Setting up a new one starts from
            scratch and bills separately.
          </p>

          <ul className="mt-3 space-y-2">
            {workspaces.map((workspace) => {
              const asked = requested.includes(workspace.orgId);
              return (
                <li
                  key={workspace.orgId}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-line-subtle bg-surface px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-fg">{workspace.name}</p>
                    <p className="text-[12px] text-fg-muted">
                      {workspace.memberCount}{" "}
                      {workspace.memberCount === 1 ? "member" : "members"} ·{" "}
                      <span className="font-mono">/{workspace.slug}</span>
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={asked ? "ghost" : "primary"}
                    icon={asked ? Check : undefined}
                    disabled={pending || asked}
                    onClick={() =>
                      startTransition(async () => {
                        setError(null);
                        const result = await requestJoinAction(workspace.orgId);
                        if (!result.ok) {
                          setError(result.error);
                          return;
                        }
                        setRequested((prev) => [...prev, workspace.orgId]);
                      })
                    }
                  >
                    {asked ? "Asked" : "Ask to join"}
                  </Button>
                </li>
              );
            })}
          </ul>

          {requested.length > 0 && (
            <p role="status" className="mt-3 text-[12px] leading-[1.5] text-fg-muted">
              An admin will see the request. You can carry on setting up your own
              workspace below in the meantime — nothing is waiting on them.
            </p>
          )}

          {error && (
            <p role="alert" className="mt-3 text-[13px] text-danger">
              {error}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
