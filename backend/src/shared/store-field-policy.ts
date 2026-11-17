/**
 * What a `/store` read may expand through a link (SD-118).
 *
 * Every Medusa and Mercur store route that takes `fields` hands the caller's
 * list to `query.graph`, and the joined graph is one connected thing: from a
 * product a caller reaches its seller, and from the seller its members, its
 * invites, its payout account and every order it ever took; from a region,
 * every order placed in it. Measured on Postgres with nothing but the
 * publishable key (which every page of the storefront carries):
 *
 *   GET /store/products?fields=*seller                    the seller's email, phone, address, tax id
 *   GET /store/products?fields=*seller.orders.customer    every buyer of that seller
 *   GET /store/products?fields=*seller.members            the seller's staff
 *   GET /store/products?fields=*seller.reviews.customer   reviewers' customer rows
 *   GET /store/products?fields=seller.products.*          drafts, other channels' products
 *   GET /store/regions?fields=*orders.shipping_address    every order's address
 *   GET /store/products?fields=*variants.digital_product.medias   the file ids of paid downloads
 *
 * Medusa's own guard for this is `http.restrictedFields.store` ("order",
 * "orders") and a route's `allowed` list. In 2.14.2 both are computed and
 * then applied only when the `rbac_filter_fields` feature flag is on
 * (`framework/dist/http/utils/get-query-config.js`): with the flag off, which
 * is the default and which nothing in this repository turns on, neither
 * refuses nor drops anything (`seller.orders.id` was answered on Postgres).
 * So the rule is written here and applied by
 * `api/middlewares/store-public-fields.ts` to the field list every store
 * route ends up with, defaults included.
 *
 * The rule, on the list after Medusa has parsed it (so `*seller`, `seller.*`,
 * `+seller.email` and `seller.email` are one spelling):
 *
 * - **A seller is an allow-list.** Reaching `seller` from anywhere leaves only
 *   the fields a storefront shows of a seller, and of its relations only its
 *   reviews and its products. Everything else on or behind a seller is denied
 *   without being named, so a link added to the seller tomorrow is denied too.
 * - **A review is an allow-list**: its rating, texts and dates, the
 *   reviewer's first and last name (what the seller page prints) and the
 *   seller's name for a reply. Never the reviewer's email, phone or addresses.
 * - **Other people's records are refused by name**: orders, carts, customers,
 *   payments and the rows that hang off them, wherever in a path they appear,
 *   and with them every link's own join rows (`*_link`).
 * - **The caller's own record is the exception**, by route: a cart, an order
 *   or `customers/me` may be read through the relations of that record
 *   (a profile's `own`), and no further. `region.orders` on a cart is still
 *   refused. A cart and an order are served to whoever holds the id, so the
 *   buyer behind one, and the order set an order was placed in, are leaves
 *   (`ownNodes`): no path from one order reaches another.
 * - **Nested products are flagged**, and the middleware then serves only
 *   those `GET /store/products` itself would: published, in the key's sales
 *   channel.
 *
 * A field that is not allowed is dropped, not refused with a 400. `*seller`
 * is how a Medusa client asks for a relation: the storefront's order and
 * review queries do, its cart query did until this change, and a client that
 * cannot be redeployed with the backend may. Refusing would turn a privacy
 * fix into an outage for them, and a star has no single field to refuse. One
 * behaviour for every spelling: the answer simply does not contain what the
 * caller may not see.
 *
 * Names, not types, decide at run time (a path segment called `orders` is
 * refused whatever it hangs off). `integration-tests/http/
 * store-public-fields.spec.ts` checks the names against the real joined
 * graph: it walks every relation the policy leaves open from each public
 * root and fails if one lands on a customer, order, cart, payment or
 * seller-private entity. A new link that exposes one under a new name fails
 * there.
 */

/** What a storefront shows of a seller: the card, the seller page, the cart header. */
export const PUBLIC_SELLER_FIELDS = [
  "id",
  "name",
  "handle",
  "description",
  "photo",
  "store_status",
  "created_at",
] as const

/**
 * What the buyer of an order is shown of its seller: the above, and where to
 * send a return and whom to ask (the storefront's return flow prints the
 * seller's address, email and phone from `order.seller`). Never the tax id.
 */
