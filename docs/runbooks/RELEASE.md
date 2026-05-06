# Release Process

**Last validated:** 2026-05-06

## Cadence

- **Patch / hotfix**: any time, on demand.
- **Minor**: weekly on Wednesdays.
- **Major**: per roadmap (`ROADMAP.md`).

## Release branches

- Cut `release/vX.Y.Z` from `main` once the desired commits are on `main`.
- The `release-validation` job in CI runs only on `release/**`; it executes `scripts/release_validation.sh` against the integration endpoints declared in repo secrets and uploads the log as an artifact.
- Hotfixes that need to bypass `main` may be cut directly from a tag with a `release/vX.Y.Z-hotfix.N` branch.

## Pre-flight checklist

Before tagging a release:

- [ ] All gates green on the release branch (see `docs/PRODUCTION_READINESS.md`).
- [ ] `release-validation` artifact uploaded and reviewed (no failures).
- [ ] `docs/RELEASE_VALIDATION_PLAYBOOK.md` walk-through completed by QA.
- [ ] `e2e` workflow has run and passed against the latest release-branch commit.
- [ ] `load-perf` workflow run with P95 < 800 ms / error < 1 % thresholds met.
- [ ] `CHANGELOG.md` `[Unreleased]` block moved under the new version with the date.
- [ ] Migration plan reviewed if any new Postgres migration is in this release. Confirm the migration is backwards-compatible with the previous app version (rolling deploys overlap them).

## Tagging

```bash
# From the release branch.
git pull
git tag -a vX.Y.Z -m "release vX.Y.Z"
git push origin vX.Y.Z
```

The tag triggers `docker-build.yml`, which adds `vX.Y.Z` and `latest` (only on default branch) to each image.

## Promotion

1. Run **Actions → Deploy → Staging** with `image_tag: vX.Y.Z`. Required approvals are configured on the `staging` GitHub environment.
2. Soak at staging for at least 30 min. Run the QA smoke list.
3. Run **Actions → Deploy → Production** with `image_tag: vX.Y.Z`. Production environment requires approval from the on-call commander + an engineering manager.
4. Watch dashboards for 30 minutes post-deploy. Roll back per `DEPLOYMENT.md` if any SEV1/SEV2 indicators trip.

## Communications

- Engineering: post the release notes (CHANGELOG entry) in `#freeblackmarket-engineering` after production deploy completes.
- Vendors: send the relevant subset of release notes to the vendor distribution list when a release changes vendor-facing flows.
- Customers: status-page entry for any release that requires planned downtime (none expected for normal releases — the K8s rollout is rolling and zero-downtime).

## Hotfix process

1. Branch from the affected tag: `git checkout vX.Y.Z -b release/vX.Y.Z-hotfix.1`.
2. Apply the minimal fix; commit; push.
3. Run the same pre-flight checklist (compressed: skip load-perf if the change is clearly low-risk).
4. Tag `vX.Y.Z-hotfix.1`; deploy to staging; deploy to prod.
5. Cherry-pick the fix back to `main` so it's not lost on the next regular release.

## Yanking a release

If a release is found to be broken post-deploy:

1. Run **Deploy → Production** with the previous tag.
2. Mark the broken tag with a `BROKEN-` prefix in the CHANGELOG ("v1.2.3 — yanked, see incident #N").
3. Open a post-mortem per `INCIDENT_RESPONSE.md`.

The image tag itself is not deleted from GHCR; it stays as a forensic artifact.
