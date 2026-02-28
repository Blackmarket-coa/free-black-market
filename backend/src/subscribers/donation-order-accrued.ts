import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { DONATION_MODULE } from "../modules/donation"
import DonationModuleService from "../modules/donation/service"

export default async function donationOrderAccruedSubscriber({ event, container }: SubscriberArgs<{ id: string }>) {
  const donationService = container.resolve<DonationModuleService>(DONATION_MODULE)
  const orderService = container.resolve("order")

  const order = await orderService.retrieveOrder(event.data.id, { relations: ["items"] })
  const donationTotal = Number((order.metadata as any)?.donation_total || 0)
  const beneficiaryId = String((order.metadata as any)?.donation_beneficiary_id || "")

  if (!beneficiaryId || donationTotal <= 0) {
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
    },
  })
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
