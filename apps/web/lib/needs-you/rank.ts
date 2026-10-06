/**
 * "Needs you" ranking — the implementation lives in `@huntloop/db/needs-you`
 * so the daily digest job ranks with exactly the same rules. Re-exported here
 * so the app's imports (and `rank.test.ts`) are unchanged.
 */
export * from "@huntloop/db/needs-you";
