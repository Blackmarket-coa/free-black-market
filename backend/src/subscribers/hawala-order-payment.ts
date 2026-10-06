import { createLogger } from "../shared/logger"
const log = createLogger("subscribers/hawala-order-payment")
import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { HAWALA_LEDGER_MODULE } from "../modules/hawala-ledger"
import HawalaLedgerModuleService from "../modules/hawala-ledger/service"
import { PAYOUT_BREAKDOWN_MODULE } from "../modules/payout-breakdown"
import PayoutBreakdownService from "../modules/payout-breakdown/service"
import { CREATOR_ATTRIBUTION_MODULE } from "../modules/creator-attribution"
import type CreatorAttributionService from "../modules/creator-attribution/service"
import { emitBlackoutEvent } from "../lib/blackout-emit"
import { feeFirstSplitEnabled, resolveSellerPlatformFee } from "../shared/platform-fee"
import {
  DEFAULT_PROCESSING_FIXED_CENTS,
  DEFAULT_PROCESSING_PERCENT,
  computeFeeFirstSplit,
  type FeeFirstSplit,
} from "../modules/payout-breakdown/fee-first"
import { resolveSellerPluginPayees } from "../shared/plugin-payees"
import { disbursePluginDeveloperShare } from "../shared/plugin-revenue-payout"
import { resolveSellerReferralPayee } from "../shared/referral-payees"
import { disburseReferralShare } from "../shared/referral-revenue-payout"
import { CARD_PROCESSING_LEG } from "../modules/hawala-ledger/card-processing"
import { CARD_FUNDING, isFbmCardProvider } from "../modules/hawala-ledger/card-clearing"
import { featureFlagState } from "../shared/feature-flags"
import { STRIPE_CONNECT_DIRECT_PROVIDER_ID } from "../modules/stripe-connect-direct/registration"
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
  const orderId = event.data.id

  // SD-36 (FF_CARD_ORDER_LEDGER_V1, hawala-ledger/card-clearing.ts). With the
  // flag off nothing here runs — no extra read — and settlement is exactly
  // the old path. On: an order paid through FBM's own Stripe account is only
  // AUTHORISED at placement (manual capture), so it settles on
  // `payment.captured` instead (`hawala-card-capture.ts`); a Stripe Connect
  // direct charge is the partner's money and never settles here. Anything
  // else (no payment found, another provider, a failed read) keeps the old
  // wallet path.
  if (cardOrderLedgerEnabled()) {
    const funding = await resolveOrderFunding(container, orderId)
    if (funding === "fbm_card") {
      log.info(`[Hawala] Order ${orderId} is a card order; it settles when Stripe captures the payment`)
      return
    }
    if (funding === "connect_direct") {
      log.info(`[Hawala] Order ${orderId} was charged on a partner's connected account; nothing settles through FBM's ledger`)
      return
    }
  }

  await settleOrderPayment(container, orderId, { funding: "wallet" })
}

export function cardOrderLedgerEnabled(): boolean {
  return featureFlagState.isEnabled("CARD_ORDER_LEDGER_V1")
}

export type OrderFunding = "fbm_card" | "connect_direct" | "other"

/**
 * How an order was paid, from its payment collections' payments (sessions as
 * a fallback, for a payment not yet created). Any FBM Stripe payment makes it
 * a card order; any Stripe Connect direct payment makes it the partner's.
 * "other" for anything else, including a failed read — the caller then keeps
 * the pre-SD-36 path, which posts nothing for a card order anyway.
 */
export async function resolveOrderFunding(
  container: SubscriberArgs<{ id: string }>["container"],
  orderId: string
): Promise<OrderFunding> {
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "payment_collections.payments.provider_id",
        "payment_collections.payment_sessions.provider_id",
        "payment_collections.payment_sessions.status",
      ],
      filters: { id: orderId },
    })
    const order = (data as Array<Record<string, unknown>>)[0]
    const collections = (order?.payment_collections ?? []) as Array<{
      payments?: Array<{ provider_id?: string | null } | null> | null
      payment_sessions?: Array<{ provider_id?: string | null; status?: string | null } | null> | null
    } | null>
    const providers: string[] = []
    for (const c of collections) {
      for (const p of c?.payments ?? []) if (p?.provider_id) providers.push(p.provider_id)
    }
    if (providers.length === 0) {
      for (const c of collections) {
        for (const ps of c?.payment_sessions ?? []) {
          if (ps?.provider_id && ps.status === "authorized") providers.push(ps.provider_id)
        }
      }
    }
    if (providers.some((p) => p === STRIPE_CONNECT_DIRECT_PROVIDER_ID)) return "connect_direct"
    if (providers.some(isFbmCardProvider)) return "fbm_card"
    return "other"
  } catch (error) {
    log.warn(`[Hawala] Could not read how order ${orderId} was paid; using the wallet path:`, error)
    return "other"
  }
}

