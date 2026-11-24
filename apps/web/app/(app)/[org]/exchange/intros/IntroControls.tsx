"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, Field, FormMessage, Note, Select, Textarea } from "@huntloop/ui";
import { Check, Handshake, Send, Share2, Undo2, X } from "lucide-react";
import type { IntroMessage, IntroState } from "../../../../../lib/data/exchange";
import {
  decideIntroAction,
  markIntroReadAction,
  reportOutcomeAction,
  requestIntroAction,
  sendIntroMessageAction,
  shareContactAction,
  withdrawIntroAction,
} from "../actions";

type Result = { ok: true; message?: string } | { ok: false; error: string } | null;
type Res = { ok: true; message?: string } | { ok: false; error: string };

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result>(null);
  const act = (fn: () => Promise<Res>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      setResult(res.ok ? { ok: true, message: res.message } : { ok: false, error: res.error });
      if (res.ok) {
        after?.();
        router.refresh();
      }
    });
  return { pending, result, act };
}

export const INTRO_STATE_LABEL: Record<IntroState, string> = {
  requested: "Waiting for the buyer",
  accepted: "Introduced",
  declined: "Declined",
  withdrawn: "Withdrawn",
  closed: "Closed",
  stale: "Lapsed",
};

export function IntroStateBadge({ state, side }: { state: IntroState; side?: "buyer" | "provider" }) {
  const label = state === "requested" && side === "buyer" ? "Asks to talk" : INTRO_STATE_LABEL[state];
  const variant = state === "accepted" ? "success" : state === "requested" ? "warning" : "neutral";
  return <Badge variant={variant}>{label}</Badge>;
}

/**
 * Ask for an introduction from a match. The buyer's version says plainly what
 * it reveals, because pressing it is the reveal; the supplier's carries an
 * optional note and reveals nothing about the buyer.
 */
export function AskIntro({
  org,
  matchId,
  side,
  supplierName,
}: {
  org: string;
  matchId: string;
  side: "buyer" | "provider";
  supplierName?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result>(null);

  if (!open) {
    return (
      <Button size="sm" variant={side === "buyer" ? "primary" : "secondary"} icon={Handshake} onClick={() => setOpen(true)}>
        {side === "buyer" ? "Introduce me" : "Ask for an introduction"}
      </Button>
    );
  }
  return (
    <div className="mt-2 w-full space-y-2 rounded-md border border-line p-3">
      {side === "buyer" ? (
        <Note tone="info">
          {supplierName ?? "This supplier"} will see your workspace name and this request in full, and you can message each other. Your email is shared only if you choose to later.
        </Note>
      ) : (
        <p className="text-[12px] text-fg-muted">
          The buyer sees your company, this offering and your note, and decides. They stay anonymous unless they accept.
        </p>
      )}
      <Field label={side === "buyer" ? "A note to the supplier (optional)" : "Why you are a fit (optional)"}>
        {(p) => <Textarea {...p} rows={2} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} />}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="primary"
          icon={Check}
          disabled={pending}
          pending={pending ? "Sending…" : undefined}
          onClick={() =>
            start(async () => {
              const res = await requestIntroAction(org, matchId, message);
              if (!res.ok) {
                setResult({ ok: false, error: res.error });
                return;
              }
              router.push(`/${org}/exchange/intros/${res.data.introId}`);
            })
          }
        >
          {side === "buyer" ? "Introduce me" : "Send request"}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <FormMessage result={result} />
    </div>
  );
}

export function IntroDecision({ org, introId }: { org: string; introId: string }) {
  const { pending, result, act } = useAct();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" icon={Check} disabled={pending} onClick={() => act(() => decideIntroAction(org, introId, true))}>
          Accept — show who I am
        </Button>
        <Button size="sm" variant="ghost" icon={X} disabled={pending} onClick={() => act(() => decideIntroAction(org, introId, false))}>
          Decline
        </Button>
      </div>
      <FormMessage result={result} />
    </div>
  );
}

export function WithdrawIntro({ org, introId }: { org: string; introId: string }) {
  const { pending, result, act } = useAct();
  return (
    <div className="space-y-2">
      <Button size="sm" variant="ghost" icon={Undo2} disabled={pending} onClick={() => act(() => withdrawIntroAction(org, introId))}>
        Withdraw request
      </Button>
      <FormMessage result={result} />
    </div>
  );
}

