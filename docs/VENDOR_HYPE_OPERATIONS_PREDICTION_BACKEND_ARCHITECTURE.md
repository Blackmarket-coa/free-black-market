# Vendor Hype + Operations Funding + Prediction
## Backend Architecture Design Notes (MedusaJS / TypeScript)

**Role perspective:** Principal Backend Engineer  
**Primary reference:** `docs/VENDOR_HYPE_OPERATIONS_PREDICTION_WHITEPAPER.md`  
**Secondary reference:** `docs/VENDOR_HYPE_OPERATIONS_PREDICTION_IMPLEMENTATION_PLAN.md`

---

## 1) Architecture Scope and Principles

### 1.1 Scope
This design extends the collective campaign stack to support:
- Hype profiles for vendors/organizers/organizations,
- Purpose-bound donation buckets and allocation rules,
- Prediction market lifecycle (non-cash in Phase B, cash-capable scaffolding),
- Settlement orchestration with oracle evidence,
- Compliance and auditability throughout all write paths.

### 1.2 Design Principles
1. **Deterministic finance and settlement records** (audit first).
2. **Mode- and jurisdiction-aware policy gating** at runtime.
3. **Idempotent command handling** for all external/event-driven writes.
4. **State machine enforcement** for market and disbursement lifecycles.
5. **Deny-by-default** on compliance dependencies (policy/oracle uncertainty).

---

## 2) Domain Model Design (Entities + Relationships)

### 2.1 New Modules
- `hype` module
- `ops_funding` module
- `prediction` module
- `compliance` module
- `audit` module (can be shared infra module)

### 2.2 Core Entities

#### Hype / Profile Layer
```ts
interface HypeProfile {
  id: string;
  profileType: "vendor" | "organizer" | "organization";
  ownerId: string; // vendor/org/account id
  slug: string;
  displayName: string;
  mission: string;
  storyMarkdown?: string;
  trustScore?: number; // materialized snapshot
  readinessScore?: number;
  capitalNeedAmount?: number;
  status: "draft" | "published" | "archived";
  publishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface HypeProfileMetricSnapshot {
  id: string;
  profileId: string;
  metricKey: string; // dispute_rate, on_time_rate, etc
  metricValue: string;
  sourceRef?: string;
  asOf: Date;
}

interface HypeMilestone {
  id: string;
  profileId: string;
  title: string;
  description?: string;
  targetDate?: Date;
  objectiveType: "shipment" | "preorder" | "distribution" | "custom";
  objectiveValue?: number;
  status: "planned" | "active" | "achieved" | "failed" | "cancelled";
  verificationSource?: string;
}
```

#### Operations Funding / Donation Layer
```ts
interface OpsFundingBucket {
  id: string;
  profileId: string;
  code: "ops_core" | "production_inputs" | "growth" | "reserve" | "custom";
  name: string;
  description?: string;
  isActive: boolean;
  displayOrder: number;
}

interface DonationPledge {
  id: string;
  profileId: string;
  supporterId: string;
  bucketId: string;
  amount: number;
  currencyCode: string;
  frequency: "one_time" | "recurring";
  recurrenceRule?: string;
  status: "initiated" | "authorized" | "captured" | "failed" | "cancelled";
  paymentRef?: string;
  idempotencyKey: string;
  createdAt: Date;
}

interface OpsAllocationRule {
  id: string;
  profileId: string;
  priorityOrder: number;
  fromSource: "donation" | "prediction_fee" | "investment" | "match";
  toBucketCode: string;
  allocationType: "percentage" | "fixed";
  allocationValue: number;
  effectiveFrom: Date;
  effectiveTo?: Date;
}

interface OpsAllocationEntry {
  id: string;
  pledgeId?: string;
  sourceType: "donation" | "prediction_fee" | "investment" | "match";
  sourceId: string;
  bucketId: string;
  allocatedAmount: number;
  currencyCode: string;
  allocationRunId: string;
  createdAt: Date;
}

interface OpsDisbursement {
  id: string;
  profileId: string;
  bucketId: string;
  requestedBy: string;
  approvedBy?: string;
  amount: number;
  currencyCode: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | "processing" | "paid" | "failed";
  externalPayoutRef?: string;
  idempotencyKey: string;
  createdAt: Date;
}
```

