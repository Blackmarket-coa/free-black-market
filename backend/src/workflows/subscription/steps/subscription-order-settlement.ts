import { createLogger } from "../../../shared/logger"
const log = createLogger("workflows/subscription/subscription-order-settlement")
import { createStep, StepResponse, type StepExecutionContext } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { isFbmCardProvider } from "../../../modules/hawala-ledger/card-clearing"
import { featureFlagState } from "../../../shared/feature-flags"
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
 *
 * SD-48 (`FF_DIGITAL_ORDER_SETTLEMENT_V1`): the digital-product checkout
 * (`workflows/create-digital-product-order`) completes its cart through the
 * same `completeCartWorkflow` and had gaps 1 and 2. It runs the seller, link
 * and capture steps below — their functions, not copies — under its own step
 * names with `sale: "digital_product"` fixed (the `*DigitalProduct*` steps at
 * the end of this file), under its own flag. Each sale's steps read only
 * that sale's flag, so either flag can be set without the other, and the
 * subscription wording is F5's byte for byte. Only a subscription renews.
 *
 * A replay — either checkout run again on a cart it already completed — must
 * not reach `completeCartWorkflow` (see `completedCartOrderStep`); the link
 * and capture steps run on it in their `replay` mode, which finishes an order
 * its first completion left unlinked or uncaptured and leaves a finished one
 * as it is.
 */

type QueryLike = { graph: (q: Record<string, unknown>) => Promise<{ data: unknown[] }> }

/** The checkout a settlement step serves; `subscription` when an input omits it. */
export type SettlementSale = "subscription" | "digital_product"

type SaleTerms = {
  /** The flag the sale's steps are dark under, read before anything else. */
  enabled: () => boolean
  /** "<label> order <id> …" */
  label: string
  /** The refusal of a cart with no single seller, before its reason. */
  soleSeller: string
  /** Log prefix. */
  tag: string
}

const SALES: Record<SettlementSale, SaleTerms> = {
  subscription: {
    enabled: () => consumerSubscriptionsEnabled(),
    label: "Subscription",
    soleSeller: "A subscription is sold by one seller",
    tag: "[subscription]",
  },
  digital_product: {
    enabled: () => featureFlagState.isEnabled("DIGITAL_ORDER_SETTLEMENT_V1"),
    label: "Digital product",
    soleSeller: "A digital product order is sold by one seller",
    tag: "[digital-product]",
  },
}

const termsOf = (sale: SettlementSale | undefined): SaleTerms => SALES[sale ?? "subscription"]

/**
 * First, before any money step: the order this cart was already completed
 * into, or null — read from the `order_cart` link, the same signal
 * `completeCartWorkflow` uses to decide it has nothing to create.
 *
 * An order here means the checkout is a replay: a client retrying the store
 * route, a refreshed checkout page, Blackout's "retry finishes the record".
 * `completeCartWorkflow` is idempotent on such a cart — it creates nothing —
 * but it still registers `compensatePaymentIfNeededStep`, whose compensation
 * refunds the cart's payment whenever `captured_at` is set. So on a replay of
 * a captured sale, anything that threw after it refunded the whole sale while
 * the order, its seller link and whatever it delivered stayed: seen on a real
 * database (SD-48) with the product re-linked to another seller since the
 * sale (the link step refuses that) and with one transient read error. FBM's
 * own `validate` hook runs after it too, on every completion. The
 * checkout therefore runs `completeCartWorkflow` and the seller check only
 * when this is null. A replay runs the link and capture steps in their
 * `replay` mode instead: a linked, captured order is returned as it is, and
 * one its first completion left unlinked or uncaptured (stopped right after
 * `completeCartWorkflow`, or completed by Medusa's Stripe webhook) is linked
 * and captured before anything is delivered — outside `completeCartWorkflow`,
 * so nothing refunds anything. At first, a replay skipped those steps too and
 * delivered such an order unlinked and uncaptured (seen on a real database,
 * SD-48's second review). Flag off, returns null before any read, and the
 * checkout completes the cart exactly as it did.
 */
async function completedCartOrder(input: { cart_id: string; sale?: SettlementSale }, { container }: StepExecutionContext) {
  const terms = termsOf(input.sale)
  if (!terms.enabled()) return new StepResponse({ order_id: null as string | null })
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as QueryLike
  const { data } = await query.graph({
    entity: "order_cart",
    fields: ["cart_id", "order_id"],
    filters: { cart_id: input.cart_id },
  })
  const link = (data as Array<{ order_id?: string | null } | null>)[0]
  return new StepResponse({ order_id: (link?.order_id ?? null) as string | null })
}
export const completedCartOrderStep = createStep("subscription-completed-cart-order", completedCartOrder)

