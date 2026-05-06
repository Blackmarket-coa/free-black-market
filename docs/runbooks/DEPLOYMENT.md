# Deployment Runbook

**Last validated:** 2026-05-06

This runbook covers the two supported deploy paths: generic Docker/Kubernetes (primary) and Railway (legacy).

## Path A — Generic Docker / Kubernetes (primary)

### Prerequisites

- GHCR access (`ghcr.io/<org>/free-black-market-{backend,storefront,admin-panel,vendor-panel}`).
- Kubeconfig stored as base64 in repo secrets:
  - `STAGING_KUBE_CONFIG_DATA`
  - `PRODUCTION_KUBE_CONFIG_DATA`
- `infrastructure/k8s/{staging,production}/` manifests (deployments, services, ingresses) with the placeholder tokens `__IMAGE_REGISTRY__` and `__IMAGE_TAG__`.
- Production env values stored in the cluster (e.g. via External Secrets Operator). The fail-closed env validator will refuse to start any pod missing required keys.

### Steps

1. **Cut a release branch.** From `main`, `git checkout -b release/vX.Y.Z`. CI runs the release-validation gate automatically.
2. **Wait for green builds.** All gates listed in `docs/PRODUCTION_READINESS.md` must pass.
3. **Confirm images exist.** `docker-build.yml` publishes images on every push. Verify with:
   ```bash
   docker buildx imagetools inspect ghcr.io/<org>/free-black-market-backend:sha-<short>
   ```
4. **Deploy to staging.** Run **Actions → Deploy → Staging → Run workflow**. The job pulls the kubeconfig, renders manifests with the chosen tag, applies them, waits for rollouts, then smoke-tests `/api/health`, `/healthz`, and `/health/ready`.
5. **Smoke-test staging manually** against the URLs in the workflow summary. Spend at least 15 minutes exercising the critical paths (storefront browse, vendor login, admin order list).
6. **Tag the release.** `git tag vX.Y.Z && git push origin vX.Y.Z`. The tag triggers `docker-build.yml`, which adds the `vX.Y.Z` tag to each image.
7. **Deploy to production.** Run **Actions → Deploy → Production → Run workflow**, supplying `image_tag: vX.Y.Z`. Production has GitHub environment protection; the configured approvers must approve before the job proceeds.
8. **Verify rollouts.** The workflow waits up to 15 minutes per deployment (`kubectl rollout status`) and then hits each healthcheck. If any step fails, stop and follow **Rollback** below.

### Rollback (production)

Re-run **Deploy → Production** with the previous known-good tag (e.g. `image_tag: vX.Y.(Z-1)`). The workflow will roll the deployments back; readiness probes gate the new pods so user impact is bounded to the rollout window.

If a manifest change (not just an image bump) needs to be reverted, `git revert` the offending commit, re-cut a release tag, and run **Deploy → Production** with that tag.

## Path B — Railway (legacy)

Railway remains wired for the backend. CI's `notify-deploy` job no longer asserts a Railway-specific message, but Railway still auto-deploys from `main` when its project is connected. The same `medusa-config.ts` startup guard catches banned secrets before Railway boots the container.

To deploy a panel/storefront on Railway, point the service at this repo, set the build command to `pnpm install --frozen-lockfile && pnpm build`, the start command to `pnpm start`, and configure all required env values per the relevant `.env.template`.

## Required environment per service

See the templates:
- `backend/.env.template`
- `backend/.env.staging.template`
- `storefront/.env.template`
- `admin-panel/.env.template`
- `vendor-panel/.env.template`

The fail-closed validator (`scripts/assert-env.mjs`) is invoked at boot for backend and storefront and refuses to start when banned placeholder values are detected.
