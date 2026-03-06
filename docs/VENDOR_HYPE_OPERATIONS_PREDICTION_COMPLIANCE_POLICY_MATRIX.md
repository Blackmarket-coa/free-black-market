# Vendor Hype + Operations Prediction
## Compliance Policy Matrix (Prediction Modes Across Jurisdictions)

**Source basis:** `docs/VENDOR_HYPE_OPERATIONS_PREDICTION_WHITEPAPER.md`  
**Scope:** Phase A/B-aligned controls with forward-compatible policy gating for Phase C.

---

## 1) Machine-Readable Policy Table

```yaml
policy_version: "1.0.0"
effective_date: "2026-01-01"
owner: "Compliance + Risk"
products:
  - prediction_non_cash
  - prediction_sweepstakes
  - prediction_regulated_cash
jurisdiction_profiles:
  - code: US-RESTRICTED
    description: "US states/territories where real-money prediction/betting is not licensed for the platform"
    default_mode: non_cash
    allowed_modes: [non_cash]
    blocked_modes: [sweepstakes, regulated_cash]
  - code: US-SWEEPSTAKES-ELIGIBLE
    description: "US states where legal counsel approves sweepstakes mechanics under state rules"
    default_mode: non_cash
    allowed_modes: [non_cash, sweepstakes]
    blocked_modes: [regulated_cash]
  - code: US-REGULATED-CASH
    description: "US states where platform has required gaming/prediction authorization"
    default_mode: non_cash
    allowed_modes: [non_cash, regulated_cash]
    blocked_modes: [sweepstakes]
  - code: EEA-NONCASH
    description: "EEA jurisdictions where product is limited to non-cash engagement"
    default_mode: non_cash
    allowed_modes: [non_cash]
    blocked_modes: [sweepstakes, regulated_cash]
  - code: EEA-CASH-LICENSED
    description: "EEA jurisdictions with required gambling/financial permissions"
    default_mode: non_cash
    allowed_modes: [non_cash, regulated_cash]
    blocked_modes: [sweepstakes]
  - code: ROW-NONCASH
    description: "Rest-of-world default where legal analysis is incomplete or restrictive"
    default_mode: non_cash
    allowed_modes: [non_cash]
    blocked_modes: [sweepstakes, regulated_cash]

mode_controls:
  non_cash:
    kyc:
      required: false
      trigger_conditions:
        - "identity verification required if abuse score >= threshold"
        - "identity verification required for reward redemption above local threshold"
    aml:
      required: false
      monitoring: "behavioral abuse + fraud monitoring only"
    age_gate:
      required: true
      minimum_age: 18
      fallback_minimum_age: "local legal minimum if higher"
    sanctions_screening:
      required: false
      trigger_conditions:
        - "required before any monetary conversion feature is enabled"
    spend_or_entry_limits:
      required: true
      defaults:
        max_positions_per_market_per_user: 1
        max_markets_per_day_per_user: 20
        cooldown_minutes_after_rapid_activity: 15
    payout_type: "non-monetary points/rewards only"

  sweepstakes:
    kyc:
      required: conditional
      trigger_conditions:
        - "required before prize fulfillment above local tax/reporting thresholds"
    aml:
      required: conditional
      monitoring: "fraud + source-of-funds checks for purchase-linked entries if present"
    age_gate:
      required: true
      minimum_age: 18
      fallback_minimum_age: "local legal minimum if higher"
    sanctions_screening:
      required: conditional
      trigger_conditions:
        - "required before prize disbursement"
    spend_or_entry_limits:
      required: true
      defaults:
        free_entry_path_required: true
        max_entries_per_promotion_per_user: 10
        daily_entry_cap: 25
    payout_type: "prizes/rewards; no direct wagering payout"

  regulated_cash:
    kyc:
      required: true
      level: "CIP/KYC with document or equivalent assurance"
    aml:
      required: true
      monitoring: "transaction monitoring, SAR workflow, enhanced due diligence thresholds"
    age_gate:
      required: true
      minimum_age: 21
      fallback_minimum_age: "local legal minimum if higher"
    sanctions_screening:
      required: true
      frequency: "at onboarding + periodic + before payout"
    spend_or_entry_limits:
      required: true
      defaults:
        deposit_limit_daily: "jurisdiction-configurable"
        loss_limit_daily: "jurisdiction-configurable"
        exposure_cap_per_market: "jurisdiction-configurable"
        self_exclusion_supported: true
    payout_type: "cash payouts with cap and reserve-backed settlement"

event_rules:
  permitted_event_classes:
    - "objective operational milestones (shipment, production target, distribution completion)"
    - "time-bounded measurable outcomes with auditable source"
  prohibited_event_classes:
    - "events involving physical harm, violence, self-harm, or illegal acts"
    - "events requiring confidential/non-public insider data"
    - "events targeting protected classes or sensitive personal attributes"
    - "purely subjective outcomes lacking verifiable oracle source"
    - "events reasonably manipulable by a small coordinated group"

manipulation_vectors:
  - id: MV-01
    vector: "wash-participation or multi-account farming"
    detection: "device graph + velocity + identity linkage"
    control: "account linkage lock, reward clawback, suspension"
  - id: MV-02
    vector: "oracle tampering / false evidence upload"
    detection: "source attestation mismatch + anomaly checks"
    control: "multi-source verification, manual adjudication, void flow"
  - id: MV-03
    vector: "collusive brigading near market close"
    detection: "clustered timing + correlated picks"
    control: "entry throttles, lock acceleration, flag to moderation"
  - id: MV-04
    vector: "insider milestone leakage"
    detection: "abnormal prediction accuracy tied to role proximity"
    control: "restricted participant lists, blackout windows"

retention_policy:
  audit_ledger_records: "7 years minimum"
  settlement_records_and_oracle_evidence: "7 years minimum"
  kyc_aml_records_regulated_cash: "5-7 years per jurisdictional rule; use stricter local requirement"
  compliance_flags_and_case_notes: "5 years minimum"
  product_telemetry_for_safety: "24 months unless legal hold"
  deletion_exceptions:
    - "ongoing investigations"
    - "litigation/legal hold"

audit_evidence_requirements:
  mandatory_fields:
    - event_id
    - actor_id_or_system_id
    - jurisdiction_code
    - mode
    - timestamp_utc
    - decision_reason
    - policy_version
  immutable_storage: true
  export_formats: [csv, json, pdf]
  replayability:
    required: true
    scope:
      - donation_to_allocation_trail
      - prediction_position_to_settlement_trail

incident_workflow:
  severities:
    - S1_critical: "active fraud/regulatory breach/systemic payout risk"
    - S2_high: "suspected manipulation with user impact"
    - S3_medium: "policy violation without active monetary harm"
    - S4_low: "minor control gap/documentation issue"
  sla:
    acknowledge:
      S1_critical: "15 minutes"
      S2_high: "1 hour"
      S3_medium: "4 hours"
      S4_low: "1 business day"
    contain:
      S1_critical: "1 hour"
      S2_high: "4 hours"
      S3_medium: "1 business day"
      S4_low: "3 business days"
    final_disposition:
      S1_critical: "72 hours"
      S2_high: "5 business days"
      S3_medium: "10 business days"
      S4_low: "30 days"
  mandatory_steps:
    - "open case and preserve evidence"
    - "apply immediate risk controls (freeze market, suspend payouts, account restrictions)"
    - "triage by compliance + risk + operations"
    - "issue regulatory/user notifications where required"
    - "complete root-cause analysis and corrective action plan"
    - "record closure with approver identity and policy references"
```

