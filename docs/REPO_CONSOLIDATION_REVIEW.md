# Repo Consolidation Review — BMC Ecosystem

> The canonical record of the 2026-08-28 seven-repo consolidation review:
> what actually exists in each repository, which planning documents are
> superseded, the consolidation decisions taken, and the ordered roadmap
> that follows from them.
>
> **Status**: Decided — operator-approved 2026-08-28 (scope, identity,
> ledger, and Blackstar dispositions were each confirmed explicitly).
> All code claims below were verified against the seven repos on
> 2026-08-28 on branch `claude/repo-consolidation-review-e1t8if`.
>
> Sibling repos carry a short `CONSOLIDATION.md` stub pointing here.

## 1. What was audited

All seven repositories in the `Blackmarket-coa` org that were in scope:

| Repo | What it actually is |
| --- | --- |
| `free-black-market` (FBM) | Medusa v2.14.2 + MercurJS marketplace. 88 custom backend modules, 613 route files, ~1,100 backend unit tests, hardened money core (`hawala-ledger`). The substrate. |
| `blackout` | Production Matrix platform (~670 users): Cinny-fork client, Synapse-fork homeserver, Hono API (158 migrations), Tauri/Capacitor wrappers. Coliseum, Coalition, Creator Hub live in it. |
| `blackmask` | Bitwarden `clients` fork; ~30 real feature commits; 8 privacy features implemented behind default-on flags; browser + self-hosted web are the built surfaces. |
| `Blackstar` | Fleetbase v0.7.15 fork. 3,066 lines of bespoke Laravel (board/claim/bid, legs, node attestation/trust, FBM HMAC bridge) around 13 empty submodules. Cannot build the Fleetbase product as checked out. |
| `Forge` | Tauri v2 desktop app rebuilt from a stripped Tilt fork (~7,500 LOC): project manager + "website → app" scaffolding + Keygen licensing. No extension/SDK/registry code exists. |
| `The-Connect` | Unmodified upstream mirror of Universal Commerce Protocol (UCP). Zero Blackmarket commits. |
| `BMC-alchemizer` | Unmodified upstream mirror of Blnk Finance. Zero Blackmarket commits. No EconomicUnit/EconomicPolicy code. |

Two findings frame everything else:

1. **Only five of seven repos contain Blackmarket work.** The-Connect and
   BMC-alchemizer are commit-identical to their upstreams. Plans that
   treated them as in-progress internal projects were mis-scoped.
2. **The consolidation was already half-declared in-repo.**
   `docs/AGGRESSIVE_OPERATIONS_GUIDE.md` §0 (FBM + Blackout copies)
   retired the four-platform model in favor of two layers — FBM as
   economic substrate, Blackout as communication/governance interface —
   and `docs/FEDERATION_VS_FOUNDATION_DECISION.md` (2026-08-12) already
   corrected the record on Blackstar, connect.js, and TigerBeetle. This
   review reconciles those documents with the older master architecture
   map and with the code, and records the operator's decisions.

## 2. Supersession chain

| Artifact | Standing after this review |
| --- | --- |
| Master architecture map ("BMC Ecosystem — Master Architecture Map", uncommitted planning doc) | Superseded where it conflicts with code: §6.5 (embed Blnk as the ledger) is replaced by D1 below; "Blackmask SSO" is replaced by D4; the "TigerBeetle chosen" and "connect.js not yet built" claims were already stale. Its §8 legal gates remain fully in force (see §8 below). |
| `docs/AGGRESSIVE_OPERATIONS_GUIDE.md` | Confirmed. The two-layer model (FBM substrate / Blackout interface), the Blackstar absorption, and the spatial-layer assignment to Blackout are all ratified by this review. |
| `docs/FEDERATION_VS_FOUNDATION_DECISION.md` | Confirmed ("ship the interface, gate the operation"), and its repo-state corrections are adopted here. |
| `ROADMAP.md` (repo root) | Stale and disconnected (it never mentions federation, connect.js, Blackstar, or the ledger). The roadmap in §6 below is the current ordering; fold it into `ROADMAP.md` at the next roadmap revision. |
| This document | Canonical for consolidation decisions and sequencing. |

