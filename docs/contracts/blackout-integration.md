# FreeBlackMarket → Blackout Integration (FBM side)

This documents the FBM-side implementation of the FreeBlackMarket → Blackout
work order. It is the companion to `docs/contracts/entitlements.yaml` (the §4
wire schema).

## Configuration (§7)

| Var | Required | Used for |
|---|---|---|
| `FREEBLACKMARKET_WEBHOOK_SECRET` | prod (boot fails without) | HMAC signing of §1–§3 webhooks |
| `FREEBLACKMARKET_API_KEY` | prod (boot fails without) | bearer for the §5 commerce API |
| `BLACKOUT_API_BASE` | for emitting | webhook destination, e.g. `https://api.theblackout.app` |
| `FREEBLACKMARKET_BASE_URL` | optional | commerce API base advertised to Blackout |
| `ENTITLEMENTS_SERVICE_TOKEN` | for §4 | static bearer Blackout uses to call entitlements |
| `ENTITLEMENTS_BASE_URL` | optional | entitlements service base |
| `FBM_BLACKOUT_INTEGRATION=1` | yes | master flag; routes 503 and emitter no-ops when unset |
| `STRIPE_API_KEY` | for real payments | registers the `pp_stripe_stripe` payment provider |
| `STRIPE_PUBLISHABLE_KEY` | for the hosted checkout page | Stripe Elements on the W1b checkout page; without it the page falls back to a plain confirm button (dev providers) |
| `FBM_SUBSCRIPTION_PAYMENT_PROVIDER_ID` | optional | payment provider for Blackout checkout + renewals (default `pp_stripe_stripe`; set `pp_system_default` in dev) |
| `FBM_SUBSCRIPTION_RENEWAL_LIVE=1` | go-live | renewal cron mints real orders + off-session charges; unset = legacy date-advance (grants WITHOUT charging — never enable paid tiers without this) |

The outbound emitter also no-ops unless both `FREEBLACKMARKET_WEBHOOK_SECRET`
and `BLACKOUT_API_BASE` are set (`features.freeblackmarketEmit()`).

## Outbound webhooks (§1–§3)

- **Destination:** `POST {BLACKOUT_API_BASE}/v1/marketplace/webhooks/freeblackmarket`
- **Headers:** `content-type: application/json`, `x-fbm-event-id: <eventId>`,
  `x-fbm-signature: <lowercase-hex HMAC-SHA256(rawBody, FREEBLACKMARKET_WEBHOOK_SECRET)>`.
  The signature is computed over the **exact transmitted bytes**.
- **Envelope:** top-level `{ eventId, type, occurredAt, metadata?, ...fields }`.
- **Idempotency:** stable `eventId` per logical event; re-emits are de-duped at
  enqueue (unique `event_id` on the delivery) and again by Blackout.
- **Delivery:** enqueued by `MarketplaceWebhooksService.emitBlackout(...)`, shipped
  by the `drain-webhook-deliveries` job (every minute) with exponential backoff,
  reusing the existing per-seller delivery state machine. The per-seller webhook
  contract (`X-FBM-Signature: sha256=…`, wrapped envelope) is unchanged.

### Event catalog

| Type | Status | Emit point |
|---|---|---|
| `purchase.succeeded` | wired | `subscribers/emit-blackout-order-placed` (per line item) |
| `purchase.refunded` | wired | `subscribers/emit-blackout-order-refund-cancel` |
| `purchase.failed` | stub | `lib/blackout-stub-emitters` (no payment-failed flow yet) |
| `purchase.chargebacked` | stub | `lib/blackout-stub-emitters` (no chargeback flow yet) |
| `creator.payout.completed` | wired | `api/v1/admin/marketplace/payouts` |
| `listing.signed_bundle.published` | wired | `api/v1/seller/listings/[id]/publish` |
| `creator.account.suspended` | wired | `api/v1/admin/marketplace/creators/[seller_id]/suspend` |
| `referral.attributed` | wired | `subscribers/attribute-order-on-placed` (after commission attribution) |
| `ambassador.commission_paid` | stub | `lib/blackout-stub-emitters` (no ambassador payout flow yet) |
| `quest.reward_settled` | wired | `api/store/collective/demand-pools/[id]/bounties/[bountyId]/milestones` (milestone payout) |
| `order.created` | wired | `subscribers/emit-blackout-order-placed` |
| `order.updated` | wired | `subscribers/emit-blackout-order-updated` (dispatched/delivered) |
| `order.cancelled` | wired | `subscribers/emit-blackout-order-refund-cancel` |
| `inventory.low` | wired¹ | `jobs/inventory-reconciliation` (threshold scan) |
| `ledger.payment_received` | wired | `subscribers/hawala-order-payment` |
| `ledger.escrow_released` | wired | `api/v1/admin/marketplace/subcontracts/[id]/resolve` |
| `ledger.refund` | wired | `api/v1/admin/marketplace/subcontracts/[id]/resolve` |
| `ledger.usdc_converted` | wired | `jobs/hawala-settlement` (per settled vendor entry after Stellar anchor) |
| `subscription.activated` / `lapsed` | wired | `lib/blackout-subscription` via create/manage workflows + `jobs/process-subscription-renewals`; payload carries `occurredAt` for last-write-wins ordering |
| `subscription.payment_failed` | wired | `subscribers/emit-blackout-subscription-payment-failed` (per dunning attempt: `attempt`, `willRetry`, `nextRetryAt`, `occurredAt`); advisory — access lapses only via `subscription.lapsed` |
| `dispute.opened` | wired | `api/v1/seller/services/subcontracts/[id]/dispute` |
| `dispute.resolved` | wired | `api/v1/admin/marketplace/subcontracts/[id]/resolve` |
| `entitlements.changed` | wired | `subscribers/emit-blackout-order-refund-cancel` |
| `launch.created` | wired | `workflows/launch-product` (emit-launch-events step) |
| `bounty.opened` | wired | `workflows/launch-product` (emit-launch-events step) |

