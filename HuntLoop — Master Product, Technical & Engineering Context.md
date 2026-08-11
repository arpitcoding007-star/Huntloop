# HuntLoop — Master Product, Technical & Engineering Context
## Single Source of Truth for Continued Development

**Document status:** Product/architecture context specification  
**Product:** HuntLoop  
**Purpose:** Provide a complete working context to an engineering/AI development agent continuing HuntLoop development.  
**Important:** This document distinguishes **CONFIRMED**, **INFERRED**, and **UNKNOWN / NOT YET DEFINED** information. Do not treat inferred architecture as existing implementation.

---

# 1. Executive Summary

## 1.1 What is HuntLoop?

HuntLoop is an **AI-powered B2B sales intelligence and lead-discovery platform**.

The core problem HuntLoop addresses is not simply finding companies or contacts. Traditional B2B sales tools are already very good at answering:

- Which companies exist?
- Which people work there?
- Who is the decision-maker?
- What are their contact details?

HuntLoop is intended to answer the more valuable questions:

- Which companies actually need what I sell?
- Why might they need it?
- What evidence supports that conclusion?
- What changed recently?
- Why is this company worth contacting **now**?
- What specific problem should I talk about?
- Who should I contact?
- What should I say?
- What should I avoid saying?
- How should I follow up?
- Is this actually a strong opportunity or merely a company that superficially matches the ICP?

The core philosophy is therefore:

> **HuntLoop should help salespeople find companies with evidence that they need what they sell.**

The fundamental unit of HuntLoop is intended to be:

> **A qualified opportunity with evidence**

rather than simply:

> **A lead**

This distinction is fundamental to the product.  
**[CONFIRMED]**

---

# 2. Product Vision

The long-term vision has expanded beyond lead discovery.

HuntLoop is intended to become an **AI-native Sales Operating System** for sales professionals and sales organizations across **Web2 and Web3**.

The intended product should eventually allow a salesperson/team to:

1. Define their company and products.
2. Build and refine their ICP.
3. Discover relevant companies.
4. Monitor sources for buying signals.
5. Research companies deeply.
6. Identify pain points and gaps.
7. Detect buying triggers.
8. Score opportunities.
9. Find decision-makers and contact information.
10. Understand why an account matters now.
11. Talk to an AI sales agent that understands the opportunity.
12. Generate and execute outreach.
13. Track all communications.
14. Manage the sales pipeline.
15. Assign opportunities to junior BDs.
16. Monitor team performance.
17. Analyze what is working and what is not.
18. Learn from historical sales outcomes.
19. Build organization-level memory.
20. Build individual salesperson memory.
21. Continuously improve recommendations based on outcomes.

The ultimate objective is:

> **One-stop sales intelligence, execution, CRM, coaching, and learning platform.**

**[CONFIRMED: product direction]**

---

# 3. Critical Product Positioning

HuntLoop should **NOT** primarily be positioned as:

- AI lead generation
- AI scraping
- Another Apollo
- A contact database
- A generic CRM
- An AI spam/outreach machine

The core differentiation should be:

> **Most systems help salespeople FIND prospects. HuntLoop helps salespeople UNDERSTAND WHY a prospect is currently worth contacting.**

Potential positioning hypotheses include:

- "Don't hunt for leads. Hunt for buying signals."
- "Find companies that need you, not companies that merely fit your filters."
- "From outbound lists to buying signals."
- "Your AI sales research team."
- "Know who needs you before you reach out."
- "Stop selling to companies that don't need you."

These are **positioning hypotheses**, not finalized messaging.

**[CONFIRMED]**

---

# 4. Core HuntLoop Thesis

Traditional outbound:

```text
PRODUCT
  ↓
DEFINE ICP
  ↓
FIND COMPANIES
  ↓
FIND CONTACTS
  ↓
SEND OUTREACH
```

HuntLoop:

```text
CUSTOMER SIGNALS
  ↓
DISCOVER COMPANIES
  ↓
UNDERSTAND THEIR BUSINESS
  ↓
UNDERSTAND THEIR PRODUCTS
  ↓
IDENTIFY PROBLEMS
  ↓
IDENTIFY GAPS
  ↓
IDENTIFY BUYING TRIGGERS
  ↓
QUALIFY AGAINST ICP
  ↓
FIND RIGHT PERSON
  ↓
EXPLAIN WHY THIS ACCOUNT MATTERS NOW
  ↓
GENERATE ACTIONABLE OUTBOUND INTELLIGENCE
```

The fundamental product loop is:

```text
SIGNAL
  ↓
CONTEXT
  ↓
INTENT
  ↓
OPPORTUNITY
```

Scraping is only one potential mechanism for collecting evidence.

The actual product is **intelligence**, not scraping.

**[CONFIRMED]**

---

# 5. Target Users

## Primary Users

HuntLoop is intended for:

- B2B Sales Representatives
- SDRs
- BDRs
- Account Executives
- Business Development Managers
- Business Development Directors
- Heads of Sales
- Chief Business Development Officers
- Chief Revenue Officers
- Founders doing outbound sales
- Growth teams
- Enterprise sales teams

## Secondary Users

- Agencies doing outbound for clients
- Sales consultants
- Recruiting/business development teams
- Partnership teams
- Channel teams

The broader strategic target is **salespeople and sales organizations globally**, across Web2 and Web3.

**[CONFIRMED]**

---

# 6. Core Product Philosophy

HuntLoop should be:

- Evidence-first
- Signal-first
- Research-heavy
- Actionable
- Explainable
- Fresh
- High precision
- Low noise

The system should prefer:

> **10 excellent opportunities over 1,000 weak leads.**

The system must avoid fake precision.

Scores should be explainable.

**[CONFIRMED]**

---

# 7. FACT / INFERENCE / UNKNOWN Framework

One of the most important rules in the HuntLoop intelligence engine is the distinction between:

```text
FACT
INFERENCE
UNKNOWN
```

Example:

### FACT

> Company launched an AI trading agent.

### INFERENCE

> The agent may require controlled financial permissions.

### UNKNOWN

> Whether the company currently uses MPC, multisig, or another wallet architecture.

HuntLoop must never silently convert an inference into a fact.

This principle should be applied throughout:

- company research
- pain detection
- technology detection
- buying intent
- contact information
- outreach recommendations
- AI sales conversations
- scoring
- analytics

Every important intelligence claim should ideally have provenance/evidence and a confidence classification.

**[CONFIRMED]**

---

# 8. Initial User Onboarding

When a salesperson signs up, the first core input is expected to be:

```text
Company Website
```

Example:

```text
https://example.com
```

HuntLoop researches the company deeply.

The research should attempt to understand:

- What the company sells
- Products
- Services
- Target customers
- Industries
- Business model
- Geography
- Pricing where available
- Customer types
- Use cases
- Competitive positioning
- Value proposition
- Likely buying triggers
- What kinds of companies would benefit most

This creates an internal understanding of:

> **WHAT THIS COMPANY SELLS**

**[CONFIRMED]**

---

# 9. ICP Creation

HuntLoop should ask the user a relatively small number of high-value questions.

Potential ICP inputs include:

- Which customer segment is most valuable?
- What company size is ideal?
- Which industries matter?
- Which geographies matter?
- What problem does the product solve?
- What type of company experiences this problem?
- Who usually buys the product?
- Who influences the decision?
- What makes a company ready to buy?
- What companies are NOT a fit?
- Are there specific competitors whose customers are desirable?
- Are there specific technologies/platforms indicating a prospect may need the product?
- What triggers usually cause a buying decision?

The ICP engine should combine:

```text
USER INPUT
+
COMPANY RESEARCH
=
ICP
```

The user should be able to review and edit the generated ICP before hunting begins.

**[CONFIRMED]**

---

# 10. Source Discovery

HuntLoop should recommend sources where relevant potential customers are likely to appear.

Potential sources:

- News
- Blogs
- Industry publications
- Company websites
- Press releases
- Funding databases
- Product launches
- Job boards
- Job postings
- LinkedIn
- X / Twitter
- Reddit
- Hacker News
- GitHub
- Product Hunt
- Conference/event sites
- Government/regulatory sources
- Technical documentation
- Company engineering blogs
- Podcasts
- Interviews
- Communities
- Other relevant public sources

