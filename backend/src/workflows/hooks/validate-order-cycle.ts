import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import type { CompleteCartValidateArgs } from "./complete-cart-validate-args"

/**
 * Refuse to complete a cart whose order-cycle items can no longer be sold
 * (D9-3, and the preventable half of D9-1).
 *
 * ## What was missing
 *
 * `POST /store/order-cycles/:id/availability` checks stock before an item
 * enters the cart, and the `order.placed` subscriber records the sale after
 * checkout. Between those two there was nothing. A cart tagged with a cycle
 * that closed hours earlier still recorded a sale, and a cart built when
 * twenty units were free still completed after the last one went — the audit
 * called the first "not a race, a missing check", and the second needed an
 * inventory decision rather than another guard.
 *
 * ## The decision this encodes
 *
 * **Fail at completion rather than reserve at add-to-cart.** Reserving stock
 * when an item enters a cart means building expiry and release machinery, and
 * an abandoned cart then holds a grower's produce until it times out. For
 * short, perishable cycles that is worse than the problem: the stock is gone
 * from everyone else while nobody is buying it. Failing at completion costs
 * the buyer a late refusal, which is real, and never costs a producer a sale
 * they could have made.
 *
 * The check runs before payment, which is the point — everything after this
 * hook has already taken the buyer's money, and `recordSale` deliberately
 * records an overshoot rather than refusing one for exactly that reason.
 *
 * ## Where it runs, and what "before payment" means there
 *
 * At both seams that complete carts: `completeCartWorkflow.hooks.validate`
 * (`complete-cart-validate.ts`), before that workflow authorizes the payment
 * session, and the middleware in front of Mercur's main checkout,
 * `POST /store/carts/:id/complete` (`api/middlewares/cart-completion-guards.ts`),
 * before Mercur's `splitAndCompleteCartWorkflow` authorizes anything; that
 * workflow never calls the hook. Two exceptions to "before payment". Medusa's
 * payment webhook captures before it runs the workflow, so a refusal there
 * leaves a captured payment for the workflow's compensation to try to refund
 * (`complete-cart-validate.ts`). And on
 * the storefront's card flow the buyer's card is confirmed in the browser
 * (`stripe.confirmCardPayment`, `PaymentButton.tsx`) before the main checkout
 * is called, so a refusal there leaves an uncaptured hold on the card. It is
 * released when the buyer changes the cart (Medusa's payment refresh deletes
 * the session, and the Stripe provider cancels its intent) or when Stripe
 * lets it lapse. There the refusal comes before capture, not before the hold.
 *
 * ## What it does not catch
 *
 * Two buyers completing in the same instant both read the same remaining
 * quantity and both pass. That residue is unavoidable without reservations,
 * and it is handled where it lands: `applySoldQuantity` increments atomically
 * so neither sale is lost, and logs the overshoot so a coordinator can act.
 * This hook removes the ordinary case; it does not pretend to remove the race.
 *
 * ## Closed cycles
 *
 * A cycle that is not open refuses here, before payment. That is deliberately
 * the opposite of the subscriber's behaviour, and the two are consistent
 * rather than contradictory: refusing *before* the buyer pays costs them
 * nothing but a message, while refusing *after* they have paid would lose a
 * real sale to a sweep that closed the cycle mid-checkout. The rule is that
 * the last moment before money moves is where a cycle's state is enforced.
 */

type CartItem = {
  title?: string | null
  variant_id?: string | null
  quantity?: number | null
  metadata?: Record<string, unknown> | null
}

/** Cycle statuses in which a buyer may still complete a purchase. */
const SELLABLE_STATUSES = new Set(["open"])

