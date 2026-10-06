import { notFound } from "next/navigation";
import { isAiConfigured } from "@huntloop/ai";
import { getAssistantHistory } from "../../../../lib/data/assistant";
import { canSpend, canWrite, currentViewer } from "../../../../lib/data/membership";
import { getDb } from "../../../../lib/data/source";
import { DemoFigures } from "../DemoFigures";
import { AssistantChat } from "./AssistantChat";

/**
 * Ask Huntloop — the workspace assistant. COMMAND.md §16.3-G (P4).
 *
 * Answers questions about this workspace from its own records, cites every
 * record it rests on, and offers actions that only happen when pressed.
 */
export default async function AssistantPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  const viewer = await currentViewer(org);
  if (!viewer) notFound();

  const { data: history, source } = await getAssistantHistory(org);
  const db = await getDb();
  const userId = db ? ((await db.auth.getUser()).data.user?.id ?? null) : null;

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col px-6 py-8 lg:px-8">
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

      <div className="mt-6">
        <AssistantChat
          org={org}
          history={history}
          userId={userId}
          canAsk={canSpend(viewer) && source === "live"}
          canWrite={canWrite(viewer)}
          aiConfigured={isAiConfigured()}
        />
      </div>
    </div>
  );
}

export const metadata = { title: "Ask Huntloop" };
