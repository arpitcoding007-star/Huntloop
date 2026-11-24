import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { Note } from "@huntloop/ui";
import { isExchangeEnabled } from "../../../../lib/exchange/flag";
import { getMySuspension } from "../../../../lib/data/exchange";

/**
 * Every Exchange route 404s while `HUNTLOOP_EXCHANGE` is off — the same
 * answer as a path that does not exist, so the flag cannot be probed.
 *
 * A suspended workspace (0065) still sees its own data, and is told plainly
 * why nothing new can happen: the database refuses new introductions and
 * messages, and its cards and alerts are withdrawn.
 */
export default async function ExchangeLayout({ children, params }: { children: ReactNode; params: Promise<{ org: string }> }) {
  if (!isExchangeEnabled()) notFound();
  const { org } = await params;
  const { data: suspension } = await getMySuspension(org).catch(() => ({ data: null }));
  return (
    <>
      {suspension && (
        <div className="mx-auto w-full max-w-[1100px] px-6 pt-6 lg:px-8">
          <Note tone="danger">
            This workspace is suspended from the Exchange: {suspension}. Your requests and offerings are hidden, and new introductions and messages are paused. Reply to the email from Huntloop, or contact support, to appeal.
          </Note>
        </div>
      )}
      {children}
    </>
  );
}
