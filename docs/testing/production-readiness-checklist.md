# Production Readiness Checklist (Tester View)

This is a tester-facing entry point into the production-readiness work. The authoritative documents live elsewhere — this page tells you where to look, what to verify, and how to file what you find.

> **Note on naming.** "Blackout Community" in this document refers to the external coordination platform used for tester recruitment, chat, and payouts — distinct from the *release blackout windows* concept covered by the release validation playbook.

## Authoritative sources (do not duplicate)

- **Release validation playbook:** [`docs/RELEASE_VALIDATION_PLAYBOOK.md`](../RELEASE_VALIDATION_PLAYBOOK.md) — the definitive checklist for cutting a release. This is the source of truth.
- **Production readiness index:** [`docs/PRODUCTION_READINESS.md`](../PRODUCTION_READINESS.md)
- **Active QA tracker:** [`docs/QA_WORK_TRACKER.md`](../QA_WORK_TRACKER.md)
- **QA remediation plan:** [`docs/QA_REMEDIATION_PLAN.md`](../QA_REMEDIATION_PLAN.md)
- **Latest QA audit:** [`QA_AUDIT_REPORT.md`](../../QA_AUDIT_REPORT.md)
- **Latest production-readiness check:** [`docs/qa-production-readiness-check-2026-05-13.md`](../qa-production-readiness-check-2026-05-13.md)
- **Audit debt backlog:** [`docs/AUDIT_DEBT.md`](../AUDIT_DEBT.md)

## What testers should do

### Pass 1 — verify known issues still reproduce

Before filing new bugs, walk through the open items in `QA_AUDIT_REPORT.md` and `docs/QA_WORK_TRACKER.md`. For each item:

- [ ] Reproduce on staging. If it still reproduces, comment on the linked issue with current behavior + environment.
- [ ] If it no longer reproduces, comment "cannot reproduce" with the environment so the item can be closed.

This pass is high-value because it converts stale audit findings into either confirmed-still-broken or confirmed-fixed.

### Pass 2 — work the release playbook from a tester perspective

Open `docs/RELEASE_VALIDATION_PLAYBOOK.md`. For each section that is testable from the outside (without infra access), confirm the described behavior or file a bug. Sections requiring infra access (DB migrations, secret rotation, etc.) are out of scope for crowdsourced testers and remain with the platform team.

### Pass 3 — surface coverage with the manual test plans

Work through `manual-test-plan-storefront.md`, `manual-test-plan-vendor-panel.md`, and `manual-test-plan-admin-panel.md` in this directory. File bugs against test-plan items by quoting the item ID (e.g. `S5.3`, `V4.2`).

## Filing findings

- File one GitHub bug per finding, using the [Bug report template](../../.github/ISSUE_TEMPLATE/bug_report.yml).
- Mention the source check (e.g. "RELEASE_VALIDATION_PLAYBOOK section X" or "QA_WORK_TRACKER item Y").
- Include your Blackout Community handle.
- For security findings, route through `SECURITY.md` — never a public issue.

## What "ready" looks like

The platform team owns the call on go/no-go. Crowdsourced testing contributes by:

1. Converting stale audit items to confirmed-fixed or confirmed-still-broken.
2. Working the release playbook from a fresh-eyes perspective.
3. Covering the manual test plans across browsers and devices the team can't easily cover internally.

Aggregate findings will be tracked in `docs/QA_WORK_TRACKER.md`. Coordination updates land in `#release-readiness` on Blackout Community.
