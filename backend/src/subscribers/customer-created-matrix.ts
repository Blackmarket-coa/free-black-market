import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/customer-created-matrix")
import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { getMatrixService } from "../shared/matrix-service"

/**
 * Subscriber: Customer Created - Matrix (Blackout) Integration
 *
 * Provisions a Matrix account for customers when they register and adds them to
 * the community room, so they can use the embedded chat immediately after signup.
 */
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
    const matrixService = getMatrixService()

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

    if (!customer || !customer.email) {
      log.warn(`[customerCreated Matrix] Customer ${customerId} not found or has no email`)
      return
    }

    const displayName =
      customer.first_name && customer.last_name
        ? `${customer.first_name} ${customer.last_name}`
        : customer.email

    const { mxid } = await matrixService.ensureUser(
      customer.email.split("@")[0],
      displayName,
      { email: customer.email }
    )

    await matrixService.invite(
      `#${matrixService.generalRoomAlias()}:${matrixService.getServerName()}`,
      mxid
    )

    // Best-effort: persist mxid for the entitlement/hawala systems to read.
    if (!customer.metadata?.mxid) {
      try {
        const customerModule = container.resolve(Modules.CUSTOMER)
        await customerModule.updateCustomers(customerId, {
          metadata: { ...(customer.metadata || {}), mxid },
        })
      } catch (persistError: any) {
        log.warn(`[customerCreated Matrix] Failed to persist mxid: ${persistError.message}`)
      }
    }

    log.info(`[customerCreated Matrix] Provisioned Matrix account for customer: ${mxid}`)
  } catch (error: any) {
    log.error(`[customerCreated Matrix] Failed for customer ${customerId}:`, error.message)
    // Don't throw - this is a non-critical enhancement
  }
}

export const config: SubscriberConfig = {
  event: "customer.created",
}
