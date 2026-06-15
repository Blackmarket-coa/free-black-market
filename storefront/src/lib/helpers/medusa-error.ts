import { logger } from "@/lib/logger"

/**
 * Normalize an error thrown by the Medusa JS SDK (or fetch) into a clean Error.
 *
 * The SDK error is NOT axios-shaped, so we must never assume `error.config` or
 * `error.response` exist — dereferencing `error.config.url` on a plain Error is
 * what produced the `Cannot access 'u' before initialization` / TDZ crash that
 * white-screened the storefront whenever a backend call failed. This formatter
 * reads whatever shape it gets and only ever throws its final, normalized Error.
 */
export default function medusaError(error: any): never {
  const status =
    error?.status ??
    error?.statusCode ??
    error?.response?.status ??
    error?.cause?.status ??
    null

  const data = error?.response?.data ?? error?.data ?? null
  const rawMessage =
    data?.message ?? data ?? error?.message ?? "An unknown error occurred."
  const message =
    typeof rawMessage === "string" ? rawMessage : JSON.stringify(rawMessage)

  logger.error("[medusaError] Request failed", { status, message })

  const normalized = message.charAt(0).toUpperCase() + message.slice(1)
  throw new Error(normalized.endsWith(".") ? normalized : `${normalized}.`)
}
