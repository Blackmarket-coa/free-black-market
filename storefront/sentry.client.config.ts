// Sentry browser-runtime initialiser. Imported from a layout/provider when
// NEXT_PUBLIC_SENTRY_DSN is set. Dynamic import keeps the dep optional.

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (typeof window !== "undefined" && dsn) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const Sentry = require("@sentry/nextjs")
    Sentry.init({
      dsn,
      environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || "production",
      tracesSampleRate: parseFloat(process.env.NEXT_PUBLIC_SENTRY_SAMPLE_RATE || "0.1"),
      enabled: true,
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      "[sentry.client.config] @sentry/nextjs is not installed; install it to enable browser error reporting."
    )
  }
}

export {}
