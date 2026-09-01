import { model } from "@medusajs/framework/utils"

/**
 * Device Push Token
 *
 * One row per FCM registration token from the FBM Capacitor shell
 * (mobile/ in this repo). Registered by the storefront via
 * `POST /store/native/push-tokens` when the shell hands the web layer a
 * token (`fbm:push-token` event).
 *
 * Shape notes:
 *   - `token` is unique: re-registering an existing token (app reinstall,
 *     login on the same device) updates the row instead of duplicating it.
 *   - `customer_id` is nullable: tokens can be registered before login and
 *     are attached to the customer on the next authenticated registration.
 *     Only rows with a customer can be targeted by customer-scoped sends.
 *   - `disabled_at` is stamped when FCM reports the token UNREGISTERED /
 *     invalid, so dead tokens stop being retried without losing the audit
 *     trail. Re-registration clears it.
 */
const DevicePushToken = model.define("device_push_token", {
  id: model.id().primaryKey(),

  // FCM registration token (Android and, via FCM's APNs bridge, iOS).
  token: model.text().unique(),

  // 'ios' | 'android' — kept as text so new platforms don't need a migration.
  platform: model.text(),

  // Medusa customer this device belongs to, when known.
  customer_id: model.text().nullable(),

  // Last time the shell (re-)registered this token.
  last_registered_at: model.dateTime().nullable(),

  // Stamped when FCM says the token is gone; cleared on re-registration.
  disabled_at: model.dateTime().nullable(),
})

export default DevicePushToken
