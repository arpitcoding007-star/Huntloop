import { notFound } from "next/navigation";
import { exchangeMetadata, isExchangeEnabled } from "../../../../../lib/exchange/flag";
import { Note } from "@huntloop/ui";
import { listExchangeCategories } from "../../../../../lib/data/exchange";
import { canWrite, currentViewer } from "../../../../../lib/data/membership";
import { IntakeFlow } from "./IntakeFlow";

/**
 * New request — the conversational questionnaire (build plan DN-42/43).
 *
 * One sentence in, a few grouped questions, then a summary card the person
 * confirms before anything is saved. With no model, the same card is the
 * whole flow: a plain form asking the same fields.
 */
export default async function NewRequestPage({ params }: { params: Promise<{ org: string }> }) {
  if (!isExchangeEnabled()) notFound();
  const { org } = await params;
  const viewer = await currentViewer(org);
  if (!viewer) notFound();
  const { data: categories } = await listExchangeCategories();

  return (
    <div className="mx-auto w-full max-w-[820px] px-6 py-8 lg:px-8">
      <header>
        <h1 className="hl-heading text-fg">New request</h1>
        <p className="mt-1 text-[13px] text-fg-muted">
          Say what you need in your own words. You confirm every detail before it is saved, and you choose who may see it.
        </p>
      </header>
      <div className="mt-6">
        {canWrite(viewer) ? (
          <IntakeFlow org={org} categories={categories} />
        ) : (
          <Note tone="info">Your role is read-only, so you can see requests but not file one.</Note>
        )}
      </div>
    </div>
  );
}

export const generateMetadata = exchangeMetadata("New request");
