/** The checks' bookkeeping and the recording admin client every subject file shares. */
import { setBoardFetcherForTests } from "../../src/handlers/fetch-company-signals.ts";

/* No test reaches a real company website: job-board reads answer 404 unless a test says otherwise. */
setBoardFetcherForTests(async () => ({ status: 404, body: "" }));

let failures = 0;
let checks = 0;

export function ok(name: string) {
  checks++;
  console.log(`  ✓ ${name}`);
}

export function fail(name: string, detail: unknown) {
  checks++;
  failures++;
  console.error(`  ✗ ${name}\n      ${String(detail).split("\n")[0]}`);
}

export function expect(name: string, condition: boolean, detail: unknown = "expected true") {
  if (condition) ok(name);
  else fail(name, detail);
}

export function expectEqual(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) ok(name);
  else fail(name, `got ${a}, wanted ${b}`);
}

export async function expectThrows(name: string, fn: () => unknown, matching?: RegExp) {
  try {
    await fn();
    fail(name, "did not throw");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (matching && !matching.test(message)) fail(name, `threw the wrong thing: ${message}`);
    else ok(name);
  }
}

/* ── A recording stand-in for the admin client ───────────────────────────── */

export interface Recorded {
  table: string;
  verb: string;
  filters: [string, unknown][];
  payload?: unknown;
}

/**
 * Just enough of PostgREST's builder to observe what a scope did.
 *
 * Deliberately not a mock of supabase-js. It records the verb, the table, the
 * filters and the payload, and returns an awaitable that yields whatever the
 * test queued — which is all any assertion below needs, and it cannot drift
 * out of agreement with a library it does not imitate.
 */
export function fakeClient(responses: Record<string, unknown> = {}) {
  const calls: Recorded[] = [];

  const builder = (record: Recorded) => {
    const chain: Record<string, unknown> = {};
    const passthrough = [
      "eq", "neq", "is", "in", "or", "order", "limit", "lt", "lte", "gt", "gte", "not", "range",
      /* `contains` is how `matchThread` asks whether a thread's participants
         array holds the sender. Added when that path first got a test. */
      "contains",
      /* `like` retires job-board postings no longer listed (TRUST-103). */
      "like",
    ];
    for (const method of passthrough) {
      chain[method] = (column: string, value: unknown) => {
        record.filters.push([`${method}:${column}`, value]);
        return chain;
      };
    }
    chain.select = (columns: string) => {
      if (record.verb === "from") record.verb = "select";
      record.payload = record.payload ?? columns;
      return chain;
    };
    chain.single = () => chain;
    chain.maybeSingle = () => chain;
    /* A response may be a function of the recorded query, for a handler that
       reads one table twice with different filters. */
    chain.then = (resolve: (v: unknown) => unknown) => {
      const response = responses[`${record.verb}:${record.table}`];
      return Promise.resolve(
        (typeof response === "function" ? (response as (r: Recorded) => unknown)(record) : response) ?? {
          data: null,
          error: null,
        },
      ).then(resolve);
    };
    return chain;
  };

  const client = {
    from(table: string) {
      const record: Recorded = { table, verb: "from", filters: [] };
      calls.push(record);
      const chain = builder(record) as Record<string, unknown>;
      chain.insert = (rows: unknown) => {
        record.verb = "insert";
        record.payload = rows;
        return chain;
      };
      chain.upsert = (rows: unknown) => {
        record.verb = "upsert";
        record.payload = rows;
        return chain;
      };
      chain.update = (values: unknown) => {
        record.verb = "update";
        record.payload = values;
        return chain;
      };
      chain.delete = () => {
        record.verb = "delete";
        return chain;
      };
      return chain;
    },
    rpc(fn: string, args: unknown) {
      const record: Recorded = { table: fn, verb: "rpc", filters: [], payload: args };
      calls.push(record);
      return Promise.resolve(responses[`rpc:${fn}`] ?? { data: null, error: null });
    },
  };

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any --
     The stand-in implements the surface `OrgScope` uses and nothing else. */
  return { client: client as any, calls };
}

export const ORG_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
export const ORG_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

/** The closing line, and the exit code the suite reports. */
export function report(): never {
  console.log(
    `\n${failures === 0 ? "PASS" : "FAIL"} — ${checks - failures}/${checks} checks passed\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}
