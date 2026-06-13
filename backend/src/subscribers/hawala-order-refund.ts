import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/hawala-order-refund")
import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { HAWALA_LEDGER_MODULE } from "../modules/hawala-ledger"
import HawalaLedgerModuleService from "../modules/hawala-ledger/service"

/**
 * Subscriber that processes order refunds through the Hawala ledger
 * when an order is cancelled or refunded.
 * 
 * Handles:
 * - Order cancellations (full refund)
 * - Order refunds (partial or full)
 * 
 * The ledger entries are reversed:
 * 1. Seller earnings returned to escrow
 * 2. Platform fee returned to escrow
 * 3. Customer payment refunded from escrow
 */
export default async function hawalaOrderRefundSubscriber({
  event,
  container,
}: SubscriberArgs<{ 
  id: string
  refund_amount?: number
  reason?: string 
}>) {
  const hawalaService = container.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)

  const orderId = event.data.id
  const refundAmount = event.data.refund_amount
  const reason = event.data.reason || "Order cancelled"

  log.info(`[Hawala] Processing refund for order: ${orderId}`)

  try {
    const refundEntries = await hawalaService.processRefund({
      order_id: orderId,
      refund_amount: refundAmount,
      reason: reason,
      idempotency_key: `order-refund-${orderId}`,
    })

    log.info(
      `[Hawala] Refund for order ${orderId} processed: ` +
      `${refundEntries.length} ledger entries created`
    )
  } catch (error) {
    // Log but don't throw - we don't want to fail the cancellation
    // if the ledger processing has issues
    log.error(`[Hawala] Error processing refund for order ${orderId}:`, error)
    
    // If no payments found, this order may not have been processed yet
    if ((error as Error).message?.includes("No completed payments found")) {
      log.info(`[Hawala] Order ${orderId} has no payments to refund - skipping`)
      return
    }
  }
}

export const config: SubscriberConfig = {
  // Listen to both order cancellation and refund events
  event: ["order.canceled", "order.refund_created"],
}
