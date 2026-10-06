"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Badge, Button, Card, CardBody, FormMessage, Note, Textarea } from "@huntloop/ui";
import { ArrowUpRight, Brain, CalendarCheck, RotateCcw, Send } from "lucide-react";
import type { AssistantHistoryTurn } from "../../../../lib/data/assistant";
import { askAssistantAction, clearAssistantAction, type AssistantTurn } from "./actions";
import { setNextStepAction } from "../opportunities/[id]/activity-actions";
import { saveMemoryAction } from "../memory/actions";

const SUGGESTED = [
  "What should I focus on today?",
  "Where am I losing deals?",
  "Which hot accounts has nobody touched?",
  "How did the last 30 days go?",
];

type Turn =
  | { role: "user"; content: string }
  | ({ role: "assistant" } & AssistantTurn);

type Result = { ok: true; message?: string } | { ok: false; error: string } | null;

function fromHistory(history: AssistantHistoryTurn[]): Turn[] {
  return history.map((t) =>
    t.role === "user"
      ? { role: "user", content: t.content }
      : {
          role: "assistant",
          answer: t.content,
          citations: t.citations,
          unresolved: [],
          actions: t.actions.map((a) => ({
            kind: a.kind as AssistantTurn["actions"][number]["kind"],
            ref: a.ref,
            label: a.label,
            text: a.text,
            href: a.href,
          })),
          example: false,
        },
  );
}

/**
 * The conversation. Answers cite records as links; proposed actions are
 * buttons that do nothing until pressed, and then run through the same server
 * actions as the rest of the app (setting a next step, saving a note).
 */
export function AssistantChat({
  org,
  history,
  userId,
  canAsk,
  canWrite,
  aiConfigured,
}: {
  org: string;
  history: AssistantHistoryTurn[];
  userId: string | null;
  canAsk: boolean;
  canWrite: boolean;
  aiConfigured: boolean;
}) {
  const [turns, setTurns] = useState<Turn[]>(() => fromHistory(history));
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const ask = (q: string) => {
    const text = q.trim();
    if (!text) return;
    setError(null);
    setTurns((t) => [...t, { role: "user", content: text }]);
    setQuestion("");
    start(async () => {
      const res = await askAssistantAction(org, text);
      if (res.ok) setTurns((t) => [...t, { role: "assistant", ...res.data }]);
      else setError(res.error);
    });
  };

  return (
    <div className="space-y-4">
      {!aiConfigured && (
        <Note tone="warning">
          No model is connected on this deployment, so answers are a worked example built from your
          queue rather than a reply to your question.
        </Note>
      )}

      {turns.length === 0 ? (
        <Card>
          <CardBody className="space-y-3">
            <p className="text-[13px] text-fg-secondary">
              Ask about your pipeline, your results or what to do next. Answers come only from this
              workspace&rsquo;s records, and say so when the records don&rsquo;t cover it.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED.map((s) => (
                <Button key={s} size="sm" variant="secondary" disabled={!canAsk || pending} onClick={() => ask(s)}>
                  {s}
                </Button>
              ))}
            </div>
          </CardBody>
        </Card>
      ) : (
        <ol className="space-y-4" aria-live="polite">
          {turns.map((t, i) =>
            t.role === "user" ? (
              <li key={i} className="ml-auto max-w-[85%] rounded-lg bg-brand-surface px-3.5 py-2.5 text-[14px] text-fg">
                {t.content}
              </li>
            ) : (
              <li key={i}>
                <AssistantAnswerCard org={org} turn={t} userId={userId} canWrite={canWrite} />
              </li>
            ),
          )}
          {pending && (
            <li className="text-[13px] text-fg-muted" role="status">
              Reading your workspace…
            </li>
          )}
        </ol>
      )}

      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}

      {canAsk ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(question);
          }}
          className="flex items-end gap-2"
        >
          <Textarea
            aria-label="Your question"
            rows={2}
            value={question}
            maxLength={2000}
            disabled={pending}
            placeholder="Ask about your pipeline…"
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask(question);
              }
            }}
            className="flex-1"
          />
          <Button type="submit" variant="primary" icon={Send} disabled={pending || !question.trim()}>
            Ask
          </Button>
        </form>
      ) : (
        <p className="text-[13px] text-fg-muted">
          {canWrite ? "Asking is not available on this deployment." : "Your role is read-only, so you cannot ask the assistant."}
        </p>
      )}

      {turns.length > 0 && canAsk && (
        <Button
          size="sm"
          variant="ghost"
          icon={RotateCcw}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await clearAssistantAction(org);
              if (res.ok) setTurns([]);
              else setError(res.error);
            })
          }
        >
          Start over
        </Button>
      )}
    </div>
  );
}

