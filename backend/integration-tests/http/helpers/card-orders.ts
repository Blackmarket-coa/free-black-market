import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SELLER_MODULE } from "@mercurjs/b2c-core/modules/seller"
import { SPLIT_ORDER_PAYMENT_MODULE } from "@mercurjs/b2c-core/modules/split-order-payment"
import { HAWALA_LEDGER_MODULE } from "../../../src/modules/hawala-ledger"
import { CARD_CLEARING_ACCOUNT_TYPE } from "../../../src/modules/hawala-ledger/card-clearing"
import hawalaOrderPaymentSubscriber from "../../../src/subscribers/hawala-order-payment"
import hawalaCardCaptureSubscriber from "../../../src/subscribers/hawala-card-capture"
import hawalaCardRefundSubscriber from "../../../src/subscribers/hawala-card-refund"

/**
 * Real-database fixtures for card orders (SD-36 / SD-39 / SD-40): real
 * order, payment, seller, split-order-payment and link modules, and the real
 * hawala ledger — nothing about an order or its money is mocked.
 *
 * Payments are taken with Medusa's built-in `pp_system_default` provider (no
 * network), then re-labelled `pp_stripe_stripe` in the database — the
 * provider id is the only thing the settlement code reads from the payment.
 */
export function cardOrderFixtures(getContainer: () => any) {
  const container = () => getContainer() as any
  const cents = (v: unknown) => Math.round(Number(v) * 100)
  let n = 0
  const uid = () => `${Date.now().toString(36)}${(++n).toString(36)}`

  async function makeSeller() {
    const sellers = container().resolve(SELLER_MODULE)
    const id = uid()
    const created = await sellers.createSellers({ name: `Grower ${id}`, handle: `grower-${id}` })
    return Array.isArray(created) ? created[0] : created
  }

  async function makeOrder(sellerId: string, unitPrice: number) {
    const orders = container().resolve(Modules.ORDER)
    const [order] = await orders.createOrders([
      {
        currency_code: "usd",
        customer_id: `cus_${uid()}`,
        email: "buyer@example.com",
        items: [{ title: "Tomatoes", quantity: 1, unit_price: unitPrice }],
      },
    ])
    await container().resolve(ContainerRegistrationKeys.LINK).create({
      [SELLER_MODULE]: { seller_id: sellerId },
      [Modules.ORDER]: { order_id: order.id },
    })
    return order
  }

  async function setProvider(paymentId: string, provider: string) {
    const pg = container().resolve(ContainerRegistrationKeys.PG_CONNECTION)
    await pg.raw(`UPDATE payment SET provider_id = ? WHERE id = ?`, [provider, paymentId])
  }

  /** A collection paid through the system provider, then labelled FBM Stripe. */
  async function pay(orderIds: string[], amount: number, opts: { capture: boolean }) {
    const payments = container().resolve(Modules.PAYMENT)
    const link = container().resolve(ContainerRegistrationKeys.LINK)
    const [collection] = await payments.createPaymentCollections([{ currency_code: "usd", amount }])
    // One batched call, as Mercur's split-and-complete-cart does: the link
    // allows one order per collection, but its uniqueness check reads only
    // links already stored, so a batch links every order of a cart.
    await link.create(
      orderIds.map((order_id) => ({
        [Modules.ORDER]: { order_id },
        [Modules.PAYMENT]: { payment_collection_id: collection.id },
      }))
    )
    const session = await payments.createPaymentSession(collection.id, {
      provider_id: "pp_system_default",
      amount,
      currency_code: "usd",
      data: {},
    })
    const payment = await payments.authorizePaymentSession(session.id, {})
    if (opts.capture) await payments.capturePayment({ payment_id: payment.id, amount })
    await setProvider(payment.id, "pp_stripe_stripe")
    return { collectionId: collection.id as string, paymentId: payment.id as string }
  }

  /** Refund through the provider that took the money, then label it back. */
  async function refund(paymentId: string, amount: number) {
    await setProvider(paymentId, "pp_system_default")
    await container().resolve(Modules.PAYMENT).refundPayment({ payment_id: paymentId, amount })
    await setProvider(paymentId, "pp_stripe_stripe")
  }

  async function split(orderId: string, collectionId: string, authorized: number) {
    const splits = container().resolve(SPLIT_ORDER_PAYMENT_MODULE)
    const created = await splits.createSplitOrderPayments({
      status: "authorized",
      currency_code: "usd",
      authorized_amount: authorized,
      captured_amount: 0,
      refunded_amount: 0,
      payment_collection_id: collectionId,
    })
    const row = Array.isArray(created) ? created[0] : created
    await container().resolve(ContainerRegistrationKeys.LINK).create({
      [Modules.ORDER]: { order_id: orderId },
      [SPLIT_ORDER_PAYMENT_MODULE]: { split_order_payment_id: row.id },
    })
    return row
  }

  const hawala = () => container().resolve(HAWALA_LEDGER_MODULE)
  const legs = async (orderId: string) =>
    (await hawala().listLedgerEntries({ order_id: orderId }, { order: { created_at: "ASC" } })) as any[]
  const sellerEarnings = async (sellerId: string) =>
    (await hawala().listLedgerAccounts({ account_type: "SELLER_EARNINGS", owner_type: "SELLER", owner_id: sellerId }))[0]
  const clearing = async () => (await hawala().listLedgerAccounts({ account_type: CARD_CLEARING_ACCOUNT_TYPE }))[0]
  const placed = (orderId: string) =>
    hawalaOrderPaymentSubscriber({ event: { data: { id: orderId } }, container: container() } as any)
  const captured = (paymentId: string) =>
    hawalaCardCaptureSubscriber({ event: { data: { id: paymentId } }, container: container() } as any)
  const refunded = (paymentId: string) =>
    hawalaCardRefundSubscriber({ event: { data: { id: paymentId } }, container: container() } as any)

  return {
    container,
    cents,
    uid,
    makeSeller,
    makeOrder,
    setProvider,
    pay,
    refund,
    split,
    hawala,
    legs,
    sellerEarnings,
    clearing,
    placed,
    captured,
    refunded,
  }
}
