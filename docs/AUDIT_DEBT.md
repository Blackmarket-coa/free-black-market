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
| ~~TD-2~~ | ~~Order list pagination~~ — **resolved**: pagination implemented at `storefront/src/app/[locale]/(main)/user/orders/page.tsx:33-94` (LIMIT=10, offset-based slicing, `<OrdersPagination />` render). Verified 2026-05-13. | `storefront/src/app/[locale]/(main)/user/orders/page.tsx` | 0 | — | — | done |
| TD-3 | Sell signup → API integration | `storefront/src/app/[locale]/(main)/sell/page.tsx` | 1 | storefront team | S | `v1.0.0` |
| ~~TD-4~~ | ~~Order details status source~~ — **resolved**: status sourced from `order.fulfillment_status` / `order.payment_status` on `HttpTypes.StoreOrder` at `storefront/src/components/organisms/OrderDefails/OrderDetails.tsx:33,42`. Verified 2026-05-13. | `storefront/src/components/organisms/OrderDefails/OrderDetails.tsx` | 0 | — | — | done |
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
| LR-3 | Eliminate translation-contract drift in admin-panel typecheck (separate from `pnpm test` translation validation, which now passes). Real source of admin-panel `pnpm typecheck` failure is **19 distinct `Cannot find module` errors** that cascade into **710 total `error TS` lines** (re-measured 2026-05-13). Missing modules: `@medusajs/admin-sdk`, `@medusajs/framework/types`, `@medusajs/types/src/http`, `@sentry/browser`, `stripe`, plus 4 local creator-monetization path failures (`../../components/create-venue-modal`, `./render`, `./tax-region-general-detail`, `./tax-region-province-section`). Most root-cause errors live in `src/routes/{ticket-products,venues,...}/**`, `src/types/**`. | `admin-panel/src/routes/**`, `admin-panel/src/types/**` | 19 root modules / 710 cascaded errors | admin-panel team | M | `v1.0.0` |
| LR-4 | Replace backend `lint` (currently aliased to `tsc --noEmit`) with a real ESLint flat config that lints `src/**/*.{ts,tsx}` with `--max-warnings 0` | `backend/package.json`, new `backend/eslint.config.mjs` | aliased to typecheck | backend team | M | `v1.1.0` |
| LR-5 | Eliminate storefront `pnpm typecheck` failures: missing `sonner` dep import in `src/lib/helpers/toast.ts`, `null` vs `Record<string, string \| undefined>` / `ClientHeaders` mismatches in `src/lib/data/{cart,customer,orders,products,wishlist}.ts`, `'apiProducts' possibly null` in `AlgoliaProductsListing.tsx`, `SellerProps.verified` missing in `ProductFeed/ProductFeedItem.tsx`, `SellerScheduling` merged-declaration / `isolatedModules` errors, missing `@type/categories` module in `ShopByStyleSection.tsx`, missing `NextFetchRequestConfig` export in `src/lib/config.ts`, plus `BodyInit` mismatches in `src/lib/data/collective.ts`. `next.config.ts` sets `typescript.ignoreBuildErrors: true` so the build is unaffected; CI step is `continue-on-error: true` until this lands. **Re-measured 2026-05-13 against `tsc --noEmit`: 29 `error TS` entries** (not ~12 as previously documented). | `storefront/src/lib/{data,helpers,config.ts}`, `storefront/src/components/sections/{CartReview,ProductFeed,ProductListing,SellerScheduling,ShopByStyle}/**` | 29 type errors | storefront team | M | `v1.0.0` |

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

All five rows below were resolved together on 2026-05-13 via the production-readiness pass on branch `claude/check-production-readiness-WGO1m`. `.trivyignore` was emptied at the same time so the Trivy gate now catches regressions.

| # | Package | Range | Fixed | CVEs | Affected lockfile | Owner | Effort | Target |
|---|---------|-------|-------|------|-------------------|-------|:------:|--------|
| ~~SD-1~~ | ~~`@mikro-orm/core` `<6.6.10`~~ — **resolved**: bumped to `6.6.10` across `@mikro-orm/{core,cli,knex,migrations,postgresql}` in `backend/package.json` (direct deps + pnpm.overrides) and root `package.json` on 2026-05-13. Lockfiles now have a single `@mikro-orm/core@6.6.10` graph. | `<6.6.10` → `6.6.10` | CVE-2026-34220, CVE-2026-34221 | `backend/pnpm-lock.yaml`, root `pnpm-lock.yaml` | — | — | done |
| ~~SD-2~~ | ~~`lodash` `<4.18.0`~~ — **resolved**: bumped to `^4.18.0` (resolves to `4.18.1`) in `backend/`, `storefront/`, `vendor-panel/`, `admin-panel/` package.json + pnpm.overrides on 2026-05-13. Runtime `lodash` is `4.18.1` everywhere; remaining `@types/lodash@4.17.x` is a types package, not exploitable. | `<4.18.0` → `4.18.1` | CVE-2026-4800 | `backend/`, `storefront/`, `vendor-panel/`, `admin-panel/pnpm-lock.yaml` | — | — | done |
| ~~SD-3~~ | ~~`picomatch` `<4.0.4`~~ — **resolved**: pinned via pnpm.overrides `>=4.0.4` (resolves to `4.0.4`) in `backend/`, `storefront/`, `vendor-panel/`, `admin-panel/package.json` on 2026-05-13. No 2.x copies remain at runtime. | `<2.3.2 / <3.0.2 / <4.0.4` → `4.0.4` | CVE-2026-33671 | `backend/`, `storefront/`, `vendor-panel/`, `admin-panel/pnpm-lock.yaml` | — | — | done |
| ~~SD-4~~ | ~~`axios` `<1.15.2`~~ — **resolved**: bumped to `^1.15.2` (resolves to `1.16.0`) via direct dep in `backend/package.json` and pnpm.overrides in `backend/`, `storefront/`, `vendor-panel/package.json` on 2026-05-13. | `<1.15.2` → `1.16.0` | CVE-2026-42033, 42035, 42043, 42264 | `backend/`, `storefront/`, `vendor-panel/pnpm-lock.yaml` | — | — | done |
| ~~SD-5~~ | ~~`next` `<15.5.15`~~ — **resolved**: bumped to `15.5.15` in `storefront/package.json` (dep + resolutions + pnpm.overrides) on 2026-05-13. | `<15.5.15` → `15.5.15` | GHSA-q4gf-8mx6-v5v3 | `storefront/pnpm-lock.yaml` | — | — | done |

## Process

- Re-generate the in-code marker list with `rg -n "TODO|FIXME" admin-panel/src storefront/src vendor-panel/src` quarterly.
- Each item closed → strike-through here and link the merging PR.
- New audit findings should be appended here, not opened as ad-hoc files.
