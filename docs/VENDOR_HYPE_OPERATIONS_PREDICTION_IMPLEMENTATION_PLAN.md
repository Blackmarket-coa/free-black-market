# Vendor Hype + Operations Funding + Prediction: Implementation Plan with Prompt Packs

## Purpose

This implementation plan operationalizes the white paper in `docs/VENDOR_HYPE_OPERATIONS_PREDICTION_WHITEPAPER.md` into an execution roadmap with reusable prompt packs for product, engineering, compliance, design, operations, and go-to-market workflows.

---

## 1) Plan Structure

This plan is organized into 4 delivery tracks and 4 rollout phases.

### Delivery Tracks

1. **Product & Experience**
2. **Compliance & Risk**
3. **Platform Engineering**
4. **Growth & Operations**

### Rollout Phases

- **Phase A:** Hype Profiles + Donation Foundation
- **Phase B:** Non-Cash Prediction Mode
- **Phase C:** Regulated Cash Prediction Mode (geo-gated)
- **Phase D:** Investment Convergence

---

## 2) Phase-by-Phase Implementation Plan

## Phase A — Hype Profiles + Donation Foundation (0–8 weeks)

### Scope

- Public hype profiles (vendors/organizers/orgs)
- Operations transparency dashboard (public + internal)
- Donation buckets (one-time + recurring)
- Basic allocation and reporting

### Deliverables

- Profile pages with trust and operations cards
- Donation checkout with purpose tagging
- Ops ledger summary widgets
- Admin controls for funding bucket governance

### Exit Criteria

- Supporters can donate to specific operational buckets
- Public can view inflow/outflow summary by profile
- Audit trail exists for every donation and disbursement

---

## Phase B — Non-Cash Prediction Mode (6–12 weeks)

### Scope

- Points-based prediction markets (no cash payout)
- Leaderboards, streaks, profile-level hype mechanics
- Oracle ingestion and settlement events

### Deliverables

- Market creation templates for measurable outcomes
- Position placement and settlement APIs
- Anti-manipulation event logs
- Reward mechanics (badges, boosts, gated perks)

### Exit Criteria

- End-to-end non-cash market lifecycle works in production
- Abuse controls and moderation tools are active
- Engagement lift is measurable versus baseline

---

## Phase C — Regulated Cash Prediction (12+ weeks, jurisdiction-based)

### Scope

- KYC/AML onboarding
- Geo-fencing and policy engine
- Cash pool settlement and reserve rules

### Deliverables

- Jurisdiction policy matrix and enforcement middleware
- User controls (limits, cooldown, self-exclusion)
- Treasury reserve and payout reconciliation workflows

### Exit Criteria

- Legal sign-off for enabled jurisdictions
- KYC and sanction checks fully enforced
- Settlement SLAs met with no unresolved payout defects

---

## Phase D — Investment Convergence (post-stability)

### Scope

- Link prediction activity to investment opportunities
- Route selected rewards to campaign backing/investment rails
- Optimize allocation engine with performance and risk feedback

### Deliverables

- Cross-surface portfolio view (donations + positions + investments)
- Optional reward-to-backing conversion
- Lifecycle analytics and retention orchestration

### Exit Criteria

- Users can navigate from hype profile → predict/donate → invest
- Allocation and conversion performance is measurable and stable

---

## 3) Work Breakdown by Team

## Product

- Define final UX for profile hype cards, donor flow, and prediction market cards
- Define event templates and settlement transparency UX
- Define KPIs and analytics schema

## Engineering

- Build core entities/services/APIs
- Implement allocation engine and operational ledger hooks
- Implement prediction lifecycle and settlement orchestration

## Compliance

- Define jurisdiction matrix and mode gating
- Build policy decision points and review operations
- Define user safety controls and disclosures

## Operations

- Build disbursement playbooks
- Build escalation runbooks for disputes and settlements
- Set reserve management policy

## Growth/Community

- Profile launch calendar
- Creator/vendor enablement playbooks
- Reward campaigns and referral loops

---

## 4) Prompt Packs (Copy/Paste)

Use these prompts with your AI implementation assistants.

## 4.1 Product Spec Prompt

