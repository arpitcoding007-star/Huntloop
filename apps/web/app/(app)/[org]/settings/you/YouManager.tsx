"use client";

import { useState, useTransition } from "react";
import {
  Badge,
  Button,
  ConfirmButton,
  EmptyState,
  Field,
  FormMessage,
  Note,
  Select,
  Textarea,
} from "@huntloop/ui";
import { Download, Pause, Play, Plus, RotateCcw, Share2, Trash2, Undo2 } from "lucide-react";
import type { MyLearning, PersonalPreference } from "../../../../../lib/data/personal-learning";
import {
  CATEGORY_LABELS,
  PREFERENCE_CATEGORY_VALUES,
  PREFERENCE_TASKS,
  describeSignal,
  type PreferenceCategoryValue,
} from "../../../../../lib/learning/vocabulary";
import {
  exportMyLearningAction,
  forgetPreferenceAction,
  promotePreferenceAction,
  savePreferenceAction,
  setLearningPausedAction,
  setPreferenceStatusAction,
  sharePreferenceAction,
  resetLearnedAction,
} from "./actions";

type Result = { ok: true; message?: string } | { ok: false; error: string } | null;

/**
 * Settings → You (K2). Four lists that never blur together:
 *
 *   Waiting for you   learned, high-risk — nothing happens until you say yes
 *   You told us       stated (and corrected) — yours, applied as written
 *   Learned           concluded from what you did, each with its evidence
 *   Workspace policy  the team's — yours win where they disagree
 */
