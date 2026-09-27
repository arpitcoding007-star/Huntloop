---
description: The eight HTTP routes that exist, why each one had to be a route, and how it authenticates.
---

# HTTP endpoints

> **Layer:** Developer · **Audience:** engineering, operations

Huntloop deliberately has **no general-purpose REST API**. Every route below
exists because something *outside* the app must call it: a cron platform, a mail
client, a browser reporting a violation, an OAuth provider.

| Route | Methods | Auth | Public? |
|---|---|---|---|
| `/api/jobs/tick` | GET, POST | `Authorization: Bearer $CRON_SECRET` | No |
| `/api/inngest` | POST | HMAC signature (`x-inngest-signature`) | No |
| `/api/csp-report` | POST | None — by necessity | Yes |
| `/api/unsubscribe/[token]` | GET, POST | The token itself | Yes |
| `/api/mailboxes/[provider]/start` | GET | Session + `canWrite` | No |
| `/api/mailboxes/[provider]/callback` | GET | OAuth `state` cookie | No |
| `/auth/callback` | GET | Supabase auth code | Yes |
| `/auth/signout` | POST | Session | No |

***

## `/api/jobs/tick` — the heartbeat

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
     "https://your-app/api/jobs/tick?limit=5"
```

```jsonc
{
  "claimed": 5, "succeeded": 4, "failed": 1,
  "requeued": 0, "stoppedEarly": false,
  "jobs": [{ "id": "...", "name": "scan_source", "ok": true, "detail": "{...}" }]
}
```

| Property | Value | Why |
|---|---|---|
| `runtime` | `nodejs` | The SSRF guard reaches `node:dns` and `node:net`, which do not exist on Edge |
| `maxDuration` | 60 | Works on both Hobby (60s cap) and Pro (300s). The runner's own deadline is derived from it |
| `limit` | 5 by default, from the query string | |
| Cache | `no-store` | A cached tick is a tick that did not happen |

**Every call sweeps *and* ticks.**

### The three status codes

| Code | Means |
|---|---|
| `503` | `CRON_SECRET` is not set. The route **refuses to run** rather than skipping the check — the alternative is a deployment that looks like it is working and is wide open, which is the worse failure because nothing about it looks wrong |
| `404` | Wrong or missing bearer token. Not `401`: a 401 confirms the endpoint exists and is worth guessing at |
| `200` | The **tick** succeeded — even if a job inside it failed |

{% hint style="info" %}
**Why 200 on a job failure.** A cron platform reads the status code to decide
whether to alert, and a 500 for "one source's feed timed out" trains people to
ignore the alert — which is worse than no alert. Job failures are in the body
and in `job_executions.error`, which is where a failure that needs a human is
actually looked for.
{% endhint %}

The token comparison is constant-time-ish. `===` on a secret leaks its prefix
through timing; the fix is four lines.

***

## `/api/inngest`

Same `sweep()` + `tick()`, different driver. Returns **404** when
`INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` are not both set — *not* "200,
feature disabled", which is how a scheduler ends up reporting green for a week
of ticks that never ran.

There is no Inngest SDK dependency; the integration is an eleven-line HMAC
check. See [The engine](../architecture/engine.md#drivers).

***

## `/api/csp-report`

Unauthenticated by necessity: a violation report is sent by the browser before,
and often instead of, anything the user did — frequently for a visitor with no
session, sometimes for a page that failed before any session could be read.
Behind the route guard it would be answered with a 307 to `/login` and the
report stream would be silently empty, which is the entire point of shipping
the policy report-only first.

It is written on the assumption that it will be found and abused:

* The body is **size-capped before it is parsed**.
* Only a **fixed set of fields** is read, each truncated — the body is
  attacker-controlled and the destination is the alerting channel engineers
  read at 3am.
* Reports are **fingerprinted by directive + blocked-URI**, so one
  misconfigured directive produces one issue rather than one per page view.
* It **always answers 204**, including on garbage.

No rate limiting: `consume_rate_limit` requires an authenticated caller and an
org, neither of which exists here. The bounds above stand in for it, and unlike
a model call this path costs nothing per request beyond a Sentry event, which
Sentry's own quota bounds.

***

## `/api/unsubscribe/[token]`

RFC 8058 one-click unsubscribe — the address in the `List-Unsubscribe` header.

| Method | Behaviour |
|---|---|
| `POST` | Acts immediately. The one-click POST comes from the **mail client**, not a person — Gmail shows its own Unsubscribe button and sends `List-Unsubscribe=One-Click` when pressed. That is an explicit action |
| `GET` | **Does not act.** Redirects to a page with a button, which posts |

{% hint style="danger" %}
**Why GET is inert.** Mail clients and security scanners prefetch links in
messages. A GET that unsubscribed would quietly remove people who never clicked
anything — a mutation on a safe method, punished by exactly the software trying
to protect the recipient.
{% endhint %}

No session is required. The person clicking is a prospect, not a user, and must
not need an account to stop being emailed. `record_unsubscribe` (`0008`) is
`SECURITY DEFINER` and takes **only the token**: with it, it can suppress that
one address and record why, and nothing else.

A dead unsubscribe link converts somebody who wanted to leave quietly into
somebody pressing "report spam", which is charged to the sending domain and to
every other campaign running from it.

***

## `/api/mailboxes/[provider]/start` and `/callback`

`provider` is `gmail` or `outlook`.

**Every refusal happens at `start`, never at `callback`.** By the time the
callback runs, the user has read a consent screen, granted access to their
mail, and been redirected back — and the only honest thing left to do would be
to throw the grant away and ask them to do it again. So the two conditions that
make the flow pointless are checked before the redirect:

1. The provider has no client credentials on this deployment.
2. `MAILBOX_ENCRYPTION_KEY` is unset, so tokens could only be stored in plain
   text.

The `state` parameter is a random value in an HTTP-only cookie, checked on
return. Tokens are encrypted before they touch a row.

Redirect URIs to register:

```
<NEXT_PUBLIC_SITE_URL>/api/mailboxes/gmail/callback
<NEXT_PUBLIC_SITE_URL>/api/mailboxes/outlook/callback
```

***

## `/auth/callback` and `/auth/signout`

Supabase's auth-code exchange and sign-out. `/auth/*` is a public prefix in
`proxy.ts`. `lib/safe-next.ts` validates the post-login redirect target, so a
`?next=` parameter cannot be used as an open redirect.

***

## Writes that are not routes

Everything else is a **Server Action**. Those are still public POST endpoints —
Next generates an id for each one and exposes it to the browser — so each one
validates its input with Zod at the edge. See
[Server actions](server-actions.md).

## Related

* [Backend and server actions](../architecture/backend.md)
* [The heartbeat](../operations/heartbeat.md)
* [Security model](../security/model.md)
