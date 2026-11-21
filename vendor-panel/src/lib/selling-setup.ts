import { backendMessage } from "./backend-message"
import { fetchQuery } from "./client"

/**
 * What a store needs before a buyer can check out, and the calls that put it
 * there (SD-151 (4)).
 *
 * Measured on Postgres with the panel's own calls: a product made by the
 * product form was listed by the storefront and could not be added to a cart
 * ("Sales channel … is not associated with any stock location"), and with a
 * stock location but no shipping option the checkout answered "Seller
 * shipping method not found!". Mercur marks a store's `locations_shipping`
 * done once any stock location exists, so the dashboard called such a store
 * set up.
 *
 * A buyer can check out when:
 *   1. a stock location is linked to the store's sales channel;
 *   2. the seller has a shipping option on that location (Mercur's cart
 *      completion wants one per seller, whatever is sold: pickup counts);
 *   3. a published product is either not stock-tracked or in stock there.
 *
 * `readSellingSetup` reads those three; `setUpDelivery` makes 1 and 2 with
 * the calls the MVP sweep made successfully through the vendor routes (its
 * steps B.41 to B.51: stock location, sales-channel link, fulfillment
 * provider, fulfillment set, service zone, shipping option, recalculation),
 * after which its buyer completed an order.
 */

/** The provider a seller fulfils by hand with: Medusa's manual provider. */
export const MANUAL_PROVIDER_ID = "manual_manual"
/** The currency the guided setup and the launch wizard write prices in. */
export const SELLING_CURRENCY = "usd"

export type DeliveryKind = "pickup" | "shipping"

export type SalesChannelRef = { id: string; name?: string }

type GeoZone = { type?: string; country_code?: string | null }
type ServiceZone = {
  id: string
  name?: string
  fulfillment_set_id?: string | null
  geo_zones?: GeoZone[] | null
}
type FulfillmentSet = {
  id: string
  name?: string
  type?: string
  service_zones?: ServiceZone[] | null
}
export type SellingLocation = {
  id: string
  name: string
  address?: {
    address_1?: string | null
    city?: string | null
    postal_code?: string | null
    province?: string | null
    country_code?: string | null
  } | null
  sales_channels?: SalesChannelRef[] | null
  fulfillment_sets?: FulfillmentSet[] | null
  fulfillment_providers?: Array<{ id: string }> | null
}
type ShippingOptionRow = {
  id: string
  name: string
  data?: Record<string, unknown> | null
  service_zone_id?: string | null
  service_zone?: ServiceZone | null
  rules?: Array<{ attribute?: string; value?: unknown }> | null
}

/**
 * The stock-location fields the checks below read. Each part is one the
 * panel's Settings, Locations screens already ask Mercur for.
 */
export const SELLING_LOCATION_FIELDS =
  "id,name,*address,*sales_channels,*fulfillment_providers,*fulfillment_sets,*fulfillment_sets.service_zones,*fulfillment_sets.service_zones.geo_zones"

const get = (path: string, query?: Record<string, string | number>) =>
  fetchQuery(path, { method: "GET", query })
const post = (path: string, body: object) =>
  fetchQuery(path, { method: "POST", body })

const defaultSalesChannel = async (): Promise<SalesChannelRef | null> => {
  const { sales_channels } = await get("/vendor/sales-channels")
  const channel = sales_channels?.[0]
  return channel?.id ? { id: channel.id, name: channel.name } : null
}

const listLocations = async (): Promise<SellingLocation[]> => {
  const { stock_locations } = await get("/vendor/stock-locations", {
    fields: SELLING_LOCATION_FIELDS,
  })
  return ((stock_locations ?? []) as Array<SellingLocation | null>).filter(
    (location): location is SellingLocation => Boolean(location?.id)
  )
}

