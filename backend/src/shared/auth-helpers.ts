import { createLogger } from "./logger"
const log = createLogger("shared/auth-helpers")
import type { MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import jwt from "jsonwebtoken"
import { config } from "./config"

/**
 * Authentication context from MedusaJS
 */
interface AuthContext {
  actor_id?: string
  actor_type?: string
  auth_identity_id?: string
  app_metadata?: Record<string, unknown>
}

/**
 * Request with authentication context
 */
interface AuthenticatedRequest {
  auth_context?: AuthContext
  headers?: {
    authorization?: string
  }
  scope?: {
    resolve: (key: string) => any
  }
}

/**
 * Result type for auth extraction
 */
type AuthResult<T> = 
  | { success: true; id: T }
  | { success: false; error: string; status: number }

/**
 * Extract seller ID from authenticated request
 * 
 * @example
 * ```typescript
 * const result = extractSellerId(req, res)
 * if (!result.success) return // Response already sent
 * const sellerId = result.id
 * ```
 */
export function extractSellerId(
  req: AuthenticatedRequest,
  res: MedusaResponse
): AuthResult<string> {
  const sellerId =
    req.auth_context?.actor_id ??
    (typeof req.auth_context?.app_metadata?.seller_id === "string"
      ? req.auth_context?.app_metadata?.seller_id
      : undefined)

  if (!sellerId) {
    res.status(401).json({ 
      message: "Unauthorized - seller authentication required",
      type: "unauthorized"
    })
    return { success: false, error: "Unauthorized", status: 401 }
  }

  return { success: true, id: sellerId }
}

/**
 * Extract customer ID from authenticated request
 * 
 * @example
 * ```typescript
 * const result = extractCustomerId(req, res)
 * if (!result.success) return
 * const customerId = result.id
 * ```
 */
export function extractCustomerId(
  req: AuthenticatedRequest,
  res: MedusaResponse
): AuthResult<string> {
  const customerId = req.auth_context?.actor_id

  if (!customerId) {
    res.status(401).json({ 
      message: "Authentication required",
      type: "unauthorized"
    })
    return { success: false, error: "Unauthorized", status: 401 }
  }

  return { success: true, id: customerId }
}

/**
 * Extract driver ID from authenticated request
 */
export function extractDriverId(
  req: AuthenticatedRequest,
  res: MedusaResponse
): AuthResult<string> {
  const driverId = req.auth_context?.actor_id

  if (!driverId) {
    res.status(401).json({ 
      message: "Driver authentication required",
      type: "unauthorized"
    })
    return { success: false, error: "Unauthorized", status: 401 }
  }

  return { success: true, id: driverId }
}

/**
 * Extract admin user ID from authenticated request
 */
export function extractAdminId(
  req: AuthenticatedRequest,
  res: MedusaResponse
): AuthResult<string> {
  const adminId = req.auth_context?.actor_id

  if (!adminId) {
    res.status(401).json({ 
      message: "Admin authentication required",
      type: "unauthorized"
    })
    return { success: false, error: "Unauthorized", status: 401 }
  }

  return { success: true, id: adminId }
}

/**
 * Require seller ID - returns null if not authenticated and sends response
 * @param req - The authenticated request
 * @param res - The response object to send error if not authenticated
 * @returns The seller ID or null if not authenticated
 */
export async function requireSellerId(
  req: AuthenticatedRequest,
  res: MedusaResponse
): Promise<string | null> {
  const actorId = req.auth_context?.actor_id
  const authIdentityId = req.auth_context?.auth_identity_id
  const pgConnection = req.scope?.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const authModule = req.scope?.resolve(Modules.AUTH)
  const token = extractBearerToken(req.headers?.authorization)
  const decodedToken = token ? decodeAuthToken(token) : null

  const resolveSellerIdFromMember = async (memberId: string): Promise<string | null> => {
    if (!pgConnection) {
      return null
    }
    const result = await pgConnection.raw(
      `
      SELECT seller_id
      FROM member
      WHERE id = ?
      `,
      [memberId]
    )
    return result.rows?.[0]?.seller_id ?? null
  }

  const resolveLinkedSellerId = async (id?: string | null): Promise<string | null> => {
    if (!id) {
      return null
    }
    if (id.startsWith("sel_")) {
      return id
    }
    if (id.startsWith("mem_")) {
      return resolveSellerIdFromMember(id)
    }
    return null
  }

  if (actorId) {
    const sellerId = await resolveLinkedSellerId(actorId)
    if (sellerId) {
      return sellerId
    }
  }

  if (decodedToken?.sellerId) {
    const sellerId = await resolveLinkedSellerId(decodedToken.sellerId)
    if (sellerId) {
      return sellerId
    }
  }

  const resolvedAuthIdentityId = authIdentityId ?? decodedToken?.authIdentityId
  if (resolvedAuthIdentityId && authModule) {
    const identities = await authModule.listAuthIdentities({ id: [resolvedAuthIdentityId] })
    const authIdentity = identities?.[0]
    const appMetadata = authIdentity?.app_metadata as Record<string, unknown> | undefined
    const linkedSellerId =
      typeof appMetadata?.seller_id === "string" ? appMetadata.seller_id : null

    if (linkedSellerId) {
      const sellerId = await resolveLinkedSellerId(linkedSellerId)
      if (sellerId) {
        return sellerId
      }
    }
  }

  res.status(401).json({
    message: "Unauthorized - seller authentication required",
    type: "unauthorized",
  })
  return null
}

function extractBearerToken(authorization?: string): string | null {
  if (!authorization?.startsWith("Bearer ")) {
    return null
  }
  return authorization.slice(7)
}

export interface AuthTokenInfo {
  authIdentityId: string | null
  actorId: string | null
  actorType: string | null
  sellerId: string | null
}

export type TokenDecodeError =
  | "no_token"
  | "no_secret"
  | "token_expired"
  | "invalid_signature"
  | "malformed_token"
  | "unknown_error"

export type TokenDecodeResult =
  | { success: true; token: AuthTokenInfo }
  | { success: false; error: TokenDecodeError; message: string }

export function decodeAuthToken(token: string): AuthTokenInfo | null {
  const result = decodeAuthTokenWithError(token)
  return result.success ? result.token : null
}

export function decodeAuthTokenWithError(token: string): TokenDecodeResult {
  if (!config.JWT_SECRET) {
    log.error("[Auth] JWT_SECRET not configured")
    return {
      success: false,
      error: "no_secret",
      message: "Server authentication configuration error. Please contact support.",
    }
  }

  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as Record<string, unknown>

    const authIdentityId =
      (payload.auth_identity_id as string | undefined) ||
      (payload.sub as string | undefined) ||
      (payload.identity_id as string | undefined) ||
      (payload.user_id as string | undefined) ||
      null
    const actorId =
      (payload.actor_id as string | undefined) ||
      (payload.user_id as string | undefined) ||
      null
    const actorType =
      (payload.actor_type as string | undefined) ||
      (payload.actorType as string | undefined) ||
      null
    const sellerId =
      (payload.actor_id as string | undefined) ||
      (payload.seller_id as string | undefined) ||
      (payload.app_metadata as { seller_id?: string } | undefined)?.seller_id ||
      null

    return {
      success: true,
      token: { authIdentityId, actorId, actorType, sellerId },
    }
  } catch (err: unknown) {
    if (err instanceof jwt.TokenExpiredError) {
      return {
        success: false,
        error: "token_expired",
        message: "Your session has expired. Please log in again.",
      }
    }
    if (err instanceof jwt.JsonWebTokenError) {
      const errorMessage = (err as Error).message || ""
      if (errorMessage.includes("signature")) {
        return {
          success: false,
          error: "invalid_signature",
          message: "Invalid authentication token. Please log in again.",
        }
      }
      return {
        success: false,
        error: "malformed_token",
        message: "Invalid authentication token format. Please log in again.",
      }
    }
    log.error("[Auth] Unknown JWT verification error:", err)
    return {
      success: false,
      error: "unknown_error",
      message: "Authentication verification failed. Please log in again.",
    }
  }
}