```text
You are a senior product manager. Using docs/VENDOR_HYPE_OPERATIONS_PREDICTION_WHITEPAPER.md, generate a complete product spec for Phase A and Phase B.

Requirements:
- User personas: supporter, vendor, organizer, operator, compliance reviewer
- End-to-end journeys for profile discovery, donation, prediction participation, settlement visibility
- Information architecture and page/route map
- KPI tree with leading and lagging indicators
- Acceptance criteria in testable form
- Explicit non-goals

Output format:
1) Product Narrative
2) User Stories
3) UX Requirements
4) Functional Requirements
5) Non-Functional Requirements
6) Acceptance Criteria
```

## 4.2 Compliance Policy Prompt

```text
You are a fintech/gaming compliance architect. Using docs/VENDOR_HYPE_OPERATIONS_PREDICTION_WHITEPAPER.md, design a policy matrix for prediction modes across jurisdictions.

Produce:
- mode gating rules: non-cash, sweepstakes, regulated cash
- required controls per mode: KYC, AML, age-gate, sanctions, limits
- prohibited events and manipulation vectors
- retention and audit evidence requirements
- incident response workflow

Return a machine-readable policy table plus a human-readable SOP.
```

## 4.3 Backend Architecture Prompt

```text
You are a principal backend engineer. Extend the existing collective campaign stack to support hype profiles, donation buckets, prediction markets, and settlement workflows.

Use the white paper and produce:
- domain model design (entities + relationships)
- migration plan and index strategy
- API contracts (store/admin/vendor)
- service-layer responsibilities and state machines
- idempotency and concurrency strategy
- failure-mode and rollback strategy
- test plan (unit/integration/e2e)

Output TypeScript-oriented design notes suitable for MedusaJS module implementation.
```

## 4.4 Frontend UX Prompt

```text
You are a senior frontend architect. Design storefront, vendor panel, and admin panel surfaces for hype profiles, operations dashboards, donation flows, and prediction markets.

Include:
- route map
- component inventory
- data-fetch and caching strategy
- loading/empty/error states
- accessibility requirements
- analytics instrumentation points

Return implementation-ready UI requirements and component contracts.
```

## 4.5 Allocation Engine Prompt

```text
You are a payment systems engineer. Design an allocation engine that routes inflows (donations, prediction fees, investment contributions) into operational buckets with reserve-first priority.

Provide:
- allocation rule syntax
- deterministic execution order
- conflict resolution rules
- reconciliation model
- ledger event schema
- report outputs for public and internal dashboards

Include pseudocode and example allocations.
```

## 4.6 Prediction Settlement Prompt

```text
You are a market settlement engineer. Design settlement workflows for measurable event prediction markets with oracle-driven outcomes.

Include:
- market lifecycle states
- settlement finality model
- dispute window and appeals flow
- payout capping logic
- anti-abuse checks
- audit log schema

Output sequence diagrams and implementation checklist.
```

## 4.7 QA / Release Prompt

```text
You are a QA lead. Create a release validation plan for Phase A/B including contract tests, integration tests, scenario tests, and operational runbooks.

Requirements:
- critical path test matrix
- compliance and safety test scenarios
- rollback and incident drills
- launch readiness gates
- post-launch monitoring dashboard checklist
```

## 4.8 Growth Launch Prompt

```text
You are a growth strategist. Build a 90-day launch plan for vendor/organizer hype profiles plus non-cash prediction engagement loops.

Include:
- launch cohorts
- creator onboarding scripts
- referral mechanics
- incentive calendar
- KPI targets and review cadence
```

---

## 5) Suggested Prompt Execution Order

1. Product Spec Prompt
2. Compliance Policy Prompt
3. Backend Architecture Prompt
4. Frontend UX Prompt
5. Allocation Engine Prompt
6. Prediction Settlement Prompt
7. QA / Release Prompt
8. Growth Launch Prompt

This order reduces rework by locking policy and product constraints before implementation details.

---

## 6) Governance Cadence

- **Weekly:** Product + Engineering + Design sync
- **Biweekly:** Compliance + Risk review
- **Monthly:** KPI and treasury reserve review
- **Per release:** Launch-go/no-go checklist with rollback plan

---

## 7) Immediate Next Actions (This Sprint)

1. Finalize Phase A scope and acceptance criteria.
2. Run Prompt 4.1 and 4.2 to lock product/compliance baseline.
3. Generate backend and frontend technical design packets from Prompts 4.3 and 4.4.
4. Convert resulting designs into phased engineering tickets and QA gate criteria.

