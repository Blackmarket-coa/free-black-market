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
| `referral.attributed` | stub | `lib/blackout-stub-emitters` |
| `ambassador.commission_paid` | stub | `lib/blackout-stub-emitters` |
| `quest.reward_settled` | stub | `lib/blackout-stub-emitters` |
| `order.created` | wired | `subscribers/emit-blackout-order-placed` |
| `order.updated` | wired | `subscribers/emit-blackout-order-updated` (dispatched/delivered) |
| `order.cancelled` | wired | `subscribers/emit-blackout-order-refund-cancel` |
| `inventory.low` | wired¹ | `jobs/inventory-reconciliation` (threshold scan) |
| `ledger.payment_received` | wired | `subscribers/hawala-order-payment` |
| `ledger.escrow_released` | wired | `api/v1/admin/marketplace/subcontracts/[id]/resolve` |
| `ledger.refund` | wired | `api/v1/admin/marketplace/subcontracts/[id]/resolve` |
| `ledger.usdc_converted` | stub | `lib/blackout-stub-emitters` |
| `subscription.activated` / `lapsed` | wired | `jobs/process-subscription-renewals` |
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
(verbatim `matrixAcls`), `getCoalitionMemberships`, `getSummary`.

## Commerce API (§5)

Served under the integration surface
`/v1/integrations/blackout/commerce/**` (bearer `FREEBLACKMARKET_API_KEY`),
mirroring the work-order operations so the existing seller-JWT `/v1/seller/**`
and public `/v1/checkout/**` routes are untouched:

| Work-order op | FBM path |
|---|---|
| `GET /v1/catalog/listings` | `…/commerce/catalog/listings` |
| `GET /v1/catalog/listings/{id}` | `…/commerce/catalog/listings/{id}` |
| `POST /v1/checkout/sessions` | `…/commerce/checkout/sessions` (`idempotency-key` → stable `id`) |
| `POST /v1/seller/listings` | `…/commerce/seller/listings` |
| `POST /v1/seller/listings/{id}/publish` | `…/commerce/seller/listings/{id}/publish` |
| `DELETE /v1/seller/listings/{id}` | `…/commerce/seller/listings/{id}` |
| `POST /v1/seller/onboarding` | `…/commerce/seller/onboarding` |

`Listing` fields (camelCase) are backed by Blackout catalog columns added to
`creator_listing` (`category`, `price_cents`, `currency`, `entitlement_kind`,
`available_skus`, `media_urls`, `tags`).
