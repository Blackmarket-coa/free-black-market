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
 *      completion wants one per seller, whatever is sold: pickup counts)
 *      that a buyer in some region is offered: its service zone covers a
 *      country of that region, and it has a price the region's carts are
 *      charged in the region's currency;
 *   3. a published product has a price in that region's currency and is
 *      either not stock-tracked or in stock at a linked location.
 *
 * Measured with the panel's calls, before regions were read: a location in
 * Canada (zone CA) read as ready while a buyer in the United States, the
 * only region, was offered no option and checkout answered "Seller shipping
 * method not found!"; an option priced only in EUR read as ready while the
 * buyer's add-shipping-method answered "Shipping options with IDs … do not
 * have a price".
 *
 * `readSellingSetup` reads those three; `setUpDelivery` makes 1 and 2 with
 * the calls the MVP sweep made successfully through the vendor routes (its
 * steps B.41 to B.51: stock location, sales-channel link, fulfillment
 * provider, fulfillment set, service zone, shipping option, recalculation),
 * after which its buyer completed an order.
 */

/** The provider a seller fulfils by hand with: Medusa's manual provider. */
export const MANUAL_PROVIDER_ID = "manual_manual"

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
/** A price as Medusa answers it, for a shipping option or a variant. */
type PriceRow = {
  currency_code?: string | null
  amount?: number | null
  /** Present only when the request asked for them. */
  price_rules?: Array<{ attribute?: string; value?: unknown }> | null
}
type ShippingOptionRow = {
  id: string
  name: string
  data?: Record<string, unknown> | null
  service_zone_id?: string | null
  service_zone?: ServiceZone | null
  rules?: Array<{ attribute?: string; value?: unknown }> | null
  prices?: PriceRow[] | null
}

/** Where buyers are, and what they pay in: `GET /vendor/regions`. */
export type SellingRegion = {
  id: string
  name?: string | null
  currency_code: string
  countries?: Array<{
    iso_2?: string | null
    display_name?: string | null
  }> | null
}

const lower = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : ""

/** The ISO codes of a region's countries, lower case. */
export const regionCountryCodes = (region: SellingRegion) =>
  (region.countries ?? []).map((country) => lower(country?.iso_2)).filter(Boolean)

/** A buyer in this country is in this region: Medusa puts a country in one at most. */
export const regionOfCountry = (
  regions: SellingRegion[],
  countryCode: string | null | undefined
) => {
  const code = lower(countryCode)
  return code
    ? (regions.find((region) => regionCountryCodes(region).includes(code)) ??
        null)
    : null
}

/** "United States, Canada": the countries buyers are in, by name. */
export const regionCountryNames = (regions: SellingRegion[]) =>
  regions
    .flatMap((region) =>
      (region.countries ?? []).map(
        (country) => country?.display_name || lower(country?.iso_2).toUpperCase()
      )
    )
    .filter(Boolean)
    .join(", ")

/**
 * Whether a cart in `region` is charged this price. Medusa chooses a price by
 * the cart's currency and region: one in another currency is never chosen,
 * and one with rules only where they hold. A rule naming this region holds;
 * any other (another region, a cart-total condition) may not, so such a
 * price is not counted. When the answer does not carry the rules, the
 * currency decides.
 */
export const priceAppliesIn = (price: PriceRow | null | undefined, region: SellingRegion) => {
  if (!price || lower(price.currency_code) !== lower(region.currency_code)) {
    return false
  }
  if (!Array.isArray(price.price_rules)) {
    return true
  }
  return price.price_rules.every(
    (rule) => rule?.attribute === "region_id" && rule?.value === region.id
  )
}

const pricedIn = (prices: PriceRow[] | null | undefined, region: SellingRegion) =>
  (prices ?? []).some((price) => priceAppliesIn(price, region))

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

/**
 * The options read for the checks below: their rules (a return option is one
 * by its `is_return` rule), and their prices with the prices' rules (a price
 * for one region only names it in a `region_id` rule). `*prices` is in
 * Mercur's defaults; `*prices.price_rules` is the fragment Settings, Locations
 * sends for an option's prices.
 */
export const SELLING_OPTION_FIELDS = "*rules,*prices.price_rules"

const listShippingOptions = async (): Promise<ShippingOptionRow[]> => {
  const { shipping_options } = await get("/vendor/shipping-options", {
    fields: SELLING_OPTION_FIELDS,
  })
  return ((shipping_options ?? []) as Array<ShippingOptionRow | null>).filter(
    (option): option is ShippingOptionRow => Boolean(option?.id)
  )
}

