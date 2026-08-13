# Setup — the bits only you can do

Everything in here needs a human: a password, a click in someone else's
dashboard, or a decision. Nothing in this file can be done from code.

Work top to bottom. Each step says **why**, so if something looks wrong you can
tell whether it matters.

---

## Before you start

Open a terminal in the project folder and check the app still works:

```bash
npm run verify
```

That runs four things: types, lint, tests, build. It should end without errors.
If it doesn't, stop and say so — don't carry on top of a broken build.

---

## Step 1 — Decide which Supabase project to use

**This is the one that needs a real decision, and it's the riskiest step in
the file.**

Your `apps/web/.env.local` currently points at project
`hnoycsbdddpmsivtmrws`.

The build plan mentions you already run Supabase in production for another
product (TruChat). **If that is the same project, do not continue.** Running
Huntloop's migrations there would add about 40 tables, several new types, and
new security policies into a live database. That is very hard to undo.

Pick one:

- **Option A (recommended): make a brand-new project.** Go to
  [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
  Name it `huntloop-dev`. Choose a region near you. Save the database password
  somewhere safe — you cannot see it again later.
- **Option B: reuse the existing project**, but only if you are certain it is
  empty or Huntloop-only.

> **Why this matters:** migrations are not like editing a file. They change the
> shape of a live database, and there is no undo button.

---

## Step 2 — Copy four values into `.env.local`

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

In the Supabase dashboard:

1. Click **SQL Editor** in the left sidebar.
2. Click **New query**.
3. Open `packages/db/migrations/0001_identity.sql` in your code editor.
4. Select all of it, copy, paste into the SQL Editor, click **Run**.
5. It should say *Success*.
6. Repeat for the other four, **in this exact order**:
   - `0002_icp_sources_evidence.sql`
   - `0003_companies_opportunities.sql`
   - `0004_outreach_memory_learning.sql`
   - `0005_rate_limits.sql`

> **Don't skip `0005`.** It creates the counters that cap how many AI calls an
> organisation can make per hour. Without it, every analysis and every piece of
> company research is uncapped — and each one is a real, paid model call.

> **Why the order matters:** later files point at tables the earlier ones make.
> Run `0003` first and it fails, because the thing it references isn't there
> yet.

**If a step fails:** stop. Don't run the next one. Copy the red error message
and send it over. Half-applied migrations are much easier to fix immediately
than after three more have run on top.

---

## Step 4 — Check it worked

Restart the app:

```bash
npm run dev
```

Open <http://localhost:3100/acme/dashboard>.

**Before Step 3** there was an orange bar at the top saying *"Supabase is
connected, but the migrations haven't been applied yet."*

**After Step 3** that bar should be gone.

If it's gone, the tables exist and the app can see them. That's the whole test.

> The app deliberately tells you when it's showing pretend data. It will never
> show you made-up numbers without saying so.

---

## Step 5 — Make a login work

Right now nobody has an account.

1. Go to <http://localhost:3100/signup>
2. Type your email, click **Create account**
3. Check your inbox for a sign-in link and click it

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

Signing up creates a *user*. It does not create a *company* for that user to
belong to — so do that now.

Go to <http://localhost:3100/welcome> and follow the four steps:

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

## What still won't work after all this

Being straight with you, because a half-working thing that looks finished is
worse than a thing that says what it is:

| Thing | State |
|---|---|
| Creating an organisation | **Real.** Writes to the database once migrations are applied. |
| Signing in | **Real.** Magic link and Google both work. |
| Every other screen | Still shows **pretend data**. The tables are real but empty, and no code fills them yet. |
| Onboarding step 2 — your company | **Real, if you added an AI key.** A model reads your site and reports what it found, marking each answer as observed, concluded, or not established. Nothing is saved yet. |
| Onboarding steps 3–4 — ICP, sources | Real screens, fake brain. Nothing is generated, nothing is saved. |
| Finding companies | Not built. No code reads news, jobs, or GitHub. |
| Scoring, why-now, evidence | Not built. The shelves exist; nothing puts anything on them. |
| The AI chat on each opportunity | A shell. It says "not connected" and means it. |
| Sending email | Not built. |
| Everything else on the sidebar | Links that go nowhere yet. |

The full list is in [DELIVERY_PLAN.md](DELIVERY_PLAN.md).

---

## If you get stuck

Send:

1. Which step number you were on
2. The exact red error text (screenshot is fine)
3. What `npm run verify` says

**Never send:** the contents of `.env.local`, or anything labelled *secret* or
*service_role*.