**Growth-loop events (§ ecosystem build).** Emitted by the Launch
orchestration (`POST /v1/seller/launches` → `launch-product` workflow) so the
Blackout Creator Hub / home feed can surface new launches and open marketing
bounties. Both use a stable `eventId` of `<type>:<launch_id>`:

- `launch.created` — `{ launchId, vendorMxid, productId, cooperativeId?,
  demandPostId, bountyId, dealId?, affiliateShortCode? }`. A single Launch
  materializes the product (Producer), a `cooperative_listing` (Coalition), a
  `demand_post` + `demand_bounty` (creator marketing bounty), and — when a
  creator is pre-matched — a `creator_deal` + default affiliate link.
- `bounty.opened` — `{ demandPostId, bountyId, objective, amount, currencyCode,
  cooperativeId? }`. Emitted only when the launch carries a funded bounty.

The Sale→Reward tail is unchanged: attributed sales flow through
`creator-attribution` → `collective-hawala` → `creator.payout.completed`.
Registered in `marketplace-webhooks/models/blackout-events.ts`
(`BLACKOUT_LAUNCH_EVENTS`).

¹ `inventory.low` emits only for items whose seller is resolvable from item
metadata; the seller-link join is the remaining one-line wire-up.

**Identity:** `userId` is the Blackout id stored at account-link time
(`POST /v1/integrations/blackout/link`), persisted as
`customer.metadata.blackout_user_id` / `seller_metadata.blackout_user_id` and
resolved via `lib/blackout-identity`. Events skip (never send a raw mxid/PII)
when no Blackout id is mapped. `vendorMxid` comes from `seller_metadata.mxid`.

**Amounts:** Medusa line items are already minor units (cents). Hawala ledger
balances are major units (NUMERIC dollars) and are converted with
`Math.round(value * 100)`.

## Entitlements service (§4)

Path-param routes under `/v1/integrations/blackout/entitlements`, bearer
`ENTITLEMENTS_SERVICE_TOKEN` (or a Blackout JWT). See `entitlements.yaml`.
`checkAccess`, `checkAccessBatch`, `getEconomicStanding`, `getGovernanceRoles`
(verbatim `matrixAcls`), `getCoalitionMemberships`, `getSummary`, and (W1b)
`listGrants` — `GET /entitlements/grants/{mxid}[?status=&featureKey=]`, the raw
grant rows with provenance (`source`, `sourceSubscriptionId`) and expiry.

## Commerce API (§5)

Served under the integration surface
`/v1/integrations/blackout/commerce/**` (bearer `FREEBLACKMARKET_API_KEY`),
mirroring the work-order operations so the existing seller-JWT `/v1/seller/**`
and public `/v1/checkout/**` routes are untouched:

| Work-order op | FBM path |
|---|---|
| `GET /v1/catalog/listings` | `…/commerce/catalog/listings` |
| `GET /v1/catalog/listings/{id}` | `…/commerce/catalog/listings/{id}` |
| `POST /v1/checkout/sessions` | `…/commerce/checkout/sessions` (stateful; see **Blackout checkout (W1b)**) |
| `POST /v1/seller/listings` | `…/commerce/seller/listings` |
| `POST /v1/seller/listings/{id}/publish` | `…/commerce/seller/listings/{id}/publish` |
| `DELETE /v1/seller/listings/{id}` | `…/commerce/seller/listings/{id}` |
| `POST /v1/seller/onboarding` | `…/commerce/seller/onboarding` |

