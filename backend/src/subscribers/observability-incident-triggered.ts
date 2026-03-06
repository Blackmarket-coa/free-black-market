import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { sendIncidentToSinks } from "../shared/observability-sinks"

type IncidentPayload = {
  provider?: "pagerduty" | "datadog" | "grafana"
  severity: "low" | "medium" | "high" | "critical"
  service: string
  incident_key: string
  details?: Record<string, unknown>
}

export default async function observabilityIncidentTriggeredHandler({
  event,
  container,
}: SubscriberArgs<IncidentPayload>) {
  const logger = container.resolve("logger")
  const data = event.data

  await sendIncidentToSinks(
    {
      provider: data.provider,
      severity: data.severity,
      service: data.service,
      incident_key: data.incident_key,
      details: data.details,
    },
    { warn: (msg) => logger.warn(msg) }
  )
}

export const config: SubscriberConfig = {
  event: "observability.incident.triggered",
}
