# Bus-Factor Drill Cadence

> Cross-link: [`AGGRESSIVE_OPERATIONS_GUIDE.md`](../AGGRESSIVE_OPERATIONS_GUIDE.md) §7.4 (drill definition), §5.1 (foundation milestone exit criterion: drill completed at least once), §5.2/§5.3 (subsequent milestones).

The bus-factor drill is the empirical test of whether the runbooks, the credentials vault, and the co-maintainer onboarding actually let someone other than the maintainer keep BMC running for 30 days. If the drill fails, the runbooks are wrong; runbooks get revised, and the drill is repeated.

This doc defines **what the drill is, when it runs, and how a pass/fail is decided**.

## Drill scenario

A Stage-3 or Stage-4 co-maintainer (per [`CO_MAINTAINER_ONBOARDING.md`](./CO_MAINTAINER_ONBOARDING.md)) takes the lead role for a **30-day window** under the simulated assumption that the maintainer is unavailable. During the window, the co-maintainer:

1. Performs at least one staging deploy following [`runbooks/RELEASE.md`](../runbooks/RELEASE.md).
2. Performs at least one production deploy under maintainer-passive supervision (maintainer observes but does not drive).
3. Walks every row of [`SPOF_MAP.md`](./SPOF_MAP.md) and confirms each row's `Current mitigation` is exercisable. Any row whose mitigation cannot be exercised gets downgraded to `pending` and a remediation PR is opened.
4. Runs a backup-restore drill on staging following [`runbooks/BACKUP_RESTORE.md`](../runbooks/BACKUP_RESTORE.md).
5. Runs an incident dry-run following [`runbooks/INCIDENT_RESPONSE.md`](../runbooks/INCIDENT_RESPONSE.md). The maintainer seeds a fault (e.g. a deliberately-broken canary, a synthetic 5xx surge); the co-maintainer detects, diagnoses, and resolves it from the runbooks.
6. Exercises the secrets manager: rotates one secret end-to-end following [`runbooks/SECRETS_MANAGER_MIGRATION.md`](../runbooks/SECRETS_MANAGER_MIGRATION.md), confirming all consumers pick up the new value.
7. Triages incoming issues and PRs at the cadence the maintainer normally would; merges those that can be merged without maintainer-specific context.

## Pass / fail criteria

The drill **passes** when all of the following hold at the end of the window:

- All seven actions above were completed without the maintainer driving.
- No Tier-1 surface (storefront, vendor panel, backend API, Synapse federation if co-located) suffered an unplanned outage attributable to drill activity.
- No secrets were leaked (confirmed by reviewing access logs in the secrets manager).
- The co-maintainer produces a written report listing every place a runbook was unclear, missing, or out of date. The list of gaps becomes follow-up PRs.

The drill **fails** if any of the following occur:

- The co-maintainer escalates to the maintainer outside of the agreed-upon emergency channel before the window ends.
- A Tier-1 outage occurs that the co-maintainer cannot resolve from the runbooks.
- A SPOF row's mitigation cannot be exercised and remediation cannot be PR'd within the window.
- The co-maintainer cannot demonstrate access to the credentials they need at their stage.

A failed drill is **not a personnel failure** — it is a documentation gap. The response is to fix the runbooks and re-run the drill, not to revoke the co-maintainer's access.

## Cadence

The cadence is **milestone-anchored, not calendar-anchored**, in keeping with the [`AGGRESSIVE_OPERATIONS_GUIDE.md`](../AGGRESSIVE_OPERATIONS_GUIDE.md) framing:

- **Foundation milestone**: at least one drill must complete successfully before the foundation milestone exit criteria are met (§5.1: "Runbook coverage of Tier-1 operations is complete and validated through at least one bus-factor drill"). The first drill ideally runs against staging only, with the co-maintainer at Stage 3.
- **Differentiation milestone**: at least one drill against production with the co-maintainer at Stage 4. This is the proof that the platform survives a real maintainer-unavailable window.
- **Density milestone**: at least one drill with the co-maintainer in Stage-5 full autonomy. This is the proof for the §5.3 exit criterion that the co-maintainer ships production work without maintainer review.
- **Infrastructure milestone**: the drill cadence becomes part of the on-call rotation rather than a discrete event, since two-person on-call is in effect by then.

Outside of milestone-gated drills, an **opportunistic drill** can be triggered at any time when:
- A new runbook is added.
- A SPOF mitigation changes.
- A co-maintainer advances a stage and wants to validate the new access scope.
- A new external dependency is introduced that warrants exercise.

## Pre-drill checklist

Before the drill window opens, confirm:

- [ ] Co-maintainer is at the required stage per the cadence section.
- [ ] All runbooks referenced above exist and are dated within the last six months (older runbooks should be reviewed for staleness first).
- [ ] The credentials vault has working access at the co-maintainer's stage.
- [ ] An emergency channel exists (separate from the simulated-unavailable maintainer) that the co-maintainer can use if a real production-impacting failure occurs that requires breaking the simulation.
- [ ] A drill-start commit on the repository tags the start of the window.

## Post-drill artifacts

A successful drill produces:

- A drill report at `docs/operations/drills/<YYYY-MM-DD>-bus-factor-drill.md` (directory created on first drill).
- One or more follow-up PRs revising runbooks based on gaps surfaced.
- An updated `Last drill` row in the [`SPOF_MAP.md`](./SPOF_MAP.md) header (added to the map on the first drill).
- An entry in the changelog of the operations guide if the drill surfaces a structural problem requiring a §-level revision.

## Cross-references

- [`SPOF_MAP.md`](./SPOF_MAP.md) — exercised row-by-row during the drill.
- [`CO_MAINTAINER_ONBOARDING.md`](./CO_MAINTAINER_ONBOARDING.md) — defines the stages required to lead a drill.
- [`runbooks/INCIDENT_RESPONSE.md`](../runbooks/INCIDENT_RESPONSE.md), [`runbooks/RELEASE.md`](../runbooks/RELEASE.md), [`runbooks/BACKUP_RESTORE.md`](../runbooks/BACKUP_RESTORE.md), [`runbooks/SECRETS_MANAGER_MIGRATION.md`](../runbooks/SECRETS_MANAGER_MIGRATION.md) — exercised during the drill.
- [`AGGRESSIVE_OPERATIONS_GUIDE.md`](../AGGRESSIVE_OPERATIONS_GUIDE.md) §5.1, §5.2, §5.3 — milestone exit criteria that depend on the drill.
