import {
  ORDER_CLAIM_REASONS,
  REQUEST_TYPES,
  getOrderClaimReasonName,
  getRequestTypeName,
  orderClaimPayloadSchema,
  requestPayloadSchema,
} from "../validators"

/**
 * Order claims are the mechanism behind the buyer-protection promise on
 * `/buyer-protection`. The payload rules and the published policy have to
 * agree, so the boundaries are pinned here rather than left to the form.
 */
describe("order claim payload", () => {
  const valid = {
    type: REQUEST_TYPES.ORDER_CLAIM,
    order_id: "order_01",
    reason: ORDER_CLAIM_REASONS.NOT_RECEIVED,
    description: "Marked delivered eight days ago but nothing arrived.",
    evidence_urls: [],
    contacted_seller: true,
  }

  it("accepts a well-formed claim", () => {
    const parsed = orderClaimPayloadSchema.safeParse(valid)
    expect(parsed.success).toBe(true)
  })

  it("covers the four things buyers actually report", () => {
    // A reason list that omitted "never arrived" would leave the most common
    // complaint with nowhere to go, which is the gap this type exists to close.
    expect(Object.values(ORDER_CLAIM_REASONS)).toEqual([
      "not_received",
      "not_as_described",
      "damaged",
      "missing_items",
    ])

    for (const reason of Object.values(ORDER_CLAIM_REASONS)) {
      expect(
        orderClaimPayloadSchema.safeParse({ ...valid, reason }).success
      ).toBe(true)
    }
  })

  it("rejects an unknown reason", () => {
    expect(
      orderClaimPayloadSchema.safeParse({ ...valid, reason: "changed_my_mind" })
        .success
    ).toBe(false)
  })

  it("requires enough detail to review", () => {
    // A one-word claim cannot be triaged, and bouncing it at submission is
    // kinder than accepting it and rejecting it a week later.
    expect(
      orderClaimPayloadSchema.safeParse({ ...valid, description: "bad" }).success
    ).toBe(false)
  })

  it("requires an order id", () => {
    expect(
      orderClaimPayloadSchema.safeParse({ ...valid, order_id: "" }).success
    ).toBe(false)
  })

  it("does not require the buyer to have contacted the seller first", () => {
    // The policy asks buyers to try the seller first, but a buyer who has been
    // ignored must still be able to escalate. Recorded, never enforced.
    const parsed = orderClaimPayloadSchema.safeParse({
      ...valid,
      contacted_seller: false,
    })
    expect(parsed.success).toBe(true)
  })

  it("defaults contacted_seller and evidence_urls when omitted", () => {
    const parsed = orderClaimPayloadSchema.parse({
      type: REQUEST_TYPES.ORDER_CLAIM,
      order_id: "order_01",
      reason: ORDER_CLAIM_REASONS.DAMAGED,
      description: "Jar arrived cracked and leaking through the box.",
    })
    expect(parsed.contacted_seller).toBe(false)
    expect(parsed.evidence_urls).toEqual([])
  })

  it("rejects non-URL evidence", () => {
    expect(
      orderClaimPayloadSchema.safeParse({
        ...valid,
        evidence_urls: ["not a url"],
      }).success
    ).toBe(false)
  })

  it("is reachable through the shared discriminated union", () => {
    // The module's own contributor notes require new types to be added to the
    // union; forgetting that would make claims fail generic validation.
    const parsed = requestPayloadSchema.safeParse(valid)
    expect(parsed.success).toBe(true)
  })
})

describe("claim labelling", () => {
  it("names the request type for admin surfaces", () => {
    expect(getRequestTypeName(REQUEST_TYPES.ORDER_CLAIM)).toBe("Order Problem")
  })

  it("names every reason", () => {
    const unnamed = Object.values(ORDER_CLAIM_REASONS).filter(
      (reason) => getOrderClaimReasonName(reason) === reason
    )
    expect(unnamed).toEqual([])
  })
})
