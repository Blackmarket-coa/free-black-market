// Sentry browser-runtime initialiser. Next.js (15.3+) auto-loads
// `instrumentation-client.ts` on the client — so this replaces the previously
// orphaned `sentry.client.config.ts`, which was imported nowhere and therefore
// never initialised the browser SDK. No-ops when NEXT_PUBLIC_SENTRY_DSN is unset.
import * as Sentry from "@sentry/nextjs"

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || "production",
    tracesSampleRate: parseFloat(
      process.env.NEXT_PUBLIC_SENTRY_SAMPLE_RATE || "0.1"
    ),
  })
}

// Instruments client-side route transitions (no-op until Sentry.init runs).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
