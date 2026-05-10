import {
  isAllowedTransition,
  resolveNextState,
} from "../escrow-state-machine"

const yesterday = new Date(Date.now() - 24 * 3600 * 1000)
const tomorrow = new Date(Date.now() + 24 * 3600 * 1000)
const now = new Date()

describe("escrow-state-machine: isAllowedTransition", () => {
  it("pending → fund is allowed", () => {
    expect(isAllowedTransition("pending", "fund")).toBe(true)
  })

  it("pending → release is NOT allowed", () => {
    expect(isAllowedTransition("pending", "release")).toBe(false)
  })

  it("funded → release/dispute/recover are allowed", () => {
    expect(isAllowedTransition("funded", "release")).toBe(true)
    expect(isAllowedTransition("funded", "dispute")).toBe(true)
    expect(isAllowedTransition("funded", "recover")).toBe(true)
  })

  it("released and recovered are terminal", () => {
    expect(isAllowedTransition("released", "release")).toBe(false)
    expect(isAllowedTransition("released", "recover")).toBe(false)
    expect(isAllowedTransition("recovered", "release")).toBe(false)
  })

  it("disputed → resolve_dispute_release or recover", () => {
    expect(isAllowedTransition("disputed", "resolve_dispute_release")).toBe(true)
    expect(isAllowedTransition("disputed", "recover")).toBe(true)
  })
})

describe("escrow-state-machine: resolveNextState", () => {
  it("fund → funded", () => {
    expect(
      resolveNextState("pending", "fund", { now, recovery_unlock_at: tomorrow })
    ).toBe("funded")
  })

  it("release → released", () => {
    expect(
      resolveNextState("funded", "release", { now, recovery_unlock_at: tomorrow })
    ).toBe("released")
  })

  it("dispute → disputed", () => {
    expect(
      resolveNextState("funded", "dispute", { now, recovery_unlock_at: tomorrow })
    ).toBe("disputed")
  })

  it("recover from funded REQUIRES unlock time to have passed", () => {
    expect(
      resolveNextState("funded", "recover", { now, recovery_unlock_at: tomorrow })
    ).toBeNull()

    expect(
      resolveNextState("funded", "recover", { now, recovery_unlock_at: yesterday })
    ).toBe("recovered")
  })

  it("recover from funded fails when unlock time is null (never set)", () => {
    expect(
      resolveNextState("funded", "recover", { now, recovery_unlock_at: null })
    ).toBeNull()
  })

  it("recover from disputed is allowed regardless of time-lock (arbitrator action)", () => {
    expect(
      resolveNextState("disputed", "recover", { now, recovery_unlock_at: tomorrow })
    ).toBe("recovered")
  })

  it("disallowed transitions return null", () => {
    expect(
      resolveNextState("released", "recover", { now, recovery_unlock_at: yesterday })
    ).toBeNull()
    expect(
      resolveNextState("pending", "release", { now, recovery_unlock_at: tomorrow })
    ).toBeNull()
  })
})