The recommendation should be based on the user's ICP.

Example:

For an AI infrastructure ICP:

- TechCrunch
- VentureBeat
- Hacker News
- GitHub
- Company engineering blogs
- AI startup databases
- Relevant Reddit communities
- Relevant conferences

For crypto institutional infrastructure:

- The Block
- CoinDesk
- Blockworks
- Company blogs
- Crypto funding sources
- GitHub
- Relevant X accounts
- Industry publications

Users should be able to:

1. Accept recommended sources.
2. Remove sources.
3. Add their own sources.

**[CONFIRMED]**

---

# 11. Hunt Engine

The Hunt Engine continuously or periodically scans selected sources.

However, it must not stop at:

> "Company X was mentioned."

It must investigate:

- Why is the company relevant?
- What does it do?
- What problem might it have?
- What changed?
- Why now?
- Does the user's product solve that problem?

**[CONFIRMED]**

---

# 12. Company Intelligence Model

For every discovered company, HuntLoop should attempt to identify:

- Company
- Website
- Industry
- Location
- Size
- Funding
- Products
- Services
- Business model
- Customers
- Technology
- Relevant executives
- Decision-makers
- Current initiatives
- Recent events
- Pain points
- Gaps
- Buying signals
- Triggers
- Competitors
- Current solutions
- Potential use case
- ICP fit
- Why now
- Recommended outreach angle

**[CONFIRMED]**

---

# 13. Trigger Engine

Recent events should receive significant priority.

Potential triggers include:

- Company just raised funding
- Company launched a product
- Company entered a new market
- Company hired a relevant executive
- Company is hiring engineers for a relevant problem
- Company announced a partnership
- Company announced expansion
- Company acquired another company
- Company launched new technology
- Company experienced a security incident
- Company changed strategy
- Company announced a new customer
- Company announced a new integration
- Company started using a relevant technology
- Company is actively discussing a problem
- Founder publicly described a pain point
- Company is building something internally that the user's product solves
- Company lost a key employee
- Company is scaling rapidly
- Company received regulatory approval
- Company entered a regulated market
- Company announced a major customer
- Company launched an enterprise product

The engine should ultimately answer:

> **Why should this salesperson contact this company TODAY rather than six months ago?**

**[CONFIRMED]**

---

# 14. Opportunity / Lead Output

A HuntLoop opportunity should contain information similar to:

```text
COMPANY
WEBSITE
ICP FIT

WHY THIS COMPANY

WHAT THEY DO

RELEVANT PRODUCT

IDENTIFIED PROBLEM

EVIDENCE

POTENTIAL GAP

TRIGGER

TRIGGER DATE

WHY NOW

CURRENT APPROACH

POTENTIAL USE CASE

LIKELY BUYER

SECONDARY BUYERS

OUTREACH ANGLE

PERSONALIZED OUTREACH

CONFIDENCE

SOURCE EVIDENCE
```

The exact UI and data schema are not finalized.

**[CONFIRMED: conceptual fields]**

---

# 15. Lead / Opportunity Prioritization

HuntLoop should classify opportunities as:

### HOT

Strong ICP + strong pain + strong recent trigger.

### WARM

Good ICP + reasonable pain + weaker trigger.

### WATCH

Potential fit but insufficient evidence.

### IGNORE

Poor fit.

**[CONFIRMED]**

---

# 16. Scoring System

HuntLoop should consider:

1. ICP fit
2. Problem severity
3. Evidence strength
4. Trigger strength
5. Trigger freshness
6. Buying likelihood
7. Product relevance
8. Decision-maker accessibility

Scores should be explainable.

Do not create fake precision.

**[CONFIRMED]**

---

# 17. Direct Company URL Analysis

A major feature should allow the user to paste any company's website.

Example:

```text
https://company.com
```

HuntLoop should investigate and provide:

- Lead/opportunity score
- ICP fit
- Pain points
- Gaps
- Relevant products
- Signals
- Triggers
- Contacts
- Decision-makers
- Supporting evidence
- Reasons the lead is strong or weak
- Unbiased assessment

The user should be able to ask HuntLoop:

> "Is this actually a good lead?"

HuntLoop should be willing to answer:

> **No.**

It should not artificially qualify companies simply because the user entered them.

**[CONFIRMED]**

---

# 18. User-Provided Company Lists

Users should be able to bring their own list of companies.

Potential input mechanisms include:

- CSV
- Spreadsheet
- CRM export
- Other supported bulk imports

Exact supported formats are **not yet finalized**.

HuntLoop should then research/qualify those companies using the same intelligence engine.

Conceptually:

```text
USER LIST
  ↓
Deduplicate
  ↓
Company Resolution
  ↓
Research
  ↓
ICP Qualification
  ↓
Signal Detection
  ↓
Pain/Gaps
  ↓
Contact Discovery
  ↓
Prioritization
```

**[CONFIRMED concept / INFERRED processing flow]**

---

# 19. Lead-Specific AI Sales Agent

Every lead/opportunity should have its own discussion window.

This is a major intended feature.

The AI agent should understand the context of that particular opportunity.

The user should be able to discuss essentially anything related to the prospect.

Potential questions:

- What should I write?
- What should I not write?
- Why hasn't this prospect replied?
- What should I say next?
- What are the likely objections?
- How should I approach this person?
- Is this still a good opportunity?
- What did they previously say?
- What happened in the last interaction?
- Prepare me for a meeting.
- Give me different outreach angles.
- Check whether this claim is supported by evidence.
- What facts do we actually know?
- What assumptions are we making?

The AI should use:

```text
Company Intelligence
+
Lead History
+
Outreach History
+
User/Organization Knowledge
+
Product Knowledge
+
Evidence
=
Lead-Specific Sales Agent
```

**[CONFIRMED concept]**

---

# 20. Organization Memory

Each HuntLoop customer organization should have persistent organizational knowledge.

Potential knowledge:

- Company/product information
- Product positioning
- ICP
- Sales playbooks
- Case studies
- Pricing
- Competitors
- Objections
- Successful messaging
- Internal sales knowledge
- Customer information
- User-provided instructions

This enables the AI sales agent to become specific to the organization.

**[CONFIRMED concept / exact storage implementation UNKNOWN]**

---

# 21. Individual User Memory

Each BD/salesperson should have their own context and memory.

Potential memory:

- Personal preferences
- Personal communication style
- Historical interactions
- Personal notes
- Successful outreach
- Failed outreach
- Relationship context
- User-specific instructions
- User-specific knowledge

The goal is:

> **Every salesperson should have an AI that increasingly understands how they work.**

This creates long-term product stickiness.

**[CONFIRMED concept]**

---

# 22. Self-Learning Architecture

There should ultimately be multiple learning systems.

## HuntLoop-Level Learning

As an admin/product operator, the system should expose whether HuntLoop is improving based on accumulated data and feedback.

Potential learning signals:

- Which signals generate replies?
- Which signals generate meetings?
- Which signals generate opportunities?
- Which sources generate customers?
- Which ICP characteristics correlate with conversion?
- Which outreach angles work?
- Which channels work?
- Which triggers matter?

The original product vision explicitly describes this feedback loop.

## Organization-Level Learning

Each organization should learn from its own sales outcomes.

## User-Level Learning

Each individual BD should have their own learning/memory.

**[CONFIRMED concept]**

---

# 23. Outreach Automation

Higher subscription tiers are expected to unlock outreach automation.

Potential channels:

- Email
- LinkedIn
- Other channels in the future

Potential functionality:

- Generate messages
- Human approval
- Automated sending
- Sequences
- Follow-ups
- Reply tracking
- Channel tracking
- Message history

However, the exact automation model, channel APIs, safety restrictions, approval model, rate limits, and compliance architecture are **NOT YET DEFINED**.

The product should not become an indiscriminate spam engine.

The preferred philosophy is:

```text
Research
  ↓
Recommend
  ↓
Approve
  ↓
Execute
  ↓
Observe
  ↓
Learn
```

Autonomous execution may eventually be available based on permissions/subscription/trust.

