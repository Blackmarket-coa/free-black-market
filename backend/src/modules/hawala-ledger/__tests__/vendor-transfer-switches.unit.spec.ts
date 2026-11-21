import {
  CREATOR_REWARD_POOLS_FLAG,
  SUBCONTRACT_ESCROW_FLAG,
  VendorTransferOffError,
  assertCreatorRewardPoolsLive,
  assertSubcontractEscrowLive,
  isCreatorRewardPoolsLive,
  isSubcontractEscrowLive,
} from "../vendor-transfer-switches"

/**
 * The two vendor-to-vendor money paths SD-63's migrations made reachable stay
 * off until an operator and counsel decide. What the ledger does with a
 * switch off or on is pinned on Postgres
 * (integration-tests/http/vendor-transfer-switches.spec.ts); this pins the
 * switches themselves.
 */
describe("vendor transfer switches", () => {
  afterEach(() => {
    delete process.env[SUBCONTRACT_ESCROW_FLAG]
    delete process.env[CREATOR_REWARD_POOLS_FLAG]
  })

  it("use the documented env names and default closed", () => {
    expect(SUBCONTRACT_ESCROW_FLAG).toBe("FBM_SUBCONTRACT_ESCROW_LIVE")
    expect(CREATOR_REWARD_POOLS_FLAG).toBe("FBM_CREATOR_REWARD_POOLS_LIVE")
    expect(isSubcontractEscrowLive()).toBe(false)
    expect(isCreatorRewardPoolsLive()).toBe(false)
    expect(() => assertSubcontractEscrowLive()).toThrow(VendorTransferOffError)
    expect(() => assertCreatorRewardPoolsLive()).toThrow(VendorTransferOffError)
  })

  it("open only for the literal string 1", () => {
    for (const value of ["true", "yes", "on", "0", "", " 1"]) {
      process.env[SUBCONTRACT_ESCROW_FLAG] = value
      process.env[CREATOR_REWARD_POOLS_FLAG] = value
      expect([value, isSubcontractEscrowLive(), isCreatorRewardPoolsLive()]).toEqual([value, false, false])
    }
    process.env[SUBCONTRACT_ESCROW_FLAG] = "1"
    process.env[CREATOR_REWARD_POOLS_FLAG] = "1"
    expect(() => assertSubcontractEscrowLive()).not.toThrow()
    expect(() => assertCreatorRewardPoolsLive()).not.toThrow()
  })

  it("are separate decisions: neither opens the other", () => {
    process.env[SUBCONTRACT_ESCROW_FLAG] = "1"
    expect([isSubcontractEscrowLive(), isCreatorRewardPoolsLive()]).toEqual([true, false])
    delete process.env[SUBCONTRACT_ESCROW_FLAG]
    process.env[CREATOR_REWARD_POOLS_FLAG] = "1"
    expect([isSubcontractEscrowLive(), isCreatorRewardPoolsLive()]).toEqual([false, true])
  })

  it("refuse with an error a route can answer from, naming the switch", () => {
    let caught: unknown
    try {
      assertSubcontractEscrowLive()
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(VendorTransferOffError)
    expect(caught).toMatchObject({
      type: "feature_disabled",
      flag: "FBM_SUBCONTRACT_ESCROW_LIVE",
      message: "Service subcontracts are not available (FBM_SUBCONTRACT_ESCROW_LIVE is not on)",
    })
  })
})
