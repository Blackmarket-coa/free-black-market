# Co-Maintainer Onboarding

> Cross-link: [`AGGRESSIVE_OPERATIONS_GUIDE.md`](../AGGRESSIVE_OPERATIONS_GUIDE.md) §7.2 and §3 (bus-factor constraint of the prioritization filter).

This doc lays out the staged access-grant procedure for onboarding a co-maintainer to the FBM repository and its operational surface. The staging exists because access scopes have very different blast radii: GitHub read access is reversible and low-risk; primary-server deploy access is high-risk and should land only after the participant has demonstrated runbook competence on lower stages.

The doc also defines the **decision tree for "the maintainer is unavailable"** so a co-maintainer with this doc and the credentials vault can keep BMC running for the bus-factor drill window (30 days).

## Stages

Stages run in order. Each stage has an **entry condition**, **what to grant**, and **a competency check** that must pass before the next stage is unlocked.

### Stage 1 — Read-only orientation

**Entry condition.** Identity verified out-of-band; participant has signed the contributor agreement (see `CONTRIBUTING.md`).

**Grants:**
- GitHub read access to `Blackmarket-coa/free-black-market`.
- Read access to staging Metabase analytics dashboards.
- Read access to the staging observability stack (Grafana / Sentry projects).

**Competency check:**
- Participant pulls the repo, runs `pnpm install && pnpm -w lint && pnpm -w build` from a fresh checkout, and reports any failure modes.
- Participant reads [`PRODUCTION_READINESS.md`](../PRODUCTION_READINESS.md), [`AGGRESSIVE_OPERATIONS_GUIDE.md`](../AGGRESSIVE_OPERATIONS_GUIDE.md) §1–§5, and the existing `runbooks/` directory.
- Participant produces a written summary of the two-layer architecture, the four milestone tiers, and the Tier-1 surfaces (storefront, vendor panel, backend API, federation).

### Stage 2 — Runbook walkthrough

**Entry condition.** Stage 1 competency check passed.

**Grants:**
- Issue triage permission on the repo (label and milestone management).
- Read access to the chosen secrets manager **at the runbook-only scope** (the participant can see the names of secrets but not their values).

**Competency check:**
- Walk the participant through one runbook end-to-end on staging with the maintainer narrating: pick [`runbooks/DEPLOYMENT.md`](../runbooks/DEPLOYMENT.md) first.
- Participant then walks a second runbook on staging unsupervised and writes a short post-walk note flagging any step that was unclear or out of date. Notes feed back into runbook revisions.

### Stage 3 — Staging deploy access

**Entry condition.** Stage 2 competency check passed and at least two runbook-revision PRs from the participant have merged.

**Grants:**
- Push access to the repository (still requires PR review for merges).
- Deploy access to staging.
- Secrets-manager read scope for staging-only secrets.
- Read access to the Stellar testnet dashboard.
- Read access to the Stripe dashboard (test-mode keys).

**Competency check:**
- Participant runs the next staging deploy following [`runbooks/RELEASE.md`](../runbooks/RELEASE.md) end-to-end, with the maintainer available but not driving.
- Participant runs a backup/restore drill on staging following [`runbooks/BACKUP_RESTORE.md`](../runbooks/BACKUP_RESTORE.md).

### Stage 4 — Production deploy access

**Entry condition.** Stage 3 competency check passed; participant has been active for at least one calendar quarter; bus-factor drill (see [`BUS_FACTOR_DRILL_CADENCE.md`](./BUS_FACTOR_DRILL_CADENCE.md)) has been completed with the participant in the lead role.

**Grants:**
- Production deploy access on the primary DL360 server (SSH key added; sudoers entry).
- Secrets-manager read scope for production secrets at the categories required for the runbooks (Postgres, MinIO, Cloudflare Tunnel, Synapse signing keys, Stellar mainnet, Stripe live keys).
- Cloudflare account access at `Member` role (not `Super Administrator`).
- Stripe live-mode dashboard read access.
- Stellar mainnet dashboard read access.
- GitHub organization member with `Maintain` role on the repo.

