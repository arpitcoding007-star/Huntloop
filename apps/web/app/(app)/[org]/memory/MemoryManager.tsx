"use client";

import { useState, useTransition } from "react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ClaimBadge,
  EmptyState,
  Field,
  FormMessage,
  Input,
  SectionLabel,
  Select,
  Textarea,
} from "@huntloop/ui";
import { Brain, Plus, Save, Trash2 } from "lucide-react";
import type { Memory, MemoryScope } from "../../../../lib/data/memory";
import { deleteMemoryAction, saveMemoryAction } from "./actions";

/**
 * The scopes, and what each one means, as client constants.
 *
 * `lib/data/memory.ts` is `server-only`, so importing a *value* from it here
 * pulls the whole loader — and its Supabase client — into the browser bundle,
 * which is a build error rather than a subtle one. The type import above is
 * erased and costs nothing.
 *
 * This is UI copy anyway: it exists to be read beside the control that sets
 * the scope, because a five-value dropdown with no explanation is how a note
 * meant for one salesperson ends up organisation-wide. The enum it mirrors is
 * `memory_scope` in `0004`, and the union type above is what makes a
 * divergence a type error rather than a silent one.
 */
const MEMORY_SCOPES: readonly MemoryScope[] = [
  "organization",
  "team",
  "user",
  "account",
  "opportunity",
];

const SCOPE_HELP: Record<MemoryScope, string> = {
  organization: "Everyone in this organisation. Takes no subject — it is about the org itself.",
  team: "One team. Needs the team it belongs to.",
  user: "One person. Nobody else retrieves it.",
  account: "One company. Retrieved whenever that company is in play.",
  opportunity: "One opportunity. Goes away with it.",
};

/**
 * Memory — master context §20, §21, §37.
 *
 * ── Scope is who can see this, and the screen has to say so ──────────────
 *
 * A five-value dropdown with no explanation is how a note meant for one
 * salesperson ends up organisation-wide. Each scope's meaning is rendered
 * beside the control, and the subject field appears and disappears with it —
 * because organisation scope takes no subject and every other scope requires
 * one, which is a check constraint in `0004` rather than a preference.
 *
 * ── Derived memories are marked, and not editable ────────────────────────
 *
 * `source` is `user` or `derived`, and the difference is whether a person
 * wrote it or the product concluded it. §7 again: letting this form edit a
 * derived memory in place would quietly turn a conclusion into an assertion
 * nobody can trace. They are shown, and they can be removed — removing
 * something the product concluded is exactly the correction the learning loop
 * should hear — but not rewritten.
 */