**[CONFIRMED direction / IMPLEMENTATION UNKNOWN]**

---

# 24. Social/Web Scraping & Information Collection

HuntLoop is intended to gather public information from sources such as:

- Reddit
- LinkedIn
- X/Twitter
- Websites
- News
- Blogs
- GitHub
- Job postings
- Other public sources

However:

> **Scraping is a data collection mechanism, not the product itself.**

Source access must respect applicable platform rules, APIs, permissions, terms, privacy requirements, and legal/compliance constraints.

Exact implementation is **UNKNOWN**.

---

# 25. Contact Intelligence

When the user opens a lead/company, HuntLoop should expose one-click contact information.

Potential contact information:

- LinkedIn
- Email
- Phone where available
- Relevant executive/person
- Title
- Role
- Decision-maker status

The proposed architecture includes integrations with contact enrichment providers such as:

- Hunter
- Apollo

The user explicitly mentioned Hunter/Apollo APIs.

The exact API versions, credentials, endpoints, quotas, fallback behavior, and current implementation are **UNKNOWN**.

Contact data should ideally carry confidence/provenance.

---

# 26. Built-In CRM

HuntLoop should eventually contain its own CRM.

The CRM should allow users to manage the complete BD/sales pipeline.

Potential entities:

```text
Company
Contact
Opportunity
Deal
Activity
Task
Conversation
Stage
Pipeline
```

Potential pipeline:

```text
Discovered
  ↓
Qualified
  ↓
Contacted
  ↓
Replied
  ↓
Meeting
  ↓
Opportunity
  ↓
Proposal
  ↓
Won / Lost
```

The exact pipeline stages should be configurable.

The CRM should be intelligence-native rather than simply a Salesforce clone.

**[CONFIRMED concept / exact schema UNKNOWN]**

---

# 27. Outreach History

HuntLoop should record every outreach interaction.

The system should retain:

- Who received it
- Who sent it
- What was sent
- Which channel
- When it was sent
- Which sequence/campaign
- Whether AI-generated
- Whether human-edited
- Response
- Outcome
- Meeting
- Deal
- Conversion

This data is necessary for analytics and learning.

Conceptually:

```text
Signal
  ↓
Opportunity
  ↓
Outreach
  ↓
Response
  ↓
Meeting
  ↓
Deal
  ↓
Revenue
```

The system should eventually learn which upstream signals and messages actually produce revenue.

**[CONFIRMED concept / detailed schema UNKNOWN]**

---

# 28. Team Management

A HuntLoop user should be able to co-assign leads to junior BDs.

Conceptual organization hierarchy:

```text
Organization
├── Admin / Owner
├── Sales Managers
├── Senior BDs
└── Junior BDs
```

Managers should be able to:

- Assign leads
- Reassign leads
- See junior BD activity
- See performance
- Monitor pipeline
- Compare performance
- Review outreach
- Understand conversion
- Potentially coach BDs using AI

Exact role definitions and permissions are **NOT YET FINALIZED**.

---

# 29. Performance Analytics

Performance analytics should exist for:

- Individual HuntLoop users
- Junior BDs
- Teams
- Organizations
- Potentially HuntLoop itself at the global level

Metrics may include:

- Outreach volume
- Response rate
- Positive response rate
- Meetings
- Opportunities
- Proposals
- Deals won
- Revenue
- Conversion rate
- Time-to-meeting
- Time-to-close
- Source performance
- Signal performance
- ICP performance
- Outreach-angle performance
- BD performance

The system should eventually generate AI insights rather than only display charts.

Example conceptual insight:

> A BD generates high outreach volume but has below-team-average positive reply rates.

**[CONFIRMED concept / exact metrics UNKNOWN]**

---

# 30. Sales Intelligence Graph

A useful inferred architecture is to model HuntLoop as a sales intelligence graph rather than a simple lead database.

Conceptually:

```text
COMPANY
  │
  ├── PEOPLE
  │
  ├── PRODUCTS
  │
  ├── TECHNOLOGY
  │
  ├── CUSTOMERS
  │
  ├── EVENTS
  │
  ├── SIGNALS
  │
  ├── PROBLEMS
  │
  ├── GAPS
  │
  ├── TRIGGERS
  │
  ├── INTENT
  │
  └── OPPORTUNITY
          │
          ├── CONTACTS
          ├── OUTREACH
          ├── ACTIVITIES
          ├── MEETINGS
          └── DEAL
                  │
                  └── OUTCOME
```

This is an **architectural recommendation/inference**, not a confirmed existing implementation.

---

# 31. Proposed High-Level System Architecture

A reasonable architecture for the intended product is:

```text
┌───────────────────────────────────────────────────────┐
│                    EXPERIENCE LAYER                   │
│ Web App / Dashboard / Lead Pages / AI Chat / CRM     │
├───────────────────────────────────────────────────────┤
│                   AI EXPERIENCE LAYER                 │
│ Sales Agent / Research Agent / Coaching / Analysis   │
├───────────────────────────────────────────────────────┤
│                   APPLICATION LAYER                   │
│ CRM / Outreach / Teams / Pipeline / Analytics        │
├───────────────────────────────────────────────────────┤
│                 INTELLIGENCE ENGINE                   │
│ ICP / Signals / Research / Scoring / Intent          │
├───────────────────────────────────────────────────────┤
│                    AGENT PLATFORM                     │
│ Orchestration / Tools / Memory / Reasoning / QA      │
├───────────────────────────────────────────────────────┤
│                     DATA PLATFORM                     │
│ Companies / People / Signals / Events / Activities   │
│ Messages / Opportunities / Outcomes / Memory         │
├───────────────────────────────────────────────────────┤
│                   INGESTION LAYER                     │
│ APIs / Crawlers / Web / Social / Imports             │
├───────────────────────────────────────────────────────┤
│                 INTEGRATION LAYER                     │
│ Email / LinkedIn / Contact Providers / CRM / etc.   │
├───────────────────────────────────────────────────────┤
│              SECURITY / GOVERNANCE / INFRA            │
│ Multi-tenancy / RBAC / Audit / Encryption / SSO      │
└───────────────────────────────────────────────────────┘
```

**[INFERRED ARCHITECTURE]**

Claude must not assume this diagram represents currently implemented infrastructure.

---

# 32. Proposed Intelligence Pipeline

The intended engine can be understood as:

```text
USER COMPANY
     ↓
COMPANY UNDERSTANDING
     ↓
ICP ENGINE
     ↓
SOURCE RECOMMENDATION
     ↓
SOURCE MONITORING
     ↓
SIGNAL DETECTION
     ↓
COMPANY DISCOVERY
     ↓
ENTITY RESOLUTION
     ↓
DEEP RESEARCH
     ↓
PAIN DETECTION
     ↓
GAP DETECTION
     ↓
TRIGGER DETECTION
     ↓
ICP QUALIFICATION
     ↓
OPPORTUNITY SCORING
     ↓
BUYER IDENTIFICATION
     ↓
CONTACT ENRICHMENT
     ↓
WHY-NOW ANALYSIS
     ↓
OUTREACH RECOMMENDATION
     ↓
AI SALES AGENT
     ↓
OUTREACH
     ↓
RESPONSE
     ↓
MEETING
     ↓
DEAL
     ↓
OUTCOME
     ↓
LEARNING
```

The early part of this pipeline is directly supported by the original HuntLoop master context.

The complete end-to-end architecture is partially inferred from subsequent product expansion.

---

# 33. Source Abstraction Layer

A recommended technical abstraction is to normalize different information sources into common events/signals.

Conceptual event:

```json
{
  "company": "Example Company",
  "source": "example-source",
  "event_type": "hiring",
  "event_date": "2026-08-01",
  "description": "Company is hiring security engineers",
  "evidence": "...",
  "confidence": "high",
  "url": "..."
}
```

The intelligence engine should ideally not need to care whether the event originated from:

- Reddit
- LinkedIn
- X
- News
- Company website
- GitHub
- Job board
- Press release

It should consume normalized evidence/signals.

This is an **architectural recommendation**, not a confirmed schema.

---

# 34. Signal Classification

Potential signal categories:

## Company Signals

- Funding
- Hiring
- Product launch
- Expansion
- Acquisition
- Partnership
- New customer
- New market
- New technology
- Strategy change
- Security incident
- Regulatory approval

## People Signals

- Promotion
- Executive hire
- Executive departure
- Founder statement
- Relevant job change
- Public discussion of pain

## Technology Signals

- Technology adoption
- New integration
- New architecture
- GitHub activity
- Engineering initiative
- Technical documentation changes

## Market Signals

- Regulation
- Industry shift
- Competitor event
- Market expansion
- Major customer movement

These categories are derived from the examples in the product context plus reasonable architectural organization.

**[CONFIRMED concepts / categorization partly INFERRED]**

---

# 35. Web2 + Web3

HuntLoop is intended to serve both Web2 and Web3.

The recommended architecture is to have one common intelligence engine with industry-specific signal packs.

## Web2 signals may include:

- Funding
- Hiring
- Product launches
- Enterprise contracts
- Technology adoption
- Expansion
- Acquisitions
- Leadership changes
- Regulatory events
- Job postings

## Web3 signals may include:

- Token launches
- Protocol launches
- TVL changes
- Chain deployments
- Funding
- Governance activity
- GitHub activity
- Smart-contract activity
- Protocol integrations
- Exchange listings
- Wallet/infrastructure changes
- DAO activity
- Developer hiring
- Security incidents

The Web3-specific examples are **inferred extensions**, not confirmed HuntLoop requirements from the original document.

The common abstraction remains:

```text
EVENT
 ↓
SIGNAL
 ↓
CONTEXT
 ↓
INTENT
 ↓
OPPORTUNITY
```

---

# 36. AI Agent Architecture

HuntLoop should not necessarily be implemented as one monolithic AI.

A scalable architecture would separate agent capabilities.

Potential agents:

```text
Research Agent
ICP Agent
Signal Detection Agent
Qualification Agent
Contact Agent
Sales Agent
Outreach Agent
Meeting Preparation Agent
Objection Agent
Sales Coach Agent
Analytics Agent
Forecasting Agent
Competitive Intelligence Agent
```

A central orchestrator can coordinate them.

Conceptually:

```text
                    HUNTLOOP AGENT PLATFORM
                              │
                     AGENT ORCHESTRATOR
                              │
        ┌───────────────┬─────┴─────┬───────────────┐
        ↓               ↓           ↓               ↓
    Research         Sales       Analyst         Coach
      Agent          Agent        Agent          Agent
        │               │           │               │
        └───────────────┴─────┬─────┴───────────────┘
                              ↓
                         Shared Tools
                              │
                  ┌───────────┼───────────┐
                  ↓           ↓           ↓
                Search      CRM        Memory
                  │           │           │
                  └───────────┼───────────┘
                              ↓
                          Evidence
```

This is **INFERRED architecture**, not confirmed implementation.

---

# 37. Memory Architecture

Recommended memory hierarchy:

```text
GLOBAL HUNTLOOP KNOWLEDGE
        │
        ↓
ORGANIZATION MEMORY
        │
        ↓
TEAM MEMORY
        │
        ↓
USER MEMORY
        │
        ↓
ACCOUNT MEMORY
        │
        ↓
OPPORTUNITY MEMORY
```

Important:

- Global knowledge must not leak private customer information between tenants.
- Organization information must be isolated by tenant.
- Individual user information should respect organization permissions.
- Opportunity memory should contain only authorized context.

Memory should distinguish durable knowledge from temporary conversational context.

Exact implementation is **UNKNOWN**.

---

# 38. Multi-Tenancy

Because HuntLoop is intended as an enterprise platform, multi-tenancy is expected to be fundamental.

Recommended conceptual hierarchy:

```text
HuntLoop
  ↓
Organization / Tenant
  ↓
Workspace
  ↓
Teams
  ↓
Users
```

Data should carry tenant ownership and access-control metadata.

This is an **architectural requirement/inference**, not a confirmed current implementation.

---

# 39. User Roles

Expected roles may include:

```text
Organization Owner
Admin
Sales Manager
Senior BD
BDR / SDR
Junior BD
Individual Salesperson
```

Potential permissions:

- View companies
- Edit companies
- Create opportunities
- Assign opportunities
- View team activity
- Send outreach
- Configure automation
- Manage integrations
- Manage billing
- Manage organization knowledge
- Access analytics
- Manage users

Exact RBAC model is **UNKNOWN / NOT FINALIZED**.

---

# 40. Authentication & Authorization

The product will require authentication and authorization.

However, the current context does not specify:

- Authentication provider
- OAuth implementation
- Session architecture
- JWT/session strategy
- SSO provider
- MFA
- SCIM
- Enterprise identity provider support
- Exact RBAC implementation

Therefore Claude must **not assume these are already implemented**.

For an enterprise-ready architecture, SSO, RBAC, audit logs, tenant isolation, encryption, and identity lifecycle management should eventually be considered.

**[UNKNOWN implementation / INFERRED enterprise requirements]**

---

# 41. Security

Expected enterprise security requirements include:

- Tenant isolation
- Role-based access control
- Encryption in transit
- Encryption at rest
- Secure secrets management
- API authentication
- Audit logging
- Permission-aware AI retrieval
- Data retention controls
- Data export/deletion
- Secure third-party integrations
- Protection of customer sales data
- Protection of private organizational memory

The exact compliance targets are **UNKNOWN**.

Potential future requirements may include SOC 2, GDPR, regional privacy requirements, enterprise security questionnaires, etc., but these are not currently confirmed.

---

# 42. External Integrations

Explicitly mentioned or implied integrations/services include:

## Contact intelligence

- Hunter
- Apollo

## Potential data/source integrations

- LinkedIn
- X/Twitter
- Reddit
- GitHub
- News sources
- Industry publications
- Funding databases
- Job boards
- Company websites
- Government/regulatory sources
- Conference/event sites
- Podcasts
- Communities

## Future sales integrations

Potentially:

- Email
- LinkedIn
- CRM systems
- Calendar
- Other outreach channels

Exact providers, API versions, authentication methods, rate limits, quotas, costs, and implementation status are **UNKNOWN**.

---

# 43. API Architecture

No actual HuntLoop API contract has been provided in the available context.

Therefore Claude should **not invent existing endpoints**.

A reasonable future service boundary could include:

```text
/auth
/organizations
/users
/companies
/contacts
/icps
/sources
/signals
/opportunities
/research
/agents
/conversations
/outreach
/activities
/pipelines
/deals
/teams
/analytics
/memory
/integrations
/imports
/settings
```

These are **proposed API domains only**, not existing APIs.

---

# 44. Backend Responsibilities

The backend should ultimately be responsible for:

- Authentication/session management
- Authorization
- Organization/tenant isolation
- Company records
- Contact records
- ICP configuration
- Source management
- Research orchestration
- Signal processing
- Scoring
- Opportunity creation
- AI-agent orchestration
- Memory management
- Outreach execution
- Activity tracking
- CRM pipeline
- Team management
- Analytics
- Learning/feedback processing
- Integration management
- Background jobs
- Audit logging

Exact technology stack is **UNKNOWN**.

---

# 45. Frontend Responsibilities

The frontend should ultimately provide:

- Onboarding
- Company URL entry
- ICP setup/editing
- Source configuration
- Hunt dashboard
- Opportunity discovery
- Company intelligence page
- Contact view
- Lead-specific AI conversation
- Outreach composer
- CRM
- Pipeline
- Team management
- Assignments
- Analytics
- Performance dashboards
- Organization settings
- Integrations
- User settings
- Memory/knowledge management

---

# 46. Important UI/UX Expectations

The product should feel like a serious enterprise intelligence workspace.

The lead/company page should be information-rich but understandable.

Important UI concepts include:

### Opportunity Dashboard

Users should be able to quickly see:

- HOT
- WARM
- WATCH
- IGNORE
- Score
- Why-now trigger
- Recent activity
- Recommended action

### Company Page

Should surface:

- Company overview
- ICP fit
- Intelligence
- Signals
- Pain
- Gaps
- Trigger
- Evidence
- Contacts
- Outreach
- CRM state
- AI agent

