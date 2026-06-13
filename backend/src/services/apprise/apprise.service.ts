import { createLogger } from "../../shared/logger"
const log = createLogger("services/apprise/apprise.service")
/**
 * Apprise Notification Service
 * 
 * Multi-channel notification service using Apprise.
 * Supports: Email, SMS (Twilio), Discord, Slack, Telegram, Push notifications, and 90+ more services.
 * 
 * @see https://github.com/caronc/apprise
 * @see https://github.com/caronc/apprise-api
 */

export type NotificationPriority = "min" | "low" | "normal" | "high" | "emergency"

export type NotificationType = 
  | "info" 
  | "success" 
  | "warning" 
  | "failure"

export interface AppriseNotification {
  /** Notification title */
  title?: string
  /** Notification body/message */
  body: string
  /** Notification type for styling */
  type?: NotificationType
  /** Optional tag to filter which services receive the notification */
  tag?: string | string[]
  /** Attachment URLs */
  attach?: string[]
}

export interface AppriseConfig {
  /** Apprise API URL (self-hosted or apprise-api service) */
  apiUrl: string
  /** Default notification URLs (services to notify) */
  defaultUrls?: string[]
  /** Configuration key for persistent configs */
  configKey?: string
}

export interface NotificationChannel {
  /** Channel name for reference */
  name: string
  /** Apprise URL scheme for this channel */
  url: string
  /** Tags for filtering */
  tags?: string[]
}

/**
 * Common Apprise URL schemes:
 * 
 * Email:
 *   - mailto://user:password@gmail.com
 *   - mailtos://user:password@smtp.example.com:587
 * 
 * SMS (Twilio):
 *   - twilio://AccountSid:AuthToken@FromPhone/ToPhone
 * 
 * Discord:
 *   - discord://WebhookID/WebhookToken
 * 
 * Slack:
 *   - slack://TokenA/TokenB/TokenC/#channel
 * 
 * Telegram:
 *   - tgram://BotToken/ChatID
 * 
 * Push (Pushover):
 *   - pover://UserKey@AppToken
 * 
 * ntfy (self-hosted):
 *   - ntfy://topic or ntfys://ntfy.sh/topic
 * 
 * Gotify:
 *   - gotify://hostname/token
 * 
 * @see https://github.com/caronc/apprise/wiki
 */

export class AppriseService {
  private apiUrl: string
  private defaultUrls: string[]
  private configKey?: string

  constructor(config: AppriseConfig) {
    this.apiUrl = config.apiUrl || process.env.APPRISE_API_URL || ""
    this.defaultUrls = config.defaultUrls || []
    this.configKey = config.configKey
  }

  /**
   * Send a notification to specified URLs or default URLs
   */
  async notify(
    notification: AppriseNotification,
    urls?: string[]
  ): Promise<{ success: boolean; error?: string }> {
    const targetUrls = urls || this.defaultUrls

    if (!targetUrls.length && !this.configKey) {
      return { success: false, error: "No notification URLs configured" }
    }

    try {
      if (!this.apiUrl) {
        return { success: false, error: "Apprise API URL not configured" }
      }

      const endpoint = this.configKey 
        ? `${this.apiUrl}/notify/${this.configKey}`
        : `${this.apiUrl}/notify`

      const payload: Record<string, any> = {
        body: notification.body,
        type: notification.type || "info",
      }

      if (notification.title) {
        payload.title = notification.title
      }

      if (notification.tag) {
        payload.tag = Array.isArray(notification.tag) 
          ? notification.tag.join(",") 
          : notification.tag
      }

      if (notification.attach?.length) {
        payload.attach = notification.attach
      }

      // If not using config key, include URLs in payload
      if (!this.configKey && targetUrls.length) {
        payload.urls = targetUrls
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorText = await response.text()
        log.error("[Apprise] Notification failed:", errorText)
        return { success: false, error: errorText }
      }

      return { success: true }
    } catch (error) {
      log.error("[Apprise] Error sending notification:", error)
      return { 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      }
    }
  }

  /**
   * Add/update a persistent configuration
   */
  async addConfig(key: string, urls: string[]): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiUrl}/add/${key}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ urls }),
      })

      return response.ok
    } catch (error) {
      log.error("[Apprise] Error adding config:", error)
      return false
    }
  }

  /**
   * Get configuration details
   */
  async getConfig(key: string): Promise<{ urls: string[] } | null> {
    try {
      const response = await fetch(`${this.apiUrl}/get/${key}`)
      
      if (!response.ok) {
        return null
      }

      return await response.json()
    } catch (error) {
      log.error("[Apprise] Error getting config:", error)
      return null
    }
  }

  /**
   * Delete a configuration
   */
  async deleteConfig(key: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiUrl}/del/${key}`, {
        method: "POST",
      })

      return response.ok
    } catch (error) {
      log.error("[Apprise] Error deleting config:", error)
      return false
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiUrl}/status`)
      return response.ok
    } catch {
      return false
    }
  }
}

// Pre-configured notification helper functions
export function createAppriseService(): AppriseService {
  return new AppriseService({
    apiUrl: process.env.APPRISE_API_URL || "http://apprise:8000",
    configKey: process.env.APPRISE_CONFIG_KEY,
  })
}

export default AppriseService
