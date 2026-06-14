import { createLogger } from "../shared/logger"
const log = createLogger("lib/instrumentation")
/**
 * Lightweight instrumentation surface for FBM modules.
 *
 * Today: emits structured-JSON log lines on stderr that grep / jq
 * pipelines can read, plus a process-level in-memory counter map an
 * `/admin/.../metrics` route can read. This is intentionally
 * dependency-free so the same call sites work whether `prom-client` or
 * `@opentelemetry/api` is later wired in.
 *
 * Migration plan: when `prom-client` lands in deps, swap the body of
 * `emitMetric` for a `Counter`/`Histogram` registry; keep the call-site
 * shape stable so call sites need no further change.
 */

const counters = new Map<string, number>()

export function emitMetric(
  name: string,
  labels: Record<string, string | number | boolean> = {},
  value = 1
): void {
  const key = stableKey(name, labels)
  counters.set(key, (counters.get(key) ?? 0) + value)
  const payload = {
    metric: name,
    value,
    labels,
    ts: new Date().toISOString(),
  }
   
  log.warn(JSON.stringify(payload))
}

export function snapshotMetrics(): Array<{
  name: string
  labels: Record<string, string | number | boolean>
  value: number
}> {
  const out: Array<{
    name: string
    labels: Record<string, string | number | boolean>
    value: number
  }> = []
  for (const [key, value] of counters.entries()) {
    const [name, labelsJson] = key.split("\x01")
    out.push({
      name,
      labels: labelsJson ? (JSON.parse(labelsJson) as Record<string, string | number | boolean>) : {},
      value,
    })
  }
  return out
}

export function resetMetricsForTesting(): void {
  counters.clear()
}

function stableKey(
  name: string,
  labels: Record<string, string | number | boolean>
): string {
  const sortedKeys = Object.keys(labels).sort()
  const sorted: Record<string, string | number | boolean> = {}
  for (const k of sortedKeys) sorted[k] = labels[k]
  return `${name}\x01${JSON.stringify(sorted)}`
}
