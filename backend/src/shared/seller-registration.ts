import { createLogger } from "./logger"
const log = createLogger("shared/seller-registration")
import { MedusaRequest } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { REQUEST_MODULE } from "../modules/request"
import RequestModuleService from "../modules/request/service"
import { decodeAuthTokenFromAuthorizationWithError } from "./auth-helpers"

/**
 * Resolve a potential member ID to a seller ID.
 * If the ID starts with "sel_", return it as-is (it's already a seller ID).
 * If the ID starts with "mem_", look up the seller_id from the member table.
 * Otherwise, return the ID as-is (may be a seller ID with different prefix or invalid).
 */
async function resolveToSellerId(req: MedusaRequest, id: string | null | undefined): Promise<string | null> {
  if (!id) {
    return null
  }

  // If it's already a seller ID, return it directly
  if (id.startsWith("sel_")) {
    return id
  }

  // If it's a member ID, look up the seller_id from the member table
  if (id.startsWith("mem_")) {
    try {
      const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
      const result = await pgConnection.raw(
        `
        SELECT seller_id
        FROM member
        WHERE id = ?
        `,
        [id]
      )
      const sellerId = result.rows?.[0]?.seller_id
      if (sellerId) {
        log.info(`[SellerRegistration] Resolved member ${id} to seller ${sellerId}`)
        return sellerId
      }
      log.warn(`[SellerRegistration] Member ${id} has no associated seller_id`)
      return null
    } catch (err) {
      log.error(`[SellerRegistration] Error resolving member to seller:`, err)
      return null
    }
  }

  // Return the ID as-is for other cases (might be a different entity type)
  return id
}

export interface RegistrationStatusResponse {
  status:
    | "approved"
    | "pending"
    | "rejected"
    | "cancelled"
    | "no_request"
    | "unauthenticated"
    | "unknown"
    | "error"
  seller_id?: string
  seller?: {
    id: string
    store_status?: "ACTIVE" | "SUSPENDED" | "INACTIVE" | null
  } | null
  store_status?: "ACTIVE" | "SUSPENDED" | "INACTIVE" | null
  request_id?: string
  message: string
  created_at?: string
  reviewer_note?: string
}

const getStoreStatus = (
  seller?: { store_status?: string | null } | null
): RegistrationStatusResponse["store_status"] => {
  const status = seller?.store_status ?? null
  if (status === "ACTIVE" || status === "SUSPENDED" || status === "INACTIVE") {
    return status
  }
  return null
}

const buildApprovedResponse = ({
  sellerId,
  seller,
  message,
  requestId,
}: {
  sellerId: string
  seller?: Record<string, unknown> | null
  message: string
  requestId?: string
}): RegistrationStatusResponse => ({
  status: "approved",
  seller_id: sellerId,
  seller: (seller as RegistrationStatusResponse["seller"]) ?? null,
  store_status: getStoreStatus(seller as { store_status?: string | null } | null),
  message,
  ...(requestId ? { request_id: requestId } : {}),
})

