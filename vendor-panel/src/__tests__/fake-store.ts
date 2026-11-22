import { json, type createBackend } from "./backend"

/**
 * One seller's store as the vendor routes present it, for specs of the guided
 * delivery setup, the launch wizard and the dashboard. It keeps state, so a
 * spec can run the setup and then read what a buyer would find.
 *
 * It follows what the backend does, read from Mercur 1.5.0's and FBM's route
 * sources and from the payloads the MVP sweep sent (SD-151):
 *
 *   - the body schemas Mercur declares `.strict()` refuse an unknown key
 *     (`POST /vendor/shipping-options`, fulfillment sets, service zones, the
 *     inventory batch);
 *   - a shipping option needs its provider enabled at the zone's location;
 *   - fulfillment-set and service-zone names are unique across the whole
 *     marketplace (`IDX_fulfillment_set_name_unique`,
 *     `IDX_service_zone_name_unique`), so `takenNames` stands for the other
 *     stores' names;
 *   - `GET /vendor/shipping-profiles` answers link rows holding the profile;
 *   - `GET /vendor/stock-locations` answers sales channels and service zones
 *     only when `fields` asks for them;
 *   - a product's variants do not come back in `variant_rank` order (the
 *     review measured the create answering rank 1 before rank 0), so they are
 *     answered last rank first here, and only `variant_rank` says which is
 *     which;
 *   - another store's product or inventory item is refused with Mercur's
 *     403, "You are not allowed to perform this action" (measured);
 *   - `POST /vendor/onboarding/publish` records any `listing_id`, as the base
 *     does (measured: another store's product id answered 200); refusing a
 *     foreign id is the backend onboarding unit's change, not the base's;
 *   - a buyer is in the region whose countries include their address
 *     country; the options offered are those whose service zone covers that
 *     country, and an option or a variant can be taken only with a price in
 *     the region's currency (`buyerCanCheckOut`, after the review's measured
 *     Canada-zone and EUR-only cases);
 *   - `POST /vendor/inventory-items/location-levels/batch` refuses another
 *     store's item or location with 403. At the base it accepts them
 *     (measured: one store wrote another's levels, the hole a backend fix is
 *     closing); modelling the fixed route makes a spec fail if the panel
 *     ever sends an id that is not the store's own.
 *
 * It is a model, not the backend: a spec that passes here says the panel
 * sends what was read and measured, not that Postgres agrees.
 */

type Backend = ReturnType<typeof createBackend>

type Location = {
  id: string
  name: string
  address: Record<string, unknown>
  channels: string[]
  providers: string[]
}
type FulfillmentSet = { id: string; name: string; type: string; location: string }
type Zone = {
  id: string
  name: string
  set: string
  geo_zones: Array<Record<string, unknown>>
}
type Option = Record<string, any> & { id: string; name: string; zone: string }
type Variant = {
  id: string
  title: string
  variant_rank: number
  manage_inventory: boolean
  allow_backorder: boolean
  item: string | null
  prices: Price[]
}
type Product = Record<string, any> & {
  id: string
  title: string
  status: string
  variants: Variant[]
}
type Level = { id: string; item: string; location: string; stocked: number }
type Region = {
  id: string
  name: string
  currency_code: string
  countries: Array<{ iso_2: string; display_name: string }>
}
/** A price as stored: rules as Medusa keeps them, attribute by attribute. */
type Price = {
  currency_code: string
  amount: number
  rules: Array<{ attribute: string; value: string }>
}

/** The marketplace the MVP sweep ran against: one region, the United States, in USD. */
export const US_REGION: Region = {
  id: "reg_us",
  name: "United States",
  currency_code: "usd",
  countries: [{ iso_2: "us", display_name: "United States" }],
}

const refuse = (message: string) =>
  json(400, { type: "invalid_data", message })
/** Mercur's ownership check, word for word (measured). */
const notYours = () =>
  json(403, { message: "You are not allowed to perform this action" })

/** As a zod `.strict()` object refuses a key it does not declare. */
const unknownKey = (body: unknown, allowed: string[]) => {
  const extra = Object.keys((body ?? {}) as object).filter(
    (key) => !allowed.includes(key)
  )
  return extra.length
    ? refuse(`Invalid request: Unrecognized fields: '${extra.join(", ")}'`)
    : null
}

