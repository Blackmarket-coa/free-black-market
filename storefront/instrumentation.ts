// Next.js server instrumentation entrypoint.
// Runs once on server start (both Node.js and Edge runtimes).
// Responsibilities:
//   1. Fail-closed on banned placeholder env values (production only).
//   2. Initialise Sentry server runtime when SENTRY_DSN is set.
//   3. Initialise OpenTelemetry SDK when OTEL_EXPORTER_OTLP_ENDPOINT is set.
//
// See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertProductionEnvOrThrow } = await import("./src/lib/config/assertEnv")
    assertProductionEnvOrThrow()

    if (process.env.SENTRY_DSN) {
      try {
        await import("./sentry.server.config")
      } catch (err) {
        console.warn("[instrumentation] Sentry server init skipped:", (err as Error).message)
      }
    }
  }
}
