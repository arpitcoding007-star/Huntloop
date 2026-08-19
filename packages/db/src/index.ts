/**
 * Public surface of @huntloop/db.
 *
 * Note what is NOT exported here: `./admin`. The service-role client is
 * reachable only through the explicit `@huntloop/db/admin` subpath, so it can
 * never arrive by accident through a barrel import, and every use site names
 * it in a way that is trivially greppable and obvious in review.
 */

export { createTenantClient, resolveMembership } from "./server.ts";
export type { CookieStore, TenantClient } from "./server.ts";

export { createClientSideClient } from "./browser.ts";
export type { ClientSideClient } from "./browser.ts";

export * from "./types.ts";
