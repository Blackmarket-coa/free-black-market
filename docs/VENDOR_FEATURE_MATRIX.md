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
| Farm profile and harvest workflows | `backend/src/api/vendor/farm/*`, `backend/src/api/store/harvests`, `backend/src/modules/harvest` | `vendor-panel/src/routes/farm/*` | Store harvest APIs exist; customer UI evidence is limited in scanned storefront files | 🟡 |
| Invoicing | `backend/src/api/vendor/invoices` | Navigation extension entry exists (`/finances?view=invoicing`) | No storefront invoicing surface found | 🟡 |
| POS mode | No vendor POS API route found in `backend/src/api/vendor` | POS nav item is feature-flagged in `vendor-panel/src/hooks/navigation/use-vendor-navigation.tsx` | POS flag exists in `storefront/src/lib/feature-flags.ts` | 🟡 |

## Method used for this matrix

1. Enumerated route/module directories in:
   - `backend/src/api`
   - `backend/src/modules`
   - `vendor-panel/src/routes`
   - `storefront/src/app`, `storefront/src/components`, `storefront/src/lib`
2. Marked capabilities as complete/partial only when implementation evidence was present in repo files.
3. Avoided deriving status from planning/tracker docs.
