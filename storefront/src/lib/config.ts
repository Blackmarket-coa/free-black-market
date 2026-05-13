import Medusa from "@medusajs/js-sdk"
import { logger } from "./logger"

// Shape of the `next` option Next.js attaches to fetch RequestInit for
// route caching/tagging. Inlined here because Next 15.5.15 removed the
// previously-public `NextFetchRequestConfig` export from
// next/dist/server/config-shared.
type NextFetchRequestConfig = {
  revalidate?: number | false
  tags?: string[]
}

// Defaults to standard port for Medusa server
const MEDUSA_BACKEND_URL =
  process.env.MEDUSA_BACKEND_URL ||
  process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
  ""

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY || ""

// Log configuration in development/server startup
if (typeof window === "undefined") {
  logger.info("[Medusa Config] Backend URL:", MEDUSA_BACKEND_URL || "(not set)")
  logger.info(
    "[Medusa Config] Publishable Key:",
    PUBLISHABLE_KEY ? `${PUBLISHABLE_KEY.slice(0, 20)}...` : "(not set)"
  )
}

export const sdk = new Medusa({
  baseUrl: MEDUSA_BACKEND_URL,
  debug: process.env.NODE_ENV === "development",
  publishableKey: PUBLISHABLE_KEY,
})

type FetchQueryOptions = Omit<RequestInit, "headers" | "body"> & {
  headers?: Record<string, string | null | { tags: string[] }>
  query?: Record<string, string | number>
  body?: Record<string, any>
}

type MedusaFetchOptions = Omit<RequestInit, "headers" | "body"> & {
  headers?: Record<string, string | undefined>
  query?: Record<string, string | number | boolean | string[] | undefined>
  // medusa-js-sdk's client.fetch accepts a plain object body and handles
  // JSON serialization internally, so callers don't need to wrap it.
  body?: Record<string, unknown>
  next?: NextFetchRequestConfig
}

/**
 * Custom fetch wrapper that ensures x-publishable-api-key header is always sent
 * Use this instead of sdk.client.fetch to guarantee the header is present
 */
export async function medusaFetch<T>(
  path: string,
  options: MedusaFetchOptions = {}
): Promise<T> {
  if (!MEDUSA_BACKEND_URL) {
    throw new Error(
      "MEDUSA_BACKEND_URL is not set. Please configure this environment variable to point to your Medusa backend."
    )
  }

  if (!PUBLISHABLE_KEY) {
    throw new Error(
      "NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY is required but not set. Please check your environment variables."
    )
  }

  const { headers = {}, ...restOptions } = options

  try {
    return await sdk.client.fetch<T>(path, {
      ...restOptions,
      headers: {
        "x-publishable-api-key": PUBLISHABLE_KEY,
        ...headers,
      },
    })
  } catch (error: any) {
    const status =
      error?.status ||
      error?.statusCode ||
      error?.response?.status ||
      error?.cause?.status

    const method = (restOptions?.method || "GET").toUpperCase()
    const isExpectedCustomerAuthMiss =
      status === 401 && method === "GET" && path === "/store/customers/me"

    if (isExpectedCustomerAuthMiss) {
      logger.info(
        `[medusaFetch] ${method} ${path} returned 401 (unauthenticated session).`
      )
      throw error
    }

    logger.error("[medusaFetch] Request failed", {
      path,
      method,
      backendUrl: MEDUSA_BACKEND_URL,
      status,
      message: error?.message || String(error),
      responseData: error?.response?.data || null,
      cause: error?.cause || null,
    })
    throw error
  }
}

export async function fetchQuery(
  url: string,
  { method, query, headers, body }: FetchQueryOptions
) {
  if (!MEDUSA_BACKEND_URL) {
    throw new Error(
      "MEDUSA_BACKEND_URL is not set. Please configure this environment variable to point to your Medusa backend."
    )
  }

  if (!PUBLISHABLE_KEY) {
    throw new Error(
      "NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY is required but not set. Please check your environment variables."
    )
  }

  const params = Object.entries(query || {}).reduce(
    (acc, [key, value], index) => {
      if (value && value !== undefined) {
        const queryLength = Object.values(query || {}).filter((i) => !!i).length
        acc += `${key}=${value}${index + 1 <= queryLength ? "&" : ""}`
      }
      return acc
    },
    ""
  )

  const fullUrl = `${MEDUSA_BACKEND_URL}${url}${params && `?${params}`}`

  try {
    const res = await fetch(fullUrl, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-publishable-api-key": PUBLISHABLE_KEY,
        ...headers,
      },
      body: body ? JSON.stringify(body) : null,
    })

    const requestId =
      res.headers.get("x-request-id") ||
      res.headers.get("x-correlation-id") ||
      null

    let data
    try {
      data = await res.json()
    } catch {
      data = { message: res.statusText || "Unknown error" }
    }

    if (!res.ok) {
      logger.error("[fetchQuery] Request failed", {
        status: res.status,
        statusText: res.statusText,
        method,
        url,
        fullUrl,
        query,
        requestId,
        backendMessage: data?.message || null,
        backendType: data?.type || null,
        backendCode: data?.code || null,
        backendError: data?.error || null,
      })
    }

    return {
      ok: res.ok,
      status: res.status,
      requestId,
      error: res.ok
        ? null
        : {
            message: data?.message,
            type: data?.type,
            code: data?.code,
            requestId,
          },
      data: res.ok ? data : null,
    }
  } catch (error: any) {
    logger.error(
      `[fetchQuery] Network error for ${fullUrl}:`,
      error?.message || error
    )
    throw error
  }
}
