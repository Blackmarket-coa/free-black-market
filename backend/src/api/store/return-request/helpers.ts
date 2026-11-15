import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { z } from "zod"

/**
 * `/store/return-request`: the storefront's returns contract, served from
 * Medusa returns.
 *
 * The storefront (`storefront/src/lib/data/orders.ts`, `types/order-return.ts`)
 * was built against `@mercurjs/requests`, which owned this path and its
 * `order_return_request` shape. That plugin was removed from
 * `medusa-config.ts` because it crashed, and nothing replaced the path, so
 * both calls answered 404. The vendor panel had already moved to Mercur's
 * `/vendor/returns`, which lists Medusa returns linked to the seller; this
 * route makes the buyer's side write and read those same returns, keeping the
 * request and response shape the storefront already speaks.
 *
 * Why not point the storefront at `/store/returns` instead: on this install
 * (Medusa 2.14.2, b2c-core 1.5.0, probed on a real database 2026-11-15)
 * Mercur's `GET /store/returns` answers 500 to anonymous and signed-in
 * callers alike — it has no auth middleware, and its order query fails in
 * MikroORM — and core's `POST /store/returns` writes no seller–return link,
 * so a return made there never appears in `/vendor/returns`.
 *
 * `items.quantity` is deliberately absent from `ORDER_FIELDS`: on an order
 * query the order module rewrites it to `items.item.quantity`, a property the
 * line item does not have, and MikroORM fails the whole read (seen as a 500
 * here before it was removed). The returned quantity is the return item's.
 *
 * Not every Medusa return on an order is a buyer's request. An operator's
 * return begun and never confirmed sits in status `open` with no items, and
 * claims and exchanges carry returns of their own. The returns page renders
 * each row by its first line, so GET serves only `isBuyerVisibleReturn` rows.
 */

export const returnRequestBodySchema = z
  .object({
    order_id: z.string().min(1),
    // Accepted because the storefront sends it, and NOT stored: core's
    // createAndCompleteReturnOrderWorkflow does not forward a note to the
    // return it creates, and the storefront collects none (it sends "").
    customer_note: z.string().max(2000).nullish(),
    shipping_option_id: z.string().min(1),
    line_items: z
      .array(
        z.object({
          line_item_id: z.string().min(1),
          quantity: z.number().int().positive(),
          reason_id: z.string().min(1).nullish(),
        })
      )
      .min(1),
  })
  .refine(
    (body) =>
      new Set(body.line_items.map((i) => i.line_item_id)).size ===
      body.line_items.length,
    { message: "Each line item may appear once", path: ["line_items"] }
  )

export type ReturnRequestBody = z.infer<typeof returnRequestBodySchema>

/** A seller as the returns page renders it. */
export type ReturnRequestSeller = {
  id: string
  name: string | null
  handle: string | null
  photo: string | null
}

/** One request in the storefront's `order_return_request` shape. */
export type StoreReturnRequest = {
  id: string
  /** Medusa's return status: requested, partially_received, received, canceled. */
  status: string
  created_at: string | Date | null
  order: {
    id: string
    display_id: number | null
    currency_code: string | null
    items: OrderItemRow[]
    seller: ReturnRequestSeller | null
  }
  line_items: {
    line_item_id: string
    quantity: number
    reason_id: string | null
    created_at: string | Date | null
  }[]
}

type OrderItemRow = {
  id: string
  title?: string | null
  product_title?: string | null
  variant_title?: string | null
  thumbnail?: string | null
  unit_price?: number | string | null
}

export type ReturnRow = {
  id: string
  order_id: string
  status: string
  claim_id?: string | null
  exchange_id?: string | null
  created_at?: string | Date | null
  items?:
    | {
        item_id: string
        quantity: number | string
        reason_id?: string | null
        created_at?: string | Date | null
      }[]
    | null
}

export type OrderRow = {
  id: string
  display_id?: number | null
  currency_code?: string | null
  items?: OrderItemRow[] | null
  seller?: {
    id: string
    name?: string | null
    handle?: string | null
    photo?: string | null
  } | null
}

const RETURN_FIELDS = [
  "id",
  "order_id",
  "status",
  "claim_id",
  "exchange_id",
  "created_at",
  "items.item_id",
  "items.quantity",
  "items.reason_id",
  "items.created_at",
]

const ORDER_FIELDS = [
  "id",
  "display_id",
  "currency_code",
  "items.id",
  "items.title",
  "items.product_title",
  "items.variant_title",
  "items.thumbnail",
  "items.unit_price",
  "seller.id",
  "seller.name",
  "seller.handle",
  "seller.photo",
]

const toTime = (value: string | Date | null | undefined): number =>
  value ? new Date(value).getTime() : 0

/**
 * The return statuses a buyer's request moves through. `open` is missing on
 * purpose: it is a return still being drafted (an operator's, begun and not
 * confirmed), which has nothing to show and may never be sent.
 */
export const BUYER_VISIBLE_RETURN_STATUSES = [
  "requested",
  "partially_received",
  "received",
  "canceled",
] as const

