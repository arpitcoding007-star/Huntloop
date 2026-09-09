Below is a **clean, copy-paste-ready Markdown document** you can give directly to Claude. I removed ChatGPT-specific citations and turned it into a proper Huntloop product/implementation brief.

````markdown
# Huntloop vs Explee / AutoGTM
## Full Product, Feature, UX, Architecture, and Implementation Comparison

## Purpose

Use this document as a product and implementation reference for Huntloop.

The goal is **NOT** to clone Explee.

The goal is to:

> Take the best simplicity, workflow design, automation patterns, and UX ideas from Explee and combine them with Huntloop's stronger intelligence, evidence, explainability, qualification, learning, and human-control architecture.

The desired result is:

> **Explee-level simplicity + Huntloop-level intelligence.**

---

# 1. Core Product Difference

## Explee

Explee essentially follows:

```text
Website
↓
Research company
↓
Research competitors
↓
Create customer segments
↓
Find companies
↓
Find decision makers
↓
Find/verify emails
↓
Write personalized emails
↓
Send outreach
↓
Handle replies
↓
Book meetings
↓
Learn what works
↓
Scale successful campaigns
````

Its product is primarily a highly automated GTM machine.

---

## Huntloop

Huntloop's intended loop is deeper:

```text
Discover
↓
Qualify
↓
Enrich
↓
Reach Out
↓
Track
↓
Learn
```

Or more practically:

```text
Find
↓
Understand
↓
Prioritize
↓
Act
↓
Learn
```

Huntloop's central question should remain:

> **Who should I pursue next, why are they a good fit, and what should I do about it?**

The important difference is:

### Explee

Focuses heavily on getting leads into outreach automatically.

### Huntloop

Should focus on identifying and explaining **qualified opportunities**.

Huntloop should therefore NOT become another generic lead database.

---

# 2. Strategic Product Position

The target Huntloop should become:

```text
Explee simplicity
+
Huntloop evidence
+
Huntloop explainable ICP scoring
+
Huntloop prospect intelligence
+
Huntloop signals
+
Huntloop contact intelligence
+
Huntloop outreach recommendations
+
Huntloop human control
+
Huntloop outcome learning
```

Do not simply recreate Explee.

Use Explee as a UX and workflow reference while preserving Huntloop's stronger product philosophy.

---

# 3. Master Comparison Table

|  # | Area                   | Explee                        | Huntloop                                   | Winner / Advantage     | Huntloop Action                          |
| -: | ---------------------- | ----------------------------- | ------------------------------------------ | ---------------------- | ---------------------------------------- |
|  1 | Core product           | Autonomous GTM platform       | Opportunity intelligence platform          | Different              | Keep Huntloop philosophy                 |
|  2 | Main promise           | Generate leads and meetings   | Tell me who to pursue, why, and what to do | Huntloop strategically | Keep as north star                       |
|  3 | Unit of value          | Lead / prospect / meeting     | Qualified opportunity                      | Huntloop               | Do not reduce Huntloop to leads          |
|  4 | Main workflow          | Very linear                   | More modular                               | Explee UX              | Create a guided linear first-run journey |
|  5 | Automation             | Heavy autopilot               | Human-controlled intelligence              | Depends                | Support both eventually                  |
|  6 | First input            | Website/domain                | ICP/company/product setup                  | Explee                 | Add domain-first onboarding              |
|  7 | Setup friction         | Extremely low                 | Higher                                     | Explee                 | Auto-generate defaults                   |
|  8 | Time to value          | Fast                          | Potentially slower                         | Explee                 | Target value within 1–2 minutes          |
|  9 | Company understanding  | Automatic                     | Deep org/product knowledge                 | Huntloop depth         | Preserve Huntloop memory system          |
| 10 | Company description    | Automatically generated       | Supported                                  | Tie                    | Generate automatically                   |
| 11 | Keywords               | Visible                       | Can be inferred                            | Explee UX              | Show editable keywords                   |
| 12 | Website onboarding     | Central                       | Less central                               | Explee                 | Add website-first path                   |
| 13 | No website path        | Available                     | Could support                              | Explee UX              | Add manual-description path              |
| 14 | Progressive onboarding | Excellent                     | Less linear                                | Explee                 | Make each step feed the next             |
| 15 | Progress navigation    | 1 → 6 stages                  | Less explicit                              | Explee                 | Add workflow rail                        |
| 16 | Persistent context     | Left sidebar remembers funnel | More app-like                              | Explee                 | Add persistent journey/sidebar           |
| 17 | Future-step visibility | Shows what happens next       | Less explicit                              | Explee                 | Show upcoming steps                      |

---

# 4. Company Research Comparison

| Capability                      | Explee                 | Huntloop                   | Recommended Huntloop Direction  |
| ------------------------------- | ---------------------- | -------------------------- | ------------------------------- |
| Understand company from website | Yes                    | Yes / capable              | Make automatic                  |
| Generate company summary        | Yes                    | Yes                        | Show prominently                |
| Extract product/services        | Yes                    | Yes                        | Store as organization knowledge |
| Extract keywords                | Yes                    | Possible                   | Display/editable                |
| Understand positioning          | Yes                    | Deeper potential           | Preserve evidence               |
| Remember organization context   | Basic visible behavior | Strong memory architecture | Huntloop advantage              |
| URL ingestion                   | Website research       | Explicit memory ingestion  | Keep                            |
| File ingestion                  | Not central            | Supported                  | Keep                            |
| Organization voice              | Not obvious            | Supported                  | Major Huntloop advantage        |
| Evidence/source tracking        | Minimal visible        | Core Huntloop concept      | Keep and expose                 |
| Human correction                | Limited visible        | Designed                   | Make easy                       |

---

# 5. Competitor Discovery

Explee has a dedicated competitor-research stage.

This should be adopted into Huntloop.

## Explee behavior

After understanding the company it:

1. Determines product/category.
2. Generates search queries.
3. Finds competitors.
4. Displays competitors.
5. Uses them to understand the market.
6. Uses market understanding to create potential customer segments.

## Huntloop version should be better.

A Huntloop competitor object should contain:

```text
Competitor
├── Name
├── Domain
├── Description
├── Product category
├── ICP
├── Pricing if available
├── Positioning
├── Key differentiators
├── Customer examples
├── Signals
├── Source evidence
└── Confidence
```

### Comparison

| Capability                            | Explee       | Huntloop         | Winner              |
| ------------------------------------- | ------------ | ---------------- | ------------------- |
| Competitor discovery                  | Excellent UX | Capable          | Explee UX           |
| Competitor list                       | Yes          | Can support      | Explee presentation |
| Competitor evidence                   | Limited      | Strong potential | Huntloop            |
| Competitor profiles                   | Basic        | Can be deep      | Huntloop            |
| Search queries shown                  | Yes          | Less visible     | Explee              |
| Source-backed competitor intelligence | Limited      | Core philosophy  | Huntloop            |

### Action

Create a dedicated Huntloop step:

```text
Research Market
```

or

```text
Explore Competitors
```

Do not bury competitor research inside generic AI output.

---

# 6. ICP and Campaign Generation

This is one of Explee's strongest UX ideas.

It automatically turns market understanding into possible campaigns/customer segments.

Examples from the supplied Explee flow included:

```text
NFT Project Founders
DAO Operators
Token Launch Teams
Web3 Startups
Creator Brands
Blockchain Ventures
```

Each segment contains meaningful information rather than just a label.

## Huntloop should generate an ICP hypothesis card containing:

```text
ICP / Segment Name

