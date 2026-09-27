# Learning loop audit

## Does HuntLoop learn anything today?

**No — but not because the learning system is missing.** It is built, and it has nothing to learn from.

## What exists

| Piece | Where |
|---|---|
| Learning schema | `0010_learning_loop.sql`, `0018_learning_targets.sql` |
| Outcome capture | `sync_mailbox` → `classify-reply` → outcome recorded against the opportunity |
| Scheduled analysis | `schedule_learning` → `analyze_performance` |
| Analysis task | `packages/ai/src/tasks/analyze-performance.ts` |
| Surface | `/learn` ("What we've learned"), `/memory` (org + person memory) |
| Provenance for attribution | `opportunity_scores.model_version`, `rule_trace`, `model_score` vs `score` |

The provenance work is the part most products skip and the part that makes learning possible later: because the model's opinion is stored separately from the customer's rule adjustments, and every rule that fired is traced, a future analysis can attribute an outcome to a *cause* rather than to a number.

## What is captured

| Signal | Captured? |
|---|---|
| Replies | ✅ via `sync_mailbox` |
| Positive / negative classification | ✅ `classify-reply` |
| Meetings | 🔴 no meeting model |
| Conversions / won deals | 🟡 only if a HubSpot stage is read back — and `sync_hubspot` never runs |
| Deal stages | 🟡 same |
| Lost opportunities | 🟡 status exists; nothing prompts a reason |
| **User corrections** | 🔴 none |
| **Score overrides** | 🔴 none |
| **Accepted / rejected recommendations** | 🔴 no recommendations exist to accept |

So the only live learning input is reply classification — and that requires the cron, which never ran.

## The chain, broken in three places

```
outreach → reply → classify → outcome → analyze → proposal → human accepts → improved scoring
   🔴          🔴        ✅         ✅         🔴         🔴            🔴              🔴
   cron       cron                          cron    not built     not built       not built
```

## Findings

| # | Severity | Finding |
|---|---|---|
| L-1 | **Critical** | No outcome volume: the two upstream stages (send, sync) are cron-gated and the cron never ran |
| L-2 | High | No user-correction capture — the cheapest and highest-quality supervised signal is simply not collected |
| L-3 | High | Learning produces no *proposals*. `analyze_performance` writes findings; nothing turns a finding into "your ICP should probably exclude X — accept?" |
| L-4 | Medium | No meeting model, so the outcome the customer actually cares about cannot be recorded |
| L-5 | Medium | No manual "analyse now" trigger on `/learn` |
| L-6 | Low | Memory (`/memory`) is written by the agent but has no retention/decay policy |

## Design guidance — keep it observable and reversible

The brief is explicit that learning must not be an opaque self-tuning system, and the existing architecture already supports the right shape:

1. **Learning proposes; humans dispose.** An analysis should produce a *proposal* — an ICP criterion to add, a scoring rule to adjust, a source to drop — rendered with the evidence behind it and an accept/reject control. Never auto-apply.
2. **Every applied change is versioned.** `icp_versions` and the rules table already support this, so an accepted proposal is revertible.
3. **Rejections are data too.** A rejected proposal should be stored with its reason; it is the correction signal L-2 is missing.
4. **Attribution must survive.** Keep `model_version` + `rule_trace` on every score, or "the average score moved" becomes unanswerable.

## Sequencing

Do not build more learning machinery now. Build the **capture** (L-2) and fix the **cron** (L-1), then let real outcomes accumulate. Analysis over an empty table is the one part of this product that cannot be usefully written in advance.