/**
 * What the subscription checkout locks for its whole run: the cart id — the
 * key the digital checkout and Medusa's own cart workflows lock a cart under
 * — or nothing with the flag off, when `acquireLockStep` takes no lock and
 * the checkout runs as before. Read once, here, so the release frees exactly
 * what the acquire took.
 *
 * Without it nothing kept two checkouts of one cart (a double submit) apart.
 * `completeCartWorkflow` has a lock on the cart id, but run nested
 * (`runAsStep`) its acquire and release steps return `StepResponse.skip()`,
 * so this checkout held no lock at all: both runs found no order and both
 * completed the cart. On a real database, depending on timing, that made two
 * orders, two subscriptions and two captures recorded on one payment; or the
 * run that lost the race to record the payment failed, after the payment
 * module had sent a cancel to Stripe for the PaymentIntent the other run
 * then captured; or that run's compensation refunded the other run's
 * capture while the other run's subscription stayed active (SD-48). For the
 * same reason, this lock on the same key never meets `completeCartWorkflow`'s
 * own.
 */
export const subscriptionCheckoutLockStep = createStep(
  "subscription-checkout-lock",
  async (input: { cart_id: string }) =>
    new StepResponse({ key: consumerSubscriptionsEnabled() ? [input.cart_id] : ([] as string[]) })
)

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
 * Before Medusa authorizes the payment session: the subscription cart's one
 * seller. Refuses (flag on) a cart whose products do not all belong to one
 * seller, so nothing is captured for a sale no seller can be credited with.
 * It cannot undo a hold the buyer already placed: Blackout's page confirms
 * the card with Stripe before it completes, and that hold lapses. With
 * `sale: "digital_product"`, the same for a digital-product cart (SD-48).
 */
async function resolveSeller(input: { cart_id: string; sale?: SettlementSale }, { container }: StepExecutionContext) {
  const terms = termsOf(input.sale)
  if (!terms.enabled()) return new StepResponse({ seller_id: null as string | null })
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
      `${terms.soleSeller}, and this cart cannot be: ${"reason" in sole ? sole.reason : ""}.`
    )
  }
  return new StepResponse({ seller_id: sole.seller_id as string | null })
}
export const resolveSubscriptionSellerStep = createStep("resolve-subscription-seller", resolveSeller)

type LinkInput = {
  order_id: string
  /**
   * `initial`: the seller resolved before payment; anything else is refused,
   * and the checkout rolls back. `replay` (SD-48): the order a checkout run
   * again on a completed cart found — see `completedCartOrderStep`. An order
   * already linked is left as it is, whatever its products' seller is now;
   * an unlinked one (its first completion stopped before the link, or it was
   * completed some other way) is linked to its products' one seller, or
   * logged and left unlinked when there is none. Never thrown: nothing on a
   * replay can undo the order. `renewal`: the cycle's money is already
   * collected, so a seller that cannot be determined is logged, not thrown —
   * the order then stays unsettled, which the ledger reports.
   */
  mode: "initial" | "replay" | "renewal"
  expected_seller_id?: string | null
  /** SD-48: `digital_product` (`initial` or `replay`); `subscription` when omitted. */
  sale?: SettlementSale
}

type LinkOutput = { linked: boolean; seller_id: string | null }
/** The link this step created, for its compensation to dismiss; null when it created none. */
type LinkDef = Record<string, Record<string, string>> | null

const linkResult = (output: LinkOutput, created: LinkDef = null) => new StepResponse<LinkOutput, LinkDef>(output, created)

/**
 * Link the subscription order (or, with `sale: "digital_product"`, the
 * digital-product order) to its seller, as Mercur's split does for its own
 * orders.
 */
async function linkOrderSeller(input: LinkInput, { container }: StepExecutionContext) {
  const terms = termsOf(input.sale)
  if (!terms.enabled()) return linkResult({ linked: false, seller_id: null })
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
    log.error(`${terms.tag} ${message}`)
    return linkResult({ linked: false, seller_id: null })
  }
  if (!order) return refuse(`${terms.label} order ${input.order_id} not found; no seller linked`)
  // A replay keeps the seller its order was linked to (the sale is settled
  // to it), even if the product has moved since.
  if (input.mode === "replay" && order.seller?.id) return linkResult({ linked: false, seller_id: order.seller.id })

  const sole = await soleSellerOf(query, (order.items ?? []).map((i) => i?.product_id))
  if (!sole.seller_id) {
    return refuse(`${terms.label} order ${input.order_id} has no single seller (${"reason" in sole ? sole.reason : ""}); not linked, so the ledger will not settle it`)
  }
  if (input.mode === "initial" && input.expected_seller_id && sole.seller_id !== input.expected_seller_id) {
    return refuse(`${terms.label} order ${input.order_id} is sold by ${sole.seller_id}, not ${input.expected_seller_id} as checked before payment`)
  }
  const current = order.seller?.id ?? null
  if (current === sole.seller_id) return linkResult({ linked: false, seller_id: current })
  if (current) {
    return refuse(`${terms.label} order ${input.order_id} is linked to seller ${current}, but its products are sold by ${sole.seller_id}`)
  }

  const link = container.resolve(ContainerRegistrationKeys.LINK) as {
    create: (d: unknown) => Promise<unknown>
    dismiss: (d: unknown) => Promise<unknown>
  }
  const def = { [SELLER_MODULE]: { seller_id: sole.seller_id }, [Modules.ORDER]: { order_id: input.order_id } }
  await link.create(def)
  return linkResult({ linked: true, seller_id: sole.seller_id }, def)
}

