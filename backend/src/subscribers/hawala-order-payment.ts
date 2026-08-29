import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/hawala-order-payment")
import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { HAWALA_LEDGER_MODULE } from "../modules/hawala-ledger"
import HawalaLedgerModuleService from "../modules/hawala-ledger/service"
import { PAYOUT_BREAKDOWN_MODULE } from "../modules/payout-breakdown"
import PayoutBreakdownService from "../modules/payout-breakdown/service"
import { CREATOR_ATTRIBUTION_MODULE } from "../modules/creator-attribution"
import type CreatorAttributionService from "../modules/creator-attribution/service"
import { emitBlackoutEvent } from "../lib/blackout-emit"
import { resolveSellerPlatformFee } from "../shared/platform-fee"
import { resolveSellerPluginPayees } from "../shared/plugin-payees"
import { disbursePluginDeveloperShare } from "../shared/plugin-revenue-payout"
import { resolveSellerReferralPayee } from "../shared/referral-payees"
import { disburseReferralShare } from "../shared/referral-revenue-payout"
import {
  isConsignmentSplitLive,
  resolveOrderConsignment,
  type ConsignmentConfig,
} from "../lib/consignment"

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
    log.warn(`[Hawala] Warning: centsToDollars received non-integer value: ${cents}`)
  }
  if (cents > 0 && cents < 1) {
    log.warn(`[Hawala] Warning: centsToDollars received value < 1, likely already in dollars: ${cents}`)
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
  log.info(`[Hawala] Processing payment for order: ${orderId}`)

  try {
    // Get order details
    const order = await orderModuleService.retrieveOrder(orderId, {
      relations: ["items", "customer"],
    })

    if (!order) {
      log.info(`[Hawala] Order not found: ${orderId}`)
      return
    }

    // Get or create customer wallet
    const customerId = order.customer_id
    if (!customerId) {
      log.info(`[Hawala] No customer ID for order: ${orderId}`)
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

    // Renewal orders carry the subscription stamp from the cloned template
    // cart (renew-helpers.buildRenewalCartInput). Used below to type the
    // ledger reference.
    const orderMetadata = ((order as any).metadata ?? {}) as Record<string, unknown>
    const renewalSubscriptionId =
      orderMetadata.renewal === true &&
      typeof orderMetadata.subscription_id === "string" &&
      orderMetadata.subscription_id.length > 0
        ? (orderMetadata.subscription_id as string)
        : null

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

    // Get platform fee from payout config (respects seller-specific overrides).
    // The fee is charged on the SUBTOTAL, not order.total — matching the
    // customer-facing transparency breakdown (payout-breakdown/service.ts).
    // Charging on order.total previously skimmed the platform's percentage off
    // the customer's tax, delivery and tip, so the ledger and the displayed
    // breakdown disagreed for the same order. Tax/delivery/tip remain in the
    // seller leg pending a fuller multi-leg settlement.
    const feeBaseAmount = centsToDollars(Number(order.subtotal ?? order.total))
    // Via the shared helper, not the module service directly: the plan's rate
    // sits between the per-seller override and the platform default, and only
    // this composition point can read it across the module boundary.
    const platformFee = await resolveSellerPlatformFee(container, sellerId)
    const platformFeePercent = platformFee.percent
    const platformFeeAmount = feeBaseAmount * (platformFeePercent / 100)

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
      log.warn(`[Hawala] Could not look up creator attribution for order ${orderId}:`, attributionError)
    }

    // Store the breakdown for this order (for transparency reporting)
    try {
      const payoutConfig = await payoutService.getDefaultConfig()
      const pluginSharePercent = Number(payoutConfig.plugin_developer_percent ?? 0)
      const referralSharePercent = Number(payoutConfig.referral_percent ?? 0)

      const breakdown = await payoutService.calculateBreakdown({
        subtotal: Number(order.subtotal || order.total),
        sellerId,
        orderId,
        currencyCode: order.currency_code,
        creatorCommissionCents,
        creatorSellerId,
        // The same plan rate the ledger leg above resolved through. Without it
        // `calculateBreakdown` would re-resolve without the plan tier, and the
        // stored customer-facing breakdown would disagree with the money that
        // actually moved for this order.
        planFeePercentBySeller: { [sellerId]: platformFee.plan_percent },
        // Plugin developer revenue share, carved out of the platform fee. The
        // payees have to be resolved here because they span two modules the
        // payout service cannot reach.
        //
        // Resolved only when the share is actually configured. It is 0 by
        // default, and looking up installed plugins on every settlement to
        // multiply them by zero would put an extra query on the money path for
        // every deployment that never turns this on.
        pluginsBySeller: pluginSharePercent > 0
          ? { [sellerId]: await resolveSellerPluginPayees(container, sellerId) }
          : undefined,
        // Generic referral share, carved from what the plugin share left. Same
        // configured-only guard: the attribution lookup is skipped entirely
        // when referral_percent is 0, which is the default.
        referralBySeller: referralSharePercent > 0
          ? { [sellerId]: await resolveSellerReferralPayee(container, sellerId) }
          : undefined,
      })
      await payoutService.storeOrderBreakdown(
        orderId,
        customerId,
        breakdown,
        order.currency_code
      )

      // Disburse after the breakdown is stored, so the record of what is owed
      // survives even if the transfers themselves are deferred.
      if (breakdown.pluginShareAllocations.length > 0) {
        await disbursePluginDeveloperShare(container, {
          orderId,
          sellerId,
          currencyCode: order.currency_code,
          allocations: breakdown.pluginShareAllocations,
        })
      }

      // Referral share disburses the same way and after the breakdown is
      // stored. Single-seller settlement here, so at most one allocation.
      if (breakdown.referralShareAllocations.length > 0) {
        await disburseReferralShare(container, {
          orderId,
          currencyCode: order.currency_code,
          allocation: breakdown.referralShareAllocations[0],
        })
      }
    } catch (breakdownError) {
      log.warn(`[Hawala] Could not store breakdown for order ${orderId}:`, breakdownError)
    }

    // Check for auto-invest settings
    const producerId = (order as any).producer_id || null
    const autoInvestPercentage = (order as any).auto_invest_percentage || 0

    // Consignment revenue split (dark by default). When
    // FBM_CONSIGNMENT_SPLIT_LIVE=1 and every line item sells the same
    // consignment deal (listing-type `consignment` + consignor metadata, see
    // lib/consignment.ts), the seller-side amount is fanned out
    // escrow->consignor + escrow->vendor INSTEAD of the single
    // escrow->seller leg. Flag unset (default): no extra reads, ledger flow
    // identical to today.
    let consignmentPlan: {
      config: ConsignmentConfig
      totalCents: number
      platformFeeCents: number
    } | null = null
    if (isConsignmentSplitLive()) {
      const config = await lookupOrderConsignment(container, order, sellerId)
      if (config) {
        // Integer cents for the whole fan-out so escrow nets to exactly
        // zero (order.total is integer cents; the percentage fee can be
        // fractional, so it is rounded to a whole cent on this path).
        const totalCents = Math.round(Number(order.total))
        const platformFeeCents = Math.min(
          Math.max(Math.round(platformFeeAmount * 100), 0),
          totalCents
        )
        if (producerId && autoInvestPercentage) {
          // Auto-invest carves its leg out of the seller side inside
          // processOrderPayment; combining it with the split is not
          // supported yet.
          log.warn(
            `[Hawala] Order ${orderId} has auto-invest configured; skipping consignment split`
          )
        } else if (totalCents - platformFeeCents <= 0) {
          log.warn(
            `[Hawala] Order ${orderId} has no positive seller-side amount; skipping consignment split`
          )
        } else {
          consignmentPlan = { config, totalCents, platformFeeCents }
        }
      }
    }

    // Idempotency across a flag flip: the `-purchase` leg is written first by
    // BOTH the plain and split paths under the same key, but their seller-side
    // keys differ (`-seller` vs `-consignor`/`-vendor`). If the order was
    // already settled, skip re-settlement so a redelivery that crosses an
    // FBM_CONSIGNMENT_SPLIT_LIVE change can't write the alternate seller legs
    // and double-debit escrow.
    const priorPurchase = await hawalaService.listLedgerEntries({
      idempotency_key: `order-payment-${orderId}-purchase`,
    })
    if (priorPurchase.length > 0) {
      log.info(`[Hawala] Order ${orderId} already settled; skipping re-settlement`)
      return
    }

    // Process order payment through ledger
    const entries = consignmentPlan
      ? await processConsignmentOrderPayment(hawalaService, {
          customerAccountId: customerWallets[0].id,
          orderId,
          currencyCode: String(order.currency_code || "USD").toUpperCase(),
          vendorSellerId: sellerId,
          totalCents: consignmentPlan.totalCents,
          platformFeeCents: consignmentPlan.platformFeeCents,
          config: consignmentPlan.config,
          idempotencyKey: `order-payment-${orderId}`,
        })
      : await hawalaService.processOrderPayment({
          customer_account_id: customerWallets[0].id,
          seller_account_id: sellerAccounts[0].id,
          order_id: orderId,
          total_amount: totalAmount,
          platform_fee_amount: platformFeeAmount,
          producer_id: producerId,
          auto_invest_percentage: autoInvestPercentage,
          idempotency_key: `order-payment-${orderId}`,
          // Subscription renewals get an explicit ledger reference
          // (ECONOMIC_REVIEW H3): the renewal cart stamps
          // metadata.subscription_id + renewal=true, and this is the ONE
          // money write for that order — typed here rather than posted as a
          // second entry, which would double-move the funds.
          ...(renewalSubscriptionId
            ? {
                reference_type: "SUBSCRIPTION_RENEWAL",
                reference_id: renewalSubscriptionId,
              }
            : {}),
        })

    log.info(`[Hawala] Order ${orderId} processed: ${entries.length} ledger entries created`)

    // §3 bridge: post to the vendor's private ledger room. order.total is in
    // CENTS already, which is exactly the minor-units the contract wants.
    const ledgerTxId =
      (entries[0] as unknown as { id?: string } | undefined)?.id ?? `order-payment-${orderId}`
    await emitBlackoutEvent(
      container,
      "ledger.payment_received",
      {
        vendorId: sellerId,
        orderId,
        amountMinorUnits: Math.round(Number(order.total)),
        currency: String(order.currency_code || "USD").toUpperCase(),
        ledgerTxId,
      },
      { eventId: `ledger.payment_received:${orderId}` }
    )
  } catch (error) {
    log.error(`[Hawala] Error processing order ${orderId}:`, error)
    // Don't throw - order completion should not fail due to ledger issues
  }
}

