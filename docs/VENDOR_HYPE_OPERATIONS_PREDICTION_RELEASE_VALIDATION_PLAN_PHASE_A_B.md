# Vendor Hype + Operations Funding + Prediction
## Release Validation Plan (Phase A / Phase B)

**Role perspective:** QA Lead  
**Primary references:**
- `docs/VENDOR_HYPE_OPERATIONS_PREDICTION_WHITEPAPER.md`
- `docs/VENDOR_HYPE_OPERATIONS_PREDICTION_IMPLEMENTATION_PLAN.md`
- `docs/VENDOR_HYPE_OPERATIONS_PREDICTION_PHASE_A_B_PRODUCT_SPEC.md`
- `docs/VENDOR_HYPE_OPERATIONS_PREDICTION_BACKEND_ARCHITECTURE.md`
- `docs/VENDOR_HYPE_OPERATIONS_PREDICTION_COMPLIANCE_POLICY_MATRIX.md`
- `docs/VENDOR_HYPE_OPERATIONS_PREDICTION_SETTLEMENT_WORKFLOWS.md`

---

## 1) Purpose, Scope, and Exit Intent

### 1.1 Purpose
Define a production-grade release validation plan for **Phase A (Hype + Donation Foundation)** and **Phase B (Non-Cash Prediction Mode)** that verifies:
- product critical paths,
- cross-service correctness,
- compliance/safety controls,
- rollback readiness,
- launch and post-launch observability.

### 1.2 In Scope
- Storefront flows: discovery, donation, prediction participation, settlement visibility.
- Vendor/admin/compliance workflows: market operations, disbursements, flags, evidence exports.
- API contract integrity and backward compatibility.
- Operational runbooks and incident simulations.

### 1.3 Out of Scope
- Regulated cash-mode legal certification execution (Phase C ownership).
- Performance at global-scale traffic beyond agreed Phase A/B load profiles.

### 1.4 Exit Intent
Release candidate can launch only when all **P0 launch gates** pass and no unresolved critical defects remain.

---

## 2) Test Strategy Overview

### 2.1 Test Layers
1. **Contract tests**: schema + behavior contracts per API boundary.
2. **Integration tests**: service-to-service workflows with real persistence.
3. **Scenario/E2E tests**: role-based user journeys across UI/API systems.
4. **Operational drills**: rollback, outage, and incident response validation.

### 2.2 Environments
- `local`: rapid developer feedback.
- `qa`: daily integration + scenario runs.
- `staging`: production-like data shape, launch rehearsal, operational drills.
- `prod-canary`: controlled rollout and monitoring gate checks.

### 2.3 Test Data Strategy
- Synthetic fixtures for profiles, buckets, milestones, markets.
- Seeded deterministic clock fixtures for lock/settlement timing tests.
- Masked pseudo-identities for compliance/audit tests.

---

## 3) Critical Path Test Matrix

### 3.1 Matrix (Phase A/B)

| ID | Phase | Path | Test Type | Preconditions | Expected Outcome | Severity if Fail |
|---|---|---|---|---|---|---|
| CP-A1 | A | Profile discovery (`/hype` -> `/hype/:id`) | Scenario + UI contract | Published profile set available | Filters/search stable, profile cards + trust cards render correctly | P1 |
| CP-A2 | A | Donation one-time | Scenario + integration | Active bucket + valid payment method | Pledge created, receipt shown, ledger + allocation events written | P0 |
| CP-A3 | A | Donation recurring | Scenario + integration | Recurring enabled | Recurrence schedule persisted and visible in supporter history | P0 |
| CP-A4 | A | Allocation reserve-first execution | Integration + property test | Reserve deficit present | Reserve gets priority before other buckets; sums reconcile exactly | P0 |
| CP-A5 | A | Disbursement approval/rejection | Integration + scenario | Pending disbursement exists | Approved runs payout workflow; rejection blocks payout with audit reason | P0 |
| CP-B1 | B | Market discovery + eligibility | Scenario + contract | Open market + policy service available | Eligible users can proceed; ineligible users receive policy-denied UI/API response | P0 |
| CP-B2 | B | Position placement (non-cash) | Scenario + integration | Market state = open | Position created once, idempotency enforced, state reflected in UI | P0 |
| CP-B3 | B | Lock + oracle ingest + proposed settlement | Integration + workflow test | Market locked + oracle payload valid | Market transitions to proposed settlement with evidence metadata | P0 |
| CP-B4 | B | Dispute window + finalize | Integration + scenario | Proposed settlement exists | Disputes accepted within window; finalization after window/resolution only | P0 |
| CP-B5 | B | Settlement visibility | Scenario + UI | Finalized settlement exists | Outcome, source evidence, timestamp, and user result displayed | P1 |
| CP-B6 | B | Anti-abuse block path | Integration + scenario | Inject abuse condition (e.g., oracle signature fail) | Settlement blocked/escalated with compliance flag and audit trail | P0 |
| CP-B7 | B | Compliance evidence export | Scenario + contract | Compliance reviewer role | Export contains required event fields and hash-chain continuity indicators | P1 |

