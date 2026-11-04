# FBM AI-First Platform Audit, Repair and Feature Visibility Plan

**Date:** 2026-11-03  
**Status:** Proposed operating plan; no code or production changes authorized by this document.  
**Related:** [Resource Exchange Charter](FBM_RESOURCE_EXCHANGE_CHARTER.md) · [Resource Exchange MVP](FBM_RESOURCE_EXCHANGE_MVP.md) · [Product Strategy](FBM_PRODUCT_STRATEGY.md)

## 1. Mission and operating rule

Audit **every user-facing and supporting capability** across Free Black Market, determine what actually works in the running stack, repair and complete as much as safely possible with AI, and show users **only complete, trustworthy, usable features**.

**Default decision:** (1) retain and expose if proven working; (2) finish if a bounded repair can make it fully functional; (3) otherwise hide from public navigation, discovery, actions, onboarding, and advertising, while preserving source code, data, tests, and a documented backlog. **Hidden does not mean deleted or secure**: disable unauthorized backend access separately.

This is an AI-first workflow, **not** permission for unsupervised production writes, financial transactions, regulatory decisions, credential access, or irreversible changes.

## 2. Audit the whole product

Inventory routes, UI actions, API endpoints, background jobs, integrations, permissions, entitlements, environment flags, and user-facing copy across:

1. **Storefront / buyer:** search, catalog, product pages, cart, checkout, payments, refunds, shipping, account, orders, messaging, trust data, discovery, collective buying, requests and bounties.
2. **Vendor portal:** signup, onboarding, first listing, product/catalog import, inventory, orders, fulfillment, returns, settlements, payouts, reporting, exports, marketing, support, supplier links.
3. **Admin and operations:** approvals, moderation, support, exceptions, fraud/abuse handling, ledger, reconciliation, taxes, audit logs, jobs and alerts.
4. **Exchange infrastructure:** sales, gifts, mutual aid, barter, demand pools, pooled purchases, bargaining, order cycles, consignment, patronage, lending/sharing, organizations and chapter governance.
5. **Cross-cutting systems:** identity, sessions, permissions, tenancy, privacy, E2EE, notifications, accessibility, mobile/desktop Capacitor wraps, web-checkout session/cart handoff, observability and backups.
6. **Platform and integrations:** Medusa/MercurJS services, databases, object storage, queues, search, email, payment/shipping providers, FBM Connect, AI/quest systems, Blackout/Blackstar interfaces, deployments, CI, docs and website copy.

**Do not assume a module exists, a flag is off, or a deployment matches main based on old docs. Verify repository, deployment commit, feature flags, configuration, and observed behavior.**

## 3. Single feature register (source of truth)

Create and maintain a machine-readable register, e.g. `docs/audits/feature-register.csv` plus a readable summary. One row per independently testable user journey or API capability, not merely per module.

Required columns:

`feature_id, area, user_job, route_or_entry, code_paths, backend_dependencies, deployment_sha, flag, audience, state, evidence, test_command, last_verified_at, privacy_risk, legal_gate, financial_risk, effort, value, decision, owner, issue_link, next_action`

**States:**
- `UNKNOWN`: not examined.
- `CODE_ONLY`: code present, no running-stack evidence.
- `BROKEN`: expected journey fails.
- `PARTIAL`: some steps work but journey cannot complete.
- `BLOCKED`: legal, external, security, infrastructure, or operator dependency.
- `VERIFIED_STAGING`: full journey passes in representative staging.
- `VERIFIED_PRODUCTION`: live non-destructive checks corroborate deployment.
- `RETIRED`: intentionally unavailable, preserved for later or removed by separate approval.

**Exposure decisions:** `SHOW`, `HIDE`, `INTERNAL_ONLY`, `COMPLETE_NOW`, `DEFER`. A feature can be code-complete yet remain `HIDE` for legal or operational reasons.

Every assertion needs evidence: commit/revision, relevant test output, endpoint result, screenshot or trace where appropriate, and date. Never mark production-verified based on source inspection alone.

## 4. Audit workflow: breadth first, then completion

### Pass A — Establish a reproducible baseline