/**
 * Resolve the order's consignment split config. Called only on the
 * FBM_CONSIGNMENT_SPLIT_LIVE path. The retrieved order already carries
 * items.product_id; the products' metadata + listing-type link are read via
 * query.graph (same shape as the unique-inventory-sold subscriber). Any
 * lookup failure returns null so money still moves through the plain seller
 * leg exactly as today.
 */
async function lookupOrderConsignment(
  container: { resolve: (key: string) => any },
  order: { id: string; items?: Array<{ product_id?: string | null } | null> | null },
  vendorSellerId: string
): Promise<ConsignmentConfig | null> {
  try {
    const items = (order.items ?? []).filter(
      (item): item is { product_id?: string | null } => !!item
    )
    const itemProductIds = items.map((item) => item.product_id)
    const productIds = [
      ...new Set(itemProductIds.filter((id): id is string => !!id)),
    ]
    let products: unknown[] = []
    if (productIds.length > 0) {
      const query = container.resolve("query")
      const { data } = await query.graph({
        entity: "product",
        fields: ["id", "metadata", "listing_type.catalog_id"],
        filters: { id: productIds },
      })
      products = data ?? []
    }
    const resolution = resolveOrderConsignment({
      item_product_ids: itemProductIds,
      products: products as any[],
      vendor_seller_id: vendorSellerId,
    })
    if (!resolution.config && resolution.reason !== "no_consignment_products") {
      log.warn(
        `[Hawala] Order ${order.id} consignment split skipped: ${resolution.reason}`
      )
    }
    // consignor_seller_id is vendor-editable product metadata. Verify it names a
    // real seller before routing order revenue to it — otherwise
    // getOrCreateSellerEarnings would mint earnings for an arbitrary id. On no
    // match, fall back to the plain seller leg (no split).
    if (resolution.config) {
      const query = container.resolve("query")
      const { data: sellers } = await query.graph({
        entity: "seller",
        fields: ["id"],
        filters: { id: resolution.config.consignor_seller_id },
      })
      if (!sellers?.length) {
        log.warn(
          `[Hawala] Order ${order.id} consignment split skipped: unknown consignor ${resolution.config.consignor_seller_id}`
        )
        return null
      }
    }
    return resolution.config
  } catch (error) {
    log.warn(
      `[Hawala] Could not resolve consignment config for order ${order.id}; using plain seller leg:`,
      error
    )
    return null
  }
}

