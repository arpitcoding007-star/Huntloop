import { DemoFigures } from "../DemoFigures";
import { SourceManager } from "./SourceManager";

/**
 * Source management (§10).
 *
 * Still fixtures — the `sources` table, its status enum and failure_count all
 * exist in packages/db/migrations, so this becomes a select plus two mutations
 * once Supabase is migrated. `npm run db:seed` already writes four rows to
 * that table; this screen does not read them yet.
 *
 * It used to rely on the org layout's banner to say so. That banner answers a
 * different question — "is this deployment connected?" — and goes quiet once
 * it is, which left these example sources looking like the org's real ones.
 * Hence the unconditional notice.
 */
export default async function SourcesPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  return (
    <>
      <div className="px-6 pt-6 lg:px-8">
        <DemoFigures what="These are example sources, not the ones on your account." />
      </div>
      <SourceManager org={org} />
    </>
  );
}

export const metadata = {
  title: "Sources",
};
