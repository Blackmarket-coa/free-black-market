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
| `FREEBLACKMARKET_BASE_URL` | optional | commerce API base advertised to Blackout; also the origin the subscription manage page's actions must come from when a browser sends no Fetch Metadata |
| `BLACKOUT_RETURN_ORIGINS` | optional | comma-separated origins a manage session's `return_url` ("Back to Blackout") may point to; anything else is ignored; unset accepts none |
| `ENTITLEMENTS_SERVICE_TOKEN` | for §4 | static bearer Blackout uses to call entitlements |
| `ENTITLEMENTS_BASE_URL` | optional | entitlements service base |
| `FBM_BLACKOUT_INTEGRATION=1` | yes | master flag; routes 503 and emitter no-ops when unset |
| `STRIPE_API_KEY` | for real payments | registers the `pp_stripe_stripe` payment provider |
| `STRIPE_WEBHOOK_SECRET` | for `purchase.failed` / `purchase.chargebacked` | signing secret of the Stripe webhook endpoint pointed at Medusa's payment webhook (`/hooks/payment/stripe_stripe`); the same value the Stripe provider is configured with. Unset = those two events are never emitted. The endpoint must have `payment_intent.payment_failed`, `charge.dispute.created` and `charge.dispute.funds_withdrawn` enabled |
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
| `purchase.failed` | wired | `subscribers/emit-blackout-stripe-payment-events` on a signature-verified Stripe `payment_intent.payment_failed`, Blackout-checkout carts only, and only while nothing can have been granted (checkout not completed, payment session not authorized/captured, no earlier completed checkout of the same listing by the same member); `eventId` `purchase.failed:<checkout_session_id>`, metadata carries `fbmCheckoutSessionId` / `fbmCartId` (no order exists yet) |
| `purchase.chargebacked` | wired | `subscribers/emit-blackout-stripe-payment-events` on a signature-verified Stripe `charge.dispute.funds_withdrawn`, or `charge.dispute.created` past the inquiry stage (`warning_*` statuses skipped), for a Blackout-checkout order; `eventId` `purchase.chargebacked:<order_id>`. Report-only: FBM's own dispute/ledger records are not touched |
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
| `aid.request.opened` / `fulfilled` / `closed` | wired | `subscribers/emit-blackout-aid-request` (one subscriber; the request's status picks the type) |
| `cycle.open` / `cycle.close` | wired | `jobs/order-cycle-status-update` (per cycle, from the status sweep's transition callback) |

**Mutual-aid mirror (§3.8).** FBM's ask board feeds Blackout's Coalition
board, which is the surface a member browses on the map. Three types because an
ask leaves the board three ways: `opened` (created, or matched — a helper having
committed is not the ask leaving), `fulfilled` (the requester confirmed help
arrived), and `closed` (withdrawn, or its `needed_by` passed). `eventId` is
`<type>:<request_id>`, and Blackout upserts on `requestId`, so a retried
transition lands on the same row rather than posting a second copy of somebody's
need.

The payload is exactly `toPublicAid`'s output, renamed to camelCase, with `id`
becoming `requestId`: `{ requestId, title, description, category, status,
quantity, unitOfMeasure, locality, createdAt }`. **This set is closed and adding
to it is a decision, not a field addition** — Blackout's
`GET /v1/coalition/mutual-aid` publishes its rows verbatim with no projection of
its own, so anything put on this family is published to the world. Coordinates,
`requester_id`, `matched_helper_id`, `urgency`, `needed_by` and `metadata` are
all deliberately absent; `lib/blackout-aid.ts` builds the payload from the
projection rather than the row, and `backend/src/lib/__tests__/blackout-aid.unit.spec.ts`
pins the nine keys.

Every transition announces `mutual_aid.request_changed` on the internal bus
carrying only a request id — the create, withdraw and confirm routes plus the
`mutual-aid-expiry` sweep — and the subscriber re-reads and projects the row.
That is why the requester's id never has to be trusted not to travel: it is
never put on an internal event that the emitter reads.

**Order-cycle events (§3).** `cycle.open` and `cycle.close`, one per cycle that
actually transitioned, emitted from the five-minute status sweep. `eventId` is
`<type>:<cycle_id>`.

The payload carries the three fields Blackout's parser requires — `vendorId`
(the cycle's `coordinator_seller_id`), `cycleId`, `name` — plus `closingAt`,
plus `ordersPlaced` on `cycle.close`. Three optional fields Blackout accepts
are deliberately **not** sent, because each would have to be invented:

-   `items` needs a product join: `order_cycle_product` carries `variant_id`,
    not the `{sku, title}` pairs the field means.
-   `listingDeepLink` would point at a storefront order-cycle route that does
    not exist.
-   `soldOutSku` belongs to `sold_out`, which is **not registered** on this
    side: Blackout accepts it, but FBM decides sold-out per product
    (`evaluateShipWindow`), not per cycle, so there is no trigger to emit it
    from.

`ordersPlaced` was on that list until 2026-09-10, for want of an order-to-cycle
link. It is sent now: the storefront tags line items with `order_cycle_id`
(`storefront/src/lib/data/order-cycles.ts`), the `order.placed` subscriber
writes one row per (order, cycle) into `order_order_ordercyclemodule_order_cycle`,
and `countCycleOrders` in `backend/src/lib/blackout-cycle.ts` counts them. Three
things about it are deliberate:

-   **Close only.** A cycle that has just opened has had no chance to take
    orders, so "0 order(s) placed" on an open would read as a result rather
    than a start. Blackout's renderer prints the clause on `cycle.close` only
    (`packages/api/src/services/fbmMatrixBridge/messageFormat.ts`), so the two
    sides agree.
-   **The link, not `order_cycle_sale`.** A sale row exists only for variants
    registered in the cycle, so an order carrying an unregistered variant would
    go uncounted; the link is created for every order tagged with the cycle.
-   **Omitted, not zeroed, when the read fails.** Blackout distinguishes the
    two — `undefined` drops the clause, `0` prints "0 order(s) placed" — and a
    cycle whose count could not be read is not a cycle that sold nothing. A
    genuine zero is still sent as zero; that one is true.

Both sources are only recently populated, so a cycle that ran before the
storefront started tagging line items will report a count lower than it really
was. That is a bounded, one-time undercount of history rather than an ongoing
one, and it is not backfillable: the tag was never written.

A row missing any of the required three is skipped with a log line rather than
enqueued, since Blackout's parser would reject it.

**What this replaced.** `PlantShipWindowService.syncCycleStatuses` emitted
`order_cycle.closed` with `{closedCount, openedCount}`. That call never reached
Blackout once: the method had no callers (the scheduled job calls
`updateOrderCycleStatuses` on the module service directly), and the type was
never registered, so `emitBlackout` threw — before the `isBlackoutEmitConfigured`
gate, so in every environment — and `emitBlackoutEvent` swallowed it. Its
`eventId` also keyed on `Date.now()`, which would have defeated delivery dedupe
had it ever run. `backend/src/lib/__tests__/blackout-cycle.unit.spec.ts` now
asserts every emitted cycle type passes `isBlackoutEventType`, which is the
check whose absence let that sit silent.

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
| `POST /v1/subscriptions/manage-session` (Blackout `packages/api`) | `…/commerce/subscriptions/manage-sessions` (15-minute single-member link to the FBM-hosted manage page; see **Blackout subscription self-service**) |
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

**Auto-renew approval (`FF_CONSUMER_SUBSCRIPTIONS_V1`, subscription-category
listings only; operator answer 2026-10-05, "renew upon approval").** Flag off,
or a one-off listing, steps 4–5 above are unchanged byte for byte. Flag on, for
a recurring listing:

- The page shows the storefront's checkbox label and disclosure text,
  **unticked**, plus the one-period terms while unticked (copy:
  `backend/src/modules/subscription/utils/auto-renew-copy.ts`, held
  string-identical to `storefront/src/lib/subscriptions/auto-renew.ts` by a
  test, disclosure version `AUTO_RENEW_DISCLOSURE_VERSION`). The checkbox is
  offered only when the shadow product carries `subscription_until_canceled`
  in its metadata. A recurring listing was sold as a renewing membership
  before the flag, so the first time its page asks the question FBM merges
  `subscription_until_canceled: true` onto the listing's own shadow product
  (`ensureRecurringListingMarkedUntilCanceled`: once, read-then-merge, every
  other metadata key kept; `ensureListingProduct` itself is unchanged). It
  never marks a one-off listing, a product that is not that listing's shadow
  product, or one whose metadata already has the key (an operator's explicit
  `false` opts it out). The page's offer and the subscription create step
  read the same marker. Without it (opted out, or the write failed) only the
  one-period terms are shown and the only answer accepted is `false`. The
  marker is a permission, not an approval: the member still has to tick the
  box, and an unticked purchase is one period.
- Ticking/unticking reloads the page with `?auto_renew_approved=true|false`;
  the payment session is (re)started with `setup_future_usage: off_session`
  **only** when approved, and its PaymentIntent metadata then carries
  `fbm_auto_renew_disclosure_version` (the approval mark). An unpaid session
  that does not fit the answer is replaced; one that may already be paid is
  never replaced and locks the answer.
- **The box renders ticked only on the page's own toggle navigation**
  (`Sec-Fetch-Site: same-origin`; with no Fetch Metadata, a Referer on the
  page's own host). A URL built anywhere else, an iframe `src` Blackout sets
  included, renders **unticked** even with `?auto_renew_approved=true`, and
  its payment session keeps no card. Blackout must not try to pre-answer the
  question: open the page without `auto_renew_approved`. A browser that sends
  neither header cannot approve (it fails closed, unticked).
- Completion requires the answer: `?action=complete&auto_renew_approved=true|false`
  (plus `auto_renew_disclosure_version=<version>` when `true`), or the same two
  fields in the JSON POST body. Refusals, before anything is completed:
  `400 auto_renew_answer_required` (missing/invalid), `409
  auto_renew_disclosure_outdated`, `409 auto_renew_not_offered`, `409
  auto_renew_answer_mismatch` (answer differs from the session the member paid
  against; an approval is accepted only against a session carrying the
  approval mark), `409 auto_renew_not_asked` (see flag flip below), `409
  auto_renew_answer_conflict` (a completed session re-hit with a different
  answer; the same answer returns the recorded ids). In embed mode a refusal
  posts `checkout.error` with `payload.code`. A retry after the cart completed
  but before the session was marked completed reads the answer back from the
  completed cart's payment sessions and finishes the record.
- **Flag flip with checkouts in flight.** Every session started before the
  flag was on keeps the card and has no approval mark. An unpaid one is
  replaced on its next render. A paid one is never read as an approval or a
  decline: its completion is refused `409 auto_renew_not_asked` and logged
  for an operator (void or refund, or complete by hand). A page rendered
  before the flip carries no answer and gets `400 auto_renew_answer_required`.
  Turn the flag on when no Blackout checkout is mid-payment.
- Approved: the store route's terms (`decideCreateTerms` — until cancelled for
  a marked product), approval + timestamp + disclosure version recorded, card
  saved as `payment_method_id` (`saveAutoRenewPaymentMethod`). Declined:
  exactly one period, no next order, never renews, no `payment_method_id`, and
  the tier bundle's `expires_at` is the end of that period.
- **Blackout-side impact:** a programmatic consumer of the JSON POST must send
  `auto_renew_approved` once the flag is on, or it gets 400.

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

## Blackout subscription self-service (manage session; operator answer 2026-10-06)

A Blackout member has no storefront login (a create-on-miss customer carries
only a synthetic `…@users.blackout.invalid` email), yet the approved
auto-renewal disclosure tells them they can "turn off automatic renewal or
cancel at any time under Account → Subscriptions". Blackout's Account →
Subscriptions therefore opens an FBM-hosted page for that member.

**Mint (server to server).**
`POST {FREEBLACKMARKET_BASE_URL}/v1/integrations/blackout/commerce/subscriptions/manage-sessions`

- Auth: the same `FREEBLACKMARKET_API_KEY` bearer and `requireCommerceApiKey`
  gate as the checkout mint.
- Body (JSON, strict): `{ "blackout_user_id": string, "return_url"?: string }`.
  `blackout_user_id` is Blackout's authenticated user (`user.sub`), never a
  client-supplied value. No `mxid`, customer id or subscription id is
  accepted (any extra key is a 400). `return_url` is kept only when its
  origin is listed in FBM's `BLACKOUT_RETURN_ORIGINS` (comma-separated);
  otherwise it is ignored, not refused.
- `201 { "url": string, "expires_at": ISO-8601 }`.
- `404 { "code": "feature_disabled" }` when `FF_CONSUMER_SUBSCRIPTIONS_V1` or
  `FBM_BLACKOUT_INTEGRATION` is off. `401` for a missing/wrong key.
- `409 { "code": "identity_ambiguous" }` when more than one FBM customer
  carries that `blackout_user_id` (FBM never picks one; an operator fixes the
  data).
- No matching customer is still `201`; the page then shows "No
  subscriptions". FBM never creates a customer on this path and never resolves
  one by mxid.

**Session.** An opaque 32-byte random token (base64url) in the URL path; FBM
stores only its sha256 (`blackout_manage_session.token_hash`). Not a JWT and
never a customer session on `/store`. TTL 15 minutes, absolute. Minting again
for the same `blackout_user_id` revokes every earlier session of that member
(a partial unique index allows one unrevoked session per member). The bound
customer is fixed at mint by a read-only lookup on
`customer.metadata.blackout_user_id`.

**Page.** `GET {FBM}/v1/integrations/blackout/commerce/subscriptions/manage-sessions/{token}/page`

- Blackout opens it in a **new tab / system browser** with
  `noopener,noreferrer`; it is never embedded (`frame-ancestors 'none'`,
  `X-Frame-Options: DENY`). Also `Cache-Control: no-store`,
  `Referrer-Policy: no-referrer`; the script runs under a per-response CSP
  nonce. Blackout opens the URL as-is: it must not script the page, pre-fill
  it, or POST its actions (a cross-site POST is refused).
- Lists only the subscriptions that member bought through Blackout. A row is
  shown, and acted on, only when it belongs to the bound customer AND its own
  `metadata.blackout_user_id` names this member — the hosted checkout stamps
  that on each subscription it creates. A row without the stamp (bought on
  the storefront) is never listed or actionable here, even on the member's own
  customer, and neither is a row another Blackout member bought (operator
  scope decision 2026-10-06: Blackout-bought rows only). Every listed row and
  every action is checked the same way.
- Actions: `disable_auto_renew`, `approve_auto_renew` (the re-approval
  disclosure from `backend/src/modules/subscription/utils/auto-renew-copy.ts`,
  string-identical to the storefront's, version
  `AUTO_RENEW_REAPPROVAL_DISCLOSURE_VERSION`; unticked; the button stays
  disabled until ticked), `cancel`. No pause/resume. A legacy fixed-horizon
  row (expiration set, never approved) offers cancel only — while renewals
  are still scheduled it says it renews until its end date, and in its final
  period it says no further charges are made. The price named in the
  re-approval disclosure is what a renewal of that row charges (its template
  cart's line-item price, read the way the renewal builds its cart), not the
  listing's current price; when that cannot be read, re-approval is not
  offered.
- Each action is a `POST` to the same URL, JSON, from the page's own script:
  `{ action, subscription_id, csrf, auto_renew_approved?: true,
  auto_renew_disclosure_version? }`. Refused, writing nothing: `403
  csrf_rejected` unless `Sec-Fetch-Site: same-origin` (or, with no Fetch
  Metadata, an `Origin` equal to FBM's own origin), `Content-Type:
  application/json`, and the session's CSRF nonce; `401 session_expired`;
  `403` `forbidden()` for a subscription the session does not own (missing
  and not-owned are the same body); `409 subscription_transition_not_allowed`
  for a cancel of a row that is no longer active, paused or in grace; `409
  auto_renew_not_available` for an `approve_auto_renew` on a row the page
  shows no re-approval disclosure for (a legacy fixed-horizon row, or one
  whose renewal price is unknown). Past
  those, the action runs through the same dispatcher as `POST
  /store/subscriptions/:id` (`backend/src/lib/subscription-manage.ts`), with
  its semantics and refusal codes (`400` validation, `409
  subscription_transition_not_allowed`, `409 auto_renew_*`).
- An invalid, expired, revoked or replaced token: `401` HTML "This link has
  expired. Open Subscriptions in Blackout again." Either flag off: `404`
  HTML "unavailable" (and `404 feature_disabled` for a POST).
- "Back to Blackout" links to the accepted `return_url`, when there is one.
- The token is in the URL path, so an HTTP access log or proxy log in front
  of FBM records it (FBM's application logs never do). Anyone holding a
  logged URL could open the page until it expires; a browser on another site
  still cannot POST its actions (the Fetch Metadata / Origin check). The
  15-minute TTL and revocation on re-mint bound that exposure; operators
  should keep access logs for these paths short-lived or redact the segment
  after `manage-sessions/`.

**What reaches Blackout.** A cancel that ends the subscription emits the
existing `lapsed` webhook (a grace cancel keeps access and lapses when grace
ends). Turning automatic renewal off or on sends no webhook today. Copy on the
Blackout side must not overstate privacy: FBM sees the Blackout user id; the
card processor sees the card.

**Account link guard.** `POST …/link` refuses (`403`, the `forbidden()` body)
to put a `blackout_user_id` on a customer that already carries a different
one, or on a seller whose `seller_metadata.blackout_user_id` names a different
member; both halves are read before either is written (a refusal on the read
writes nothing), and each write repeats the check in its `WHERE`. The two
writes are not one transaction: if the customer write commits and the seller
write then loses a race to another member's link, the `403` leaves the
customer linked to the caller's own id. Linking the same member again, or a
customer/seller with none yet, works as before.

**mxid fallback.** The hosted checkout (and the create-on-miss paths of
`/link` and the reputation event) resolve a member by `blackout_user_id`, then
by `metadata.mxid`. An mxid match already linked to another member is never
re-stamped: it is treated as no match (logged once), and the create-on-miss
path gives this member their own customer. An mxid match with no Blackout id,
or this member's, is linked as before. When several customers share an mxid,
the lookup (checkout and `/link` alike) is ordered: a customer carrying this
member's id or none first, then the lowest id — never whichever row the
database returns. Together with the per-row check above, a customer re-linked
by mistake never exposes another member's rows or the customer's storefront
purchases on this page.

**These keys are server-owned.** The guard trusts `customer.metadata.mxid`
and `customer.metadata.blackout_user_id` as written by FBM. Medusa's store
API accepts free-form customer `metadata`, so `POST /store/customers` and
`POST /store/customers/me` now refuse (`400 invalid_data`, nothing written) a
body whose `metadata` names `blackout_user_id`, `mxid` or `mxid_source`, with
any value. Before that refusal a storefront customer could plant another
person's mxid on their own customer, and the mxid fallback would adopt it for
that person's checkout — after which the purchase is that customer's on
`/store/subscriptions` (this page still never lists it: the row carries the
buyer's stamp, not the customer's). Values written that way before the
refusal shipped are not detected by the guard, and an email-derived
(`mxid_source: "derived"`) mxid is not proof of the Matrix account either;
the guard does not close cross-user adoption on its own.

**FBM-side go-live steps** (joint with Blackout's MONETIZATION_GO_LIVE):
price + publish the Canopy plan listings seeded as drafts
(`canopy_plan_code` metadata), set `STRIPE_API_KEY` +
`STRIPE_PUBLISHABLE_KEY`, flip `FBM_SUBSCRIPTION_RENEWAL_LIVE=1` together
with Blackout's monetization gates, and verify during acceptance (with
`BLACKOUT_BETA_UNLOCK_ALL` off) that the first checkout attaches a reusable
payment method in the Stripe dashboard — off-session renewals depend on it.
