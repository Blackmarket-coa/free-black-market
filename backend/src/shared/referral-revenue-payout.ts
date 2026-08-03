import type { MedusaContainer } from "@medusajs/framework/types"
import { createLogger } from "./logger"
import { HAWALA_LEDGER_MODULE } from "../modules/hawala-ledger"
import type { ReferralShareAllocation } from "../modules/payout-breakdown/referral-revenue-share"

const log = createLogger("shared/referral-revenue-payout")

/**
 * Move a referrer's share from the platform-fee account to their
 * seller-earnings account.
 *
 * A near-twin of `plugin-revenue-payout.ts` — same debit side (`PLATFORM_FEE`,
 * never escrow), same balance-guarded defer instead of overdraft, same
 * never-throws posture, because a referral share is the least important thing
 * on an order and must never fail the settlement that funds it. The one
 * difference is the payee count: a referral is a single seller, so there is one
 * leg, not an allocation set.
 *
 * Idempotency is keyed on `(order, referred_seller_id)`: an order has at most
 * one referral share, and keying on the referred seller (rather than the
 * referrer) means a re-run of the same order's settlement collides with itself
 * even if the attribution row changed underneath.
 */
export type ReferralPayoutResult = {
  transferred: number
  deferred: number
  failed: number
}

type HawalaService = {
  getOrCreateSystemAccount: (accountType: string) => Promise<{ id: string }>
  getOrCreateSellerEarnings: (
    sellerId: string,
    currencyCode?: string
  ) => Promise<{ id: string }>
  getAccountBalance: (id: string) => Promise<{ available_balance: number }>
  createTransfer: (data: Record<string, unknown>) => Promise<{ id: string }>
}

export async function disburseReferralShare(
  container: MedusaContainer,
  args: {
    orderId: string
    currencyCode?: string
    allocation: ReferralShareAllocation | null
  }
): Promise<ReferralPayoutResult> {
  const result: ReferralPayoutResult = { transferred: 0, deferred: 0, failed: 0 }
  const allocation = args.allocation
  if (!allocation || allocation.amount_cents <= 0) return result

  // A self-referral must never move money, even if a stale allocation reached
  // here — the compute already excludes it, this is the belt to that braces.
  if (allocation.referrer_seller_id === allocation.referred_seller_id) {
    return result
  }

  const currency = (args.currencyCode || "USD").toUpperCase()

  let hawala: HawalaService
  let platformAccount: { id: string }
  try {
    hawala = container.resolve(HAWALA_LEDGER_MODULE) as unknown as HawalaService
    platformAccount = await hawala.getOrCreateSystemAccount("PLATFORM_FEE")
  } catch (err) {
    log.warn(
      `[referral-payout] ledger unavailable for order ${args.orderId}; share not disbursed`,
      err
    )
    result.failed = 1
    return result
  }

  try {
    const referrerAccount = await hawala.getOrCreateSellerEarnings(
      allocation.referrer_seller_id,
      currency
    )

    // The platform-fee leg may not have posted yet on a slow settlement.
    // Defer rather than overdraw the platform account against money it has not
    // yet received — a later reconciliation pays what is owed.
    const balance = await hawala.getAccountBalance(platformAccount.id)
    const amountDollars = allocation.amount_cents / 100
    if (Number(balance.available_balance) < amountDollars) {
      result.deferred = 1
      log.warn(
        `[referral-payout] deferring referral share on order ${args.orderId}: platform balance below ${amountDollars}`
      )
      return result
    }

    await hawala.createTransfer({
      debit_account_id: platformAccount.id,
      credit_account_id: referrerAccount.id,
      amount: amountDollars,
      entry_type: "COMMISSION",
      reference_type: "ORDER",
      reference_id: args.orderId,
      order_id: args.orderId,
      idempotency_key: `referral-share:${args.orderId}:${allocation.referred_seller_id}`,
      description: `Referral share for ${allocation.referred_seller_id} (order ${args.orderId})`,
      metadata: {
        referrer_seller_id: allocation.referrer_seller_id,
        referred_seller_id: allocation.referred_seller_id,
        amount_cents: allocation.amount_cents,
      },
    })
    result.transferred = 1
  } catch (err) {
    result.failed = 1
    log.warn(
      `[referral-payout] failed referral share on order ${args.orderId}`,
      err
    )
  }

  return result
}