## 3. Repo-by-repo verdicts

### free-black-market — the substrate; role confirmed

- The money core is real and hardened: `backend/src/modules/hawala-ledger`
  (10.6k LOC, 21 specs, concurrency soak in CI) — genuine double-entry,
  six rails (CCR, USDC, USD, KARMA, HRS, GIFT) with compile-enforced
  per-rail invariants, an escrow state machine, and Stellar settlement
  integrated but shipping disabled behind a fail-fast guard.
- The §4 "Extension Registry vs. FBM catalog" question is effectively
  answered in code: `plugin-registry`, `marketplace-signing` (Ed25519
  signed bundles), `digital-product` delivery, and entitlements all
  exist. ~~The remaining gap is a hook registry + semver handling~~
  *(both had already shipped; W3 closed what was actually missing — the
  shared manifest, the publish bridge + `plugin_version` history, and
  signature verification — `docs/contracts/extension-manifest.md`)*.
- `connect.js` exists (`storefront/public/connect.js`, ~1,200 lines,
  publishable keys hashed at rest). ~~It is unshipped only as a versioned
  artifact.~~ *(Stale at the time of writing — v2.0.0 had already shipped
  as a frozen, SRI-pinned release on 2026-08-13 via PRs #801–#803, two
  weeks before this review: `public/v2.0.0/connect.js` + `CONNECT_VERSION`
  / `CONNECT_SRI` in `shared/website-config.ts`, immutable cache headers,
  a changelog with a release procedure, and the CI parity spec
  `connect-sri.unit.spec.ts`. W6 closed what actually remained: the
  first-party site template now embeds the pinned URL + integrity hash,
  the parity spec holds the template in lockstep with future bumps, and
  the embed-key middleware gates got direct unit specs.)*
- Known internal redundancies to work down: commission/payout logic
  spread across five owners; three quest/XP systems; ~~two reviews
  implementations~~ *(consolidated in W4 — one model, subject-typed)*;
  four near-identical vertical portals; the two
  vendored panel forks (~48% of repo source). *(Found and fixed in W5:
  six duplicated haversine functions and two divergent ZIP3 tables —
  geo redundancy this list originally missed; now `lib/geo-distance` +
  `lib/zip3`.)*
- Federation remains vocabulary, not code: no partner-node model, no
  network-operator actor. That is consistent with the gate-the-operation
  posture, not a defect to fix now.

### blackout — interface layer; two hazards to unwind

- Coliseum is the most complete custom module (fully vertical);
  Coalition is substantial; Creator Hub is API-thick and
  config-gated dark; Town Square is a single page, not a subsystem.
- Hazard 1 — a second money layer: Coalition Credits and tips already
  delegate movement to FBM (good), but `channel_points_ledger` is a
  self-owned ledger and creator/canopy subscriptions bill through a
  direct Stripe integration. Resolved by W1 below.
- Hazard 2 — three auth stacks (bespoke JWT accounts, inherited
  Synapse OIDC/MAS surface, delegated-login page) against the AOG's
  "MXID is canonical" commitment. Resolved by D4/W2 below.
- Geospatial genuinely lives here (maplibre-gl client, PostGIS + martin
  in infra, privacy-conscious geocoder proxy) — confirmed as the
  ecosystem's spatial home (D5).
- BO-1 (megolm/key-backup decryption failures) stays the top operations
  priority and is explicitly outside consolidation scope.

### blackmask — real features, re-scoped role

- All 8 privacy features have real code (~4,500 LOC + specs) but none
  are browser-validated yet; browser extension + self-hosted web vault
  are the shipping surfaces (no desktop/CLI build workflows exist).
- There is no identity-provider capability anywhere in the repo —
  Blackmask is an SSO *client*. Under D4 its role is persona/credential
  manager and trust-signal source, not ecosystem IdP.
- The 1.2 GB `third_party/` vendored reference tree (34 OSS snapshots,
  excluded from build/lint/store archives) is removed on this branch;
  the inventory README with pinned upstream commits is kept.

