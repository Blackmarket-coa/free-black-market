/**
 * OpenTelemetry Instrumentation for FreeBlackMarket
 * 
 * Enables distributed tracing, metrics, and observability.
 * Exports to OTLP collector (Jaeger, Grafana Tempo, etc.) or Zipkin.
 * 
 * Environment variables:
 * - OTEL_ENABLED: Set to "true" to enable (default: false in dev, true in prod)
 * - OTEL_EXPORTER_OTLP_ENDPOINT: OTLP collector URL (e.g., "http://localhost:4318")
 * - OTEL_SERVICE_NAME: Service name override (default: "freeblackmarket-backend")
 * 
 * Refer to docs: https://docs.medusajs.com/learn/debugging-and-testing/instrumentation
 */
import { registerOtel } from "@medusajs/medusa"
import { initSentry } from "./src/shared/sentry"

// Determine if OpenTelemetry should be enabled
const isProduction = process.env.NODE_ENV === "production"
const otelEnabled = process.env.OTEL_ENABLED === "true" || (isProduction && process.env.OTEL_ENABLED !== "false")

export async function register() {
  // Initialize Sentry first so its process-level uncaughtException /
  // unhandledRejection handlers are registered as early as possible. Self-guards
  // on SENTRY_DSN (no-ops when unset) and is independent of OTEL — this is what
  // activates the already-wired 5xx capture point in shared/error-sanitizer.ts.
  await initSentry()

  if (!otelEnabled) {
    console.log("[OTEL] OpenTelemetry disabled. Set OTEL_ENABLED=true to enable.")
    return
  }

  const serviceName = process.env.OTEL_SERVICE_NAME || "freeblackmarket-backend"
  
  console.log(`[OTEL] Initializing OpenTelemetry for service: ${serviceName}`)

  try {
    registerOtel({
      serviceName,
      // OTLP exporter is configured via environment variables:
      // OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_HEADERS
      instrument: {
        http: true,      // Trace HTTP requests
        workflows: true, // Trace Medusa workflows
        query: true,     // Trace database queries
      },
    })
    
    console.log("[OTEL] OpenTelemetry initialized successfully")
  } catch (error) {
    console.error("[OTEL] Failed to initialize OpenTelemetry:", error)
  }
}