/**
 * Prices as sent: `{ currency_code, amount }`, a shipping option's
 * `{ region_id, amount }` (Medusa gives it the region's currency and a
 * `region_id` rule), or a variant's `{ currency_code, amount, rules }`.
 */
const storePrices = (sent: unknown, regions: Region[]): Price[] =>
  (Array.isArray(sent) ? sent : []).map((price: Record<string, any>) => {
    const region = regions.find((r) => r.id === price?.region_id)
    const rules = Object.entries((price?.rules ?? {}) as Record<string, unknown>).map(
      ([attribute, value]) => ({ attribute, value: String(value) })
    )
    return region
      ? {
          currency_code: region.currency_code,
          amount: price.amount,
          rules: [{ attribute: "region_id", value: region.id }, ...rules],
        }
      : { currency_code: String(price?.currency_code ?? ""), amount: price?.amount, rules }
  })
/** Medusa's choice of price for a cart in `region`. */
const chargedIn = (prices: Price[], region: Region) =>
  prices.some(
    (price) =>
      price.currency_code.toLowerCase() === region.currency_code.toLowerCase() &&
      price.rules.every((rule) => rule.attribute === "region_id" && rule.value === region.id)
  )
/** As Medusa answers a price: its rules only when `fields` asks for them. */
const priceView = (price: Price, index: number, withRules: boolean) => ({
  id: `price_${index + 1}`,
  currency_code: price.currency_code,
  amount: price.amount,
  rules_count: price.rules.length,
  ...(withRules && {
    price_rules: price.rules.map((rule) => ({ ...rule, operator: "eq" })),
  }),
})

