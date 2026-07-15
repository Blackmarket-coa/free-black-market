# Vendor Panel

The seller-facing dashboard for [Free Black Market](../README.md) (FBM), a
cooperative multi-vendor commerce platform built on
[MedusaJS](https://www.medusajs.com). This app started from the
[Mercur](https://github.com/mercurjs/mercur) vendor-panel starter and has
been extended with FBM's playbook (co-op governance), sliding-scale pricing,
and Coalition Credits payout features.

## What it does

- **Product management** — add, edit, and organize products.
- **Order tracking** — monitor order status and manage fulfillment.
- **Store customization** — update vendor store details.
- **Playbook & governance** — pick a playbook at setup (solo seller, worker
  co-op, multi-stakeholder co-op, CSA, mutual-aid garden, and more); the
  playbook shapes dashboard chrome, allowed listing-types, and payout
  structure. See `../docs/PLAYBOOK_SYSTEM.md`.
- **Review handling** — engage with customer feedback.
- **Analytics dashboard** — sales performance and customer behavior insights.

## Quickstart

From the repo root, install workspace dependencies once:

```bash
pnpm install
```

Then run this app:

```bash
cd vendor-panel
cp .env.template .env.local   # fill in the values
pnpm dev
```

At minimum, set:

```
VITE_MEDUSA_BASE='/'
VITE_MEDUSA_STOREFRONT_URL=http://localhost:3000
VITE_MEDUSA_BACKEND_URL=http://localhost:9000
VITE_ROCKETCHAT_URL=https://your-rocketchat-url
VITE_DISABLE_SELLERS_REGISTRATION=false
```

See `.env.template` for the full list of supported variables.

## Guides

### Rocket.Chat setup

Set up a Rocket.Chat instance and configure `VITE_ROCKETCHAT_URL` with your
Rocket.Chat server URL to enable chat functionality.

## Related

- Backend API: `../backend/README.md`
- Operator-facing counterpart: `../admin-panel/README.md`
- Playbook system: `../docs/PLAYBOOK_SYSTEM.md`
- Repository overview: `../README.md`