export function YouManager({ org, learning, live }: { org: string; learning: MyLearning; live: boolean }) {
  const [result, setResult] = useState<Result>(null);
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<PersonalPreference | "new" | null>(null);

  if (!learning.available) {
    return (
      <Note tone="warning">
        This workspace&rsquo;s database is missing migration <code>0044</code>, so Huntloop can&rsquo;t
        keep personal preferences yet. An admin can apply it with <code>npm run db:doctor -- --bundle</code>.
      </Note>
    );
  }

  const run = (fn: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>) => {
    setResult(null);
    start(async () => {
      const res = await fn();
      setResult(res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
    });
  };

  const proposed = learning.preferences.filter((p) => p.status === "proposed");
  const stated = learning.preferences.filter((p) => p.status !== "proposed" && p.origin !== "learned");
  const learned = learning.preferences.filter((p) => p.status !== "proposed" && p.origin === "learned");

  const actionsFor = (p: PersonalPreference) => (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <Button size="sm" variant="ghost" onClick={() => setEditing(p)} disabled={!live || pending}>
        {p.origin === "learned" ? "Correct" : "Edit"}
      </Button>
      {p.status === "paused" ? (
        <Button size="sm" variant="ghost" icon={Play} disabled={!live || pending}
          onClick={() => run(() => setPreferenceStatusAction(org, p.id, "active"))}>
          Turn back on
        </Button>
      ) : (
        <Button size="sm" variant="ghost" icon={Pause} disabled={!live || pending}
          onClick={() => run(() => setPreferenceStatusAction(org, p.id, "paused"))}>
          Pause
        </Button>
      )}
      <Button size="sm" variant="ghost" icon={Share2} disabled={!live || pending}
        onClick={() => run(() => sharePreferenceAction(org, p.id, !p.sharedAt))}>
        {p.sharedAt ? "Stop sharing" : "Share with workspace"}
      </Button>
      {learning.isAdmin && (
        <Button size="sm" variant="ghost" disabled={!live || pending}
          onClick={() => run(() => promotePreferenceAction(org, p.id))}>
          Make it workspace policy
        </Button>
      )}
      <ConfirmButton
        size="sm"
        icon={Trash2}
        label="Forget"
        confirmLabel={p.origin === "learned" ? "Forget, and don't learn it again" : "Forget this"}
        disabled={!live}
        pending={pending}
        onConfirm={() => run(() => forgetPreferenceAction(org, p.id))}
      />
    </div>
  );

  return (
    <div className="space-y-8">
      {/* ── Controls ─────────────────────────────────────────────────────── */}
      <section aria-labelledby="you-learning" className="rounded-md border border-line bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 max-w-xl">
            <h2 id="you-learning" className="text-[14px] font-semibold text-fg">
              {learning.learningPaused ? "Learning is paused" : "Huntloop is learning how you work"}
            </h2>
            <p className="mt-1 text-[13px] leading-[1.6] text-fg-muted">
              It notices what you change, reject and ask for again, and only concludes something
              after it has seen it at least three times. Everything here is private to you, admins
              included, unless you share it.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" icon={learning.learningPaused ? Play : Pause}
              disabled={!live || pending}
              onClick={() => run(() => setLearningPausedAction(org, !learning.learningPaused))}>
              {learning.learningPaused ? "Resume learning" : "Pause learning"}
            </Button>
            <Button size="sm" variant="secondary" icon={Download} disabled={!live || pending}
              onClick={() => {
                setResult(null);
                start(async () => {
                  const res = await exportMyLearningAction(org);
                  if (!res.ok) return setResult({ ok: false, error: res.error });
                  download(res.data.json, res.data.filename);
                  setResult({ ok: true, message: `Downloaded ${res.data.filename}.` });
                });
              }}>
              Export
            </Button>
            <ConfirmButton
              size="sm"
              icon={RotateCcw}
              label="Reset what it learned"
              confirmLabel="Reset — keep what I told it"
              disabled={!live}
              pending={pending}
              onConfirm={() => run(() => resetLearnedAction(org))}
            />
          </div>
        </div>
      </section>

      <FormMessage result={result} />

      {/* ── Waiting for you ──────────────────────────────────────────────── */}
      {proposed.length > 0 && (
        <section aria-labelledby="you-waiting">
          <SectionHeading id="you-waiting" title="Waiting for you"
            hint="Huntloop noticed these, but they change who you go after, so nothing happens until you say yes." />
          <ul className="mt-3 space-y-2">
            {proposed.map((p) => (
              <li key={p.id} className="rounded-md border border-warning-border bg-surface p-3">
                <PreferenceBody p={p} />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button size="sm" variant="primary" disabled={!live || pending}
                    onClick={() => run(() => setPreferenceStatusAction(org, p.id, "active"))}>
                    Yes, do this
                  </Button>
                  <Button size="sm" variant="ghost" icon={Undo2} disabled={!live || pending}
                    onClick={() => run(() => setPreferenceStatusAction(org, p.id, "rejected"))}>
                    No
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── You told us ──────────────────────────────────────────────────── */}
      <section aria-labelledby="you-told">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <SectionHeading id="you-told" title="You told us"
            hint="Applied as written, ahead of anything Huntloop learned and anything the workspace set." />
          <Button size="sm" variant="secondary" icon={Plus} disabled={!live || pending} onClick={() => setEditing("new")}>
            Add a preference
          </Button>
        </div>
        {editing && (
          <PreferenceForm
            org={org}
            initial={editing === "new" ? null : editing}
            onDone={(res) => {
              setEditing(null);
              if (res) setResult(res);
            }}
          />
        )}
        {stated.length === 0 ? (
          <EmptyState className="mt-3" title="Nothing yet"
            description={'Tell Huntloop how you like things done — "Sign off as Alex", "Bullet points, not paragraphs", "I sell to hospitals in the EU".'} />
        ) : (
          <ul className="mt-3 space-y-2">
            {stated.map((p) => (
              <li key={p.id} className="rounded-md border border-line bg-surface p-3">
                <PreferenceBody p={p} />
                {actionsFor(p)}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Learned ──────────────────────────────────────────────────────── */}
      <section aria-labelledby="you-learned">
        <SectionHeading id="you-learned" title="Learned from how you work"
          hint="Each one cites what you did. Correct one and it becomes something you told us." />
        {learned.length === 0 ? (
          <EmptyState className="mt-3" title="Nothing learned yet"
            description="Once you've edited, rejected or redrafted a few things the same way, what Huntloop concluded shows up here — with the examples it came from." />
        ) : (
          <ul className="mt-3 space-y-2">
            {learned.map((p) => (
              <li key={p.id} className="rounded-md border border-line bg-surface p-3">
                <PreferenceBody p={p} />
                {actionsFor(p)}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Shared by teammates (admins) ─────────────────────────────────── */}
      {learning.isAdmin && learning.shared.length > 0 && (
        <section aria-labelledby="you-shared">
          <SectionHeading id="you-shared" title="Shared by teammates"
            hint="Personal preferences a teammate offered to the workspace. Adopting one makes it apply to everyone." />
          <ul className="mt-3 space-y-2">
            {learning.shared.map((s) => (
              <li key={s.id} className="rounded-md border border-line bg-surface p-3">
                <p className="text-[13px] text-fg">{s.content}</p>
                <p className="mt-1 text-[12px] text-fg-muted">
                  From {s.ownerName}
                  {s.category ? ` · ${CATEGORY_LABELS[s.category as PreferenceCategoryValue]}` : ""}
                </p>
                <Button className="mt-2" size="sm" variant="secondary" disabled={!live || pending}
                  onClick={() => run(() => promotePreferenceAction(org, s.id))}>
                  Make it workspace policy
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Workspace policy ─────────────────────────────────────────────── */}
      <section aria-labelledby="you-workspace">
        <SectionHeading id="you-workspace" title="Workspace policy"
          hint="Applies to everyone here. Where one of yours says otherwise, yours wins for you. Edited under Memory." />
        {learning.workspace.length === 0 ? (
          <p className="mt-3 text-[13px] text-fg-muted">The workspace hasn&rsquo;t set any.</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {learning.workspace.map((w) => (
              <li key={w.id} className="flex items-start gap-2 text-[13px] text-fg">
                <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-fg-muted" />
                <span className="min-w-0">
                  {w.content}
                  {w.origin === "promoted" && <Badge className="ml-2" size="sm">Adopted from a teammate</Badge>}
                  {w.origin === "learned" && <Badge className="ml-2" size="sm" variant="ai">Learned</Badge>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SectionHeading({ id, title, hint }: { id: string; title: string; hint: string }) {
  return (
    <div className="min-w-0">
      <h2 id={id} className="text-[14px] font-semibold text-fg">{title}</h2>
      <p className="mt-0.5 text-[12px] text-fg-muted">{hint}</p>
    </div>
  );
}

function PreferenceBody({ p }: { p: PersonalPreference }) {
  const tasks = p.appliesTo.length
    ? p.appliesTo.map((t) => PREFERENCE_TASKS.find((o) => o.value === t)?.label ?? t).join(", ")
    : "Everything";
  return (
    <div>
      <p className="text-[13px] leading-[1.6] text-fg">{p.content}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-fg-muted">
        {p.origin === "learned" ? (
          <Badge size="sm" variant="ai">Learned · {p.evidence.length || p.support} examples</Badge>
        ) : p.origin === "promoted" ? (
          <Badge size="sm">Adopted</Badge>
        ) : (
          <Badge size="sm">You told us</Badge>
        )}
        {p.category && <span>{CATEGORY_LABELS[p.category as PreferenceCategoryValue]}</span>}
        <span>· {tasks}</span>
        {p.status === "paused" && <Badge size="sm" variant="warning">Paused</Badge>}
        {p.fading && <Badge size="sm" variant="warning">Fading — not seen lately, no longer applied</Badge>}
        {p.sharedAt && <Badge size="sm" variant="brand">Shared</Badge>}
      </div>
      {p.evidence.length > 0 && (
        <details className="mt-2 text-[12px]">
          <summary className="hl-focusable cursor-pointer rounded-sm text-fg-muted hover:text-fg">
            Why Huntloop thinks this
          </summary>
          <ul className="mt-1.5 space-y-1 pl-3">
            {p.evidence.slice(0, 10).map((e) => (
              <li key={e.id} className="text-fg-muted">
                {describeSignal(e)} · {new Date(e.createdAt).toLocaleDateString()}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function PreferenceForm({
  org,
  initial,
  onDone,
}: {
  org: string;
  initial: PersonalPreference | null;
  onDone: (result: Result) => void;
}) {
  const [content, setContent] = useState(initial?.content ?? "");
  const [category, setCategory] = useState<PreferenceCategoryValue>(
    (initial?.category as PreferenceCategoryValue | null) ?? "writing_style",
  );
  const [tasks, setTasks] = useState<string[]>(initial?.appliesTo ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="mt-3 space-y-3 rounded-md border border-brand-border bg-surface p-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await savePreferenceAction(org, { id: initial?.id, content, category, appliesTo: tasks });
          if (!res.ok) {
            setErrors(res.fieldErrors ?? {});
            setError(res.fieldErrors ? null : res.error);
            return;
          }
          onDone({ ok: true, message: res.message });
        });
      }}
    >
      {initial?.origin === "learned" && (
        <Note tone="info" icon={null}>
          Correcting this makes it yours: Huntloop applies your wording, and it stops being a guess.
        </Note>
      )}
      <Field label="What should Huntloop do?" error={errors.content} required>
        {(props) => (
          <Textarea {...props} rows={3} value={content} onChange={(e) => setContent(e.target.value)}
            placeholder="e.g. Keep emails under 80 words and sign off as Alex." />
        )}
      </Field>
      <Field label="What it's about" error={errors.category}>
        {(props) => (
          <Select {...props} value={category} onChange={(e) => setCategory(e.target.value as PreferenceCategoryValue)}>
            {PREFERENCE_CATEGORY_VALUES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </Select>
        )}
      </Field>
      <fieldset>
        <legend className="text-[11px] font-medium tracking-label text-fg-muted uppercase">Use it for</legend>
        <p className="mt-0.5 text-[12px] text-fg-muted">Leave all unticked to use it everywhere.</p>
        <div className="mt-1.5 flex flex-wrap gap-3">
          {PREFERENCE_TASKS.map((t) => (
            <label key={t.value} className="inline-flex items-center gap-1.5 text-[13px] text-fg">
              <input
                type="checkbox"
                checked={tasks.includes(t.value)}
                onChange={(e) =>
                  setTasks((prev) => (e.target.checked ? [...prev, t.value] : prev.filter((v) => v !== t.value)))
                }
                className="size-4 accent-[var(--color-brand)]"
              />
              {t.label}
            </label>
          ))}
        </div>
      </fieldset>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={pending || !content.trim()}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onDone(null)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Same as the privacy screen's: a one-off save, the object URL revoked at once. */
function download(json: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