### 3.2 Coverage Targets
- Critical paths (P0): 100% automated coverage in QA and staging.
- P1 flows: >= 90% automated + manual exploratory spot checks.

---

## 4) Contract Test Plan

### 4.1 API Contract Domains
- Hype profile APIs
- Donation APIs
- Prediction market/position APIs
- Settlement/dispute APIs
- Disbursement/compliance/admin APIs

### 4.2 Contract Assertions
1. Request/response schema validity (OpenAPI/JSON schema).
2. Required enum/state values unchanged unless versioned.
3. Error envelope consistency (`type`, `code`, `message`, `request_id`).
4. Idempotency behavior for mutation endpoints.
5. Backward compatibility checks for existing clients.

### 4.3 Priority Contract Cases
- `POST /store/hype/profiles/:id/donations`: same key/same payload replay returns same response.
- `POST /store/predictions/markets/:id/positions`: locked market rejects with stable error code.
- `GET /store/predictions/markets/:id/settlement`: finalized payload includes evidence URI + status.
- `POST /admin/predictions/settlements/:id/finalize`: duplicate finalize prevented.

### 4.4 Contract Tooling Guidance
- Consumer-driven contracts for frontend clients.
- Provider contract pipeline must run on every merge to release branch.

---

## 5) Integration Test Plan

### 5.1 Key Integration Flows
1. **Donation-to-allocation-to-ledger**
   - Validate reserve-first routing and reconciliation invariant.
2. **Disbursement lifecycle**
   - Pending -> approved/rejected -> processing -> paid/failed/retry.
3. **Market lifecycle integration**
   - open -> locked -> oracle_pending -> proposed -> finalized.
4. **Dispute + appeal integration**
   - valid dispute transitions and adjudication outcomes.
5. **Compliance flag pipeline**
   - detector trigger -> queue -> resolution -> immutable audit entries.

### 5.2 Data Integrity Checks
- No orphan entries across pledge/allocation/disbursement tables.
- Exactly one active finalized settlement per market.
- Compensating entries used for reversals (no destructive mutation).

### 5.3 Concurrency + Idempotency Tests
- Simultaneous position submissions (duplicate idempotency keys).
- Double-finalize race condition (one succeeds, others conflict/no-op).
- Retry after partial failure preserves exactly-once outcomes.

---

## 6) Scenario Test Plan (Role-Based)

### 6.1 Supporter Scenarios
- Discover profile and view trust/ops cards.
- Complete one-time donation with bucket tagging.
- Enroll recurring donation and verify schedule visibility.
- Participate in non-cash prediction market.
- View settlement result and dispute status.

### 6.2 Vendor Scenarios
- Update profile and milestones.
- Configure funding buckets.
- Create market draft and submit for approval.

### 6.3 Operator/Admin Scenarios
- Approve/reject disbursements with reason capture.
- Publish/lock/void market.
- Ingest oracle result and run settlement finalization.

### 6.4 Compliance Reviewer Scenarios
- Review auto-generated abuse flags.
- Resolve disputes and escalate appeals.
- Export audit evidence and verify completeness.

### 6.5 Negative Scenario Set
- Policy service unavailable at position placement.
- Oracle payload invalid signature.
- Settlement finalized attempt before dispute window close.
- Bucket deactivated during in-flight donation.

---

## 7) Compliance and Safety Test Scenarios

### 7.1 Policy and Eligibility
- Jurisdiction-mode gating denies disallowed mode with deterministic error.
- Age-gate and role constraints enforced before participation actions.
- Non-cash disclosure present before position confirm.

### 7.2 User Safety Controls
- Repeated rapid participation triggers cooldown/safety prompt.
- Self-exclusion or participation lock honored immediately (if enabled).

### 7.3 Financial/Safety Integrity
- Reserve insufficiency triggers payout cap and reason capture.
- Settlement cap reason exposed in internal logs and user-facing detail where required.

### 7.4 Evidence and Retention
- Audit events include actor, policy version, correlation IDs.
- Evidence exports include required fields and are retrievable by date/entity filters.

---

## 8) Rollback and Incident Drills

### 8.1 Rollback Drill Catalog

| Drill ID | Scenario | Objective | Success Criteria |
|---|---|---|---|
| RB-1 | Deployment rollback | Verify blue/green rollback with no data loss | Service restored < 15 min, no failed write amplification |
| RB-2 | Settlement logic regression | Validate feature-flag disable and safe fallback | New settlement proposals paused; existing finalized data preserved |
| RB-3 | Policy service outage | Ensure deny-by-default on sensitive mutations | Position/disbursement mutations blocked with clear error; reads unaffected |
| RB-4 | Oracle outage | Ensure market remains safe pending outcome | Markets remain in pending/review without incorrect finalization |
| RB-5 | Bad policy config push | Validate config rollback and reprocessing | Policy reverted, queued events reprocessed without duplicates |

