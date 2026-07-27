// Sentry edge-runtime initialiser. Loaded by instrumentation.ts on the edge
// runtime (Next middleware runs there) when SENTRY_DSN is set. No-ops when the
// DSN is unset.
import * as Sentry from "@sentry/nextjs"

const dsn = process.env.SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment:
      process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    tracesSampleRate: parseFloat(process.env.SENTRY_SAMPLE_RATE || "0.1"),
  })
}

export {}
