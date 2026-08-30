# Shared Extension Manifest — registry + publish contract (W3)

Status: **landed dark** (W3, consolidation D6: the extension registry lives inside
FBM's catalog — no standalone registry service; Forge publishes into it). This is
the cross-repo contract between the three parties:

- **Forge** (authoring tool) — builds an extension project, computes digests,
  publishes through the seller API. Holds no signing keys.
- **FBM** (this repo) — validates the manifest, signs at publish
  (`marketplace-signing`, Ed25519, platform key), upserts the
  `plugin-registry` catalog + version history, serves discovery/installation
  under entitlements.
- **Blackout** (host) — installs entitled bundles and verifies signatures
  client-side against FBM's published keys; renders `manifest_plugin` surfaces
  (home card / pinned nav / right panel / mobile tab) today.

**Type source of truth** for the manifest shape is the Blackout plugin protocol
(`blackout/packages/blackout-protocol/src/plugins/index.ts` — `PluginManifest`,
`PLUGINS_PROTOCOL_VERSION = 2`). FBM's validator is
`backend/src/modules/plugin-registry/manifest.ts` (literals transcribed,
manually kept in sync). Forge mirrors both in Rust.

## The marker

A `creator_listing` is an **extension listing** iff it has a non-empty
`plugin_slug` OR its `manifest.artifactKind` is present
(`isExtensionListing()`). Every W3 behavior keys off this marker; free-form
manifests without it are untouched (dark/additive guarantee).

## Field ownership

| Field | Authored by Forge | Injected by FBM at publish |
| --- | --- | --- |
| `id` (reverse-DNS), `name`, `version`, `artifactKind`, `capabilities[]`, `entry?`, `description?`, `homepageCard?`, `pinnedNav?`, `rightPanel?`, `mobileTab?`, `pluginDens?` | ✓ | — |
| `protocolVersion` | optional | defaulted to `2` |
| `sha256` | for `manifest_plugin`: hash of the declarative payload; for `code_plugin`: may omit (listing's `code_blob_sha256` binds it) | bound into the distribution manifest |
| `listing {providerId, providerListingId, publicSlug}` | omit | ✓ (`providerId: "freeblackmarket"`, `providerListingId` = creator_listing id, `publicSlug` = plugin slug) |
| `fbm {minHostVersion?, maxHostVersion?, category?, …}` | ✓ (host-compat bounds ride HERE — the Blackout manifest has no host-version fields; unknown keys like `dataSource` pass through) | mapped onto `plugin_listing.min/max_host_version` + category |

Rules enforced at publish (`validateExtensionManifest({forPublish: true})`):
`manifest.version === creator_listing.version`; `sha256` required for
`code_plugin`; the plugin slug (`creator_listing.plugin_slug`, defaulting to
the listing `slug`) must match `/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/`.

Category mapping: `fbm.category` override wins; else `automation_recipe` →
`AUTOMATION`; else `MARKETPLACE_EXTENSION`.

## Publish sequence (what Forge calls)

```
1. POST  /v1/seller/listings              (seller bearer)
     { slug, title, version, manifest, plugin_slug?,
       code_blob_url? + code_blob_sha256?  (omit for manifest_plugin),
       assets?, description? }
     → 400 invalid_extension_manifest on authoring-rule failures
2. PATCH /v1/seller/listings/:id          (iterate drafts; same validation)
3. POST  /v1/seller/listings/:id/publish
     → validates (forPublish) BEFORE any status change (failures leave DRAFT)
     → ownership guard: existing catalog slug owned by another author → 409 plugin_slug_taken
     → repeat version with different bytes → 409 version_already_published
     → signs (FBM envelope, unchanged) + mints the DISTRIBUTION envelope
     → upserts plugin_listing (latest) + inserts plugin_version (history)
     → responds { listing, envelope, plugin: { slug, version } }
```

`code_blob_url`/`code_blob_sha256` are required at publish for every listing
EXCEPT extension listings with `artifactKind === "manifest_plugin"` (no code
exists; the signature covers the manifest; the bundle hash falls back to
`manifest.sha256`).

Retry semantics: versions are immutable — republishing the same
`(slug, version)` with the same `code_sha256` is an idempotent no-op; with
different bytes it is refused. A publish interrupted between registry write and
`markPublished` converges on retry.

## The two signature envelopes

Both are signed by the **same platform Ed25519 key** (`marketplace-signing`);
they cover different payloads, so neither can be derived from the other —
both are minted at publish time.

| | FBM envelope (existing, frozen) | Distribution envelope (Blackout format) |
| --- | --- | --- |
| Payload | `1\|manifestHash\|codeHash\|assetHashesHash\|signedAt` | `${manifestSha256}:${sha256}` |
| Fields | `{keyId, alg, manifestHash, codeHash, assetHashes, signedAt, signature}` | `{keyId, signature, manifestSha256, sha256, issuedAt}` |
| Where it lives | `creator_listing.signature_envelope`, seller webhooks, `/v1/marketplace/listings` | `plugin_version.signature_envelope`, `GET /store/plugins/:slug` (`latest_version`), fulfillment |
| Verifier | `marketplace-signing/verify.ts#verifyPluginBundleEnvelope` | Blackout client `pluginSignature.ts` + `verify.ts#verifyBlackoutEnvelope` |

Hashing is SHA-256 over canonical JSON (recursively key-sorted) in both.

## Key discovery

- `GET /v1/marketplace/signing-keys` — existing, PEM (`publicKeyPem`).
- `GET /.well-known/freeblackmarket-publishing-keys.json` — the rotation
  endpoint the Blackout client pins against. Served from a literal-path
  middleware alias plus the real route at
  `/well-known/freeblackmarket-publishing-keys.json` (a dotted route
  *directory* compiles in dev but is dropped by `tsc`'s `**/*` glob at
  `medusa build` — hence the alias). Document shape:
  `{ keys: [{ keyId, alg: "ed25519", publicKey: <base64 SPKI DER>, publicKeyPem }] }`
  — Blackout imports raw SPKI via WebCrypto, so `publicKey` is the field it
  needs; the array is rotation-ready (retired keys append).

Env (opt-in pair, both-or-neither enforced in production by
`scripts/assert-env.mjs`): `MARKETPLACE_SIGNING_PRIVATE_KEY_PEM`,
`MARKETPLACE_SIGNING_KEY_ID`. Unset → publish 500s `signing_failed`
(draft-reverting) and both key endpoints 503 `signing_unavailable`.

## Discovery + install (consumer side)

"Public" below means no user auth — but Medusa requires the storefront
**publishable key** (`x-publishable-api-key`, public by design) on every
`/store/*` request, so external consumers (Blackout's provider via
`FREEBLACKMARKET_PUBLISHABLE_KEY`, Forge via `~/.forge/fbm.json
publishable_key`) must send it. The `/.well-known` key document is outside
`/store` and needs nothing.

- `GET /store/plugins` — public list (unchanged).
- `GET /store/plugins/:slug` — detail: catalog fields + `installable`
  (compat gate vs `FBM_PLATFORM_VERSION`) + `latest_version {version,
  published_at, code_sha256, signed_bundle_url, signature_envelope,
  manifest_url}`; `?include=versions` adds non-yanked history.
- `GET /store/plugins/:slug/manifest` (`?version=`) — the canonical
  distribution manifest JSON; this is what `manifest_url` points at.
- `POST /store/plugins/:slug/install` — customer entitlement grant
  (`plugin:<slug>`, kind `plugin`); `DELETE` uninstalls (revokes).
- Seller installs (`POST/DELETE /v1/seller/plugins/:slug/install`) write
  `seller_metadata.enabled_extensions` (authoritative) + a best-effort
  seller-scoped `plugin:<slug>` entitlement.
- `POST /v1/seller/plugins/:slug/deprecate` — author-only; emits
  `plugin.deprecated`; deprecated plugins fail the install gate. There is no
  un-deprecate API (operator path only).
- Blackout's server (`packages/api` marketplace provider) assembles
  `SignedPluginBundle { manifest, bundleBase64?, signature }` from the detail +
  manifest routes for its client installer.

## Version semantics

`plugin_listing.version` is the denormalized **latest**; `plugin_version` rows
are the immutable history (unique `(slug, version)`), with `yanked_at` hiding a
version from resolution without deleting the record. Precedence is full SemVer
§11 (prerelease-aware). The install gate keeps its deliberate **fail-open**
bounds semantics: an absent or unparseable bound is "no bound".

## Demo runbook (the Featured Vendor Widget path)

The first-party seed (`featured-vendor-widget`, `manifest_plugin`, home card →
featured vendors, data source `GET /store/vendors?featured=true` backed by the
`vendor.promoted_listing` entitlement) exercises the consumer half without any
publish. The full loop, against a dev backend with signing keys set:

```sh
# 0. Operator: MARKETPLACE_SIGNING_PRIVATE_KEY_PEM + MARKETPLACE_SIGNING_KEY_ID set;
#    seller bearer TOKEN in hand.
# 1. Draft
curl -sX POST $BASE/v1/seller/listings -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d @widget-listing.json     # slug/title/version/manifest/plugin_slug
# 2. Publish (signs + bridges into the registry)
curl -sX POST $BASE/v1/seller/listings/$LISTING_ID/publish -H "authorization: Bearer $TOKEN"
# 3. Discover + verify
curl -s $BASE/store/plugins/featured-vendor-widget | jq .latest_version
curl -s $BASE/store/plugins/featured-vendor-widget/manifest | jq .
curl -s $BASE/.well-known/freeblackmarket-publishing-keys.json | jq .
# 4. Install under entitlements (customer JWT)
curl -sX POST $BASE/store/plugins/featured-vendor-widget/install -H "authorization: Bearer $CUSTOMER"
curl -s $BASE/store/plugins/featured-vendor-widget/entitlement -H "authorization: Bearer $CUSTOMER"
# 5. Uninstall
curl -sX DELETE $BASE/store/plugins/featured-vendor-widget/install -H "authorization: Bearer $CUSTOMER"
```

This script doubles as Forge's integration checklist (`publish_extension`
performs steps 1–2; `browse_plugins` reads step 3's list route).

## Known deferrals (see `docs/AUDIT_DEBT.md` §W3)

Commerce-API publish path bypasses signing + the bridge (reject-or-port);
single-key rotation; `creator_listing.compatible_with` stays dead (superseded
by `fbm.*`); seller entitlement grant is best-effort; integration-http spec;
Blackout featured-vendors view + pinned-key flip to the well-known keyset;
`code_plugin` runtime (sandbox RPCs) is a pre-existing Blackout audit item
(M19), not W3.
