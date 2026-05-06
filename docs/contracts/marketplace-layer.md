# BMC Marketplace Layer — API Contracts

This document is the canonical reference for the FreeBlackMarket APIs that power
the BMC marketplace layer (transactions, monetization, entitlements, group
commerce, plugin/theme listings, and the Blackout / Blackstar sibling
integrations).

All endpoints below are **additive** — they extend the existing FreeBlackMarket
API without breaking the established `store`, `vendor`, and `admin` shapes.

## Conventions

- **Path conventions**:
  - `/store/...` — public storefront endpoints (publishable key + optional
    customer JWT)
  - `/vendor/...` — vendor-panel endpoints (seller JWT)
  - `/admin/...` — admin / operator endpoints (admin JWT)
  - `/v1/integrations/<sibling>/...` — sibling-integration endpoints
    (Blackout, Blackstar). Each sibling's auth scheme is documented per
    endpoint below.
- **Error format**: `{ "message": string }` with the appropriate 4xx/5xx
  status. OAuth-style errors use `{ error, error_description }`.
- **Idempotency**: where stated, repeated requests return the same row /
  status without side-effects.

---

## Store routes

### `POST /store/carts/:id/attribution`

Stamp affiliate attribution onto a cart. The storefront writes the
`_fbm_aff` cookie (set by middleware on `?fbm_ref=`) into the cart so it
propagates to the order at completion. Idempotent.

Request:
```json
{
  "ref_code": "fbm_ab12cd34",
  "visitor_token": "vis_xxx"
}
```
Response: `{ cart_id, attribution: { fbm_short_code, fbm_aff_link_id, fbm_visitor_token? } }`

### `POST /store/carts/:id/group`

Attach a cart to a cooperative / collective-campaign / community for
group-commerce attribution. Idempotent.

Request:
```json
{
  "cooperative_id": "coop_abc",
  "collective_campaign_id": "cmp_xyz",
  "community_id": "comm_qrs"
}
```
Response: `{ cart_id, group: { fbm_cooperative_id, fbm_collective_campaign_id, fbm_community_id } }`

### `GET /store/customers/me/entitlements?active_only=true`

Authenticated customer self-lookup of entitlements they hold. Pass
`active_only=false` to include expired/revoked rows.

Response: `{ entitlements: Entitlement[] }`

---

## Vendor routes

### `PUT /vendor/products/:id/archetype`

Assign an archetype to a vendor's product. Vendor must own the product.

Request: `{ "code": "ACCESS_PASS" }`
Response: `{ assignment, archetype }`

Valid codes: `AGRICULTURAL_RAW | AGRICULTURAL_PROCESSED | RESTAURANT_PREPARED | NON_PERISHABLE | DIGITAL | TICKET | SUBSCRIPTION | LAND_ACCESS | MUTUAL_AID | CIRCULAR_ECONOMY | COMMUNITY_SERVICE | EXPERIMENTAL | SERVICE | PLUGIN | THEME | EMOJI_PACK | ACCESS_PASS`

### `GET /vendor/products/:id/archetype`

Returns the assigned archetype (or `null`).

### `GET /vendor/affiliate-links` &nbsp;·&nbsp; `POST /vendor/affiliate-links`

List and create affiliate links scoped to the authenticated seller.

Create body:
```json
{
  "product_id": "prod_xxx",
  "collection_id": "pcol_xxx",
  "destination_path": "/products/foo",
  "utm_medium": "instagram",
  "utm_campaign": "spring",
  "utm_content": "story",
  "vendor_id": "sel_vendor",
  "deal_id": "deal_xxx",
  "program_id": "prog_xxx",
  "metadata": { }
}
```
All fields optional. Returns `{ link }`.

### `GET|PATCH|DELETE /vendor/affiliate-links/:id`

Get / update / soft-revoke an affiliate link. DELETE is a soft revoke that
preserves historical attribution; the row's `status` becomes `revoked`.

### `GET|POST /vendor/entitlement-rules`

List or create grant rules — declarations that purchasing a given
product (or variant) grants an entitlement with a specific feature key.

Create body:
```json
{
  "product_id": "prod_abc",
  "variant_id": "variant_def",
  "feature_key": "blackout.creator_tools",
  "kind": "access_pass",
  "duration_days": 30,
  "enabled": true
}
```

### `GET /vendor/onboarding`

Sprint A wizard state for the authenticated seller. Auto-creates the row
on first call.

Response: `{ state: OnboardingState }`

### `PATCH /vendor/onboarding`

Advance the wizard step (autosave). Idempotent per step.

Request:
```json
{
  "step": "step_2",
  "selling_type": "physical",
  "payout_deferred_until_first_sale": true
}
```

Valid steps: `signup | step_1 | step_2 | step_3 | step_4 | published`
Valid selling types: `physical | digital | service | event_class`

### `POST /vendor/onboarding/publish`

Step 4 publish. Marks the listing as the seller's first published
listing, flips `wizard_step` to `published`, emits
`vendor.onboarding.first_listing_published` for analytics + 48h
follow-up automation.

Request: `{ "listing_id": "prod_xxx" }`
Response: `{ state }`

### `POST /vendor/onboarding/import-csv`

Sprint B v1 CSV import preview. Parses + validates rows and returns the
mapped preview alongside any per-row errors. Does not yet create
products — wire-up entry for the wizard's "Already selling elsewhere?"
flow.

