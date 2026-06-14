import { createLogger } from "../../../shared/logger"
const log = createLogger("api/admin/auth-debug")
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /admin/auth-debug
 *
 * Debug endpoint to diagnose authentication issues.
 * Query params:
 *   - email: The email address to look up
 *   - actor_type: Optional actor type filter (seller, customer, user)
 *
 * This endpoint helps diagnose why login might fail by checking:
 * 1. provider_identity - is the email registered?
 * 2. auth_identity - what actor types are associated?
 * 3. member/seller chain - is the seller properly linked?
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ error: "Not found" })
  }

  const email = req.query.email as string
  const actorType = req.query.actor_type as string

  if (!email) {
    return res.status(400).json({
      error: "Missing 'email' query parameter",
      usage: "GET /admin/auth-debug?email=user@example.com&actor_type=seller"
    })
  }

  try {
    const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

    // 1. Check provider_identity table
    const providerIdentities = await pgConnection.raw(`
      SELECT
        pi.id,
        pi.entity_id,
        pi.provider,
        pi.auth_identity_id,
        pi.created_at
      FROM provider_identity pi
      WHERE LOWER(pi.entity_id) = LOWER(?)
      ORDER BY pi.created_at DESC
    `, [email])

    // 2. Get auth_identities for the provider_identities found
    const authIdentityIds = providerIdentities.rows?.map((p: any) => p.auth_identity_id) || []

    let authIdentities: any[] = []
    if (authIdentityIds.length > 0) {
      const authResult = await pgConnection.raw(`
        SELECT
          ai.id,
          ai.app_metadata,
          ai.created_at
        FROM auth_identity ai
        WHERE ai.id = ANY(?::text[])
        ORDER BY ai.created_at DESC
      `, [authIdentityIds])
      authIdentities = authResult.rows || []
    }

    // 3. For seller actor type, check the member/seller chain
    const sellerChain: any[] = []
    if (!actorType || actorType === "seller") {
      for (const authId of authIdentities) {
        const appMetadata = authId.app_metadata || {}
        const sellerId = appMetadata.seller_id

        if (sellerId) {
          // Check if this is a member_id (starts with "mem_") or seller_id
          if (sellerId.startsWith("mem_")) {
            // It's a member ID, look up the member and its seller
            const memberResult = await pgConnection.raw(`
              SELECT
                m.id as member_id,
                m.name as member_name,
                m.email as member_email,
                m.seller_id,
                s.id as seller_id_actual,
                s.name as seller_name,
                s.store_status,
                s.created_at as seller_created_at
              FROM member m
              LEFT JOIN seller s ON m.seller_id = s.id
        WHERE m.id = ?
            `, [sellerId])

            if (memberResult.rows?.[0]) {
              sellerChain.push({
                auth_identity_id: authId.id,
                app_metadata_seller_id: sellerId,
                type: "member_id",
                member: memberResult.rows[0],
              })
            }
          } else if (sellerId.startsWith("sel_")) {
            // It's a direct seller ID
            const sellerResult = await pgConnection.raw(`
              SELECT
                s.id,
                s.name,
                s.email,
                s.store_status,
                s.created_at
              FROM seller s
              WHERE s.id = ?
            `, [sellerId])

            if (sellerResult.rows?.[0]) {
              sellerChain.push({
                auth_identity_id: authId.id,
                app_metadata_seller_id: sellerId,
                type: "seller_id",
                seller: sellerResult.rows[0],
              })
            }
          }
        }
      }
    }

    // 4. Check if there are any request records for this email
    const requestRecords = await pgConnection.raw(`
      SELECT
        r.id,
        r.type,
        r.status,
        r.data,
        r.created_at
      FROM request r
      WHERE r.data->>'member'->>'email' = ?
         OR r.data->'member'->>'email' = ?
      ORDER BY r.created_at DESC
      LIMIT 5
    `, [email])

    // Build diagnosis
    const diagnosis: string[] = []

    if (providerIdentities.rows?.length === 0) {
      diagnosis.push("❌ Email not found in provider_identity table - user may not be registered")
    } else {
      diagnosis.push(`✓ Found ${providerIdentities.rows.length} provider_identity record(s)`)

      const providers = providerIdentities.rows.map((p: any) => p.provider)
      if (!providers.includes("emailpass")) {
        diagnosis.push("⚠️ No 'emailpass' provider found - user might have registered with a different method")
      }
    }

    if (authIdentities.length === 0) {
      diagnosis.push("❌ No auth_identity records found")
    } else {
      diagnosis.push(`✓ Found ${authIdentities.length} auth_identity record(s)`)

      // Check for seller_id in app_metadata
      const withSellerId = authIdentities.filter((a: any) => a.app_metadata?.seller_id)
      if (withSellerId.length === 0) {
        diagnosis.push("⚠️ No auth_identity has seller_id in app_metadata - seller might not be approved yet")
      }
    }

    if (sellerChain.length === 0) {
      diagnosis.push("⚠️ No seller chain found - auth might not be linked to an active seller")
    } else {
      for (const chain of sellerChain) {
        if (chain.type === "member_id") {
          const storeStatus = chain.member?.store_status
          if (storeStatus !== "ACTIVE") {
            diagnosis.push(`⚠️ Seller store_status is '${storeStatus}' - may be blocked from login`)
          } else {
            diagnosis.push(`✓ Seller '${chain.member?.seller_name}' is ACTIVE`)
          }
        }
      }
    }

    return res.json({
      email,
      actorType: actorType || "all",
      providerIdentities: providerIdentities.rows || [],
      authIdentities: authIdentities.map((a: any) => ({
        id: a.id,
        app_metadata: a.app_metadata,
        created_at: a.created_at,
      })),
      sellerChain,
      requestRecords: requestRecords.rows || [],
      diagnosis,
    })
  } catch (error: any) {
    log.error("[auth-debug] Error:", error)
    return res.status(500).json({
      error: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    })
  }
}