Who they are
Why they may buy
Problem / pain
Buying trigger
Qualification criteria
Disqualification criteria
Example companies
Relevant signals
Estimated market size
Confidence
Evidence
Recommended outreach angle
```

---

# 7. ICP Comparison Table

|  # | Feature                  | Explee          | Huntloop               | Winner              | Huntloop Action                 |
| -: | ------------------------ | --------------- | ---------------------- | ------------------- | ------------------------------- |
|  1 | ICP definition           | Yes             | Core capability        | Huntloop            | Keep depth                      |
|  2 | Automatic ICP generation | Excellent       | Possible               | Explee UX           | Make first-class                |
|  3 | Multiple segments        | Yes             | Supported              | Tie                 | Auto-create options             |
|  4 | Segment names            | Yes             | Yes                    | Tie                 | Keep                            |
|  5 | Segment pain             | Visible         | Can infer              | Explee presentation | Make explicit field             |
|  6 | Criteria                 | Visible bullets | Deeper rule system     | Huntloop            | Display simplified rule summary |
|  7 | Example companies        | Yes             | Supported              | Tie                 | Add examples                    |
|  8 | Market-size estimate     | Yes             | Less visible           | Explee              | Add estimate                    |
|  9 | Fit scores               | Yes             | Explainable scoring    | Huntloop            | Expose score                    |
| 10 | Rule scoring             | Limited         | Strong                 | Huntloop            | Keep                            |
| 11 | AI/model score           | Limited visible | Supported              | Huntloop            | Combine with rules              |
| 12 | Rule trace               | Not visible     | Supported              | Huntloop            | Build UI                        |
| 13 | Explainability           | Basic           | Core                   | Huntloop            | Major differentiator            |
| 14 | Human correction         | Less obvious    | Core principle         | Huntloop            | Easy edit/correction            |
| 15 | Evidence                 | Minimal         | Core                   | Huntloop            | Add source drawer               |
| 16 | Unknown facts            | Not emphasized  | Supported conceptually | Huntloop            | Explicitly show uncertainty     |
| 17 | Confidence               | Limited         | Intended               | Huntloop            | Surface confidence              |
| 18 | Lookalikes               | Yes             | Can support            | Tie                 | Add "Find more like this"       |

---

# 8. Company Discovery

## Explee

Explee takes a selected segment and produces a large company table.

Fields shown include:

```text
Company
Description
Location
Size
Monthly Traffic
Traffic Change
```

This is a very good browsing interface.

---

## Huntloop Should Add More Intelligence

A Huntloop company row should ideally contain:

```text
Company
Domain
Location
Industry
Size
Opportunity Score
Why It Fits
Why Now
Top Signal
Best Contact
Evidence Count
Confidence
Status
Next Action
```

Example:

```text
Acme Inc.
Opportunity Score: 91