- Read repository instructions, CI, manifests, environment key **names only**, architecture docs and existing tests.
- Determine default branch and deployment revisions per app/service; compare production with repository main and staging.
- Enumerate feature flags, gated routes, billing/entitlement rules, service dependencies and secrets *presence* without reading/logging secret values.
- Run static checks, lint, typecheck, build, unit tests and existing integration tests in isolated environments; record pre-existing failures.
- Build route/API/job inventory from code and navigation; detect dead links, missing handlers, placeholder buttons, fake data and unsupported copy.
- Produce an **initial report before code changes** with coverage, contradictions, security risks and a ranked shortlist.

### Pass B — Journey-based functional audit

Test representative personas: anonymous buyer, registered buyer, new seller, active seller, nonprofit/organization operator, chapter participant (if available), admin/support.

For each journey, test: discover → initiate → submit → authorize → persist → notify → fulfill/resolve → reconcile/export. Include happy path, validation errors, retries, empty states, access denial, mobile viewport, keyboard access and basic accessibility.

Use test identities, synthetic data, mocked external payment/shipping calls in staging and **non-destructive** production smoke tests. Never place live purchases, move money, send external messages or expose real users' records without explicit approval.

### Pass C — Decide feature by feature

| Evidence | Action |
| --- | --- |
| Full journey verified and compliant | **SHOW**; keep regression test and monitoring |
| Small, bounded repair; dependencies available; no unresolved legal gate | **COMPLETE_NOW** in a reviewable change, test end-to-end |
| Partial, large scope or external dependency | **HIDE + DEFER**; preserve code, migration compatibility and issue |
| Security/privacy/financial defect | **HIDE immediately in a proposed safe release**, block vulnerable API paths and escalate |
| Legal gate uncleared | **HIDE / DISABLE** regardless of technical readiness |
| Duplicate or obsolete path | **HIDE**; preserve until explicit deprecation approval |

Do not substitute UI hiding for authorization or security. Prefer centrally controlled feature flags/capability checks that consistently govern UI, API, jobs, notifications and public marketing copy.

### Pass D — Repair and release

For `COMPLETE_NOW`, AI should: reproduce defect → identify root cause → write failing test → implement smallest change → run targeted and full checks → run staging end-to-end test → update feature register, docs and rollout notes → submit reviewable PR/change set. Verify the running deployed revision after approved deployment.

For `HIDE`, AI should: remove navigation/CTAs and onboarding suggestions, disable public endpoints or sensitive jobs where appropriate, retain internal tests and source, create backlog issue with dependencies and reactivation criteria, and verify no broken links or exposed data remain.

## 5. AI autonomy levels and human intervention

**AI may do autonomously in a scoped workspace:** repository inventory; static analysis; tests; safe local/staging reproductions; draft feature register; documentation; issue creation; code fixes in isolated branches; accessibility reviews; mock-data end-to-end automation; suggested flags; PRs and evidence summaries.

**AI must seek approval before:** production deployment, live feature disablement affecting users, billing or entitlement migration, database migration with data loss risk, external communications, real payments/refunds/payouts, legal interpretation sign-off, changing auth/privacy policy, using privileged credentials, modifying live user data, and broad architectural changes.

**Human-only or specialist review:** securities/barter/tax/compliance determinations, contractual commitments, actual fee settlement sign-off, security incident decisions, high-risk financial flows, and business acceptance of policy changes. AI prepares evidence and recommended options to minimize human workload.

**Human intervention package:** concise decision requested, why automation cannot safely decide, evidence, risk, reversible options, estimated impact, and exact approval needed. Batch related approvals instead of interrupting for every minor fix.

## 6. Prioritize AI work by usefulness and risk

**Priority 0 — trust and safety:** private needs/offers exposure, unauthenticated reads, courier/customer PII, permissions/tenant isolation, secrets, checkout fee arithmetic, financial reconciliation, active subscription contradictions, and legal-gated features. Isolate unsafe paths before expanding usage.

**Priority 1 — MVP critical path:** first-session survey → private need/offer → explainable match → contact → completed sale/gift/barter/pooled buy (with gates). Vendor first listing, payment and order fulfillment are part of this path.

**Priority 2 — daily/weekly utility:** housekeeping, saved suppliers, status/reminders, goal planning, exports, accessible mobile flows.

**Priority 3 — extensions:** equipment sharing, advanced research, chapter federation, consignment/patronage, sophisticated gamification, cross-border settlement.

