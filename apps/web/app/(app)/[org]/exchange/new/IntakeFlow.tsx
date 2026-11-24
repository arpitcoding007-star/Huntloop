"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Field, FormMessage, Input, Note, Select, Textarea } from "@huntloop/ui";
import { ArrowRight, Send, SkipForward, Store } from "lucide-react";
import type { IntakeAttribute, KnownField } from "@huntloop/ai";
import type { ExchangeCategory } from "../../../../../lib/data/exchange";
import type { IntakeState } from "../../../../../lib/exchange/intake-state";
import { COUNTRY_CODES, countryName, CURRENCIES, parseAmount, parseCurrency, parseTimeline, TIMELINE_LABEL, VISIBILITY } from "../../../../../lib/exchange/requirement";
import { clearDraftRequest, readDraftRequest } from "../../../../../lib/exchange/draft-request";
import { previewCard } from "../../../../../lib/exchange/card";
import { answerIntakeAction, startIntakeAction, submitNeedAction } from "../actions";

type Result = { ok: true; message?: string } | { ok: false; error: string } | null;

function emptyState(summary: string, notice: string | null): IntakeState {
  return {
    sessionId: null,
    mode: "form",
    direction: "buy",
    summary,
    categoryId: null,
    categoryPath: null,
    attributes: [],
    known: {},
    question: null,
    quickReplies: [],
    askKeys: [],
    ready: true,
    reason: "incomplete",
    turns: 0,
    notice,
    transcript: [],
  };
}

export function IntakeFlow({ org, categories }: { org: string; categories: ExchangeCategory[] }) {
  const [state, setState] = useState<IntakeState | null>(null);
  const [text, setText] = useState("");
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<Result>(null);
  const [pending, start] = useTransition();

  /* What they typed on /find before they had an account. */
  useEffect(() => {
    const draft = readDraftRequest();
    if (draft) setText((t) => t || draft);
  }, []);

  const run = (fn: () => Promise<{ ok: true; data: IntakeState } | { ok: false; error: string }>) =>
    start(async () => {
      setResult(null);
      const res = await fn();
      if (res.ok) {
        clearDraftRequest();
        setState(res.data);
        setAnswer("");
      } else setResult({ ok: false, error: res.error });
    });

  if (!state) {
    return (
      <Card>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => startIntakeAction(org, text));
          }}
        >
          <Field label="What do you need?" hint="For example: “200 NVIDIA H100 GPUs delivered to Munich this quarter”.">
            {(p) => (
              <Textarea {...p} rows={3} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} />
            )}
          </Field>
          <FormMessage result={result} />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary" icon={ArrowRight} disabled={pending || text.trim().length < 3} pending={pending ? "Reading…" : undefined}>
              Continue
            </Button>
            <Button type="button" variant="ghost" onClick={() => {
                clearDraftRequest();
                setState(emptyState(text.trim(), null));
              }}>
              Use a plain form instead
            </Button>
          </div>
        </form>
      </Card>
    );
  }

  if (state.mode === "sell") {
    return (
      <Card>
        <div className="space-y-4">
          <Note tone="info">
            That reads like something you offer rather than something you need. Offerings are listed from your supplier profile, where buyers with matching requests find them.
          </Note>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon={Store} href={`/${org}/exchange/supplier`} linkComponent={Link}>
              Go to supplier profile
            </Button>
            <Button variant="ghost" onClick={() => setState(emptyState(state.summary, null))}>
              No, I am looking to buy
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  const asking = state.mode === "chat" && !state.ready;

  return (
    <div className="space-y-4">
      {state.transcript.length > 0 && (
        <Card>
          <ol className="space-y-3" aria-label="Conversation">
            {state.transcript.map((t, i) => (
              <li key={i} className={t.role === "user" ? "flex justify-end" : "flex"}>
                <p
                  className={
                    t.role === "user"
                      ? "max-w-[80%] rounded-lg bg-brand px-3 py-2 text-[14px] text-brand-ink"
                      : "max-w-[80%] rounded-lg bg-field px-3 py-2 text-[14px] text-fg"
                  }
                >
                  {t.text}
                </p>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {state.notice && <Note tone="warning">{state.notice}</Note>}

      {asking && !state.categoryId && (
        <CategoryPicker
          categories={categories}
          pending={pending}
          prompt={state.question}
          onPick={(categoryId) => run(() => answerIntakeAction(org, { sessionId: state.sessionId!, categoryId }))}
        />
      )}

      {asking && state.categoryId && (
        <Card>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (answer.trim()) run(() => answerIntakeAction(org, { sessionId: state.sessionId!, answer }));
            }}
          >
            {state.question && <p className="text-[14px] font-medium text-fg">{state.question}</p>}
            {state.quickReplies.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {state.quickReplies.map((q) => (
                  <Button
                    key={q}
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => run(() => answerIntakeAction(org, { sessionId: state.sessionId!, answer: q }))}
                  >
                    {q}
                  </Button>
                ))}
              </div>
            )}
            <Field label="Your answer">
              {(p) => <Input {...p} value={answer} maxLength={2000} onChange={(e) => setAnswer(e.target.value)} />}
            </Field>
            <FormMessage result={result} />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" variant="primary" icon={Send} disabled={pending || !answer.trim()} pending={pending ? "Thinking…" : undefined}>
                Send
              </Button>
              <Button
                type="button"
                variant="ghost"
                icon={SkipForward}
                disabled={pending}
                onClick={() => run(() => answerIntakeAction(org, { sessionId: state.sessionId!, skip: true }))}
              >
                Skip — leave unknown
              </Button>
              <Button type="button" variant="ghost" disabled={pending} onClick={() => setState({ ...state, ready: true })}>
                Review now
              </Button>
            </div>
          </form>
        </Card>
      )}

      {!asking && <ReviewCard org={org} categories={categories} state={state} />}
    </div>
  );
}

function CategoryPicker({
  categories,
  pending,
  prompt,
  onPick,
}: {
  categories: ExchangeCategory[];
  pending: boolean;
  prompt: string | null;
  onPick: (id: string) => void;
}) {
  const [choice, setChoice] = useState("");
  return (
    <Card>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (choice) onPick(choice);
        }}
      >
        {prompt && <p className="text-[14px] font-medium text-fg">{prompt}</p>}
        <CategorySelect categories={categories} value={choice} onChange={setChoice} />
        <Button type="submit" variant="primary" disabled={pending || !choice} pending={pending ? "Thinking…" : undefined}>
          Continue
        </Button>
      </form>
    </Card>
  );
}

