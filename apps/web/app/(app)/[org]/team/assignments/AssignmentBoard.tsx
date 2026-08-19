"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  Badge,
  Card,
  CardBody,
  EmptyState,
  FormMessage,
  PriorityBadge,
  SectionLabel,
  Select,
} from "@huntloop/ui";
import { UserCheck } from "lucide-react";
import type { Assignment, Member } from "../../../../../lib/data/team";
import { assignOpportunityAction } from "../actions";

/**
 * Assignments — who owns which opportunity.
 *
 * ── Why unassigned work is its own section ───────────────────────────────
 *
 * Because it is the only part of this screen anybody comes here to change. An
 * assignment view that mixes owned and unowned rows in one list makes the
 * question "what is nobody working on?" a scanning exercise, and that question
 * is the reason the screen exists. §14 makes an opportunity a unit of work,
 * and work with no owner is the failure state.
 *
 * Ordering inside each section is priority then recency — the same rule as the
 * opportunity list, so unassigned work is triaged in the order it would be
 * worked rather than in insertion order.
 *
 * Members are named through `profiles` (0007), which is what makes the owner
 * dropdown usable: handing work to a colleague means recognising them in a
 * list, and a list of uuids is a list you cannot choose from. Where a person
 * has supplied no name the address stands in, and the uuid is the last
 * fallback — see `memberLabel` below.
 */
export function AssignmentBoard({
  org,
  assignments,
  members,
  canWrite,
}: {
  org: string;
  assignments: Assignment[];
  members: Member[];
  canWrite: boolean;
}) {
  const [result, setResult] = useState<
    { ok: true; message?: string } | { ok: false; error: string } | null
  >(null);

  const { unassigned, assigned } = useMemo(
    () => ({
      unassigned: assignments.filter((a) => !a.ownerId),
      assigned: assignments.filter((a) => a.ownerId),
    }),
    [assignments],
  );

  const mine = assigned.filter((a) => a.ownerIsYou).length;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Figure label="Unassigned" value={unassigned.length} />
        <Figure label="Assigned" value={assigned.length} />
        <Figure label="Yours" value={mine} />
      </div>

      <FormMessage result={result} />

      <section>
        <SectionLabel>Nobody is working on these</SectionLabel>
        <Card flush className="mt-3">
          {unassigned.length === 0 ? (
            <CardBody>
              <p className="text-[13px] text-fg-muted">
                Every opportunity has an owner. New ones arrive here as a hunt
                finds them.
              </p>
            </CardBody>
          ) : (
            <ul className="divide-y divide-line-subtle">
              {unassigned.map((a) => (
                <AssignmentRow
                  key={a.id}
                  org={org}
                  assignment={a}
                  members={members}
                  canWrite={canWrite}
                  onResult={setResult}
                />
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section>
        <SectionLabel>Assigned</SectionLabel>
        <Card flush className="mt-3">
          {assigned.length === 0 ? (
            <CardBody>
              <EmptyState
                icon={UserCheck}
                title="Nothing is assigned yet"
                description="Give an opportunity an owner above and it moves here, and its status moves to assigned."
              />
            </CardBody>
          ) : (
            <ul className="divide-y divide-line-subtle">
              {assigned.map((a) => (
                <AssignmentRow
                  key={a.id}
                  org={org}
                  assignment={a}
                  members={members}
                  canWrite={canWrite}
                  onResult={setResult}
                />
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[11px] font-medium tracking-[0.06em] text-fg-muted uppercase">
        {label}
      </p>
      <p className="mt-0.5 font-mono text-[18px] text-fg">{value}</p>
    </div>
  );
}

function AssignmentRow({
  org,
  assignment,
  members,
  canWrite,
  onResult,
}: {
  org: string;
  assignment: Assignment;
  members: Member[];
  canWrite: boolean;
  onResult: (r: { ok: true; message?: string } | { ok: false; error: string }) => void;
}) {
  const [pending, start] = useTransition();

  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/${org}/opportunities/${assignment.id}`}
            className="hl-focusable truncate text-[13px] font-medium text-fg underline-offset-2 hover:underline"
          >
            {assignment.company}
          </Link>
          <PriorityBadge
            priority={assignment.priority}
            reason={assignment.priorityReason}
          />
          <Badge variant="neutral">{assignment.status}</Badge>
        </div>
        {assignment.ownerId && (
          <p className="mt-1 truncate text-[12px] text-fg-muted">
            {assignment.ownerIsYou
              ? "You"
              : (assignment.ownerName ?? assignment.ownerId)}
          </p>
        )}
      </div>

      {canWrite ? (
        <label className="flex items-center gap-2">
          <span className="sr-only">Owner for {assignment.company}</span>
          <Select
            value={assignment.ownerId ?? ""}
            disabled={pending}
            className="mt-0 h-8 w-[260px]"
            onChange={(e) =>
              start(async () => {
                const res = await assignOpportunityAction(
                  org,
                  assignment.id,
                  // The empty option is "nobody", which is NULL rather than
                  // an empty string the uuid column would reject.
                  e.target.value || null,
                );
                onResult(
                  res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error },
                );
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
        </label>
      ) : (
        <Badge variant="neutral">
          {assignment.ownerId ? (assignment.ownerIsYou ? "Yours" : "Assigned") : "Unassigned"}
        </Badge>
      )}
    </li>
  );
}

/**
 * How a member reads in the owner dropdown.
 *
 * "You" first, because the most common assignment is to yourself and reading
 * your own name in a list of colleagues is slower than reading the word. Then
 * the name, then the address, then the id — each step down is a fact the row
 * genuinely has, and nothing is synthesised from the one below it.
 */
function memberLabel(member: Member): string {
  if (member.isYou) return "You";
  if (member.name && member.email) return `${member.name} · ${member.email}`;
  return member.name ?? member.email ?? member.userId;
}
