# Vendor Hype + Operations Funding + Prediction
## Allocation Engine Design (Reserve-First Routing)

**Role perspective:** Payment Systems Engineer  
**Primary references:**
- `docs/VENDOR_HYPE_OPERATIONS_PREDICTION_WHITEPAPER.md`
- `docs/VENDOR_HYPE_OPERATIONS_PREDICTION_IMPLEMENTATION_PLAN.md`
- `docs/VENDOR_HYPE_OPERATIONS_PREDICTION_BACKEND_ARCHITECTURE.md`

---

## 1) Objective and Scope

Design an allocation engine that deterministically routes inflows into operational buckets with **reserve-first priority** while preserving full auditability, replayability, and transparent reporting.

### Inflow sources
- Donations
- Prediction fees
- Investment contributions
- Matching/promotional contributions (optional extension)

### Bucket classes
- `reserve`
- `ops_core`
- `production_inputs`
- `campaign_commitments`
- `growth`

---

## 2) Allocation Rule Syntax

Rules are represented as versioned declarative JSON objects.

```ts
type InflowType = "donation" | "prediction_fee" | "investment" | "match";

type BucketCode =
  | "reserve"
  | "ops_core"
  | "production_inputs"
  | "campaign_commitments"
  | "growth"
  | "custom";

interface AllocationPolicy {
  policy_id: string;
  policy_version: string;
  jurisdiction_code?: string;
  profile_id: string;
  currency_code: string;
  active_from: string; // ISO
  active_to?: string; // ISO
  reserve:
    | {
        mode: "target_ratio";
        target_ratio_bps: number; // e.g., 1500 = 15%
        min_balance_minor: number; // cents
      }
    | {
        mode: "fixed_floor";
        floor_minor: number;
      };
  priority_chain: Array<{
    priority: number;
    bucket: BucketCode;
    strategy: "fixed" | "percent" | "remaining" | "need_capped";
    value?: number; // fixed minor units OR bps based on strategy
    cap_minor?: number;
    floor_minor?: number;
    constraints?: {
      inflow_types?: InflowType[];
      tags_all?: string[];
      tags_any?: string[];
    };
  }>;
  rounding: {
    method: "largest_remainder" | "bankers";
    precision_minor_unit: number;
  };
  conflict_policy: {
    mode: "strict_fail" | "best_effort";
    unresolved_remainder_bucket: BucketCode;
  };
}
```

### Example policy (compact)
```json
{
  "policy_id": "alloc_pol_profile_42",
  "policy_version": "2026.03.01",
  "profile_id": "profile_42",
  "currency_code": "USD",
  "reserve": { "mode": "target_ratio", "target_ratio_bps": 1500, "min_balance_minor": 500000 },
  "priority_chain": [
    { "priority": 10, "bucket": "ops_core", "strategy": "need_capped", "cap_minor": 2000000 },
    { "priority": 20, "bucket": "production_inputs", "strategy": "percent", "value": 3000 },
    { "priority": 30, "bucket": "campaign_commitments", "strategy": "fixed", "value": 250000 },
    { "priority": 40, "bucket": "growth", "strategy": "remaining" }
  ],
  "rounding": { "method": "largest_remainder", "precision_minor_unit": 1 },
  "conflict_policy": { "mode": "strict_fail", "unresolved_remainder_bucket": "reserve" }
}
```

---

## 3) Deterministic Execution Order

Allocation executes as a single atomic command with deterministic steps:

1. **Validate command envelope**
   - Check inflow exists, idempotency key is unique, policy active for timestamp.
2. **Load snapshot inputs (same transaction)**
   - Current bucket balances, policy version, unmet needs, commitment obligations.
3. **Reserve-first top-up**
   - Compute reserve deficit from target/floor; allocate from inflow first.
4. **Apply priority chain in ascending `priority`**
   - Evaluate constraints; skip ineligible rules deterministically.
5. **Rounding pass**
   - Apply configured method to eliminate fractional residuals.
6. **Remainder handling**
   - Route unresolved minor units to configured remainder bucket.