export const BUYER_SELLER_FIELDS = [
  ...PUBLIC_SELLER_FIELDS,
  "email",
  "phone",
  "address_line",
  "city",
  "state",
  "postal_code",
  "country_code",
] as const

/** What is public of a review. */
export const PUBLIC_REVIEW_FIELDS = [
  "id",
  "reference",
  "rating",
  "customer_note",
  "seller_note",
  "created_at",
  "updated_at",
] as const

/** The reviewer, as the seller page prints them. */
export const PUBLIC_REVIEWER_FIELDS = ["first_name", "last_name"] as const

/** The seller a reply is signed with. */
export const REVIEW_SELLER_FIELDS = ["id", "name", "handle", "photo"] as const

type GuardedNode = {
  readonly fields: readonly string[]
  /** `"open"` hands the rest of the path back to the public rules. */
  readonly relations: Readonly<Record<string, GuardedNode | "open">>
}

const REVIEW: GuardedNode = {
  fields: PUBLIC_REVIEW_FIELDS,
  relations: {
    customer: { fields: PUBLIC_REVIEWER_FIELDS, relations: {} },
    seller: { fields: REVIEW_SELLER_FIELDS, relations: {} },
  },
}

const sellerNode = (fields: readonly string[]): GuardedNode => ({
  fields,
  relations: { reviews: REVIEW, products: "open" },
})

const PUBLIC_SELLER = sellerNode(PUBLIC_SELLER_FIELDS)
const BUYER_SELLER = sellerNode(BUYER_SELLER_FIELDS)

const SELLER_NAMES = new Set(["seller", "sellers"])
const REVIEW_NAMES = new Set(["review", "reviews"])

/**
 * Relations a public read never walks, at any depth: each leads to another
 * party's record, or to something of the platform's that is not catalogue.
 * The spec's graph walk is what keeps this list complete.
 */
export const DENIED_RELATIONS: ReadonlySet<string> = new Set([
  // Orders and what hangs off them.
  "order",
  "orders",
  "order_items",
  "order_line_item",
  "order_change",
  "order_changes",
  "order_set",
  "transactions",
  "claim",
  "claims",
  "exchange",
  "exchanges",
  "return",
  "returns",
  "return_order",
  "return_items",
  "fulfillment",
  "fulfillments",
  "delivery_address",
  "split_order_payment",
  "ticket_purchases",
  "purchases",
  "wellness_class_attendees",
  "digital_product_order",
  "delivery",
  "deliveries",
  "driver",
  // Carts.
  "cart",
  "carts",
  "cart_items",
  // Customers and what is theirs.
  "customer",
  "customers",
  "addresses",
  "account_holders",
  "wishlist",
  "wishlists",
  "entitlements",
  "subscription",
  "subscriptions",
  "rental",
  "rentals",
  "wellness_member",
  "wellness_members",
  // Payments and payouts.
  "payment",
  "payments",
  "payment_collection",
  "payment_collections",
  "payment_session",
  "payment_sessions",
  "captures",
  "refunds",
  "payout",
  "payouts",
  "payout_account",
  "reversals",
  // A seller's and the platform's own people and keys.
  "members",
  "invites",
  "onboarding",
  "admins",
  "user",
  "users",
  "auth_identity",
  "provider_identities",
  "api_keys",
  "publishable_api_keys",
  // Where a seller keeps stock: for a small grower, a home address.
  "stock_locations",
  "location",
  "locations",
  "address",
  // What is sold, and what is held back for other buyers.
  "medias",
  "reservation_items",
])

/**
 * A link's own join rows (`seller_link`, `products_link`, ...). They carry
 * ids only, but each is a second way to the record on the far side under a
 * name the rules above do not know (`sales_channels.products_link.product`
 * is every product in the channel, drafts included). No client asks for
 * them.
 */
const isLinkRow = (segment: string) => segment.endsWith("_link")

/**
 * A relation that is refused only after a particular one: an inventory item
 * may be shared by variants of several products, so its `variants` lead to
 * products the caller was not listed.
 */
