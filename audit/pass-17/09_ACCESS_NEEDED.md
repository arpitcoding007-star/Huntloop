# What only the owner's access can settle

Everything else in the audit program has now been done from this machine. These items need something only you can provide. They are ordered by how much each one unlocks.

| # | Provide | Settles | How long |
|---|---|---|---|
| **A1** | **A staging Supabase project** (free tier is fine), its URL and keys in a local `.env.local`, and permission to apply 0001–0051 to it | DB-201 real grants; DB-203 and SEC-102 against real PostgREST; the PROD-201 marker probe over HTTP; `pg_cron` behaviour; RLS under PostgREST; every signed-in flow, onboarding and real-data empty/error states (W1 gaps) | ~30 min |
| **A2** | **Sandbox vendor keys** (Apollo, Hunter, ZeroBounce, Anthropic) for that staging project, and your OK to spend a few credits | PROV-005 request shapes; PROV-301 against real responses; AI cost per run; first-run timing vs 60 s (ENG-203) | ~30 min, plus a small credit spend |
| **A3** | Permission to install **Postgres or Docker** locally, or a second staging DB connection string | Real concurrency: two sessions racing `claim_job_executions`, `claim_contact_lane`, `reserve_provider_credit` (pass-16 TEST-202); production-like query timings (W6 used PGlite) | ~20 min |
| **A4** | A **test Google Workspace or M365 mailbox** connected to staging | Send, threading, bounce DSNs, List-Unsubscribe one-click, the OUT-201 guard end to end | ~20 min |
| **A5** | A **HubSpot developer test portal** | CRM-201 duplicate deals, CRM-202 overwrite, association behaviour | ~15 min |
| **A6** | Read-only looks at dashboards (you can paste screenshots or settings; no credentials): **Vercel** (projects, domains, env names per environment, Git deploy checks), **Supabase prod** (Backups/PITR, Auth URL config, `select * from cron.job`), **GitHub** (Actions secrets/variables names, tick and migrate run history, branch protection, workflow permissions, repo visibility), **Google Cloud + Entra** (OAuth redirect URIs), **Sentry**, **registrar DNS** for `huntloop.pro` | PROD-001, PROD-202/206, SEC-204, JOB-204 severity, OBS-201, M1–M15 in the pass-16 manual-ops register | ~20 min |
| **A7** | The **7 legal facts** pending in `apps/web/lib/legal.ts` (entity name, registered address, jurisdiction, privacy contact, contact email, Art. 27 representative needed?, prospect lawful basis) | LEGAL-01; publishing the privacy, terms and acceptable-use pages | your decision |
| **A8** | A person with **NVDA or VoiceOver** for 30 minutes | Screen-reader output and full form tab order (A11Y not covered) | 30 min |
| **A9** | After A1–A4 and a deploy in the safe order: a **post-deploy pass (pass 18)** | That 0048–0051 and the send guard are live in production | one session |

A1 alone settles the most, and makes A2–A5 possible.