### Lead-specific AI window

Every opportunity should have its own persistent conversation context.

### CRM

Pipeline-oriented workspace.

### Team dashboard

Manager view of:

- Assigned opportunities
- Activity
- Conversion
- Performance

### Analytics

Charts + AI explanations rather than charts alone.

---

# 47. Lead Detail Information Architecture

A recommended company/opportunity page:

```text
Company Header
│
├── Opportunity Score
├── ICP Fit
├── Intent
├── Priority
├── Confidence
│
├── Why This Company?
│
├── What They Do
│
├── Relevant Product
│
├── Problems
│
├── Evidence
│
├── Gaps
│
├── Recent Triggers
│
├── Why Now?
│
├── Current Approach
│
├── Potential Use Case
│
├── Decision Makers
│
├── Contact Information
│
├── Outreach
│
├── Conversation History
│
├── CRM / Pipeline
│
├── Activities
│
└── AI Sales Agent
```

This is a **UX recommendation** based on the requirements, not an existing implementation specification.

---

# 48. Background Jobs

The product is inherently asynchronous.

Likely background workloads include:

- Website research
- Source crawling
- Signal detection
- Company discovery
- Entity resolution
- Contact enrichment
- AI research
- Score calculation
- Trigger monitoring
- Scheduled source scans
- Outreach sequences
- Follow-up scheduling
- Email processing
- Analytics aggregation
- Learning jobs
- Memory updates

A queue/job architecture will likely be necessary for scale.

Exact job technology is **UNKNOWN**.

---

# 49. Continuous Monitoring

HuntLoop should eventually support ongoing monitoring.

A company is not a static record.

Conceptually:

```text
Company
 ↓
Current State
 ↓
Monitor Sources
 ↓
Detect Change
 ↓
Create Signal
 ↓
Re-evaluate Intent
 ↓
Re-score Opportunity
 ↓
Notify User
```

This allows HuntLoop to say:

> "This account wasn't particularly interesting last month. Something changed."

This directly supports the core "why now?" philosophy.

**[CONFIRMED concept / implementation UNKNOWN]**

---

# 50. Recommendation Engine

The recommendation engine should eventually recommend:

- Companies
- Signals
- Sources
- Buyers
- Outreach angles
- Timing
- Follow-ups
- Next actions

Recommendations should be explainable.

A recommendation should ideally contain:

```text
Recommendation
Reason
Evidence
Confidence
Expected value
Unknowns
```

The system should not manufacture certainty.

---

# 51. Scoring Architecture

A conceptual score can be represented as multiple dimensions rather than one opaque number:

```text
ICP Fit
Problem Severity
Evidence Strength
Trigger Strength
Trigger Freshness
Buying Likelihood
Product Relevance
Decision-Maker Accessibility
```

A final priority classification can then become:

```text
HOT
WARM
WATCH
IGNORE
```

A numeric score such as "92/100" is part of the conceptual product example, but the exact scoring formula is **NOT DEFINED**.

Claude must not invent arbitrary weights and treat them as official HuntLoop logic.

---

# 52. Evidence Architecture

Every important intelligence claim should ideally preserve:

```text
Source
Source URL
Observed date
Event date
Extracted evidence
Claim
Confidence
Fact / Inference / Unknown
```

This allows the AI agent to answer:

> "Why do you think this?"

with evidence rather than unsupported reasoning.

This is a key architectural recommendation derived from the evidence-first philosophy.

---

# 53. Learning Loop

The long-term learning architecture should connect:

```text
SIGNAL
 ↓
COMPANY
 ↓
OPPORTUNITY
 ↓
OUTREACH
 ↓
RESPONSE
 ↓
MEETING
 ↓
OPPORTUNITY
 ↓
DEAL
 ↓
REVENUE
```

Then learn:

```text
Which signals work?
Which sources work?
Which ICPs work?
Which triggers work?
Which messages work?
Which channels work?
Which users perform best?
Which buyers convert?
```

This creates an outcome-based intelligence loop.

---

# 54. Global vs Private Learning

This distinction is critical.

HuntLoop may learn globally from aggregate patterns, but it must not expose private customer data to another customer.

For example:

```text
CUSTOMER A
Private sales data
        ↓
Private memory
        ↓
Private learning
```

should remain isolated.

If HuntLoop later uses aggregate learning globally, it should be based on appropriately governed/authorized data and should not leak customer-specific confidential information.

Exact privacy/learning architecture is **UNKNOWN**.

---

# 55. Subscription Model

Potential subscription tiers have been discussed.

Original pricing hypothesis:

```text
Starter:
$99–199/user/month

Professional:
$299–499/user/month

Enterprise:
Custom
```

However:

> **These prices are NOT finalized.**

They must not be treated as current pricing.

The user expects higher subscription tiers to unlock features such as:

- Outreach automation
- Advanced scraping/source access
- Advanced AI capabilities
- Team functionality
- Performance analytics
- Enterprise functionality

Exact packaging is **UNKNOWN**.

Pricing should eventually be validated against willingness to pay and competitors.

---

# 56. Feature Packaging Hypothesis

A possible packaging model is:

## Core

- Company intelligence
- ICP
- Hunt
- Signals
- Opportunity scoring
- Company pages
- Basic AI sales agent

## Professional

- Advanced research
- More sources
- Contact enrichment
- CRM
- Advanced AI agent
- Outreach
- Analytics
- User memory

## Team

- Junior BDs
- Assignment
- Team analytics
- Manager dashboards
- Organization memory
- Advanced automation

## Enterprise

- SSO
- Advanced permissions
- Enterprise security
- Custom integrations
- High-scale research
- Custom data
- Advanced governance
- Enterprise support

This is **INFERRED packaging**, not finalized pricing/product tiers.

---

# 57. Enterprise Scalability

The product vision implies potentially:

- Large numbers of organizations
- Large numbers of users
- Millions of companies
- Large contact datasets
- Large volumes of source data
- High-frequency signal monitoring
- Large volumes of AI calls
- Large activity/message histories

Architecture should therefore anticipate:

- asynchronous processing
- caching
- batching
- deduplication
- rate limiting
- retries
- idempotency
- queue-based workers
- observability
- partitioning/sharding where needed
- efficient search
- vector/semantic retrieval where appropriate
- cost controls for AI calls

These are **engineering recommendations**, not confirmed existing architecture.

---

# 58. Reliability

Expected reliability patterns:

### External source failure

Do not fail the entire hunt.

```text
Source A unavailable
Source B available
Source C available
        ↓
Continue
        ↓
Mark source A unavailable
        ↓
Retry later
```

### AI failure

AI calls should support:

- retry
- timeout
- fallback
- partial result handling
- provenance preservation

### Contact provider failure

Try another configured provider if permitted.

### Duplicate company

Resolve/deduplicate rather than create uncontrolled duplicates.

### Conflicting information

Preserve evidence and confidence instead of arbitrarily overwriting.

These are **recommended behaviors**.

---

# 59. Entity Resolution

HuntLoop will likely encounter the same company through:

- Website
- LinkedIn
- News
- Reddit
- X
- GitHub
- Funding database
- User-uploaded list

These should resolve to a common company entity where possible.

Conceptually:

```text
Example Inc.
example.com
linkedin.com/company/example
github.com/example
news article
       ↓
ENTITY RESOLUTION
       ↓
One Company
```

Exact matching algorithm is **UNKNOWN**.

---

# 60. Deduplication

The same:

- company
- person
- event
- signal
- source
- message

should not unnecessarily create duplicate records.

Deduplication should consider:

- canonical URL
- domain
- provider IDs
- source IDs
- normalized company name
- email
- LinkedIn URL
- timestamps
- event similarity

Exact rules are **UNKNOWN**.

---

# 61. Import Architecture

For user-provided lists, imports should ideally support:

```text
Upload
 ↓
Validate
 ↓
Parse
 ↓
Preview
 ↓
Map columns
 ↓
Deduplicate
 ↓
Entity resolve
 ↓
Import
 ↓
Research
```

Users should know when processing is incomplete.

This is an **inferred UX/engineering recommendation**.

---