#### Prediction Layer
```ts
type PredictionMode = "non_cash" | "sweepstakes" | "regulated_cash";

type MarketState =
  | "draft"
  | "scheduled"
  | "open"
  | "locked"
  | "in_review"
  | "settled"
  | "voided";

interface PredictionMarket {
  id: string;
  profileId: string;
  milestoneId?: string;
  title: string;
  description?: string;
  mode: PredictionMode;
  jurisdictionCode: string;
  policyVersion: string;
  oracleConfigId: string;
  startsAt: Date;
  locksAt: Date;
  settlementDeadlineAt?: Date;
  payoutCapConfig?: string; // json
  state: MarketState;
  createdBy: string;
  createdAt: Date;
}

interface PredictionOutcomeOption {
  id: string;
  marketId: string;
  key: string; // YES, NO, OVER_500, etc.
  label: string;
  sortOrder: number;
}

interface PredictionPosition {
  id: string;
  marketId: string;
  supporterId: string;
  outcomeOptionId: string;
  stakeAmount: number; // points for non_cash
  stakeUnit: "points" | "currency";
  maxPayoutAmount?: number;
  status: "open" | "won" | "lost" | "voided";
  idempotencyKey: string;
  createdAt: Date;
}

interface PredictionSettlement {
  id: string;
  marketId: string;
  settlementRef: string;
  oracleOutcomeKey: string;
  oracleEvidenceUri: string;
  settledAt: Date;
  disputeWindowEndsAt?: Date;
  status: "proposed" | "final" | "reversed";
  executedBy: "system" | "operator";
  executionRunId: string;
}

interface PredictionPayoutEntry {
  id: string;
  settlementId: string;
  positionId: string;
  supporterId: string;
  payoutAmount: number;
  payoutUnit: "points" | "currency";
  status: "computed" | "credited" | "failed";
}
```

#### Compliance + Audit
```ts
interface ComplianceFlag {
  id: string;
  entityType: "market" | "position" | "user" | "disbursement";
  entityId: string;
  reasonCode: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "in_review" | "closed";
  createdBy: "system" | "operator";
  resolutionNote?: string;
  closedBy?: string;
  closedAt?: Date;
}

interface AuditLogEntry {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  actorId?: string;
  actorType: "supporter" | "vendor" | "operator" | "system";
  jurisdictionCode?: string;
  mode?: PredictionMode;
  payload: Record<string, unknown>;
  hashChainPrev?: string;
  hashChainCurrent: string;
  createdAt: Date;
}
```

### 2.3 Key Relationships
- `HypeProfile 1:N OpsFundingBucket`
- `HypeProfile 1:N DonationPledge`
- `DonationPledge 1:N OpsAllocationEntry`
- `HypeProfile 1:N OpsDisbursement`
- `HypeProfile 1:N PredictionMarket`
- `PredictionMarket 1:N PredictionOutcomeOption`
- `PredictionMarket 1:N PredictionPosition`
- `PredictionMarket 1:0..1 PredictionSettlement`
- `PredictionSettlement 1:N PredictionPayoutEntry`
- `* -> N AuditLogEntry` (event-sourced audit trail)
- `* -> N ComplianceFlag`

---

## 3) Migration Plan and Index Strategy

### 3.1 Migration Sequencing (Zero-Downtime)
1. **Schema introduction:** create new tables with nullable forward-compatible fields.
2. **Reference backfill:** attach profile-owner mappings from existing `Vendor`, `Campaign` data.
3. **Dual-write phase (optional):** where legacy flows overlap, write old + new records.
4. **Feature flag release:** enable read endpoints behind per-surface flags.
5. **Data integrity checks:** verify counts, referential integrity, idempotency uniqueness.
6. **Cutover and cleanup:** remove deprecated dual-write code after stable release window.

### 3.2 Suggested Table and Index Plan

#### hype_profile
- PK: `id`
- Unique: `(slug)`
- Index: `(owner_id)`, `(profile_type, status)`, `(published_at DESC)`

#### ops_funding_bucket
- PK: `id`
- Unique: `(profile_id, code)` where `is_active=true`
- Index: `(profile_id, display_order)`

