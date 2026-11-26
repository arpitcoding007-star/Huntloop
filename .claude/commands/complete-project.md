---
description: Finish the next piece of Huntloop that code alone can finish — one item per run, verified, as a pull request. Built to run under /loop until only owner actions remain.
argument-hint: "[item id to force | status]"
---

# Complete the project, one item per run

Arguments: `$ARGUMENTS`

Each run finishes **one** item that can be done from the code, proves it, and opens a pull request. Under `/loop` it repeats until nothing code-side is left, then reports what only the owner can do and stops the loop.

## Ground rules

- **Never merge a pull request, push to `main`, create or move tags on `main`, change GitHub or Vercel settings, set secrets, or touch production data.** The owner merges. Migrations apply to production when the owner merges, so a migration is fine to write but must say so in its PR.
- **Never decide for the owner.** Anything in the "Owner" list below, or anything marked **Decide** in `audit/PROJECT-INVENTORY-2026-11-26.md`, is reported, not done.
- Follow `CONTRIBUTING.md`, `COMMAND.md`'s maintenance rule, and section 11 ("Do not change") of the inventory.
- One item per run. If an item is bigger than one run, split it, ship the first slice, and record the rest.
- Do not let pull requests pile up: if **three or more** pull requests opened by this command are open and unmerged, do not start new work. Report which ones wait on the owner and end the run.

## The tracker

`.claude/completion-log.md` is local and untracked (listed in `.git/info/exclude`). It holds the queue and a log. Read it first; create it from the queue below if it is missing. Append one line per run: date, item, outcome, PR link.

## Each run

1. **Sync.** `git fetch --prune`. Check each open PR from the tracker with `gh pr view`. Mark merged ones done; if one failed CI, fixing it **is** this run's item.
2. **If `$ARGUMENTS` is `status`:** print the tracker summary and stop.
3. **Pick** the first item in the queue that is not done, not blocked, and whose dependencies are merged (or `$ARGUMENTS` names one).
4. **Branch** from `origin/main`: `feat/…`, `fix/…`, `chore/…` or `docs/…`. Only stack on an unmerged branch when the item depends on it, and say so in the PR. Until PR #30 is merged, `main` does not have this file: if `.claude/commands/complete-project.md` is missing after the checkout, restore it unstaged with `git show origin/feat/release-0.2-engine-alert:.claude/commands/complete-project.md > .claude/commands/complete-project.md` and never commit it on the item branch.
5. **Do it.** Read the code before changing it; match the style and comment voice around it. Add or extend tests in the suites that already cover that area.
6. **Prove it.** `npm run verify` must pass. Run `npm run test:e2e` when a screen changes. For a visible change, start the dev server with the preview tools and check it in the browser. Never claim a check you did not run.
7. **Record** it in the docs that describe it (`docs/status/README.md`, `audit/pass-22/FINDINGS.md`/`PLAN.md`, `COMMAND.md`, `CHANGELOG.md` under Unreleased) in the same commit.
8. **Ship.** Commit (with the session's attribution line), push, and open a PR against `main` that states what was verified and what was not.
9. **Log** it in the tracker.
10. **When the queue has nothing code-side left:** write the final report (done, waiting on the owner to merge, owner actions) and stop the loop with `ScheduleWakeup` `stop: true`.

## Queue (seed — keep the tracker as the live copy)

| # | Item | Depends on | Notes |
|---|---|---|---|
| 1 | Tag `v0.2.0` and publish a GitHub release with the Light and Dark brochure PDFs attached | PR #30 merged | Tag the merge commit on `origin/main`. The **one** exception to "no tags": it was asked for. Title "Huntloop 0.2.0", body from the CHANGELOG section |
| 2 | Remove the three unused `eslint-disable` directives (`audit/pass-22/harness/g.mjs`, `brochure/catalogue.mjs`, `brochure/content.mjs`) | — | Lint must report 0 warnings |
| 3 | Refresh stale documents: `COMMAND.md` header date, the master guide's migration count (it should say 71), mark `docs/spec` 01–07 historical | — | Check each first; wave 4 may have done some |
| 4 | Command palette (UX-15): ⌘K / Ctrl+K over Jump-to search plus the verbs with no screen of their own | — | Keyboard and screen-reader accessible; Playwright desktop and mobile; update `COMMAND.md` |
| 5 | Profile picture upload (V-18 remainder) on Settings → You, via Supabase Storage with RLS on the bucket | — | Migration needed; size and type limits; no EXIF kept |
| 6 | Split `packages/db/scripts/verify-migrations.ts` and `packages/jobs/scripts/verify-jobs.ts` by subject, keeping every check | — | Check count before and after must match |
| 7 | Remove the unused `TTL` export in `packages/providers/src/cache.ts` if still unread | — | |

## Owner (report, never do)

- Set `CRON_SECRET` (Vercel and GitHub), set `HUNTLOOP_URL` to `https://huntloop.pro`, move the tick to Inngest.
- Provider keys and `MAILBOX_ENCRYPTION_KEY`; then `npm run live-check` and the first live run.
- `SENTRY_DSN` plus a Sentry Crons alert rule; PostHog.
- Legal facts in `apps/web/lib/legal.ts`; counsel review.
- Repository visibility and branch protection on `main`; disconnect the failing Vercel project `huntloop`.
- Decisions: billing, Exchange (EX-1, EX-3, EX-4, EX-6 to EX-10, moderation screen), `WORKSPACE_PURGE_DAYS`, `ActionRail`, the unused database views and `company_gaps`, unused CSS tokens.
- Merging this command's pull requests.