# 62. AI Sales Agent Safety Rules

The AI sales agent should:

1. Never fabricate company facts.
2. Never fabricate customer claims.
3. Distinguish fact from inference.
4. Cite or identify evidence when making important claims.
5. Respect organization-specific instructions.
6. Respect user permissions.
7. Avoid exposing private data.
8. Avoid confidently claiming unknown information.
9. Warn users when a proposed message contains an unsupported claim.
10. Prefer evidence-backed personalization.

These requirements follow directly from the product's evidence-first philosophy.

---

# 63. Outreach Quality Principle

The AI should optimize for **relevance**, not message volume.

Bad:

> "Hi John, I saw your company is growing. We help companies like yours..."

Better:

> Specific reference to a verified event + specific problem + relevant value proposition.

The system should help users understand:

- What to write
- What not to write
- Why the message works
- What evidence supports personalization
- What claim is speculative
- What follow-up is appropriate

---

# 64. CRM + Intelligence Relationship

The CRM should not become a separate silo.

The desired architecture is:

```text
CRM
 ↕
Company Intelligence
 ↕
Signals
 ↕
AI Agent
 ↕
Outreach
 ↕
Activities
 ↕
Deals
 ↕
Analytics
```

Everything should feed everything else where appropriate.

For example:

A new signal should be capable of changing an opportunity's relevance.

A new response should update opportunity context.

A closed deal should feed the learning system.

---

# 65. HuntLoop as a Sales Operating System

The mature product can be thought of as:

```text
DISCOVER
    ↓
RESEARCH
    ↓
QUALIFY
    ↓
UNDERSTAND
    ↓
CONTACT
    ↓
CONVERSE
    ↓
MANAGE
    ↓
MEASURE
    ↓
LEARN
```

This is the intended long-term product evolution.

---

# 66. Existing Competitive Context

Relevant categories include:

## Lead Databases

- ZoomInfo
- Apollo
- Lusha
- Seamless.ai

## Sales Intelligence

- LinkedIn Sales Navigator
- 6sense
- Demandbase
- Clearbit/Breeze

## Data Enrichment

- Clay
- Clearbit
- People Data Labs

## Intent / Signals

- 6sense
- Bombora
- G2 Buyer Intent
- Common Room

## AI Sales Agents

- 11x
- Artisan
- AiSDR
- Regie.ai
- Outreach
- Salesloft

HuntLoop should not blindly compete with all of these.

The intended distinction is:

> Existing systems often help salespeople FIND prospects.

> HuntLoop should help salespeople UNDERSTAND WHY a prospect is currently worth contacting.

**[CONFIRMED]**

---

# 67. What HuntLoop Should NOT Become

Avoid turning HuntLoop into:

### 1. A scraping company

Scraping is infrastructure.

### 2. A contact database

Contact data is a dependency/input.

### 3. A generic CRM

CRM is one component of the system.

### 4. A generic AI chatbot

The AI needs deep structured context.

### 5. An AI spam generator

High-volume irrelevant outreach would undermine the product.

### 6. An opaque scoring system

Users must understand why a company scored highly.

### 7. A generic Web2-only product

The architecture should support Web2 and Web3.

---

# 68. Recommended Development Strategy

Because the full vision is extremely large, development should be staged.

## Phase 1 — Intelligence Core

Build:

```text
Company URL
 ↓
Company Understanding
 ↓
ICP
 ↓
Source Discovery
 ↓
Signal Detection
 ↓
Research
 ↓
Pain/Gaps
 ↓
Trigger
 ↓
Opportunity Score
 ↓
Why Now
 ↓
Buyer
```

Then build the core company/opportunity page.

Goal:

> Prove that HuntLoop can identify better opportunities than ordinary lead databases.

---

## Phase 2 — AI Sales Workspace

Add:

- Lead-specific AI agent
- Conversation context
- Company memory
- User memory
- CRM
- Activity timeline
- Research assistant
- Message generation
- Objection handling
- Meeting preparation

Goal:

> Make HuntLoop something salespeople work inside every day.

---

## Phase 3 — Execution

Add:

- Email
- LinkedIn
- Sequences
- Follow-ups
- Contact enrichment
- Automation

Goal:

> Move from "this is a good opportunity" to "let's act."

---

## Phase 4 — Team Operating System

Add:

- Team roles
- Lead assignment
- Junior BDs
- Manager dashboards
- Performance analytics
- AI sales coaching

Goal:

> Sell to organizations rather than only individuals.

---

## Phase 5 — Learning System

Connect:

```text
Signal
 ↓
Opportunity
 ↓
Outreach
 ↓
Response
 ↓
Meeting
 ↓
Deal
 ↓
Revenue
 ↓
Learning
```

Goal:

> HuntLoop gets better as customers use it.

---

# 69. Potential Long-Term Moat

The strongest intended moat is **not**:

- More scraped data
- More contacts
- More AI prompts
- More generic automation

The stronger moat is:

> **HuntLoop Sales Intelligence Graph + Outcome Learning**

Over time HuntLoop could learn relationships such as:

```text
Company characteristics
        +
Signals
        +
Timing
        +
Problems
        +
Buyer characteristics
        +
Outreach approach
        +
Channel
        ↓
Probability of response
        ↓
Probability of meeting
        ↓
Probability of opportunity
        ↓
Probability of conversion
```

This is a long-term hypothesis, not a currently proven moat.

---

# 70. Core Data Entities

The following are the conceptual entities currently implied by the product.

```text
Organization
User
Team
Role
Permission

Company
CompanyProduct
CompanyTechnology
CompanyEvent
CompanySignal
CompanyProblem
CompanyGap
CompanyTrigger

ICP
ICPRule
ICPVersion

Source
SourceType
SourceDocument
SourceEvent
Evidence

Contact
ContactRole
ContactEnrichment

Opportunity
OpportunityScore
OpportunityAssessment

Conversation
Message
Outreach
OutreachSequence
OutreachStep
Activity

Pipeline
PipelineStage
Deal

Task
Assignment

Memory
OrganizationMemory
UserMemory
AccountMemory
OpportunityMemory

Integration
ProviderCredential

AnalyticsEvent
Outcome
LearningSignal
```

This is a **proposed conceptual data model**, not an existing schema.

---

# 71. Important Relationships

Conceptually:

```text
Organization
 ├── Users
 ├── Teams
 ├── ICPs
 ├── Companies
 ├── Opportunities
 ├── Pipelines
 └── Memory

Company
 ├── Contacts
 ├── Products
 ├── Technologies
 ├── Events
 ├── Signals
 ├── Problems
 ├── Gaps
 ├── Triggers
 └── Opportunities

Opportunity
 ├── Company
 ├── Contacts
 ├── Scores
 ├── Evidence
 ├── Signals
 ├── Conversations
 ├── Outreach
 ├── Activities
 ├── Tasks
 ├── Deal
 └── AI Memory
```

---

# 72. Important Fields for Intelligence Objects

A signal/event should ideally have:

```text
id
company_id
source_id
source_url
event_type
event_date
observed_at
description
evidence
confidence
fact_or_inference
freshness
relevance
created_at
```

A company should potentially have:

```text
id
canonical_domain
name
website
industry
location
size
funding
business_model
description
products
services
customers
technology
leadership
created_at
updated_at
last_researched_at
```

An opportunity should potentially have:

```text
id
company_id
icp_id
score
priority
icp_fit
problem_severity
evidence_strength
trigger_strength
trigger_freshness
buying_likelihood
product_relevance
decision_maker_accessibility
why_this_company
identified_problem
potential_gap
why_now
outreach_angle
confidence
status
owner_id
created_at
updated_at
```

These are **recommended schemas**, not existing confirmed database definitions.

---

# 73. Configuration & Environment Variables

No actual environment variable names have been provided.

Do not assume existing names.

Expected categories may eventually include:

```text
DATABASE_URL
AUTH configuration
AI model/provider credentials
SEARCH provider credentials
CRAWLER credentials
HUNTER credentials
APOLLO credentials
EMAIL provider credentials
LINKEDIN integration credentials
X/Twitter credentials
REDDIT credentials
STORAGE configuration
QUEUE configuration
CACHE configuration
OBSERVABILITY configuration
ENCRYPTION/secrets configuration
```

