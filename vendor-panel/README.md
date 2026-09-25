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
VITE_DISABLE_SELLERS_REGISTRATION=false
```

See `.env.template` for the full list of supported variables.

## Guides

### Chat (Matrix) setup

Chat runs on Blackout's Matrix/Synapse server through an embedded Element Web
client, configured on the **backend**: set the `MATRIX_*` variables in
`../backend/.env.template` (`MATRIX_HOMESERVER_URL`, `MATRIX_SERVER_NAME`,
`MATRIX_ADMIN_TOKEN`, `MATRIX_ELEMENT_URL`, …). The panel calls
`GET /vendor/chat`, which returns whether chat is configured, the Element URL,
the server name and a single-use login token; the unread badge polls
`GET /vendor/chat/unread`. `VITE_MATRIX_ELEMENT_URL` / `VITE_MATRIX_SERVER_NAME`
are optional build-time fallbacks for when the backend does not return them.

## Related

- Backend API: `../backend/README.md`
- Operator-facing counterpart: `../admin-panel/README.md`
- Playbook system: `../docs/PLAYBOOK_SYSTEM.md`
- Repository overview: `../README.md`
