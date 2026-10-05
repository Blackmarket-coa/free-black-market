# Black Mask provisioning webhook: wire contract (v1)

FBM sends a signed HTTP POST to the Black Mask provisioning service whenever a
Black Mask vault order or subscription changes state. This document is the
contract both sides build against. The sender is
`backend/src/modules/marketplace-webhooks/black-mask.ts` (pure contract code)
and `MarketplaceWebhooksService` (enqueue, claim, send). If you change one,
change this file in the same PR.

Status: the code is shipped **dark**. Nothing is enqueued or sent unless
`FF_BLACK_MASK_PROVISIONING_V1=true` **and** all four of
`BLACK_MASK_PROVISIONING_URL`, `BLACK_MASK_WEBHOOK_SECRET`,
`BLACK_MASK_WEBHOOK_KEY_ID` and `BLACK_MASK_SELLER_ID` are set. None of them is
set anywhere in the repo. Legal checkpoint L28 (the vault licence) gates the
paid launch this channel serves. This document does not resolve it.

## 1. Which orders are vault orders

An order line is a vault line only when **both** of these hold:

1. The product's seller is `BLACK_MASK_SELLER_ID`. FBM reads the seller from
   the Mercur seller-to-product link.
2. The product's own metadata has `black_mask_plan`, a plan code matching
   `^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$`.

FBM never reads line-item, cart or order metadata for this check, because the
store API lets the customer write those fields. A subscription is a vault
subscription when its `product_id` passes the same test.

## 2. Events

| `event`          | FBM trigger                                                            | `subject.type` | `sequence` comes from                                     |
|------------------|------------------------------------------------------------------------|----------------|-----------------------------------------------------------|
| `placed`         | `order.placed`, **first order of a subscription only** (see below)     | `order`        | `order.created_at`                                        |
| `cancelled`      | `order.canceled`                                                       | `order`        | `order.canceled_at`                                       |
| `renewed`        | `subscription.renewal_processed`, **live renewals only** (event carries `order_id`) | `subscription` | the renewal order's `created_at`                          |
| `cancelled`      | `subscription.canceled` (emitted by `manageSubscriptionWorkflow` only on a cancel that ended the subscription, only while the flag is on; a cancel that starts grace sends `grace_started`, then `read_only`, instead) | `subscription` | `subscription.canceled_at`                                |
| `payment_failed` | `subscription.payment_failed`                                          | `subscription` | `subscription.metadata.dunning_last_attempt_at`           |
| `grace_started`  | `subscription.grace_started` (emitted by the grace slice)              | `subscription` | the event's `occurred_at` (required)                      |
| `read_only`      | `subscription.read_only` (emitted by the grace slice)                  | `subscription` | the event's `occurred_at` (required)                      |

A renewal processed without a charge (legacy mode,
`FBM_SUBSCRIPTION_RENEWAL_LIVE` unset) has no `order_id`, so FBM does not send
`renewed` for it. If FBM did, a vault would be extended for free.

**Renewal orders never produce `placed`.** In live mode each renewal order is
created by Medusa's cart completion, which emits `order.placed` like any
checkout. FBM reads the subscription-to-order link (never cart, order or line
metadata) and, when the order's subscription already has an earlier linked
order, skips it: the same renewal arrives as `renewed` on the subscription
subject. So `placed`, the only event that carries `customer_email`, is sent
once per vault, for the order that started it. If the link cannot be read,
FBM sends nothing for that `order.placed` rather than risk announcing a
renewal as a new vault (see §10, reconciliation).