export const createFakeStore = (
  backend: Backend,
  seed: {
    /** No default shipping profile, as for a store approval did not finish. */
    noShippingProfile?: boolean
    /** Fulfillment-set and service-zone names other stores already use. */
    takenNames?: string[]
    /** What the product-create route answers instead of creating. */
    refuseProducts?: () => Response
    /** Where buyers are: the United States in USD unless a spec says otherwise. */
    regions?: Region[]
  } = {}
) => {
  let serial = 0
  const id = (prefix: string) => `${prefix}_${++serial}`

  const db = {
    channel: { id: "sc_1", name: "Default Sales Channel" },
    providers: ["digital_digital", "local-delivery_local-delivery", "manual_manual"],
    locations: [] as Location[],
    sets: [] as FulfillmentSet[],
    zones: [] as Zone[],
    options: [] as Option[],
    profiles: seed.noShippingProfile
      ? []
      : [{ id: "sp_default", name: "sel_1:Default shipping profile", type: "default" }],
    products: [] as Product[],
    levels: [] as Level[],
    takenNames: new Set(seed.takenNames ?? []),
    regions: seed.regions ?? [US_REGION],
    onboarding: {
      id: "onb_1",
      selling_type: null as string | null,
      wizard_step: "signup",
      wizard_step_completed_at: null,
      first_published_listing_id: null as string | null,
    },
    recalculations: 0,
    uploads: 0,
    /** `GET /vendor/playbook/assign`: a Stall seller unless a spec says otherwise. */
    assignment: { recipe_id: "stall", metadata: { roles: ["stall"] } } as Record<
      string,
      unknown
    > | null,
  }

  const zonesOf = (set: FulfillmentSet) =>
    db.zones
      .filter((zone) => zone.set === set.id)
      .map((zone) => ({
        id: zone.id,
        name: zone.name,
        fulfillment_set_id: zone.set,
        geo_zones: zone.geo_zones,
      }))
  const locationView = (location: Location, fields = "") => ({
    id: location.id,
    name: location.name,
    address: location.address,
    fulfillment_sets: db.sets
      .filter((set) => set.location === location.id)
      .map((set) => ({
        id: set.id,
        name: set.name,
        type: set.type,
        ...(fields.includes("fulfillment_sets.service_zones") && {
          service_zones: zonesOf(set),
        }),
      })),
    fulfillment_providers: location.providers.map((p) => ({ id: p })),
    ...(fields.includes("sales_channels") && {
      sales_channels: location.channels.map((c) => ({ id: c, name: db.channel.name })),
    }),
  })
  const optionView = (option: Option, fields = "") => {
    const zone = db.zones.find((z) => z.id === option.zone)!
    const { zone: _zone, rules, prices, ...rest } = option
    // `*prices` is in Mercur's defaults; the rules of each only on request.
    const withPriceRules = fields.includes("prices.price_rules")
    return {
      ...rest,
      prices: (prices as Price[]).map((price, i) => priceView(price, i, withPriceRules)),
      service_zone_id: zone.id,
      service_zone: { id: zone.id, name: zone.name, fulfillment_set_id: zone.set },
      ...(fields.split(",").includes("*rules") && { rules }),
    }
  }
  /** Not in rank order: last rank first. */
  const answered = (variants: Variant[]) => [...variants].reverse()
  // FBM's detail route reads `variants.prices.*`: the prices, not their rules.
  const productView = (product: Product) => ({
    ...product,
    variants: answered(product.variants).map(({ item, prices, ...variant }) => ({
      ...variant,
      prices: (prices as Price[]).map((price, i) => priceView(price, i, false)),
      inventory_items: item ? [{ inventory_item_id: item, required_quantity: 1 }] : [],
    })),
  })
  const ownItems = () =>
    new Set(
      db.products.flatMap((p) =>
        p.variants.map((v) => v.item).filter((item): item is string => Boolean(item))
      )
    )
  const findLocation = (path: string) =>
    db.locations.find((l) => l.id === path.split("/")[3])

  backend.on("GET", "/vendor/regions", () =>
    json(200, { regions: db.regions, count: db.regions.length })
  )

  backend.on("GET", "/vendor/sales-channels", () =>
    json(200, { sales_channels: [db.channel], count: 1 })
  )

  backend.on("GET", "/vendor/stock-locations", ({ query }) =>
    json(200, {
      stock_locations: db.locations.map((l) => locationView(l, query.fields)),
      count: db.locations.length,
    })
  )
  backend.on("POST", "/vendor/stock-locations", ({ body }) => {
    const b = body as Record<string, any>
    if (typeof b?.name !== "string" || !b.name.trim()) return refuse("name is required")
    if (b.address && (!b.address.address_1 || !b.address.country_code)) {
      return refuse("address_1 and country_code are required")
    }
    const location: Location = {
      id: id("sloc"),
      name: b.name,
      address: b.address ?? {},
      channels: [],
      providers: [],
    }
    db.locations.push(location)
    return json(201, { stock_location: locationView(location) })
  })
  backend.on("POST", /^\/vendor\/stock-locations\/[^/]+\/sales-channels$/, ({ path, body }) => {
    const location = findLocation(path)
    if (!location) return json(404, { message: "Stock location not found" })
    for (const channel of (body as { add?: string[] }).add ?? []) {
      if (channel !== db.channel.id) return refuse(`Sales channel ${channel} not found`)
      if (!location.channels.includes(channel)) location.channels.push(channel)
    }
    return json(200, { stock_location: locationView(location) })
  })
  backend.on("POST", /^\/vendor\/stock-locations\/[^/]+\/fulfillment-providers$/, ({ path, body }) => {
    const location = findLocation(path)
    if (!location) return json(404, { message: "Stock location not found" })
    for (const provider of (body as { add?: string[] }).add ?? []) {
      if (!db.providers.includes(provider)) return refuse(`Provider ${provider} not found`)
      if (!location.providers.includes(provider)) location.providers.push(provider)
    }
    return json(200, { stock_location: locationView(location) })
  })
  backend.on("POST", /^\/vendor\/stock-locations\/[^/]+\/fulfillment-sets$/, ({ path, body }) => {
    const location = findLocation(path)
    if (!location) return json(404, { message: "Stock location not found" })
    const strict = unknownKey(body, ["name", "type"])
    if (strict) return strict
    const b = body as { name: string; type: string }
    if (db.takenNames.has(b.name) || db.sets.some((s) => s.name === b.name)) {
      return refuse(`Fulfillment set with name: ${b.name}, already exists.`)
    }
    db.sets.push({ id: id("fuset"), name: b.name, type: b.type, location: location.id })
    return json(200, { stock_location: locationView(location) })
  })

  backend.on("POST", /^\/vendor\/fulfillment-sets\/[^/]+\/service-zones$/, ({ path, body }) => {
    const set = db.sets.find((s) => s.id === path.split("/")[3])
    if (!set) return json(404, { message: "Fulfillment set not found" })
    const strict = unknownKey(body, ["name", "geo_zones"])
    if (strict) return strict
    const b = body as { name: string; geo_zones?: Array<Record<string, unknown>> }
    if (db.takenNames.has(b.name) || db.zones.some((z) => z.name === b.name)) {
      return refuse(`Service zone with name: ${b.name}, already exists.`)
    }
    db.zones.push({ id: id("serzo"), name: b.name, set: set.id, geo_zones: b.geo_zones ?? [] })
    return json(200, {
      fulfillment_set: { id: set.id, name: set.name, type: set.type, service_zones: zonesOf(set) },
    })
  })

  backend.on("GET", "/vendor/fulfillment-providers", () =>
    json(200, { fulfillment_providers: db.providers.map((p) => ({ id: p, is_enabled: true })) })
  )
  backend.on("GET", "/vendor/fulfillment-providers/manual_manual/options", () =>
    json(200, {
      fulfillment_options: [
        { id: "manual-fulfillment" },
        { id: "manual-fulfillment-return", is_return: true },
      ],
    })
  )

  backend.on("GET", "/vendor/shipping-profiles", () =>
    json(200, {
      shipping_profiles: db.profiles.map((profile) => ({ shipping_profile: profile })),
      count: db.profiles.length,
    })
  )
  backend.on("POST", "/vendor/shipping-profiles", ({ body }) => {
    const strict = unknownKey(body, ["name", "type", "metadata"])
    if (strict) return strict
    const b = body as { name: string; type: string }
    const profile = { id: id("sp"), name: `sel_1:${b.name}`, type: b.type }
    db.profiles.push(profile)
    return json(201, { shipping_profile: profile })
  })

  backend.on("GET", "/vendor/shipping-options", ({ query }) =>
    json(200, {
      shipping_options: db.options.map((o) => optionView(o, query.fields)),
      count: db.options.length,
    })
  )
  backend.on("POST", "/vendor/shipping-options", ({ body }) => {
    const strict = unknownKey(body, [
      "name",
      "service_zone_id",
      "shipping_profile_id",
      "data",
      "provider_id",
      "prices",
      "type",
      "rules",
    ])
    if (strict) return strict
    const b = body as Record<string, any>
    const zone = db.zones.find((z) => z.id === b.service_zone_id)
    if (!zone) return json(403, { message: "You are not allowed to perform this action" })
    if (!db.profiles.some((p) => p.id === b.shipping_profile_id)) {
      return refuse(`Shipping profile ${b.shipping_profile_id} not found`)
    }
    const set = db.sets.find((s) => s.id === zone.set)!
    const location = db.locations.find((l) => l.id === set.location)!
    if (!location.providers.includes(b.provider_id)) {
      return refuse(
        `Providers (${b.provider_id}) are not enabled for the service location`
      )
    }
    if (
      !Array.isArray(b.prices) ||
      b.prices.some((p: any) => typeof p?.amount !== "number")
    ) {
      return refuse("prices must carry a numeric amount")
    }
    if (!b.type?.label || !b.type?.description || !b.type?.code) {
      return refuse("type needs label, description and code")
    }
    const option: Option = {
      ...b,
      prices: storePrices(b.prices, db.regions),
      id: id("so"),
      name: b.name,
      zone: zone.id,
      price_type: "flat",
    }
    delete option.service_zone_id
    db.options.push(option)
    return json(201, { shipping_option: optionView(option) })
  })

  backend.on("POST", "/vendor/sellers/me/onboarding", () => {
    db.recalculations += 1
    return json(200, {
      onboarding: {
        store_information: false,
        stripe_connection: false,
        // Mercur's rule: any stock location, any product.
        locations_shipping: db.locations.length > 0,
        products: db.products.length > 0,
      },
    })
  })

  backend.on("POST", "/vendor/seller-products", ({ body }) => {
    if (seed.refuseProducts) return seed.refuseProducts()
    const b = body as Record<string, any>
    if (!b?.title) return refuse("title is required")
    const product: Product = {
      ...b,
      id: id("prod"),
      title: b.title,
      status: b.status ?? "draft",
      handle: String(b.title).toLowerCase().replace(/\W+/g, "-"),
      variants: (b.variants ?? []).map((v: Record<string, any>, index: number) => ({
        id: id("variant"),
        title: v.title ?? "Default variant",
        variant_rank: v.variant_rank ?? index,
        // Medusa's default when a variant does not say.
        manage_inventory: v.manage_inventory !== false,
        allow_backorder: v.allow_backorder === true,
        item: v.manage_inventory !== false ? id("iitem") : null,
        prices: storePrices(v.prices, db.regions),
      })),
    }
    db.products.push(product)
    // The create route answers variants without their inventory items.
    return json(200, {
      product: {
        ...product,
        variants: answered(product.variants).map(({ item: _item, ...variant }) => variant),
      },
    })
  })
  backend.on("GET", "/vendor/products", () =>
    json(200, {
      products: db.products.map(({ variants: _variants, ...product }) => product),
      count: db.products.length,
    })
  )
  backend.on("GET", /^\/vendor\/products\/[^/]+$/, ({ path }) => {
    const product = db.products.find((p) => p.id === path.split("/")[3])
    return product ? json(200, { product: productView(product) }) : notYours()
  })
  backend.on("POST", /^\/vendor\/products\/[^/]+\/status$/, ({ path, body }) => {
    const product = db.products.find((p) => p.id === path.split("/")[3])
    if (!product) return notYours()
    product.status = (body as { status: string }).status
    return json(200, {
      product: { id: product.id, title: product.title, status: product.status },
    })
  })

  backend.on("GET", /^\/vendor\/inventory-items\/[^/]+\/location-levels$/, ({ path }) => {
    const item = path.split("/")[3]
    if (!ownItems().has(item)) return notYours()
    return json(200, {
      location_levels: db.levels
        .filter((level) => level.item === item)
        .map((level) => ({
          id: level.id,
          inventory_item_id: level.item,
          location_id: level.location,
          stocked_quantity: level.stocked,
          reserved_quantity: 0,
          available_quantity: level.stocked,
        })),
    })
  })
  backend.on("POST", "/vendor/inventory-items/location-levels/batch", ({ body }) => {
    const strict = unknownKey(body, ["create", "update", "delete", "force"])
    if (strict) return strict
    const b = body as Record<string, Array<Record<string, any>>>
    const allowed = ["inventory_item_id", "location_id", "stocked_quantity", "incoming_quantity"]
    for (const row of [...(b.create ?? []), ...(b.update ?? [])]) {
      const bad = unknownKey(row, allowed)
      if (bad) return bad
      if (!Number.isInteger(row.stocked_quantity) || row.stocked_quantity < 0) {
        return refuse("stocked_quantity must be a whole number, zero or more")
      }
      // The fixed route: only the store's own items and locations.
      if (
        !ownItems().has(row.inventory_item_id) ||
        !db.locations.some((l) => l.id === row.location_id)
      ) {
        return notYours()
      }
    }
    const created: Level[] = []
    for (const row of b.create ?? []) {
      if (db.levels.some((l) => l.item === row.inventory_item_id && l.location === row.location_id)) {
        return refuse(
          `Inventory level for item ${row.inventory_item_id} and location ${row.location_id} already exists`
        )
      }
      const level = {
        id: id("ilev"),
        item: row.inventory_item_id,
        location: row.location_id,
        stocked: row.stocked_quantity,
      }
      db.levels.push(level)
      created.push(level)
    }
    for (const row of b.update ?? []) {
      const level = db.levels.find(
        (l) => l.item === row.inventory_item_id && l.location === row.location_id
      )
      if (!level) return refuse("Inventory level not found")
      level.stocked = row.stocked_quantity
    }
    return json(200, { created, updated: b.update ?? [], deleted: [] })
  })

  backend.on("GET", "/vendor/playbook/assign", () =>
    json(200, { playbook_assignment: db.assignment })
  )
  backend.on("GET", "/vendor/cottage-food/onboarding", () =>
    json(200, { needs_setup: true, profile: null, checklist: [] })
  )
  // The file module's answer: where each uploaded file can be fetched.
  backend.on("POST", "/vendor/uploads", ({ body }) => {
    const files = body instanceof FormData ? body.getAll("files") : []
    db.uploads += files.length
    return json(200, {
      files: files.map((file, index) => ({
        id: id("file"),
        url: `https://files.fbm.test/${index}-${(file as File).name}`,
      })),
    })
  })

  backend.on("GET", "/vendor/onboarding", () =>
    json(200, { state: { ...db.onboarding }, archetype_code: null })
  )
  backend.on("PATCH", "/vendor/onboarding", ({ body }) => {
    const b = body as { step?: string; selling_type?: string }
    if (b.step) db.onboarding.wizard_step = b.step
    if (b.selling_type !== undefined) db.onboarding.selling_type = b.selling_type
    return json(200, { state: { ...db.onboarding } })
  })
  backend.on("POST", "/vendor/onboarding/publish", ({ body }) => {
    // Any id, the store's or not: the base checks nothing (measured).
    const listing = (body as { listing_id?: string }).listing_id
    db.onboarding.wizard_step = "published"
    db.onboarding.first_published_listing_id = listing ?? null
    return json(200, { state: { ...db.onboarding } })
  })

  return {
    db,
    /**
     * What Medusa and Mercur ask of a cart before a buyer of this store's
     * first published product can complete it, in the order they ask: a
     * buyer at an address in `country` (the United States by default), in
     * whatever region holds that country. The stock-location, inventory,
     * shipping-method and option-price refusals are the measured wording;
     * the variant-price one is Medusa's (`get-variant-price-sets`), read.
     */
    buyerCanCheckOut: (country = "us"): true | string => {
      const region = db.regions.find((r) =>
        r.countries.some((c) => c.iso_2 === country.toLowerCase())
      )
      if (!region) return `No region holds ${country.toUpperCase()}`
      const product = db.products.find((p) => p.status === "published")
      if (!product) return "no published product"
      const linked = db.locations.filter((l) => l.channels.includes(db.channel.id))
      const variant = product.variants[0]
      // Adding to the cart: a price in the cart's currency.
      if (!chargedIn(variant.prices as Price[], region)) {
        return `Variants with IDs ${variant.id} do not have a price`
      }
      if (variant.manage_inventory) {
        if (linked.length === 0) {
          return `Sales channel ${db.channel.id} is not associated with any stock location for variant ${variant.id}.`
        }
        const stocked = db.levels.some(
          (level) =>
            level.item === variant.item &&
            linked.some((l) => l.id === level.location) &&
            level.stocked > 0
        )
        if (!stocked) return "Some variant does not have the required inventory"
      }
      // The options offered for the address: on a linked location, not for
      // returns, in a zone that covers the buyer's country.
      const offered = db.options.filter((option) => {
        const zone = db.zones.find((z) => z.id === option.zone)
        const set = db.sets.find((s) => s.id === zone?.set)
        return (
          linked.some((l) => l.id === set?.location) &&
          !option.rules?.some(
            (r: any) => r.attribute === "is_return" && r.value === "true"
          ) &&
          Boolean(
            zone?.geo_zones.some(
              (g) => String(g.country_code).toLowerCase() === country.toLowerCase()
            )
          )
        )
      })
      // Measured: with none offered the completion answers this.
      if (offered.length === 0) return "Seller shipping method not found!"
      // Measured: adding an option with no price in the cart's currency.
      if (!offered.some((option) => chargedIn(option.prices as Price[], region))) {
        return `Shipping options with IDs ${offered.map((o) => o.id).join(", ")} do not have a price`
      }
      return true
    },
  }
}
