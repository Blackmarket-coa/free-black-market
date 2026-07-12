# Creator Commerce Roadmap

This document captures the Creator Commerce optimization initiative — gap analysis,
phase plan, and acceptance criteria — derived from the strategic brief targeting
TikTok Shop / ShopMy / Whatnot / Gumroad / Patreon / Discord-app caliber creator
infrastructure.

The intent is for FBM to become "the easiest place on the internet for communities
to monetize together," not just another marketplace.

## How this doc is organized

- §1 maps the 8 strategic must-have areas to repo evidence (Present / Partial / Missing).
- §2 defines Phase 1 (currently in flight) with per-slice acceptance criteria.
- §3 stubs Phase 2+ work with rough scope and dependencies.
- §4 lists the env flags introduced by Phase 1 so each slice can ship dark.
- §5 is the migration ordering note.

---

## 1. Audit — strategic brief mapped to repo state

Verdicts are based on file/path evidence inside `backend/src`, `storefront/src`,
`vendor-panel/src`, `admin-panel/src` (no inference from tracker docs).

### 1.1 Creator Commerce

| Capability | Verdict | Evidence |
|---|---|---|
| Creator entity (distinct from vendor) | Present | `backend/src/modules/seller-extension/models/seller-metadata.ts` — `VendorType.CREATOR` enum + `creator_handle`, `creator_bio`, `creator_niches`, `creator_total_followers` fields |
| Public creator profile / branded storefront | Present | `storefront/src/lib/data/creator.ts` (`CreatorProfile`), storefront page `storefront/src/app/[locale]/(main)/creators/[handle]/`, embed variant present |
| Creator listings (signed digital products) | Present | `backend/src/modules/marketplace-listing/models/creator-listing.ts` |
| Creator branding (logo, banner, bio, social links) | Present | Social link fields on `seller-metadata.ts` (Instagram, TikTok, YouTube, Discord, etc.) |
| Creator/vendor interconnection (multi-creator stores, shared campaigns) | Partial | `cooperative`, `collective-campaign`, `kitchen` modules exist; no unified multi-creator storefront linking |

### 1.2 Affiliate / Cross-platform Tracking / Onboarding

| Capability | Verdict | Evidence |
|---|---|---|
| Affiliate links + click tracking | Present | `backend/src/modules/creator-attribution/` (AffiliateLink, AttributionClickEvent), `/r/[shortCode]` redirector at `backend/src/api/r/[shortCode]/route.ts` |
| UTM capture | Present (link-scoped) | UTM fields on `AffiliateLink`; cookie-based propagation via `_fbm_visitor`/`_fbm_aff` |
| Order attribution + commission lifecycle | Present (single-level) | `OrderAttribution`, `attribute-order-on-placed.ts` subscriber, hold→approve→paid |
| Recursive / multi-level referral chains | Missing | `OrderAttribution.order_id` is `unique()`; only one creator per order — see Phase 1 Slice B |
| Onboarding wizard | Present | `backend/src/modules/tenancy/models/onboarding-state.ts` (5-step), `vendor-panel/src/routes/onboarding/` |
| Social login (Google / Apple / TikTok / Discord) | Missing | `backend/medusa-config.ts` ships only the default emailpass auth — see Phase 1 Slice C |
| Frictionless / 60s onboarding path | Missing | Existing wizard requires payout + verification before publish |

### 1.3 Digital Product Dominance

| Capability | Verdict | Evidence |
|---|---|---|
| Digital / service / event product types | Present | `backend/src/modules/product-archetype/` enum (DIGITAL, SUBSCRIPTION, SERVICE, PLUGIN, THEME, COMMUNITY_SERVICE) |
| Plugin / theme / emoji-pack listing fields | Partial | `Migration20260506300AddPluginThemeFields.ts` adds `plugin_slug`, `plugin_version`, `plugin_repo_url`, `theme_slug`, `emoji_pack_slug` — schema only |
| Digital fulfillment + entitlement generation | Present | `backend/src/modules/digital-product/`, `backend/src/modules/entitlement/` (EntitlementKind, Source MANUAL/ORDER/SUBSCRIPTION), `grant-entitlements-on-order-placed.ts` subscriber |
| Signed download URLs | Present | `backend/src/modules/minio-file/service.ts` |
| Subscription model + recurring metadata | Present | `backend/src/modules/subscription/models/subscription.ts` (interval, period, next_order_date, stripe_subscription_id) |
| Subscription billing loop (real recurring orders + payment capture + entitlements) | Present | Slice A landed — `renew-subscription.ts` clones the template cart, creates + authorizes an off-session payment session, completes the order, links it, and grants entitlements keyed by the new order id (gated by `FBM_SUBSCRIPTION_RENEWAL_LIVE`). Pure input-shaping in `renew-helpers.ts` (unit-tested); DB+Stripe path is CI-verified |
| Access pass / gated content type | Present (via entitlement) | `EntitlementKind.access_pass` |

