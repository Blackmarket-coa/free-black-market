# Environment Configuration Reference

Centralized reference for all FreeBlackMarket environment variables. App
templates live in:

- `backend/.env.template`
- `storefront/.env.template`
- `vendor-panel/.env.template`
- `admin-panel/.env.template`

Production validation is split across several places, and they do not share
one rule set (checked 2026-11-15, SD-78):

- **Boot guards** refuse to start in production (`NODE_ENV=production`).
  Only the backend has one that runs:
  - `backend/medusa-config.ts`: `JWT_SECRET`, `COOKIE_SECRET`,
    `MEDUSA_ADMIN_PASSWORD`.
  - `backend/src/shared/config.ts` `loadConfig()`, evaluated when Medusa
    loads `src/api/middlewares.ts` at start: `JWT_SECRET`, `COOKIE_SECRET`,
    `FREEBLACKMARKET_WEBHOOK_SECRET`, `FREEBLACKMARKET_API_KEY`,
    `CREATOR_ATTRIBUTION_IP_SALT`, and the Blackstar bridge rules below.
  - The backend's `NODE_ENV` comes from `docker-compose.yml`'s
    `${NODE_ENV:-development}`, interpolated from the shell, so a stack
    brought up without `.env.production` sourced runs in development with
    these guards off (`scripts/deploy-fedora.sh` sources it).
- **The storefront guard does not run.**
  `storefront/src/lib/config/assertEnv.ts` exists and is meant to be called
  from `storefront/instrumentation.ts`, but Next 15 looks for
  `instrumentation.*` only beside the app directory, which for the
  storefront is `storefront/src/` (the app is `src/app`). The root-level
  file is never built: a `next build` with the storefront's Next 15.5.28 and
  this layout emits no `.next/server/instrumentation.js`, and does once the
  file is in `src/`. So `REVALIDATE_SECRET`, `NEXT_PUBLIC_STRIPE_KEY` and
  `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` are not checked at start, and the
  server-side Sentry init in the same file does not run either (open in
  `docs/AUDIT_DEBT.md`).
