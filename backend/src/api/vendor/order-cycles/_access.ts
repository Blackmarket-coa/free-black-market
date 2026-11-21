import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { z } from "zod"
import { ORDER_CYCLE_MODULE } from "../../../modules/order-cycle"
import type OrderCycleModuleService from "../../../modules/order-cycle/service"
import { definedFields } from "../../../shared/defined-fields"
import { productSellerIds } from "../../../shared/product-sellers"
import { recordId } from "../../../shared/route-input"
import { getSellerId } from "../quests/_helpers"

type OrderCycleRecord = Awaited<
  ReturnType<OrderCycleModuleService["retrieveOrderCycle"]>
>
type OrderCycleSellerRecord = Awaited<
  ReturnType<OrderCycleModuleService["listOrderCycleSellers"]>
>[number]
type OrderCycleExchangeRecord = Awaited<
  ReturnType<OrderCycleModuleService["retrieveOrderCycleExchange"]>
>

export type CycleAccess = {
  sellerId: string
  orderCycle: OrderCycleRecord
  isCoordinator: boolean
}

/**
 * Resolve the authenticated seller and verify they may act on the given order
 * cycle. On denial this sends the appropriate 401/403/404 response and returns
 * `null`, so callers use the pattern:
 *
 *   const access = await resolveCycleAccess(req, res, id, { requireCoordinator })
 *   if (!access) return
 *
 * This centralizes the object-level authorization the child routes (exchanges,
 * fees) previously lacked — they had only the generic `/vendor/**` seller
 * authentication and would read/write/delete another vendor's cycle records.
 * Mirrors the gate already inlined in `order-cycles/[id]/route.ts`.
 *
 * - `requireCoordinator: true`  → only the cycle's `coordinator_seller_id`
 *   passes (create/update/delete of cycle children).
 * - `requireCoordinator: false` → coordinator OR an active participant passes
 *   (reads).
 */
export async function resolveCycleAccess(
  req: MedusaRequest,
  res: MedusaResponse,
  cycleId: string,
  opts: { requireCoordinator: boolean }
): Promise<CycleAccess | null> {
  const sellerId = await getSellerId(req)
  if (!sellerId) {
    res.status(401).json({ message: "Unauthorized" })
    return null
  }

  const orderCycleService = req.scope.resolve<OrderCycleModuleService>(
    ORDER_CYCLE_MODULE
  )

  let orderCycle: OrderCycleRecord
  try {
    orderCycle = await orderCycleService.retrieveOrderCycle(cycleId)
  } catch (_error) {
    res.status(404).json({ message: "Order cycle not found" })
    return null
  }

  const isCoordinator = orderCycle.coordinator_seller_id === sellerId

  if (opts.requireCoordinator) {
    if (!isCoordinator) {
      res.status(403).json({
        message: "Only the coordinator can modify this order cycle",
      })
      return null
    }
  } else {
    const sellers = await orderCycleService.listOrderCycleSellers({
      order_cycle_id: cycleId,
    })
    const isParticipant = (sellers ?? []).some(
      (s: OrderCycleSellerRecord) => s.seller_id === sellerId && s.is_active
    )
    if (!isCoordinator && !isParticipant) {
      res.status(403).json({ message: "Access denied" })
      return null
    }
  }

  return { sellerId, orderCycle, isCoordinator }
}

/**
 * Resolve access to one exchange inside a cycle.
 *
 * Three checks, and a child route needs all three: the caller may act on the
 * cycle at all; the exchange named in the path really belongs to that cycle
 * (otherwise a mismatched `:id`/`:exchangeId` pair acts on another cycle's
 * exchange); and, for writes, the caller is the cycle's coordinator or the
 * exchange's own seller.
 *
 * This lived as a private helper in `exchanges/[exchangeId]/route.ts` while
 * its own child route `exchanges/[exchangeId]/products` had no gate at all —
 * so any authenticated seller could read another coordinator's exchange
 * products and insert rows into their cycle. It is shared from here now so a
 * new child route cannot be added without a gate in reach.
 */
export async function resolveExchangeAccess(
  req: MedusaRequest,
  res: MedusaResponse,
  requireCoordinator: boolean
): Promise<{ access: CycleAccess; exchange: OrderCycleExchangeRecord } | null> {
  const { id, exchangeId } = req.params

  const access = await resolveCycleAccess(req, res, id, {
    requireCoordinator: false,
  })
  if (!access) return null

  const orderCycleService = req.scope.resolve<OrderCycleModuleService>(
    ORDER_CYCLE_MODULE
  )

  let exchange: OrderCycleExchangeRecord
  try {
    exchange = await orderCycleService.retrieveOrderCycleExchange(exchangeId)
  } catch (_error) {
    res.status(404).json({ message: "Exchange not found" })
    return null
  }

  // The exchange must belong to the cycle named in the path.
  if (exchange.order_cycle_id !== id) {
    res.status(404).json({ message: "Exchange not found" })
    return null
  }

  const isOwner = exchange.seller_id === access.sellerId
  if (requireCoordinator && !access.isCoordinator && !isOwner) {
    // Writes: coordinator or the exchange's own seller.
    res.status(403).json({ message: "Access denied" })
    return null
  }
  // Reads are already satisfied by the cycle participant/coordinator check.

  return { access, exchange }
}

