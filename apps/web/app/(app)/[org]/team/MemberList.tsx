"use client";

import { useState, useTransition } from "react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  FormMessage,
  Freshness,
  Input,
  Select,
} from "@huntloop/ui";
import { Copy, Trash2, UserPlus, X } from "lucide-react";
import type { Role } from "../../../../lib/data/membership";
import type { Invitation, Member } from "../../../../lib/data/team";
import {
  inviteMemberAction,
  removeMemberAction,
  revokeInvitationAction,
  setMemberRoleAction,
} from "./actions";

/**
 * Members — the role enum from `0001`, made editable, and `0007`'s invitations.
 *
 * ── Identity ────────────────────────────────────────────────────────────
 *
 * This screen used to show uuids, because names live in `auth.users` and
 * tenants cannot read that table. `0007`'s `profiles` — one row per user,
 * written by a trigger, readable only by co-members — closes that.
 *
 * The uuid is still the last fallback and is still shown when there is
 * genuinely nothing else, because a profile row can legitimately have no name:
 * a magic-link signup supplies an address and nothing more. Address, then id.
 * Never a name derived from either.
 */

const ROLE_HELP: Record<Role, string> = {
  owner: "Everything, including billing and the last word on membership.",
  admin: "Manage members and organisation settings.",
  member: "Work opportunities, run hunts, send outreach.",
  viewer: "Read-only. Cannot change anything, including their own role.",
};

type Result = { ok: true; message?: string } | { ok: false; error: string } | null;

