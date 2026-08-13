import { Analyzer } from "./Analyzer";

/**
 * Master context §17 — paste any company URL, get an honest assessment.
 *
 * This is a top-level job rather than a filter on a list, because the question
 * it answers is its own: "is this actually a good lead?" And §17 is explicit
 * that Huntloop must be willing to answer **no** — it must not qualify a
 * company just because the user took the trouble to type it in.
 */
export default async function AnalyzePage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  return <Analyzer org={org} />;
}

export const metadata = { title: "Analyze a URL" };
