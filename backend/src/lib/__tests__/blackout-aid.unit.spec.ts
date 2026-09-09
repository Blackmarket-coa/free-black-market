import { toBlackoutAidFields, aidEventTypeFor } from "../blackout-aid"

/**
 * The §3.8 wire shape. This is the whole of what FreeBlackMarket tells Blackout
 * about a mutual-aid ask, and Blackout's Coalition board publishes what it
 * receives verbatim — so a field reaching this function reaches the world.
 *
 * There are two whitelists in series here, and it is worth being clear about
 * which one these tests pin. `toPublicAid` is the first; the explicit nine-key
 * object literal in `toBlackoutAidFields` is the second, and it is the one the
 * assertions below actually hold in place — swapping the projection out for the
 * raw row leaves them almost all green, because the literal still names only
 * nine fields. The projection call earns its place by keeping the status and
 * locality normalisation in one place, not by being the last line of defence.
 */
const row = (over: Record<string, unknown> = {}) => ({
  id: "mar_1",
  requester_id: "cus_asker",
  title: "Ride to a dialysis appointment",
  description: "Tuesdays and Thursdays, 8am",
  category: "transport",
  status: "OPEN",
  urgency: "URGENT",
  quantity: null,
  unit_of_measure: null,
  latitude: 42.3314,
  longitude: -83.0458,
  locality: "Southwest Detroit",
  needed_by: new Date("2026-12-01T00:00:00.000Z"),
  matched_offer_id: "mao_1",
  matched_helper_id: "cus_helper",
  metadata: { note: "third floor, no lift" },
  created_at: new Date("2026-09-08T11:00:00.000Z"),
  ...over,
})

describe("toBlackoutAidFields", () => {
  it("carries the coarse locality and renames the id to a foreign key", () => {
    const fields = toBlackoutAidFields(row())

    expect(fields.requestId).toBe("mar_1")
    expect(fields.locality).toBe("Southwest Detroit")
    expect(fields.title).toBe("Ride to a dialysis appointment")
    expect(fields.status).toBe("OPEN")
    expect(fields.createdAt).toBe("2026-09-08T11:00:00.000Z")
  })

  it("emits exactly nine keys and no others", () => {
    // The closed shape is the contract. A tenth key here is a field published
    // on a public board in another system.
    expect(Object.keys(toBlackoutAidFields(row())).sort()).toEqual([
      "category",
      "createdAt",
      "description",
      "locality",
      "quantity",
      "requestId",
      "status",
      "title",
      "unitOfMeasure",
    ])
  })

  it("never carries coordinates, the requester, urgency, or metadata", () => {
    // Each of these is on the row and each is withheld for its own reason:
    // coordinates and requester_id identify a person in need, urgency would be
    // a claim FBM's own public surface does not make, and metadata is
    // unbounded free text nobody has reviewed for publication.
    const serialized = JSON.stringify(toBlackoutAidFields(row()))

    expect(serialized).not.toContain("42.33")
    expect(serialized).not.toContain("-83.04")
    expect(serialized).not.toContain("cus_asker")
    expect(serialized).not.toContain("cus_helper")
    expect(serialized).not.toContain("mao_1")
    expect(serialized).not.toContain("URGENT")
    expect(serialized).not.toContain("third floor")
    expect(serialized).not.toContain("2026-12-01")
  })

  it("cannot be widened by adding a column to the model", () => {
    // Neither whitelist has a spread in it, so a new column is not visible to
    // either. This is the reason both are written as explicit literals.
    const fields = toBlackoutAidFields(
      row({ bank_account: "1234", home_address: "12 Elm St" }) as Record<string, unknown>
    )

    expect(JSON.stringify(fields)).not.toContain("1234")
    expect(JSON.stringify(fields)).not.toContain("Elm St")
  })

  it("passes nulls through rather than inventing values", () => {
    const fields = toBlackoutAidFields(
      row({ category: null, locality: null, quantity: null, created_at: null })
    )

    expect(fields.category).toBeNull()
    expect(fields.locality).toBeNull()
    expect(fields.quantity).toBeNull()
    expect(fields.createdAt).toBeNull()
  })

  it("keeps quantity and unit together in camelCase", () => {
    const fields = toBlackoutAidFields(row({ quantity: 3, unit_of_measure: "rides" }))

    expect(fields.quantity).toBe(3)
    expect(fields.unitOfMeasure).toBe("rides")
  })
})

describe("aidEventTypeFor", () => {
  it("treats a match as still open, not as leaving the board", () => {
    // A helper having committed is not the ask being met; the mirror reads
    // MATCHED off the status field and shows it as in progress.
    expect(aidEventTypeFor("OPEN")).toBe("aid.request.opened")
    expect(aidEventTypeFor("MATCHED")).toBe("aid.request.opened")
  })

  it("sends fulfilment on its own type", () => {
    expect(aidEventTypeFor("FULFILLED")).toBe("aid.request.fulfilled")
  })

  it("sends both ways of leaving the board as closed", () => {
    expect(aidEventTypeFor("WITHDRAWN")).toBe("aid.request.closed")
    expect(aidEventTypeFor("EXPIRED")).toBe("aid.request.closed")
  })

  it("emits nothing for a status it does not have a meaning for", () => {
    // A status added to the model without deciding what it means over the seam
    // should produce no event, not a wrong one.
    expect(aidEventTypeFor("SOMETHING_NEW")).toBeNull()
    expect(aidEventTypeFor(null)).toBeNull()
    expect(aidEventTypeFor(undefined)).toBeNull()
  })
})