#### donation_pledge
- PK: `id`
- Unique: `(idempotency_key)`
- Index: `(profile_id, created_at DESC)`, `(supporter_id, created_at DESC)`, `(status, created_at DESC)`

#### ops_allocation_entry
- PK: `id`
- Index: `(source_type, source_id)`, `(bucket_id, created_at DESC)`, `(allocation_run_id)`

#### ops_disbursement
- PK: `id`
- Unique: `(idempotency_key)`
- Index: `(profile_id, status, created_at DESC)`, `(bucket_id, status)`, `(approved_by, created_at DESC)`

#### prediction_market
- PK: `id`
- Index: `(profile_id, state, locks_at)`, `(jurisdiction_code, mode, state)`, `(created_by, created_at DESC)`

#### prediction_position
- PK: `id`
- Unique: `(idempotency_key)`
- Unique partial: `(market_id, supporter_id)` for non-cash single-entry policy
- Index: `(market_id, created_at DESC)`, `(supporter_id, created_at DESC)`

#### prediction_settlement
- PK: `id`
- Unique: `(market_id)` where `status IN ('proposed','final')`
- Unique: `(settlement_ref)`
- Index: `(settled_at DESC)`, `(execution_run_id)`

#### compliance_flag
- PK: `id`
- Index: `(status, severity, created_at DESC)`, `(entity_type, entity_id)`

#### audit_log_entry
- PK: `id`
- Index: `(aggregate_type, aggregate_id, created_at ASC)`, `(event_type, created_at DESC)`
- Optional partitioning: monthly by `created_at` for high volume.

### 3.3 Data Integrity Constraints
- Enforce FK constraints for all core relationships.
- Enforce check constraints on enum-like statuses.
- Enforce currency + unit consistency (`stake_unit=points` for non-cash mode).

---

## 4) API Contracts (Store / Admin / Vendor)

### 4.1 Store APIs

#### Hype Profiles
- `GET /store/hype/profiles`
  - Query: `q`, `type`, `location`, `status=published`, `page`, `limit`, `sort`
  - Returns paginated profile cards + trust/readiness snapshots.
- `GET /store/hype/profiles/:id`
  - Returns full profile detail + active milestones.
- `GET /store/hype/profiles/:id/operations`
  - Returns public inflow/outflow aggregates + milestone timeline.

#### Donations
- `POST /store/hype/profiles/:id/donations`
  - Headers: `Idempotency-Key`
  - Body: `{bucket_id, amount, currency_code, frequency, payment_method_id}`
  - Returns `DonationPledge` + receipt metadata.
- `GET /store/me/donations`
  - Returns user donation history and recurring schedules.

#### Predictions
- `GET /store/predictions/markets`
  - Query by `profile_id`, `state`, `mode`, `jurisdiction`
- `GET /store/predictions/markets/:id`
  - Includes rules, options, lock time, compliance disclosure metadata.
- `POST /store/predictions/markets/:id/positions`
  - Headers: `Idempotency-Key`
  - Body: `{outcome_option_id, stake_amount}`
  - Validates mode policy and market `open` state.
- `GET /store/predictions/markets/:id/settlement`
  - Settlement evidence + user-specific outcome summary.

### 4.2 Vendor APIs
- `POST /vendor/hype/profiles`
- `PATCH /vendor/hype/profiles/:id`
- `POST /vendor/hype/profiles/:id/milestones`
- `PATCH /vendor/hype/profiles/:id/buckets/:bucketId`
- `POST /vendor/predictions/markets`
  - Creates market in `draft` (requires operator approval to publish).
- `POST /vendor/predictions/markets/:id/submit-for-approval`

### 4.3 Admin / Operator APIs
- `POST /admin/predictions/markets/:id/publish`
- `POST /admin/predictions/markets/:id/lock`
- `POST /admin/predictions/markets/:id/void`
- `POST /admin/predictions/settlements/:marketId/ingest-outcome`
- `POST /admin/predictions/settlements/:marketId/finalize`
- `GET /admin/ops/disbursements?status=pending`
- `POST /admin/ops/disbursements/:id/approve`
- `POST /admin/ops/disbursements/:id/reject`
- `GET /admin/compliance/flags`
- `POST /admin/compliance/flags/:id/close`