export function MemoryManager({
  org,
  memories,
  canWrite,
}: {
  org: string;
  memories: Memory[];
  canWrite: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [result, setResult] = useState<
    { ok: true; message?: string } | { ok: false; error: string } | null
  >(null);

  const written = memories.filter((m) => m.source === "user");
  const derived = memories.filter((m) => m.source === "derived");

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Figure label="You wrote" value={written.length} />
        <Figure label="Huntloop concluded" value={derived.length} />
      </div>

      <FormMessage result={result} />

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionLabel>What you have told Huntloop</SectionLabel>
          {canWrite && !adding && (
            <Button size="sm" variant="secondary" icon={Plus} onClick={() => setAdding(true)}>
              Add a memory
            </Button>
          )}
        </div>

        {adding && (
          <div className="mt-3">
            <MemoryForm
              org={org}
              memory={null}
              canWrite={canWrite}
              onDone={() => setAdding(false)}
              onResult={setResult}
            />
          </div>
        )}

        <div className="mt-3 space-y-3">
          {written.length === 0 && !adding ? (
            <Card>
              <CardBody>
                <EmptyState
                  icon={Brain}
                  title="Nothing remembered yet"
                  description="Standing instructions — how you write, what never to say, which segments to leave alone. Everything Huntloop drafts is written against these."
                />
              </CardBody>
            </Card>
          ) : (
            written.map((m) =>
              editing === m.id ? (
                <MemoryForm
                  key={m.id}
                  org={org}
                  memory={m}
                  canWrite={canWrite}
                  onDone={() => setEditing(null)}
                  onResult={setResult}
                />
              ) : (
                <MemoryCard
                  key={m.id}
                  org={org}
                  memory={m}
                  canWrite={canWrite}
                  onEdit={() => setEditing(m.id)}
                  onResult={setResult}
                />
              ),
            )
          )}
        </div>
      </section>

      {derived.length > 0 && (
        <section>
          <SectionLabel>What Huntloop worked out</SectionLabel>
          <p className="mt-2 text-[12px] text-fg-muted">
            Conclusions the product drew from what happened, not things you
            said. They can be removed but not rewritten — a conclusion edited in
            place stops being traceable to what produced it.
          </p>
          <div className="mt-3 space-y-3">
            {derived.map((m) => (
              <MemoryCard
                key={m.id}
                org={org}
                memory={m}
                canWrite={canWrite}
                onResult={setResult}
              />
            ))}
          </div>
        </section>
      )}
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

function MemoryCard({
  org,
  memory,
  canWrite,
  onEdit,
  onResult,
}: {
  org: string;
  memory: Memory;
  canWrite: boolean;
  onEdit?: () => void;
  onResult: (r: { ok: true; message?: string } | { ok: false; error: string }) => void;
}) {
  const [pending, start] = useTransition();

  return (
    <Card>
      <CardBody className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="neutral">{memory.scope}</Badge>
          {memory.key && <Badge variant="neutral">{memory.key}</Badge>}
          {memory.source === "derived" && (
            <ClaimBadge kind="inference" confidence={memory.confidence ?? undefined} />
          )}
          {memory.expiresAt && <Badge variant="warning">expires</Badge>}

          {canWrite && (
            <span className="ml-auto flex items-center gap-1">
              {onEdit && (
                <Button size="sm" variant="ghost" onClick={onEdit} disabled={pending}>
                  Edit
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                icon={Trash2}
                aria-label="Remove this memory"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const res = await deleteMemoryAction(org, memory.id);
                    onResult(
                      res.ok
                        ? { ok: true, message: res.message }
                        : { ok: false, error: res.error },
                    );
                  })
                }
              />
            </span>
          )}
        </div>

        <p className="text-[13px] whitespace-pre-wrap text-fg">{memory.content}</p>
      </CardBody>
    </Card>
  );
}

function MemoryForm({
  org,
  memory,
  canWrite,
  onDone,
  onResult,
}: {
  org: string;
  memory: Memory | null;
  canWrite: boolean;
  onDone: () => void;
  onResult: (r: { ok: true; message?: string } | { ok: false; error: string }) => void;
}) {
  const [scope, setScope] = useState<MemoryScope>(memory?.scope ?? "organization");
  const [scopeId, setScopeId] = useState(memory?.scopeId ?? "");
  const [key, setKey] = useState(memory?.key ?? "");
  const [content, setContent] = useState(memory?.content ?? "");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const needsSubject = scope !== "organization";

  return (
    <Card>
      <CardHeader
        title={memory ? "Edit memory" : "Add a memory"}
        description="A standing instruction. Everything Huntloop drafts is written against these."
      />
      <CardBody className="space-y-5">
        <Field label="Who this applies to" hint={SCOPE_HELP[scope]} error={fieldErrors.scope}>
          {(a) => (
            <Select
              {...a}
              value={scope}
              onChange={(e) => setScope(e.target.value as MemoryScope)}
              disabled={!canWrite || pending}
            >
              {MEMORY_SCOPES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {/* Appears and disappears with the scope, because the pairing is a
            check constraint rather than a preference: organisation scope takes
            no subject, and every other scope requires one. */}
        {needsSubject && (
          <Field
            label="Subject"
            required
            hint={`The id of the ${scope} this is about. Without it, this memory would be retrieved for every ${scope}.`}
            error={fieldErrors.scopeId}
          >
            {(a) => (
              <Input
                {...a}
                value={scopeId}
                onChange={(e) => setScopeId(e.target.value)}
                disabled={!canWrite || pending}
                placeholder="00000000-0000-0000-0000-000000000000"
              />
            )}
          </Field>
        )}

        <Field
          label="Label"
          hint="Optional. A short name, so a later instruction can replace this one rather than contradict it."
          error={fieldErrors.key}
        >
          {(a) => (
            <Input
              {...a}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              disabled={!canWrite || pending}
              placeholder="tone"
            />
          )}
        </Field>

        <Field label="What to remember" required error={fieldErrors.content}>
          {(a) => (
            <Textarea
              {...a}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={!canWrite || pending}
              rows={4}
              placeholder="Never open with a compliment. Lead with the observation and the source."
            />
          )}
        </Field>

        {canWrite && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              icon={Save}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setFieldErrors({});
                  const res = await saveMemoryAction(org, {
                    id: memory?.id && !memory.id.startsWith("demo-") ? memory.id : undefined,
                    scope,
                    scopeId: needsSubject ? scopeId : null,
                    key,
                    content,
                  });
                  onResult(
                    res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error },
                  );
                  if (res.ok) onDone();
                  else setFieldErrors(res.fieldErrors ?? {});
                })
              }
            >
              {pending ? "Saving…" : memory ? "Save memory" : "Add memory"}
            </Button>
            <Button variant="ghost" onClick={onDone} disabled={pending}>
              Cancel
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
