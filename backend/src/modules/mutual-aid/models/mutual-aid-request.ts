import { model } from "@medusajs/framework/utils"

export enum AidRequestStatus {
  OPEN = "OPEN",
  MATCHED = "MATCHED",
  FULFILLED = "FULFILLED",
  WITHDRAWN = "WITHDRAWN",
  EXPIRED = "EXPIRED",
}

export enum AidUrgency {
  ROUTINE = "ROUTINE",
  SOON = "SOON",
  URGENT = "URGENT",
}

/**
 * Someone asking for help.
 *
 * ## Location is split on purpose
 *
 * `latitude`/`longitude` are precise enough to route a delivery, and they
 * describe where a person in need actually is. That is not public information,
 * and it is not information a stranger browsing a map should be able to
 * de-anonymise. So the model carries both a precise pair used for matching and
 * fulfilment, and a coarse `locality` label that is the only thing listings are
 * allowed to show. `lib/aid-location.ts` does the narrowing; nothing should
 * hand these columns to a response directly.
 *
 * The precise pair is nullable because a request does not require a location at
 * all — plenty of needs are met remotely, and demanding coordinates from
 * someone asking for help to make the schema tidier would be the wrong trade.
 */
const MutualAidRequest = model.define("mutual_aid_request", {
  id: model.id().primaryKey(),

  requester_id: model.text(),

  title: model.text().searchable(),
  description: model.text(),
  category: model.text().nullable(),

  urgency: model.enum(Object.values(AidUrgency)).default(AidUrgency.ROUTINE),
  status: model.enum(Object.values(AidRequestStatus)).default(AidRequestStatus.OPEN),

  quantity: model.number().nullable(),
  unit_of_measure: model.text().nullable(),

  // Private: matching and fulfilment only. Never serialise these.
  latitude: model.float().nullable(),
  longitude: model.float().nullable(),
  // Public: a coarse label such as a neighbourhood or town.
  locality: model.text().nullable(),

  needed_by: model.dateTime().nullable(),

  /** The offer, if any, that took this on. */
  matched_offer_id: model.text().nullable(),
  matched_helper_id: model.text().nullable(),
  matched_at: model.dateTime().nullable(),
  fulfilled_at: model.dateTime().nullable(),

  metadata: model.json().nullable(),
}).indexes([
  { on: ["status"], name: "IDX_aid_request_status" },
  { on: ["requester_id"], name: "IDX_aid_request_requester" },
  { on: ["category"], name: "IDX_aid_request_category" },
  { on: ["matched_helper_id"], name: "IDX_aid_request_helper" },
])

export default MutualAidRequest
