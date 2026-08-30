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
| `MARKETPLACE_SIGNING_PRIVATE_KEY_PEM` | — | extension signing on (paired with KEY_ID, validated both ways) | Ed25519 private key PEM (`openssl genpkey -algorithm ed25519`) that signs published extension bundles (W3, `docs/contracts/extension-manifest.md`). Unset ⇒ publish 500s `signing_failed` (draft-reverting) and both key endpoints 503. |
| `MARKETPLACE_SIGNING_KEY_ID` | — | extension signing on | Stable key identifier (e.g. `fbm-2026-q3`) surfaced in envelopes, `/v1/marketplace/signing-keys`, and `/.well-known/freeblackmarket-publishing-keys.json`. |
| `FBM_PLATFORM_VERSION` | `1.0.0` | optional | Host platform version the plugin install compat gate checks `min/max_host_version` bounds against (`plugin-registry/compat.ts`). |

## In-app bug reporter

Added with the in-app "Report a bug" entry points in storefront, vendor
panel, and admin panel. The backend opens an issue on the configured
GitHub repository for each submission.

| Variable | Default | Required when | Description |
| --- | --- | --- | --- |
| `GITHUB_ISSUE_REPO` | — | reporter enabled | `owner/repo` slug the backend posts issues to (e.g. `blackmarket-coa/free-black-market`). |
| `GITHUB_APP_ID` | — | preferred | GitHub App ID. Used with `GITHUB_APP_INSTALLATION_ID` and `GITHUB_APP_PRIVATE_KEY` to mint installation tokens. |
| `GITHUB_APP_INSTALLATION_ID` | — | preferred | Installation ID for the App on the target org. |
| `GITHUB_APP_PRIVATE_KEY` | — | preferred | PEM private key (literal or base64-encoded) for the App. |
| `GITHUB_PAT` | — | fallback | Personal access token. Used only when App credentials are absent. |
| `BUG_REPORT_ENABLED` | `true` | optional | Set to `false` to hide UI entry points and make routes return 404. |

When neither App credentials nor a PAT are set, the routes return 503
and the UI hides itself via `GET /store/bug-report/config`.

## Auth providers

Gating lives in `backend/src/lib/build-auth-module.ts`: with none of these
set, Medusa's framework default (emailpass-only) applies. Google serves the
**seller** actor (Creator Commerce Slice C); MAS serves the **customer**
actor against the Blackout-hosted Matrix Authentication Service — the
ecosystem's one IdP (W2; contract:
`docs/contracts/mas-identity-consumer.md`). Seller OIDC is deferred — it
would bypass vendor registration/approval.

| Variable | Default | Required when | Description |
| --- | --- | --- | --- |
| `BACKEND_URL` | — | OAuth callbacks not set explicitly | Public base URL of this API; derives the default OAuth callback URLs. |
| `GOOGLE_CLIENT_ID` | — | Google login on | Google OAuth client id. |
| `GOOGLE_CLIENT_SECRET` | — | Google login on | Google OAuth client secret. |
| `GOOGLE_CALLBACK_URL` | `${BACKEND_URL}/auth/seller/google/callback` | optional | Override for the Google redirect URI. |
| `MAS_OIDC_ISSUER` | — | MAS login on | MAS public issuer URL (blackout deploy `MAS_ISSUER`). Setting it activates the conditional production rules in `scripts/assert-env.mjs`. |
| `MAS_OIDC_CLIENT_ID` | — | MAS login on | Client id registered as `MAS_FBM_CLIENT_ID` in the blackout deploy's MAS client registry. |
| `MAS_OIDC_CLIENT_SECRET` | — | MAS login on (validated min-32 in production) | Client secret for the same registration. |
| `MAS_OIDC_CALLBACK_URL` | `${BACKEND_URL}/auth/customer/mas/callback` | optional | Must EXACTLY match the redirect URI registered with MAS. |
| `MAS_OIDC_SCOPES` | `openid profile` | optional | Space-separated scopes; `profile` carries `preferred_username` (the Matrix localpart). |
| `MATRIX_SERVER_NAME` | — | mxid assembly | Reused from the Matrix block above to build `@localpart:server` in the auth identity's `user_metadata.mxid`. |

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
