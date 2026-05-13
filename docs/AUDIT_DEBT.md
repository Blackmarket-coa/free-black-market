# Audit Debt Tracker

Deferred work captured from prior audits and direct repo inspection. **Items here are intentionally not being fixed in the current production-readiness pass** — they are tracked so they can be ratcheted down in dedicated follow-up PRs without losing visibility.

Effort key: **S** ≤ 1 day · **M** 2–5 days · **L** > 1 week.

## Type-safety debt

| # | Item | Location | Count | Owner | Effort | Target milestone |
|---|------|----------|------:|-------|:------:|------------------|
| TS-1 | Replace `any` in API hooks, table/grid utilities, dashboard extensibility | `admin-panel/src/hooks/api/*.tsx`, `admin-panel/src/components/data-grid/*`, `admin-panel/src/lib/table/*`, `admin-panel/src/types/*`, `admin-panel/src/dashboard-app/*` | 327 (down from 662 after Medusa SDK retype pass; `src/hooks/api/*.tsx` now clean) | admin-panel team | L | post-`v1.0.0` |
| TS-2 | Replace `any` in pricing helpers, data access, return/shipping UI | `storefront/src/lib/helpers/get-product-price.ts`, `storefront/src/lib/helpers/get-seller-product-price.ts`, `storefront/src/lib/data/*`, `storefront/src/components/sections/OrderReturnSection/*`, `storefront/src/components/sections/CartShippingMethodsSection/*` | 158 | storefront team | M | `v1.1.0` |

## In-code TODO/FIXME debt

| # | Item | Location | Count | Owner | Effort | Target milestone |
|---|------|----------|------:|-------|:------:|------------------|
| TD-1 | Resolve admin-panel TODO/FIXME backlog (see `TODO_TRACKER.md`) | `admin-panel/src/routes/orders/**`, `admin-panel/src/routes/products/**`, `admin-panel/src/components/{data-grid,table}/**`, `admin-panel/src/hooks/{table,use-date.tsx}` | 14 | admin-panel team | M | `v1.1.0` |
| TD-2 | Order list pagination | `storefront/src/app/[locale]/(main)/user/orders/page.tsx` | 1 | storefront team | S | `v1.0.0` |
| TD-3 | Sell signup → API integration | `storefront/src/app/[locale]/(main)/sell/page.tsx` | 1 | storefront team | S | `v1.0.0` |
| TD-4 | Order details status source | `storefront/src/components/organisms/OrderDefails/OrderDetails.tsx` | 1 | storefront team | S | `v1.0.0` |
| TD-5 | Cart data shape (POJO instead of form entity) | `storefront/src/lib/data/cart.ts` | 1 | storefront team | S | `v1.1.0` |

## Logging hygiene

| # | Item | Location | Count | Owner | Effort | Target milestone |
|---|------|----------|------:|-------|:------:|------------------|
| LG-1 | Replace `console.*` with structured logger in backend runtime | `backend/src/**` | ~172 | backend team | M | `v1.1.0` |
| LG-2 | Replace `console.*` in storefront request wrappers and middleware | `storefront/src/lib/config.ts`, `storefront/src/lib/data/*`, `storefront/src/middleware.ts`, `storefront/src/app/[locale]/(main)/page.tsx`, `storefront/src/components/sections/*` | 54 | storefront team | S | `v1.1.0` |
| LG-3 | Replace `console.*` in admin-panel runtime | `admin-panel/src/lib/query-client.ts`, `admin-panel/src/components/layout/pages/*`, `admin-panel/src/components/data-grid/*` | 27 | admin-panel team | S | `v1.1.0` |

## Lint/typecheck baseline ratchet

| # | Item | Location | Current | Owner | Effort | Target milestone |
|---|------|----------|--------:|-------|:------:|------------------|
| LR-1 | Lower admin-panel ESLint `--max-warnings` from 7000 → 0 in steps (5400 → 4000 → 2000 → 0) | `admin-panel/package.json` `lint` script | 5400 (currently 5,347 warnings; first step of the ratchet landed alongside the Medusa SDK retype) | admin-panel team | L | `v1.0.0` → `v1.2.0` |
| ~~LR-2~~ | ~~Eliminate vendor-panel typecheck failures~~ — **resolved**: `pnpm typecheck`, `pnpm test`, `pnpm build:preview`, `pnpm lint --max-warnings 0` all pass on `main` as of 2026-05-06; `continue-on-error: true` was correctly removed in PR #658. | `vendor-panel/**` | 0 errors | — | — | done |
| ~~LR-3~~ | ~~Eliminate translation-contract drift in admin-panel typecheck — missing modules `@medusajs/admin-sdk`, `@medusajs/framework`, `stripe` now installed at `2.12.5`/latest; local types defined for `TicketProduct`, `Venue`, `Donation*` in `admin-panel/src/types/{ticket-product,venue,donation}`; `@medusajs/framework/types::OrderCreditLineDTO` import resolves.~~ Module-resolution cascade closed; downstream type mismatches in `routes/orders/**`, `routes/tax-regions/**`, `routes/products/**` etc. remain (tracked as TS-1 follow-up). `admin-panel/package.json` `lint` ratcheted from `--max-warnings 7000` → `5400`. `Typecheck admin panel` CI step stays `continue-on-error: true` until the unrelated route-level errors land. | `admin-panel/src/types/**`, `admin-panel/src/routes/**` | module-resolution cascade closed | admin-panel team | — | partially-done |
| LR-4 | Replace backend `lint` (currently aliased to `tsc --noEmit`) with a real ESLint flat config that lints `src/**/*.{ts,tsx}` with `--max-warnings 0` | `backend/package.json`, new `backend/eslint.config.mjs` | aliased to typecheck | backend team | M | `v1.1.0` |
| LR-5 | Eliminate storefront `pnpm typecheck` failures: missing `sonner` dep import in `src/lib/helpers/toast.ts`, `null` vs `Record<string, string \| undefined>` mismatches in `src/lib/data/{customer,orders,products,wishlist}.ts`. `next.config.ts` sets `typescript.ignoreBuildErrors: true` so the build is unaffected; CI step is `continue-on-error: true` until this lands. | `storefront/src/lib/{data,helpers}/**` | ~12 type errors | storefront team | S | `v1.0.0` |

