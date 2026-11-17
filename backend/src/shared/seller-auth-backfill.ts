import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

export type SellerAuthBackfillResult = {
  updated: number
  skipped: number
  errors: number
  total: number
  /** Logins holding a seller id that the gates refuse (see REFUSED_SELLER_ID_LINKS_SQL). */
  refused: number
}

/**
 * Read-only: every login whose `app_metadata.seller_id` is a seller id that
 * the gates refuse, and why. A seller id acts only as the live member of that
 * store whose email is the login's own emailpass address, compared trimmed and
 * ignoring case (shared/seller-actor.ts). Run it against production before
 * deploying that rule: a `no_member_at_login_address` row whose store is the
 * login's own is an owner whose member email differs from its login's
 * address, and will be locked out until one of the two is corrected.
 *
 * reason: `no_login_address` (no emailpass identity), `closed_store` (the
 * seller is soft-deleted or gone), `removed_member` (its member at that
 * address was removed), `no_member_at_login_address` (no live member of that
 * store has the address; `store_first_member_email` shows the store's first).
 */
export const REFUSED_SELLER_ID_LINKS_SQL = `
SELECT ai.id AS auth_identity_id,
       ai.app_metadata->>'seller_id' AS seller_id,
       pi.entity_id AS login_address,
       CASE
         WHEN pi.entity_id IS NULL THEN 'no_login_address'
         WHEN s.id IS NULL OR s.deleted_at IS NOT NULL THEN 'closed_store'
         WHEN EXISTS (
           SELECT 1 FROM member m
            WHERE m.seller_id = s.id AND m.deleted_at IS NOT NULL
              AND LOWER(TRIM(m.email)) = LOWER(TRIM(pi.entity_id))
         ) THEN 'removed_member'
         ELSE 'no_member_at_login_address'
       END AS reason,
       (SELECT f.email FROM member f
         WHERE f.seller_id = s.id AND f.deleted_at IS NULL
         ORDER BY f.created_at ASC, f.id ASC LIMIT 1) AS store_first_member_email
  FROM auth_identity ai
  LEFT JOIN provider_identity pi
    ON pi.auth_identity_id = ai.id AND pi.provider = 'emailpass' AND pi.deleted_at IS NULL
  LEFT JOIN seller s ON s.id = ai.app_metadata->>'seller_id'
 WHERE ai.deleted_at IS NULL
   AND LEFT(ai.app_metadata->>'seller_id', 4) = 'sel_'
   AND NOT EXISTS (
     SELECT 1 FROM member m
      WHERE m.seller_id = s.id AND s.deleted_at IS NULL AND m.deleted_at IS NULL
        AND LOWER(TRIM(m.email)) = LOWER(TRIM(pi.entity_id))
   )
 ORDER BY reason, login_address, auth_identity_id
`

type RefusedLink = {
  auth_identity_id: string
  seller_id: string
  login_address: string | null
  reason: "no_login_address" | "closed_store" | "removed_member" | "no_member_at_login_address"
  store_first_member_email: string | null
}

const REASON_TEXT: Record<RefusedLink["reason"], string> = {
  no_login_address: "the login has no emailpass address",
  closed_store: "the store is closed",
  removed_member: "its member of that store was removed",
  no_member_at_login_address: "no live member of that store has the login's address",
}

type Pair = {
  seller_id: string
  seller_name: string
  store_status: string | null
  member_id: string
  member_email: string | null
}

/**
 * Link the login of each team member whose `app_metadata.seller_id` was never
 * written (vendors approved before approval wrote it) to that member. Shared by
 * `POST /admin/backfill-seller-auth` and `src/scripts/backfill-seller-auth.ts`.
 *
 * It writes the MEMBER id, as Mercur does: createSellerWorkflow and
 * acceptMemberInvitesWorkflow both set `seller_id` to the member they create.
 * It used to write the seller id, which the gates then let act as the store's
 * first member, its owner, so a backfilled invited member got the owner's
 * context. The gates now let a seller id act only as the live member at the
 * login's own address (shared/seller-actor.ts), but a member id says exactly
 * which member.
 *
 * Only members still on the team, of stores still open: a removed member's row
 * is soft-deleted, not gone, and linking its login through it handed the store
 * back, as its owner (SD-139 follow-up review, measured on Postgres after
 * approval had cleared the removed member's link). A login that already has a
 * link is left as it is. Last, every login holding a seller id the gates
 * refuse is reported with the reason (REFUSED_SELLER_ID_LINKS_SQL).
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
      m.email AS member_email
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
    const { seller_id, seller_name, store_status, member_id, member_email } = pair
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
      // The login was found by this member's address, so a seller-id link to
      // its store acts as this member under the gates' rule.
      if (current === member_id || current === seller_id) {
        report(`✓ Already linked: ${member_email} -> ${String(current)}`)
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

  // Links the backfill leaves alone but the gates refuse. An owner whose
  // member email differs from its login's address is among them, and must be
  // corrected before the rule is deployed.
  const refusedResult: { rows?: RefusedLink[] } = await pg.raw(REFUSED_SELLER_ID_LINKS_SQL)
  const refused = refusedResult.rows ?? []
  for (const link of refused) {
    const firstMember =
      link.reason === "no_member_at_login_address" && link.store_first_member_email
        ? ` (the store's first member is ${link.store_first_member_email})`
        : ""
    report(
      `⛔ ${link.login_address ?? link.auth_identity_id} holds ${link.seller_id}, which the gates refuse: ${link.reason}, ${REASON_TEXT[link.reason]}${firstMember}`
    )
  }

  return { updated, skipped, errors, total: pairs.length, refused: refused.length }
}