export async function validateOrderCycleOnCompleteCart(
  args: CompleteCartValidateArgs,
  context: { container?: any }
): Promise<void> {
  // `{ input: { id }, cart }`, as Medusa calls the hook. Until SD-54 this read
  // `input.cart_id`, which the hook never carries, and so ran at no checkout.
  // A cart that has already completed never reaches this guard: on a re-run
  // the cycle's sold count already holds the cart's own sale, so the
  // composition skips every guard there (`complete-cart-guards.ts`).
  const cartId = args?.input?.id
  if (!cartId || !context?.container) return

  let cart: Record<string, unknown> | undefined
  try {
    const query = context.container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "cart",
      fields: ["id", "metadata", "items.title", "items.variant_id", "items.quantity", "items.metadata"],
      filters: { id: cartId },
    })
    cart = Array.isArray(data) ? data[0] : undefined
  } catch {
    // A cart we cannot read is not one this guard should block on
    // infrastructure grounds; the other validators on this hook read the same
    // cart and would have failed first.
    return
  }
  if (!cart) return

  // Resolved as `subscribers/order-cycle-order-placed.ts` does — an
  // item-level tag, falling back to a cart-level one. If these two ever
  // disagreed about which items belong to a cycle, the check and the sale
  // would be about different things. On Mercur's main checkout they do, for
  // the fallback: Mercur copies each line's metadata onto its orders and never
  // the cart's, so the subscriber's order-level fallback finds no tag, and a
  // line this guard checks under the cart's tag is recorded under none
  // (pinned in integration-tests/http/main-checkout-guards.spec.ts). No
  // client in this repo writes the cart-level tag.
  const cartMetadata = (cart.metadata ?? {}) as Record<string, unknown>
  const cartLevelCycleId =
    typeof cartMetadata.order_cycle_id === "string"
      ? cartMetadata.order_cycle_id
      : undefined

  const items = (cart.items as CartItem[] | undefined) ?? []

  /** cycleId -> variantId -> quantity in this cart */
  const wanted = new Map<string, Map<string, number>>()
  /** cycleId -> the titles of its lines, which the buyer sees in the cart */
  const titles = new Map<string, Set<string>>()

  for (const item of items) {
    const cycleId =
      typeof item?.metadata?.order_cycle_id === "string"
        ? (item.metadata.order_cycle_id as string)
        : cartLevelCycleId
    if (!cycleId || !item?.variant_id) continue

    const quantity = Number(item.quantity ?? 0)
    if (!Number.isFinite(quantity) || quantity <= 0) continue

    const byVariant = wanted.get(cycleId) ?? new Map<string, number>()
    byVariant.set(item.variant_id, (byVariant.get(item.variant_id) ?? 0) + quantity)
    wanted.set(cycleId, byVariant)
    if (typeof item.title === "string" && item.title.trim()) {
      titles.set(cycleId, (titles.get(cycleId) ?? new Set<string>()).add(item.title.trim()))
    }
  }

  if (wanted.size === 0) return

  const service = resolveOrderCycleService(context.container)
  if (!service) return

  for (const [cycleId, byVariant] of wanted) {
    let cycle: { status?: string; name?: string } | undefined
    try {
      cycle = await service.retrieveOrderCycle(cycleId)
    } catch {
      cycle = undefined
    }

    if (!cycle) {
      // Shown to the buyer as it is (`storefront/src/lib/helpers/
      // order-error-formatter.ts`), so it names the lines they can see rather
      // than the cycle's id, which they cannot.
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, missingCycleMessage([...(titles.get(cycleId) ?? [])]))
    }

    if (!SELLABLE_STATUSES.has(String(cycle.status))) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `The order cycle "${cycle.name ?? cycleId}" is ${cycle.status} and is no longer taking orders. ` +
          `Remove those items to check out with the rest of your cart.`
      )
    }

    let products: Array<{
      variant_id: string
      available_quantity?: number | null
      sold_quantity?: number | null
    }> = []
    try {
      products = await service.listOrderCycleProducts({ order_cycle_id: cycleId })
    } catch {
      // Cannot read the cycle's stock. Do not block the sale on that — the
      // post-payment path records and reports an overshoot, which is the
      // safer failure than refusing a checkout we cannot prove is bad.
      continue
    }

    const byId = new Map(products.map((p) => [p.variant_id, p]))

    for (const [variantId, quantity] of byVariant) {
      const product = byId.get(variantId)
      if (!product) {
        throw new MedusaError(
          MedusaError.Types.NOT_ALLOWED,
          `An item in your cart is no longer offered in the order cycle ` +
            `"${cycle.name ?? cycleId}". Remove it to check out.`
        )
      }

      const capacity = product.available_quantity
      // A null capacity means the producer set no limit.
      if (capacity === null || capacity === undefined) continue

      const remaining = Number(capacity) - Number(product.sold_quantity ?? 0)
      if (quantity > remaining) {
        throw new MedusaError(
          MedusaError.Types.NOT_ALLOWED,
          remaining > 0
            ? `Only ${remaining} left of an item in your cart for "${cycle.name ?? cycleId}", ` +
              `and you have ${quantity}. Reduce the quantity to check out.`
            : `An item in your cart has sold out in "${cycle.name ?? cycleId}". ` +
              `Remove it to check out.`
        )
      }
    }
  }
}

/** The refusal for lines whose cycle is gone, naming them by title when the cart has titles. */
function missingCycleMessage(titles: string[]): string {
  const quoted = titles.map((title) => `"${title}"`)
  if (quoted.length === 1) {
    return `${quoted[0]} in your cart is from an order cycle that no longer exists. Remove it and check out again.`
  }
  if (quoted.length > 1) {
    return `${quoted.join(", ")} in your cart are from an order cycle that no longer exists. Remove them and check out again.`
  }
  return `Some items in your cart are from an order cycle that no longer exists. Remove them and check out again.`
}

/**
 * Registration key of the order-cycle module. Resolved by string rather than
 * importing `modules/order-cycle` so this boot-time hook stays out of that
 * module's import graph — the same reason `shared/actor-scope.ts` names the
 * hawala module by string. Kept in sync with `ORDER_CYCLE_MODULE` in
 * `modules/order-cycle/index.ts`; `__tests__/validate-order-cycle` asserts
 * the two still match, so a rename fails a test rather than silently making
 * this guard a no-op.
 */
const ORDER_CYCLE_MODULE = "orderCycleModuleService"

function resolveOrderCycleService(container: any):
  | {
      retrieveOrderCycle: (id: string) => Promise<{ status?: string; name?: string }>
      listOrderCycleProducts: (filter: {
        order_cycle_id: string
      }) => Promise<
        Array<{
          variant_id: string
          available_quantity?: number | null
          sold_quantity?: number | null
        }>
      >
    }
  | undefined {
  try {
    return container.resolve(ORDER_CYCLE_MODULE)
  } catch {
    return undefined
  }
}