### 1.4 Plugin Marketplace

| Capability | Verdict | Evidence |
|---|---|---|
| Plugin listing schema + versioning | Partial | Plugin/theme columns on `creator-listing`; no version compatibility lifecycle |
| Plugin developer revenue split | Present | `payout-breakdown` supports `PLUGIN_DEVELOPER_FEE` |
| Install / entitlement-verification API | Present | `POST /store/plugins/:slug/install` (idempotent `plugin:<slug>` grant + install-count bump) and `GET /store/plugins/:slug/entitlement` (verify), reusing the entitlement service |
| Plugin version compatibility lifecycle | Present | Install is gated by `isInstallable` (`plugin-registry/compat.ts`): blocks `DEPRECATED` plugins and host-version mismatches against `PLATFORM_VERSION` using `min_host_version`/`max_host_version` bounds |
| Plugin event/hook system | Missing | No extension point registry beyond Medusa subscribers (2A-tail, deferred) |

### 1.5 Group / Community Commerce

| Capability | Verdict | Evidence |
|---|---|---|
| Cooperatives / kitchens / collective campaigns | Present | `backend/src/modules/cooperative/`, `kitchen/`, `collective-campaign/` |
| Revenue pooling / split payouts | Present | `backend/src/modules/hawala-ledger/`, `kitchen-ledger.ts` |
| Multi-creator shared campaigns | Partial | Collective campaigns exist but no creator-specific shared affiliate group |
| Community treasury logic | Present | `payout-breakdown.community_fund` fee type |

### 1.6 Service Marketplace

| Capability | Verdict | Evidence |
|---|---|---|
| Service listing / contract lifecycle | Present | `backend/src/modules/service-program/` (ServiceProgram, ServiceApplication, ServiceContract; PENDING→ACCEPTED→IN_PROGRESS→COMPLETED→DISPUTED) |
| Reviews / ratings on services | Present | `ServiceReview` model on `service-program` (accepted-contract, client-authored, 1..5, one per contract); `POST /vendor/service-contracts/:id/reviews` + public `GET /store/service-sellers/:sellerId/reviews` |
| Contract lifecycle transitions | Present | `POST /v1/seller/services/contracts/:id/{start,deliver,accept,dispute,cancel}` with a per-transition authorization guard (`contract-transitions.ts`); the `accept` transition is what makes a contract reviewable |
| Messaging hooks | Present | Lifecycle transitions dispatch the per-seller `service.contract.{delivered,accepted,disputed}` webhooks to both parties; disputes also emit the Blackout `dispute.opened` bridge. Deeper Blackout/RocketChat room hooks remain out of scope |

### 1.7 Omnichannel

| Capability | Verdict | Evidence |
|---|---|---|
| Sales channel taxonomy | Partial | `backend/src/modules/agriculture/models/availability-window.ts` `SalesChannel` enum (DTC, B2B, CSA, WHOLESALE, FARMERS_MARKET) |
| Fulfillment-mode breadth | Partial | `food-distribution` `FulfillmentType` (PICKUP, DELIVERY, DINE_IN, CURBSIDE, LOCKER, COMMUNITY_POINT) |
| `order_channel` field on order | Present | `modules/order-channel` — one attribution row per order (online/pos/vending/pickup/subscription), written by the `attribute-channel-on-placed` subscriber. Clients declare a channel pre-completion via `POST /store/carts/:id/channel` (cart-metadata stamp, same mechanism as affiliate attribution); subscription renewals stamp `order_channel: subscription`; unstamped orders default to `online` |
| POS / vending integrations | Partial | `POST /vendor/pos/orders` rings up an in-person sale as a real order (stamped `order_channel: pos`, emits `order.placed` so channel attribution / entitlements / Blackout events fire); `/vendor/pos/checkout` still handles vendor-to-vendor hawala payments. Remaining: vending hardware, POS inventory reservation (future POS module), vendor-panel POS UI for order ring-up |
| Unified cross-channel customer view | Present | `GET /store/customers/me/order-channels` — the customer's orders annotated with channel + a per-channel summary (counts, per-currency totals); pre-feature orders default to `online` |

