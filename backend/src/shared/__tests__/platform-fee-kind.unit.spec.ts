import {
  resolveSellerPlatformFee,
  resolveTransactionPlatformFee,
} from "../platform-fee"
import { PHASE0_FEATURE_FLAGS } from "../feature-flags"
import { clearPlanFeatureCache } from "../plan-entitlement-cache"
import { PAYOUT_BREAKDOWN_MODULE } from "../../modules/payout-breakdown"
import PayoutBreakdownService from "../../modules/payout-breakdown/service"
import { VENDOR_PLAN_MODULE } from "../../modules/vendor-plan"
import { ENTITLEMENT_MODULE } from "../../modules/entitlement"
import { TENANCY_MODULE } from "../../modules/tenancy"

/**
 * The container composition point is the ONLY place `FF_NONPROFIT_PARITY_V1`
 * touches the fee chain. The pure resolver is unconditional (covered in
 * payout-breakdown/__tests__/fee-resolution.unit.spec.ts); what these pin is
 * that a caller holding a container cannot classify a charge as a donation
 * while the flag is off, and that when it is on a donation never reads the
 * seller's plan.
 *
 * Every module is keyed on its imported registration constant and the
 * container throws on anything else, so a hand-typed key would fail loudly
 * here rather than silently exercising a fallback (CLAUDE.md rule 2).
 */

const ENV = PHASE0_FEATURE_FLAGS.NONPROFIT_PARITY_V1

type SettingsRow = {
  id: string
  seller_id: string
  custom_platform_fee_percent?: number | null
  fee_reduction_reason?: string | null
  fee_reduction_expires_at?: Date | null
}

/**
 * A real `PayoutBreakdownService` (prototype + patched CRUD, the pattern in
 * payout-breakdown/__tests__/platform-fee-service.unit.spec.ts) so the real
 * `getPlatformFeeDetail` and the real resolver run — not a jest.fn standing in
 * for the chain.
 */
function makePayouts(opts: { defaultPercent: number; settings?: SettingsRow[] }) {
  const svc = Object.create(
    PayoutBreakdownService.prototype
  ) as Record<string, unknown>
  const rows = [...(opts.settings ?? [])]
  svc.listPayoutConfigs = (async () => [
    { id: "pc_1", is_default: true, platform_fee_percent: opts.defaultPercent },
  ]) as never
  svc.listSellerPayoutSettings = (async (filters: { seller_id?: string }) =>
    rows.filter((r) => !filters?.seller_id || r.seller_id === filters.seller_id)) as never
  return svc as unknown as PayoutBreakdownService
}

function makeContainer(opts: {
  defaultPercent?: number
  planCode?: string
  settings?: SettingsRow[]
}) {
  const payouts = makePayouts({
    defaultPercent: opts.defaultPercent ?? 3,
    settings: opts.settings,
  })
  const ensureAssignment = jest.fn(async () => ({
    plan_code: opts.planCode ?? "free",
  }))
  const getEntitledFeatureKeys = jest.fn(async () => [])
  const listActiveFeatureKeysForSeller = jest.fn(async () => [])
  const resolveSellerTier = jest.fn(async () => "tier0_public")

  const container = {
    resolve: jest.fn((key: string) => {
      if (key === PAYOUT_BREAKDOWN_MODULE) return payouts
      if (key === VENDOR_PLAN_MODULE) {
        return { ensureAssignment, getEntitledFeatureKeys }
      }
      if (key === ENTITLEMENT_MODULE) return { listActiveFeatureKeysForSeller }
      if (key === TENANCY_MODULE) return { resolveSellerTier }
      throw new Error(`unexpected container key: ${key}`)
    }),
  }

  return { container: container as never, resolve: container.resolve, ensureAssignment }
}

beforeEach(() => {
  clearPlanFeatureCache()
})

afterEach(() => {
  // Flag specs mutate process.env; a leaked value flips later specs in the
  // same jest worker.
  delete process.env[ENV]
})

