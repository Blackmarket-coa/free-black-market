# Vendor Hype Prediction Operations Runbook

## Scope
This runbook covers:
- Oracle key rotation lifecycle
- Settlement failure observability
- Payout processing status transitions (`computed` -> `credited` / `failed`)

## Event Flow
1. `prediction.settlement.requested`
2. `prediction.settlement.finalized` OR `prediction.settlement.rejected`
3. `prediction.payout.processed` OR `prediction.payout.processing_failed`

## Alerts and On-Call Signals

### P1: Oracle replay / signature failures spike
Trigger when either event exceeds threshold (example: >5 in 10 minutes):
- `prediction.settlement.rejected` with reason:
  - `oracle_replay_detected_nonce_already_used`
  - `signature_invalid`
  - `oracle_signature_invalid`

Immediate actions:
1. Confirm active key list and rotation state.
2. Check whether the same nonce is repeatedly submitted.
3. Validate oracle producer timestamp/expiry drift.

### P1: Settlement processing failures
Trigger on:
- `prediction.settlement.rejected` with operational errors (e.g. `dispute_window_open_settlement_not_allowed`, persistence failures)

Immediate actions:
1. Verify market state is `IN_REVIEW` before settlement attempt.
2. Verify dispute window policy and event payload timestamps.
3. Check DB write-path health for settlement + payout entry creation.

### P2: Payout processing failures
Trigger on:
- `prediction.payout.processing_failed`

Immediate actions:
1. Confirm settlement exists and is finalized.
2. Re-run payout processor using a new `execution_run_id`.
3. Inspect payout metadata audit trail for prior run details.

## Oracle Key Rotation SOP
1. Create new key via admin oracle-key endpoint.
2. Rotate from old to new key using rotation endpoint.
3. Keep old key in retiring state during downstream propagation window.
4. Monitor rejection rates for signature/key mismatch.
5. Retire old key only after a stable observation period.

## Payout Processing SOP
1. Settlement writes payout entries as `computed` (or `failed` if invalid).
2. Downstream payout processor transitions `computed` entries to terminal states:
   - `credited`: valid winner payout with positive amount
   - `failed`: non-winner or non-positive payout amount
3. Each transition records audit metadata:
   - `execution_run_id`
   - `processed_by`
   - `processed_at`

## Dashboards (recommended)
- Rejections by reason over time
- Finalized settlements per hour
- Payout transitions: computed/credited/failed counts
- Replay detection events by key_id and nonce prefix

## Escalation Matrix
- Security anomalies (replay/signature tampering): Security + Platform on-call
- Settlement processing failures: Backend + Data on-call
- Payout processing failures: Backend + Finance operations

## Centralized Metrics & Alerting Wiring
- Subscriber `prediction-payout-processed` emits `observability.metric.recorded` for Datadog/Grafana ingestion.
- Subscriber `prediction-payout-processing-failed` emits:
  - `observability.metric.recorded`
  - `observability.incident.triggered` (PagerDuty high severity when retries are exhausted)
- Recommended threshold policy (from this runbook):
  - `prediction.payout.processing_failed` > 5 in 10 minutes -> page on-call
  - Any `prediction.payout.dead_lettered` -> immediate page

## Retry and Dead-Letter Policy
- Failed payout processing attempts are retried up to `MAX_RETRY_ATTEMPTS=2`.
- On retry success, emit `prediction.payout.retry_succeeded`.
- On retry exhaustion or unrecoverable error, emit `prediction.payout.dead_lettered` and trigger incident event.

## Audit Query Endpoint
- Admin audit endpoint: `GET /admin/vendor-hype/payouts/audit?execution_run_id=<id>`
- Response includes summary counts and payout rows for the requested run id.