### 1.8 Analytics

| Capability | Verdict | Evidence |
|---|---|---|
| Storefront event taxonomy | Missing | `storefront/src/lib/analytics/events.ts` only emits 11 marketing-page events; no `product_view` / `add_to_cart` / `purchase` / `click_affiliate` / `signup` / `subscribe` |
| Backend event ingest table | Missing | No `analytics_event` table — see Phase 1 Slice B |
| Creator-side performance metrics | Partial | `creator-rewards/models/content-post.ts` + `engagement-snapshot.ts` track external content; no conversion/funnel dashboard |
| Vendor analytics dashboard | Partial | `vendor-panel/src/routes/dashboard/` shows sales/orders charts; no retention/cohort/referral views |
| Discoverability (trending / for-you) | Missing | Algolia search integrated but no recommendation/trending surfaces |

---

## 2. Phase 1 — In-flight slices

Phase 1 ships on branch `claude/fbm-creator-commerce-wjh4Z` as four commits.

### Slice A — Subscription billing loop + entitlements ✅ LANDED

**Why.** Subscriptions are foundational to creator commerce (Patreon, Whatnot
weekly drops, CSA boxes). The model + hourly job + workflow stub existed but the
renewal workflow did not create orders or capture payments.

**Status.** Landed: `renew-subscription.ts` now composes
createCart → payment-collection → off-session payment-session → authorize →
completeCart → subscription↔order link → record-order → entitlement grant
(keyed by the new order id), gated by `FBM_SUBSCRIPTION_RENEWAL_LIVE`. Legacy
date-advance path preserved when the flag is unset. Pure input-shaping lives in
`renew-helpers.ts` and is unit-tested; the DB+Stripe path is CI/live-env
verified. Optional provider override: `FBM_SUBSCRIPTION_PAYMENT_PROVIDER_ID`
(defaults to `pp_stripe_stripe`).

**What.**
- `backend/src/workflows/subscription/workflows/renew-subscription.ts` —
  replace stub at lines 97–115 with `createRenewalOrderStep →
  captureSubscriptionPaymentStep → linkRenewalOrderStep →
  updateSubscriptionStep`. Gate behind `FBM_SUBSCRIPTION_RENEWAL_LIVE`.
- New steps: `create-renewal-order.ts`, `capture-subscription-payment.ts`,
  `link-renewal-order.ts` under `backend/src/workflows/subscription/steps/`.
- New workflow `handle-subscription-failure.ts` — dunning (1d/3d/7d), pause on
  4th failure, emit `subscription.payment_failed`.
- `backend/src/jobs/process-subscription-renewals.ts` — invoke the workflow
  instead of `recordNewSubscriptionOrder` directly.
- `backend/src/modules/entitlement/service.ts` + `subscribers/grant-entitlements-on-order-placed.ts` —
  pass `source: SUBSCRIPTION` + `source_subscription_id` when
  `order.metadata.subscription_id` is present.

**Acceptance criteria.**
1. With `FBM_SUBSCRIPTION_RENEWAL_LIVE=1`, hourly job creates a real order for
   each due subscription, captures payment off-session via Stripe, advances
   `last_order_date` and `next_order_date`.
2. Entitlements granted with `source=subscription` + `source_subscription_id`.
3. Card failure → retry on 1d/3d/7d schedule; 4th failure pauses subscription
   and emits `subscription.payment_failed` event.
4. Unsetting `FBM_SUBSCRIPTION_RENEWAL_LIVE` returns to legacy `renewal_prepared`
   path.

### Slice B — Multi-level referrals + analytics event taxonomy

**Why.** A single-level affiliate model caps creator-driven growth. ShopMy /
Whatnot growth is partly recursive (creators recruiting creators). Plus we need
a canonical event taxonomy to feed Phase 4 dashboards.

**What.**
- `affiliate_link.referrer_creator_seller_id` (nullable text + index) — points
  to the parent creator who recruited this creator.
- `order_attribution`: drop `unique(order_id)`, add composite unique
  `(order_id, level)`, plus `parent_attribution_id`, `level int default 1`,
  `level_split_percent`.
