# Crowdsourced Testing Program

This document is the entry point for testers and engineers joining the Free Black Market crowdsourced testing program.

> **Note on naming.** "Blackout Community" in this document refers to the external coordination platform used for tester recruitment, chat, and payouts. This is distinct from the *release blackout windows* concept used elsewhere in this repository (see `docs/blackout_centralized_build_work_order.md`).

## What this program is

We're validating the marketplace platform — storefront, vendor panel, admin panel, backend — before and around launch. Testers earn rewards for high-quality findings; engineers earn bounties for fixing them. All recruitment, chat, and payouts happen on the **Blackout Community** platform. All bug reports and code contributions happen here on GitHub.

There are three tracks. You can participate in any combination.

| Track | What you do | Where findings go |
| --- | --- | --- |
| Exploratory / UX | Use the apps as a real user would, file what's broken, slow, confusing, or ugly | GitHub bug report or test session report |
| Production readiness | Work the structured checklists in `docs/testing/` | GitHub bug report, linked to the checklist item |
| Security bounty | Probe for vulnerabilities under the rules in `SECURITY.md` | **Private** — GitHub Security Advisory; *never* a public issue |

## 1. Sign up

1. Join Blackout Community: `<BLACKOUT_INVITE_URL>`
2. Complete the tester profile (tells us which surfaces and devices you can cover).
3. Read this page, `SECURITY.md`, and the track-specific docs under `docs/testing/`.
4. Link your GitHub account in your Blackout Community profile so payouts can be attributed to your bug reports automatically.

## 2. Set up locally (optional)

Most exploratory testing happens against the staging environment (`<STAGING_URL>`) — no local setup needed.

If you want to run the apps locally to test pre-release builds or contribute fixes, follow `README.md` for setup and `CONTRIBUTING.md` for the development workflow. Don't duplicate those steps here — start there.

## 3. Pick a test plan

- **Storefront:** `docs/testing/manual-test-plan-storefront.md`
- **Vendor panel:** `docs/testing/manual-test-plan-vendor-panel.md`
- **Admin panel:** `docs/testing/manual-test-plan-admin-panel.md`
- **Production readiness:** `docs/testing/production-readiness-checklist.md`
- **Security bounty scope:** `docs/testing/security-bounty-scope.md`

Coordinate which plan you're picking up in the `#testing-claims` channel on Blackout Community so two testers don't duplicate work.

## 4. Where to file what

| Type of finding | Where |
| --- | --- |
| Functional bug, broken UI, bad copy, accessibility issue | GitHub issue — [`Bug report` template](.github/ISSUE_TEMPLATE/bug_report.yml) |
| End-of-session summary covering many small findings | GitHub issue — [`Test session report` template](.github/ISSUE_TEMPLATE/test_session_report.yml) |
| Security vulnerability (auth bypass, IDOR, XSS, SSRF, etc.) | **Private** — open a [GitHub Security Advisory](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability). See `SECURITY.md`. |
| Feature request, UX suggestion | GitHub issue — `Feature request` template |
| Question, clarification, "is this expected?" | Blackout Community — `#testing-help` channel |

**Always include your Blackout Community handle** in the bug report so the payout system can attribute the finding to you.

## 5. What makes a high-payout finding

Triage gives larger payouts to reports that:

- Reproduce on a clean staging session (steps work end-to-end for the triager).
- Specify the exact surface and severity (use the dropdowns in the bug template).
- Include a screenshot, screen recording, or HAR file where relevant.
- Link to the test plan item or release checklist item the finding came from.
- Are *not* already on the known-issues list — see `QA_AUDIT_REPORT.md`, `docs/QA_WORK_TRACKER.md`, and `docs/qa-production-readiness-check-2026-05-13.md` before filing.

## 6. For engineers contributing fixes

If you're picking up a triaged bug to fix:

1. Comment on the GitHub issue claiming it. Mention your Blackout Community handle.
2. Follow `CONTRIBUTING.md` for branch naming, quality checks, and PR expectations.
3. Reference the issue with `Closes #N` in your PR. Payout is attributed via the linked issue.
4. If you're adding regression coverage, the existing E2E suite lives in `e2e/tests/` — extend it, don't fork it.

## 7. Code of conduct

Participation is governed by `CODE_OF_CONDUCT.md`. Harassment, doxing, and any testing activity outside the rules in `SECURITY.md` are grounds for removal and forfeit of pending payouts.