describe("resolveTransactionPlatformFee with FF_NONPROFIT_PARITY_V1 off", () => {
  it("coerces a donation to a sale and reads the plan", async () => {
    // Deploy with no env set: nothing can be classified as a donation, so a
    // caller asking for one gets the seller's ordinary sale rate — here the
    // `pro` plan's 2% — with the plan read as it always was.
    const { container, resolve, ensureAssignment } = makeContainer({
      planCode: "pro",
    })

    const fee = await resolveTransactionPlatformFee(container, {
      sellerId: "sel_1",
      kind: "donation",
    })

    expect(fee.percent).toBe(2)
    expect(fee.source).toBe("plan")
    expect(fee.plan_code).toBe("pro")
    expect(fee.plan_percent).toBe(2)
    expect(ensureAssignment).toHaveBeenCalledTimes(1)
    expect(resolve).toHaveBeenCalledWith(VENDOR_PLAN_MODULE)
  })

  it("resolves a sale through the plan exactly as resolveSellerPlatformFee does", async () => {
    const a = makeContainer({ planCode: "starter" })
    const b = makeContainer({ planCode: "starter" })

    const viaKind = await resolveTransactionPlatformFee(a.container, {
      sellerId: "sel_1",
      kind: "sale",
    })
    clearPlanFeatureCache()
    const viaWrapper = await resolveSellerPlatformFee(b.container, "sel_1")

    expect(viaKind).toEqual(viaWrapper)
    expect(viaKind.percent).toBe(2.5)
    expect(viaKind.source).toBe("plan")
  })
})

describe("resolveTransactionPlatformFee with FF_NONPROFIT_PARITY_V1 on", () => {
  beforeEach(() => {
    process.env[ENV] = "true"
  })

  it("charges 0 on a donation and never reads the plan", async () => {
    // Override AND plan present, both of which would normally win. The kind
    // rung sits above both, and the composition point does not even ask the
    // plan service — so `plan_code` / `plan_percent` are null rather than a
    // rate that had nothing to do with the result.
    const { container, resolve, ensureAssignment } = makeContainer({
      planCode: "pro",
      settings: [
        {
          id: "sps_1",
          seller_id: "sel_1",
          custom_platform_fee_percent: 1,
          fee_reduction_reason: "pilot",
        },
      ],
    })

    const fee = await resolveTransactionPlatformFee(container, {
      sellerId: "sel_1",
      kind: "donation",
    })

    expect(fee.percent).toBe(0)
    expect(fee.source).toBe("transaction_kind")
    expect(fee.override_expired).toBe(false)
    expect(fee.override_reason).toBeNull()
    expect(fee.plan_code).toBeNull()
    expect(fee.plan_percent).toBeNull()
    expect(ensureAssignment).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalledWith(VENDOR_PLAN_MODULE)
    expect(resolve).toHaveBeenCalledWith(PAYOUT_BREAKDOWN_MODULE)
  })

  it("treats a donation pledge the same way", async () => {
    const { container, ensureAssignment } = makeContainer({ planCode: "pro" })

    const fee = await resolveTransactionPlatformFee(container, {
      sellerId: "sel_1",
      kind: "donation_pledge",
    })

    expect(fee.percent).toBe(0)
    expect(fee.source).toBe("transaction_kind")
    expect(ensureAssignment).not.toHaveBeenCalled()
  })

  it("still reads the plan for a sale", async () => {
    // The flag turns the classification on; it must not change what a sale
    // costs. The 3% default and the plan ladder are untouched.
    const { container, ensureAssignment } = makeContainer({ planCode: "pro" })

    const fee = await resolveTransactionPlatformFee(container, {
      sellerId: "sel_1",
      kind: "sale",
    })

    expect(fee.percent).toBe(2)
    expect(fee.source).toBe("plan")
    expect(fee.plan_code).toBe("pro")
    expect(ensureAssignment).toHaveBeenCalledTimes(1)
  })

  it("defaults an unspecified kind to a sale", async () => {
    const { container } = makeContainer({})
    const fee = await resolveTransactionPlatformFee(container, {
      sellerId: "sel_1",
    })
    expect(fee.percent).toBe(3)
    expect(fee.source).toBe("plan")
  })

  it("leaves resolveSellerPlatformFee on the sale path", async () => {
    // The wrapper every live caller uses pins kind to `sale`; turning the
    // flag on cannot zero an order's fee.
    const { container, ensureAssignment } = makeContainer({
      planCode: "free",
    })
    const fee = await resolveSellerPlatformFee(container, "sel_1")
    expect(fee.percent).toBe(3)
    expect(fee.source).toBe("plan")
    expect(ensureAssignment).toHaveBeenCalledTimes(1)
  })
})
