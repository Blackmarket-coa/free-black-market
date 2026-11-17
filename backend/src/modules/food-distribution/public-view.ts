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

/**
 * Honour a producer's request to keep their exact address private.
 *
 * `food_producer.hide_address` is declared with the comment "For cottage food
 * / privacy - don't show exact address" and, like `anonymous_recipient`
 * before it, was read by no path: `/store/food-producers` and `/:id` both
 * return the whole entity, so a cottage-food producer working out of their
 * home had their street address and precise coordinates published.
 *
 * **What stays and what goes.** The flag says *exact*, not *any*: city,
 * state, postal code and country remain, because a buyer needs to know
 * roughly where a producer is and that is the whole point of a local food
 * marketplace. What goes is the doorstep — the street lines and the precise
 * latitude/longitude.
 *
 * Coordinates are nulled rather than rounded. Rounding is the tempting option
 * because it keeps map pins and distance sorting working, but "how coarse is
 * coarse enough" is a judgement nobody has made here, and a rounded
 * coordinate still reads as precise to every consumer of the field. Null is
 * the honest signal that this producer does not publish a location, and a
 * caller that needs proximity can use the postal code.
 *
 * `service_area_radius_miles` is deliberately kept: it describes how far a
 * producer will travel, not where they live.
 */
const PRODUCER_EXACT_LOCATION_FIELDS = [
  "address_line_1",
  "address_line_2",
  "latitude",
  "longitude",
] as const

export function applyProducerAddressPrivacy<T extends Record<string, unknown>>(
  producer: T
): T {
  if (!producer?.hide_address) {
    return producer
  }
  const copy = { ...producer } as Record<string, unknown>
  for (const field of PRODUCER_EXACT_LOCATION_FIELDS) {
    if (field in copy) {
      copy[field] = null
    }
  }
  return copy as T
}

/** `applyProducerAddressPrivacy` over a list. */
export function applyProducerAddressPrivacyAll<T extends Record<string, unknown>>(
  producers: readonly T[]
): T[] {
  return producers.map(applyProducerAddressPrivacy)
}

/**
 * What a stranger may see of a courier.
 *
 * ## The exposure this closes (D10-5, the courier half)
 *
 * `GET /store/couriers` and `GET /store/couriers/:id` are unauthenticated and
 * serialized the `food_courier` row verbatim. That row carries, for people
 * doing gig delivery work: `email`, `phone`, `current_latitude` /
 * `current_longitude` (their live position), `license_plate`,
 * `service_area_center_lat` / `_lng` (usually where they live),
 * `weekly_schedule` (when they are and are not out), `documents`,
 * `background_check_passed` and its date, `drivers_license_verified`,
 * `insurance_verified`, `total_earnings`, `pending_payout`,
 * `hawala_account_id` — and `emergency_contact_name` / `_phone`, which
 * belong to a third party who never interacted with this platform at all.
 *
 * ## Why this is a projection and not a ruling
 *
 * D10-5 deferred the remaining unauthenticated reads because guessing the
 * audience would either break a working surface or leave a hole. Neither
 * risk applies here, for two reasons the repository already settled:
 *
 * 1. **The code declares the public field set twice.**
 *    `GET /store/food-deliveries/:id/track` builds `courier: { name,
 *    vehicle_type, photo_url }` under the comment "Courier info (public
 *    only)", and the model annotates `display_name` as "What customers see".
 *    The audience question was answered; two endpoints just did not ask it.
 * 2. **Nothing consumes these two endpoints** — no storefront, no admin or
 *    vendor panel, no integration test references either. There is no
 *    working surface to break.
 *
 * ## What is published, and why each
 *
 * Identity is `display_name` falling back to `first_name`, which is the
 * model's own stated intent and matches what `/track` shows a customer
 * already expecting this courier. Surname, email and phone are not a
 * stranger's business; a customer with an active delivery gets contact
 * details through the delivery, which is authorised separately.
 *
 * Reputation and capability are published — rating, completed deliveries,
 * on-time rate, vehicle type, bags, capacity, zones, radius — because a
 * courier list exists to answer "who can carry this". `verified` rides
 * along as the platform's own trust summary; `background_check_passed`,
 * `drivers_license_verified` and `insurance_verified` deliberately do not.
 * They are employment-screening facts about a person, and republishing them
 * to anonymous callers is a different act from the platform saying it has
 * checked someone.
 *
 * `service_area_radius_miles` is published without its centre: a radius
 * alone locates nobody, and it is the half a requester needs.
 *
 * Position is omitted entirely — including for a courier mid-delivery. The
 * customer that delivery belongs to already gets the breadcrumb through
 * `/food-deliveries/:id/track`, which is the endpoint that knows who is
 * asking.
 */
const PUBLIC_COURIER_FIELDS = [
  "id",
  "courier_type",
  "vehicle_type",
  "status",
  "active",
  "verified",
  "avatar_url",
  "average_rating",
  "total_ratings",
  "on_time_percentage",
  "total_deliveries",
  "successful_deliveries",
  "has_insulated_bag",
  "has_hot_bag",
  "has_cold_storage",
  "max_weight_lbs",
  "max_orders_simultaneous",
  "preferred_zones",
  "service_area_radius_miles",
  "accepts_cash_orders",
  "accepts_donation_deliveries",
  "created_at",
] as const

