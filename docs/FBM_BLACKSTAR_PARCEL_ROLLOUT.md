# Parcel identity across FBM and Blackstar

Implementation slice of the approved cost-reduction plan: reuse the existing delivery network and retail tools rather than build replacement services. Enhancement purchases remain one-time purchases; this change introduces no subscription, new payment custody, pricing change, or forced dispatch.

## Behavior

- An FBM fulfillment can have its own Blackstar board listing, identified by `source_order_ref` plus `source_fulfillment_ref`.
- Blackstar echoes both refs on claimed/status/bid-award and relay events. Leg completion still does not mean the whole listing was delivered.
- FBM updates only the identified parcel. Existing replay and out-of-order status guards remain in place.
- `fulfillment.cancelled` requires both refs, cancels only the matching transport job, and uses a stable outbound event id. `order.cancelled` cancels all live jobs for the order.
- A processed cancellation received before selection prevents the delayed selection from reopening that parcel. Existing delivered/disputed jobs are not rewritten by cancellation.
- Legacy order-only events remain valid for a single local shipment. With several local rows, FBM records `ambiguous_shipment` and changes none; an operator must reconcile using the actual parcel identities. This is an intentional correction to the previous order-wide write.

## Rollout

1. Keep `FBM_BLACKSTAR_FULFILLMENT_REFS=0` during deployment. Deploy Blackstar and apply `2026_11_12_000100_add_fulfillment_ref_to_shipment_board_listings.php` before enabling new FBM events.
2. Apply FBM migration `Migration20261112000100AllowAmbiguousShipmentOutcome` before deploying its new receiver. It adds an outcome to the receipt check constraint. Rollback preserves the original outcome in metadata.
3. Drain or explicitly reconcile active legacy order-only Blackstar jobs and pending bridge deliveries. Do not replay old selection events with new identities: that could create another job beside an active legacy listing. The migration deliberately does not guess which fulfillment an old listing represents.
4. Deploy FBM and set `FBM_BLACKSTAR_FULFILLMENT_REFS=1` for new fulfillments. Keep existing bridge signing secrets/credentials and `FBM_BLACKSTAR_INTEGRATION` configuration.
5. In staging, create two fulfillments on one order. Claim them voluntarily. Deliver one and verify the sibling stays pending; cancel the sibling and verify only its listing is cancelled. Retry signed events and test a relay before considering production rollout complete.

Do not downgrade Blackstar while parcel-scoped jobs remain active. Turning the outbound flag off does not convert in-flight parcel jobs back into order-only jobs. Keep both receivers and their migrations until jobs and queued deliveries drain.

## Verification and remaining work

FBM regression tests exercise the real service with persistence fakes, the receiver, subscriber, and signed outbound queue. The new Blackstar feature tests cover separate listings, replay, parcel versus order cancellation, cancellation before selection, malformed refs, and refs on relay/listing events. Runtime verification and limitations are recorded in the paired PRs; test source alone is not a passing run.

This is one completed code slice, not the entire product roadmap. Still required: staging end-to-end delivery, coordinator identity/award permissions for service-owned bid jobs, authenticated member-facing relay presentation, and transactional concurrency tests for claims/status writes. No public map gets shipment addresses or proof payloads.

Retail POS is already in `POST /vendor/pos/orders`, the POS order workflow, inventory adjustment, and vendor POS page. `/vendor/pos/checkout` is a different vendor payment flow. Finish verified gaps in those tools before adding OSS replacements. Blackout Coalition remains the map/coordination owner; Blackstar remains the transport owner.
