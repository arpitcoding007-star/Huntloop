---
description: >-
  Where Huntloop stands today, what only the owner can unblock, and where the
  detail for everything else lives.
---

# Status

> **Layer:** Internal · **Audience:** everyone · **Checked:** 26 Nov 2026

{% hint style="info" %}
This page replaced six older ones on 26 Nov 2026: *Implementation status*,
*Roadmap*, *Technical debt*, *Documentation vs. code*, *Pass 18 status* and the
second *Changelog*. Each had become a dated snapshot that disagreed with the
others. They are kept in Git at the `pre-cleanup` tag.
{% endhint %}

**The rule:** the code outranks every document on the question of what exists.
When this page and the code disagree, the code is right and this page is out of
date.

## Today

| Area | State |
|---|---|
| Code | Broadly built. The latest full check, [audit pass 22](../../audit/pass-22/README.md), classified 236 capabilities: 7 fully live, 194 built and tested but not live, 9 partial, 1 not working, 2 not implemented, 23 planned |
| Production | `huntloop.pro` runs `main` with the schema complete through migration 0071 |
| Health | `/api/health` answers `ok:false`. No cron secret, AI, data, mailbox, email or monitoring service is configured, and credential encryption is off |
| Engine | Not running in production. Every scheduled "Engine tick" run fails (see [The heartbeat](../operations/heartbeat.md)) |
| Tests | `npm run verify` and both Playwright suites pass in CI on every pull request |

Nothing that depends on an outside service has been seen working against the
real service: AI output, vendor data, mailbox sending and reply reading are
proven against stand-ins only.

## What only the owner can do

These block the product from running and cannot be done from the code.

| Action | Why |
|---|---|
| Set `CRON_SECRET` on Vercel and as a GitHub secret | The tick route refuses to run without it |
| Set the GitHub variable `HUNTLOOP_URL` to `https://huntloop.pro` | `https://www.huntloop.pro` redirects, so the tick call fails |
| Move the tick to Inngest or a paid Vercel cron | GitHub runs the five-minute schedule only every few hours, and a private repository would pay for every run |
| Add the provider keys (Anthropic, Apollo, Hunter, ZeroBounce, Resend, Google and Microsoft mail) and `MAILBOX_ENCRYPTION_KEY` | Each one switches on a part of the product; see [Environment variables](../developer/environment-variables.md) |
| Configure Sentry and PostHog, and add a Sentry alert rule for Crons | Without them a production failure is invisible. The engine-stopped alert is built in and reports to Sentry once `SENTRY_DSN` is set ([The engine-stopped alert](../operations/heartbeat.md#the-engine-stopped-alert)) |
| Fill in `IDENTITY` in `apps/web/lib/legal.ts` | The legal pages stay unpublished until the business facts are supplied |
| Disconnect the Vercel project `huntloop` (the one with no root directory) | It fails on every commit; `huntloop-web` is the project that serves the site |
| Decide whether the repository stays public, and protect `main` | The repository holds internal plans and audits |
| Decide on billing | There is no payment path; the pricing page says so ([open decision #1](../decisions/README.md#open-decisions)) |

Then run `npm run live-check` and [the first live run](../operations/first-live-run.md).

## Open engineering work

Ranked work lives in one place each:

* [audit/pass-22/PLAN.md](../../audit/pass-22/PLAN.md): the prioritized plan from the latest verification
* [audit/pass-22/FINDINGS.md](../../audit/pass-22/FINDINGS.md): defects and gaps, with cause and reproduction
* [audit/BACKLOG.md](../../audit/BACKLOG.md): every finding ID cited in code comments, with its status

## Not debt: deliberate

These look like gaps and are decisions. See the [Decision log](../decisions/README.md).

* No general REST API
* No shared sending infrastructure or deliverability tooling
* No second CRM
* Two-way CRM sync: stage is recorded as evidence, not obeyed
* No Inngest SDK dependency
* No exactly-once queue semantics
* No weights column on `opportunity_scores`
* No SSO or SCIM
* `contact_retention_days` defaults to `NULL`

## History

* [CHANGELOG.md](../../CHANGELOG.md): what shipped, by release
* [audit/README.md](../../audit/README.md): every audit pass
* [Decision log](../decisions/README.md)
