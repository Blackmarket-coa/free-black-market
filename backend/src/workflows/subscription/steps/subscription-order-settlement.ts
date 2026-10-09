import { createLogger } from "../../../shared/logger"
const log = createLogger("workflows/subscription/subscription-order-settlement")
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { isFbmCardProvider } from "../../../modules/hawala-ledger/card-clearing"
import { consumerSubscriptionsEnabled } from "../grace-lifecycle"
import {
  buildRenewalRecord,
  RENEWAL_RECORD_METADATA_KEY,
  RENEWAL_RECORD_PROVIDER_ID,
  renewalRecordClaim,
} from "../renew-helpers"

/**
 * F5 / SD-46 (`FF_CONSUMER_SUBSCRIPTIONS_V1`): a subscription order reaches
 * its seller and the ledger like any other sale.
 *
 * A subscription is checked out through Medusa's `completeCartWorkflow`, not
 * Mercur's split, because Mercur's split refuses a cart without a shipping
 * method per seller and a vault seat ships nothing. Medusa's flow makes the
 * order and stops there, which left three gaps that only Mercur's split filled:
 *
 *   1. No seller link. The ledger settles an order onto its Mercur `seller`
 *      link (`lib/card-order-settlement.ts`) and refuses an order without
 *      one, so a subscription sale never credited its seller and its 3% was
 *      never taken; the seller's own order list never showed it.
 *   2. No capture. FBM's Stripe provider authorizes only (`capture` is unset
 *      in medusa-config, so `capture_method` is manual) and Mercur captures
 *      its own carts on `order_set.placed`. Nothing captured a subscription's
 *      first order: the card was authorized, the seat delivered, and the
 *      authorization left to lapse.
 *   3. A renewal's money (an off-session PaymentIntent FBM already
 *      collected) is recorded on a system-provider payment that nothing
 *      marked captured and that kept no trace of the intent (authorization
 *      replaces the session's data with the system provider's `{}`), so the
 *      ledger read it as "not a card order" and Stripe's refunds of it could
 *      not be found.
 *
 * Flag off, every step here returns before any read and the workflows behave
 * as before.
 */

type QueryLike = { graph: (q: Record<string, unknown>) => Promise<{ data: unknown[] }> }

/**
 * The one seller every listed product belongs to (Mercur's product `seller`
 * link), or why there is not exactly one.
 */
async function soleSellerOf(
  query: QueryLike,
  productIds: Array<string | null | undefined>
): Promise<{ seller_id: string } | { seller_id: null; reason: string }> {
  if (productIds.length === 0) return { seller_id: null, reason: "it has no items" }
  if (productIds.some((id) => !id)) return { seller_id: null, reason: "an item is not a catalogue product" }
  const ids = [...new Set(productIds as string[])]
  const { data } = await query.graph({
    entity: "product",
    fields: ["id", "seller.id"],
    filters: { id: ids },
  })
  const rows = data as Array<{ id: string; seller?: { id?: string } | null }>
  const sellerOf = new Map(rows.map((r) => [r.id, r.seller?.id ?? null]))
  if (ids.some((id) => !sellerOf.get(id))) return { seller_id: null, reason: "a product has no seller" }
  const sellers = new Set(ids.map((id) => sellerOf.get(id) as string))
  if (sellers.size !== 1) return { seller_id: null, reason: `its products belong to ${sellers.size} sellers` }
  return { seller_id: [...sellers][0] }
}

/**
 * Before any payment is authorized: the subscription cart's one seller.
 * Refuses (flag on) a cart whose products do not all belong to one seller,
 * so nothing is charged for a sale no seller can be credited with.
 */
export const resolveSubscriptionSellerStep = createStep(
  "resolve-subscription-seller",
  async (input: { cart_id: string }, { container }) => {
    if (!consumerSubscriptionsEnabled()) return new StepResponse({ seller_id: null as string | null })
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as QueryLike
    const { data } = await query.graph({
      entity: "cart",
      fields: ["id", "items.product_id"],
      filters: { id: input.cart_id },
    })
    const cart = (data as Array<{ items?: Array<{ product_id?: string | null } | null> | null }>)[0]
    const sole = await soleSellerOf(query, (cart?.items ?? []).map((i) => i?.product_id))
    if (!sole.seller_id) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `A subscription is sold by one seller, and this cart cannot be: ${"reason" in sole ? sole.reason : ""}.`
      )
    }
    return new StepResponse({ seller_id: sole.seller_id as string | null })
  }
)

