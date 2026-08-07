import { Module } from "@medusajs/framework/utils"
import CottageFoodModuleService from "./service"

/**
 * Cottage Food Module
 *
 * Support for home-based food sellers — people baking, canning, and cooking
 * out of their own kitchens under cottage food and home-kitchen permits.
 *
 * The module holds three things:
 *
 * 1. A **self-declared compliance profile**. FBM ships no state-law table and
 *    makes no legal determination about anyone's operation. The seller enters
 *    their own jurisdiction, permit, caps, and the exact disclosure sentence
 *    their county requires; the platform tracks against what they entered.
 *    This works in every state and county on day one and avoids FBM asserting
 *    legal facts it can't stand behind.
 *
 * 2. A **sales ledger** feeding the meters that matter to a home producer: how
 *    much of their declared annual cap they've used, and — for people selling
 *    cooked meals — how many meals they've committed to today and this week.
 *    Off-platform sales can be entered by hand, because farmers-market cash
 *    counts toward the same cap and a meter that ignores it is worse than none.
 *
 * 3. **Product labels**, composed from the seller's ingredients, Big-9
 *    allergens, net weight, and their own disclosure wording.
 *
 * **This module never blocks a sale.** Nothing here is wired into cart
 * validation, no method returns a pass/fail verdict, and the advisories it
 * produces are sentences for a human to read. The seller is the authority on
 * their own compliance; FBM's job is to count accurately and show them the
 * number.
 */
export const COTTAGE_FOOD_MODULE = "cottageFoodModuleService"

export default Module(COTTAGE_FOOD_MODULE, {
  service: CottageFoodModuleService,
})

export * from "./models"
export type {
  ComplianceSnapshot,
  MeterView,
  ExpiryStatus,
  RecordSaleInput,
} from "./service"