These are **categories only**.

Claude should inspect the existing codebase before creating or renaming environment variables.

---

# 74. Technical Stack

The provided HuntLoop context does **NOT** specify the existing:

- Frontend framework
- Backend framework
- Programming language
- Database
- ORM
- Search engine
- Vector database
- Queue
- Cache
- Cloud provider
- Container platform
- AI provider
- Deployment platform
- Monitoring platform

Therefore:

> **Do not invent or assume the current technical stack.**

Claude should inspect the existing repository and preserve established conventions unless there is a compelling reason to change them.

**[UNKNOWN]**

---

# 75. Existing Implementation Status

The available context does not provide actual HuntLoop source code or a reliable inventory of implemented modules.

Therefore the following should be treated as **product requirements/concepts**, not guaranteed implementation:

- CRM
- Outreach
- AI sales agent
- Scraping
- Contact enrichment
- Team management
- Performance analytics
- Memory
- Learning system
- Web3 signals
- Enterprise RBAC
- Enterprise SSO
- APIs
- Background workers

Claude should inspect the actual repository before claiming any feature is implemented.

**[UNKNOWN]**

---

# 76. Important Development Rule for Claude

When continuing development:

### DO

- Preserve existing working code.
- Inspect the repository before redesigning architecture.
- Treat this document as product intent.
- Treat existing source code as implementation truth.
- Separate confirmed requirements from assumptions.
- Ask for clarification when a decision materially affects architecture.
- Prefer modular services/components.
- Maintain tenant isolation.
- Preserve provenance of intelligence.
- Make AI reasoning evidence-driven.
- Make scoring explainable.
- Keep user/company memory isolated.
- Design for asynchronous processing.
- Log important events.
- Build observability into background processes.

### DO NOT

- Assume a proposed schema already exists.
- Assume an API integration is already connected.
- Invent API credentials.
- Invent existing endpoints.
- Invent database tables.
- Replace working architecture without inspecting it.
- Turn inference into factual data.
- Create fake precision in scoring.
- Treat scraping as the product.
- build everything simultaneously without validating the intelligence core.

---

# 77. Important Business Logic Principles

## Principle 1 — Evidence First

Important claims should have supporting evidence.

## Principle 2 — Signal First

Recent events should receive meaningful priority.

## Principle 3 — Why Now

Every strong opportunity should have a reason it matters now.

## Principle 4 — Explainability

Scores and recommendations should be explainable.

## Principle 5 — High Precision

Prefer fewer excellent opportunities.

## Principle 6 — Fact vs Inference

Never silently convert inference into fact.

## Principle 7 — User Control

Users should be able to review/edit ICPs and sources.

## Principle 8 — Continuous Learning

Outcomes should improve future recommendations.

## Principle 9 — Contextual AI

AI must understand the specific company, user, organization and interaction history.

## Principle 10 — Intelligence Before Automation

Automation should execute intelligence, not replace it.

---

# 78. Important Edge Cases

The system should eventually handle:

### Company not found

Return a clear failure state rather than fabricating information.

### Website inaccessible

Use other available sources where appropriate and disclose incomplete research.

### Conflicting company information

Preserve multiple sources and confidence.

### No strong signals

Mark the company WATCH rather than forcing a HOT classification.

### No verified decision-maker

State that buyer identification is incomplete.

### Contact data unavailable

Do not fabricate contact details.

### Old signal

Reduce freshness/relevance.

### Weak ICP fit

Do not allow a strong trigger to automatically make a poor-fit company HOT.

### Strong ICP but no trigger

Potentially WATCH/WARM depending on evidence.

### Strong trigger but unclear problem

Do not claim buying intent without evidence.

### Duplicate company

Resolve to existing entity where possible.

### Duplicate signal

Deduplicate.

### AI uncertainty

Communicate uncertainty.

### External source failure

Continue other research where possible and retry later.

### Third-party API failure

Return partial results rather than blocking the entire workflow.

### Outreach failure

Record the failure and do not falsely mark the message as sent.

### User permissions

AI retrieval must respect the same permissions as the underlying data.

These are **recommended behaviors** unless explicitly implemented differently in the existing codebase.

---

# 79. Observability

A production HuntLoop system should eventually track:

- Research jobs
- Source failures
- AI calls
- AI latency
- AI cost
- Signal processing
- Company resolution
- Contact enrichment
- Outreach delivery
- API failures
- Queue latency
- User actions
- Errors
- Learning jobs

Useful dimensions include:

```text
organization_id
user_id
job_id
company_id
opportunity_id
source_id
integration_id
timestamp
status
duration
error
```

Exact observability tooling is **UNKNOWN**.

---

# 80. Performance Strategy

Potential high-cost operations include:

- Web research
- Crawling
- AI reasoning
- Embeddings
- Contact enrichment
- Continuous monitoring
- Large imports

Therefore the architecture should consider:

- caching
- batching
- deduplication
- asynchronous queues
- rate limiting
- incremental research
- event-driven updates
- model selection based on task complexity
- storing reusable research
- avoiding unnecessary repeated AI calls

These are **engineering recommendations**.

---

# 81. Research Freshness

Freshness is especially important because HuntLoop's differentiation is "why now."

Research records should ideally track:

```text
observed_at
published_at
last_verified_at
last_researched_at
```

A six-month-old signal should not be treated the same as a signal from yesterday.

Exact freshness decay logic is **UNKNOWN**.

---

# 82. Opportunity Lifecycle

A conceptual opportunity lifecycle:

```text
DISCOVERED
    ↓
RESEARCHING
    ↓
QUALIFIED
    ↓
HOT / WARM / WATCH
    ↓
ASSIGNED
    ↓
CONTACTED
    ↓
REPLIED
    ↓
MEETING
    ↓
OPPORTUNITY
    ↓
PROPOSAL
    ↓
WON / LOST
```

The exact statuses are not finalized.

---

# 83. AI Sales Agent Conversation Lifecycle

A lead-specific AI conversation should ideally have access to:

```text
Current Company Intelligence
+
Current Opportunity State
+
Historical Research
+
Evidence
+
Contact Information
+
Outreach History
+
Meeting History
+
CRM State
+
Organization Memory
+
User Memory
+
Product Knowledge
```

The agent should be able to answer questions and perform permitted actions.

Future tool capabilities may include:

```text
Search company
Research web
Get latest signals
Read CRM
Read outreach
Draft message
Create task
Update CRM
Prepare meeting brief
Analyze response
Recommend next step
```

Exact tool architecture is **UNKNOWN / INFERRED**.

---

# 84. The Core Product Loop

The single most important product loop remains:

```text
CUSTOMER SIGNAL
      ↓
DISCOVER COMPANY
      ↓
UNDERSTAND COMPANY
      ↓
IDENTIFY PROBLEM
      ↓
IDENTIFY GAP
      ↓
IDENTIFY TRIGGER
      ↓
QUALIFY AGAINST ICP
      ↓
FIND BUYER
      ↓
EXPLAIN WHY NOW
      ↓
GENERATE ACTION
      ↓
OUTREACH
      ↓
RESPONSE
      ↓
DEAL
      ↓
LEARN
```

This should remain the conceptual backbone even as additional modules are added.

---

# 85. What Is Confirmed vs Inferred vs Unknown

## CONFIRMED

The following are explicitly established product requirements/directions:

