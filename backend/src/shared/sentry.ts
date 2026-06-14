/**
 * Sentry Error Tracking Integration for FreeBlackMarket.com
 * 
 * Captures errors, performance data, and user context for monitoring.
 * 
 * Environment Variables:
 * - SENTRY_DSN: Sentry Data Source Name (required to enable)
 * - SENTRY_ENVIRONMENT: Environment name (defaults to NODE_ENV)
 * - SENTRY_RELEASE: Release version (defaults to package.json version)
 * - SENTRY_SAMPLE_RATE: Transaction sample rate 0-1 (default: 0.1)
 * 
 * Usage:
 * ```typescript
 * import { initSentry, captureException, setUser } from "./shared/sentry"
 * 
 * // Initialize early in app startup
 * initSentry()
 * 
 * // Capture errors
 * try {
 *   await riskyOperation()
 * } catch (error) {
 *   captureException(error, { tags: { module: "checkout" } })
 * }
 * 
 * // Set user context after authentication
 * setUser({ id: "user_123", email: "user@example.com" })
 * ```
 */


import { createLogger } from "./logger"

const logger = createLogger("Sentry")

// Sentry types - defined inline since @sentry/node is optional
interface SentryModule {
  init: (options: Record<string, unknown>) => void
  withScope: <T>(callback: (scope: SentryScope) => T) => T
  captureException: (error: unknown) => string
  captureMessage: (message: string, level?: string) => string
  setUser: (user: SentryUser | null) => void
  addBreadcrumb: (breadcrumb: Record<string, unknown>) => void
  startInactiveSpan: (options: Record<string, unknown>) => { finish: () => void }
  flush: (timeout: number) => Promise<boolean>
}

interface SentryScope {
  setTag: (key: string, value: string) => void
  setExtra: (key: string, value: unknown) => void
  setUser: (user: SentryUser) => void
  setLevel: (level: string) => void
}

// Sentry is optional - we use a mock if not installed or configured
let Sentry: SentryModule | null = null

interface SentryUser {
  id?: string
  email?: string
  username?: string
  ip_address?: string
  [key: string]: unknown
}

interface SentryContext {
  tags?: Record<string, string>
  extra?: Record<string, unknown>
  user?: SentryUser
  level?: "fatal" | "error" | "warning" | "info" | "debug"
}

interface SentryConfig {
  dsn?: string
  environment?: string
  release?: string
  sampleRate?: number
  tracesSampleRate?: number
  debug?: boolean
}

/**
 * Initialize Sentry error tracking
 * Safe to call even if Sentry is not installed - will gracefully no-op
 */
export async function initSentry(config: SentryConfig = {}): Promise<boolean> {
  const dsn = config.dsn || process.env.SENTRY_DSN

  if (!dsn) {
    logger.info("Sentry DSN not configured, error tracking disabled")
    return false
  }

  try {
    // Dynamic import to avoid requiring @sentry/node as a dependency
     
    const sentryModule = await import("@sentry/node").catch(() => null)
    if (!sentryModule) {
      logger.warn("@sentry/node not installed, error tracking disabled. Install with: pnpm add @sentry/node")
      return false
    }
    Sentry = sentryModule as unknown as SentryModule

    const environment = config.environment || process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development"
    const release = config.release || process.env.SENTRY_RELEASE || process.env.npm_package_version
    const sampleRate = config.tracesSampleRate ?? parseFloat(process.env.SENTRY_SAMPLE_RATE || "0.1")

    Sentry.init({
      dsn,
      environment,
      release,
      tracesSampleRate: sampleRate,
      debug: config.debug ?? false,

      // Filter out noisy errors
      ignoreErrors: [
        // Network errors
        "Network request failed",
        "Failed to fetch",
        "NetworkError",
        // User-caused errors
        "AbortError",
        // Common non-actionable errors
        "ResizeObserver loop limit exceeded",
      ],

      // Sanitize sensitive data
      beforeSend(event) {
        // Remove sensitive headers
        if (event.request?.headers) {
          delete event.request.headers["authorization"]
          delete event.request.headers["cookie"]
          delete event.request.headers["x-api-key"]
        }
        return event
      },
    })

    logger.info("Sentry initialized", { environment, release, sampleRate })
    return true
  } catch (error) {
    logger.warn("Failed to initialize Sentry - @sentry/node may not be installed", { error })
    return false
  }
}

/**
 * Capture an exception and send to Sentry
 */
export function captureException(error: unknown, context?: SentryContext): string | undefined {
  if (!Sentry) {
    // Log locally if Sentry not initialized
    logger.error("Untracked exception", error, context?.extra)
    return undefined
  }

  return Sentry.withScope((scope) => {
    if (context?.tags) {
      Object.entries(context.tags).forEach(([key, value]) => {
        scope.setTag(key, value)
      })
    }

    if (context?.extra) {
      Object.entries(context.extra).forEach(([key, value]) => {
        scope.setExtra(key, value)
      })
    }

    if (context?.user) {
      scope.setUser(context.user)
    }

    if (context?.level) {
      scope.setLevel(context.level)
    }

    return Sentry!.captureException(error)
  })
}

/**
 * Capture a message (non-error event)
 */
export function captureMessage(
  message: string,
  level: "fatal" | "error" | "warning" | "info" | "debug" = "info",
  context?: SentryContext
): string | undefined {
  if (!Sentry) {
    logger.info(`Untracked message: ${message}`, context?.extra)
    return undefined
  }

  return Sentry.withScope((scope) => {
    if (context?.tags) {
      Object.entries(context.tags).forEach(([key, value]) => {
        scope.setTag(key, value)
      })
    }

    if (context?.extra) {
      Object.entries(context.extra).forEach(([key, value]) => {
        scope.setExtra(key, value)
      })
    }

    return Sentry!.captureMessage(message, level)
  })
}

/**
 * Set user context for all subsequent events
 */
export function setUser(user: SentryUser | null): void {
  if (Sentry) {
    Sentry.setUser(user)
  }
}

/**
 * Add breadcrumb for debugging
 */
export function addBreadcrumb(breadcrumb: {
  message: string
  category?: string
  level?: "fatal" | "error" | "warning" | "info" | "debug"
  data?: Record<string, unknown>
}): void {
  if (Sentry) {
    Sentry.addBreadcrumb({
      ...breadcrumb,
      timestamp: Date.now() / 1000,
    })
  }
}

/**
 * Start a performance transaction
 */
export function startTransaction(name: string, op: string) {
  if (!Sentry) {
    return {
      finish: () => {},
      startChild: () => ({ finish: () => {} }),
    }
  }

  return Sentry.startInactiveSpan({
    name,
    op,
    forceTransaction: true,
  })
}

/**
 * Flush pending events before shutdown
 */
export async function flushSentry(timeout = 2000): Promise<boolean> {
  if (!Sentry) {
    return true
  }

  try {
    return await Sentry.flush(timeout)
  } catch {
    return false
  }
}

/**
 * Express/Medusa error handler middleware
 */
export function sentryErrorHandler() {
  return (error: Error, req: unknown, res: unknown, next: (error: Error) => void) => {
    captureException(error, {
      tags: { handler: "express" },
    })
    next(error)
  }
}
