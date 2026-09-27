# Outreach audit

## What exists (more than the README claims)

| Capability | Implementation |
|---|---|
| Campaigns / sequences / steps | `campaigns`, `sequences`, `sequence_steps` (`0004`), managed in `OutreachManager.tsx` |
| Enrollment | `enrollments`, advanced by `advance_enrollments` |
| Sending | `send_message` + `packages/jobs/src/mailbox/{gmail,outlook}.ts` |
| Mailbox connection | OAuth via `/api/mailboxes/[provider]/start` + `/callback`, tokens AES-256-GCM encrypted |
| Reply ingestion | `sync_mailbox`, thread matching, `classify-reply` |
| Suppression + cadence caps | `0017`, `can_contact()` |
| Unsubscribe | `/unsubscribe/[token]` + `/api/unsubscribe/[token]` |
| Personalization | `personalize-message` |
| Inbox | `/inbox` with real loader and reply actions |

## The autonomy ladder — the differentiator

Messages carry `scheduled_at`, and `send_message` **refuses any message without it**. At low autonomy the engine drafts and stops; a human sets `scheduled_at` by approving. `schedule_sends` sweeps approved-and-due messages into jobs.

This is the right design for an AI outbound product and it is properly enforced at the handler, not just in the UI.

## Send safety (excellent)

`send_message`'s check order is deliberate and documented:

1. **Already sent?** — the queue is at-least-once, and `sent_at` is the only reliable evidence.
2. **Suppressed?** — re-checked here even though `advance_enrollments` checked it, because days can pass between drafting and sending and an unsubscribe arriving in that window must win.
3. **Approved?**
4. **Allowance claimed atomically *before* the send** — "a crash between claiming and sending over-counts by one; the reverse order over-sends, which costs a domain's reputation and cannot be undone."
5. Send. 6. Record `sent_at` **with the provider message id** — `messages_sent_has_provider_id` means a message cannot claim to have been sent without proof.

On provider failure: `sent_at` stays null, an `error` is recorded, a `failed` event is written. It never falsely marks a message sent.

Reply handling matches provider thread id → `In-Reply-To` → sender heuristic, **in that order of trustworthiness**, and an unmatched reply is stored rather than dropped ("silently dropping it would make the product look like it loses mail"). A reply stops the sequence, moves the opportunity to `replied`, and records an outcome.

## Findings

| # | Severity | Finding |
|---|---|---|
| OU-1 | **Critical** | Nothing sends or advances without the cron: `schedule_sends`, `advance_enrollments` and `schedule_syncs` are all sweepers |
| OU-2 | **Critical** | `emails` plan quota is defined, displayed and **never enforced** — `send_message` claims a mailbox allowance but not the plan limit |
| OU-3 | High | Never verified against a live mailbox; OAuth, send and sync are all untested against Google/Microsoft |
| OU-4 | Medium | No deliverability tooling (warm-up, rotation, domain health) — a deliberate scope decision, but it caps safe volume and nothing in the UI says so |
| OU-5 | Medium | No bounce handling distinct from failure: a hard bounce should suppress the address, and only `classify-reply`-driven paths currently can |
| OU-6 | Medium | Single channel. No call or LinkedIn step type — deliberate, and correct for now |
| OU-7 | Low | No send-time optimisation or per-recipient throttling beyond the cadence cap |

## Should HuntLoop send email itself?

**Yes — keep it, narrow.** The argument for owning sending here is not channel coverage, it is that the autonomy ladder and the evidence chain only work if the draft, the approval and the send are the same system. Routing sending through an external tool would put the approval gate outside the product that made the claim.

But keep the scope exactly where it is: BYO mailbox, one channel, no warm-up infrastructure. If volume ever demands deliverability engineering, integrate a specialist rather than building one — that is a different company's product.
