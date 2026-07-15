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

For vertical-specific storefronts (plant nursery, wellness, botanical,
creator), see `../nursery-portal`, `../wellness-portal`,
`../botanical-portal`, and `../creator-portal` — they share this backend and
the `@bmc/portal-kit` / `@bmc/bmc-ui` packages.

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
# Rocket.Chat URL for messaging
NEXT_PUBLIC_ROCKETCHAT_URL=https://your-rocketchat-url
```

See `.env.template` for the full list of supported variables.

## Guides

### Rocket.Chat setup

Set up a Rocket.Chat instance and configure `NEXT_PUBLIC_ROCKETCHAT_URL` with
your Rocket.Chat server URL to enable chat functionality.

### Algolia search setup

1. Get your Algolia keys: <https://www.algolia.com/doc/guides/security/api-keys/>
2. In the Algolia dashboard, select your index, then **Manage index → Import
   configuration**, and upload [`algolia-config.json`](./algolia-config.json)
   to configure facets and searchable attributes.

## Related

- Backend API: `../backend/README.md`
- Vendor dashboard: `../vendor-panel/README.md`
- Repository overview: `../README.md`
