# Domain migration: seefluence.com → huntloop.pro

Status as of 2026-10-14. **Code/docs are ready; the cutover is blocked on Vercel-team access and DNS (below).**
No secret values appear in this file.

## Decisions

- **Canonical origin:** `https://huntloop.pro` (apex). `www.huntloop.pro` → 308 → apex.
  Why apex: mailbox OAuth builds `redirect_uri` from the request origin
  (`apps/web/app/api/mailboxes/[provider]/shared.ts`), so the host users land on must equal the host
  registered with Google/Microsoft exactly. One canonical host = one URI to register.
- `seefluence.com` is **not** touched. It stays attached to its current project until `huntloop.pro` is verified,
  then is released for the separate Website Concepts Studio project (out of scope here).

## Findings (verified)

| Item | Finding |
|---|---|
| Git | `main` @ `8021d3f`, only untracked `AUDIT.md` before this work |
| Prod serves | `GET https://www.seefluence.com/api/health` → commit `8021d3f`, schema `complete`, `siteUrl: https://seefluence.com`, `ok:false` (pre-existing: no cron/AI/mailbox keys) |
| Local Vercel link | `.vercel` + `apps/web/.vercel` → project `huntloop-web` in **`cmbatmans-projects`** (`prj_hkcP…`, root `apps/web`). This is the CLI-only duplicate (serves `huntloop-web-mu.vercel.app`), **not** the project serving seefluence.com |
| Real prod project | Team **`huntloop`** → `huntloop-web` (Git-connected) per [[huntloop-deploy-topology]]. The local CLI login (`cmbatman`) cannot see that team |
| `seefluence.com` DNS | apex A `76.76.21.21` (Vercel), apex 307 → `www`; GoDaddy NS |
| `huntloop.pro` DNS | GoDaddy nameservers (`ns05/ns06.domaincontrol.com`); apex currently resolves to GoDaddy parking IPs (`3.33.130.190`, `15.197.148.33`), i.e. **not on Vercel yet** |
| Domain in Vercel | `huntloop.pro` is not in any Vercel account visible to the CLI (`vercel domains ls`: only `chandramanisharma.online`, `truchat.fun`) |

## Code references to seefluence.com

The app is origin-agnostic: every absolute URL derives from `NEXT_PUBLIC_SITE_URL` via `apps/web/lib/site-url.ts`
(metadata, robots, sitemap, OG, OAuth `redirectTo`, mailbox callbacks, unsubscribe links). No hard-coded
`seefluence` in runtime code. Changed (comments/docs only): `SETUP.md`, `apps/web/app/(marketing)/page.tsx`,
`apps/web/app/api/health/route.ts`. Left as historical records: `AUDIT.md`, `audit/**`, `docs/spec/**`,
`design/PremiumLanding.dc.html`.
No CORS allowlist, cookie `domain`, HubSpot, or Stripe code exists in the app (Stripe not implemented), so nothing to change there.
Cookies are host-only (`__Host-` prefix on https) — users will have to sign in again on the new host; sessions do not carry over.

## Checklist

Legend: ☑ done/verified · ☐ pending (owner)

### A. Repo (done)
- ☑ Audit references; code is env-driven.
- ☑ SETUP.md / comments point at huntloop.pro.
- ☐ Lint/types/tests/build — run results recorded in the PR/report.

### B. Vercel — real production project (team `huntloop`, project `huntloop-web`; **needs owner/team access**)
1. ☐ Settings → Domains → add `huntloop.pro` (set as Production domain) and `www.huntloop.pro` (Redirect to `huntloop.pro`, 308).
2. ☐ Copy the exact DNS values Vercel shows for each (do not guess).
3. ☐ Env → `NEXT_PUBLIC_SITE_URL` = `https://huntloop.pro` (Production), then redeploy (value is inlined at build time).
   Do this only after the domain resolves, otherwise OAuth/canonicals point at a dead host.
4. ☐ Keep `seefluence.com` + `www.seefluence.com` attached until step E passes. Afterwards, optionally make them 308 → `huntloop.pro` for a short grace period, then release them for the Studio project.

### C. DNS at GoDaddy for `huntloop.pro` (do after step B.1 so Vercel shows required values)
Vercel's current standard values (confirm against the dashboard, which is authoritative):
- `A` `@` → `76.76.21.21` (replace the GoDaddy parking A record)
- `CNAME` `www` → `cname.vercel-dns.com` (or the project-specific value Vercel displays)
- Remove any GoDaddy "forwarding"/parking record on `@` and `www` that conflicts.
- If sending mail from `@huntloop.pro` later: SPF/DKIM/DMARC are separate and not part of this cutover.

### D. Third-party dashboards (exact values)
| Provider | Setting | Value |
|---|---|---|
| Supabase `hnoycsbdddpmsivtmrws` | Authentication → URL Configuration → **Site URL** | `https://huntloop.pro` |
| Supabase | Redirect URLs (add; keep seefluence entries during grace) | `https://huntloop.pro/auth/callback`, `https://huntloop.pro/**` |
| Supabase | Email templates | use `{{ .SiteURL }}` / `{{ .ConfirmationURL }}`; no hard-coded host found in repo |
| Google Cloud (Gmail mailbox OAuth, when configured) | Authorised redirect URI | `https://huntloop.pro/api/mailboxes/gmail/callback` |
| Google (Supabase "Continue with Google") | Authorised JS origin / redirect | Supabase's own `https://hnoycsbdddpmsivtmrws.supabase.co/auth/v1/callback` is unchanged; no edit unless a JS origin lists seefluence |
| Microsoft Entra (Outlook mailbox OAuth, when configured) | Redirect URI (Web) | `https://huntloop.pro/api/mailboxes/outlook/callback` |
| GitHub repo `arpitcoding007-star/Huntloop` | Actions variable `HUNTLOOP_URL` | `https://huntloop.pro` (currently unset; owner-only) |
| Sentry/PostHog/Inngest | none configured in prod | — |

### E. Acceptance (run after B–D; none of these are verified yet)
- ☐ `dig huntloop.pro` → `76.76.21.21`; `www` → Vercel; TLS cert issued (https loads without warning).
- ☐ `curl -sI https://www.huntloop.pro` → 308 → `https://huntloop.pro/` (no loop); `http://` → https.
- ☐ `curl https://huntloop.pro/api/health` → `siteUrl: https://huntloop.pro`, commit matches, `schema: complete`.
- ☐ View-source: `<link rel=canonical>`, `og:url`, `/robots.txt` sitemap line, `/sitemap.xml` all `https://huntloop.pro/…`.
- ☐ Sign up / magic link / sign-in / sign-out / password recovery from `huntloop.pro`; email link lands on `huntloop.pro`.
- ☐ Google sign-in (if `NEXT_PUBLIC_AUTH_GOOGLE=true`), mailbox connect (if keys present).
- ☐ App pages load, DB reads/writes work, mobile viewport check.
- ☐ `seefluence.com` still resolves and serves until deliberately released.

### Rollback
Set `NEXT_PUBLIC_SITE_URL` back to `https://seefluence.com`, redeploy; seefluence domains were never removed. Remove nothing from Supabase redirect lists until the grace period ends.
