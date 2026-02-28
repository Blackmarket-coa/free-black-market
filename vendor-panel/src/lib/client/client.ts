import Medusa from "@medusajs/js-sdk"
import { devLogger } from "../logger"

// PUBLIC ROUTE CHECKER
export const isPublicAuthRoute = (url: string) => {
  return url.startsWith("/auth/") || url.startsWith("/vendor/auth")
}

// BACKEND CONFIG
const isBrowser = typeof window !== "undefined"
const runtimeBackend = isBrowser && (window as any).__MEDUSA_BACKEND_URL__
export const backendUrl = (runtimeBackend || __BACKEND_URL__) ?? "/"
export const publishableApiKey = __PUBLISHABLE_API_KEY__ ?? ""
const publishableHeader = publishableApiKey
  ? { "x-publishable-api-key": publishableApiKey }
  : {}

// AUTH TOKEN STORAGE
export const getAuthToken = () =>
  isBrowser ? window.localStorage.getItem("medusa_auth_token") || "" : ""

export const getAuthTokenPayload = (): Record<string, unknown> | null => {
  if (!isBrowser) {
    return null
  }

  const token = getAuthToken()
  if (!token) {
    return null
  }

  try {
    const tokenParts = token.split(".")
    if (tokenParts.length < 2) {
      return null
    }

    const payload = tokenParts[1]
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/")
    const padded = normalized + "===".slice((normalized.length + 3) % 4)
    const decoded = window.atob(padded)

    return JSON.parse(decoded) as Record<string, unknown>
  } catch (error) {
    if (import.meta.env.DEV) {
      devLogger.warn("Failed to decode auth token payload:", error)
    }
    return null
  }
}

export const setAuthToken = (token: string) => {
  if (isBrowser) {
    window.localStorage.setItem("medusa_auth_token", token)
  }
}

export const clearAuthToken = () => {
  if (isBrowser) {
    window.localStorage.removeItem("medusa_auth_token")
  }
}

// MEDUSA SDK INSTANCE
export const sdk = new Medusa({
  baseUrl: backendUrl,
  publishableKey: publishableApiKey,
  auth: {
    type: "jwt",
    jwtTokenStorageMethod: "local",
  },
})

export const publicAuthSdk = new Medusa({
  baseUrl: backendUrl,
  publishableKey: publishableApiKey,
  auth: {
    type: "jwt",
    jwtTokenStorageMethod: "memory",
  },
})

// Expose SDK in dev for console experimentation
if (process.env.NODE_ENV === "development" && isBrowser) {
  ;(window as any).__sdk = sdk
}

// UPLOAD FILES
export const uploadFilesQuery = async (files: any[]) => {
  const formData = new FormData()
  for (const { file } of files) formData.append("files", file)

  return await fetchQuery("/vendor/uploads", {
    method: "POST",
    body: formData,
    isForm: true,
  })
}

// IMPORT PRODUCTS
export const importProductsQuery = async (file: File) => {
  const formData = new FormData()
  formData.append("file", file)

  return await fetchQuery("/vendor/products/import", {
    method: "POST",
    body: formData,
    isForm: true,
  })
}

export const resolveOnlineStoreReferencesQuery = async (
  references: string[]
) => {
  return await fetchQuery("/vendor/products/resolve-references", {
    method: "POST",
    body: {
      references,
    },
  })
}

// FETCH QUERY WRAPPER
export const fetchQuery = async (
  url: string,
  {
    method,
    body,
    query,
    headers,
    isForm,
  }: {
    method: "GET" | "POST" | "DELETE"
    body?: object | FormData
    query?: Record<string, string | number>
    headers?: Record<string, string>
    isForm?: boolean
  }
) => {
  const isPublic = isPublicAuthRoute(url)
  const token = getAuthToken()

  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null) {
      continue
    }

    if (typeof value === "string" && value.trim() === "") {
      continue
    }

    params.set(key, String(value))
  }
  const queryString = params.toString()

  const requestUrl = `${backendUrl}${url}${queryString ? `?${queryString}` : ""}`
  const authHeaders = isPublic
    ? {}
    : token
      ? { Authorization: `Bearer ${token}` }
      : {}

  const requestBody: BodyInit | undefined = body
    ? isForm
      ? (body as BodyInit)
      : JSON.stringify(body)
    : undefined

  const response = await fetch(requestUrl, {
    method,
    credentials: isPublic ? "omit" : "include",
    headers: {
      ...authHeaders,
      ...publishableHeader,
      ...(!isForm && { "Content-Type": "application/json" }),
      ...headers,
    },
    body: requestBody,
  })

  if (!response.ok) {
    const contentType = response.headers.get("content-type") || ""
    const requestId =
      response.headers.get("x-request-id") ||
      response.headers.get("x-correlation-id") ||
      null
    const errorData = contentType.includes("application/json")
      ? await response.json().catch(() => ({}))
      : {}
    const errorText = !contentType.includes("application/json")
      ? await response.text().catch(() => "")
      : ""
    const errorContext = `${method} ${url} (${response.status} ${response.statusText})`
    const errorDetails = {
      status: response.status,
      statusText: response.statusText,
      method,
      url,
      requestUrl,
      requestId,
      backendMessage: errorData.message || null,
      backendType: errorData.type || null,
      backendCode: errorData.code || null,
      backendError: errorData.error || null,
      backendDetails: errorData.details || null,
      rawText: errorText || null,
      timestamp: new Date().toISOString(),
    }

    if (import.meta.env.DEV) {
      devLogger.error("[Vendor fetchQuery] Request failed", errorDetails)
    }

    if (!isPublic && response.status === 401) {
      clearAuthToken()
    }
    const baseMessage = errorData.message || errorText || "Unknown server error"
    const error = new Error(`${baseMessage} (${errorContext})`) as Error & {
      details?: typeof errorDetails
    }
    error.details = errorDetails

    throw error
  }

  return response.json()
}