- **`scripts/assert-env.mjs`** is a pre-deploy check, not a boot guard.
  Nothing runs it at startup or in CI, and it is not in the backend image
  (built with context `backend/`, so `/app/scripts` is `backend/scripts`).
  Its conditional rules (Blackout, Matrix, MAS, extension signing) are
  enforced only when someone runs it. Against an env file, from a repo
  checkout:

  ```bash
  env -i PATH="$PATH" node --env-file=.env.production scripts/assert-env.mjs --app=backend
  ```

  `env -i` matters: Node lets a variable already in the shell win over the
  file, so without it a shell's own `NODE_ENV` or `JWT_SECRET` is what gets
  checked. The file must set `NODE_ENV=production` itself (the example
  does): the script exits 2 with "nothing was checked" when `NODE_ENV` is
  anything else, and 1 when a value fails. Against a running stack, copy it
  into the backend container and run it there: step 7 of
  `docs/runbooks/FBM_MIGRATION_TO_PRIMARY_SERVER.md`.

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
| `FBM_BLACKSTAR_INTEGRATION` | `0` | always | `1` registers the `blackstar` fulfillment provider and enables the inbound events route (`/v1/integrations/blackstar/events`). `0` keeps the provider unregistered. It does **not** switch the outbound channel: that is live whenever `BLACKSTAR_API_BASE` and `BLACKSTAR_WEBHOOK_SECRET` are both set. The boot guard (`src/shared/config.ts`) and `scripts/assert-env.mjs` check the `BLACKSTAR_*` values below as each row says (the old `FBM_BLACKSTAR_API_KEY` is read by nothing and no longer required). |
| `BLACKSTAR_API_BASE` | — | in production, when `FBM_BLACKSTAR_INTEGRATION=1` or `BLACKSTAR_WEBHOOK_SECRET` is set | Blackstar's API base URL; the destination of FBM's outbound lifecycle events, including `node.operator.approved`, which carries a newly minted per-node secret. Must parse as an `https://` URL with a host, with no whitespace, query or fragment (the delivery path is appended to it). |
| `BLACKSTAR_WEBHOOK_SECRET` | — | in production, when `FBM_BLACKSTAR_INTEGRATION=1` or `BLACKSTAR_API_BASE` is set | Signs FBM's outbound events (the value Blackstar reads as `FBM_WEBHOOK_SECRET`). Min 32 chars. Without it or `BLACKSTAR_API_BASE`, nothing is sent; with one and not the other, production refuses to boot. |
| `BLACKSTAR_OUTBOUND_SECRET` | — | `FBM_BLACKSTAR_INTEGRATION=1` in production, unless `BLACKSTAR_REQUIRE_KEY_ID=1` | Verifies Blackstar's inbound events on `/v1/integrations/blackstar/events` (the value Blackstar signs with as `FBM_OUTBOUND_SECRET`). Min 32 chars. With `BLACKSTAR_REQUIRE_KEY_ID=1`, per-partner credentials replace it. |
| `FBM_DEFAULT_REFERRAL_PERCENT` | — | optional | Default referral commission (0-100) used when active `PayoutConfig` does not set one. |
| `FBM_DEFAULT_PLUGIN_DEVELOPER_PERCENT` | — | optional | Default plugin / theme / emoji-pack developer share (0-100). |
| `FBM_ENTITLEMENT_DEFAULT_DURATION_DAYS` | (perpetual) | optional | Default lifetime for entitlements granted without an explicit duration. |
| `FBM_ONBOARDING_FOLLOWUP_DELAY_MS` | `172800000` (48h) | optional | Delay used by the Sprint A → C 48h follow-up subscriber. |
| `PUBLIC_STOREFRONT_URL` | — | optional | Used by the launch wizard's share screen for storefront URL building. Never hardcoded in code. |
| `MARKETPLACE_SIGNING_PRIVATE_KEY_PEM` | — | extension signing on (paired with KEY_ID, validated both ways) | Ed25519 private key PEM (`openssl genpkey -algorithm ed25519`) that signs published extension bundles (W3, `docs/contracts/extension-manifest.md`). Unset ⇒ publish 500s `signing_failed` (draft-reverting) and both key endpoints 503. |
| `MARKETPLACE_SIGNING_KEY_ID` | — | extension signing on | Stable key identifier (e.g. `fbm-2026-q3`) surfaced in envelopes, `/v1/marketplace/signing-keys`, and `/.well-known/freeblackmarket-publishing-keys.json`. |
| `FBM_PLATFORM_VERSION` | `1.0.0` | optional | Host platform version the plugin install compat gate checks `min/max_host_version` bounds against (`plugin-registry/compat.ts`). |

## Posture A guard

The service-layer guard in `backend/src/modules/hawala-ledger/posture-a-guard.ts`
refuses any Coalition Credits (CCR) transfer without a goods-or-services
purchase context (`docs/POSTURE_A_COMPLIANCE.md`). It is a legal boundary, not
a preference.

| Variable | Default | Required when | Description |
| --- | --- | --- | --- |
| `HAWALA_CCR_GUARD_MODE` | `strict` | never | `strict` refuses a violating transfer. `warn` (log only) and `off` exist for local development and tests and are **ignored when `NODE_ENV=production`**: the guard is always strict there, and a refused override is logged once at error level (LEG-7). Any unrecognised value is `strict`. |

## Vendor hype prediction policy

`backend/src/modules/vendor-hype-operations-prediction/policy-service.ts`
admits a prediction market only in a mode its jurisdiction's profile allows
(`docs/VENDOR_HYPE_OPERATIONS_PREDICTION_COMPLIANCE_POLICY_MATRIX.md` §1, an
allow list). The US and every subdivision are `US-RESTRICTED` (non-cash only);
any unmapped jurisdiction is `ROW-NONCASH`. The policy in force is checked when
a market is created, again when an operator publishes it (`scheduled`) or opens
it (`open`), and again when a position is placed, so a market admitted under
older rules cannot go live; voiding is never refused. Every refusal answers
**403** `{ "type": "policy_denied", "code": "PREDICTION_MODE_NOT_PERMITTED",
"message": <reason>, "policy_version": <version> }`.

