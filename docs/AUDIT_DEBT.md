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
| ~~TD-3~~ | ~~Sell signup → API integration~~ — **resolved 2026-05-13**: new `sell-signup` backend module (`backend/src/modules/sell-signup`) with a `sell_signup` table (`email`, `store_name`, `selling jsonb`, `status enum`, source_ip / user_agent / referer for spam triage, `status` enum drives the admin lifecycle `new → contacted → converted/rejected`). New `POST /store/sell-signup` endpoint validates the body with zod, persists, and returns `{id, status}` with 202. `storefront/src/app/api/sell-signup/route.ts` now forwards captures to the backend (propagating IP / UA / referer); failures are still swallowed so the client redirect to the vendor-panel registration page never blocks. 611 backend unit tests still pass; both `pnpm typecheck` runs pass. | `backend/src/modules/sell-signup/**`, `backend/src/api/store/sell-signup/route.ts`, `backend/medusa-config.ts`, `storefront/src/app/api/sell-signup/route.ts`, `storefront/src/app/[locale]/(main)/sell/SellPageClient.tsx` | 0 | — | — | done |
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
| LR-1 | Lower admin-panel ESLint `--max-warnings` from 7000 → 0 in steps (~~5500~~ → ~~4000~~ → 2000 → 0). **Step 1 done 2026-05-13**: ratcheted 7000 → 5500 after `pnpm exec eslint --fix` cleared 1,586 auto-fixable warnings (mostly `@typescript-eslint/consistent-type-imports` and `newline-before-return`). **Step 2 done 2026-05-13**: ratcheted 5500 → 4000 after adding the conventional `^_` ignorePattern to `@typescript-eslint/no-unused-vars` (covering `argsIgnorePattern`, `varsIgnorePattern`, `caughtErrorsIgnorePattern`, `destructuredArrayIgnorePattern` — the codebase already conventionally `_`-prefixes intentionally-unused identifiers) plus targeted cleanup of 12 unused imports + 23 unused-var renames + 4 bare-`catch` conversions. Count is now 3,998 with `lint` exit 0; typecheck dropped 670 → 647 as a side-effect of removing dead imports. Next step (4000 → 2000) needs ~1,998 more warnings cleared — the dominant rule (`no-restricted-imports`, 3,077 occurrences) blocks the next ratchet without either rewriting relative `../` imports to `@/` aliases at scale or relaxing the rule. | `admin-panel/package.json` `lint` script, `admin-panel/.eslintrc.json` | 4000 cap (currently 3,998 warnings) | admin-panel team | L | `v1.0.0` → `v1.2.0` |
| ~~LR-2~~ | ~~Eliminate vendor-panel typecheck failures~~ — **resolved**: `pnpm typecheck`, `pnpm test`, `pnpm build:preview`, `pnpm lint --max-warnings 0` all pass on `main` as of 2026-05-06; `continue-on-error: true` was correctly removed in PR #658. | `vendor-panel/**` | 0 errors | — | — | done |
| LR-3 | Eliminate type drift in admin-panel typecheck (separate from `pnpm test` translation validation, which now passes). **Partially landed 2026-05-13** (5 sub-passes): pass 1 installed missing devDeps + restored missing files (710 → 671); pass 2 cleared `requests/` (671 → 629); pass 3 cleared `tax-regions/` + deduplicated `RequestStatus` (629 → 604); pass 4 cleared `components/table/`, `hooks/table/`, `locations/`, `regions/`, `reservations/`, `price-lists/` (604 → 535); pass 5 cleared `hooks/api/`, `inventory/`, `customers/`, and the phase0 feature-flag env declarations (535 → 472) — aligned 15+ mutation hooks' `UseMutationOptions` response types with what the SDK actually returns (claims/exchanges hooks declared `AdminClaimResponse`/`AdminExchangeResponse` but the methods return `…ReturnPreviewResponse`/`…PreviewResponse`/`…DeleteResponse`), replaced `sdk.admin.user.create` (dropped in 2.12.5) with a typed `sdk.client.fetch<AdminUserResponse>(POST /admin/users)`, parameterised `sdk.client.fetch` in `useReviewRequest` so `onSuccess.data` narrows, swapped React-Query v4 `cacheTime` → v5 `gcTime`, narrowed `usePromotionRules` `UseQueryOptions` `TQueryFnData`, fixed 3 more SDK type renames (`AdminFulfillmentProviderListParams`, `AdminInventoryItemParams`), supplied missing `id` to `pricePreferencesQueryKeys.detail`, cast through the `AdminUpdate \| AdminCreate` union in `useUpsertPricePreference`, added `VITE_FF_*` declarations to `ImportMetaEnv`, repointed `InventoryTypes.InventoryItemDTO` → `HttpTypes.AdminInventoryItem` in two edit-item forms, swapped workflow `InventoryLevelDTO`/`StockLocationDTO` for `AdminInventoryLevel`/`AdminStockLocation` in the adjust-inventory form, structurally-cast `AdminInventoryItem.stocked_quantity`/`reserved_quantity` (declared on `AdminInventoryLevel` only but inlined in the admin response), switched the location-level table's `stock_locations.0.name` accessor from path-string to function form, exported `ExtendedLocationLevel` and cast `inventory_levels` accordingly, coerced 4 `string \| null` → `undefined` in `edit-customer-form`, dropped `email` from `AdminUpdateCustomer` payload (not accepted by the SDK), wrapped `mutateAsync` for two more `MetaDataSubmitHook` consumers, narrowed `e: unknown` in 2 catch blocks. The 472 residual errors live in Medusa-inherited routes (`orders/**` ~308, `promotions/**` ~53, `products/**` ~40, `product-variants/**` ~32, plus small clusters); they do not block runtime (`vite build` ignores TS errors) but do block flipping CI to fail-fast. CI step remains `continue-on-error: true`. | `admin-panel/src/routes/{orders,promotions,products,product-variants}/**` | 472 errors across ~120 files | admin-panel team | M | `v1.0.0` |
| LR-4 | Replace backend `lint` (currently aliased to `tsc --noEmit`) with a real ESLint flat config that lints `src/**/*.{ts,tsx}` with `--max-warnings 0` | `backend/package.json`, new `backend/eslint.config.mjs` | aliased to typecheck | backend team | M | `v1.1.0` |
| ~~LR-5~~ | ~~Eliminate storefront `pnpm typecheck` failures.~~ — **resolved 2026-05-13**: installed `sonner@^2.0.7`; inlined `NextFetchRequestConfig` shape after Next 15.5.15 removed the public export; widened `MedusaFetchOptions.body` to `Record<string, unknown>` and `query` value type to include `boolean` (covers `with_deleted`, `shipping_method_ids`, `promo_codes`, `reference`, `action` body fields); coerced `null` returns from `getAuthHeaders()` to `undefined` in `src/lib/data/orders.ts`; gated `apiProducts` access with `?.` / `?? []`; added `verified?: boolean` to `SellerProps`; added missing `Style` export to `src/types/categories.ts`; switched `SellerScheduling.tsx` to `import type` to satisfy `isolatedModules`; narrowed `err: unknown` → `err instanceof Error ? err.message : String(err)` in `src/lib/data/customer.ts`; null-coalesced `res.error` in `PaymentButton.tsx` and `AddressForm.tsx`; moved `headers` to the 4th `deleteLineItem` arg (SDK now takes `SelectParams` 3rd); fixed `@type/categories` → `@/types/categories` path. `pnpm typecheck` now passes; `ci.yml` Storefront typecheck step is fail-fast. | `storefront/src/lib/{data,helpers,config.ts}`, `storefront/src/components/sections/{CartReview,ProductFeed,ProductListing,SellerScheduling,ShopByStyle}/**`, `storefront/src/types/{seller,categories}.ts` | 0 type errors | — | — | done |

