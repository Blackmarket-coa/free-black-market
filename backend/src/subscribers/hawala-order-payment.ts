import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { HAWALA_LEDGER_MODULE } from "../modules/hawala-ledger"
import HawalaLedgerModuleService from "../modules/hawala-ledger/service"
import { PAYOUT_BREAKDOWN_MODULE } from "../modules/payout-breakdown"
import PayoutBreakdownService from "../modules/payout-breakdown/service"
import { CREATOR_ATTRIBUTION_MODULE } from "../modules/creator-attribution"
import type CreatorAttributionService from "../modules/creator-attribution/service"

/**
 * Convert cents (integer) to dollars (decimal)
 * 
 * IMPORTANT: Medusa stores all monetary amounts in cents (integers).
 * The Hawala ledger stores amounts in dollars (decimals).
 * This function ensures consistent conversion.
 * 
 * @param cents - Amount in cents (e.g., 1999 = $19.99)
 * @returns Amount in dollars (e.g., 19.99)
 */
function centsToDollars(cents: number): number {
  // Sanity check: if value looks like dollars already (has decimals or > $10000), warn
  if (cents !== Math.floor(cents)) {
    console.warn(`[Hawala] Warning: centsToDollars received non-integer value: ${cents}`)
  }
  if (cents > 0 && cents < 1) {
    console.warn(`[Hawala] Warning: centsToDollars received value < 1, likely already in dollars: ${cents}`)
    return cents // Return as-is to avoid double conversion
  }
  return cents / 100
}

/**
 * Subscriber that processes order payments through the Hawala ledger
 * when an order is completed/paid.
 * 
 * Uses the payout-breakdown service to calculate platform fees based on
 * the default config or seller-specific custom fee settings.
 * 
 * CURRENCY NOTE: Medusa amounts are in CENTS, Hawala ledger uses DOLLARS.
 * All amounts are converted via centsToDollars() before ledger operations.
 */
export default async function hawalaOrderPaymentSubscriber({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const hawalaService = container.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const payoutService = container.resolve<PayoutBreakdownService>(PAYOUT_BREAKDOWN_MODULE)
  const orderModuleService = container.resolve("order")

  const orderId = event.data.id
  console.log(`[Hawala] Processing payment for order: ${orderId}`)

  try {
    // Get order details
    const order = await orderModuleService.retrieveOrder(orderId, {
      relations: ["items", "customer"],
    })

    if (!order) {
      console.log(`[Hawala] Order not found: ${orderId}`)
      return
    }

    // Get or create customer wallet
    const customerId = order.customer_id
    if (!customerId) {
      console.log(`[Hawala] No customer ID for order: ${orderId}`)
      return
    }

    let customerWallets = await hawalaService.listLedgerAccounts({
      account_type: "USER_WALLET",
      owner_type: "CUSTOMER",
      owner_id: customerId,
    })

    if (customerWallets.length === 0) {
      // Create wallet for customer
      const wallet = await hawalaService.createAccount({
        account_type: "USER_WALLET",
        owner_type: "CUSTOMER",
        owner_id: customerId,
      })
      customerWallets = [wallet]
    }

    // Get seller ID (from marketplace context or default)
    const sellerId = (order as any).seller_id || "default-seller"

    // Get or create seller earnings account
    let sellerAccounts = await hawalaService.listLedgerAccounts({
      account_type: "SELLER_EARNINGS",
      owner_type: "SELLER",
      owner_id: sellerId,
    })

    if (sellerAccounts.length === 0) {
      const account = await hawalaService.createAccount({
        account_type: "SELLER_EARNINGS",
        owner_type: "SELLER",
        owner_id: sellerId,
      })
      sellerAccounts = [account]
    }

    // Calculate amounts using payout-breakdown service for accurate fees
    // IMPORTANT: order.total is in CENTS, convert to DOLLARS for ledger
    const totalAmount = centsToDollars(Number(order.total))
    
    // Get platform fee from payout config (respects seller-specific overrides)
    const platformFeePercent = await payoutService.getEffectivePlatformFee(sellerId)
    const platformFeeAmount = totalAmount * (platformFeePercent / 100)

    // Look up creator attribution (idempotent — created earlier by
    // attribute-order-on-placed subscriber, but we look it up rather than
    // depending on subscriber ordering).
    let creatorCommissionCents = 0
    let creatorSellerId: string | undefined
    try {
      const attributionService = container.resolve<CreatorAttributionService>(
        CREATOR_ATTRIBUTION_MODULE
      )
      const attributions = await attributionService.listOrderAttributions({
        order_id: orderId,
      })
      const attribution = attributions[0]
      if (attribution) {
        creatorCommissionCents = Number(attribution.commission_amount_cents) || 0
        creatorSellerId = attribution.creator_seller_id
      }
    } catch (attributionError) {
      console.warn(`[Hawala] Could not look up creator attribution for order ${orderId}:`, attributionError)
    }

    // Store the breakdown for this order (for transparency reporting)
    try {
      const breakdown = await payoutService.calculateBreakdown({
        subtotal: Number(order.subtotal || order.total),
        sellerId,
        orderId,
        currencyCode: order.currency_code,
        creatorCommissionCents,
        creatorSellerId,
      })
      await payoutService.storeOrderBreakdown(
        orderId,
        customerId,
        breakdown,
        order.currency_code
      )
    } catch (breakdownError) {
      console.warn(`[Hawala] Could not store breakdown for order ${orderId}:`, breakdownError)
    }

    // Check for auto-invest settings
    const producerId = (order as any).producer_id || null
    const autoInvestPercentage = (order as any).auto_invest_percentage || 0

    // Process order payment through ledger
    const entries = await hawalaService.processOrderPayment({
      customer_account_id: customerWallets[0].id,
      seller_account_id: sellerAccounts[0].id,
      order_id: orderId,
      total_amount: totalAmount,
      platform_fee_amount: platformFeeAmount,
      producer_id: producerId,
      auto_invest_percentage: autoInvestPercentage,
      idempotency_key: `order-payment-${orderId}`,
    })

    console.log(`[Hawala] Order ${orderId} processed: ${entries.length} ledger entries created`)
  } catch (error) {
    console.error(`[Hawala] Error processing order ${orderId}:`, error)
    // Don't throw - order completion should not fail due to ledger issues
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
