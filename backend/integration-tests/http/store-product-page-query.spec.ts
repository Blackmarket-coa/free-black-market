import fs from "fs"
import path from "path"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { ATTRIBUTE_MODULE } from "@mercurjs/b2c-core/modules/attribute"
import { REVIEW_MODULE } from "@mercurjs/reviews/modules/reviews"
import { safe } from "./helpers/seller-auth"

jest.setTimeout(240 * 1000)

/**
 * The storefront's own product queries, issued against a real database.
 *
 * From 2026-06-16 the storefront asked `GET /store/products` for
 * `id,title,handle,thumbnail,status` with no region, as a workaround for
 * relation expansions failing in MikroORM, and a product page received no
 * variants, prices, options, images or seller: nothing could be added to a
 * cart from it. Nothing ran the storefront's query against the backend, so
 * nothing noticed; the storefront's own tests stub the fetch.
 *
 * This spec loads the storefront module that builds the queries
 * (`storefront/src/lib/data/product-query.ts`, pure and import-free for this
 * purpose) and sends what it builds, serialised as `@medusajs/js-sdk` does,
 * through the real `/store/products` route: publishable key, sales channel,
 * pricing and tax context, the remote joins to Mercur's seller, review and
 * attribute modules, and MikroORM 6.6.14 with `scripts/patch-mikro-orm.js`
 * applied. A field the backend cannot serve, or an expansion that fails
 * again, fails here.
 */

const STOREFRONT_QUERY = path.resolve(__dirname, "../../../storefront/src/lib/data/product-query.ts")

type Query = Record<string, string | number | string[] | undefined>

type StorefrontProductQuery = {
  PRODUCT_PAGE_FIELDS: string
  PRODUCT_LIST_FIELDS: string
  PRODUCT_FEED_FIELDS: string
  pricingContext: (fields: string, regionId: string, countryCode?: string) => Query
  productPageQuery: (input: { handle: string; regionId: string; countryCode?: string; stock?: boolean }) => Query
  moreFromSellerHandles: (product: { id: string; seller?: { products?: unknown[] | null } | null }) => string[]
  productListQuery: (input: {
    fields?: string
    regionId: string
    countryCode?: string
    limit: number
    offset: number
  }) => Query
}

function loadStorefront(): StorefrontProductQuery | null {
  if (!fs.existsSync(STOREFRONT_QUERY)) {
    // The backend is sometimes checked out on its own; in CI the whole repo
    // is there and a missing file must fail, never pass by skipping.
    if (process.env.CI) throw new Error(`storefront product queries not found at ${STOREFRONT_QUERY}`)
    return null
  }
  return jest.requireActual(STOREFRONT_QUERY) as StorefrontProductQuery
}

/**
 * A query as `@medusajs/js-sdk` puts it on the wire:
 * `qs.stringify(query, { skipNulls: true })`, so an array is `key[0]=…` and
 * an undefined value is left out.
 */