Why it fits:
✓ B2B SaaS
✓ 50–200 employees
✓ Founder-led sales

Why now:
• Raised Series A 3 weeks ago
• Hiring 4 SDRs
• New VP Sales

Best Contact:
Sarah Chen
VP Sales

Confidence:
High

Next Action:
Draft outreach
```

---

# 9. Company Discovery Comparison

| Feature                       | Explee          | Huntloop                | Winner    |
| ----------------------------- | --------------- | ----------------------- | --------- |
| Automatic discovery           | Yes             | Yes                     | Tie       |
| Segment-driven search         | Excellent       | Capable                 | Explee UX |
| Natural-language search       | Less central    | Core                    | Huntloop  |
| Dense company table           | Excellent       | Needs equivalent polish | Explee    |
| Company description           | Yes             | Yes                     | Tie       |
| Geography                     | Yes             | Yes                     | Tie       |
| Company size                  | Yes             | Supported               | Tie       |
| Traffic                       | Yes             | Optional                | Explee    |
| Traffic growth                | Yes             | Optional                | Explee    |
| Opportunity score             | Limited         | Core                    | Huntloop  |
| Why it fits                   | Implicit        | Core                    | Huntloop  |
| Why now                       | Limited         | Core opportunity        | Huntloop  |
| Trigger signals               | Less visible    | Core                    | Huntloop  |
| Evidence                      | Limited visible | Core                    | Huntloop  |
| Confidence                    | Minimal         | Core                    | Huntloop  |
| Missing-information awareness | Limited         | Strong                  | Huntloop  |
| Explainability                | Moderate        | Strong                  | Huntloop  |
| Quality-first prioritization  | Yes             | Core philosophy         | Huntloop  |

---

# 10. Decision Makers and Contacts

Explee's next step is:

```text
Find Decision Makers
```

The table contains:

```text
Name
Job title
Company
Geography
LinkedIn
```

This is extremely straightforward.

Huntloop should adopt this simplicity while making contact selection smarter.

---

# 11. Contact Intelligence

A Huntloop contact should contain:

```text
Person
├── Name
├── Job title
├── Seniority
├── Company
├── LinkedIn
├── Email
├── Email verification
├── Contact score
├── Role relevance
├── Why this person
├── Evidence
└── Confidence
```

Huntloop should explicitly answer:

> **Why is this the best person to contact?**

Examples:

```text
Decision authority: High
Problem ownership: High
Budget influence: Medium
ICP role fit: 94%
```

---

# 12. Contact Comparison

| Capability                            | Explee         | Huntloop             | Winner              |
| ------------------------------------- | -------------- | -------------------- | ------------------- |
| Find decision makers                  | Yes            | Yes                  | Tie                 |
| Name                                  | Yes            | Yes                  | Tie                 |
| Job title                             | Yes            | Yes                  | Tie                 |
| Company                               | Yes            | Yes                  | Tie                 |
| Geography                             | Yes            | Supported            | Tie                 |
| LinkedIn                              | Yes            | Supported            | Explee presentation |
| Recommended contact                   | Implicit       | Can be ranked        | Huntloop            |
| Contact-fit score                     | Limited        | Strong potential     | Huntloop            |
| Why this contact                      | Minimal        | Can explain          | Huntloop            |
| Email discovery                       | Multi-provider | Adapter architecture | Tie                 |
| Email verification                    | Yes            | Supported            | Tie                 |
| Provider provenance                   | Visible        | Can expose           | Tie                 |
| Missing-email state                   | Visible        | Should support       | Tie                 |
| Contact enrichment                    | Yes            | Supported            | Tie                 |
| Evidence-backed person recommendation | Limited        | Strong potential     | Huntloop            |

---

# 13. Enrichment

Huntloop already has the right architectural direction here.

Potential integrations/adapters include things such as:

```text
Apollo
Hunter
ZeroBounce
Tavily
Other enrichment/research providers
```

Keep the adapter architecture.

Do NOT tightly couple Huntloop to one provider.

The ideal flow is:

```text
Discovery
↓
Basic company
↓
Qualification
↓
Only enrich promising companies
↓
Find contacts
↓
Verify contact
↓
Research for personalization
```

This prevents wasting enrichment credits on poor-fit prospects.

---

# 14. Prospect Intelligence

This should be Huntloop's biggest differentiator.

Explee is good at finding and contacting leads.

Huntloop should be better at explaining the opportunity.

Every qualified company should eventually have an intelligence view resembling:

```text
# Company Intelligence

Opportunity Score: 91/100
Confidence: High

## Why This Company Fits

• Matches industry criterion
• Matches target size
• Uses relevant technology
• Expanding sales team

## Why Now

• Raised Series A 22 days ago
• Hiring 5 sales roles
• New VP Sales joined recently

## Evidence

1. Company careers page
2. Funding announcement
3. LinkedIn
4. Product documentation
5. Recent press release

## Best Decision Maker

Sarah Chen
VP Sales

Contact Fit: 94%

Why:
• Owns sales team
• Joined recently
• Responsible for scaling outbound

## Recommended Angle

Position Huntloop around reducing research time while the company scales its new sales team.

## Suggested Next Action

