# Huntloop

AI-powered closed-loop outbound growth engine.

> **Discover → Qualify → Enrich → Personalize → Reach out → Track → Learn → Improve → repeat**

- Product spec: [Project_Creation.md](Project_Creation.md)
- Build plan, architecture decisions, and design system: [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 15 (App Router), TypeScript, Tailwind v4 |
| Backend | Supabase — Postgres + Auth + Storage, tenant isolation via RLS |
| Jobs | Durable job runner (Inngest / Trigger.dev) |
| AI | Claude (Anthropic) |
| Billing | Stripe |

## Layout

```
apps/web            Next.js app — marketing + product + admin
packages/ui         Design system: tokens + components
```

The design system's color and chrome derive from Supabase; the dashboard
information architecture derives from Kima BD OS. Tokens are canonical in
`packages/ui/src/tokens.css` — see IMPLEMENTATION_PLAN.md §1.

Semantic rule: **green = system state and primary action, violet = an AI
produced this.**

## Local development

Requires Node 20+.

```bash
npm install
cp .env.example apps/web/.env.local   # then fill it in
npm run dev
```

- App: http://localhost:3100
- Design system gallery: http://localhost:3100/kitchen-sink

```bash
npm run typecheck   # both workspaces
npm run build       # production build
```

## Deploying to Vercel

This is an npm-workspaces monorepo, so the defaults do not work:

| Setting | Value |
|---|---|
| Framework Preset | **Next.js** (not "Other") |
| Root Directory | **`apps/web`** (not `./`) |
| Install Command | leave default — Vercel installs from the workspace root |

Add every variable from `.env.example` under Project → Settings →
Environment Variables. `SUPABASE_SERVICE_ROLE_KEY` must never carry the
`NEXT_PUBLIC_` prefix.
