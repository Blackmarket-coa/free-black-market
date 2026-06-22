# TODO Tracker

Generated from in-code `TODO`/`FIXME` markers in `admin-panel/src`, `storefront/src`, and `vendor-panel/src`.

**Open items:** 12 *(12 admin-panel code markers remain after TD-1 triage; 2 resolved 2026-06-22 — see below. The audit-derived manual follow-up is resolved.)*

> **TD-1 triage (2026-06-22).** admin-panel is a vendored fork of
> `@medusajs/dashboard@2.14.2`; all 14 markers are upstream, Low-severity. Two
> were safe to fix in-fork (✅ below). The remaining 12 describe **Medusa
> framework / backend limitations** (missing bulk endpoints, RQ join gaps, no
> `region_id`/`order` on the relevant APIs, incomplete SDK response shapes) or
> **upstream component / i18n architecture decisions** — they are deferred to
> the backend/upstream rather than patched in the fork, and tracked here with a
> per-item rationale (see "Triage" column).

## Summary by area and severity

| App | Open Items | High | Medium | Low | Top Areas |
|---|---:|---:|---:|---:|---|
| admin-panel | 12 | 0 | 0 | 12 | `routes/orders` (5), `routes/products` (2), `components/data-grid` (1) |
| storefront | 0 | 0 | 0 | 0 | — |
| vendor-panel | 0 | 0 | 0 | 0 | — |

## admin-panel (14)

### Area breakdown

| Area | Count |
|---|---:|
| `routes/orders` | 5 |
| `routes/products` | 1 |
| `components/data-grid` | 1 |
| `components/table` | 1 |
| `hooks/table` | 1 |
| `hooks/use-date.tsx` | 1 |
| `routes/locations` | 1 |
| `routes/product-variants` | 1 |

### Items (sorted by severity → area → file)

| Status | Triage | Area | File | Note |
|---|---|---|---|---|
| ⬜ | Upstream | `components/data-grid` | `data-grid/components/data-grid-root.tsx` | Restore focus (anchor/rangeEnd) after undo/redo — needs data-grid command-infra rework (vendored Medusa component). |
| ⬜ | Upstream | `components/table` | `table/data-table/.../data-table-root.tsx` | Sticky header during vertical scroll — CSS can't do sticky + horizontal scroll natively; custom solution is upstream component work. |
| ⬜ | Backend | `hooks/table` | `hooks/table/query/use-shipping-option-table-query.tsx` | `region_id` is not accepted by the shipping-option list API yet. |
| ⬜ | Architectural | `hooks/use-date.tsx` | `hooks/use-date.tsx` | Date locale is derived from the i18n language (en-US for English). Decoupling needs an i18n config decision (or an en-GB translation). |
| ⬜ | Backend | `routes/locations` | `routes/locations/location-list/constants.ts` | `*address` isn't joined by Request Query; field list is a workaround until the RQ join is fixed upstream. |
| ⬜ | Backend | `routes/orders` | `routes/orders/order-allocate-items/.../order-allocate-items-form.tsx` | Needs a bulk allocate endpoint so allocation runs in a revertible workflow instead of N parallel requests. |
| ✅ | Fixed | `routes/orders` | `routes/orders/order-create-claim/components/claim-create-form/claim-create-form.tsx` | **Resolved 2026-06-22** — Escape now sets `IS_CANCELING` via a keydown listener, so ESC-close cancels the in-progress claim like the Cancel button. |
| ⬜ | Backend | `routes/orders` | `routes/orders/order-create-claim/components/claim-create-form/schema.ts` | `item_id` vs `variant_id` is an API-contract clarification; the field name follows the claim endpoint. |
| ⬜ | Upstream | `routes/orders` | `routes/orders/order-create-fulfillment/.../order-create-fulfillment-form.tsx` | Edge case: original shipping option deleted — needs a UX decision (fallback vs warning). |
| ⬜ | Backend | `routes/orders` | `routes/orders/order-detail/components/order-activity-section/order-timeline.tsx` | Activity action details only carry `original_email`; showing full customer info needs an action-log schema change. |
| ⬜ | Backend | `routes/orders` | `routes/orders/order-detail/order-detail.tsx` | JS sort of items because the order retrieve endpoint has no `order` ability yet. |
| ⬜ | Backend | `routes/product-variants` | `routes/product-variants/.../product-edit-variant-form.tsx` | Options keyed by title (no ID) — needs the backend to accept option IDs or change the constraint handling. |
| ✅ | Fixed | `routes/products` | `routes/products/product-create-variant/components/create-product-variant-form/create-product-variant-form.tsx` | **Resolved 2026-06-22** — `isTabDirty(tab)` implemented via `form.formState.dirtyFields` keyed by each tab's field set; a touched tab keeps its progress on backward nav instead of resetting. |
| ⬜ | Backend | `routes/products` | `routes/products/product-detail/components/product-sales-channel-section/product-sales-channel-section.tsx` | The sales-channel SDK response lacks fields the section wants; needs a richer endpoint/response. |

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

- Refreshed on: 2026-06-22 (TD-1 triage pass).
- Code marker scan command run: `rg -n "TODO|FIXME" admin-panel/src storefront/src vendor-panel/src`
- Result: 12 open in-code TODO/FIXME markers (admin-panel only; 2 resolved this pass) + 0 open manual storefront audit follow-ups. All 12 remaining are vendored-Medusa, Low severity, and triaged as backend/upstream/architectural (see the Triage column).