/** Compensation: dismiss the link the step created, if it created one. */
async function unlinkOrderSeller(def: LinkDef, { container }: StepExecutionContext) {
  if (!def) return
  const link = container.resolve(ContainerRegistrationKeys.LINK) as { dismiss: (d: unknown) => Promise<unknown> }
  await link.dismiss(def)
}
export const linkSubscriptionOrderSellerStep = createStep("link-subscription-order-seller", linkOrderSeller, unlinkOrderSeller)

/**
 * The payment module's `updatePayment`. Its DTO declares only `id`, but the
 * service writes the other fields it is given; `metadata` landing is proved
 * on a real database by the renewal scenarios, which read the stamp back.
 */
type PaymentMetadataWriter = {
  updatePayment: (d: { id: string; metadata: Record<string, unknown> | null }) => Promise<unknown>
}
const paymentWriter = (container: { resolve: (key: string) => unknown }) =>
  container.resolve(Modules.PAYMENT) as unknown as PaymentMetadataWriter

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
    await paymentWriter(container).updatePayment({
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
    await paymentWriter(container).updatePayment({ id: prior.id, metadata: prior.metadata })
  }
)

type CaptureInput = {
  order_id: string
  mode: "initial" | "replay" | "renewal"
  /** `renewal`: the cycle's charge status from `chargeSubscriptionRenewalStep`. */
  renewal_charge_status?: string | null
  /** `replay`: the seller the link step left the order linked to; null when it could not link it. */
  linked_seller_id?: string | null
  /** SD-48: `digital_product` (`initial` or `replay`); `subscription` when omitted. */
  sale?: SettlementSale
}

type PaymentRow = {
  id: string
  provider_id?: string | null
  captured_at?: Date | string | null
  metadata?: Record<string, unknown> | null
  canceled_at?: Date | string | null
  payment_session_id?: string | null
}

type CollectionRow = { id?: string | null; payments?: Array<PaymentRow | null> | null } | null

/**
 * The payment sessions the collections still have. Read on their own: asked
 * for as `payments.payment_session.id`, the order query leaves out a payment
 * whose session is gone instead of answering null for it (seen on a real
 * database), which would drop such a payment from the read whether it is a
 * leftover or the payment the checkout has to capture.
 */
