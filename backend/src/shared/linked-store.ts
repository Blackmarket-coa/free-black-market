import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { REQUEST_MODULE } from "../modules/request"
import type RequestModuleService from "../modules/request/service"
import { RequestStatus } from "../modules/request/models"
import { isSellerRequestType } from "../modules/request/validators"
import { liveMemberAtAddress, loginAddressOf } from "./seller-actor"

type Seller = { id: string; name: string; handle: string }

/**
 * The store a login is already linked to as a seller, read from
 * `app_metadata.seller_id`: a seller id (what approval writes) or a member id
 * (what Mercur's createSellerWorkflow writes for the member it creates, and
 * what an accepted invite writes for the new member).
 *
 * - `none`: the login has no seller link.
 * - `live`: the store exists, and `memberId` is the member the link acts as:
 *   the one a member id names, or for a seller id the live member of that
 *   store at the login's own address, as the gates resolve it
 *   (shared/seller-actor.ts).
 * - `removed`: the link acts as no member of a store that is still open,
 *   because the member it acted as was removed: a member id naming a removed
 *   member (Mercur's deleteMemberStep soft-deletes the member and leaves the
 *   login's link pointing at it), or a seller id with no live member at the
 *   login's address and a removed one. Filing and approval treat the login as
 *   having no store; approval clears the link before creating one.
 * - `unmatched`: a seller id naming a store that is still open, with no
 *   member at the login's address, live or removed (or a login with no
 *   address). Nothing says the login was ever a member there: an owner whose
 *   member email no longer matches the login's address holds one (the
 *   seller-auth backfill reports it as `no_member_at_login_address`), and
 *   replacing that link left the owner's member row live and linked to no
 *   login (follow-up re-review, R-b). Filing and approval refuse it, and
 *   change nothing, until support fixes the link.
 * - `closed`: the link names a store that is gone (a removed member's
 *   included), a member that is gone without a trace, or an id of neither
 *   kind.
 */
export type LinkedStore =
  | { kind: "none" }
  | { kind: "live"; seller: Seller; memberId: string }
  | { kind: "removed"; seller: Seller; actor: string }
  | { kind: "unmatched"; seller: Seller; actor: string }
  | { kind: "closed"; actor: string }

/**
 * Said at filing, and in substance at approval, to a login whose link is
 * `unmatched`.
 */
export const LINK_NEEDS_SUPPORT =
  "This account's link to an existing store needs support to fix before you can apply. Nothing was created or changed. Contact support."

type Rows<T> = { rows?: T[] }

export async function resolveLinkedStore(
  container: MedusaContainer,
  appMetadata: Record<string, unknown> | null | undefined,
  authIdentityId: string
): Promise<LinkedStore> {
  const actor = appMetadata?.seller_id
  if (typeof actor !== "string" || !actor) {
    return { kind: "none" }
  }

  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  let sellerId: string | null = null
  let memberRemoved = false
  if (actor.startsWith("mem_")) {
    // Soft-deleted rows too: a removed member still names its store, which
    // decides between `removed` (the store is open) and `closed`.
    const member: Rows<{ seller_id: string | null; deleted_at: Date | null }> = await pg.raw(
      `SELECT seller_id, deleted_at FROM member WHERE id = ?`,
      [actor]
    )
    const row = member.rows?.[0]
    sellerId = row?.seller_id ?? null
    memberRemoved = Boolean(row?.deleted_at)
  } else if (actor.startsWith("sel_")) {
    sellerId = actor
  }
  if (!sellerId) {
    return { kind: "closed", actor }
  }

  const seller: Rows<Seller> = await pg.raw(
    `SELECT id, name, handle FROM seller WHERE id = ? AND deleted_at IS NULL`,
    [sellerId]
  )
  const found = seller.rows?.[0]
  if (!found) {
    return { kind: "closed", actor }
  }
  if (memberRemoved) {
    return { kind: "removed", seller: found, actor }
  }
  if (actor.startsWith("sel_")) {
    const address = await loginAddressOf(container, authIdentityId)
    if (!address) {
      return { kind: "unmatched", seller: found, actor }
    }
    const memberId = await liveMemberAtAddress(container, found.id, address)
    if (memberId) {
      return { kind: "live", seller: found, memberId }
    }
    // The same test as the seller-auth backfill's `removed_member` reason.
    const removedAtAddress: Rows<{ id: string }> = await pg.raw(
      `SELECT id FROM member
        WHERE seller_id = ? AND deleted_at IS NOT NULL
          AND LOWER(TRIM(email)) = LOWER(TRIM(?))
        LIMIT 1`,
      [found.id, address]
    )
    return removedAtAddress.rows?.length
      ? { kind: "removed", seller: found, actor }
      : { kind: "unmatched", seller: found, actor }
  }
  return { kind: "live", seller: found, memberId: actor }
}

const sameAddress = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Whether the store a login is linked to is the one an approval of this
 * application created and then failed to finish, so approval may resume onto
 * it. All of these must hold:
 *
 * - Its handle is the one the application's store name makes.
 * - Its first member, the owner createSellerWorkflow creates right after the
 *   store and before anyone can invite anyone into it, was made for this
 *   applicant: an owner with the applicant's address, not since deleted, and
 *   the member the link acts as. Soft-deleted members count when
 *   finding the first, so no later member can stand in for it. An invite
 *   needs a member of the store to send it, so whoever accepts one is never
 *   the first member, whatever role the invite gave them: Mercur's invite
 *   accepts "owner" and nothing checks who sends it (SD-127 follow-up,
 *   reproduced on Postgres).
 * - No other seller application of this login has been approved. If one has,
 *   the store is that approval's finished result, and approving this one
 *   would rerun the metadata, playbook and node-operator steps over it.
 */
export async function isUnfinishedApprovalOf(
  container: MedusaContainer,
  linked: Extract<LinkedStore, { kind: "live" }>,
  application: { requestId: string; loginId: string; handle: string; applicantEmail: string }
): Promise<boolean> {
  if (linked.seller.handle !== application.handle) {
    return false
  }

  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const first: Rows<{ id: string; role: string; email: string | null; deleted_at: Date | null }> =
    await pg.raw(
      `SELECT id, role, email, deleted_at FROM member
        WHERE seller_id = ?
        ORDER BY created_at ASC, id ASC
        LIMIT 1`,
      [linked.seller.id]
    )
  const owner = first.rows?.[0]
  if (
    !owner ||
    owner.deleted_at ||
    owner.role !== "owner" ||
    !owner.email ||
    !sameAddress(owner.email, application.applicantEmail) ||
    linked.memberId !== owner.id
  ) {
    return false
  }

  const finished = await container
    .resolve<RequestModuleService>(REQUEST_MODULE)
    .listRequests({
      submitter_id: application.loginId,
      status: [RequestStatus.ACCEPTED, RequestStatus.COMPLETED],
    })
  return !finished.some(
    (request) => request.id !== application.requestId && isSellerRequestType(request.type)
  )
}
