# First live run — one real loop, end to end

Every test in this repository runs against fakes we wrote. This runbook is the
first time the engine meets the real database, the real vendors and a real
inbox. Do it once, on a project with no customers on it, before anything is
emailed to a prospect.

**What "done" means:** one ICP → discovery finds real companies → one is
researched and scored → a draft is written → it is approved and **sent to an
address you own** → the reply you send back is read and classified.

Everything here is a step only you can do (accounts, keys, a mailbox). The
commands check each step.

---

## 0 · Which database

`apps/web/.env.local` points at `hnoycsbdddpmsivtmrws` (SETUP.md step 1). It
holds only the seeded `acme` workspace and your own login, and production
serves no customer today, so it is fine for this run. If that ever changes,
make a second Supabase project for this and point `.env.local` at it instead.

```bash
npm run db:doctor
```

Expected today: 0001–0047 `ok`, **0048, 0049, 0050 `MISSING`**.

## 1 · Apply the migrations

Through the ledger runner, not the SQL editor, so the path production uses is
the one that gets tested. The project was migrated by hand up to 0047, so the
first run records that as the baseline. The runner shells out to `psql`, which
this machine does not have, so run it from GitHub:

1. Repository → Settings → Secrets and variables → Actions: secret
   `DATABASE_URL` (Supabase → Connect → session pooler), variable
   `MIGRATIONS_BASELINE` = `0047`.
2. Actions → **Migrate database** → Run workflow, on the pass-15 branch.
3. Delete the `MIGRATIONS_BASELINE` variable.

(Locally instead: install the PostgreSQL client so `psql` is on the path, then
`DATABASE_URL=… MIGRATIONS_BASELINE=0047 npm run migrate --workspace @huntloop/db`.)

Then `npm run db:doctor`: everything `ok`. Run the workflow a second time; it
should apply nothing.

## 2 · Keys

Add to `apps/web/.env.local` (names in `.env.example`):

| Variable | Where | Needed for |
|---|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com | research, scoring, drafts |
| `APOLLO_API_KEY` | Apollo → Settings → API | discovery, people |
| `EMAIL_VERIFICATION_API_KEY` | ZeroBounce | verifying addresses (optional for this run) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud → OAuth client, redirect `http://localhost:3100/api/mailboxes/google/callback` | connecting the sending mailbox |

Set a low monthly credit limit on Apollo for this run.

```bash
npm run live-check
```

Free: proves each key is accepted. Then, once, the paid version — one small
call per vendor, a few cents:

```bash
npm run live-check -- --spend
```

**This is the step most likely to fail**, and that is the point of it: the
Apollo request shape has never been seen by the real API. A `FAIL` here is a
code fix, not a key problem — bring the output back.

## 3 · Run the app and the engine

```bash
npm run dev --workspace @huntloop/web
```

In a second terminal, the heartbeat, every minute (the value is `CRON_SECRET`
from `.env.local`):

```bash
while true; do curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3100/api/jobs/tick | head -c 300; echo; sleep 60; done
```

## 4 · The loop

1. **Settings:** set the organisation's postal address. Sends refuse without one.
2. **Settings → Integrations:** connect a Gmail account you own. A new mailbox
   warms up (10 sends on day one), and its domain is checked within a tick.
3. **Profiles:** create one narrow ICP.
4. **Discovery:** run it. Watch `/ops` — companies appear, then research and
   scores.
5. **Opportunities:** open one. Check the evidence links go where they say.
6. **Outreach:** the app has no recipient override, so make the recipient you.
   The engine picks the opportunity's primary contact, else the best person
   at the company with a sendable address. So use a company where you are the
   only person: **Companies → Add** one on a domain you own, **Imports** add
   yourself as its only person, and let it be researched and scored.
   Create a campaign at autonomy 0 with one email step, enrol that
   opportunity, and check the draft's *To* is your address before approving.
7. **Inbox:** within a tick or two it shows *Queued*, or *Waiting to send* with
   a reason (business hours, inbox freshness). Then *Sent*.
8. Reply to it from the address you own. After the next mailbox sync, the
   reply is in the inbox, classified, and the sequence has stopped.

## 5 · Bring back

- The `live-check --spend` output.
- Any step that did not happen, and what `/ops` and the tick output said.
- The cost screen's figures for the run.

Then production: the same keys in Vercel, `CRON_SECRET` and `HUNTLOOP_URL` on
GitHub, `DATABASE_URL` as a GitHub secret so `migrate.yml` applies 0048–0050
**before** the pass-15 branch is merged (Vercel deploys `main` on merge, and
the new code reads columns those migrations add).
