import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ORDER_DISPUTE_MODULE } from "../modules/order-dispute"
import type OrderDisputeService from "../modules/order-dispute/service"
import {
  DisputeStateError,
  type DisputeRow,
} from "../modules/order-dispute/service"
import {
  DEFAULT_FILING_WINDOW_DAYS,
  type DisputeReason,
  sellerShareCents,
  sellersOnOrder,
} from "../modules/order-dispute/resolution"

/**
 * One intake path for a buyer's complaint about an order, shared by
 * `POST /store/orders/:id/dispute` and `POST /store/order-claims`.
 *
 * Both routes used to carry their own copy of "prove the order is yours,
 * work out which vendor, cap the claim at that vendor's goods, refuse a
 * duplicate". Two copies of a money-adjacent rule drift; the multi-vendor
 * ceiling bug fixed in dcc8aef existed in exactly one of them. This is the
 * single copy.
 *
 * Returns an HTTP-shaped result rather than throwing so each route keeps its
 * own published error contract. The claims route promised buyers specific
 * `type` codes (`claim_window_expired`, `duplicate_claim`) that its storefront
 * surfaces verbatim — those are preserved here for every caller, because a
 * buyer who is told "outside the window" needs to hear "your card issuer's
 * window is usually longer", whichever route they came in through.
 */

export type OrderForDispute = {
  id: string
  customer_id: string | null
  created_at: string | Date
  currency_code: string | null
  items: { seller_id: string | null; total: number }[]
}

export type IntakeFailure = {
  ok: false
  status: number
  body: Record<string, unknown>
}

export type IntakeSuccess = { ok: true; dispute: DisputeRow }

export type IntakeResult = IntakeSuccess | IntakeFailure

const fail = (status: number, body: Record<string, unknown>): IntakeFailure => ({
  ok: false,
  status,
  body,
})

/**
 * Load an order and prove the caller bought it.
 *
 * "No such order" and "not yours" return the same 404: distinguishing them
 * would confirm to a stranger that an order id exists.
 */
export async function loadOwnOrderForDispute(
  container: MedusaContainer,
  args: { orderId: string; customerId: string }
): Promise<OrderForDispute | IntakeFailure> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "customer_id",
      "created_at",
      "currency_code",
      "items.total",
      "items.product.seller_id",
    ],
    filters: { id: args.orderId },
  })

  const raw = data?.[0] as
    | {
        id: string
        customer_id: string | null
        created_at: string | Date
        currency_code: string | null
        items?: {
          total?: number | string | null
          product?: { seller_id?: string | null } | null
        }[]
      }
    | undefined

  if (!raw || raw.customer_id !== args.customerId) {
    return fail(404, { message: "Order not found", type: "not_found" })
  }

  return {
    id: raw.id,
    customer_id: raw.customer_id,
    created_at: raw.created_at,
    currency_code: raw.currency_code,
    items: (raw.items ?? []).map((i) => ({
      seller_id: i.product?.seller_id ?? null,
      total: Math.floor(Number(i.total) || 0),
    })),
  }
}

export function isIntakeFailure(
  value: OrderForDispute | IntakeFailure
): value is IntakeFailure {
  return (value as IntakeFailure).ok === false
}

/**
 * Which vendor is being complained about, and the most that can be claimed.
 *
 * On a single-vendor order the answer is obvious. On a multi-vendor order the
 * buyer must say — guessing (as the first version did, taking whichever
 * seller appeared first) names the wrong vendor half the time.
 */
export function resolveDisputeTarget(
  order: OrderForDispute,
  requestedSellerId?: string | null
): { sellerId: string; ceilingCents: number } | IntakeFailure {
  const sellers = sellersOnOrder(order.items)
  if (!sellers.length) {
    return fail(409, {
      message: "This order has no vendor to dispute against.",
      type: "no_vendor",
    })
  }

  const requested = (requestedSellerId ?? "").trim()
  let sellerId: string
  if (requested) {
    if (!sellers.includes(requested)) {
      // 404-shaped so the route cannot be used to probe for seller ids.
      return fail(404, {
        message: "That vendor has no items on this order.",
        type: "not_found",
      })
    }
    sellerId = requested
  } else if (sellers.length === 1) {
    sellerId = sellers[0]
  } else {
    return fail(400, {
      message:
        "This order has items from more than one vendor — name the one you are disputing.",
      type: "ambiguous_vendor",
      sellers,
    })
  }

  const ceilingCents = sellerShareCents(order.items, sellerId)
  if (ceilingCents <= 0) {
    return fail(409, {
      message: "That vendor's items on this order have no value to dispute.",
      type: "nothing_to_dispute",
    })
  }

  return { sellerId, ceilingCents }
}

export async function openDisputeForOrder(
  container: MedusaContainer,
  args: {
    customerId: string
    orderId: string
    sellerId?: string | null
    reason: DisputeReason
    description: string
    claimCents?: number | null
    metadata?: Record<string, unknown> | null
    windowDays?: number
  }
): Promise<IntakeResult> {
  const order = await loadOwnOrderForDispute(container, {
    orderId: args.orderId,
    customerId: args.customerId,
  })
  if (isIntakeFailure(order)) return order

  const target = resolveDisputeTarget(order, args.sellerId)
  if ("ok" in target) return target

  const service = container.resolve<OrderDisputeService>(ORDER_DISPUTE_MODULE)

  // Checked here as well as inside `open()` so the duplicate answer can carry
  // the existing claim's id — the storefront links the buyer to it rather than
  // leaving them to hunt for the ticket they already have.
  const existing = await service.liveForOrder(order.id, target.sellerId)
  if (existing) {
    return fail(409, {
      message:
        "You already have an open claim on this order. Reply on that claim rather than filing another.",
      type: "duplicate_claim",
      claim_id: existing.id,
    })
  }

  const windowDays = args.windowDays ?? DEFAULT_FILING_WINDOW_DAYS

  try {
    const dispute = await service.open({
      orderId: order.id,
      sellerId: target.sellerId,
      customerId: args.customerId,
      orderPlacedAt: order.created_at,
      orderTotalCents: target.ceilingCents,
      currencyCode: order.currency_code ?? "usd",
      reason: args.reason,
      description: args.description,
      claimCents: args.claimCents ?? null,
      filingWindowDays: windowDays,
    })

    if (args.metadata && Object.keys(args.metadata).length) {
      await service.updateOrderDisputes({
        id: dispute.id,
        metadata: args.metadata,
      })
    }

    return { ok: true, dispute }
  } catch (err) {
    if (err instanceof DisputeStateError) {
      if (/outside the .*window/.test(err.message)) {
        return fail(422, {
          message:
            `Claims can be filed within ${windowDays} days of an order. Your card ` +
            `issuer's dispute window is usually longer — contact them if this order ` +
            `is outside ours.`,
          type: "claim_window_expired",
        })
      }
      return fail(409, { message: err.message, type: "conflict" })
    }
    throw err
  }
}
