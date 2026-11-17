import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

export type SellerAuthBackfillResult = {
  updated: number
  skipped: number
  errors: number
  total: number
}

type Pair = {
  seller_id: string
  seller_name: string
  store_status: string | null
  member_id: string
  member_email: string | null
  /** The store's first member still on the team: the one a seller-id link acts as. */
  is_first: boolean
}

/**
 * Link the login of each team member whose `app_metadata.seller_id` was never
 * written (vendors approved before approval wrote it) to that member. Shared by
 * `POST /admin/backfill-seller-auth` and `src/scripts/backfill-seller-auth.ts`.
 *
 * It writes the MEMBER id, as Mercur does: createSellerWorkflow and
 * acceptMemberInvitesWorkflow both set `seller_id` to the member they create.
 * It used to write the seller id, and a seller-id link acts as the store's
 * first member, its owner (the vendor gate rewrites it so for Mercur's
 * member-keyed guards), so a backfilled invited member got the owner's
 * context.
 *
 * Only members still on the team, of stores still open: a removed member's row
 * is soft-deleted, not gone, and linking its login through it handed the store
 * back, as its owner (SD-139 follow-up review, measured on Postgres after
 * approval had cleared the removed member's link). A login that already has a
 * link is left as it is; one that holds the store's seller id while its member
 * is not the store's first is reported, since that link acts as the owner.
 */
export async function backfillSellerAuthLinks(
  container: MedusaContainer,
  report: (line: string) => void = () => undefined
): Promise<SellerAuthBackfillResult> {
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const authModule = container.resolve(Modules.AUTH)

  const result: { rows?: Pair[] } = await pg.raw(`
    SELECT
      s.id AS seller_id,
      s.name AS seller_name,
      s.store_status,
      m.id AS member_id,
      m.email AS member_email,
      ROW_NUMBER() OVER (PARTITION BY s.id ORDER BY m.created_at ASC, m.id ASC) = 1 AS is_first
    FROM seller s
    INNER JOIN member m ON m.seller_id = s.id
    WHERE m.deleted_at IS NULL AND s.deleted_at IS NULL
    ORDER BY s.created_at DESC, m.created_at ASC, m.id ASC
  `)
  const pairs = result.rows ?? []
  report(`Found ${pairs.length} seller-member pairs to check`)

  let updated = 0
  let skipped = 0
  let errors = 0
  for (const pair of pairs) {
    const { seller_id, seller_name, store_status, member_id, member_email, is_first } = pair
    if (!member_email) {
      report(`⚠️ Member ${member_id} of ${seller_name} has no email`)
      skipped++
      continue
    }
    try {
      const [identity] = await authModule.listAuthIdentities({
        provider_identities: { entity_id: member_email },
      })
      if (!identity) {
        report(`⚠️ No auth_identity found for ${member_email} (${seller_name})`)
        skipped++
        continue
      }

      const current = (identity.app_metadata as Record<string, unknown> | null | undefined)?.seller_id
      if (current === member_id || (current === seller_id && is_first)) {
        report(`✓ Already linked: ${member_email} -> ${String(current)}`)
        skipped++
        continue
      }
      if (current === seller_id) {
        report(`⚠️ ${member_email} holds ${seller_name}'s seller id, which acts as its owner, but is member ${member_id}; left as it is`)
        skipped++
        continue
      }
      if (current) {
        report(`⚠️ Linked elsewhere, left as it is: ${member_email} has ${String(current)}, this member is ${member_id}`)
        skipped++
        continue
      }

      // The auth module merges app_metadata, so only the key is sent.
      await authModule.updateAuthIdentities([{ id: identity.id, app_metadata: { seller_id: member_id } }])
      report(`✅ Updated: ${member_email} -> ${member_id} (${seller_name}) [${store_status ?? "unknown"}]`)
      updated++
    } catch (err) {
      report(`❌ Error processing ${member_email}: ${err instanceof Error ? err.message : String(err)}`)
      errors++
    }
  }

  return { updated, skipped, errors, total: pairs.length }
}