const DENIED_AFTER: Readonly<Record<string, ReadonlySet<string>>> = {
  inventory: new Set(["variants"]),
}

/**
 * How a route's field list is read. By default the public rules apply from
 * the first segment. A route whose root record is the caller's own names the
 * relations of that record in `own`: a path may pass through them freely, and
 * the public rules apply from the first segment that is not one. `ownNodes`
 * are relations of that record read as an allow-list that ends there (the
 * buyer behind a cart or an order, the order set an order belongs to), and
 * `ownSeller` is the allow-list for a seller reached from that record.
 */
export type StoreFieldProfile = {
  readonly name: string
  /** The route's root record is itself an allow-list (the seller routes). */
  readonly root?: GuardedNode
  readonly own?: ReadonlySet<string>
  readonly ownNodes?: Readonly<Record<string, GuardedNode>>
  readonly ownSeller?: GuardedNode
  /**
   * The route's handler fixes its own field list, so there is no request to
   * narrow: cut every seller object in its response to these fields instead.
   */
  readonly projectSellers?: readonly string[]
}

/**
 * The buyer of a cart or an order, as that record is read with them: their
 * own columns and none of their other records.
 *
 * `GET /store/orders/:id` and `GET /store/carts/:id` answer whoever holds the
 * id (Medusa's design for guest checkout; no customer token is asked for).
 * With the buyer an ordinary part of the order, one order id opened the
 * buyer's customer row, every other order of theirs with its address, and,
 * through those orders and the buyer's reviews, the contact details of every
 * seller they had bought from or reviewed (measured on Postgres with only the
 * publishable key). The buyer is a leaf now: a path through them stops at
 * these columns. `metadata` and `created_by` stay off.
 */
export const RECORD_CUSTOMER_FIELDS = [
  "id",
  "email",
  "first_name",
  "last_name",
  "phone",
  "company_name",
  "has_account",
  "created_at",
  "updated_at",
] as const

/**
 * The order set an order was placed in, as the storefront's order pages head
 * it (`order_set.id`, `display_id`, `created_at`): never its other orders,
 * its cart or its payment collection.
 */
export const ORDER_SET_HEADING_FIELDS = ["id", "display_id", "created_at", "updated_at"] as const

/**
 * Of the buyer's relations, only the ids of their customer groups, which
 * Medusa's default cart fields ask for (`customer.groups.id`): a group is
 * price-list configuration, but its name can say something about the person
 * in it, and nothing first-party reads more than the id.
 */
const RECORD_CUSTOMER: GuardedNode = {
  fields: RECORD_CUSTOMER_FIELDS,
  relations: { groups: { fields: ["id"], relations: {} } },
}
const ORDER_SET_HEADING: GuardedNode = { fields: ORDER_SET_HEADING_FIELDS, relations: {} }

/** The parts of a cart, an order and a payment that belong to whoever holds it. */
const CART_PARTS = [
  "items",
  "adjustments",
  "tax_lines",
  "shipping_methods",
  "shipping_address",
  "billing_address",
  "credit_lines",
  "payment_collection",
  "payment_sessions",
  "payments",
  "captures",
  "refunds",
]

/**
 * An order's own parts. Not `customer` (a leaf, above), not `order_set` (a
 * heading), and not `orders`: nothing reached from one order is another.
 */
const ORDER_PARTS = [
  ...CART_PARTS,
  "detail",
  "summary",
  "payment_collections",
  "transactions",
  "fulfillments",
  "labels",
  "delivery_address",
  "returns",
  "return_items",
  "order_change",
  "reviews",
]

const PUBLIC_PROFILE: StoreFieldProfile = { name: "public" }