- HuntLoop is a B2B sales intelligence and lead-discovery platform.
- It is separate from Aeredium/AER360.
- Its core problem is identifying companies that actually need a product now.
- It focuses on signals, context, intent and opportunities.
- The fundamental unit is a qualified opportunity with evidence.
- Company research begins from a company website.
- HuntLoop creates/helps create an ICP.
- Users can review/edit ICPs.
- HuntLoop recommends sources based on ICP.
- Users can accept/remove/add sources.
- HuntLoop hunts selected sources.
- HuntLoop must research discovered companies.
- HuntLoop identifies problems, gaps, triggers and buying signals.
- HuntLoop prioritizes recent events.
- HuntLoop should explain why-now.
- HuntLoop should produce opportunity intelligence.
- HuntLoop distinguishes fact/inference/unknown.
- HuntLoop scores opportunities using multiple dimensions.
- Scores should be explainable.
- HuntLoop uses HOT/WARM/WATCH/IGNORE conceptual prioritization.
- HuntLoop should not primarily be positioned as scraping or another Apollo.
- HuntLoop should prioritize evidence and precision.
- Users can paste a company URL for analysis.
- Users can bring their own company lists.
- Users should have lead-specific AI sales conversations.
- Higher tiers may provide outreach automation.
- Social/public-source research is part of the intended product.
- HuntLoop should have CRM capabilities.
- HuntLoop should have team/junior-BD functionality.
- HuntLoop should have performance analytics.
- HuntLoop should record outreach history.
- HuntLoop should learn from sales outcomes.
- Organizations should have memory.
- Individual users should have memory.
- HuntLoop is intended for Web2 and Web3.
- The product should evolve into a broader sales operating system.
- HuntLoop should become more valuable as it accumulates context and outcomes.

---

# 86. INFERRED / RECOMMENDED

The following are strong architectural/product recommendations but are not confirmed existing implementation:

- Sales Intelligence Graph
- Separate ingestion layer
- Source abstraction layer
- Normalized signal/event schema
- Agent orchestration layer
- Multiple specialized agents
- Global/org/user/account/opportunity memory hierarchy
- Queue-based background processing
- Event-driven architecture
- Dedicated contact intelligence service
- Dedicated learning pipeline
- Multi-tenant architecture
- Fine-grained RBAC
- SSO/SCIM for enterprise
- Evidence/provenance objects
- Confidence scoring
- Entity resolution
- Advanced deduplication
- Asynchronous research
- Caching
- Search/indexing layer
- AI cost optimization
- Detailed observability
- Web2/Web3 signal packs
- Intelligence-native CRM
- Outcome-based learning
- AI coaching
- AI-generated analytics insights

Claude should implement these only after considering the actual existing codebase.

---

# 87. UNKNOWN / MISSING INFORMATION

The current context does not establish:

## Technical Stack

- Frontend framework
- Backend framework
- Programming language
- Database
- ORM
- Search infrastructure
- Vector database
- Cache
- Queue
- Cloud
- Hosting
- Deployment
- CI/CD
- Monitoring

## Existing Code

- Current implementation
- Existing database schema
- Existing APIs
- Existing services
- Existing components
- Existing agents
- Existing background workers
- Existing integrations

## Authentication

- Auth provider
- OAuth
- SSO
- MFA
- Session architecture
- SCIM

## Exact APIs

- HuntLoop API endpoints
- API versions
- Webhooks
- External API schemas

## Integrations

- Which providers are already connected
- API keys
- Quotas
- Billing
- Rate limits
- Fallbacks

## Scoring

- Exact formula
- Exact weights
- Thresholds
- Freshness decay
- Confidence calculations

## Pricing

- Final pricing
- Final plan names
- Feature gates
- Usage limits

## Compliance

- SOC 2
- GDPR requirements
- Data residency
- Industry-specific compliance

## Outreach

- Exact channels
- Exact provider
- Automation limits
- Approval workflows
- Sending infrastructure
- Compliance requirements

## Learning

- Exact ML approach
- Whether learning means rules, statistical models, LLM feedback, fine-tuning, RAG, or another mechanism
- How global learning is isolated from customer data
- Evaluation methodology

## Product Design

- Final UI
- Brand system
- Navigation
- Exact screens
- Design system
- Mobile strategy

These should not be fabricated.

---

# 88. Most Important Instruction to Continuing Developers

HuntLoop should be developed around this principle:

> **Do not build a collection of unrelated sales features. Build one connected intelligence system.**

Every major feature should feed the central loop.

For example:

### CRM

Should feed intelligence.

### Outreach

Should feed learning.

### Responses

Should feed opportunity qualification.

### Meetings

Should feed outcome learning.

### User memory

Should improve recommendations.

### Team analytics

Should reveal what works.

### Social research

Should generate signals.

### Contact enrichment

Should connect opportunities to buyers.

### AI sales agent

Should sit on top of all of this context.

The system should therefore feel like one coherent product rather than:

> CRM + scraper + chatbot + email tool + analytics dashboard.

---

# 89. Ultimate HuntLoop Architecture

The mature product can be conceptualized as:

```text
                         HUNTLOOP
               AI SALES OPERATING SYSTEM
                              │
     ┌────────────────────────┼────────────────────────┐
     │                        │                        │
 DISCOVER                   UNDERSTAND               EXECUTE
     │                        │                        │
 Sources                   Research                 Outreach
 Signals                   Intelligence             Email
 Companies                 Pain/Gaps                LinkedIn
 ICP                       Triggers                 Sequences
 Intent                    Buyers                   Follow-ups
     │                        │                        │
     └────────────────────────┼────────────────────────┘
                              │
                           MANAGE
                              │
                  CRM / Pipeline / Teams
                              │
                           ASSIST
                              │
                    AI Sales Agent
                              │
                           MEASURE
                              │
                    Performance Analytics
                              │
                            LEARN
                              │
              ┌───────────────┼────────────────┐
              │               │                │
           GLOBAL           ORG             USER
           LEARNING        MEMORY           MEMORY
              │               │                │
              └───────────────┼────────────────┘
                              ↓
                     BETTER INTELLIGENCE
                              ↓
                     BETTER OPPORTUNITIES
                              ↓
                       BETTER OUTCOMES
                              ↓
                         MORE LEARNING
```

---

# 90. Final Product Definition

The most complete current definition of HuntLoop is:

> **HuntLoop is an AI-native Sales Operating System for Web2 and Web3 sales teams. It discovers companies exhibiting relevant buying signals, researches and understands their business, identifies problems and gaps, qualifies them against an ICP, determines why they may need a solution now, identifies relevant buyers, and provides evidence-backed sales intelligence. It then allows salespeople to interact with a lead-specific AI sales agent, execute and track outreach, manage the opportunity through an integrated CRM, collaborate with sales teams, measure performance, and continuously improve through organization-level and user-level memory and outcome-based learning.**

The long-term strategic objective is to make HuntLoop the place where a salesperson can go from:

```text
"I need customers."
```

to:

```text
"Here are the companies that need me."
```

to:

```text
"Here is why they need me."
```

to:

```text
"Here is who I should talk to."
```

to:

```text
"Here is exactly what I should say."
```

to:

```text
"Let's contact them."
```

to:

```text
"Let's manage the deal."
```

to:

```text
"Let's learn why this worked."
```

That is the intended end-state of HuntLoop.

---

# 91. Source / Context Boundary

This document is based on the HuntLoop master context supplied by the product owner and the subsequent product/architecture discussion.

The original master context explicitly establishes HuntLoop's core thesis, target users, onboarding, ICP, source discovery, hunt engine, intelligence layer, triggers, opportunity output, fact/inference/unknown model, scoring, prioritization, differentiation, business-model hypothesis, product philosophy, long-term vision, and desired strategic partnership. 
The subsequent expansion in this document incorporates the additional requirements described by the product owner in the conversation, including outreach automation, social information collection, lead-specific AI agents, team/junior-BD management, performance analytics, CRM, direct URL analysis, self-learning, user-specific memory, custom company lists, complete outreach history, and Web2/Web3 expansion.

Where the available context does not specify an implementation detail, this document intentionally labels it **UNKNOWN** or **INFERRED** rather than inventing an answer.

---

# 92. Developer Rule of Record

When there is a conflict between:

1. This product-context document,
2. The existing HuntLoop repository,
3. A new explicit requirement from the product owner,

use the following interpretation:

```text
Existing code
    ↓
reveals current implementation

This document
    ↓
defines product intent and known requirements

New explicit product-owner instruction
    ↓
may update product intent
```

Do not assume that a product requirement described here is already implemented.

Do not remove working functionality simply because the architecture described here is cleaner.

Do not silently invent missing requirements.

When architectural ambiguity materially affects implementation, surface the ambiguity rather than pretending certainty.

---

## END OF HUNTLOOP MASTER CONTEXT