import type { MedusaContainer } from "@medusajs/framework/types"
import { createLogger } from "./logger"
import { HAWALA_LEDGER_MODULE } from "../modules/hawala-ledger"
import type { PluginShareAllocation } from "../modules/payout-breakdown/plugin-revenue-share"

const log = createLogger("shared/plugin-revenue-payout")

/**
 * Move each plugin developer's share from the platform-fee account to their
 * seller-earnings account.
 *
 * Follows `grower-payout.ts`'s hub-cut pattern exactly, for the same reasons:
 * idempotent per logical leg, balance-guarded, and never throwing. This runs
 * AFTER the base order payment has settled, and a revenue share is the least
 * important thing happening on an order — it must never be able to fail the
 * settlement that funds it.
 *
 * The debit side is `PLATFORM_FEE`, never escrow: the share is carved out of
 * money the platform has already collected, so at no point does an unfunded
 * transfer touch the customer's payment.
 */
export type PluginPayoutResult = {
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

export async function disbursePluginDeveloperShare(
  container: MedusaContainer,
  args: {
    orderId: string
    sellerId: string
    currencyCode?: string
    allocations: PluginShareAllocation[]
  }
): Promise<PluginPayoutResult> {
  const result: PluginPayoutResult = { transferred: 0, deferred: 0, failed: 0 }
  if (!args.allocations.length) return result

  const currency = (args.currencyCode || "USD").toUpperCase()

  let hawala: HawalaService
  let platformAccount: { id: string }
  try {
    hawala = container.resolve(HAWALA_LEDGER_MODULE) as unknown as HawalaService
    platformAccount = await hawala.getOrCreateSystemAccount("PLATFORM_FEE")
  } catch (err) {
    log.warn(
      `[plugin-payout] ledger unavailable for order ${args.orderId}; share not disbursed`,
      err
    )
    result.failed = args.allocations.length
    return result
  }

  for (const allocation of args.allocations) {
    try {
      const developerAccount = await hawala.getOrCreateSellerEarnings(
        allocation.author_seller_id,
        currency
      )

      // The platform-fee leg may not have posted yet on a slow settlement.
      // Deferring is right: the money is owed and the order is recorded, so a
      // later reconciliation can pay it, whereas an overdraft here would put
      // the platform account negative against money it has not received.
      const balance = await hawala.getAccountBalance(platformAccount.id)
      const amountDollars = allocation.amount_cents / 100
      if (Number(balance.available_balance) < amountDollars) {
        result.deferred++
        log.warn(
          `[plugin-payout] deferring ${allocation.slug} share on order ${args.orderId}: platform balance below ${amountDollars}`
        )
        continue
      }

      await hawala.createTransfer({
        debit_account_id: platformAccount.id,
        credit_account_id: developerAccount.id,
        amount: amountDollars,
        entry_type: "COMMISSION",
        reference_type: "ORDER",
        reference_id: args.orderId,
        order_id: args.orderId,
        // Keyed on the slug, not the developer: one developer with two
        // installed plugins is owed two shares, and keying on them would
        // silently collapse the second.
        idempotency_key: `plugin-share:${args.orderId}:${allocation.slug}`,
        description: `Plugin developer share for ${allocation.slug} (order ${args.orderId})`,
        metadata: {
          plugin_slug: allocation.slug,
          developer_seller_id: allocation.author_seller_id,
          selling_seller_id: args.sellerId,
          amount_cents: allocation.amount_cents,
        },
      })
      result.transferred++
    } catch (err) {
      // One developer's failed leg must not stop the others being paid.
      result.failed++
      log.warn(
        `[plugin-payout] failed ${allocation.slug} share on order ${args.orderId}`,
        err
      )
    }
  }

  return result
}
