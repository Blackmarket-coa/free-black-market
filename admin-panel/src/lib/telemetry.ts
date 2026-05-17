// Browser telemetry init for the admin panel.
// Loaded by the app entrypoint (e.g. main.tsx). Sentry init is dynamic so the
// dep is optional until the team commits to a SaaS provider.

const DSN = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env
  ?.VITE_SENTRY_DSN

export async function initTelemetry(): Promise<void> {
  if (!DSN) return
  try {
    // @sentry/browser is an optional peer dep; declared as a dynamic
    // import so missing-dep installs don't fail typecheck.
    const Sentry = (await import(
      /* @vite-ignore */ "@sentry/browser" as never
    )) as { init: (options: Record<string, unknown>) => void }
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
