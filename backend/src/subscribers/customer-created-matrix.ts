import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/customer-created-matrix")
import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { getChatProvider } from "../shared/chat"
import { pickMxid, shouldWriteMxid } from "../lib/oidc-mxid"

/**
 * Subscriber: Customer Created - Matrix (Blackout) Integration
 *
 * Provisions a Matrix account for customers when they register and adds them to
 * the community room, so they can use the embedded chat immediately after signup.
 *
 * W2 (docs/contracts/mas-identity-consumer.md): customers who signed in via
 * the `mas` OIDC provider ALREADY have a MAS-managed Matrix account — for
 * them we skip admin provisioning (ensureUser would conflict with, and under
 * MSC3861 is unavailable to, the IdP-owned account), still invite the mxid
 * the IdP reported, and persist it with `mxid_source: "oidc"`. Everyone else
 * keeps the pre-W2 email-derived path (`mxid_source: "derived"`).
 */

/**
 * Find the mxid a `mas` auth identity reported for this customer, if any.
 * Primary: auth identities linked via app_metadata.customer_id. Fallbacks
 * (the app_metadata stamp can lose the race with this subscriber): raw SQL
 * over auth_identity/provider_identity (the auth-debug/password-history
 * precedent), then a secondary match on the OIDC-reported email.
 */
async function findOidcMxid(
  container: SubscriberArgs["container"],
  customerId: string,
  email: string | null
): Promise<unknown> {
  try {
    const authModule = container.resolve(Modules.AUTH)
    const identities = await authModule.listAuthIdentities(
      { app_metadata: { customer_id: customerId } },
      { relations: ["provider_identities"] }
    )
    for (const identity of identities) {
      for (const provider of identity.provider_identities ?? []) {
        if (provider.provider === "mas" && provider.user_metadata?.mxid) {
          return provider.user_metadata.mxid
        }
      }
    }
  } catch (error: any) {
    log.warn(
      `[customerCreated Matrix] auth-module mas lookup failed (falling back to SQL): ${error.message}`
    )
  }

  try {
    const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const byCustomer = await pgConnection.raw(
      `
      SELECT pi.user_metadata
      FROM provider_identity pi
      JOIN auth_identity ai ON ai.id = pi.auth_identity_id
      WHERE pi.provider = 'mas'
        AND ai.app_metadata->>'customer_id' = ?
      ORDER BY pi.created_at DESC
      LIMIT 1
      `,
      [customerId]
    )
    const customerHit = byCustomer.rows?.[0]?.user_metadata?.mxid
    if (customerHit) return customerHit

    if (email) {
      const byEmail = await pgConnection.raw(
        `
        SELECT pi.user_metadata
        FROM provider_identity pi
        WHERE pi.provider = 'mas'
          AND LOWER(pi.user_metadata->>'email') = LOWER(?)
        ORDER BY pi.created_at DESC
        LIMIT 1
        `,
        [email]
      )
      return byEmail.rows?.[0]?.user_metadata?.mxid
    }
  } catch (error: any) {
    log.warn(`[customerCreated Matrix] SQL mas lookup failed: ${error.message}`)
  }
  return undefined
}

export default async function customerCreatedMatrixHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const customerId = event.data.id

  if (!customerId) {
    log.warn("[customerCreated Matrix] Event received without customer ID")
    return
  }

  log.info(`[customerCreated Matrix] Processing customer ${customerId}`)

  try {
    const matrixService = getChatProvider()

    if (!matrixService) {
      log.info("[customerCreated Matrix] Matrix not configured, skipping")
      return
    }

    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: [customer] } = await query.graph({
      entity: "customer",
      fields: ["id", "email", "first_name", "last_name", "metadata"],
      filters: { id: customerId },
    })

    if (!customer) {
      log.warn(`[customerCreated Matrix] Customer ${customerId} not found`)
      return
    }

    const oidcMxid = await findOidcMxid(container, customerId, customer.email ?? null)
    const plan = pickMxid({ oidcMxid, email: customer.email ?? "" })

    let mxid: string
    if (plan.source === "oidc") {
      // MAS owns this account — never admin-provision over it.
      mxid = plan.mxid
      log.info(`[customerCreated Matrix] Using OIDC-provided mxid for ${customerId}: ${mxid}`)
    } else {
      // Pre-W2 behavior, unchanged: derive from the email local part.
      if (!customer.email) {
        log.warn(`[customerCreated Matrix] Customer ${customerId} has no email`)
        return
      }
      const displayName =
        customer.first_name && customer.last_name
          ? `${customer.first_name} ${customer.last_name}`
          : customer.email

      const ensured = await matrixService.ensureUser(plan.localpart, displayName, {
        email: customer.email,
      })
      mxid = ensured.mxid
    }

    await matrixService.invite(
      `#${matrixService.generalRoomAlias()}:${matrixService.getServerName()}`,
      mxid
    )

    // Best-effort: persist mxid for the entitlement/hawala systems to read.
    // "derived" stays write-once; "oidc" is authoritative (see lib/oidc-mxid).
    if (shouldWriteMxid(customer.metadata, plan.source)) {
      try {
        const customerModule = container.resolve(Modules.CUSTOMER)
        await customerModule.updateCustomers(customerId, {
          metadata: { ...(customer.metadata || {}), mxid, mxid_source: plan.source },
        })
      } catch (persistError: any) {
        log.warn(`[customerCreated Matrix] Failed to persist mxid: ${persistError.message}`)
      }
    }

    log.info(
      `[customerCreated Matrix] Matrix identity ready for customer ${customerId}: ${mxid} (${plan.source})`
    )
  } catch (error: any) {
    log.error(`[customerCreated Matrix] Failed for customer ${customerId}:`, error.message)
    // Don't throw - this is a non-critical enhancement
  }
}

export const config: SubscriberConfig = {
  event: "customer.created",
}
