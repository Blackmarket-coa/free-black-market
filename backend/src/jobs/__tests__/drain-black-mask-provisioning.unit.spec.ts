jest.mock("../../links/subscription-order", () => ({
  __esModule: true,
  default: { entryPoint: "subscription_order_link_test" },
}))

import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import job, { config } from "../drain-black-mask-provisioning"
import { MARKETPLACE_WEBHOOKS_MODULE } from "../../modules/marketplace-webhooks"
import { makeHarness } from "../../modules/marketplace-webhooks/__tests__/black-mask-harness"
import { buildBlackMaskPayload } from "../../modules/marketplace-webhooks/black-mask"
import { PHASE0_FEATURE_FLAGS } from "../../shared/feature-flags"

/**
 * The Black Mask drain job: dark (resolves nothing) while the flag is off or
 * the config is incomplete; otherwise drives the REAL service's drain, with
 * the send-time customer lookup going through query on its imported key.
 */

const FLAG = PHASE0_FEATURE_FLAGS.BLACK_MASK_PROVISIONING_V1
const ENV = [FLAG, "BLACK_MASK_PROVISIONING_URL", "BLACK_MASK_WEBHOOK_SECRET", "BLACK_MASK_WEBHOOK_KEY_ID", "BLACK_MASK_SELLER_ID"] as const

function enable() {
  process.env[FLAG] = "true"
  process.env.BLACK_MASK_PROVISIONING_URL = "https://bm.example/hooks/fbm"
  process.env.BLACK_MASK_WEBHOOK_SECRET = "s"
  process.env.BLACK_MASK_WEBHOOK_KEY_ID = "k1"
  process.env.BLACK_MASK_SELLER_ID = "sel_bmc"
}

afterEach(() => {
  for (const k of ENV) delete process.env[k]
  jest.restoreAllMocks()
})

function world() {
  const harness = makeHarness()
  const resolved: string[] = []
  const query = {
    graph: async (args: { entity: string; filters?: Record<string, unknown> }) => {
      if (args.entity !== "customer") throw new Error(`unexpected entity ${args.entity}`)
      return { data: args.filters?.id === "cus_1" ? [{ id: "cus_1", email: "m@example.org", metadata: {} }] : [] }
    },
  }
  const container = {
    resolve: <T,>(key: string): T => {
      resolved.push(key)
      if (key === MARKETPLACE_WEBHOOKS_MODULE) return harness.svc as unknown as T
      if (key === ContainerRegistrationKeys.QUERY) return query as unknown as T
      throw new Error(`Could not resolve '${key}'`)
    },
  }
  return { ...harness, container, resolved }
}

it("runs every minute under its own name", () => {
  expect(config).toEqual({ name: "drain-black-mask-provisioning", schedule: "*/1 * * * *" })
})

it("resolves nothing while the flag is off or the config is incomplete", async () => {
  const w = world()
  expect(await job(w.container as never)).toEqual({ attempted: 0, sent: 0 })
  enable()
  delete process.env.BLACK_MASK_PROVISIONING_URL
  expect(await job(w.container as never)).toEqual({ attempted: 0, sent: 0 })
  expect(w.resolved).toEqual([])
})

it("sends a due `placed` with the email looked up through query at send time", async () => {
  enable()
  const w = world()
  await w.svc.emitBlackMask(
    buildBlackMaskPayload({
      event: "placed",
      subject: { type: "order", id: "order_1" },
      sequence: 1767225600000,
      customerId: "cus_1",
      plan: "vault_monthly",
      seats: 1,
      sellerId: "sel_bmc",
    })
  )
  const bodies: string[] = []
  jest.spyOn(global, "fetch").mockImplementation((async (_url: string, init: { body: string }) => {
    bodies.push(init.body)
    return { ok: true, status: 202, text: async () => "{}" }
  }) as unknown as typeof fetch)

  expect(await job(w.container as never)).toEqual({ attempted: 1, sent: 1 })
  expect(JSON.parse(bodies[0]).customer_email).toBe("m@example.org")
  expect(w.rows[0].status).toBe("succeeded")
  expect(w.resolved).toEqual([MARKETPLACE_WEBHOOKS_MODULE, ContainerRegistrationKeys.QUERY])
})
