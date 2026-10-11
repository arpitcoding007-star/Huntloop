import Link from "next/link";
import { QuestionCard } from "../QuestionCard";
import { getQuestionFor } from "../../../../lib/data/questions";
import { notFound } from "next/navigation";
import { isAiConfigured } from "@huntloop/ai";
import {
  getAssistantHistory,
  getAssistantVisibility,
  getUsualQuestions,
  listAssistantConversations,
} from "../../../../lib/data/assistant";
import { canSpend, canWrite, currentViewer } from "../../../../lib/data/membership";
import { listProducts } from "../../../../lib/data/product";
import { getDb } from "../../../../lib/data/source";
import { DemoFigures } from "../DemoFigures";
import { AssistantChat } from "./AssistantChat";
import { WhatItCanSee } from "./WhatItCanSee";

/**
 * Ask Huntloop — the workspace assistant. COMMAND.md §9.5, §16.3-G (P4).
 *
 * Answers questions about this workspace from its own records, cites every
 * record it rests on, and offers actions that only happen when pressed.
 * Several saved conversations per person (0045), each optionally focused on
 * one product — one assistant, not one per product (§16.6).
 *
 * `?c={id}` opens a conversation, `?c=new` starts one; with neither, the most
 * recent opens. An id that is not one of yours opens nothing rather than
 * erroring: the list beside it is what you can reach.
 */
export default async function AssistantPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ c?: string }>;
}) {
  const [{ org }, { c }] = await Promise.all([params, searchParams]);
  const viewer = await currentViewer(org);
  if (!viewer) notFound();

  const { data: conversations, source } = await listAssistantConversations(org);
  const selected = c === "new" ? null : (conversations.find((x) => x.id === c) ?? (c ? null : conversations[0]) ?? null);

  const [{ data: history }, questionKey, usual, visibility, { data: products }] = await Promise.all([
    getAssistantHistory(org, selected?.id ?? null),
    getQuestionFor(org, "assistant"),
    getUsualQuestions(org),
    getAssistantVisibility(org),
    listProducts(org),
  ]);
  const db = await getDb();
  const userId = db ? ((await db.auth.getUser()).data.user?.id ?? null) : null;
  /* A focus is worth offering only when there is more than one thing to focus on. */
  const focusable = source === "live" && products.length > 1 ? products.map((p) => ({ id: p.id, name: p.name })) : [];

  return (
    <div className="mx-auto w-full max-w-[1180px] px-6 py-8 lg:px-8">
      <header>
        <h1 className="hl-heading text-fg">Ask Huntloop</h1>
        <p className="mt-1 text-[13px] text-fg-muted">
          Questions about your pipeline, answered from your own workspace — every answer shows what it rests on
        </p>
      </header>

      {source !== "live" && (
        <div className="mt-6">
          <DemoFigures what="There is no workspace data to answer from on this deployment." />
        </div>
      )}

      {/* Phones: conversations, the chat, then what it can see. From lg the
          list and the panel share the left column beside the chat. */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:grid-rows-[auto_1fr]">
        <aside className="min-w-0 lg:col-start-1 lg:row-start-1">
          <nav aria-label="Your conversations" className="space-y-1">
            <div className="flex items-center justify-between gap-2 px-1">
              <h2 className="text-[11px] font-semibold tracking-label text-fg-muted uppercase">Conversations</h2>
              <Link
                href={`/${org}/assistant?c=new`}
                className="hl-focusable rounded-sm text-[12px] text-brand-text underline-offset-2 hover:underline"
              >
                New
              </Link>
            </div>
            {conversations.length === 0 ? (
              <p className="px-1 text-[12px] text-fg-muted">Your first question starts one.</p>
            ) : (
              <ul className="max-h-[320px] space-y-0.5 overflow-y-auto lg:max-h-[480px]">
                {conversations.map((x) => (
                  <li key={x.id}>
                    <Link
                      href={`/${org}/assistant?c=${x.id}`}
                      aria-current={selected?.id === x.id ? "page" : undefined}
                      className={[
                        "hl-focusable block rounded-md px-2 py-1.5 text-[13px] transition-colors duration-[120ms]",
                        selected?.id === x.id
                          ? "bg-brand-surface text-brand-text"
                          : "text-fg-secondary hover:bg-hover hover:text-fg",
                      ].join(" ")}
                    >
                      <span className="block truncate">{x.title}</span>
                      <span className="block truncate text-[11px] text-fg-muted">
                        {x.productName ? `${x.productName} · ` : ""}
                        {x.lastMessageAt ? x.lastMessageAt.slice(0, 10) : "No answers yet"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </nav>
        </aside>

        <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          {history.length > 0 && <QuestionCard org={org} questionKey={questionKey} />}
          <AssistantChat
            /* A new mount per conversation, so switching never shows one
               conversation's turns under another's title. */
            key={selected?.id ?? "new"}
            org={org}
            conversationId={selected?.id ?? null}
            title={selected?.title ?? null}
            focus={selected?.productName ?? null}
            products={selected ? [] : focusable}
            history={history}
            usual={usual}
            userId={userId}
            canAsk={canSpend(viewer) && source === "live"}
            canWrite={canWrite(viewer)}
            aiConfigured={isAiConfigured()}
          />
        </div>

        <div className="min-w-0 lg:col-start-1 lg:row-start-2">
          <WhatItCanSee org={org} visibility={visibility} focus={selected?.productName ?? null} />
        </div>
      </div>
    </div>
  );
}

export const metadata = { title: "Ask Huntloop" };
