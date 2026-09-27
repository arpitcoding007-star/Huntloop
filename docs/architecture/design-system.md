---
description: Tokens, the semantic colour rule, theming, and the twenty components.
---

# Design system

> **Layer:** Developer / Product · **Audience:** design, engineering

`packages/ui`. Tokens are canonical in `src/tokens.css`. The live gallery is at
`/kitchen-sink` — it needs no login.

## Where the look comes from

* **Colour and chrome** derive from Supabase: near-black layered surfaces, a
  single saturated green accent, hairline borders, **no shadows**.
* **Light** derives from the reference report screenshots — warm paper canvas,
  white cards, rust/amber flag accent — rather than being an inversion of Dark.
* **Dashboard semantics** (stat grid, quota bars) derive from Kima BD OS.

## The semantic colour rule

This holds in **both** themes, and it is not decoration.

| Colour | Means |
|---|---|
| **green** | system state · primary action · a **source-verified fact** |
| **violet** | a model produced this — which includes every **inference** |
| **gray** | **unknown** — nothing on file |

{% hint style="info" %}
The epistemic clause is load-bearing. Colour is the fastest place an inference
could quietly become a fact, so the palette carries the distinction too. A fact
is something observed at a source (hence: system state); an inference is
something a model concluded.
{% endhint %}

### Priority is a fifth, ranked scale

`HOT` / `WARM` / `WATCH` / `IGNORE` alias existing hues:

| Priority | Token alias |
|---|---|
| HOT | `--hl-danger` |
| WARM | `--hl-warning` |
| WATCH | `--hl-info` |
| IGNORE | `--hl-text-muted` |

**It always ships with the word and a dot shape as well as the colour.**
Nothing in this UI is communicated by colour alone.

### Score bands

| Band | Range | Token |
|---|---|---|
| Poor | 0–39 | `--hl-score-poor` |
| Fair | 40–69 | `--hl-score-fair` |
| Good | 70–89 | `--hl-score-good` |
| Excellent | 90+ | `--hl-score-excellent` |

An unmeasured dimension renders **UNKNOWN**, which is not a band.

## Token architecture

```
:root
├── never theme-dependent: spacing, radius, density, motion, type scale, fonts
├── composite aliases as var() references: priority-*, score-*, focus-ring
│   (custom properties resolve at used-value time, so one declaration
│    serves both themes)
│
[data-theme="dark"]   every colour leaf token
[data-theme="light"]  every colour leaf token
```

Both selectors are scoped on `<html>`, which is also `:root`, so they have equal
specificity — safe here because **no token is declared in both places**.

### Type scale

| Token | Size | Role |
|---|---|---|
| `--hl-text-display` | 30/36/600 | Page titles |
| `--hl-text-body` | 14/20/400 | The workhorse |
| `--hl-text-body-sm` | 13/18/400 | Dense rows |
| `--hl-text-caption` | 12/16/400 | |
| `--hl-text-label` | 11/16/500 uppercase | **The signature** — section labels |
| `--hl-text-metric` | 32/36/600 tabular | Stat cards |
| `--hl-text-metric-sm` | 20/24/600 tabular | |

## Theming

Three preferences — **System / Light / Dark** — stored in the `hl-theme` cookie
and rendered into `data-theme` **server-side**, so an explicit choice never
flashes.

`"system"` is the only case the server cannot resolve. For it, `data-theme` is
left unset on the server-rendered HTML and `THEME_INIT_SCRIPT` — the first thing
to run in `<body>`, synchronous, before any later content paints — sets it from
`matchMedia`. A `change` listener keeps System following the OS live, re-reading
`data-theme-preference` on every firing so a later switch via the toggle is
respected rather than closed over as a stale value.

## The components

| Component | Product meaning |
|---|---|
| `ClaimBadge` | fact / inference / unknown — **the epistemic rule made visible** |
| `ScorePill` + `SCORE_DIMENSIONS` | The eight dimensions; UNKNOWN is a state |
| `PriorityBadge` | Colour + word + dot |
| `EvidenceList` | Claims with their sources |
| `Freshness` · `elapsedLabel` · `freshnessBand` | Why-now decay, rendered |
| `BreakdownList` | Score explanation |
| `QuotaBar` · `QuotaBarGroup` | Plan usage |
| `StatCard` · `StatGrid` | Dashboard metrics |
| `DataTable` | Rows; **not focusable without `onRowClick`**, because they do nothing |
| `FilterBar` | List filtering |
| `HoverPanel` | Explanations reachable on a phone too, not hover-only |
| `ActionRail` · `ActionRailItem` | Per-item actions |
| `Sidebar` | Nav, with the `unbuilt` flag |
| `TopBar` · `Avatar` | Chrome |
| `ThemeToggle` | System / Light / Dark |
| `Badge` · `StatusDot` · `Button` · `Card` · `Form` · `States` · `Anchor` | Generic |

## Conventions when adding a component

1. **Tokens only.** No literal colour in a component file.
2. **Never colour alone.** If a state is meaningful, it needs a word or a shape.
3. **No shadows.** Elevation is surface layering plus a hairline border.
4. **Respect `prefers-reduced-motion`** — `motion-reduce:transition-none` is used
   throughout.
5. **Focusable only if actionable.** `hl-focusable` is the shared focus ring.
6. **Add it to `/kitchen-sink`.** A component that is not in the gallery is a
   component nobody can review.

## Related

* [Frontend](frontend.md)
* [Vision and principles](../product/vision-and-principles.md)