7. **Persist allocation batch + ledger events**
   - Write immutable events and allocation rows.
8. **Post-commit publish**
   - Emit outbox event `ops.allocation.completed`.

### Determinism guarantees
- Sort rules by `(priority ASC, bucket ASC, strategy ASC)`.
- Frozen read timestamp and policy version stored on allocation run.
- Pure function computation with explicit rounding strategy.

---

## 4) Conflict Resolution Rules

### 4.1 Conflict Types
1. **Rule overlap conflict**: multiple rules target same bucket with incompatible strategies.
2. **Constraint conflict**: no eligible rule can consume remaining inflow.
3. **Cap/floor conflict**: floors exceed allocable amount after reserve top-up.
4. **Version conflict**: policy changed during allocation attempt.
5. **Currency conflict**: inflow currency mismatches policy currency.

### 4.2 Resolution Policy

#### Rule overlap
- Allowed only if distinct priorities.
- Same priority + same bucket + different strategy -> configuration error.

#### Constraint dead-end
- `strict_fail`: fail transaction and emit `allocation.failed` with reason code.
- `best_effort`: push unresolved remainder to `unresolved_remainder_bucket`.

#### Cap/floor infeasibility
- Apply floors in priority order until funds exhausted.
- Emit warning event with underfunded floor list.

#### Version conflict
- Use optimistic lock on policy version.
- Retry command with latest active policy if retry budget not exceeded.

#### Currency mismatch
- Hard fail; do not auto-convert inside allocator.

### 4.3 Standard reason codes
- `ALLOC_CONFLICT_RULE_OVERLAP`
- `ALLOC_CONFLICT_INFEASIBLE_FLOORS`
- `ALLOC_CONFLICT_CONSTRAINT_DEAD_END`
- `ALLOC_CONFLICT_POLICY_VERSION_STALE`
- `ALLOC_CONFLICT_CURRENCY_MISMATCH`

---

## 5) Reconciliation Model

### 5.1 Reconciliation invariants
For each inflow:

`sum(allocation_entries.amount_minor) + unallocated_minor = inflow.amount_minor`

For each day/profile/currency:

`opening_balance + inflows - disbursements ± adjustments = closing_balance`

### 5.2 Reconciliation layers
1. **Real-time (per command)**
   - Validate allocation sum equals inflow amount.
2. **Batch (hourly)**
   - Compare allocator ledger with payment/market/investment source ledgers.
3. **Daily close**
   - Produce signed reconciliation statement per profile + currency.
4. **Exception queue**
   - Mismatches create `recon_exception` records requiring operator action.

### 5.3 Exception categories
- Missing source inflow
- Duplicate allocation run
- Orphan allocation entry
- Balance drift
- Late external settlement adjustment

### 5.4 Repair strategy
- Never mutate existing ledger events.
- Post compensating ledger events (`adjustment_debit`, `adjustment_credit`).
- Maintain causal link via `correction_of_event_id`.

---

## 6) Ledger Event Schema

### 6.1 Canonical event envelope
```ts
interface LedgerEvent {
  event_id: string;
  event_type:
    | "inflow.recorded"
    | "allocation.started"
    | "allocation.entry.created"
    | "allocation.completed"
    | "allocation.failed"
    | "reconciliation.completed"
    | "reconciliation.exception"
    | "adjustment.posted";
  event_time: string; // ISO UTC
  profile_id: string;
  currency_code: string;
  inflow_id?: string;
  allocation_run_id?: string;
  idempotency_key?: string;
  policy_id?: string;
  policy_version?: string;
  source: {
    source_type: InflowType;
    source_ref: string;
  };
  amounts?: {
    gross_minor?: number;
    allocated_minor?: number;
    unallocated_minor?: number;
  };
  bucket_code?: BucketCode;
  metadata?: Record<string, unknown>;
  hash_prev?: string;
  hash_curr: string;
}
```