Request: `{ "csv": "<csv text>", "mapping": { "title": "title", "price": "price" } }`
Response: `{ headers, row_count, preview, errors }`

---

## Admin routes

### `GET|POST /admin/entitlements`

List / manually grant entitlements. POST defaults `source` to `manual`.

Filter query keys for GET: `customer_id`, `customer_external_id`,
`feature_key`, `status`, `kind`, `source_order_id`, `source_subscription_id`.

### `GET|PATCH|DELETE /admin/entitlements/:id`

Read, update (status / expires_at / metadata), or revoke (`DELETE
?reason=…`). DELETE is a soft revoke.

### `PUT /admin/products/:id/archetype`

Operator override for product archetype. Same body as the vendor route.

### `GET /admin/onboarding/funnel`

Sprint A G3 funnel report — counts of onboarding states grouped by
`wizard_step`.

Response: `{ counts: Record<wizard_step, number> }`

---

## Sibling integration routes

### `POST /v1/integrations/blackout/oauth/token`

OAuth 2.0 client_credentials grant. Returns a short-lived JWT (HS256,
`iss=fbm`, `aud=blackout`) bound to the supplied client.

Auth: env-configured `BLACKOUT_CLIENT_ID` + `BLACKOUT_CLIENT_SECRET`
(reused from the existing Blackout integration scaffold).

Behavior: returns 503 when `FBM_BLACKOUT_INTEGRATION!=1`.

Request body or query: `client_id`, `client_secret`, optional
`grant_type=client_credentials`.

Response: `{ access_token, token_type: "Bearer", expires_in }`

### `GET /v1/integrations/blackout/entitlements`

Blackout-side entitlement verification.

Auth: `Authorization: Bearer <jwt>` from the OAuth token endpoint above.

Behavior: returns 503 when `FBM_BLACKOUT_INTEGRATION!=1`.

Query params (one of customer_id / customer_external_id required):
`customer_id`, `customer_external_id`, `feature_key` (required).

Response: `{ entitled: boolean, entitlements: Entitlement[] }`

### `POST /v1/integrations/blackstar/shipments`

Inbound webhook for Blackstar shipment status updates. Persists / merges
`fulfillment_node_id`, `pickup_point_id`, `vending_machine_id` and
`external_status` into BlackstarShipment keyed by `order_id`.

Auth: header `x-fbm-integration-key` must equal `FBM_BLACKSTAR_API_KEY`.

Behavior: returns 503 when `FBM_BLACKSTAR_INTEGRATION!=1`.

Request body:
```json
{
  "order_id": "order_xxx",
  "fulfillment_id": "ful_xxx",
  "fulfillment_node_id": "node_abc",
  "pickup_point_id": "pp_def",
  "vending_machine_id": "vm_ghi",
  "external_status": "ready_for_pickup",
  "metadata": { }
}
```

Response: `{ shipment }`

---

## Outbound webhook events

These events are dispatched via the existing `marketplace-webhooks`
service so subscribers (Blackout, vendor automations, ops tools) can
react asynchronously.

| Event | Trigger | Payload (key fields) |
| --- | --- | --- |
| `creator.commission.earned` | `order.placed` (with affiliate attribution) | `attribution_id`, `order_id`, `creator_seller_id`, `commission_amount_cents`, `commission_status` |
| `creator.commission.reversed` | `order.canceled` / `order.refund_created` | `attribution_id`, `order_id`, `commission_amount_cents`, `reason` |
| `digital_delivery.ready` | `digital_product_order.created` | `digital_product_order_id`, `order_id`, `customer_id`, `products`, `entitlement_ids` |
| `vendor.onboarding.followup_scheduled` | `vendor.onboarding.first_listing_published` | `seller_id`, `listing_id`, `branch` |

---

## Schema reference

### `Entitlement`

```ts
{
  id: string
  customer_id: string | null
  customer_external_id: string | null
  product_id: string | null
  variant_id: string | null
  kind: "digital" | "access_pass" | "plugin" | "theme" | "emoji_pack" | "service" | "other"
  feature_key: string
  status: "active" | "pending" | "expired" | "revoked"
  source: "order" | "subscription" | "manual" | "external"
  source_order_id: string | null
  source_subscription_id: string | null
  granted_at: Date
  expires_at: Date | null
  revoked_at: Date | null
  revoked_reason: string | null
  metadata: Record<string, unknown> | null
}
```

### `OnboardingState` (Sprint A fields)

```ts
{
  id: string
  organization_id: string
  storefront_id: string
  seller_id: string | null
  selling_type: "physical" | "digital" | "service" | "event_class" | null
  wizard_step: "signup" | "step_1" | "step_2" | "step_3" | "step_4" | "published"
  wizard_step_completed_at: Record<string, string> | null   // ISO timestamps per step
  wizard_started_at: Date | null
  first_listing_created: boolean
  first_published_listing_id: string | null
  first_published_at: Date | null
  payout_configured: boolean
  payout_deferred_until_first_sale: boolean
  first_order_simulated: boolean
  metadata: Record<string, unknown> | null
}
```

### `BlackstarShipment`

```ts
{
  id: string
  order_id: string
  fulfillment_id: string | null
  fulfillment_node_id: string | null
  pickup_point_id: string | null
  vending_machine_id: string | null
  external_status: string | null
  metadata: Record<string, unknown> | null
}
```
