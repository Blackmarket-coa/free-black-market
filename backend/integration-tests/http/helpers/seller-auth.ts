import { Modules } from "@medusajs/framework/utils"
import {
  createSalesChannelsWorkflow,
  createShippingProfilesWorkflow,
} from "@medusajs/medusa/core-flows"
import jwt from "jsonwebtoken"
import { createSellerWorkflow } from "@mercurjs/b2c-core/workflows"
import { invalidateSellerPlan } from "../../../src/shared/plan-entitlement-cache"

/**
 * Test helper: bootstrap an authenticated, active seller for /vendor/* integration tests.
 *
 * The vendor auth stack (src/api/vendor/_middlewares.ts + src/shared/auth-helpers.ts and
 * the @mercurjs/b2c-core store/seller guards) resolves a seller from the bearer token via
 * `actor_id` (a mem_* member id, which maps to a sel_* seller) and/or the auth identity's
 * app_metadata. This helper:
 *   1. registers a seller auth identity (emailpass),
 *   2. creates + activates a seller through the real mercurjs createSellerWorkflow
 *      (the same workflow the approval service runs; store_status defaults to ACTIVE),
 *   3. mints a JWT carrying the linked actor so both our custom routes and the mercurjs
 *      dist routes authenticate.
 *
 * The token is minted directly with jsonwebtoken using the same JWT_SECRET the server
 * verifies with (Medusa's auth middleware and our decodeAuthToken both jwt.verify against
 * it), which makes the bootstrap deterministic regardless of /auth/token/refresh behaviour
 * in a given Medusa build.
 */

// axios (the test runner's `api`) may or may not be configured to throw on non-2xx
// depending on the @medusajs/test-utils version. This wrapper returns the response either
// way so assertions can read `.status`/`.data` uniformly.
export const safe = <T = any>(p: Promise<T>): Promise<T> =>
  p.catch((e: any) => e?.response ?? Promise.reject(e))

export const authHeader = (token: string) => ({
  headers: { authorization: `Bearer ${token}` },
})

/**
 * Idempotently ensure the store infrastructure that createProductsWorkflow needs
 * (a default sales channel + a default shipping profile). A fresh test database has
 * neither, which makes product creation fail with an opaque 500. Mirrors src/scripts/seed.ts.
 */
export interface StoreInfra {
  salesChannelId: string
  shippingProfileId: string
}

export async function ensureStoreInfra(container: any): Promise<StoreInfra> {
  const salesChannelService = container.resolve(Modules.SALES_CHANNEL)
  let [salesChannel] = await salesChannelService.listSalesChannels({
    name: "Default Sales Channel",
  })
  if (!salesChannel) {
    const { result } = await createSalesChannelsWorkflow(container).run({
      input: { salesChannelsData: [{ name: "Default Sales Channel" }] },
    })
    salesChannel = result[0]
  }

  const fulfillmentService = container.resolve(Modules.FULFILLMENT)
  let [shippingProfile] = await fulfillmentService.listShippingProfiles({
    type: "default",
  })
  if (!shippingProfile) {
    const { result } = await createShippingProfilesWorkflow(container).run({
      input: { data: [{ name: "Default Shipping Profile", type: "default" }] },
    })
    shippingProfile = result[0]
  }

  return { salesChannelId: salesChannel.id, shippingProfileId: shippingProfile.id }
}

export interface AuthenticatedSeller {
  token: string
  authIdentityId: string
  /** The actor id embedded in the token (a mem_* member id). */
  actorId: string
  /** The mercurjs seller (sel_*) created for this auth identity. */
  seller: { id: string; name: string; handle?: string }
  email: string
  password: string
}

export interface CreateAuthenticatedSellerOptions {
  api: any
  getContainer: () => any
  storeName?: string
  memberName?: string
  /**
   * Billing plan to provision the seller onto.
   *
   * Defaults to `internal`, the operator-assigned plan carrying every feature,
   * so that specs exercising paid surfaces (quests, vault, POS, invoicing, the
   * nursery vertical) behave as they did before `requirePlanFeature` existed.
   *
   * Pass an explicit code — `"free"` in particular — to assert the gate's
   * denial path end to end.
   */
  planCode?: string
}

