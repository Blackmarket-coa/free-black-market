import {
  CLAIM_METADATA_KEYS,
  CLAIM_REASONS,
  claimReasonToDisputeReason,
  disputeReasonToClaimReason,
  disputeStatusToClaimStatus,
  isClaimReason,
  toLegacyClaim,
} from "../claims-compat"
import { DisputeReason, DisputeStatus } from "../resolution"

describe("claims-compat: reasons", () => {
  it("maps every claim reason to a dispute reason", () => {
    for (const reason of CLAIM_REASONS) {
      expect(Object.values(DisputeReason)).toContain(
        claimReasonToDisputeReason(reason)
      )
    }
  })

  it("calls missing_items what the dispute vocabulary calls incomplete", () => {
    expect(claimReasonToDisputeReason("missing_items")).toBe(
      DisputeReason.INCOMPLETE
    )
    expect(disputeReasonToClaimReason(DisputeReason.INCOMPLETE)).toBe(
      "missing_items"
    )
  })

  it("round-trips every claim reason exactly", () => {
    // A claim filed through the storefront must read back as filed.
    for (const reason of CLAIM_REASONS) {
      expect(
        disputeReasonToClaimReason(claimReasonToDisputeReason(reason))
      ).toBe(reason)
    }
  })

  it("maps dispute-only reasons to something the storefront can render", () => {
    expect(disputeReasonToClaimReason(DisputeReason.BILLING)).toBe(
      "not_as_described"
    )
    expect(disputeReasonToClaimReason(DisputeReason.OTHER)).toBe(
      "not_as_described"
    )
  })

  it("recognises only the four claim reasons", () => {
    expect(isClaimReason("damaged")).toBe(true)
    expect(isClaimReason("billing")).toBe(false)
    expect(isClaimReason(42)).toBe(false)
  })
})

describe("claims-compat: statuses", () => {
  it("presents open and under_review both as pending", () => {
    // From the buyer's side both mean "someone is looking at it"; the
    // storefront never distinguished them.
    expect(disputeStatusToClaimStatus(DisputeStatus.OPEN)).toBe("pending")
    expect(disputeStatusToClaimStatus(DisputeStatus.UNDER_REVIEW)).toBe("pending")
  })

  it("presents a refund as accepted and a release as rejected", () => {
    expect(disputeStatusToClaimStatus(DisputeStatus.RESOLVED_REFUND)).toBe(
      "accepted"
    )
    expect(disputeStatusToClaimStatus(DisputeStatus.RESOLVED_RELEASE)).toBe(
      "rejected"
    )
  })

  it("presents a withdrawal as cancelled", () => {
    expect(disputeStatusToClaimStatus(DisputeStatus.WITHDRAWN)).toBe("cancelled")
  })
})

describe("claims-compat: toLegacyClaim", () => {
  const base = {
    id: "dsp_1",
    order_id: "ord_1",
    seller_id: "sel_1",
    status: DisputeStatus.OPEN,
    reason: DisputeReason.INCOMPLETE,
    description: "two jars short",
    claim_amount: 1_200,
    award_amount: 0,
    resolution_note: null,
    created_at: "2026-09-03T00:00:00.000Z",
  }

  it("produces the storefront's OrderClaim shape", () => {
    const claim = toLegacyClaim(base)
    expect(claim).toMatchObject({
      id: "dsp_1",
      status: "pending",
      reviewer_note: null,
      data: {
        order_id: "ord_1",
        reason: "missing_items",
        description: "two jars short",
        seller_id: "sel_1",
        claim_amount: 1_200,
        award_amount: 0,
      },
    })
  })

  it("prefers the original claim reason stored at intake over the reverse map", () => {
    // A `billing` dispute would reverse-map to not_as_described; if the buyer
    // actually filed `damaged`, that is what must come back.
    const claim = toLegacyClaim({
      ...base,
      reason: DisputeReason.BILLING,
      metadata: { [CLAIM_METADATA_KEYS.reason]: "damaged" },
    })
    expect(claim.data.reason).toBe("damaged")
  })

  it("ignores a stored reason that is not a claim reason", () => {
    const claim = toLegacyClaim({
      ...base,
      reason: DisputeReason.DAMAGED,
      metadata: { [CLAIM_METADATA_KEYS.reason]: "nonsense" },
    })
    expect(claim.data.reason).toBe("damaged")
  })

  it("carries evidence and contacted_seller through, and only when present", () => {
    const withMeta = toLegacyClaim({
      ...base,
      metadata: {
        [CLAIM_METADATA_KEYS.evidenceUrls]: ["https://x/1.jpg", 7, "https://x/2.jpg"],
        [CLAIM_METADATA_KEYS.contactedSeller]: true,
      },
    })
    expect(withMeta.data.evidence_urls).toEqual([
      "https://x/1.jpg",
      "https://x/2.jpg",
    ])
    expect(withMeta.data.contacted_seller).toBe(true)

    const without = toLegacyClaim(base)
    expect(without.data).not.toHaveProperty("evidence_urls")
    expect(without.data).not.toHaveProperty("contacted_seller")
  })

  it("surfaces the admin's resolution note as reviewer_note", () => {
    const claim = toLegacyClaim({
      ...base,
      status: DisputeStatus.RESOLVED_REFUND,
      award_amount: 1_200,
      resolution_note: "Refunded in full.",
    })
    expect(claim.status).toBe("accepted")
    expect(claim.reviewer_note).toBe("Refunded in full.")
    expect(claim.data.award_amount).toBe(1_200)
  })
})