Generate personalized email
```

---

# 15. Prospect Intelligence Comparison

| Feature                     | Explee            | Huntloop          | Advantage |
| --------------------------- | ----------------- | ----------------- | --------- |
| Company summary             | Yes               | Yes               | Tie       |
| ICP fit                     | Yes               | Explainable       | Huntloop  |
| Score breakdown             | Limited           | Strong            | Huntloop  |
| Evidence                    | Limited visible   | Core              | Huntloop  |
| Trigger signals             | Moderate          | Strong potential  | Huntloop  |
| Recommended contact         | Finds contacts    | Can rank contacts | Huntloop  |
| Recommended angle           | Embedded in email | Can be standalone | Huntloop  |
| Confidence                  | Limited           | Intended          | Huntloop  |
| Unknowns                    | Rarely surfaced   | Explicit          | Huntloop  |
| Human correction            | Less prominent    | Core principle    | Huntloop  |
| AI decision storage         | Not visible       | Supported         | Huntloop  |
| Quality rating              | Not visible       | Supported         | Huntloop  |
| Explain "why this prospect" | Partial           | Core product idea | Huntloop  |

---

# 16. Outreach and Email Generation

Explee has a clean email-writing stage.

It:

```text
Selects a prospect
↓
Finds email
↓
Verifies email
↓
Researches company/person
↓
Writes subject
↓
Writes personalized message
↓
Allows editing
↓
Sends
```

Huntloop should preserve human control.

The workflow should instead be:

```text
Opportunity
↓
Recommended angle
↓
Evidence used
↓
Draft
↓
Review
↓
Edit
↓
Approve
↓
Send
```

The user should understand **why the AI wrote what it wrote**.

---

# 17. Outreach Comparison

|  # | Capability                    | Explee              | Huntloop                  | Winner            |
| -: | ----------------------------- | ------------------- | ------------------------- | ----------------- |
|  1 | Email generation              | Yes                 | Yes                       | Tie               |
|  2 | Subject generation            | Yes                 | Yes                       | Tie               |
|  3 | Personalization               | Strong              | Evidence-backed potential | Huntloop          |
|  4 | Company-specific opener       | Yes                 | Yes                       | Tie               |
|  5 | Research personalization      | Yes                 | Core philosophy           | Huntloop          |
|  6 | Edit before send              | Yes                 | Yes                       | Tie               |
|  7 | Human approval                | Optional            | Core                      | Huntloop          |
|  8 | Brand voice                   | Basic               | Org voice system          | Huntloop          |
|  9 | Phrase guardrails             | Not visible         | Banned-phrase system      | Huntloop          |
| 10 | Evidence protection           | Limited visible     | Strong                    | Huntloop          |
| 11 | Outreach angle                | Mostly inside email | Should be explicit object | Huntloop          |
| 12 | Bulk generation               | Yes                 | Should support carefully  | Explee current UX |
| 13 | Integrated sending            | Strong              | Less complete             | Explee            |
| 14 | Domain warming                | Strong              | Not current               | Explee            |
| 15 | Pre-warmed mailboxes          | Strong              | Not current               | Explee            |
| 16 | Deliverability infrastructure | Strong              | Limited                   | Explee            |
| 17 | Cost-per-email model          | Yes                 | Not mature                | Explee            |

---

# 18. What NOT to Copy Immediately

Do not spend early Huntloop engineering effort recreating:

```text
Massive proprietary email infrastructure
Huge proprietary B2B database
Email-domain warming system
Hundreds of millions of owned records
Full autonomous reply agent
Automatic calendar booking
Advanced billing infrastructure
```

These can be integrated later.

Huntloop's moat should be intelligence first.

---

# 19. Replies and Meetings

Explee goes beyond sending.

It can conceptually:

```text
Detect reply
↓
Understand reply
↓
Respond
↓
Share calendar
↓
Book meeting
```

Huntloop should eventually support this but introduce levels of automation.

Example:

```text
Automation Level 0
Manual only

Automation Level 1
AI suggests reply

Automation Level 2
AI drafts and asks approval

Automation Level 3
Auto-send safe reply categories

Automation Level 4
Handle qualification and booking automatically
```

Human control should remain configurable.

---

# 20. Reply / CRM Comparison

| Feature              | Explee           | Huntloop                 | Recommendation         |
| -------------------- | ---------------- | ------------------------ | ---------------------- |
| Reply detection      | Yes              | Supported direction      | Finish                 |
| Reply classification | Implied          | AI capable               | Build                  |
| Reply drafting       | Yes              | Capable                  | Build                  |
| Automatic reply      | Yes              | Not default              | Add later              |
| Booking link         | Yes              | Later                    | Add after reply system |
| Meeting booking      | Yes              | Later                    | Integrate              |
| Calendar             | Yes              | Not core                 | Later                  |
| Conversion tracking  | Yes              | Learning system supports | Build                  |
| Full CRM             | No heavy CRM     | Should avoid huge CRM    | Keep lightweight       |
| Next-best action     | Workflow implied | Core Huntloop concept    | Make primary           |

---

# 21. Learning System

Explee has an excellent simple presentation.

Campaigns become:

```text
Scaling
Working
Paused
```

Example concept:

```text
Event designers → Scaling
Wedding floral studios → Scaling
Wedding planners → Working
Houses of worship → Paused
Property management → Paused
```

Huntloop should copy this presentation but use a much more intelligent backend.

---

# 22. Huntloop Learning Engine

Huntloop already has or is designed around concepts such as:

```text
Learning runs
Learning findings
Rule effects
AI decisions
Quality ratings
Opportunity model scores
Rule traces
Memory ingestion
Feedback
```

The UI should translate this complexity into simple recommendations.

Example:

```text
Huntloop learned:

