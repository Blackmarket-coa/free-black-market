import { Modules } from "@medusajs/framework/utils"

/**
 * The per-seller hourly send budget of the wellness automations lives in the
 * shared rate-limit store (Redis when REDIS_URL is set), not in a Map in the
 * module: a Map counted 50 per process and forgot them on restart. Since the
 * `wellness-automation` email template exists, a send that falls back to
 * email really leaves, so the budget has to mean what it says.
 */

// Pin the in-memory store before the limiter module loads.
const ORIGINAL_REDIS_URL = process.env.REDIS_URL
delete process.env.REDIS_URL

afterAll(() => {
  if (ORIGINAL_REDIS_URL === undefined) delete process.env.REDIS_URL
  else process.env.REDIS_URL = ORIGINAL_REDIS_URL
})

jest.mock("../../../shared/chat", () => ({ getChatProvider: () => null }))
// The real limiter store, observed: the factory runs on first require, after
// REDIS_URL is cleared above.
jest.mock("../../../shared/rate-limiter", () => {
  const actual = jest.requireActual("../../../shared/rate-limiter")
  return { ...actual, consumeRateLimit: jest.fn(actual.consumeRateLimit) }
})

const limiter = require("../../../shared/rate-limiter") as typeof import("../../../shared/rate-limiter")
const consume = limiter.consumeRateLimit as jest.MockedFunction<typeof limiter.consumeRateLimit>
const { WellnessAutomationService, WELLNESS_SEND_BUDGET } =
  require("../automation-service") as typeof import("../automation-service")

function service() {
  const createNotifications = jest.fn(async () => [])
  const container = {
    resolve(key: string) {
      if (key === Modules.NOTIFICATION) return { createNotifications }
      throw new Error(`unexpected container key in spec: ${key}`)
    },
  }
  return { svc: new WellnessAutomationService(container as never), createNotifications }
}

const dm = (seller: string) => ({
  seller_id: seller,
  recipient_email: "client@example.com",
  body: "See you tomorrow",
  channel: "email" as const,
})

describe("wellness automation send budget", () => {
  it("is spent through the shared limiter store, keyed per seller, 50 an hour", async () => {
    const { svc } = service()
    await svc.sendDM(dm("sel_key"))
    expect(consume).toHaveBeenLastCalledWith("wellness-send:sel_key", 3_600_000, 50)
    expect(WELLNESS_SEND_BUDGET).toEqual({ keyPrefix: "wellness-send", windowMs: 3_600_000, max: 50 })
  })

  it("sends the email fallback 50 times in an hour for one seller, then skips without sending, across service instances", async () => {
    const a = service()
    const b = service()
    const results: Array<Awaited<ReturnType<InstanceType<typeof WellnessAutomationService>["sendDM"]>>> = []
    for (let i = 0; i < 25; i++) results.push(await a.svc.sendDM(dm("sel_budget")))
    for (let i = 0; i < 25; i++) results.push(await b.svc.sendDM(dm("sel_budget")))
    expect(results.every((r) => r.ok && r.channel === "email")).toBe(true)

    const over = await b.svc.sendDM(dm("sel_budget"))
    expect(over).toEqual({ channel: "skipped", ok: false })
    expect(a.createNotifications).toHaveBeenCalledTimes(25)
    expect(b.createNotifications).toHaveBeenCalledTimes(25)

    // Another seller's budget is untouched.
    expect((await a.svc.sendDM(dm("sel_other"))).ok).toBe(true)
  })

  it("sends the fallback as the wellness-automation template on the email channel", async () => {
    const { svc, createNotifications } = service()
    await svc.sendDM(dm("sel_template"))
    expect(createNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ to: "client@example.com", channel: "email", template: "wellness-automation" })
    )
  })
})