### 6.2 Allocation entry event payload
```ts
interface AllocationEntryPayload {
  allocation_run_id: string;
  inflow_id: string;
  bucket_code: BucketCode;
  priority: number;
  strategy: "fixed" | "percent" | "remaining" | "need_capped";
  amount_minor: number;
  reserve_topup_applied: boolean;
  policy_version: string;
  reason_code?: string;
}
```

### 6.3 Reconciliation event payload
```ts
interface ReconciliationPayload {
  recon_batch_id: string;
  window_start: string;
  window_end: string;
  profile_id: string;
  currency_code: string;
  expected_minor: number;
  actual_minor: number;
  delta_minor: number;
  status: "matched" | "mismatch";
  exception_ids?: string[];
}
```

---

## 7) Report Outputs

### 7.1 Public dashboard outputs (aggregated, non-sensitive)

#### `public_funding_summary`
- Dimensions: `profile_id`, `period_day`, `currency_code`
- Metrics:
  - `total_inflow_minor`
  - `allocated_to_ops_core_minor`
  - `allocated_to_production_inputs_minor`
  - `allocated_to_growth_minor`
  - `allocated_to_reserve_minor`
  - `reserve_coverage_ratio`

#### `public_milestone_funding_progress`
- Dimensions: `profile_id`, `milestone_id`, `period_week`
- Metrics:
  - `required_minor`
  - `funded_minor`
  - `funding_gap_minor`
  - `pct_funded`

### 7.2 Internal dashboard outputs (operational + audit)

#### `internal_allocation_run_detail`
- Keys: `allocation_run_id`, `inflow_id`
- Fields:
  - policy metadata, execution duration, deterministic checksum
  - per-rule amounts, skipped-rule reasons, rounding residual

#### `internal_reconciliation_status`
- Dimensions: `profile_id`, `currency_code`, `recon_day`
- Metrics:
  - `matched_runs`
  - `mismatched_runs`
  - `total_delta_minor`
  - `open_exception_count`

#### `internal_reserve_health`
- Dimensions: `profile_id`, `currency_code`, `snapshot_time`
- Metrics:
  - `reserve_balance_minor`
  - `reserve_target_minor`
  - `reserve_deficit_minor`
  - `days_of_runway_estimate`

#### `internal_compliance_audit_extract`
- Filterable by: `date range`, `profile_id`, `inflow_type`, `policy_version`
- Includes immutable ledger events and hash-chain verification status.

---

## 8) Allocation Engine Pseudocode

```ts
function allocateInflow(cmd: {
  inflowId: string;
  profileId: string;
  sourceType: InflowType;
  amountMinor: number;
  currencyCode: string;
  tags: string[];
  idempotencyKey: string;
  occurredAt: string;
}) {
  beginTransaction();

  assertIdempotency(cmd.idempotencyKey, cmd);

  const policy = loadActivePolicy(cmd.profileId, cmd.currencyCode, cmd.occurredAt);
  if (!policy) fail("ALLOC_POLICY_NOT_FOUND");

  const snapshot = loadAllocationSnapshot(cmd.profileId, cmd.currencyCode);
  const reserveDeficit = computeReserveDeficit(policy.reserve, snapshot.reserveBalanceMinor);

  let remaining = cmd.amountMinor;
  const entries: AllocationEntryPayload[] = [];

  // Step 1: reserve-first
  const reserveTopUp = min(remaining, max(0, reserveDeficit));
  if (reserveTopUp > 0) {
    entries.push(makeEntry("reserve", 0, "need_capped", reserveTopUp, true));
    remaining -= reserveTopUp;
  }

  // Step 2: deterministic priority chain
  const rules = sortRules(policy.priority_chain);
  for (const rule of rules) {
    if (remaining <= 0) break;
    if (!isRuleEligible(rule, cmd.sourceType, cmd.tags)) continue;

    const amount = computeRuleAmount(rule, remaining, snapshot);
    const bounded = applyFloorCap(rule, amount, remaining);
    if (bounded <= 0) continue;

    entries.push(makeEntry(rule.bucket, rule.priority, rule.strategy, bounded, false));
    remaining -= bounded;
  }

  // Step 3: rounding + remainder
  const roundedEntries = applyRounding(entries, policy.rounding);
  const allocated = sum(roundedEntries.map((e) => e.amount_minor));
  remaining = cmd.amountMinor - allocated;

  if (remaining > 0) {
    if (policy.conflict_policy.mode === "strict_fail") {
      fail("ALLOC_CONFLICT_CONSTRAINT_DEAD_END");
    }
    roundedEntries.push(
      makeEntry(
        policy.conflict_policy.unresolved_remainder_bucket,
        9999,
        "remaining",
        remaining,
        false,
        "ALLOC_REMAINDER_ROUTED"
      )
    );
    remaining = 0;
  }

  assert(sum(roundedEntries.map((e) => e.amount_minor)) === cmd.amountMinor);

  const runId = persistAllocationRun(cmd, policy, roundedEntries);
  appendLedgerEvents(cmd, policy, runId, roundedEntries);
  publishOutbox("ops.allocation.completed", { runId, inflowId: cmd.inflowId });

  commitTransaction();
  return { allocationRunId: runId, entries: roundedEntries };
}
```