const PROFILES: readonly { prefix: string; profile: StoreFieldProfile }[] = [
  // Mercur's seller list and page: the root record is a seller.
  { prefix: "/store/seller", profile: { name: "seller", root: PUBLIC_SELLER } },
  {
    prefix: "/store/carts",
    profile: { name: "cart", own: new Set(CART_PARTS), ownNodes: { customer: RECORD_CUSTOMER } },
  },
  {
    prefix: "/store/payment-collections",
    profile: { name: "payment", own: new Set(CART_PARTS), ownNodes: { customer: RECORD_CUSTOMER } },
  },
  {
    // `GET /store/orders/:id` authenticates nobody: a path from the order
    // stays on that order.
    prefix: "/store/orders",
    profile: {
      name: "order",
      own: new Set(ORDER_PARTS),
      ownNodes: { customer: RECORD_CUSTOMER, order_set: ORDER_SET_HEADING },
      ownSeller: BUYER_SELLER,
    },
  },
  {
    prefix: "/store/order-set",
    // Mercur's handlers ignore the request's list and ask for `orders.seller.*`;
    // `api/middlewares/store-order-set-owner.ts` lets only the buyer ask.
    profile: {
      name: "order-set",
      own: new Set([...ORDER_PARTS, "orders"]),
      ownNodes: { customer: RECORD_CUSTOMER },
      ownSeller: BUYER_SELLER,
      projectSellers: BUYER_SELLER_FIELDS,
    },
  },
  {
    // The signed-in customer's own records (Medusa authenticates
    // `/store/customers/me`): their orders and order sets, addresses and
    // reviews are theirs to walk.
    prefix: "/store/customers",
    profile: {
      name: "customer",
      own: new Set([...ORDER_PARTS, "customer", "orders", "order_set", "addresses"]),
      ownSeller: BUYER_SELLER,
    },
  },
  // A customer's own reviews: the reviewer is the caller.
  { prefix: "/store/reviews", profile: { name: "review", own: new Set(["customer"]) } },
]

/**
 * A request path in the form the profiles are written in.
 *
 * Express matches a route without regard to case (Medusa never turns on
 * `case sensitive routing`) and on the path alone, so `/store/Seller/x`,
 * `/STORE/SELLER` and an absolute-form request line
 * (`GET http://host/store/seller`) all reach Mercur's seller handler. Compared
 * as raw strings they missed the seller profile and fell to the public one,
 * which leaves a root record's own columns alone: the tax id, email and
 * address answered (measured on Postgres). So the scheme and host go, the
 * query goes, and ASCII letters are folded to lower case, which is exactly
 * the folding Express's non-Unicode case-insensitive match does against these
 * ASCII prefixes.
 */
