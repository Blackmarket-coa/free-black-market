# FBM authorization hardening — deferred repository work

**Updated:** 2026-11-24
**Status:** Planned / security review required. Not a claim of an exploitable bypass or completed implementation.
**Scope:** Self-hosted FBM backend (Fedora/Docker), vendor API, Medusa/MercurJS seller sessions and onboarding.

## Context and verified local checks
During E2E-23BC–BP, a local, not-deployed middleware change added `authenticate("seller", "bearer")` to `/vendor/playbook/assign`. Local shared auth helpers were tightened for seller/admin extraction. Seven authorization unit tests passed (E2E-23BK), full TypeScript check passed in an isolated container (E2E-23BN), and `git diff --check` was clean. These are local-worktree results, not evidence that GitHub main or production contains those changes.

## Deferred implementation tasks
1. **Seller session contract audit.** Inspect `src/api/auth/seller/{session,registration-status,register-request}/route.ts`, `src/api/vendor/me/route.ts`, and `src/api/shared/seller-registration.ts`. Document issued actor types, `sel_*` and `mem_*` links, auth identity metadata, session/bearer behavior and legitimate onboarding paths.
2. **Vendor middleware boundary.** Review `src/api/vendor/_middlewares.ts:ensureSellerContext`. Its current guard permits `sel_*`/`mem_*` prefixes as alternatives to a seller/member actor type, and it may fill missing auth context from JWT/identity metadata. Require a validated seller authorization context; preserve MercurJS seller-to-member compatibility and public registration/verification routes.
3. **V1 seller boundary.** Review `src/api/middlewares/seller-context-v1.ts:requireSellerContextV1` for actor-type enforcement, identity binding, and metadata fallback safety. Keep `authenticate("seller","bearer")` as an explicit route boundary.
4. **Shared helper boundary.** Review `src/shared/auth-helpers.ts:requireSellerId`, used by billing, delivery, bookings, subscriptions, creator credits, and playbook APIs. Prevent customer/admin actor contexts from resolving seller IDs through prefix, JWT claims, or `app_metadata.seller_id`. Do not simply ban `mem_*` without confirming legitimate member contracts.
5. **Regression suite before patching.** Add negative cases for customer/admin actors, mismatched actor type vs ID prefix, forged or inconsistent seller metadata, absent/invalid/expired JWT, and unrelated member/seller links. Add positive cases for valid seller bearer and authorized seller-member sessions, registration, verification, login, and onboarding. Test both middleware matchers and HTTP-level behavior.
6. **Additional role helpers.** Audit `extractCustomerId`, `requireCustomerId`, and `extractDriverId` for analogous missing actor-type checks; prioritize based on actual callers and route middleware.
7. **Operational follow-up.** Investigate seller registration-status/session 401s separately from authorization hardening; review admin backfill endpoint dry-run/conflict handling and cookie+bearer CSRF precedence. Do not conflate observed 401s with proof of a bypass.
8. **Release gating.** Confirm TypeScript, isolated unit/integration tests, onboarding compatibility, HTTP 401/403 boundaries, and reviewer signoff before any deployment. Seed/registry work must remain isolated from production until separately approved.

## Constraints
- Production release is locked; no deployment, restart, migration, seed, or production DB write without explicit authorization.
- Preserve existing local modified and untracked files; no automatic cleanup or overwrite.
- Keep the self-hosted architecture; do not propose Medusa Cloud migration.
- Findings are code-level risks, not a confirmed exploit.

## Ingress and release hardening (2026-11-25)

Public ingress mitigation passed operator HTTP tests and reported browser checks. Permanent fixes remain planned, not implemented.

- P0: Centralize trusted client IP resolution; eliminate raw first-address extraction; validate proxy trust boundaries, duplicate headers, IPv4/IPv6 and internal requests. Audit rate limiting, Hawala auditing and creator attribution.
- P0: Configure canonical origins and allowlisted checkout and redirect destinations; audit forwarded-host consumers.
- P0: Restrict shared BMC internal network access and demonstrate maintenance isolation without disrupting other services.
- P1: Consolidate startup validation for both Stripe secret key variables, including restricted-key compatibility and redacted diagnostics.
- P1: Regression-test authenticated browser flows, legitimate upstream proxies, payment and webhook delivery.
- P2: Review SSH/Cockpit exposure, LLMNR and CSP unsafe-inline separately.

Public WAF rejection of preexisting forwarded IP headers does not protect direct internal requests. Host sanitization and HTTPS enforcement are interim controls. Preserve the pinned candidate and deployment lock; require explicit authorization, quiescent database checkpoint, explicit initialization and separately authorized rollback. No automatic database restoration. Fresh Redis rehearsal and selected table fingerprints do not establish full production equivalence.