export function ShareContact({ org, introId }: { org: string; introId: string }) {
  const { pending, result, act } = useAct();
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="space-y-2">
      {confirming ? (
        <>
          <p className="text-[12px] text-fg-muted">Your name and email will be visible to this supplier, and only to them. It cannot be taken back.</p>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" icon={Share2} disabled={pending} onClick={() => act(() => shareContactAction(org, introId))}>
              Share my contact details
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <Button size="sm" variant="secondary" icon={Share2} onClick={() => setConfirming(true)}>
          Share my contact details
        </Button>
      )}
      <FormMessage result={result} />
    </div>
  );
}

export function OutcomeForm({ org, introId, current }: { org: string; introId: string; current: string | null }) {
  const { pending, result, act } = useAct();
  const [outcome, setOutcome] = useState(current ?? "");
  const [reason, setReason] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (outcome) act(() => reportOutcomeAction(org, introId, outcome, reason));
      }}
    >
      <Field label="How did it end?">
        {(p) => (
          <Select {...p} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">Choose…</option>
            <option value="won">We did business</option>
            <option value="lost">It went elsewhere</option>
            <option value="not_a_fit">Not a fit</option>
            <option value="no_decision">No decision</option>
          </Select>
        )}
      </Field>
      <Field label="Anything worth knowing (optional)">
        {(p) => <Textarea {...p} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      <Button type="submit" size="sm" variant="secondary" disabled={pending || !outcome}>
        {current ? "Update outcome" : "Report outcome"}
      </Button>
      <FormMessage result={result} />
    </form>
  );
}

/** The two-party thread. Marks itself read when opened; posts through the database function. */
export function Thread({
  org,
  introId,
  side,
  messages,
  open,
}: {
  org: string;
  introId: string;
  side: "buyer" | "provider";
  messages: IntroMessage[];
  open: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result>(null);
  const marked = useRef(false);
  useEffect(() => {
    if (marked.current) return;
    marked.current = true;
    void markIntroReadAction(org, introId);
  }, [org, introId]);

  return (
    <div className="space-y-3">
      {messages.length === 0 ? (
        <p className="text-[13px] text-fg-muted">{open ? "No messages yet." : "Messages open once the buyer accepts."}</p>
      ) : (
        <ol className="space-y-2" aria-label="Messages">
          {messages.map((m) => (
            <li key={m.id} className={m.side === side ? "flex justify-end" : "flex"}>
              <div
                className={
                  m.side === side
                    ? "max-w-[80%] rounded-lg bg-brand px-3 py-2 text-[14px] text-brand-ink"
                    : "max-w-[80%] rounded-lg bg-field px-3 py-2 text-[14px] text-fg"
                }
              >
                <p className="whitespace-pre-wrap">{m.body}</p>
                <p className="mt-1 text-[10px] opacity-70">
                  {m.side === side ? "You" : m.side === "buyer" ? "Buyer" : "Supplier"} ·{" "}
                  {new Date(m.createdAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
      {open && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!body.trim()) return;
            start(async () => {
              const res = await sendIntroMessageAction(org, introId, body);
              if (!res.ok) {
                setResult({ ok: false, error: res.error });
                return;
              }
              setBody("");
              setResult(null);
              router.refresh();
            });
          }}
        >
          <Field label="Message">
            {(p) => <Textarea {...p} rows={3} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} />}
          </Field>
          <Button type="submit" size="sm" variant="primary" icon={Send} disabled={pending || !body.trim()} pending={pending ? "Sending…" : undefined}>
            Send
          </Button>
          <FormMessage result={result} />
        </form>
      )}
    </div>
  );
}

export function IntroLink({ org, introId, state, side }: { org: string; introId: string; state: IntroState; side: "buyer" | "provider" }) {
  return (
    <span className="inline-flex items-center gap-2">
      <IntroStateBadge state={state} side={side} />
      <Link href={`/${org}/exchange/intros/${introId}`} className="hl-focusable text-[12px] text-brand underline">
        Open
      </Link>
    </span>
  );
}
