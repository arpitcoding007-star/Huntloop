import { SourceManager } from "./SourceManager";

/**
 * Source management (§10).
 *
 * Still fixtures — the `sources` table, its status enum and failure_count all
 * exist in packages/db/migrations, so this becomes a select plus two mutations
 * once Supabase is migrated. The demo-data banner is rendered by the org
 * layout, not here.
 */
export default async function SourcesPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  return <SourceManager org={org} />;
}

export const metadata = {
  title: "Sources · Huntloop",
};
