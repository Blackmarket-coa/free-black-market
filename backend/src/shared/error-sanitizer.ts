/**
 * Production error-response sanitizer.
 *
 * Wraps Medusa's canonical HTTP error handler (`@medusajs/framework/http`'s
 * `errorHandler`) so the framework keeps full ownership of error-type → status
 * mapping (no drift), and only post-processes the *response body* in production:
 *
 *  - For server errors (status >= 500), the raw `err.message` can carry internal
 *    detail (e.g. ORM/SQL text with table/column names from a `DB_ERROR`, or an
 *    unexpected-state message). In production those bodies are replaced with a
 *    generic message while the full error is logged via the structured logger
 *    and forwarded to Sentry (if configured).
 *  - Client errors (4xx — validation, not-found, auth) are passed through
 *    unchanged: their messages are intentional and the frontends depend on them.
 *  - In development/test, nothing is intercepted, so error output stays verbose.
 *
 * Wired as the `errorHandler` in `src/api/middlewares.ts`.
 */
import { errorHandler as coreErrorHandler } from "@medusajs/framework/http"
import type {
  MedusaRequest,
  MedusaResponse,
  MedusaNextFunction,
} from "@medusajs/framework/http"
import { createLogger } from "./logger"
import { captureException } from "./sentry"

const log = createLogger("api/error-handler")

const GENERIC_5XX_MESSAGE = "An internal server error occurred."

type ErrorBody = {
  code?: string
  type?: string
  message?: string
  [key: string]: unknown
}

/**
 * Factory mirroring the core `errorHandler()` shape so it can be passed straight
 * to `defineMiddlewares({ errorHandler: sanitizedErrorHandler() })`.
 */
export function sanitizedErrorHandler() {
  const core = coreErrorHandler()
  const isProduction = process.env.NODE_ENV === "production"

  return (
    err: unknown,
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction,
  ): void => {
    if (isProduction) {
      const originalJson = res.json.bind(res)
      ;(res as any).json = (body: ErrorBody) => {
        const status = res.statusCode
        if (status >= 500 && body && typeof body === "object") {
          // Full, unredacted detail stays server-side only.
          log.error(
            "Unhandled server error",
            err instanceof Error ? err : undefined,
            { path: req.path, method: req.method, status, code: body.code },
          )
          try {
            captureException(err, {
              tags: { handler: "http", path: req.path ?? "unknown" },
            })
          } catch {
            // Never let telemetry failures break the error response.
          }
          return originalJson({
            code: body.code ?? "api_error",
            type: body.type ?? "unknown_error",
            message: GENERIC_5XX_MESSAGE,
          })
        }
        return originalJson(body)
      }
    }

    return core(err, req, res, next)
  }
}