### 4.4 Contract Conventions
- Error envelope:
```json
{
  "type": "policy_denied|validation_error|conflict|not_found|internal_error",
  "message": "human-readable",
  "code": "PREDICTION_MARKET_LOCKED"
}
```
- Include `x-request-id` and `x-idempotency-key` in all mutating response headers.

---

## 5) Service-Layer Responsibilities and State Machines

### 5.1 Services

#### `HypeProfileService`
- CRUD + publish workflow for profile content.
- Materialize trust/readiness metric snapshots.

#### `DonationService`
- Validate bucket + profile status.
- Create `DonationPledge` under idempotency guard.
- Coordinate with payment provider adapter.
- Emit domain events for allocation workflow.

#### `AllocationEngineService`
- Apply deterministic priority rules:
  1. Regulatory reserve minimum,
  2. Operational critical costs,
  3. Campaign-linked commitments,
  4. Discretionary growth.
- Persist allocation entries as atomic batch.

#### `DisbursementService`
- Execute approval workflow.
- Call payout adapter with idempotent payout command.
- Update disbursement status with compensating events on failure.

#### `PredictionMarketService`
- Validate mode policy by jurisdiction.
- Enforce market lifecycle transitions.
- Validate placement eligibility and limits.

#### `SettlementService`
- Ingest oracle outcomes.
- Compute winners and capped payout/points results.
- Persist `PredictionSettlement` + `PredictionPayoutEntry` in transaction.
- Trigger asynchronous crediting pipeline.

#### `CompliancePolicyService`
- Resolve mode gating and mandatory controls.
- Provide policy decision artifacts for logs/audit.

#### `ComplianceMonitoringService`
- Generate flags from rule engine detections.
- Route flags to moderation/reviewer queues.

#### `AuditService`
- Append immutable evidence entries for every critical event.
- Hash-chain sequencing to detect tampering.

### 5.2 Market State Machine

```text
draft -> scheduled -> open -> locked -> in_review -> settled
                         \-> voided
locked -> voided
in_review -> voided
```

**Transition guards:**
- `open -> locked` only when `now >= locks_at` or admin lock command.
- `locked -> in_review` only with oracle outcome received.
- `in_review -> settled` only after settlement validation passes.
- `* -> voided` requires operator reason + audit entry.

### 5.3 Disbursement State Machine

```text
pending -> approved -> processing -> paid
    \-> rejected
processing -> failed
failed -> processing (retry with same idempotency key)
```

### 5.4 Donation State Machine

```text
initiated -> authorized -> captured
        \-> failed
captured -> cancelled (refund path; creates reversal ledger entries)
```

---

## 6) Idempotency and Concurrency Strategy

### 6.1 Idempotency
- Require `Idempotency-Key` for all mutating endpoints.
- Persist request fingerprint + response snapshot in idempotency table.
- Return stored response for duplicate key + equivalent payload.
- Reject duplicate key + different payload with `409 conflict`.

### 6.2 Concurrency Controls
- Use DB transactions with `SELECT ... FOR UPDATE` on mutable aggregates:
  - market state updates,
  - settlement finalization,
  - disbursement status transitions.
- Use optimistic versioning (`version` column) for high-traffic aggregates.
- Use distributed lock (e.g., Redis) for settlement job singleton per market.

### 6.3 Settlement Exactly-Once Strategy
- `execution_run_id` unique per market + outcome hash.
- Unique constraint on final settlement per market.
- Crediting job uses payout entry idempotency to prevent double-award.

---

## 7) Failure-Mode and Rollback Strategy

### 7.1 Failure Modes
1. **Payment capture succeeds but DB commit fails**
   - Recovery: outbox reconciliation job pulls payment provider events and replays missing pledge state.
2. **Settlement computation crash mid-batch**
   - Recovery: mark run failed, restart with same `execution_run_id`, skip already persisted payout entries.
3. **Oracle conflict/inconsistency**
   - Response: transition market to `in_review`, freeze payout, open compliance case.
4. **Policy service unavailable**
   - Response: deny new placements/disbursements requiring policy decision; keep reads available.
