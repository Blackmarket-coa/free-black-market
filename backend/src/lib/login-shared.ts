import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { REQUEST_MODULE } from "../modules/request"
import { RequestStatus } from "../modules/request/models/request"

/**
 * What else a shopper's sign-in identity is used for, decided before
 * self-service deletion revokes it.
 *
 * One emailpass login can carry several actors: Medusa keeps an
 * `<actor>_id` per actor in the auth identity's `app_metadata`, and the
 * storefront and vendor panel sign in with the same email and password.
 * Medusa's own removeCustomerAccountWorkflow therefore only unlinks a customer
 * from its login. FBM's deletion revokes the login, which is right for a
 * shopper-only login and wrong for one a vendor or a staff member signs in
 * with.
 *
 * Only facts a stranger cannot create count. A PENDING vendor application does
 * not: POST /auth/seller/register-request (api/shared/seller-registration.ts)
 * files one for whatever login the email in its body names, with no token, so
 * anyone who knows a shopper's email could otherwise keep that shopper's login
 * from ever being deleted. An approved application (FBM approves on the email
 * owner's verification, or an admin does), or a vendor member row with the
 * login's email (made at approval or by accepting an emailed invite), does
 * count: approved vendors whose login was never given `seller_id` exist
 * (shared/seller-registration.ts writes it lazily; /admin/backfill-seller-auth
 * is for them), and their `app_metadata` is empty.
 */
export type LoginUse = {
  /** Why the login must outlive the shopper profile, or null. */
  keep: string | null
  /** The ids a seller request may name this login by. */
  submitterIds: string[]
}

type RequestService = {
  listRequests: (
    filters: Record<string, unknown>,
    config?: Record<string, unknown>
  ) => Promise<Array<{ id: string }>>
  deleteRequests: (ids: string[]) => Promise<void>
}

/**
 * The one Query call this file makes, typed locally: the generated
 * `query.graph` filter types for `member` with `$or`/`$ilike` sent
 * `medusa build`'s type check out of memory (CLAUDE.md rule 5's family).
 */
type MemberQuery = {
  graph: (q: {
    entity: "member"
    fields: string[]
    filters: Record<string, unknown>
  }) => Promise<{ data: Array<{ id: string }> }>
}

/** ILIKE pattern that matches `value` exactly, ignoring case. */
const exactInsensitive = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`)

export async function inspectLogin(
  container: MedusaContainer,
  authIdentityId: string
): Promise<LoginUse> {
  const authModule = container.resolve(Modules.AUTH)
  const [identity] = await authModule.listAuthIdentities(
    { id: [authIdentityId] },
    { relations: ["provider_identities"] }
  )
  // Already gone (a token replayed after a revoke): nothing to keep.
  if (!identity) {
    return { keep: null, submitterIds: [authIdentityId] }
  }

  const providers = (identity.provider_identities ?? []) as Array<{
    id: string
    provider?: string
    entity_id?: string
  }>
  // FBM's registration names the submitter by auth identity
  // (shared/seller-registration.ts); Mercur's POST /vendor/sellers by provider
  // identity.
  const submitterIds = [authIdentityId, ...providers.map((p) => p.id)]

  const appMetadata = (identity.app_metadata ?? {}) as Record<string, unknown>
  const otherActor = Object.entries(appMetadata).find(
    ([key, value]) => key !== "customer_id" && key.endsWith("_id") && Boolean(value)
  )
  if (otherActor) {
    return { keep: `the login is also linked as ${otherActor[0]}`, submitterIds }
  }

  const requestService = container.resolve(REQUEST_MODULE) as RequestService
  const approved = await requestService.listRequests(
    {
      type: "seller",
      submitter_id: submitterIds,
      status: [RequestStatus.ACCEPTED, RequestStatus.COMPLETED],
    },
    { take: 1 }
  )
  if (approved.length > 0) {
    return { keep: "an approved vendor application was made with this login", submitterIds }
  }

  const emails = providers
    .filter((p) => p.provider === "emailpass" && p.entity_id)
    .map((p) => p.entity_id as string)
  if (emails.length > 0) {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as unknown as MemberQuery
    const { data: members } = await query.graph({
      entity: "member",
      fields: ["id"],
      filters: { $or: emails.map((email) => ({ email: { $ilike: exactInsensitive(email) } })) },
    })
    if ((members ?? []).length > 0) {
      return { keep: "a vendor team member signs in with this email", submitterIds }
    }
  }

  return { keep: null, submitterIds }
}

/**
 * Delete the pending vendor applications made with a login that is being
 * revoked: they name the person, and one may have been filed in their name by
 * someone else. A real applicant can apply again.
 */
export async function removePendingSellerRequests(
  container: MedusaContainer,
  submitterIds: string[]
): Promise<number> {
  const requestService = container.resolve(REQUEST_MODULE) as RequestService
  const pending = await requestService.listRequests({
    type: "seller",
    submitter_id: submitterIds,
    status: RequestStatus.PENDING,
  })
  if (pending.length === 0) return 0
  await requestService.deleteRequests(pending.map((r) => r.id))
  return pending.length
}
