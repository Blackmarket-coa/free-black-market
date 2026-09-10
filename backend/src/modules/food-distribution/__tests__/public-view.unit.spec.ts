/**
 * Read-side redaction on the community surfaces.
 *
 * `api/middlewares.ts` gates these prefixes on write verbs only, so their
 * GETs are unauthenticated and several return whole ORM entities. These
 * helpers cover the two cases where the schema already declared an intent
 * that no read path honoured — a credential that must never be serialized,
 * and a recipient's request not to be named.
 */
import {
  applyRecipientAnonymity,
  applyRecipientAnonymityAll,
  redactDeliveries,
  redactDelivery,
} from "../public-view"

describe("redactDelivery", () => {
  it("strips the delivery PIN", () => {
    // The PIN is what a recipient reads back to a courier to confirm
    // delivery. Serializing it defeats the control: anyone holding it can
    // confirm someone else's delivery.
    const out = redactDelivery({
      id: "fd_1",
      status: "IN_TRANSIT",
      proof_pin_code: "4821",
    })
    expect(out).not.toHaveProperty("proof_pin_code")
    expect(JSON.stringify(out)).not.toContain("4821")
  })

  it("leaves every other field alone", () => {
    const out = redactDelivery({
      id: "fd_1",
      status: "IN_TRANSIT",
      recipient_name: "Ada",
      proof_pin_code: "4821",
    })
    expect(out).toEqual({ id: "fd_1", status: "IN_TRANSIT", recipient_name: "Ada" })
  })

  it("does not mutate its input", () => {
    const row = { id: "fd_1", proof_pin_code: "4821" }
    redactDelivery(row)
    expect(row.proof_pin_code).toBe("4821")
  })

  it("is a no-op on a row that never had a PIN", () => {
    expect(redactDelivery({ id: "fd_1" })).toEqual({ id: "fd_1" })
  })

  it("redacts every row in a list", () => {
    const out = redactDeliveries([
      { id: "a", proof_pin_code: "1111" },
      { id: "b", proof_pin_code: "2222" },
    ])
    expect(JSON.stringify(out)).not.toMatch(/1111|2222/)
  })
})

describe("applyRecipientAnonymity", () => {
  const namedOrder = {
    id: "fo_1",
    anonymous_recipient: true,
    customer_id: "cus_1",
    recipient_name: "Ada Lovelace",
    recipient_phone: "+15550000000",
    recipient_email: "ada@example.com",
    delivery_address_line_1: "12 Analytical Way",
    delivery_latitude: 51.5,
    delivery_longitude: -0.1,
    transaction_type: "DONATION",
  }

  it("withholds identity when the recipient asked to be anonymous", () => {
    const out = applyRecipientAnonymity(namedOrder)
    const serialized = JSON.stringify(out)
    expect(serialized).not.toContain("Ada Lovelace")
    expect(serialized).not.toContain("+15550000000")
    expect(serialized).not.toContain("ada@example.com")
    expect(serialized).not.toContain("Analytical Way")
    expect(out.delivery_latitude).toBeNull()
    expect(out.delivery_longitude).toBeNull()
    expect(out.customer_id).toBeNull()
  })

  it("labels the recipient rather than leaving a blank", () => {
    expect(applyRecipientAnonymity(namedOrder).recipient_name).toBe("Anonymous")
  })

  it("keeps the non-identifying fields, so the row still means something", () => {
    const out = applyRecipientAnonymity(namedOrder)
    expect(out.id).toBe("fo_1")
    expect(out.transaction_type).toBe("DONATION")
  })

  it("leaves a recipient who did not ask to be anonymous untouched", () => {
    const open = { ...namedOrder, anonymous_recipient: false }
    expect(applyRecipientAnonymity(open)).toEqual(open)
  })

  it("treats a missing flag as not anonymous", () => {
    const row = { id: "fo_2", recipient_name: "Grace" }
    expect(applyRecipientAnonymity(row)).toEqual(row)
  })

  it("does not mutate its input", () => {
    const row = { ...namedOrder }
    applyRecipientAnonymity(row)
    expect(row.recipient_name).toBe("Ada Lovelace")
  })

  it("applies per row across a list, honouring each row's own flag", () => {
    const out = applyRecipientAnonymityAll([
      namedOrder,
      { ...namedOrder, id: "fo_2", anonymous_recipient: false, recipient_name: "Grace Hopper" },
    ])
    expect(out[0].recipient_name).toBe("Anonymous")
    expect(out[1].recipient_name).toBe("Grace Hopper")
  })
})
