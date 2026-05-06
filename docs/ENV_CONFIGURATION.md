# Environment Configuration Reference

Centralized reference for all FreeBlackMarket environment variables. App
templates live in:

- `backend/.env.template`
- `storefront/.env.template`
- `vendor-panel/.env.template`
- `admin-panel/.env.template`

Production validation rules are enforced by `scripts/assert-env.mjs`,
which is invoked at startup via `backend/medusa-config.ts` and
`storefront/instrumentation.ts`. Failing values cause the app to refuse
to boot.

## BMC marketplace layer

Added in the marketplace-layer pass that introduces entitlements,
plugin/theme listings, group commerce, and Blackstar/Blackout
integration hooks.

| Variable | Default | Required when | Description |
| --- | --- | --- | --- |
| `FBM_BLACKOUT_INTEGRATION` | `0` | always | `1` enables `/v1/integrations/blackout/*` routes (OAuth token + entitlements). `0` makes those routes return `503`. |
| `BLACKOUT_CLIENT_ID` | — | `FBM_BLACKOUT_INTEGRATION=1` in production | Reused from the existing Blackout integration scaffold. OAuth client_credentials. |
| `BLACKOUT_CLIENT_SECRET` | — | `FBM_BLACKOUT_INTEGRATION=1` in production | Same. Validated as a min-32-char secret with banned-prefix check. |
| `FBM_BLACKOUT_TOKEN_TTL_SECONDS` | `3600` | optional | TTL of the JWT issued by the OAuth token endpoint. |
| `FBM_BLACKSTAR_INTEGRATION` | `0` | always | `1` registers the `blackstar` fulfillment provider and enables the inbound shipment webhook. `0` keeps the provider unregistered. |
| `FBM_BLACKSTAR_API_KEY` | — | `FBM_BLACKSTAR_INTEGRATION=1` in production | Shared secret expected on the `x-fbm-integration-key` header for Blackstar shipment webhooks. Min 32 chars. |
| `FBM_DEFAULT_REFERRAL_PERCENT` | — | optional | Default referral commission (0-100) used when active `PayoutConfig` does not set one. |
| `FBM_DEFAULT_PLUGIN_DEVELOPER_PERCENT` | — | optional | Default plugin / theme / emoji-pack developer share (0-100). |
| `FBM_ENTITLEMENT_DEFAULT_DURATION_DAYS` | (perpetual) | optional | Default lifetime for entitlements granted without an explicit duration. |
| `FBM_ONBOARDING_FOLLOWUP_DELAY_MS` | `172800000` (48h) | optional | Delay used by the Sprint A → C 48h follow-up subscriber. |
| `PUBLIC_STOREFRONT_URL` | — | optional | Used by the launch wizard's share screen for storefront URL building. Never hardcoded in code. |

## Existing variables (reference)

The above is layered on top of the existing template:

- Required core: `JWT_SECRET`, `COOKIE_SECRET`, `DATABASE_URL`, `MEDUSA_ADMIN_PASSWORD` (validated)
- CORS: `STORE_CORS`, `ADMIN_CORS`, `VENDOR_CORS`, `VENDOR_PANEL_URL`, `AUTH_CORS`
- Optional services: Stripe, Algolia, Resend, SMTP, Printful, MinIO, Odoo, Sentry
- Feature flags: `ENABLE_STELLAR_SETTLEMENT`, `ENABLE_STRIPE_ACH`
- Railway: `NODE_MEMORY_MB`, `DB_POOL_MAX`, `DB_SSL_REJECT_UNAUTHORIZED`, `DB_SSL_CA`
- Storefront: `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY`, `NEXT_PUBLIC_STRIPE_KEY`, `REVALIDATE_SECRET`, `NEXT_PUBLIC_CREATOR_ATTRIBUTION_DEFAULT_COOKIE_DAYS`

## How to add a new variable

1. Append to the matching `.env.template` with a one-line description.
2. If production-critical, add a rule to `scripts/assert-env.mjs` (use
   `CONDITIONAL_RULES` for opt-in integrations).
3. Document it here under the relevant section.
4. Reference it in `docs/contracts/marketplace-layer.md` if it gates an
   API surface.