/**
 * Cycle product rows: which store may write which (SD-158).
 *
 * An `order_cycle_product` row lists one variant in one cycle for the store in
 * its `seller_id`, and (cycle, variant) is unique. Both writers, POST
 * `/:id/products` and POST `/:id/exchanges/:exchangeId/products`, took any
 * variant id and, finding the cycle's row for it, updated that row whoever it
 * belonged to. Measured on Postgres, with SD-63's missing column added as a
 * fixture: participant B set coordinator A's row for A's variant to price
 * 0.01, quantity 0 and hidden, and listed another of A's variants under
 * itself.
 *
 * A store writes only its own rows, with its own variants: every variant must
 * be of a product the store owns (`seller_product`), and the row written is
 * the one matched by cycle, variant and store. That holds for the cycle's
 * coordinator too. Nothing in the code or the docs gives a coordinator a
 * participant's price, quantity or visibility to set: the panel's add dialog
 * offers only the store's own products (`useProducts`), the service stamps the
 * caller as the row's seller, and the one coordinator power over another
 * store's row that is written down is removal (the `products/[productId]`
 * DELETE and `docs/CDFI_COOP_ROADMAP.md`), which stays.
 */

/** The columns a store sets on its row; never `seller_id`, `sold_quantity` or the ids. */
const cycleProductFields = {
  available_quantity: z.number().int().min(0).nullable().optional(),
  override_price: z.number().min(0).nullable().optional(),
}

/** POST /vendor/order-cycles/:id/products */
export const addCycleProductBody = z.object({
  variant_id: recordId,
  ...cycleProductFields,
  is_visible: z.boolean().optional(),
  display_order: z.number().int().optional(),
})

/** POST /vendor/order-cycles/:id/exchanges/:exchangeId/products */
export const addExchangeProductsBody = z.object({
  products: z
    .array(z.object({ variant_id: recordId, ...cycleProductFields }))
    .min(1)
    .max(100),
})

type QueryGraph = {
  graph: (args: Record<string, unknown>) => Promise<{ data: Array<Record<string, unknown>> }>
}

/** Whether every variant exists and is of a product the store owns. */
export async function storeOwnsVariants(
  req: MedusaRequest,
  sellerId: string,
  variantIds: string[]
): Promise<boolean> {
  const ids = [...new Set(variantIds)]
  if (!ids.length) return false
  const query = req.scope.resolve<QueryGraph>(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product_variant",
    fields: ["id", "product_id"],
    filters: { id: ids },
  })
  const productOf = new Map<string, string>()
  for (const variant of data ?? []) {
    if (typeof variant.id === "string" && typeof variant.product_id === "string") {
      productOf.set(variant.id, variant.product_id)
    }
  }
  if (ids.some((id) => !productOf.has(id))) return false
  const owners = await productSellerIds(req.scope, [...productOf.values()])
  return ids.every((id) => owners.get(productOf.get(id) as string) === sellerId)
}

type CycleProductRow = { id: string; seller_id: string }

export type CycleProductWrite = {
  exchange_id?: string
  available_quantity?: number | null
  override_price?: number | null
  is_visible?: boolean
  display_order?: number
}

/**
 * Whether another store holds the cycle's row for any of these variants.
 *
 * The store's variant listed in its cycle under another store can only be a
 * row written before SD-158 (or of a product that changed hands). It is
 * refused with 409 rather than taken over, as a nursery attribute row is: the
 * row carries the cycle's sales of the variant (`sold_quantity`, and the
 * `order_cycle_sale` rows that name it), which a takeover would hand to the
 * new owner or reset. Where SD-63's column is missing, no row can have been
 * written through these routes at all.
 */
export async function cycleRowsHeldByOthers(
  service: OrderCycleModuleService,
  cycleId: string,
  sellerId: string,
  variantIds: string[]
): Promise<boolean> {
  const rows = (await service.listOrderCycleProducts({
    order_cycle_id: cycleId,
    variant_id: [...new Set(variantIds)],
  })) as CycleProductRow[]
  return rows.some((row) => row.seller_id !== sellerId)
}

/**
 * Write the store's own row for a variant in a cycle: the row matched by
 * cycle, variant and store is updated with the fields sent, or created. The
 * caller has checked that the variant is the store's (`storeOwnsVariants`)
 * and that no other store holds the cycle's row for it
 * (`cycleRowsHeldByOthers`); a create racing another store's still fails on
 * the unique index and nothing is overwritten.
 */
export async function saveOwnCycleProduct(
  service: OrderCycleModuleService,
  cycleId: string,
  variantId: string,
  sellerId: string,
  fields: CycleProductWrite
): Promise<unknown> {
  const given = definedFields(fields)
  const [own] = (await service.listOrderCycleProducts(
    { order_cycle_id: cycleId, variant_id: variantId, seller_id: sellerId },
    { take: 1 }
  )) as CycleProductRow[]
  if (own) {
    return service.updateOrderCycleProducts({ ...given, id: own.id })
  }
  return service.createOrderCycleProducts({
    ...given,
    order_cycle_id: cycleId,
    variant_id: variantId,
    seller_id: sellerId,
  })
}
