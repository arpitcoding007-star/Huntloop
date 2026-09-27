# Onboarding audit

**Verdict: the most complete and best-designed part of the product.** Every question persists, and every question has a downstream consumer.

## Persistence — verified

All writes go through `app/(onboarding)/welcome/actions.ts`:

| Step | Action | Writes to |
|---|---|---|
| You | `saveYou` (line 74) | `profiles`, user role |
| Workspace | `createWorkspace` (146) | `organizations`, `memberships` |
| Goals | `saveGoals` (243) | org onboarding state (`0024`) |
| ICP | `saveIcp` (267) | `icps`, `icp_versions` |
| Sources | `saveSources` (324) | `sources` |
| Step advance | `advanceStep` (346) | `0024` progress column |
| Finish | `finishOnboarding` (359) | completion timestamp, idempotent |

`GoalsStep.tsx` imports `saveGoals` from the shared actions file — the step has no `actions.ts` of its own, which is why an early file-level scan can wrongly read it as non-persisting. It persists.

## Every answer has a consumer

The brief's rule — *no onboarding question should exist without a clear downstream purpose* — holds:

| Answer | Consumed by |
|---|---|
| Company URL | `research-company` → org profile, ICP draft, product description |
| Product description | qualification (`qualify-opportunity` judges "would this company buy *this*"), personalization |
| Role | dashboard layout (`0024` restricts to roles the dashboard has layouts for) |
| Primary goal (≤2) | first-run stage emphasis, dashboard |
| Segments / sizes / regions / industries / technologies | `discovery.ts` → provider filters |
| Pain points / use cases | scoring context, research prompts |
| Triggers | `company_triggers`, why-now |
| Job titles / seniority | `person.search` filters, `contact_fit_scores` persona matching |
| Exclusions | pushed down to the provider where expressible, filtered locally otherwise |
| Example domains (look-alikes) | `expandWithLookAlikes` widens the search |
| Sources | `scan_source` |
| Outreach method | first-run's contextual secondary CTA |

## Deliberate omissions — verified against `audit/PLAN-12.md` §2.5

Eight questions Apollo/Clay ask and HuntLoop does not: phone number, team size, CRM in use, current tools, revenue target, deal size, attribution, leads-per-month. Each has a stated reason. **Two now need revisiting:**

- **"CRM in use" — cut because "no CRM integration ships in this phase".** A HubSpot integration now ships. Asking at onboarding (or offering the connect step there) would convert a settings tab nobody visits into a first-run action.
- **Team size — cut because it "doesn't change behaviour".** Still true, but seats are now quota-enforced, so it may be worth knowing for plan fit.

## Counts (from the spec, verified against the screens)

9 required answers · 12 optional · 3 screens with a text cursor. Everything else is selection or confirmation. This remains a genuine competitive advantage over Apollo's and Clay's setup flows.

## Findings

| # | Severity | Finding |
|---|---|---|
| O-1 | Medium | Onboarding is the **only** place discovery is ever configured or run. A user cannot revisit "what am I hunting for" and act on it — the ICP settings tab edits the profile but offers no way to re-hunt |
| O-2 | Medium | The CRM connection is not offered during onboarding despite now existing |
| O-3 | Low | No way to re-run first-run for an existing workspace (useful after a significant ICP change) |
| O-4 | Low | `first-run.ts` bounds its work (`MAX_*` constants) but nothing tells the user "we stopped at N — here's how to continue" |
| O-5 | Info | Live model calls in onboarding have never been verified; the whole flow is exercised against a scripted client |

## Recommendation

Add one control at the end of onboarding and one in settings: **"Hunt again"**. The engine, the query row, the budget and the progress UI all already exist — `first-run.ts` is literally a working implementation of it, currently reachable only once.