/** With each option's rules: a return option is one by its `is_return` rule. */
const listShippingOptions = async (): Promise<ShippingOptionRow[]> => {
  const { shipping_options } = await get("/vendor/shipping-options", {
    fields: "*rules",
  })
  return ((shipping_options ?? []) as Array<ShippingOptionRow | null>).filter(
    (option): option is ShippingOptionRow => Boolean(option?.id)
  )
}

const isLinked = (location: SellingLocation, channel: SalesChannelRef | null) =>
  Boolean(
    channel && location.sales_channels?.some((sc) => sc?.id === channel.id)
  )

const hasRule = (option: ShippingOptionRow, attribute: string, value: string) =>
  Boolean(
    option.rules?.some((r) => r?.attribute === attribute && r?.value === value)
  )
/** For sending goods back, or hidden from the storefront: no buyer can pick it. */
const notForBuyers = (option: ShippingOptionRow) =>
  hasRule(option, "is_return", "true") ||
  option.data?.is_return === true ||
  hasRule(option, "enabled_in_store", "false")

export type DeliverySetup = {
  /** The store's sales channel, which products are listed in. */
  channel: SalesChannelRef | null
  locations: SellingLocation[]
  /** Where stock is held: a location linked to the channel when there is one. */
  location: SellingLocation | null
  /** Whether `location` is linked to the channel. */
  locationLinked: boolean
  /** The options a buyer can choose at checkout. */
  options: Array<{ id: string; name: string; kind: DeliveryKind }>
  /** A linked location and at least one option on it. */
  ready: boolean
}

const describeDelivery = (
  channel: SalesChannelRef | null,
  locations: SellingLocation[],
  shippingOptions: ShippingOptionRow[]
): DeliverySetup => {
  const linked = locations.filter((location) => isLinked(location, channel))

  // The fulfillment sets of linked locations, and the zones in them.
  const kindOfSet = new Map<string, DeliveryKind>()
  const setOfZone = new Map<string, string>()
  for (const location of linked) {
    for (const set of location.fulfillment_sets ?? []) {
      if (!set?.id) continue
      kindOfSet.set(set.id, set.type === "pickup" ? "pickup" : "shipping")
      for (const zone of set.service_zones ?? []) {
        if (zone?.id) setOfZone.set(zone.id, set.id)
      }
    }
  }

  const options = shippingOptions.flatMap((option) => {
    if (notForBuyers(option)) return []
    const zoneId = option.service_zone?.id ?? option.service_zone_id ?? ""
    const setId =
      option.service_zone?.fulfillment_set_id ?? setOfZone.get(zoneId) ?? ""
    const kind = kindOfSet.get(setId)
    // An option on a location the sales channel is not linked to is not
    // offered to a cart in that channel.
    return kind ? [{ id: option.id, name: option.name, kind }] : []
  })

  return {
    channel,
    locations,
    location: linked[0] ?? locations[0] ?? null,
    locationLinked: linked.length > 0,
    options,
    ready: linked.length > 0 && options.length > 0,
  }
}

export const readDeliverySetup = async (): Promise<DeliverySetup> => {
  const [channel, locations, shippingOptions] = await Promise.all([
    defaultSalesChannel(),
    listLocations(),
    listShippingOptions(),
  ])
  return describeDelivery(channel, locations, shippingOptions)
}

type ProductRow = { id: string; title?: string; status?: string }
type VariantRow = {
  id: string
  title?: string
  variant_rank?: number | null
  manage_inventory?: boolean | null
  allow_backorder?: boolean | null
  inventory_items?: Array<{ inventory_item_id?: string | null }> | null
}
type LevelRow = {
  id?: string
  location_id?: string
  stocked_quantity?: number | null
  reserved_quantity?: number | null
  available_quantity?: number | null
}

export type ListingRef = { id: string; title: string }
export type ListingSetup = {
  total: number
  /** A published product a buyer can add to a cart now. */
  buyable: ListingRef | null
  /** With none buyable: a published product that is stock-tracked and has none. */
  needsStock: ListingRef | null
  /** With none published: a draft to publish. */
  draft: ListingRef | null
}

