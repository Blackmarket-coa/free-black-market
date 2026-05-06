# Healthcheck Contract

Every app exposes a stable HTTP endpoint that container orchestrators (Docker, Kubernetes, Railway, ALB) use for liveness/readiness probes. The endpoints below are also baked into each Dockerfile's `HEALTHCHECK` directive and the repo-root `docker-compose.yml`.

## Endpoints

| App | Port | Liveness | Readiness | Sample 200 body |
|-----|-----:|----------|-----------|-----------------|
| backend | 9000 | `GET /health` | `GET /health/ready` | `{ "status": "ok", "service": "freeblackmarket-backend", "uptime": ..., "memory": { ... } }` |
| storefront | 3000 | `GET /api/health` | `GET /api/health` | `{ "status": "ok", "service": "freeblackmarket-storefront", "commit": "..." }` |
| admin-panel | 80 | `GET /healthz` | `GET /healthz` | `ok\n` (text/plain) |
| vendor-panel | 80 | `GET /healthz` | `GET /healthz` | `ok\n` (text/plain) |

The legacy storefront route `GET /api/healthcheck` is preserved for backwards compatibility with any existing operators; new probes should target `/api/health`.

## Probe behaviour

- **Liveness**: should return 200 as long as the process is reachable. No DB calls. Used by Kubernetes to restart hung containers.
- **Readiness**: returns 200 only after critical dependencies are reachable (DB, Redis). Used by Kubernetes to gate Service membership and by Compose to gate `depends_on: condition: service_healthy`.

The backend backend's `/health/ready` runs a lightweight `SELECT 1` against Postgres and a `PING` against Redis when `REDIS_URL` is set. If either fails, the route returns 503.

## Kubernetes probe snippets

```yaml
# backend pod
livenessProbe:
  httpGet: { path: /health, port: 9000 }
  initialDelaySeconds: 60
  periodSeconds: 30
  timeoutSeconds: 5
readinessProbe:
  httpGet: { path: /health/ready, port: 9000 }
  initialDelaySeconds: 30
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3

# storefront pod
livenessProbe:
  httpGet: { path: /api/health, port: 3000 }
  initialDelaySeconds: 20
  periodSeconds: 30
readinessProbe:
  httpGet: { path: /api/health, port: 3000 }
  initialDelaySeconds: 10
  periodSeconds: 10

# admin / vendor panel pods (nginx)
livenessProbe:
  httpGet: { path: /healthz, port: 80 }
  initialDelaySeconds: 5
  periodSeconds: 30
readinessProbe:
  httpGet: { path: /healthz, port: 80 }
  initialDelaySeconds: 5
  periodSeconds: 10
```

## Dockerfile parity

All four Dockerfiles ship a `HEALTHCHECK` directive matching the table above. `docker compose ps` will show `healthy` once each container's probe succeeds; this is how the compose stack gates `depends_on: condition: service_healthy`.

## Local verification

```bash
docker compose up --build -d
docker compose ps
curl -fsS localhost:9000/health
curl -fsS localhost:9000/health/ready
curl -fsS localhost:3000/api/health
curl -fsS localhost:7000/healthz   # admin-panel
curl -fsS localhost:7001/healthz   # vendor-panel
```
