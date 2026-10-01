# Free Black Market (FBM)

Free Black Market (FBM) is a monorepo for a cooperative, multi-vendor
commerce platform built on [MedusaJS](https://www.medusajs.com). It started
from the [Mercur](https://github.com/mercurjs/mercur) marketplace starter and
has grown into a broader **cooperative-economy substrate**: vendors pick a
governance "playbook" (solo seller, worker co-op, multi-stakeholder co-op,
CSA, mutual-aid garden, and more), an internal ledger settles value across
commerce, creator bounties, mutual aid, and delivery, and four
vertical-specific vendor dashboards (in development, not yet deployed) sit on
top of the same backend.

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
- **Build vertical-specific vendor tooling** (plant nursery, wellness/herbal,
  creator commerce, general botanical goods) on shared infrastructure instead
  of building each one from scratch. The four portals here are early
  back-office dashboards, not customer storefronts (see below).

> **Testing & security.** We run an external crowdsourced testing program with
> a security bounty. See [`TESTING.md`](TESTING.md) to join as a tester or
> contribute fixes, and [`SECURITY.md`](SECURITY.md) for the
> responsible-disclosure policy. **Do not file public issues for security
> vulnerabilities.**

> **License.** FBM is licensed under the **GNU Affero General Public License
> v3.0** — see [`LICENSE`](LICENSE), and [`NOTICE`](NOTICE) for why the AGPL
> rather than a permissive licence, third-party attribution, and the questions
> the licence leaves to the operator. The AGPL's section 13 is the point: run a
> modified FBM as a network service and the people using it can get your
> source. That is the same promise FBM makes its own members.
>
> Ignore MIT badges in older vendored READMEs inherited from the upstream
> Mercur starter — they describe those upstream projects, not this one.
> `backend/package.json` also declared MIT until 2026-09-13; that was the
> Medusa starter template's own unedited metadata, not a licence chosen here.

## Repository Layout

```text
.
├── backend/              MedusaJS API, marketplace + cooperative-economy modules
├── admin-panel/           Operator dashboard
├── vendor-panel/          Seller dashboard
├── storefront/            Customer-facing web app (Next.js)
├── nursery-portal/        Vendor dashboard (dev only): plant nursery / growers
├── wellness-portal/       Vendor dashboard (dev only): wellness / herbal
├── botanical-portal/      Vendor dashboard (dev only): general botanical goods
├── creator-portal/        Vendor dashboard (dev only): independent creators
├── packages/               Shared UI kit and portal-framework packages (@bmc/*)
├── services/ai-orchestrator/  Hermes system prompt + tool-call guardrails (not deployed)
├── infrastructure/         Fedora host (production), observability, Jitsi, unused k8s manifests
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
  bookable, campaign, ...), an internal hawala-style double-entry ledger
  (Coalition Credits + USDC treasury; Stellar anchoring and outbound Stripe
  ACH payouts are built but ship disabled — `ENABLE_STELLAR_SETTLEMENT=false`
  and `ACH_PAYOUTS_ENABLED=false`), creator bounties (**Refrain**), mutual aid
  (**Threshold**), and a delivery hand-off to the separate **Blackstar**
  logistics app — a signed-webhook bridge between two deployments
  ([`docs/integrations/federated-logistics.md`](docs/integrations/federated-logistics.md)),
  off unless `FBM_BLACKSTAR_INTEGRATION=1`. There is no federation protocol.
- **Vertical portals** (`nursery-portal`, `wellness-portal`,
  `botanical-portal`, `creator-portal`): vendor back-office dashboards for
  specific vendor communities, built on the shared `@bmc/portal-kit` and
  `@bmc/ui` packages. They are not customer storefronts and are not deployed:
  in dev they read from a typed mock data layer, there is no Dockerfile,
  compose service or DNS entry for them, and 17 of the `/vendor/**` routes
  they call, plus the Blackout feed routes, do not exist in the backend yet
  (each portal's README lists its own).
- **AI orchestrator** (`services/ai-orchestrator`, codename Hermes): the
  versioned Hermes system prompt plus a tool-call schema validator and a
  destructive-action confirmation checker, with tests. It has no LangGraph
  dependency, makes no model calls, and is not deployed or imported by any
  app; the backend's `POST /vendor/hermes/runtime` keeps its own copy of the
  validator and forwards chat to the OpenAI-compatible endpoint set by
  `HERMES_CHAT_*`.
- **Commerce feature families** beyond the basics, each backed by one or
  more backend modules: restaurant/commissary ordering, rentals, ticketed
  events and venue booking, digital products, subscriptions and CSA-style
  order cycles, POS sessions, wholesale/supplier forwarding, collective
  crowdfunding campaigns, wishlists and reviews. See
  [`docs/MODULE_CATALOG.md`](docs/MODULE_CATALOG.md) for the full inventory
  of backend modules.
- **Community & economy systems**: cooperative governance, XP/progression
  with demurrage, vendor quests, buyer networks, group bargaining, demand
  pools, impact metrics, volunteer and work verification.
- **Integrations**: WooCommerce import + inventory sync, Odoo import,
  Printful fulfillment, Stripe (payments; ACH payouts off by default),
  Stellar (ledger anchoring, off by default), Postgres search (`ILIKE`
  filtering — `@mercurjs/algolia` was removed from `backend/medusa-config.ts`),
  Matrix/Element chat against the Blackout Synapse homeserver
  (`backend/src/shared/matrix-service.ts`), Resend/SMTP email, MinIO file
  storage, and the `connect.js` embed layer
  ([`docs/integrations/fbm-connect.md`](docs/integrations/fbm-connect.md))
  for standalone vendor sites. It does not work from vendor origins yet: no
  shipped `connect.js` sends the Medusa publishable key (`/store/*` returns
  `400` without it), and store CORS rejects vendor origins (see the §1 known
  gaps).
- **Operational tooling**: release-validation scripts, health checks,
  observability config, runbooks, and a documented compliance posture for
  anything that touches money.

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
- **Internal ledger**: Postgres double-entry (Coalition Credits, USDC
  treasury); Stellar anchoring and Stripe ACH payouts built but off by default
- **AI**: Hermes prompt + tool-call guardrails (`services/ai-orchestrator`,
  not deployed); the backend proxies vendor chat to an OpenAI-compatible
  endpoint
- **Deploy**: single-host Docker Compose + host nginx on Fedora via
  `scripts/deploy-fedora.sh`
  ([`docs/runbooks/FEDORA_DEPLOYMENT.md`](docs/runbooks/FEDORA_DEPLOYMENT.md));
  the Kubernetes, Railway and Vercel configs are committed but unused

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