**Competency check:**
- Participant performs the next production release following [`runbooks/RELEASE.md`](../runbooks/RELEASE.md), with the maintainer on standby.
- Participant performs an incident dry-run following [`runbooks/INCIDENT_RESPONSE.md`](../runbooks/INCIDENT_RESPONSE.md) using a staged failure (e.g. a deliberately-broken canary).

### Stage 5 — Full autonomy (density-milestone target)

**Entry condition.** Stage 4 sustained for one or more bus-factor drill cycles without escalation; co-maintainer is shipping production work without maintainer review on routine items, per the §5.3 density-milestone exit criterion.

**Grants:**
- GitHub organization second-owner role.
- Full Cloudflare account access.
- Authority to onboard the next co-maintainer through Stages 1–3.

This is the milestone the guide §5.3 refers to as "one full-autonomy co-maintainer is shipping production work."

## "Maintainer is unavailable" decision tree

Use this tree when the maintainer has been unreachable for the windows below. The tree is intentionally conservative on production-mutating actions during the first 24 hours to allow for the maintainer simply being asleep or offline.

```
0–24 hours unreachable:
    Stage ≥3 co-maintainer can:
      - merge already-approved PRs
      - run staging deploys
      - acknowledge alerts in observability stack
    Stage ≥3 co-maintainer must NOT:
      - run production deploys
      - rotate secrets
      - push to release branches

24–72 hours unreachable:
    Stage ≥4 co-maintainer can:
      - run production hotfix deploys following runbooks/INCIDENT_RESPONSE.md
      - rotate secrets per runbooks/SECRETS_MANAGER_MIGRATION.md if a leak
        is suspected
      - post a status update from a coordination channel

72 hours – 30 days unreachable (bus-factor drill window):
    Stage ≥4 co-maintainer:
      - keeps the stack running per runbooks/* and PRODUCTION_READINESS.md
      - defers non-urgent feature work
      - escalates to the emergency-access delegate on the maintainer's
        passphrase manager if account-recovery actions are needed

>30 days unreachable:
    Trigger the maintainer-unavailability protocol:
      - Stage ≥4 co-maintainer assumes Stage 5 access via the emergency-access
        delegate.
      - Public communication issued to coalition partners.
      - Project governance falls back to the open-source fork right per
        AGGRESSIVE_OPERATIONS_GUIDE.md §2.7.
```

## Revocation

Revocation is the inverse of grant order: stages roll back in reverse, with each rollback recorded in a revocation log under `docs/operations/access_revocations.md` (created on first use). Revocation is **immediate** when triggered by a security event; it is **scheduled with handoff** when triggered by an amicable departure.

Specific revocation actions per stage:
- Stage 5: remove GitHub org owner role, remove Cloudflare account access, transfer onboarding authority back to the remaining maintainer.
- Stage 4: remove SSH key from primary server; rotate secrets the participant had production read on (Postgres, MinIO admin, Cloudflare Tunnel, Synapse signing, Stellar mainnet, Stripe live).
- Stage 3: remove staging deploy access; rotate staging secrets.
- Stage 2: revoke triage permission; remove runbook-scope secrets-manager access.
- Stage 1: remove repo read access.

## Cross-references

- [`SPOF_MAP.md`](./SPOF_MAP.md) — SPOF-05 and SPOF-06 are mitigated by progressing co-maintainers through these stages.
- [`BUS_FACTOR_DRILL_CADENCE.md`](./BUS_FACTOR_DRILL_CADENCE.md) — drills exercise this onboarding doc; gaps surfaced during drills should land back here as PRs.
- [`runbooks/ON_CALL.md`](../runbooks/ON_CALL.md) — the on-call rotation that becomes possible at Stage 4.
- [`AGGRESSIVE_OPERATIONS_GUIDE.md`](../AGGRESSIVE_OPERATIONS_GUIDE.md) §5.1 (foundation exit criterion: one Stage-3 co-maintainer onboarded), §5.2 (differentiation: Stage-4 with deploy access), §5.3 (density: Stage-5 full autonomy).
