# Setup — the bits only you can do

Everything in here needs a human: a password, a click in someone else's
dashboard, or a decision. Nothing in this file can be done from code.

Work top to bottom. Each step says **why**, so if something looks wrong you can
tell whether it matters.

---

## Where this stands right now

Checked against your project on **2026-08-15**. Steps 1, 2 (partly), 3 (partly),
4 and 6 are already done. Re-check any time with:

```bash
npm run db:doctor
```

| Step | State |
|---|---|
| 1 · Which project | **Done.** `hnoycsbdddpmsivtmrws`, and it holds nothing but Huntloop — see the note in step 1 |
| 2 · Keys in `.env.local` | **Three of five.** URL, publishable and secret keys are set. `DATABASE_URL` and `ANTHROPIC_API_KEY` are empty |
| 3 · Create the tables | **`0001`–`0004` applied. `0005` and `0006` are not.** ← **this is the one thing blocking the AI features** |
| 4 · Check it worked | **Done.** No orange banner; the app reads real rows |
| 5 · Make a login work | **An account exists for `arpitcoding007@gmail.com`**, created by the seed. Sign in with a magic link — no password was ever set |
| 6 · Set up your organisation | **Done by the seed**, not by hand — `acme`, with three worked opportunities |
| 7 · CI | Runs on push. Branch protection still needs a repo admin |
| 8 · Enforce the CSP | Not started — needs a Sentry DSN first |

**Do step 3 first.** Until `0005_rate_limits.sql` is applied, every screen that
calls a model refuses. It refuses *politely* — "this feature is temporarily
unavailable" — and tells you why in Sentry, but it refuses, because the thing
that caps spending does not exist yet.

---

## Before you start

Open a terminal in the project folder and check the app still works:

```bash
npm run verify
```

That runs six things: types, lint, tests, the audit, the build, and the bundle
budget. It should end without errors. If it doesn't, stop and say so — don't
carry on top of a broken build.

---

## Step 1 — Decide which Supabase project to use

**Done — but read this once, because it was the riskiest step in the file.**

Your `apps/web/.env.local` points at project `hnoycsbdddpmsivtmrws`.

The build plan mentions you already run Supabase in production for another
product (TruChat). If that were the same project, running Huntloop's migrations
would have added about 40 tables into a live database, which is very hard to
undo.

**It is not.** The project was inspected before anything was written to it, and
every table in it belongs to Huntloop. If you ever point this repo at a
different project, do that check again first — `npm run db:doctor` lists what
is there.

<details>
<summary>If you do want a separate project instead</summary>

