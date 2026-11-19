# W5 — failure injection

Method: (1) inventory the failures the existing suites already inject; (2) for the gaps, a scratch probe outside the repo (`provider-malformed.ts` in the session scratchpad) that drives the real adapters with `fetch` replaced. Nothing left the machine.

## What is already injected, and holds

| Failure | Where injected | Result |
|---|---|---|
| Provider transport failure, retried | `verify-providers.ts:341` | 3 attempts, eventual success recorded |
| Provider 429 | `verify-providers.ts:357`, Apollo `:489` | retried to the cap, ledger says `rate_limited` |
| Provider 401 / bad key | `:374`, Apollo `:473` | not retried; says the key was rejected |
| Provider 5xx | Apollo `:500` | retryable |
| A failure is never cached | `:312` | holds |
| AI refusal, `max_tokens`, `pause_turn`, empty answer | `packages/ai/scripts/verify-tasks.ts` (`:413`, `:499`, `:1632`, …), `client.ts:164-186` | refused or failed visibly; no SDK retries (`maxRetries: 0`, the queue retries) |
| AI cost on failure | pass-15 AI-010 fix, `verify-tasks.ts` | tokens carried on errors |
| Job killed at its deadline / stalled worker | `verify-jobs.ts:499`, `:587`; DB `verify-migrations.ts` queue block | handed back without penalty; stalled job requeued |
| Same send twice, crash mid-send | `verify-jobs.ts` OUT-001 block | at most one provider send; "delivery unknown" otherwise |
| Same unsubscribe twice | `verify-migrations.ts:909-942` | one event, idempotent |
| Double approve | `inbox/actions.ts:302-313` (`.is("scheduled_at", null)`) | second write matches nothing |
| Another org's ids | `verify-migrations.ts:316`, `:3021`, `enforce_same_org_refs` cases; reviewer A scanned all 138 actions for client-supplied org ids | refused / invisible |
| Viewer spending AI | `apps/web/lib/ai/spend-guard.test.ts` | refused before the call |
| Lower role writing | `mutate` (`lib/data/org.ts:100-118`); the only `minRole: "viewer"` actions (assistant, questions, settings/you, notifications) write the caller's own rows | refused / self-only |
| Gmail send answered with an unparsable body | read: `gmail.ts:101` throws → `send-message.ts` `isDefiniteRefusal` false → "Delivery unknown", permanent | safe direction (never re-sent) |

## Probe results (new)

`fetch` returned each body below to the real adapters:

| Body | Apollo search | Apollo person | Hunter person | ZeroBounce verify |
|---|---|---|---|---|
| 200 HTML (proxy or maintenance page) | throws `SyntaxError` | `SyntaxError` | `SyntaxError` | `SyntaxError` |
| 200 empty | `SyntaxError` | `SyntaxError` | `SyntaxError` | `SyntaxError` |
| 200 JSON, unexpected shape | throws `TypeError` | **returns `data: null`, credits 2** | **returns `data: null`, credits 1** | returns `"unknown"`, credits 1 |
| 200 `null` | `TypeError` | `TypeError` | `TypeError` | `TypeError` |
| Timeout (`TimeoutError`) | `ProviderError`, retryable | same | same | same |

How `callProvider` treats them (`call.ts:258-290`, `isTransport` `:318`): a `SyntaxError` or `TypeError` is neither a `ProviderError` nor a transport error, so it is **not retried**, is recorded as `failed` and is not cached. That is acceptable. The cell that matters is the unexpected-shape row.

### [Medium] PROV-301: A changed or unexpected 200 response from Apollo or Hunter becomes a charged "no match", cached for the TTL
- Confidence: CONFIRMED for the adapter return value (probe). LIKELY for caching: `matchPerson` passes no `cacheable` (`providers/src/index.ts:189-210`), so the default caches every success, including `null`.
- Where: `adapters/apollo.ts` `matchPerson` (`:529+`), `adapters/hunter.ts:108+`. Both read an optional field (`body.person`, `body.data`) and return `null` when it is absent, with credits charged.
- Impact: if a vendor renames a field or wraps the payload (the shapes are unverified live, PROV-005), every person lookup reads as "nobody findable". That is billed, recorded as a success, and cached. The pass-16 rule, "a failed search must never look like an empty market", is broken for contacts, silently, at full cost. ZeroBounce's `"unknown"` is not cached (`index.ts:241`), and its behaviour (rounds down, not sendable unattended) is the safe direction.
- Root cause: "the response did not have the shape we expect" and "the vendor found nothing" are the same branch.
- Fix: in each adapter, distinguish the vendor's own empty answer (Apollo `person: null` present, Hunter 404 / `data.email` null with `data` present) from a missing envelope, and throw a non-retryable `ProviderError("unexpected response shape")` for the latter. Pass `cacheable: (d) => d !== null` for `person.match` unless the empty answer is the vendor's own.
- Acceptance: a 200 with `{}` from Apollo or Hunter is recorded `failed`, is not cached, and charges 0 credits in the ledger.
- Test to add: `verify-providers.ts`, "an unexpected 200 shape is a failure, not an empty answer" per adapter.
- Effort: S · Mechanizable: yes (test) · Status: New

## Not injected (no safe harness here), and what would settle each

| Failure | Why not | How |
|---|---|---|
| Two workers claiming the same job, or racing the lane or reserve | PGlite has one connection | a two-connection Postgres (W6, `09_ACCESS_NEEDED.md`) |
| Revoked OAuth token mid-sync, against the real vendor | no mailbox | sandbox Workspace/M365 account |
| HubSpot 409/429 under real paging | no portal | HubSpot developer test portal |
| Anthropic 529 overload | no key | covered by code read (`maxRetries: 0`, queue backoff); live run would confirm |
| Route handlers (tick, OAuth callback, health) with bad input | no route tests exist (pass-16 TEST-201) | the five route tests in pass-16 `05_VERIFICATION.md` |
