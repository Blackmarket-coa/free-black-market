import donationBatchDisbursementJob, { config } from "../donation-batch-disbursement"
import { DONATION_MODULE } from "../../modules/donation"
import { PHASE0_FEATURE_FLAGS } from "../../shared/feature-flags"

/**
 * S10: the weekly batch disbursement is the bookkeeping half of the legacy
 * tier-2 accrual path (donations on FBM's books — legal checkpoint L24). Under
 * FF_NONPROFIT_PARITY_V1 donations are direct charges on the org's own
 * account and there is nothing of FBM's to disburse, so the job must not even
 * resolve the donation module. With the flag off it runs exactly as before.
 */
const FLAG = PHASE0_FEATURE_FLAGS.NONPROFIT_PARITY_V1

function makeContainer() {
  const queueBatchDisbursement = jest.fn(async () => ({ skipped: false, count: 2 }))
  const resolved: string[] = []
  const container = {
    resolve: (key: string) => {
      resolved.push(key)
      if (key === DONATION_MODULE) return { queueBatchDisbursement }
      // awilix throws on an unknown key; a stub that answered any string would
      // let a wrong constant pass by fallback (CLAUDE.md rule 2).
      throw new Error(`Could not resolve '${key}'`)
    },
  }
  return { container: container as never, queueBatchDisbursement, resolved }
}

afterEach(() => {
  delete process.env[FLAG]
})

describe("donation-batch-disbursement job", () => {
  it("is the weekly job it always was", () => {
    expect(config).toEqual({ name: "donation-batch-disbursement", schedule: "0 3 * * 1" })
  })

  it("flag on: skips without resolving anything and says why", async () => {
    process.env[FLAG] = "true"
    const { container, queueBatchDisbursement, resolved } = makeContainer()
    const result = await donationBatchDisbursementJob(container)
    expect(result).toEqual({ skipped: true, reason: expect.stringContaining("FF_NONPROFIT_PARITY_V1") })
    expect(queueBatchDisbursement).not.toHaveBeenCalled()
    expect(resolved).toEqual([])
  })

  it("flag off: resolves the donation module by its imported key and queues the last seven days", async () => {
    const { container, queueBatchDisbursement, resolved } = makeContainer()
    const before = Date.now()
    const result = await donationBatchDisbursementJob(container)
    expect(result).toEqual({ skipped: false, count: 2 })
    expect(resolved).toEqual([DONATION_MODULE])
    expect(queueBatchDisbursement).toHaveBeenCalledTimes(1)
    const [start, end] = queueBatchDisbursement.mock.calls[0] as unknown as [Date, Date]
    expect(end.getTime()).toBeGreaterThanOrEqual(before)
    expect(end.getTime() - start.getTime()).toBe(7 * 86400000)
  })

  it("flag off, ledger_batch not selected: passes the service's skip reason through", async () => {
    const { container, queueBatchDisbursement } = makeContainer()
    queueBatchDisbursement.mockResolvedValueOnce({ skipped: true, reason: "settlement mode is not ledger_batch" } as never)
    const result = await donationBatchDisbursementJob(container)
    expect(result).toEqual({ skipped: true, reason: "settlement mode is not ledger_batch" })
  })

  it("flag set to anything but the literal \"true\" leaves the job running", async () => {
    process.env[FLAG] = "1"
    const { container, queueBatchDisbursement } = makeContainer()
    await donationBatchDisbursementJob(container)
    expect(queueBatchDisbursement).toHaveBeenCalledTimes(1)
  })
})
