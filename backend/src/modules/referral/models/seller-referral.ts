import { model } from "@medusajs/framework/utils"
import { ReferralSource, ReferralStatus } from "../attribution"

/**
 * A record that one seller referred another onto the platform.
 *
 * One row per referred seller — `referred_seller_id` is unique among live rows,
 * so a seller has at most one referrer and the earning share can never fork.
 * The referrer is itself a seller, so the share is paid through the same
 * seller-earnings rail plugin developers are paid on.
 *
 * Self-referral is blocked three ways: the write path
 * (`isValidAttribution`), the earning rule (`isReferralEarning`), and the
 * `CK_seller_referral_not_self` CHECK — a seller paying themselves out of their
 * own orders is a laundering shape, not a referral.
 */
const SellerReferral = model
  .define("seller_referral", {
    id: model.id().primaryKey(),

    /** The seller who was referred. At most one live row per value. */
    referred_seller_id: model.text(),
    /** The seller owed a share while the referral earns. */
    referrer_seller_id: model.text(),

    status: model
      .enum(Object.values(ReferralStatus))
      .default(ReferralStatus.ACTIVE),
    source: model.enum(Object.values(ReferralSource)),

    attributed_at: model.dateTime(),
    /** When the earning window closes. Null means it never lapses on its own. */
    expires_at: model.dateTime().nullable(),

    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["referred_seller_id"],
      name: "IDX_seller_referral_referred",
      unique: true,
      where: "deleted_at IS NULL",
    },
    {
      on: ["referrer_seller_id", "status"],
      name: "IDX_seller_referral_referrer_status",
      where: "deleted_at IS NULL",
    },
  ])

export default SellerReferral