↑ SaaS companies hiring SDRs convert 2.4x better
↑ Recently funded companies produce more replies
↓ Agencies under 10 employees rarely respond
↓ Generic "growth" messaging performs poorly

Recommended changes:

+ Increase hiring-signal weight
+ Increase funding-signal weight
- Reduce score for micro-agencies
- Prefer operational pain messaging
```

The user should be able to:

```text
Accept
Reject
Edit
Apply
Undo
```

---

# 23. Learning Comparison

| Capability               | Explee          | Huntloop            | Winner   |
| ------------------------ | --------------- | ------------------- | -------- |
| Learn from results       | Yes             | Yes                 | Tie      |
| Scale strong campaigns   | Yes             | Yes                 | Tie      |
| Pause weak campaigns     | Yes             | Yes potential       | Tie      |
| CPL-based learning       | Strong          | Later               | Explee   |
| Reply learning           | Yes             | Strong architecture | Huntloop |
| Meeting learning         | Yes             | Supported           | Tie      |
| Conversion learning      | Yes             | Supported           | Tie      |
| User acceptance feedback | Limited visible | Core                | Huntloop |
| Rejection feedback       | Limited         | Core                | Huntloop |
| Correction feedback      | Limited         | Core                | Huntloop |
| Quality rating           | Not visible     | Supported           | Huntloop |
| Learning runs            | Not visible     | Supported           | Huntloop |
| Learning findings        | Basic           | Rich architecture   | Huntloop |
| Rule effects             | Simple          | Strong              | Huntloop |
| Rule updates             | Hidden          | Can be reviewable   | Huntloop |
| Explain learning         | Limited         | Strong potential    | Huntloop |
| Human approval           | Limited         | Core philosophy     | Huntloop |
| Auditability             | Limited visible | Strong              | Huntloop |

---

# 24. UI/UX Comparison

This is where Huntloop should learn the most from Explee.

Explee hides enormous backend complexity behind a very simple interface.

The user mainly sees:

```text
1. Research company
2. Explore competitors
3. Define campaigns
4. Find companies
5. Find decision makers
6. Write emails
```

This is excellent product design.

---

# 25. Recommended Huntloop Guided Journey

Huntloop could use:

```text
1. Understand
2. Target
3. Discover
4. Qualify
5. Contact
6. Reach
7. Learn
```

or:

```text
1. Research your company
2. Define your ICP
3. Find opportunities
4. Understand opportunities
5. Find decision makers
6. Reach out
7. Learn
```

The wording can be refined later.

---

# 26. Persistent Sidebar

Adopt the interaction concept seen in Explee.

Example Huntloop sidebar:

```text
HUNTLOOP

✓ Research
   My Company
   Product
   Competitors

✓ ICPs
   SaaS Growth Teams
   AI Startups
   Agencies

✓ Opportunities
   342 Found
   76 Qualified
   19 High Priority

✓ People
   108 Contacts
   61 Verified

→ Outreach
   22 Drafts
   8 Sent
   3 Replied

