import type { MedusaContainer } from "@medusajs/framework/types"
import { VENDOR_RULES_MODULE } from "../modules/vendor-rules"
import type VendorRulesService from "../modules/vendor-rules/service"
import type { TermsBearingTier } from "../modules/accounts-receivable/terms"
import { createLogger } from "./logger"

const log = createLogger("shared/ar-tiers")

/**
 * A seller's customer tiers, in the shape the AR policy reads.
 *
 * The composition point between `vendor-rules` (which owns tiers, and so owns
 * `payment_terms_days` and `credit_limit_cents`) and `accounts-receivable`
 * (which enforces them). Neither module resolves the other, matching how
 * `cross-channel-revenue` joins payout-breakdown to channel-connector.
 *
 * Degrades to an empty list rather than throwing. An empty list means "no
 * tier applies", which `resolveTermsDays` reads as due-on-receipt and
 * `resolveCreditLimitCents` reads as no ceiling — the strictest terms and the
 * loosest limit. That asymmetry is deliberate: if tiers cannot be read, the
 * safe failure is to not extend credit terms the vendor may not have granted,
 * while still not blocking an invoice from being written.
 */
export async function loadTiersForSeller(
  container: MedusaContainer,
  sellerId: string
): Promise<TermsBearingTier[]> {
  try {
    const service = container.resolve<VendorRulesService>(VENDOR_RULES_MODULE)
    const rows = (await service.listVendorCustomerTiers({
      seller_id: sellerId,
    })) as unknown as TermsBearingTier[]
    return rows ?? []
  } catch (err) {
    log.warn(`[ar-tiers] tier read failed for ${sellerId}`, err)
    return []
  }
}
