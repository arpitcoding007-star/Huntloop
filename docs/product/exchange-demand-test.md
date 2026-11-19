---
description: >-
  A hand-run test of whether buyers will state needs and accept intros, before
  any Exchange code is written. The plan, the form, the scripts and the pass bar.
---

# Exchange demand test (run by hand)

> **Layer:** Product · **Audience:** founder, product · **Status:** Ready to run. Not run yet.

{% hint style="info" %}
**Why this comes before code.** The [Exchange spec](marketplace-spec.md) rests
on one assumption nobody has tested: that founders will tell Huntloop what they
plan to buy and accept introductions. If that fails, a matching engine can't
fix it. This test checks it in about three weeks for almost no cost, using
only a form, a spreadsheet and email.
{% endhint %}

## 1. The question this test answers

> Will startup buyers in one category **state a real need** and **accept an
> introduction** to a provider, and do providers find those intros **worth
> paying for**?

## 2. Before you start: two decisions

| Decision | Needed for | Default if you don't decide |
|---|---|---|
| [EX-1 brand](../decisions/exchange.md#ex-1--buyer-side-brand-and-domain) | The name on the form | Run the test under a neutral working name, not "Huntloop". This also tests EX-1: if response is fine under a neutral name, the brand question is open. |
| [EX-5 category](../decisions/exchange.md#ex-5--the-first-category-list) | Which form to send | Pick **one** category where you can find **at least 5 providers** willing to take intros. CRM, accounting, or HR and payroll software for startups are good candidates. |

## 3. Setup (day 1 to 3)

1. **Recruit 5 to 8 providers in the category.** Start with Huntloop seller
   customers. Ask each one: "If we introduce you to a founder who has said
   they're choosing a [category] tool this quarter, would you take the call?
   Would you pay ₹X / $Y for an intro like that?" Write down the answer and the
   number they say. **This is half the test.**
2. **Build the buyer form** (Google Forms, Tally or Typeform, whatever is
   quickest) with the fields in §4.
3. **Make a tracking sheet** with the columns in §6.
4. **Write the privacy line** on the form (§4, last field). Have it checked if
   you're collecting from EU residents.

## 4. The buyer form

Keep it under two minutes. Every field maps to a column in the spec's `needs`
table, so the answers can be imported later.

| # | Question | Type | Maps to |
|---|---|---|---|
| 1 | What are you looking for? (one sentence) | Short text | `needs.summary` |
| 2 | Which of these do you need? | Checkboxes, 6 to 10 category-specific must-haves, plus "Other" | `needs.attributes` |
| 3 | How many people will use it? | 1–5 / 6–20 / 21–50 / 51–200 | `needs.attributes.seats` |
| 4 | Monthly budget | Ranges in your currency, plus "Not sure" | `budget_min`, `budget_max` |
| 5 | When do you want to decide? | This month / This quarter / Later this year / Just exploring | `decide_by`, `urgency` |
| 6 | What do you use today? | Short text | `needs.attributes.current_tool` |
| 7 | Company name and website | Short text | `buyer_profiles` |
| 8 | Your role | Founder / Ops / Finance / Engineering / Other | `buyer_profiles.role` |
| 9 | Work email | Email | used only for the intro |
| 10 | **May we introduce you to up to 3 providers that fit?** | Yes, I'll choose which / Yes, any that fit / No, just send me a shortlist | visibility level 3 / 3 / 1 |
| — | Privacy line | Text | "We use your answers only to find providers for you. We never share your name or email with a provider until you say yes to that provider. Reply 'delete' at any time and we'll remove your answers." |

Question 10 is the most important field. It is the consent model from spec §5,
tested with real people.

## 5. Getting 30 to 50 responses (day 3 to 14)

Ask in places where founders in the category already are. Don't buy lists and
don't cold-email strangers: that would test the wrong thing and break the
promise in the privacy line.

- Founder communities you are a member of (Slack and Discord groups, WhatsApp
  groups, accelerator cohorts). Post the question, not a pitch: "Choosing a
  [category] tool this quarter? Tell us what you need and we'll send you 3
  options that fit, with no sales calls unless you ask."
- Your own network and your seller customers' networks (ask them to share it;
  they benefit directly).
- One or two LinkedIn posts from the founder's own account.

Track where each response came from (one column). That tells you where buyers
come from, which you'll need for EX-2 (region).

## 6. Matching by hand (within 48 hours of each response)

For each response:

1. Pick up to 3 providers that fit, and write **why** in one line per provider
   (category fit, must-haves, budget, size). This is the explanation the spec's
   matching engine will produce later.
2. Send the buyer the shortlist with the reasons.
3. If they answered "Yes, I'll choose", ask which ones. If "any that fit",
   introduce them to all three. Write one email that introduces both sides.
4. A week after each intro, ask both sides what happened.

**Tracking sheet columns:** response date · source · category · must-haves ·
budget · timeline · consent answer · matched providers (and why) · shortlist
sent date · providers the buyer chose · intro date · buyer reply (Y/N) ·
provider reply (Y/N) · call held (Y/N) · outcome after 2 weeks · would the
provider pay (Y/N, amount) · notes.

## 7. Pass bar (decide before you look at the results)

| Measure | Pass | Strong pass | Maps to spec metric |
|---|---|---|---|
| Completed forms | ≥ 30 | ≥ 50 | Need capture |
| Said yes to intros (Q10 options 1 or 2) | ≥ 40% | ≥ 60% | Intro acceptance |
| Had at least one good match | ≥ 80% | ≥ 90% | Match coverage |
| Intros where a call happened | ≥ 30% | ≥ 50% | Qualified intros |
| Providers who would pay for this intro | ≥ 3 of 5 | ≥ 4 of 5 | Provider activation |
| Days from form to shortlist | ≤ 2 | ≤ 1 | Time to first match |

**What the result means:**

- **Pass on everything:** start Exchange P0 with the decisions in
  [decisions/exchange.md](../decisions/exchange.md). The tracking sheet becomes
  the seed data and the acceptance tests.
- **Buyers fill the form but won't accept intros:** the consent model is right
  but intros are the wrong product. Test a shortlist-only version (level 1 and
  2 only) before building intros.
- **Buyers accept intros but providers won't pay:** the demand side works. The
  money is elsewhere. Test subscription demand analytics instead of per-intro
  pricing.
- **Fewer than 30 responses in two weeks:** the problem is distribution, not
  product. Don't build. Try a second category or a different channel first.

## 8. What to record when it's done

Write the results into this page (§9) with the date and who ran it, and update
each decision in [decisions/exchange.md](../decisions/exchange.md) that the
results settle. Then change this page's status to "Run on <date>".

## 9. Results

Not run yet.
