# MAS Identity — FBM consumer contract (W2)

Status: **landed dark** (W2, consolidation D4). The BMC ecosystem's one
identity provider is the Blackout-hosted **Matrix Authentication Service
(MAS)**; FBM consumes it through the `mas` Medusa auth provider
(`backend/src/modules/oidc-auth-provider/`). Nothing changes behavior until
the operator sets `MAS_OIDC_*` — until then the auth module keeps its pre-W2
shape (emailpass, plus Google when configured).

The canonical producer-side contract — issuer layout, MSC2965 rules, claim
semantics, the client registry, the bespoke-account migration path — is
`blackout/docs/contracts/mas-identity.md`. This file is the FBM mirror: what
we send, what we consume, and what we deliberately do not do.

Note the direction inversion vs. the W1b billing contract: for **money**, FBM
is the provider and Blackout delegates to us; for **identity**, Blackout (via
MAS) is the provider and FBM is a relying party.

## Client registration

FBM is a **confidential** OIDC client in the MAS client registry
(`blackout/deploy/docker/blackout-backend/mas/config.yaml.template`), threaded
from the blackout deploy env:

| Blackout deploy var | FBM env var | Notes |
| --- | --- | --- |
| `MAS_FBM_CLIENT_ID` | `MAS_OIDC_CLIENT_ID` | 26-char ULID; placeholder `00000000000000000000000FBM` until the operator mints the real one. |
| `MAS_FBM_CLIENT_SECRET` | `MAS_OIDC_CLIENT_SECRET` | `client_secret_post`; min 32 chars in production (`scripts/assert-env.mjs`). |
| `MAS_FBM_REDIRECT_URI` | `MAS_OIDC_CALLBACK_URL` (default `${BACKEND_URL}/auth/customer/mas/callback`) | Exact match on both ends — MAS rejects anything else. |
| `MAS_ISSUER` | `MAS_OIDC_ISSUER` | e.g. `https://matrix.theblackout.app/` (trailing slash). |

Medusa's core auth router serves the flow automatically once the provider is
registered: `POST /auth/customer/mas` → 302 to MAS (PKCE S256 + nonce) →
`GET|POST /auth/customer/mas/callback` → JWT.

## Claims consumed

| Claim | Use here |
| --- | --- |
| `sub` | `auth_identity` provider `entity_id`. MAS account ULID — stable, opaque, **never a Matrix localpart**; never displayed as identity. |
| `preferred_username` | The Matrix **localpart**. Stored in `user_metadata.matrix_localpart` / `preferred_username`. |
| (assembled) mxid | `@<localpart>:<MATRIX_SERVER_NAME>` — built with OUR configured server name, never parsed out of `sub` or trusted from a claim wholesale. Stored in `user_metadata.mxid`. |
| `email`, `name` | Stored in `user_metadata` when present. **Never required** — Blackout accounts are email-optional (no-PII account numbers). |
| `nonce` | Verified against the transaction parked at `authenticate()` time. The id_token is jose-verified against the issuer's JWKS (signature/iss/aud/exp) — decode-only is not acceptable for an IdP we federate identity from. |

## The mxid / mxid_source convention

`customer.metadata.mxid` is what the entitlement + hawala systems key on
(W1b: `customer_external_id` is mxid-only). W2 adds `mxid_source`:

- `"oidc"` — reported by MAS via the `mas` auth identity. Authoritative: the
  IdP owns the Matrix account, so `subscribers/customer-created-matrix.ts`
  **skips admin `ensureUser`** (provisioning over an IdP-owned account would
  fork the identity; under MSC3861 the admin upsert path isn't available
  anyway), still invites the mxid to the community room, and persists it.
- `"derived"` — the pre-W2 email-local-part provisioning, unchanged, still
  the path for emailpass/Google customers.

Precedence + persistence rules are pure functions in
`backend/src/lib/oidc-mxid.ts` (`pickMxid` / `shouldWriteMxid`): `derived`
stays write-once; `oidc` may replace anything, including a previous `oidc`
value. Readers of `metadata.mxid` need no change.

## Actor scope: customer only

The `mas` provider is registered for the **customer** actor. Seller OIDC is
**deliberately deferred**: `/auth/seller/mas` would mint seller identities
that bypass vendor registration/approval (`sell-signup`,
`seller-registration` request flow). Sellers keep emailpass/Google. Revisit
only with an explicit design for OIDC-initiated seller onboarding.

## MSC3861 risk — `mintLoginToken` (operator verification item)

`backend/src/shared/matrix-service.ts#mintLoginToken` powers embedded-chat
auto-login via **admin impersonation**
(`POST /_synapse/admin/v1/users/{mxid}/login` →
`/_matrix/client/v1/login/get_token`, requires Synapse
`login_via_existing_session`). Under Mode B (Synapse delegating auth to MAS,
MSC3861) that admin impersonation path is expected to break — Synapse no
longer owns login. This is recorded as an **operator verification item** for
the staging flip: verify embedded chat against a Mode-B homeserver, and if it
breaks, the successor is an OIDC-native handoff (the customer's own MAS
session) rather than a backend-minted token. Until the flip, nothing changes
(Mode A keeps the current behavior).

## Enablement checklist (operator)

1. Register the FBM client in the blackout deploy env (real
   `MAS_FBM_CLIENT_ID`/`SECRET`/`REDIRECT_URI`) and re-render MAS config.
2. Set `MAS_OIDC_ISSUER`, `MAS_OIDC_CLIENT_ID`, `MAS_OIDC_CLIENT_SECRET`
   (+ optional `MAS_OIDC_CALLBACK_URL`, `MAS_OIDC_SCOPES`) and
   `MATRIX_SERVER_NAME` here — `backend/.env.template` documents the block;
   production rules live in `scripts/assert-env.mjs`.
3. Smoke: `POST /auth/customer/mas` redirects to the MAS authorize page;
   completing login lands on the callback with a Medusa JWT; the auth
   identity carries `entity_id = <MAS ULID>` and `user_metadata.mxid`.
4. Verify the customer-created subscriber logged `Using OIDC-provided mxid`
   and `customer.metadata.mxid_source = "oidc"`.
