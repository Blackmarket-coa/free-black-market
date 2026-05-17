# Testing Plans

Start at the repository root `TESTING.md` for program overview and onboarding. This directory holds the structured test plans testers work through.

> **Note on naming.** "Blackout Community" in these documents refers to the external coordination platform used for tester recruitment, chat, and payouts. This is distinct from the *release blackout windows* concept used elsewhere in this repository (see `docs/blackout_centralized_build_work_order.md`).

## Plans

- [`manual-test-plan-storefront.md`](manual-test-plan-storefront.md) — customer-facing surface
- [`manual-test-plan-vendor-panel.md`](manual-test-plan-vendor-panel.md) — seller dashboard
- [`manual-test-plan-admin-panel.md`](manual-test-plan-admin-panel.md) — operator dashboard
- [`production-readiness-checklist.md`](production-readiness-checklist.md) — tester-friendly view onto `docs/RELEASE_VALIDATION_PLAYBOOK.md`
- [`security-bounty-scope.md`](security-bounty-scope.md) — scope, severity tiers, reward bands, rules of engagement

## How to claim a plan

Post in `#testing-claims` on Blackout Community: which plan, which sections, and the time window you're working. This avoids duplicate effort.

## Reporting findings

File each finding as its own GitHub issue using the [Bug report template](../../.github/ISSUE_TEMPLATE/bug_report.yml). For a multi-finding session, also file a [Test session report](../../.github/ISSUE_TEMPLATE/test_session_report.yml) that links to each individual bug.

Always include your Blackout Community handle for payout attribution.
