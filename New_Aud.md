The migrations are now complete.

Now perform a **full, end-to-end audit of HuntLoop** and create the plan for turning the current system into a significantly stronger, cleaner, more automated, reliable, scalable, and production-ready platform.

Do not treat this as a simple bug-fixing exercise.

Audit the entire product, architecture, workflows, data model, integrations, AI systems, jobs, UX, and operational setup. Identify anything that is incomplete, fragile, duplicated, overly complicated, poorly connected, unnecessary, missing, or capable of being designed better.

Use the existing HuntLoop architecture and previous audit work as the starting point. **Do not rebuild functionality simply because another product such as Explee implements it differently. Preserve existing HuntLoop systems that are already well-designed and improve or extend them instead.**

Also revisit everything we learned from analyzing **Explee**, but treat Explee as inspiration and competitive research rather than something HuntLoop should copy blindly.

The goal is to determine:

**What should HuntLoop keep?
What should HuntLoop improve?
What is genuinely missing?
What should be simplified?
What should be automated?
What should be removed?
What should be rebuilt?
What should be added to make HuntLoop substantially better than it is today?**

## Apollo integration

Integrate **Apollo as the primary company-search and company-discovery provider**.

Design Apollo so it plugs into HuntLoop's existing pipeline rather than replacing systems that already work.

The intended flow should roughly become:

**ICP / search intent
→ Apollo company discovery
→ entity matching + deduplication
→ company record
→ enrichment
→ AI/company research
→ qualification
→ explainable scoring
→ opportunity creation
→ contact discovery
→ contact ranking
→ outreach recommendation
→ drafting / approval / sending
→ reply + outcome tracking
→ learning loop
→ improved future discovery and scoring**

Audit and design every part of this flow.

Apollo should be considered primarily a **data/discovery provider**, while HuntLoop should continue owning its intelligence, qualification, evidence, scoring, workflows, learning, and decision-making layers.

Plan for:

* Apollo organization/company search
* ICP-to-Apollo query translation
* filters and segmentation
* pagination
* result limits
* API quotas
* credits
* rate limits
* cost controls
* request batching
* caching
* incremental discovery
* avoiding repeated API calls
* retries
* exponential backoff
* timeout handling
* partial failures
* provider outages
* invalid or incomplete results
* provider-specific metadata
* provider abstraction
* future provider fallback
* usage telemetry
* per-organization quotas
* discovery budgets
* admin visibility into API usage

Do not tightly couple HuntLoop's core architecture to Apollo.

Apollo should be replaceable later without rewriting the core product.

---

# Audit every major subsystem

Review at minimum:

### Discovery

* company search
* ICP-driven discovery
* source-based discovery
* natural-language search
* discovery filters
* saved searches
* recurring discovery
* discovery freshness
* discovery history
* incremental searches
* discovery ranking
* discovery explainability

### Company intelligence

* company profiles
* enrichment
* research
* evidence
* sources
* confidence
* industry
* company size
* geography
* technology
* funding
* hiring signals
* growth signals
* trigger events
* buying signals
* intent signals
* why-this-company
* why-now

### Competitor intelligence

The previous Explee analysis exposed this as a meaningful HuntLoop gap.

Design a real competitor-intelligence system rather than keeping competitors as simple names.

Consider:

* competitor discovery
* competitor profiles
* positioning
* differentiators
* products
* customer examples
* target markets
* pricing when discoverable
* strengths/weaknesses where evidence supports them
* overlapping ICPs
* market positioning
* competitor mentions as sales signals
* evidence and source tracking

Decide where this belongs in onboarding and the main HuntLoop navigation.

### ICP system

Audit whether ICPs contain enough information to drive high-quality discovery and qualification.

Consider:

* ICP versions
* segments
* personas
* industries
* geography
* company size
* technologies
* triggers
* exclusions
* pain points
* use cases
* buying signals
* negative signals
* example companies
* competitor relationships
* estimated addressable-company count
* estimated market size
* confidence
* evidence
* ICP quality score

Determine how an ICP should translate into Apollo discovery queries without losing HuntLoop's richer qualification logic.

### Contacts

Audit:

* contact discovery
* enrichment
* decision-maker identification
* title matching
* seniority
* persona matching
* department
* email confidence
* email verification
* LinkedIn
* contact freshness
* duplicate contacts
* employment changes
* multiple contacts per account

Add a proper concept of:

**Best contact → contact-fit score → why this person → recommended outreach angle.**

Do not rely on a simple `is_decision_maker` boolean.

### Qualification and scoring

Preserve HuntLoop's existing explainable scoring architecture where it is already strong.

Audit:

* scoring dimensions
* rules
* model scores
* rule traces
* confidence
* unknown values
* negative signals
* exclusions
* score recalculation
* score versioning
* historical scores
* score drift
* human overrides
* scoring feedback
* explainability

Do not collapse deterministic rule scoring and AI scoring into one opaque number.

### Evidence and provenance

Evidence should remain a core HuntLoop differentiator.

