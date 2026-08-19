import { notFound } from "next/navigation";
import { canWrite, currentViewer } from "../../../../lib/data/membership";
import { listMemories } from "../../../../lib/data/memory";
import { DemoFigures } from "../DemoFigures";
import { MemoryManager } from "./MemoryManager";

/**
 * Memory — master context §20, §21, §37.
 *
 * What the product has been told, and what it has worked out, kept apart on
 * screen because §7 makes that distinction the thing that must stay visible —
 * including when the subject is the user's own preferences.
 */
export default async function MemoryPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;

  const viewer = await currentViewer(org);
  if (!viewer) notFound();

  const { data: memories, source } = await listMemories(org);

  return (
    <div className="mx-auto w-full max-w-[880px] px-6 py-8 lg:px-8">
      <header>
        <h1 className="text-[30px] leading-9 font-semibold text-fg">Memory</h1>
        <p className="mt-1 text-[13px] text-fg-muted">
          {org} · standing instructions, and what Huntloop has concluded
        </p>
      </header>

      {source !== "live" && (
        <div className="mt-6">
          <DemoFigures what="These are example memories, not instructions on your account." />
        </div>
      )}

      <div className="mt-6">
        <MemoryManager org={org} memories={memories} canWrite={canWrite(viewer)} />
      </div>
    </div>
  );
}

export const metadata = { title: "Memory" };