5. **External payout adapter timeout**
   - Response: keep disbursement in `processing`, perform safe retries with same idempotency key.

### 7.2 Rollback Model
- Use **forward-only compensating actions** (no hard deletes for financial/settlement rows).
- For donation reversal/refund: create negative ledger + reversal allocation records.
- For incorrect settlement:
  - create `PredictionSettlement.status = reversed`,
  - generate compensating payout reversal entries,
  - publish corrected settlement.

### 7.3 Disaster Recovery
- PITR-enabled primary database.
- Periodic restore drills (quarterly).
- Replay from outbox/event log to reconstruct derived aggregates.

---

## 8) Test Plan (Unit / Integration / E2E)

### 8.1 Unit Tests

#### Domain logic
- Allocation priority algorithm correctness.
- Market transition guard validation.
- Payout cap calculations and rounding.
- Compliance policy decision resolution by jurisdiction + mode.

#### Idempotency
- Same key/same payload returns same result.
- Same key/different payload returns conflict.

#### Validation
- Non-cash mode enforces `stake_unit=points`.
- Closed/locked market rejects new positions.

### 8.2 Integration Tests

#### Database + services
- Donation capture produces pledge + allocation entries + audit logs.
- Settlement ingest produces settlement + payout entries exactly once.
- Disbursement approve/process/fail/retry lifecycle maintains consistency.
- Compliance flag creation and closure persist immutable trail.

#### External adapters
- Payment adapter retry behavior with simulated transient failures.
- Oracle ingestion with malformed/late payloads.
- Payout adapter timeout and safe retry semantics.

### 8.3 E2E Tests
1. **Supporter donation journey**
   - Discover profile -> donate to bucket -> receipt visible -> public ops aggregate updated.
2. **Prediction journey (non-cash)**
   - View market -> place position -> lock -> settle -> points credited -> settlement evidence visible.
3. **Operator settlement workflow**
   - Ingest oracle outcome -> finalize settlement -> audit export contains required evidence fields.
4. **Compliance denial path**
   - Policy denies mode in jurisdiction -> placement blocked with explicit error code.

### 8.4 Non-Functional Test Matrix
- Load test `GET /store/hype/profiles` and placement endpoint.
- Chaos test: policy service downtime.
- Concurrency test: simultaneous settlement finalization attempts.
- Security test: RBAC boundary checks across supporter/vendor/admin/compliance roles.

### 8.5 Release Gates
- 0 critical defects in settlement/disbursement flows.
- Idempotency duplicate-write rate = 0 in pre-prod tests.
- Audit export validated against evidence schema.
- Compliance sign-off on policy gating + deny-by-default behavior.

---

## 9) MedusaJS Implementation Notes (TypeScript)

### 9.1 Module Structure (suggested)
```text
src/modules/hype
src/modules/ops-funding
src/modules/prediction
src/modules/compliance
src/modules/audit
```

### 9.2 Patterns
- Use Medusa workflows for multi-step commands:
  - `createDonationWorkflow`
  - `allocateFundsWorkflow`
  - `placePredictionPositionWorkflow`
  - `finalizeSettlementWorkflow`
  - `approveDisbursementWorkflow`
- Use outbox pattern for reliable event publication.
- Keep settlement and payout crediting separated by queue boundary.

### 9.3 Event Contracts (examples)
- `hype.profile.published`
- `donation.pledge.captured`
- `ops.allocation.completed`
- `prediction.market.locked`
- `prediction.settlement.finalized`
- `compliance.flag.opened`
- `ops.disbursement.paid`

### 9.4 Observability
- Structured logs with fields: `aggregate_id`, `market_id`, `profile_id`, `jurisdiction_code`, `mode`, `idempotency_key`, `request_id`.
- Metrics:
  - settlement latency,
  - disbursement queue depth,
  - policy-denied request rate,
  - idempotency replay hit rate.

---

## 10) Open Engineering Decisions
1. Oracle provider strategy: single source + fallback, or quorum model.
2. Whether prediction position cardinality is 1/user/market globally or mode-dependent.
3. Event bus choice and delivery guarantees for settlement-critical events.
4. Partitioning threshold for audit logs and payout entries.
5. Whether to model compliance policy as static config or dynamic policy service with versioning API.

