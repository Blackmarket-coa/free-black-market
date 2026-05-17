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

## First-time setup

Items in this section are configured **outside** the repo and must exist before the deploy workflows can succeed. Confirm with the user / platform team which already exist; the rows in the **Cluster-external setup** section below track the off-repo state of each.

### Repository secrets (Settings → Secrets and variables → Actions)

| Secret | Used by | Format |
|--------|---------|--------|
| `STAGING_KUBE_CONFIG_DATA` | `staging-deploy.yml` | base64-encoded kubeconfig with cluster-admin or namespaced rights for `freeblackmarket-staging` |
| `PRODUCTION_KUBE_CONFIG_DATA` | `prod-deploy.yml` | base64-encoded kubeconfig for `freeblackmarket-production` |
| `GITLEAKS_LICENSE` | `security.yml` (gitleaks job) | optional; lifts the org-scan rate limit |
| `BACKEND_URL` | `ci.yml` `release-validation` job | full URL of the integration backend (no trailing slash) |
| `STORE_TOKEN` | `release-validation` | publishable / store API token |
| `VENDOR_TOKEN` | `release-validation` | vendor JWT |
| `ADMIN_TOKEN` | `release-validation` | admin JWT |

Encode a kubeconfig with `cat ~/.kube/config-prod | base64 -w0`; paste the result into the secret's value field. Do not commit kubeconfigs.

### GitHub environments (Settings → Environments)

| Environment | Required reviewers | URL | Used by |
|-------------|--------------------|-----|---------|
| `staging` | ≥ 1 (any platform engineer) | `https://staging.freeblackmarket.com` | `staging-deploy.yml` |
| `production` | ≥ 2 (on-call commander + engineering manager) | `https://freeblackmarket.com` | `prod-deploy.yml` |

Enable "Wait timer: 5 min" on `production` so a deploy can be cancelled before pods roll.

### GHCR (GitHub Container Registry)

The first run of `docker-build.yml` after a push to `main` creates four image repositories:

```
ghcr.io/<org>/free-black-market-backend
ghcr.io/<org>/free-black-market-storefront
ghcr.io/<org>/free-black-market-admin-panel
ghcr.io/<org>/free-black-market-vendor-panel
```

The workflow's `GITHUB_TOKEN` already has `packages: write` (declared at the top of `docker-build.yml`). After the first push, switch each package to **Internal** in `https://github.com/orgs/<org>/packages/container/<name>/settings` so the cluster can pull without a registry credential.

If the cluster is in a different network and cannot pull from GHCR directly, create an `imagePullSecret` and reference it in each Deployment's `spec.template.spec.imagePullSecrets`.

### External Secrets Operator (recommended)

The K8s manifests under `infrastructure/k8s/{staging,production}/10-externalsecrets.yaml` declare four `ExternalSecret` resources per environment that read from a `ClusterSecretStore` named `cluster-secret-store`. Install ESO once per cluster:

```bash
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets -n external-secrets --create-namespace
# Then create the ClusterSecretStore pointing at your secret backend (AWS SM /
# Vault / GCP SM / 1Password / Doppler) — see ESO docs for the provider stanza.
```

If ESO is not (yet) installed, delete `10-externalsecrets.yaml` from the manifests directory before the workflow runs and provision the four Secrets manually:

```bash
kubectl -n freeblackmarket-staging create secret generic backend-env \
  --from-literal=JWT_SECRET=... \
  --from-literal=COOKIE_SECRET=... \
  --from-literal=DATABASE_URL=... \
  # … all keys per the env templates …
```

Repeat for `storefront-env`, `admin-panel-env`, `vendor-panel-env`.

### DNS prerequisites

The deploy workflows hit these URLs as smoke tests immediately after rollout. Each must resolve to the cluster's load-balancer IP (or a global anycast / CDN that proxies to it) before the first deploy:

| Environment | Hostnames |
|-------------|-----------|
| Staging | `staging.freeblackmarket.com`, `staging-admin.freeblackmarket.com`, `staging-vendor.freeblackmarket.com`, `staging-api.freeblackmarket.com` |
| Production | `freeblackmarket.com`, `admin.freeblackmarket.com`, `vendor.freeblackmarket.com`, `api.freeblackmarket.com` |

cert-manager + the `letsencrypt-prod` `ClusterIssuer` annotated in the Ingress objects will issue the TLS certificates on first request.

### First-time-setup checklist (operator)

- [ ] Kubeconfigs base64-encoded and uploaded to repo secrets (`STAGING_KUBE_CONFIG_DATA`, `PRODUCTION_KUBE_CONFIG_DATA`).
- [ ] GitHub environments `staging` and `production` configured with reviewers.
- [ ] `GITLEAKS_LICENSE` set (optional).
- [ ] Release-validation tokens (`BACKEND_URL`, `STORE_TOKEN`, `VENDOR_TOKEN`, `ADMIN_TOKEN`) set.
- [ ] GHCR image repos visible after first `docker-build.yml` run; visibility set to Internal.
- [ ] External Secrets Operator installed in both clusters; `ClusterSecretStore` named `cluster-secret-store` reachable.
- [ ] DNS records for all 8 hostnames above point at the right LB.
- [ ] cert-manager installed; `letsencrypt-prod` `ClusterIssuer` exists.

## Cluster-external setup

These items are configured outside the cluster (or outside the repo) and the deploy workflows / runbooks reference them. Each row tracks whether the user has confirmed it exists.

| Item | Referenced by | Confirmed |
|------|---------------|-----------|
| PagerDuty rotation "Free Black Market" | `runbooks/ON_CALL.md` | _pending — confirm with user_ |
| Slack `#freeblackmarket-alerts` | `runbooks/INCIDENT_RESPONSE.md`, `OBSERVABILITY.md` | _pending_ |
| Slack `#freeblackmarket-oncall` | `runbooks/ON_CALL.md` | _pending_ |
| Slack `#freeblackmarket-engineering` | `runbooks/RELEASE.md` | _pending_ |
| Status page at `status.freeblackmarket.com` | `runbooks/INCIDENT_RESPONSE.md` | _pending_ |
| Sentry projects per app + DSN distribution | `OBSERVABILITY.md` | _pending_ |
| Grafana org folder `freeblackmarket` + 5 dashboards | `OBSERVABILITY.md`, `infrastructure/observability/grafana/README.md` | _pending_ |
| DB managed-snapshot policy (daily, 30 d retention) | `runbooks/BACKUP_RESTORE.md` | _pending_ |
| Cross-region MinIO/S3 replication on the media bucket | `runbooks/DR.md` | _pending_ |
| Route 53 / Cloudflare failover record sets | `runbooks/DR.md` | _pending_ |

When an item is confirmed, replace `_pending_` with the date and the operator who verified it (e.g. `2026-05-08 — alice`).