function CategorySelect({
  categories,
  value,
  onChange,
}: {
  categories: ExchangeCategory[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <Field label="Category">
      {(p) => (
        <Select {...p} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose a category…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.path}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

function kindBadge(field: KnownField | undefined, edited: boolean) {
  if (edited) return <Badge variant="success">You said</Badge>;
  if (!field || field.value === null) return <Badge variant="neutral">Unknown</Badge>;
  if (field.kind === "inference") return <Badge variant="ai">Suggested — confirm</Badge>;
  return <Badge variant="success">You said</Badge>;
}

function AttributeInput({ attribute, value, onChange }: { attribute: IntakeAttribute; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={attribute.label} required={attribute.required}>
      {(p) =>
        attribute.options?.length ? (
          <Select {...p} required={undefined} value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">Unknown</option>
            {attribute.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        ) : (
          <Input {...p} required={undefined} value={value} maxLength={300} onChange={(e) => onChange(e.target.value)} />
        )
      }
    </Field>
  );
}

/**
 * The summary card: everything the conversation gathered, editable, with
 * where each value came from. Submitting is the person confirming it — a
 * suggestion becomes their answer only here. Also the whole flow when there
 * is no model.
 */
function ReviewCard({ org, categories, state }: { org: string; categories: ExchangeCategory[]; state: IntakeState }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result>(null);
  const [summary, setSummary] = useState(state.summary);
  const [kind, setKind] = useState<"buy" | "partner">(state.direction === "partner" ? "partner" : "buy");
  const [categoryId, setCategoryId] = useState(state.categoryId ?? "");
  const [edited, setEdited] = useState<Set<string>>(new Set());
  const [fields, setFields] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(state.known).map(([k, v]) => [k, v.value ?? ""])),
  );
  const budgetText = state.known.budget?.value ?? null;
  const [budget, setBudget] = useState(() => {
    const n = parseAmount(budgetText);
    return n === null ? "" : String(n);
  });
  const [currency, setCurrency] = useState(() => parseCurrency(budgetText) ?? "");
  const [country, setCountry] = useState("");
  const [visibility, setVisibility] = useState(1);

  const attributes = useMemo(
    () => (categoryId === state.categoryId ? state.attributes : categories.find((c) => c.id === categoryId)?.attributes ?? []),
    [categoryId, categories, state.attributes, state.categoryId],
  );
  const category = categories.find((c) => c.id === categoryId);
  const missingRequired = attributes.filter((a) => a.required && !(fields[a.key] ?? "").trim());

  const submit = () =>
    start(async () => {
      setResult(null);
      const budgetMax = budget.trim() ? Number(budget.replace(/,/g, "")) : null;
      if (budgetMax !== null && !Number.isFinite(budgetMax)) {
        setResult({ ok: false, error: "The budget is a plain number, e.g. 6000000." });
        return;
      }
      const res = await submitNeedAction(org, {
        sessionId: state.sessionId,
        kind,
        summary,
        categoryId: categoryId || null,
        fields: Object.fromEntries(attributes.map((a) => [a.key, fields[a.key] ?? ""])),
        country: country || null,
        currency: currency || null,
        budgetMax,
        visibility,
      });
      if (!res.ok) {
        setResult({ ok: false, error: res.error });
        return;
      }
      router.push(`/${org}/exchange/requests/${res.data.needId}`);
    });

  return (
    <Card>
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div>
          <h2 className="text-[15px] font-semibold text-fg">Check your request</h2>
          <p className="mt-1 text-[13px] text-fg-muted">
            Nothing is saved until you confirm. Anything left empty is recorded as unknown, never guessed.
          </p>
        </div>

        {state.reason === "turn_limit" && (
          <Note tone="info">That was the last question. Fill in what is still open, or leave it unknown.</Note>
        )}

        <Field label="In a sentence" required>
          {(p) => <Input {...p} value={summary} maxLength={500} onChange={(e) => setSummary(e.target.value)} />}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="I am looking to">
            {(p) => (
              <Select {...p} value={kind} onChange={(e) => setKind(e.target.value === "partner" ? "partner" : "buy")}>
                <option value="buy">Buy</option>
                <option value="partner">Find a partner</option>
              </Select>
            )}
          </Field>
          <CategorySelect categories={categories} value={categoryId} onChange={setCategoryId} />
        </div>

        {category?.regulated && (
          <Note tone="warning">
            This is a regulated category. Suppliers may need licences or export checks, and some details may be asked for before an introduction.
          </Note>
        )}

        {attributes.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {attributes.map((a) => (
              <div key={a.key} className="space-y-1">
                <AttributeInput
                  attribute={a}
                  value={fields[a.key] ?? ""}
                  onChange={(v) => {
                    setFields((f) => ({ ...f, [a.key]: v }));
                    setEdited((s) => new Set(s).add(a.key));
                  }}
                />
                <div>{kindBadge(state.known[a.key], edited.has(a.key) && !!(fields[a.key] ?? "").trim())}</div>
              </div>
            ))}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Country" hint="Where it is needed. Matching uses it.">
            {(p) => (
              <Select {...p} value={country} onChange={(e) => setCountry(e.target.value)}>
                <option value="">Unknown</option>
                {COUNTRY_CODES.map((c) => (
                  <option key={c} value={c}>
                    {countryName(c)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Budget, at most">
            {(p) => <Input {...p} inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} />}
          </Field>
          <Field label="Currency" hint="Budgets are compared only in the same currency.">
            {(p) => (
              <Select {...p} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                <option value="">None</option>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <fieldset>
          <legend className="text-[11px] leading-4 font-semibold tracking-label text-fg-muted uppercase">
            Who may see this request
          </legend>
          <div className="mt-2 space-y-2">
            {VISIBILITY.map((v) => (
              <label
                key={v.level}
                htmlFor={`visibility-${v.level}`}
                className="flex cursor-pointer items-start gap-3 rounded-md border border-line p-3"
              >
                <input
                  id={`visibility-${v.level}`}
                  aria-label={v.label}
                  type="radio"
                  name="visibility"
                  className="mt-1"
                  checked={visibility === v.level}
                  onChange={() => setVisibility(v.level)}
                />
                <span>
                  <span className="block text-[14px] font-medium text-fg">{v.label}</span>
                  <span className="block text-[12px] text-fg-muted">{v.detail}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <SupplierPreview
          level={visibility}
          fields={{
            categoryPath: category?.path ?? null,
            quantity: parseAmount(fields.quantity ?? fields.seats ?? null),
            budgetMax: budget.trim() ? Number(budget.replace(/,/g, "")) : null,
            currency: currency || null,
            country: country || null,
            timeline: (() => {
              const t = parseTimeline(fields.timeline ?? fields.start ?? null);
              return t ? TIMELINE_LABEL[t] : null;
            })(),
            summary,
            mustHaves: fields.must_haves?.trim() || null,
          }}
        />

        {missingRequired.length > 0 && (
          <p className="text-[12px] text-fg-muted">
            Still unknown: {missingRequired.map((a) => a.label).join(", ")}. Suppliers match better with these, but you can save without them.
          </p>
        )}

        <FormMessage result={result} />
        <Button type="submit" variant="primary" disabled={pending || summary.trim().length < 3} pending={pending ? "Saving…" : undefined}>
          Save request
        </Button>
      </form>
    </Card>
  );
}

/**
 * What a matched supplier would see at the chosen level, from the person's own
 * answers (DN-62). Mirrors the database's banding; the database decides.
 */
function SupplierPreview({ level, fields }: { level: number; fields: Parameters<typeof previewCard>[1] }) {
  const card = previewCard(level, fields);
  return (
    <div className="rounded-md border border-dashed border-line-strong p-4">
      <p className="text-[11px] leading-4 font-semibold tracking-label text-fg-muted uppercase">What a matched supplier sees</p>
      {card.visible ? (
        <dl className="mt-2 grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-[140px_1fr]">
          {card.rows.map((r) => (
            <div key={r.label} className="contents">
              <dt className="text-fg-muted">{r.label}</dt>
              <dd className="text-fg">{r.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <p className="mt-2 text-[12px] text-fg-muted">{card.note}</p>
    </div>
  );
}
