import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { isExchangeEnabled } from "../../../../lib/exchange/flag";

/**
 * Every Exchange route 404s while `HUNTLOOP_EXCHANGE` is off — the same
 * answer as a path that does not exist, so the flag cannot be probed.
 */
export default function ExchangeLayout({ children }: { children: ReactNode }) {
  if (!isExchangeEnabled()) notFound();
  return children;
}
