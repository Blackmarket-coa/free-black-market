// Browser telemetry init for the vendor panel.
// Loaded by the app entrypoint. Sentry init is dynamic so the dep is optional
// until the team commits to a SaaS provider.

const DSN = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env
  ?.VITE_SENTRY_DSN

export async function initTelemetry(): Promise<void> {
  if (!DSN) return
  try {
    const Sentry = await import("@sentry/browser")
    Sentry.init({
      dsn: DSN,
      environment: (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env
        ?.VITE_SENTRY_ENVIRONMENT || "production",
      tracesSampleRate: parseFloat(
        (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env
          ?.VITE_SENTRY_SAMPLE_RATE || "0.1"
      ),
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[telemetry] @sentry/browser is not installed; skipping init.")
  }
}
