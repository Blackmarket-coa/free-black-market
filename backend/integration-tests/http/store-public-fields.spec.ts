import fs from "fs"
import http from "http"
import path from "path"
import jwt from "jsonwebtoken"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, GraphQLUtils, Modules } from "@medusajs/framework/utils"
import { MedusaModule } from "@medusajs/framework/modules-sdk"
import { MARKETPLACE_MODULE } from "@mercurjs/b2c-core/modules/marketplace"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { WISHLIST_MODULE } from "@mercurjs/b2c-core/modules/wishlist"
import { REVIEW_MODULE } from "@mercurjs/reviews/modules/reviews"
import { DIGITAL_PRODUCT_MODULE } from "../../src/modules/digital-product"
import { BARTER_MODULE } from "../../src/modules/barter"
import { DEMAND_POOL_MODULE } from "../../src/modules/demand-pool"
import { FOOD_DISTRIBUTION_MODULE } from "../../src/modules/food-distribution"
import { TICKET_BOOKING_MODULE } from "../../src/modules/ticket-booking"
import { WISHLIST_MODULE as SHOPPER_WISHLIST_MODULE } from "../../src/modules/wishlist"
import {
  BUYER_SELLER_FIELDS,
  ORDER_SET_HEADING_FIELDS,
  PUBLIC_REVIEWER_FIELDS,
  PUBLIC_REVIEW_FIELDS,
  PUBLIC_SELLER_FIELDS,
  RECORD_CUSTOMER_FIELDS,
  REVIEW_SELLER_FIELDS,
  sanitizeStoreFields,
  storeFieldProfile,
} from "../../src/shared/store-field-policy"
import { authHeader, createAuthenticatedSeller, safe } from "./helpers/seller-auth"

jest.setTimeout(300 * 1000)

/**
 * What a `/store` read answers when asked to expand through a link (SD-118),
 * on a real database through the real routes: Medusa's and Mercur's
 * validators, the remote joins to the seller, review, order and customer
 * modules, and `api/middlewares/store-public-fields.ts` in front of them.
 *
 * Every private value in the fixture is a string that appears nowhere else,
 * so a test asks one question of a response: is that string in it. Before the
 * fix each of the requests below answered 200 with the value in the body,
 * for a caller holding nothing but the publishable key.
 */

const PRIVATE = {
  seller_email: "grower@riverbend.example",
  seller_phone: "+15550100",
  seller_tax_id: "12-3456789",
  seller_address: "1 Farm Lane",
  seller_city: "Privateville",
  seller_state: "Alaskastate",
  seller_postal: "99501-PRIVATE",
  member_email: "member@riverbend.example",
  member_phone: "+15550111",
  invite_email: "invitee@riverbend.example",
  reviewer_email: "reviewer@example.com",
  reviewer_phone: "+15550199",
  reviewer_address: "5 Reviewer Road",
  buyer_email: "otherbuyer@example.com",
  buyer_phone: "+15550777",
  buyer_address: "742 Buyer Street",
  buyer_second_address: "99 Second Home Street",
  draft_title: "Unreleased Hot Sauce",
  wholesale_title: "Wholesale Pallet",
  location_address: "9 Warehouse Way",
  digital_file: "FILE-ID-OF-THE-PAID-DOWNLOAD",
} as const

type PrivateName = keyof typeof PRIVATE

const SELLER_COLUMNS: PrivateName[] = [
  "seller_email",
  "seller_phone",
  "seller_tax_id",
  "seller_address",
  "seller_city",
  "seller_state",
  "seller_postal",
]

/** The private values a response contains, by name. */
const found = (data: unknown, names: PrivateName[] = Object.keys(PRIVATE) as PrivateName[]) => {
  const text = JSON.stringify(data) ?? ""
  return names.filter((name) => text.includes(PRIVATE[name]))
}

/** Every value stored under `key`, anywhere in a response. */
function collect(data: unknown, key: string, out: unknown[] = []): unknown[] {
  if (Array.isArray(data)) data.forEach((item) => collect(item, key, out))
  else if (data && typeof data === "object") {
    for (const [name, value] of Object.entries(data as Record<string, unknown>)) {
      if (name === key) out.push(value)
      collect(value, key, out)
    }
  }
  return out
}

const STOREFRONT = path.resolve(__dirname, "../../../storefront/src/lib/data")

/** A storefront data file's text, or null when the backend is checked out alone (never in CI). */
function storefrontSource(file: string): string | null {
  const full = path.join(STOREFRONT, file)
  if (!fs.existsSync(full)) {
    if (process.env.CI) throw new Error(`storefront file not found at ${full}`)
    return null
  }
  return fs.readFileSync(full, "utf8")
}

/** The storefront's cart field list (`storefront/src/lib/data/cart-query.ts`, pure, so it can be loaded here). */
function storefrontCartFields(): string | null {
  const full = path.join(STOREFRONT, "cart-query.ts")
  if (!fs.existsSync(full)) {
    if (process.env.CI) throw new Error(`storefront cart query not found at ${full}`)
    return null
  }
  return (jest.requireActual(full) as { CART_FIELDS: string }).CART_FIELDS
}

/** What `storefront/src/lib/data/seller.ts` asks `GET /store/seller/:handle` for. */
const SELLER_PAGE_FIELDS =
  "+created_at,+email,+metadata,+reviews.seller.name,+reviews.rating,+reviews.customer_note,+reviews.seller_note,+reviews.created_at,+reviews.updated_at,+reviews.customer.first_name,+reviews.customer.last_name"

/** What `storefront/src/lib/data/orders.ts` asks `GET /store/orders/:id` and `GET /store/orders` for. */
const ORDER_FIELDS = "*payment_collections.payments,*items,*items.metadata,*items.variant,*items.product,*seller,*order_set"
const ORDER_LIST_FIELDS =
  "*items,+items.metadata,*items.variant,*items.product,*seller,*reviews,*order_set,shipping_total,total,created_at"

const q = (fields: string) => `fields=${encodeURIComponent(fields)}`

/** Values only a pool's creator, or the person a row is about, may read. */
const POOL_PRIVATE = {
  supplier_id: "sel_supplier_private_01",
  terms: "net-30-private-terms",
  notes: "supplier-private-note",
  compliance: "compliance-private-note",
  proposal_metadata: "proposal-private-metadata",
  counter: "counter-offer-private-note",
  escrow_entry: "escrow-entry-private-01",
  bounty_metadata: "bounty-proof-private-note",
  barter_entry: "barter-ledger-private-01",
  barter_metadata: "barter-private-metadata",
} as const

/** The values of POOL_PRIVATE, and the ids given, that a response contains. */
const poolPrivateValues = (data: unknown, ids: string[]) => {
  const text = JSON.stringify(data) ?? ""
  return [...Object.values(POOL_PRIVATE), ...ids].filter((value) => text.includes(value))
}

