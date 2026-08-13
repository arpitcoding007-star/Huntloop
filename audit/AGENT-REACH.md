# Agent Reach — what still needs a human

Answering: *"After providing this repository, what will still require manual
input or approval?"*

Source: [github.com/Panniantong/Agent-Reach](https://github.com/Panniantong/Agent-Reach),
read 2026-08-13. Platform and auth details below come from that project's own
documentation and are treated as claims about it, not verified behaviour.

---

## Read this first — three corrections

The checklist you supplied is a reasonable list of things a SaaS needs. But
three of its assumptions don't survive contact with what Agent Reach actually
is, and getting these wrong would cost weeks.

### 1. It is a *read* tool, not an outreach tool

Despite the name, Agent Reach does not send anything. Its own description is
about giving an agent "eyes to see the entire internet" — it reads and searches
web pages, YouTube subtitles, RSS, GitHub, Twitter/X, Reddit, Bilibili,
Instagram, Facebook, and XiaoHongShu.

For Huntloop that is genuinely useful, but for a **different phase** than the
name suggests:

| Huntloop phase | Fit |
|---|---|
| **SIGNAL** — scanning sources for triggers (§10, §33) | Strong. This is what the tool does |
| **CONTEXT** — research a company before qualifying | Strong |
| INTENT / OPPORTUNITY — qualification, scoring | No. Already built in `packages/ai` |
| **Outreach — sending** | **None. It does not send messages** |

The outreach half of Huntloop's loop — mailboxes, sequences, sending, reply
classification — is unaffected by this integration. `.env.example` already
reserves `GOOGLE_CLIENT_ID` / `MICROSOFT_CLIENT_ID` for that, and it remains a
separate piece of work.

### 2. Two platforms on your list aren't supported

**LinkedIn** and **WeChat** appear in your checklist but not in Agent Reach's
platform table. LinkedIn in particular is the one most sales tools want and the
one most aggressively defended against automation. Plan for it separately, or
not at all.

Supported, and what each needs:

| Platform | Auth | Human needed? |
|---|---|---|
| Web pages (Jina Reader) | None | No |
| YouTube (yt-dlp) | None | No |
| RSS | None | No |
| Bilibili — search/info | None | No |
| GitHub | `gh` CLI or a personal token | **Yes** — one-time |
| Twitter/X | Cookie export via Cookie-Editor | **Yes** — recurring |
| XiaoHongShu | Cookie export, or OpenCLI | **Yes** — recurring |
| Reddit | Desktop browser session | **Yes** — recurring |
| Facebook | Desktop Chrome session | **Yes** — recurring |
| Instagram | Desktop Chrome session | **Yes** — recurring |
| Global search (Exa) | API key | **Yes** — one-time, optional |

Most of the value — web pages, RSS, YouTube, GitHub — needs little or nothing.
The zero-config sources are also the ones that map best onto Huntloop's
existing `sources` table (`kind: news | blog | jobs | …`).

### 3. **It cannot run inside this app as deployed.** This is the big one.

Agent Reach is a **Python 3.10+ CLI** that shells out to other CLIs, drives a
desktop browser, and keeps state in `~/.agent-reach/config.yaml`.

Huntloop is a **Next.js app on Vercel**. Every one of those requirements is
incompatible with it:

| Agent Reach needs | Vercel provides |
|---|---|
| Python 3.10+ runtime | Node. No Python in this repo at all |
| Persistent `~/.agent-reach/config.yaml` (chmod 600) | Ephemeral filesystem, wiped per invocation |
| A logged-in desktop Chrome | No display, no browser, no persistent session |
| Long-running processes | Serverless functions with execution limits |
| Shelling out to `gh`, `yt-dlp`, `bili-cli` | Not installed, not installable at runtime |

So "the AI will install and configure most of the tooling" is true of a
developer's machine and false of your deployment. **No amount of configuration
makes this run on Vercel.**

To use it in the product you need a **separate persistent worker** — a VPS or
container running Python, Agent Reach, its CLI dependencies, and a headless (or
headful) browser, talking to Huntloop over a queue or an authenticated
endpoint. That worker is real infrastructure this repo does not currently have.
Note that `audit/FINDINGS.md` records **REPO-05** — no Docker, deliberately,
because there was nothing to containerize. This integration is the thing that
changes that.

There is a much cheaper option worth considering first: **use Agent Reach as a
developer tool, not a product component.** Run it locally to prototype what
signal extraction should look like, then implement the handful of sources you
actually need directly in `packages/ai` using the existing `web_fetch`
allow-list mechanism (`client.ts`), which is already built, already tested, and
already prompt-injection hardened (`untrusted.ts`). Only stand up the worker if
you need the cookie-authenticated platforms.

---

## Before you touch any of this: the cookie question

This is a product and legal decision, and it should be made **before** any
engineering, because the answer changes the architecture.

Cookie-based access means holding a **live session token for a third-party
account**. Two very different models:

**(a) Huntloop's own accounts.** One set of company-controlled logins, scraping
on behalf of all tenants. Simpler, one place to secure, and the rate limits and
bans land on you.

**(b) Each customer's accounts.** You store your customers' Twitter, Reddit,
Facebook, and Instagram session cookies in your database.

If you choose (b), understand what you are taking on:

- A session cookie is **equivalent to the password** for the duration of its
  life. Your breach blast radius becomes your customers' social accounts.
- Those platforms' terms of service generally prohibit automated access and
  credential sharing. Accounts get banned — your customers' accounts.
- Cookies expire. Every customer re-exports cookies from a browser extension
  every few weeks, forever. That is an onboarding step most B2B buyers will
  refuse.
- It is very likely in scope for whatever compliance regime you eventually face.

If you do proceed with (b), the storage must be encrypted at rest with a key
that is **not** in the same database (envelope encryption via KMS), with a
rotation and revocation path, and it must never be readable through RLS by
anything but the job that uses it. That is a meaningful project, not a column.

**Recommendation:** start with the zero-auth sources. They cover most of what
Huntloop's `sources` table actually needs, and they carry none of this.

---

## The manual checklist, scoped to reality

Reorganised by *when* you need it, with items your list included that are not
actually Agent Reach concerns marked as such.

### A. Needed to evaluate Agent Reach at all — half a day

Local, on a developer machine. Nothing touches production.

- [ ] Python 3.10+ installed
- [ ] Run the install, then `agent-reach doctor`
- [ ] Confirm the zero-auth sources return something useful for a real target company
- [ ] **Decision:** is this a product component, or a prototyping tool? (see above)

### B. Needed if it becomes a product component

**Infrastructure — all new, none of it exists today**

- [ ] VPS or container host (Fly.io, Railway, Hetzner, ECS — anything that is not serverless)
- [ ] Dockerfile for the worker: Python + Agent Reach + `gh`, `yt-dlp`, `bili-cli` + browser
- [ ] Job queue between Huntloop and the worker. `.env.example` already reserves
      `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` — the durable job runner named
      in the plan and not yet built
- [ ] Authenticated endpoint or queue credentials, so the worker can write results back
- [ ] Monitoring for the worker (it will fail; `sources.status` already models
      `ok | degraded | unavailable` and `failure_count`, so the schema is ready)
- [ ] Deployment credentials, DNS, SSL, reverse proxy — only if self-hosting

**Accounts and keys**

- [ ] GitHub personal access token or `gh` auth, on the worker
- [ ] Exa API key (optional — only for global search)
- [ ] Per-platform cookies, *only* for the platforms you decided to support

**Product decisions — make these before building**

- [ ] Company accounts or customer accounts? (the section above)
- [ ] Which platforms are actually in scope for your ICP?
- [ ] Cookie refresh UX — who is prompted, how often, and what breaks meanwhile
- [ ] Where scraped content sits in the `fact / inference / unknown` model.
      **Non-negotiable given §7:** a scraped page is a source, so claims from it
      are facts *with a source URL*; anything the model concludes from it is an
      inference. The existing `claims.ts` validator already enforces this —
      route Agent Reach output through it rather than around it
- [ ] Rate-limit and backoff policy per platform

**Security — before any cookie is stored**

- [ ] Envelope encryption for cookies, key outside the database
- [ ] Rotation and revocation path
- [ ] Confirm no scraped content can reach a tool that acts. `untrusted.ts`
      documents this as the actual defence against prompt injection, and it is
      the property most likely to be lost when a new content source is bolted on

### C. Not Agent Reach concerns

These are on your checklist but unrelated to this integration. They belong in
the [main backlog](BACKLOG.md), and several already have entries there.

| Item | Where it actually belongs |
|---|---|
| Payment gateway (Stripe) | Product work. Keys reserved in `.env.example`, nothing built |
| Analytics / monitoring / error tracking | **ANL-01a / ANL-01b**, already P0/P1 |
| Push notifications | Not in the plan at all |
| Email provider | The outreach half of the loop — separate from this |
| Database credentials, CDN, domain | Already covered by `SETUP.md` |
| Pricing model, user roles, permission model | Roles exist and are enforced in RLS (`owner`/`admin`/`member`/`viewer`); the UI doesn't read them — **FEAT-04** |
| Content moderation rules | No user-generated content surface exists |
| User onboarding flow | Built. Four steps, working — see `app/(onboarding)` |
| Google / social login, OAuth | **Already done.** Magic link + Google OAuth are live |

---

## Recommended sequence

1. **Evaluate locally** (½ day). Install it, point it at three companies in your
   ICP, and judge whether the output is better than what `research_company`
   already produces with `web_fetch`. It may not be.
2. **Decide the cookie question.** Company accounts, customer accounts, or
   zero-auth only. Everything downstream depends on this.
3. **If zero-auth is enough** — and it may well be — skip the worker entirely.
   Implement those sources in `packages/ai`, reusing the allow-list and
   untrusted-content handling that already exist and are already hardened.
4. **If you need authenticated platforms**, build the worker properly: queue,
   container, encrypted secrets, monitoring. Treat it as its own project, and
   run [Phase 5](README.md#phase-5--security) of the audit against it before it
   touches production data.

**Do not** start at step 4. The most likely outcome of this evaluation is that
the zero-auth sources cover your needs, and the honest answer to "what do I
still need to provide manually?" turns out to be *a GitHub token and an
afternoon* — rather than the infrastructure programme the full checklist implies.
