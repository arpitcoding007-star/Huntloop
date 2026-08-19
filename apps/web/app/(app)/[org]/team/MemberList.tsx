"use client";

import { useState, useTransition } from "react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  FormMessage,
  Select,
  Freshness,
} from "@huntloop/ui";
import { Trash2, UserPlus } from "lucide-react";
import type { Role } from "../../../../lib/data/membership";
import type { Member } from "../../../../lib/data/team";
import { removeMemberAction, setMemberRoleAction } from "./actions";

/**
 * Members — the role enum from `0001`, made editable.
 *
 * ── Why nobody has a name ────────────────────────────────────────────────
 *
 * There is nowhere to read one from: names and emails live in `auth.users`,
 * which Supabase does not expose to tenants, and reaching them needs the
 * service-role client `apps/web` is forbidden to import. There is no
 * `profiles` table yet — that is `TEAM-01` in the backlog, and it is a
 * migration rather than something this screen can work around.
 *
 * So it shows what is true and says why the rest is missing. The alternative,
 * rendering a blank where a name goes, reads as "this person has no name"
 * rather than "we cannot see it" — and inventing one from a uuid would be the
 * §7 failure aimed at our own interface.
 *
 * What the screen *can* do completely is the part that matters: roles are
 * real, and the four levels are the ones RLS enforces.
 */

const ROLE_HELP: Record<Role, string> = {
  owner: "Everything, including billing and the last word on membership.",
  admin: "Manage members and organisation settings.",
  member: "Work opportunities, run hunts, send outreach.",
  viewer: "Read-only. Cannot change anything, including their own role.",
};

export function MemberList({
  org,
  members,
  canAdmin,
  now,
}: {
  org: string;
  members: Member[];
  canAdmin: boolean;
  now: string;
}) {
  const [result, setResult] = useState<
    { ok: true; message?: string } | { ok: false; error: string } | null
  >(null);

  const owners = members.filter((m) => m.role === "owner").length;

  return (
    <div className="space-y-6">
      <Card flush>
        <CardHeader
          title="Members"
          description="Who can see this organisation, and what each of them may do."
          actions={
            /* Inviting means creating a user, which is `auth.admin` and needs
               the service-role key this app may not import. The control says
               so rather than rendering as live (NAV-03). */
            <Button
              size="sm"
              variant="secondary"
              icon={UserPlus}
              pending="Invites aren't built yet — creating a user needs a server-side admin path this app doesn't have."
            >
              Invite
            </Button>
          }
        />
        <CardBody>
          <p className="mb-4 rounded-md border border-line bg-surface px-3 py-2 text-[12px] text-fg-muted">
            Names and email addresses aren&rsquo;t shown because they live in
            Supabase&rsquo;s auth schema, which this app deliberately cannot
            read. Members are identified by their user id until a profiles
            table exists.
          </p>

          <ul className="divide-y divide-line-subtle">
            {members.map((m) => (
              <MemberRow
                key={m.id}
                org={org}
                member={m}
                canAdmin={canAdmin}
                isLastOwner={m.role === "owner" && owners <= 1}
                now={now}
                onResult={setResult}
              />
            ))}
          </ul>

          <FormMessage result={result} className="mt-4" />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="What each role may do"
          description="These are the levels the database enforces, not a convention this screen applies."
        />
        <CardBody>
          <dl className="space-y-2">
            {(Object.keys(ROLE_HELP) as Role[]).map((role) => (
              <div key={role} className="flex flex-wrap items-baseline gap-2">
                <dt>
                  <Badge variant={role === "viewer" ? "neutral" : "brand"}>{role}</Badge>
                </dt>
                <dd className="text-[13px] text-fg-secondary">{ROLE_HELP[role]}</dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>
    </div>
  );
}

const ROLES: Role[] = ["owner", "admin", "member", "viewer"];

function MemberRow({
  org,
  member,
  canAdmin,
  isLastOwner,
  now,
  onResult,
}: {
  org: string;
  member: Member;
  canAdmin: boolean;
  isLastOwner: boolean;
  now: string;
  onResult: (r: { ok: true; message?: string } | { ok: false; error: string }) => void;
}) {
  const [pending, start] = useTransition();

  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-mono text-[12px] text-fg">{member.userId}</span>
          {member.isYou && <Badge variant="brand">You</Badge>}
          {isLastOwner && <Badge variant="neutral">Last owner</Badge>}
        </div>
        {member.joinedAt && (
          <div className="mt-1">
            <Freshness date={member.joinedAt} now={new Date(now)} label="Joined" />
          </div>
        )}
      </div>

      {canAdmin ? (
        <label className="flex items-center gap-2">
          <span className="sr-only">Role for {member.userId}</span>
          <Select
            value={member.role}
            disabled={pending}
            className="mt-0 h-8 w-[120px]"
            onChange={(e) =>
              start(async () => {
                const res = await setMemberRoleAction(org, member.id, e.target.value);
                onResult(
                  res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error },
                );
              })
            }
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </label>
      ) : (
        <Badge variant={member.role === "viewer" ? "neutral" : "brand"}>{member.role}</Badge>
      )}

      {canAdmin && (
        <Button
          size="sm"
          variant="ghost"
          icon={Trash2}
          aria-label={`Remove ${member.userId}`}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await removeMemberAction(org, member.id);
              onResult(
                res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error },
              );
            })
          }
        />
      )}
    </li>
  );
}
