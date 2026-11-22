import {
  CREATOR_REWARD_POOLS_FLAG,
  FUNDED_LAUNCHES_FLAG,
  SUBCONTRACT_ESCROW_FLAG,
  VendorTransferOffError,
  assertCreatorRewardPoolsLive,
  assertFundedLaunchesLive,
  assertSubcontractEscrowLive,
  isCreatorRewardPoolsLive,
  isFundedLaunchesLive,
  isSubcontractEscrowLive,
} from "../vendor-transfer-switches"

/**
 * The vendor money paths SD-63's migrations made reachable stay off until an
 * operator and counsel decide. What the ledger does with a switch off or on is
 * pinned on Postgres (integration-tests/http/vendor-transfer-switches.spec.ts,
 * and seller-launch.spec.ts for funded launches); this pins the switches
 * themselves.
 */
describe("vendor transfer switches", () => {
  afterEach(() => {
    delete process.env[SUBCONTRACT_ESCROW_FLAG]
    delete process.env[CREATOR_REWARD_POOLS_FLAG]
    delete process.env[FUNDED_LAUNCHES_FLAG]
  })

  it("use the documented env names and default closed", () => {
    expect(SUBCONTRACT_ESCROW_FLAG).toBe("FBM_SUBCONTRACT_ESCROW_LIVE")
    expect(CREATOR_REWARD_POOLS_FLAG).toBe("FBM_CREATOR_REWARD_POOLS_LIVE")
    expect(FUNDED_LAUNCHES_FLAG).toBe("FBM_FUNDED_LAUNCHES_LIVE")
    expect(isSubcontractEscrowLive()).toBe(false)
    expect(isCreatorRewardPoolsLive()).toBe(false)
    expect(isFundedLaunchesLive()).toBe(false)
    expect(() => assertSubcontractEscrowLive()).toThrow(VendorTransferOffError)
    expect(() => assertCreatorRewardPoolsLive()).toThrow(VendorTransferOffError)
    expect(() => assertFundedLaunchesLive()).toThrow(VendorTransferOffError)
  })

  it("open only for the literal string 1", () => {
    for (const value of ["true", "yes", "on", "0", "", " 1"]) {
      process.env[SUBCONTRACT_ESCROW_FLAG] = value
      process.env[CREATOR_REWARD_POOLS_FLAG] = value
      process.env[FUNDED_LAUNCHES_FLAG] = value
      expect([value, isSubcontractEscrowLive(), isCreatorRewardPoolsLive(), isFundedLaunchesLive()]).toEqual([
        value,
        false,
        false,
        false,
      ])
    }
    process.env[SUBCONTRACT_ESCROW_FLAG] = "1"
    process.env[CREATOR_REWARD_POOLS_FLAG] = "1"
    process.env[FUNDED_LAUNCHES_FLAG] = "1"
    expect(() => assertSubcontractEscrowLive()).not.toThrow()
    expect(() => assertCreatorRewardPoolsLive()).not.toThrow()
    expect(() => assertFundedLaunchesLive()).not.toThrow()
  })

  it("are separate decisions: none opens another", () => {
    const state = () => [isSubcontractEscrowLive(), isCreatorRewardPoolsLive(), isFundedLaunchesLive()]
    process.env[SUBCONTRACT_ESCROW_FLAG] = "1"
    expect(state()).toEqual([true, false, false])
    delete process.env[SUBCONTRACT_ESCROW_FLAG]
    process.env[CREATOR_REWARD_POOLS_FLAG] = "1"
    expect(state()).toEqual([false, true, false])
    delete process.env[CREATOR_REWARD_POOLS_FLAG]
    process.env[FUNDED_LAUNCHES_FLAG] = "1"
    expect(state()).toEqual([false, false, true])
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
