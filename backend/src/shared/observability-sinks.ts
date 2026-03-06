export type MetricRecord = {
  metric: string
  value: number
  tags?: Record<string, string>
  summary?: Record<string, unknown>
}

export type IncidentRecord = {
  provider?: "pagerduty" | "datadog" | "grafana"
  severity: "low" | "medium" | "high" | "critical"
  service: string
  incident_key: string
  details?: Record<string, unknown>
}

const postJson = async (url: string, payload: unknown, apiKey?: string) => {
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(payload),
  })
}

export async function sendMetricToSinks(record: MetricRecord, logger: { warn: (msg: string) => void }) {
  const datadogUrl = process.env.OBSERVABILITY_METRIC_SINK_URL
  const datadogApiKey = process.env.OBSERVABILITY_METRIC_SINK_API_KEY

  if (!datadogUrl) {
    logger.warn("[Observability] Metric sink URL not configured, metric emitted to event bus only")
    return
  }

  await postJson(datadogUrl, record, datadogApiKey)
}

export async function sendIncidentToSinks(record: IncidentRecord, logger: { warn: (msg: string) => void }) {
  const pagerdutyUrl = process.env.OBSERVABILITY_INCIDENT_SINK_URL
  const pagerdutyApiKey = process.env.OBSERVABILITY_INCIDENT_SINK_API_KEY

  if (!pagerdutyUrl) {
    logger.warn("[Observability] Incident sink URL not configured, incident emitted to event bus only")
    return
  }

  await postJson(pagerdutyUrl, record, pagerdutyApiKey)
}