### Blackstar — ~~frozen and absorbed~~ UNFROZEN 2026-09-03 (operator decision)

> **Unfrozen by operator decision, 2026-09-03.** D2's freeze is lifted and
> the "archive the repo after merge / revive standalone node software only
> when a real external logistics node exists" condition below is waived. The
> absorption stands — FBM's fulfillment modules remain the live
> implementation and nothing about them is reverted — but Blackstar is again
> an active line of work rather than a parked one. The original text is kept
> below as the record of what was decided in August.
>
> First increment landed FBM-side immediately: the inbound bridge's
> out-of-order and replay defects are closed (contract §7–§9), which is what
> the integration needed before it could safely be turned on anywhere. The
> integration itself stays dark by default (`FBM_BLACKSTAR_INTEGRATION=0`) —
> unfreezing the decision is not the same act as enabling it in production,
> which still requires paired secrets per contract §4.
>
> Two things this session could not do, both org-admin actions outside the
> `free-black-market` repo: un-archiving or re-activating the `Blackstar`
> repo itself, and any change to its Laravel side (sequence numbers per
> contract §9.3 need both halves).


- FBM already carries the absorption (`blackstar-fulfillment`,
  `blackstar-fulfillment-provider`, per-partner HMAC bridge). The
  salvageable designs — shipment board/leg/attestation data model, HMAC
  credential rotation, the `NonCustodialPaymentGuard` posture — are
  recorded in W1/W3 notes and the Blackstar stub.
- On this branch the 525-file duplicate console app is folded back into
  `console/` (its 6 genuinely unique files are ported). Archive the
  repo after merge; revive standalone node software only when a real
  external logistics node exists.

### Forge — honest re-scope

- Keep it as the authoring tool. The near-term work that makes it part
  of the ecosystem is a manifest schema aligned with FBM's
  `plugin-registry` compatibility model, publishing into FBM's catalog
  (W3), not a parallel registry. The `plugin_browser` paywall entry for
  a feature that does not exist should be removed or implemented against
  FBM `/store/plugins`. Stack modernization (React 18/Vite/TS5) is
  queued behind that.

### The-Connect — upstream mirror, kept as a reference

- "BMC Connect" today is FBM's `/v1` marketplace layer + `connect.js` +
  `marketplace-webhooks` + `marketplace-signing` (protocol by
  extraction). The UCP mirror stays as an adoption reference: UCP's
  `/.well-known/ucp` discovery profile with JWK signing is the likely
  future federation front door, and its checkout/catalog objects map
  well onto FBM's `/v1` surface. Revisit when a second real marketplace
  wants in. No protocol build before that.

### BMC-alchemizer — parked; harvested, not adopted

- hawala-ledger is the canonical ledger (operator decision). The Blnk
  mirror is retained temporarily as reference material for the harvest
  work in §5, then archived. Standing up Blnk as the ledger would
  rewrite the most-tested money code in the org for no user value.

## 4. Decisions