- `creator_program.max_referral_levels int default 1` (capped at 3 in service)
  and `referral_level_splits jsonb`.
- `order_payout_breakdown.referrer_levels jsonb` capturing per-level per-seller
  amounts.
- New `analytics_event` table + `POST /store/analytics/events` ingest endpoint.
- `creator-attribution/service.ts` — in `attributeOrder`, walk parent chain to
  insert L1/L2/L3 rows with split percentages from program (default
  `{L1:80, L2:15, L3:5}` from `FBM_REFERRAL_DEFAULT_SPLITS`).
- `storefront/src/lib/analytics/events.ts` — extend `WebsiteEventName` with
  canonical funnel; add `enrichWithContext` helper that auto-attaches
  `_fbm_visitor`, `_fbm_aff`, `utm_*`, `creator_handle`; add `postToBackend`
  via `navigator.sendBeacon`.

**Acceptance criteria.**
1. With `FBM_MULTILEVEL_REFERRALS=1`, an order driven by a 3-deep referral
   chain produces three `order_attribution` rows (levels 1/2/3) summing to 100%
   of the configured commission.
2. `payout-breakdown.referrer_levels` lists the L2/L3 amounts; legacy
   `total_to_referrers` matches the L2+L3 sum.
3. Without the flag, behavior is identical to today (single L1 row).
4. `POST /store/analytics/events` accepts allowlisted event names, writes a row
   with visitor/creator/UTM context, returns 400 on unknown events.
5. Storefront emits the canonical taxonomy on product view, add-to-cart,
   purchase, share, click-affiliate, signup, subscribe; events appear both in
   GTM dataLayer (back-compat) and the new ingest table.

### Slice C — Social login + frictionless creator onboarding

**Why.** Creator-economy products live or die on time-to-first-product.
Email-only signup + a 5-step wizard with payout/KYC up-front is too heavy
for an Instagram-native creator.

**What.**
- `backend/medusa-config.ts` — add an `auth` module with conditional
  `emailpass` + `google` (`@medusajs/medusa/auth-google`) + `tiktok`
  + `discord`. Each provider only registers when its env vars are present.
- New auth-provider modules `backend/src/modules/auth-tiktok/` and
  `auth-discord/` (single `service.ts` each, no domain models — these are
  infrastructure providers, not business modules).
- `backend/src/api/auth/seller/social-callback/[provider]/route.ts` — handles
  post-OAuth callback, mints registration token, captures `_fbm_aff` cookie,
  persists `referred_by_seller_id` (Slice B chain seed).
- `backend/src/modules/tenancy/models/onboarding-state.ts` — new
  `quick_path_used boolean default false` and `referred_by_seller_id text NULL`.
- `backend/src/api/vendor/onboarding/quick-publish/route.ts` — POST that
  creates a draft product (title + price) and advances wizard to `STEP_3`,
  deferring payout/KYC until first sale (existing `creator_program.requires_kyc`
  gate handles enforcement).
- `vendor-panel/src/routes/onboarding/quick-path.tsx` — collapsed UI
  (handle, niches, sample product). Existing wizard reachable via `?mode=full`.
- `vendor-panel/src/routes/register/social-buttons.tsx` and
  `storefront/src/modules/account/components/social-login-buttons.tsx`.
- `backend/src/subscribers/seller-created.ts` — when metadata carries
  `referred_by_aff_short_code`, persist `referred_by_seller_id` and seed the
  new seller's primary AffiliateLink with `referrer_creator_seller_id`.

**Acceptance criteria.**
1. Setting `GOOGLE_CLIENT_ID` (or TikTok / Discord equivalents) causes the
   provider to register; missing envs leave the app booting with emailpass only.
2. Social login from a referred URL (`_fbm_aff` cookie present) creates a seller
   with `OnboardingState.referred_by_seller_id` set + a primary AffiliateLink
   with the parent creator linked.
3. `VITE_FBM_QUICK_ONBOARD=1` redirects vendor-panel onboarding to the quick
   path; a creator can publish a draft product in under 60 seconds.
4. Without the flag, the existing 5-step wizard is unchanged.

---

## 3. Phase 2+ — Deferred scope (planned, not in flight)

Each item below is scoped enough to start in a future PR without re-deriving
context. Dependencies on Phase 1 are noted.

