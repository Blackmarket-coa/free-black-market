# Project Operating System Baseline

This document defines the default execution structure for delivery, risk control, and KPI accountability.

## 1) Project Board Structure

Create and maintain a **single project board** with the following columns (left to right):

1. **Backlog**
2. **Ready**
3. **In Progress**
4. **Blocked**
5. **QA**
6. **Done**

### Column Exit Criteria

- **Backlog → Ready**: scope is clear, owner assigned, and acceptance criteria documented.
- **Ready → In Progress**: implementation start date committed and dependencies validated.
- **In Progress → Blocked**: work cannot advance due to external dependency, decision, or incident.
- **In Progress → QA**: development complete with self-checks and linked verification notes.
- **QA → Done**: acceptance criteria met, quality checks passed, and release notes updated.

## 2) Weekly Operating Cadence

Run the following recurring ceremonies every week:

- **30-minute roadmap sync**
  - Purpose: review progress versus roadmap outcomes and reprioritize upcoming work.
- **30-minute risk/compliance sync**
  - Purpose: review active risk items, compliance obligations, and mitigation ownership.
- **Friday demo**
  - Purpose: demonstrate completed increments, validate stakeholder feedback, and close the learning loop.

## 3) Baseline KPI Dashboard

Stand up a baseline KPI dashboard with these metrics and definitions:

### A. Time to First Live Listing

- **Definition**: elapsed time from seller account creation to first successfully published live listing.
- **Primary slice**: median and p90 by cohort week.
- **Target direction**: lower is better.

### B. Order-Forwarding Success Rate

- **Definition**: percentage of marketplace orders successfully forwarded to downstream fulfillment/provider systems without manual intervention.
- **Formula**: `(successful forwards / total forward attempts) * 100`.
- **Primary slice**: daily rate and trailing 7-day average.
- **Target direction**: higher is better.

### C. Payout Reconciliation Pass Rate

- **Definition**: percentage of payout batches that reconcile successfully on first automated pass.
- **Formula**: `(batches reconciled on first pass / total payout batches) * 100`.
- **Primary slice**: weekly rate with exception count.
- **Target direction**: higher is better.

### D. Donation Settlement Latency

- **Definition**: elapsed time between donation capture and confirmed settlement.
- **Primary slice**: median and p95 latency by settlement rail.
- **Target direction**: lower is better.

## 4) Dashboard Operating Rules

- Assign one accountable owner per KPI.
- Review KPI trends in roadmap sync weekly.
- Escalate KPI regressions to risk/compliance sync when thresholds are breached.
- Keep KPI definitions versioned in this document to avoid drift.