/** What a pool's rows say to someone who is not its creator, nor on the row (written out here, not imported). */
const PROPOSAL_TERMS = [
  "id",
  "demand_post_id",
  "status",
  "unit_price",
  "currency_code",
  "min_quantity",
  "max_quantity",
  "volume_tiers",
  "fulfillment_timeline_days",
  "delivery_method",
  "delivery_cost",
  "certifications",
  "votes_for",
  "votes_against",
  "vote_weight_for",
  "vote_weight_against",
  "submitted_at",
]
const BOUNTY_TERMS = ["id", "demand_post_id", "objective", "amount", "currency_code", "milestones", "milestones_completed", "status", "visibility"]
const TRADE_TERMS = ["id", "demand_post_id", "offering", "wanting", "estimated_hours", "status"]
const keysOf = (rows: Record<string, unknown>[]) => rows.map((row) => Object.keys(row).sort())

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api, getContainer }) => {
    const container = () => getContainer() as any
    const link = () => container().resolve(ContainerRegistrationKeys.LINK)
    const one = <T>(created: T | T[]): T => (Array.isArray(created) ? created[0] : created)
    let n = 0
    const uid = () => `${Date.now().toString(36)}${(++n).toString(36)}`

    const customerToken = (customerId: string) =>
      jwt.sign(
        { actor_id: customerId, actor_type: "customer", auth_identity_id: `authid_${uid()}`, app_metadata: {} },
        process.env.JWT_SECRET as string,
        { expiresIn: "1h" }
      )

    /**
     * A marketplace as production has one. A storefront channel behind a
     * publishable key and a wholesale channel beside it. A seller whose row
     * carries an email, a phone, an address and a tax id, with a member of
     * staff, a pending invite, a stock location with an address, and four
     * products: two published in the storefront's channel, one still a draft,
     * one published only to wholesale. A reviewer with an email, a phone and
     * a saved address, who has also ordered from the seller; and another
     * buyer, with an order shipped to their home, a wishlist and a product
     * review. One variant is a paid download.
     */
    async function makeMarket() {
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
        .createRegions([{ name: "North America", currency_code: "usd", countries: ["us", "ca"] }])

      const sellers = container().resolve(SELLER_MODULE)
      const seller = one(
        await sellers.createSellers({
          name: "Riverbend Farm",
          handle: "riverbend-farm",
          description: "Family farm",
          photo: "https://cdn.example.com/farm.png",
          email: PRIVATE.seller_email,
          phone: PRIVATE.seller_phone,
          tax_id: PRIVATE.seller_tax_id,
          address_line: PRIVATE.seller_address,
          city: PRIVATE.seller_city,
          state: PRIVATE.seller_state,
          postal_code: PRIVATE.seller_postal,
          country_code: "us",
        })
      ) as { id: string }
      await sellers.createMembers({
        seller_id: seller.id,
        name: "Morgan Member",
        email: PRIVATE.member_email,
        phone: PRIVATE.member_phone,
        role: "owner",
      })
      await sellers.createMemberInvites({
        seller_id: seller.id,
        email: PRIVATE.invite_email,
        role: "member",
        token: `invite-${uid()}`,
        expires_at: new Date(Date.now() + 86400000),
      })

      const products = container().resolve(Modules.PRODUCT)
      const [tag] = await products.createProductTags([{ value: "organic" }])
      const [type] = await products.createProductTypes([{ value: "produce" }])
      const [collection] = await products.createProductCollections([{ title: "Summer", handle: "summer" }])
      const [category] = await products.createProductCategories([{ name: "Vegetables", is_active: true, is_internal: false }])
      const shared = { tag_ids: [tag.id], type_id: type.id, collection_id: collection.id, category_ids: [category.id] }
      const product = (title: string, handle: string, status: string, sku: string) => ({
        title,
        handle,
        status,
        ...shared,
        options: [{ title: "Size", values: ["One"] }],
        variants: [{ title: "One", sku, manage_inventory: false, options: { Size: "One" } }],
      })
      const [tomatoes, corn, sauce, pallet] = await products.createProducts([
        product("Heirloom Tomatoes", "heirloom-tomatoes", "published", "TOM"),
        product("Sweet Corn", "sweet-corn", "published", "CORN"),
        product(PRIVATE.draft_title, "unreleased-hot-sauce", "draft", "SAUCE"),
        product(PRIVATE.wholesale_title, "wholesale-pallet", "published", "PALLET"),
      ])
      for (const item of [tomatoes, corn, sauce, pallet]) {
        await link().create({ [SELLER_MODULE]: { seller_id: seller.id }, [Modules.PRODUCT]: { product_id: item.id } })
        await link().create({
          [Modules.PRODUCT]: { product_id: item.id },
          [Modules.SALES_CHANNEL]: { sales_channel_id: item.id === pallet.id ? wholesale.id : channel.id },
        })
      }

      const [location] = await container()
        .resolve(Modules.STOCK_LOCATION)
        .createStockLocations([{ name: "Farm", address: { address_1: PRIVATE.location_address, country_code: "us" } }])
      await link().create({
        [Modules.SALES_CHANNEL]: { sales_channel_id: channel.id },
        [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
      })
      await link().create({ [SELLER_MODULE]: { seller_id: seller.id }, [Modules.STOCK_LOCATION]: { stock_location_id: location.id } })
      const inventory = container().resolve(Modules.INVENTORY)
      const [stock] = await inventory.createInventoryItems([{ sku: "TOM" }])
      await inventory.createInventoryLevels([{ inventory_item_id: stock.id, location_id: location.id, stocked_quantity: 7 }])
      await link().create({
        [Modules.PRODUCT]: { variant_id: tomatoes.variants[0].id },
        [Modules.INVENTORY]: { inventory_item_id: stock.id },
      })

      const customers = container().resolve(Modules.CUSTOMER)
      const [reviewer, buyer] = await customers.createCustomers([
        { email: PRIVATE.reviewer_email, first_name: "Ada", last_name: "Reviewer", phone: PRIVATE.reviewer_phone },
        { email: PRIVATE.buyer_email, first_name: "Olu", last_name: "Buyer", phone: PRIVATE.buyer_phone },
      ])
      await customers.createCustomerAddresses([{ customer_id: reviewer.id, address_1: PRIVATE.reviewer_address, country_code: "us" }])

      const reviews = container().resolve(REVIEW_MODULE)
      const sellerReview = one(await reviews.createReviews({ reference: "seller", rating: 5, customer_note: "Great tomatoes" })) as { id: string }
      await link().create({ [SELLER_MODULE]: { seller_id: seller.id }, [REVIEW_MODULE]: { review_id: sellerReview.id } })
      await link().create({ [Modules.CUSTOMER]: { customer_id: reviewer.id }, [REVIEW_MODULE]: { review_id: sellerReview.id } })

      const orders = container().resolve(Modules.ORDER)
      const order = async (customer: { id: string; email: string }, item: { id: string; variants: { id: string }[] }, address?: string) => {
        const [created] = await orders.createOrders([
          {
            currency_code: "usd",
            customer_id: customer.id,
            email: customer.email,
            sales_channel_id: channel.id,
            region_id: region.id,
            ...(address ? { shipping_address: { address_1: address, country_code: "us", first_name: "Olu" } } : {}),
            items: [{ title: "Line", quantity: 1, unit_price: 5, product_id: item.id, variant_id: item.variants[0].id }],
          },
        ])
        await link().create({ [SELLER_MODULE]: { seller_id: seller.id }, [Modules.ORDER]: { order_id: created.id } })
        return created as { id: string }
      }
      const buyersOrder = await order(buyer, tomatoes, PRIVATE.buyer_address)
      const reviewersOrder = await order(reviewer, corn)

      const productReview = one(await reviews.createReviews({ reference: "product", rating: 4, customer_note: "Tasty" })) as { id: string }
      await link().create({ [Modules.PRODUCT]: { product_id: tomatoes.id }, [REVIEW_MODULE]: { review_id: productReview.id } })
      await link().create({ [Modules.CUSTOMER]: { customer_id: buyer.id }, [REVIEW_MODULE]: { review_id: productReview.id } })
      await link().create({ [Modules.ORDER]: { order_id: buyersOrder.id }, [REVIEW_MODULE]: { review_id: productReview.id } })

      const wishlist = one(await container().resolve(WISHLIST_MODULE).createWishlists({ reference: "product" })) as { id: string }
      await link().create({ [Modules.CUSTOMER]: { customer_id: buyer.id }, [WISHLIST_MODULE]: { wishlist_id: wishlist.id } })
      await link().create({ [WISHLIST_MODULE]: { wishlist_id: wishlist.id }, [Modules.PRODUCT]: { product_id: tomatoes.id } })

      const download = one(
        await container()
          .resolve(DIGITAL_PRODUCT_MODULE)
          .createDigitalProducts({ name: "Growing guide", medias: [{ type: "main", fileId: PRIVATE.digital_file, mimeType: "application/pdf" }] })
      ) as { id: string }
      await link().create({
        [DIGITAL_PRODUCT_MODULE]: { digital_product_id: download.id },
        [Modules.PRODUCT]: { product_variant_id: tomatoes.variants[0].id },
      })

      const [cart] = await container()
        .resolve(Modules.CART)
        .createCarts([
          {
            currency_code: "usd",
            region_id: region.id,
            sales_channel_id: channel.id,
            email: "cartowner@example.com",
            items: [{ title: "Tomatoes", quantity: 1, unit_price: 5, product_id: tomatoes.id, variant_id: tomatoes.variants[0].id }],
          },
        ])

      const pak = { headers: { "x-publishable-api-key": key.token as string } }
      const as = (customer: { id: string }) => ({
        headers: { "x-publishable-api-key": key.token as string, authorization: `Bearer ${customerToken(customer.id)}` },
      })
      const get = (url: string, headers = pak) => safe(api.get(url, headers))
      return {
        get,
        pak,
        as,
        asReviewer: as(reviewer),
        asBuyer: as(buyer),
        key: key as { token: string },
        channel: channel as { id: string },
        region: region as { id: string },
        seller,
        tomatoes,
        corn,
        sauce,
        pallet,
        cart: cart as { id: string },
        reviewer,
        buyer,
        buyersOrder,
        reviewersOrder,
        order,
      }
    }

    /** A request line exactly as written: absolute-form included, which axios would rewrite. */
    const rawGet = (target: (origin: string) => string, headers: Record<string, string>) =>
      new Promise<{ status: number; data: any }>((resolve, reject) => {
        const origin = new URL((api as unknown as { defaults: { baseURL: string } }).defaults.baseURL)
        const req = http.request(
          { host: "127.0.0.1", port: origin.port, method: "GET", path: target(`http://127.0.0.1:${origin.port}`), headers },
          (res) => {
            let text = ""
            res.on("data", (chunk) => (text += chunk))
            res.on("end", () => resolve({ status: res.statusCode ?? 0, data: text ? JSON.parse(text) : null }))
          }
        )
        req.on("error", reject)
        req.end()
      })

    /**
     * An order set as Mercur's checkout leaves one: a payment collection, the
     * set (it cannot be inserted without a display id), and the set's orders
     * linked to it.
     */
    async function makeOrderSet(input: { customerId: string; cartId: string; channelId: string; orderIds: string[]; displayId: number }) {
      const [collection] = await container()
        .resolve(Modules.PAYMENT)
        .createPaymentCollections([{ amount: 5, currency_code: "usd" }])
      const set = one(
        await container().resolve(MARKETPLACE_MODULE).createOrderSets({
          display_id: input.displayId,
          sales_channel_id: input.channelId,
          cart_id: input.cartId,
          customer_id: input.customerId,
          payment_collection_id: collection.id,
        })
      ) as { id: string }
      for (const orderId of input.orderIds) {
        await link().create({ [MARKETPLACE_MODULE]: { order_set_id: set.id }, [Modules.ORDER]: { order_id: orderId } })
      }
      return set
    }

    describe("what a /store read may expand through a link", () => {
      it("answers no spelling of a seller's private columns, on any route that reaches a seller", async () => {
        const { get, tomatoes, cart } = await makeMarket()

        // [route, path from the route's record to the seller]. The cart's own
        // default list answers 500 in this environment once a cart has a line
        // (SD-117), so each cart request names a column and so replaces it.
        const routes: [string, string, string?][] = [
          ["/store/products", "seller"],
          [`/store/products/${tomatoes.id}`, "seller"],
          ["/store/products", "variants.product.seller"],
          ["/store/products", "seller.reviews.seller"],
          ["/store/products", "seller.products.seller"],
          ["/store/product-variants", "product.seller"],
          ["/store/collections", "products.seller"],
          ["/store/product-categories", "products.seller"],
          ["/store/product-tags", "products.seller"],
          ["/store/product-types", "products.seller"],
          [`/store/carts/${cart.id}`, "items.product.seller", "id,"],
        ]
        const spellings = (seller: string) => [
          `*${seller}`,
          `${seller}.*`,
          `+${seller}.email`,
          `id,${seller}.email`,
          `id,${seller}.phone,${seller}.tax_id,${seller}.address_line,${seller}.city,${seller}.state,${seller}.postal_code`,
          `id,*${seller},+${seller}.tax_id`,
        ]
        const answered: string[] = []
        for (const [route, seller, replaceDefaults = ""] of routes) {
          for (const spelling of spellings(seller)) {
            const fields = `${replaceDefaults}${spelling}`
            const res = await get(`${route}?${q(fields)}`)
            expect([route, fields, res.status]).toEqual([route, fields, 200])
            expect([route, fields, found(res.data, SELLER_COLUMNS)]).toEqual([route, fields, []])
            answered.push(`${route} ${fields}`)
          }
        }
        expect(answered).toHaveLength(routes.length * 6)

        // And the star still answers: the seller a storefront shows, whole.
        const star = await get(`/store/products?${q("id,*seller")}&handle=heirloom-tomatoes`)
        expect(Object.keys(star.data.products[0].seller).sort()).toEqual([...PUBLIC_SELLER_FIELDS].sort())
        expect(star.data.products[0].seller).toMatchObject({
          name: "Riverbend Farm",
          handle: "riverbend-farm",
          description: "Family farm",
          photo: "https://cdn.example.com/farm.png",
          store_status: "ACTIVE",
        })
      })

      it("leads to nobody else's record: not through a seller, a region, a channel, a variant or a product", async () => {
        const { get, cart } = await makeMarket()

        const requests = [
          // Behind a seller: its orders and their buyers, its staff, its invites.
          "/store/products?fields=seller.orders.*",
          "/store/products?fields=id,seller.orders.id,seller.orders.email",
          "/store/products?fields=*seller.orders.shipping_address",
          "/store/products?fields=*seller.orders.customer",
          "/store/products?fields=*seller.members",
          "/store/products?fields=*seller.invites",
          "/store/products?fields=*seller.stock_locations.address",
          "/store/products?fields=*seller.order_link.order",
          "/store/seller?fields=*members,*invites,*orders,*orders.shipping_address,*orders.customer,*stock_locations.address",
          "/store/seller/riverbend-farm?fields=*members,*invites,*orders.customer,*reviews.customer,*reviews.customer.addresses",
          // Reviewers.
          "/store/products?fields=*seller.reviews.customer",
          "/store/products?fields=id,seller.reviews.customer.email,seller.reviews.customer.phone",
          "/store/products?fields=*seller.reviews.customer.addresses",
          "/store/products?fields=*reviews.customer,*reviews.order",
          "/store/seller?fields=*reviews.customer,*reviews.customer.addresses",
          // Every order in a region or a sales channel.
          "/store/regions?fields=*orders",
          "/store/regions?fields=*orders.shipping_address",
          "/store/regions?fields=*orders.customer",
          "/store/products?fields=*sales_channels.orders",
          "/store/products?fields=*sales_channels.orders.shipping_address",
          // Who wants a product, and where it is kept.
          "/store/products?fields=*wishlist.customer",
          "/store/products?fields=*sales_channels.stock_locations.address",
          "/store/products?fields=*variants.inventory_items.inventory.location_levels.stock_locations.address",
          // What is sold.
          "/store/products?fields=*variants.digital_product.medias",
          // The same from a cart, which anyone may create.
          `/store/carts/${cart.id}?fields=id,*region.orders,*items.product.seller.orders,*items.product.seller.members`,
          `/store/carts/${cart.id}?fields=id,*items.product.wishlist.customer,*items.product.seller.reviews.customer`,
        ]
        for (const url of requests) {
          const res = await get(url)
          expect([url, res.status]).toEqual([url, 200])
          expect([url, found(res.data)]).toEqual([url, []])
        }

        // A review keeps what a seller page prints: the texts, the dates and the reviewer's name.
        const reviews = await get(`/store/products?${q("id,*seller.reviews,*seller.reviews.customer,*seller.reviews.seller")}&handle=heirloom-tomatoes`)
        const [review] = reviews.data.products[0].seller.reviews
        expect(review).toMatchObject({ rating: 5, customer_note: "Great tomatoes", customer: { first_name: "Ada", last_name: "Reviewer" } })
        expect(Object.keys(review).sort()).toEqual([...PUBLIC_REVIEW_FIELDS, "customer", "seller"].sort())
        expect(Object.keys(review.customer).sort()).toEqual([...PUBLIC_REVIEWER_FIELDS, "id"].sort())
        expect(Object.keys(review.seller).sort()).toEqual([...REVIEW_SELLER_FIELDS].sort())
      })

      it("serves a product list reached through a relation only as the listing would: published, in the key's channel", async () => {
        const { get, tomatoes } = await makeMarket()
        const visible = ["heirloom-tomatoes", "sweet-corn"]
        const handles = (rows: { handle: string }[]) => rows.map((row) => row.handle).sort()

        // What the listing itself serves.
        const listing = await get("/store/products?fields=id,handle")
        expect(handles(listing.data.products)).toEqual(visible)

        const lists: [string, (data: any) => { handle: string }[]][] = [
          [`/store/products/${tomatoes.id}?fields=id,seller.products.*`, (data) => data.product.seller.products],
          [`/store/products/${tomatoes.id}?fields=id,*seller.products`, (data) => data.product.seller.products],
          [`/store/products/${tomatoes.id}?fields=id,seller.products.handle,seller.products.status`, (data) => data.product.seller.products],
          ["/store/seller/riverbend-farm?fields=*products", (data) => data.seller.products],
          ["/store/seller?fields=id,products.handle", (data) => data.sellers[0].products],
          ["/store/collections?fields=*products", (data) => data.collections[0].products],
          ["/store/product-categories?fields=id,*products", (data) => data.product_categories[0].products],
          // Medusa's tag and type routes list their products by default.
          ["/store/product-tags", (data) => data.product_tags[0].products],
          ["/store/product-types", (data) => data.product_types[0].products],
        ]
        for (const [url, rows] of lists) {
          const res = await get(url)
          expect([url, res.status]).toEqual([url, 200])
          expect([url, handles(rows(res.data))]).toEqual([url, visible])
          expect([url, found(res.data, ["draft_title", "wholesale_title"])]).toEqual([url, []])
        }

        // (From a product, Medusa does not populate `collection.products`,
        // `tags.products` or `type.products` at all: nothing to filter there.)

        // Asked for by a column that is not the id, the rows are still checked.
        const titles = await get(`/store/products/${tomatoes.id}?fields=id,seller.products.title`)
        expect(titles.data.product.seller.products.map((row: { title: string }) => row.title).sort()).toEqual(["Heirloom Tomatoes", "Sweet Corn"])

        // A join row is a second way to the same list, and is not answered.
        const joined = await get("/store/products?fields=id,*sales_channels.products_link.product,*seller.product_link.product")
        expect(joined.status).toBe(200)
        expect(found(joined.data, ["draft_title", "wholesale_title"])).toEqual([])
      })

      /**
       * FBM's `api/store/wishlist/route.ts` answers this path, not Mercur's:
       * it reads FBM's own wishlist module, ignores `fields`, and selects
       * each product whole by id. So the field policy never sees it, and
       * the route checks what it takes and what it serves itself.
       */
      it("FBM's wishlist takes and serves only what the product listing serves: not a draft, not another channel's product", async () => {
        const { get, as, buyer, tomatoes, corn, sauce, pallet } = await makeMarket()
        const asBuyer = as(buyer)
        const add = (id: string) => safe(api.post("/store/wishlist", { reference: "product", reference_id: id }, asBuyer))
        const served = async () => {
          const res = await get("/store/wishlist", asBuyer)
          expect(res.status).toBe(200)
          const titles = (res.data.wishlists as { products: { title: string }[] }[]).flatMap((wishlist) =>
            wishlist.products.map((product) => product.title)
          )
          return { titles: titles.sort(), data: res.data }
        }

        expect((await add(tomatoes.id)).status).toBe(201)
        expect((await add(corn.id)).status).toBe(201)
        expect((await served()).titles).toEqual(["Heirloom Tomatoes", "Sweet Corn"])

        // A draft, another channel's product and an id that names nothing
        // are refused alike, with what the product page answers for each.
        const missingId = `${sauce.id.slice(0, -4)}ZZZZ`
        for (const [what, id] of [
          ["a draft", sauce.id],
          ["another channel's product", pallet.id],
          ["no product", missingId],
        ] as const) {
          const res = await add(id)
          const page = await get(`/store/products/${id}`, asBuyer)
          expect([what, res.status, page.status]).toEqual([what, 404, 404])
          expect([what, res.data]).toEqual([what, page.data])
        }

        // Rows the module already holds (written before the route checked,
        // or a product unpublished since it was saved) are not served.
        const shopper = container().resolve(SHOPPER_WISHLIST_MODULE)
        await shopper.addProductToWishlist(buyer.id, sauce.id)
        await shopper.addProductToWishlist(buyer.id, pallet.id)
        await container().resolve(Modules.PRODUCT).updateProducts(corn.id, { status: "draft" })
        const after = await served()
        expect(after.titles).toEqual(["Heirloom Tomatoes"])
        expect(found(after.data, ["draft_title", "wholesale_title"])).toEqual([])
        expect(collect(after.data, "status")).toEqual(["published"])
      })

      it("Mercur's seller routes serve the seller a storefront shows, and the storefront's seller page still gets what it prints", async () => {
        const { get } = await makeMarket()

        for (const url of [
          "/store/seller",
          "/store/seller/riverbend-farm",
          "/store/seller?fields=id,email,phone,tax_id,address_line,city,state,postal_code",
          `/store/seller/riverbend-farm?${q("+email,+phone,+tax_id,+state")}`,
          "/store/seller/riverbend-farm?fields=*",
        ]) {
          const res = await get(url)
          expect([url, res.status]).toEqual([url, 200])
          expect([url, found(res.data)]).toEqual([url, []])
        }

        // The routes' own defaults, less the address and the tax id.
        const byDefault = await get("/store/seller/riverbend-farm")
        expect(byDefault.data.seller).toEqual({
          id: expect.any(String),
          store_status: "ACTIVE",
          name: "Riverbend Farm",
          handle: "riverbend-farm",
          description: "Family farm",
          photo: "https://cdn.example.com/farm.png",
        })
        const list = await get("/store/seller")
        expect(list.data.sellers).toEqual([byDefault.data.seller])
        expect(list.data.count).toBe(1)

        // `storefront/src/lib/data/seller.ts`, as it asks today.
        const source = storefrontSource("seller.ts")
        if (source) expect(source).toContain(SELLER_PAGE_FIELDS)
        const page = await get(`/store/seller/riverbend-farm?${q(SELLER_PAGE_FIELDS)}`)
        expect(page.status).toBe(200)
        expect(page.data.seller).toMatchObject({
          name: "Riverbend Farm",
          handle: "riverbend-farm",
          description: "Family farm",
          photo: "https://cdn.example.com/farm.png",
          created_at: expect.any(String),
          reviews: [
            {
              rating: 5,
              customer_note: "Great tomatoes",
              seller_note: null,
              created_at: expect.any(String),
              updated_at: expect.any(String),
              customer: { first_name: "Ada", last_name: "Reviewer" },
              seller: { name: "Riverbend Farm" },
            },
          ],
        })
        // It asks for the email too; the page never printed it, and it is not sent.
        expect(page.data.seller).not.toHaveProperty("email")
        expect(found(page.data)).toEqual([])
      })

      it("is profiled by the path Express routes: a re-cased path or an absolute-form request line answers as the plain one", async () => {
        const { get, key } = await makeMarket()

        // Express routes these to Mercur's seller handler. Compared as raw
        // strings they fell to the public profile and the tax id, email and
        // address answered.
        const plain = await get("/store/seller/riverbend-farm")
        for (const url of [
          "/store/Seller/riverbend-farm",
          "/Store/seller/riverbend-farm",
          "/STORE/SELLER/riverbend-farm",
          "/store/SELLER?fields=id,email,phone,tax_id,address_line",
          "/STORE/SELLER?fields=id,email,tax_id",
          `/store/Seller/riverbend-farm?${q("+email,+phone,+tax_id,+state,+address_line")}`,
          "/store/Seller?fields=id,handle&order=tax_id",
        ]) {
          const res = await get(url)
          expect([url, res.status]).toEqual([url, 200])
          expect([url, found(res.data, SELLER_COLUMNS)]).toEqual([url, []])
        }
        expect((await get("/store/Seller/riverbend-farm")).data).toEqual(plain.data)
        expect((await get("/STORE/SELLER/riverbend-farm")).data).toEqual(plain.data)

        const headers = { "x-publishable-api-key": key.token }
        for (const target of [
          (origin: string) => `${origin}/store/seller?fields=id,email,tax_id`,
          (origin: string) => `${origin.toUpperCase()}/Store/Seller/riverbend-farm?fields=id,email,phone,tax_id`,
          (origin: string) => `${origin}/store/products?fields=id,*seller`,
        ]) {
          const res = await rawGet(target, headers)
          expect([target("ORIGIN"), res.status]).toEqual([target("ORIGIN"), 200])
          expect([target("ORIGIN"), found(res.data, SELLER_COLUMNS)]).toEqual([target("ORIGIN"), []])
        }
        const absolute = await rawGet((origin) => `${origin}/store/seller/riverbend-farm`, headers)
        expect(absolute.data).toEqual(plain.data)
      })

      it("Mercur's seller list is sorted by nothing it does not serve", async () => {
        const { get } = await makeMarket()
        // Two more sellers, so that every private column sorts the three
        // differently from the list's own order, each way.
        const sellers = container().resolve(SELLER_MODULE)
        const low = one(
          await sellers.createSellers({ name: "Aaa Low", handle: "aaa-low", tax_id: "00-0000001", email: "zz-last@example.org", phone: "+19999", address_line: "Zed Road", postal_code: "00001" })
        ) as { id: string }
        const high = one(
          await sellers.createSellers({ name: "Zzz High", handle: "zzz-high", tax_id: "99-9999999", email: "aa-first@example.org", phone: "+10000", address_line: "Alpha Road", postal_code: "99999" })
        ) as { id: string }
        await sellers.createMembers({ seller_id: low.id, name: "A", email: "aaa-staff@example.org", role: "owner" })
        await sellers.createMembers({ seller_id: high.id, name: "Z", email: "zzz-staff@example.org", role: "owner" })
        const handles = async (order?: string) => {
          const res = await get(`/store/seller?fields=id,handle${order ? `&order=${order}` : ""}`)
          expect([order, res.status]).toEqual([order, 200])
          return (res.data.sellers as { handle: string }[]).map((row) => row.handle)
        }

        const unsorted = await handles()
        expect([...unsorted].sort()).toEqual(["aaa-low", "riverbend-farm", "zzz-high"])
        // Ascending and descending by a column are each other's reverse, so
        // both equal to the unsorted list means the key was not applied.
        for (const column of ["tax_id", "email", "phone", "address_line", "postal_code", "members.email"]) {
          expect([column, await handles(column), await handles(`-${column}`)]).toEqual([column, unsorted, unsorted])
        }
        // What the list serves still sorts it.
        expect(await handles("name")).toEqual(["aaa-low", "riverbend-farm", "zzz-high"])
        expect(await handles("-name")).toEqual(["zzz-high", "riverbend-farm", "aaa-low"])
        expect(await handles("-handle")).toEqual(["zzz-high", "riverbend-farm", "aaa-low"])
      })

      it("a path from an order stays on that order, for whoever holds its id", async () => {
        const { get, as, buyer, buyersOrder, corn, cart, channel, reviewer, order } = await makeMarket()
        // The buyer's other order, to another address, in the same order set.
        const secondOrder = await order(buyer as { id: string; email: string }, corn as { id: string; variants: { id: string }[] }, PRIVATE.buyer_second_address)
        await makeOrderSet({ customerId: buyer.id, cartId: cart.id, channelId: channel.id, orderIds: [buyersOrder.id, secondOrder.id], displayId: 2001 })
        const other = as(reviewer)

        // GET /store/orders/:id asks for no customer (Medusa's guest order
        // page); one id opened the buyer's other orders, their addresses and
        // their sellers' contact details.
        const leaks: [string, PrivateName[]][] = []
        for (const fields of [
          "id,*customer,*customer.orders,*customer.orders.shipping_address",
          "id,*customer.orders.seller,*customer.reviews.seller",
          "id,*customer.addresses",
          "id,customer.orders,customer.addresses,customer.reviews",
          "id,*order_set,*order_set.orders,*order_set.orders.shipping_address,*order_set.orders.customer",
          "id,order_set.orders,order_set.customer_id,order_set.cart_id,*order_set.payment_collection",
          "id,*reviews,*reviews.customer,*reviews.customer.orders,*reviews.customer.orders.shipping_address",
          "id,*reviews.seller.orders,*reviews.order",
        ]) {
          for (const headers of [undefined, other]) {
            const res = await get(`/store/orders/${buyersOrder.id}?${q(fields)}`, headers)
            expect([fields, res.status]).toEqual([fields, 200])
            const text = JSON.stringify(res.data)
            expect([fields, text.includes(secondOrder.id)]).toEqual([fields, false])
            leaks.push([fields, found(res.data, ["buyer_second_address", ...SELLER_COLUMNS, "reviewer_email", "reviewer_address"])])
          }
        }
        expect(leaks.filter(([, names]) => names.length > 0)).toEqual([])

        // The buyer themselves, as columns; the order set as the heading the
        // storefront's order pages print.
        const own = await get(`/store/orders/${buyersOrder.id}?${q("id,*customer,*order_set")}`)
        expect(own.data.order.customer).toMatchObject({ id: buyer.id, first_name: "Olu", last_name: "Buyer" })
        expect(Object.keys(own.data.order.customer).every((key) => (RECORD_CUSTOMER_FIELDS as readonly string[]).includes(key))).toBe(true)
        expect(Object.keys(own.data.order.order_set).sort()).toEqual([...ORDER_SET_HEADING_FIELDS].sort())
        expect(own.data.order.order_set).toMatchObject({ display_id: 2001 })
      })

      it("an order set is its buyer's: they read it with each seller cut to what a buyer is shown, nobody else reads it", async () => {
        const { get, pak, as, asReviewer, reviewer, reviewersOrder, cart, channel, buyer, seller } = await makeMarket()
        const set = await makeOrderSet({ customerId: reviewer.id, cartId: cart.id, channelId: channel.id, orderIds: [reviewersOrder.id], displayId: 1001 })

        // The buyer, as the storefront's account page asks (with their token),
        // on the plain path and on re-cased ones.
        for (const url of [`/store/order-set/${set.id}`, `/store/Order-Set/${set.id}`, `/STORE/ORDER-SET/${set.id}`]) {
          const res = await get(url, asReviewer)
          expect([url, res.status]).toEqual([url, 200])
          const [placed] = res.data.order_set.orders
          expect(placed.id).toBe(reviewersOrder.id)
          expect(placed.seller).toMatchObject({ id: seller.id, name: "Riverbend Farm", email: PRIVATE.seller_email })
          expect(Object.keys(placed.seller).every((key) => (BUYER_SELLER_FIELDS as readonly string[]).includes(key))).toBe(true)
          expect([url, found(res.data, ["seller_tax_id", "member_email", "invite_email", "buyer_email"])]).toEqual([url, []])
        }
        for (const url of ["/store/order-set", "/store/ORDER-SET"]) {
          const list = await get(url, asReviewer)
          expect([url, list.status, list.data.order_sets.map((row: { id: string }) => row.id)]).toEqual([url, 200, [set.id]])
          expect([url, found(list.data, ["seller_tax_id", "member_email"])]).toEqual([url, []])
        }

        // Nobody else: no token, another customer's token, an id that does
        // not exist (the same answer as someone else's), a re-cased path.
        const refusal = { message: "You do not have access to this record.", type: "not_allowed" }
        const missingId = `${set.id.slice(0, -4)}ZZZZ`
        const asBuyer = as(buyer)
        for (const [who, url, headers, status] of [
          ["no customer", `/store/order-set/${set.id}`, pak, 401],
          ["no customer, re-cased", `/store/Order-Set/${set.id}`, pak, 401],
          ["another customer", `/store/order-set/${set.id}`, asBuyer, 403],
          ["another customer, re-cased", `/STORE/order-set/${set.id}`, asBuyer, 403],
          ["the buyer, an id that does not exist", `/store/order-set/${missingId}`, asReviewer, 403],
          ["no customer, the list", "/store/order-set", pak, 401],
        ] as const) {
          const res = await get(url, headers)
          expect([who, res.status]).toEqual([who, status])
          if (status === 403) expect([who, res.data]).toEqual([who, refusal])
          expect([who, found(res.data)]).toEqual([who, []])
        }
        // Another customer's list is their own (empty), as before.
        const theirs = await get("/store/order-set", asBuyer)
        expect([theirs.status, theirs.data.order_sets]).toEqual([200, []])
      })

      it("the storefront's cart query gets the seller its cart shows, and nothing private", async () => {
        const { get, cart, seller } = await makeMarket()
        const fields = storefrontCartFields()
        if (!fields) return

        const res = await get(`/store/carts/${cart.id}?${q(fields)}`)
        expect(res.status).toBe(200)
        const [line] = res.data.cart.items
        // The cart header: the seller's name, link, avatar and "since".
        expect(line.product.seller).toMatchObject({
          id: seller.id,
          name: "Riverbend Farm",
          handle: "riverbend-farm",
          photo: "https://cdn.example.com/farm.png",
          created_at: expect.any(String),
        })
        expect(line.product).toMatchObject({ title: "Heirloom Tomatoes", handle: "heirloom-tomatoes" })
        expect(line.variant.options).toEqual([expect.objectContaining({ value: "One", option: expect.objectContaining({ title: "Size" }) })])
        expect(res.data.cart.region).toMatchObject({ currency_code: "usd" })
        expect(found(res.data)).toEqual([])
      })

      it("a buyer reads their own order with where to return it, and not the seller's tax id, staff or other buyers", async () => {
        const { get, asReviewer, reviewersOrder, seller } = await makeMarket()

        const source = storefrontSource("orders.ts")
        if (source) {
          expect(source).toContain(ORDER_FIELDS)
          expect(source).toContain(ORDER_LIST_FIELDS)
        }

        const detail = await get(`/store/orders/${reviewersOrder.id}?${q(ORDER_FIELDS)}`, asReviewer)
        expect(detail.status).toBe(200)
        // The return flow prints the seller's address, email and phone from the order.
        expect(detail.data.order.seller).toEqual({
          id: seller.id,
          name: "Riverbend Farm",
          handle: "riverbend-farm",
          description: "Family farm",
          photo: "https://cdn.example.com/farm.png",
          store_status: "ACTIVE",
          created_at: expect.any(String),
          email: PRIVATE.seller_email,
          phone: PRIVATE.seller_phone,
          address_line: PRIVATE.seller_address,
          city: PRIVATE.seller_city,
          state: PRIVATE.seller_state,
          postal_code: PRIVATE.seller_postal,
          country_code: "us",
        })
        expect(Object.keys(detail.data.order.seller).sort()).toEqual([...BUYER_SELLER_FIELDS].sort())
        expect(detail.data.order.items).toHaveLength(1)
        expect(detail.data.order.items[0].product).toMatchObject({ handle: "sweet-corn" })
        expect(found(detail.data, ["seller_tax_id", "member_email", "buyer_email", "buyer_address"])).toEqual([])

        const list = await get(`/store/orders?${q(ORDER_LIST_FIELDS)}&order=-created_at`, asReviewer)
        expect(list.status).toBe(200)
        expect(list.data.orders).toHaveLength(1)
        expect(list.data.orders[0].seller).toMatchObject({ name: "Riverbend Farm", address_line: PRIVATE.seller_address })
        expect(found(list.data, ["seller_tax_id", "member_email", "buyer_email", "buyer_address"])).toEqual([])

        // The buyer's own order is not a way to the seller's other orders, staff or tax id.
        for (const fields of [
          "id,*seller.orders",
          "id,*seller.orders.shipping_address",
          "id,*seller.orders.customer",
          "id,*seller.members",
          "id,seller.tax_id",
          "id,*items.variant.order_items",
          "id,*region.orders",
          "id,*payouts",
        ]) {
          const res = await get(`/store/orders?${q(fields)}`, asReviewer)
          expect([fields, res.status]).toEqual([fields, 200])
          expect([fields, found(res.data, ["seller_tax_id", "member_email", "member_phone", "buyer_email", "buyer_phone", "buyer_address"])]).toEqual([
            fields,
            [],
          ])
        }
      })

      it("does not touch /vendor or /admin: a seller and an admin still read the private columns", async () => {
        const vendor = await createAuthenticatedSeller({ api, getContainer })
        await container()
          .resolve(SELLER_MODULE)
          .updateSellers({ id: vendor.seller.id, email: PRIVATE.seller_email, tax_id: PRIVATE.seller_tax_id, phone: PRIVATE.seller_phone })

        const me = await safe(api.get(`/vendor/sellers/me?${q("id,email,tax_id,phone")}`, authHeader(vendor.token)))
        expect(me.status).toBe(200)
        expect(me.data.seller).toMatchObject({ email: PRIVATE.seller_email, tax_id: PRIVATE.seller_tax_id, phone: PRIVATE.seller_phone })

        const [user] = await container()
          .resolve(Modules.USER)
          .createUsers([{ email: `admin+${uid()}@example.com` }])
        const adminToken = jwt.sign(
          { actor_id: user.id, actor_type: "user", auth_identity_id: "", app_metadata: { user_id: user.id } },
          process.env.JWT_SECRET as string,
          { expiresIn: "1h" }
        )
        const admin = await safe(
          api.get(`/admin/sellers/${vendor.seller.id}?${q("id,email,tax_id,phone")}`, { headers: { authorization: `Bearer ${adminToken}` } })
        )
        expect(admin.status).toBe(200)
        expect(admin.data.seller).toMatchObject({ email: PRIVATE.seller_email, tax_id: PRIVATE.seller_tax_id, phone: PRIVATE.seller_phone })
      })

      /**
       * The policy decides by the name of a path segment. This walks the
       * graph Medusa actually joined (every module's schema and every link,
       * as the framework's own field filter reads them) from each record a
       * public store route serves, follows every relation the policy leaves
       * open, and fails if one arrives at a record that is someone's: a
       * customer, an order, a cart, a payment, a seller's staff or keys. A
       * link added tomorrow that reaches one under a new name fails here.
       */
      it("leaves no relation open that reaches a customer, an order, a cart, a payment or a seller's private record", async () => {
        const graph = joinedGraph()
        // The graph is the real one: it knows the links this fix is about.
        expect(graph.Product.seller).toBe("Seller")
        expect(graph.Seller.orders).toBe("Order")
        expect(graph.Seller.members).toBe("Member")
        expect(graph.Region.orders).toBe("Order")
        expect(graph.Review.customer).toBe("Customer")

        const narrowed: Record<string, readonly string[]> = {
          Seller: PUBLIC_SELLER_FIELDS,
          Review: PUBLIC_REVIEW_FIELDS,
          Customer: PUBLIC_REVIEWER_FIELDS,
        }
        const violations: string[] = []
        const visited = new Set<string>()
        let judged = 0

        const judge = (prefix: string[], name: string, target: string, profilePath: string, depth: number) => {
          judged++
          const at = [...prefix, name]
          const asked = `${at.join(".")}.*`
          const kept = sanitizeStoreFields([asked], storeFieldProfile(profilePath)).fields
          if (kept.length === 0) return
          if (kept.includes(asked)) {
            if (isPrivateEntity(target)) violations.push(`${profilePath}: ${at.join(".")} is open and is a ${target}`)
            else walk(target, at, profilePath)
            return
          }
          // Narrowed to an allow-list: it must be one written for this record.
          // (A nested product list also keeps its own id; that is not this record's.)
          const own = `${at.join(".")}.`
          const columns = kept.filter((field) => field.startsWith(own)).map((field) => field.slice(own.length))
          const allowed = target === "Seller" ? [...PUBLIC_SELLER_FIELDS, ...REVIEW_SELLER_FIELDS] : narrowed[target]
          if (!allowed || columns.some((column) => !allowed.includes(column))) {
            violations.push(`${profilePath}: ${at.join(".")} (${target}) is narrowed to ${columns.join(",")}`)
            return
          }
          if (depth > 6) return
          for (const [next, nextTarget] of Object.entries(graph[target] ?? {})) judge(at, next, nextTarget, profilePath, depth + 1)
        }
        const walk = (entity: string, prefix: string[], profilePath: string) => {
          const seen = `${profilePath}|${entity}`
          if (visited.has(seen)) return
          visited.add(seen)
          for (const [name, target] of Object.entries(graph[entity] ?? {})) judge(prefix, name, target, profilePath, 0)
        }

        // The record each public store route with a `fields` parameter serves.
        // (Not `/store/wishlist`: FBM's own handler answers that path and
        // ignores `fields`, so the walk would judge nothing that answers a
        // request. Its own case above pins what it takes and serves.)
        const roots: [string, string][] = [
          ["/store/products", "Product"],
          ["/store/product-variants", "ProductVariant"],
          ["/store/product-categories", "ProductCategory"],
          ["/store/collections", "ProductCollection"],
          ["/store/product-tags", "ProductTag"],
          ["/store/product-types", "ProductType"],
          ["/store/regions", "Region"],
          ["/store/shipping-options", "ShippingOption"],
          ["/store/return-reasons", "ReturnReason"],
          ["/store/currencies", "Currency"],
          ["/store/payment-providers", "PaymentProvider"],
        ]
        for (const [route, entity] of roots) {
          expect([route, storeFieldProfile(route).name]).toEqual([route, "public"])
          walk(entity, [], route)
        }
        // Mercur's seller routes: the root record is the seller.
        for (const [name, target] of Object.entries(graph.Seller)) judge([], name, target, "/store/seller", 0)

        expect(violations).toEqual([])
        // The walk went somewhere: it crossed the catalogue and judged the links.
        expect(visited.has("/store/products|ProductVariant")).toBe(true)
        expect(visited.has("/store/products|SalesChannel")).toBe(true)
        expect(judged).toBeGreaterThan(300)
      })
    })

    /**
     * SD-63: on a database built from the migrations the demand-pool tables
     * lack the `raw_*` companion Medusa writes for every `bigNumber`, so no
     * demand post can be inserted there at all. That is its own open item;
     * to have a post to read, this adds the columns as Medusa's DML would
     * have generated them.
     */
    async function addDemandPoolRawColumns() {
      const pg = container().resolve(ContainerRegistrationKeys.PG_CONNECTION)
      const zero = `JSONB NOT NULL DEFAULT '{"value":"0","precision":20}'`
      const columns: [string, string, string][] = [
        ["demand_post", "raw_target_price", "JSONB NULL"],
        ["demand_post", "raw_final_unit_price", "JSONB NULL"],
        ["demand_post", "raw_final_total_price", "JSONB NULL"],
        ["demand_post", "raw_total_bounty_amount", zero],
        ["demand_post", "raw_total_escrowed", zero],
        ["demand_participant", "raw_price_willing_to_pay", "JSONB NULL"],
        ["demand_participant", "raw_escrow_amount", zero],
        ["demand_bounty", "raw_amount", "JSONB NULL"],
        ["demand_bounty", "raw_amount_paid_out", zero],
        ["supplier_proposal", "raw_unit_price", "JSONB NULL"],
        ["supplier_proposal", "raw_delivery_cost", "JSONB NULL"],
      ]
      for (const [table, column, type] of columns) {
        await pg.raw(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${column}" ${type}`)
      }
    }

    /**
     * A pool with one of each row its sub-routes list: a supplier's
     * proposal, a bounty a participant put up and an outsider claimed, a
     * restricted bounty of the creator's, and an outsider's offer of a
     * trade. Every value only the creator or the person a row is about may
     * read appears nowhere else. (Each bounty names its milestones:
     * `demand_bounty.milestones` is NOT NULL in the migration, SD-63's
     * family.)
     */
    async function makePoolRows(input: {
      creatorId: string
      visibility: string
      participantId: string
      contributorId: string
      assigneeId: string
      proposerId: string
    }) {
      const pools = container().resolve(DEMAND_POOL_MODULE)
      const trades = container().resolve(BARTER_MODULE)
      const post = await pools.createDemandPost({
        creator_id: input.creatorId,
        creator_type: "CUSTOMER",
        title: `Bulk oats ${uid()}`,
        description: "Sacks between neighbours",
        category: "pantry",
        target_quantity: 50,
        min_quantity: 10,
        unit_of_measure: "sacks",
        visibility: input.visibility,
      })
      await pools.publishDemandPost(post.id)
      // Only a participant (or the creator) may put up a bounty.
      for (const customerId of [input.participantId, input.contributorId]) {
        await pools.joinDemandPool({ demand_post_id: post.id, customer_id: customerId, quantity_committed: 3 })
      }
      const proposal = await pools.submitProposal({
        demand_post_id: post.id,
        supplier_id: POOL_PRIVATE.supplier_id,
        unit_price: 12,
        min_quantity: 10,
        max_quantity: 60,
        fulfillment_timeline_days: 14,
        delivery_method: "pallet freight",
        delivery_cost: 40,
        certifications: ["organic"],
        compliance_notes: POOL_PRIVATE.compliance,
        payment_terms: POOL_PRIVATE.terms,
        notes: POOL_PRIVATE.notes,
      })
      await pools.updateSupplierProposals({
        id: proposal.id,
        metadata: { internal: POOL_PRIVATE.proposal_metadata },
        counter_offer: { notes: POOL_PRIVATE.counter },
      })
      const milestones = [{ description: "Supplier named", percentage: 100, condition: "a signed quote" }]
      const open = await pools.addBounty({
        demand_post_id: post.id,
        contributor_id: input.contributorId,
        objective: "FIND_SUPPLIER",
        amount: 25,
        milestones,
      })
      await pools.updateDemandBounties({
        id: open.id,
        assignee_id: input.assigneeId,
        assignee_type: "CUSTOMER",
        escrowed: true,
        escrow_ledger_entry_id: POOL_PRIVATE.escrow_entry,
        metadata: { proofs: [{ note: POOL_PRIVATE.bounty_metadata }] },
      })
      const restricted = await pools.addBounty({
        demand_post_id: post.id,
        contributor_id: input.creatorId,
        objective: "NEGOTIATE_PRICE",
        amount: 10,
        milestones,
        visibility: "RESTRICTED",
      })
      const trade = await trades.proposeBarter({
        proposer_id: input.proposerId,
        demand_post_id: post.id,
        offering: "two hours of hauling",
        wanting: "one sack",
      })
      await trades.updateBarterProposals({
        id: trade.id,
        ledger_entry_id: POOL_PRIVATE.barter_entry,
        metadata: { note: POOL_PRIVATE.barter_metadata },
      })
      return {
        post: post as { id: string },
        proposal: proposal as { id: string },
        open: open as { id: string },
        restricted: restricted as { id: string },
        trade: trade as { id: string },
      }
    }

    /** The pool's people, each a customer of their own. */
    async function makePoolPeople() {
      const created = await container()
        .resolve(Modules.CUSTOMER)
        .createCustomers(["participant", "contributor", "assignee", "proposer", "stranger"].map((role) => ({ email: `${role}-${uid()}@example.com` })))
      const [participant, contributor, assignee, proposer, stranger] = created as { id: string }[]
      return { participant, contributor, assignee, proposer, stranger }
    }

    describe("FBM's own public reads", () => {
      it("a show's availability counts its seats sold and names no purchase or order; a draft show answers 404", async () => {
        const { get, pak, buyersOrder, channel } = await makeMarket()
        const tickets = container().resolve(TICKET_BOOKING_MODULE)
        const SHOW_DATE = "2027-01-15T19:00:00.000Z"
        const venue = await tickets.createVenues({ name: `Hall ${uid()}` })
        const row = await tickets.createVenueRows({ venue_id: venue.id, row_number: "A", row_type: "standard", seat_count: 10 })

        const show = async (status: "published" | "draft") => {
          const id = uid()
          const [product] = await container().resolve(Modules.PRODUCT).createProducts([
            {
              title: `Show ${id}`,
              handle: `show-${id}`,
              status,
              options: [{ title: "Date", values: [SHOW_DATE] }, { title: "Row Type", values: ["standard"] }],
              variants: [{ title: `Show ${id} standard`, manage_inventory: false, options: { Date: SHOW_DATE, "Row Type": "standard" } }],
            },
          ])
          const tp = await tickets.createTicketProducts({ product_id: product.id, venue_id: venue.id, dates: [SHOW_DATE] })
          const tv = await tickets.createTicketProductVariants({ ticket_product_id: tp.id, product_variant_id: product.variants[0].id, row_type: "standard" })
          await link().create([
            { [TICKET_BOOKING_MODULE]: { ticket_product_id: tp.id }, [Modules.PRODUCT]: { product_id: product.id } },
            { [TICKET_BOOKING_MODULE]: { ticket_product_variant_id: tv.id }, [Modules.PRODUCT]: { product_variant_id: product.variants[0].id } },
            { [Modules.PRODUCT]: { product_id: product.id }, [Modules.SALES_CHANNEL]: { sales_channel_id: channel.id } },
          ])
          return { product, tp, tv }
        }

        const published = await show("published")
        const purchase = await tickets.createTicketPurchases({
          order_id: buyersOrder.id,
          ticket_product_id: published.tp.id,
          ticket_variant_id: published.tv.id,
          venue_row_id: row.id,
          seat_number: "7",
          show_date: new Date(SHOW_DATE),
        })

        const avail = await get(`/store/ticket-products/${published.product.id}/availability`, pak)
        expect(avail.status).toBe(200)
        const body = JSON.stringify(avail.data)
        expect(body).not.toContain(buyersOrder.id)
        expect(body).not.toContain(purchase.id)
        expect(collect(avail.data, "order_id")).toEqual([])
        expect(collect(avail.data, "purchases")).toEqual([])
        // What the product page's ticket panel reads is still there, and the
        // sold seat is still counted.
        expect(avail.data.ticket_product).toEqual({
          id: published.tp.id,
          product_id: published.product.id,
          dates: [SHOW_DATE],
          venue: { id: venue.id, name: venue.name },
        })
        expect(avail.data.availability[0].row_types).toEqual([
          { row_type: "standard", total_seats: 10, available_seats: 9, sold_out: false },
        ])

        const draft = await show("draft")
        const hidden = await get(`/store/ticket-products/${draft.product.id}/availability`, pak)
        expect(hidden.status).toBe(404)
        expect(hidden.data.message).toBe(`Product with id: ${draft.product.id} was not found`)
      })

      it("the demand-pool list and page are the public view; the creator still reads their own post whole", async () => {
        const { pak, reviewer, asReviewer, get } = await makeMarket()
        await addDemandPoolRawColumns()
        const pools = container().resolve(DEMAND_POOL_MODULE)
        const post = await pools.createDemandPost({
          creator_id: reviewer.id,
          creator_type: "CUSTOMER",
          title: "Bulk flour",
          description: "Fifty sacks between neighbours",
          category: "pantry",
          target_quantity: 50,
          min_quantity: 10,
          unit_of_measure: "sacks",
          delivery_region: "Chicago South Side",
          delivery_address: { address_1: "77 Household Lane", postal_code: "60617" },
          visibility: "PUBLIC",
          metadata: { note: "internal-note-for-the-creator" },
        })
        await pools.publishDemandPost(post.id)
        await pools.joinDemandPool({ demand_post_id: post.id, customer_id: "cus_participant_one", quantity_committed: 3 })

        const privateOf = (data: unknown) => {
          const text = JSON.stringify(data)
          return [reviewer.id, "77 Household Lane", "60617", "internal-note-for-the-creator", "cus_participant_one"].filter((value) =>
            text.includes(value)
          )
        }

        const list = await get("/store/collective/demand-pools")
        expect(list.status).toBe(200)
        expect(list.data.count).toBe(1)
        // What the storefront's board and list print.
        expect(list.data.demand_pools[0]).toMatchObject({
          id: post.id,
          title: "Bulk flour",
          description: "Fifty sacks between neighbours",
          category: "pantry",
          target_quantity: 50,
          min_quantity: 10,
          committed_quantity: 3,
          unit_of_measure: "sacks",
          status: "OPEN",
          delivery_region: "Chicago South Side",
        })
        for (const column of ["creator_id", "delivery_address", "escrow_account_id", "selected_supplier_id", "metadata", "total_escrowed"]) {
          expect(list.data.demand_pools[0]).not.toHaveProperty(column)
        }
        expect(privateOf(list.data)).toEqual([])

        // The page: the same view and the three counts, without the rows behind them.
        const page = await get(`/store/collective/demand-pools/${post.id}`)
        expect(page.status).toBe(200)
        expect(page.data.demand_pool).toMatchObject({
          id: post.id,
          title: "Bulk flour",
          committed_quantity: 3,
          target_quantity: 50,
          participants: { total: 1, committed_quantity: 3, target_quantity: 50, progress_percent: 6 },
          proposals: { total: 0 },
          bounties: { total: 0, total_amount: 0 },
        })
        expect(page.data.demand_pool.participants).not.toHaveProperty("list")
        expect(page.data.demand_pool.proposals).not.toHaveProperty("list")
        expect(page.data.demand_pool.bounties).not.toHaveProperty("list")
        expect(page.data.demand_pool).not.toHaveProperty("creator_id")
        expect(page.data.demand_pool).not.toHaveProperty("delivery_address")
        expect(privateOf(page.data)).toEqual([])

        // Another signed-in customer is a stranger to it too.
        const [other] = await container().resolve(Modules.CUSTOMER).createCustomers([{ email: `other-${uid()}@example.com` }])
        const asOther = { headers: { ...pak.headers, authorization: `Bearer ${customerToken(other.id)}` } }
        expect(privateOf((await get(`/store/collective/demand-pools/${post.id}`, asOther)).data)).toEqual([])

        // The creator reads the whole post, the address they typed and who joined.
        const own = await get(`/store/collective/demand-pools/${post.id}`, asReviewer)
        expect(own.status).toBe(200)
        expect(own.data.demand_pool).toMatchObject({
          creator_id: reviewer.id,
          delivery_address: { address_1: "77 Household Lane", postal_code: "60617" },
          metadata: { note: "internal-note-for-the-creator" },
        })
        expect(own.data.demand_pool.participants.list).toEqual([expect.objectContaining({ customer_id: "cus_participant_one" })])
      })

      it("a public pool's proposals, bounties and trades: the creator reads them whole, the people on a row read it whole, anyone else the terms", async () => {
        const { pak, reviewer, asReviewer, as, get } = await makeMarket()
        await addDemandPoolRawColumns()
        const { participant, contributor, assignee, proposer, stranger } = await makePoolPeople()
        const rows = await makePoolRows({
          creatorId: reviewer.id,
          visibility: "PUBLIC",
          participantId: participant.id,
          contributorId: contributor.id,
          assigneeId: assignee.id,
          proposerId: proposer.id,
        })
        const base = `/store/collective/demand-pools/${rows.post.id}`
        const privateOf = (data: unknown) => poolPrivateValues(data, [reviewer.id, participant.id, contributor.id, assignee.id, proposer.id])

        // Before: each sub-route served its rows as stored, to anyone: the
        // supplier's notes and terms, the customers who put up, claimed or
        // offered, and the ledger entries.
        for (const [who, headers] of [
          ["the publishable key alone", pak],
          ["another customer", as(stranger)],
          ["a participant", as(participant)],
        ] as const) {
          const proposals = await get(`${base}/proposals`, headers)
          const bounties = await get(`${base}/bounties`, headers)
          const trades = await get(`${base}/barter`, headers)
          expect([who, proposals.status, bounties.status, trades.status]).toEqual([who, 200, 200, 200])
          expect([who, privateOf([proposals.data, bounties.data, trades.data])]).toEqual([who, []])

          expect([who, keysOf(proposals.data.proposals)]).toEqual([who, [[...PROPOSAL_TERMS].sort()]])
          expect(proposals.data.proposals[0]).toMatchObject({
            id: rows.proposal.id,
            unit_price: 12,
            min_quantity: 10,
            max_quantity: 60,
            fulfillment_timeline_days: 14,
            delivery_method: "pallet freight",
            delivery_cost: 40,
            certifications: ["organic"],
            status: "SUBMITTED",
            votes_for: 0,
          })
          // The restricted bounty is still hidden from them, as before.
          expect([who, keysOf(bounties.data.bounties)]).toEqual([who, [[...BOUNTY_TERMS].sort()]])
          expect(bounties.data.bounties[0]).toMatchObject({
            id: rows.open.id,
            objective: "FIND_SUPPLIER",
            amount: 25,
            currency_code: "USD",
            status: "ACTIVE",
            visibility: "PUBLIC",
            milestones: [{ description: "Supplier named", percentage: 100, condition: "a signed quote" }],
          })
          expect([who, trades.data.count, keysOf(trades.data.proposals)]).toEqual([who, 1, [[...TRADE_TERMS].sort()]])
          expect(trades.data.proposals[0]).toMatchObject({ id: rows.trade.id, offering: "two hours of hauling", wanting: "one sack", status: "PROPOSED" })
        }

        // The people a row is about read that row whole, and nothing else of anyone's.
        const asContributor = await get(`${base}/bounties`, as(contributor))
        expect(asContributor.data.bounties).toEqual([
          expect.objectContaining({ id: rows.open.id, contributor_id: contributor.id, assignee_id: assignee.id, escrow_ledger_entry_id: POOL_PRIVATE.escrow_entry }),
        ])
        const asAssignee = await get(`${base}/bounties`, as(assignee))
        expect(asAssignee.data.bounties).toEqual([expect.objectContaining({ id: rows.open.id, contributor_id: contributor.id, assignee_id: assignee.id })])
        const asProposer = await get(`${base}/barter`, as(proposer))
        expect(asProposer.data.proposals).toEqual([expect.objectContaining({ id: rows.trade.id, proposer_id: proposer.id, ledger_entry_id: POOL_PRIVATE.barter_entry })])
        expect(privateOf((await get(`${base}/proposals`, as(proposer))).data)).toEqual([])
        expect(privateOf((await get(`${base}/proposals`, as(contributor))).data)).toEqual([])

        // The creator reads every row whole, the restricted bounty included.
        const [ownProposals, ownBounties, ownTrades] = await Promise.all(["/proposals", "/bounties", "/barter"].map((sub) => get(`${base}${sub}`, asReviewer)))
        expect([ownProposals.status, ownBounties.status, ownTrades.status]).toEqual([200, 200, 200])
        expect(ownProposals.data.proposals[0]).toMatchObject({
          supplier_id: POOL_PRIVATE.supplier_id,
          payment_terms: POOL_PRIVATE.terms,
          notes: POOL_PRIVATE.notes,
          compliance_notes: POOL_PRIVATE.compliance,
        })
        expect(ownBounties.data.bounties.map((row: { id: string }) => row.id).sort()).toEqual([rows.open.id, rows.restricted.id].sort())
        expect(ownTrades.data.proposals[0]).toMatchObject({ proposer_id: proposer.id })
      })

      it("a pool that is not public lists its rows to its creator, its participants and the people on a row; anyone else gets what a missing pool gets", async () => {
        const { pak, reviewer, asReviewer, as, get } = await makeMarket()
        await addDemandPoolRawColumns()
        const { participant, contributor, assignee, proposer, stranger } = await makePoolPeople()
        const rows = await makePoolRows({
          creatorId: reviewer.id,
          visibility: "INVITE_ONLY",
          participantId: participant.id,
          contributorId: contributor.id,
          assigneeId: assignee.id,
          proposerId: proposer.id,
        })
        const base = `/store/collective/demand-pools/${rows.post.id}`
        const missing = `/store/collective/demand-pools/${rows.post.id.slice(0, -4)}ZZZZ`
        const notFound = { error: "Demand pool not found" }
        const privateOf = (data: unknown) => poolPrivateValues(data, [reviewer.id, participant.id, contributor.id, assignee.id, proposer.id])

        // Before: 200 and every row, whatever the pool's visibility; only
        // /ledger refused. Now the answer /ledger gives, and a missing pool.
        for (const sub of ["/proposals", "/bounties", "/barter"]) {
          for (const [who, headers] of [
            ["the publishable key alone", pak],
            ["another customer", as(stranger)],
          ] as const) {
            const res = await get(`${base}${sub}`, headers)
            expect([sub, who, res.status, res.data]).toEqual([sub, who, 404, notFound])
          }
          const nothing = await get(`${missing}${sub}`)
          expect([sub, "no such pool", nothing.status, nothing.data]).toEqual([sub, "no such pool", 404, notFound])
        }
        const ledger = await get(`${base}/ledger`)
        expect([ledger.status, ledger.data]).toEqual([404, notFound])

        // A participant reads the terms.
        for (const sub of ["/proposals", "/bounties", "/barter"]) {
          const res = await get(`${base}${sub}`, as(participant))
          expect([sub, res.status]).toEqual([sub, 200])
          expect([sub, privateOf(res.data)]).toEqual([sub, []])
        }
        expect((await get(`${base}/bounties`, as(participant))).data.bounties.map((row: { id: string }) => row.id)).toEqual([rows.open.id])

        // Someone outside who claimed a bounty, or offered a trade: their
        // own row, whole, and nothing else of the pool.
        const claimed = await get(`${base}/bounties`, as(assignee))
        expect([claimed.status, claimed.data.bounties?.map((row: { id: string }) => row.id)]).toEqual([200, [rows.open.id]])
        expect(claimed.data.bounties[0]).toMatchObject({ assignee_id: assignee.id, contributor_id: contributor.id })
        const offered = await get(`${base}/barter`, as(proposer))
        expect([offered.status, offered.data.proposals?.map((row: { id: string }) => row.id)]).toEqual([200, [rows.trade.id]])
        expect(offered.data.proposals[0]).toMatchObject({ proposer_id: proposer.id })
        for (const [who, headers, sub] of [
          ["the assignee", as(assignee), "/proposals"],
          ["the assignee", as(assignee), "/barter"],
          ["the proposer", as(proposer), "/proposals"],
          ["the proposer", as(proposer), "/bounties"],
        ] as const) {
          const res = await get(`${base}${sub}`, headers)
          expect([who, sub, res.status, res.data]).toEqual([who, sub, 404, notFound])
        }

        // The creator reads every row whole.
        const own = await get(`${base}/proposals`, asReviewer)
        expect([own.status, own.data.proposals?.[0]?.payment_terms]).toEqual([200, POOL_PRIVATE.terms])
        const ownBounties = await get(`${base}/bounties`, asReviewer)
        expect(ownBounties.data.bounties.map((row: { id: string }) => row.id).sort()).toEqual([rows.open.id, rows.restricted.id].sort())
      })

      it("food producers are the public listing; the owner reads the whole row; a profile switched off answers as a missing one", async () => {
        const { pak, reviewer, asReviewer, get } = await makeMarket()
        const food = container().resolve(FOOD_DISTRIBUTION_MODULE)
        const kitchen = await food.createFoodProducers({
          name: "Corner Kitchen",
          handle: `corner-kitchen-${uid()}`,
          email: "kitchen-private@example.com",
          phone: "+15550555",
          secondary_phone: "+15550556",
          description: "Soul food",
          address_line_1: "12 Market Street",
          city: "Chicago",
          state: "IL",
          postal_code: "60601",
          owner_id: reviewer.id,
          owner_type: "customer",
          hawala_account_id: "acct_private_ledger",
          verification_notes: "reviewer-note-about-the-kitchen",
          licenses: [{ type: "FOOD_HANDLER", number: "LIC-PRIVATE-777", document_url: "https://docs.example.com/licence.pdf" }],
          metadata: { internal: "internal-producer-metadata" },
        })
        const baker = await food.createFoodProducers({
          name: "Home Baker",
          handle: `home-baker-${uid()}`,
          email: "baker-private@example.com",
          address_line_1: "3 Doorstep Close",
          city: "Chicago",
          state: "IL",
          latitude: 41.881832,
          longitude: -87.623177,
          hide_address: true,
        })
        const hidden = await food.createFoodProducers({
          name: "Not Listed Yet",
          handle: `not-listed-${uid()}`,
          email: "hidden-private@example.com",
          owner_id: reviewer.id,
          public_profile: false,
        })

        const privateOf = (data: unknown) => {
          const text = JSON.stringify(data)
          return [
            "kitchen-private@example.com",
            "+15550555",
            "+15550556",
            "acct_private_ledger",
            "reviewer-note-about-the-kitchen",
            "LIC-PRIVATE-777",
            "licence.pdf",
            "internal-producer-metadata",
            reviewer.id,
            "baker-private@example.com",
            "3 Doorstep Close",
            "41.881832",
            "Not Listed Yet",
            "hidden-private@example.com",
          ].filter((value) => text.includes(value))
        }

        const list = await get("/store/food-producers")
        expect(list.status).toBe(200)
        expect(list.data.producers.map((p: { name: string }) => p.name)).toEqual(["Corner Kitchen", "Home Baker"])
        expect(list.data.count).toBe(2)
        expect(list.data.producers[0]).toMatchObject({
          id: kitchen.id,
          name: "Corner Kitchen",
          description: "Soul food",
          address_line_1: "12 Market Street",
          city: "Chicago",
          state: "IL",
          postal_code: "60601",
          producer_type: "RESTAURANT",
          verified: false,
        })
        for (const column of ["email", "phone", "secondary_phone", "owner_id", "owner_type", "hawala_account_id", "verification_notes", "licenses", "metadata", "public_profile"]) {
          expect(list.data.producers[0]).not.toHaveProperty(column)
        }
        // `hide_address` still holds: the city stays, the doorstep goes.
        expect(list.data.producers[1]).toMatchObject({ id: baker.id, city: "Chicago", address_line_1: null, latitude: null, longitude: null })
        expect(privateOf(list.data)).toEqual([])

        const page = await get(`/store/food-producers/${kitchen.id}`)
        expect(page.status).toBe(200)
        expect(page.data.producer).toMatchObject({ id: kitchen.id, name: "Corner Kitchen", address_line_1: "12 Market Street", is_currently_open: expect.any(Boolean) })
        expect(privateOf(page.data)).toEqual([])

        // A profile switched off: the same answer as an id that does not exist.
        const missingId = `${hidden.id.slice(0, -4)}ZZZZ`
        const missing = await get(`/store/food-producers/${missingId}`)
        const switchedOff = await get(`/store/food-producers/${hidden.id}`)
        expect(missing.status).toBe(404)
        expect(switchedOff.status).toBe(missing.status)
        expect(JSON.stringify(switchedOff.data).split(hidden.id).join("ID")).toBe(JSON.stringify(missing.data).split(missingId).join("ID"))

        // The account that manages a producer reads its own rows whole, listed or not.
        const own = await get(`/store/food-producers/${kitchen.id}`, asReviewer)
        expect(own.data.producer).toMatchObject({
          email: "kitchen-private@example.com",
          phone: "+15550555",
          owner_id: reviewer.id,
          hawala_account_id: "acct_private_ledger",
          verification_notes: "reviewer-note-about-the-kitchen",
          licenses: [expect.objectContaining({ number: "LIC-PRIVATE-777" })],
        })
        const ownHidden = await get(`/store/food-producers/${hidden.id}`, asReviewer)
        expect(ownHidden.status).toBe(200)
        expect(ownHidden.data.producer).toMatchObject({ name: "Not Listed Yet", public_profile: false })
        const ownList = await get("/store/food-producers", asReviewer)
        expect(ownList.data.producers.find((p: { id: string }) => p.id === kitchen.id)).toMatchObject({ email: "kitchen-private@example.com", owner_id: reviewer.id })
        // Someone else's producer in the same list is still the public view.
        expect(ownList.data.producers.find((p: { id: string }) => p.id === baker.id)).not.toHaveProperty("email")

        // Another signed-in customer is a stranger.
        const [other] = await container().resolve(Modules.CUSTOMER).createCustomers([{ email: `other-${uid()}@example.com` }])
        const asOther = { headers: { ...pak.headers, authorization: `Bearer ${customerToken(other.id)}` } }
        expect(privateOf((await get("/store/food-producers", asOther)).data)).toEqual([])
        expect((await get(`/store/food-producers/${hidden.id}`, asOther)).status).toBe(404)
      })

      it("a producer write tells a caller who is not the owner no more than GET does", async () => {
        const { pak, get } = await makeMarket()
        const food = container().resolve(FOOD_DISTRIBUTION_MODULE)
        // Producers with no owner on record, which any signed-in account may
        // write (`actorMayManage`, grandfathered).
        const legacy = await food.createFoodProducers({
          name: "Legacy Kitchen",
          handle: `legacy-kitchen-${uid()}`,
          email: "legacy-private@example.com",
          phone: "+15550888",
          secondary_phone: "+15550889",
          hawala_account_id: "acct_legacy_ledger",
          verification_notes: "legacy-reviewer-note",
          licenses: [{ type: "FOOD_HANDLER", number: "LIC-LEGACY-1" }],
          metadata: { internal: "legacy-internal" },
          hide_address: true,
          address_line_1: "8 Legacy Doorstep",
          city: "Chicago",
        })
        const switchedOff = await food.createFoodProducers({
          name: "Switched Off Kitchen",
          handle: `switched-off-${uid()}`,
          email: "switched-off-private@example.com",
          public_profile: false,
        })
        expect([legacy.owner_id, switchedOff.owner_id]).toEqual([null, null])
        const [stranger] = await container().resolve(Modules.CUSTOMER).createCustomers([{ email: `stranger-${uid()}@example.com` }])
        const asStranger = { headers: { ...pak.headers, authorization: `Bearer ${customerToken(stranger.id)}` } }
        const ownerOnly = (data: unknown) => {
          const text = JSON.stringify(data)
          return [
            "legacy-private@example.com",
            "+15550888",
            "+15550889",
            "acct_legacy_ledger",
            "legacy-reviewer-note",
            "LIC-LEGACY-1",
            "legacy-internal",
            "8 Legacy Doorstep",
            "switched-off-private@example.com",
            "Switched Off Kitchen",
          ].filter((value) => text.includes(value))
        }

        const served = await get(`/store/food-producers/${legacy.id}`, asStranger)
        expect(served.status).toBe(200)
        const written = await safe(api.put(`/store/food-producers/${legacy.id}`, { description: "updated by a stranger" }, asStranger))
        expect(written.status).toBe(200)
        // The write went through; the answer is what GET serves them.
        expect(written.data.producer).toMatchObject({ id: legacy.id, description: "updated by a stranger", city: "Chicago", address_line_1: null })
        expect(Object.keys(written.data.producer).sort()).toEqual(
          Object.keys(served.data.producer)
            .filter((key) => key !== "is_currently_open")
            .sort()
        )
        expect(ownerOnly(written.data)).toEqual([])
        expect((await food.retrieveFoodProducer(legacy.id)).email).toBe("legacy-private@example.com")

        // A profile switched off is missing to them on GET; its write is
        // acknowledged with the id they named.
        expect((await get(`/store/food-producers/${switchedOff.id}`, asStranger)).status).toBe(404)
        const quiet = await safe(api.put(`/store/food-producers/${switchedOff.id}`, { description: "still writable" }, asStranger))
        expect([quiet.status, quiet.data]).toEqual([200, { producer: { id: switchedOff.id } }])
        expect((await food.retrieveFoodProducer(switchedOff.id)).description).toBe("still writable")

        // The account that creates a producer owns it and is answered with the row.
        const created = await safe(
          api.post(
            "/store/food-producers",
            { name: "Fresh Kitchen", handle: `fresh-kitchen-${uid()}`, producer_type: "RESTAURANT", email: "fresh-private@example.com", phone: "+15550444" },
            asStranger
          )
        )
        expect(created.status).toBe(201)
        expect(created.data.producer).toMatchObject({ email: "fresh-private@example.com", phone: "+15550444", owner_id: stranger.id })
      })
    })
  },
})

