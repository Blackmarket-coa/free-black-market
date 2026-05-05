import { model } from "@medusajs/framework/utils"

export enum CreatorPayoutProvider {
  STRIPE_CONNECT = "stripe_connect",
  HAWALA = "hawala",
  MANUAL = "manual",
}

export enum CreatorPayoutStatus {
  PENDING = "pending",
  ACTIVE = "active",
  RESTRICTED = "restricted",
  SUSPENDED = "suspended",
}

const CreatorPayoutAccount = model
  .define("creator_payout_account", {
    id: model.id().primaryKey(),

    seller_id: model.text().unique(),
    provider: model
      .enum(Object.values(CreatorPayoutProvider))
      .default(CreatorPayoutProvider.MANUAL),

    external_account_id: model.text().nullable(),
    onboarding_url: model.text().nullable(),
    status: model
      .enum(Object.values(CreatorPayoutStatus))
      .default(CreatorPayoutStatus.PENDING),

    last_payout_at: model.dateTime().nullable(),
    provider_metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["status"],
      name: "IDX_creator_payout_account_status",
    },
  ])

export default CreatorPayoutAccount
