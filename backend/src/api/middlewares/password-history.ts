import { createLogger } from "../../shared/logger"
const log = createLogger("api/middlewares/password-history")
import type {
  MedusaRequest,
  MedusaResponse,
  MedusaNextFunction,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import Scrypt from "scrypt-kdf"
import jwt from "jsonwebtoken"
import { PASSWORD_HISTORY_MODULE } from "../../modules/password-history"
import type PasswordHistoryService from "../../modules/password-history/service"

/**
 * Verify a password against a scrypt hash (base64 encoded)
 * MedusaJS uses scrypt-kdf for password hashing
 */
async function verifyPassword(password: string, hashBase64: string): Promise<boolean> {
  try {
    const hashBuffer = Buffer.from(hashBase64, "base64")
    return await Scrypt.verify(hashBuffer, password)
  } catch (error) {
    log.error("[password-history] Error verifying password:", error)
    return false
  }
}

/**
 * Configuration for password history checking
 */
const PASSWORD_HISTORY_CONFIG = {
  // Number of previous passwords to check against (0 = unlimited)
  maxHistoryCount: 5,
  // Enable/disable password history checking
  enabled: true,
}

/**
 * Decode a password reset token to extract auth identity info
 * MedusaJS password reset tokens contain: entity_id (email), provider, exp, iat
 */
function decodeResetToken(token: string): { entityId: string; provider: string } | null {
  try {
    // Password reset tokens are JWTs - decode without verification to get payload
    // (the actual verification is done by MedusaJS)
    const payload = jwt.decode(token) as Record<string, unknown> | null
    if (!payload) return null

    const entityId =
      (payload.entity_id as string) ||
      (payload.email as string) ||
      null

    const provider = (payload.provider as string) || "emailpass"

    if (!entityId) return null

    return { entityId, provider }
  } catch (error) {
    log.error("[password-history] Failed to decode reset token:", error)
    return null
  }
}

/**
 * Middleware to prevent password reuse
 *
 * This middleware intercepts password update requests and:
 * 1. Extracts the auth identity ID from the reset token
 * 2. Retrieves the current password hash from provider_identity
 * 3. Checks if the new password matches any previous passwords
 * 4. If a match is found, rejects the request
 * 5. After successful update, stores the old password hash in history
 */
export async function preventPasswordReuseMiddleware(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  log.info(`[password-history] Middleware invoked for ${req.method} ${req.path}`)

  // Skip if password history is disabled
  if (!PASSWORD_HISTORY_CONFIG.enabled) {
    log.info("[password-history] Password history disabled, skipping")
    return next()
  }

  // Only process requests with password in the body
  const body = req.body as Record<string, unknown> | undefined
  if (!body?.password || typeof body.password !== "string") {
    log.info("[password-history] No password in body, skipping")
    return next()
  }

  const newPassword = body.password

  // Get the reset token from the Authorization header or query parameter
  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : (req.query.token as string)

  if (!token) {
    log.info("[password-history] No token found, skipping")
    return next()
  }

  // Decode the reset token to get auth identity info
  const tokenInfo = decodeResetToken(token)
  if (!tokenInfo) {
    log.warn("[password-history] Could not decode reset token - skipping history check")
    return next()
  }

  const { entityId, provider } = tokenInfo

  try {
    const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

    // Look up the auth_identity_id using the email (entity_id) from the token
    // The provider_identity table stores the email in entity_id field
    const providerResult = await pgConnection.raw(`
      SELECT pi.auth_identity_id, pi.provider_metadata
      FROM provider_identity pi
      WHERE pi.entity_id = ?
        AND pi.provider = ?
      LIMIT 1
    `, [entityId, provider])

    const providerData = providerResult.rows?.[0]
    if (!providerData?.auth_identity_id) {
      log.warn(`[password-history] Could not find auth identity for email: ${entityId}`)
      return next()
    }

    const authIdentityId = providerData.auth_identity_id

    // Parse provider_metadata - raw SQL returns it as a JSON string
    let providerMetadata: Record<string, unknown> = {}
    if (providerData.provider_metadata) {
      if (typeof providerData.provider_metadata === "string") {
        try {
          providerMetadata = JSON.parse(providerData.provider_metadata)
        } catch (e) {
          log.warn("[password-history] Failed to parse provider_metadata:", e)
        }
      } else {
        // Already an object (e.g., if using a different query method)
        providerMetadata = providerData.provider_metadata as Record<string, unknown>
      }
    }

    const currentPasswordHash = providerMetadata.password as string | undefined

    log.info(`[password-history] Auth identity: ${authIdentityId}`)
    log.info(`[password-history] Provider metadata keys: ${Object.keys(providerMetadata).join(", ")}`)
    log.info(`[password-history] Has current password hash: ${!!currentPasswordHash}`)
    if (currentPasswordHash) {
      log.info(`[password-history] Password hash prefix: ${currentPasswordHash.substring(0, 10)}...`)
    }

    // Get password history for this auth identity
    let passwordHistoryService: PasswordHistoryService | null = null
    try {
      passwordHistoryService = req.scope.resolve(PASSWORD_HISTORY_MODULE)
    } catch (_e) {
      // Module not registered yet - skip history check but continue
      log.warn("[password-history] Password history module not available - skipping history check")
    }

    // Always check against current password (shouldn't set same password)
    // This check runs regardless of whether the password history module is available
    if (currentPasswordHash) {
      log.info(`[password-history] Comparing new password against current hash using scrypt...`)
      const matchesCurrent = await verifyPassword(newPassword, currentPasswordHash)
      log.info(`[password-history] Password match result: ${matchesCurrent}`)
      if (matchesCurrent) {
        log.info(`[password-history] User tried to reuse current password for auth_identity: ${authIdentityId}`)
        return res.status(400).json({
          message: "New password must be different from your current password.",
          type: "password_same_as_current",
        })
      }
    } else {
      log.info(`[password-history] No current password hash found, skipping current password check`)
    }

    if (passwordHistoryService) {
      // Get historical password hashes
      const historyEntries = await passwordHistoryService.listPasswordHistoryEntries(
        { auth_identity_id: authIdentityId },
        {
          order: { created_at: "DESC" },
          take: PASSWORD_HISTORY_CONFIG.maxHistoryCount || 100,
        }
      )

      // Check if new password matches any historical password
      for (const entry of historyEntries) {
        const isMatch = await verifyPassword(newPassword, entry.password_hash)
        if (isMatch) {
          log.info(`[password-history] Password reuse detected for auth_identity: ${authIdentityId}`)
          return res.status(400).json({
            message: "This password has been used before. Please choose a different password.",
            type: "password_reuse",
          })
        }
      }
    }

    // Store the current password hash after successful update
    // We use response interception to do this
    const originalSend = res.send.bind(res)
    res.send = function (data: any) {
      // Only store history on successful responses
      if (res.statusCode >= 200 && res.statusCode < 300 && currentPasswordHash && passwordHistoryService) {
        // Store the old password hash asynchronously (don't block response)
        passwordHistoryService
          .createPasswordHistoryEntries([
            {
              auth_identity_id: authIdentityId,
              actor_type: getActorTypeFromPath(req.path),
              password_hash: currentPasswordHash,
            },
          ])
          .then(() => {
            log.info(`[password-history] Stored old password hash for auth_identity: ${authIdentityId}`)
          })
          .catch((err) => {
            log.error("[password-history] Failed to store password history:", err)
          })
      }
      return originalSend(data)
    }

    next()
  } catch (error) {
    log.error("[password-history] Error checking password history:", error)
    // Don't block password reset on error - log and continue
    next()
  }
}

/**
 * Extract actor type from request path
 * e.g., /auth/seller/emailpass/update -> "seller"
 */
function getActorTypeFromPath(path: string): string {
  const match = path.match(/\/auth\/([^/]+)\//)
  return match?.[1] || "unknown"
}
