# Admin Panel

The operator-facing dashboard for [Free Black Market](../README.md) (FBM), a
cooperative multi-vendor commerce platform built on
[MedusaJS](https://www.medusajs.com). This app started from the
[Mercur](https://github.com/mercurjs/mercur) admin-panel starter and has been
extended with FBM-specific marketplace, playbook/co-op, and compliance
features.

## What it does

- **Product management** — add, edit, and organize products across vendors.
- **Order tracking** — monitor order status and fulfillment.
- **Store customization** — update store-level details.
- **Sellers** — manage vendor accounts and their assigned playbook.
- **Requests** — accept or reject vendor onboarding requests.
- **Attributes** — manage global product attributes.
- **Commissions** — inspect and manage commission and patronage-refund data.

## Quickstart

From the repo root, install workspace dependencies once:

```bash
pnpm install
```

Then run this app:

```bash
cd admin-panel
cp .env.template .env.local   # fill in the values
pnpm dev
```

At minimum, set:

```
VITE_MEDUSA_BASE='/'
VITE_MEDUSA_STOREFRONT_URL=http://localhost:3000
VITE_MEDUSA_BACKEND_URL=http://localhost:9000
```

See `.env.template` for the full list of supported variables.

## Guides

### Rocket.Chat setup

Chat functionality requires a Rocket.Chat instance. Set the `ROCKETCHAT_URL`
environment variable in the backend to enable messaging.

## Related

- Backend API: `../backend/README.md`
- Vendor-facing counterpart: `../vendor-panel/README.md`
- Repository overview: `../README.md`
