/**
 * Read-side redaction for food-distribution entities.
 *
 * `api/middlewares.ts` gates the community `/store/*` prefixes on
 * `COMMUNITY_WRITE_VERBS` only — the prefix list gates *verbs*, not data
 * sensitivity — so several GETs on these surfaces are unauthenticated and
 * return whole ORM entities by spreading them. Redaction here is defence in
 * depth: the access rules on those routes are a separate, open question
 * (docs/TRANSMUTATION_STRATEGY.md), but a field like a delivery PIN must not
 * be serialized to *any* caller, authorized or not, so it is stripped at the
 * boundary rather than at each call site.
 */

/**
 * Fields that must never leave the server on a read, whoever is asking.
 *
 * `proof_pin_code` is the secret a recipient reads back to a courier to
 * confirm a delivery — `food-deliveries/[id]/route.ts` and
 * `food-deliveries/[id]/proof/route.ts` both compare a submitted PIN against
 * it. Serializing it defeats the control it exists to provide: anyone holding
 * it can confirm someone else's delivery. It is a credential, not data about
 * the delivery.
 */
const DELIVERY_SECRETS = ["proof_pin_code"] as const

/** Strip server-only secrets from a delivery row before it is serialized. */
export function redactDelivery<T extends Record<string, unknown>>(
  delivery: T
): Omit<T, (typeof DELIVERY_SECRETS)[number]> {
  const copy = { ...delivery } as Record<string, unknown>
  for (const field of DELIVERY_SECRETS) {
    delete copy[field]
  }
  return copy as Omit<T, (typeof DELIVERY_SECRETS)[number]>
}

/** `redactDelivery` over a list. */
export function redactDeliveries<T extends Record<string, unknown>>(
  deliveries: readonly T[]
): Array<Omit<T, (typeof DELIVERY_SECRETS)[number]>> {
  return deliveries.map(redactDelivery)
}

/**
 * Honour a recipient's request not to be named.
 *
 * `food_order.anonymous_recipient` is a boolean the schema has always
 * carried and no read path consulted, so a recipient who asked to be
 * anonymous was returned with their name, phone, email and delivery address
 * anyway. It matters most on `/store/food-donations`, whose rows are
 * donation, gift, community-share, rescue and gleaning orders — food-aid
 * recipients.
 *
 * The flag is a promise the schema makes to a person; this is the read path
 * keeping it.
 */
const RECIPIENT_IDENTITY_FIELDS = [
  "recipient_name",
  "recipient_phone",
  "recipient_email",
  "delivery_address_line_1",
  "delivery_address_line_2",
  "delivery_latitude",
  "delivery_longitude",
  "delivery_instructions",
  "customer_id",
] as const

export function applyRecipientAnonymity<T extends Record<string, unknown>>(
  order: T
): T {
  if (!order?.anonymous_recipient) {
    return order
  }
  const copy = { ...order } as Record<string, unknown>
  for (const field of RECIPIENT_IDENTITY_FIELDS) {
    if (field in copy) {
      copy[field] = null
    }
  }
  copy.recipient_name = "Anonymous"
  return copy as T
}

/** `applyRecipientAnonymity` over a list. */
export function applyRecipientAnonymityAll<T extends Record<string, unknown>>(
  orders: readonly T[]
): T[] {
  return orders.map(applyRecipientAnonymity)
}
