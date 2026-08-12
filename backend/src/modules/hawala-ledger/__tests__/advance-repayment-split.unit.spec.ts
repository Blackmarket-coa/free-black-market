import { splitAdvanceRepayment } from "../advance-repayment-split"

/**
 * H8: `processAdvanceRepayment` booked every repayment as 100% principal
 * (`principal_amount: repaymentAmount, // Simplified - in reality split
 * principal/fee`), so `AdvanceRepayment.fee_amount` was always zero and
 * `VendorAdvance.total_fee_charged` was never written. Advance fee revenue was
 * invisible in the records that are supposed to account for it.
 *
 * The canonical case below is the one to read first: a $1,000 advance at a 1.25
 * factor owes $1,250, and repaying all of it must land exactly $1,000 against
 * principal and $250 against fee.
 */

const split = (overrides: Partial<Parameters<typeof splitAdvanceRepayment>[0]> = {}) =>
  splitAdvanceRepayment({
    repayment_amount: 125,
    fee_rate: 1.25,
    principal_amount: 1000,
    prior_principal_repaid: 0,
    is_final: false,
    ...overrides,
  })

describe("splitAdvanceRepayment", () => {
  it("splits pro-rata by the factor rate", () => {
    // 1/1.25 = 0.8 of every dollar retires principal.
    expect(split()).toEqual({ principal_amount: 100, fee_amount: 25 })
  })

  it("always sums to the payment amount", () => {
    const result = split({ repayment_amount: 33.33, fee_rate: 1.17 })
    expect(result.principal_amount + result.fee_amount).toBeCloseTo(33.33, 8)
  })

  it("retires principal and fee exactly across a full repayment schedule", () => {
    // $1,000 advanced at 1.25 → $1,250 owed. Ten $125 instalments.
    const principalTotal = 1000
    const feeRate = 1.25
    let outstanding = principalTotal * feeRate
    let principalRepaid = 0
    let feeCharged = 0

    for (let i = 0; i < 10; i++) {
      const payment = 125
      outstanding -= payment
      const result = splitAdvanceRepayment({
        repayment_amount: payment,
        fee_rate: feeRate,
        principal_amount: principalTotal,
        prior_principal_repaid: principalRepaid,
        is_final: outstanding <= 0,
      })
      principalRepaid += result.principal_amount
      feeCharged += result.fee_amount
    }

    expect(principalRepaid).toBeCloseTo(1000, 8)
    expect(feeCharged).toBeCloseTo(250, 8)
    expect(outstanding).toBeCloseTo(0, 8)
  })

  it("trues up the closing payment instead of computing it pro-rata", () => {
    // Pro-rata would attribute 0.8 * 125 = 100 to principal, leaving the books
    // 20 short. The final payment must close the gap.
    expect(
      split({ prior_principal_repaid: 880, is_final: true })
    ).toEqual({ principal_amount: 120, fee_amount: 5 })
  })

  it("never attributes more principal than the advance carried", () => {
    const result = split({
      repayment_amount: 500,
      prior_principal_repaid: 950,
      is_final: true,
    })
    expect(result.principal_amount).toBe(50)
    expect(result.fee_amount).toBe(450)
  })

  it("charges the remainder to fee once principal is fully retired", () => {
    const result = split({ prior_principal_repaid: 1000 })
    expect(result).toEqual({ principal_amount: 0, fee_amount: 125 })
  })

  it("treats a factor rate of 1 as fee-free", () => {
    expect(split({ fee_rate: 1 })).toEqual({
      principal_amount: 125,
      fee_amount: 0,
    })
  })

  it("does not invent a fee when fee_rate is missing or corrupt", () => {
    // Guards against dividing by zero and against a NaN escaping into money.
    for (const feeRate of [0, NaN, -1, Number.POSITIVE_INFINITY]) {
      const result = split({ fee_rate: feeRate as number })
      expect(result.fee_amount).toBe(0)
      expect(result.principal_amount).toBe(125)
    }
  })

  it("returns a zero split for a non-positive payment", () => {
    expect(split({ repayment_amount: 0 })).toEqual({
      principal_amount: 0,
      fee_amount: 0,
    })
    expect(split({ repayment_amount: -5 })).toEqual({
      principal_amount: 0,
      fee_amount: 0,
    })
  })
})
