import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/user-created-matrix")
import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { getChatProvider } from "../shared/chat"

/**
 * Subscriber: User Created - Matrix (Blackout) Integration
 *
 * Provisions a Matrix account for admin users when they are created and adds
 * them to the community room.
 */
export default async function userCreatedMatrixHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const userId = event.data.id

  if (!userId) {
    log.warn("[userCreated Matrix] Event received without user ID")
    return
  }

  log.info(`[userCreated Matrix] Processing user ${userId}`)

  try {
    const matrixService = getChatProvider()

    if (!matrixService) {
      log.info("[userCreated Matrix] Matrix not configured, skipping")
      return
    }

    const userModule = container.resolve(Modules.USER)
    const user = await userModule.retrieveUser(userId)

    if (!user || !user.email) {
      log.warn(`[userCreated Matrix] User ${userId} not found or has no email`)
      return
    }

    const displayName =
      user.first_name && user.last_name
        ? `${user.first_name} ${user.last_name}`
        : user.email

    const { mxid } = await matrixService.ensureUser(
      user.email.split("@")[0],
      displayName,
      { email: user.email }
    )

    await matrixService.invite(
      `#${matrixService.generalRoomAlias()}:${matrixService.getServerName()}`,
      mxid
    )

    log.info(`[userCreated Matrix] Provisioned Matrix account for admin user: ${mxid}`)
  } catch (error: any) {
    log.error(`[userCreated Matrix] Failed for user ${userId}:`, error.message)
    // Don't throw - this is a non-critical enhancement
  }
}

export const config: SubscriberConfig = {
  event: "user.created",
}