type LinkInput = {
  order_id: string
  /**
   * `initial`: the seller resolved before payment; anything else is refused,
   * and the checkout rolls back. `renewal`: the cycle's money is already
   * collected, so a seller that cannot be determined is logged, not thrown —
   * the order then stays unsettled, which the ledger reports.
   */
  mode: "initial" | "renewal"
  expected_seller_id?: string | null
}

type LinkOutput = { linked: boolean; seller_id: string | null }
/** The link this step created, for its compensation to dismiss; null when it created none. */
type LinkDef = Record<string, Record<string, string>> | null

const linkResult = (output: LinkOutput, created: LinkDef = null) => new StepResponse<LinkOutput, LinkDef>(output, created)

/** Link the subscription order to its seller, as Mercur's split does for its own orders. */
export const linkSubscriptionOrderSellerStep = createStep(
  "link-subscription-order-seller",
  async (input: LinkInput, { container }) => {
    if (!consumerSubscriptionsEnabled()) return linkResult({ linked: false, seller_id: null })
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as QueryLike
    const { data } = await query.graph({
      entity: "order",
      fields: ["id", "seller.id", "items.product_id"],
      filters: { id: input.order_id },
    })
    const order = (data as Array<{
      seller?: { id?: string } | null
      items?: Array<{ product_id?: string | null } | null> | null
    }>)[0]
    const refuse = (message: string) => {
      if (input.mode === "initial") throw new MedusaError(MedusaError.Types.NOT_ALLOWED, message)
      log.error(`[subscription] ${message}`)
      return linkResult({ linked: false, seller_id: null })
    }
    if (!order) return refuse(`Subscription order ${input.order_id} not found; no seller linked`)

    const sole = await soleSellerOf(query, (order.items ?? []).map((i) => i?.product_id))
    if (!sole.seller_id) {
      return refuse(`Subscription order ${input.order_id} has no single seller (${"reason" in sole ? sole.reason : ""}); not linked, so the ledger will not settle it`)
    }
    if (input.mode === "initial" && input.expected_seller_id && sole.seller_id !== input.expected_seller_id) {
      return refuse(`Subscription order ${input.order_id} is sold by ${sole.seller_id}, not ${input.expected_seller_id} as checked before payment`)
    }
    const current = order.seller?.id ?? null
    if (current === sole.seller_id) return linkResult({ linked: false, seller_id: current })
    if (current) {
      return refuse(`Subscription order ${input.order_id} is linked to seller ${current}, but its products are sold by ${sole.seller_id}`)
    }

    const link = container.resolve(ContainerRegistrationKeys.LINK) as {
      create: (d: unknown) => Promise<unknown>
      dismiss: (d: unknown) => Promise<unknown>
    }
    const def = { [SELLER_MODULE]: { seller_id: sole.seller_id }, [Modules.ORDER]: { order_id: input.order_id } }
    await link.create(def)
    return linkResult({ linked: true, seller_id: sole.seller_id }, def)
  },
  async (def, { container }) => {
    if (!def) return
    const link = container.resolve(ContainerRegistrationKeys.LINK) as { dismiss: (d: unknown) => Promise<unknown> }
    await link.dismiss(def)
  }
)

type StampInput = {
  order_id: string
  subscription_id: string
  payment_intent_id: string | null
  idempotency_key: string
}

/**
 * Renewal only: stamp the order's bookkeeping payment with the PaymentIntent
 * that collected the cycle, in the payment's `metadata` — the one place no
 * provider call rewrites and no store route can write. The ledger reads it
 * to treat the order as card money and Stripe's refund and dispute events on
 * that intent to find it (`lib/card-order-settlement.ts`,
 * `lib/card-stripe-sync.ts`). Nothing to stamp when no intent was needed.
 */
