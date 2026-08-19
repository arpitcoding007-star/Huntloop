"use client";

import { useState, useTransition } from "react";
import { Badge, Button, Field, FormMessage, Select } from "@huntloop/ui";
import { Send, UserPlus } from "lucide-react";
import type { Member } from "../../../../../lib/data/team";
import type { CampaignTarget } from "../../../../../lib/data/outreach";
import { assignOpportunityAction } from "../../team/actions";
import { enrollOpportunitiesAction } from "../actions";

/**
 * The two things a person does from this page: give it an owner, and put it
 * into a campaign.
 *
 * ── Why these were `pending` and are not any more ────────────────────────
 *
 * Both buttons carried a reason rather than a handler, and both reasons had
 * quietly stopped being true. Ownership is `assignOpportunityAction`, which
 * the assignments board has been calling for some time; drafting is
 * `enrollOpportunitiesAction`, which the opportunity list calls for a whole
 * selection. This page is one row of that selection, so it is the same action
 * with one id — a second "enrol just this one" write would be a second place
 * for the campaign's autonomy rules to be checked.
 *
 * ── Why "Draft outreach" became "Add to campaign" ────────────────────────
 *
 * Because that is what pressing it does. Enrolling puts the opportunity into a
 * sequence, and whether the first message is drafted for review or sent on its
 * own is the campaign's autonomy level — not this button's. A control labelled
 * "Draft outreach" promises a draft, which at autonomy 2 and above is not what
 * would happen.
 */
export function OpportunityActions({
  org,
  opportunityId,
  owner,
  ownerId,
  members,
  campaigns,
  canWrite,
}: {
  org: string;
  opportunityId: string;
  /** The label — "You", or "another member". See `OpportunityDetail.owner`. */
  owner: string | null;
  ownerId: string | null;
  members: Member[];
  campaigns: CampaignTarget[];
  canWrite: boolean;
}) {
  const [assigning, setAssigning] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [result, setResult] = useState<
    { ok: true; message?: string } | { ok: false; error: string } | null
  >(null);

  if (!canWrite) {
    return (
      <Badge variant="neutral">{owner ? `Owned by ${owner}` : "Unassigned"}</Badge>
    );
  }

  return (
    <>
      <Button
        variant="secondary"
        icon={UserPlus}
        onClick={() => {
          setAssigning((open) => !open);
          setEnrolling(false);
        }}
      >
        {owner ? `Owned by ${owner}` : "Assign"}
      </Button>
      <Button
        variant="primary"
        icon={Send}
        onClick={() => {
          setEnrolling((open) => !open);
          setAssigning(false);
        }}
        pending={
          campaigns.length === 0
            ? "There are no campaigns to add this to yet. Create one under Outreach."
            : undefined
        }
      >
        Add to campaign
      </Button>

      {/* Full-width, so the panels sit under the header rather than squeezing
          the score and status badges beside them. `basis-full` inside the
          header's existing wrap is what puts them on their own line. */}
      {(assigning || enrolling) && (
        <div className="basis-full rounded-md border border-line bg-surface p-4">
          {assigning && (
            <Assign
              org={org}
              opportunityId={opportunityId}
              ownerId={ownerId}
              members={members}
              onResult={setResult}
              onDone={() => setAssigning(false)}
            />
          )}
          {enrolling && (
            <Enrol
              org={org}
              opportunityId={opportunityId}
              campaigns={campaigns}
              onResult={setResult}
              onDone={() => setEnrolling(false)}
            />
          )}
        </div>
      )}

      {result && <FormMessage result={result} className="basis-full" />}
    </>
  );
}

function Assign({
  org,
  opportunityId,
  ownerId,
  members,
  onResult,
  onDone,
}: {
  org: string;
  opportunityId: string;
  ownerId: string | null;
  members: Member[];
  onResult: (r: { ok: true; message?: string } | { ok: false; error: string }) => void;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();

  return (
    <Field label="Owner" className="max-w-[380px]">
      {(field) => (
        <Select
          {...field}
          defaultValue={ownerId ?? ""}
          disabled={pending}
          onChange={(e) =>
            start(async () => {
              const res = await assignOpportunityAction(
                org,
                opportunityId,
                /* The empty option is "nobody", which is NULL rather than an
                   empty string the uuid column would reject. */
                e.target.value || null,
              );
              onResult(
                res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error },
              );
              if (res.ok) onDone();
            })
          }
        >
          <option value="">Unassigned</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {memberLabel(m)}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

function Enrol({
  org,
  opportunityId,
  campaigns,
  onResult,
  onDone,
}: {
  org: string;
  opportunityId: string;
  campaigns: CampaignTarget[];
  onResult: (r: { ok: true; message?: string } | { ok: false; error: string }) => void;
  onDone: () => void;
}) {
  const sendable = campaigns.filter((c) => c.sendable);
  const [campaignId, setCampaignId] = useState(sendable[0]?.id ?? "");
  const [pending, start] = useTransition();

  const chosen = campaigns.find((c) => c.id === campaignId) ?? null;

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Campaign" className="min-w-[240px] flex-1">
          {(field) => (
            <Select
              {...field}
              value={campaignId}
              disabled={pending}
              onChange={(e) => setCampaignId(e.target.value)}
            >
              <option value="">Choose a campaign…</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id} disabled={!c.sendable}>
                  {c.name} · {c.status} · autonomy {c.autonomyLevel}
                  {c.sendable ? "" : " — no email step yet"}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <div className="flex items-center gap-2 pb-0.5">
          <Button
            size="sm"
            variant="primary"
            icon={Send}
            disabled={pending}
            pending={campaignId ? undefined : "Choose a campaign first."}
            onClick={() =>
              start(async () => {
                const res = await enrollOpportunitiesAction(org, campaignId, [opportunityId]);
                onResult(
                  res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error },
                );
                if (res.ok) onDone();
              })
            }
          >
            {pending ? "Adding…" : "Add"}
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={onDone}>
            Cancel
          </Button>
        </div>
      </div>

      {/* §46's ladder, stated before the commit rather than after it. */}
      {chosen && chosen.sendable && (
        <p className="mt-3 text-[13px] text-fg-muted">
          {chosen.autonomyLevel >= 2
            ? `"${chosen.name}" is at autonomy ${chosen.autonomyLevel}, so messages it writes are sent without further approval.`
            : `"${chosen.name}" is at autonomy ${chosen.autonomyLevel}, so messages are drafted and wait for you.`}
        </p>
      )}
    </div>
  );
}

/** §21: a colleague is named only as much as the screen needs. */
function memberLabel(member: Member): string {
  if (member.isYou) return "You";
  if (member.name && member.email) return `${member.name} · ${member.email}`;
  return member.name ?? member.email ?? member.userId;
}
