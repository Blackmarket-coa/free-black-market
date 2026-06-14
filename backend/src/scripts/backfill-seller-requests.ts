import { ExecArgs } from "@medusajs/framework/types"

/**
 * Backfill script to create request records for existing sellers
 * that were created before the request approval flow was implemented.
 *
 * Run with:
 *   medusa exec ./src/scripts/backfill-seller-requests.ts
 *
 * By default creates requests with "accepted" status.
 * To create pending requests instead, set environment variable:
 *   REQUEST_STATUS=pending medusa exec ./src/scripts/backfill-seller-requests.ts
 */
export default async function backfillSellerRequests({ container }: ExecArgs) {
  // Get status from environment variable, default to "accepted"
  const requestStatus = (process.env.REQUEST_STATUS || "accepted") as "pending" | "accepted"
  const query = container.resolve("query")
  const requestsModule = container.resolve("requests") as {
    createRequests: (data: any[]) => Promise<any>
  }
  const logger = container.resolve("logger")

  logger.info(`Starting backfill of seller requests with status: ${requestStatus}...`)

  try {
    // Get all existing sellers with their members
    const { data: sellers } = await query.graph({
      entity: "seller",
      fields: [
        "id",
        "name",
        "created_at",
        "members.*",
        "members.user.*",
      ],
    })

    logger.info(`Found ${sellers.length} existing sellers`)

    // Get existing seller requests to avoid duplicates
    const { data: existingRequests } = await query.graph({
      entity: "request",
      fields: ["id", "payload"],
      filters: {} as any, // type filter may not be in generated types
    })

    // Create a set of seller names that already have requests
    const sellersWithRequests = new Set(
      existingRequests
        .map((r: any) => r.payload?.seller?.name)
        .filter(Boolean)
    )

    let created = 0
    let skipped = 0

    for (const seller of sellers) {
      // Skip if request already exists for this seller
      if (sellersWithRequests.has(seller.name)) {
        logger.info(`Skipping seller "${seller.name}" - request already exists`)
        skipped++
        continue
      }

      // Get the first member (owner) of the seller
      const member = seller.members?.[0] as (typeof seller.members)[0] & { user?: { email?: string; first_name?: string } | null } | undefined
      if (!member) {
        logger.warn(`Skipping seller "${seller.name}" - no members found`)
        skipped++
        continue
      }

      const memberData = member as { email?: string; name?: string; user?: { email?: string; first_name?: string } | null }
      const email = memberData.user?.email || memberData.email || "unknown@example.com"
      const memberName = memberData.name || memberData.user?.first_name || "Unknown"

      // Create a request record with the specified status
      const requestData = {
        type: "seller",
        status: requestStatus,
        data: {
          seller: {
            name: seller.name,
          },
          member: {
            name: memberName,
            email: email,
          },
          provider_identity_id: email,
          // Mark as backfilled
          backfilled: true,
          original_created_at: seller.created_at,
        },
        submitter_id: member.id || "backfill",
        reviewer_note: requestStatus === "accepted"
          ? "Backfilled - seller was created before request approval flow"
          : undefined,
      }

      try {
        await requestsModule.createRequests([requestData])
        logger.info(`Created request for seller "${seller.name}"`)
        created++
      } catch (error: any) {
        logger.error(`Failed to create request for seller "${seller.name}": ${error.message}`)
      }
    }

    logger.info(`Backfill complete: ${created} requests created, ${skipped} skipped`)
  } catch (error: any) {
    logger.error(`Backfill failed: ${error.message}`)
    throw error
  }
}
