import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * Black Mask F6: `getFeeSchedule` passes the backend's `processing` field
 * through, and when the field is missing (backend unreachable, or a response
 * cached from before the API flag was set) the build-time twin
 * NEXT_PUBLIC_FF_FEE_FIRST_SPLIT_V1 decides — so neither an outage nor a stale
 * cache while fee-first is live can put "we absorb processing" back on a page. Flag twin unset, the
 * fallback is today's exactly (no field).
 */

const h = vi.hoisted(() => ({ medusaFetch: vi.fn() }))
vi.mock("@/lib/config", () => ({ medusaFetch: h.medusaFetch }))
vi.mock("../../config", () => ({ medusaFetch: h.medusaFetch }))

const TWIN = "NEXT_PUBLIC_FF_FEE_FIRST_SPLIT_V1"

const load = async () => {
  vi.resetModules()
  return (await import("../fee-schedule")).getFeeSchedule
}

afterEach(() => {
  delete process.env[TWIN]
  h.medusaFetch.mockReset()
})

describe("getFeeSchedule processing", () => {
  it("passes the backend's processing field through untouched", async () => {
    const body = {
      default_plan_code: "free",
      default_fee_percent: 3,
      plans: [],
      processing: { model: "fee_first", percent: 2.9, fixed_cents: 30 },
    }
    h.medusaFetch.mockResolvedValue(body)
    const getFeeSchedule = await load()
    expect(await getFeeSchedule()).toEqual(body)
  })

  it("twin unset: a response without processing passes through untouched (today's)", async () => {
    const body = { default_plan_code: "free", default_fee_percent: 3, plans: [] }
    h.medusaFetch.mockResolvedValue(body)
    const getFeeSchedule = await load()
    const out = await getFeeSchedule()
    expect(out).toBe(body)
    expect("processing" in out).toBe(false)
  })

  it("twin set, response cached from before the API flag (no processing): fee_first wins, no figures it could not check", async () => {
    process.env[TWIN] = "true"
    const body = { default_plan_code: "free", default_fee_percent: 3, plans: [] }
    h.medusaFetch.mockResolvedValue(body)
    const getFeeSchedule = await load()
    expect(await getFeeSchedule()).toEqual({
      ...body,
      processing: { model: "fee_first", percent: null, fixed_cents: null },
    })
  })

  it("twin set, response carries processing: the backend's figures, untouched", async () => {
    process.env[TWIN] = "true"
    const body = {
      default_plan_code: "free",
      default_fee_percent: 3,
      plans: [],
      processing: { model: "fee_first", percent: 2.9, fixed_cents: 30 },
    }
    h.medusaFetch.mockResolvedValue(body)
    const getFeeSchedule = await load()
    expect(await getFeeSchedule()).toEqual(body)
  })

  it("backend unreachable, twin unset: today's fallback exactly, no processing field", async () => {
    h.medusaFetch.mockRejectedValue(new Error("down"))
    const getFeeSchedule = await load()
    const out = await getFeeSchedule()
    expect(out).toEqual({ default_plan_code: "free", default_fee_percent: 3, plans: [] })
    expect("processing" in out).toBe(false)
  })

  it("backend unreachable, twin set: fee_first with no figures it could not check", async () => {
    process.env[TWIN] = "true"
    h.medusaFetch.mockRejectedValue(new Error("down"))
    const getFeeSchedule = await load()
    expect((await getFeeSchedule()).processing).toEqual({
      model: "fee_first",
      percent: null,
      fixed_cents: null,
    })
  })

  it("only the literal string true sets the twin", async () => {
    process.env[TWIN] = "1"
    h.medusaFetch.mockRejectedValue(new Error("down"))
    const getFeeSchedule = await load()
    expect("processing" in (await getFeeSchedule())).toBe(false)
  })
})