export function decodeAuthTokenFromAuthorization(
  authorization?: string
): AuthTokenInfo | null {
  const result = decodeAuthTokenFromAuthorizationWithError(authorization)
  return result.success ? result.token : null
}

export function decodeAuthTokenFromAuthorizationWithError(
  authorization?: string
): TokenDecodeResult {
  const token = extractBearerToken(authorization)
  if (!token) {
    return {
      success: false,
      error: "no_token",
      message: "No authentication token provided.",
    }
  }
  return decodeAuthTokenWithError(token)
}

/**
 * Require customer ID - returns null if not authenticated and sends response
 * @param req - The authenticated request
 * @param res - The response object to send error if not authenticated
 * @returns The customer ID or null if not authenticated
 */
export function requireCustomerId(req: AuthenticatedRequest, res: MedusaResponse): string | null {
  const customerId = req.auth_context?.actor_id
  if (!customerId) {
    res.status(401).json({
      message: "Authentication required",
      type: "unauthorized"
    })
    return null
  }
  return customerId
}

/**
 * Require admin ID - returns null if not authenticated and sends response
 * @param req - The authenticated request
 * @param res - The response object to send error if not authenticated
 * @returns The admin ID or null if not authenticated
 */
export function requireAdminId(req: AuthenticatedRequest, res: MedusaResponse): string | null {
  const adminId = req.auth_context?.actor_id
  if (!adminId) {
    res.status(401).json({
      message: "Admin authentication required",
      type: "unauthorized"
    })
    return null
  }
  return adminId
}

/**
 * Require driver ID - returns null if not authenticated and sends response
 * @param req - The authenticated request
 * @param res - The response object to send error if not authenticated
 * @returns The driver ID or null if not authenticated
 */
export function requireDriverId(req: AuthenticatedRequest, res: MedusaResponse): string | null {
  const driverId = req.auth_context?.actor_id
  if (!driverId) {
    res.status(401).json({
      message: "Driver authentication required",
      type: "unauthorized"
    })
    return null
  }
  return driverId
}