○ Learn
```

As the user progresses, earlier context remains visible.

---

# 27. UX Comparison Table

| UX Feature         | Explee    | Huntloop             | Action                  |
| ------------------ | --------- | -------------------- | ----------------------- |
| Initial simplicity | Excellent | More complex         | Simplify                |
| Linear journey     | Excellent | Less explicit        | Add                     |
| Persistent sidebar | Excellent | Different structure  | Adopt concept           |
| Progress indicator | Excellent | Weaker               | Add                     |
| Dense tables       | Excellent | Needs equivalent     | Improve                 |
| Campaign cards     | Excellent | Can be richer        | Build                   |
| Company table      | Excellent | Must match           | Build                   |
| People table       | Excellent | Must match           | Build                   |
| Email editor       | Simple    | Draft system capable | Simplify                |
| AI transparency    | Moderate  | Strong               | Keep Huntloop advantage |
| Evidence           | Limited   | Strong               | Make visible            |
| Human control      | Moderate  | Strong               | Keep                    |
| Cognitive load     | Low       | Higher               | Progressive disclosure  |
| Power-user depth   | Moderate  | High potential       | Hide until needed       |

---

# 28. Biggest Explee Product Lesson

The biggest lesson from Explee is NOT:

```text
Find leads
```

or:

```text
Send emails
```

It is:

> **Compress enormous complexity into a tiny understandable journey.**

Behind Explee there may be:

```text
Databases
Enrichment providers
Search
AI agents
Background jobs
Email verification
Sending infrastructure
Campaign logic
Analytics
Reply handling
```

But the user experiences:

```text
Understand me
↓
Understand my market
↓
Choose buyers
↓
Find companies
↓
Find people
↓
Write emails
```

Huntloop needs the same simplicity.

---

# 29. Data / Infrastructure Comparison

| Area                    | Explee             | Huntloop                 | Direction                 |
| ----------------------- | ------------------ | ------------------------ | ------------------------- |
| Raw contact database    | Major asset        | Provider-driven          | Do not recreate now       |
| Research system         | Internal           | Provider abstraction     | Keep Huntloop modular     |
| Email finder            | Multi-source       | Adapters                 | Keep                      |
| Email verifier          | Yes                | Supported                | Keep                      |
| AI decision persistence | Unknown            | Supported                | Advantage                 |
| Evidence storage        | Less visible       | Core                     | Advantage                 |
| Memory                  | Website context    | Deep organization memory | Advantage                 |
| Multi-tenancy           | Exists externally  | Explicit architecture    | Keep                      |
| RLS                     | Unknown externally | Designed                 | Keep                      |
| Rate limiting           | Unknown            | Supported                | Keep                      |
| Async jobs              | Clearly used       | Jobs package             | Keep                      |
| Learning jobs           | Yes                | Architecture exists      | Complete                  |
| Public API              | Available          | Limited                  | Later                     |
| Billing                 | Mature             | Deferred                 | Later                     |
| Sending infrastructure  | Mature             | Limited                  | Integrate before building |

---

# 30. Important Huntloop Operational Reality

Do not confuse:

```text
Features implemented in code
```

with:

```text
Features actually working in production
```

The latest Huntloop work has included or planned things such as:

```text
Programmable scoring
Rule evaluator
Model scores
Rule traces
Learning analysis
Feedback
Scheduled learning
Organization voice
Banned-phrase guard
URL/file memory ingestion
Job/backlog controls
Provider adapters
```

However, production readiness must be verified.

There have been migration/runtime issues where later database migrations were not yet applied.

Therefore:

## Before building many new features:

```text
1. Verify production database migrations.
2. Apply every required unapplied migration.
3. Verify workers/jobs can claim and execute work.
4. Verify discovery end-to-end.
5. Verify enrichment.
6. Verify scoring.
7. Verify learning.
8. Verify outreach.
```

Do not assume green local code means production functionality.

---

# 31. Recommended Huntloop Opportunity Screen

Create one unified opportunity page.

Example:

```text
┌─────────────────────────────────────────────────────────────┐
│ ACME                                      SCORE 91 / 100     │
│ SaaS • United States • 85 employees                        │
├─────────────────────────────────────────────────────────────┤
│ WHY IT FITS                                                  │
│ ✓ ICP industry match                                        │
│ ✓ Correct employee size                                     │
│ ✓ Founder-led GTM                                           │
│ ✓ Uses relevant technology                                  │
├─────────────────────────────────────────────────────────────┤
│ WHY NOW                                                      │
│ ↑ Raised Series A 22 days ago                               │
│ ↑ Hiring 4 SDRs                                             │
│ ↑ New VP Sales                                              │
├─────────────────────────────────────────────────────────────┤
│ EVIDENCE                                                     │
│ 5 verified sources                                          │
│ [View evidence]                                              │
├─────────────────────────────────────────────────────────────┤
│ BEST CONTACT                                                 │
│ Sarah Chen                                                   │
│ VP Sales                                                     │
│ Contact Fit: 94                                              │
├─────────────────────────────────────────────────────────────┤
│ RECOMMENDED ANGLE                                            │
│ Scaling outbound while reducing account research time.      │
├─────────────────────────────────────────────────────────────┤
│ NEXT ACTION                                                  │
│ [Research More] [Find Email] [Draft Outreach]                │
└─────────────────────────────────────────────────────────────┘
```

This should become Huntloop's signature experience.

---

# 32. Recommended Huntloop Company Table

```text
Company
Score
Why Fit
Why Now
Signals
Best Contact
Evidence
Confidence
Status
Next Action
```

Example:

| Company | Score | Why Fit           | Why Now         | Contact    | Confidence | Next     |
| ------- | ----: | ----------------- | --------------- | ---------- | ---------- | -------- |
| Acme    |    91 | SaaS + right size | Raised Series A | Sarah Chen | High       | Draft    |
| Nova    |    87 | AI company        | Hiring sales    | Alex Kim   | High       | Research |
| Orbit   |    81 | ICP match         | New VP Growth   | Maria Lee  | Medium     | Enrich   |

---

# 33. Recommended Campaign Card

Instead of only:

```text
AI Startups
1.2K
```

show:

```text
AI Infrastructure Startups
Estimated prospects: 1.2K

Pain:
Need predictable enterprise pipeline.

Criteria:
• 20–200 employees
• B2B
• AI infrastructure
• Active growth

Signals:
• Recently funded
• Hiring sales
• Product launch

Examples:
Together AI
Fireworks AI
Modal
Replicate

Average fit score:
86

[Find Opportunities]
```

---

# 34. Human Control

Huntloop should continue being intentionally different from blind-autopilot platforms.

Every important AI action should support:

```text
View
Edit
Approve
Reject
Correct
Explain
Undo
```

Possible automation settings:

```text
Manual
Assisted
Semi-automatic
Automatic
```

Users should choose how much autonomy Huntloop receives.

---

# 35. Evidence Model

Every major AI claim should ideally point to evidence.

Example:

```text
Signal:
Company is hiring salespeople.

