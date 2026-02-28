# Vendor Pilot Support & Incident Handling Runbook

This runbook defines the support and incident response operating model for the Hybrid vendor portal pilot cohort.

## 1) Scope

Applies to pilot vendors using:
- Product draft/publish workflow
- Dropship email/manual forwarding paths
- Sales CSV export and baseline reporting

## 2) Support Intake

- Primary channel: `#vendor-pilot-support` (internal)
- Secondary channel: support inbox (`vendor-pilot@freeblackmarket.local`)
- Required intake fields:
  - `vendorId`
  - `storefrontId`
  - environment (`pilot`)
  - impacted flow (`publish`, `forwarding`, `reporting`, `donation`)
  - severity (`sev-1`, `sev-2`, `sev-3`)

## 3) Severity & SLA Targets

| Severity | Definition | Initial Response | Update Cadence | Mitigation Target |
| --- | --- | --- | --- | --- |
| sev-1 | Revenue-blocking or data-integrity risk | <= 15 min | every 30 min | <= 4 hours |
| sev-2 | Major feature degradation, workaround exists | <= 60 min | every 4 hours | <= 2 business days |
| sev-3 | Minor bug / UX issue | <= 1 business day | daily | next sprint planning |

## 4) Incident Triage Workflow

1. Acknowledge intake and assign incident commander (Engineering Lead delegate).
2. Validate blast radius by querying pilot cohort impact (`vendorId`, `storefrontId`).
3. Route to owning DRO:
   - publish/catalog UX -> Vendor Panel Lead
   - forwarding retries/dead-letter -> Backend Lead
   - reconciliation/export mismatch -> Data/Reporting Lead
   - donation settlement issue -> Compliance/Ops Lead
4. Apply mitigation:
   - queue replay/manual override for forwarding
   - rollback/feature-flag controls for UI regressions
   - reconciliation rerun and discrepancy audit export
5. Record timeline + root cause in incident log.
6. Close incident only after owner verifies acceptance criteria recovery.

## 5) Pilot Weekly Rituals

- Monday: review prior-week incident themes and top recurring tickets.
- Wednesday: open-risk checkpoint with compliance for donation/ledger anomalies.
- Friday demo: KPI review of
  - forwarding success rate
  - reconciliation pass rate
  - donation settlement latency
  - time to first listing

## 6) Exit Criteria for Day 0-30 Support Readiness

- Workstream A baseline support script validated with 5 pilot vendors.
- Dropship email/manual paths have documented replay/manual fallback.
- No unresolved sev-1 incidents older than 24 hours.
- Known issues list and next-sprint actions published.