/**
 * Whether a return belongs on the buyer's returns page: a request in one of
 * `BUYER_VISIBLE_RETURN_STATUSES`, with at least one item (the page dates
 * and lists a request by its lines), and not the return leg of a claim or an
 * exchange, which the buyer follows through that claim or exchange.
 */
export function isBuyerVisibleReturn(ret: ReturnRow): boolean {
  return (
    (BUYER_VISIBLE_RETURN_STATUSES as readonly string[]).includes(ret.status) &&
    !ret.claim_id &&
    !ret.exchange_id &&
    (ret.items?.length ?? 0) > 0
  )
}

/**
 * Join a return with its order into the storefront's shape. Pure: the
 * route's reads feed it, and its unit spec pins the mapping.
 */
export function toStoreReturnRequest(
  ret: ReturnRow,
  order: OrderRow
): StoreReturnRequest {
  return {
    id: ret.id,
    status: ret.status,
    created_at: ret.created_at ?? null,
    order: {
      id: order.id,
      display_id: order.display_id ?? null,
      currency_code: order.currency_code ?? null,
      items: order.items ?? [],
      seller: order.seller
        ? {
            id: order.seller.id,
            name: order.seller.name ?? null,
            handle: order.seller.handle ?? null,
            photo: order.seller.photo ?? null,
          }
        : null,
    },
    line_items: (ret.items ?? []).map((item) => ({
      line_item_id: item.item_id,
      quantity: Number(item.quantity),
      reason_id: item.reason_id ?? null,
      // The returns page sorts and dates requests by their first line's
      // created_at; a return item always has one, the fallback is defensive.
      created_at: item.created_at ?? ret.created_at ?? null,
    })),
  }
}

/**
 * The customer's return requests, newest first — or, with `returnId`, just
 * that one if it is on one of their orders.
 *
 * Ownership is the order's `customer_id`: returns are read only for order ids
 * the customer owns, so another buyer's return id yields nothing.
 */
export async function listCustomerReturnRequests(
  container: MedusaContainer,
  customerId: string,
  opts: { returnId?: string } = {}
): Promise<StoreReturnRequest[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: owned } = await query.graph({
    entity: "order",
    fields: ["id"],
    filters: { customer_id: customerId },
  })
  const orderIds = (owned as unknown as { id: string }[]).map((o) => o.id)
  if (!orderIds.length) return []

  const { data: returnRows } = await query.graph({
    entity: "return",
    fields: RETURN_FIELDS,
    filters: {
      ...(opts.returnId ? { id: opts.returnId } : {}),
      order_id: orderIds,
      status: [...BUYER_VISIBLE_RETURN_STATUSES],
    },
  })
  const returns = (returnRows as unknown as ReturnRow[]).filter(
    isBuyerVisibleReturn
  )
  if (!returns.length) return []

  const { data: orderRows } = await query.graph({
    entity: "order",
    fields: ORDER_FIELDS,
    filters: { id: [...new Set(returns.map((r) => r.order_id))] },
  })
  const orders = new Map(
    (orderRows as unknown as OrderRow[]).map((o) => [o.id, o])
  )

  return returns
    .filter((ret) => orders.has(ret.order_id))
    .map((ret) => toStoreReturnRequest(ret, orders.get(ret.order_id)!))
    .sort((a, b) => toTime(b.created_at) - toTime(a.created_at))
}

export type OrderForReturn = {
  id: string
  customer_id: string | null
  seller: { id: string; shipping_options?: { id: string }[] | null } | null
}

/** The order a request names, with what POST needs to authorize it. */
export async function loadOrderForReturn(
  container: MedusaContainer,
  orderId: string
): Promise<OrderForReturn | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "customer_id", "seller.id", "seller.shipping_options.id"],
    filters: { id: orderId },
  })
  return ((data as unknown as OrderForReturn[])[0] ?? null)
}

/**
 * Whether the option is a return option the order's seller offers — the
 * same set `/store/shipping-options/return` (Mercur) shows the buyer: the
 * seller's linked options, narrowed to those carrying the `is_return` rule
 * and not withheld from the store. That route lists through core's
 * `listShippingOptionsForCartWorkflow`, whose rule context carries
 * `enabled_in_store: "true"`, so an option whose `enabled_in_store` rule says
 * otherwise (an operator-only return method) is never offered to a buyer.
 */
export async function isSellersReturnOption(
  container: MedusaContainer,
  order: OrderForReturn,
  optionId: string
): Promise<boolean> {
  const offered = (order.seller?.shipping_options ?? []).map((o) => o.id)
  if (!offered.includes(optionId)) return false

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "shipping_option",
    fields: ["id", "rules.attribute", "rules.operator", "rules.value"],
    filters: { id: optionId },
  })
  const option = (
    data as unknown as {
      rules?: { attribute: string; operator: string; value: unknown }[] | null
    }[]
  )[0]
  const rules = option?.rules ?? []
  const isTrue = (rule: { operator: string; value: unknown }) =>
    rule.operator === "eq" && String(rule.value) === "true"
  return (
    rules.some((rule) => rule.attribute === "is_return" && isTrue(rule)) &&
    rules
      .filter((rule) => rule.attribute === "enabled_in_store")
      .every(isTrue)
  )
}
