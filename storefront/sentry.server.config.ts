// Sentry server-runtime initialiser. Loaded by instrumentation.ts when
// SENTRY_DSN is set. Imports are dynamic so the dep is optional.
//
// Add `@sentry/nextjs` to package.json before enabling in production. Until
// then this module logs once and returns.

const dsn = process.env.SENTRY_DSN

if (dsn) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const Sentry = require("@sentry/nextjs")
    Sentry.init({
      dsn,
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
      tracesSampleRate: parseFloat(process.env.SENTRY_SAMPLE_RATE || "0.1"),
      enabled: true,
    })
  } catch (err) {
    console.warn(
      "[sentry.server.config] @sentry/nextjs is not installed; install it to enable server error reporting."
    )
  }
}

export {}