/**
 * Settle one order through the ledger: the breakdown record, then the
 * purchase / fee / processing / seller legs. `funding` decides where the
 * purchase leg comes from:
 *
 *   - "wallet" (the pre-SD-36 path, and the only one with the flag off): the
 *     customer's USER_WALLET, created at $0 when missing.
 *   - "card_clearing" (`payment.captured`, flag on): the card-clearing
 *     account — money FBM's Stripe account received. No wallet is read,
 *     created or touched. Refunds then return to clearing (the card),
 *     because `processRefund` credits the purchase leg's debit account.
 *
 * Idempotent across both: the `-purchase` key is the same, so an order that
 * already settled either way is skipped.
 */
export async function settleOrderPayment(
  container: SubscriberArgs<{ id: string }>["container"],
  orderId: string,
  opts: { funding: "wallet" } | { funding: "card_clearing"; paymentId: string }
) {
  const hawalaService = container.resolve<HawalaLedgerModuleService>(HAWALA_LEDGER_MODULE)
  const payoutService = container.resolve<PayoutBreakdownService>(PAYOUT_BREAKDOWN_MODULE)
  const orderModuleService = container.resolve("order")

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

    // Where the purchase leg comes from. A card order never reads, creates
    // or touches a customer wallet (Posture A: no customer-held balance).
    // The clearing account itself is looked up only once the order is known
    // not to be settled already (below), so a redelivery creates nothing.
    let purchaseAccountId: string | null = null
    let purchaseMetadata: Record<string, unknown> | undefined
    if (opts.funding === "card_clearing") {
      purchaseMetadata = { funding: CARD_FUNDING, payment_id: opts.paymentId, customer_id: customerId }
    } else {
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
      purchaseAccountId = customerWallets[0].id
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

    // Fee-first split (FF_FEE_FIRST_SPLIT_V1, Black Mask F6), decided HERE at
    // the composition point. On: the card-processing estimate is taken on
    // the WHOLE amount FBM's Stripe account charged (order.total, all of which
    // sits in this one seller's leg — tax, delivery and tip included), comes
    // off first, and the commission is taken on what is left — the same pure
    // function, with the same inputs, that `calculateBreakdown` runs below,
    // so the ledger COMMISSION is the stored breakdown's platform fee to the
    // cent. Both use ONE fee base (`subtotal ?? total`), in integer cents.
    // Off: `feeFirst` is null and every amount below is the pre-F6 expression,
    // including the unrounded dollar fee (a known defect kept byte-identical
    // rather than changed under a flag that is not set).
    const feeFirst: (FeeFirstSplit & { configFallback: boolean }) | null = feeFirstSplitEnabled()
      ? await orderFeeFirstSplit(payoutService, {
          sellerId,
          feeBaseCents: Math.round(Number(order.subtotal ?? order.total)),
          chargedCents: Math.round(Number(order.total)),
          feePercent: platformFeePercent,
        })
      : null
    const feeFirstSeller = feeFirst?.sellers[0] ?? null
    const platformFeeAmount = feeFirstSeller
      ? feeFirstSeller.commissionCents / 100
      : feeBaseAmount * (platformFeePercent / 100)
    const processingFeeCents = feeFirstSeller?.processingCents ?? 0

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

    // Captured here and disbursed AFTER the settlement leg below, which is
    // what actually funds the PLATFORM_FEE account these shares are carved
    // from. Disbursing inside the breakdown block ran BEFORE that leg, so on a
    // cold PLATFORM_FEE account every share hit the disbursers' balance guard
    // and deferred — and nothing retries a deferred share, so payees were only
    // ever paid out of residue left by earlier orders.
    let settledBreakdown:
      | Awaited<ReturnType<typeof payoutService.calculateBreakdown>>
      | null = null

    // Store the breakdown for this order (for transparency reporting)
    try {
      const payoutConfig = await payoutService.getDefaultConfig()
      const pluginSharePercent = Number(payoutConfig.plugin_developer_percent ?? 0)
      const referralSharePercent = Number(payoutConfig.referral_percent ?? 0)

      const breakdown = await payoutService.calculateBreakdown({
        // Flag off: the pre-F6 base (`||`), unchanged. Fee-first: the ledger's
        // base, so the two cannot diverge on a zero subtotal.
        subtotal: feeFirst
          ? Math.round(Number(order.subtotal ?? order.total))
          : Number(order.subtotal || order.total),
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
        // Fee-first only; absent with the flag off so the input is unchanged.
        // The whole charge sits in this seller's leg, as it does in the ledger.
        // The processing figures are the ones the ledger legs were built
        // from (one config read), so the two cannot disagree.
        ...(feeFirst
          ? {
              feeFirst: {
                chargedCentsBySeller: { [sellerId]: feeFirst.chargedTotalCents },
                processing: {
                  percent: feeFirst.processingPercent,
                  fixedCents: feeFirst.processingFixedCents,
                },
              },
            }
          : {}),
      })
      await payoutService.storeOrderBreakdown(
        orderId,
        customerId,
        breakdown,
        order.currency_code
      )

      // The record of what is owed is now stored; the transfers themselves
      // wait for settlement.
      settledBreakdown = breakdown
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
      processingCents: number
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
        } else if (totalCents - processingFeeCents - platformFeeCents <= 0) {
          log.warn(
            `[Hawala] Order ${orderId} has no positive seller-side amount; skipping consignment split`
          )
        } else {
          consignmentPlan = {
            config,
            totalCents,
            platformFeeCents,
            processingCents: processingFeeCents,
          }
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
    if (purchaseAccountId === null) {
      purchaseAccountId = (await hawalaService.getOrCreateCardClearingAccount()).id
    }

    // Process order payment through ledger
    const entries = consignmentPlan
      ? await processConsignmentOrderPayment(hawalaService, {
          customerAccountId: purchaseAccountId,
          purchaseMetadata,
          orderId,
          currencyCode: String(order.currency_code || "USD").toUpperCase(),
          vendorSellerId: sellerId,
          totalCents: consignmentPlan.totalCents,
          platformFeeCents: consignmentPlan.platformFeeCents,
          processingCents: consignmentPlan.processingCents,
          processingMetadata: feeFirst ? processingMetadata(feeFirst) : undefined,
          config: consignmentPlan.config,
          idempotencyKey: `order-payment-${orderId}`,
        })
      : await hawalaService.processOrderPayment({
          customer_account_id: purchaseAccountId,
          ...(purchaseMetadata ? { purchase_metadata: purchaseMetadata } : {}),
          seller_account_id: sellerAccounts[0].id,
          order_id: orderId,
          total_amount: totalAmount,
          platform_fee_amount: platformFeeAmount,
          producer_id: producerId,
          auto_invest_percentage: autoInvestPercentage,
          idempotency_key: `order-payment-${orderId}`,
          // Fee-first only: the processing leg (escrow -> card-processing
          // account). Absent with the flag off, so the call is unchanged.
          ...(feeFirst
            ? {
                processing_fee_amount: processingFeeCents / 100,
                processing_metadata: processingMetadata(feeFirst),
              }
            : {}),
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

    // Platform-fee carve-outs, now that the settlement leg above has credited
    // PLATFORM_FEE. Both disbursers are idempotent and defer rather than
    // overdraw, so a failure here leaves the stored breakdown as the record of
    // what is still owed.
    if (settledBreakdown) {
      if (settledBreakdown.pluginShareAllocations.length > 0) {
        await disbursePluginDeveloperShare(container, {
          orderId,
          sellerId,
          currencyCode: order.currency_code,
          allocations: settledBreakdown.pluginShareAllocations,
        })
      }

      // Single-seller settlement here, so at most one referral allocation.
      if (settledBreakdown.referralShareAllocations.length > 0) {
        await disburseReferralShare(container, {
          orderId,
          currencyCode: order.currency_code,
          allocation: settledBreakdown.referralShareAllocations[0],
        })
      }
    }

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
    /** Card orders (SD-36): stamped on the purchase leg. */
    purchaseMetadata?: Record<string, unknown>
    orderId: string
    currencyCode: string
    vendorSellerId: string
    totalCents: number
    platformFeeCents: number
    /** Fee-first only (0 otherwise): the processing leg, before the split. */
    processingCents: number
    processingMetadata?: Record<string, unknown>
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
    ...(args.purchaseMetadata ? { metadata: args.purchaseMetadata } : {}),
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

  // 2b. Fee-first only: the card-processing estimate, escrow -> its own
  // account, under the same `-processing` key the plain path uses, so a
  // redelivery across an FBM_CONSIGNMENT_SPLIT_LIVE flip cannot post it twice.
  const processingEntries =
    args.processingCents > 0
      ? [
          await hawalaService.createTransfer({
            debit_account_id: escrowAccount.id,
            credit_account_id: (await hawalaService.getOrCreateCardProcessingAccount()).id,
            amount: args.processingCents / 100,
            entry_type: "FEE",
            description: "Card processing (estimate), taken off the sale before the platform fee",
            order_id: args.orderId,
            idempotency_key: `${args.idempotencyKey}-processing`,
            // Linked to its purchase exactly as the plain path's leg is.
            correlation_id: args.idempotencyKey,
            parent_entry_id: purchaseEntry?.id,
            metadata: { ...(args.processingMetadata ?? {}), leg: CARD_PROCESSING_LEG },
          }),
        ]
      : []

  // 3. Seller-side amount split escrow->consignor + escrow->vendor. With
  // fee-first on, processing came off first, so the consignor's bps apply to
  // what is left after processing and commission.
  const splitEntries = await hawalaService.processConsignmentSplit({
    orderId: args.orderId,
    sellerAmountCents: args.totalCents - args.processingCents - args.platformFeeCents,
    currencyCode: args.currencyCode,
    vendorSellerId: args.vendorSellerId,
    consignorSellerId: args.config.consignor_seller_id,
    consignorBps: args.config.consignor_bps,
    idempotencyKey: args.idempotencyKey,
  })

  return [purchaseEntry, feeEntry, ...processingEntries, ...splitEntries]
}

/**
 * The fee-first split for this single-seller order, from the payout config's
 * processing estimate. The same `computeFeeFirstSplit` call (same seller, fee
 * base, charge and rate) that `calculateBreakdown` makes when handed
 * `feeFirst`, so ledger and stored breakdown agree to the cent.
 */
async function orderFeeFirstSplit(
  payoutService: PayoutBreakdownService,
  args: { sellerId: string; feeBaseCents: number; chargedCents: number; feePercent: number }
): Promise<FeeFirstSplit & { configFallback: boolean }> {
  const { percent, fixedCents, configFallback } = await readProcessingEstimate(payoutService)
  const split = computeFeeFirstSplit({
    sellers: [
      {
        sellerId: args.sellerId,
        subtotalCents: args.feeBaseCents,
        chargedCents: args.chargedCents,
        feePercent: args.feePercent,
      },
    ],
    processingPercent: percent,
    processingFixedCents: fixedCents,
  })
  return { ...split, configFallback }
}

/**
 * The processing estimate from payout_config, read ONCE per settlement. A
 * failed read (or a row without usable figures) must not skip the whole
 * settlement — with the flag off a config failure only drops the breakdown —
 * so it falls back to the documented default (2.9% + 30¢, what
 * `getDefaultConfig` seeds) and the processing leg is stamped
 * `config_fallback: true`, so a later true-up can find it.
 */
async function readProcessingEstimate(
  payoutService: PayoutBreakdownService
): Promise<{ percent: number; fixedCents: number; configFallback: boolean }> {
  try {
    const config = await payoutService.getDefaultConfig()
    const percent = Number(config.payment_processing_percent)
    const fixedCents = Number(config.payment_processing_fixed)
    if (
      Number.isFinite(percent) && percent >= 0 && percent <= 100 &&
      Number.isSafeInteger(fixedCents) && fixedCents >= 0
    ) {
      return { percent, fixedCents, configFallback: false }
    }
    log.warn(
      `[Hawala] payout_config processing estimate unusable (${config.payment_processing_percent} / ` +
        `${config.payment_processing_fixed}); using the documented default`
    )
  } catch (error) {
    log.warn("[Hawala] Could not read payout_config for the processing estimate; using the documented default:", error)
  }
  return {
    percent: DEFAULT_PROCESSING_PERCENT,
    fixedCents: DEFAULT_PROCESSING_FIXED_CENTS,
    configFallback: true,
  }
}

/** Provenance stamped on the processing leg: what the estimate was built from. */
function processingMetadata(
  split: FeeFirstSplit & { configFallback?: boolean }
): Record<string, unknown> {
  return {
    estimate: true,
    processing_percent: split.processingPercent,
    processing_fixed_cents: split.processingFixedCents,
    charged_total_cents: split.chargedTotalCents,
    processing_total_cents: split.processingTotalCents,
    ...(split.configFallback ? { config_fallback: true } : {}),
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