| # | Decision |
| --- | --- |
| D1 | **Ledger**: `hawala-ledger` is the org-canonical ledger. BMC-alchemizer is parked (archive after §5 harvest). Blackout's second money layer is absorbed per W1. TigerBeetle stays rejected (PR #800). |
| D2 | **Logistics**: AOG absorption executed. ~~Blackstar frozen~~; FBM fulfillment modules are the live implementation. *(Freeze lifted by operator decision 2026-09-03 — see the Blackstar section in §3. The absorption and FBM's role as the live implementation are unchanged; what is reversed is the parking of further Blackstar work and the plan to archive the repo.)* |
| D3 | **Federation**: protocol by extraction. BMC Connect = FBM `/v1` + connect.js + webhooks + signing today; UCP mirror kept as the future front-door reference; no protocol build until a second marketplace exists. |
| D4 | **Identity**: Matrix OIDC/MAS becomes the ecosystem IdP (the surface already exists in the Synapse fork). FBM integrates via one Medusa OIDC auth provider. Blackout's bespoke JWT account system retires behind it. Blackmask is re-scoped to persona/credential manager + trust signals. |
| D5 | **Geospatial**: Blackout is the single spatial home (maplibre + PostGIS + martin + geocoder proxy). FBM's haversine/ZIP3 code is retired when it can consume Blackout's spatial API. No new geospatial service repo. |
| D6 | **Extension registry**: inside FBM's catalog. ~~Close the hook-registry + semver gap~~ *(closed — the real W3 work was the shared manifest, publish bridge, `plugin_version` history, and verification)*; Forge publishes into it via `POST /v1/seller/listings` → `/publish`. No standalone registry service. |
| D7 | **Reputation**: one write path — `karma_event` (append-only, signed, source-attributed, transfer-prohibited) becomes the canonical reputation event log; vendor trust, Coliseum standing, node trust, and publisher tiers become derived per-context projections. FBM's duplicate reviews implementations get deduped as part of this. *(W4 clarification, landed 2026-08-30: FBM's `karma_event` is the canonical economic-reputation log — the write path, source registry, attestation, and first producers shipped; blackout's `reputation_events` is the governance-context log, hardened to the same adjectives rather than renamed — the "karma has no implementation" assertion in its data export is deliberate and stays true. Vendor trust flows FBM→blackout only; node trust rides the Blackstar freeze; publisher tiers stay future.)* |
| D8 | **Hygiene**: executed on this branch where safe (blackmask `third_party/`, Blackstar duplicate console, FBM restaurant-marketplace version skew); queued where riskier (Blackout's three client shells, FBM's four portals and vendored panel forks). |

## 5. Blnk harvest list (D1's "improve hawala-ledger" workstream)

Operator directive: take what is useful from Blnk (and the other parked
systems) into `hawala-ledger` rather than adopting any of them. Verified
gaps, in value order:

1. **External reconciliation engine.** hawala-ledger's `reconciler.ts`
   self-checks internal balances; it cannot ingest external records
   (Stripe payouts, bank/ACH statements, Stellar ledger extracts) and
   match them by rule. Blnk's upload → matching-rules → batch/instant
   reconciliation flow is the model. This is the precondition for
   turning on Stellar/USDC settlement and ACH payouts with confidence.
2. **Balance monitors with alerting.** Threshold monitors on settlement
   and escrow accounts. The PRE_LAUNCH_AUDIT's negative-amount payout
   bug class is exactly what these catch structurally.
3. **Transaction/balance lineage.** No lineage queries exist today;
   commission/payout logic spans five modules, so end-to-end tracing of
   a split is currently a manual join exercise.
4. **First-class point-in-time balances.** Formalize `balance_at(ts)`
   and snapshots (partially present in `service.ts`).
5. Optional/later: Blnk-style PII tokenization pattern; formalized
   pre/post-transaction hooks (outbound eventing is already covered by
   `marketplace-webhooks`).

From the others: Blackstar's `NonCustodialPaymentGuard` posture
complements the existing `posture-a-guard.ts` for any future
partner-node flow; Blackout's `channel_points_ledger` derived-balance
pattern is sound — W1 migrates its data onto a rail rather than
rewriting the pattern.

## 6. Roadmap

Ordered workstreams; each is independently shippable.

- **W1 — Money-layer unification** (highest hazard, do first):
  route Blackout creator/canopy subscriptions through FBM checkout +
  entitlements (the seam exists and is path-pinned by tests); decide
  channel points (FBM closed-loop rail vs. declared non-monetary local
  state) and migrate accordingly; land harvest items 1–4 above.
  - *W1a landed (2026-08-29)*: Blnk harvest — external reconciliation,
    balance monitors, lineage, point-in-time balances in `hawala-ledger`.
  - *W1b landed FBM-side (2026-08-29)*: real Blackout checkout (stateful
    idempotent sessions → shadow product → cart/payment → order +
    subscription + tier grants), entitlement/renewal fixes (extend-on-renew,
    revoke-on-cancel/expire, mxid normalization, `SUBSCRIPTION_RENEWAL`
    ledger reference), `subscription.payment_failed` bridge event, Canopy
    plan placeholder listings, `listGrants` read. Operator decision recorded:
    **channel points are declared non-monetary** (engagement state in
    Blackout — never purchasable, never convertible to CCR/USD; zero
    migration). Blackout-side retirement of the direct Stripe rail is the
    companion change (see blackout `docs/contracts/fbm-billing-consumer.md`).
- **W2 — Identity (MAS)**: enable the Synapse OIDC/MAS surface in
  staging; write the single Medusa OIDC auth provider for FBM; define
  the migration path for Blackout's bespoke accounts (account-number ↔
  MXID mapping already exists); keep Blackmask out of the IdP role.
  - *W2 landed (dark, 2026-08-29).* Blackout: MSC2965 well-known + MAS
    client registry in the deploy templates; native
    `/v1/auth/oidc/begin|continue` + `/v1/auth/sign-out` filled behind
    `BLACKOUT_OIDC_*`; canonical contract + migration path in
    `blackout/docs/contracts/mas-identity.md` (syn2mas moves password
    hashes, so account-number login → exchange survives the flip
    byte-identically; Blackmask verified zero-reference). FBM: `mas`
    auth provider (PKCE + nonce, jose-verified id_token, customer actor
    only) behind `MAS_OIDC_*`; OIDC-provided mxid takes precedence over
    email-derived (`mxid_source`); consumer mirror in
    `docs/contracts/mas-identity-consumer.md`. Staging enablement +
    Mode-B flip remain operator-side; deferrals in `docs/AUDIT_DEBT.md`
    §W2.