## Storefront test coverage

| # | Item | Location | Owner | Effort | Target milestone |
|---|------|----------|-------|:------:|------------------|
| TC-1 | Bring storefront test suite to ≥ 30 % coverage on `src/lib/data/*` and `src/lib/helpers/*` | `storefront/src/**` | storefront team | M | `v1.1.0` |

## Storefront QA

| # | Item | Source | Owner | Effort | Target milestone |
|---|------|--------|-------|:------:|------------------|
| ~~QA-1~~ | ~~Add recurring static internal-link route validation in QA/release checks~~ — **resolved 2026-05-13**: `scripts/release_validation.sh` now invokes `pnpm qa:internal-links` in the storefront block (already wired in `.github/workflows/ci.yml` as a hard gate); release validation will now flag dead internal hrefs alongside other storefront checks. | `scripts/release_validation.sh`, `storefront/scripts/check-internal-links.js` | — | — | — | done |

## Test infrastructure

| # | Item | Location | Owner | Effort | Target milestone |
|---|------|----------|-------|:------:|------------------|
| ~~TI-1~~ | ~~Reconcile backend module migration order so `pnpm test:integration:http` can run end-to-end.~~ — **resolved 2026-05-13**: renamed `Migration20251229AddRawColumns.ts` → `Migration20251230AddRawColumns.ts` (and the class) so `hawala-ledger`'s ALTERs run *after* `Migration20251229CreateHawalaLedger`; added `Migration20260101000000CreateOrderPayoutBreakdown.ts` to the `payout-breakdown` module so the table exists before the three subsequent ALTERs (which already use `ADD COLUMN IF NOT EXISTS` and harmlessly no-op against the baseline). Backend `pnpm typecheck` still passes. CI integration-test step (`ci.yml:409`) remains `continue-on-error: true` until the CI run validates the end-to-end migration graph against a live Postgres; flip to fail-fast in a follow-up once the green run is observed. | `backend/src/modules/{hawala-ledger,payout-breakdown}/migrations/*.ts` | backend team | M | `v1.0.0` |
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
