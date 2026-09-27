# Manual actions required

Things no amount of code can do. Each needs a human with credentials or authority.

---

## 🔴 Do first — security

### 1. Patch the Next.js RCE

`npm audit --audit-level=high` exits 1 today. `next@^16.3.1` sits inside a range carrying **two critical unauthenticated RCE advisories** (GHSA-p293-qw3h-jr36, GHSA-2xp9-vwfh-vxw4) plus a high-severity `sharp`/libheif issue.

```bash
npm audit fix
npm run verify        # must pass before anything deploys
```

A non-breaking fix is reported available. Do not deploy anything until this is green.

---

## Credentials to provision

| Variable | For | Consequence if unset |
|---|---|---|
| `ANTHROPIC_API_KEY` | all 12 AI tasks | no research, ICP drafting, qualification, why-now, personalization |
| `APOLLO_API_KEY` | company/people search, enrich, signals | discovery finds nothing; reach counter says "cannot count" |
| `ENRICHMENT_API_KEY` | Hunter (`person.match`) | falls back to Apollo |
| `EMAIL_VERIFICATION_API_KEY` | ZeroBounce | every address stays `unverified` |
| `MAILBOX_ENCRYPTION_KEY` | mailbox **and** CRM tokens | connecting a mailbox or HubSpot is refused |
| `CRON_SECRET` | job heartbeat | `/api/jobs/tick` returns 503 — **nothing runs** |
| `SUPABASE_*` | database | app runs on demo data |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | error reporting | SDK is a no-op |
| `NEXT_PUBLIC_POSTHOG_KEY` | product analytics | `capture()` is a no-op |
| `NEXT_PUBLIC_SITE_URL` | canonical URLs, CRM back-links | links point at the per-deploy Vercel host |
| `STRIPE_*` | — | **currently read by nothing**; either implement billing or remove these |

Generate the encryption key with `openssl rand -hex 32`. Rotating it makes every connected mailbox and CRM need reconnecting.

---

## Deployment steps

1. **Vercel project settings** — Framework: Next.js; Root Directory: `apps/web`; Install command: default.
2. **Set every variable above** in Project → Settings → Environment Variables. `SUPABASE_SECRET_KEY` must never carry `NEXT_PUBLIC_`.
3. **Confirm the cron.** `apps/web/vercel.json` schedules `/api/jobs/tick` every minute. This requires a plan with minute-level cron — Hobby allows one invocation per day, which is not a heartbeat. If Hobby, drive it from Inngest instead (`INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY`).
4. **Apply migrations.** All 28, in order, by hand against the Supabase project — there is no automated migration step. Then run `npm run db:doctor` to confirm none were missed. This is the largest operational risk in the project; automating it is `26` Phase 2.
5. **Verify the heartbeat.** After the first hour, check `job_executions` for rows that were **claimed and finished**, not merely queued.

---

## Third-party accounts to create

| Account | Why | Notes |
|---|---|---|
| Apollo | primary data provider | note the plan's credit allowance; reconcile against `CREDITS` in `adapters/apollo.ts` |
| Anthropic | AI | set a spend cap independently of HuntLoop's own quota |
| HubSpot **sandbox** | CRM verification | free developer portal; needed before touching a customer's real portal. Private app needs CRM read/write on companies, contacts, deals, plus properties |
| Google Cloud / Microsoft Entra | mailbox OAuth | consent screens and scopes |
| Sentry, PostHog | observability | optional but recommended before first customer |

---

## Decisions only you can make

| # | Decision | Why it cannot wait long |
|---|---|---|
| 1 | **Billing: implement Stripe or remove it.** Plans are priced and displayed; three of five limits are unenforced; no payment path exists | You cannot take money today, and the pricing page implies you can |
| 2 | **Two-way CRM sync:** may HubSpot's stage overwrite HuntLoop's opportunity status? | Currently recorded as evidence only. Needs a real rep's opinion |
| 3 | **Source-of-truth table** between HuntLoop and HubSpot | Write it before inbound sync exists, not after (`11_CRM_HUBSPOT_AUDIT.md`) |
| 4 | **GDPR lawful basis** for enrichment and outreach in your target geographies | Needs counsel. Affects whether EU prospecting is viable at all |
| 5 | **Retention periods** per org | The SQL exists; the numbers are a policy choice |
| 6 | **Hobby vs Pro Vercel** | Determines whether the engine can beat once a minute or once a day |

---

## Legal review (not engineering)

- Lawful basis for processing enriched personal data (GDPR Art. 6(1)(f) legitimate interest assessment).
- CAN-SPAM / PECR compliance of the outreach flow — unsubscribe and suppression are implemented; the *content* and sender identification requirements are a policy matter.
- Data-processing agreements with Apollo, Hunter, ZeroBounce, Anthropic, HubSpot.
- Privacy policy and data-subject request procedure — the erasure job exists but has no request intake.