---

## 2) Human-Readable Policy Matrix

| Jurisdiction Profile | Non-Cash | Sweepstakes | Regulated Cash | Minimum Control Baseline |
|---|---:|---:|---:|---|
| US-RESTRICTED | ✅ Allowed | ❌ Blocked | ❌ Blocked | Age-gate, entry limits, anti-abuse telemetry, immutable logs |
| US-SWEEPSTAKES-ELIGIBLE | ✅ Allowed | ✅ Allowed | ❌ Blocked | Non-cash baseline + free entry path + prize controls |
| US-REGULATED-CASH | ✅ Allowed | ❌ Blocked | ✅ Allowed | Full KYC/AML/sanctions + limits + reserve-backed settlement |
| EEA-NONCASH | ✅ Allowed | ❌ Blocked | ❌ Blocked | Age-gate, local policy checks, non-cash disclosures |
| EEA-CASH-LICENSED | ✅ Allowed | ❌ Blocked | ✅ Allowed | Licensed operations + KYC/AML/sanctions + evidence retention |
| ROW-NONCASH | ✅ Allowed | ❌ Blocked | ❌ Blocked | Default-safe non-cash controls only |

> **Policy principle:** if jurisdiction mapping is unknown or stale, default to **Non-Cash only** and block prize/cash pathways until legal/compliance sign-off.

---

## 3) Required Controls by Mode

| Control | Non-Cash | Sweepstakes | Regulated Cash |
|---|---|---|---|
| KYC | Optional/triggered (risk or redemption threshold) | Conditional (prize threshold) | Mandatory pre-participation |
| AML Monitoring | Behavioral/fraud only | Conditional (if monetized entry/prizes) | Mandatory with escalation workflows |
| Age Gate | Mandatory (18+ or higher local rule) | Mandatory (18+ or higher local rule) | Mandatory (21+ or higher local rule) |
| Sanctions Screening | Triggered before monetary conversion | Triggered before prize disbursement | Mandatory onboarding + periodic + pre-payout |
| Spend/Entry Limits | Mandatory points-entry caps + cooldown | Mandatory caps + free entry equivalence | Mandatory deposit/loss/exposure limits + self-exclusion |
| Payout Type | Points/badges only | Prize/reward only | Cash payouts (capped) |

