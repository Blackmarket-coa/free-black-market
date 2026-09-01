import { MedusaService } from "@medusajs/framework/utils"
import DevicePushToken from "./models/device-push-token"
import { FcmClient, type FcmNotification, type FcmSendSummary } from "./fcm"

export type RegisterTokenInput = {
  token: string
  platform: "ios" | "android"
  customer_id?: string | null
  seller_id?: string | null
}

/**
 * Native push module service.
 *
 * Owns the device-token registry for the FBM Capacitor shell and the FCM
 * delivery path. Sending is fail-closed: without FCM_SERVICE_ACCOUNT_JSON
 * every send resolves to `{ configured: false }` and nothing leaves the
 * process, so the module is safe to ship ahead of the Firebase project.
 */
class NativePushModuleService extends MedusaService({
  DevicePushToken,
}) {
  private fcmClient: FcmClient | null = null

  /** Lazily constructed so env changes in tests are picked up per-instance. */
  protected getFcm(): FcmClient {
    if (!this.fcmClient) {
      this.fcmClient = new FcmClient()
    }
    return this.fcmClient
  }

  isSendingConfigured(): boolean {
    return this.getFcm().isConfigured()
  }

  /**
   * Register (or refresh) a device token. Unique on `token`: an existing
   * row is updated in place — re-registration re-enables a token FCM had
   * reported dead and attaches the caller when the call is authenticated.
   *
   * Attachments are preserved, never cleared, when a later registration
   * arrives without them: the shopper app registers anonymously on launch
   * and the vendor surface registers a seller separately, so each call
   * only ever adds the identity it knows about. Detaching is
   * `unregisterToken` (sign-out), not an anonymous re-registration.
   */
  async registerToken(input: RegisterTokenInput) {
    const now = new Date()
    const [existing] = await this.listDevicePushTokens(
      { token: input.token },
      { take: 1 }
    )

    if (existing) {
      return await this.updateDevicePushTokens({
        id: existing.id,
        platform: input.platform,
        customer_id: input.customer_id ?? existing.customer_id ?? null,
        seller_id: input.seller_id ?? existing.seller_id ?? null,
        last_registered_at: now,
        disabled_at: null,
      })
    }

    return await this.createDevicePushTokens({
      token: input.token,
      platform: input.platform,
      customer_id: input.customer_id ?? null,
      seller_id: input.seller_id ?? null,
      last_registered_at: now,
      disabled_at: null,
    })
  }

  /**
   * Detach a seller from a device without unregistering it — the vendor
   * signs out of the seller surface but the shopper session (and buyer
   * pushes) on the same phone continue. Idempotent.
   */
  async detachSeller(token: string): Promise<boolean> {
    const [existing] = await this.listDevicePushTokens({ token }, { take: 1 })
    if (!existing) return false
    await this.updateDevicePushTokens({ id: existing.id, seller_id: null })
    return true
  }

  /** Remove a token (device logout / permission revoked). Idempotent. */
  async unregisterToken(token: string): Promise<boolean> {
    const [existing] = await this.listDevicePushTokens({ token }, { take: 1 })
    if (!existing) return false
    await this.softDeleteDevicePushTokens([existing.id])
    return true
  }

  /** Active (non-disabled) tokens registered to a customer. */
  async listActiveTokensForCustomer(customer_id: string): Promise<string[]> {
    const rows = await this.listDevicePushTokens(
      { customer_id, disabled_at: null },
      { select: ["token"], take: 200 }
    )
    return rows.map((row) => row.token)
  }

  /** Active (non-disabled) tokens registered to a seller. */
  async listActiveTokensForSeller(seller_id: string): Promise<string[]> {
    const rows = await this.listDevicePushTokens(
      { seller_id, disabled_at: null },
      { select: ["token"], take: 200 }
    )
    return rows.map((row) => row.token)
  }

  /** Stamp tokens FCM reported as gone so they stop being retried. */
  async disableTokens(tokens: string[]): Promise<void> {
    if (tokens.length === 0) return
    const rows = await this.listDevicePushTokens(
      { token: tokens },
      { select: ["id"], take: tokens.length }
    )
    if (rows.length === 0) return
    const now = new Date()
    await this.updateDevicePushTokens(
      rows.map((row) => ({ id: row.id, disabled_at: now }))
    )
  }

  /**
   * Deliver a notification to every active device a customer has
   * registered. Dead tokens are disabled as a side effect. Never throws
   * for delivery problems — inspect the summary.
   */
  async sendToCustomer(
    customer_id: string,
    notification: FcmNotification
  ): Promise<FcmSendSummary> {
    const fcm = this.getFcm()
    if (!fcm.isConfigured()) {
      return { configured: false, sent: [], invalid: [], failed: [] }
    }
    const tokens = await this.listActiveTokensForCustomer(customer_id)
    const summary = await fcm.sendToTokens(tokens, notification)
    if (summary.invalid.length > 0) {
      await this.disableTokens(summary.invalid)
    }
    return summary
  }

  /**
   * Deliver a notification to every active device a seller has registered
   * through the in-app vendor surface. Same fail-closed and
   * dead-token-disabling semantics as `sendToCustomer`.
   */
  async sendToSeller(
    seller_id: string,
    notification: FcmNotification
  ): Promise<FcmSendSummary> {
    const fcm = this.getFcm()
    if (!fcm.isConfigured()) {
      return { configured: false, sent: [], invalid: [], failed: [] }
    }
    const tokens = await this.listActiveTokensForSeller(seller_id)
    const summary = await fcm.sendToTokens(tokens, notification)
    if (summary.invalid.length > 0) {
      await this.disableTokens(summary.invalid)
    }
    return summary
  }
}

export default NativePushModuleService
