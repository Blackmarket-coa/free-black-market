# Free Black Market

A monorepo for a Medusa-based multi-vendor marketplace platform with four main apps:

- `backend` – MedusaJS API and marketplace modules
- `admin-panel` – operator dashboard
- `vendor-panel` – seller dashboard
- `storefront` – customer-facing web app

This repository also includes operational docs, QA playbooks, and scripts for release validation.

## Repository Layout

```text
.
├── backend/
├── admin-panel/
├── vendor-panel/
├── storefront/
├── docs/
├── scripts/
└── README.md
```

## Tech Snapshot

- **Package manager**: pnpm workspaces
- **Backend**: Node.js + TypeScript + MedusaJS
- **Frontends**: React/Vite (`admin-panel`, `vendor-panel`), Next.js (`storefront`)
- **Data services**: PostgreSQL + Redis (backend runtime)

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

Copy each template to a local `.env` file and fill values.

### 4) Run apps

Use each package README for app-specific commands:

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

### Prefer explicitness in generated code

- Use descriptive names over short abbreviations.
- Add brief comments only where intent is non-obvious.
- Keep functions small and deterministic where possible.

## Where to Look Next

- Platform docs: `docs/README.md`
- Production readiness index: `docs/PRODUCTION_READINESS.md`
- Deferred audit backlog: `docs/AUDIT_DEBT.md`
- Release checks: `docs/RELEASE_VALIDATION_PLAYBOOK.md`
- Contributor process: `CONTRIBUTING.md`
- Root scripts: `scripts/README.md`