## Storefront test coverage

| # | Item | Location | Owner | Effort | Target milestone |
|---|------|----------|-------|:------:|------------------|
| TC-1 | Bring storefront test suite to ≥ 30 % coverage on `src/lib/data/*` and `src/lib/helpers/*` | `storefront/src/**` | storefront team | M | `v1.1.0` |

## Storefront QA

| # | Item | Source | Owner | Effort | Target milestone |
|---|------|--------|-------|:------:|------------------|
| QA-1 | Add recurring static internal-link route validation in QA/release checks to detect unmatched hrefs before release | `storefront/docs/storefront-pages-audit.md` (open follow-up in `TODO_TRACKER.md`) | storefront QA | S | `v1.0.0` |

## Test infrastructure

| # | Item | Location | Owner | Effort | Target milestone |
|---|------|----------|-------|:------:|------------------|
| TI-1 | Reconcile backend module migration order so `pnpm test:integration:http` can run end-to-end. Currently `Migration20251229AddRawColumns` references `hawala_ledger_account` and `Migration20260520AddCreatorCommission` references `order_payout_breakdown` before either table is created. Test runner uses individual `DB_HOST`/`DB_USERNAME`/`DB_PASSWORD`/`DB_PORT` env vars (not `DATABASE_URL`) — already wired in `.github/workflows/ci.yml`. CI step is `continue-on-error: true` until the migration graph is fixed. | `backend/src/modules/**/migrations/*.ts` | backend team | M | `v1.0.0` |
| TI-2 | Harden the `e2e.yml` Playwright job: cache the docker buildx layers, pre-pull base images, and raise the healthcheck wait window past 5 min so cold builds on shared GitHub runners don't trip the loop. CI step is `continue-on-error: true` and dumps `docker compose logs` on failure for forensic debugging. | `.github/workflows/e2e.yml`, `e2e/**` | platform | M | `v1.1.0` |

## Security dependency bumps (HIGH/CRITICAL — gated, not blocking)

Pinned in `.trivyignore` and the Trivy FS gate is `continue-on-error: true` until the bumps land. Findings still surface in the GitHub Security tab via the SARIF upload.

| # | Package | Range | Fixed | CVEs | Affected lockfile | Owner | Effort | Target |
|---|---------|-------|-------|------|-------------------|-------|:------:|--------|
| SD-1 | `@mikro-orm/core` | `<6.6.10` | `6.6.10` (or `7.0.6`) | CVE-2026-34220 (SQL injection), CVE-2026-34221 (prototype pollution) | `backend/pnpm-lock.yaml` | backend team | S | `v1.0.0` |
| SD-2 | `lodash` | `<4.18.0` | `4.18.0` | CVE-2026-4800 (RCE via template imports) | `backend/`, `storefront/`, `vendor-panel/pnpm-lock.yaml` | platform | S | `v1.0.0` |
| SD-3 | `picomatch` | `<2.3.2 / <3.0.2 / <4.0.4` | latest within range | CVE-2026-33671 (regex DoS) | `backend/`, `storefront/pnpm-lock.yaml` | platform | S | `v1.0.0` |
| SD-4 | `axios` | `<1.15.2` | `1.15.2` | CVE-2026-42033 / 42035 / 42043 / 42264 (prototype pollution, header injection, NO_PROXY bypass) | `storefront/`, `vendor-panel/pnpm-lock.yaml` | platform | S | `v1.0.0` |
| SD-5 | `next` | `<15.5.15` | `15.5.15` (or `16.2.3`) | GHSA-q4gf-8mx6-v5v3 (DoS in Server Components) | `storefront/pnpm-lock.yaml` | storefront team | S | `v1.0.0` |

## Process

- Re-generate the in-code marker list with `rg -n "TODO|FIXME" admin-panel/src storefront/src vendor-panel/src` quarterly.
- Each item closed → strike-through here and link the merging PR.
- New audit findings should be appended here, not opened as ad-hoc files.
