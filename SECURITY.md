# Security Policy

> **Note on naming.** "Blackout Community" in this document refers to the external coordination platform used for tester recruitment, chat, and payouts. This is distinct from the *release blackout windows* concept used elsewhere in this repository (see `docs/blackout_centralized_build_work_order.md`).

## Reporting a vulnerability

**Do not open a public GitHub issue for a vulnerability.** Public disclosure before a fix is shipped puts users at risk and disqualifies the finding from the bounty program.

Report privately via **[GitHub Security Advisories](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)** on this repository. Use the "Report a vulnerability" button under the *Security* tab.

After the advisory is filed, coordinate payout and follow-up in the `#security-bounty` channel on Blackout Community.

## What to include

- Affected surface (Storefront / Vendor Panel / Admin Panel / Backend API / Infrastructure).
- Steps to reproduce, against the staging environment if possible.
- Proof of concept — minimum required to demonstrate impact. Do not exfiltrate real data.
- Suggested severity (see rubric below) and impact statement.
- Your Blackout Community handle for payout attribution.

## Response timeline

| Stage | Target |
| --- | --- |
| Acknowledgement | 2 business days |
| Initial triage and severity assignment | 5 business days |
| Fix or mitigation plan | 30 days for High/Critical, 90 days for Medium/Low |
| Public disclosure | After fix is shipped and 30-day grace period for affected operators |

## Severity rubric (summary)

Full details and reward bands are in `docs/testing/security-bounty-scope.md`.

| Severity | Examples |
| --- | --- |
| Critical | Pre-auth RCE; full customer or vendor data dump; payment fraud at scale |
| High | Auth bypass; privilege escalation between vendors or roles; stored XSS in admin; IDOR on financial endpoints |
| Medium | Reflected XSS; missing authorization on lower-risk endpoints; SSRF without internal data access |
| Low | Verbose error messages; missing security headers; logout / CSRF on low-impact actions |

## Rules of engagement

You **may**:

- Test against the staging environment (`<STAGING_URL>`).
- Create test vendor and customer accounts.
- Use automated scanners at low rate (≤ 5 req/sec).

You **must not**:

- Run denial-of-service or stress tests against production or staging.
- Access, modify, or download data belonging to other testers or real users beyond what is strictly required to demonstrate the issue.
- Pivot from a finding into other infrastructure (cloud accounts, CI, vendor SaaS).
- Social-engineer staff, vendors, or customers.
- Publicly disclose a finding before the embargo lifts.

Violations forfeit pending payouts and may result in removal from the program and legal action.

## Safe harbor

Researchers acting in good faith under these rules will not be pursued legally for incidental violations of the [CFAA](https://www.law.cornell.edu/uscode/text/18/1030) or equivalent local law. If you're unsure whether a planned activity is in scope, ask in `#security-bounty` on Blackout Community *before* running it.