function AssistantAnswerCard({
  org,
  turn,
  userId,
  canWrite,
}: {
  org: string;
  turn: AssistantTurn;
  userId: string | null;
  canWrite: boolean;
}) {
  return (
    <Card>
      <CardBody className="space-y-3">
        {turn.example && <Badge variant="warning">Worked example</Badge>}
        <p className="whitespace-pre-line text-[14px] leading-[1.6] text-fg">{turn.answer}</p>

        {turn.citations.length > 0 && (
          <div>
            <p className="text-[11px] font-medium tracking-label text-fg-muted uppercase">Based on</p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {turn.citations.map((c) => (
                <li key={c.ref}>
                  {c.href ? (
                    <Link
                      href={c.href}
                      className="hl-focusable inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-0.5 text-[12px] text-fg-secondary hover:border-brand-border hover:bg-hover hover:text-fg"
                    >
                      {c.title}
                      <ArrowUpRight className="size-3" strokeWidth={1.75} />
                    </Link>
                  ) : (
                    <span className="inline-flex rounded-md border border-line px-2 py-0.5 text-[12px] text-fg-muted">
                      {c.title}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {turn.unresolved.length > 0 && (
          <div>
            <p className="text-[11px] font-medium tracking-label text-fg-muted uppercase">Not in your records</p>
            <ul className="mt-1 space-y-0.5">
              {turn.unresolved.map((u) => (
                <li key={u} className="text-[12px] text-fg-muted">
                  · {u}
                </li>
              ))}
            </ul>
          </div>
        )}

        {turn.actions.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-line-subtle pt-3">
            {turn.actions.map((a, i) => (
              <ProposedAction key={`${a.kind}-${i}`} org={org} action={a} userId={userId} canWrite={canWrite} />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/** One proposed action. Nothing happens until it is pressed. */
function ProposedAction({
  org,
  action,
  userId,
  canWrite,
}: {
  org: string;
  action: AssistantTurn["actions"][number];
  userId: string | null;
  canWrite: boolean;
}) {
  const [result, setResult] = useState<Result>(null);
  const [text, setText] = useState(action.text ?? "");
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();

  if (action.kind === "open") {
    return action.href ? (
      <Button size="sm" variant="secondary" icon={ArrowUpRight} href={action.href} linkComponent={Link}>
        {action.label}
      </Button>
    ) : null;
  }

  if (!canWrite) return null;

  const opportunityId = action.ref?.startsWith("opportunity:") ? action.ref.slice("opportunity:".length) : null;

  const run = () =>
    start(async () => {
      const res =
        action.kind === "set_next_step" && opportunityId
          ? await setNextStepAction(org, opportunityId, { text, dueAt: null })
          : action.kind === "remember" && userId
            ? await saveMemoryAction(org, { scope: "user", scopeId: userId, key: "", content: text })
            : null;
      if (!res) return;
      setResult(res.ok ? { ok: true, message: res.message ?? "Done." } : { ok: false, error: res.error });
      if (res.ok) setEditing(false);
    });

  if (result?.ok) return <FormMessage result={result} />;

  return (
    <div className="w-full space-y-2 sm:w-auto">
      {editing ? (
        <div className="flex flex-wrap items-end gap-2">
          <Textarea
            aria-label={action.label}
            rows={2}
            value={text}
            disabled={pending}
            onChange={(e) => setText(e.target.value)}
            className="min-w-[260px] flex-1"
          />
          <Button size="sm" variant="primary" disabled={pending || !text.trim()} onClick={run}>
            {pending ? "Saving…" : "Confirm"}
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          icon={action.kind === "remember" ? Brain : CalendarCheck}
          onClick={() => setEditing(true)}
        >
          {action.label}
        </Button>
      )}
      <FormMessage result={result} />
    </div>
  );
}