`Listing` fields (camelCase) are backed by Blackout catalog columns added to
`creator_listing` (`category`, `price_cents`, `currency`, `entitlement_kind`,
`available_skus`, `media_urls`, `tags`, and — W1b — `product_id`, `variant_id`,
`interval`, `period_days`). W3 adds `pluginSlug`/`pluginVersion` (both nullable):
the plugin-registry identity the publish bridge stamps on extension listings.
Blackout's provider uses `pluginSlug` to resolve signed bundles via the public
`GET /store/plugins/{slug}` detail route (see
[extension-manifest.md](./extension-manifest.md)).

## Blackout checkout (W1b — the retired-Stripe-rail replacement)

`POST …/commerce/checkout/sessions` is **stateful**: each call persists a
`blackout_checkout_session` row, and the partial unique index on
`(userId, listingId, idempotency-key)` makes a retried POST return the SAME
session — the same eventual cart, order, and charge — instead of a decorative
id over a duplicate purchase.

Request body: `{ userId, listingId, sku?, returnUrl?, embed?, embedOrigin?,
mxid?, metadata? }`. `metadata` is a bounded string→string echo (≤20 keys,
≤500-char values) copied verbatim onto the order and returned on the
`purchase.succeeded` webhook — the Blackout return leg dispatches on
`metadata.creatorSubscriptionId` / `canopyPlanCode` / `tipId`. The listing
must be PUBLISHED with `price_cents ≥ 1` (`404 listing_not_found` /
`409 listing_not_purchasable` otherwise). Response: `{ id, url }` (201).

The hosted page (`…/sessions/{token}/page`) materializes the purchase
idempotently on first render:

1. **Customer** — `resolveOrCreateCustomerForBlackoutUser`: found by
   `metadata.blackout_user_id`, else `metadata.mxid`, else created with both
   keys and a synthetic `…@users.blackout.invalid` email (`POST …/link` also
   creates-on-miss now, so account-link never 404s a Blackout-native member).
2. **Shadow product** — `ensureListingProduct`: a product+variant priced from
   the listing (`price_cents`/100 in `currency`), deterministic handle
   `blackout-listing-<id>`, ids persisted on the listing.
3. **Cart** — region matched to the listing currency, metadata carrying the
   echo + `blackout_user_id` / `mxid` / `creator_listing_id` /
   `fbm_external_customer_id`.
4. **Payment** — payment collection + a payment session on
   `FBM_SUBSCRIPTION_PAYMENT_PROVIDER_ID` with
   `setup_future_usage: off_session`; the page renders Stripe Elements when
   `STRIPE_PUBLISHABLE_KEY` + a client secret exist, else a plain confirm
   button (dev providers).
5. **Completion** (`?action=complete`, or POST for JSON) — subscription-
   category listings run `createSubscriptionWorkflow` (order → subscription →
   `payment_method_id` + `metadata.blackout_tier` persisted → tier
   `feature_keys` bundle granted with `expires_at = next_order_date`); other
   listings run the digital-product order flow and grant their `feature_keys`
   keyed to the order. The session row records `order_id` /
   `subscription_id`; re-visits render the completed state.

Embed mode mirrors the public checkout page: `postMessage` events
(`checkout.ready|completed|cancelled|error`, source `fbm-checkout`) to the
`embedOrigin` captured at session creation, CSP `frame-ancestors` pinned to it.

**Lifecycle after purchase** — renewals: the hourly cron clones the template
cart and charges the saved `payment_method_id` off-session
(`FBM_SUBSCRIPTION_RENEWAL_LIVE=1`); each cycle extends the tier bundle to the
new `next_order_date` and the ledger types the purchase leg with
`reference_type=SUBSCRIPTION_RENEWAL` (reference_id = subscription). Failures:
dunning records the attempt and `subscription.payment_failed` is bridged per
attempt; pause-on-max-retries then emits `lapsed`. Cancel/expire revoke the
subscription-sourced grants (`revokeBySubscriptionId`) in the same motion as
the `lapsed` webhook. A refunded/canceled subscription order cancels its
subscription and revokes the bundle.

**FBM-side go-live steps** (joint with Blackout's MONETIZATION_GO_LIVE):
price + publish the Canopy plan listings seeded as drafts
(`canopy_plan_code` metadata), set `STRIPE_API_KEY` +
`STRIPE_PUBLISHABLE_KEY`, flip `FBM_SUBSCRIPTION_RENEWAL_LIVE=1` together
with Blackout's monetization gates, and verify during acceptance (with
`BLACKOUT_BETA_UNLOCK_ALL` off) that the first checkout attaches a reusable
payment method in the Stripe dashboard — off-session renewals depend on it.
