import { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { REQUEST_MODULE } from "../modules/request"
import { RequestStatus } from "../modules/request/models/request"

/**
 * Why a shopper's sign-in identity must outlive their shopper profile, or
 * null when nothing else uses it.
 *
 * One emailpass login can carry several actors: Medusa keeps a
 * `<actor>_id` per actor in the auth identity's `app_metadata`, and the
 * storefront and vendor panel sign in with the same email and password.
 * Medusa's own removeCustomerAccountWorkflow therefore only unlinks a customer
 * from its login. FBM's self-service deletion deletes the login outright, which
 * is right for a shopper-only login and wrong for one that a vendor or a staff
 * member signs in with, or that has a vendor application pending (FBM writes
 * `seller_id` only when the application is approved,
 * shared/seller-approval-service.ts, so until then the login looks unused).
 */
export async function loginKeptBecause(
  container: MedusaContainer,
  authIdentityId: string
): Promise<string | null> {
  const authModule = container.resolve(Modules.AUTH)
  const identity = await authModule.retrieveAuthIdentity(authIdentityId, {
    relations: ["provider_identities"],
  })

  const appMetadata = (identity.app_metadata ?? {}) as Record<string, unknown>
  const otherActor = Object.entries(appMetadata).find(
    ([key, value]) => key !== "customer_id" && key.endsWith("_id") && Boolean(value)
  )
  if (otherActor) {
    return `the login is also linked as ${otherActor[0]}`
  }

  // FBM's registration names the submitter by auth identity
  // (shared/seller-registration.ts); Mercur's POST /vendor/sellers by provider
  // identity. Either way the login is the applicant's way back in.
  const submitterIds = [
    authIdentityId,
    ...(identity.provider_identities ?? []).map((p: { id: string }) => p.id),
  ]
  const requestService = container.resolve(REQUEST_MODULE) as {
    listRequests: (filters: Record<string, unknown>, config?: Record<string, unknown>) => Promise<unknown[]>
  }
  const pending = await requestService.listRequests(
    { type: "seller", submitter_id: submitterIds, status: RequestStatus.PENDING },
    { take: 1 }
  )
  if (pending.length > 0) {
    return "a vendor application made with this login is pending"
  }

  return null
}
