# Grafana dashboards

Source-of-truth JSON for the production Grafana dashboards listed in `docs/OBSERVABILITY.md`.

## Why this directory exists

`OBSERVABILITY.md` declares five canonical dashboards under the `freeblackmarket` Grafana folder:

1. Service overview (RPS, P50/P95/P99, error rate)
2. DB pool saturation
3. Redis queue depth
4. Cart-to-checkout funnel
5. Vendor onboarding funnel

Until automated provisioning lands (tracked separately), the dashboards live in Grafana and their JSON is committed here as a forensic backup. If the Grafana org is ever rebuilt, an operator can re-import each `.json` file via **Dashboards → Import**.

## File naming

```
<area>-<dashboard-name>.json
```

Examples:
- `service-service-overview.json`
- `infra-db-pool.json`
- `infra-redis-queue-depth.json`
- `funnel-cart-to-checkout.json`
- `funnel-vendor-onboarding.json`

Use kebab-case, no spaces. The `<area>` prefix groups related dashboards alphabetically when listed.

## How to export from Grafana

1. Open the dashboard.
2. **Share** → **Export** → **Save to file**. Tick **"Export for sharing externally"** so panel UIDs are normalised; this prevents drift when other operators import the JSON.
3. Save the file as `<area>-<dashboard-name>.json` here.
4. Open a PR. The reviewer can sanity-check the diff — Grafana exports are deterministic if you remember to tick the "external" box.

## How to import into a fresh Grafana

```bash
for f in *.json; do
  curl -sS -X POST -H "Authorization: Bearer $GRAFANA_API_TOKEN" \
    -H "Content-Type: application/json" \
    --data-binary "@$f" \
    "https://grafana.example.com/api/dashboards/db" | jq .status
done
```

The token must have **Editor** rights on the `freeblackmarket` folder. Set the folder UID via the Grafana UI before running the loop, then add `"folderUid": "..."` to each payload (the export file does **not** include the folder).

## What lives where

| Concern | Location |
|---------|----------|
| Dashboard JSON | this directory |
| Dashboard catalogue + intent | `docs/OBSERVABILITY.md` |
| Alert rules | provisioned in Grafana Cloud directly (no JSON in repo yet) |
| Datasource definitions | configured at cluster install time, not committed |

When automated provisioning is adopted (Grafana Operator / Helm `grafana.dashboards.providers`), this directory is the source. The README will be updated then.
