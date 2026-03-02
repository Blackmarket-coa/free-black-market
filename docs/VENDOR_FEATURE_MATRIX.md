# Vendor Feature Matrix

This matrix is based on **repo-implemented artifacts** (routes, modules, and app code), not roadmap/tracker intent.

**Legend**
- ✅ Implemented evidence found in code
- 🟡 Partial evidence (feature flags, extension points, or only one surface wired)
- ❌ No clear implementation evidence found

| Capability | Backend evidence | Vendor Panel evidence | Storefront evidence | Completion |
|---|---|---|---|---|
| Vendor registration/onboarding | `backend/src/api/auth/seller/register-request`, `backend/src/api/vendor/register`, `backend/src/api/vendor/registration-status` | `vendor-panel/src/routes/register`, `vendor-panel/src/routes/onboarding`, `vendor-panel/src/routes/pending-approval` | Seller-aware listing/filtering in `storefront/src/lib/listing/unified-products.ts` | ✅ |
| Product management | `backend/src/api/vendor/products`, `backend/src/api/vendor/seller-products` | `vendor-panel/src/routes/products/*`, `vendor-panel/src/routes/product-variants/*`, `vendor-panel/src/routes/collections/*`, `vendor-panel/src/routes/categories/*` | Product listing/details flows under `storefront/src/lib/listing/unified-products.ts` and product/cart components | ✅ |
| Inventory and reservations | `backend/src/api/vendor/inventory-sync/events`, `backend/src/api/vendor/woocommerce/sync/route.ts`, transition contract in `backend/src/shared/phase0-contracts.ts` | `vendor-panel/src/routes/inventory/*`, inventory sync health card in `vendor-panel/src/routes/inventory/inventory-list/components/inventory-sync-status.tsx`, `vendor-panel/src/routes/reservations/*` | Structured stock-code messaging in checkout helper (`storefront/src/lib/helpers/order-error-formatter.ts`) | ✅ |
| Orders and fulfillment | `backend/src/api/vendor/orders`, `backend/src/api/vendor/deliveries`, `backend/src/api/vendor/pick-pack` | `vendor-panel/src/routes/orders/*`, `vendor-panel/src/routes/deliveries/*` | Cart/checkout/place-order flows in `storefront/src/components/sections/CartReview/*` | ✅ |
| Delivery zones | `backend/src/api/vendor/delivery-zones`, `backend/src/api/store/delivery-zones/check/route.ts`, shared payload contracts in `backend/src/api/delivery-zones/contracts.ts` | `vendor-panel/src/routes/delivery-zones/*` with conflict feedback on create/edit | Checkout delivery-eligibility messaging in `storefront/src/components/sections/CartShippingMethodsSection/CartShippingMethodsSection.tsx` wired to `/store/delivery-zones/check` | ✅ |
| Donations | `backend/src/api/store/donations/*`, vendor donation operational routes in `backend/src/api/vendor/donations/*`, `backend/src/api/admin/donations/*` | `vendor-panel/src/routes/donations/*` + `vendor-panel/src/hooks/api/donations.ts` | Discoverable donations page (`storefront/src/app/[locale]/(main)/donations/page.tsx`), footer entry (`storefront/src/data/footerLinks.ts`), and checkout donation preferences (`storefront/src/components/sections/CartReview/DonationPreferences.tsx`) | ✅ |
| Order cycles / subscriptions / seasons | `backend/src/api/vendor/order-cycles`, `backend/src/api/store/order-cycles`, `backend/src/api/store/subscriptions`, `backend/src/api/store/seasons` | `vendor-panel/src/routes/order-cycles/*` | No obvious dedicated customer-facing UI route in scanned storefront files | 🟡 |
| Reviews and requests | `backend/src/api/vendor/requests`, `backend/src/api/store/requests` | `vendor-panel/src/routes/reviews/*`, `vendor-panel/src/routes/requests/*` | No obvious dedicated storefront review/request management UI in scanned files | 🟡 |
| Messaging/support chat | `backend/src/api/vendor/rocketchat`, `backend/src/api/store/rocketchat` | `vendor-panel/src/routes/messages`, Rocket.Chat provider wiring in navigation | No clear storefront chat surface located | 🟡 |
| Farm profile and harvest workflows | `backend/src/api/vendor/farm/*`, farm/harvest consistency checks in `backend/src/api/vendor/farm/consistency.ts`, provenance propagation in `backend/src/api/store/products/[id]/provenance/route.ts` | `vendor-panel/src/routes/farm/*` with farm profile + harvest create/edit flows | Product provenance payload now includes farm-harvest consistency issues for storefront context consumers; route-flow test coverage in `backend/src/api/vendor/__tests__/farm-provenance-flow.unit.spec.ts` | ✅ |
| Invoicing | `backend/src/api/vendor/invoices` supports list/create/update lifecycle (`draft/sent/paid/void`) and legacy queue contract mode; seller auth + feature-gate enforced in `backend/src/api/middlewares.ts` | Invoicing flow wired in `vendor-panel/src/routes/finances/finances.tsx` (`/finances?view=invoicing`) | Invoices can be associated with order IDs and feed POS payment references; lifecycle route-flow test coverage in `backend/src/api/vendor/__tests__/invoices-route.unit.spec.ts` | ✅ |
| POS mode | POS API support added at `backend/src/api/vendor/pos/config` and `backend/src/api/vendor/pos/checkout` with endpoint map to existing payment/order rails; seller auth + feature-gate enforced in `backend/src/api/middlewares.ts` | Dedicated POS screen at `vendor-panel/src/routes/pos/*` and route wiring in router map | POS checkout interoperates with existing hawala vendor payment pipeline; checkout response covered in `backend/src/api/vendor/__tests__/pos-checkout-route.unit.spec.ts` | ✅ |

## Method used for this matrix

1. Enumerated route/module directories in:
   - `backend/src/api`
   - `backend/src/modules`
   - `vendor-panel/src/routes`
   - `storefront/src/app`, `storefront/src/components`, `storefront/src/lib`
2. Marked capabilities as complete/partial only when implementation evidence was present in repo files.
3. Avoided deriving status from planning/tracker docs.
