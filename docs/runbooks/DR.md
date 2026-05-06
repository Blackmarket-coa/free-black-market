# Disaster Recovery

**Last validated:** 2026-05-06

## Targets

| Metric | Target | Notes |
|--------|--------|-------|
| RTO (recovery time objective) | 4 hours | From "all primary-region capacity lost" to "site serving" in secondary region. |
| RPO (recovery point objective) | 15 minutes | Maximum acceptable data loss measured from last successful Postgres write. |

## Architecture invariants for DR

- Postgres uses managed read replicas in the secondary region with continuous WAL streaming.
- Object storage (MinIO/S3) uses cross-region replication.
- Redis is treated as ephemeral; no DR target.
- All Kubernetes manifests live in git (`infrastructure/k8s/**`); the secondary cluster is bootstrapped from the same manifests.
- Image registry (`ghcr.io`) is GitHub-hosted, not in-region; no replication required.
- DNS records point to a Route 53 / Cloudflare failover policy with a short TTL (60 s).

## Failover procedure

### 1. Declare the incident
Page CTO + secondary on-call. Open `#inc-dr-<date>`.

### 2. Promote the secondary Postgres
```bash
# Provider-specific. Example (AWS RDS):
aws rds promote-read-replica --db-instance-identifier freeblackmarket-prod-replica
```

### 3. Update secrets
Rotate the cluster's `DATABASE_URL` secret to the promoted instance hostname. External Secrets Operator should sync within 30 s; otherwise restart pods.

### 4. Apply manifests in the secondary cluster
```bash
KUBECONFIG=~/.kube/config-secondary kubectl apply -f infrastructure/k8s/production/
```

### 5. Flip DNS
Update the Route 53 / Cloudflare record set to the secondary region's load balancer.

### 6. Verify
Run the smoke checks from `DEPLOYMENT.md` step 8. Watch error rate and `/health/ready` for the first 30 minutes.

### 7. Communicate
Status-page update. Notify customers that orders placed within the RPO window may need to be reconciled.

## Failback

When the primary region is healthy, failback is the inverse:

1. Re-establish the primary as a read replica of the now-promoted secondary.
2. When replica lag is < 1 s, promote the primary again during a quiet window.
3. Flip DNS back.
4. Reconcile any orders / events from the divergence window using the audit logs.

## Drill log

| Date | Type | Outcome | RTO observed | RPO observed | Notes |
|------|------|---------|-------------:|-------------:|-------|
| _next: 2026-08_ | Quarterly DB restore | _pending_ | — | — | First drill after this runbook lands. |

Append rows here after each drill.

## Known gaps (tracked in `docs/AUDIT_DEBT.md`)

- Cross-region MinIO replication is provider-specific and currently configured manually; track automation in a follow-up.
- `infrastructure/k8s/{staging,production}/` directories are scaffolded; manifests are added as the platform team adopts the K8s deploy path.