Evidence:
Careers page shows 4 open SDR/AE roles.

Source:
company.com/careers

Captured:
2026-09-04

Confidence:
High
```

AI-generated conclusions should distinguish:

```text
FACT
INFERENCE
UNKNOWN
```

Example:

```text
FACT
Company raised $12M.

INFERENCE
Likely increasing GTM spending.

UNKNOWN
Exact sales budget.
```

This is a major Huntloop differentiator.

---

# 36. Scoring

Huntloop's scoring should remain explainable.

Example:

```text
Opportunity Score: 87

ICP Match            +30
Company Size         +15
Industry             +15
Funding Signal       +10
Hiring Signal        +10
Tech Match            +7

Risk:
No confirmed sales leader -5

Total: 82
Model adjustment: +5

Final score: 87
```

Allow users to inspect:

```text
Rule trace
Evidence
Model reasoning summary
Confidence
```

Do not turn scoring into an unexplained magic number.

---

# 37. Feedback Loop

Every opportunity should allow feedback.

Example:

```text
👍 Good fit
👎 Bad fit
Wrong industry
Wrong company size
Wrong contact
Wrong timing
Bad data
Already known
Competitor
Not relevant
```

For AI outputs:

```text
Useful
Not useful
Too generic
Incorrect
Poor personalization
Wrong angle
```

Use this feedback in the learning system.

---

# 38. Learning UI

Create a simple page such as:

```text
# What Huntloop Learned

Last learning run:
Today, 09:30

New findings:

↑ Recently funded SaaS companies respond 2.1x more
↑ VP-level contacts outperform founders for companies >100 employees
↓ Companies under 10 employees rarely convert
↓ "Growth" messaging performs worse than operational-pain messaging

Suggested adjustments:

+ Funding signal weight: 8 → 12
+ VP Sales contact priority: 70 → 84
- Micro-company fit weight: 10 → 4

[Review Changes]
[Apply]
[Reject]
```

This turns the internal learning engine into something users can understand.

---

# 39. Product Phases

## P0: Make the existing engine real

Before cloning any additional Explee behavior:

```text
Verify migrations
Apply missing migrations
Verify background worker
Verify jobs
Verify queues
Verify DB claims
Verify providers
Verify production env
Verify scoring
Verify learning
Verify outreach state
```

Everything must operate end-to-end in production.

---

## P1: Explee-Level Activation

Build:

```text
Domain-first onboarding
Company research
Competitor discovery
Automatic ICP generation
Campaign/ICP cards
Persistent workflow sidebar
Progress rail
Company discovery table
Decision-maker table
```

---

## P2: Huntloop Intelligence Layer

Build/polish:

```text
Unified opportunity page
Explainable scores
Rule trace UI
Evidence drawer
Why-it-fits
Why-now
Signals
Confidence
Best contact
Contact-fit score
Recommended angle
Next-best action
```

---

## P3: Outreach

Build:

```text
Email finder
Verification
Research-backed personalization
Organization voice
Outreach angle
Email drafting
Approval
Sending integration
Reply tracking
```

---

## P4: Learning

Build:

```text
Outcomes
Reply classification
Meeting outcomes
User feedback
Learning runs
Learning findings
Recommended scoring changes
Scale / Working / Pause status
Learning dashboard
```

---

## P5: Automation

Later:

```text
AI reply suggestions
Safe auto-replies
Booking
Calendar integration
Automated campaigns
Sending infrastructure
Billing
Public API
```

---

# 40. Features to Copy From Explee

| Explee Idea               | Copy?   | Huntloop Version                    |
| ------------------------- | ------- | ----------------------------------- |
| Domain-first start        | YES     | URL → organization intelligence     |
| Linear onboarding         | YES     | Guided Huntloop journey             |
| Competitor stage          | YES     | Evidence-backed competitor research |
| Auto segments             | YES     | ICP hypotheses                      |
| Campaign cards            | YES     | Rich ICP cards                      |
| Estimated segment count   | YES     | Addressable prospect estimate       |
| Persistent sidebar        | YES     | Workflow memory                     |
| Progress rail             | YES     | Activation path                     |
| Company table             | YES     | Add intelligence columns            |
| Decision-maker table      | YES     | Add contact scoring                 |
| Multi-provider enrichment | YES     | Already aligned                     |
| Personalized emails       | YES     | Evidence-backed                     |
| Email edit                | YES     | Keep human control                  |
| Campaign scale/pause      | YES     | Learning-backed                     |
| Proprietary database      | NO      | Use providers                       |
| Full sending stack        | NOT NOW | Integrate                           |
| Automatic reply agent     | LATER   | Guardrails                          |
| Calendar booking          | LATER   | Integration                         |
| Pay-per-email model       | LATER   | Validate first                      |
| Public API                | LATER   | After domain model stabilizes       |

---

# 41. Features Huntloop Should Be Better At

Huntloop should beat Explee in:

```text
Explainable qualification
Evidence
Source-backed AI
Opportunity scoring
Signals
Why-now intelligence
Confidence
Unknown-information handling
Contact ranking
Recommended outreach angle
Human correction
User feedback
AI decision auditability
Learning transparency
Organization memory
Organization voice
Rule-driven intelligence
Next-best actions
```

---

# 42. What Huntloop Should NOT Become

Do NOT turn Huntloop into:

```text
Apollo clone
Salesforce clone
Instantly clone
Generic lead scraper
Generic CRM
Generic cold-email tool
```

Those markets are crowded.

Huntloop's differentiation should remain:

> **Opportunity intelligence.**

---

# 43. Ideal Huntloop Workflow

Final ideal workflow:

```text
ENTER WEBSITE
↓
Huntloop understands the business
↓
Huntloop researches competitors
↓
Huntloop proposes ICPs
↓
User approves/edits ICPs
↓
Huntloop discovers companies
↓
Huntloop scores them
↓
Huntloop identifies why they fit
↓
Huntloop detects why now
↓
Huntloop gathers evidence
↓
Huntloop prioritizes opportunities
↓
Huntloop finds the best person
↓
Huntloop verifies contact information
↓
Huntloop recommends an outreach angle
↓
Huntloop drafts outreach
↓
User approves
↓
Outreach is sent
↓
Replies are tracked
↓
Meetings/conversions are recorded
↓
Feedback enters learning engine
↓
Huntloop updates future qualification
↓
Next opportunity becomes better
```

---

# 44. Ideal User Experience

The user should NOT feel like they are operating:

```text
A database
A scraping engine
An enrichment tool
An AI orchestration platform
A workflow builder
A scoring engine
```

Even though all of those things may exist underneath.

The user should feel like Huntloop simply answers:

```text
WHO SHOULD I PURSUE?