export const getSellerRegistrationStatus = async (
  req: MedusaRequest
): Promise<{ status: RegistrationStatusResponse; statusCode: number }> => {
  try {
    const tokenResult = decodeAuthTokenFromAuthorizationWithError(req.headers.authorization)
    const authContextIdentityId = (req as any).auth_context?.auth_identity_id

    // Check for authentication: either valid token or auth_context
    if (!tokenResult.success && !authContextIdentityId) {
      // Provide specific error message based on token decode failure
      if (tokenResult.error === "no_token") {
        return {
          statusCode: 401,
          status: {
            status: "unauthenticated",
            message: "Authentication required. Please provide a valid bearer token.",
          },
        }
      }
      if (tokenResult.error === "token_expired") {
        return {
          statusCode: 401,
          status: {
            status: "unauthenticated",
            message: "Your session has expired. Please log in again.",
          },
        }
      }
      // For other errors (invalid_signature, malformed_token, etc.)
      return {
        statusCode: 401,
        status: {
          status: "unauthenticated",
          message: tokenResult.message || "Invalid or expired authentication. Please log in again.",
        },
      }
    }

    const decodedToken = tokenResult.success ? tokenResult.token : null
    const authModule = req.scope.resolve(Modules.AUTH)

    const authIdentityId =
      decodedToken?.authIdentityId ?? authContextIdentityId ?? null

    // Get the raw ID which might be a member ID (mem_*) or seller ID (sel_*)
    const rawActorId = decodedToken?.sellerId ?? (req as any).auth_context?.actor_id ?? null
    // Resolve to actual seller ID (handles member ID to seller ID lookup)
    const sellerId = await resolveToSellerId(req, rawActorId)

    // A token can carry a seller/member claim that no longer resolves to a
    // seller row (deleted seller, duplicate registration, stale backfill).
    // That must NOT dead-end the session: fall through to the auth-identity →
    // request-history chain below, which can re-link the account or report an
    // actionable status. Only when every path is exhausted do we return 404.
    let staleSellerClaim: string | null = null

    if (sellerId) {
      const seller = await findSellerById(req, sellerId)
      if (seller) {
        return {
          statusCode: 200,
          status: buildApprovedResponse({
            sellerId,
            seller,
            message: "Your seller account is approved. You can access the vendor dashboard.",
          }),
        }
      }

      staleSellerClaim = sellerId
      log.warn(
        "[GET /auth/seller/registration-status] Seller ID present in token but not found; trying identity-based resolution:",
        sellerId
      )
    }

    const staleClaimResult = (): { status: RegistrationStatusResponse; statusCode: number } => ({
      statusCode: 404,
      status: {
        status: "error",
        seller_id: staleSellerClaim ?? undefined,
        seller: null,
        store_status: null,
        message: "Seller profile not found for this account. Please contact support.",
      },
    })

    if (!authIdentityId) {
      if (staleSellerClaim) {
        return staleClaimResult()
      }
      return {
        statusCode: 401,
        status: {
          status: "unauthenticated",
          message: "Invalid or expired authentication. Please log in again.",
        },
      }
    }

    const authIdentity = await getAuthIdentity(authModule, authIdentityId)
    if (!authIdentity) {
      if (staleSellerClaim) {
        return staleClaimResult()
      }
      return {
        statusCode: 401,
        status: {
          status: "unauthenticated",
          message: "Invalid authentication. Please log in again.",
        },
      }
    }

    const appMetadata = authIdentity.app_metadata as Record<string, unknown> | undefined
    if (appMetadata?.seller_id) {
      // The linked id may itself be a member id (Mercur links the member as
      // the seller actor), so resolve it the same way as the token claim.
      const linkedSellerId = await resolveToSellerId(req, String(appMetadata.seller_id))
      const seller = linkedSellerId ? await findSellerById(req, linkedSellerId) : null
      if (!seller) {
        log.warn(
          "[GET /auth/seller/registration-status] Seller ID present in auth metadata but not found:",
          appMetadata.seller_id
        )
      } else {
        return {
          statusCode: 200,
          status: buildApprovedResponse({
            sellerId: linkedSellerId as string,
            seller,
            message: "Your seller account is approved. You can access the vendor dashboard.",
          }),
        }
      }
    }

    return await checkRequests(req, authIdentityId, authModule)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    log.error("[GET /auth/seller/registration-status] Error:", message)
    return {
      statusCode: 500,
      status: {
        status: "error",
        message: "Failed to check registration status. Please try again later.",
      },
    }
  }
}

async function findSellerById(req: MedusaRequest, sellerId: string) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: sellers } = await query.graph({
    entity: "seller",
    fields: ["id", "store_status"],
    filters: { id: sellerId },
  })
  return sellers?.[0] ?? null
}

async function getAuthIdentity(authModule: any, authIdentityId: string) {
  const identities = await authModule.listAuthIdentities({ id: [authIdentityId] })
  if (!identities || identities.length === 0) return null
  log.info("[Auth identity] Found:", authIdentityId)
  return identities[0]
}