Each decision records a `policy_version` derived from the rules, not
configured: `matrix-<matrix version>@<effective date>+map:<hash>`, where the
hash is the first 12 hex characters of the SHA-256 of the effective
jurisdiction-to-profile mapping in canonical form (`canonicalPolicyRules`).
With no mapping set it is `matrix-1.0.0@2026-01-01+map:c78f8f076443`; any
change to `VENDOR_HYPE_JURISDICTION_PROFILES` changes it. The backend logs the
version and the full effective mapping at `info` ("Prediction policy in
force") when the module starts, and each market stores its decision (profile,
the code it matched, the allowed modes, the version) in
`metadata.policy_decision`, so a decision can be replayed without the
deployment's env. Market creators cannot set either.

| Variable | Default | Required when | Description |
| --- | --- | --- | --- |
| `VENDOR_HYPE_JURISDICTION_PROFILES` | — | counsel has approved a jurisdiction for a wider profile | JSON object of jurisdiction code to profile code, e.g. `{"US-NV":"US-REGULATED-CASH"}`. Codes are upper-cased; a subdivision inherits its country unless mapped itself. Fails closed: unparseable JSON is ignored whole, and an entry naming an unknown profile (or remapping a profile code) is dropped, each logged at error level. A valid entry under the wrong key still widens that key (`US` for `US-NV` widens every state): check the effective mapping in the startup log. Changing it changes the recorded `policy_version`. |
| `VENDOR_HYPE_POLICY_VERSION` | — | optional | A label **appended** to the derived version as `+label:<value>` (for example a counsel ticket), 1-64 characters of `A-Z a-z 0-9 . _ -`; anything else is ignored and logged at error level. It can no longer replace the version: it used to, so any string could relabel the rules without changing them. |

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

## Supplier status webhook

`POST /webhooks/suppliers/status` lets a supplier report the
manual-fulfillment status of an order FBM forwarded to it
(`backend/src/api/webhooks/suppliers/status/route.ts`, keys in
`backend/src/modules/supplier-forwarding/webhook-auth.ts`).

| Variable | Default | Required when | Description |
| --- | --- | --- | --- |
| `SUPPLIER_WEBHOOK_SECRET` | — | supplier status webhook on | Operator secret, at least 32 characters (`openssl rand -hex 32`). Never given to a supplier. Unset or shorter ⇒ the webhook answers `503` and reads nothing. |

Each supplier gets its **own** key, derived from the secret and its
`supplier_id` (the value on its supplier profile):

```bash
printf '%s' "$SUPPLIER_ID" | openssl dgst -sha256 -hmac "$SUPPLIER_WEBHOOK_SECRET" | awk '{print $NF}'
```

The supplier sends `x-fbm-signature: hex(HMAC-SHA256(<its key>, <exact request body>))`
with a JSON body `{ order_id, supplier_id, status, notes?, metadata? }`. A
supplier can only sign for its own `supplier_id`, and only for orders
forwarded to it (`403` otherwise); `status` must be a legal next step in the
manual-fulfillment state machine (`409` otherwise; repeating the current
status is a `200` re-delivery that writes nothing). To cut one supplier off,
set `is_active: false` on its profile. Rotating `SUPPLIER_WEBHOOK_SECRET`
re-keys every supplier at once.

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
   `CONDITIONAL_RULES` for opt-in integrations). That alone does not stop a
   boot: if a bad value must refuse to start, add it to the production block
   of `backend/src/shared/config.ts` too (or `medusa-config.ts` for values
   the framework itself reads).
3. Document it here under the relevant section.
4. Reference it in `docs/contracts/marketplace-layer.md` if it gates an
   API surface.
