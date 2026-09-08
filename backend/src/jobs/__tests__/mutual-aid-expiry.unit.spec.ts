import mutualAidExpiryJob, { config } from "../mutual-aid-expiry"
import { MUTUAL_AID_MODULE } from "../../modules/mutual-aid"

/**
 * The scheduled half of the ask-board lifecycle (`docs/CDFI_COOP_ROADMAP.md`
 * §3.8). The sweep rule lives in `MutualAidModuleService.expireStaleAid`, which
 * takes `now` and touches no container; this file is only the schedule, so what
 * is asserted here is that it resolves the right module, passes a real clock,
 * and cannot take the worker down.
 */
const makeContainer = (service: unknown) => ({
  resolve: jest.fn((key: string) =>
    key === MUTUAL_AID_MODULE ? service : undefined
  ),
})

describe("mutual-aid-expiry job", () => {
  it("sweeps through the mutual-aid module with the current time", async () => {
    const service = {
      expireStaleAid: jest.fn(async () => ({
        requests_expired: 2,
        offers_expired: 1,
      })),
    }
    const container = makeContainer(service)
    const before = Date.now()

    await mutualAidExpiryJob(container as never)

    expect(container.resolve).toHaveBeenCalledWith(MUTUAL_AID_MODULE)
    const [now] = service.expireStaleAid.mock.calls[0] as unknown as [Date]
    expect(now).toBeInstanceOf(Date)
    expect(now.getTime()).toBeGreaterThanOrEqual(before)
  })

  it("swallows a failing sweep rather than taking the worker down", async () => {
    // A board with a stale row on it is a worse board, not a broken one — and
    // `matchRequest` refuses the stale row whether or not this ever ran.
    const service = {
      expireStaleAid: jest.fn(async () => {
        throw new Error("connection refused")
      }),
    }

    await expect(
      mutualAidExpiryJob(makeContainer(service) as never)
    ).resolves.toBeUndefined()
  })

  it("survives a container that cannot resolve the module", async () => {
    await expect(
      mutualAidExpiryJob({ resolve: () => undefined } as never)
    ).resolves.toBeUndefined()
  })

  it("runs daily, off the hour the other sweeps use", async () => {
    expect(config.name).toBe("mutual-aid-expiry")
    expect(config.schedule).toBe("0 4 * * *")
  })
})