export async function createAuthenticatedSeller({
  api,
  getContainer,
  storeName,
  memberName = "Test Vendor",
  planCode = "internal",
}: CreateAuthenticatedSellerOptions): Promise<AuthenticatedSeller> {
  const container = getContainer()
  const authModule = container.resolve(Modules.AUTH)

  const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const email = `vendor+${unique}@example.com`
  const password = "supersecret123"
  const sellerName = storeName ?? `Test Store ${unique}`

  // 1. Register an emailpass auth identity for the seller scope.
  const reg = await safe(
    api.post("/auth/seller/emailpass/register", { email, password })
  )
  const registrationToken: string | undefined = reg?.data?.token

  // Resolve the auth identity created above (by provider entity_id == email).
  const identities = await authModule.listAuthIdentities({
    provider_identities: { entity_id: email },
  })
  const authIdentity = identities?.[0]
  if (!authIdentity?.id) {
    throw new Error(
      `createAuthenticatedSeller: could not resolve auth identity for ${email}`
    )
  }
  const authIdentityId: string = authIdentity.id

  // 2. Create + activate the seller via the real mercurjs workflow.
  const { result: seller } = await createSellerWorkflow.run({
    container,
    input: {
      auth_identity_id: authIdentityId,
      member: { name: memberName, email },
      seller: { name: sellerName },
    } as any,
  })

  // The workflow links the member id under app_metadata.seller_id on the auth identity
  // (setAuthAppMetadataStep with actorType "seller"). That member id (mem_*) is the actor.
  const [linked] = await authModule.listAuthIdentities({ id: [authIdentityId] })
  const appMetadata = (linked?.app_metadata ?? {}) as Record<string, unknown>
  const actorId =
    typeof appMetadata.seller_id === "string" ? (appMetadata.seller_id as string) : ""
  if (!actorId) {
    throw new Error(
      "createAuthenticatedSeller: seller workflow did not link an actor on the auth identity"
    )
  }

  // 3. Obtain a Medusa-native seller token now that the actor is linked. Prefer the
  //    canonical auth routes (login, then refresh) because the mercurjs dist routes
  //    authenticate via Medusa's own auth middleware, which only trusts tokens it issued.
  //    Fall back to a hand-minted token (accepted by our custom requireSellerId decode).
  let token: string | undefined

  // 3a. Login: re-authenticates with credentials and embeds the now-linked actor.
  const login = await safe(
    api.post("/auth/seller/emailpass", { email, password })
  )
  token = login?.data?.token

  // 3b. Refresh: re-mints the registration token with the linked actor.
  if (!token && registrationToken) {
    const refreshed = await safe(
      api.post("/auth/token/refresh", {}, authHeader(registrationToken))
    )
    token = refreshed?.data?.token
  }

  // 3c. Fallback: mint directly with the shared secret.
  if (!token) {
    const secret = process.env.JWT_SECRET
    if (!secret) {
      throw new Error("createAuthenticatedSeller: JWT_SECRET is not set in the test env")
    }
    token = jwt.sign(
      {
        actor_id: actorId,
        actor_type: "seller",
        auth_identity_id: authIdentityId,
        app_metadata: { seller_id: actorId },
      },
      secret,
      { expiresIn: "1h" }
    )
  }

  // 4. Provision the seller's billing plan.
  //
  // `/vendor/*` routes behind `requirePlanFeature` resolve entitlements from
  // this assignment. Without one the gate's `ensureAssignment` would drop the
  // seller onto `free` and 402 every paid surface, so the fixture states the
  // plan explicitly rather than relying on that fallback.
  await assignSellerPlan(container, (seller as { id: string }).id, planCode)

  return {
    token,
    authIdentityId,
    actorId,
    seller: seller as AuthenticatedSeller["seller"],
    email,
    password,
  }
}

/**
 * Put a seller on a billing plan, idempotently.
 *
 * Writes the assignment row directly rather than going through
 * `applyPlanTransition` — a fixture wants a deterministic end state, not the
 * upgrade/downgrade semantics (deferred downgrades, idempotency keys) that the
 * transition path deliberately applies.
 */
export async function assignSellerPlan(
  container: any,
  sellerId: string,
  planCode: string
): Promise<void> {
  const plans = container.resolve("vendorPlan")
  const now = new Date()

  const [existing] = await plans.listVendorPlanAssignments({ seller_id: sellerId })
  if (existing) {
    await plans.updateVendorPlanAssignments({ id: existing.id, plan_code: planCode })
  } else {
    await plans.createVendorPlanAssignments({
      seller_id: sellerId,
      plan_code: planCode,
      status: "active",
      started_at: now,
      activated_at: now,
      assigned_by: "migration",
    })
  }

  // The gate caches feature sets per seller for 30s; drop any snapshot so the
  // next request reflects the plan this fixture just set.
  invalidateSellerPlan(sellerId)
}