export function normaliseStorePath(path: string): string {
  return path
    .split(/[?#]/)[0]
    .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "")
    .replace(/[A-Z]/g, (letter) => letter.toLowerCase())
    .replace(/\/+$/, "")
}

/**
 * The profile for a request path (`/store/...`, with or without a query
 * string, in any case). The middleware hands it the path Express routed the
 * request by, not the raw request line.
 */
export function storeFieldProfile(path: string): StoreFieldProfile {
  const clean = normaliseStorePath(path)
  for (const { prefix, profile } of PROFILES) {
    if (clean === prefix || clean.startsWith(`${prefix}/`)) return profile
  }
  return PUBLIC_PROFILE
}

export type SanitizedStoreFields = {
  fields: string[]
  /** What was asked for and is not served, as asked. */
  dropped: string[]
  /** A product list is reached through a relation: filter it to what the listing serves. */
  nestedProducts: boolean
}

/**
 * Apply the policy to a field list in the form Medusa hands a route:
 * dot paths, with `relation.*` for "every column of this relation".
 */
export function sanitizeStoreFields(
  fields: readonly string[],
  profile: StoreFieldProfile = PUBLIC_PROFILE
): SanitizedStoreFields {
  const out = new Set<string>()
  const dropped: string[] = []
  /** Paths of product lists reached through a relation. */
  const productLists = new Set<string>()

  const guarded = (prefix: string[], node: GuardedNode, rest: string[], star: boolean): string[] => {
    if (rest.length === 0) {
      // `seller.*`: the columns on the list. A bare `seller` selects nothing
      // in Medusa either.
      return star ? node.fields.map((field) => [...prefix, field].join(".")) : []
    }
    const [segment, ...more] = rest
    if (more.length === 0 && !star && node.fields.includes(segment)) {
      return [[...prefix, segment].join(".")]
    }
    const relation = node.relations[segment]
    if (!relation) return []
    if (relation === "open") {
      if (segment === "products") productLists.add([...prefix, segment].join("."))
      return walk([...prefix, segment], more, star, false)
    }
    return guarded([...prefix, segment], relation, more, star)
  }

  const walk = (prefix: string[], rest: string[], star: boolean, own: boolean): string[] => {
    const path = [...prefix]
    let inOwn = own
    for (let i = 0; i < rest.length; i++) {
      const segment = rest[i]
      const after = rest.slice(i + 1)
      const ownNode = inOwn ? profile.ownNodes?.[segment] : undefined
      if (ownNode) return guarded([...path, segment], ownNode, after, star)
      if (inOwn && profile.own?.has(segment)) {
        path.push(segment)
        continue
      }
      if (SELLER_NAMES.has(segment)) {
        const node = inOwn && profile.ownSeller ? profile.ownSeller : PUBLIC_SELLER
        return guarded([...path, segment], node, after, star)
      }
      if (inOwn && after.length === 0 && !star && !DENIED_RELATIONS.has(segment) && !isLinkRow(segment)) {
        // A column of the caller's own record. A name refused at any depth is
        // not taken for one: bare, it is refused like the rest (Medusa
        // selects nothing for a bare relation today, measured, but that is
        // its business, not this rule's).
        path.push(segment)
        continue
      }
      inOwn = false
      if (REVIEW_NAMES.has(segment)) return guarded([...path, segment], REVIEW, after, star)
      if (DENIED_RELATIONS.has(segment) || isLinkRow(segment)) return []
      if (DENIED_AFTER[path[path.length - 1]]?.has(segment)) return []
      path.push(segment)
      if (segment === "products") productLists.add(path.join("."))
    }
    return [star ? `${path.join(".")}.*` : path.join(".")]
  }

  for (const field of fields) {
    const star = field.endsWith(".*")
    const segments = (star ? field.slice(0, -2) : field).split(".").filter(Boolean)
    let kept: string[]
    if (profile.root) {
      kept = guarded([], profile.root, segments, star)
    } else if (segments.length === 0) {
      // `*` alone: every column of the root record, which the route owns.
      kept = [field]
    } else {
      kept = walk([], segments, star, Boolean(profile.own))
    }
    if (kept.length !== 1 || kept[0] !== field) dropped.push(field)
    for (const keep of kept) out.add(keep)
  }

  // The rows of a nested product list are checked by id on the way out, so
  // the id is always selected, whatever columns were asked for.
  for (const list of productLists) {
    if ([...out].some((field) => field.startsWith(`${list}.`))) out.add(`${list}.id`)
  }

  return {
    fields: [...out],
    dropped: dropped.filter((field) => !out.has(field)),
    nestedProducts: productLists.size > 0,
  }
}

/**
 * What a list may be sorted by: the same rule as what it may return.
 *
 * Medusa turns `order=-members.email` into `{ members: { email: "DESC" } }`
 * and hands it to `query.graph` with the page (`req.queryConfig.pagination`,
 * `req.listConfig.order`), and in 2.14.2 nothing checks it against the
 * fields a route serves unless the route has an `allowed` list (Mercur's
 * seller routes do not). So `GET /store/seller?order=tax_id` sorted sellers
 * by the tax id the fields no longer returned, and by email, phone, address
 * and staff email the same way (measured on Postgres): a vendor who controls
 * one seller row can binary-search another seller's value by moving its own.
 *
 * A sort key is kept when the same path would be kept as a field under the
 * request's profile; the rest are dropped, as fields are. What is left keeps
 * Medusa's nested shape, and nothing left is no order at all.
 */
export function sanitizeStoreOrder(
  order: unknown,
  profile: StoreFieldProfile = PUBLIC_PROFILE
): Record<string, unknown> | undefined {
  if (!isPlainObject(order)) return undefined
  const kept: Record<string, unknown> = {}
  let any = false
  const visit = (node: Record<string, unknown>, prefix: string[]) => {
    for (const [key, value] of Object.entries(node)) {
      const at = [...prefix, key]
      if (isPlainObject(value)) {
        visit(value, at)
        continue
      }
      const path = at.join(".")
      if (!sanitizeStoreFields([path], profile).fields.includes(path)) continue
      let into = kept
      for (const segment of at.slice(0, -1)) {
        into[segment] = isPlainObject(into[segment]) ? into[segment] : {}
        into = into[segment] as Record<string, unknown>
      }
      into[at[at.length - 1]] = value
      any = true
    }
  }
  visit(order, [])
  return any ? kept : undefined
}

/**
 * The same, for the `select` / `relations` pair Medusa also derives from the
 * list (`req.listConfig`, `req.retrieveConfig`), where a relation means
 * "every column of it". No store route reads these today (Medusa's, Mercur's
 * and FBM's all read `req.queryConfig.fields`), so this is the strict
 * reading: a column stays if the policy allows it, and a relation stays only
 * if it is open as a whole or a kept column needs it.
 */
export function sanitizeStoreSelectRelations(
  config: { select?: string[]; relations?: string[] },
  profile: StoreFieldProfile = PUBLIC_PROFILE
): { select?: string[]; relations: string[] } {
  const select = config.select
    ? sanitizeStoreFields(config.select, profile).fields.filter((field) => !field.endsWith(".*"))
    : undefined
  const relations = (config.relations ?? []).filter((relation) => {
    const whole = sanitizeStoreFields([`${relation}.*`], profile).fields
    if (whole.length === 1 && whole[0] === `${relation}.*`) return true
    return (select ?? []).some((field) => field.startsWith(`${relation}.`))
  })
  return { select, relations }
}

/**
 * What the walkers below descend into: arrays and the rows of a response. A
 * value that serialises itself (a `Date`, Medusa's `BigNumber`) is a value.
 */
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  typeof (value as { toJSON?: unknown }).toJSON !== "function"

function pick(row: unknown, fields: readonly string[]): unknown {
  if (!isPlainObject(row)) return row
  const result: Record<string, unknown> = {}
  for (const field of fields) if (field in row) result[field] = row[field]
  return result
}

/**
 * Keep only `fields` of every object found under a `seller` key. For the one
 * store route whose field list is fixed in its handler and asks for
 * `orders.seller.*` (Mercur's order sets), where there is no request to
 * narrow. Returns a copy: the rows a handler passes to `res.json` may be
 * shared with a cache.
 */
export function projectSellersInBody<T>(body: T, fields: readonly string[] = BUYER_SELLER_FIELDS): T {
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit)
    if (!isPlainObject(value)) return value
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      if (SELLER_NAMES.has(key) && child && typeof child === "object") {
        out[key] = Array.isArray(child) ? child.map((row) => pick(row, fields)) : pick(child, fields)
      } else {
        out[key] = visit(child)
      }
    }
    return out
  }
  return visit(body) as T
}

