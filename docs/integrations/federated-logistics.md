# Federated logistics — the FBM ↔ Blackstar event contract

Partner-facing specification for the federated delivery network bridge:
how an order on FreeBlackMarket becomes a claimable shipment on a
logistics-protocol deployment (Blackstar), and how shipment lifecycle
updates flow back. Contract v1.

- **FBM half:** `free-black-market` — emitters, receiver, and this spec.
- **Logistics half:** `blackstar` — shipment board, claim flow, and the
  canonical contract file at `api/docs/events/freeblackmarket-contract.md`.
  The two documents pin the same contract; the Blackstar file is the
  wire-format source of truth, this one adds the FBM-side operational view.
- **Default posture:** dark. FBM ships with `FBM_BLACKSTAR_INTEGRATION=0`;
  nothing is emitted or accepted until both deployments are paired (§4).

## 1. Shape of the seam

Two deployments exchange signed webhooks over HTTPS. There is exactly one
protocol on the seam: every request in either direction carries a unix
timestamp and an HMAC-SHA256 signature over `"{timestamp}.{raw_body}"`,
verified with a constant-time compare inside a bounded replay window.
There are no API keys, no shared sessions, and no unauthenticated paths;
an unconfigured secret disables the direction (503 / dead-letter) rather
than weakening it.

```
FreeBlackMarket (commerce)                Blackstar (logistics protocol)
--------------------------                ------------------------------
order.created            ──────────────▶  pre-validation hook
delivery.option.selected ──────────────▶  shipment listing (idempotent)
order.cancelled          ──────────────▶  listing cancelled

BlackstarShipment status ◀──────────────  shipment.claimed / in_transit /
  (per order)                             delivered / disputed / cancelled
```

## 2. Endpoints

| Direction | Request | Events |
| --- | --- | --- |
| FBM → Blackstar | `POST {BLACKSTAR_API_BASE}/api/webhooks/freeblackmarket` | `order.created`, `delivery.option.selected`, `order.cancelled` |
| Blackstar → FBM | `POST {FBM_API_BASE}/v1/integrations/blackstar/events` | `shipment.claimed`, `shipment.in_transit`, `shipment.delivered`, `shipment.disputed`, `shipment.cancelled` |

Both receivers return 503 when their direction is unconfigured or the
integration flag is off, and 401 for any signature or timestamp failure.

## 3. Authentication (identical both directions)

Request headers:

- `X-FBM-Timestamp` — unix **seconds** at signing time, digits only.
  Computed fresh for every delivery attempt, including retries; a retry is
  a new signature, never a replayed one.
- `X-FBM-Signature` — lowercase hex of
  `HMAC_SHA256(secret, "{X-FBM-Timestamp}.{raw_request_body}")`.
  The signature covers the exact serialized envelope, so no field —
  including `event_type` and `correlation_id` — is tamperable.
- `X-FBM-Key-ID` — optional in contract v1: names the per-partner machine
  credential that signed the request (§4a). When present, the receiver
  verifies with that credential's secret; an unknown or revoked key id
  answers exactly like a bad signature.
- `X-Correlation-ID` — optional; propagated for tracing (§8).

Receiver rules, both sides:

- Verify with a constant-time compare (`timingSafeEqual` / `hash_equals`);
  length mismatches are an ordinary 401, never an exception.
- Reject timestamps that are missing, non-`^\d+$`, or outside the replay
  tolerance window: **300 seconds** by default, configurable via
  `BLACKSTAR_SIGNATURE_TOLERANCE_SECONDS` (FBM) /
  `FBM_SIGNATURE_TOLERANCE_SECONDS` (Blackstar).
- If the verifying secret is unset, return 503. An empty key is a
  disabled integration, not a passing one.

Producing a valid signature from a shell, for smoke tests:

```bash
TS=$(date +%s)
BODY='{"event_type":"shipment.delivered","correlation_id":"ord_123","payload":{"shipment_listing_id":"11111111-1111-1111-1111-111111111111","source_order_ref":"ord_123","claimed_by_node_id":null,"status":"delivered"}}'
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$BLACKSTAR_OUTBOUND_SECRET" -r | cut -d' ' -f1)
curl -sS -X POST "$FBM_API_BASE/v1/integrations/blackstar/events" \
  -H "Content-Type: application/json" \
  -H "X-FBM-Timestamp: $TS" -H "X-FBM-Signature: $SIG" \
  -d "$BODY"
```

