import {
  computeFeeFirstSplit,
  legacyPlatformFeeCents,
  percentOfCents,
  processingEstimateCents,
} from "../fee-first"

/**
 * F6-1: the pure fee-first split. Integer cents in, integer cents out; the
 * estimate is on the whole charge with the fixed part once; commission on
 * what is left. The operator's worked examples (2026-10-05 item 6) are pinned
 * literally.
 */

const DEFAULTS = { processingPercent: 2.9, processingFixedCents: 30 }

const single = (subtotalCents: number, feePercent: number, chargedCents?: number) =>
  computeFeeFirstSplit({
    ...DEFAULTS,
    sellers: [{ sellerId: "sel_1", subtotalCents, chargedCents, feePercent }],
  })

describe("computeFeeFirstSplit — the operator's worked examples", () => {
  it("$40, one seller, 3%: processing 146, commission 116, seller 3738", () => {
    const split = single(4000, 3)
    expect(split.processingTotalCents).toBe(146)
    expect(split.sellers[0]).toMatchObject({
      processingCents: 146,
      commissionCents: 116,
      sellerNetCents: 3738,
    })
    expect(split.platformBorneProcessingCents).toBe(0)
    // 116 / 4000 = 2.90% of gross, from a rate that is still 3%.
    expect(split.sellers[0].feePercent).toBe(3)
  })

  it("$40 at 0%: commission 0, seller 3854", () => {
    const split = single(4000, 0)
    expect(split.sellers[0]).toMatchObject({
      processingCents: 146,
      commissionCents: 0,
      sellerNetCents: 3854,
    })
  })

  it("$5 at 3%: processing 45, commission 14, seller 441", () => {
    // The float `500 * (2.9 / 100)` is 14.499999999999998, which Math.round
    // takes to 14 (processing 44). The exact rule takes 14.5 to 15.
    const split = single(500, 3)
    expect(split.sellers[0]).toMatchObject({
      processingCents: 45,
      commissionCents: 14,
      sellerNetCents: 441,
    })
  })
})

