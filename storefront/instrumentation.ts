// Next.js server instrumentation entrypoint.
//
// NOT LOADED TODAY (checked 2026-11-15): Next looks for instrumentation.* only
// beside the app directory, and this app is src/app, so Next reads
// src/instrumentation.ts and never builds this file. Nothing below runs: not
// the env guard, not the Sentry server/edge init, not onRequestError. Moving
// it into src/ (with its import paths fixed) is an open ledger item; prove the
// move with a build that emits .next/server/instrumentation.js.
//
// Meant to run once on server start (both Node.js and Edge runtimes).
// Responsibilities:
//   1. Fail-closed on banned placeholder env values (production only).
//   2. Initialise Sentry server/edge runtime when SENTRY_DSN is set.
//   3. Initialise OpenTelemetry SDK when OTEL_EXPORTER_OTLP_ENDPOINT is set.
//
// The browser SDK is initialised separately by `instrumentation-client.ts`,
// which Next auto-loads on the client.
//
// See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

// Captures errors thrown in React Server Components / route handlers (Next 15
// onRequestError hook). No-op until a Sentry config has run Sentry.init.
export { captureRequestError as onRequestError } from "@sentry/nextjs"

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

  if (process.env.NEXT_RUNTIME === "edge" && process.env.SENTRY_DSN) {
    try {
      await import("./sentry.edge.config")
    } catch (err) {
      console.warn("[instrumentation] Sentry edge init skipped:", (err as Error).message)
    }
  }
}
