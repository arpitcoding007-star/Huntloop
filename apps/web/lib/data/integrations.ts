import "server-only";
import { requireOrgId } from "./org";
import { load, type Loaded } from "./source";

/**
 * HubSpot connection status — never the token itself.
 *
 * `access_token` is not in the select list below, on purpose, and not merely
 * as a habit: this is a Server Component read that ends up serialized into
 * the page a browser receives. Leaving the column out of the query is a
 * stronger guarantee than trusting every caller to remember not to render
 * it — the same reasoning `packages/db/migrations/0028` gives for making the
 * row admin-only at the RLS layer in the first place.
 */
export interface HubspotConnection {
  connected: boolean;
  hubId: string | null;
  connectedAt: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  isEnabled: boolean;
}

const NOT_CONNECTED: HubspotConnection = {
  connected: false,
  hubId: null,
  connectedAt: null,
  lastSyncedAt: null,
  lastSyncError: null,
  isEnabled: false,
};

export async function getHubspotConnection(orgSlug: string): Promise<Loaded<HubspotConnection>> {
  return load(
    async (db) => {
      const orgId = await requireOrgId(orgSlug, "getHubspotConnection");

      const { data, error } = await db
        .from("hubspot_connections")
        .select("hub_id, connected_at, last_synced_at, last_sync_error, is_enabled")
        .eq("org_id", orgId)
        .maybeSingle();

      /* A member who is not an admin gets an RLS-refused read here, not an
         error — the same "no policy exists, which is what makes it
         unreadable" shape `0025` documents elsewhere. That reads as "not
         connected" to this screen, which is a defensible default: a member
         who cannot see the connection cannot act on it either. */
      if (error) return NOT_CONNECTED;
      if (!data) return NOT_CONNECTED;

      return {
        connected: true,
        hubId: data.hub_id ?? null,
        connectedAt: data.connected_at ?? null,
        lastSyncedAt: data.last_synced_at ?? null,
        lastSyncError: data.last_sync_error ?? null,
        isEnabled: Boolean(data.is_enabled),
      };
    },
    () => NOT_CONNECTED,
  );
}
