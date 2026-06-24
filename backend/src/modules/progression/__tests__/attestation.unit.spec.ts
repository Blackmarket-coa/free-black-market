/**
 * Peer-attestation unit tests.
 *
 * `recordAttestedXpEvent` is exercised on a prototype instance with the two
 * persistence calls it makes (`createXpAttestations`, `recordXpEvent`) stubbed,
 * so the trust logic is tested without a database:
 *   - self-attestation is rejected
 *   - the weight is clamped to [MIN, MAX]
 *   - the awarded amount is base × clampedWeight (floored at 1)
 *   - an attestation row is written linking subject ↔ attester
 */
import ProgressionModuleService, {
  SelfAttestationError,
  ATTESTATION_WEIGHT_MIN,
  ATTESTATION_WEIGHT_MAX,
} from "../service"
import { Stance } from "../stance"

function makeService() {
  // Prototype instance so the real method runs against stubbed persistence.
  const svc: any = Object.create(ProgressionModuleService.prototype)
  svc.createXpAttestations = jest.fn().mockResolvedValue([{ id: "att_1" }])
  svc.recordXpEvent = jest.fn().mockResolvedValue({ id: "sheet" })
  return svc as ProgressionModuleService & Record<string, jest.Mock>
}

const base = {
  customer_id: "cus_1",
  role: Stance.COALITION,
  amount: 100,
  reason: "volunteer-verified",
  source_module: "volunteer_log",
  source_id: "log_1",
}

describe("recordAttestedXpEvent", () => {
  it("rejects self-attestation", async () => {
    const svc = makeService()
    await expect(
      svc.recordAttestedXpEvent(base, { attesterId: "cus_1" })
    ).rejects.toBeInstanceOf(SelfAttestationError)
    expect(svc.createXpAttestations).not.toHaveBeenCalled()
  })

  it("rejects a missing attester", async () => {
    const svc = makeService()
    await expect(
      svc.recordAttestedXpEvent(base, { attesterId: "" })
    ).rejects.toBeInstanceOf(SelfAttestationError)
  })

  it("awards base × weight and writes an attestation row", async () => {
    const svc = makeService()
    await svc.recordAttestedXpEvent(base, { attesterId: "cus_admin", weight: 1.5 })
    expect(svc.createXpAttestations).toHaveBeenCalledWith(
      expect.objectContaining({
        subject_customer_id: "cus_1",
        attester_customer_id: "cus_admin",
        weight: 1.5,
      })
    )
    expect(svc.recordXpEvent).toHaveBeenCalledWith(
      expect.objectContaining({ customer_id: "cus_1", role: Stance.COALITION, amount: 150 })
    )
  })

  it("clamps weight above the max", async () => {
    const svc = makeService()
    await svc.recordAttestedXpEvent(base, { attesterId: "cus_admin", weight: 99 })
    expect(svc.recordXpEvent).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 100 * ATTESTATION_WEIGHT_MAX })
    )
  })

  it("clamps weight below the min", async () => {
    const svc = makeService()
    await svc.recordAttestedXpEvent(base, { attesterId: "cus_admin", weight: 0 })
    expect(svc.recordXpEvent).toHaveBeenCalledWith(
      expect.objectContaining({ amount: Math.round(100 * ATTESTATION_WEIGHT_MIN) })
    )
  })

  it("defaults weight to 1 when none is given", async () => {
    const svc = makeService()
    await svc.recordAttestedXpEvent(base, { attesterId: "cus_admin" })
    expect(svc.recordXpEvent).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 100 })
    )
  })
})