| Phase | Scope | Notes / dependencies |
|---|---|---|
| 2A | Plugin marketplace runtime — ✅ install/entitlement-verification API + ✅ version-compatibility gate (`min/max_host_version` vs `PLATFORM_VERSION`, deprecated-block). Remaining (2A-tail): plugin event hooks | Schema is already in place |
| 2B | Service marketplace reviews — ✅ review/rating model + endpoints + ✅ contract lifecycle transitions/messaging landed on `service-program`. Remaining: deeper Blackout/RocketChat room hooks | Mirrored the existing product-review + subcontract-dispute patterns |
| 3A | Omnichannel `order_channel` first-class — ✅ landed: `order-channel` module + `order.placed` subscriber + cart-stamp route + unified customer view + POS order flow (`POST /vendor/pos/orders` creates a real `pos`-stamped order and emits `order.placed`; mirrors the delivery flow's direct order creation). Remaining: POS inventory reservation + vendor-panel ring-up UI (future POS module) | None |
| 3B | POS + vending hardware — Stripe Terminal / Square integrations | Depends on 3A |
| 4A | Creator / vendor / community dashboards — conversion, retention, cohort, campaign performance, subscription growth | Reads from Slice B `analytics_event` table |
| 4B | Discoverability — trending creators, "for-you" feed, personalized recs | Reuse AI orchestrator service (`services/ai-orchestrator/`) |
| 4C | Apple OAuth provider | Depends on Apple developer account |

---

## 4. Env flags

| Flag | Slice | Default | Effect when unset |
|---|---|---|---|
| `FBM_SUBSCRIPTION_RENEWAL_LIVE` | A | unset | Workflow returns legacy `renewal_prepared: true` (no order created) |
| `FBM_SUBSCRIPTION_PAYMENT_PROVIDER_ID` | A | `pp_stripe_stripe` | Payment provider used for off-session renewal charges |
| `FBM_MULTILEVEL_REFERRALS` | B | unset | `attributeOrder` writes single L1 row exactly like today |
| `FBM_REFERRAL_DEFAULT_SPLITS` | B | `{"L1":80,"L2":15,"L3":5}` | Used only when program lacks explicit splits |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | C | unset | Google provider not registered |
| `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` | C | unset | TikTok provider not registered |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | C | unset | Discord provider not registered |
| `VITE_FBM_QUICK_ONBOARD` | C | unset | Vendor-panel falls back to the 5-step wizard |

---

## 5. Migration ordering

`docs/AUDIT_DEBT.md` records TI-1: a `Migration20260520AddCreatorCommission`
references `order_payout_breakdown` before its creation. Phase 1 Slice B's
new migrations are numbered `Migration20260520202+` so they land cleanly
*after* both `20260520AddCreatorCommission` and the existing
`20260506*` migrations. Migration files are additive only:

- `Migration20260520202AddMultiLevelReferrals.ts` — referrer column on
  `affiliate_link`; level columns + composite unique on `order_attribution`
- `Migration20260520203AddReferralLevels.ts` — level config on `creator_program`
- `Migration20260520204AddReferrerLevels.ts` — `referrer_levels jsonb` on
  `order_payout_breakdown`
- `Migration20260520205AddAnalyticsEvents.ts` — new `analytics_event` table
- `Migration20260520206AddQuickPath.ts` — quick-path + referral columns on
  `onboarding_state`

## 6. Rollback

Per-slice rollback procedures:

- **Slice A** — unset `FBM_SUBSCRIPTION_RENEWAL_LIVE`. Workflow returns to
  legacy stub. No data migration to reverse.
- **Slice B** — unset `FBM_MULTILEVEL_REFERRALS`. `attributeOrder` writes a
  single L1 row. New columns/tables are nullable/empty when unused. The
  composite unique `(order_id, level)` is a strict superset of the dropped
  `unique(order_id)` for level=1 rows.
- **Slice C** — unset `VITE_FBM_QUICK_ONBOARD` (UI rollback) and the
  `GOOGLE_CLIENT_ID`/`TIKTOK_*`/`DISCORD_*` env vars (auth providers
  unregister at boot). New onboarding columns remain nullable.

---

## See also

- `FEATURE_BUILD_PLAN.md`
- `docs/AUDIT_DEBT.md`
- `docs/PHASE_0_FOUNDATIONS.md`
- `docs/VENDOR_FEATURE_MATRIX.md`
