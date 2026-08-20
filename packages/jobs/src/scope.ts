/**
 * The tenant boundary for code that runs without a user.
 *
 * ── Why this package may hold the service-role client ────────────────────
 *
 * `packages/db/src/admin.ts` names three legitimate callers: migrations and
 * seeds, webhook handlers that run with no user session, and background jobs
 * that have already resolved their tenant. This package is the third, and it
 * is the only place in the repo other than the seed script that is.
 *
 * The reason it cannot be avoided is structural, not convenient. A scheduled
 * scan has no signed-in user, so `auth.uid()` is null, so every RLS policy in
 * the schema evaluates to false and every query returns nothing. Routing the
 * work through SECURITY DEFINER functions instead would mean writing one for
 * every table the engine touches — which is the same bypass, spread across
 * thirty functions where nobody can see it at once.
 *
 * ── What replaces RLS while it is off ────────────────────────────────────
 *
 * `admin.ts` rule 3: every query through the bypass carries an explicit
 * `org_id` filter. Rules like that are followed until the day they are not,
 * and the failure is silent and cross-tenant.
 *
 * So the rule is made mechanical here. A handler never receives the admin
 * client; it receives an `OrgScope`, which is bound to one org id and which
 *
 *   · applies `.eq("org_id", …)` to every select, update and delete, and
 *   · injects `org_id` into every insert, overwriting whatever was passed.
 *
 * A handler that wants to touch another tenant's rows cannot express it. That
 * is a stronger guarantee than a code-review convention, and it is checked by
 * `scripts/verify-jobs.ts`, which asserts the filter is applied even when the
 * caller supplies a conflicting one.
 */
import { createAdminClient, type AdminClient } from "@huntloop/db/admin";

/* eslint-disable @typescript-eslint/no-explicit-any --
   PostgREST's builder types are generated from a live project's schema, and
   this repo deliberately has none — see DB-03 in the backlog, and the note at
   the top of packages/db/src/types.ts on why the row types there are
   hand-written and thin.

   Without generated types the builder's generics infer against `any` and
   produce errors that are about inference rather than about correctness:
   `update()` rejects a Record because it cannot prove the keys are columns,
   and `select()` widens its result to a union with PostgREST's error shape.

   The two honest options are this alias or a hand-written structural copy of
   the builder. A copy would look safer and would drift the first time
   supabase-js changed a signature, silently, because nothing would compare
   them. This is confined to the six method bodies below; every handler works
   against the returned rows explicitly. */
type Query = any;

let shared: AdminClient | null = null;

/**
 * The one admin client this process uses.
 *
 * Memoised because `createClient` opens its own fetch pool and a runner tick
 * creates a scope per org; the alternative is a new pool per job.
 */
export function adminClient(): AdminClient {
  shared ??= createAdminClient();
  return shared;
}

/** Replaces the shared client. Tests only — see `verify-jobs.ts`. */
export function setAdminClientForTests(client: AdminClient | null): void {
  shared = client;
}

export class OrgScope {
  readonly orgId: string;
  readonly #db: AdminClient;

  constructor(orgId: string, db: AdminClient = adminClient()) {
    if (!orgId) {
      // A scope with no org is a scope with no boundary. Refusing here rather
      // than defaulting to "all orgs" is the whole point of the class.
      throw new Error("OrgScope requires an org id.");
    }
    this.orgId = orgId;
    this.#db = db;
  }

  /**
   * A read, pre-filtered to this org.
   *
   * Three verbs rather than one `from()`, because PostgREST's builder only
   * accepts filters *after* the verb — `from(t).eq(…)` is not expressible, and
   * a scope whose filter had to be applied by the caller afterwards would be
   * back to the convention this class exists to replace.
   */
  select(table: string, columns = "*"): Query {
    return (this.#db.from(table) as Query).select(columns).eq("org_id", this.orgId);
  }

  update(table: string, values: Record<string, unknown>): Query {
    return (this.#db.from(table) as Query).update(values).eq("org_id", this.orgId);
  }

  delete(table: string): Query {
    return (this.#db.from(table) as Query).delete().eq("org_id", this.orgId);
  }

  /**
   * Inserts, with `org_id` supplied rather than trusted.
   *
   * Spread *after* the caller's row on purpose: a handler that passes an
   * org_id — by copying a row, say — has it overwritten rather than honoured.
   */
  insert(table: string, rows: Record<string, unknown> | Record<string, unknown>[]): Query {
    const withOrg = (Array.isArray(rows) ? rows : [rows]).map((row) => ({
      ...row,
      org_id: this.orgId,
    }));
    return (this.#db.from(table) as Query).insert(withOrg);
  }

  /** Upsert, same rule. `onConflict` names the constraint to arbitrate on. */
  upsert(
    table: string,
    rows: Record<string, unknown> | Record<string, unknown>[],
    options?: { onConflict?: string; ignoreDuplicates?: boolean },
  ): Query {
    const withOrg = (Array.isArray(rows) ? rows : [rows]).map((row) => ({
      ...row,
      org_id: this.orgId,
    }));
    return (this.#db.from(table) as Query).upsert(withOrg, options);
  }

  /**
   * A database function call.
   *
   * Not org-scoped, because an RPC's arguments are its own business — the
   * functions in `0007`/`0008` that take an org take it as a parameter. Kept
   * on the scope anyway so a handler never needs the raw client for anything,
   * which is what keeps `adminClient()` out of the handler files entirely.
   */
  rpc(fn: string, args: Record<string, unknown> = {}): Query {
    return (this.#db.rpc as Query)(fn, args);
  }

  /**
   * The unscoped client, for the two reads that are legitimately global.
   *
   * Only the scheduler uses it: "which sources are due, across every org" and
   * "which enrollments are due" are cross-tenant questions by nature, and both
   * immediately fan out into per-org scopes. Named so that any other use is
   * conspicuous in review and in a grep.
   */
  static global(): AdminClient {
    return adminClient();
  }
}

/**
 * The one row of a to-one embed.
 *
 * PostgREST returns an embedded relation as an object when it can prove the
 * relationship is to-one and as a single-element array when it cannot, and
 * which of those you get depends on the foreign keys rather than on anything
 * visible in the query. Every handler that reads `companies!inner(...)` or
 * `products(...)` has to cope with both.
 *
 * Written once, here, beside the `Query` note that explains why none of this
 * has a generated type. It replaces four copies of the same ternary, each
 * carrying its own `eslint-disable-next-line` that covered the first line of a
 * three-line expression and left the other two warning — which is how a
 * suppression comment ends up suppressing nothing.
 */
export function embedded<T = Record<string, unknown>>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return (value as T) ?? null;
}