**Finish-now heuristic:** choose features with high real-user value, short bounded effort, known dependencies, automated testability, reversible deployment, and no unresolved compliance gate. Avoid polishing optional features while a basic exchange is broken.

## 7. Fixed decision consistency checks

Audit and flag any contradiction to these **non-negotiable product decisions**:

- **Flat 3% Coalition commission, never increased**; KARMA does not change commission/payouts.
- **Payment processor fee deducted first**, then the remainder split between seller and 3% commission. Test exact calculation and rounding against the actual settlement implementation.
- **No subscriptions**; one-time software purchase owns that version, ongoing hosted/metered costs transparently passed through at cost. Audit legacy plans, renewals, copy and migration impact; do not silently cancel active contracts.
- **E2EE never paywalled**.
- **Cooperative quest rules national and international**, with jurisdiction-specific legal checks, not SC-only.
- **AGPL-3.0 compatibility** before introducing dependencies.
- **Capacitor mobile/desktop wraps** with web checkout and synced cart/session.
- **Needs/offers private by default**; no inferred ideology, no dark patterns.
- **Legal gates stay off until cleared**: barter reporting, pooled investments, KARMA-linked pricing, cross-border and Stellar/USDC settlement.

A code contradiction becomes an audit finding and remediation task; it does not amend the decision.

## 8. Test matrix and evidence requirements

**Automated layers:** static/type/lint; unit; API contract; authorization/tenant isolation; integration with isolated databases and fake external services; browser end-to-end across buyer/vendor/admin; mobile-responsive and accessibility; CI deployment checks; non-destructive production smoke tests.

**Critical assertions:**
- A user cannot read another user's private need, contact details, or chapter membership.
- Disabled features are absent from menus, links, recommendations, notifications and public API access; deep links fail safely.
- No placeholder CTA claims success.
- New users get 2–3 honest next steps if no matches exist.
- Fee ordering, refunds, rounding and seller/Coalition allocations reconcile.
- No active subscription price is advertised after an approved pricing migration.
- A sale, gift, barter and pooled buy each complete in staging **only where compliance gates permit**.
- No secret values appear in logs, CI output or generated reports.
- Web checkout preserves session/cart context from wrappers once implemented.

**Evidence discipline:** link CI run, commit, test artifacts and sanitized logs. If a test cannot run, label it `NOT_TESTED` with reason, not `PASS`.

## 9. Deliverables and cadence

1. **Audit baseline report:** deployed-vs-main matrix, build/test results, feature inventory, security and policy contradictions.
2. **Feature register and visibility matrix:** all discovered journeys, evidence, decision and owner.
3. **AI repair queue:** small, ranked PR-sized tasks with acceptance criteria.
4. **Hide/defer queue:** feature flags, safe UI/API concealment, preservation and reactivation criteria.
5. **Release verification report:** tested build, deployed SHA, smoke checks, remaining blockers.
6. **Weekly readiness dashboard:** verified working journeys, incomplete visible journeys (target **zero**), completed exchanges, unresolved critical defects, legal gates, and automation vs human-review workload.

**Work in short cycles:** inventory one area → reproduce → fix or hide → verify → document → move on. Revisit the full register after each significant deployment.

## 10. Definition of done

The audit is complete when every discoverable route and important user journey has a recorded state, evidence and visibility decision; no knowingly incomplete feature is publicly promoted; hidden features are inaccessible where security requires it; and deferred work remains recoverable.

The MVP is ready only when its own [acceptance criteria](FBM_RESOURCE_EXCHANGE_MVP.md) pass in the running pilot stack, with legal/privacy gates cleared. **AI output is not proof of production readiness** without verified tests and required human approvals.

## 11. Immediate first sprint (audit only, then approval)

1. Inventory repository apps, services, navigation, APIs, feature flags, plans, and deployment metadata.
2. Run safe baseline checks and identify broken or misleading visible journeys.
3. Audit privacy, fee arithmetic, subscriptions and legal flags before other repairs.
4. Produce the first feature register, visibility recommendations and top ten AI-fixable defects.
5. Present a compact proposal for the first repair/hide batch and obtain approval before production-impacting changes.

**Do not claim this audit has run merely because this plan has been written.**