---

## 4) Prohibited Events and Manipulation Vectors

### 4.1 Prohibited Event Types
1. Any event tied to violence, self-harm, or illegal conduct.
2. Events requiring non-public insider information to predict fairly.
3. Events using sensitive personal attributes or protected classes.
4. Outcomes that cannot be objectively verified by an approved source.
5. Easily gameable outcomes controlled by a narrow internal group.

### 4.2 Manipulation Vectors and Preventive Controls
- **Multi-account farming / wash participation:** detect with device graphing and velocity rules; enforce linkage lock and reward clawback.
- **Oracle tampering:** require source attestation and multi-source checks; enable manual adjudication and void procedures.
- **Collusive late-entry brigading:** monitor correlated last-minute clustering; apply throttles/lock acceleration.
- **Insider leakage:** monitor outlier win-rate by role proximity; impose participant restrictions and blackout windows.

---

## 5) Retention and Audit Evidence Requirements

### 5.1 Retention Baseline
- Donation/allocation/disbursement ledger records: **7 years** minimum.
- Prediction settlement + oracle evidence: **7 years** minimum.
- KYC/AML records (cash mode): **5–7 years** or stricter local rule.
- Compliance case records: **5 years** minimum.
- Safety telemetry: **24 months**, except legal hold.

### 5.2 Mandatory Audit Evidence Fields
- Event ID, actor/system ID, jurisdiction code, mode, UTC timestamp, policy version, decision rationale.
- Logs must be immutable, append-only, and exportable in CSV/JSON/PDF.
- Evidence must support deterministic replay for:
  - donation → allocation → disbursement trail,
  - prediction position → settlement → reward/payout trail.

---

## 6) Incident Response SOP (Standard Operating Procedure)

### 6.1 Purpose
Establish a single workflow to detect, contain, investigate, and remediate compliance/safety incidents across all prediction modes.

### 6.2 Trigger Conditions
- Automated control alert (fraud, manipulation, sanction hit, abnormal settlement).
- Manual report from support, operations, legal, or user complaint.
- Regulator or partner escalation.

### 6.3 Severity Classification
- **S1 Critical:** active fraud, potential regulatory breach, systemic payout exposure.
- **S2 High:** suspected manipulation with material user impact.
- **S3 Medium:** policy control failure with contained risk.
- **S4 Low:** documentation/procedural non-conformance.

### 6.4 Workflow
1. **Detect & Open Case**
   - Create incident case ID; preserve all relevant logs, market snapshots, and user actions.
2. **Immediate Containment**
   - Apply temporary controls based on severity: market freeze, payout pause, account restriction, geo-block hardening.
3. **Triage**
   - Assign incident lead (Compliance) and responders (Risk, Ops, Engineering, Legal).
   - Validate mode, jurisdiction, and active policy version at incident time.
4. **Investigation**
   - Reconstruct timeline from immutable logs.
   - Evaluate manipulation vectors and control failures.
   - Determine impacted users, funds, and records.
5. **Decision & Action**
   - Execute remediation: void market, resettle, reward clawback, account sanctions, disclosure updates.
   - For regulated cash: trigger SAR/regulatory notifications when thresholds are met.
6. **Communications**
   - Issue user notices (if impact exists) and regulator/partner notices when legally required.
7. **Closure**
   - Record final disposition, approver, corrective actions, and prevention owner.
8. **Post-Incident Review**
   - Run RCA within 5 business days (S1/S2) and update policy/rules/training.

### 6.5 SLA Targets
- **Acknowledge:** S1 15 min, S2 1 hr, S3 4 hr, S4 1 business day.
- **Contain:** S1 1 hr, S2 4 hr, S3 1 business day, S4 3 business days.
- **Final disposition:** S1 72 hr, S2 5 business days, S3 10 business days, S4 30 days.

### 6.6 Governance and Change Control
- Policy owner: Head of Compliance.
- Any jurisdiction-mode change requires Legal approval + documented effective date.
- Emergency rule changes must be reviewed retroactively within 48 hours.

---

## 7) Implementation Notes for Product/Engineering

- Enforce policy decision point at **market view**, **position placement**, **settlement**, and **reward/payout** checkpoints.
- Store `jurisdiction_code`, `mode`, and `policy_version` on each market and position record.
- Build deny-by-default behavior when policy service is unavailable.
- Expose compliance evidence exports in admin panel for reviewer workflows.

