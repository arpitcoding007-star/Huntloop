# Pass 21

- **Commit audited:** `dab37db`
- **Fixes:** `feat/pass-21-loop`
- **Scope:** the whole project after PRs 7–18
- **Method:** `/audit-system`. Five read-only area sweeps ran in parallel, then a disprove pass on every High, then fixes with tests in the same session.

| File | Contents |
|---|---|
| [00_SUMMARY.md](00_SUMMARY.md) | Verdict, counts, blockers, top 10, do-not-change |
| [03_FINDINGS.md](03_FINDINGS.md) | Every finding with fix status and proof |
| [CHECKLIST.md](CHECKLIST.md) | Areas covered |
| `raw-A…E-*.md` | Area reports: evidence, state machines, invariants, integration and job inventories, env inventory, top-10 missing tests |

The skill's other files (system map, flows, verification, DB, security, integrations, ops, debt, roadmap, env, diff) were not written as separate files. Their content is in the area reports:

| Topic | Report |
|---|---|
| State machines, invariants | B |
| Integration inventory | C |
| Job table | D |
| Env inventory, CI gates, missing tests | E |
| Journey table | A |

## Tests added this pass

| Suite | New checks | Covers |
|---|---|---|
| `verify-migrations` "0070" | 25 | Last owner, self-promotion, mailbox cap and delete, erasure, domain claim, Verified reset, deleted-org roles and Exchange, hard delete |
| `verify-jobs` | 12 | OUT-201, CRM-001, CRM-003, DB-009, ENG-001 reaper, ENG-002 marker |
| `verify-providers` | 1 changed | PRV-002 |

## Not verified in this pass

| Item | What would settle it |
|---|---|
| Any live vendor, model or email behaviour | Production keys, then `npm run live-check` |
| Whether Apollo enrich returns `{}` for "not found" | One live call |
| Gmail `history.list` with `labelId` and pagination against a real mailbox | A connected test mailbox |
| Outlook delta `$filter=receivedDateTime` | A connected test mailbox |
| Production CSP header, Supabase PITR, backups, restore drill | Vercel and Supabase dashboard access |
| Latency (PERF-001 and others) | Not measured |
| The AI-001 price claim | The current price list |
