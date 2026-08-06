import { model } from "@medusajs/framework/utils"

export enum AidOfferStatus {
  AVAILABLE = "AVAILABLE",
  COMMITTED = "COMMITTED",
  SPENT = "SPENT",
  WITHDRAWN = "WITHDRAWN",
  EXPIRED = "EXPIRED",
}

/**
 * Someone saying what they can give.
 *
 * The mirror of `MutualAidRequest`, with the same location split: precise
 * coordinates for matching, a coarse `locality` for display. An offerer is
 * volunteering rather than asking, so the privacy stakes are lower — but the
 * asymmetry is not worth encoding, and treating both sides the same means one
 * projection helper covers everything.
 *
 * `service_radius_km` is what makes matching possible in the direction that
 * matters: a request has a place, and an offer has a reach.
 */
const MutualAidOffer = model.define("mutual_aid_offer", {
  id: model.id().primaryKey(),

  offerer_id: model.text(),

  title: model.text().searchable(),
  description: model.text(),
  category: model.text().nullable(),

  status: model.enum(Object.values(AidOfferStatus)).default(AidOfferStatus.AVAILABLE),

  quantity: model.number().nullable(),
  unit_of_measure: model.text().nullable(),

  // Private: matching only. Never serialise these.
  latitude: model.float().nullable(),
  longitude: model.float().nullable(),
  // Public: a coarse label such as a neighbourhood or town.
  locality: model.text().nullable(),

  /** How far the offerer can travel. Null means no stated limit. */
  service_radius_km: model.float().nullable(),

  available_until: model.dateTime().nullable(),

  metadata: model.json().nullable(),
}).indexes([
  { on: ["status"], name: "IDX_aid_offer_status" },
  { on: ["offerer_id"], name: "IDX_aid_offer_offerer" },
  { on: ["category"], name: "IDX_aid_offer_category" },
])

export default MutualAidOffer