export const stampRenewalRecordStep = createStep(
  "stamp-renewal-record",
  async (input: StampInput, { container }) => {
    type Prior = { id: string; metadata: Record<string, unknown> | null } | null
    const done = (prior: Prior = null) => new StepResponse<{ payment_id: string | null }, Prior>({ payment_id: prior?.id ?? null }, prior)
    if (!consumerSubscriptionsEnabled() || !input.payment_intent_id) return done()
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as QueryLike
    const { data } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "payment_collections.payments.id",
        "payment_collections.payments.provider_id",
        "payment_collections.payments.metadata",
      ],
      filters: { id: input.order_id },
    })
    const order = (data as Array<{
      payment_collections?: Array<{ payments?: Array<{ id: string; provider_id?: string | null; metadata?: Record<string, unknown> | null } | null> | null } | null> | null
    }>)[0]
    const records = (order?.payment_collections ?? [])
      .flatMap((c) => c?.payments ?? [])
      .filter((p): p is { id: string; provider_id?: string | null; metadata?: Record<string, unknown> | null } => !!p && p.provider_id === RENEWAL_RECORD_PROVIDER_ID)
    if (records.length !== 1) {
      log.error(`[subscription] Renewal order ${input.order_id} has ${records.length} bookkeeping payments; the charge is not recorded on any`)
      return done()
    }
    const payment = records[0]
    const payments = container.resolve(Modules.PAYMENT) as { updatePayment: (d: Record<string, unknown>) => Promise<unknown> }
    await payments.updatePayment({
      id: payment.id,
      metadata: {
        ...(payment.metadata ?? {}),
        [RENEWAL_RECORD_METADATA_KEY]: buildRenewalRecord({
          subscription_id: input.subscription_id,
          payment_intent_id: input.payment_intent_id,
          idempotency_key: input.idempotency_key,
        }),
      },
    })
    return done({ id: payment.id, metadata: payment.metadata ?? null })
  },
  async (prior, { container }) => {
    if (!prior) return
    const payments = container.resolve(Modules.PAYMENT) as { updatePayment: (d: Record<string, unknown>) => Promise<unknown> }
    await payments.updatePayment({ id: prior.id, metadata: prior.metadata })
  }
)

type CaptureInput = {
  order_id: string
  mode: "initial" | "renewal"
  /** `renewal`: the cycle's charge status from `chargeSubscriptionRenewalStep`. */
  renewal_charge_status?: string | null
}

type PaymentRow = {
  id: string
  provider_id?: string | null
  captured_at?: Date | string | null
  metadata?: Record<string, unknown> | null
}

/**
 * Which of the order's payments to capture, if any:
 *
 *   - `initial`: the authorized, uncaptured payment on FBM's own Stripe
 *     provider — captured now, as Mercur captures its carts at placement. A
 *     partner's Connect direct charge captures itself and a manual/system
 *     payment is not FBM card money, so neither is touched.
 *   - `renewal`: the bookkeeping payment stamped with the PaymentIntent FBM
 *     already collected (`stampRenewalRecordStep`), once that charge has
 *     `succeeded`. Capturing it moves
 *     no money (the system provider touches no rail); it records on the order
 *     what Stripe already took, so the ledger settles it. A bank debit still
 *     `processing` is left uncaptured — the money has not arrived.
 */
export const subscriptionPaymentToCaptureStep = createStep(
  "subscription-payment-to-capture",
  async (input: CaptureInput, { container }) => {
    const none = () => new StepResponse({ payment_id: null as string | null })
    if (!consumerSubscriptionsEnabled()) return none()
    if (input.mode === "renewal" && input.renewal_charge_status !== "succeeded") {
      if (input.renewal_charge_status === "processing") {
        log.warn(`[subscription] Renewal order ${input.order_id}: its charge is still processing; not recorded as captured`)
      }
      return none()
    }
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as QueryLike
    const { data } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "payment_collections.payments.id",
        "payment_collections.payments.provider_id",
        "payment_collections.payments.captured_at",
        "payment_collections.payments.metadata",
      ],
      filters: { id: input.order_id },
    })
    const order = (data as Array<{ payment_collections?: Array<{ payments?: Array<PaymentRow | null> | null } | null> | null }>)[0]
    const payments = (order?.payment_collections ?? [])
      .flatMap((c) => c?.payments ?? [])
      .filter((p): p is PaymentRow => !!p && !p.captured_at)
    const candidates = payments.filter((p) =>
      input.mode === "initial" ? isFbmCardProvider(p.provider_id) : !!renewalRecordClaim(p.provider_id, p.metadata)
    )
    if (candidates.length > 1) {
      // One checkout, one payment session: more than one is not a shape this
      // flow makes, and capturing the wrong one would charge twice.
      const message = `Subscription order ${input.order_id} has ${candidates.length} uncaptured payments; none captured`
      if (input.mode === "initial") throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, message)
      log.error(`[subscription] ${message}`)
      return none()
    }
    return new StepResponse({ payment_id: candidates[0]?.id ?? null })
  }
)
