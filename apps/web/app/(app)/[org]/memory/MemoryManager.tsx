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
import { Brain, FileUp, Link2, Plus, Save, Trash2 } from "lucide-react";
import type { Memory, MemoryScope } from "../../../../lib/data/memory";
import { deleteMemoryAction, ingestMemoryAction, saveMemoryAction } from "./actions";

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
  const [ingesting, setIngesting] = useState(false);
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
          {canWrite && (
            <span className="flex flex-wrap items-center gap-2">
              {!ingesting && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={FileUp}
                  onClick={() => setIngesting(true)}
                >
                  Add a document
                </Button>
              )}
              {!adding && (
                <Button size="sm" variant="secondary" icon={Plus} onClick={() => setAdding(true)}>
                  Add a memory
                </Button>
              )}
            </span>
          )}
        </div>

        {ingesting && (
          <div className="mt-3">
            <IngestForm
              org={org}
              onDone={() => setIngesting(false)}
              onResult={setResult}
            />
          </div>
        )}

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
          {/* Where the text came from, when it did not come from this form.
              `source` says who concluded it; this says what it was before it
              was a memory, and both matter to somebody deciding whether to
              trust it. */}
          {memory.sourceType !== "text" && (
            <Badge variant="neutral">{memory.sourceType}</Badge>
          )}
          {/* Stated, never inferred. The reference system truncated fetched
              pages at ten thousand characters and told nobody, which made "the
              whole document" and "the first two pages" the same claim. */}
          {memory.truncated && <Badge variant="warning">excerpt</Badge>}
          {memory.tags.map((tag) => (
            <Badge key={tag} variant="neutral">
              {tag}
            </Badge>
          ))}
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

        {(memory.sourceUrl || memory.sourceLabel) && (
          <p className="text-[12px] text-fg-muted">
            From{" "}
            {memory.sourceUrl ? (
              <a
                href={memory.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="hl-focusable rounded text-brand underline underline-offset-2"
              >
                {memory.sourceLabel ?? memory.sourceUrl}
              </a>
            ) : (
              memory.sourceLabel
            )}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * Ingesting a document instead of typing a sentence.
 *
 * ── Why the URL and the file take different paths ────────────────────────
 *
 * A URL is fetched server-side by `fetchPage`, which is SSRF-checked — private
 * ranges, link-local addresses and non-HTTP schemes are refused, and the check
 * re-runs after every redirect. This form is a public POST endpoint that takes
 * an address from the caller and makes the server request it, which is the
 * textbook shape of that vulnerability, so it reuses the hardened fetcher the
 * scanner already uses rather than a second softer one.
 *
 * A file is read in the browser and its text is posted. A browser cannot hand
 * a server a file any other way, and the consequence is stated honestly in the
 * row: `source_type = 'file'` means "somebody uploaded this", which is a
 * weaker provenance claim than "we fetched this from that address" and is
 * labelled as the weaker one.
 *
 * Plain text only, deliberately. A PDF or a .docx read as text is mostly
 * binary noise, and silently storing that as an organisation memory would put
 * it in front of every prompt this org ever runs. The accept list refuses them
 * rather than producing something unusable that looks like it worked.
 */
function IngestForm({
  org,
  onDone,
  onResult,
}: {
  org: string;
  onDone: () => void;
  onResult: (r: { ok: true; message?: string } | { ok: false; error: string }) => void;
}) {
  const [mode, setMode] = useState<"url" | "file">("url");
  const [url, setUrl] = useState("");
  const [filename, setFilename] = useState("");
  const [text, setText] = useState("");
  const [key, setKey] = useState("");
  const [tags, setTags] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  return (
    <Card>
      <CardHeader
        title="Add a document"
        description="A page or a text file becomes organisation context — read by every qualification and every message Huntloop writes from now on."
      />
      <CardBody className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={mode === "url" ? "secondary" : "ghost"}
            icon={Link2}
            onClick={() => setMode("url")}
            disabled={pending}
          >
            From a link
          </Button>
          <Button
            size="sm"
            variant={mode === "file" ? "secondary" : "ghost"}
            icon={FileUp}
            onClick={() => setMode("file")}
            disabled={pending}
          >
            From a file
          </Button>
        </div>

        {mode === "url" ? (
          <Field
            label="Address"
            required
            hint="Huntloop fetches it and stores the readable text. Pages that render in the browser often have none."
            error={fieldErrors.url}
          >
            {(a) => (
              <Input
                {...a}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={pending}
                placeholder="https://example.com/positioning"
              />
            )}
          </Field>
        ) : (
          <Field
            label="File"
            required
            hint="Plain text or markdown. Read in your browser — the file itself is not uploaded or stored."
            error={fieldErrors.text}
          >
            {(a) => (
              <input
                {...a}
                type="file"
                accept=".txt,.md,.markdown,.csv,text/plain,text/markdown"
                disabled={pending}
                className="hl-focusable block w-full rounded-md border border-line bg-surface px-3 py-2 text-[13px] text-fg file:mr-3 file:rounded file:border-0 file:bg-surface-active file:px-3 file:py-1 file:text-[12px] file:text-fg"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setFilename(file.name);
                  setText(await file.text());
                }}
              />
            )}
          </Field>
        )}

        <Field
          label="Label"
          hint="Optional. A short name, so a later document can replace this one rather than sit beside it."
          error={fieldErrors.key}
        >
          {(a) => (
            <Input
              {...a}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              disabled={pending}
              placeholder="positioning"
            />
          )}
        </Field>

        <Field label="Tags" hint="Optional. Comma separated." error={fieldErrors.tags}>
          {(a) => (
            <Input
              {...a}
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              disabled={pending}
              placeholder="positioning, pricing"
            />
          )}
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            icon={Save}
            disabled={pending || (mode === "url" ? !url.trim() : !text.trim())}
            onClick={() =>
              start(async () => {
                setFieldErrors({});
                const res = await ingestMemoryAction(org, {
                  sourceType: mode,
                  url: mode === "url" ? url.trim() : undefined,
                  filename: mode === "file" ? filename : undefined,
                  text: mode === "file" ? text : undefined,
                  tags: tags
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
                  key,
                });
                onResult(
                  res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error },
                );
                if (res.ok) onDone();
                else setFieldErrors(res.fieldErrors ?? {});
              })
            }
          >
            {pending ? "Reading…" : "Store it"}
          </Button>
          <Button variant="ghost" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
        </div>
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