export function MemberList({
  org,
  members,
  invitations,
  canAdmin,
  now,
}: {
  org: string;
  members: Member[];
  invitations: Invitation[];
  canAdmin: boolean;
  now: string;
}) {
  const [result, setResult] = useState<Result>(null);
  const [inviting, setInviting] = useState(false);
  const [issued, setIssued] = useState<{ url: string; email: string } | null>(null);

  const owners = members.filter((m) => m.role === "owner").length;

  return (
    <div className="space-y-6">
      <Card flush>
        <CardHeader
          title="Members"
          description="Who can see this organisation, and what each of them may do."
          actions={
            canAdmin && (
              <Button
                size="sm"
                variant="secondary"
                icon={UserPlus}
                onClick={() => {
                  setInviting((v) => !v);
                  setIssued(null);
                }}
              >
                Invite
              </Button>
            )
          }
        />
        <CardBody>
          {inviting && (
            <InviteForm
              org={org}
              onIssued={(r) => {
                setIssued(r);
                setInviting(false);
              }}
              onCancel={() => setInviting(false)}
              onResult={setResult}
            />
          )}

          {issued && <IssuedLink url={issued.url} email={issued.email} />}

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

      {/* Rendered only when there is something to show. `invitation_admin` in
          0007 is admin-scoped, so a member's loader returns zero rows — and an
          empty "Pending invitations" card would read to them as "nobody has
          been invited", which is a claim this screen cannot make. */}
      {invitations.length > 0 && (
        <Card flush>
          <CardHeader
            title="Pending invitations"
            description="Nothing is emailed automatically — each of these is a link somebody has to be sent."
          />
          <CardBody>
            <ul className="divide-y divide-line-subtle">
              {invitations.map((inv) => (
                <InvitationRow
                  key={inv.id}
                  org={org}
                  invitation={inv}
                  now={now}
                  onResult={setResult}
                />
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

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
/** Owner is not offerable at invite time — see the note on `inviteSchema`. */
const INVITE_ROLES: Role[] = ["admin", "member", "viewer"];

function InviteForm({
  org,
  onIssued,
  onCancel,
  onResult,
}: {
  org: string;
  onIssued: (r: { url: string; email: string }) => void;
  onCancel: () => void;
  onResult: (r: Result) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  return (
    <form
      className="mb-5 rounded-md border border-line bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await inviteMemberAction(org, { email, role });
          if (res.ok) {
            setFieldErrors({});
            onResult({ ok: true, message: res.message });
            onIssued(res.data);
          } else {
            setFieldErrors(res.fieldErrors ?? {});
            onResult({ ok: false, error: res.error });
          }
        });
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <Field
          label="Email address"
          error={fieldErrors.email}
          required
          className="min-w-[240px] flex-1"
        >
          {(field) => (
            <Input
              {...field}
              type="email"
              value={email}
              disabled={pending}
              placeholder="colleague@company.com"
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Field label="Role" error={fieldErrors.role} className="w-[140px]">
          {(field) => (
            <Select
              {...field}
              value={role}
              disabled={pending}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              {INVITE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="flex items-center gap-2 pb-1">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Creating…" : "Create invitation"}
          </Button>
          <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
      <p className="mt-3 text-[12px] text-fg-muted">
        This creates a link. Huntloop has no transactional sender configured, so
        you send it yourself — the link only works for the address you type
        here, whoever ends up holding it.
      </p>
    </form>
  );
}

/**
 * The link, shown once and copyable.
 *
 * Deliberately not hidden behind a "copy" button alone: a copy that silently
 * fails — which happens in insecure contexts and in some browsers without a
 * user gesture — would leave the admin with nothing at all. The text is always
 * selectable, and the button is a convenience over it.
 */
function IssuedLink({ url, email }: { url: string; email: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="mb-5 rounded-md border border-success-border bg-success-surface p-4">
      <p className="text-[13px] text-success">
        Invitation for <span className="font-medium">{email}</span>. Send them
        this link — it expires in 14 days and works only for that address.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded-sm border border-line bg-canvas px-2 py-1.5 font-mono text-[12px] text-fg">
          {url}
        </code>
        <Button
          size="sm"
          variant="secondary"
          icon={Copy}
          onClick={() => {
            navigator.clipboard?.writeText(url).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

/**
 * How a member is named, in the order the data can support it.
 *
 * Never falls through to something invented. The uuid is ugly and is the
 * honest answer when there is nothing else — §7 applied to our own interface.
 */
function displayName(member: Member): string {
  return member.name ?? member.email ?? member.userId;
}

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
  onResult: (r: Result) => void;
}) {
  const [pending, start] = useTransition();
  const name = displayName(member);
  const secondary = member.name && member.email ? member.email : null;

  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={
              member.name
                ? "truncate text-[14px] font-medium text-fg"
                : "truncate font-mono text-[12px] text-fg"
            }
          >
            {name}
          </span>
          {member.isYou && <Badge variant="brand">You</Badge>}
          {isLastOwner && <Badge variant="neutral">Last owner</Badge>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          {secondary && <span className="text-[12px] text-fg-muted">{secondary}</span>}
          {member.joinedAt && (
            <Freshness date={member.joinedAt} now={new Date(now)} label="Joined" />
          )}
        </div>
      </div>

      {canAdmin ? (
        <label className="flex items-center gap-2">
          <span className="sr-only">Role for {name}</span>
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
          aria-label={`Remove ${name}`}
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

function InvitationRow({
  org,
  invitation,
  now,
  onResult,
}: {
  org: string;
  invitation: Invitation;
  now: string;
  onResult: (r: Result) => void;
}) {
  const [pending, start] = useTransition();

  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[14px] text-fg">{invitation.email}</span>
          <Badge variant="neutral">{invitation.role}</Badge>
          {invitation.expired && <Badge variant="warning">Expired</Badge>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-muted">
          <Freshness date={invitation.createdAt} now={new Date(now)} label="Invited" />
          {invitation.invitedByName && <span>by {invitation.invitedByName}</span>}
        </div>
      </div>

      <Button
        size="sm"
        variant="ghost"
        icon={X}
        aria-label={`Revoke the invitation for ${invitation.email}`}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await revokeInvitationAction(org, invitation.id);
            onResult(
              res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error },
            );
          })
        }
      />
    </li>
  );
}