Audit:

* claim → source relationships
* source freshness
* source reliability
* citations
* confidence
* contradictory evidence
* stale evidence
* evidence deduplication
* AI hallucination prevention
* provenance through the pipeline

Every important AI-generated claim should be traceable whenever possible.

### Entity resolution and duplicates

Design robust company/contact identity handling.

Audit:

* canonical domains
* redirects
* parent/subsidiary relationships
* alternate domains
* company renames
* acquisitions
* duplicate Apollo records
* duplicate source discoveries
* duplicate opportunities
* duplicate contacts
* fuzzy matching
* manual merge
* merge history
* provider IDs

HuntLoop should ideally maintain its own internal canonical entity IDs and treat Apollo IDs as external identifiers.

### Opportunity lifecycle

Audit the complete lifecycle:

Discovery
→ Candidate
→ Qualified
→ Opportunity
→ Research
→ Contact selected
→ Drafted
→ Approved
→ Sent
→ Engaged
→ Meeting
→ Won / Lost / Disqualified

Check whether states are explicit, consistent, recoverable, measurable, and easy for users to understand.

### Outreach

Audit:

* message generation
* evidence-based personalization
* recommended angle
* channel selection
* drafts
* approval
* sending
* sequences
* follow-ups
* reply detection
* unsubscribe handling
* suppression lists
* contact frequency limits
* campaign limits
* failure states

Preserve human approval where appropriate instead of forcing full autonomy.

### AI architecture

Review every AI task.

Look for:

* duplicated prompts
* inconsistent schemas
* weak validation
* unnecessary LLM calls
* expensive calls
* missing caching
* missing retries
* hallucination risks
* poor grounding
* missing evidence
* bad context construction
* excessive token use
* missing model evaluation
* missing AI observability

Create a clear separation between:

**data retrieval
→ deterministic processing
→ AI reasoning
→ evidence validation
→ persisted result**

Do not use AI for logic that can be deterministic.

### Learning loop

Audit whether HuntLoop genuinely becomes better from outcomes.

Review:

* user corrections
* score overrides
* positive/negative outcomes
* reply quality
* meetings
* conversions
* losses
* disqualification reasons
* accepted/rejected AI findings
* scoring-rule suggestions
* ICP improvements
* persona improvements
* discovery improvements

The ideal system should improve:

**who HuntLoop finds
→ how HuntLoop ranks them
→ who it recommends contacting
→ what outreach angle it proposes.**

### Jobs and automation

Audit the entire asynchronous engine:

* job creation
* queues
* priorities
* scheduling
* concurrency
* retries
* retry policies
* exponential backoff
* idempotency
* deduplication
* stuck jobs
* dead-letter handling
* cancellation
* timeouts
* job dependencies
* partial failures
* job history
* observability
* per-org fairness
* backlog limits

Ensure jobs can safely run more than once.

### Data architecture

Audit every relevant table, relation, JSONB field, constraint, index, and query pattern.

Look for:

* missing foreign keys
* missing indexes
* unused indexes
* duplicated data
* unnecessary JSONB
* fields that should be normalized
* fields that should remain flexible
* weak constraints
* inconsistent enums
* missing timestamps
* missing provenance
* missing audit history
* N+1 queries
* inefficient joins
* expensive scans
* race conditions

### API architecture

Review:

* API boundaries
* server actions
* internal services
* jobs
* provider adapters
* authentication
* authorization
* pagination
* filtering
* validation
* error contracts
* versioning
* idempotency
* rate limiting

Prevent provider-specific implementation details from leaking throughout the application.

### Reliability

Find every workflow that can become stuck or silently fail.

Audit:

* recovery
* retries
* consistency
* concurrency
* race conditions
* stale state
* external API failures
* partial writes
* duplicate jobs
* network interruptions
* webhook duplication
* timeout recovery

### Observability

Design proper visibility into production.

Include:

* structured logging
* error tracking
* job monitoring
* provider usage
* Apollo usage
* AI usage
* token usage
* latency
* database performance
* queue depth
* failed jobs
* retry counts
* webhook failures
* outreach failures
* discovery throughput
* qualification throughput

Create enough visibility that we can answer:

**What failed?
Why did it fail?
Which user/org was affected?
Can it retry?
How much did it cost?
What happened next?**

### Performance and scalability

Audit:

* query performance
* indexing
* caching
* batching
* pagination
* background work
* connection pooling
* large organizations
* large company datasets
* many simultaneous discovery jobs
* Apollo result volume
* AI workloads
* rate limiting
* queue pressure
* frontend rendering
* data-fetching patterns

Do not overengineer premature scale, but remove architectural traps that would prevent growth.

### Security

Review:

* secrets
* environment variables
* provider keys
* encryption
* authorization
* organization isolation
* row-level security
* webhooks
* API endpoints
* OAuth
* CSRF
* SSRF
* prompt injection
* AI tool access
* sensitive logs
* PII
* email/contact data

### Compliance and outreach safety

Also review:

