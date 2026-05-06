# Observability

The platform ships three observability primitives, all opt-in via environment variables. They are wired in every app on the production code path, but stay no-ops when their configuration is absent.

## Stack

| Concern | Mechanism | Where it's wired |
|---|---|---|
| Tracing (OTel) | `@medusajs/medusa#registerOtel` (backend) and `@opentelemetry/sdk-node` (storefront) | `backend/instrumentation.ts`, `storefront/instrumentation.ts` |
| Error tracking | Sentry SDKs | `storefront/sentry.{client,server}.config.ts`, `admin-panel/src/lib/telemetry.ts`, `vendor-panel/src/lib/telemetry.ts` |
| Logs | JSON to stdout (backend); Next.js default (storefront); browser console (panels) | `backend/src/**` (logger TBD — tracked under `LG-1` in `AUDIT_DEBT.md`) |

## Environment contract

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `OTEL_ENABLED` | backend, storefront | `true` in prod, `false` otherwise | Enables OTel exporter |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | backend, storefront | _unset_ | OTLP/HTTP endpoint, e.g. `http://otel-collector:4318` |
| `OTEL_SERVICE_NAME` | backend, storefront | `freeblackmarket-{backend,storefront}` | Logical service name |
| `SENTRY_DSN` | backend, storefront, panels | _unset_ → no-op | Sentry project DSN |
| `SENTRY_ENVIRONMENT` | all | `NODE_ENV` | Tag for Sentry filtering |
| `SENTRY_SAMPLE_RATE` | all | `0.1` | Trace sample rate |
| `LOG_LEVEL` | backend | `info` in prod, `debug` otherwise | Pino-style log threshold (target — see `LG-1`) |

## Local stack

`docker-compose.yml` does **not** provision an OTel collector by default. To run tracing locally, add a one-shot collector container alongside the stack:

```yaml
otel-collector:
  image: otel/opentelemetry-collector-contrib:latest
  ports:
    - "4318:4318"
    - "4317:4317"
  command: ["--config=/etc/otel-collector-config.yaml"]
  volumes:
    - ./infrastructure/otel/collector.yaml:/etc/otel-collector-config.yaml:ro
```

## Dashboards

Production dashboards live in the Grafana org under the `freeblackmarket` folder (configured outside this repo). Each dashboard maps to one of:

- Service overview (RPS, P50/P95/P99, error rate)
- DB pool saturation
- Redis queue depth
- Cart-to-checkout funnel
- Vendor onboarding funnel

Adding a new dashboard: capture the JSON via Grafana's "share → export" and PR it under `infrastructure/observability/grafana/` (path created on first dashboard contribution).

## Alerting

Critical alert rules (5xx error rate > 1 % over 5 min, P95 > 1.5 s over 10 min, `/health/ready` failing for > 2 min) page the on-call rotation defined in `docs/runbooks/ON_CALL.md`. Lower-severity alerts post to the `#freeblackmarket-alerts` Slack channel.

## What's still in the backlog

Tracked in `docs/AUDIT_DEBT.md`:

- `LG-1`: replace `console.*` in backend with structured logger (target `v1.1.0`).
- `LG-2`/`LG-3`: same for storefront and admin panel.

Until those land, log-based alerts should grep for `level=error` or `[ERROR]` strings rather than parsing JSON fields.
