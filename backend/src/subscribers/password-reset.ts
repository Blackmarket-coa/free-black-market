import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/password-reset")
import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { appendPath } from "../shared/url"

/**
 * Subscriber: Password Reset
 *
 * Automatically sends a password reset email when a user requests to reset their password.
 * Handles password reset for all actor types: customer, seller, user (admin), and driver.
 */
export default async function passwordResetHandler({
  event,
  container,
}: SubscriberArgs<{ entity_id: string; token: string; actor_type: string }>) {
  const { entity_id: email, token, actor_type } = event.data

  if (!email || !token) {
    log.warn("Password reset event received without email or token")
    return
  }

  log.info(`[passwordReset subscriber] Processing password reset for ${actor_type}: ${email}`)

  try {
    const notificationModuleService = container.resolve("notification") as any

    // Build reset URL based on actor type
    const actorType = actor_type || "customer" // Default to customer if not specified
    let baseUrl = ""

    // Helper to get env var, treating "undefined" string as empty
    const getEnvVar = (name: string): string => {
      const value = process.env[name]
      if (!value || value === "undefined" || value === "null") {
        return ""
      }
      return value.trim()
    }

    switch (actorType) {
      case "customer":
        baseUrl = getEnvVar("STOREFRONT_URL") || getEnvVar("NEXT_PUBLIC_BASE_URL")
        break
      case "seller":
        baseUrl = getEnvVar("VENDOR_URL") || getEnvVar("VENDOR_PANEL_URL")
        break
      case "user":
        baseUrl = getEnvVar("ADMIN_URL")
        break
      case "driver":
        // Drivers use the same URL as sellers for now
        baseUrl = getEnvVar("VENDOR_URL") || getEnvVar("VENDOR_PANEL_URL")
        break
      default:
        log.warn(`Unknown actor_type: ${actorType}, defaulting to storefront`)
        baseUrl = getEnvVar("STOREFRONT_URL") || getEnvVar("NEXT_PUBLIC_BASE_URL")
    }

    // Trim whitespace from base URL
    baseUrl = baseUrl.trim()

    // Validate that base URL is set and looks like a valid URL
    if (!baseUrl || !baseUrl.startsWith("http")) {
      log.error(`[passwordReset subscriber] Missing or invalid base URL for actor_type: ${actorType}.`)
      log.error(`[passwordReset subscriber] STOREFRONT_URL="${process.env.STOREFRONT_URL}", NEXT_PUBLIC_BASE_URL="${process.env.NEXT_PUBLIC_BASE_URL}"`)
      log.error(`[passwordReset subscriber] Please set the appropriate environment variable (VENDOR_URL, STOREFRONT_URL, or ADMIN_URL) with a valid URL starting with http:// or https://`)
      return
    }

    const resetBaseUrl = appendPath(baseUrl, "/reset-password")
    const resetUrl = resetBaseUrl ? `${resetBaseUrl}?token=${token}` : ""

    // Send notification using the password-reset template
    await notificationModuleService.createNotifications({
      to: email,
      channel: "email",
      template: "password-reset",
      data: {
        reset_url: resetUrl,
        email: email,
      },
    })

    log.info(`[passwordReset subscriber] Password reset email sent successfully to ${email}`)
  } catch (error) {
    log.error(`[passwordReset subscriber] Failed to send password reset email to ${email}:`, error)
    // Don't throw - notification failure shouldn't break the password reset flow
  }
}

export const config: SubscriberConfig = {
  event: "auth.password_reset",
}