- **W3 — Registry + Forge MVP**: close the hook-registry + semver gap
  in `plugin-registry`; define the shared extension manifest; ship one
  extension end-to-end (build in Forge → sign → publish → install under
  entitlements) — the "Featured Vendor Widget" path.
  - *W3 FBM side landed (dark, 2026-08-29).* The premise was partly
    stale — the hook registry and host-compat gate had already shipped;
    what actually landed: the shared extension manifest (canonical:
    `docs/contracts/extension-manifest.md`, adopting Blackout's
    `PluginManifest` with an `fbm.*` bounds block), signature
    verification + the Blackout-format distribution envelope + the
    `/.well-known/freeblackmarket-publishing-keys.json` keyset,
    `plugin_version` immutable history + prerelease-aware semver, the
    seller publish bridge (`plugin_slug` intake → validate → sign →
    catalog upsert + version row), registry surface closure
    (detail/manifest routes, uninstall on both surfaces, seller-scoped
    `plugin:<slug>` entitlements, author deprecation), and the
    `featured-vendor-widget` first-party seed (`manifest_plugin`, home
    card → featured vendors, backed by `vendor.promoted_listing`).
    Forge's build → publish flow and Blackout's real-provider signed
    bundles are the companion changes; deferrals in
    `docs/AUDIT_DEBT.md` §W3.
- **W4 — Reputation consolidation**: karma_event as the canonical log;
  re-point vendor-verification, Coliseum, and any future publisher
  tiers to derived projections; dedupe FBM's two reviews modules.
  *(Landed dark 2026-08-30: `recordKarmaEvent` write path + registry +
  attestation; xp_event mirrored row-for-row into the canonical log;
  reviews consolidated onto one model — service reviews absorbed, the
  storefront's write dialect accepted, its broken POST fixed; five-star
  reviews and verification checks/badges are the first producers;
  character-sheet karma projection bug fixed. Blackout hardens its
  per-context `reputation_events` (W4 B1) instead of adopting the karma
  name — see the D7 clarification. Deferrals in
  `docs/AUDIT_DEBT.md` §W4 — the vendor-panel/admin reviews screens
  still ride `@mercurjs/reviews` until re-pointed.)*
