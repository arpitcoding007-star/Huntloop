# How Huntloop Works — The Simple Guide

*Written so a 10-year-old can follow it. Everything here is true to how the real program is built — just told with pictures in your head instead of code.*

> **A note on honesty.** This guide describes what the code is built to do. Huntloop has never been switched on with its real "brains" and real data sources in the place I checked (no secret keys were present), so think of it as a **very well-built machine that has been tested with pretend parts but not yet run at full power.** I'll tell you where that matters.

---

## 1. The big idea: finding people who are thirsty

Imagine you run a **lemonade stand**. You don't want to shout at everybody on the street. You want to find the people who are **hot, thirsty, and have a dollar in their pocket — right now.**

That's what Huntloop does, but for **businesses that sell to other businesses.**

- You tell Huntloop what you sell and **who would love it.** (We call that your **"ideal customer."**)
- Huntloop goes looking for companies that match.
- It collects **proof** for why each company might need you *today*.
- It scores them, picks the best person to talk to, writes a friendly message, and (only if it's safe and you say OK) sends it.
- Then it watches what happens and **gets smarter.**

```
   You describe        Huntloop          Huntloop        Huntloop        Huntloop
   your dream     →    FINDS      →     COLLECTS    →    SCORES     →    WRITES &
   customer            companies         proof            them           SENDS
                                                                           │
        ▲                                                                  ▼
        └──────────────  LEARNS from what worked  ◄───────  WATCHES replies
```

That circle is why it's called a **loop**.

---

## 2. The cast of characters

Think of Huntloop as a **busy clubhouse** with different helpers:

| Helper | Real job in the code | Pretend job in the clubhouse |
|---|---|---|
| **The To-Do Board** | A table called `job_executions` | A big wall of sticky notes |
| **The Alarm Clock** | A timer that pokes the app every 5 minutes | Rings every 5 minutes: "Wake up!" |
| **The Worker** | The "runner" (`tick`) | A kid who grabs up to **5 sticky notes** and does them one by one |
| **The Hall Monitors** | "Sweepers" (14 of them) | They walk around, see what's due, and **write new sticky notes** |
| **The Quick Reader** | A small, fast AI (Haiku) | Skims newspapers quickly |
| **The Deep Thinker** | A big, careful AI (Opus) | Thinks hard about one company at a time |
| **The Phone Book** | Data companies (Apollo, Hunter, ZeroBounce) | Look up companies, people, and emails |
| **The Mail Carrier** | Gmail / Outlook connection | Delivers your messages |
| **The Vault** | The database (Postgres/Supabase) | Locked filing cabinet — **one drawer per customer** |

---

## 3. How the clubhouse stays busy: sticky notes and an alarm

Nothing in Huntloop runs "all the time." Instead:

1. **The alarm rings** every 5 minutes (a robot on the internet pokes Huntloop's secret door; it only opens for someone who knows the **password**).
2. **The Hall Monitors** walk around. "Is any newspaper due to be read? Any email waiting to go out? Any reply to check?" Each one writes sticky notes.
3. **The Worker** grabs **up to 5 sticky notes** and does them **one at a time** (it has about a minute total, then must stop).
4. Each note either **works**, or **fails**.
   - If it fails, the note goes back on the board with a *"try again later"* — waiting **1 minute, then 4, then 9…** (up to an hour). After **3 tries** it gives up.
   - If a note is *impossible* ("this web address doesn't even exist"), it's marked failed right away so nobody wastes time.
   - If the Worker falls asleep mid-job, after **10 minutes** the note is put back for someone else.
5. **Two sticky notes for the same thing?** The board is smart — it says "already have that one!" so work isn't done twice.

```
  ⏰ every 5 min
   │
   ▼
 Hall Monitors write notes ──► 📋 Sticky-note board ──► 🧒 Worker takes 5, one by one
                                      ▲                         │
                                      └──── failed? put back ◄──┘
                                            (wait longer each time)
```

> **Honest limit:** one worker doing 5 notes every 5 minutes is *slow*, like one cashier for a huge store. It's fine for a few customers; it would need to be upgraded for lots.

---

## 4. Step by step: from "who is your dream customer?" to "message sent"

### Step 1 — Tell Huntloop about you (onboarding)
You give your website. A big AI reads it and **drafts** your ideal customer: *what industries, how big, what country, what problems you solve.* **You can fix anything it got wrong.**

You also pick **sources** — like newspapers, blogs, or feeds where news about those companies shows up.

### Step 2 — Finding companies (two ways)

**Way A — Ask the Phone Book.** Huntloop turns your ideal-customer description into a **search**, and asks a data company (like Apollo): *"Give me 25 companies like this."* It reads up to **5 pages**, and has a **spending limit** (credits) so it can't blow your money. Every company it gets is sorted into a pile:

- ✅ **new** — never seen before
- 🔁 **matched** — we already have it
- 🚫 **excluded** — you said "never these" (and it tells you *which rule* said so)
- 🛑 **suppressed** — on the "do not contact" list
- ❓ **invalid** — no usable website

Nothing is silently thrown away.

**Way B — Read the newspapers.** Every so often (you choose how often; once a day is the default) Huntloop **visits each source** you gave it:

1. It first checks the web address is **safe** — it will **never** be tricked into peeking at private/internal addresses (it's like a bouncer who checks *twice*, even right at the door).
2. It downloads the page (small and quick: 15 seconds, 4 megabytes max).
3. It figures out if it's an RSS feed, or a normal web page, and pulls out the articles.
4. Brand-new articles go to **the Quick Reader**, which writes down **"signals"** — like *"Company X just raised money"* or *"Company Y is hiring 10 engineers."* It must point to the exact words in the article, so it can't make things up.
5. A "signal" with a **date** (like a funding announcement) becomes a **trigger** — a reason to talk *now*. No date = no trigger, because something with no date could look "fresh" forever, and that would be cheating.

### Step 3 — Understanding each company (research)
**The Deep Thinker** reads the company's own website and writes down what it learned: *what they sell, who they sell to, what problems they might have.* Every note is labeled:

| Label | Kid version |
|---|---|
| **Fact** | "I saw it with my own eyes — here's where." (Must show the link!) |
| **Inference** | "I'm guessing, based on clues." |
| **Unknown** | "I honestly don't know." (Never pretends to be sure!) |

> A fact that isn't from the company's own website gets **downgraded to a guess**. Huntloop is strict about honesty.

### Step 4 — Scoring: the report card
Now the Deep Thinker grades the company against **your** ideal customer on **8 school subjects:**

1. Is it the **right type** of company? *(ICP fit)*
2. How **big is their problem**?
3. How **strong is our proof**?
4. How **strong** is the trigger (the "why now")?
5. How **fresh** is the trigger?
6. How **likely** are they to buy?
7. How well does **our product fit**?
8. Can we **reach** the decision-maker?

Each subject is a number from 0 to 100 — **or "unknown."** *Unknown is NOT zero.* Zero would mean "we checked and it's terrible." Unknown means "we haven't found out." Huntloop never mixes those up.

The whole thing gets a **single score (0–100)** and one of four labels, like a campfire:

| Label | Meaning | Picture |
|---|---|---|
| 🔥 **HOT** | Great match, big pain, **and** something just happened | Roaring fire — go now! |
| 🟠 **WARM** | Good match | Cozy fire |
| 👀 **WATCH** | Not enough proof yet | Just a spark — keep an eye |
| ⛔ **IGNORE** | Not a fit | Cold ashes |

**A safety check:** the AI is **not allowed** to say HOT unless it actually figured out the match, the pain, *and* the trigger. If it tries, Huntloop says "no, that doesn't add up" and throws the answer out.

### Step 5 — Your house rules
You (or the AI, with your OK) can add **rules**:
- ➕ **"Add 10 points if they use Salesforce."**
- ⬆️ **"Treat anyone in healthcare as at least WARM."**
- ⛔ **"NEVER consider companies with fewer than 5 people."** (a "veto")

These run *after* the AI, in plain math — no guessing — and Huntloop keeps a **receipt** of exactly which rules fired. Rules can't be crazy: each can change the score by **at most ±40**.

### Step 6 — Who should we talk to?
Companies have many people. Huntloop gives each person a **mini score**:

- **Skip** anyone who **left** the company, or whose title you said to avoid.
- Does their **job title** match the kind of person who buys? *(counts 3×)*
- Are they **senior enough**? *(2×)* Right **department**? *(2×)*
- Do we have a **trustworthy email**? *(counts a lot)* Was it **checked recently**?

Someone scoring **70 or more** is marked a **decision-maker.** The best one becomes the main contact — **unless a human already picked someone**, because Huntloop never overrules a person's decision.

### Step 7 — Writing the message
**The Deep Thinker** writes a short email (under about 150 words) using only **real proof it found**, in **your** voice, and it must say which proofs it used. It **may not name competitors** it isn't allowed to mention. If it breaks a rule, the email is rejected.

### Step 8 — Sending — the safety checklist ✅
Before **any** email leaves, Huntloop goes through a checklist, like an airplane pilot:

- [ ] Was this email **approved** by a person (or is autonomy turned up)?
- [ ] Is it going to **one** real email address? (No sneaky lists.)
- [ ] Is this person on the **"do not contact"** list — or did they ask to be **erased**?
- [ ] Have we emailed them **too recently**? (Waits between emails; a **monthly cap per person**.)
- [ ] Has the company hit its **daily limit**?
- [ ] Is there a working **"unsubscribe" link**?
- [ ] Does the email have the company's **real postal address** (required by law)?
- [ ] Is there **email allowance left** this month?
- [ ] Does the **mailbox** still have sending room today?

Then comes the cleverest part: Huntloop **stamps the email "send attempted"** *before* hitting send. If something crashes halfway, it will **never** send a second time on a guess. It stops and says "Check your Sent folder." It's better to send **zero** than **two**.

### Step 9 — Reading the replies
Huntloop checks the inbox. A small, fast AI sorts each reply into a bin:

| Bin | What happens |
|---|---|
| 😀 **Positive** | Stop the sequence, tell a human! |
| 😐 **Neutral** | Keep going |
| 🙅 **Not interested / wrong person** | Stop |
| ✋ **"Unsubscribe me"** | Stop **and** never email them again |
| 🌴 **Out of office** | Wait; it's a robot, not a real answer |
| 📭 **Bounce** (bad address) | Stop, mark the address bad |

### Step 10 — Learning (the coach watches the game)
After enough results (**at least 8 real things happened**, over about 90 days), the Deep Thinker looks at *what worked and what didn't*, plus *the times a human disagreed with Huntloop*. It suggests up to 10 **ideas** ("Companies hiring salespeople reply more"). **A human approves each idea one by one** — only then does it become a new rule. If there isn't enough to learn from, it says **"not enough yet"** and spends nothing.

It also notices **your writing style** — if you shorten its emails 3 times the same way, it learns to write shorter.

---

## 5. Keeping everyone's stuff private

Huntloop serves **many companies** at once. Each company's information is in its **own locked room**:

1. The front door checks who you are.
2. If you try to open a room that isn't yours, the answer is **"doesn't exist"** — not "forbidden" (so nobody can even *guess* who the customers are).
3. The most important lock is **inside the database itself**: even if the app had a bug, the database still refuses to hand over someone else's data.
4. The passwords to people's email accounts are stored **scrambled** (strong encryption).

---

## 6. Things Huntloop will NOT do (on purpose)

- ❌ It won't make up proof. Unknown stays **unknown**.
- ❌ It won't pretend it has an AI key when it doesn't — it shows an example **clearly labeled as an example**.
- ❌ It won't spend more money than the limit you set.
- ❌ It won't email someone on the "do not contact" list — ever.
- ❌ It won't send the same email twice by accident.
- ❌ It won't change a decision you made by hand.
- ❌ It won't visit private internet addresses.

---

## 7. What's not finished or not proven (the honest list)

| Thing | What it means in plain words |
|---|---|
| **Never run "for real"** | The AI, the data companies and Gmail/Outlook were tested with *pretend* versions, not real ones. So it's a car that passed every test on the stand, but hasn't driven on a road yet. |
| **Three helpers have no one to call them** | `enrich_person`, `resolve_entity`, `purge_contact_data` exist, but nothing ever puts their sticky note on the board. So **finding extra contact details for a person**, **spotting duplicate companies that look a bit different**, and the **automatic "erase this person" job** don't start by themselves. |
| **Slow worker** | 5 jobs every 5 minutes, one at a time, for *all* customers. |
| **One Phone Book per kind of lookup** | If the data company is down, there's no backup company to ask. |
| **Scores are an AI's opinion** | It's carefully checked for consistency, but there's no "answer key" proving the scores are right. |
| **Learning is a small-sample read** | It's an AI looking at a few results, not a math test — which is why a human approves each idea. |
| **No payments** | Plans exist (Free, Growth, Scale) but there is no way to pay yet. |
| **Setup by hand** | The database updates are applied manually; notes in the setup file were behind the actual code when I checked. |

---

## 8. Glossary — hard words, easy meanings

| Word | Easy meaning |
|---|---|
| **ICP** (Ideal Customer Profile) | A description of the *perfect customer* — "small online shops in Canada". |
| **Opportunity** | A company that might become a customer, plus all the proof about it. |
| **Lead** | An old word for a name on a list. Huntloop prefers "opportunity" because it comes with proof. |
| **Evidence** | A fact, guess, or "don't know" with a link showing where it came from. |
| **Trigger** | A dated event (like raising money) that makes *now* a good time. |
| **Signal** | A hint found in an article. |
| **Score** | A 0–100 number showing how good a match a company is. |
| **Priority** | Hot / Warm / Watch / Ignore label. |
| **Rule** | Something *you* tell Huntloop — adds, subtracts, or blocks. |
| **Veto** | A rule that says "NEVER." |
| **Persona** | A type of person you want to reach ("Head of Sales"). |
| **Decision-maker** | The person who can say "yes, let's buy." |
| **Enrichment** | Filling in missing details (size, industry, email) from a data company. |
| **Provider** | A company that sells data (like Apollo). |
| **Credits** | The "coins" a data company charges per lookup. |
| **Cache** | A saved answer, so we don't pay twice for the same question. |
| **Circuit breaker** | If a service keeps failing, we stop calling it for a bit — like turning off a faulty toaster. |
| **Queue** | A line of waiting jobs (the sticky-note board). |
| **Job** | One sticky note — one small piece of work. |
| **Sweeper** | A hall monitor job that finds what's due and creates more jobs. |
| **Tick** | One round of the alarm clock + worker. |
| **Idempotent** | "Doing it twice is just as good as doing it once." |
| **Model / AI** | The smart text-writing program (here: Claude). |
| **Prompt** | The instructions given to the AI. |
| **RSS feed** | A page that lists a website's latest articles for computers to read. |
| **Suppression list** | The "do not contact" list. |
| **Unsubscribe** | A link that lets people stop getting emails. |
| **Bounce** | An email that couldn't be delivered. |
| **Autonomy level** | How much Huntloop may do without asking (0 = ask for everything). |
| **Tenant** | One customer company using Huntloop. |
| **RLS** (Row Level Security) | A database rule: "you only see your own rows." |
| **Encryption** | Scrambling a secret so only the right key can read it. |
| **SSRF guard** | The bouncer that stops Huntloop being tricked into visiting private addresses. |
| **Migration** | An update to the shape of the database. |

---

## 9. One picture to remember

```
 YOU ──► describe dream customer
            │
            ▼
   ┌────────────────────┐        ┌───────────────────┐
   │ Ask Phone Book     │        │ Read newspapers   │
   │ (find companies)   │        │ (find news)       │
   └─────────┬──────────┘        └─────────┬─────────┘
             └──────────────┬──────────────┘
                            ▼
                 Research each company  (Fact / Guess / Unknown)
                            ▼
                 Report card  (8 subjects → score → 🔥🟠👀⛔)
                            ▼
                 Your house rules  (+, floor, NEVER)
                            ▼
                 Pick the best person to contact
                            ▼
                 Write a short, honest message
                            ▼
                 SAFETY CHECKLIST  ──► (stop if any ✗)
                            ▼
                 Send  ─► read replies ─► sort them
                            ▼
                 Learn what worked  ─► human approves ─► better next time ↺
```

*Want the nerdy version? See `HUNTLOOP_ENGINE_EXPLAINED.md`. Want all the diagrams? See `HUNTLOOP_ENGINE_ARCHITECTURE.md`.*