const ref = (product: ProductRow): ListingRef => ({
  id: product.id,
  title: product.title || "Untitled product",
})

const levelsOf = async (inventoryItemId: string): Promise<LevelRow[]> => {
  const { location_levels } = await get(
    `/vendor/inventory-items/${inventoryItemId}/location-levels`
  )
  return (location_levels ?? []) as LevelRow[]
}

const available = (level: LevelRow) =>
  level.available_quantity ??
  (level.stocked_quantity ?? 0) - (level.reserved_quantity ?? 0)

/** How many published products are looked into, and variants of each. */
const PRODUCTS_CHECKED = 3
const VARIANTS_CHECKED = 5

const variantIsBuyable = async (variant: VariantRow, locationIds: string[]) => {
  if (variant.manage_inventory === false) {
    return true
  }
  const itemIds = (variant.inventory_items ?? [])
    .map((item) => item?.inventory_item_id)
    .filter((id): id is string => Boolean(id))
  if (itemIds.length === 0 || locationIds.length === 0) {
    return false
  }
  for (const itemId of itemIds) {
    const here = (await levelsOf(itemId)).filter((level) =>
      locationIds.includes(level.location_id ?? "")
    )
    // On backorder a level must exist to reserve against; otherwise stock.
    const ok = variant.allow_backorder
      ? here.length > 0
      : here.some((level) => available(level) > 0)
    if (!ok) return false
  }
  return true
}

export const readListingSetup = async (
  linkedLocationIds: string[]
): Promise<ListingSetup> => {
  const { products } = await get("/vendor/products")
  const all = ((products ?? []) as Array<ProductRow | null>).filter(
    (product): product is ProductRow => Boolean(product?.id)
  )
  const published = all.filter((product) => product.status === "published")
  const draft = all.find((product) => product.status === "draft")

  for (const product of published.slice(0, PRODUCTS_CHECKED)) {
    const detail = await get(`/vendor/products/${product.id}`)
    const variants = ((detail?.product?.variants ?? []) as VariantRow[]).slice(
      0,
      VARIANTS_CHECKED
    )
    for (const variant of variants) {
      if (await variantIsBuyable(variant, linkedLocationIds)) {
        return {
          total: all.length,
          buyable: ref(product),
          needsStock: null,
          draft: null,
        }
      }
    }
  }

  return {
    total: all.length,
    buyable: null,
    needsStock: published[0] ? ref(published[0]) : null,
    draft: published[0] || !draft ? null : ref(draft),
  }
}

export type SellingSetup = {
  delivery: DeliverySetup
  listing: ListingSetup
  /** A buyer could check out now. */
  ready: boolean
}

export const readSellingSetup = async (): Promise<SellingSetup> => {
  const delivery = await readDeliverySetup()
  const linkedIds = delivery.locations
    .filter((location) => isLinked(location, delivery.channel))
    .map((location) => location.id)
  const listing = await readListingSetup(linkedIds)
  return {
    delivery,
    listing,
    ready: delivery.ready && listing.buyable !== null,
  }
}

/** A step of the guided setup the backend refused, in its own words. */
export class SetupStepError extends Error {
  constructor(
    /** What was being done, as the vendor reads it: "create the stock location". */
    public step: string,
    /** What the backend said. */
    public reason: string
  ) {
    super(`Could not ${step}: ${reason}`)
    this.name = "SetupStepError"
  }
}

const step = async <T>(label: string, run: () => Promise<T>): Promise<T> => {
  try {
    return await run()
  } catch (error) {
    if (error instanceof SetupStepError) throw error
    throw new SetupStepError(label, backendMessage(error, "Unknown error"))
  }
}

export type DeliverySetupInput = {
  /**
   * The place goods are kept and handed over. Used only when the store has no
   * stock location: an existing one is linked and reused instead.
   */
  location: {
    name: string
    address_1: string
    city?: string
    province?: string
    postal_code?: string
    country_code: string
  }
  /** Buyers collect at the location, free. */
  pickup: { name: string } | null
  /** Shipped anywhere in the location's country for one price, in major units. */
  shipping: { name: string; amount: number } | null
}