Go to [supabase.com/dashboard](https://supabase.com/dashboard) → **New
project**. Name it `huntloop-dev`. Choose a region near you. Save the database
password somewhere safe — you cannot see it again later. Then redo steps 2, 3
and 6 against it.

</details>

---

## Step 2 — Copy four values into `.env.local`

**Partly done.** Three of the four are already in `apps/web/.env.local`:
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and
`SUPABASE_SECRET_KEY`. **`DATABASE_URL` is the one still missing**, and it is
the one that lets a command line create tables — which is why step 3 is still a
copy-and-paste job.

In the Supabase dashboard for the project you chose:

1. Click **Project Settings** (the gear, bottom left).
2. Click **API**.
3. Copy these two:
   - **Project URL** → paste after `NEXT_PUBLIC_SUPABASE_URL=`
   - **`publishable` / `anon` key** → paste after
     `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=`
   - **`secret` / `service_role` key** → paste after `SUPABASE_SECRET_KEY=`
4. Now click **Database** (still under Project Settings).
5. Find **Connection string**, choose the **URI** tab.
6. Copy it → paste after `DATABASE_URL=`
7. In that pasted line, replace `[YOUR-PASSWORD]` with the database password
   from Step 1.

The file lives at `apps/web/.env.local`.

> **Why `DATABASE_URL` is separate:** the two keys talk to Supabase's web API,
> which can read and write rows but cannot *create tables*. Creating tables
> needs a direct database connection. That's this fourth value, and it's the
> one currently missing.

⚠️ **Never paste any of these into a chat, a ticket, or a screenshot.** The
`secret` key ignores all the security rules and can read every customer's data.

### And one more, for the AI

Huntloop's research runs on Claude. Without a key, the screens that use a model
work but show a labelled worked example instead of a real answer — they never
pretend otherwise.

1. Go to [console.anthropic.com](https://console.anthropic.com) → **API keys**
   → **Create key**
2. Paste it after `ANTHROPIC_API_KEY=` in the same `.env.local`

> **This one costs money**, unlike the Supabase keys on a free project.
> Researching one company is a few cents. There is no budget cap in the code
> yet — that is on the plan and not built — so treat the key as spendable and
> don't put it on a shared machine.

The same warning applies: never paste it anywhere.

---

## Step 3 — Create the tables

**`0001`–`0004` are already applied. You need to run `0005` and `0006`.**

Check for yourself first:

```bash
npm run db:doctor
```

It prints one line per migration and names any that are missing.

Then, in the Supabase dashboard:

1. Click **SQL Editor** in the left sidebar.
2. Click **New query**.
3. Open `packages/db/migrations/0005_rate_limits.sql` in your code editor.
4. Select all of it, copy, paste into the SQL Editor, click **Run**.
5. It should say *Success*.
6. Repeat for `0006_prune_schedule.sql`.

Then re-run `npm run db:doctor`. It should report all five applied.

> **`0005` is not optional.** It creates the counters that cap how many AI
> calls an organisation can make per hour, and the `consume_rate_limit()`
> function the app calls before every model call. Without it the app **refuses
> those calls** rather than making them uncapped — each one is a real, paid
> model call, and a spend cap that isn't there is not a cap.

> **Why the order matters:** later files point at tables the earlier ones make.
> Run `0003` first and it fails, because the thing it references isn't there
> yet. `0006` needs `prune_rate_limits()`, which `0005` creates.

**One extra check after `0006`.** Run this in the SQL editor:

```sql
select * from cron.job;
```

You should see a job named `prune-rate-limits`. That half of `0006` has never
been exercised by any test — the test database has no `pg_cron` — so this is
the only place it gets confirmed. If the list is empty, `0006` printed a notice
instead of scheduling, and the counter table will grow forever.

**If a step fails:** stop. Don't run the next one. Copy the red error message
and send it over. Half-applied migrations are much easier to fix immediately
than after another has run on top — which is exactly the state this project was
found in, and what `npm run db:doctor` now exists to catch.

---

## Step 4 — Check it worked

**Already true**, but here is the test.

Restart the app:

```bash
npm run dev
```

Open <http://localhost:3100/acme/opportunities>.

**Before Step 3** there was an orange bar at the top saying *"Supabase is
connected, but the migrations haven't been applied yet."*

**Now** that bar is gone and you should see three companies — Alphio AI,
Northwind Logistics, Cormorant Health — with priorities, scores and trigger
ages. Those are real rows, put there by `npm run db:seed`.

> The app deliberately tells you when it's showing pretend data. It will never
> show you made-up numbers without saying so. No banner means the numbers came
> from your database.

> **The banner cannot tell you about `0005`.** It reports whether the schema
> exists at all, and `0001`–`0004` were enough to satisfy it. That gap is what
> `npm run db:doctor` is for.

---

## Step 4b — The seeded data, and how to remove it

`npm run db:seed` writes one organisation (`acme`) with three worked
opportunities, chosen to exercise the states the interface has to tell apart:
a fresh trigger with a named decision maker, an older one with a contact but no
verified address, and a stale one with no buyer identified and several score
dimensions deliberately left unmeasured.

```bash
npm run db:seed                       # re-run any time; it replaces its own rows
npm run db:seed -- --reset            # remove the organisation and everything in it
npm run db:seed -- --slug other       # a second org, for testing the 404 guard
```

It touches nothing outside the organisation it names. `--reset` deletes that
organisation and lets the database's cascades remove the rest; it leaves the
login account alone, because that may be a real account.

**It is demonstration data, and it is not labelled as such inside the app** —
those rows look exactly like real ones, because that is what makes them useful
for checking the screens. Run `--reset` before you put real customers in.

---

## Step 5 — Make a login work

**An account already exists for `arpitcoding007@gmail.com`.** The seed created
it, marked the address confirmed, and made it the **owner** of `acme` — that
membership is what lets you see the seeded opportunities at all, because
without one the app answers 404 for every page under `/acme`.

**No password was ever set**, and there is no password field in this app by
design. To sign in:

1. Go to <http://localhost:3100/login>
2. Type `arpitcoding007@gmail.com`, click the button
3. Click the link in your inbox

If you would rather that account did not exist, delete it under
**Authentication → Users** in the Supabase dashboard and sign up normally
below. `npm run db:seed -- --reset` does *not* remove it — deleting someone's
login is not something a seed script should decide.

To create any other account:

1. Go to <http://localhost:3100/signup>
2. Type your email, click **Create account**
3. Check your inbox for a sign-in link and click it
4. Then run `npm run db:seed -- --email that@address` to join it to `acme`

**If no email arrives:** Supabase's built-in email sender only allows a few
messages per hour and often lands in spam. Check spam first. If it's still
missing, go to **Authentication → Providers** in the dashboard and confirm
**Email** is switched on.

**To make "Continue with Google" work** (optional):

1. Dashboard → **Authentication** → **Providers** → **Google** → toggle on
2. It asks for a Client ID and Secret. Get those from
   [console.cloud.google.com](https://console.cloud.google.com) →
   *APIs & Services* → *Credentials* → *Create OAuth client ID* → *Web
   application*
3. In Google, set the **Authorised redirect URI** to the callback URL Supabase
   shows you on that same Providers page
4. Paste the Client ID and Secret back into Supabase and save

### Sign-in rate limits — check these before going live

Sending a magic link is an unauthenticated action that causes an email to be
sent, so it needs a limit. **Supabase already enforces one**, which is why
there is no code for this in the repo — a second limiter in the app would
duplicate it and do a worse job, because a serverless function cannot reliably
identify the caller's IP.

Defaults worth knowing:

| | Default |
|---|---|
| Emails per hour (built-in sender) | **2** |
| OTP / magic links per hour, project-wide | 30 |
| Per-user window between requests | 60 seconds |
| Verification attempts per hour, per IP | 360 |

Adjust under **Authentication → Rate Limits**.

> **The one that will bite you.** The built-in email sender's limit of 2 per
> hour is unusable for real signups, so you will move to custom SMTP — and at
> that moment the email cap becomes *yours* to set. Set it deliberately when
> you do. The protection does not disappear loudly; it disappears by becoming
> whatever your SMTP provider's ceiling happens to be.

---

## Step 6 — Set up your organisation

**Already done for `acme`, by the seed.** This step is how you would make a
real one — and worth walking through once, because it is the flow your future
users see.

Signing up creates a *user*. It does not create a *company* for that user to
belong to. Go to <http://localhost:3100/welcome> and follow the four steps:

1. **Organisation** — type a name. Watch the URL preview underneath; that
   becomes your web address and can't be changed afterwards.
2. **Your company** — paste your website. Huntloop shows what it understood.
   Fix anything wrong; everything later is built on this.
3. **Ideal customer** — who to hunt for, what makes them ready to buy, and who
   is never a fit. All editable.
4. **Sources** — where to look. Remove any you don't want, add your own.

That's it. You land on the Command Center.

> **No SQL needed.** Earlier versions of this guide asked you to paste a query
> here; the sign-up screen now does it, running as *you* — so the same security
> rules that protect everything else apply to it too.

> **Nothing in steps 2–4 is saved yet.** The choices aren't written to the
> database; step 1 is the only one that is, once the migrations are applied.
> Step 2 now has a real brain if you added an AI key — a model actually reads
> your site — but the result lives only in the page you're looking at.

> **Why a 404 and not "access denied"** if you visit an org you're not in: if
> the app said *"that organisation exists but you can't see it"*, anyone could
> guess names and work out who your customers are. A 404 gives nothing away.

---

## Step 7 — Turn on CI (optional but worth it)

There's a file at `.github/workflows/ci.yml` that runs all the checks whenever
you push code.

It works automatically **if** your code is on GitHub. If it isn't yet:

1. Make an empty repository on GitHub — **private**
2. Follow the "push an existing repository" commands GitHub shows you
3. Push. Then look at the **Actions** tab — you should see the checks running

No secrets or setup needed. The tests use a pretend database that runs inside
the test itself.

---

## Step 8 — Turn the Content-Security-Policy on (after a week, not today)

The app already sends a full CSP with a per-request nonce. It ships in
**observation mode**: violations are reported and nothing is blocked. That is
deliberate, and the delay before enforcing it is the point of this step.

A wrong CSP does not fail loudly. It blocks one script on one route, the page
renders perfectly, and nothing responds to a click. So it watches first.

**Where the reports go.** Browsers POST them to `/api/csp-report`, which
forwards them to Sentry as warnings tagged `csp_directive`. No Sentry DSN means
no reports — set `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` first or this step
proves nothing.

**When to flip it.** After roughly a week of real use with no reports you did
not expect. Then set, in your hosting environment:

```bash
CSP_ENFORCE=true
```

**Before you flip it,** run the browser suite against an enforcing build — this
is the rehearsal, and it is the same check CI runs in observation mode:

```bash
CSP_ENFORCE=true npx playwright test e2e/csp.spec.ts
```

That suite asserts the things a static reading cannot: that the nonce reaches
Next's inline hydration scripts, that a real page renders with no violation,
and that the app still hydrates under the policy. It has already caught two
failures that looked fine on paper — statically prerendered pages cannot carry
a per-request nonce (which is why `app/layout.tsx` sets `force-dynamic`), and
`upgrade-insecure-requests` is ignored in report-only mode and warns about it
on every page load.

**If something breaks after enforcing**, unset `CSP_ENFORCE` and redeploy. You
are back to observation mode in one deploy, with the violation in Sentry
naming the directive.

---

## What still won't work after all this

Being straight with you, because a half-working thing that looks finished is
worse than a thing that says what it is:

| Thing | State |
|---|---|
| Creating an organisation | **Real.** Writes to the database. |
| Signing in | **Real.** Magic link and Google both work. |
| **The opportunity list and detail pages** | **Real.** They read your database — the join, the evidence, the triggers, the buyers. Verified against real rows in a browser, signed in. |
| The Command Center, analytics, sources | Still **demo figures**, and each says so. Those queries are not written. |
| **Anything that calls a model** | **Refused until `0005` is applied** — see step 3. After that, refused again unless `ANTHROPIC_API_KEY` is set, and it says which. |
| Onboarding step 2 — your company | **Real, if you add an AI key.** A model reads your site and reports what it found, marking each answer as observed, concluded, or not established. Nothing is saved yet. |
| Onboarding steps 3–4 — ICP, sources | Real screens, fake brain. Nothing is generated, nothing is saved. |
| Finding companies | Not built. No code reads news, jobs, or GitHub — the three opportunities you can see were seeded, not found. |
| Scoring, why-now, evidence | **Displayed, not generated.** The pages render them from the database faithfully; nothing yet computes them. |
| The AI chat on each opportunity | A shell. It says "not connected" and means it. |
| Sending email | Not built. |
| Everything else on the sidebar | Marked `SOON` rather than linked, so nothing leads to a dead end. |

The full list is in [DELIVERY_PLAN.md](DELIVERY_PLAN.md).

---

## If you get stuck

Send:

1. Which step number you were on
2. The exact red error text (screenshot is fine)
3. What `npm run verify` says

**Never send:** the contents of `.env.local`, or anything labelled *secret* or
*service_role*.