async function checkRequests(
  req: MedusaRequest,
  authIdentityId: string,
  authModule: any
): Promise<{ status: RegistrationStatusResponse; statusCode: number }> {
  const requestService = req.scope.resolve<RequestModuleService>(REQUEST_MODULE)
  const userRequests = await requestService.listRequests(
    {
      type: "seller",
      submitter_id: authIdentityId,
    },
    {
      order: { created_at: "DESC" },
    }
  )
  log.info(
    `[Requests] Found ${userRequests.length} requests for authIdentityId: ${authIdentityId}`
  )

  if (userRequests.length === 0) {
    return {
      statusCode: 200,
      status: {
        status: "no_request",
        message: "No registration request found. Please complete the registration process.",
      },
    }
  }

  const latestRequest = userRequests[0]

  log.info(
    `[Requests] Latest request status: ${latestRequest.status}, id: ${latestRequest.id}`
  )

  switch (latestRequest.status) {
    case "pending":
      return {
        statusCode: 200,
        status: {
          status: "pending",
          request_id: latestRequest.id,
          message:
            "Your registration request is pending approval. Please wait for an administrator to review your application.",
          created_at: latestRequest.created_at?.toISOString?.() ?? undefined,
        },
      }

    case "accepted":
      return await handleAcceptedRequest(req, latestRequest, authIdentityId, authModule)

    case "rejected":
      return {
        statusCode: 200,
        status: {
          status: "rejected",
          request_id: latestRequest.id,
          message:
            "Your registration request was not approved. Please contact support for more information.",
          reviewer_note: latestRequest.reviewer_note ?? undefined,
        },
      }

    case "cancelled":
      return {
        statusCode: 200,
        status: {
          status: "cancelled",
          request_id: latestRequest.id,
          message: "Your registration request was cancelled. You may submit a new registration.",
        },
      }

    default:
      return {
        statusCode: 200,
        status: {
          status: "unknown",
          request_id: latestRequest.id,
          message: "Unable to determine registration status. Please contact support.",
        },
      }
  }
}

async function handleAcceptedRequest(
  req: MedusaRequest,
  latestRequest: any,
  authIdentityId: string,
  authModule: any
): Promise<{ status: RegistrationStatusResponse; statusCode: number }> {
  try {
    const requestData = latestRequest.data as Record<string, any>
    const requestEmail: string | undefined = requestData?.member?.email

    const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

    const findMemberSellerIdByEmail = async (
      email?: string | null
    ): Promise<string | null> => {
      if (!email) {
        return null
      }
      const memberResult = await pgConnection.raw(
        `
        SELECT seller_id
        FROM member
        WHERE LOWER(email) = LOWER(?)
        ORDER BY created_at DESC
        LIMIT 1
        `,
        [email]
      )
      return memberResult.rows?.[0]?.seller_id ?? null
    }

    // Load the identity once: provider email for the lookup fallback, and the
    // current app_metadata so the re-link below doesn't clobber other keys.
    let identity: { app_metadata?: Record<string, unknown>; provider_identities?: { entity_id?: string }[] } | null = null
    try {
      const identities = await authModule.listAuthIdentities(
        { id: [authIdentityId] },
        { relations: ["provider_identities"] }
      )
      identity = identities?.[0] ?? null
    } catch (err: any) {
      log.warn("[Accepted request] Could not load auth identity:", err?.message)
    }

    let sellerId = await findMemberSellerIdByEmail(requestEmail)

    if (!sellerId) {
      // The request-payload email can drift from the login email (case
      // differences, admin edits). Try the identity's provider email too.
      const providerEmail = identity?.provider_identities
        ?.map((p) => p?.entity_id)
        .find((e): e is string => typeof e === "string" && e.includes("@"))
      if (
        providerEmail &&
        providerEmail.toLowerCase() !== requestEmail?.toLowerCase()
      ) {
        sellerId = await findMemberSellerIdByEmail(providerEmail)
      }
    }

    if (sellerId) {
      const seller = await findSellerById(req, sellerId)
      if (seller) {
        if (identity) {
          log.info("[Accepted request] Found seller, updating auth_identity")
          await authModule.updateAuthIdentities([
            {
              id: authIdentityId,
              // Merge, don't replace: the same identity can also be a
              // customer (customer_id) or carry provider metadata.
              app_metadata: {
                ...(identity.app_metadata ?? {}),
                seller_id: sellerId,
              },
            },
          ])
        }
        return {
          statusCode: 200,
          status: buildApprovedResponse({
            sellerId,
            seller,
            requestId: latestRequest.id,
            message: "Your seller account is approved. You can access the vendor dashboard.",
          }),
        }
      }
    }

    return {
      statusCode: 200,
      status: {
        status: "approved",
        request_id: latestRequest.id,
        message:
          "Your registration has been approved. Please log out and log back in to access the dashboard.",
      },
    }
  } catch (err: any) {
    log.error("[Accepted request] Error:", err.message)
    return {
      statusCode: 200,
      status: {
        status: "approved",
        request_id: latestRequest.id,
        message:
          "Your registration has been approved. Please log out and log back in to access the dashboard.",
      },
    }
  }
}