/** Every region, as the product form reads them, with their countries. */
const listRegions = async (): Promise<SellingRegion[]> => {
  const { regions } = await get("/vendor/regions", { limit: 9999 })
  return ((regions ?? []) as Array<SellingRegion | null>).filter(
    (region): region is SellingRegion =>
      Boolean(region?.id && region.currency_code)
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

export type DeliveryOption = {
  id: string
  name: string
  kind: DeliveryKind
  /** The regions whose buyers are offered it, by id. */
  regions: string[]
}

/** An option on a linked location that no buyer is offered, and why. */
export type UnofferedOption = {
  id: string
  name: string
  kind: DeliveryKind
  /**
   * "outside": its zone covers no country buyers are in. "unpriced": it does,
   * and it has no price those buyers' carts are charged.
   */
  reason: "outside" | "unpriced"
  /** For "unpriced": the currencies it needs a price in, upper case. */
  currencies: string[]
}

export type DeliverySetup = {
  /** The store's sales channel, which products are listed in. */
  channel: SalesChannelRef | null
  locations: SellingLocation[]
  /** Where stock is held: a location linked to the channel when there is one. */
  location: SellingLocation | null
  /** Whether `location` is linked to the channel. */
  locationLinked: boolean
  /** Where buyers are, and the currency each region pays in. */
  regions: SellingRegion[]
  /** The options a buyer can choose at checkout. */
  options: DeliveryOption[]
  /** Options on a linked location that no buyer can choose. */
  unoffered: UnofferedOption[]
  /** A linked location and at least one option a buyer is offered. */
  ready: boolean
}

const describeDelivery = (
  channel: SalesChannelRef | null,
  locations: SellingLocation[],
  shippingOptions: ShippingOptionRow[],
  regions: SellingRegion[]
): DeliverySetup => {
  const linked = locations.filter((location) => isLinked(location, channel))

  // The fulfillment sets of linked locations, the zones in them, and the
  // countries each zone covers.
  const kindOfSet = new Map<string, DeliveryKind>()
  const setOfZone = new Map<string, string>()
  const countriesOfZone = new Map<string, string[]>()
  for (const location of linked) {
    for (const set of location.fulfillment_sets ?? []) {
      if (!set?.id) continue
      kindOfSet.set(set.id, set.type === "pickup" ? "pickup" : "shipping")
      for (const zone of set.service_zones ?? []) {
        if (!zone?.id) continue
        setOfZone.set(zone.id, set.id)
        countriesOfZone.set(
          zone.id,
          (zone.geo_zones ?? []).map((geo) => lower(geo?.country_code)).filter(Boolean)
        )
      }
    }
  }

  const options: DeliveryOption[] = []
  const unoffered: UnofferedOption[] = []
  for (const option of shippingOptions) {
    if (notForBuyers(option)) continue
    const zoneId = option.service_zone?.id ?? option.service_zone_id ?? ""
    const setId =
      option.service_zone?.fulfillment_set_id ?? setOfZone.get(zoneId) ?? ""
    const kind = kindOfSet.get(setId)
    // An option on a location the sales channel is not linked to is not
    // offered to a cart in that channel.
    if (!kind) continue

    // Medusa offers a cart the options whose zone covers its address, and
    // the cart can take one only with a price in its region's currency.
    const countries = countriesOfZone.get(zoneId) ?? []
    const covered = regions.filter((region) =>
      regionCountryCodes(region).some((code) => countries.includes(code))
    )
    const priced = covered.filter((region) => pricedIn(option.prices, region))
    if (priced.length > 0) {
      options.push({
        id: option.id,
        name: option.name,
        kind,
        regions: priced.map((region) => region.id),
      })
    } else {
      unoffered.push({
        id: option.id,
        name: option.name,
        kind,
        reason: covered.length > 0 ? "unpriced" : "outside",
        currencies: [
          ...new Set(covered.map((region) => region.currency_code.toUpperCase())),
        ],
      })
    }
  }

  return {
    channel,
    locations,
    location: linked[0] ?? locations[0] ?? null,
    locationLinked: linked.length > 0,
    regions,
    options,
    unoffered,
    ready: linked.length > 0 && options.length > 0,
  }
}

/** Why buyers are not offered an option, in a sentence. */
export const unofferedReason = (option: UnofferedOption) =>
  option.reason === "unpriced"
    ? `${option.name} has no price in ${option.currencies.join(" or ")}, the currency buyers there pay in.`
    : `${option.name} delivers only to countries where this marketplace has no buyers.`

export const readDeliverySetup = async (): Promise<DeliverySetup> => {
  const [channel, locations, shippingOptions, regions] = await Promise.all([
    defaultSalesChannel(),
    listLocations(),
    listShippingOptions(),
    listRegions(),
  ])
  return describeDelivery(channel, locations, shippingOptions, regions)
}

/**
 * The currency a new listing is priced in: that of the region the store's
 * stock location is in, or else of the first region. Null when the
 * marketplace has no region, and so no buyer anywhere.
 */
export const listingCurrency = (
  delivery: Pick<DeliverySetup, "regions" | "location"> | null | undefined
): string | null => {
  const regions = delivery?.regions ?? []
  const region =
    regionOfCountry(regions, delivery?.location?.address?.country_code) ??
    regions[0] ??
    null
  return region ? lower(region.currency_code) : null
}

type ProductRow = { id: string; title?: string; status?: string }
type VariantRow = {
  id: string
  title?: string
  variant_rank?: number | null
  manage_inventory?: boolean | null
  allow_backorder?: boolean | null
  inventory_items?: Array<{ inventory_item_id?: string | null }> | null
  prices?: PriceRow[] | null
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
  /**
   * With none buyable: a published product with no price in a currency
   * buyers pay in (`currencies`). A cart refuses a variant without one.
   */
  needsPrice: ListingRef | null
  /** With none buyable: a published product that is stock-tracked and has none. */
  needsStock: ListingRef | null
  /** With none published: a draft to publish. */
  draft: ListingRef | null
  /** The currencies a product is checked for a price in, upper case. */
  currencies: string[]
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

/** Untracked, or in stock at one of these locations. */
const variantHasStock = async (variant: VariantRow, locationIds: string[]) => {
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

/**
 * Whether one of the store's first published products could be added to a
 * cart: a variant with a price in the currency of one of `regions`, untracked
 * or in stock at one of `linkedLocationIds`.
 */
export const readListingSetup = async (
  linkedLocationIds: string[],
  regions: SellingRegion[]
): Promise<ListingSetup> => {
  const { products } = await get("/vendor/products")
  const all = ((products ?? []) as Array<ProductRow | null>).filter(
    (product): product is ProductRow => Boolean(product?.id)
  )
  const published = all.filter((product) => product.status === "published")
  const draft = all.find((product) => product.status === "draft")
  const currencies = [
    ...new Set(regions.map((region) => region.currency_code.toUpperCase())),
  ]

  let needsPrice: ListingRef | null = null
  let needsStock: ListingRef | null = null
  for (const product of published.slice(0, PRODUCTS_CHECKED)) {
    const detail = await get(`/vendor/products/${product.id}`)
    const variants = ((detail?.product?.variants ?? []) as VariantRow[]).slice(
      0,
      VARIANTS_CHECKED
    )
    for (const variant of variants) {
      if (!regions.some((region) => pricedIn(variant.prices, region))) {
        if (!needsPrice) needsPrice = ref(product)
        continue
      }
      if (await variantHasStock(variant, linkedLocationIds)) {
        return {
          total: all.length,
          buyable: ref(product),
          needsPrice: null,
          needsStock: null,
          draft: null,
          currencies,
        }
      }
      if (!needsStock) needsStock = ref(product)
    }
  }

  return {
    total: all.length,
    buyable: null,
    needsPrice,
    needsStock:
      needsStock ?? (!needsPrice && published[0] ? ref(published[0]) : null),
    draft: published[0] || !draft ? null : ref(draft),
    currencies,
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
  // A product counts in a region a buyer is offered delivery in; with none
  // yet, in any region, so the listing's own state can still be told.
  const offered = delivery.regions.filter((region) =>
    delivery.options.some((option) => option.regions.includes(region.id))
  )
  const listing = await readListingSetup(
    linkedIds,
    offered.length > 0 ? offered : delivery.regions
  )
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
  /**
   * Shipped anywhere in the location's country for one price, in major units
   * of the currency of the region that country is in (`listingCurrency`).
   */
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

/**
 * The name of a stock location's fulfillment set. Medusa keeps these unique
 * across the whole marketplace (`IDX_fulfillment_set_name_unique`), not per
 * store, so the location's id is part of it: "Home shipping" could be made by
 * one store only, and the next store with a location called Home was refused.
 */
export const fulfillmentSetName = (
  locationName: string,
  locationId: string,
  kind: DeliveryKind
) =>
  `${locationName} ${kind === "pickup" ? "pick up" : "shipping"} (${locationId})`

/** A service zone's name: unique marketplace-wide too, so it carries its set's id. */
export const serviceZoneName = (countryCode: string, fulfillmentSetId: string) =>
  `${countryCode.toUpperCase()} (${fulfillmentSetId})`

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
 * flat-rate shipping option, or both, covering the location's country and
 * priced in the currency of the region that country is in. A country in no
 * region is refused before anything is written: an option there would be
 * offered to no buyer.
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
  const [channel, locations, existingOptions, regions] = await step(
    "read your store's current setup",
    () =>
      Promise.all([
        defaultSalesChannel(),
        listLocations(),
        listShippingOptions(),
        listRegions(),
      ])
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

  // Where the options deliver, and so which region's buyers they are for and
  // what currency they are priced in. Checked before anything is written.
  const country = lower(location?.address?.country_code || input.location.country_code)
  let region: SellingRegion | null = null
  if (wanted.length > 0) {
    if (!country) {
      throw new SetupStepError(
        "work out where you deliver",
        "the stock location has no country. Add one in Settings, Locations."
      )
    }
    if (regions.length === 0) {
      throw new SetupStepError(
        "work out where you deliver",
        "this marketplace has no buyer regions yet, so no option would be offered to anyone. Contact support."
      )
    }
    region = regionOfCountry(regions, country)
    if (!region) {
      throw new SetupStepError(
        "work out where you deliver",
        `buyers on this marketplace are in ${regionCountryNames(regions)}, and ${
          location ? `${location.name} is` : "that place is"
        } in ${country.toUpperCase()}: an option there would be offered to no one. ${
          location
            ? "Change its address in Settings, Locations."
            : "Choose a place in one of those countries."
        }`
      )
    }
  }
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

  const options: DeliverySetupResult["options"] = []
  if (region && wanted.length > 0) {
    const currency = lower(region.currency_code)
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

    for (const want of wanted) {
      const label =
        want.kind === "pickup" ? "the pickup option" : "the shipping option"

      // 6. The location's fulfillment set of this kind.
      let set = location.fulfillment_sets?.find((s) => s?.type === want.kind)
      if (!set) {
        const made = await step(`set up ${label}`, () =>
          post(`/vendor/stock-locations/${locationId}/fulfillment-sets`, {
            name: fulfillmentSetName(location!.name, locationId, want.kind),
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
        const zoneName = serviceZoneName(country, setId)
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
          prices: [{ currency_code: currency, amount: want.amount }],
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
 * Medusa's `toHandle` (`@medusajs/utils`), with leading and trailing hyphens
 * dropped so the result passes its `isValidHandle`: "Pat's Pickles" is
 * "pats-pickles".
 */
export const toHandle = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")

/**
 * A product handle for this store: the title's, then the store's own handle,
 * then "-2", "-3"… while the store already has it. Product handles are unique
 * across the whole marketplace (measured: a second store's "Pat's Pickles"
 * was refused, "Product with handle: pats-pickles, already exists."), and
 * store handles are unique, so two stores never ask for the same one.
 */
export const storeProductHandle = (
  title: string,
  storeHandle: string,
  taken: ReadonlySet<string>
) => {
  const base = [toHandle(title) || "listing", toHandle(storeHandle)]
    .filter(Boolean)
    .join("-")
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const next = `${base}-${n}`
    if (!taken.has(next)) return next
  }
}

type OwnProduct = ProductRow & { handle?: string | null }

/** FBM's `GET /vendor/products` answers every product of the store, unpaged. */
const listOwnProducts = async (): Promise<OwnProduct[]> => {
  const { products } = await get("/vendor/products")
  return ((products ?? []) as Array<OwnProduct | null>).filter(
    (product): product is OwnProduct => Boolean(product?.id)
  )
}

const readStoreHandle = async () => {
  const { seller } = await get("/vendor/sellers/me", { fields: "id,handle" })
  // Mercur gives every store a unique handle; the end of its id otherwise.
  return toHandle(String(seller?.handle ?? "")) || toHandle(String(seller?.id ?? "").slice(-8))
}

export type CreatedProduct = {
  product: { id: string; title: string } & Record<string, unknown>
}

/**
 * Create a product in the store: `POST /vendor/seller-products`, with a
 * handle of the store's own unless the vendor typed one.
 *
 * When the create fails, the store's products are read again: one with the
 * handle that was sent, which the store did not have before, is the product
 * the request made before its answer was lost, and it is returned instead of
 * the error. Measured without this: after a lost answer, sending the listing
 * again answered 400 "Product with handle: frans-bouquet, already exists.",
 * and the draft the first request made was left behind. Nothing is sent
 * again: this only reads.
 */
export const createProductInStore = async (
  payload: { title?: string; handle?: string | null } & Record<string, unknown>
): Promise<CreatedProduct> => {
  const typed = typeof payload.handle === "string" ? payload.handle.trim() : ""
  const [before, storeHandle] = await Promise.all([
    listOwnProducts(),
    typed ? Promise.resolve("") : readStoreHandle(),
  ])
  const taken = new Set(
    before.map((product) => product.handle ?? "").filter(Boolean)
  )
  const handle =
    typed || storeProductHandle(String(payload.title ?? ""), storeHandle, taken)

  try {
    return (await post("/vendor/seller-products", {
      ...payload,
      handle,
    })) as CreatedProduct
  } catch (error) {
    if (!taken.has(handle)) {
      const after = await listOwnProducts().catch(() => [] as OwnProduct[])
      const made = after.find((product) => product.handle === handle)
      if (made) {
        return { product: { ...made, title: made.title ?? "" } }
      }
    }
    throw error
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
