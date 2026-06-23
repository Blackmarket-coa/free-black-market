import { createLogger } from "../../../shared/logger"
const log = createLogger("api/admin/backfill-seller-auth")
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * POST /admin/backfill-seller-auth
 *
 * One-time endpoint to fix existing sellers whose auth_identity
 * records are missing the seller_id in app_metadata.
 *
 * Run via: curl -X POST https://your-backend/admin/backfill-seller-auth -H "Authorization: Bearer <token>"
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const authModule = req.scope.resolve(Modules.AUTH)

  const results: string[] = []
  let updated = 0
  let skipped = 0
  let errors = 0

  try {
    // Find all sellers with their members
    const sellersResult = await pgConnection.raw(`
      SELECT
        s.id as seller_id,
        s.name as seller_name,
        s.store_status,
        m.id as member_id,
        m.email as member_email
      FROM seller s
      INNER JOIN member m ON m.seller_id = s.id
      ORDER BY s.created_at DESC
    `)

    const sellers = sellersResult.rows || []
    results.push(`Found ${sellers.length} seller-member pairs to check`)

    for (const seller of sellers) {
      const { seller_id, seller_name, member_email, store_status } = seller

      try {
        // Find the auth_identity for this email
        const [authIdentity] = await authModule.listAuthIdentities({
          provider_identities: {
            entity_id: member_email,
          },
        })

        if (!authIdentity) {
          results.push(`⚠️ No auth_identity found for ${member_email} (${seller_name})`)
          skipped++
          continue
        }

        // Check if seller_id is already set
        const currentSellerId = (authIdentity.app_metadata as Record<string, unknown>)?.seller_id

        if (currentSellerId === seller_id) {
          results.push(`✓ Already linked: ${member_email} -> ${seller_id}`)
          skipped++
          continue
        }

        if (currentSellerId && currentSellerId !== seller_id) {
          results.push(`⚠️ Mismatch for ${member_email}: has ${currentSellerId}, expected ${seller_id}`)
          skipped++
          continue
        }

        // Update the auth_identity with seller_id
        await authModule.updateAuthIdentities([{
          id: authIdentity.id,
          app_metadata: {
            ...(authIdentity.app_metadata || {}),
            seller_id: seller_id,
          },
        }])

        results.push(`✅ Updated: ${member_email} -> ${seller_id} (${seller_name}) [${store_status}]`)
        updated++

      } catch (err) {
        results.push(`❌ Error processing ${member_email}: ${err.message}`)
        errors++
      }
    }

    res.json({
      success: true,
      summary: {
        updated,
        skipped,
        errors,
        total: sellers.length,
      },
      details: results,
    })

  } catch (error) {
    log.error("Backfill error:", error)
    res.status(500).json({
      success: false,
      error: error.message,
      details: results,
    })
  }
}
