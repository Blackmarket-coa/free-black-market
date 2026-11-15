import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

const runTrigger = jest.fn(async () => ({ sent: 1, skipped: 0 }))
jest.mock("../../../../../../modules/wellness/automation-service", () => ({
  WellnessAutomationService: jest.fn().mockImplementation(() => ({ runTrigger })),
}))

import { POST } from "../route"

/**
 * POST /vendor/wellness/automations/test renders the seller's own template
 * with `vars` from the request and sends it; its email fallback really
 * sends now that the `wellness-automation` template exists. So the recipient
 * is restricted to the seller and their team: otherwise any seller can mail
 * any text to any address from FBM's domain. Wellness clients and members are
 * refused too, because the seller writes those lists and can add anyone.
 *
 * The container resolves only the keys the route should use, by constant. The
 * wellness module is not among them: the route must not consult the lists a
 * seller writes, and resolving it fails the case.
 */

function harness() {
  const graph = jest.fn(async () => ({
    data: [{ email: "owner@farm.example", members: [{ email: "Staff@Farm.example" }, { email: null }] }],
  }))
  const services: Record<string, unknown> = {
    [ContainerRegistrationKeys.QUERY]: { graph },
    // requireSellerId resolves these eagerly; a `sel_` actor needs neither.
    [ContainerRegistrationKeys.PG_CONNECTION]: { raw: jest.fn() },
    [Modules.AUTH]: { listAuthIdentities: jest.fn(async () => []) },
  }
  const scope = {
    resolve(key: string) {
      if (!(key in services)) throw new Error(`unexpected container key in spec: ${key}`)
      return services[key]
    },
  }
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
      return this
    },
  }
  return { scope, res, graph }
}

async function send(recipient: string) {
  const h = harness()
  const req = {
    scope: h.scope,
    auth_context: { actor_id: "sel_1", actor_type: "seller" },
    headers: {},
    body: { trigger: "booking_reminder", recipient_email: recipient, vars: { name: "Sam" } },
  }
  await POST(req as never, h.res as never)
  return h
}

beforeEach(() => runTrigger.mockClear())

describe("POST /vendor/wellness/automations/test: who a test may go to", () => {
  it("refuses an address that is not the seller's or their team's, and sends nothing", async () => {
    const h = await send("stranger@example.com")
    expect(h.res.statusCode).toBe(403)
    expect(h.res.body).toMatchObject({ type: "not_allowed" })
    expect(runTrigger).not.toHaveBeenCalled()
  })

  it("sends to the seller's own address, whatever its case", async () => {
    const h = await send("  Owner@Farm.Example ")
    expect(h.res.statusCode).toBe(200)
    expect(runTrigger).toHaveBeenCalledWith(
      expect.objectContaining({ seller_id: "sel_1", recipients: [{ email: "Owner@Farm.Example", name: null }] })
    )
    expect(h.graph).toHaveBeenCalledWith(
      expect.objectContaining({ entity: "seller", filters: { id: "sel_1" } })
    )
  })

  it("sends to a member of the seller's team", async () => {
    await send("staff@farm.example")
    expect(runTrigger).toHaveBeenCalledTimes(1)
  })

  it("refuses a wellness client or member: the seller writes those lists and can add anyone", async () => {
    // Before, a seller could POST /vendor/wellness/clients with a stranger's
    // address and then test-send to it. The harness has no wellness module,
    // so a route that looked the address up there would throw, not pass.
    for (const address of ["client@example.com", "member@example.com"]) {
      const h = await send(address)
      expect(h.res.statusCode).toBe(403)
    }
    expect(runTrigger).not.toHaveBeenCalled()
  })

  it("still answers 400 without a recipient", async () => {
    const h = await send("")
    expect(h.res.statusCode).toBe(400)
    expect(runTrigger).not.toHaveBeenCalled()
  })
})
