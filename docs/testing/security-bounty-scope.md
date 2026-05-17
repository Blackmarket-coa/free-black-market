# Security Bounty Scope

This document is the detailed scope for the security bounty program. `SECURITY.md` at the repo root has the short version and the disclosure procedure — read that first.

> **Note on naming.** "Blackout Community" in this document refers to the external coordination platform used for tester recruitment, chat, and payouts — distinct from the *release blackout windows* concept used elsewhere in this repository.

## In scope

Targets:

- Storefront web app (`<STAGING_URL>`)
- Vendor panel (`<STAGING_URL>/vendor`)
- Admin panel (`<STAGING_URL>/admin`) — credentials issued on request via `#security-bounty` on Blackout Community
- Backend API (`<STAGING_API_URL>`)
- First-party MedusaJS modules in `backend/`

Classes of vulnerability we care most about:

- Authentication / authorization (auth bypass, IDOR, privilege escalation, session fixation)
- Server-side code execution (RCE, SQLi, command injection, deserialization, SSRF)
- Client-side injection in authenticated contexts (stored XSS, DOM XSS leading to account takeover)
- Payment / financial logic (price manipulation, double-spend, refund abuse)
- Multi-tenancy isolation (one vendor reading or modifying another vendor's data)
- Secrets / sensitive data exposure
- Server-side request forgery against internal services

## Out of scope

- Denial of service and resource exhaustion
- Findings requiring physical access, MITM on the tester's own connection, or compromised end-user devices
- Social engineering of staff, vendors, customers, or contractors
- Self-XSS that requires the victim to paste content into devtools
- Outdated software / library version reports without a working PoC against this app
- Best-practice findings without demonstrated impact (missing headers on static pages, etc.)
- Findings in third-party SaaS we integrate with — report those to the vendor directly
- Anything against production infrastructure (test against staging only)

## Severity rubric

| Severity | Definition | Reward band |
| --- | --- | --- |
| Critical | Pre-auth RCE; full data dump of customers, vendors, or admins; payment fraud against any user; complete authentication bypass | `<CRITICAL_BAND>` |
| High | Authenticated RCE; cross-vendor data access; privilege escalation to admin; stored XSS in admin or vendor panel; IDOR on financial endpoints | `<HIGH_BAND>` |
| Medium | Reflected XSS; SSRF without sensitive internal data access; missing authorization on lower-risk endpoints; sensitive data exposure in logs | `<MEDIUM_BAND>` |
| Low | Verbose error messages with stack traces; missing security headers on sensitive surfaces; CSRF on lower-impact actions; rate-limit gaps | `<LOW_BAND>` |

Reward bands are filled in by the program owner before public launch. Final severity and reward are determined by the triage team; duplicates pay the first valid report. Reports that include a working fix in a linked PR receive an additional bounty (see `<PATCH_BONUS>`).

## Rules of engagement

You **may**:

- Test against staging.
- Create test vendor and customer accounts (clearly marked as test data).
- Run automated scanners at low rate (≤ 5 req/sec from a single source).
- Chain low-severity findings to demonstrate higher impact — but report each linked finding so triage can assess separately.

You **must not**:

- Run denial-of-service, stress, or load tests against any environment.
- Access, modify, or download data belonging to real users or other testers beyond the minimum needed to demonstrate impact.
- Persist access (web shells, scheduled tasks, dropped credentials) — clean up after PoC.
- Pivot beyond the in-scope targets (cloud accounts, CI, internal services).
- Publicly disclose any finding before the embargo lifts.

## Disclosure

1. File a [GitHub Security Advisory](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) on this repository.
2. The triage team acknowledges within 2 business days and assigns a severity within 5 business days.
3. Fix is shipped, then a 30-day grace period for operators to update.
4. Coordinated public disclosure with credit to the researcher (your Blackout Community handle, GitHub handle, or "anonymous" — your choice).

## Safe harbor

Researchers acting in good faith under these rules will not be pursued legally for incidental violations of the [CFAA](https://www.law.cornell.edu/uscode/text/18/1030) or equivalent local law. If you're unsure whether a planned activity is in scope, ask in `#security-bounty` on Blackout Community *before* running it.