export function publicCourierView(
  courier: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of PUBLIC_COURIER_FIELDS) {
    if (field in courier) out[field] = courier[field]
  }

  // Allow-list, not a deny-list: a column added to `food_courier` tomorrow is
  // private until someone adds it above. The reverse default is how this row
  // came to publish emergency contacts in the first place.
  const displayName = courier.display_name
  out.display_name =
    typeof displayName === "string" && displayName.length > 0
      ? displayName
      : (courier.first_name ?? null)

  return out
}

/** `publicCourierView` over a list. */
export function publicCourierViewAll(
  couriers: readonly Record<string, unknown>[]
): Array<Record<string, unknown>> {
  return (couriers ?? []).map((courier) => publicCourierView(courier))
}

/**
 * What a stranger may see of a food producer (SD-118).
 *
 * `GET /store/food-producers` and `/:id` need no customer and serialized the
 * `food_producer` row: the reviewer's `verification_notes`, the `licenses`
 * array (licence numbers and links to the documents), the `owner_id` and
 * `owner_type` of the account that manages it, the `hawala_account_id` its
 * money settles to, its contact email and phones, and `metadata`. And nothing
 * read `public_profile`: a producer who switched their profile off was listed
 * and served like any other.
 *
 * This is the listing a buyer chooses a producer from: who they are, what
 * they make, where and when, how they deliver and what they accept, their
 * ratings and their own account of themselves. The street address and the
 * coordinates are on it and stay subject to `hide_address`
 * (`applyProducerAddressPrivacy`, applied here so no caller can forget it).
 *
 * The contact email and phones are left off. A restaurant's phone is
 * public knowledge; a home baker's is their own, and the row does not say
 * which it is. Nothing consumes these two routes today (no storefront, app
 * or panel calls them), so the conservative reading costs no working surface,
 * and a buyer with an order reaches the producer through the order.
 *
 * An allow-list: a column added to `food_producer` tomorrow is private until
 * it is added here. The owner still reads the whole row.
 */
const PUBLIC_PRODUCER_FIELDS = [
  "id",
  "seller_id",
  "name",
  "handle",
  "producer_type",
  "description",
  "tagline",
  "address_line_1",
  "address_line_2",
  "city",
  "state",
  "postal_code",
  "country_code",
  "latitude",
  "longitude",
  "hide_address",
  "service_area_radius_miles",
  "operating_hours",
  "timezone",
  "operating_status",
  "accepts_orders",
  "accepts_trades",
  "accepts_donations",
  "donation_only",
  "offers_delivery",
  "offers_pickup",
  "delivery_fee",
  "minimum_order",
  "free_delivery_threshold",
  "estimated_prep_time_minutes",
  "cottage_food_state",
  "verified",
  "verified_at",
  "logo_url",
  "cover_image_url",
  "gallery",
  "website",
  "social_links",
  "story",
  "mission",
  "accepting_volunteers",
  "volunteer_info",
  "cuisine_types",
  "dietary_options",
  "specialties",
  "average_rating",
  "total_reviews",
  "total_orders",
  "community_vouches",
  "years_active",
  "accepts_cash",
  "accepts_card",
  "accepts_ebt_snap",
  "accepts_mutual_credit",
  "featured",
  "created_at",
  "updated_at",
] as const

export function publicProducerView(
  producer: Record<string, unknown>
): Record<string, unknown> {
  const source = applyProducerAddressPrivacy(producer)
  const out: Record<string, unknown> = {}
  for (const field of PUBLIC_PRODUCER_FIELDS) {
    if (field in source) out[field] = source[field]
  }
  return out
}

/** `publicProducerView` over a list. */
export function publicProducerViewAll(
  producers: readonly Record<string, unknown>[]
): Array<Record<string, unknown>> {
  return (producers ?? []).map((producer) => publicProducerView(producer))
}

/**
 * Whether a producer's profile is published. Only an explicit `false` hides
 * it: the column defaults to true, and a row read without it is not hidden.
 */
export function producerProfileIsPublic(producer: Record<string, unknown>): boolean {
  return producer?.public_profile !== false
}

/**
 * What a caller is told of a producer row it has just written or created
 * (`PUT /store/food-producers/:id`, `POST /store/food-producers`): never more
 * than `GET /store/food-producers/:id` serves the same caller.
 *
 * The owner reads the row whole, as on GET. Anyone else gets the public view
 * (no contact email or phones, no licences, notes, owner or ledger account,
 * `hide_address` honoured). A write by someone who is not the owner happens
 * on a producer with no owner on record, which `actorMayManage` lets any
 * signed-in account manage; the write is theirs to make, the row is not
 * theirs to read. And of a profile switched off, which GET answers exactly as
 * an id that does not exist, the acknowledgement is the id the caller named
 * and nothing else.
 */
export function producerEchoFor(
  producer: Record<string, unknown>,
  callerIsOwner: boolean
): Record<string, unknown> {
  if (callerIsOwner) return producer
  if (!producerProfileIsPublic(producer)) return { id: producer.id }
  return publicProducerView(producer)
}
