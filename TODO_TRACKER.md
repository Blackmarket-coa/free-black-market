# TODO Tracker

Generated from in-code `TODO`/`FIXME` markers in `admin-panel/src`, `storefront/src`, and `vendor-panel/src`.

**Open items:** 14 *(14 admin-panel code markers; the audit-derived manual follow-up is now resolved — see below)*

## Summary by area and severity

| App | Open Items | High | Medium | Low | Top Areas |
|---|---:|---:|---:|---:|---|
| admin-panel | 14 | 0 | 0 | 14 | `routes/orders` (6), `routes/products` (2), `components/data-grid` (1) |
| storefront | 0 | 0 | 0 | 0 | — |
| vendor-panel | 0 | 0 | 0 | 0 | — |

## admin-panel (14)

### Area breakdown

| Area | Count |
|---|---:|
| `routes/orders` | 6 |
| `routes/products` | 2 |
| `components/data-grid` | 1 |
| `components/table` | 1 |
| `hooks/table` | 1 |
| `hooks/use-date.tsx` | 1 |
| `routes/locations` | 1 |
| `routes/product-variants` | 1 |

### Items (sorted by severity → area → file)

| Status | Severity | Area | File | Line | Note |
|---|---|---|---|---:|---|
| ⬜ | Low | `components/data-grid` | `admin-panel/src/components/data-grid/components/data-grid-root.tsx` | 94 | * TODO: |
| ⬜ | Low | `components/table` | `admin-panel/src/components/table/data-table/data-table-root/data-table-root.tsx` | 66 | * TODO |
| ⬜ | Low | `hooks/table` | `admin-panel/src/hooks/table/query/use-shipping-option-table-query.tsx` | 44 | // TODO: We don't allow region_id in the API yet |
| ⬜ | Low | `hooks/use-date.tsx` | `admin-panel/src/hooks/use-date.tsx` | 7 | // TODO: We rely on the current language to determine the date locale. This is not ideal, as we use en-US for the english translation. |
| ⬜ | Low | `routes/locations` | `admin-panel/src/routes/locations/location-list/constants.ts` | 1 | // TODO: change this when RQ is fixed (address is not joined when *address) |
| ⬜ | Low | `routes/orders` | `admin-panel/src/routes/orders/order-allocate-items/components/order-create-fulfillment-form/order-allocate-items-form.tsx` | 99 | * TODO: we should have bulk endpoint for this so this is executed in a workflow and can be reverted |
| ⬜ | Low | `routes/orders` | `admin-panel/src/routes/orders/order-create-claim/components/claim-create-form/claim-create-form.tsx` | 572 | // TODO: add this on ESC press |
| ⬜ | Low | `routes/orders` | `admin-panel/src/routes/orders/order-create-claim/components/claim-create-form/schema.ts` | 14 | item_id: z.string(), // TODO: variant id? |
| ⬜ | Low | `routes/orders` | `admin-panel/src/routes/orders/order-create-fulfillment/components/order-create-fulfillment-form/order-create-fulfillment-form.tsx` | 181 | } // else -> TODO: what if original shipping option is deleted? |
| ⬜ | Low | `routes/orders` | `admin-panel/src/routes/orders/order-detail/components/order-activity-section/order-timeline.tsx` | 1030 | * TODO: change original_email to customer info when action details is changed |
| ⬜ | Low | `routes/orders` | `admin-panel/src/routes/orders/order-detail/order-detail.tsx` | 41 | // TODO: Retrieve endpoints don't have an order ability, so a JS sort until this is available |
| ⬜ | Low | `routes/product-variants` | `admin-panel/src/routes/product-variants/product-variant-edit/components/product-edit-variant-form/product-edit-variant-form.tsx` | 44 | // TODO: Either pass option ID or make the backend handle options constraints differently to handle the lack of IDs |
| ⬜ | Low | `routes/products` | `admin-panel/src/routes/products/product-create-variant/components/create-product-variant-form/create-product-variant-form.tsx` | 128 | const isCurrentTabDirty = false // isTabDirty(tab) TODO |
| ⬜ | Low | `routes/products` | `admin-panel/src/routes/products/product-detail/components/product-sales-channel-section/product-sales-channel-section.tsx` | 12 | // TODO: The fetched sales channel doesn't contain all necessary info |

## storefront (0)

- No open TODO/FIXME markers.

## vendor-panel (0)

- No open TODO/FIXME markers.


## Audit-derived storefront follow-ups (manual)

The following open issues were identified in the storefront routes/links/pages audit and should be tracked until resolved:

| Status | Severity | Area | Item | Source |
|---|---|---|---|---|
| ✅ | High | `storefront/routes` | Add route metadata to 20 pages missing `generateMetadata`/`metadata` exports (including `/sell`, `/collections/[handle]`, `/collective/demand-pools/[id]`, and account/password pages). | `storefront/docs/storefront-pages-audit.md` |
| ✅ | High | `storefront/routes` | Add explicit `notFound()` handling to 10 dynamic routes missing fallback behavior (including `/collections/[handle]`, `/products/[handle]`, and `/user/orders/[id]` paths). | `storefront/docs/storefront-pages-audit.md` |
| ✅ | Medium | `storefront/qa` | Add recurring static internal-link route validation in QA/release checks to detect unmatched hard-coded hrefs before release. **Done** — implemented as `storefront/qa/validate-static-routes.mjs` (`pnpm qa:internal-links` / `pnpm release:check`), wired into the CI `lint` job; tracked as resolved (QA-1) in `docs/AUDIT_DEBT.md`. | `storefront/docs/storefront-pages-audit.md` |

## Usage

- Check an item (`⬜` → `✅`) when completed.
- Remove the row once merged if you prefer a compact tracker.
- Re-generate by re-running: `rg -n "TODO|FIXME" admin-panel/src storefront/src vendor-panel/src`.
- Severity buckets are heuristic and based on TODO/FIXME comment text.

## Last refreshed

- Refreshed on: 2026-02-19.
- Code marker scan command run: `rg -n "TODO|FIXME" admin-panel/src storefront/src vendor-panel/src`
- Result: 14 in-code TODO/FIXME markers (admin-panel only) + 1 open manual storefront audit follow-up (2 high-priority follow-ups completed).
