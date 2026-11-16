import { prepareListQuery } from "@medusajs/framework/http"
import {
  BUYER_SELLER_FIELDS,
  PUBLIC_REVIEW_FIELDS,
  PUBLIC_SELLER_FIELDS,
  keepVisibleNestedProducts,
  nestedProductIds,
  projectSellersInBody,
  sanitizeStoreFields,
  sanitizeStoreSelectRelations,
  storeFieldProfile,
} from "../store-field-policy"

/**
 * The policy on its own: what is left of a field list. The same lists go
 * through the real routes on Postgres in
 * `integration-tests/http/store-public-fields.spec.ts`.
 */

/**
 * A `fields` query parameter as Medusa turns it into the list a route passes
 * to `query.graph`: its own `prepareListQuery`, which is what
 * `validateAndTransformQuery` calls.
 */
async function parsed(fields: string, defaults: string[] = []): Promise<string[]> {
  const { remoteQueryConfig } = await prepareListQuery({ fields }, { defaults, isList: true })
  return remoteQueryConfig.fields
}

const publicFields = async (fields: string, defaults: string[] = []) =>
  sanitizeStoreFields(await parsed(fields, defaults), storeFieldProfile("/store/products")).fields.sort()

const sellerColumns = (prefix: string, columns: readonly string[] = PUBLIC_SELLER_FIELDS) =>
  columns.map((column) => `${prefix}.${column}`)