function toQueryString(query: Query): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      value.forEach((item, i) => parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(item)}`))
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    }
  }
  return parts.join("&")
}

/** The seller columns a shopper's browser must never be sent. */
const SELLER_PRIVATE = ["email", "phone", "tax_id", "address_line", "city", "state", "postal_code"]

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, getContainer }) => {
    const storefront = loadStorefront()
    const run = storefront ? it : it.skip

    const container = () => getContainer() as any
    const link = () => container().resolve(ContainerRegistrationKeys.LINK)

    /**
     * A storefront as production has one: a sales channel behind a
     * publishable key, a US region in dollars, and a seller. The tomatoes
     * come in two sizes at $5.00 and $40.00: the pint is counted (7 in stock
     * at a location serving the channel), the crate is not counted at all.
     * They carry two images, a tag and an attribute.
     *
     * The seller has four more products, as a Mercur vendor does: sweet corn
     * at $3.00 and basil with no price in the region, both published in the
     * storefront's channel; a hot sauce still in draft; and a pallet that is
     * published but sold only through a wholesale channel. And two reviews:
     * one from a buyer, one whose customer is gone (a deleted customer loses
     * the link, and so does an imported review).
     */
    async function makeStorefront() {
      const [channel, wholesale] = await container()
        .resolve(Modules.SALES_CHANNEL)
        .createSalesChannels([{ name: "Storefront" }, { name: "Wholesale" }])
      const [key] = await container()
        .resolve(Modules.API_KEY)
        .createApiKeys([{ title: "storefront", type: "publishable", created_by: "test" }])
      await link().create({
        [Modules.API_KEY]: { publishable_key_id: key.id },
        [Modules.SALES_CHANNEL]: { sales_channel_id: channel.id },
      })
      const [region] = await container()
        .resolve(Modules.REGION)
        .createRegions([{ name: "United States", currency_code: "usd", countries: ["us"] }])

      const createdSeller = await container().resolve(SELLER_MODULE).createSellers({
        name: "Riverbend Farm",
        handle: "riverbend-farm",
        photo: "https://cdn.example.com/farm.png",
        email: "grower@riverbend.example",
        phone: "+15550100",
        tax_id: "12-3456789",
        address_line: "1 Farm Lane",
      })
      const seller = (Array.isArray(createdSeller) ? createdSeller[0] : createdSeller) as { id: string }

      const products = container().resolve(Modules.PRODUCT)
      const [tag] = await products.createProductTags([{ value: "organic" }])
      const [tomatoes, basil, corn, sauce, pallet] = await products.createProducts([
        {
          title: "Heirloom Tomatoes",
          handle: "heirloom-tomatoes",
          description: "<p>Vine ripened.</p>",
          status: "published",
          thumbnail: "https://cdn.example.com/tomatoes-thumb.jpg",
          images: [{ url: "https://cdn.example.com/tomatoes-1.jpg" }, { url: "https://cdn.example.com/tomatoes-2.jpg" }],
          tag_ids: [tag.id],
          metadata: { harvest: "weekly" },
          options: [{ title: "Size", values: ["Pint", "Crate"] }],
          variants: [
            { title: "Pint", sku: "TOM-PINT", manage_inventory: true, options: { Size: "Pint" } },
            { title: "Crate", sku: "TOM-CRATE", manage_inventory: false, options: { Size: "Crate" } },
          ],
        },
        {
          title: "Basil",
          handle: "basil",
          status: "published",
          options: [{ title: "Size", values: ["Bunch"] }],
          variants: [{ title: "Bunch", sku: "BASIL", manage_inventory: false, options: { Size: "Bunch" } }],
        },
        {
          title: "Sweet Corn",
          handle: "sweet-corn",
          status: "published",
          thumbnail: "https://cdn.example.com/corn-thumb.jpg",
          options: [{ title: "Size", values: ["Dozen"] }],
          variants: [{ title: "Dozen", sku: "CORN", manage_inventory: false, options: { Size: "Dozen" } }],
        },
        {
          title: "Unreleased Hot Sauce",
          handle: "unreleased-hot-sauce",
          status: "draft",
          thumbnail: "https://cdn.example.com/secret-sauce.jpg",
          options: [{ title: "Size", values: ["Bottle"] }],
          variants: [{ title: "Bottle", sku: "SAUCE", manage_inventory: false, options: { Size: "Bottle" } }],
        },
        {
          title: "Wholesale Pallet",
          handle: "wholesale-pallet",
          status: "published",
          thumbnail: "https://cdn.example.com/pallet.jpg",
          options: [{ title: "Size", values: ["Pallet"] }],
          variants: [{ title: "Pallet", sku: "PALLET", manage_inventory: false, options: { Size: "Pallet" } }],
        },
      ])
      for (const product of [tomatoes, basil, corn, sauce, pallet]) {
        await link().create({ [SELLER_MODULE]: { seller_id: seller.id }, [Modules.PRODUCT]: { product_id: product.id } })
        await link().create({
          [Modules.PRODUCT]: { product_id: product.id },
          [Modules.SALES_CHANNEL]: { sales_channel_id: product.id === pallet.id ? wholesale.id : channel.id },
        })
      }

      const bySku = (sku: string) =>
        [tomatoes, corn, sauce, pallet].flatMap((p) => p.variants).find((v: { sku: string }) => v.sku === sku) as { id: string }
      const pint = bySku("TOM-PINT")
      const crate = bySku("TOM-CRATE")
      const pricing = container().resolve(Modules.PRICING)
      for (const [variant, amount] of [
        [pint, 5],
        [crate, 40],
        [bySku("CORN"), 3],
        [bySku("SAUCE"), 9],
        [bySku("PALLET"), 400],
      ] as const) {
        const [priceSet] = await pricing.createPriceSets([{ prices: [{ amount, currency_code: "usd" }] }])
        await link().create({
          [Modules.PRODUCT]: { variant_id: variant.id },
          [Modules.PRICING]: { price_set_id: priceSet.id },
        })
      }

      const [location] = await container().resolve(Modules.STOCK_LOCATION).createStockLocations([{ name: "Farm" }])
      await link().create({
        [Modules.SALES_CHANNEL]: { sales_channel_id: channel.id },
        [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
      })
      const inventory = container().resolve(Modules.INVENTORY)
      const [item] = await inventory.createInventoryItems([{ sku: "TOM-PINT" }])
      await inventory.createInventoryLevels([{ inventory_item_id: item.id, location_id: location.id, stocked_quantity: 7 }])
      await link().create({
        [Modules.PRODUCT]: { variant_id: pint.id },
        [Modules.INVENTORY]: { inventory_item_id: item.id },
      })

      const [customer] = await container()
        .resolve(Modules.CUSTOMER)
        .createCustomers([{ email: "buyer@example.com", first_name: "Ada", last_name: "Buyer", phone: "+15550199" }])
      const createdReview = await container()
        .resolve(REVIEW_MODULE)
        .createReviews({ reference: "seller", rating: 5, customer_note: "Great tomatoes" })
      const review = (Array.isArray(createdReview) ? createdReview[0] : createdReview) as { id: string }
      await link().create({ [SELLER_MODULE]: { seller_id: seller.id }, [REVIEW_MODULE]: { review_id: review.id } })
      await link().create({ [Modules.CUSTOMER]: { customer_id: customer.id }, [REVIEW_MODULE]: { review_id: review.id } })
      const createdOrphan = await container()
        .resolve(REVIEW_MODULE)
        .createReviews({ reference: "seller", rating: 4, customer_note: "Fresh and sweet" })
      const orphan = (Array.isArray(createdOrphan) ? createdOrphan[0] : createdOrphan) as { id: string }
      await link().create({ [SELLER_MODULE]: { seller_id: seller.id }, [REVIEW_MODULE]: { review_id: orphan.id } })

      const attributes = container().resolve(ATTRIBUTE_MODULE)
      const createdAttribute = await attributes.createAttributes({ name: "Growing method", handle: "growing-method" })
      const attribute = (Array.isArray(createdAttribute) ? createdAttribute[0] : createdAttribute) as { id: string }
      const createdValue = await attributes.createAttributeValues({ value: "Organic", rank: 0, attribute_id: attribute.id })
      const attributeValue = (Array.isArray(createdValue) ? createdValue[0] : createdValue) as { id: string }
      await link().create({
        [Modules.PRODUCT]: { product_id: tomatoes.id },
        [ATTRIBUTE_MODULE]: { attribute_value_id: attributeValue.id },
      })

      const pak = { headers: { "x-publishable-api-key": key.token as string } }
      const get = (query: Query) => safe(api.get(`/store/products?${toQueryString(query)}`, pak))
      /** Link the storefront's publishable key to the wholesale channel as well. */
      const addSecondChannelToKey = () =>
        link().create({
          [Modules.API_KEY]: { publishable_key_id: key.id },
          [Modules.SALES_CHANNEL]: { sales_channel_id: wholesale.id },
        })
      return { get, region: region as { id: string }, seller, tomatoes, basil, corn, sauce, pallet, pint, crate, addSecondChannelToKey }
    }

    /** A listing's request for the given handles, as `listMoreFromSeller` sends it through `listProducts`. */
    const listByHandle = (regionId: string, handles: string[]) => ({
      ...storefront!.productListQuery({ regionId, countryCode: "us", limit: handles.length, offset: 0 }),
      handle: handles,
      order: "created_at",
    })

    describe("GET /store/products as the storefront asks", () => {
      run("the product page's query returns what the page renders: variants, prices, stock, options, images and the seller", async () => {
        const { get, region, seller, tomatoes, pint, crate } = await makeStorefront()

        const res = await get(storefront!.productPageQuery({ handle: "heirloom-tomatoes", regionId: region.id, countryCode: "us" }))

        expect(res.status).toBe(200)
        expect(res.data.products).toHaveLength(1)
        const product = res.data.products[0]
        expect(product).toMatchObject({
          id: tomatoes.id,
          title: "Heirloom Tomatoes",
          handle: "heirloom-tomatoes",
          thumbnail: "https://cdn.example.com/tomatoes-thumb.jpg",
          description: "<p>Vine ripened.</p>",
          metadata: { harvest: "weekly" },
          created_at: expect.any(String),
        })

        // The gallery, the tag chips and the option picker.
        expect(product.images.map((image: { url: string }) => image.url)).toEqual([
          "https://cdn.example.com/tomatoes-1.jpg",
          "https://cdn.example.com/tomatoes-2.jpg",
        ])
        expect(product.images[0].id).toEqual(expect.any(String))
        expect(product.tags.map((t: { value: string }) => t.value)).toEqual(["organic"])
        expect(product.options).toHaveLength(1)
        expect(product.options[0].title).toBe("Size")
        expect(product.options[0].values.map((v: { value: string }) => v.value).sort()).toEqual(["Crate", "Pint"])

        // The variants a buyer chooses between, each with the option it is
        // (the page matches the chosen option to a variant by its title and
        // value) and its price in the region's currency.
        const variant = (id: string) => product.variants.find((v: { id: string }) => v.id === id)
        expect(product.variants).toHaveLength(2)
        expect(variant(pint.id).options).toEqual([expect.objectContaining({ value: "Pint", option: expect.objectContaining({ title: "Size" }) })])
        expect(variant(crate.id).options).toEqual([expect.objectContaining({ value: "Crate", option: expect.objectContaining({ title: "Size" }) })])
        expect(variant(pint.id).calculated_price).toMatchObject({ calculated_amount: 5, original_amount: 5, currency_code: "usd" })
        expect(variant(crate.id).calculated_price).toMatchObject({ calculated_amount: 40, original_amount: 40, currency_code: "usd" })

        // Stock: the count for the variant Medusa counts, and no count at all
        // for the one it does not (the page must not read that as zero).
        expect(variant(pint.id)).toMatchObject({ manage_inventory: true, allow_backorder: false, inventory_quantity: 7 })
        expect(variant(crate.id).manage_inventory).toBe(false)
        expect(variant(crate.id)).not.toHaveProperty("inventory_quantity")

        // The seller block and its reviews.
        expect(product.seller).toMatchObject({
          id: seller.id,
          name: "Riverbend Farm",
          handle: "riverbend-farm",
          photo: "https://cdn.example.com/farm.png",
          store_status: "ACTIVE",
        })
        const reviewOf = (note: string) => product.seller.reviews.find((r: { customer_note: string }) => r.customer_note === note)
        expect(product.seller.reviews).toHaveLength(2)
        expect(reviewOf("Great tomatoes")).toMatchObject({
          rating: 5,
          created_at: expect.any(String),
          customer: expect.objectContaining({ first_name: "Ada", last_name: "Buyer" }),
          seller: expect.objectContaining({ name: "Riverbend Farm" }),
        })
        // A review whose customer is gone comes back with no `customer` at
        // all, not a null one: the seller block must render it without one.
        expect(reviewOf("Fresh and sweet")).toMatchObject({ rating: 4, seller: expect.objectContaining({ name: "Riverbend Farm" }) })
        expect(reviewOf("Fresh and sweet")).not.toHaveProperty("customer")
        expect(product.attribute_values).toEqual([
          expect.objectContaining({ value: "Organic", attribute: expect.objectContaining({ name: "Growing method" }) }),
        ])

        // The product goes to a client component whole, so what the page
        // asks for is what the browser receives: not the seller's email,
        // phone, address or tax id, and not the reviewer's contact details.
        for (const column of SELLER_PRIVATE) {
          expect(product.seller).not.toHaveProperty(column)
          expect(reviewOf("Great tomatoes").seller).not.toHaveProperty(column)
        }
        expect(reviewOf("Great tomatoes").customer).not.toHaveProperty("email")
        expect(reviewOf("Great tomatoes").customer).not.toHaveProperty("phone")
      })

      run("the seller's product link returns drafts and other channels' products; only what the listing serves is shown", async () => {
        const { get, region, tomatoes } = await makeStorefront()

        const page = await get(storefront!.productPageQuery({ handle: "heirloom-tomatoes", regionId: region.id, countryCode: "us" }))
        expect(page.status).toBe(200)
        const product = page.data.products[0]
        // The storefront's vitest renders its product page from this
        // response and the listing's answer below, in
        // `ProductDetailsPage/__tests__/fixtures/`. Run with
        // PRODUCT_PAGE_FIXTURE_OUT=<path of product-page-response.json> to
        // rewrite both; `more-from-seller-response.json` is written beside it.
        const fixtureOut = process.env.PRODUCT_PAGE_FIXTURE_OUT
        if (fixtureOut) {
          fs.writeFileSync(fixtureOut, `${JSON.stringify(page.data, null, 2)}\n`)
        }

        // What the link returns: every product of the seller, the draft and
        // the wholesale-only one among them, each with exactly the three
        // fields the storefront asks for. This is why the storefront takes
        // the list off the product before a component sees it.
        const linked = [...product.seller.products].sort((a: { handle: string }, b: { handle: string }) => a.handle.localeCompare(b.handle))
        expect(linked.map((p: { handle: string; status: string }) => [p.handle, p.status])).toEqual([
          ["basil", "published"],
          ["heirloom-tomatoes", "published"],
          ["sweet-corn", "published"],
          ["unreleased-hot-sauce", "draft"],
          ["wholesale-pallet", "published"],
        ])
        for (const stub of linked) {
          expect(Object.keys(stub).sort()).toEqual(["handle", "id", "status"])
        }

        // The storefront's candidates: published and not this product. The
        // status tells a draft apart; nothing on the link tells the
        // wholesale-only product apart, so it is still a candidate.
        const handles = storefront!.moreFromSellerHandles(product)
        expect([...handles].sort()).toEqual(["basil", "sweet-corn", "wholesale-pallet"])

        // The gate: the listing serves only published products in the
        // publishable key's sales channel, whatever handles it is asked for.
        const more = await get(listByHandle(region.id, handles))
        expect(more.status).toBe(200)
        if (fixtureOut) {
          fs.writeFileSync(
            path.join(path.dirname(fixtureOut), "more-from-seller-response.json"),
            `${JSON.stringify(more.data, null, 2)}\n`
          )
        }
        expect(more.data.products.map((p: { handle: string }) => p.handle).sort()).toEqual(["basil", "sweet-corn"])
        expect(more.data.products.map((p: { id: string }) => p.id)).not.toContain(tomatoes.id)
        const corn = more.data.products.find((p: { handle: string }) => p.handle === "sweet-corn")
        expect(corn).toMatchObject({
          title: "Sweet Corn",
          thumbnail: "https://cdn.example.com/corn-thumb.jpg",
          seller: { name: "Riverbend Farm", handle: "riverbend-farm" },
        })
        expect(corn.variants[0].calculated_price).toMatchObject({ calculated_amount: 3, currency_code: "usd" })

        // Asked for by name, the draft and the wholesale-only product are not served.
        const hidden = await get(listByHandle(region.id, ["unreleased-hot-sauce", "wholesale-pallet"]))
        expect(hidden.status).toBe(200)
        expect(hidden.data.products).toEqual([])
        expect(hidden.data.count).toBe(0)
      })

      run("a listing's query returns each card's price and seller", async () => {
        const { get, region, seller, tomatoes, basil } = await makeStorefront()

        const res = await get({
          ...storefront!.productListQuery({ regionId: region.id, countryCode: "us", limit: 12, offset: 0 }),
          order: "created_at",
        })

        expect(res.status).toBe(200)
        // The seller's draft and wholesale-only products are not listed.
        expect(res.data.count).toBe(3)
        expect(res.data.products.map((p: { handle: string }) => p.handle).sort()).toEqual(["basil", "heirloom-tomatoes", "sweet-corn"])
        const card = (id: string) => res.data.products.find((p: { id: string }) => p.id === id)
        expect(card(tomatoes.id)).toMatchObject({
          title: "Heirloom Tomatoes",
          handle: "heirloom-tomatoes",
          thumbnail: "https://cdn.example.com/tomatoes-thumb.jpg",
          created_at: expect.any(String),
          metadata: { harvest: "weekly" },
          seller: { id: seller.id, name: "Riverbend Farm", handle: "riverbend-farm", store_status: "ACTIVE" },
        })
        expect(
          card(tomatoes.id)
            .variants.map((v: { calculated_price: { calculated_amount: number } }) => v.calculated_price.calculated_amount)
            .sort((a: number, b: number) => a - b)
        ).toEqual([5, 40])
        expect(card(tomatoes.id).variants[0].calculated_price.currency_code).toBe("usd")
        // A product with no price in the region still lists; its card says so.
        expect(card(basil.id).seller.id).toBe(seller.id)
        expect(card(basil.id).variants[0].calculated_price).toBeFalsy()
        // The facets the listing filters on.
        expect(card(tomatoes.id)).toMatchObject({ categories: [], type: null, sales_channels: [{ name: "Storefront" }] })
        for (const column of SELLER_PRIVATE) {
          expect(card(tomatoes.id).seller).not.toHaveProperty(column)
        }
        // A card is not sent what only the feed shows.
        expect(card(tomatoes.id)).not.toHaveProperty("description")
        expect(card(tomatoes.id).seller).not.toHaveProperty("photo")

        // The feed's list: the same, with the description and the seller's avatar.
        const feed = await get({
          ...storefront!.productListQuery({
            fields: storefront!.PRODUCT_FEED_FIELDS,
            regionId: region.id,
            countryCode: "us",
            limit: 12,
            offset: 0,
          }),
          order: "-created_at",
        })
        expect(feed.status).toBe(200)
        const item = feed.data.products.find((p: { id: string }) => p.id === tomatoes.id)
        expect(item).toMatchObject({
          title: "Heirloom Tomatoes",
          description: "<p>Vine ripened.</p>",
          seller: { id: seller.id, name: "Riverbend Farm", handle: "riverbend-farm", photo: "https://cdn.example.com/farm.png" },
        })
        expect(item.variants.map((v: { calculated_price: { calculated_amount: number } }) => v.calculated_price.calculated_amount).sort((a: number, b: number) => a - b)).toEqual([5, 40])
        for (const column of SELLER_PRIVATE) {
          expect(item.seller).not.toHaveProperty(column)
        }
      })

      run("the stock count is refused unless the key has exactly one sales channel; the page's query without it still answers", async () => {
        const { get, region, pint, crate, addSecondChannelToKey } = await makeStorefront()
        const input = { handle: "heirloom-tomatoes", regionId: region.id, countryCode: "us" }
        expect((await get(storefront!.productPageQuery(input))).status).toBe(200)

        await addSecondChannelToKey()

        // Medusa counts stock per sales channel and will not choose one.
        const refused = await get(storefront!.productPageQuery(input))
        expect(refused.status).toBe(400)
        expect(refused.data.message).toMatch(/single sales channel/i)

        // What the storefront sends next: the same query without the count.
        const withoutStock = await get(storefront!.productPageQuery({ ...input, stock: false }))
        expect(withoutStock.status).toBe(200)
        const product = withoutStock.data.products[0]
        expect(product.images).toHaveLength(2)
        expect(product.options).toHaveLength(1)
        expect(product.seller.name).toBe("Riverbend Farm")
        const variant = (id: string) => product.variants.find((v: { id: string }) => v.id === id)
        expect(variant(pint.id).calculated_price).toMatchObject({ calculated_amount: 5, currency_code: "usd" })
        expect(variant(crate.id).calculated_price).toMatchObject({ calculated_amount: 40, currency_code: "usd" })
        // The counted pint says it is counted and carries no count: the page
        // must not read that as none left.
        expect(variant(pint.id).manage_inventory).toBe(true)
        expect(variant(pint.id)).not.toHaveProperty("inventory_quantity")
        expect(variant(crate.id)).not.toHaveProperty("inventory_quantity")

        // A listing asks for no count and is not refused.
        const list = await get(storefront!.productListQuery({ regionId: region.id, countryCode: "us", limit: 12, offset: 0 }))
        expect(list.status).toBe(200)
      })

      run("prices are refused without the region, and a field list that asks for none is sent none", async () => {
        const { get, region } = await makeStorefront()
        // The field list the search listing and carousel send of their own.
        const fields =
          "*variants.calculated_price,*seller.reviews,-thumbnail,-images,-type,-tags,-variants.options,-options,-collection,-collection_id"
        const query = { handle: ["heirloom-tomatoes"], limit: 1, offset: 0, fields }

        // As it went out while the region was left off: refused, and the
        // storefront turned the refusal into an empty list.
        const without = await get(query)
        expect(without.status).toBe(400)
        expect(without.data.message).toMatch(/pricing context/i)

        const withRegion = await get({ ...query, ...storefront!.pricingContext(fields, region.id, "us") })
        expect(withRegion.status).toBe(200)
        expect(
          withRegion.data.products[0].variants
            .map((v: { calculated_price: { calculated_amount: number } }) => v.calculated_price.calculated_amount)
            .sort((a: number, b: number) => a - b)
        ).toEqual([5, 40])

        // A list that asks for no prices (the category pages' JSON-LD) gets
        // no region, and so no variants and no price calculation.
        const light = "id,title,handle"
        expect(storefront!.pricingContext(light, region.id, "us")).toEqual({})
        const jsonLd = await get({ limit: 8, offset: 0, fields: light, ...storefront!.pricingContext(light, region.id, "us") })
        expect(jsonLd.status).toBe(200)
        expect(Object.keys(jsonLd.data.products[0]).sort()).toEqual(["handle", "id", "title"])
      })

      run("a suspended seller's product is still served, with the status the storefront hides it by", async () => {
        const { get, region, seller } = await makeStorefront()
        await container().resolve(SELLER_MODULE).updateSellers({ id: seller.id, store_status: "SUSPENDED" })

        const page = await get(storefront!.productPageQuery({ handle: "heirloom-tomatoes", regionId: region.id, countryCode: "us" }))
        expect(page.status).toBe(200)
        expect(page.data.products[0].seller.store_status).toBe("SUSPENDED")

        const list = await get(storefront!.productListQuery({ regionId: region.id, countryCode: "us", limit: 12, offset: 0 }))
        expect(list.status).toBe(200)
        expect(list.data.products.map((p: { seller: { store_status: string } }) => p.seller.store_status)).toEqual([
          "SUSPENDED",
          "SUSPENDED",
          "SUSPENDED",
        ])
      })
    })
  },
})
