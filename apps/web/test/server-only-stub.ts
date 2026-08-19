/**
 * Stands in for the `server-only` package under vitest.
 *
 * See the note beside the alias in `vitest.config.ts`. Empty on purpose: the
 * real package's only job is to throw when it is bundled into a client graph,
 * and a test run has no client graph to be bundled into.
 */
export {};
