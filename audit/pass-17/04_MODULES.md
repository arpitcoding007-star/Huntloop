# W4 — backend modules pass 16 did not trace

Read line by line at the baseline tree: `app/(onboarding)/welcome/{actions,company/actions,icp/actions,building/actions,sources/actions}.ts`, `lib/data/onboarding.ts` (all writers), `lib/data/directory.ts`, and SQL `claim_research` (0025) and `discoverable_workspaces`/`request_to_join` (0027).

## Findings

### [Medium] SEC-302: A workspace's company domain is self-asserted, so anyone can appear as "your company's workspace" to every employee of a target domain
- Confidence: CONFIRMED (code and SQL read; not run).
- Where: `lib/data/onboarding.ts` `saveCompanyStep` (sets `organizations.primary_domain` from `understanding.url`, which arrives from the client, `company/actions.ts:157-177`); `welcome/actions.ts` `createWorkspace` → `create_organization(p_domain)` (0030:70) from the URL the user typed; `0027` `discoverable_workspaces()` matches the **caller's** verified email domain against that unverified `primary_domain`.
- Evidence: the column comment in 0027 says the domain is "never against a domain a caller supplies". That is true for the *searcher's* side only. The *workspace's* side is whatever its creator typed: any site, any domain.
- Trace: a user with any address creates a workspace from `https://acme.com` → `primary_domain = acme.com`, `is_discoverable` defaults true → every `@acme.com` user signing up sees it listed as a workspace at their company and can "Ask to join" → the creator approves.
- Impact: it impersonates a company to its own employees. A victim who joins may connect their mailbox or import contacts into a stranger's tenant. It also pre-empts the real company's own onboarding, because the prompt steers them to "join the existing workspace". It needs the victim to act and the creator to approve, so Medium.
- Root cause: discovery trusts a claim of domain ownership that nothing verifies.
- Fix: write `primary_domain` only when it equals the creating (or a later owner's) verified email domain, and leave it NULL otherwise. Optionally also require at least one member with that email domain before `discoverable_workspaces` returns the org.
- Acceptance: a workspace created by `@other.com` from `acme.com` is not returned to an `@acme.com` caller.
- Test to add: `verify-migrations.ts` "a workspace is discoverable only at a domain one of its owners has an address at".
- Effort: S · Mechanizable: yes (test) · Status: New

### [Low] FLOW-301: A personal workspace is named from the first name split on the letter "s"
- Confidence: CONFIRMED (code).
- Where: `app/(onboarding)/welcome/actions.ts:189`, `.trim().split(/s+/)[0]`. The regex is missing a backslash: `/s+/` splits on runs of the letter `s`, not on whitespace.
- Repro: full name "Chris Smith" → `"Chri"` → workspace "Chri's workspace" at `/chri`. "Alex Jones" → `"Alex Jone"`, so the whole name with the trailing `s` cut, giving slug `alex-jone…`. Only names with no `s` come out right.
- Impact: a wrong workspace name and a wrong permanent slug on the "personal workspace" first-job path (`startFirstJob`). The slug is in every URL and is not renamed later.
- Fix: `split(/\s+/)`.
- Test to add: unit test of `personalName`'s splitting (extract the helper).
- Effort: S · Mechanizable: yes (lint: `no-useless-escape` would not catch it; a test does) · Status: New

## Checked, nothing found

| What | Result | Where |
|---|---|---|
| Membership on every onboarding write | All seven writers (`saveCompanyStep`, `saveGoalsStep`, `saveIcpStep`, `saveSourcesStep`, `completeOnboarding`, `makePersonalWorkspace`, `setOnboardingStep`) go through `mutate`. `saveYouStep` writes only the caller's own `profiles` row (`.eq("id", auth.user.id)`) | `lib/data/onboarding.ts` |
| Spend on onboarding model calls | `research`, `draft`, `recommend` refuse through `resolveRecorder` before the call (membership + role); budget and rate limit are checked first (`lib/ai/research.ts:67-80`) | `lib/ai/*` |
| `runStageAction` | `mutate` + `limitRefusal(orgId, "first_run_stage")`, then the runner gets the org id from a verified membership before service-role code runs | `building/actions.ts:181-187` |
| `recommendSourcesAction` | `requireOrgId` when a DB exists; demo path uses a fixture only | `sources/actions.ts:56-64` |
| Live-seal minted for an org the caller passes in | `researchCompanyAction(url, existingOrg)` on the claimed-research path returns `liveSealFor(slug)` without a membership check, but the seal is only accepted by `saveCompanyAction` → `saveCompanyStep` → `mutate`, which refuses non-members. Harmless | `company/actions.ts:87-101` |
| `claim_research` | DEFINER, no argument, domain from `auth.users`, claim-and-read in one `UPDATE … RETURNING`, execute revoked from anon | `0025` |
| `request_to_join` | Refuses any org the caller could not see through `discoverable_workspaces()` | `0027` (the hole is the discoverability itself, SEC-302) |
| Client-supplied company profile | Bounded by `parseUnderstanding` (lengths, 20 findings, kind enum) and affects only the caller's own tenant | `company/actions.ts:188-228` |
| Error text to the browser | `createWorkspace` returns `error.message` from `create_organization` for non-23505 errors (`welcome/actions.ts:324`): the same class as pass-16 API-203, not filed again | — |
