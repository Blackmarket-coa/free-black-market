# Free Black Market (FBM)

Free Black Market (FBM) is a monorepo for a cooperative, multi-vendor
commerce platform built on [MedusaJS](https://www.medusajs.com). It started
from the [Mercur](https://github.com/mercurjs/mercur) marketplace starter and
has grown into a broader **cooperative-economy substrate**: vendors pick a
governance "playbook" (solo seller, worker co-op, multi-stakeholder co-op,
CSA, mutual-aid garden, and more), an internal ledger settles value across
commerce, creator bounties, mutual aid, and delivery, and several
vertical-specific storefront apps sit on top of the same backend.

FBM is useful to you if you want to:

- **Self-host a multi-vendor marketplace** with a real admin/vendor/storefront
  split (the "plain commerce" path works standalone, no cooperative features
  required).
- **Run a cooperative or solidarity-economy marketplace** where vendors share
  governance and surplus, sliding-scale pricing is a first-class checkout
  option, and mutual-aid/donation flows route through a compliant fiscal
  sponsor.
- **Study or reuse the compliance-first payment design** — the platform
  operates as a Stripe-ACH payment facilitator (not a money transmitter);
  see [`docs/POSTURE_A_COMPLIANCE.md`](docs/POSTURE_A_COMPLIANCE.md) for the
  regulatory frame every money-touching module is built against.
- **Stand up a vertical-specific storefront** (plant nursery, wellness/herbal,
  creator commerce, general botanical goods) on shared infrastructure instead
  of building each one from scratch.

> **Testing & security.** We run an external crowdsourced testing program with
> a security bounty. See [`TESTING.md`](TESTING.md) to join as a tester or
> contribute fixes, and [`SECURITY.md`](SECURITY.md) for the
> responsible-disclosure policy. **Do not file public issues for security
> vulnerabilities.**

> **License.** This repository does not currently include a `LICENSE` file.
> Until one is added, treat the code as "all rights reserved" — do not assume
> MIT or any other open-source license applies, even where older vendored
> READMEs (inherited from the upstream Mercur starter) display an MIT badge.

## Repository Layout

```text
.
├── backend/              MedusaJS API, marketplace + cooperative-economy modules
├── admin-panel/           Operator dashboard
├── vendor-panel/          Seller dashboard
├── storefront/            Customer-facing web app (Next.js)
├── nursery-portal/        Vertical storefront: plant nursery / growers
├── wellness-portal/       Vertical storefront: wellness / herbal
├── botanical-portal/      Vertical storefront: general botanical goods
├── creator-portal/        Vertical storefront: independent creators
├── packages/               Shared UI kit and portal-framework packages (@bmc/*)
├── services/ai-orchestrator/  LangGraph-based AI supervisor/vendor-tooling agent
├── infrastructure/         Kubernetes, observability, Jitsi, deployment configs
├── templates/              Starter site template for spinning up a new node
├── e2e/                    Playwright end-to-end suite across surfaces
├── docs/                   Architecture, compliance, and operational docs
├── scripts/                 Release validation, migration, and QA scripts
└── README.md
```

## What's Actually Here

- **Core commerce** (`backend`, `admin-panel`, `vendor-panel`, `storefront`):
  a standard multi-vendor marketplace — product catalog, orders,
  fulfillment, seller onboarding/approval, commissions.
- **Composition layer** (see [`docs/COMPOSITION_LAYER.md`](docs/COMPOSITION_LAYER.md)):
  a "playbook" system (co-op governance shapes a vendor can pick),
  listing-types (physical, event, digital, subscription, consignment,
  bookable, campaign, ...), an internal hawala-style ledger on Stellar
  (Coalition Credits + USDC treasury, settling out via Stripe ACH), creator
  bounties (**Refrain**), mutual aid (**Threshold**), and delivery
  federation (**Blackstar**).
- **Vertical portals** (`nursery-portal`, `wellness-portal`,
  `botanical-portal`, `creator-portal`): focused storefront experiences for
  specific vendor communities, built on the shared `@bmc/portal-kit` and
  `@bmc/ui` packages.
- **AI orchestrator** (`services/ai-orchestrator`): a LangGraph supervisor
  agent with a vendor tool registry, used for AI-assisted vendor workflows.
- **Operational tooling**: release-validation scripts, health checks,
  observability config, and a documented compliance posture for anything
  that touches money.

This platform is under active, iterative development — several
capabilities described in `docs/` are partially shipped or gated behind
feature flags. See [`docs/PRODUCTION_READINESS.md`](docs/PRODUCTION_READINESS.md)
and [`docs/AUDIT_DEBT.md`](docs/AUDIT_DEBT.md) for the current state versus
aspirational scope.

## Tech Snapshot

- **Package manager**: pnpm workspaces
- **Backend**: Node.js + TypeScript + MedusaJS, PostgreSQL + Redis
- **Frontends**: React/Vite (`admin-panel`, `vendor-panel`, vertical portals),
  Next.js (`storefront`)
- **Internal ledger**: Stellar (Coalition Credits, USDC treasury), Stripe ACH
  for vendor payout settlement
- **AI**: LangGraph-based orchestrator service for vendor tooling

## Quick Start

### 1) Prerequisites

- Node.js 20+
- pnpm
- PostgreSQL (for backend)
- Redis (for backend)

### 2) Install dependencies

From repo root:

```bash
pnpm install
```

### 3) Configure environment files

Each app provides its own template:

- `backend/.env.template`
- `admin-panel/.env.template`
- `vendor-panel/.env.template`
- `storefront/.env.template`

Copy each template to a local `.env` file and fill values. The vertical
portals (`nursery-portal`, `wellness-portal`, `botanical-portal`,
`creator-portal`) read from the same backend and follow the pattern in their
own `package.json` scripts (`pnpm nursery-portal:dev`, etc.).

### 4) Run apps

From the repo root, or `cd` into the app directory and run `pnpm dev`:

```bash
cd backend && pnpm dev
cd admin-panel && pnpm dev
cd vendor-panel && pnpm dev
cd storefront && pnpm dev
```

Vertical portals have root-level shortcuts:

```bash
pnpm nursery-portal:dev
pnpm wellness-portal:dev
pnpm botanical-portal:dev
pnpm creator-portal:dev
```

Use each package README for app-specific setup details:

- `backend/README.md`
- `admin-panel/README.md`
- `vendor-panel/README.md`
- `storefront/README.md`

## Development Workflow

1. Create a feature branch.
2. Make focused changes in one app at a time.
3. Run lint/tests in touched packages.
4. Update docs when behavior, API shape, or env vars change.
5. Open a PR with validation evidence.

## Notes for Better AI Editing

These guidelines are intended for AI-assisted edits and automation tooling.

### Keep changes scoped

- Edit only files relevant to the requested outcome.
- Prefer small, reviewable commits over broad rewrites.
- Avoid unrelated refactors in the same change set.

### Preserve contracts

- Do not silently rename public routes, exported symbols, or env vars.
- If a contract must change, update call sites and documentation in the same PR.
- Keep existing response shapes stable unless the task explicitly requests a breaking change.

### Match local patterns

- Follow naming, folder layout, and style already used in the touched package.
- Reuse existing helpers/hooks/services before adding new abstractions.
- Prefer incremental extension over replacing working modules.

### Touch docs with code

When modifying behavior, update the nearest relevant docs:

- package-level README
- `docs/` operational guides
- env templates if configuration changed

### Validate before finalizing

At minimum, run checks for packages you changed:

- lint
- unit/integration tests (if present)
- build/typecheck

Include exact commands and outcomes in your PR description.

### Avoid risky edits

- Do not commit secrets, keys, or real credentials.
- Do not change lockfiles unless dependency changes are required.
- Do not mass-format unrelated files.
- Money-movement code must honor the compliance invariants in
  [`docs/POSTURE_A_COMPLIANCE.md`](docs/POSTURE_A_COMPLIANCE.md) — do not add
  Coalition Credits-to-cash paths, non-Stripe-ACH vendor payout rails, or
  peer-to-peer transfers outside a purchase/refund context.

### Prefer explicitness in generated code

- Use descriptive names over short abbreviations.
- Add brief comments only where intent is non-obvious.
- Keep functions small and deterministic where possible.

## Where to Look Next

- Platform docs index: `docs/README.md`
- Composition layer (playbooks, ledger, Refrain/Threshold/Blackstar): `docs/COMPOSITION_LAYER.md`
- Compliance posture: `docs/POSTURE_A_COMPLIANCE.md`
- Production readiness index: `docs/PRODUCTION_READINESS.md`
- Deferred audit backlog: `docs/AUDIT_DEBT.md`
- Release checks: `docs/RELEASE_VALIDATION_PLAYBOOK.md`
- Roadmap: `ROADMAP.md`
- Contributor process: `CONTRIBUTING.md`
- Root scripts: `scripts/README.md`