* consent considerations
* unsubscribe handling
* suppression
* opt-outs
* email frequency
* contact data retention
* deletion
* export
* GDPR-style workflows
* CAN-SPAM-style requirements where relevant
* audit history

Do not turn HuntLoop into uncontrolled spam automation.

### Testing

Audit the current testing strategy.

Plan:

* unit tests
* integration tests
* provider-adapter tests
* Apollo mocked tests
* database tests
* queue/job tests
* AI schema tests
* prompt regression tests
* end-to-end tests
* production smoke tests
* failure simulations
* retry/idempotency tests

Identify critical workflows that currently have no realistic production-level validation.

### UX

Review HuntLoop from a user's perspective rather than only reviewing code.

Look for:

* confusing flows
* unnecessary screens
* duplicate screens
* excessive clicks
* unclear terminology
* weak empty states
* poor progress feedback
* hidden automation
* actions with unclear consequences
* missing bulk actions
* difficult filtering
* weak tables
* poor research presentation
* evidence visibility
* unclear score explanations

The product should constantly help answer:

**Who should I pursue next?
Why are they a good fit?
Why now?
Who should I contact?
What should I say?
What should I do next?**

---

# Production validation

Now that migrations are complete, verify the real system rather than assuming architecture equals working production.

Confirm:

* migrations are actually present in production
* job claiming works
* scheduler/tick works
* jobs execute successfully
* Apollo connectivity works
* enrichment providers work
* Anthropic calls work against the real API
* scoring executes
* evidence persists correctly
* opportunities are created
* contact enrichment works
* outreach generation works
* learning jobs work

Create at least one **real end-to-end smoke path**:

**ICP
→ Apollo search
→ company
→ research
→ qualification
→ score
→ opportunity
→ contact
→ outreach draft**

A system that compiles but cannot complete this path is not production-ready.

---

# Architecture principles

While auditing and planning, follow these rules:

1. **Reuse before rebuilding.**
2. **Extend good architecture instead of creating parallel systems.**
3. **Prefer deterministic logic when AI is unnecessary.**
4. **Keep AI grounded and evidence-backed.**
5. **Keep Apollo behind a provider abstraction.**
6. **Keep HuntLoop's own canonical company/contact identities.**
7. **Every asynchronous operation should be idempotent.**
8. **Every important failure should be observable.**
9. **Every expensive external action should have cost controls.**
10. **Every automated decision should remain explainable where practical.**
11. **Human users should retain control over consequential actions.**
12. **Avoid architecture that depends permanently on one provider.**
13. **Do not add features merely because Explee has them.**
14. **Prefer fewer, stronger workflows over more disconnected features.**

---

# Deliverables

Before making major changes, create a detailed audit and implementation plan.

Organize findings by:

* **P0 — blocks production or causes serious security/data risk**
* **P1 — major product/reliability gap**
* **P2 — meaningful improvement**
* **P3 — polish / future optimization**

For every finding include:

* problem
* evidence
* affected code/system
* user impact
* technical impact
* recommended solution
* dependencies
* implementation complexity
* risk
* priority
* whether it should be fixed now, later, or rejected

Also identify:

### KEEP

Systems already strong enough that we should preserve them.

### FIX

Existing systems with flaws.

### EXTEND

Good systems missing important capabilities.

### BUILD

Capabilities that genuinely do not exist.

### SIMPLIFY

Areas with unnecessary architecture or UX complexity.

### REMOVE

Dead code, duplicate logic, obsolete systems, unused abstractions, or unnecessary features.

### DEFER

Ideas that sound attractive but should not be built yet.

---

# Then move from planning to implementation

Do not stop after producing documentation.

After the audit and architecture plan are complete:

1. Work through findings systematically.
2. Implement the highest-impact improvements that can safely be done.
3. Reuse existing infrastructure wherever possible.
4. Update tests alongside implementation.
5. Update relevant documentation.
6. Keep the repo clean.
7. Verify builds, type checks, tests, migrations, and critical workflows.
8. Re-audit the changed areas after implementation.
9. Continue until everything that can reasonably be completed from the codebase/CLI has been handled.

Do **not** interrupt me for routine implementation decisions. Make the technically sound choice when the evidence is sufficient.

Only leave something for me when it genuinely requires external access, credentials, billing decisions, provider configuration, account approval, or another action that cannot be completed from the repository/CLI.

At the very end, give me one clear section:

# MANUAL ACTIONS REQUIRED FROM ME

For each manual action provide:

* exactly what I need to do
* why it is required
* where to do it
* exact value/configuration needed where safe
* how to verify it worked
* what depends on it

The objective is not merely to make HuntLoop pass an audit.

The objective is to turn HuntLoop into a coherent, production-ready **AI business-development intelligence system** where:

**Discover → Understand → Qualify → Prioritize → Act → Track → Learn**

operates as one connected loop, with Apollo providing high-quality company discovery while HuntLoop owns the intelligence, evidence, prioritization, automation, and learning that make the data useful.
