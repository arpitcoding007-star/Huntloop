"use client";

import { useState, useTransition } from "react";
import { Button, FormMessage, Textarea } from "@huntloop/ui";
import { HelpCircle } from "lucide-react";
import { questionByKey } from "../../../lib/questions/catalog";
import { answerQuestionAction, declineQuestionAction } from "./questions-actions";

/**
 * One just-in-time question (K4). Always skippable — **Not now** (a week) or
 * **Don't ask again** — and always says why it is asked. The words come from
 * the catalog by key, never from the server's data.
 */
export function QuestionCard({ org, questionKey }: { org: string; questionKey: string | null }) {
  const q = questionKey ? questionByKey(questionKey) : undefined;
  const [answer, setAnswer] = useState("");
  const [done, setDone] = useState<{ ok: true; message?: string } | { ok: false; error: string } | null>(null);
  const [gone, setGone] = useState(false);
  const [pending, start] = useTransition();

  if (!q || gone) return null;
  if (done?.ok) return <FormMessage className="mb-4" result={done} />;

  const submit = (value: string) =>
    start(async () => {
      const res = await answerQuestionAction(org, q.key, value);
      setDone(res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
    });

  const decline = (mode: "later" | "never") =>
    start(async () => {
      const res = await declineQuestionAction(org, q.key, mode);
      if (res.ok) setGone(true);
      else setDone({ ok: false, error: res.error });
    });

  const id = `question-${q.key.replace(/\./g, "-")}`;
  return (
    <section aria-labelledby={id} className="mb-4 rounded-md border border-brand-border bg-surface p-3.5">
      <h2 id={id} className="flex items-center gap-1.5 text-[13px] font-semibold text-fg">
        <HelpCircle aria-hidden className="size-4 text-brand-text" strokeWidth={1.75} />
        {q.ask}
      </h2>
      <p className="mt-0.5 text-[12px] text-fg-muted">{q.why}</p>

      {q.input.kind === "choice" ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {q.input.choices.map((c) => (
            <Button key={c.value} size="sm" variant="secondary" disabled={pending} onClick={() => submit(c.value)}>
              {c.label}
            </Button>
          ))}
        </div>
      ) : (
        <form
          className="mt-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            submit(answer);
          }}
        >
          <Textarea
            aria-label={q.ask}
            rows={2}
            value={answer}
            maxLength={q.input.maxLength}
            placeholder={q.input.placeholder}
            disabled={pending}
            onChange={(e) => setAnswer(e.target.value)}
          />
          <Button className="mt-2" type="submit" size="sm" variant="primary" disabled={pending || !answer.trim()}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </form>
      )}

      {done && !done.ok && <FormMessage className="mt-2" result={done} />}

      <div className="mt-2 flex flex-wrap gap-1">
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => decline("later")}>
          Not now
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => decline("never")}>
          Don&rsquo;t ask again
        </Button>
      </div>
    </section>
  );
}