describe("store field policy", () => {
  describe("a seller reached from a public read", () => {
    it.each(["*seller", "seller.*"])("%s becomes the public columns", async (spelling) => {
      expect(await publicFields(`id,${spelling}`)).toEqual(["id", ...sellerColumns("seller")].sort())
    })

    it.each([
      "seller.email",
      "+seller.email",
      "seller.phone",
      "seller.tax_id",
      "seller.address_line",
      "seller.city",
      "seller.state",
      "seller.postal_code",
      "seller.country_code",
    ])("%s is dropped", async (spelling) => {
      expect(await publicFields(`id,${spelling}`)).toEqual(["id"])
    })

    it("keeps a public column asked for by name", async () => {
      expect(await publicFields("id,seller.name,seller.handle,seller.photo,seller.store_status")).toEqual(
        ["id", "seller.handle", "seller.name", "seller.photo", "seller.store_status"].sort()
      )
    })

    it.each([
      "*seller.members",
      "*seller.invites",
      "*seller.onboarding",
      "*seller.orders",
      "seller.orders.id",
      "*seller.orders.shipping_address",
      "*seller.orders.customer",
      "*seller.payout_account",
      "*seller.stock_locations.address",
      "*seller.seller_metadata",
      "*seller.vault_documents",
      "*seller.woocommerce_connection",
      "*seller.a_link_added_tomorrow",
      "seller.a_column_added_tomorrow",
    ])("%s is dropped: nothing behind a seller is served unless listed", async (spelling) => {
      expect(await publicFields(`id,${spelling}`)).toEqual(["id"])
    })

    it("is the same seller however deep the path to it", async () => {
      expect(await publicFields("id,*variants.product.seller")).toEqual(["id", ...sellerColumns("variants.product.seller")].sort())
      expect(await publicFields("id,sales_channels.stock_locations.seller.email")).toEqual(["id"])
      expect(sanitizeStoreFields(["items.product.seller.*"], storeFieldProfile("/store/carts/cart_1")).fields.sort()).toEqual(
        sellerColumns("items.product.seller").sort()
      )
    })

    it("a seller's reviews are the public columns, the reviewer's name and the seller's name", async () => {
      expect(await publicFields("id,*seller.reviews")).toEqual(["id", ...PUBLIC_REVIEW_FIELDS.map((f) => `seller.reviews.${f}`)].sort())
      expect(await publicFields("id,*seller.reviews.customer")).toEqual(
        ["id", "seller.reviews.customer.first_name", "seller.reviews.customer.last_name"].sort()
      )
      expect(await publicFields("id,seller.reviews.customer.email,seller.reviews.customer.phone,*seller.reviews.customer.addresses")).toEqual([
        "id",
      ])
      expect(await publicFields("id,*seller.reviews.seller")).toEqual(
        ["id", "seller.reviews.seller.handle", "seller.reviews.seller.id", "seller.reviews.seller.name", "seller.reviews.seller.photo"].sort()
      )
      expect(await publicFields("id,*seller.reviews.order,*seller.reviews.product")).toEqual(["id"])
    })

    it("a seller's products are flagged for the visibility filter and always carry their id", async () => {
      const result = sanitizeStoreFields(await parsed("id,seller.products.title"))
      expect(result.nestedProducts).toBe(true)
      expect(result.fields.sort()).toEqual(["id", "seller.products.id", "seller.products.title"])
      expect(sanitizeStoreFields(await parsed("id,seller.products.*")).fields.sort()).toEqual([
        "id",
        "seller.products.*",
        "seller.products.id",
      ])
      // And what is behind them is the public rules again.
      expect(await publicFields("id,*seller.products.seller.orders,seller.products.seller.email")).toEqual(["id"])
      expect(sanitizeStoreFields(await parsed("id,title,*variants")).nestedProducts).toBe(false)
    })

    it("leaves the storefront's product lists as they are, apart from the id of the seller's products", async () => {
      const page =
        "id,title,handle,*images,*variants,*variants.calculated_price,variants.inventory_quantity," +
        "seller.id,seller.name,seller.handle,seller.photo,seller.store_status," +
        "seller.reviews.id,seller.reviews.rating,seller.reviews.customer_note,seller.reviews.seller_note," +
        "seller.reviews.created_at,seller.reviews.updated_at," +
        "seller.reviews.customer.first_name,seller.reviews.customer.last_name,seller.reviews.seller.name," +
        "seller.products.id,seller.products.handle,seller.products.status," +
        "attribute_values.id,attribute_values.value,attribute_values.attribute.id,attribute_values.attribute.name"
      const result = sanitizeStoreFields(await parsed(page))
      expect(result.dropped).toEqual([])
      expect(result.fields.sort()).toEqual((await parsed(page)).sort())
    })
  })

  describe("other people's records", () => {
    it.each([
      ["/store/regions", "*orders"],
      ["/store/regions", "*orders.shipping_address"],
      ["/store/regions", "*carts"],
      ["/store/regions", "*payment_providers.payment_collections"],
      ["/store/products", "*sales_channels.orders"],
      ["/store/products", "*sales_channels.stock_locations.address"],
      ["/store/products", "*sales_channels.publishable_api_keys"],
      ["/store/products", "*variants.order_items"],
      ["/store/products", "*variants.inventory_items.inventory.location_levels.stock_locations.address"],
      ["/store/products", "*variants.inventory_items.inventory.reservation_items"],
      ["/store/products", "*variants.digital_product.medias"],
      ["/store/products", "*wishlist.customer"],
      ["/store/products", "*entitlements.customer"],
      ["/store/products", "*ticket_product.purchases"],
      ["/store/products", "*restaurant.deliveries"],
      ["/store/products", "*restaurant.admins"],
      ["/store/products", "*shipping_profile.shipping_options.fulfillments.delivery_address"],
      ["/store/product-variants", "*product.wishlist.customer"],
      // A link's join rows are a second way to the far side under another name.
      ["/store/products", "*sales_channels.products_link.product"],
      ["/store/products", "*seller_link.seller"],
      // An inventory item may be shared with another product's variants.
      ["/store/products", "*variants.inventory.variants"],
      ["/store/products", "*sales_channels.stock_locations"],
      // By name, whatever it hangs off: a link added tomorrow is refused too.
      ["/store/products", "*a_link_added_tomorrow.customer"],
      ["/store/products", "*a_link_added_tomorrow.customers"],
      ["/store/products", "*a_link_added_tomorrow.orders"],
      ["/store/products", "*a_link_added_tomorrow.cart"],
      ["/store/products", "*a_link_added_tomorrow.payment_collection"],
      ["/store/products", "*a_link_added_tomorrow.payments"],
      ["/store/products", "*a_link_added_tomorrow.addresses"],
      ["/store/collections", "*products.seller.orders"],
    ])("%s?fields=%s is dropped", async (route, spelling) => {
      expect(sanitizeStoreFields(await parsed(`id,${spelling}`), storeFieldProfile(route)).fields).toEqual(["id"])
    })

    it("a product's reviews are the public columns and the reviewer's name", async () => {
      expect(await publicFields("id,*reviews.customer,reviews.customer.email,*reviews.order")).toEqual(
        ["id", "reviews.customer.first_name", "reviews.customer.last_name"].sort()
      )
    })

    it("catalogue relations stay open", async () => {
      const fields =
        "id,*variants,*variants.options,variants.options.option.title,*options.values,*images,*tags,*type,*collection," +
        "categories.id,categories.name,sales_channels.id,sales_channels.name,*variants.calculated_price,*category_children"
      expect(await publicFields(fields)).toEqual((await parsed(fields)).sort())
    })

    it("flags a product list reached from a collection, a category, a tag or a type", async () => {
      for (const route of ["/store/collections", "/store/product-categories", "/store/product-tags", "/store/product-types"]) {
        const result = sanitizeStoreFields(await parsed("id,*products"), storeFieldProfile(route))
        expect(result.nestedProducts).toBe(true)
        expect(result.fields.sort()).toEqual(["id", "products.*", "products.id"])
      }
    })
  })

  describe("Mercur's seller routes, whose root record is a seller", () => {
    const mercurDefaults = [
      "id",
      "store_status",
      "name",
      "handle",
      "description",
      "photo",
      "address_line",
      "city",
      "postal_code",
      "country_code",
      "tax_id",
    ]
    const seller = async (fields?: string) =>
      sanitizeStoreFields(
        fields === undefined ? mercurDefaults : await parsed(fields, mercurDefaults),
        storeFieldProfile("/store/seller/riverbend-farm")
      ).fields.sort()

    it("the route's own defaults lose the address and the tax id", async () => {
      expect(await seller()).toEqual(["description", "handle", "id", "name", "photo", "store_status"])
      expect(sanitizeStoreFields(mercurDefaults, storeFieldProfile("/store/seller")).fields.sort()).toEqual(await seller())
    })

    it("the storefront's seller page query keeps what the page shows, and not the email it also asks for", async () => {
      const asked =
        "+created_at,+email,+metadata,+reviews.seller.name,+reviews.rating,+reviews.customer_note,+reviews.seller_note," +
        "+reviews.created_at,+reviews.updated_at,+reviews.customer.first_name,+reviews.customer.last_name"
      expect(await seller(asked)).toEqual(
        [
          "created_at",
          "description",
          "handle",
          "id",
          "name",
          "photo",
          "reviews.created_at",
          "reviews.customer.first_name",
          "reviews.customer.last_name",
          "reviews.customer_note",
          "reviews.rating",
          "reviews.seller.name",
          "reviews.seller_note",
          "reviews.updated_at",
          "store_status",
        ].sort()
      )
    })

    it.each(["email", "phone", "tax_id", "state", "*members", "*invites", "*orders", "*payout_account", "*reviews.customer.addresses"])(
      "%s is dropped",
      async (spelling) => {
        expect(await seller(`id,${spelling}`)).toEqual(["id"])
      }
    )

    it("a star on the root is the public columns", async () => {
      expect(await seller("*")).toEqual([...PUBLIC_SELLER_FIELDS].sort())
    })
  })

  describe("the caller's own record", () => {
    const cart = async (fields: string) => sanitizeStoreFields(await parsed(fields), storeFieldProfile("/store/carts/cart_1")).fields.sort()
    const order = async (fields: string) => sanitizeStoreFields(await parsed(fields), storeFieldProfile("/store/orders/order_1")).fields.sort()
    const me = async (fields: string) => sanitizeStoreFields(await parsed(fields), storeFieldProfile("/store/customers/me")).fields.sort()

    it("a cart keeps its customer, its addresses and its payment", async () => {
      const fields =
        "id,email,customer.id,customer.email,customer.groups.id,shipping_address.address_1,*payment_collection," +
        "*payment_collection.payment_sessions,*items,*items.product,*items.variant,*region,*promotions,items.total"
      expect(await cart(fields)).toEqual((await parsed(fields)).sort())
    })

    it("a cart does not lead to anyone else's", async () => {
      expect(await cart("id,*region.orders,*region.carts,*items.variant.order_items,*customer.groups.customers")).toEqual(["id"])
      expect(await cart("id,*items.product.seller.orders,items.product.seller.email,*items.product.wishlist.customer")).toEqual(["id"])
    })

    it("the seller of a cart line is the public seller", async () => {
      expect(await cart("id,*items.product.seller")).toEqual(["id", ...sellerColumns("items.product.seller")].sort())
    })

    it("an order shows its buyer where to send a return: the seller's address and contact, never the tax id", async () => {
      expect(await order("id,*seller")).toEqual(["id", ...sellerColumns("seller", BUYER_SELLER_FIELDS)].sort())
      expect(await order("id,seller.tax_id,*seller.orders,*seller.members")).toEqual(["id"])
      // The seller of a line's product is not the order's seller record.
      expect(await order("id,items.product.seller.email")).toEqual(["id"])
    })

    it("an order keeps the storefront's own list", async () => {
      const fields = "*payment_collections.payments,*items,*items.metadata,*items.variant,*items.product,*order_set,*reviews,shipping_total"
      expect(await order(fields)).toEqual((await parsed(fields)).sort())
      // What the seller was paid for it is not the buyer's.
      expect(await order("id,*payouts,*split_order_payment")).toEqual(["id"])
    })

    it("customers/me keeps the caller's addresses and orders, and not the other members of their groups", async () => {
      expect(await me("id,email,*addresses,*orders,*orders.items")).toEqual((await parsed("id,email,*addresses,*orders,*orders.items")).sort())
      expect(await me("id,*groups.customers,*orders.seller.orders")).toEqual(["id"])
      expect(await me("id,*orders.seller")).toEqual(["id", ...sellerColumns("orders.seller", BUYER_SELLER_FIELDS)].sort())
    })
  })

  it("matches a route family by whole path segments", async () => {
    expect(storeFieldProfile("/store/seller").name).toBe("seller")
    expect(storeFieldProfile("/store/seller/riverbend-farm?fields=email").name).toBe("seller")
    expect(storeFieldProfile("/store/sellers/riverbend-farm/story").name).toBe("public")
    expect(storeFieldProfile("/store/seller-reports").name).toBe("public")
    expect(storeFieldProfile("/store/orders/order_1").name).toBe("order")
    expect(storeFieldProfile("/store/order-set/ordset_1").name).toBe("order-set")
    expect(storeFieldProfile("/store/order-claims").name).toBe("public")
    expect(storeFieldProfile("/store/carts/cart_1/line-items").name).toBe("cart")
    expect(storeFieldProfile("/store/products").name).toBe("public")
  })

  it("is stable: a sanitised list is its own fixed point", async () => {
    const once = sanitizeStoreFields(await parsed("id,*seller,*seller.reviews.customer,seller.products.*,*orders"))
    expect(sanitizeStoreFields(once.fields).fields.sort()).toEqual([...once.fields].sort())
  })

  it("select/relations: a relation stays only when it is open as a whole or a kept column needs it", async () => {
    expect(
      sanitizeStoreSelectRelations({
        select: ["id", "seller.name", "seller.email", "orders.id"],
        relations: ["variants", "seller", "seller.orders", "orders", "seller.members"],
      })
    ).toEqual({ select: ["id", "seller.name"], relations: ["variants", "seller"] })
    expect(sanitizeStoreSelectRelations({ relations: ["seller", "variants"] })).toEqual({ select: undefined, relations: ["variants"] })
  })

  describe("on the way out", () => {
    it("cuts every seller object in a response to the allow-list", async () => {
      const total = { toJSON: () => 12, numeric_: 12 }
      const body = {
        order_set: {
          id: "ordset_1",
          total,
          orders: [
            {
              id: "order_1",
              seller: { id: "sel_1", name: "Farm", email: "grower@example.com", tax_id: "12-3456789", members: [{ email: "m@example.com" }] },
            },
          ],
        },
      }
      const cut = projectSellersInBody(body)
      expect(cut.order_set.orders[0].seller).toEqual({ id: "sel_1", name: "Farm", email: "grower@example.com" })
      // A value that serialises itself is left whole.
      expect(cut.order_set.total).toBe(total)
      // A copy: the rows a handler holds (or a cache does) are not edited.
      expect(body.order_set.orders[0].seller).toHaveProperty("tax_id", "12-3456789")
    })

    it("finds and filters product lists below the top level, and leaves the route's own list alone", async () => {
      const body = {
        products: [
          {
            id: "prod_listed",
            seller: { id: "sel_1", products: [{ id: "prod_a" }, { id: "prod_draft" }, { handle: "no-id" }] },
            collection: { id: "pcol_1", products: [{ id: "prod_b" }, { id: "prod_other_channel" }] },
          },
        ],
      }
      expect(nestedProductIds(body).sort()).toEqual(["prod_a", "prod_b", "prod_draft", "prod_other_channel"])
      const kept = keepVisibleNestedProducts(body, new Set(["prod_a", "prod_b"]))
      expect(kept.products).toHaveLength(1)
      expect(kept.products[0].seller.products).toEqual([{ id: "prod_a" }])
      expect(kept.products[0].collection.products).toEqual([{ id: "prod_b" }])
      expect(body.products[0].seller.products).toHaveLength(3)
    })
  })
})
