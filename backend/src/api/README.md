# API Routes

File-based REST routes (Medusa convention: a directory path plus `route.ts`
maps to a URL; see
<https://docs.medusajs.com/learn/fundamentals/api-routes>).

## Route trees

- `store/` — customer-facing storefront API (catalog, cart/checkout
  extensions, subscriptions, rentals, tickets, wishlists, reviews,
  collective commerce, donations, XP/character, embeds).
- `vendor/` — seller-facing API consumed by the vendor panel and vertical
  portals (products, orders, fulfillment, farm, nursery, botanical,
  wellness, quests, imports, analytics, embed keys, hawala).
- `admin/` — operator API consumed by the admin panel (sellers, requests,
  donations, asset-graph, vendor-hype, tenancy, hawala).
- `auth/` — auth extensions (e.g. seller registration requests).
- `v1/` — the BMC marketplace-layer API (`admin`, `seller`, `marketplace`,
  `checkout`, `integrations`, `webhooks`): creator commerce, service
  programs, plugin listings/signing, Blackout and Blackstar integration
  endpoints. Contracts: `docs/contracts/marketplace-layer.md`.
- `webhooks/` — inbound webhook receivers (hawala/Stripe, supplier status).
- `health/` — liveness (`/health`) and readiness (`/health/ready`) probes
  (see `docs/HEALTHCHECKS.md`).
- `r/` — short-code redirects for creator affiliate links
  (creator-attribution).
- `key-exchange/`, `product-feed/`, `deliveries/`, `delivery-zones/`,
  `restaurants/`, `tickets/`, `users/` — narrower feature surfaces.

**Nothing guards a route outside `store/`, `admin/`, `vendor/` and `auth/`
by default.** Medusa authenticates `/admin`, asks `/store` for a publishable
key, and Mercur guards `/vendor`; a route file anywhere else is served to
anyone on the internet unless a matcher or the handler says otherwise
(`/restaurants` was open that way: SD-116). Before adding one, decide who may
call it, guard it (`middlewares/bare-prefix-auth.ts` holds the admin-only
prefixes), and add it to the reviewed list in
`__tests__/bare-prefix-route-guards.unit.spec.ts`, which fails until you do.

## Cross-cutting pieces

- `middlewares.ts` + `middlewares/` — auth scoping, seller context,
  tenancy context, password-history enforcement, feature gates.
- `hawala-validation.ts` — rejects Coalition-Credit calls without a
  purchase context (Posture A guard; see `docs/POSTURE_A_COMPLIANCE.md`).
- `validation-schemas.ts`, `shared/`, `utils/` — shared request validation
  and helpers.

For which module backs which route prefix, see
[`docs/MODULE_CATALOG.md`](../../../docs/MODULE_CATALOG.md).