WHY?

WHY NOW?

WHO SHOULD I CONTACT?

WHAT SHOULD I SAY?

WHAT SHOULD I DO NEXT?
```

---

# 45. Final Product Position

Explee currently feels like:

> **An automated outbound sales machine.**

Huntloop should become:

> **An AI opportunity intelligence system that continuously tells you which companies are worth pursuing, why they matter now, who you should contact, what you should say, and what it learned from the outcome.**

The target is not:

```text
Huntloop = Explee clone
```

The target is:

```text
Huntloop
=
Explee simplicity
+
better qualification
+
better evidence
+
better explainability
+
better opportunity intelligence
+
better human control
+
better learning
```

---

# 46. Final Priority Order

## Priority 0

Fix and verify the underlying system.

```text
Database migrations
Workers
Queues
Jobs
Providers
Production environment
Scoring
Learning
Outreach
```

---

## Priority 1

Make Huntloop dramatically easier to use.

```text
Website-first onboarding
Company research
Competitor research
Automatic ICPs
Linear workflow
Progress indicator
Persistent sidebar
Company table
People table
```

---

## Priority 2

Make Huntloop dramatically smarter than Explee.

```text
Opportunity score
Why it fits
Why now
Evidence
Signals
Confidence
Rule trace
Best contact
Contact reasoning
Recommended angle
Next-best action
```

---

## Priority 3

Complete the action loop.

```text
Email discovery
Verification
Drafting
Approval
Sending
Reply detection
Outcome tracking
```

---

## Priority 4

Complete the learning loop.

```text
Feedback
Replies
Meetings
Conversions
Learning runs
Learning findings
Rule recommendations
Scale / Working / Pause
```

---

## Priority 5

Add deeper automation later.

```text
Automatic replies
Calendar booking
Sending infrastructure
Billing
Public API
Advanced autonomous campaigns
```

---

# 47. Instruction for Implementation

Before implementing anything:

1. Audit Huntloop's existing implementation completely.
2. Do not rebuild anything that already exists.
3. Map every feature in this document to:

   * existing and complete,
   * existing but incomplete,
   * implemented but not connected,
   * implemented but not production-ready,
   * missing.
4. Verify database schema and migrations.
5. Verify production/runtime behavior.
6. Verify all provider adapters.
7. Verify job workers.
8. Verify current UI.
9. Verify scoring and learning systems.
10. Create a dependency-aware implementation plan.

Then implement in the correct order.

Do not blindly reproduce Explee's visual design.

Use Explee primarily as a reference for:

```text
Flow
Simplicity
Progressive disclosure
Navigation
Funnel organization
Tables
Campaign organization
Low-friction onboarding
```

Retain Huntloop's own visual identity.

---

# 48. Implementation Rule

For every proposed feature:

```text
FIRST:
Search Huntloop for an existing implementation.

IF COMPLETE:
Reuse it.

IF PARTIAL:
Finish it.

IF DISCONNECTED:
Connect it.

IF BROKEN:
Fix it.

IF NOT PRODUCTION READY:
Make it production ready.

ONLY IF MISSING:
Build it.
```

Avoid duplicate systems.

---

# 49. Final Goal

The final Huntloop experience should feel almost deceptively simple:

```text
Give Huntloop my website.
↓
It understands my business.
↓
It understands who should buy.
↓
It finds the best opportunities.
↓
It proves why they are good opportunities.
↓
It finds the right person.
↓
It tells me what to say.
↓
I approve it.
↓
It tracks the result.
↓
It learns.
↓
The next recommendation gets better.
```

That is the product to build.

```
```
