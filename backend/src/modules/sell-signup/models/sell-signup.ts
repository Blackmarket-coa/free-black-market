import { model } from "@medusajs/framework/utils"

/**
 * Captures from the storefront "Sell on Free Black Market" landing
 * page. The storefront fires a best-effort POST with the email +
 * store_name + chosen sale categories before redirecting the user to
 * the vendor-panel registration flow, so even users who abandon mid
 * registration end up in the leads table.
 *
 * Network/UA fields are recorded for downstream spam triage; we do
 * not record the user's session token or any vendor-panel cookies.
 *
 * `status` is admin-managed (new → contacted → converted / rejected).
 */
const SellSignup = model.define("sell_signup", {
  id: model.id().primaryKey(),
  email: model.text(),
  store_name: model.text(),
  selling: model.json(),
  status: model
    .enum(["new", "contacted", "converted", "rejected"])
    .default("new"),
  source_ip: model.text().nullable(),
  user_agent: model.text().nullable(),
  referer: model.text().nullable(),
  metadata: model.json().nullable(),
})

export default SellSignup