/**
 * Records that are someone's, or the platform's own: never the answer to a
 * public read. By name of the entity in the joined schema.
 */
function isPrivateEntity(entity: string): boolean {
  const open = new Set([
    // Catalogue and configuration that happen to share a prefix.
    "OrderCycle",
    "OrderCycleProduct",
    "PaymentProvider",
    "FulfillmentProvider",
    "FulfillmentSet",
    "ReturnReason",
    "CustomerGroup",
  ])
  if (open.has(entity)) return false
  return (
    /^(Order|Cart|Customer|Payment|Payout|Fulfillment|Return|Refund|Capture|LineItem|ShippingMethod|Member|Seller[A-Z]|StockLocation|ApiKey|Wishlist|Subscription|Delivery|Wellness|Vault|Vendor|Woocommerce|AuthIdentity|ProviderIdentity|FoodOrder|FoodDelivery|FoodCourier|Quote|CooperativeMember|User$|Invite$)/.test(
      entity
    ) ||
    [
      "AccountHolder",
      "Address",
      "CreditLine",
      "Entitlement",
      "TicketPurchase",
      "DigitalProductOrder",
      "DigitalProductMedia",
      "Driver",
      "Rental",
      "ReservationItem",
      "RestaurantAdmin",
      "SplitOrderPayment",
      "Onboarding",
      "PlaybookAssignment",
      "ProductionBatch",
      "QuestEnrollment",
    ].includes(entity)
  )
}