/** The ids of every product row found in a `products` list below the top level of a response. */
export function nestedProductIds(body: unknown): string[] {
  const ids = new Set<string>()
  const visit = (value: unknown, top: boolean) => {
    if (Array.isArray(value)) return value.forEach((item) => visit(item, false))
    if (!isPlainObject(value)) return
    for (const [key, child] of Object.entries(value)) {
      if (key === "products" && Array.isArray(child) && !top) {
        for (const row of child) {
          const id = (row as { id?: unknown } | null)?.id
          if (typeof id === "string") ids.add(id)
        }
      }
      visit(child, false)
    }
  }
  visit(body, true)
  return [...ids]
}

/**
 * A copy of `body` in which every nested `products` list holds only the rows
 * in `visible`. A row with no id cannot be checked and is left out. The
 * top-level list of a product route is the route's own and is kept as it is.
 */
export function keepVisibleNestedProducts<T>(body: T, visible: ReadonlySet<string>): T {
  const isVisible = (row: unknown) => {
    const id = (row as { id?: unknown } | null)?.id
    return typeof id === "string" && visible.has(id)
  }
  const visit = (value: unknown, top: boolean): unknown => {
    if (Array.isArray(value)) return value.map((item) => visit(item, false))
    if (!isPlainObject(value)) return value
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      const list = key === "products" && Array.isArray(child) && !top ? child.filter(isVisible) : child
      out[key] = visit(list, false)
    }
    return out
  }
  return visit(body, true) as T
}