### 8.2 Incident Drill Scenarios
- Payout miscalculation discovered post-finalization (reversal + compensation path).
- Coordinated manipulation alert surge.
- Reconciliation mismatch at day close.
- Compliance export request during active incident.

### 8.3 Drill Cadence
- Pre-launch: run all RB drills in staging at least once.
- Post-launch: monthly RB-1/RB-3, quarterly full incident game day.

### 8.4 Drill Evidence Required
- Timeline transcript
- Decision log
- Metrics snapshot
- Corrective action items with owners + due dates

---

## 9) Launch Readiness Gates

### 9.1 P0 Go/No-Go Gates
1. **Quality Gate**
   - 100% pass on CP P0 matrix.
   - No unresolved Sev-0/Sev-1 defects.
2. **Compliance Gate**
   - Policy gating tests pass in staging and canary.
   - Audit export verification completed.
3. **Operational Gate**
   - On-call runbooks reviewed and acknowledged.
   - Rollback drills RB-1..RB-5 completed with pass evidence.
4. **Data Integrity Gate**
   - Reconciliation checks show zero unexplained deltas in final rehearsal window.
5. **Observability Gate**
   - Required dashboards and alerts active with tested thresholds.

### 9.2 Release Stage Gates
- **Gate A (QA complete):** contract + integration stable for 3 consecutive nightly runs.
- **Gate B (Staging rehearsal):** full scenario suite + drills passed.
- **Gate C (Canary):** no alert threshold breaches for first 24h.
- **Gate D (General availability):** explicit sign-off from QA, Eng, Product, Compliance, Ops.

---

## 10) Post-Launch Monitoring Dashboard Checklist

### 10.1 Core Reliability Dashboard
- API success/error rates by endpoint family.
- p50/p95/p99 latency for donation, position, settlement endpoints.
- Queue depth and processing lag (settlement, disbursement, compliance flags).

### 10.2 Funding Integrity Dashboard
- Inflow volume by source (donation/prediction/investment).
- Allocation completion rate and reserve-first conformance rate.
- Reconciliation mismatch count and total delta.
- Disbursement failure/retry rates.

### 10.3 Settlement Health Dashboard
- Markets by state (`open`, `locked`, `proposed`, `finalized`, `reversed`, `voided`).
- Oracle ingestion latency and failure rate.
- Time-to-proposed and time-to-finalized distributions.
- Dispute count, appeal count, unresolved dispute age.

### 10.4 Compliance/Safety Dashboard
- Policy-denied action rate by jurisdiction/mode.
- Abuse flag rate per 1k prediction actions.
- Manual override count and trend.
- Evidence export success/failure and latency.

### 10.5 User Experience Dashboard
- Donation funnel conversion by step.
- Position placement success vs rejection reasons.
- Settlement page views per finalized market.
- Support ticket volume tagged `donation`, `prediction`, `settlement`, `compliance`.

### 10.6 Alerting Checklist
- Alert thresholds defined and tested for:
  - settlement finalization failures,
  - reconciliation delta breaches,
  - policy service unavailability,
  - oracle ingestion failures,
  - disbursement stuck in processing state,
  - sudden abuse-flag spikes.

---

## 11) Execution Plan and Ownership

### 11.1 Ownership Matrix
- QA: test plan execution, defect triage, sign-off evidence.
- Engineering: test automation, environment stability, rollback tooling.
- Compliance: policy scenario validation, evidence/export checks.
- Operations: runbook readiness, on-call coverage, incident drill participation.
- Product: acceptance confirmation for user-facing critical paths.

### 11.2 Timeline (Recommended)
- Week -3: contract/integration baseline complete.
- Week -2: scenario automation + manual exploratory pass.
- Week -1: staging launch rehearsal + rollback drills.
- Week 0: canary + gated GA decision.
- Week +1: post-launch review and metric stabilization checks.

### 11.3 Artifacts Required at Sign-Off
- Test execution report by suite and severity.
- Defect burndown and waiver log.
- Drill run reports and retrospective notes.
- Monitoring dashboard screenshots/links and alert test proofs.

---

## 12) Entry/Exit Criteria by Test Phase

### 12.1 Entry Criteria
- Requirements baselined and tagged with test IDs.
- Test environments healthy and seed data loaded.
- API specs frozen for candidate release window.

### 12.2 Exit Criteria
- All P0 scenarios passed.
- P1 failures either fixed or formally waived with approved risk.
- No unresolved data integrity anomalies.
- Incident drill outcomes reviewed and accepted by stakeholders.

