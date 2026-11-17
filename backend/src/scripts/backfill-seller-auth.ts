import { ExecArgs } from "@medusajs/framework/types"
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Backfill script to link auth_identity records to their sellers
 *
 * This fixes sellers who were approved before the auth_identity.app_metadata.seller_id
 * fix was deployed. Without this link, sellers cannot login.
 *
 * Run with: medusa exec ./src/scripts/backfill-seller-auth.ts
 * Or from PowerShell: pnpm medusa exec ./src/scripts/backfill-seller-auth.ts
 */
export default async function backfillSellerAuth({ container }: ExecArgs) {
  const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const authModule = container.resolve(Modules.AUTH)

  console.log("\n========================================")
  console.log("Backfilling seller auth_identity links")
  console.log("========================================\n")

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
      -- Only members still on the team, of stores still open: linking a login
      -- through a removed member would give it back the store it left.
      WHERE m.deleted_at IS NULL AND s.deleted_at IS NULL
      ORDER BY s.created_at DESC
    `)

    const sellers = sellersResult.rows || []
    console.log(`Found ${sellers.length} seller-member pairs to check\n`)

    let updated = 0
    let skipped = 0
    let errors = 0

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
          console.log(`⚠️  No auth_identity found for ${member_email} (${seller_name})`)
          skipped++
          continue
        }

        // Check if seller_id is already set
        const currentSellerId = (authIdentity.app_metadata as any)?.seller_id

        if (currentSellerId === seller_id) {
          console.log(`✓  Already linked: ${member_email} -> ${seller_id}`)
          skipped++
          continue
        }

        if (currentSellerId && currentSellerId !== seller_id) {
          console.log(`⚠️  Mismatch for ${member_email}: has ${currentSellerId}, expected ${seller_id}`)
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

        console.log(`✅ Updated: ${member_email} -> ${seller_id} (${seller_name}) [${store_status}]`)
        updated++

      } catch (err: any) {
        console.error(`❌ Error processing ${member_email}: ${err.message}`)
        errors++
      }
    }

    console.log("\n========================================")
    console.log("Backfill Complete")
    console.log("========================================")
    console.log(`Updated: ${updated}`)
    console.log(`Skipped: ${skipped}`)
    console.log(`Errors:  ${errors}`)
    console.log("========================================\n")

  } catch (error: any) {
    console.error("Fatal error during backfill:", error)
    throw error
  }
}
