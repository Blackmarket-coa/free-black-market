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


### Sink Adapter Configuration
- Configure metric sink endpoint via `OBSERVABILITY_METRIC_SINK_URL` (optional bearer token: `OBSERVABILITY_METRIC_SINK_API_KEY`).
- Configure incident sink endpoint via `OBSERVABILITY_INCIDENT_SINK_URL` (optional bearer token: `OBSERVABILITY_INCIDENT_SINK_API_KEY`).
- Subscriber adapters:
  - `observability.metric.recorded` -> metric sink (Datadog/Grafana bridge).
  - `observability.incident.triggered` -> incident sink (PagerDuty Events v2 bridge).

### Retry Execution Contract
- `prediction.payout.processing_failed` now schedules delayed retries and emits `prediction.payout.retry_scheduled`.
- Queue topic contract: `prediction.payout.retry.execute.v1` with 60s backoff and 2 retries.
- Retry worker subscriber consumes `prediction.payout.retry.execute` and emits either:
  - `prediction.payout.retry_succeeded`
  - or `prediction.payout.processing_failed` (for another retry / eventual DLQ).


### Staging End-to-End Verification (Real Sinks)
1. Set sink endpoints in staging:
   - `OBSERVABILITY_METRIC_SINK_URL`, `OBSERVABILITY_METRIC_SINK_API_KEY`
   - `OBSERVABILITY_INCIDENT_SINK_URL`, `OBSERVABILITY_INCIDENT_SINK_API_KEY`
2. Trigger a controlled payout-processing success and verify Datadog/Grafana receives `prediction.payout.processed` metrics payload.
3. Trigger controlled repeated payout failure until dead-letter and verify PagerDuty incident event is created with dedup key: `prediction-payout-<settlement_ref>`.
4. Confirm retries are scheduled via `prediction.payout.retry_scheduled` and consumed by `prediction.payout.retry.execute`.
5. Capture request/response payload samples and attach to on-call runbook evidence.