/**
 * entity -> { relation name -> entity it leads to }, from what Medusa loaded:
 * each module's schema for the relations inside a module, each link's
 * `extends` for the ones between modules (the join row, and the alias that
 * skips over it), as `framework/dist/http/utils/policies/rbac-field-filter.js`
 * reads the same configs.
 */
function joinedGraph(): Record<string, Record<string, string>> {
  type Relationship = { entity?: string; alias: string }
  type JoinerConfig = {
    schema?: string
    alias?: { name: string | string[]; entity?: string } | { name: string | string[]; entity?: string }[]
    relationships?: Relationship[]
    extends?: { entity?: string; fieldAlias?: Record<string, string | { path: string }>; relationship?: Relationship }[]
  }
  const configs = MedusaModule.getAllJoinerConfigs() as JoinerConfig[]
  const graph: Record<string, Record<string, string>> = {}
  const edge = (from: string, name: string, to: string) => {
    graph[from] = graph[from] ?? {}
    graph[from][name] = to
  }

  const scalars = "scalar DateTime\nscalar Date\nscalar Time\nscalar JSON\n"
  const typeDefs = scalars + configs.map((config) => config.schema ?? "").join("\n")
  const { schema: cleaned } = GraphQLUtils.cleanGraphQLSchema(typeDefs)
  const types = GraphQLUtils.makeExecutableSchema({ typeDefs: cleaned }).getTypeMap()
  const unwrap = (type: any): string => (type.type ? unwrap(type.type) : type.name?.value)
  for (const [name, type] of Object.entries(types)) {
    if (name.startsWith("__")) continue
    for (const field of (type as any).astNode?.fields ?? []) {
      const target = unwrap(field.type)
      if (target && (types[target] as any)?.astNode?.kind === "ObjectTypeDefinition") edge(name, field.name.value, target)
    }
  }

  for (const config of configs) {
    // A link's join row leads to both of its sides.
    const aliases = Array.isArray(config.alias) ? config.alias : config.alias ? [config.alias] : []
    const row = aliases.find((alias) => alias.entity)?.entity
    if (row) for (const relationship of config.relationships ?? []) if (relationship.entity) edge(row, relationship.alias, relationship.entity)
    for (const extension of config.extends ?? []) {
      if (extension.entity && extension.relationship?.entity) {
        edge(extension.entity, extension.relationship.alias, extension.relationship.entity)
      }
    }
  }
  // The aliases that skip over a join row (`product.seller` for `product.seller_link.seller`).
  for (const config of configs) {
    for (const extension of config.extends ?? []) {
      if (!extension.entity) continue
      for (const [name, spec] of Object.entries(extension.fieldAlias ?? {})) {
        let at: string | undefined = extension.entity
        for (const segment of (typeof spec === "string" ? spec : spec.path).split(".")) at = at ? graph[at]?.[segment] : undefined
        if (at) edge(extension.entity, name, at)
      }
    }
  }
  return graph
}
