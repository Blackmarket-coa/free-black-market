# Single Points of Failure Map

> Cross-link: [`AGGRESSIVE_OPERATIONS_GUIDE.md`](../AGGRESSIVE_OPERATIONS_GUIDE.md) §4.2 and §7.2.

This map inventories single points of failure across the consolidated FBM + Blackout deployment as seen from the FBM repository. A single point of failure (SPOF) is any component whose loss takes a Tier-1 user-visible surface offline. Each row records severity, blast radius, current mitigation state, and the milestone at which a stronger mitigation lands.

The map is updated whenever a new SPOF is introduced (new dependency, new external service) or an existing SPOF is mitigated (replication enabled, fallback ingress activated, co-maintainer onboarded).

## Severity legend

- **S1** — loss takes the entire ecosystem offline.
- **S2** — loss takes a Tier-1 surface offline (storefront, vendor panel, federation).
- **S3** — loss degrades a non-blocking surface or removes a guardrail.

## Inventory

| ID | Component | Severity | Blast radius | Current mitigation | Target mitigation (milestone) |
|----|-----------|----------|--------------|--------------------|-------------------------------|
| SPOF-01 | Primary HP DL360 server (FBM + Synapse co-located) | S1 | Loss of substrate, storefront, vendor panel, federation, analytics | Nightly encrypted Postgres dumps to offsite (foundation deliverable, see [`runbooks/BACKUP_RESTORE.md`](../runbooks/BACKUP_RESTORE.md)) | Postgres streaming replication to secondary server (density milestone); multi-host deployment (infrastructure milestone, if scale warrants) |
| SPOF-02 | Cloudflare Tunnel (sole ingress) | S1 | All public ingress lost; storefront and federation unreachable | Documented fallback nginx + Let's Encrypt config (foundation; doc only) | Fallback nginx ingress enabled and tested (differentiation milestone) |
| SPOF-03 | Postgres instance (hosts FBM Medusa schema **and** Synapse state) | S1 | Both layers lost simultaneously; recovery from dump is the only path | Nightly encrypted dumps; per-database autovacuum baseline | Streaming replication to secondary (density milestone); evaluate Synapse worker mode or Dendrite/conduwuit migration if Postgres I/O becomes binding (infrastructure milestone) |
| SPOF-04 | Secrets manager (Vault, Infisical, or SOPS — choice pending §2.3) | S2 | Deploy and rotation blocked; no immediate user impact while running secrets stay loaded | Decision and migration runbook ([`runbooks/SECRETS_MANAGER_MIGRATION.md`](../runbooks/SECRETS_MANAGER_MIGRATION.md)) (foundation deliverable) | Backup/replica of the chosen manager per its native HA story (differentiation milestone) |
| SPOF-05 | Maintainer (sole human operator) | S1 | No deploys, no incident response, no secret rotation, no merges | Bus-factor runbooks (foundation); identity hardening with hardware key + 2FA (foundation); co-maintainer onboarding doc ([`CO_MAINTAINER_ONBOARDING.md`](./CO_MAINTAINER_ONBOARDING.md)) (foundation) | Co-maintainer with deploy access onboarded (differentiation milestone); two-person on-call rotation (infrastructure milestone) |
| SPOF-06 | GitHub organization owner account | S2 | Loss of repo control, CI access, secrets in Actions | Hardware key + 2FA on owner account (foundation); passphrase manager with emergency-access delegate | Second org owner once a co-maintainer reaches autonomy (density milestone) |
| SPOF-07 | MinIO single-node object store | S2 | Listing media, vendor uploads, and digital-product fulfillment artifacts unavailable | Daily bucket sync to offsite (foundation; see [`runbooks/BACKUP_RESTORE.md`](../runbooks/BACKUP_RESTORE.md)) | MinIO multi-node erasure coding once tenant uploads grow (infrastructure milestone) |
| SPOF-08 | Stellar / USDC settlement rail | S2 | Coalition Credits cannot settle externally; internal ledger continues to record | Operate against testnet during foundation; mainnet cutover gated on §5.2 entry | Multi-rail settlement (alternate USDC issuer or Circle CCTP path) evaluated in density milestone |
| SPOF-09 | Cloudflare account (DNS + Tunnel + Pages) | S2 | DNS lost; ingress lost via SPOF-02 | Hardware key + 2FA on Cloudflare; account recovery delegate | Document Cloudflare → AWS Route 53 + nginx fallback in DR runbook (differentiation milestone) |
| SPOF-10 | Container registry (GHCR) | S3 | New deploys blocked; running services unaffected | Image pin in compose; rebuild from source as fallback | Mirror critical images to a second registry (infrastructure milestone) |

## Update procedure

1. When opening a PR that introduces a new external dependency, infrastructure component, or single-host service, add a row to the inventory table above with `pending` in **Current mitigation** if no mitigation ships in the same PR.
2. When a mitigation ships, update the row's **Current mitigation** column and link the runbook or commit that delivered it.
3. The bus-factor drill (see [`BUS_FACTOR_DRILL_CADENCE.md`](./BUS_FACTOR_DRILL_CADENCE.md)) walks this map row-by-row; any row whose mitigation cannot be exercised by the drill participant is downgraded back to `pending`.

## Cross-repository note

This map covers FBM-side and shared infrastructure SPOFs only. The Blackout repository maintains its own SPOF inventory under `docs/operations/SPOF_MAP.md` in that repo, covering Synapse-specific SPOFs (federation senders, TURN allocation, appservice transactions endpoint). The two maps overlap on SPOF-01 and SPOF-03 because the Postgres host is shared.