/**
 * Consignment order fan-out (FBM_CONSIGNMENT_SPLIT_LIVE only). Legs 1-2
 * mirror processOrderPayment exactly — same entry types and `-purchase` /
 * `-fee` idempotency keys — so an event redelivery that crosses a flag flip
 * can never double-move them; the seller-side amount then goes through
 * processConsignmentSplit (`-consignor` / `-vendor` legs) instead of the
 * single `-seller` leg. All inputs are integer cents; createTransfer takes
 * major units (cents / 100).
 */
async function processConsignmentOrderPayment(
  hawalaService: HawalaLedgerModuleService,
  args: {
    customerAccountId: string
    orderId: string
    currencyCode: string
    vendorSellerId: string
    totalCents: number
    platformFeeCents: number
    config: ConsignmentConfig
    idempotencyKey: string
  }
) {
  const escrowAccount = await hawalaService.getOrCreateSystemAccount("ESCROW")
  const platformAccount = await hawalaService.getOrCreateSystemAccount(
    "PLATFORM_FEE"
  )

  // 1. Customer pays full amount to escrow first
  const purchaseEntry = await hawalaService.createTransfer({
    debit_account_id: args.customerAccountId,
    credit_account_id: escrowAccount.id,
    amount: args.totalCents / 100,
    entry_type: "PURCHASE",
    order_id: args.orderId,
    idempotency_key: `${args.idempotencyKey}-purchase`,
  })

  // 2. Platform fee from escrow to platform
  const feeEntry = await hawalaService.createTransfer({
    debit_account_id: escrowAccount.id,
    credit_account_id: platformAccount.id,
    amount: args.platformFeeCents / 100,
    entry_type: "COMMISSION",
    order_id: args.orderId,
    idempotency_key: `${args.idempotencyKey}-fee`,
  })

  // 3. Seller-side amount split escrow->consignor + escrow->vendor
  const splitEntries = await hawalaService.processConsignmentSplit({
    orderId: args.orderId,
    sellerAmountCents: args.totalCents - args.platformFeeCents,
    currencyCode: args.currencyCode,
    vendorSellerId: args.vendorSellerId,
    consignorSellerId: args.config.consignor_seller_id,
    consignorBps: args.config.consignor_bps,
    idempotencyKey: args.idempotencyKey,
  })

  return [purchaseEntry, feeEntry, ...splitEntries]
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