---

## 9) Example Allocations

Assume:
- Inflow: `donation`, USD 10,000.00 (`1,000,000` minor units)
- Reserve target deficit: USD 2,000.00 (`200,000`)
- Rules after reserve:
  1. `ops_core`: need-capped up to USD 4,000.00
  2. `production_inputs`: 30% of remaining
  3. `campaign_commitments`: fixed USD 1,000.00
  4. `growth`: remaining

### Example A (enough funds for all steps)
1. Reserve top-up: `200,000`
2. Remaining: `800,000`
3. Ops core (need-capped): `400,000`
4. Remaining: `400,000`
5. Production inputs (30%): `120,000`
6. Remaining: `280,000`
7. Campaign commitments (fixed): `100,000`
8. Remaining to growth: `180,000`

**Final allocation**
- reserve: `200,000`
- ops_core: `400,000`
- production_inputs: `120,000`
- campaign_commitments: `100,000`
- growth: `180,000`
- total: `1,000,000`

### Example B (inflow too small after reserve)
- Inflow: USD 1,500.00 (`150,000`)
- Reserve deficit: `200,000`

Result:
- reserve receives all `150,000`
- all other buckets receive `0`
- reason note: `RESERVE_PRIORITY_EXHAUSTED_INFLOW`

### Example C (constraint dead-end in strict mode)
- Inflow after reserve: `50,000`
- All eligible rules filtered out by inflow tags/constraints.

Result:
- `strict_fail` => allocation transaction fails, no entries committed.
- `best_effort` => remainder goes to configured fallback bucket.

---

## 10) Operational Controls and SLOs

### SLOs
- Allocation command success (excluding validation rejects): **99.95%** monthly
- p95 allocation latency: **< 250ms** (excluding DB failover)
- Reconciliation completion by T+1 02:00 local ledger time: **99.9%**

### Controls
- Idempotency keys required on all inflow ingestion and reprocess jobs.
- Policy changes require approval and produce a new immutable `policy_version`.
- Allocator runs are replayable by `inflow_id + policy_version + snapshot_checksum`.

---

## 11) Implementation Notes (MedusaJS / TypeScript)

### Suggested workflow steps
1. `recordInflowStep`
2. `loadPolicyAndSnapshotStep`
3. `computeAllocationStep`
4. `persistAllocationEntriesStep`
5. `appendLedgerEventsStep`
6. `publishAllocationCompletedStep`

### Key storage tables
- `ops_allocation_policy`
- `ops_allocation_run`
- `ops_allocation_entry`
- `ops_ledger_event`
- `ops_reconciliation_batch`
- `ops_reconciliation_exception`

### Recommended indexes
- `ops_allocation_run (inflow_id UNIQUE, profile_id, created_at DESC)`
- `ops_allocation_entry (allocation_run_id, bucket_code, created_at DESC)`
- `ops_ledger_event (profile_id, event_time DESC, event_type)`
- `ops_reconciliation_exception (status, created_at DESC)`

