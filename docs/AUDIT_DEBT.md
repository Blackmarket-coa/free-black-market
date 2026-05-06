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
| LR-1 | Lower admin-panel ESLint `--max-warnings` from 7000 → 0 in steps (5500 → 4000 → 2000 → 0) | `admin-panel/package.json` `lint` script | 7000 (masks 5,526 errors) | admin-panel team | L | `v1.0.0` → `v1.2.0` |
| LR-2 | Eliminate vendor-panel typecheck failures (currently `continue-on-error: true` in CI) | `vendor-panel/**` | unknown count | vendor-panel team | M | `v1.0.0` |
| LR-3 | Eliminate translation-contract drift (`extraInTranslations` in `en.json`, `fields.currentPriceTemplate` extra key) | `admin-panel/src/i18n/translations/en.json`, `vendor-panel/src/i18n/translations/en.json` | 2 failing suites | i18n owners | S | `v1.0.0` |
| LR-4 | Replace backend `lint` (currently aliased to `tsc --noEmit`) with a real ESLint flat config that lints `src/**/*.{ts,tsx}` with `--max-warnings 0` | `backend/package.json`, new `backend/eslint.config.mjs` | aliased to typecheck | backend team | M | `v1.1.0` |

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