**Sequences come only from stable timestamps.** FBM never falls back to a
record's `updated_at`, which moves on any later write: a redelivered Medusa
event would then compute a new `event_id` and enqueue a duplicate. An event
without its source timestamp is not sent: an `order.canceled` with no
`canceled_at` (Medusa's cancel always sets it), or a `grace_started` /
`read_only` event that does not carry `occurred_at`. The grace slice
(`grace-lifecycle.ts`) puts the transition time on both events as
`occurred_at`, read from the row (`metadata.grace_started_at`, `read_only_at`)
so a redelivered event carries the same value.

**A customer cancel under the grace lifecycle is not `cancelled`.** With
`FF_CONSUMER_SUBSCRIPTIONS_V1` on and a grace length configured, a cancel of a
paid subscription keeps access through the paid period plus grace: you receive
`grace_started` (keep the vault open), then `read_only` when grace ends. You
receive `cancelled` for a subscription only when it actually ended: grace off
or unconfigured, or a refund-driven cancel.

## 3. Payload

The request body is a JSON object. The `customer_email` field appears on
`placed` only.

```json
{
  "event": "renewed",
  "event_id": "bm:v1:subscription:sub_01J...:renewed:1769904000000",
  "sequence": 1769904000000,
  "occurred_at": "2026-02-01T00:00:00.000Z",
  "subject": { "type": "subscription", "id": "sub_01J..." },
  "customer_id": "cus_01J...",
  "plan": "vault_monthly",
  "seats": 1,
  "seller_id": "sel_01J...",
  "period_end": "2026-03-01T00:00:00.000Z",
  "order_id": "order_01J..."
}
```

| Field             | Type                     | Notes |
|-------------------|--------------------------|-------|
| `event`           | string                   | One of the events in §2. |
| `event_id`        | string                   | `bm:v1:{subject.type}:{subject.id}:{event}:{sequence}`. This is the idempotency key, and it equals `X-FBM-Event-Id`. |
| `sequence`        | integer                  | Epoch milliseconds of the record timestamp in §2. Later states of the same subject get larger numbers. |
| `occurred_at`     | string (ISO-8601)        | `sequence` as a date. |
| `subject`         | `{ type, id }`           | `type` is `order` or `subscription`. |
| `customer_id`     | string or null           | FBM customer id. |
| `plan`            | string                   | The product's `black_mask_plan`. |
| `seats`           | integer, at least 1      | Order events: the total quantity of the order's lines with that plan. Subscription events: `subscription.quantity`. |
| `seller_id`       | string                   | Always `BLACK_MASK_SELLER_ID`. |
| `period_end`      | string (ISO), optional   | Subscription events only: `next_order_date`, else `expiration_date`. |
| `subscription_id` | string, optional         | Order events only, read from the subscription-to-order link. On `placed` it is the subscription this order started (renewal orders never produce `placed`, §2). On an order's `cancelled` it is the subscription the order belongs to, which may be a renewal order you never saw as `placed`. Use it to tie later `renewed` / `cancelled` events to the vault provisioned on `placed`. |
| `order_id`        | string, optional         | `renewed` only: the renewal order. |
| `customer_email`  | string, optional         | **`placed` only.** See §4. |

The payload never contains amounts, names, addresses, phone numbers, a
Blackout identity or vault contents.

### 4. The email (data-minimisation decision, recorded for the operator)

- FBM sends the customer's email **only on `placed`**, so the receiver can
  send an invite. No other event carries it.
- FBM looks the email up **at send time** from the customer record. It is
  never written to the outbox row (`marketplace_webhook_delivery.payload`).
  The row holds `customer_id` only, and the operator view cannot show an email.
- FBM leaves the email out when it is a placeholder FBM created itself:
  `metadata.synthetic_email === true`, or any address under the reserved
  `.invalid` TLD. That covers Blackout-native customers
  (`blackout+<sub>@users.blackout.invalid`) and erased customers
  (`deleted-<id>@deleted.invalid`). In that case `placed` arrives without
  `customer_email`, and the receiver must fall back to a claim flow.
- If the customer lookup fails at send time, FBM retries the attempt (§7). It
  does not send `placed` without the address.

Another option is to send no email at all and rely on a claim link only. That
is an operator decision. Choosing it removes the lookup in
`attemptBlackMaskDelivery`. The rest of the contract stays the same.

## 5. Headers and signing

| Header            | Value |
|-------------------|-------|
| `Content-Type`    | `application/json` |
| `X-FBM-Timestamp` | Unix seconds when this attempt was made |
| `X-FBM-Signature` | lowercase hex `HMAC-SHA256(secret, "{X-FBM-Timestamp}.{raw_body}")` |
| `X-FBM-Key-Id`    | `BLACK_MASK_WEBHOOK_KEY_ID`, which names the secret used |
| `X-FBM-Event-Id`  | the payload's `event_id` |

FBM computes the signature fresh on **every attempt**, over the exact bytes it
sends. The recipe is the same as the Blackstar channel's.

### Worked example

```
secret     = bm_whsec_example_only
timestamp  = 1767225660
raw_body   = {"event":"placed","event_id":"bm:v1:order:order_01J:placed:1767225600000","sequence":1767225600000}
signed     = 1767225660.{"event":"placed","event_id":"bm:v1:order:order_01J:placed:1767225600000","sequence":1767225600000}
signature  = 5ad5686aa13fe3fe09b1f6c45a9d64581b6986c30324d448a318109804582b4a
```

To reproduce it:

```sh
printf '%s' '1767225660.{"event":"placed","event_id":"bm:v1:order:order_01J:placed:1767225600000","sequence":1767225600000}' \
  | openssl dgst -sha256 -hmac bm_whsec_example_only
```

A shorter vector: secret `bm_test_secret`, timestamp `1700000000`, body
`{"event":"placed"}` gives
`0a050026aea76ed365b98455a6659cb3f1c4ea203e102d0a413bd0f30b5eb718`.

The spec `black-mask-contract.unit.spec.ts` checks both vectors.

### Receiver duties

1. Read the **raw** body before any JSON parsing. Re-serialising the parsed
   JSON changes the bytes and breaks the signature.
2. Reject a request whose `X-FBM-Timestamp` is more than **300 seconds** away
   from your clock in either direction (+/-300s).
3. Recompute the signature with the secret named by `X-FBM-Key-Id`. Compare it
   in constant time. `verifyBlackMaskSignature` in `black-mask.ts` is the
   reference implementation.
4. Return 2xx only after you have durably recorded the event. Any other status
   means "retry".

## 6. Deduplication and ordering

- **Dedupe on `event_id`** (also sent as `X-FBM-Event-Id`). FBM sends at least
  once. A retry, an operator replay, or a crash after the receiver answered
  can all deliver the same `event_id` again. Treat a second delivery of one
  `event_id` as a no-op that still returns 2xx.
- FBM enqueues each `event_id` at most once. The id is unique in the outbox,
  and a duplicate Medusa event computes the same id.
- **Last sequence wins, per subject.** Retries can deliver events out of order.
  For each `(subject.type, subject.id)`, apply an event only when its
  `sequence` is greater than the last one you applied. Record older ones and
  otherwise ignore them. An order's `cancelled` always has a higher sequence
  than its `placed`.
- A `cancelled` for a subject you have never seen should be stored as a
  tombstone, so a late `placed` cannot provision it.

## 7. Delivery and retries

- A scheduled job (`drain-black-mask-provisioning`) runs every minute and sends
  due rows. It runs separately from the Blackout and Blackstar drain, so a slow
  Black Mask receiver cannot stall those channels.
- Before sending, FBM **claims** each row with one conditional `UPDATE ...
  WHERE id = ? AND status IN ('pending','failed') AND next_attempt_at <= ?
  RETURNING`. The claim counts the attempt and leases the row for 2 minutes.
  Two overlapping drains cannot both send the same row. A sender that crashes
  mid-attempt leaves the row free to claim again once the lease expires.
- Each attempt times out after **10 seconds**. A timeout counts as a failed
  attempt.
- The retry ladder is **8 attempts**. The gaps after failed attempts 1 to 7 are
  1 min, 5 min, 30 min, 2 h, 6 h, 12 h and 24 h, about 44.6 hours in total.
  After the 8th failure the row is `dead`.
- While the flag is off or the config is incomplete, rows stay `pending` and
  no attempt is used up.

## 8. Operator surface

Both routes are admin-authenticated and return 404 while the flag is off.

- `GET /admin/black-mask/deliveries[?status=pending|failed|dead|succeeded][&limit=N]`
  lists deliveries. The default filter is `dead` + `failed`. Each row includes
  the stored payload, the attempt count, and the last response code and
  excerpt (up to 500 chars). Rows never contain an email or a request body.
- `POST /admin/black-mask/deliveries/:id/replay` resets a **dead** row to
  `pending` with `attempt` 0, so it gets a fresh ladder. The next drain sends
  it with a new signature and, for `placed`, a freshly looked-up email. A row
  in any other state returns 409. A missing row returns 404. Replay is safe
  because the `event_id` is unchanged.

## 9. Secret rotation

`X-FBM-Key-Id` names the secret that signed the request. To rotate:

1. The receiver adds the new `(key id, secret)` pair and keeps accepting the
   old one.
2. FBM switches `BLACK_MASK_WEBHOOK_SECRET` and `BLACK_MASK_WEBHOOK_KEY_ID`
   together. Every later attempt is signed with the new pair, including
   retries of rows enqueued earlier, because signing happens at send time.
3. Once no row signed with the old key can still be retried (allow the ~45 h
   ladder), the receiver drops the old pair.

## 10. Not in this version

- No reconciliation sweep yet. An enqueue that fails inside the subscriber is
  logged and swallowed so checkout is not broken, and nothing re-derives it
  later.
- No deprovisioning notice when a vault subscription ends by **expiry** or by
  **renewal failure** (`expireSubscription` / `failSubscription` in
  `process-subscription-renewals`). Only an explicit cancel through
  `manageSubscriptionWorkflow` emits `subscription.canceled`. Until a
  follow-up emits and handles an expiry event, the receiver should also treat
  a subscription whose last `period_end` has passed with no later `renewed`
  as lapsed. This includes a seat whose customer withdrew auto-renew
  (`disable_auto_renew`, ledger BM-4): withdrawing sends nothing, and the seat
  then ends by expiry at the end of its paid period.
- The two-drain claim is proven against an in-memory pg fake that is atomic
  by construction (it pins the SQL text). A real-Postgres concurrency test
  (`test:integration:modules`) is still to be written.
- Erasure: the outbox payload carries `customer_id` in JSON, and
  `marketplace_webhook_delivery` has no `customer_id` column, so the
  customer-data registry does not cover these rows.