- **W5 — Geospatial service**: expose Blackout's spatial API for FBM
  consumption; retire the ZIP3 table + haversine helpers; absorb or
  archive the standalone `coalition-app` repo (outside this session's
  scope — needs operator action).
  *(Landed dark 2026-08-30: Blackout's `/v1/spatial/*` service surface
  (token-authed geocode, per-token rate buckets, 503 until tokens are
  minted) + FBM's `blackout-spatial` consumer behind
  `FBM_BLACKOUT_SPATIAL` with the ZIP3 fallback always available —
  `docs/contracts/blackout-spatial-consumer.md`. The retirement leg:
  six duplicated haversines → one `lib/geo-distance`; two divergent
  ZIP3 tables → one `lib/zip3` behind `GET /store/geocode` (this fixed
  a real bug: checkout could fail to geocode a ZIP the vendors page
  resolved). Deliberately kept local: pairwise distance (no data
  dependency) and mutual-aid distances (privacy boundary). Deferred
  with reasons in `docs/AUDIT_DEBT.md` §W5: remote nearby/zone
  containment await a vendor-coordinate data-ownership decision;
  Blackout's deployed PostGIS+martin remain unfed by its product;
  coalition-app stays an operator action.)*
- **W6 — Federation**: version connect.js as a shippable artifact;
  maintain the BMC↔UCP mapping in The-Connect; revisit protocol work
  when a second marketplace is real.
  *(Landed 2026-08-30 — mostly by discovering the first half had
  already shipped: connect.js v2.0.0 went out frozen + SRI-pinned on
  2026-08-13 (PRs #801–#803), so the artifact leg reduced to closing
  the real gaps — the Launch site template now embeds the pinned URL +
  integrity (enforced by `connect-sri.unit.spec.ts` so a version bump
  can never leave it behind) and `requireEmbedKey`/`optionalEmbedKey`
  gained direct middleware specs. The mapping leg is new work: The
  Connect now carries `docs/documentation/ucp-and-bmc-connect.md`, the
  BMC Connect ↔ UCP concept mapping per D3, wired into its mkdocs nav
  + llmstxt index; its CONSOLIDATION.md seed table folded in, including
  the correction that UCP does spec an order-scoped webhook. Protocol
  build remains gated on a second real marketplace — unchanged.)*
- **Ops track (parallel, not consolidation)**: BO-1 megolm/key-backup
  defect; the legal/compliance launch gates (§8).

## 7. What the review branch itself changes

On `claude/repo-consolidation-review-e1t8if` across the org:

- **free-black-market**: this document + index entry;
  `restaurant-marketplace` Medusa pins aligned 2.12.3 → 2.14.2.
- **blackmask**: `third_party/` source trees removed (inventory README
  and re-fetch script kept; full GitHub-side size reclaim would need a
  separate, deliberate history rewrite); `CONSOLIDATION.md` stub.
- **Blackstar**: duplicate `apps/blackstar-console` folded into
  `console/` (6 unique files + router/environment/home hunks ported;
  smoke script repointed); `CONSOLIDATION.md` stub.
- **blackout, Forge, The-Connect, BMC-alchemizer**: `CONSOLIDATION.md`
  stubs (plus a ROADMAP pointer row in blackout).

## 8. Legal gates — unchanged and restated

Nothing in this review loosens the standing gates:

- **Coliseum betting stays shelved.** No money staking on debate
  outcomes under any framing.
- **ACH payouts stay disabled** until the money-transmitter/compliance
  sign-off recorded in `PRE_LAUNCH_AUDIT.md` §5-C.
- **Coalition investing and revenue-share subscriptions**: the
  EconomicUnit/claim modeling may be designed, but no cash-in/cash-out
  code path ships before the compliance work completes (Reg CF
  requirements for revenue-share; CSA-style claim framing for
  production claims). These are hard release gates, not configuration
  toggles.

## 9. Operator actions this review cannot take

- Archive `Blackstar` and (after §5 harvest) `BMC-alchemizer` on GitHub
  once this branch merges — archiving is an org-admin action.
- Decide `coalition-app`'s disposition (rename/absorb/archive) — the
  repo was not in this session's scope.
- Merge the review branches; the eventual blackmask PR will render
  "diff too large" for the third_party removal (cosmetic only).