async function liveSessionIds(query: QueryLike, collectionIds: string[]): Promise<Set<string>> {
  if (collectionIds.length === 0) return new Set()
  const { data } = await query.graph({
    entity: "payment_session",
    fields: ["id"],
    filters: { payment_collection_id: collectionIds },
  })
  return new Set((data as Array<{ id?: string | null } | null>).map((s) => s?.id).filter((id): id is string => !!id))
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
 *
 *   - `replay` (SD-48): as `initial`, for the order a checkout run again on
 *     a completed cart found, once the link step has left it linked. An
 *     order its first completion left uncaptured (stopped after
 *     `completeCartWorkflow`, or completed some other way) is captured here,
 *     before anything is delivered; one that could not be linked is not
 *     captured — no seller could be credited — and is logged. Outside
 *     `completeCartWorkflow`, so a refused capture fails the retry and
 *     nothing refunds anything.
 *
 * A digital-product order (`sale: "digital_product"`, SD-48) is `initial`
 * or `replay`.
 *
 * `initial` and `replay` pass over one kind of payment: a cancelled one whose
 * payment session the collection no longer has. That is what a checkout
 * that failed after authorization leaves once the buyer pays again:
 * `completeCartWorkflow`'s compensation cancels the payment and Medusa keeps
 * it on the payment collection, and the retry's new session
 * (`createPaymentSessionsWorkflow` deletes the collection's sessions first)
 * replaces its session. Counted, it made every retry of that cart refuse
 * ("2 uncaptured payments") and cancel the new authorization too (SD-48,
 * seen on a real database for both sales). Every other uncaptured FBM
 * payment stays a candidate, so a payment that cannot be captured fails the
 * checkout rather than letting it deliver uncaptured:
 *
 *   - a cancelled payment on the cart's current session — a retry on the
 *     same session, which `authorizePaymentSession` answers with the payment
 *     it already has — whose capture the payment module refuses;
 *   - an authorized payment whose session was replaced while the checkout
 *     ran: the store's payment-collection route lets a client open a new
 *     session at any time, and Medusa then cancels the old intent at Stripe,
 *     which refuses its capture (both seen on a real database, SD-48).
 */
async function paymentToCapture(input: CaptureInput, { container }: StepExecutionContext) {
  const none = () => new StepResponse({ payment_id: null as string | null })
  const terms = termsOf(input.sale)
  if (!terms.enabled()) return none()
  if (input.mode === "renewal" && input.renewal_charge_status !== "succeeded") {
    if (input.renewal_charge_status === "processing") {
      log.warn(`${terms.tag} Renewal order ${input.order_id}: its charge is still processing; not recorded as captured`)
    }
    return none()
  }
  if (input.mode === "replay" && !input.linked_seller_id) {
    log.error(`${terms.tag} ${terms.label} order ${input.order_id} has no seller link, so this checkout captures nothing for it`)
    return none()
  }
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as QueryLike
  const { data } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "payment_collections.id",
      "payment_collections.payments.id",
      "payment_collections.payments.provider_id",
      "payment_collections.payments.captured_at",
      "payment_collections.payments.metadata",
      "payment_collections.payments.canceled_at",
      "payment_collections.payments.payment_session_id",
    ],
    filters: { id: input.order_id },
  })
  const order = (data as Array<{ payment_collections?: CollectionRow[] | null }>)[0]
  const collections = (order?.payment_collections ?? []).filter((c): c is NonNullable<CollectionRow> => !!c)
  const payments = collections.flatMap((c) => c.payments ?? []).filter((p): p is PaymentRow => !!p && !p.captured_at)
  let candidates: PaymentRow[]
  if (input.mode === "renewal") {
    candidates = payments.filter((p) => !!renewalRecordClaim(p.provider_id, p.metadata))
  } else {
    const card = payments.filter((p) => isFbmCardProvider(p.provider_id))
    const live = card.some((p) => p.canceled_at)
      ? await liveSessionIds(query, collections.map((c) => c.id).filter((id): id is string => !!id))
      : new Set<string>()
    // An earlier attempt's leftover: cancelled, and its session since replaced.
    const leftover = (p: PaymentRow) => !!p.canceled_at && !(p.payment_session_id && live.has(p.payment_session_id))
    candidates = card.filter((p) => !leftover(p))
  }
  if (candidates.length > 1) {
    // One checkout, one payment session: more than one is not a shape this
    // flow makes, and capturing the wrong one would charge twice.
    const message = `${terms.label} order ${input.order_id} has ${candidates.length} uncaptured payments; none captured`
    if (input.mode !== "renewal") throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, message)
    log.error(`${terms.tag} ${message}`)
    return none()
  }
  return new StepResponse({ payment_id: candidates[0]?.id ?? null })
}
export const subscriptionPaymentToCaptureStep = createStep("subscription-payment-to-capture", paymentToCapture)

/**
 * SD-48: the replay check and the seller, link and capture steps for the
 * digital-product checkout — the same functions as F5's, under that
 * checkout's own step names and with its sale fixed, so they read only
 * FF_DIGITAL_ORDER_SETTLEMENT_V1 and speak of a digital product order.
 *
 * Defined here rather than renamed in the workflow with `.config({ name })`:
 * the checkout runs them inside a `when` block, and workflows-sdk 2.14.2
 * gives a step renamed that way inside a `when` the handler made under its
 * first name — whose compensation reads the step's result under that first
 * name, finds none, and does nothing. The link step's compensation then left
 * the seller link behind a refused capture (caught on a real database by
 * `digital-order-settlement.spec.ts`, which reads the link table).
 */
export const digitalProductCompletedCartOrderStep = createStep(
  "digital-product-completed-cart-order",
  (input: { cart_id: string }, context: StepExecutionContext) =>
    completedCartOrder({ ...input, sale: "digital_product" }, context)
)
export const resolveDigitalProductSellerStep = createStep(
  "resolve-digital-product-seller",
  (input: { cart_id: string }, context: StepExecutionContext) => resolveSeller({ ...input, sale: "digital_product" }, context)
)
export const linkDigitalProductOrderSellerStep = createStep(
  "link-digital-product-order-seller",
  (input: Omit<LinkInput, "sale">, context: StepExecutionContext) =>
    linkOrderSeller({ ...input, sale: "digital_product" }, context),
  unlinkOrderSeller
)
export const digitalProductPaymentToCaptureStep = createStep(
  "digital-product-payment-to-capture",
  (input: Omit<CaptureInput, "sale">, context: StepExecutionContext) =>
    paymentToCapture({ ...input, sale: "digital_product" }, context)
)