describe("computeFeeFirstSplit — allocation", () => {
  it("multi-seller $25 + $15: the 30c fixed fee is counted once and the parts sum exactly", () => {
    const split = computeFeeFirstSplit({
      ...DEFAULTS,
      sellers: [
        { sellerId: "sel_a", subtotalCents: 2500, feePercent: 3 },
        { sellerId: "sel_b", subtotalCents: 1500, feePercent: 3 },
      ],
    })
    // One charge of 4000: 116 + 30 — not 2 x 30.
    expect(split.processingTotalCents).toBe(146)
    // 146 x 2500/4000 = 91.25 -> 91; 146 x 1500/4000 = 54.75 -> 54; the one
    // remainder cent goes to the larger leg.
    expect(split.sellers.map((s) => s.processingCents)).toEqual([92, 54])
    expect(split.sellerBorneProcessingCents).toBe(146)
    expect(split.sellers.map((s) => s.commissionCents)).toEqual([
      Math.round(0.03 * (2500 - 92)),
      Math.round(0.03 * (1500 - 54)),
    ])
    for (const s of split.sellers) {
      expect(s.processingCents + s.commissionCents + s.sellerNetCents).toBe(s.chargedCents)
    }
  })

  it("never lets the fixed fee multiply with the number of sellers", () => {
    const sellers = Array.from({ length: 7 }, (_, i) => ({
      sellerId: `sel_${i}`,
      subtotalCents: 1000,
      feePercent: 3,
    }))
    const split = computeFeeFirstSplit({ ...DEFAULTS, sellers })
    expect(split.processingTotalCents).toBe(Math.round(7000 * 0.029) + 30)
    expect(split.sellerBorneProcessingCents).toBe(split.processingTotalCents)
  })

  it("gives the remainder to the LARGEST leg, not the first", () => {
    const split = computeFeeFirstSplit({
      ...DEFAULTS,
      sellers: [
        { sellerId: "small", subtotalCents: 1500, feePercent: 3 },
        { sellerId: "large", subtotalCents: 2500, feePercent: 3 },
      ],
    })
    expect(split.sellers.map((s) => [s.sellerId, s.processingCents])).toEqual([
      ["small", 54],
      ["large", 92],
    ])
  })

  it("puts tax, delivery and tip inside a seller's leg under processing too", () => {
    // $40 goods + $3.20 tax + $5 delivery + $2 tip, all in the one leg.
    const split = single(4000, 3, 5020)
    expect(split.chargedTotalCents).toBe(5020)
    // round(5020 x 2.9%) = round(145.58) = 146, + 30.
    expect(split.processingTotalCents).toBe(176)
    expect(split.sellers[0].processingCents).toBe(176)
    // Commission on the goods subtotal less the leg's processing.
    expect(split.sellers[0].commissionCents).toBe(Math.round(0.03 * (4000 - 176)))
    expect(split.sellers[0].sellerNetCents).toBe(5020 - 176 - Math.round(0.03 * (4000 - 176)))
  })

  it("charges processing on money in no seller's leg to the platform, never to a seller", () => {
    // Should a donation (or anything else) ever sit inside FBM's own charge,
    // it is passed as unattributed: its processing is platform-borne and the
    // seller's share is exactly what it would be on the seller's leg alone.
    const split = computeFeeFirstSplit({
      ...DEFAULTS,
      sellers: [{ sellerId: "sel_1", subtotalCents: 4000, feePercent: 3 }],
      unattributedChargedCents: 1000,
    })
    expect(split.chargedTotalCents).toBe(5000)
    expect(split.processingTotalCents).toBe(Math.round(5000 * 0.029) + 30)
    // 175 x 1000/5000 = 35 to the platform; 140 to the seller.
    expect(split.platformBorneProcessingCents).toBe(35)
    expect(split.sellers[0].processingCents).toBe(140)
    expect(split.sellerBorneProcessingCents + split.platformBorneProcessingCents).toBe(
      split.processingTotalCents
    )
  })

  it("clamps: a seller never bears more processing than their leg, commission never negative", () => {
    // A 10c sale: the estimate (0 + 30) exceeds the whole leg.
    const split = single(10, 3)
    expect(split.processingTotalCents).toBe(30)
    expect(split.sellers[0]).toMatchObject({ processingCents: 10, commissionCents: 0, sellerNetCents: 0 })
    expect(split.platformBorneProcessingCents).toBe(20)
  })

  it("costs nothing on a charge of nothing", () => {
    const split = single(0, 3)
    expect(split.processingTotalCents).toBe(0)
    expect(split.sellers[0]).toMatchObject({ processingCents: 0, commissionCents: 0, sellerNetCents: 0 })
  })

  it("sums exactly across 2,000 random multi-seller charges", () => {
    let seed = 42
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed % n
    }
    for (let k = 0; k < 2000; k++) {
      const sellers = Array.from({ length: 1 + rand(5) }, (_, i) => {
        const subtotalCents = rand(50_000)
        return {
          sellerId: `s${i}`,
          subtotalCents,
          chargedCents: subtotalCents + rand(3_000),
          feePercent: [0, 1.5, 2, 2.5, 3][rand(5)],
        }
      })
      const split = computeFeeFirstSplit({ ...DEFAULTS, sellers })
      expect(split.sellerBorneProcessingCents + split.platformBorneProcessingCents).toBe(
        split.processingTotalCents
      )
      for (const s of split.sellers) {
        expect(Number.isInteger(s.processingCents)).toBe(true)
        expect(Number.isInteger(s.commissionCents)).toBe(true)
        expect(s.commissionCents).toBeGreaterThanOrEqual(0)
        expect(s.sellerNetCents).toBeGreaterThanOrEqual(0)
        expect(s.processingCents).toBeLessThanOrEqual(s.chargedCents)
        expect(s.processingCents + s.commissionCents + s.sellerNetCents).toBe(s.chargedCents)
      }
    }
  })
})

describe("rate arithmetic", () => {
  it("rounds half up exactly where the float would not", () => {
    expect(percentOfCents(500, 2.9)).toBe(15)
    expect(Math.round(500 * (2.9 / 100))).toBe(14)
    expect(percentOfCents(3854, 3)).toBe(116)
    expect(percentOfCents(4000, 0)).toBe(0)
  })

  it("counts the fixed part once per charge", () => {
    expect(processingEstimateCents(4000, 2.9, 30)).toBe(146)
    expect(processingEstimateCents(0, 2.9, 30)).toBe(0)
  })

  it("refuses a rate it cannot apply rather than settling on NaN", () => {
    expect(() => single(4000, Number.NaN)).toThrow(RangeError)
    expect(() => single(4000, 101)).toThrow(RangeError)
    expect(() =>
      computeFeeFirstSplit({
        processingPercent: Number.NaN,
        processingFixedCents: 30,
        sellers: [{ sellerId: "s", subtotalCents: 4000, feePercent: 3 }],
      })
    ).toThrow(RangeError)
    expect(() => single(40.5, 3)).toThrow(RangeError)
  })
})

describe("legacyPlatformFeeCents", () => {
  it("is the pre-F6 calculateBreakdown expression for 1,000 subtotals and every ladder rate", () => {
    let seed = 7
    for (let k = 0; k < 1000; k++) {
      seed = (seed * 1103515245 + 12345) % 2147483648
      const subtotal = seed % 1_000_000
      for (const pct of [0, 1.5, 2, 2.5, 3, 6, 10]) {
        expect(legacyPlatformFeeCents(subtotal, pct)).toBe(Math.round(subtotal * (pct / 100)))
      }
    }
  })
})