## 4. Pairing two deployments

Four secrets across the two sides — two independent values, each set in
both places. Never reuse one value for both directions.

| Purpose | FBM env var | Blackstar env var |
| --- | --- | --- |
| FBM → Blackstar signing | `BLACKSTAR_WEBHOOK_SECRET` | `FBM_WEBHOOK_SECRET` |
| Blackstar → FBM signing | `BLACKSTAR_OUTBOUND_SECRET` | `FBM_OUTBOUND_SECRET` |

FBM additionally needs:

- `FBM_BLACKSTAR_INTEGRATION=1` — registers the `blackstar` fulfillment
  provider and enables the events receiver.
- `BLACKSTAR_API_BASE` — where outbound deliveries are posted.

The FBM outbound channel silently no-ops (emits nothing, queues nothing)
unless both `BLACKSTAR_WEBHOOK_SECRET` and `BLACKSTAR_API_BASE` are set.
The legacy `FBM_BLACKSTAR_API_KEY` static key is retired; drop it.

### 4a. Per-partner machine credentials

The global secrets above are the migration path, not the destination. Each
side can issue per-partner credentials and verify by `X-FBM-Key-ID`:

- **Blackstar issues FBM's credential** with
  `php artisan fbm:credential issue --label="FBM production"` (stored in its
  `node_credentials` table); FBM announces the issued key id via
  `BLACKSTAR_EMIT_KEY_ID`.
- **FBM issues Blackstar's credential** with
  `pnpm medusa exec ./src/scripts/blackstar-bridge-credential.ts issue
  "Blackstar production"` (stored encrypted under `BRIDGE_CREDENTIAL_KEY`);
  Blackstar announces its key id via `FBM_OUTBOUND_KEY_ID`.

Secrets print exactly once at issue time and are encrypted at rest — there
is no read-back path; re-issue instead. Rotation is overlap-based on both
sides: `rotate` issues a new credential while the old one keeps verifying
until explicitly revoked, so senders switch on their own schedule with no
flag day. Once every sender carries a key id, flip the receiver's require
flag (`FBM_REQUIRE_KEY_ID` on Blackstar, `BLACKSTAR_REQUIRE_KEY_ID` on FBM)
— the global secret for that direction is then never consulted again.

## 5. Envelopes

FBM → Blackstar. `event_id` is **required** and globally unique; Blackstar
persists receipts by `event_id` and replays return 202 with no side
effects:

```json
{
  "event_id": "blackstar:delivery.option.selected:{order_id}:{fulfillment_id}",
  "event_type": "delivery.option.selected",
  "correlation_id": "{order_id}",
  "payload": { "...": "event specific, see §6" }
}
```

Blackstar → FBM. `event_id` is the outbound event record's uuid — stable
across retries (retries re-sign with a fresh timestamp but keep the same
id), so receivers can deduplicate at the receipt level:

```json
{
  "event_id": "uuid (outbound event id, stable across retries)",
  "event_type": "shipment.claimed",
  "correlation_id": "ord_123",
  "payload": {
    "shipment_listing_id": "uuid",
    "source_order_ref": "ord_123",
    "claimed_by_node_id": "uuid or null",
    "status": "string"
  }
}
```

## 6. Event semantics

### FBM → Blackstar

| Event | FBM emits when | Blackstar effect |
| --- | --- | --- |
| `order.created` | An order is placed whose shipping method resolves to the Blackstar provider | Idempotent pre-validation hook; creates nothing by itself |
| `delivery.option.selected` | A fulfillment is created on the `blackstar` provider | Creates the shipment board listing, idempotently keyed by `payload.source_order_ref` |
| `order.cancelled` | An order is cancelled **and** a `BlackstarShipment` exists for it | Cancels the listing when its status is `open`, `claimed`, or `in_transit` |

`delivery.option.selected` payload:

```json
{
  "delivery_option": "federated_delivery_network",
  "source_order_ref": "{order_id}",
  "claim_policy": "first_claim",
  "job_type": "delivery",
  "fulfillment_node_id": "string or null",
  "pickup_point_id": "string or null",
  "vending_machine_id": "string or null"
}
```

