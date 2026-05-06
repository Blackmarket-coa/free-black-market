# Audit Debt Tracker

Deferred work captured from prior audits and direct repo inspection. **Items here are intentionally not being fixed in the current production-readiness pass** — they are tracked so they can be ratcheted down in dedicated follow-up PRs without losing visibility.

Effort key: **S** ≤ 1 day · **M** 2–5 days · **L** > 1 week.

## Type-safety debt

| # | Item | Location | Count | Owner | Effort | Target milestone |
|---|------|----------|------:|-------|:------:|------------------|
| TS-1 | Replace `any` in API hooks, table/grid utilities, dashboard extensibility | `admin-panel/src/hooks/api/*.tsx`, `admin-panel/src/components/data-grid/*`, `admin-panel/src/lib/table/*`, `admin-panel/src/types/*`, `admin-panel/src/dashboard-app/*` | 671 | admin-panel team | L | post-`v1.0.0` |
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
| LR-1 | Lower admin-panel ESLint `--max-warnings` from 7000 → 0 in steps (5500 → 4000 → 2000 → 0) | `admin-panel/package.json` `lint` script | 7000 (currently 5,679 warnings) | admin-panel team | L | `v1.0.0` → `v1.2.0` |
| ~~LR-2~~ | ~~Eliminate vendor-panel typecheck failures~~ — **resolved**: `pnpm typecheck`, `pnpm test`, `pnpm build:preview`, `pnpm lint --max-warnings 0` all pass on `main` as of 2026-05-06; `continue-on-error: true` was correctly removed in PR #658. | `vendor-panel/**` | 0 errors | — | — | done |
| LR-3 | Eliminate translation-contract drift in admin-panel typecheck (separate from `pnpm test` translation validation, which now passes). Real source of admin-panel `pnpm typecheck` failure is missing modules (`@medusajs/admin-sdk`, `@medusajs/framework/types`, `stripe`) and ~30 type errors across `src/routes/{ticket-products,venues,...}/**`, `src/types/**` — most introduced by the creator-monetization releases. | `admin-panel/src/routes/**`, `admin-panel/src/types/**` | ~30 type errors | admin-panel team | M | `v1.0.0` |
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

## Process

- Re-generate the in-code marker list with `rg -n "TODO|FIXME" admin-panel/src storefront/src vendor-panel/src` quarterly.
- Each item closed → strike-through here and link the merging PR.
- New audit findings should be appended here, not opened as ad-hoc files.
