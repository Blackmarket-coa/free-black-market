import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { HAWALA_LEDGER_MODULE } from "../modules/hawala-ledger"
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
  toMinorUnits,
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
  /** `total` is in the currency's minor unit, like every `order_dispute` figure. */
  items: { seller_id: string | null; total: number }[]
}

/**
 * The order as the intake reads it, before any ownership check, with line
 * totals still in Medusa's MAJOR units. `fix-order-dispute-minor-units.ts`
 * needs the major figures to work out what the old intake stored.
 */
export type OrderReadForDispute = {
  id: string
  customer_id: string | null
  created_at: string | Date
  currency_code: string | null
  lines: { seller_id: string | null; total_major: unknown }[]
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
 * What the intake asks `query.graph` for. Each of these was checked against a
 * real migrated database, because the first version asked for two things
 * that do not exist and every claim failed before it was stored:
 *
 * - `total` (top level) is what makes the order module compute totals at
 *   all: `shouldIncludeTotals` looks only at top-level field names. Asking
 *   for `items.total` without it sends `total` to MikroORM as a column, and
 *   the read throws "Entity 'OrderLineItem' does not have property 'total'".
 *   With it, every item comes back with its computed `total`.
 * - `items.product.seller.id`: Mercur links sellers to products through a
 *   link table. There is no `product.seller_id` column; asking for one is
 *   silently dropped, so no line had a seller and every claim was refused
 *   as "no vendor".
 * - `seller.id`: Mercur splits a cart into one order per seller and links
 *   each order to its seller. Used for a line whose product link is gone
 *   (a deleted product, a custom line), which still belongs to the seller
 *   whose order it is.
 */
export const ORDER_FIELDS_FOR_DISPUTE = [
  "id",
  "customer_id",
  "created_at",
  "currency_code",
  "total",
  "items.*",
  "items.product.seller.id",
  "seller.id",
]

type RawOrder = {
  id: string
  customer_id: string | null
  created_at: string | Date
  currency_code: string | null
  seller?: { id?: string | null } | null
  items?: {
    total?: unknown
    product?: { seller?: { id?: string | null } | null } | null
  }[]
}

/** Read an order's lines and who sold each one. No ownership check. */
export async function readOrderForDispute(
  container: MedusaContainer,
  orderId: string
): Promise<OrderReadForDispute | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: ORDER_FIELDS_FOR_DISPUTE,
    filters: { id: orderId },
  })

  const raw = data?.[0] as RawOrder | undefined
  if (!raw) return null

  const orderSeller = raw.seller?.id || null
  return {
    id: raw.id,
    customer_id: raw.customer_id,
    created_at: raw.created_at,
    currency_code: raw.currency_code,
    lines: (raw.items ?? []).map((i) => ({
      seller_id: i.product?.seller?.id || orderSeller,
      total_major: i.total,
    })),
  }
}

/**
 * Load an order and prove the caller bought it.
 *
 * "No such order" and "not yours" return the same 404: distinguishing them
 * would confirm to a stranger that an order id exists.
 *
 * Line totals come back in minor units (`toMinorUnits`): Medusa's are major,
 * and the ceiling worked out from these is stored as `claim_amount`.
 */
export async function loadOwnOrderForDispute(
  container: MedusaContainer,
  args: { orderId: string; customerId: string }
): Promise<OrderForDispute | IntakeFailure> {
  const order = await readOrderForDispute(container, args.orderId)

  if (!order || order.customer_id !== args.customerId) {
    return fail(404, { message: "Order not found", type: "not_found" })
  }

  return {
    id: order.id,
    customer_id: order.customer_id,
    created_at: order.created_at,
    currency_code: order.currency_code,
    items: order.lines.map((l) => ({
      seller_id: l.seller_id,
      total: toMinorUnits(l.total_major, order.currency_code),
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

/**
 * The hawala escrow agreement holding this order's funds, if one exists.
 *
 * `order_dispute.escrow_agreement_id` was nullable-and-always-null: the
 * service accepted it, and no caller ever supplied it, so the admin route's
 * headline feature — naming the escrow transition a decision implies — was
 * unreachable even for the escrowed orders it was designed for. This is the
 * writer.
 *
 * Ordinary orders settle through Stripe and have no agreement; that is the
 * common case and returns null. Resolution failure also returns null rather
 * than blocking the complaint — a buyer's right to raise a dispute must not
 * depend on the ledger module being reachable.
 */
async function findOrderEscrowId(
  container: MedusaContainer,
  orderId: string
): Promise<string | null> {
  try {
    const hawala = container.resolve(HAWALA_LEDGER_MODULE) as {
      listEscrowAgreements?: (
        filters: Record<string, unknown>
      ) => Promise<{ id: string; state?: string }[]>
    }
    if (typeof hawala?.listEscrowAgreements !== "function") return null
    const rows = await hawala.listEscrowAgreements({
      subject_type: "order",
      subject_id: orderId,
    })
    // Prefer a live agreement; a released or recovered one holds nothing to
    // move, and naming it would imply a transition that cannot happen.
    const live = rows.find((r) => r.state === "funded" || r.state === "disputed")
    return (live ?? rows[0])?.id ?? null
  } catch {
    return null
  }
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
      escrowAgreementId: await findOrderEscrowId(container, order.id),
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