export type DeliverySetupResult = {
  location: { id: string; name: string; created: boolean }
  options: Array<{
    id: string
    name: string
    kind: DeliveryKind
    created: boolean
  }>
}

const optionType = (kind: DeliveryKind) =>
  kind === "pickup"
    ? { label: "Pickup", description: "Pickup fulfillment", code: "pickup" }
    : { label: "Shipping", description: "Shipping fulfillment", code: "shipping" }

const clean = (value: string | undefined) => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/**
 * Make a store's delivery work from nothing: a stock location linked to the
 * sales channel, manual fulfilment enabled at it, and a pickup option, a
 * flat-rate shipping option, or both, covering the location's country.
 *
 * Each call is one the scout measured. It reads first and makes only what is
 * missing, so pressing the button again after a step failed does not make a
 * second location or a second option of the same name.
 *
 * Fulfillment-set and service-zone names are unique across the whole
 * marketplace in Medusa (`IDX_fulfillment_set_name_unique`,
 * `IDX_service_zone_name_unique`), not per store: a zone named "US" can exist
 * once. The names written here carry the id of the location or set they
 * belong to, so two stores never ask for the same one.
 */
export const setUpDelivery = async (
  input: DeliverySetupInput
): Promise<DeliverySetupResult> => {
  const [channel, locations, existingOptions] = await step(
    "read your store's current setup",
    () =>
      Promise.all([defaultSalesChannel(), listLocations(), listShippingOptions()])
  )
  if (!channel) {
    throw new SetupStepError(
      "find your store's sales channel",
      "the store has none, so nothing can be listed. Contact support."
    )
  }

  // 1. The stock location: one already linked, else the first, else a new one.
  let location =
    locations.find((candidate) => isLinked(candidate, channel)) ??
    locations[0] ??
    null
  const createdLocation = !location
  if (!location) {
    const address = {
      address_1: input.location.address_1.trim(),
      country_code: input.location.country_code.trim().toLowerCase(),
      ...(clean(input.location.city) && { city: clean(input.location.city) }),
      ...(clean(input.location.province) && {
        province: clean(input.location.province),
      }),
      ...(clean(input.location.postal_code) && {
        postal_code: clean(input.location.postal_code),
      }),
    }
    const created = await step("create the stock location", () =>
      post("/vendor/stock-locations", {
        name: input.location.name.trim(),
        address,
      })
    )
    location = created?.stock_location as SellingLocation | null
    if (!location?.id) {
      throw new SetupStepError(
        "create the stock location",
        "the backend returned no location."
      )
    }
  }
  const locationId = location.id

  // 2. Linked to the sales channel, so a cart in it can find the stock.
  if (!isLinked(location, channel)) {
    await step("link the stock location to your sales channel", () =>
      post(`/vendor/stock-locations/${locationId}/sales-channels`, {
        add: [channel.id],
      })
    )
  }

  const wanted = (
    [
      input.pickup && { kind: "pickup" as const, name: input.pickup.name, amount: 0 },
      input.shipping && {
        kind: "shipping" as const,
        name: input.shipping.name,
        amount: input.shipping.amount,
      },
    ] as Array<{ kind: DeliveryKind; name: string; amount: number } | null>
  ).filter((option): option is NonNullable<typeof option> => Boolean(option))

  const options: DeliverySetupResult["options"] = []
  if (wanted.length > 0) {
    // 3. Manual fulfilment at the location: a shipping option's provider has
    //    to be enabled where it ships from.
    if (!location.fulfillment_providers?.some((p) => p?.id === MANUAL_PROVIDER_ID)) {
      const { fulfillment_providers } = await step(
        "read the fulfilment providers",
        () => get("/vendor/fulfillment-providers")
      )
      if (
        !(fulfillment_providers ?? []).some(
          (p: { id?: string }) => p?.id === MANUAL_PROVIDER_ID
        )
      ) {
        throw new SetupStepError(
          "enable manual fulfilment",
          "this marketplace has no manual fulfilment provider. Use Settings, Locations instead."
        )
      }
      await step("enable manual fulfilment at the stock location", () =>
        post(`/vendor/stock-locations/${locationId}/fulfillment-providers`, {
          add: [MANUAL_PROVIDER_ID],
        })
      )
    }

    // 4. The store's default shipping profile: the one Mercur gives every new
    //    product, which a shipping option has to share to be offered for it.
    const { shipping_profiles } = await step("read your shipping profile", () =>
      get("/vendor/shipping-profiles")
    )
    // Mercur answers link rows, each holding its profile.
    const profiles = ((shipping_profiles ?? []) as Array<Record<string, any>>).map(
      (row) => row?.shipping_profile ?? row
    )
    let profileId: string | undefined = profiles.find(
      (profile) => profile?.type === "default"
    )?.id
    if (!profileId) {
      const created = await step("create a shipping profile", () =>
        post("/vendor/shipping-profiles", {
          name: "Default shipping profile",
          type: "default",
        })
      )
      profileId = created?.shipping_profile?.id
    }
    if (!profileId) {
      throw new SetupStepError(
        "create a shipping profile",
        "the backend returned no profile."
      )
    }

    // 5. What the manual provider fulfils with (not its return option).
    const { fulfillment_options } = await step(
      "read the manual fulfilment options",
      () => get(`/vendor/fulfillment-providers/${MANUAL_PROVIDER_ID}/options`)
    )
    const fulfilmentData =
      ((fulfillment_options ?? []) as Array<Record<string, unknown>>).find(
        (option) => !option?.is_return
      ) ?? {}

    const country = (
      location.address?.country_code ||
      input.location.country_code ||
      ""
    )
      .trim()
      .toLowerCase()
    if (!country) {
      throw new SetupStepError(
        "work out where you deliver",
        "the stock location has no country. Add one in Settings, Locations."
      )
    }

    for (const want of wanted) {
      const label =
        want.kind === "pickup" ? "the pickup option" : "the shipping option"

      // 6. The location's fulfillment set of this kind.
      let set = location.fulfillment_sets?.find((s) => s?.type === want.kind)
      if (!set) {
        const made = await step(`set up ${label}`, () =>
          post(`/vendor/stock-locations/${locationId}/fulfillment-sets`, {
            name: `${location!.name} ${
              want.kind === "pickup" ? "pick up" : "shipping"
            } (${locationId})`,
            type: want.kind,
          })
        )
        set = (
          (made?.stock_location?.fulfillment_sets ?? []) as FulfillmentSet[]
        ).find((s) => s?.type === want.kind)
        if (!set?.id) {
          throw new SetupStepError(
            `set up ${label}`,
            "the backend returned no fulfillment set."
          )
        }
      }
      const setId = set.id

      // 7. A service zone covering the location's country.
      let zone = set.service_zones?.find((z) =>
        z?.geo_zones?.some(
          (g) => g?.type === "country" && g?.country_code === country
        )
      )
      if (!zone) {
        const zoneName = `${country.toUpperCase()} (${setId})`
        const made = await step(`set up ${label}`, () =>
          post(`/vendor/fulfillment-sets/${setId}/service-zones`, {
            name: zoneName,
            geo_zones: [{ type: "country", country_code: country }],
          })
        )
        zone = (
          (made?.fulfillment_set?.service_zones ?? []) as ServiceZone[]
        ).find((z) => z?.name === zoneName)
        if (!zone?.id) {
          throw new SetupStepError(
            `set up ${label}`,
            "the backend returned no service zone."
          )
        }
      }
      const zoneId = zone.id

      // 8. The option itself, unless one of this name is already in the zone.
      const existing = existingOptions.find(
        (option) =>
          (option.service_zone?.id ?? option.service_zone_id) === zoneId &&
          option.name === want.name &&
          !notForBuyers(option)
      )
      if (existing) {
        options.push({
          id: existing.id,
          name: existing.name,
          kind: want.kind,
          created: false,
        })
        continue
      }
      const made = await step(`create ${label}`, () =>
        post("/vendor/shipping-options", {
          name: want.name,
          service_zone_id: zoneId,
          shipping_profile_id: profileId,
          provider_id: MANUAL_PROVIDER_ID,
          prices: [{ currency_code: SELLING_CURRENCY, amount: want.amount }],
          data: fulfilmentData,
          rules: [
            { value: "false", attribute: "is_return", operator: "eq" },
            { value: "true", attribute: "enabled_in_store", operator: "eq" },
          ],
          type: optionType(want.kind),
        })
      )
      const option = made?.shipping_option
      if (!option?.id) {
        throw new SetupStepError(
          `create ${label}`,
          "the backend returned no shipping option."
        )
      }
      options.push({
        id: option.id,
        name: option.name ?? want.name,
        kind: want.kind,
        created: true,
      })
    }
  }

  // Mercur's own setup flags. Best effort: the location and options above are
  // made whether or not this recalculation answers.
  await post("/vendor/sellers/me/onboarding", {}).catch(() => undefined)

  return {
    location: { id: locationId, name: location.name, created: createdLocation },
    options,
  }
}

