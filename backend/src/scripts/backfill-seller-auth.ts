import { ExecArgs } from "@medusajs/framework/types"
import { backfillSellerAuthLinks } from "../shared/seller-auth-backfill"

/**
 * Backfill script to link auth_identity records to their sellers
 *
 * This fixes sellers who were approved before the auth_identity.app_metadata.seller_id
 * fix was deployed. Without this link, sellers cannot login. Links each such
 * login to its MEMBER, as Mercur's own workflows do, and only through members
 * still on the team of stores still open (shared/seller-auth-backfill.ts).
 *
 * Run with: medusa exec ./src/scripts/backfill-seller-auth.ts
 * Or from PowerShell: pnpm medusa exec ./src/scripts/backfill-seller-auth.ts
 */
export default async function backfillSellerAuth({ container }: ExecArgs) {
  console.log("\n========================================")
  console.log("Backfilling seller auth_identity links")
  console.log("========================================\n")

  try {
    const { updated, skipped, errors } = await backfillSellerAuthLinks(container, (line) => console.log(line))

    console.log("\n========================================")
    console.log("Backfill Complete")
    console.log("========================================")
    console.log(`Updated: ${updated}`)
    console.log(`Skipped: ${skipped}`)
    console.log(`Errors:  ${errors}`)
    console.log("========================================\n")
  } catch (error: unknown) {
    console.error("Fatal error during backfill:", error)
    throw error
  }
}
