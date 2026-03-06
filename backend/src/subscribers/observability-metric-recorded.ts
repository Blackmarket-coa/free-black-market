import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { sendMetricToSinks } from "../shared/observability-sinks"

type MetricPayload = {
  metric: string
  value: number
  tags?: Record<string, string>
  summary?: Record<string, unknown>
}

export default async function observabilityMetricRecordedHandler({
  event,
  container,
}: SubscriberArgs<MetricPayload>) {
  const logger = container.resolve("logger")
  const data = event.data

  await sendMetricToSinks(
    {
      metric: data.metric,
      value: data.value,
      tags: data.tags,
      summary: data.summary,
    },
    { warn: (msg) => logger.warn(msg) }
  )
}

export const config: SubscriberConfig = {
  event: "observability.metric.recorded",
}
