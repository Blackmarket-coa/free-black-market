# Storefront

The customer-facing storefront for [Free Black Market](../README.md) (FBM),
a cooperative multi-vendor commerce platform built on
[MedusaJS](https://www.medusajs.com). This app started from the
[Mercur](https://github.com/mercurjs/mercur) B2C storefront starter and has
been extended with sliding-scale checkout, donation/mutual-aid widgets, and
FBM's vertical-portal branding.

## What it does

- Home page, catalog listing, product page, cart, and seller page.
- Wishlist.
- Sliding-scale pricing tiers and donation-toggle checkout (see
  `../docs/COMPOSITION_LAYER.md`).
- Vendor-facing "Selling Hub" flows live in the separate `../vendor-panel`
  app.

The vertical portals (plant nursery, wellness, botanical, creator) in
`../nursery-portal`, `../wellness-portal`, `../botanical-portal`, and
`../creator-portal` are vendor back-office dashboards (dev only, not deployed),
not customer storefronts — this app is the only storefront. They share this
backend and the `@bmc/portal-kit` / `@bmc/ui` packages.

## Quickstart

From the repo root, install workspace dependencies once:

```bash
pnpm install
```

Then run this app:

```bash
cd storefront
cp .env.template .env.local   # fill in the values
pnpm dev
```

At minimum, set:

```bash
# API URL
MEDUSA_BACKEND_URL=http://localhost:9000
# Publishable key generated in the admin panel
NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=
# Public site URL
NEXT_PUBLIC_BASE_URL=http://localhost:3000
# Default region
NEXT_PUBLIC_DEFAULT_REGION=us
# Stripe payment key (can be a placeholder in dev, do not leave empty)
NEXT_PUBLIC_STRIPE_KEY=supersecret
# Backend revalidation secret
REVALIDATE_SECRET=supersecret
# Site metadata
NEXT_PUBLIC_SITE_NAME="Free Black Market"
NEXT_PUBLIC_SITE_DESCRIPTION="Free Black Market"
# Algolia (optional, see below)
NEXT_PUBLIC_ALGOLIA_ID=
NEXT_PUBLIC_ALGOLIA_SEARCH_KEY=
# Matrix/Synapse (Blackout) chat (optional, see below)
NEXT_PUBLIC_MATRIX_ELEMENT_URL=
NEXT_PUBLIC_MATRIX_SERVER_NAME=
```

See `.env.template` for the full list of supported variables.

## Guides

### Chat (Matrix) setup

Chat runs on Blackout's Matrix/Synapse server through an embedded Element Web
client. Set `NEXT_PUBLIC_MATRIX_ELEMENT_URL` to the public Element Web base URL
and `NEXT_PUBLIC_MATRIX_SERVER_NAME` to the Matrix server name (used to build
room aliases such as `#vendor-<handle>:<server>`). Auto-login tokens are
delivered server-side via the backend's `/store/chat` route. With
`NEXT_PUBLIC_MATRIX_ELEMENT_URL` unset, chat is not shown.

### Algolia search setup (optional)

Algolia is optional and client-side only. With `NEXT_PUBLIC_ALGOLIA_ID` and
`NEXT_PUBLIC_ALGOLIA_SEARCH_KEY` set, the catalog, seller and product-listing
views query an Algolia index directly from the browser; with either unset they
fall back to listings served by the backend. The backend no longer indexes
products into Algolia (the `@mercurjs/algolia` plugin was removed; see
`../backend/medusa-config.ts`), so an index you point the storefront at has to
be populated some other way.

1. Get your Algolia keys: <https://www.algolia.com/doc/guides/security/api-keys/>
2. In the Algolia dashboard, select your index, then **Manage index → Import
   configuration**, and upload [`algolia-config.json`](./algolia-config.json)
   to configure facets and searchable attributes.

## Related

- Backend API: `../backend/README.md`
- Vendor dashboard: `../vendor-panel/README.md`
- Repository overview: `../README.md`
