import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
  MedusaStoreRequest,
  MiddlewareRoute,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys, ProductStatus } from "@medusajs/framework/utils"
import {
  keepVisibleNestedProducts,
  nestedProductIds,
  projectSellersInBody,
  sanitizeStoreFields,
  sanitizeStoreSelectRelations,
  storeFieldProfile,
} from "../../shared/store-field-policy"

/**
 * Applies `shared/store-field-policy.ts` to every `/store` request (SD-118).
 *
 * Where: on the field list a route ends up with, not on the query string.
 * `validateAndTransformQuery` merges the caller's `fields` with the route's
 * defaults and writes the result to `req.queryConfig` (and three aliases of
 * it); every store route of Medusa's and Mercur's passes that list to
 * `query.graph`. So this middleware does not parse anything. It runs first on
 * `/store`, and makes those four request properties sanitise whatever is
 * later assigned to them. That covers:
 *
 * - every spelling (`*seller`, `seller.*`, `+seller.email`, `seller.email`),
 *   because Medusa has already reduced them to one list;
 * - the route's own defaults (Mercur's seller routes select the tax id and
 *   the address by default);
 * - routes that do not exist yet: a store route added tomorrow with
 *   `validateAndTransformQuery` is covered without being listed here, which a
 *   middleware registered per matcher would not be. Medusa sorts middleware
 *   by matcher (`framework/dist/http/routes-sorter.js`), so one registered
 *   on `/store/*` could not run after a route's own validator either.
 *
 * It does not cover a handler that writes its own field list. Mercur's order
 * set routes do (`orders.seller.*`), so their responses have the seller
 * objects cut to the buyer's allow-list on the way out. FBM's own store
 * routes build their projections by hand and are not touched.
 *
 * A product list reached through a relation (`seller.products`,
 * `collection.products`, the product tag and type routes' default
 * `*products`) is filtered on the way out to the rows `GET /store/products`
 * serves: published, and in the publishable key's sales channel.
 *
 * Mounted on `/store` only; `/vendor` and `/admin` have their own callers and
 * are not matched (the Postgres spec reads a seller's email back through
 * both).
 */

const GUARDED_CONFIGS = ["queryConfig", "remoteQueryConfig", "listConfig", "retrieveConfig"] as const

type FieldConfig = { fields?: unknown; select?: unknown; relations?: unknown }

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string")

export function guardStoreFields(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) {
  const profile = storeFieldProfile(req.originalUrl ?? req.url)
  let nestedProducts = false

  const sanitise = (config: unknown): unknown => {
    if (!config || typeof config !== "object") return config
    const target = config as FieldConfig
    if (isStringArray(target.fields)) {
      const result = sanitizeStoreFields(target.fields, profile)
      nestedProducts ||= result.nestedProducts
      target.fields = result.fields
    }
    if (isStringArray(target.select) || isStringArray(target.relations)) {
      const result = sanitizeStoreSelectRelations(
        {
          select: isStringArray(target.select) ? target.select : undefined,
          relations: isStringArray(target.relations) ? target.relations : undefined,
        },
        profile
      )
      if (isStringArray(target.select)) target.select = result.select
      target.relations = result.relations
    }
    return config
  }

  const holder = req as unknown as Record<string, unknown>
  for (const key of GUARDED_CONFIGS) {
    let current = sanitise(holder[key])
    Object.defineProperty(req, key, {
      configurable: true,
      enumerable: true,
      get: () => current,
      set: (value: unknown) => {
        current = sanitise(value)
      },
    })
  }

  const json = res.json.bind(res)
  res.json = ((body: unknown) => {
    const cut = profile.projectSellers ? projectSellersInBody(body, profile.projectSellers) : body
    if (!nestedProducts) return json(cut)
    const ids = nestedProductIds(cut)
    if (ids.length === 0) return json(cut)
    visibleProductIds(req, ids).then(
      (visible) => json(keepVisibleNestedProducts(cut, visible)),
      (error) => next(error)
    )
    return res
  }) as typeof res.json

  next()
}

/**
 * Of `ids`, the products `GET /store/products` would list for this request:
 * published, and in one of the publishable key's sales channels. As Medusa's
 * own route does, the channel is not checked when the store has only one.
 */
export async function visibleProductIds(req: MedusaRequest, ids: string[]): Promise<Set<string>> {
  const channels = (req as MedusaStoreRequest).publishable_key_context?.sales_channel_ids ?? []
  if (ids.length === 0 || channels.length === 0) return new Set()
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { metadata } = await query.graph({
    entity: "sales_channels",
    fields: ["id"],
    pagination: { skip: 0, take: 1 },
  })
  let candidates = ids
  if ((metadata?.count ?? 0) > 1) {
    const { data: links } = await query.graph({
      entity: "product_sales_channel",
      fields: ["product_id"],
      filters: { product_id: ids, sales_channel_id: channels },
    })
    candidates = [...new Set(links.map((link) => link.product_id))]
    if (candidates.length === 0) return new Set()
  }

  const { data: published } = await query.graph({
    entity: "product",
    fields: ["id"],
    filters: { id: candidates, status: ProductStatus.PUBLISHED },
  })
  return new Set(published.map((product) => product.id))
}

/**
 * No `method`: it must run for every verb (a `POST` to a cart returns the
 * cart with the caller's `fields`), and Medusa runs method-less middleware
 * before any route's own.
 */
export const storePublicFieldsMiddlewares: MiddlewareRoute[] = [
  { matcher: "/store", middlewares: [guardStoreFields] },
]
