import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { DONATION_MODULE } from "../modules/donation"
import DonationModuleService from "../modules/donation/service"
import { TENANCY_MODULE } from "../modules/tenancy"
import TenancyModuleService from "../modules/tenancy/service"
import { getOrderCartMetadata } from "../lib/cart-metadata-recovery"

export default async function donationOrderAccruedSubscriber({ event, container }: SubscriberArgs<{ id: string }>) {
  const donationService = container.resolve<DonationModuleService>(DONATION_MODULE)
  const tenancyService = container.resolve<TenancyModuleService>(TENANCY_MODULE)
  const orderService = container.resolve("order")

  const order = await orderService.retrieveOrder(event.data.id, { relations: ["items"] })

  // The storefront writes these onto the CART
  // (`storefront/src/lib/data/donations.ts` `setCartDonationPreferences`), and
  // FBM's main checkout path drops cart metadata on the floor — see
  // `lib/cart-metadata-recovery.ts` and D9-5. Reading `order.metadata`
  // directly meant `beneficiaryId` was always "" and `donationTotal` always 0
  // on that path, so the guard below returned early and **the donation a
  // buyer chose at checkout was silently never accrued**. Nothing failed
  // loudly: the beneficiary's balance simply never moved.
  const metadata = await getOrderCartMetadata(container, order, [
    "donation_total",
    "donation_beneficiary_id",
    "storefront_id",
  ])

  const donationTotal = Number(metadata?.donation_total || 0)
  const beneficiaryId = String(metadata?.donation_beneficiary_id || "")
  const storefrontId = String(metadata?.storefront_id || "")

  if (!beneficiaryId || donationTotal <= 0) {
    return
  }

  const tenancyContext = storefrontId
    ? await tenancyService.resolveContext({ storefront_id: storefrontId })
    : { tier: "tier0_public" as const }

  const gates = tenancyService.featureGatesForTier(tenancyContext.tier)
  if (!gates.donation_routing) {
    return
  }

  const beneficiary = await donationService.retrieveDonationBeneficiary(beneficiaryId).catch(() => null)
  if (!beneficiary) {
    return
  }

  const currentBalance = Number((beneficiary.metadata as any)?.accrued_balance || 0)

  await donationService.updateDonationBeneficiaries({
    id: beneficiary.id,
    metadata: {
      ...(beneficiary.metadata as Record<string, unknown>),
      accrued_balance: currentBalance + donationTotal,
      currency_code: order.currency_code || "usd",
      last_order_id: order.id,
      storefront_id: storefrontId || "default",
    },
  })
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
