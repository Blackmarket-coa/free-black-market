import hawalaCardStripeResyncJob, { config } from "../hawala-card-stripe-resync"
import { PHASE0_FEATURE_FLAGS } from "../../shared/feature-flags"

/**
 * The hourly Stripe re-read's guards (SD-43 (b)). What it re-reads, and what
 * that posts or releases, is proved on a real database in
 * integration-tests/http/hawala-card-stripe-sync.spec.ts; here, when it runs
 * at all: hourly, never with the card-ledger flag off, never without the
 * payment provider's Stripe key, and never throwing out of the job.
 */

const FLAG = PHASE0_FEATURE_FLAGS.CARD_ORDER_LEDGER_V1

describe("hawala-card-stripe-resync job", () => {
  const saved = { flag: process.env[FLAG], key: process.env.STRIPE_API_KEY }
  afterEach(() => {
    if (saved.flag === undefined) delete process.env[FLAG]
    else process.env[FLAG] = saved.flag
    if (saved.key === undefined) delete process.env.STRIPE_API_KEY
    else process.env.STRIPE_API_KEY = saved.key
  })
  const containerSpy = () => {
    const resolve = jest.fn(() => {
      throw new Error("resolved")
    })
    return { container: { resolve } as never, resolve }
  }

  it("runs hourly, off the hour", () => {
    expect(config).toEqual({ name: "hawala-card-stripe-resync", schedule: "23 * * * *" })
  })

  it("flag off: reads nothing", async () => {
    delete process.env[FLAG]
    process.env.STRIPE_API_KEY = "sk_test_x"
    const { container, resolve } = containerSpy()
    await hawalaCardStripeResyncJob(container)
    expect(resolve).not.toHaveBeenCalled()
  })

  it("no Stripe key: reads nothing", async () => {
    process.env[FLAG] = "true"
    delete process.env.STRIPE_API_KEY
    const { container, resolve } = containerSpy()
    await hawalaCardStripeResyncJob(container)
    expect(resolve).not.toHaveBeenCalled()
  })

  it("flag on with a key: runs, and a failure never escapes the job", async () => {
    process.env[FLAG] = "true"
    process.env.STRIPE_API_KEY = "sk_test_x"
    const { container, resolve } = containerSpy()
    await expect(hawalaCardStripeResyncJob(container)).resolves.toBeUndefined()
    expect(resolve).toHaveBeenCalled()
  })
})
