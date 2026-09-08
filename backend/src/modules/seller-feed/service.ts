import { AbstractNotificationProviderService } from "@medusajs/framework/utils"
import {
  ProviderSendNotificationDTO,
  ProviderSendNotificationResultsDTO,
  Logger,
} from "@medusajs/framework/types"

type InjectedDependencies = {
  logger: Logger
}

/**
 * In-app delivery for the vendor notification drawer.
 *
 * `GET /vendor/notifications/buckets` has read `channel: "seller_feed"` since
 * it shipped, and `lib/notification-buckets.ts` classifies those rows into the
 * three tabs the drawer renders. Nothing ever wrote one: before this provider,
 * `seller_feed` appeared exactly twice in the backend — that route's filter and
 * a comment in the classifier describing it.
 *
 * The reason nothing could write one is that Medusa routes `createNotifications`
 * to a provider *by channel*, and both configured providers (`smtp`, `resend`)
 * register `channels: ["email"]` only. A `seller_feed` notification had no
 * provider to route to.
 *
 * For an in-app feed the persisted notification row *is* the delivery — the
 * drawer queries the notification table directly. So this provider's `send` is
 * deliberately a no-op that reports success: the notification module has
 * already written the row by the time it is called, and there is no second
 * system to hand it to. That is the whole provider, and it should stay that
 * small. If a push or email copy of a feed item is ever wanted, it belongs in
 * a provider for *that* channel, fanned out by the caller — not bolted on here,
 * where a failure to reach an external service would start reporting an in-app
 * notification as undelivered when it is sitting in the drawer.
 */
class SellerFeedNotificationProviderService extends AbstractNotificationProviderService {
  static identifier = "notification-seller-feed"

  private logger: Logger

  constructor({ logger }: InjectedDependencies) {
    super()
    this.logger = logger
  }

  /**
   * No required options — the provider holds no credentials and talks to
   * nothing. Declared so the module loader's validation hook has an explicit
   * answer rather than falling through to the base class.
   */
  static validateOptions(_options: Record<string, unknown>): void {
    // Intentionally empty: nothing to validate.
  }

  async send(
    notification: ProviderSendNotificationDTO
  ): Promise<ProviderSendNotificationResultsDTO> {
    // Nothing to send. The row the notification module just persisted is what
    // the vendor drawer reads; returning an empty result marks it delivered.
    this.logger.debug?.(
      `[seller-feed] queued ${notification.template} for ${notification.to}`
    )
    return {}
  }
}

export default SellerFeedNotificationProviderService