The FBM emitter refuses event types outside this table at the call site —
the contract cannot drift silently from FBM's side.

### Blackstar → FBM

Each accepted event overwrites the matching shipment's status
(`BlackstarShipment.external_status`, matched by
`payload.source_order_ref` — required, 400 without it):

| Event | `external_status` |
| --- | --- |
| `shipment.claimed` | `claimed` |
| `shipment.in_transit` | `in_transit` |
| `shipment.delivered` | `delivered` |
| `shipment.disputed` | `disputed` |
| `shipment.cancelled` | `cancelled` |

`claimed_by_node_id` is stored as the shipment's fulfillment node;
`shipment_listing_id`, the reported `status`, and the last event type/id
are kept in shipment metadata. Unknown `event_type` values are
acknowledged with 202 `{"status":"ignored"}` — a newer Blackstar may add
lifecycle events without dead-lettering against an older FBM. Additive
evolution only; there is no envelope version field.

## 7. Delivery guarantees

Both directions are **at-least-once**. Consumers must tolerate duplicates.

- **FBM outbound queue** — deliveries are persisted rows, deduplicated at
  enqueue by `event_id`. A failed attempt schedules a retry after 1, then
  5, then 30 minutes; after 4 total attempts the delivery is terminally
  `failed`. Each attempt re-signs with a fresh timestamp.
- **Blackstar outbound dispatcher** — `pending → dispatched` or
  `failed → dead_letter`, linear backoff (`FBM_RETRY_BACKOFF_SECONDS ×
  attempts`) up to `FBM_MAX_RETRIES`. Fails closed (never unsigned) if
  `FBM_OUTBOUND_SECRET` is unset.
- **Blackstar inbound** — receipt table keyed by unique `event_id`;
  replayed events return 202 with no side effects.
- **FBM inbound** — idempotent by construction: applying the same event
  twice rewrites the same state. There is no receipt table on this side
  yet; the last-processed `event_id` is kept in shipment metadata (§9).

## 8. Correlation and ordering

Correlation ID precedence on receipt: `X-Correlation-ID` header, then
`correlation_id` in the body, then a generated UUID. Both sides store it
on the event record and propagate it on anything emitted downstream. FBM
uses the order id as the correlation id for everything it originates.

Ordering is **not guaranteed**. There are no sequence numbers in contract
v1, and independent retries can deliver lifecycle events out of order; the
FBM receiver applies last-writer-wins to `external_status`. Downstream
consumers reconciling shipment state should treat `delivered` and
`disputed` as terminal rather than trusting the latest write blindly.

## 9. Open contract items

1. ~~**`created_by_user_id`**~~ — **closed.** Blackstar defaults the
   listing creator to its `FBM_SYSTEM_USER_ID` service account (fail-closed
   with an actionable dead-letter when unset); FBM still omits the field by
   contract.
2. ~~**Outbound `event_id`**~~ — **closed.** The Blackstar → FBM envelope
   now carries the outbound record's uuid, stable across retries (§5).
3. **Sequencing** — a monotonic per-shipment sequence number would close
   the ordering caveat in §8.
4. **FBM-side receipt table** — with outbound `event_id` in place, FBM can
   add receipt-level dedupe symmetric to Blackstar's
   `fbm_inbound_event_receipts`; today FBM relies on idempotent-by-
   construction handling plus the metadata stamp (§7).

## 10. Verifying an integration

- FBM unit specs (run in `backend/`):
  `src/modules/marketplace-webhooks/__tests__/blackstar-emit.unit.spec.ts`
  (envelope, idempotency, signing, retry) and
  `src/modules/blackstar-fulfillment/__tests__/verify-blackstar-signature.unit.spec.ts`
  (verifier edge cases, status map).
- Blackstar: `php artisan test` covers the webhook controller (timestamped
  verify, replay rejection) and the outbound publisher (exact-body
  signing per attempt).
- End to end: pair the secrets per §4 on staging, place an order with a
  Blackstar shipping option, and watch the listing appear; then drive the
  shipment lifecycle from Blackstar and watch `external_status` advance.
  The §3 shell snippet exercises the FBM receiver without a Blackstar.