/**
 * Set how many of a product's variants are in stock at a location.
 *
 * `stock` names variants by `variant_rank`, which the product form sends and
 * the backend returns. A level that exists is updated; one that does not is
 * created, so this can be run again.
 */
export const recordStock = async ({
  productId,
  locationId,
  stock,
}: {
  productId: string
  locationId: string
  stock: Array<{ variant_rank: number; quantity: number }>
}): Promise<{ recorded: number }> => {
  if (stock.length === 0) {
    return { recorded: 0 }
  }
  const detail = await get(`/vendor/products/${productId}`)
  const variants = (detail?.product?.variants ?? []) as VariantRow[]

  const create: Array<Record<string, unknown>> = []
  const update: Array<Record<string, unknown>> = []
  for (const entry of stock) {
    const variant =
      variants.find((v) => v?.variant_rank === entry.variant_rank) ??
      (variants.length === 1 && stock.length === 1 ? variants[0] : undefined)
    const itemId = variant?.inventory_items?.[0]?.inventory_item_id
    if (!variant || !itemId) {
      throw new Error(
        `The product was saved, but its stock could not be recorded: ${
          variant?.title ? `"${variant.title}"` : "a variant"
        } has no inventory item.`
      )
    }
    const level = {
      inventory_item_id: itemId,
      location_id: locationId,
      stocked_quantity: entry.quantity,
    }
    const exists = (await levelsOf(itemId)).some(
      (row) => row.location_id === locationId
    )
    ;(exists ? update : create).push(level)
  }

  await post("/vendor/inventory-items/location-levels/batch", {
    create,
    update,
    delete: [],
  })
  return { recorded: create.length + update.length }
}

/**
 * Publish a product and record it as the store's first published listing.
 * Resolves only once the backend has answered both: the product's status is
 * `published`, and the onboarding state is `published`.
 */
export const publishFirstListing = async (productId: string) => {
  const published = await post(`/vendor/products/${productId}/status`, {
    status: "published",
  })
  if (published?.product?.status !== "published") {
    throw new Error("The backend did not confirm that the product is published.")
  }
  const recorded = await post("/vendor/onboarding/publish", {
    listing_id: productId,
  })
  if (recorded?.state?.wizard_step !== "published") {
    throw new Error(
      "The product is published, but the backend did not record it as your first listing."
    )
  }
  return {
    product: published.product as { id: string; title?: string; status: string },
    state: recorded.state,
  }
}
